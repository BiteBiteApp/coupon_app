import copy
import unittest
import test_cloud_controller as fixture
from cloud_controller import Controller
from cloud_provider import GoogleResources, ProviderError
from guard import Rejected


class FiniteJobReservations(unittest.TestCase):
    def setUp(self):
        self.f=fixture.CloudControls();self.f.setUp()
        self.requests=[{**copy.deepcopy(self.f.request),'activeSeconds':60,'reservationId':'stream-'+str(i)} for i in range(2)]
        self.job={'kind':'run.job','id':'synthetic-stream','disposable':True,'body':{'labels':self.f.resources.labels(),
            'template':{'taskCount':1,'parallelism':1,'template':{'timeout':'60s','maxRetries':0}}},'runReservations':self.requests}
        self.config=copy.deepcopy(self.f.config);self.config['provider']['resources']=[self.job]
        self.provider=GoogleResources(self.config,self.f.transport)
        self.controller=Controller(self.config,fixture.Approval(self.config),self.f.store,self.provider,lambda:self.f.now)
        self.controller.start();self.controller.begin_work()
        self.key='run.job/synthetic-stream'
        self.raw={**self.f.observed,'name':self.provider.url(self.job).split('/v2/')[1],'template':self.job['body']['template']}
        self.receipt=self.provider.identity(self.job,self.raw)
        self.f.store.value['state']['receipts'][self.key]=self.receipt
        self.execution={'name':self.raw['name']+'/executions/first','job':self.raw['name'],'uid':'first-uid','etag':'first-etag',
            'labels':self.provider.labels(),'createTime':self.raw['createTime'],'completionTime':'1970-01-01T00:16:45Z'}

    def first(self):
        self.f.transport.replies=[self.raw,{'name':'first-operation'}]
        self.controller.run_job_once(self.job,self.requests[0])

    def completed_first(self):
        self.first();self.f.now+=5
        self.f.transport.replies=[self.raw,{'executions':[self.execution]}]
        self.assertEqual(self.controller.reconcile_job_execution(self.job)['state'],'completed')

    def test_exact_sequence_prior_terminal_receipt_and_global_reservations_are_preserved(self):
        with self.assertRaisesRegex(Rejected,'out of order'):self.controller.run_job_once(self.job,self.requests[1])
        self.first()
        with self.assertRaisesRegex(Rejected,'previous exact execution'):self.controller.run_job_once(self.job,self.requests[1])
        self.f.now+=5;self.f.transport.replies=[self.raw,{'executions':[self.execution]}]
        self.controller.reconcile_job_execution(self.job)
        before=copy.deepcopy(self.f.store.value['state'])
        self.f.transport.replies=[self.raw,{'name':'second-operation'}]
        self.controller.run_job_once(self.job,self.requests[1])
        after=self.f.store.value['state']
        self.assertEqual(after['reservationIds'],['stream-0','stream-1'])
        self.assertEqual(after['activeSeconds'],120)
        self.assertGreater(after['costUpper'],before['costUpper'])
        self.assertEqual(after['jobRunHistory'][self.key][0]['execution']['uid'],'first-uid')
        calls=len(self.f.transport.calls)
        for request in self.requests:self.assertEqual(self.controller.run_job_once(self.job,request)['state'],'reconcile-required')
        self.assertEqual(len(self.f.transport.calls),calls)

    def test_lost_second_reply_retains_intent_and_does_not_match_old_completed_execution(self):
        self.completed_first();self.f.transport.replies=[self.raw,ProviderError(None)]
        with self.assertRaises(ProviderError):self.controller.run_job_once(self.job,self.requests[1])
        self.assertNotIn(self.key,self.f.store.value['state']['operations'])
        self.f.transport.replies=[self.raw,{'executions':[self.execution]}]
        self.assertEqual(self.controller.reconcile_job_execution(self.job)['state'],'unknown')
        second={**self.execution,'name':self.raw['name']+'/executions/second','uid':'second-uid','createTime':'1970-01-01T00:16:45Z'}
        self.f.now+=5;self.f.transport.replies=[self.raw,{'executions':[self.execution,second]}]
        self.assertEqual(self.controller.reconcile_job_execution(self.job)['state'],'completed')
        self.assertEqual(self.f.store.value['state']['jobRuns'][self.key]['execution']['uid'],'second-uid')
        self.assertEqual(sum(call[0]=='POST' for call in self.f.transport.calls),2)

    def test_cleanup_cannot_treat_old_execution_as_missing_new_execution_completion(self):
        self.completed_first();self.f.transport.replies=[self.raw,ProviderError(None)]
        with self.assertRaises(ProviderError):self.controller.run_job_once(self.job,self.requests[1])
        self.f.store.value['state']['status']='paused'
        self.f.transport.replies=[self.raw,{'executions':[self.execution]}]
        with self.assertRaisesRegex(Rejected,'execution outcome'):self.controller.delete_owned(self.job)
        self.assertFalse(any(call[0]=='DELETE' for call in self.f.transport.calls))

    def test_fixture_stream_must_reserve_actual_per_invocation_source_bounds(self):
        self.config['hosted']['jobs']=[{'id':self.job['id'],'action':'fixture-stream','workload':{
            'maxSourceOperations':1000,'maxParentsPerInvocation':1,'maxInvocations':2}}]
        controller=Controller(self.config,fixture.Approval(self.config),self.f.store,self.provider,lambda:self.f.now)
        with self.assertRaisesRegex(Rejected,'underreserved'):controller.run_job_once(self.job,self.requests[0])
        self.assertEqual(self.f.transport.calls,[])

    def test_no_unsigned_extra_or_duplicate_reservation_and_existing_global_cap_remains(self):
        with self.assertRaisesRegex(Rejected,'finite cost plan'):
            self.controller.run_job_once(self.job,{**self.requests[0],'reservationId':'unsigned'})
        self.f.store.value['state']['reservationIds']=['reserved-'+str(i) for i in range(self.config['maxOutstandingReservations'])]
        with self.assertRaisesRegex(Rejected,'reservation bound'):self.controller.run_job_once(self.job,self.requests[0])
        self.assertEqual(self.f.transport.calls,[])
