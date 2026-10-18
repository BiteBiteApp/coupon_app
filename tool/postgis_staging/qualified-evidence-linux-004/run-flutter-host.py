from pathlib import Path
import subprocess,os,sys
p=Path(__file__).parent;mode=sys.argv[1];assert mode in ['serial','window']
e=os.environ.copy();e['PATH']='/Applications/Docker.app/Contents/Resources/bin:'+e['PATH']
a=['docker','run','-d','--name','bs-linux004-flutter-host','--label','bitestar.run=linux004','--platform=linux/amd64','--network=container:bs-linux004-pg','--memory=1024m','--cpus=2','--pids-limit=128','--mount','type=bind,src='+str(p/'linux-execution')+',dst=/evidence']
for key,value in {'BS_POSTGIS_FLUTTER_HOST':'1','BS_POSTGIS_GUEST_WINDOW':'1' if mode=='window' else '0','FIRESTORE_EMULATOR_HOST':'127.0.0.1:8088','FIREBASE_AUTH_EMULATOR_HOST':'127.0.0.1:9099','GCLOUD_PROJECT':'demo-bs-postgis-flutter','BS_POSTGIS_FIXTURE_NOW':'2026-10-18T00:00:00Z','BS_POSTGIS_FLUTTER_METADATA':'/evidence/'+mode+'-host.final.json','BS_POSTGIS_FLUTTER_TIMINGS':'/evidence/'+mode+'-authority.final.jsonl'}.items():a+=['-e',key+'='+value]
a+=['--entrypoint=node','sha256:a2de5c9804255d17d275a974d2ce1923191f43b4a7e33c64f722f0566b33c6e4','/evidence/linux-flutter-host.cjs']
id=subprocess.check_output(a,env=e,text=True).strip();(p/'linux-execution'/f'{mode}-container.inspect.json').write_text(subprocess.check_output(['docker','inspect',id],env=e,text=True));print(id)
