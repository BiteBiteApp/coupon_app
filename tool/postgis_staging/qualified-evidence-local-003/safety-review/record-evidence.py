from pathlib import Path
import hashlib,json,datetime,re,subprocess
report=Path('/Users/colesmart/.codex/reports/BS-BITESTAR-POSTGIS-PRESPEND-LOCAL-003-20261017')
p=report/'selected-source';out=report/'safety-review'
node='/Users/colesmart/.codex/reports/BS-NATIONWIDE-SEARCH-READ-MODEL-PROOF-001-20261001-123527-EDT/runtime/node'
sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest()
base_env={'NODE_PATH':'/Users/colesmart/dev/coupon_app/firestore_rules_tests/node_modules','FIRESTORE_EMULATOR_HOST':'127.0.0.1:8792'}
provider=['search_index_contract','search_index_builders','search_index_maintenance','search_index_runtime_wiring','photo_screening_provider','review_text_provider','firestore_index_contract']
existing=['photo_report_rules','review_text_rules','reviewer_safety_rules','posting_restriction_rules']
ff=lambda n:f'functions/test/{n}.test.js'
rf=lambda n:f'firestore_rules_tests/test/{n}.test.js'
runs=[
('transaction-completion.log',{'FIRESTORE_EMULATOR_HOST':'127.0.0.1:8792','RUN_SAFETY_TRANSACTION_EMULATOR':'1'},[ff('safety_transaction_retry')],6),
('projection-provider-contracts.log',{},list(map(ff,provider)),341),
('root-rules-existing.log',{**base_env,'FIRESTORE_EMULATOR_HOST':'127.0.0.1:8088'},list(map(rf,existing[:2]+['account_deletion_rules']+existing[2:])),None),
('root-rules-rerun.log',base_env,list(map(rf,existing)),20),
('root-rules-completion.log',{**base_env,'SAFETY_RULES_POLICY':'source'},[rf('safety_release_candidate_rules')],13),
('root-rules-source-projection.log',base_env,list(map(rf,['firestore_bitescore_cutover','firestore_bitescore_bounded'])),11)]
records=[];paths=set()
for log,env,tests,count in runs:
 s=(out/log).read_text(); counts={k:int(v) for k,v in re.findall(r'^ℹ (tests|pass|fail|skipped|cancelled|todo) (\d+)$',s,re.M)}
 if count is not None: assert counts['tests']==count and counts['pass']==count and counts['fail']==0 and counts['skipped']==0
 records.append({'log':log,'logSha256':sha(out/log),'cwd':str(p),'environmentOverrides':env,'argv':[node,'--test','--test-concurrency=1',*tests],'stdoutStderrRedirect':str(out/log),'exitCode':0 if count is not None else 1,'counts':counts,'status':'PASS' if count is not None else 'SETUP_FAILURE_RETAINED','note':None if count is not None else '13 passed; 12 setup failures: photo/reviewer exact8792 guard and account-deletion Firestore8792 plus Storage9298 guard. Does not establish product failure. Corrected Firestore-only invocation passes separately; account-deletion5 remains unverified.'})
 paths.update(tests)
paths.update(['firestore.rules','storage.rules','firestore.indexes.json','firebase.json','functions/package.json','functions/package-lock.json','functions/tsconfig.json','firestore_rules_tests/package.json','firestore_rules_tests/package-lock.json','firestore_rules_tests/fixtures/bitescore_pre_cutover.rules','functions/test/fixtures/customer_bitescore_runtime_metadata.json','functions/test/safety_release_integration_emulator.test.js'])
# Hash relevant tested compiled modules and their static relative dependency closure;
# this is an identity inventory, not an additional behavioral audit.
modules=['index','photo_screening','owner_photo_screening','review_text_moderation','bitescore_review_aggregate','rating_destructive_job_store','photo_screening_provider','review_text_provider','search_index_contract','search_index_builders','search_index_maintenance','customer_bitesaver_search_matcher','customer_bitesaver_search_contract','restaurant_geo_helpers','customer_bitesaver_public_identity','customer_bitescore_search_contract','admin_restaurant_search_helpers','admin_restaurant_mailing_batch']
queue=[p/'functions/lib'/f'{x}.js' for x in modules]; seen=set()
while queue:
 f=queue.pop().resolve()
 if f in seen or not f.is_file(): continue
 seen.add(f);paths.add(str(f.relative_to(p)))
 src=p/'functions/src'/f'{f.stem}.ts'
 if src.is_file(): paths.add(str(src.relative_to(p)))
 for q in re.findall(r'require\([\"\'](\./[^\"\']+)[\"\']\)',f.read_text()):
  d=f.parent/q
  if not d.suffix:d=d.with_suffix('.js')
  if d.is_file():queue.append(d)
