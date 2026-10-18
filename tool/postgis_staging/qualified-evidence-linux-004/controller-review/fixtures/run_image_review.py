"""Report-only Linux image qualification harness. No provider/credential transport."""
import contextlib,copy,hashlib,importlib,io,json,os,platform,shutil,ssl,sqlite3,subprocess,sys,time,unittest
from pathlib import Path
fixture=Path('/fixtures'); root=Path('/tmp/controller-harness'); original=Path('/app')
manifest=json.loads((fixture/'fixture-manifest.json').read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
image_hashes={}
for relative,expected in manifest['imageFilesExpected'].items():
    source=original/relative
    assert sha(source)==expected, (relative,'image/build-context mismatch')
    target=root/relative;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,target)
    assert sha(target)==expected
    image_hashes[relative]={'imageSha256':sha(source),'copySha256':sha(target)}
for relative,expected in manifest['fixtureFiles'].items():
    assert sha(fixture/relative)==expected
    target=root/relative;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(fixture/relative,target)
    assert sha(target)==expected
scripts=root/'tool/postgis_staging/scripts'
sys.path[:0]=[str(original/'tool/postgis_staging/scripts'),str(scripts)]
module_paths={}
for name in ('guard','cloud_provider','cloud_controller','provider_entrypoint'):
    module=importlib.import_module(name)
    assert Path(module.__file__).parent==original/'tool/postgis_staging/scripts', module.__file__
    module_paths[name]=module.__file__
node=Path(shutil.which('node')).resolve();python=Path(sys.executable).resolve()
node_info=json.loads(subprocess.check_output([str(node),'-e',"console.log(JSON.stringify({node:process.version,v8:process.versions.v8,arch:process.arch,platform:process.platform,execPath:process.execPath}))"],text=True))
metadata={'osRelease':Path('/etc/os-release').read_text(),'platform':platform.platform(),'machine':platform.machine(),
 'python':{'version':sys.version,'path':str(python),'sha256':sha(python),'openssl':ssl.OPENSSL_VERSION,'sqlite':sqlite3.sqlite_version},
 'node':{**node_info,'resolvedPath':str(node),'sha256':sha(node)},'uid':os.getuid(),
 'imageFiles':image_hashes,'importModulePaths':module_paths,'fixtureFiles':manifest['fixtureFiles']}
from test_cloud_controller import CloudControls
from cloud_provider import GoogleResources,ProviderError
from provider_entrypoint import summarize_result
from guard import Rejected,digest

