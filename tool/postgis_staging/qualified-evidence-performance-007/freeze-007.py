from pathlib import Path
import subprocess,json,hashlib,re,datetime
r=Path(__file__).parent;s=r/'integration-source';d='/Applications/Docker.app/Contents/Resources/bin/docker'
js="const fs=require('node:fs'),p=require('node:path'),c=require('node:crypto');const out={};function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=p.join(dir,e.name);if(e.isDirectory())walk(f);else out[f.slice('/app/'.length)]=c.createHash('sha256').update(fs.readFileSync(f)).digest('hex');}}walk('/app/functions/lib');walk('/app/functions/src');console.log(JSON.stringify({version:process.version,arch:process.arch,v8:process.versions.v8,sha256:out}));"
image='bitestar-postgis-search-007-final:local'
j=json.loads(subprocess.check_output([d,'run','--rm','--pull=never','--network','none','--cpus','1','--memory','768m','--entrypoint','node',image,'-e',js],text=True))
mismatches=[p for p,h in j['sha256'].items() if hashlib.sha256((s/p).read_bytes()).hexdigest()!=h];assert not mismatches
j['image']=subprocess.check_output([d,'image','inspect',image,'--format','{{.Id}}'],text=True).strip();j['sourceAndMacCompileMatch']=True
(r/'final-image-source-compiled-proof.json').write_text(json.dumps(j,indent=2)+'\n')
# Preserve explicit 006 scope; extend only to all final backend compilation inputs
# and the current-head client files already present in that scope.
old=json.loads((s/'tool/postgis_staging/combined-source.review-006.json').read_text());paths=set(old['sha256']);paths.add('functions/test/postgis_guest_authority_batching_007.test.cjs');paths.update(str(p.relative_to(s)) for p in (s/'functions/src').rglob('*') if p.is_file())
hashes={p:hashlib.sha256((s/p).read_bytes()).hexdigest() for p in sorted(paths)}
changedFrom006=[p for p,h in hashes.items() if old['sha256'].get(p)!=h]
head='39922fd418d5cc5cd191db0af8d3ee12dab64c7a'
owned=['functions/src/customer_bitesaver_search_session.ts','functions/test/postgis_guest_authority_batching_007.test.cjs']
for p in changedFrom006:
 if p not in owned:assert (s/p).read_bytes()==subprocess.check_output(['git','show',head+':'+p],cwd='/Users/colesmart/dev/coupon_app')
# Verify exact search runtime dependency closure between the controlled candidate
# and current-head integration; unrelated index/export additions are not mixed
# into controlled measurements.
seen=set();pending=['postgis_staging_runtime.js','postgis_hosted_entrypoint.js']
while pending:
 name=pending.pop()
 if name in seen:continue
 seen.add(name);content=(s/'functions/lib'/name).read_text()
 for dep in re.findall(r'require\([\"\'](\./[^\"\']+\.js)[\"\']\)',content):
  target=str((Path(name).parent/dep).as_posix());pending.append(target)
closureMismatch=[p for p in seen if (s/'functions/lib'/p).read_bytes()!=(r/'candidate-source/functions/lib'/p).read_bytes()];assert not closureMismatch
(r/'final-integration-reuse-proof.json').write_text(json.dumps({'baseHead':head,'controlledCandidateBase':'6753dd0f999afe8416e3d536feace7a7bf38347a','runtimeClosureFiles':len(seen),'runtimeClosureExactlyEqual':True,'closure':sorted(seen),'changedFrozenInputsFrom006':changedFrom006,'taskOwnedChanges':owned,'allOtherChangesExactCurrentHead':True},indent=2)+'\n')
manifest={'schemaVersion':1,'runId':'BS-BITESTAR-POSTGIS-PERFORMANCE-CLOSEOUT-007','promptTimestamp':'2026-10-19T17:36:00-04:00','frozenAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'expectedStartingHead':'6753dd0f999afe8416e3d536feace7a7bf38347a','actualStartingHead':head,'status':'SOURCE_AND_AFFECTED_LOCAL_CORRECTNESS_QUALIFIED; HEAVY_LATENCY_TARGET_UNMET; HOSTED_TAILS_UNQUALIFIED; CLOUD_EXECUTION_BLOCKED','previousFreezeDigest':old['candidateDigest'],'candidateDigest':hashlib.sha256(''.join(h+'  '+p+'\n' for p,h in hashes.items()).encode()).hexdigest(),'sourceCount':len(hashes),'digestAlgorithm':old['digestAlgorithm'],'selection':'Final current-main39922fd clean archive plus one bounded backend change and focused test. Prior006 explicit scope extended for current backend compile inputs; newer committed website inputs preserved. Unrelated owner worktree bytes excluded. Qualification applies only to affected search paths, not all website changes. Reports/evidence indexed separately.','intendedImplementationEdits':owned,'sha256':hashes,'images':{'controlledCandidate':'sha256:d6258f63d589a68cffdc3dc7f6562f948d712aa379f32e903e2a22c6a38b736c','finalIntegration':j['image']},'qualified':['314 final-head native tests','179 final-head Dart tests','5 real Firestore/PostGIS authority/expiry/replay checks','16 final-image actual Flutter consumer intents','Exact heavy corrected-reference parity and controlled empty/moderate differential parity','Task-local relay buffering correction; application allocation unchanged'],'unqualified':['Heavy suppression latency remains above target','Hosted warm p95<=2s/p99<=4s and cold<=4s not established','Native-cloud performance, provider refresh, whole workload and cleanup gates retained'],'paidAuthorization':False,'originalFirstBillableAtMs':None,'productionActivation':False}
(s/'tool/postgis_staging/combined-source.performance-007.json').write_text(json.dumps(manifest,indent=2)+'\n')
(r/'source-freeze-summary.json').write_text(json.dumps({k:v for k,v in manifest.items() if k!='sha256'},indent=2)+'\n')
print({'sourceCount':len(hashes),'digest':manifest['candidateDigest'],'image':j['image'],'compiledAndSourceFiles':len(j['sha256']),'runtimeClosure':len(seen)})
