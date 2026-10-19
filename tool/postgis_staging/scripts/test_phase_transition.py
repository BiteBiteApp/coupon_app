import copy
from pathlib import Path
import unittest
import test_cloud_controller as fixture
from cloud_controller import Controller
from cloud_provider import GoogleResources, ProviderError
from guard import Rejected, digest


class Phases(unittest.TestCase):
    def setUp(self):
        self.f = fixture.CloudControls(); self.f.setUp()
        self.f.config['phase']='diagnostic'
        self.f.config['hosted']['nativeDiagnostic']={'id':'synthetic-diagnostic','action':'numerical-only','protocolVersion':'bitestar.postgis-native-diagnostic.v1'}
        self.f.resource.update(kind='run.job',id='synthetic-diagnostic')
        self.f.resources=GoogleResources(self.f.config,self.f.transport)
        self.f.controller=Controller(self.f.config,fixture.Approval(self.f.config),self.f.store,self.f.resources,lambda:self.f.now)
        self.c = self.f.controller
        self.c.start();self.c.begin_work();self.c.reserve_create(self.f.resource,self.f.request)
        self.key='run.job/synthetic-diagnostic'
        self.f.observed['name']=self.f.resources.url(self.f.resource).split('/v2/')[1]
        self.f.store.value['state']['intents'][self.key]['phase']='observed'
        self.f.store.value['state']['receipts'][self.key]=self.f.resources.identity(self.f.resource,self.f.observed)
        for key in ('node', 'verifier', 'trusted_keys'): setattr(self.c.approval, key, Path('/synthetic/' + key))
        def verify(envelope, expected):
            if envelope != {'signature':'synthetic-valid'}: raise Rejected('invalid transition signature')
            return {**expected, 'validUntilMs': 1100000}
        self.c.approval.verify_claims = verify
        s = self.f.store.value['state']; s['status'] = 'paused'
        key = self.key
        s['absent'][key] = {'verifiedAt':self.f.now, 'receipt':copy.deepcopy(s['receipts'][key])}
        s.update(remainingHoldUpper=8, delayedChargeUpper=4)
        self.next = copy.deepcopy(self.f.config); self.next['candidateDigest'] = 'c' * 64
        self.next['phase']='serving';self.next['hosted'].pop('nativeDiagnostic')
        self.next['provider']['resources'][0]['id'] = 'synthetic-serving'
        self.next_approval = fixture.Approval(self.next)
        self.next_approval.verify_claims = verify
        for key in ('node', 'verifier', 'trusted_keys'): setattr(self.next_approval, key, getattr(self.c.approval, key))
        self.envelope = {'signature':'synthetic-valid'}
        self.f.transport.replies = [ProviderError(404)]

    def transition(self):
        return self.c.transition_to_serving(self.next, self.next_approval, self.envelope, 'e' * 64)

    def test_transition_preserves_original_clock_every_liability_and_prior_receipt(self):
        before = copy.deepcopy(self.f.store.value['state'])
        result = self.transition()['state']
        for key in ('runId','projectId','firstBillableAt','deadline','costUpper','remainingHoldUpper','delayedChargeUpper',
                    'counts','activeSeconds','phaseUsed','reservationIds','reservationDigests'):
            self.assertEqual(result[key], before[key], key)
        self.assertEqual(result['phaseHistory'][0]['state'], before)
        self.assertEqual(result['phaseHistory'][0]['configuration'], self.f.config)
        self.assertEqual(result['status'], 'phase-awaiting-controls'); self.assertFalse(result['controlsVerified'])
        self.assertEqual(result['configDigest'], digest(self.next)); self.assertEqual(result['intents'], {})
        self.assertEqual([call[0] for call in self.f.transport.calls[-1:]], ['GET'])

    def test_new_phase_requires_new_config_control_receipt_before_paid_admission(self):
        self.transition()
        next_controller = Controller(self.next, self.next_approval, self.f.store, GoogleResources(self.next, self.f.transport), lambda:self.f.now)
        with self.assertRaises(Rejected): next_controller.begin_work()
        state = self.f.store.value['state']
        receipt = {key:state[key] for key in ('runId','projectId','configDigest','candidateDigest','firstBillableAt','deadline','phaseEvidenceDigest')}
        receipt.update(watchdogConfigObserved=True,safetyActionObserved=True,alertDelivered=True,evidenceDigest='f'*64)
        for field in ('watchdogConfigObserved','safetyActionObserved','alertDelivered'):
            with self.assertRaises(Rejected): next_controller.confirm_phase_controls({**receipt,field:False})
        next_controller.confirm_phase_controls(receipt); next_controller.begin_work()
        self.assertEqual(self.f.store.value['state']['status'],'running')
        self.assertEqual(self.f.store.value['state']['firstBillableAt'],1000)

    def test_wrong_signature_old_config_replay_and_new_phase_replay_refuse(self):
        self.envelope = {'signature':'forged'}
        with self.assertRaisesRegex(Rejected,'signature'): self.transition()
        self.envelope = {'signature':'synthetic-valid'}; self.transition()
        with self.assertRaises(Rejected): self.transition()
        next_controller = Controller(self.next,self.next_approval,self.f.store,GoogleResources(self.next,self.f.transport),lambda:self.f.now)
        later = copy.deepcopy(self.next); later['candidateDigest']='d'*64
        later_approval = fixture.Approval(later)
        for key in ('node','verifier','trusted_keys'):setattr(later_approval,key,getattr(self.next_approval,key))
        with self.assertRaises(Rejected):
            next_controller.transition_to_serving(later,later_approval,self.envelope,'e'*64)

    def test_policy_clock_trust_and_resource_name_changes_refuse_without_mutation(self):
        original = copy.deepcopy(self.f.store.value)
        edits = [lambda c:c.update(bootstrapMaximumSeconds=7200),lambda c:c.update(lifetimeSeconds=259199),
            lambda c:c['provider'].update(firstBillableAtMs=1001000),lambda c:c['provider'].update(monitoringChannels=['one']),
            lambda c:c['provider']['resources'][0].update(id='synthetic-diagnostic')]
        for edit in edits:
            saved=copy.deepcopy(self.next);edit(self.next)
            with self.assertRaises(Rejected):self.transition()
            self.next=saved
        self.next_approval.trusted_keys=Path('/forged/trust')
        with self.assertRaisesRegex(Rejected,'trust'):self.transition()
        self.assertEqual(self.f.store.value,original)

    def test_unresolved_or_reappeared_resources_and_pending_cancellation_refuse(self):
        original=copy.deepcopy(self.f.store.value)
        for mutation in [lambda s:s['absent'].clear(),lambda s:s.update(cleanupCancellationPending={'r':[{'name':'op'}]}),
                         lambda s:s.update(jobRuns={self.key:{'phase':'sent'}})]:
            mutation(self.f.store.value['state'])
            with self.assertRaises(Rejected):self.transition()
            self.f.store.value=copy.deepcopy(original)
        self.f.transport.replies=[self.f.observed]
        with self.assertRaisesRegex(Rejected,'reappeared'):self.transition()

    def test_lost_transition_cas_reply_reconciles_next_config_without_new_timer(self):
        self.f.store.lost=True
        with self.assertRaises(ProviderError):self.transition()
        next_controller=Controller(self.next,self.next_approval,self.f.store,GoogleResources(self.next,self.f.transport),lambda:self.f.now)
        result=next_controller.start()['state']
        self.assertEqual(result['phaseSequence'],1);self.assertEqual(result['firstBillableAt'],1000)
        self.assertEqual(len(result['phaseHistory']),1)

    def test_real_prior_configuration_and_ledger_must_both_be_diagnostic(self):
        self.f.store.value['state']['activePhase']='serving'
        with self.assertRaisesRegex(Rejected,'prior phase'):self.transition()
        self.f.store.value['state']['activePhase']='diagnostic'
        self.c.config['hosted']['jobs']=[{'id':'ordinary-source','action':'fixture'}]
        with self.assertRaisesRegex(Rejected,'diagnostic-to-serving'):self.transition()
        self.c.config['hosted'].pop('jobs')
        self.c.config['provider']['resources'][0]['kind']='run.service'
        with self.assertRaisesRegex(Rejected,'diagnostic-to-serving'):self.transition()

    def sql_phase(self):
        # Independent preflight is produced after the original start, for the
        # new phase's candidate/name, and signed into that full configuration.
        self.f.now = 1010
        sql={'kind':'sql.instance','id':'synthetic-serving-sql','disposable':True,'body':{}}
        self.next['provider']['resources']=[sql]
        for config in (self.f.config,self.next):
            config['provider'].update(controllerServiceAccount='controller@synthetic.test',watchdogServiceAccount='watchdog@synthetic.test')
            config['provider']['sqlExclusiveDeletion']={'approved':True,'singleUseNames':True,'exclusiveControllerOwnership':True,
                'ownerApprovalReference':'synthetic-existing-policy'}
        self.c.config=copy.deepcopy(self.f.config)
        state=self.f.store.value['state'];state['configDigest']=digest(self.f.config)
        proof={key:self.next[key] for key in ('projectId','projectNumber','runId','candidateDigest')}
        proof.update(protocol='bitestar-sql-exclusive-preflight-v1',sqlName=sql['id'],resourcePlanDigest=digest(self.next['provider']['resources']),
            firstBillableAtMs=1000000,deadlineMs=int(state['deadline']*1000),
            principals={key:self.next['provider'][key] for key in ('controllerServiceAccount','watchdogServiceAccount')},
            reviewerId='independent-synthetic-reviewer',reviewedAtMs=1005000,validUntilMs=int(state['deadline']*1000)+7200000,
            effectiveLifecyclePermissionsEvidenceSha256='a'*64,permanentSingleUseRegistryEvidenceSha256='b'*64)
        self.next['provider']['sqlExclusiveDeletion'].update(evidence=proof,evidenceDigest=digest(proof))
        return sql,proof

    def test_signed_phase_refresh_qualifies_exact_new_sql_incarnation_and_cleanup(self):
        sql,proof=self.sql_phase()
        unbound=GoogleResources(self.next,self.f.transport)
        with self.assertRaisesRegex(Rejected,'stale'):unbound.sql_exclusivity_evidence(sql,1010000)
        with self.assertRaises(Rejected):unbound.bind_phase_context({'configDigest':digest(self.next)})
        self.transition()
        resources=GoogleResources(self.next,self.f.transport)
        controller=Controller(self.next,self.next_approval,self.f.store,resources,lambda:self.f.now)
        controller._read()
        self.assertEqual(resources.sql_exclusivity_evidence(sql,1010000),digest(proof))
        state=self.f.store.value['state'];key='sql.instance/'+sql['id']
        state['intents'][key]={'phase':'sent','sentAt':self.f.now,'resourceDigest':digest(sql)}
        raw={'project':self.next['projectId'],'name':sql['id'],'createTime':'1970-01-01T00:16:50Z',
             'settings':{'userLabels':resources.labels(),'settingsVersion':'7','activationPolicy':'NEVER'}}
        self.f.transport.replies=[raw];controller.reconcile_create(sql)
        self.assertEqual(self.f.store.value['state']['sqlDeletionEligibility'][key]['evidenceDigest'],digest(proof))
        self.f.store.value['state']['status']='paused'
        self.f.transport.replies=[raw,{'name':'delete-op'}]
        self.assertEqual(controller.delete_owned(sql),{'deletionRequested':True,'absenceVerified':False})
        self.assertTrue(self.f.transport.calls[-1][1].endswith('?enableFinalBackup=false'))
        # Re-reading a forged or missing history cannot retain an old in-process
        # phase proof, nor convert a receipt into an atomic SQL delete condition.
        saved=copy.deepcopy(self.f.store.value)
        self.f.store.value['state']['phaseHistory'][0]['transitionApproval']={'signature':'forged'}
        with self.assertRaisesRegex(Rejected,'signature'):controller._read(cleanup=True)
        self.assertIsNone(resources.phase_context)
        self.f.store.value=saved;self.f.store.value['state']['phaseSequence']=0
        controller._read(cleanup=True)
        with self.assertRaisesRegex(Rejected,'stale'):resources.sql_exclusivity_evidence(sql,1010000)

    def test_new_sql_preflight_policy_staleness_identity_and_signature_refuse_before_cas(self):
        sql,proof=self.sql_phase();original=copy.deepcopy(self.f.store.value)
        policy=self.next['provider']['sqlExclusiveDeletion'];valid=copy.deepcopy(policy)
        for field,value in [('candidateDigest','d'*64),('sqlName','wrong'),('reviewedAtMs',1010001),
                            ('reviewedAtMs',-90000000),('firstBillableAtMs',1000001),('deadlineMs',int(original['state']['deadline']*1000)+1)]:
            policy.update(copy.deepcopy(valid));policy['evidence'][field]=value;policy['evidenceDigest']=digest(policy['evidence'])
            with self.assertRaises(Rejected):self.transition()
            self.assertEqual(self.f.store.value,original)
        policy.update(copy.deepcopy(valid));policy['approved']=False
        with self.assertRaisesRegex(Rejected,'policy'):self.transition()
        policy.update(copy.deepcopy(valid));self.envelope={'signature':'forged'}
        with self.assertRaisesRegex(Rejected,'signature'):self.transition()
        self.assertEqual(self.f.transport.calls,[])


