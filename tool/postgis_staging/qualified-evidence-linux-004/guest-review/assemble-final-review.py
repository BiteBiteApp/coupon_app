import collections,datetime,hashlib,json,math,pathlib,re,statistics,subprocess
B=pathlib.Path('/Users/colesmart/.codex/reports/BS-BITESTAR-POSTGIS-LINUX-QUALIFY-004-20261017')
R=B/'guest-review'; S=B/'selected-source'; W=pathlib.Path('/Users/colesmart/dev/coupon_app')
P=pathlib.Path('/Users/colesmart/.codex/reports/BS-BITESTAR-POSTGIS-PRESPEND-LOCAL-003-20261017/guest-review')
now=datetime.datetime.now(datetime.timezone.utc).isoformat()
def read(p): return json.loads(p.read_text())
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def save(n,x): (R/n).write_text(json.dumps(x,indent=2)+'\n')
def stats(rows):
 v=[x['milliseconds'] for x in rows]; s=sorted(v)
 return {'n':len(v),'medianMs':statistics.median(v),'minimumMs':min(v),'maximumMs':max(v),'nearestRankP95Ms':s[math.ceil(.95*len(s))-1],'atOrBelow2000Ms':sum(x<=2000 for x in v),'allMilliseconds':v}
image='sha256:a2de5c9804255d17d275a974d2ce1923191f43b4a7e33c64f722f0566b33c6e4'
perf={'recordedAt':now,'image':image,'evidenceType':'Actual macOS Flutter rendering through fixed loopback relays to actual emulated Linux backend, PostgreSQL/PostGIS and Auth/Firestore emulators; synthetic local workload only.','modes':{}}
all_authority={}; all_render={}
for mode in ['serial','window']:
 render=read(B/f'linux-execution/{mode}-render.final.json')['observations']; all_render[mode]=render
 authority=[json.loads(x) for x in (B/f'linux-execution/{mode}-authority.final.jsonl').read_text().splitlines()];all_authority[mode]=authority
 assert len(render)==46 and all(r['status']=='success' and r['errors']==0 for r in render)
 assert [x['sequence'] for x in authority]==list(range(1,len(authority)+1))
 assert sum(len(x['calls']) for x in render)==len(authority)
 offset=0; authority_by_flow=collections.defaultdict(list)
 for obs in render:
  records=authority[offset:offset+len(obs['calls'])]; offset+=len(records)
  assert [x['endpoint'] for x in records]==[x['endpoint'] for x in obs['calls']]
  assert all(x['status']=='success' for x in records)
  assert all(x['status']=='success' for x in obs['calls'])
  assert all(o['failures']==0 for x in records for o in x['operations'].values())
  counts=collections.Counter();millis=collections.Counter()
  for x in records:
   for k,v in x['operations'].items(): counts[k]+=v['calls'];millis[k]+=v['milliseconds']
  authority_by_flow[obs['flow']].append({'run':obs['run'],'httpCalls':len(records),'requestedDocuments':sum(x['requestedDocuments'] for x in records),'operationCalls':dict(counts),'operationMilliseconds':dict(millis)})
 m={'observations':len(render),'allSuccess':True,'allHttpCalls':len(authority),'authorityOperationFailures':0,'flows':{}}
 for flow in dict.fromkeys(r['flow'] for r in render):
  rows=[r for r in render if r['flow']==flow];warm=[r for r in rows if r['phase']=='warm-observation'];first=[r for r in rows if r['phase']=='first-observation']
  f={'samples':len(rows),'successes':len(rows),'errors':0,'firstObservationMs':[r['milliseconds'] for r in first],'warm':stats(warm),'httpCallsPerSample':sorted(set(r['httpCalls'] for r in rows)),'usefulCardCounts':sorted(set(r.get('usefulCards') for r in rows),key=str),'orderedMembershipDigests':sorted(set(r.get('orderedMembershipDigest') for r in rows),key=str),'challengeRoundsPerSample':sorted(set(sum(c['challengeCandidates']>0 for c in r['calls']) for r in rows)),'challengeSizes':sorted(set(c['challengeCandidates'] for r in rows for c in r['calls'] if c['challengeCandidates']>0))}
  values=authority_by_flow[flow]
  countsets={json.dumps({'httpCalls':v['httpCalls'],'requestedDocuments':v['requestedDocuments'],'operationCalls':v['operationCalls']},sort_keys=True) for v in values}
  f['authorityCountsIdenticalAcrossSamples']=len(countsets)==1
  f['authorityCounts']=json.loads(next(iter(countsets))) if len(countsets)==1 else list(map(json.loads,sorted(countsets)))
  f['authorityTimingSamples']=values
  m['flows'][flow]=f
 host=read(B/f'linux-execution/{mode}-host.final.json');ci=read(B/f'linux-execution/{mode}-container.inspect.json');ci=ci[0] if isinstance(ci,list) else ci
 assert ci['Image']==image
 env=dict(x.split('=',1) for x in ci['Config']['Env'] if '=' in x)
 assert env['BS_POSTGIS_GUEST_WINDOW']==('0' if mode=='serial' else '1')
 m['actualContainer']={'image':ci['Image'],'command':ci['Config']['Cmd'],'guestWindowEnvironment':env['BS_POSTGIS_GUEST_WINDOW'],'fixtureTemporalNow':env['BS_POSTGIS_FIXTURE_NOW'],'networkMode':ci['HostConfig']['NetworkMode'],'portBindings':ci['HostConfig']['PortBindings'],'mounts':ci['Mounts']}
 perf['modes'][mode]=m
