import os,subprocess,json,time
from pathlib import Path
r=Path(__file__).parent;node='/Users/colesmart/.codex/reports/BS-NATIONWIDE-SEARCH-READ-MODEL-PROOF-001-20261001-123527-EDT/runtime/node';attempts=[]
for mode in ['empty','moderate','heavy']:
 for index,variant in enumerate(['baseline','candidate','candidate','baseline','baseline','candidate']):
  name=f'native-{mode}-{index}-{variant}'
  env={**os.environ,'BS_PERF_SOURCE':str(r/(variant+'-source')),'BS_PERF_RUN':name,'BS_PERF_OUTPUT':str(r/(name+'.json')),'BS_PERF_HISTORY':mode,'BS_PERF_NOW':'2026-10-19T23:00:00Z','FIRESTORE_EMULATOR_HOST':'127.0.0.1:8088','FIREBASE_AUTH_EMULATOR_HOST':'127.0.0.1:9099'}
  before=time.time()
  with open(r/(name+'.log'),'w') as f:p=subprocess.run([node,str(r/'native-probe.cjs')],env=env,stdout=f,stderr=subprocess.STDOUT)
  attempts.append({'scenario':mode,'index':index,'variant':variant,'exitCode':p.returncode,'startedAtEpoch':before,'finishedAtEpoch':time.time(),'evidence':name+'.json'})
  (r/'native-balanced-results.json').write_text(json.dumps(attempts,indent=2)+'\n')
  if p.returncode:raise SystemExit(p.returncode)
print('PASS',len(attempts),'native two-page attempts')