class NotificationDescriptors(unittest.TestCase):
    def test_three_exact_independent_conditions_and_two_channels_remain_required(self):
        from render_provider_descriptors import render
        f=fixture.CloudControls();f.setUp();config=copy.deepcopy(f.config);p=config['provider'];project=config['projectId']
        p.update(controlImageDigest='us-central1-docker.pkg.dev/'+project+'/control/image@sha256:'+'a'*64,
            controllerJob='synthetic-controller',watchdogJob='synthetic-watchdog',watchdogWorkflow='synthetic-workflow',
            watchdogScheduler='synthetic-scheduler',configurationBucket='synthetic-config',trustBucket='synthetic-trust',
            monitoringChannels=['projects/'+project+'/notificationChannels/1','projects/'+project+'/notificationChannels/2'])
        for role in ('controller','watchdog','workflow','scheduler'):p[role+'ServiceAccount']=role+'@'+project+'.iam.gserviceaccount.com'
        result=render(config)
        missing=result['watchdogSilenceAlert']['conditions'][0]['conditionThreshold']
        self.assertEqual(missing['evaluationMissingData'],'EVALUATION_MISSING_DATA_ACTIVE')
        self.assertEqual(missing['comparison'],'COMPARISON_LT');self.assertEqual(missing['thresholdValue'],1)
        self.assertNotIn('metric.labels.result',missing['filter'])
        self.assertEqual(missing['aggregations'][0]['alignmentPeriod'],'900s')
        self.assertIn('jsonPayload.safetyAction',result['watchdogSafetyActionAlert']['conditions'][0]['conditionMatchedLog']['filter'])
        for name in ('watchdogFailureAlert','watchdogSilenceAlert','watchdogSafetyActionAlert'):
            self.assertEqual(result[name]['notificationChannels'],p['monitoringChannels'])
        p['monitoringChannels']=p['monitoringChannels'][:1]
        with self.assertRaises(Rejected):render(config)