host0=read(B/'linux-execution/serial-host.final.json');host1=read(B/'linux-execution/window-host.final.json');assert host0==host1
assert len(host0['publishedSourceFence']['shards'])==16
perf['equivalentInputs']={'entireHostMetadataEqual':True,'fixture':host0['fixture'],'temporalNow':host0['fixtureTemporalNow'],'publishedRevision':host0['publishedRevision'],'fullPublishedSourceFence':host0['publishedSourceFence'],'activeEntities':host0['activeEntities']}
saver=[r for rows in all_render.values() for r in rows if r['flow'].startswith('bitesaver')]
assert len(saver)==80 and all(r['usefulCards']==25 for r in saver)
digests={r['orderedMembershipDigest'] for r in saver};assert len(digests)==1
perf['resultIdentity']={'saverSamples':80,'all25UsefulCards':True,'sameOrderedPublicIdSha256':next(iter(digests)),'scoreFinder':'3 successful observations each per mode; no ordered-membership digest for these flows, so no stronger identical-membership claim from timing JSON.'}
a=perf['modes']['serial']['flows']['bitesaver-guest']['warm']['medianMs'];b=perf['modes']['window']['flows']['bitesaver-guest']['warm']['medianMs']
perf['warmGuestMedianReductionPercent']=100*(1-b/a)
perf['counterMeaning']=['Instrumented method calls and requested document counts, not billed Firestore reads. Query-returned rows are excluded from requestedDocuments.','Unique document counts are per endpoint; do not sum as global distinct reads.','Nested and concurrent operation durations overlap; summing them is not request wall time.','Both modes retain 26 membership queries and 191 instrumented SQL queries per guest sample; reduced challenge round trips do not imply SQL authority replacement.']
perf['limitations']=['First observations are retained separately and are not proof of a cold-start distribution.','19 warm guest samples per mode: window 18/19 at or below 2 seconds; one 2225.986ms sample. No consistent sub-2-second or hosted-tail claim.','Linux x64 runs under Rosetta on this Mac; Flutter is on macOS. No native cloud CPU, network, mobile-device or nationwide load qualification.','Serial and window runs are sequential fixed-fixture runs; do not infer a general causal latency distribution from these samples.','Signed, Score and Finder remain functional; their timings are not claimed unchanged or improved.']
save('linux-performance-review.final.json',perf)
identity=read(R/'linux-image-guest-identity.final.json');initial=read(R/'linux-image-guest-identity.json')
source_comp=[]
for p,h in identity['sha256'].items():
 row={'path':p,'imageSha256':h}
 for label,root in [('selected',S),('primary',W)]:
  if (root/p).exists():row[label+'Sha256']=sha(root/p)
 if p.startswith('functions/src/') or p.startswith('functions/test/'):assert row.get('selectedSha256')==h
 if p in initial['sha256']:row['sameAsInitialImage']=initial['sha256'][p]==h
 source_comp.append(row)
for p in ['functions/src/customer_bitesaver_search_session.ts','functions/lib/customer_bitesaver_search_session.js','functions/src/postgis_staging_runtime.ts','functions/lib/postgis_staging_runtime.js','functions/test/customer_bitesaver_search_handlers.test.js','functions/test/support/postgis_flutter_host.cjs']:
 assert identity['sha256'][p]==initial['sha256'][p]