hashes={name:sha(p/name) for name in sorted(paths) if (p/name).is_file()}
(out/'tested-files.sha256').write_text(''.join(f'{h}  {name}\n' for name,h in hashes.items()))
frozen=p/'tool/safety_release_prep/combined-source.json';old=json.loads(frozen.read_text())
compare={n:{'currentSha256':hashes[n],'frozenSha256':old['sha256'].get(n),'equal':hashes[n]==old['sha256'].get(n)} for n in [ff('safety_transaction_retry'),'functions/src/photo_screening.ts','functions/src/owner_photo_screening.ts','functions/src/review_text_moderation.ts','firestore.rules']}
version=json.loads(subprocess.run([node,'-e','console.log(JSON.stringify({node:process.version,v8:process.versions.v8,platform:process.platform,arch:process.arch}))'],check=True,capture_output=True,text=True).stdout)
now=datetime.datetime.now(datetime.timezone.utc).isoformat()
d={'schemaVersion':1,'runId':'BS-BITESTAR-POSTGIS-PRESPEND-LOCAL-003','role':'Independent focused safety completion, root Rules and source projection regression verifier','finishedAtUtc':now,'selectedSource':str(p),'startingStateReceipt':str(report/'starting-state.json'),'startingStateSha256':sha(report/'starting-state.json'),'reportedStartingHead':json.loads((report/'starting-state.json').read_text())['head'],'gitActionsPerformed':False,'sourceEditsPerformed':False,'installationPerformed':False,'cloudActionsPerformed':False,'runtime':{**version,'path':node,'resolvedPath':str(Path(node).resolve()),'sha256':sha(Path(node))},'commands':records,'passedUniqueSelectedSuiteTests':391,'skippedInPassingCommands':0,'scope':'Actual local Firestore rules and transaction behavior; deterministic provider/injected projection/runtime wiring contracts. Does not claim live providers, deployed triggers, hosted/Linux qualification or Storage integration. One of11 cutover/private tests intentionally loads preceding frozen policy; the other43 Rules tests use current root policy.','limitations':[{'file':rf('account_deletion_rules'),'tests':5,'status':'NOT_EXECUTED_SUCCESSFULLY','reason':'Requires exact Storage emulator9298; unavailable. Initial attempt was blocked in setup. No new Storage service was started.'},{'file':ff('safety_release_integration_emulator'),'tests':4,'status':'NOT_RUN','reason':'Connected fixture requires Storage9298 in addition to Firestore/Auth. Prior evidence is not presented as current execution.'},'No full functions rebuild was performed by this reviewer. Executed existing selected-source compiled lib supplied by parent; compiled/source identities are retained.','No broad prior205/206 safety suite rerun and no claim resolving its historical intermittent concurrency failure.'],'frozenSafetyComparison':{'manifest':str(frozen),'manifestSha256':sha(frozen),'candidateDigest':old['candidateDigest'],'files':compare},'hashTiming':'Hashes captured after tests; no claim of independent before-and-after byte attestation. Parent supplied selected-source and compiled lib.','testedFilesSha256Manifest':str(out/'tested-files.sha256'),'testedFilesManifestSha256':sha(out/'tested-files.sha256'),'hashedFileCount':len(hashes),'relayShutdown':str(out/'relay-shutdown.json'),'relayShutdownSha256':sha(out/'relay-shutdown.json'),'bugFilter':[{'classification':'ACCEPT AND CLOSE','finding':'Initial test invocation used8088 although several unchanged fixtures require8792. Corrected using report-only transparent loopback relay; passing reruns and original failure retained.'}],'verdict':'PASS for391 focused executed tests; Storage-dependent9 tests remain unverified in this run.'}
(out/'safety-regression-review.json').write_text(json.dumps(d,indent=2)+'\n')
summary='''Independent safety regression review — BS-BITESTAR-POSTGIS-PRESPEND-LOCAL-003\n\n391/391 focused tests passed, with zero skips:\n-6 real Firestore transaction retry/nonretry completion cases for customer/owner/text screening; provider outcomes are deterministic doubles.\n-341 source-projection, native runtime-wiring, provider parser and index-contract tests.\n-20 existing root safety Rules cases.\n-13 exact root safety completion/compatibility Rules cases.\n-11 source-cutover/private-projection Rules cases, including one intentional frozen preceding-policy compatibility case.\n\nInitial Rules invocation retained13 passes and12 setup failures: several fixtures require8792, and account-deletion also requires Storage9298. Firestore-only reruns through a temporary127.0.0.1:8792→8088 relay passed. This was a test invocation correction, with no source or test edits. The relay was stopped;8088/9099/55441 still listen.\n\nFive account-deletion Rules tests and four connected safety integration tests were not successfully executed because Storage9298 is absent. No current pass is claimed for them or for historical broad safety suites. Root Rules, all three completion modules, and the retry fixture exactly match the retained safety-release hashes.\n\nQualified retained macOS Node24.21.0 executed the parent-supplied selected-source compiled lib. This reviewer performed no build/install, repository/Git changes, cloud actions, live provider calls, or parent-service shutdown. Exact commands, logs, hashes and fixture boundaries are recorded in safety-regression-review.json. The result does not qualify Linux or hosted execution.\n'''
(out/'safety-regression-review.txt').write_text(summary)
print(json.dumps({'receipt':str(out/'safety-regression-review.json'),'sha256':sha(out/'safety-regression-review.json'),'hashedFiles':len(hashes),'counts':391,'frozenMatches':all(v['equal'] for v in compare.values())},indent=2))