class Independent003Diagnostics(unittest.TestCase):
    def setUp(self):
        self.f=CloudControls();self.f.setUp()
        self.sql={'kind':'sql.instance','id':'synthetic-sql','disposable':True,'body':{}}
        self.f.config['provider']['resources']=[self.sql]
        self.proof=self.f._sql_proof(self.sql)
    def rejected_proof(self,now=1000000):
        with self.assertRaises(Rejected):GoogleResources(self.f.config,self.f.transport).sql_exclusivity_evidence(self.sql,now)
        self.assertEqual(self.f.transport.calls,[])
    def test_proof_digest_tamper(self):
        self.f.config['provider']['sqlExclusiveDeletion']['evidenceDigest']='0'*64;self.rejected_proof()
    def test_controller_principal_drift(self):
        self.f.config['provider']['controllerServiceAccount']='changed@synthetic.test';self.rejected_proof()
    def test_resource_plan_drift(self):
        self.sql['body']['changed']=True;self.rejected_proof()
    def test_policy_disabled(self):
        self.f.config['provider']['sqlExclusiveDeletion']['approved']=False;self.rejected_proof()
    def test_after_evidence_expiry(self):self.rejected_proof(self.proof['validUntilMs']+1)
    def test_before_review_time(self):self.rejected_proof(self.proof['reviewedAtMs']-1)
    def raw_binding(self):
        self.provider=GoogleResources(self.f.config,self.f.transport)
        self.raw={'project':self.f.config['projectId'],'name':self.sql['id'],'createTime':'1970-01-01T00:16:40Z',
          'settings':{'userLabels':self.provider.labels(),'settingsVersion':'7','activationPolicy':'NEVER'}}
        self.receipt=self.provider.identity(self.sql,self.raw)
        return {'evidenceDigest':digest(self.proof),'receipt':copy.deepcopy(self.receipt),'resourceDigest':digest(self.sql),'createIntentDigest':'a'*64,'revoked':False}
    def denied_delete(self,binding):
        self.f.transport.replies=[self.raw]
        with self.assertRaises(Rejected):self.provider.delete(self.sql,self.receipt,binding,1000000)
        self.assertFalse(any(method=='DELETE' for method,_,_ in self.f.transport.calls))
    def test_missing_actual_ledger_binding(self):self.raw_binding();self.denied_delete(None)
    def test_revoked_actual_binding(self):
        binding=self.raw_binding();binding['revoked']=True;self.denied_delete(binding)
    def test_different_actual_incarnation(self):
        binding=self.raw_binding();binding['receipt']['createTime']='1970-01-01T00:16:41Z';self.denied_delete(binding)
    def unresolved(self,state):
        summary,status=summarize_result('watchdog',{'action':'pause-load-stop-sql-and-alert','resources':[{'resource':'synthetic','state':state}],'alert':'published-delivery-unproven'})
        self.assertEqual(status,2);self.assertFalse(summary['removalComplete'])
    def test_cli_failure_execution_outcome_unresolved(self):self.unresolved('execution-outcome-unresolved')
    def test_cli_failure_sql_stop_configured_completion_unconfirmed(self):self.unresolved('sql-stop-configured-completion-unconfirmed')
    def test_failed_stop_operation_never_confirms_or_refunds(self):
        f=CloudControls();f.setUp();sql,raw=f._sql_cleanup_fixture();key='sql.instance/synthetic-sql'
        before=f.store.value['state']['costUpper']
        self.assertEqual(f._safety_step([raw,raw,{'name':'stop-op'}]),'mutation-requested-absence-unproven')
        self.assertEqual(f._safety_step([{'status':'DONE','error':{'errors':[{'code':'SYNTHETIC_DENIED'}]}}]),'unknown-or-refused')
        self.assertNotIn(key,f.store.value['state'].get('cleanupSqlStopConfirmed',{}))
        self.assertEqual(f.store.value['state']['costUpper'],before);self.assertEqual(f.store.value['state']['status'],'paused')
    def test_denied_stop_poll_recovery_preserves_deadline_and_liability(self):
        f=CloudControls();f.setUp();sql,raw=f._sql_cleanup_fixture();key='sql.instance/synthetic-sql'
        before={k:f.store.value['state'][k] for k in ('deadline','costUpper')}
        self.assertEqual(f._safety_step([raw,raw,{'name':'stop-op'}]),'mutation-requested-absence-unproven')
        self.assertEqual(f._safety_step([ProviderError(403)]),'unknown-or-refused')
        self.assertNotIn(key,f.store.value['state'].get('cleanupSqlStopConfirmed',{}))
        self.assertEqual(f._safety_step([{'status':'DONE'}]),'provider-operation-completed-recheck-required')
        raw['settings']['activationPolicy']='NEVER'
        self.assertEqual(f._safety_step([raw]),'sql-stop-confirmed-storage-charges-remain')
        self.assertEqual({k:f.store.value['state'][k] for k in before},before)

suites={};output=io.StringIO()
with contextlib.redirect_stdout(output):
    for label,names,expected in [
      ('selected-source-89',['test_cloud_controller','test_guard','test_gate0_controls','test_price_worksheet_20261017'],89),
      ('independent003-13',['__main__.Independent003Diagnostics'],13)]:
        suite=unittest.defaultTestLoader.loadTestsFromNames(names)
        assert suite.countTestCases()==expected,(label,suite.countTestCases())
        start=time.monotonic();result=unittest.TextTestRunner(verbosity=2).run(suite)
        suites[label]={'run':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'skipped':len(result.skipped),
                      'successful':result.wasSuccessful(),'elapsedSeconds':time.monotonic()-start}
post_hashes={name:sha(original/name) for name in manifest['imageFilesExpected']}
assert post_hashes==manifest['imageFilesExpected']
print(json.dumps({'metadata':metadata,'suites':suites,'capturedTestStdout':output.getvalue(),'imageFilesUnchanged':True},indent=2))
sys.exit(0 if all(x['successful'] for x in suites.values()) else 1)