checks=[]
for f,old in [('linux-independent-observations.final.json','independent-window-observations.v3.json'),('linux-supplement-observations.final.json','independent-window-observations.supplement.json')]:
 assert read(R/f)==read(P/old)
 checks.append({'current':str(R/f),'prior003':str(P/old),'jsonEqual':True})
baseline=read(B/'starting-state.json');deltas=[]
for p,h in baseline['protectedSha256'].items():
 full=pathlib.Path(p) if pathlib.Path(p).is_absolute() else W/p
 if not full.exists() or sha(full)!=h:deltas.append(p)
assert not deltas
owners=[line[3:] for line in baseline['status'].splitlines() if line.startswith(' M ')]
selected_not_committed=[]
for p in owners:
 committed=subprocess.check_output(['git','show',baseline['head']+':'+p],cwd=W)
 if hashlib.sha256(committed).hexdigest()!=sha(S/p):selected_not_committed.append(p)
assert len(owners)==16 and not selected_not_committed
current_head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=W,text=True).strip()
source_extra={}
for p in ['test/services/postgis_flutter_integration_test.dart','lib/services/customer_bitesaver_search_coordinator.dart','lib/services/customer_bitesaver_guest_usage_store.dart','lib/models/customer_bitesaver_search.dart','tool/postgis_staging/hosted/render-service.cjs','tool/postgis_staging/hosted/hosted.example.json','tool/postgis_staging/linux/Dockerfile']:
 source_extra[p]={'selectedSha256':sha(S/p),'primarySha256':sha(W/p)}
 if p.startswith(('lib/','test/')):assert source_extra[p]['selectedSha256']==source_extra[p]['primarySha256']
assert source_extra['test/services/postgis_flutter_integration_test.dart']['selectedSha256']=='994cb9d13d661f55e0e39b4d4cc268b88e23196e1d22b3a8dd94df8bf98d940f'
tests=[]
for f,n in [('linux-native-handlers.final.log',304),('linux-independent-diagnostics.final.log',22),('linux-independent-supplement.final.log',2)]:
 t=(R/f).read_text();assert re.search(r'\btests '+str(n)+r'\b',t) and re.search(r'\bpass '+str(n)+r'\b',t) and re.search(r'\bfail 0\b',t) and re.search(r'\bskipped 0\b',t)
 tests.append({'log':str(R/f),'sha256':sha(R/f),'tests':n,'passed':n,'failed':0,'skipped':0,'durationMs':float(re.search(r'duration_ms ([0-9.]+)',t).group(1))})
restart=read(B/'linux-execution/postgres-restart-evidence.json')
assert restart['pass'] and restart['boundedPoolReconnected'] and restart['oldConnectionRejected']
for k in ['publication','counts','sourceHeadsHash','entitiesHash','pinsHash','activePin','orderedIds','boundary']:assert restart['before'][k]==restart['after'][k]
relay=read(B/'mac-loopback-relay.final.inspect.json');relay=relay[0] if isinstance(relay,list) else relay
assert all(x['HostIp']=='127.0.0.1' for v in relay['HostConfig']['PortBindings'].values() for x in v)
evidence=[
 'guest-review/linux-performance-review.final.json','guest-review/linux-image-guest-identity.final.json','guest-review/linux-container-execution.final.json','guest-review/linux-container-cleanup.final.json','guest-review/linux-independent-observations.final.json','guest-review/linux-supplement-observations.final.json','guest-review/linux-diagnostic-adaptation.json','guest-review/linux-inputs/independent-window-diagnostics.v3.cjs','guest-review/linux-inputs/independent-window-diagnostics.supplement.cjs','guest-review/linux-initial-guest-execution-review.json','guest-review/switch-propagation-review.json','linux-review/final-guard-review.json','linux-review/numerical-runtime-review.json','linux-review/final-guard-tests.log','linux-execution/sql-native-integration.final.log','linux-execution/native-integration.final.json','linux-execution/query.final.json','linux-execution/postgres-restart-evidence.json','linux-execution/postgres-restart.final.log','linux-execution/linux-flutter-host.cjs','mac-loopback-relay.cjs','mac-loopback-relay.final.inspect.json','mac-loopback-relay.inspect.json','linux-execution/serial-render.network-startup.log','linux-execution/serial-render.auth-relay-missing.log','linux-execution/serial-render.auth-relay-missing.json','starting-state.json','search-image.final.inspect.json']
