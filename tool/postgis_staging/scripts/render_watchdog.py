#!/usr/bin/env python3
"""Render only: one Google Workflows tick from a frozen cleanup config/receipt.
No network, credentials, deployment, or caller-supplied workflow arguments.
"""
import argparse
import json
import re
from pathlib import Path
from guard import project_check, need, number

KINDS = {'sql.instance', 'run.service', 'firestore.database'}

def heartbeat_valid(value, run_id, now, max_age):
    """Local mock equivalent of the strict workflow heartbeat conditions below."""
    return (isinstance(value, dict) and value.get('runId') == run_id
            and value.get('status') == 'running'
            and number(value.get('heartbeatAt'))
            and 0 <= now - value['heartbeatAt'] <= max_age)

def unique_steps(workflow):
    """Workflows names are unique across nested scopes of each subworkflow."""
    for sub in workflow.values():
        names = set()
        def visit(value):
            if isinstance(value, dict):
                for key, child in value.items():
                    if key == 'steps':
                        for step in child:
                            need(len(step) == 1, 'invalid step')
                            name = next(iter(step))
                            need(name not in names, 'duplicate workflow step ' + name)
                            names.add(name)
                    visit(child)
            elif isinstance(value, list):
                for child in value: visit(child)
        visit(sub)
    return True

def target(c, resource):
    p = c['projectId']; ident = resource['id']; kind = resource['kind']
    if kind == 'sql.instance':
        url = f'https://sqladmin.googleapis.com/sql/v1beta4/projects/{p}/instances/{ident}'
        condition = '${owned.body.settings.userLabels["bs-run"] != runId or owned.body.createTime != ' + json.dumps(resource['identity']) + '}'
    elif kind == 'run.service':
        url = f'https://run.googleapis.com/v2/projects/{p}/locations/{c["region"]}/services/{ident}'
        condition = '${owned.body.labels["bs-run"] != runId or owned.body.uid != ' + json.dumps(resource['identity']) + '}'
    else:
        url = f'https://firestore.googleapis.com/v1/projects/{p}/databases/{ident}'
        condition = '${owned.body.uid != ' + json.dumps(resource['identity']) + '}'
    return url, condition

def owned_action(resource, url, condition, prefix, pause=False):
    sql_pause = pause and resource['kind'] == 'sql.instance'
    action = {'call': 'http.patch' if sql_pause else 'http.delete',
              'args': {'url': url, 'auth': {'type': 'OAuth2'}, 'timeout': 30}, 'result': 'operation'}
    if sql_pause:
        action['args']['body'] = {'settings': {'activationPolicy': 'NEVER', 'settingsVersion': '${owned.body.settings.settingsVersion}'}}
    return {prefix: {
        'try': {'steps': [
            {prefix+'_read': {'call': 'http.get', 'args': {'url': url, 'auth': {'type': 'OAuth2'}, 'timeout': 30}, 'result': 'owned'}},
            {prefix+'_verify': {'switch': [{'condition': condition, 'steps': [{prefix+'_refuse': {'raise': 'ownership mismatch: action refused'}}]}]}},
            {prefix+'_action': action},
            {prefix+'_record': {'call': 'sys.log', 'args': {'text': '${json.encode_to_string(operation.body)}', 'severity': 'NOTICE'}}}
        ]},
        'except': {'as': 'actionError', 'steps': [
            {prefix+'_log_error': {'call': 'sys.log', 'args': {'text': '${json.encode_to_string(actionError)}', 'severity': 'ERROR'}}}
        ]}
    }}

