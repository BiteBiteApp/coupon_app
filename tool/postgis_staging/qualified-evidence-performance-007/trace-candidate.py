import os,subprocess,json
from pathlib import Path
r=Path(__file__).parent;node='/Users/colesmart/.codex/reports/BS-NATIONWIDE-SEARCH-READ-MODEL-PROOF-001-20261001-123527-EDT/runtime/node'
for variant in ['baseline','candidate']:
 name='trace-heavy-'+variant
 env={**os.environ,'BS_PERF_SOURCE':str(r/(variant+'-source')),'BS_PERF_RUN':name,'BS_PERF_OUTPUT':str(r/(name+'-native.json')),'BS_PERF_HISTORY':'heavy','BS_PERF_NOW':'2026-10-19T23:00:00Z','FIRESTORE_EMULATOR_HOST':'127.0.0.1:8088','FIREBASE_AUTH_EMULATOR_HOST':'127.0.0.1:9099','BS_PERF_OBSERVER':str(r/'observer.cjs'),'BS_POSTGIS_FLUTTER_TIMINGS':str(r/(name+'-operations.jsonl'))}
 subprocess.run(['python3',str(r/'resources.py'),str(r/(name+'-resources-before.json')),'bs-corrections006-pg','bs-corrections006-emulators'],check=True)
 with open(r/(name+'.log'),'w') as f:p=subprocess.run([node,str(r/'native-probe.cjs')],env=env,stdout=f,stderr=subprocess.STDOUT)
 subprocess.run(['python3',str(r/'resources.py'),str(r/(name+'-resources-after.json')),'bs-corrections006-pg','bs-corrections006-emulators'],check=True)
 if p.returncode:raise SystemExit(p.returncode)