for mode in ['serial','window']:
 evidence += [f'linux-execution/{mode}-{f}' for f in ['render.final.json','render.final.log','authority.final.jsonl','host.final.json','container.inspect.json']]
for p in evidence: assert (B/p).exists(),p
review={'runId':baseline['runId'],'promptTimestamp':baseline['promptTimestamp'],'role':'Independent guest/security/privacy/performance reviewer','reviewer':'/root/query_client','completedAt':now,'expectedStartingHead':baseline['head'],'observedHead':current_head,'permittedChangeArea':'External report artifacts only; no repository edits, Git mutation, cloud or production action.','verdict':'PASS for this exact local emulated Linux guest/authority artifact with stated performance and hosted-mode limitations; no unresolved material guest defect found.','image':image,'runtime':{k:v for k,v in identity.items() if k!='sha256'},'testsRunIndependentlyInFinalImage':tests,'diagnosticObservationParityWith003':checks,'execution':{'platform':'linux/amd64 under Rosetta','network':'none','memoryBytes':805306368,'cpus':1,'pidsLimit':128,'nativeSuiteMounts':[],'diagnosticMounts':'Report-owned adapter directory read-only; no repository, home, credentials or Docker socket mounts.','testIsolation':'--test-isolation=none','assertionBodies':'Retained003 diagnostics unchanged; only fixture root /app and /tmp observation output locations adapted.'},'sourceAndCompiledHashes':source_comp,'otherReviewedSourceHashes':source_extra,
 'switchPropagation':{'local':'Report fixture reads BS_POSTGIS_GUEST_WINDOW === "1", local runtime passes options.guestRestaurantWindow === true; only PostGIS-backed private restaurant progress opts into windowVersion 1. Omitted/0 remains serial. No public request selector.','imageDefault':'Hosted entrypoint --dry-run, no listener or cloud connection.','hostedConfiguration':'No validated or forwarded window option in hosted configuration/runtime; adding local environment variable does not enable hosted window.','hostedExecution':'Final guard explicitly rejects Linux hosted scope before cached local qualification can succeed and before entrypoint credentials/resources open. This image cannot execute either hosted mode without separately qualified hosted runtime work.','futureDependency':'Before an authorized hosted window trial: strict optional boolean in cloned, digest/signature-bound hosted configuration; default false; explicitly forward into native Saver context and verify invalid/tampered/mutated configuration negatives. No such change was made in004.','guardEvidence':'Independent numerical/runtime reviewer final-guard-review.json reused; final image and binary hashes match. No additional mathematical qualification is inferred by this guest review.'},
 'authorityPrivacyAndOrder':[
 'Source/compiled guest implementation, guest wire codec, search contract, coordinator/history and public identity handling retain003 reviewed bytes. SQL supplies candidate membership; native current Firestore source/parent/offer/usage evidence determines returned authority and grants.',
 'Private window holds ordered pending parents. Results drain only through resolved head, not past an unresolved restaurant; strict parser bounds, candidate-count/boundary/exhaustion slices and transaction replay protection remain intact.',
 'Global challenge bound75 IDs, pending parent window26-minus-ready including head, existing100-item work and bounded private checkpoint limits retained. Independent maximum-domain case checkpoint444772 bytes and token6573 bytes remain under existing limits.',
 'Exact same-ID edit versus replaced occurrence distinction, per-parent source validation, expired check reissue, accepted-answer interruption/replay, conflicting concurrent answer single winner, withdrawn parent failure, once-per-day boundary and invalid old snapshot were exercised in final-image diagnostics/native suite.',
 'No device history inventory added to telemetry. Actual timing artifact records ordered public result IDs only as SHA256; bounded candidate challenge sizes and aggregate counters remain visible. Batched challenge may expose up to75 already-needed candidate IDs in one round, under the authorized existing global bound.',
 'Final real SQL/native integration30/30 reviewed from parent evidence: malformed actor/client, signed and guest same-ID edits, usage revocation, account switching, hidden/private canaries, Menu and guest redemption preparation preserved. This is reviewed evidence, not an additional independently rerun SQL suite.'
 ],
 'performanceEvidence':{'path':str(R/'linux-performance-review.final.json'),'sha256':sha(R/'linux-performance-review.final.json'),'finalFlutterSuites':'4/4 per mode, 20 guest +20 signed +3Score +3Finder per mode; all46 observations and every instrumented request succeeded.','sameFixtureAndFence':'Entire host JSON equals between modes:185 synthetic source/projection documents, fixed2026-10-18T00:00:00Z, revision1, same full16-shard fence.','sameSaverResults':'All80 Saver observations have25 useful cards and equal ordered public-ID digest.','warmGuestMedianMs':{'serial':a,'window':b},'windowWarmAbove2s':1,'windowWarmSamples':19,'counterChange':'Per guest28→3 HTTP calls,26→1 challenge rounds,754→658 requested documents;26 membership.queryResults and191 sql.membershipQuery calls retained in both modes.','limitations':perf['limitations']},
 'relayAndRestart':{'topology':'macOS Flutter uses fixed Mac127.0.0.1:8188/9099 publications; report-only byte relays reach actual image fixture host and Auth emulator in shared task network namespace. Backend host and emulator endpoints remain127.0.0.1 internally. No mock transport or fake token substitution.','relayPorts':relay['HostConfig']['PortBindings'],'postgresRestart':'Actual task-owned PostgreSQL fast restart rejected active/old connections, bounded pool reconnected in3536ms. Publication,185heads/entities,72pins, active pin/expiry, ordered25 IDs and boundary unchanged; no data reset. This is not hosted failover or power-loss proof.'},
 'retainedEarlierFailures':[
 {'log':'linux-execution/serial-render.network-startup.log','status':'Interrupted setup run; internal Docker relay port unavailable. Preserved as failed/incomplete evidence, excluded from final timing distribution.'},
 {'log':'linux-execution/serial-render.auth-relay-missing.log','json':'linux-execution/serial-render.auth-relay-missing.json','status':'2/4 failed before report-only Auth relay was added. Guest first sample tester initialization exception; signed Auth connection refused/null UID; Score/Finder succeeded. Initial relay inspect lacks9099. Final relay publishes it on Macloopback. Flutter test source unchanged; no assertion weakening.'}
 ],
 'findings':[
 {'classification':'ACCEPT AND CLOSE','finding':'One truthful count metadata difference remains in dense in-memory fixture: serial count3/current versus window null/unknown at page0row21. Existing100-item work bound may leave exhaustion unproven. Exact eligible IDs/order/hasMore unchanged; supported unknown DTO retained. No claim of byte-identical responses.','evidence':'linux-independent-observations.final.json'},
 {'classification':'ACCEPT AND CLOSE','finding':'Final local window improves measured median but18/19 warm samples meet2 seconds; maximum/p95 by nearest rank2225.986ms. Keep explicit limitation; no architecture/product change is justified within this qualification task.'},
 {'classification':'ACCEPT AND CLOSE','finding':'Current hosted configuration does not forward guest window and final image hosted runtime is deliberately refused. Current task authorizes identifying the missing future dependency, not implementing/activating it. Localwindow qualification remains valid.'}
 ],
 'preservation':{'baseline':str(B/'starting-state.json'),'protectedPaths':len(baseline['protectedSha256']),'mismatches':deltas,'ownerModifiedPaths':len(owners),'selectedOwnerPathsNotCommittedVersion':selected_not_committed,'guestClientAndFlutterSourceUnchanged':True,'primaryWorkingTree':'Existing owner work preserved; root authorized runtime guard changes are separate. Reviewer performed read-only git rev-parse/show only.'},
 'cleanup':{'onlyReviewerTestContainersRemoved':['bs-postgis-004-final-guest-handlers','bs-postgis-004-final-guest-diagnostics','bs-postgis-004-final-guest-supplement'],'imagesRetained':True,'rootServiceContainersTouched':False},
 'qualificationBoundary':['Source reviewed, actual Linux image tests passed and local macOS-Flutter/Linux-backend integration reviewed. Not cloud-deployed, customer-active, hosted-approved, nationally load-tested or production-qualified.','Local emulated numerical qualification is exactly bounded by independent final guard receipt; unsupported runtime flags, CPUs/kernels and hosted scope remain refused.'],
 'evidence':[{'path':str(B/p),'sha256':sha(B/p)} for p in evidence]}
save('final-independent-review.json',review)
print(json.dumps({'reviewPath':str(R/'final-independent-review.json'),'sha256':sha(R/'final-independent-review.json'),'performancePath':str(R/'linux-performance-review.final.json'),'performanceSha256':sha(R/'linux-performance-review.final.json'),'tests':[x['passed'] for x in tests],'protectedPaths':len(baseline['protectedSha256']),'deltas':len(deltas),'head':current_head,'guestMedianReductionPercent':perf['warmGuestMedianReductionPercent']},indent=2))
