"""Render explicit provider deployment documents in memory. Never deploys."""
import copy
import json
import re
from cloud_provider import configuration_bytes
from guard import need, project_check


def render(config):
    configuration_bytes(config)
    project = project_check(config)
    provider = config['provider']
    need(provider.get('enabled') is True and config['region'] == 'us-central1', 'provider configuration incomplete')
    image = provider['controlImageDigest']
    need(re.fullmatch(re.escape('us-central1-docker.pkg.dev/' + project + '/') + r'[a-z0-9/-]+@sha256:[0-9a-f]{64}', image), 'exact control image digest required')
    base = f'projects/{project}/locations/us-central1'
    need(len({provider[role + 'ServiceAccount'] for role in ('controller','watchdog','workflow','scheduler')}) == 4,
         'independent control identities required')
    labels = {'bs-run':config['runId'],'bs-candidate-a':config['candidateDigest'][:32],
              'bs-candidate-b':config['candidateDigest'][32:]}
    result = {}
    for role, action in [('controller','start'),('watchdog','watchdog')]:
        name = provider[role + 'Job']
        identity = provider[role + 'ServiceAccount']
        need(re.fullmatch(r'[a-z][a-z0-9-]{1,61}[a-z0-9]',name), 'invalid exact control job')
        need(identity.endswith('@' + project + '.iam.gserviceaccount.com'), 'wrong control identity')
        # Read-only approved configuration/approval and separately provisioned
        # public trust roots. They are not credentials; no Secret Manager read.
        config_bucket = provider['configurationBucket']
        trust_bucket = provider['trustBucket']
        need(config_bucket != trust_bucket, 'trust roots must be a separately controlled immutable input')
        result[role + 'Job'] = {'name':base + '/jobs/' + name,'labels':labels,
            'template':{'taskCount':1,'parallelism':1,'labels':labels,'template':{
                'serviceAccount':identity,'maxRetries':0,'timeout':'600s',
                'containers':[{'image':image,'resources':{'limits':{'cpu':'1','memory':'512Mi'}},
                    'args':['--mode','execute','--action',action,
                        '--config','/config/configuration.json','--approval','/config/approval.json',
                        '--trusted-keys','/trust/trusted-keys.json','--node','/usr/local/bin/node',
                        '--verifier','/app/tool/postgis_staging/verify-approval.cjs'],
                    'volumeMounts':[{'name':'config','mountPath':'/config'}, {'name':'trust','mountPath':'/trust'}]}],
                'volumes':[{'name':'config','gcs':{'bucket':config_bucket,'readOnly':True}},
                           {'name':'trust','gcs':{'bucket':trust_bucket,'readOnly':True}}]}}}
    # No workflow input parameters: a Scheduler request cannot select another
    # project, job, image, actor, config or resource. No automatic HTTP retry.
    workflow = provider['watchdogWorkflow']
    scheduler = provider['watchdogScheduler']
    scheduler_sa = provider['schedulerServiceAccount']
    workflow_sa = provider['workflowServiceAccount']
    for name in (workflow,scheduler): need(re.fullmatch(r'[a-z][a-z0-9-]{1,61}[a-z0-9]',name), 'invalid control name')
    for identity in (scheduler_sa,workflow_sa):
        need(identity.endswith('@' + project + '.iam.gserviceaccount.com'), 'wrong trigger identity')
    result['workflow'] = {'name':base + '/workflows/' + workflow,'serviceAccount':workflow_sa,
        'sourceContents':json.dumps({'main':{'steps':[
            {'invokeIndependentWatchdog':{'call':'http.post','args':{
                'url':'https://run.googleapis.com/v2/' + result['watchdogJob']['name'] + ':run',
                'auth':{'type':'OAuth2'},'timeout':30,'body':{}},'result':'operation'}},
            {'accepted':{'return':'Watchdog invocation requested; completion and alert delivery remain unproven.'}}
        ]}})}
    result['scheduler'] = {'name':base + '/jobs/' + scheduler,'schedule':'* * * * *','timeZone':'Etc/UTC',
        'attemptDeadline':'30s','retryConfig':{'retryCount':0},'httpTarget':{
            'uri':'https://workflowexecutions.googleapis.com/v1/' + base + '/workflows/' + workflow + '/executions',
            'httpMethod':'POST','oauthToken':{'serviceAccountEmail':scheduler_sa},
            'headers':{'Content-Type':'application/json'},'body':'e30='}}
    # Delivery channels are existing owner-approved Monitoring channel names.
    channels = provider['monitoringChannels']
    need(isinstance(channels,list) and len(channels) >= 2 and len(set(channels)) == len(channels), 'two independent alert channels required')
    need(all(re.fullmatch(r'projects/' + re.escape(project) + r'/notificationChannels/[0-9]+', x) for x in channels), 'wrong alert channel project')
    result['watchdogFailureAlert'] = {'displayName':config['runId'] + ' watchdog failures',
        'enabled':True,'combiner':'OR','notificationChannels':channels,'conditions':[{
            'displayName':'Independent watchdog job failed','conditionThreshold':{
                'filter':'resource.type="cloud_run_job" AND resource.labels.job_name="' + provider['watchdogJob'] + '" AND metric.type="run.googleapis.com/job/completed_execution_count" AND metric.labels.result="failed"',
                'comparison':'COMPARISON_GT','thresholdValue':0,'duration':'0s',
                'aggregations':[{'alignmentPeriod':'60s','perSeriesAligner':'ALIGN_SUM'}]}}]}
    return copy.deepcopy(result)


if __name__ == '__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__); parser.add_argument('--config',required=True)
    args=parser.parse_args()
    with open(args.config) as source: configuration=json.load(source)
    print(json.dumps(render(configuration),indent=2))
