import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from cloud_controller import Controller, SignedApproval
from cloud_provider import GcsControlStore, GoogleResources, ProviderError, configuration_bytes
from guard import Rejected, digest
import test_guard


class Approval:
    def __init__(self, config, rejected=False):
        self.config, self.rejected, self.envelope, self.checkpoint = config, rejected, {'synthetic': 'initial'}, None
        self.gates, self.cleanup_until = [1, 2, 3, 4, 5], 999999
        self.valid_until = 999999
    def verify(self, gate=1, cleanup=False):
        if self.rejected: raise Rejected('forged approval')
        return {'approved': True, 'ownerApprovalReference': 'synthetic-signed-fixture',
                'projectId': self.config['projectId'], 'runId': self.config['runId'],
                'configDigest': digest(self.config), 'candidateDigest': self.config['candidateDigest'],
                'validUntil': self.valid_until, 'cleanupUntil': self.cleanup_until, 'approvedGates': self.gates, 'supervisedControlBootstrap': True,
                'costCheckpointUsd': self.checkpoint}


class Store:
    def __init__(self): self.value, self.version, self.lost, self.calls = None, 0, False, 0
    def read(self): self.calls += 1; return copy.deepcopy(self.value)
    def write(self, version, state):
        self.calls += 1
        if str(self.version) != version: raise ProviderError(412)
        self.version += 1
        self.value = {'generation': str(self.version), 'state': copy.deepcopy(state)}
        if self.lost: self.lost = False; raise ProviderError(None)
        return copy.deepcopy(self.value)


class Transport:
    def __init__(self): self.calls, self.replies = [], []
    def request(self, method, url, body=None):
        self.calls.append((method, url, copy.deepcopy(body)))
        if not self.replies: raise AssertionError('unplanned external call: ' + method + ' ' + url)
        result = self.replies.pop(0)
        if isinstance(result, Exception): raise result
        return copy.deepcopy(result)


