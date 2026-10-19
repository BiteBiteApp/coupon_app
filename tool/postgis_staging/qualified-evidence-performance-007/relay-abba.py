import subprocess,json,time
from pathlib import Path
r=Path(__file__).parent;d='/Applications/Docker.app/Contents/Resources/bin/docker'
results=[];old='bs-corrections006-loopback';new='bs-performance007-loopback-nodelay';app='bs-performance007-relay-ab'
for index,variant in enumerate(['original','nodelay','nodelay','original']):
 name=f'relay-{index}-{variant}'
 subprocess.run([d,'stop','-t','1',app],capture_output=True)
 subprocess.run([d,'stop','-t','1',new if variant=='original' else old],check=True,capture_output=True)
 subprocess.run([d,'start',old if variant=='original' else new],check=True,capture_output=True)
 subprocess.run([d,'start',app],check=True,capture_output=True)
 # Readiness, no arbitrary timing delay inside a measured intent.
 for attempt in range(100):
  p=subprocess.run([d,'logs','--tail','1',app],capture_output=True,text=True)
  if '"ready":true' in p.stdout:break
  time.sleep(.1)
 subprocess.run(['python3',str(r/'resources.py'),str(r/(name+'-before.json')),app,'bs-corrections006-pg','bs-corrections006-emulators'],check=True)
 cmd=['/opt/homebrew/bin/flutter','test','--no-pub','--dart-define=BS_POSTGIS_HTTP_URL=http://127.0.0.1:8188',f'--dart-define=BS_POSTGIS_UI_EVIDENCE={r/name}.json','--dart-define=BS_POSTGIS_UI_SAMPLES=2','--plain-name','real local guest BiteSaver renders useful native offer cards','test/services/postgis_flutter_integration_test.dart']
 with open(r/(name+'.log'),'w') as f:p=subprocess.run(cmd,cwd=r/'baseline-source',stdout=f,stderr=subprocess.STDOUT)
 subprocess.run(['python3',str(r/'resources.py'),str(r/(name+'-after.json')),app,'bs-corrections006-pg','bs-corrections006-emulators'],check=True)
 results.append({'index':index,'variant':variant,'exitCode':p.returncode,'evidence':name+'.json'})
 (r/'relay-abba-results.json').write_text(json.dumps(results,indent=2)+'\n')
 if p.returncode:raise SystemExit(p.returncode)
subprocess.run([d,'stop','-t','1',app],check=True,capture_output=True)