def render(c, receipt):
    p = project_check(c)
    need(c['region'] == 'us-central1', 'unapproved region')
    need(receipt.get('projectId') == p and receipt.get('runId') == c['runId'], 'receipt identity mismatch')
    need(receipt.get('approvalReference'), 'missing execution approval reference')
    start = receipt['firstBillableAt']; deadline = receipt['deadline']
    need(number(start) and number(deadline), 'invalid clock')
    need(0 < c['lifetimeSeconds'] <= 259200, 'lifetime exceeds 72h')
    need(deadline == start+c['lifetimeSeconds'], 'immutable deadline mismatch')
    need(receipt.get('alertAndShutdownTestPassed') is True or receipt.get('supervisedShutdownTest') is True,
         'managed alert/shutdown test missing; only explicitly supervised test allowed')
    resources = receipt['resources']; need(resources, 'empty cleanup receipt')
    need({r['kind'] for r in resources} == KINDS, 'required resource kinds missing')
    approved = [r for r in c['resources'] if r.get('kind') in KINDS]
    need(len(approved) == len(resources), 'resource manifest count mismatch')
    seen = set(); resolved = []
    for r in resources:
        key = (r['kind'], r['id']); need(key not in seen, 'duplicate resource'); seen.add(key)
        need(re.fullmatch(r'[a-z][a-z0-9-]{0,61}[a-z0-9]', r['id']), 'invalid resource id')
        need(r.get('runId') == c['runId'] and r.get('disposable') is True and isinstance(r.get('identity'), str) and r['identity'], 'invalid ownership receipt')
        matches = [a for a in approved if (a.get('kind'), a.get('id')) == key]
        need(len(matches) == 1 and matches[0] == r, 'unlisted or changed ownership receipt')
        url, condition = target(c, r); need(url == r.get('url'), 'resource URL mismatch')
        resolved.append((r, url, condition))
    bucket = receipt['controlBucket']; need(re.fullmatch(r'[a-z0-9][a-z0-9-]{2,60}', bucket), 'invalid bucket')
    need(receipt['heartbeatObjectMediaUrl'] == f'https://storage.googleapis.com/storage/v1/b/{bucket}/o/heartbeat.json?alt=media', 'heartbeat target mismatch')
    # Fetch and all validation share the fail-closed catch, including KeyError/TypeError.
    heartbeat_conditions = [
        '${get_type(hb.body) != "map"}',
        '${get_type(map.get(hb.body, "heartbeatAt")) != "integer" and get_type(map.get(hb.body, "heartbeatAt")) != "double"}',
        '${hb.body.runId != runId or hb.body.status != "running"}',
        '${hb.body.heartbeatAt > sys.now() or sys.now() - hb.body.heartbeatAt > staleSeconds}'
    ]
    checks = [{'condition': value, 'steps': [{f'heartbeat_bad_{i}': {'raise': 'invalid or stale heartbeat'}}]} for i, value in enumerate(heartbeat_conditions)]
    steps = [
        {'init': {'assign': [{'deadline': deadline-c['teardownLeadSeconds']}, {'heartbeatUrl': receipt['heartbeatObjectMediaUrl']}, {'runId': c['runId']}, {'staleSeconds': c['heartbeatMaxAgeSeconds']}]}},
        {'deadlineCheck': {'switch': [{'condition': '${sys.now() >= deadline}', 'next': 'cleanup_0'}]}},
        {'heartbeat': {'try': {'steps': [
            {'readHeartbeat': {'call': 'http.get', 'args': {'url': '${heartbeatUrl}', 'auth': {'type': 'OAuth2'}, 'timeout': 10}, 'result': 'hb'}},
            {'checkHeartbeat': {'switch': checks}}
        ]}, 'except': {'as': 'heartbeatError', 'steps': [{'heartbeat_fail_closed': {'next': 'pause_0'}}]}}},
        {'healthy': {'return': 'Healthy; next Scheduler tick checks the same immutable deadline.'}}
    ]
    for i, (r, url, condition) in enumerate(resolved):
        steps.append(owned_action(r, url, condition, f'cleanup_{i}'))
    steps.append({'cleanup_done': {'return': 'Deletion requested; reconcile asynchronous completion and retained charges.'}})
    for i, (r, url, condition) in enumerate(v for v in resolved if v[0]['kind'] != 'firestore.database'):
        steps.append(owned_action(r, url, condition, f'pause_{i}', pause=True))
    steps.append({'pause_done': {'return': 'SQL stop and service deletion requested; storage still bills; deadline remains armed.'}})
    workflow = {'main': {'steps': steps}}
    unique_steps(workflow)
    return workflow

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--receipt', type=Path, required=True)
    a = parser.parse_args()
    print(json.dumps(render(json.loads(a.config.read_text()), json.loads(a.receipt.read_text())), indent=2))
if __name__ == '__main__': main()