class CloudControls(unittest.TestCase):
    def setUp(self):
        base = test_guard.Safety(); base.setUp()
        self.config = base.c
        self.config['projectNumber'] = '123456789'
        self.config['provider'] = {'enabled': True, 'controlBucket': 'synthetic-control-only',
            'firstBillableAtMs': 1000000,
            'controlObject': 'runs/' + self.config['runId'] + '/control.json',
            'alertTopic': 'projects/' + self.config['projectId'] + '/topics/synthetic-alert',
            'supervisedControlBootstrap': True, 'resources': []}
        self.now = 1000
        self.transport = Transport()
        self.resources = GoogleResources(self.config, self.transport)
        labels = self.resources.labels()
        project=self.config['projectId']
        self.config['hosted']={'imageDigest':'us-central1-docker.pkg.dev/'+project+'/synthetic/image@sha256:'+'b'*64,
            'network':self.config['runId'],'subnet':self.config['runId'],
            'sql':{'serviceAccountEmail':'synthetic@'+project+'.iam.gserviceaccount.com'}}
        native_template={'scaling':{'minInstanceCount':0,'maxInstanceCount':4},
            'maxInstanceRequestConcurrency':4,'timeout':'30s',
            'serviceAccount':self.config['hosted']['sql']['serviceAccountEmail'],
            'containers':[{'image':self.config['hosted']['imageDigest'],'resources':{'limits':{'cpu':'1','memory':'1Gi'}}}],
            'vpcAccess':{'egress':'PRIVATE_RANGES_ONLY','networkInterfaces':[{
                'network':'projects/'+project+'/global/networks/'+self.config['runId'],
                'subnetwork':'projects/'+project+'/regions/us-central1/subnetworks/'+self.config['runId']}]}}
        self.resource = {'kind': 'run.service', 'id': 'synthetic-service', 'disposable': True,
                         'body': {'labels': labels, 'template':native_template}, 'createReservation': copy.deepcopy(base.r)}
        self.config['provider']['resources'] = [self.resource]
        self.resources = GoogleResources(self.config, self.transport)
        self.store = Store()
        self.controller = Controller(self.config, Approval(self.config), self.store, self.resources, lambda: self.now)
        self.request = base.r
        self.observed = {'name': self.resources.url(self.resource).split('/v2/')[1],
                         'labels': labels, 'uid': 'synthetic-uid-1', 'createTime': '1970-01-01T00:16:40Z', 'etag': 'v1'}

    def running(self):
        self.controller.start(); self.controller.begin_work()

    def reserve(self):
        self.running(); self.controller.reserve_create(self.resource, self.request)

    def owned(self):
        self.reserve()
        self.transport.replies = [None, {'name': 'projects/' + self.config['projectId'] + '/locations/us-central1/operations/op1'}, self.observed]
        # GET absence is represented by 404 at the REST boundary.
        self.transport.replies[0] = ProviderError(404)
        self.controller.create_once(self.resource)

    def test_rejects_production_and_forged_approval_before_any_transport(self):
        for production in (False, True):
            config = copy.deepcopy(self.config)
            if production: config.update(projectId='coupon-app-29446', allowedProjectIds=['coupon-app-29446'])
            with self.assertRaises(Rejected):
                Controller(config, Approval(config, rejected=not production), self.store, self.resources, lambda: self.now)
        self.assertEqual(self.store.calls, 0); self.assertEqual(self.transport.calls, [])

    def test_cleanup_authority_required_before_any_store_or_resource_io(self):
        for gates, until in [([1],999999),([1,5],1001)]:
            approval=Approval(self.config);approval.gates=gates;approval.cleanup_until=until
            with self.assertRaisesRegex(Rejected, 'cleanup authority'):
                Controller(self.config,approval,self.store,self.resources,lambda:self.now)
        self.assertEqual(self.store.calls,0);self.assertEqual(self.transport.calls,[])

    def test_singleton_restart_and_lost_creation_reply_keep_original_clock(self):
        self.store.lost = True
        first = self.controller.start()
        self.now += 50
        second = self.controller.start()
        self.assertEqual(first, second)
        self.assertEqual(first['state']['firstBillableAt'], 1000)
        with self.assertRaises(ProviderError): self.store.write('0', first['state'])

    def test_duplicate_reservation_and_lost_resource_reply_never_recreates(self):
        self.reserve()
        before = self.store.read()['state']['costUpper']
        self.transport.replies = [ProviderError(404), ProviderError(None)]
        with self.assertRaises(ProviderError): self.controller.create_once(self.resource)
        self.assertFalse(self.controller.reserve_create(self.resource, self.request)['executeAllowed'])
        self.transport.replies = [self.observed]
        self.assertEqual(self.controller.create_once(self.resource)['state'], 'observed')
        self.assertEqual(sum(method == 'POST' for method, _, _ in self.transport.calls), 1)
        self.assertEqual(self.store.read()['state']['costUpper'], before)

    def test_lost_create_not_observed_stays_unknown_not_safe_to_repeat(self):
        self.reserve(); self.transport.replies = [ProviderError(404), ProviderError(None)]
        with self.assertRaises(ProviderError): self.controller.create_once(self.resource)
        self.transport.replies = [ProviderError(404)]
        self.assertEqual(self.controller.create_once(self.resource), {'state': 'unknown', 'executeAllowed': False})

    def test_conflicting_request_and_preexisting_resource_refused(self):
        self.reserve()
        with self.assertRaises(Rejected): self.controller.reserve_create(self.resource, {**self.request, 'costUpper': 2})
        self.transport.replies = [self.observed]
        with self.assertRaises(Rejected): self.controller.create_once(self.resource)
        self.assertFalse(any(method == 'POST' for method, _, _ in self.transport.calls))

    def test_replacement_incarnation_cannot_be_deleted(self):
        self.owned(); self.store.value['state']['status'] = 'paused'
        self.transport.replies = [{**self.observed, 'uid': 'replacement'}]
        with self.assertRaises(Rejected): self.controller.delete_owned(self.resource)
        self.assertFalse(any(method == 'DELETE' for method, _, _ in self.transport.calls))

    def test_delete_uses_etag_and_requires_actual_404_for_absence(self):
        self.owned(); self.store.value['state']['status'] = 'paused'
        self.transport.replies = [self.observed, {'name': 'op'}]
        self.assertFalse(self.controller.delete_owned(self.resource)['absenceVerified'])
        self.assertIn('etag=v1', self.transport.calls[-1][1])
        for failure in [ProviderError(403), ProviderError(None)]:
            self.transport.replies = [failure]
            with self.assertRaises(ProviderError): self.controller.verify_absence(self.resource)
        self.transport.replies = [self.observed]
        self.assertFalse(self.controller.verify_absence(self.resource)['absent'])
        self.transport.replies = [ProviderError(404)]
        self.assertTrue(self.controller.verify_absence(self.resource)['absent'])

    def test_delayed_operation_polling_is_bounded_and_wrong_project_refused(self):
        self.owned()
        for done in [False, False, True]:
            self.now += 5
            self.transport.replies = [{'done': done}]
            self.assertEqual(self.controller.poll_once(self.resource)['done'], done)
        key = 'run.service/synthetic-service'
        self.store.value['state']['polls'][key] = 120
        with self.assertRaises(Rejected): self.controller.poll_once(self.resource)
        with self.assertRaises(Rejected): self.resources.poll(self.resource, {'name': 'projects/other/locations/us-central1/operations/op'})

    def test_watchdog_survives_main_runner_restart_and_malformed_heartbeat(self):
        self.owned()
        deadline = self.store.value['state']['deadline']
        self.store.value['state']['heartbeatAt'] = 'malformed'
        watchdog = Controller(self.config, Approval(self.config), self.store, self.resources, lambda: self.now, cleanup_only=True)
        self.transport.replies = [{'done': True}, {'messageIds': ['synthetic']}]
        result = watchdog.safety_tick()
        self.assertEqual(result['action'], 'pause-load-stop-sql-and-alert')
        self.assertEqual(self.store.value['state']['deadline'], deadline)
        self.assertEqual(result['alert'], 'publish-accepted-delivery-unproven')
        with self.assertRaises(Rejected): watchdog.start()

    def test_independent_watchdog_reconciles_async_deletion_and_stops_after_absence(self):
        self.owned();self.store.value['state']['heartbeatAt']='malformed'
        watchdog=Controller(self.config,Approval(self.config),self.store,self.resources,lambda:self.now,cleanup_only=True)
        operation={'name':'projects/'+self.config['projectId']+'/locations/us-central1/operations/delete-op'}
        def tick(replies):
            self.now+=60;self.transport.replies=replies+[{'messageIds':['synthetic']}]
            result=watchdog.safety_tick();self.assertEqual(self.transport.replies,[])
            return result['resources'][0]['state']
        self.assertEqual(tick([{'done':True}]),'provider-operation-completed-recheck-required')
        self.assertEqual(tick([self.observed,self.observed,operation]),'mutation-requested-absence-unproven')
        self.assertEqual(tick([{'done':False}]),'provider-operation-pending')
        self.assertEqual(tick([{'done':True}]),'provider-operation-completed-recheck-required')
        self.assertEqual(tick([ProviderError(403)]),'unknown-or-refused')
        self.assertEqual(tick([ProviderError(404)]),'absence-verified-retained-charges-unreconciled')
        self.assertEqual(tick([]),'absence-previously-verified')
        self.assertEqual(sum(method=='DELETE' for method,_,_ in self.transport.calls),1)

    def test_independent_watchdog_recovers_lost_create_receipt_without_main_runner(self):
        self.reserve();self.transport.replies=[ProviderError(404),ProviderError(None)]
        with self.assertRaises(ProviderError):self.controller.create_once(self.resource)
        self.now+=181
        watchdog=Controller(self.config,Approval(self.config),self.store,self.resources,lambda:self.now,cleanup_only=True)
        operation={'name':'projects/'+self.config['projectId']+'/locations/us-central1/operations/delete-op'}
        self.transport.replies=[self.observed,self.observed,self.observed,operation,{'messageIds':['synthetic']}]
        result=watchdog.safety_tick()
        self.assertEqual(result['resources'][0]['state'],'mutation-requested-absence-unproven')
        self.assertEqual(self.transport.replies,[])
        self.assertEqual(sum(method=='POST' and ':publish' not in url for method,url,_ in self.transport.calls),1)

    def test_immutable_deadline_and_cost_bound_stop_work(self):
        self.running()
        self.store.value['state']['deadline'] += 1
        with self.assertRaises(Rejected): self.controller.reserve_create(self.resource, self.request)
        self.store.value['state']['deadline'] -= 1
        self.store.value['state']['costUpper'] = 99
        with self.assertRaisesRegex(Rejected, r'\$100 checkpoint'):
            self.controller.reserve_create(self.resource, self.request)

    def test_sql_stop_conditional_delete_requires_explicit_separate_policy(self):
        sql = {'kind': 'sql.instance', 'id': 'synthetic-sql', 'disposable': True, 'body': {}}
        config = copy.deepcopy(self.config); config['provider']['resources'] = [sql]
        provider = GoogleResources(config, self.transport)
        raw = {'project': config['projectId'], 'name': sql['id'], 'createTime': '1970-01-01T00:16:40Z',
               'settings': {'userLabels': provider.labels(), 'settingsVersion': '7'}}
        receipt = provider.identity(sql, raw)
        self.transport.replies = [raw, {'name': 'stop-op'}]
        provider.stop_sql(sql, receipt)
        self.assertEqual(self.transport.calls[-1][2]['settings']['settingsVersion'], '7')
        self.transport.replies = [raw]
        with self.assertRaisesRegex(Rejected, 'single-use-name'): provider.delete(sql, receipt)
        config['provider']['sqlExclusiveDeletion'] = {'approved': True, 'singleUseNames': True,
            'exclusiveControllerOwnership': True, 'ownerApprovalReference': 'synthetic-policy'}
        provider = GoogleResources(config, self.transport)
        self.transport.replies = [raw, {'name': 'delete-op'}]
        provider.delete(sql, receipt)
        self.assertTrue(self.transport.calls[-1][1].endswith('?enableFinalBackup=false'))

    def test_gcs_generation_cas_reads_exact_version_and_permission_is_not_absence(self):
        store = GcsControlStore(self.config, self.transport)
        bucket = {'projectNumber': self.config['projectNumber']}
        self.transport.replies = [bucket, {'generation': '17'}, {'synthetic': True}]
        self.assertEqual(store.read()['generation'], '17')
        self.assertIn('generation=17', self.transport.calls[-1][1])
        self.transport.replies = [bucket, {'generation': '18'}]
        store.write('17', {'synthetic': True})
        self.assertIn('ifGenerationMatch=17', self.transport.calls[-1][1])
        for status in [403, 412]:
            self.transport.replies = [bucket, ProviderError(status)]
            with self.assertRaises(ProviderError): store.read()
        self.transport.replies = [{'projectNumber': 'different'}]
        with self.assertRaises(Rejected): store.read()

    def test_import_and_dry_run_need_no_credentials_or_cloud_transport(self):
        script = Path(__file__).parent / 'provider_entrypoint.py'
        config = script.parents[1] / 'config' / 'staging.json'
        result = subprocess.run([sys.executable, str(script), '--config', str(config)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['externalActions'], False)

    def test_signed_bootstrap_start_precedes_control_store_and_cannot_move(self):
        self.now += 60
        self.assertEqual(self.controller.start()['state']['firstBillableAt'], 1000)
        self.store = Store()
        controller = Controller(self.config, Approval(self.config), self.store, self.resources, lambda: 1900)
        with self.assertRaisesRegex(Rejected, 'initialization window'): controller.start()
        self.assertIsNone(self.store.value)

    def test_coherent_clock_rewrite_and_stale_reserved_create_are_refused(self):
        self.reserve()
        self.store.value['state']['firstBillableAt'] += 1
        self.store.value['state']['deadline'] += 1
        with self.assertRaisesRegex(Rejected, 'signed original start'): self.controller.create_once(self.resource)
        self.store.value['state']['firstBillableAt'] -= 1
        self.store.value['state']['deadline'] -= 1
        self.now += 181
        self.transport.replies = [ProviderError(404)]
        with self.assertRaisesRegex(Rejected, 'stale accounting'): self.controller.create_once(self.resource)
        self.assertEqual(self.store.value['state']['intents']['run.service/synthetic-service']['phase'], 'reserved')
        self.assertFalse(any(method == 'POST' for method,_,_ in self.transport.calls))

    def test_descriptors_exact_identity_independent_watchdog_and_no_render_io(self):
        from render_provider_descriptors import render
        config=copy.deepcopy(self.config); provider=config['provider']; project=config['projectId']
        provider.update(controlImageDigest='us-central1-docker.pkg.dev/'+project+'/control/image@sha256:'+'a'*64,
            controllerJob='synthetic-controller',watchdogJob='synthetic-watchdog',
            watchdogWorkflow='synthetic-workflow',watchdogScheduler='synthetic-scheduler',
            configurationBucket='synthetic-config',trustBucket='synthetic-trust',
            monitoringChannels=['projects/'+project+'/notificationChannels/1','projects/'+project+'/notificationChannels/2'])
        for role in ['controller','watchdog','workflow','scheduler']:
            provider[role+'ServiceAccount']=role+'@'+project+'.iam.gserviceaccount.com'
        result=render(config)
        self.assertNotEqual(result['controllerJob']['template']['template']['serviceAccount'],
                            result['watchdogJob']['template']['template']['serviceAccount'])
        self.assertEqual(result['scheduler']['retryConfig']['retryCount'],0)
        workflow=json.loads(result['workflow']['sourceContents'])
        self.assertNotIn('params',workflow['main'])
        self.assertIn('synthetic-watchdog:run',json.dumps(workflow))
        self.assertEqual(self.transport.calls,[])
        config['projectId']='coupon-app-29446';config['allowedProjectIds']=['coupon-app-29446']
        with self.assertRaises(Rejected):render(config)

    def test_bootstrap_small_reservations_and_shutdown_proof_transition(self):
        config = copy.deepcopy(self.config); config.update(guardianTested=False, alertTested=False)
        controller = Controller(config, Approval(config), self.store, self.resources, lambda: self.now)
        state = controller.start()['state']
        self.assertEqual(controller.safety_tick()['action'], 'observe')
        controller.reserve_create(self.resource, self.request)
        self.assertEqual(self.store.value['state']['costUpper'], 5)
        self.assertEqual(self.store.value['state']['phaseUsed']['1'], 5)
        self.now = 1900
        with self.assertRaisesRegex(Rejected, 'bootstrap expired'): controller.create_once(self.resource)
        self.now = 1020; self.store.value['state']['status'] = 'paused'
        receipt = {key:state[key] for key in ('runId','projectId','configDigest','firstBillableAt','deadline')}
        receipt.update(alertDelivered=True, shutdownObserved=True, evidenceDigest='e'*64)
        with self.assertRaisesRegex(Rejected, 'verified owned absence'): controller.confirm_controls(receipt)
        self.store.value['state']['absent']['synthetic-drill'] = {'verifiedAt': 1019}
        self.assertEqual(controller.confirm_controls(receipt)['state']['status'], 'running')

    def test_separate_signed_checkpoint_and_gate_sequence(self):
        self.running(); self.store.value['state']['costUpper'] = 70
        with self.assertRaises(Rejected): self.controller.reserve_create(self.resource, self.request)
        second = Approval(self.config); second.checkpoint = 100
        with self.assertRaises(Rejected): self.controller.confirm_early_checkpoint(second)
        second.envelope = {'synthetic': 'later-owner-receipt'}
        self.controller.confirm_early_checkpoint(second)
        self.assertTrue(self.controller.reserve_create(self.resource, self.request)['executeAllowed'])
        with self.assertRaises(Rejected): self.controller.complete_gate(2, 'e'*64)
        self.controller.complete_gate(1, 'e'*64)
        self.assertIn(1, self.store.value['state']['completedGates'])

    def test_poll_pacing_cleanup_retry_bound_and_monotonic_counters(self):
        self.owned(); self.transport.replies = [{'done': False}]
        self.controller.poll_once(self.resource)
        with self.assertRaisesRegex(Rejected, 'too frequent'): self.controller.poll_once(self.resource)
        self.store.value['state']['status'] = 'paused'
        for _ in range(3):
            self.transport.replies = [ProviderError(403)]
            with self.assertRaises(ProviderError): self.controller.delete_owned(self.resource)
        with self.assertRaisesRegex(Rejected, 'retry bound'): self.controller.delete_owned(self.resource)
        with self.assertRaises(Rejected): self.controller.heartbeat(False, 0, {}, 0)

    def test_fixed_limits_and_canonical_document(self):
        for key in ['approvedForecastUsd','activeLoadSeconds','lifetimeSeconds','maxSearchStorageGiB']:
            config = copy.deepcopy(self.config); config[key] *= 2
            with self.assertRaises(Rejected): Controller(config, Approval(config), self.store, self.resources, lambda: self.now)
        for bad in [float('nan'), 1.5, 2**54, '\u2603', {'bad\nkey':1}]:
            with self.assertRaises(Rejected): configuration_bytes(bad)

    def test_job_single_attempt_timeout_reservation_and_exact_execution_cancel(self):
        job = {'kind':'run.job','id':'synthetic-load','disposable':True,'body':{'labels':self.resources.labels(),
               'template':{'taskCount':1,'parallelism':1,'template':{'timeout':'60s','maxRetries':0}}},
               'runReservation':{**self.request,'activeSeconds':60}}
        second=copy.deepcopy(job);second['id']='synthetic-load-two';second['runReservation']['reservationId']='mock-2'
        config = copy.deepcopy(self.config); config['provider']['resources'] = [job,second]
        provider = GoogleResources(config,self.transport)
        controller = Controller(config,Approval(config),self.store,provider,lambda:self.now)
        controller.start(); controller.begin_work()
        raw = {**self.observed,'name':provider.url(job).split('/v2/')[1],'template':job['body']['template']}
        receipt = provider.identity(job,raw)
        self.store.value['state']['receipts']['run.job/synthetic-load'] = receipt
        raw_second={**raw,'name':provider.url(second).split('/v2/')[1],'uid':'synthetic-uid-two'}
        self.store.value['state']['receipts']['run.job/synthetic-load-two']=provider.identity(second,raw_second)
        request = {**self.request,'activeSeconds':60}
        self.transport.replies = [raw, ProviderError(None)]
        with self.assertRaises(ProviderError): controller.run_job_once(job,request)
        self.assertEqual(controller.run_job_once(job,request)['state'],'reconcile-required')
        with self.assertRaisesRegex(Rejected,'another job is pending'):
            controller.run_job_once(second,second['runReservation'])
        self.assertEqual(sum(method=='POST' for method,_,_ in self.transport.calls),1)
        execution = {'name':raw['name']+'/executions/execution-one','job':raw['name'],
                     'uid':'execution-uid','etag':'execution-etag','labels':provider.labels(),'createTime':raw['createTime']}
        self.transport.replies=[raw,{'executions':[execution]}]
        self.assertEqual(controller.reconcile_job_execution(job)['state'],'pending')
        self.now+=5
        self.transport.replies=[raw,{'executions':[{**execution,'completionTime':'1970-01-01T00:16:45Z'}]}]
        self.assertEqual(controller.reconcile_job_execution(job)['state'],'completed')
        self.transport.replies=[raw_second,{'name':'second-run-op'}]
        self.assertEqual(controller.run_job_once(second,second['runReservation'])['state'],'requested')
        self.transport.replies=[raw,{'executions':[execution]},{'name':'cancel-op'}]
        provider.cancel_job_executions(job,receipt)
        self.assertTrue(self.transport.calls[-1][1].endswith(':cancel'))
        self.assertEqual(self.transport.calls[-1][2],{'etag':'execution-etag'})
        self.transport.replies=[raw,{'executions':[{**execution,'job':'replacement'}]}]
        with self.assertRaises(Rejected): provider.cancel_job_executions(job,receipt)

    def test_actual_resource_body_bounds_reject_before_post(self):
        cases=[('scaling',{'minInstanceCount':0,'maxInstanceCount':5}),
               ('maxInstanceRequestConcurrency',80),('timeout','3600s'),
               ('serviceAccount','other@other-project.iam.gserviceaccount.com'),
               ('vpcAccess',{'egress':'ALL_TRAFFIC'}),
               ('containers',[{'image':self.config['hosted']['imageDigest'],'resources':{'limits':{'cpu':'8','memory':'32Gi'}}}])]
        for key,value in cases:
            config=copy.deepcopy(self.config);resource=copy.deepcopy(self.resource)
            resource['body']['template'][key]=value;config['provider']['resources']=[resource]
            with self.assertRaises(Rejected):GoogleResources(config,self.transport).create(resource)
        self.assertEqual(self.transport.calls,[])

    def test_full_job_duration_must_fit_signed_execution_before_provider_io(self):
        request={**self.request,'activeSeconds':60}
        job={'kind':'run.job','id':'synthetic-load','disposable':True,'runReservation':request,
             'body':{'template':{'taskCount':1,'parallelism':1,'template':{'maxRetries':0,'timeout':'60s'}}}}
        config=copy.deepcopy(self.config);config['provider']['resources']=[job]
        approval=Approval(config);approval.valid_until=self.now+59
        provider=GoogleResources(config,self.transport)
        controller=Controller(config,approval,self.store,provider,lambda:self.now)
        controller.start();controller.begin_work()
        self.store.value['state']['receipts']['run.job/synthetic-load']={'synthetic':'owned-fixture'}
        with self.assertRaisesRegex(Rejected,'signed execution window'):
            controller.run_job_once(job,request)
        self.assertEqual(self.transport.calls,[])
        self.assertEqual(self.store.value['state'].get('jobRuns',{}),{})
        self.assertEqual(self.store.value['state']['costUpper'],0)

    def test_firestore_wrong_region_refused_before_post(self):
        resource={'kind':'firestore.database','id':'search-qualification','disposable':True,
            'body':{'name':'projects/'+self.config['projectId']+'/databases/search-qualification',
                    'locationId':'nam5','type':'FIRESTORE_NATIVE'}}
        config=copy.deepcopy(self.config);config['provider']['resources']=[resource]
        with self.assertRaises(Rejected):GoogleResources(config,self.transport).create(resource)
        self.assertEqual(self.transport.calls,[])

    def test_entrypoint_reports_pending_and_fails_unresolved_watchdog(self):
        from provider_entrypoint import summarize_result
        result={'action':'pause-load-stop-sql-and-alert','resources':[{'resource':'run.service/synthetic',
            'state':'provider-operation-pending','rawProviderBody':'private-do-not-copy'}],
            'alert':'publish-accepted-delivery-unproven'}
        output,status=summarize_result('watchdog',result)
        self.assertEqual(status,0);self.assertFalse(output['removalComplete'])
        self.assertNotIn('private-do-not-copy',json.dumps(output))
        for state in ['unknown-or-refused','create-outcome-unresolved']:
            result['resources'][0]['state']=state
            self.assertEqual(summarize_result('watchdog',result)[1],2)
        result['resources'][0]['state']='absence-previously-verified'
        result['alert']='publish-failed-delivery-unproven'
        self.assertEqual(summarize_result('watchdog',result)[1],2)
        self.assertEqual(summarize_result('poll',{'done':False})[0]['state'],'provider-operation-pending')
    def test_real_ed25519_cli_matches_python_digest_and_rejects_forgery(self):
        import shutil
        node = shutil.which('node')
        self.assertIsNotNone(node, 'explicit local Node runtime required for approval contract test')
        verifier = Path(__file__).resolve().parents[1]/'verify-approval.cjs'
        claims = {'protocolVersion':'bitestar.postgis-execution-approval.v1',
            **{key:self.config[key] for key in ('projectId','projectNumber','runId','candidateDigest')},
            'configDigest':digest(self.config),'notBeforeMs':900000,'validUntilMs':1100000,
            'cleanupUntilMs':2000000,'allowedGates':[1,2,3,4,5]}
        # Ephemeral signer lives only in a Node process. No private key is persisted.
        js = """const c=require('node:crypto'); const fs=require('node:fs');
        const claims=JSON.parse(fs.readFileSync(0,'utf8')); const k=c.generateKeyPairSync('ed25519');
        const b=Buffer.from(JSON.stringify(claims,Object.keys(claims).sort()));
        process.stdout.write(JSON.stringify({trust:{test:k.publicKey.export({type:'spki',format:'pem'})},
        approval:{keyId:'test',payloadBase64:b.toString('base64'),signatureBase64:c.sign(null,b,k.privateKey).toString('base64')}}));"""
        result = subprocess.run([node,'-e',js],input=json.dumps(claims),text=True,capture_output=True,check=True)
        vector = json.loads(result.stdout)
        with tempfile.TemporaryDirectory() as tmp:
            trust=Path(tmp)/'trust.json'; trust.write_text(json.dumps(vector['trust']))
            approval=SignedApproval(self.config,vector['approval'],node,verifier,trust,lambda:self.now)
            self.assertTrue(approval.verify()['approved'])
            self.now=1200
            with self.assertRaises(Rejected): approval.verify()
            self.assertTrue(approval.verify(5,True)['approved'])
            approval.envelope['signatureBase64']='A'*88
            with self.assertRaises(Rejected): approval.verify(5,True)


if __name__ == '__main__': unittest.main()
