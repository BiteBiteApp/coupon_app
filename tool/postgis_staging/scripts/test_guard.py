import copy,json,unittest
from pathlib import Path
from guard import *
from render_watchdog import render,heartbeat_valid,unique_steps
S=Path(__file__).resolve().parents[1]
class Safety(unittest.TestCase):
 def setUp(self):
  self.c=json.loads((S/'config/staging.json').read_text());self.c.update(projectId='bs-synthetic-test-001',allowedProjectIds=['bs-synthetic-test-001'],candidateDigest='a'*64,gate0Ready=True,guardianTested=True,alertTested=True,alertRecipients=['synthetic-test@example.invalid'])
  self.a={'approved':True,'ownerApprovalReference':'MOCK ONLY','runId':self.c['runId'],'projectId':self.c['projectId'],'configDigest':digest(self.c),'candidateDigest':self.c['candidateDigest'],'validUntil':999999,'approvedGates':[1,2,3,4]}
  self.s=launch(self.c,self.a,None,1000);self.s['status']='running'
  self.r={'reservationId':'mock-1','gate':1,'counts':{k:1 for k in self.c['caps']},'activeSeconds':10,'costUpper':1,'remainingHoldUpper':20,'delayedChargeUpper':2}
 def reject(self,fn):self.assertRaises(Rejected,fn)
 def test_valid_reservation(self):self.assertEqual(permit(self.c,self.a,self.s,self.r,1010)['counts']['requests'],1)
 def test_production(self):self.c['projectId']='coupon-app-29446';self.c['allowedProjectIds']=['coupon-app-29446'];self.reject(lambda:project_check(self.c))
 def test_wrong_project(self):self.c['projectId']='other-project-001';self.reject(lambda:project_check(self.c))
 def test_missing_project(self):self.c['projectId']=None;self.reject(lambda:project_check(self.c))
 def test_missing_approval(self):self.a['approved']=False;self.reject(lambda:permit(self.c,self.a,self.s,self.r,1010))
 def test_wrong_approval_project(self):self.a['projectId']='other-project';self.reject(lambda:permit(self.c,self.a,self.s,self.r,1010))
 def test_changed_candidate(self):self.c['candidateDigest']='b'*64;self.reject(lambda:permit(self.c,self.a,self.s,self.r,1010))
 def test_changed_config(self):self.c['caps']['requests']+=1;self.reject(lambda:permit(self.c,self.a,self.s,self.r,1010))
 def test_expired_run(self):self.reject(lambda:permit(self.c,self.a,self.s,self.r,self.s['deadline']))
 def test_expired_approval(self):self.a['validUntil']=1005;self.reject(lambda:permit(self.c,self.a,self.s,self.r,1010))
 def test_duplicate_launch(self):self.reject(lambda:launch(self.c,self.a,self.s,1010))
 def test_duplicate_request(self):s=permit(self.c,self.a,self.s,self.r,1010);self.reject(lambda:permit(self.c,self.a,s,self.r,1011))
 def test_phase_allowance(self):self.r['costUpper']=16;self.reject(lambda:permit(self.c,self.a,self.s,self.r,1010))
 def test_previous_gate(self):self.r['gate']=3;self.reject(lambda:permit(self.c,self.a,self.s,self.r,1010))
 def test_unapproved_gate(self):self.a['approvedGates']=[];self.reject(lambda:permit(self.c,self.a,self.s,self.r,1010))
 def test_interrupted(self):self.s['status']='interrupted';self.reject(lambda:permit(self.c,self.a,self.s,self.r,1010))
 def test_stale_accounting(self):self.reject(lambda:permit(self.c,self.a,self.s,self.r,1181))
 def test_reset_deadline(self):self.s['deadline']+=1;self.reject(lambda:permit(self.c,self.a,self.s,self.r,1010))
 def test_limit_every_counter(self):
  for key,value in self.c['caps'].items():
   with self.subTest(key=key):r=copy.deepcopy(self.r);r['counts'][key]=value+1;self.reject(lambda:permit(self.c,self.a,self.s,r,1010))
 def test_active_load_limit(self):self.r['activeSeconds']=21601;self.reject(lambda:permit(self.c,self.a,self.s,self.r,1010))
 def test_material_next_spend_at_280(self):self.s['costUpper']=280;self.r.update(gate=4,costUpper=100);self.s['completedGates']=[0,1,2,3];self.reject(lambda:permit(self.c,self.a,self.s,self.r,1010))
 def test_nonfinite_and_negative(self):
  for v in [float('nan'),float('inf'),-1,True]:
   with self.subTest(value=str(v)):self.r['costUpper']=v;self.reject(lambda:permit(self.c,self.a,self.s,self.r,1010))
 def test_missing_local_work(self):self.c['gate0Ready']=False;self.a['configDigest']=digest(self.c);self.reject(lambda:launch(self.c,self.a,None,1000))
 def test_missing_shutdown_test(self):self.c['guardianTested']=False;self.a['configDigest']=digest(self.c);self.reject(lambda:launch(self.c,self.a,None,1000))
 def test_teardown_ownership(self):
  r={'kind':'sql.instance','id':'bs-db','uid':'fixed-uid','createTime':1000,'disposable':True};self.c['resources']=[r];o={**r,'projectId':self.c['projectId'],'runId':self.c['runId']};self.assertEqual(owned_resource(self.c,r,o)['action'],'delete')
  for key,v in [('uid','replacement'),('projectId','coupon-app-29446'),('runId','other'),('createTime',999)]:
   with self.subTest(key=key):bad={**o,key:v};self.reject(lambda:owned_resource(self.c,r,bad))
 def test_teardown_unlisted(self):self.reject(lambda:owned_resource(self.c,{},{}))
 def test_watchdog_without_owner(self):self.assertEqual(watchdog(self.c,self.s,1181),'pause-load-stop-sql-and-alert');self.assertEqual(watchdog(self.c,self.s,self.s['deadline']),'stop-load-export-and-teardown')
 def test_checkpoint_resume(self):
  m={'syntheticOnly':True,'candidateDigest':'a','datasetDigest':'b','projectId':self.c['projectId'],'databaseId':'search-qualification','partition':1,'fence':[2]*16};r={**m,'verified':True,'gapCount':0,'lastSequence':2};self.assertEqual(checkpoint(m,r),2);r['fence']=[3]*16;self.reject(lambda:checkpoint(m,r))
 def test_renderer_targets_and_no_dynamic_arguments(self):
  p=self.c['projectId'];rs=[{'kind':'sql.instance','id':'bs-db','identity':'fixed-time','url':f'https://sqladmin.googleapis.com/sql/v1beta4/projects/{p}/instances/bs-db'},{'kind':'run.service','id':'bs-search','identity':'uid1','url':f'https://run.googleapis.com/v2/projects/{p}/locations/us-central1/services/bs-search'},{'kind':'firestore.database','id':'search-qualification','identity':'uid2','url':f'https://firestore.googleapis.com/v1/projects/{p}/databases/search-qualification'}]
  for r in rs:r.update(runId=self.c['runId'],disposable=True)
  receipt={'projectId':p,'runId':self.c['runId'],'approvalReference':'MOCK','firstBillableAt':1000,'deadline':260200,'alertAndShutdownTestPassed':True,'resources':rs,'controlBucket':'bs-mock-control','heartbeatObjectMediaUrl':'https://storage.googleapis.com/storage/v1/b/bs-mock-control/o/heartbeat.json?alt=media'}
  self.c['resources']=copy.deepcopy(rs)
  w=render(self.c,receipt);self.assertNotIn('params',w['main']);self.assertIn('http.patch',json.dumps(w));self.assertIn('http.delete',json.dumps(w))
  # Keep rendering in memory; tests must not rewrite qualification artifacts.
  self.assertTrue(unique_steps(w))
  for mutation in ('unlisted','duplicate','replacement'):
   with self.subTest(mutation=mutation):
    bad=copy.deepcopy(receipt)
    if mutation=='unlisted':bad['resources'][0]['id']='not-approved'
    if mutation=='duplicate':bad['resources'].append(copy.deepcopy(bad['resources'][0]))
    if mutation=='replacement':bad['resources'][0]['identity']='replacement'
    self.reject(lambda:render(self.c,bad))
  self.assertIn('checkHeartbeat',str(w['main']['steps'][2]['heartbeat']['try']))
  receipt['resources'][0]['url']='https://sqladmin.googleapis.com/sql/v1beta4/projects/coupon-app-29446/instances/bs-db';self.reject(lambda:render(self.c,receipt))
 def test_strict_heartbeat(self):
  self.assertTrue(heartbeat_valid({'runId':'r','status':'running','heartbeatAt':100},'r',110,180))
  for value in [None,[],{},'bad',{'runId':'r','status':'running'}, {'runId':'r','status':'running','heartbeatAt':'100'}, {'runId':'r','status':'running','heartbeatAt':111}, {'runId':'r','status':'running','heartbeatAt':float('nan')}, {'runId':'r','status':'running','heartbeatAt':True}, {'runId':'r','status':'paused','heartbeatAt':100}]:
   with self.subTest(value=str(value)):self.assertFalse(heartbeat_valid(value,'r',110,180))
 def test_duplicate_nested_workflow_names(self):
  self.reject(lambda:unique_steps({'main':{'steps':[{'x':{'try':{'steps':[{'x':{'return':'bad'}}]}}}]}}))
 def test_supervised_bootstrap_transition(self):
  self.c.update(guardianTested=False,alertTested=False);self.a.update(configDigest=digest(self.c),supervisedControlBootstrap=True)
  s=launch(self.c,self.a,None,1000);self.assertEqual(s['status'],'supervised-bootstrap');self.assertEqual(s['costUpper'],5)
  self.reject(lambda:permit(self.c,self.a,s,self.r,1010))
  receipt={k:s[k] for k in ('runId','projectId','configDigest','firstBillableAt','deadline')};receipt.update(alertDelivered=True,shutdownObserved=True,evidenceDigest='mock-controls')
  ready=confirm_controls(self.c,self.a,s,receipt,1020);self.assertEqual(ready['firstBillableAt'],1000);self.assertEqual(ready['deadline'],s['deadline']);self.assertEqual(ready['costUpper'],5)
  self.assertEqual(permit(self.c,self.a,ready,self.r,1030)['costUpper'],6)
  self.reject(lambda:confirm_controls(self.c,self.a,s,receipt,1900))
  receipt['deadline']+=1;self.reject(lambda:confirm_controls(self.c,self.a,s,receipt,1020))
if __name__=='__main__':unittest.main(verbosity=2)
