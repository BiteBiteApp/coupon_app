"""Explicit source-only controller job entrypoint; dry-run is the default.

Imports never access credentials. Execute requires signed approval and complete
exact configuration before the lazily invoked metadata credential provider.
"""
import argparse
import json
import time
import urllib.request
from pathlib import Path

from cloud_controller import Controller, SignedApproval
from cloud_provider import GcsControlStore, GoogleResources, HttpsTransport
from guard import need, project_check


def summarize_result(action, result):
    """Only controller-generated states; no raw provider body/credentials."""
    summary = {'action': action}
    if action == 'watchdog':
        summary['safetyAction'] = result['action']
        summary['resources'] = [{'resource': item['resource'], 'state': item['state']}
                                for item in result.get('resources', [])]
        summary['alert'] = result.get('alert', 'not-requested')
        unresolved = any(item['state'] in ('unknown-or-refused', 'create-outcome-unresolved')
                         for item in summary['resources']) or summary['alert'] == 'publish-failed-delivery-unproven'
        summary['status'] = 'unresolved' if unresolved else 'bounded-safety-step-finished'
        summary['removalComplete'] = False  # Separate all-resource + retained-charge reconciliation.
        return summary, 2 if unresolved else 0
    if 'absent' in result:
        summary.update(state='absence-verified' if result['absent'] else 'still-present',
                       retainedChargesReconciled=False)
    elif 'done' in result:
        summary['state'] = 'operation-complete-absence-unproven' if result['done'] else 'provider-operation-pending'
    elif result.get('deletionRequested'):
        summary['state'] = 'deletion-requested-absence-unproven'
    elif isinstance(result.get('state'), str):
        summary['state'] = result['state']
    else:
        summary['state'] = result.get('state', {}).get('status', 'control-state-persisted')
    if 'failed' in result:
        summary['failed'] = result['failed'] is True
    return summary, 2 if result.get('failed') is True else 0


class MetadataToken:
    def __init__(self, config, service_account, clock):
        self.config, self.service_account, self.clock = config, service_account, clock
        self.token, self.expires = None, 0

    def _get(self, suffix):
        # Fixed link-local metadata origin; never a URL supplied by the request.
        request = urllib.request.Request('http://169.254.169.254/computeMetadata/v1/' + suffix,
                                         headers={'Metadata-Flavor': 'Google'})
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs): return None
        with urllib.request.build_opener(NoRedirect).open(request, timeout=3) as response:
            need(response.headers.get('Metadata-Flavor') == 'Google', 'invalid metadata response')
            value = response.read(16385)
            need(len(value) <= 16384, 'metadata response exceeds bound')
            return value.decode()

    def __call__(self):
        if self.token is None or self.clock() >= self.expires - 60:
            need(self._get('project/project-id') == self.config['projectId'], 'runtime project mismatch')
            need(self._get('project/numeric-project-id') == str(self.config['projectNumber']), 'runtime project number mismatch')
            need(self._get('instance/service-accounts/default/email') == self.service_account, 'runtime service identity mismatch')
            token = json.loads(self._get('instance/service-accounts/default/token'))
            need(token.get('token_type') == 'Bearer' and 60 < token.get('expires_in', 0) <= 3600, 'invalid metadata credential')
            self.token, self.expires = token['access_token'], self.clock() + token['expires_in']
        return self.token


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=['dry-run', 'execute'], default='dry-run')
    parser.add_argument('--action', choices=['start', 'watchdog', 'create', 'run-job', 'job-status', 'poll', 'cleanup-poll', 'absence', 'delete', 'confirm-controls', 'begin-work', 'confirm-checkpoint', 'complete-gate', 'heartbeat'], default='watchdog')
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--approval', type=Path)
    parser.add_argument('--trusted-keys', type=Path)
    parser.add_argument('--node', type=Path)
    parser.add_argument('--verifier', type=Path)
    parser.add_argument('--request', type=Path)
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    if args.mode == 'dry-run':
        print(json.dumps({'mode': 'dry-run', 'externalActions': False, 'credentialsRead': False,
                          'executionApproved': False, 'timerStarted': False}))
        return
    project_check(config)
    need(all(value is not None for value in [args.approval, args.trusted_keys, args.node, args.verifier]), 'explicit signed approval dependencies missing')
    cleanup = args.action in ('watchdog', 'absence', 'delete', 'cleanup-poll')
    clock = time.time
    approval = SignedApproval(config, json.loads(args.approval.read_text()), args.node,
                              args.verifier, args.trusted_keys, clock)
    approval.verify(5 if cleanup else 1, cleanup)
    identity = config['provider']['watchdogServiceAccount' if cleanup else 'controllerServiceAccount']
    need(config['provider']['controllerServiceAccount'] != config['provider']['watchdogServiceAccount'], 'independent watchdog identity required')
    need(isinstance(identity, str) and identity.endswith('@' + config['projectId'] + '.iam.gserviceaccount.com'), 'wrong service account project')
    transport = HttpsTransport(MetadataToken(config, identity, clock), lambda: approval.verify(5 if cleanup else 1, cleanup))
    resources = GoogleResources(config, transport)
    controller = Controller(config, approval, GcsControlStore(config, transport), resources, clock, cleanup_only=cleanup)
    request = {} if args.request is None else json.loads(args.request.read_text())
    if args.action == 'watchdog': result = controller.safety_tick()
    elif args.action == 'start': result = controller.start()
    elif args.action == 'confirm-controls': result = controller.confirm_controls(request)
    elif args.action == 'confirm-checkpoint':
        result = controller.confirm_early_checkpoint(SignedApproval(config, request, args.node,
            args.verifier, args.trusted_keys, clock))
    elif args.action == 'begin-work': result = controller.begin_work()
    elif args.action == 'complete-gate': result = controller.complete_gate(request['gate'], request['evidenceDigest'])
    elif args.action == 'heartbeat':
        result = controller.heartbeat(request['activeSeconds'], request['costUpper'], request['counts'], request['storageGiB'])
    else:
        matches = [item for item in config['provider']['resources'] if item['kind'] == request.get('kind') and item['id'] == request.get('id')]
        need(len(matches) == 1, 'unapproved exact resource')
        resource = matches[0]
        if args.action == 'create':
            controller.reserve_create(resource, request['reservation'])
            result = controller.create_once(resource)
        elif args.action == 'run-job': result = controller.run_job_once(resource, request['reservation'])
        elif args.action == 'job-status': result = controller.reconcile_job_execution(resource)
        elif args.action in ('poll', 'cleanup-poll'): result = controller.poll_once(resource, cleanup)
        elif args.action == 'delete': result = controller.delete_owned(resource)
        else: result = controller.verify_absence(resource)
    # Only bounded operational state. Never output credentials/provider raw bodies.
    summary, status = summarize_result(args.action, result)
    print(json.dumps(summary))
    return status


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception:
        raise SystemExit('Staging operation refused or unresolved; inspect private controller evidence.') from None
