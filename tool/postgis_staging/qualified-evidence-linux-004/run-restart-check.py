from pathlib import Path
import subprocess,os,time,json,datetime
p=Path(__file__).parent; out=p/'linux-execution';env=os.environ.copy();env['PATH']='/Applications/Docker.app/Contents/Resources/bin:'+env['PATH']
def run(args,timeout=50):return subprocess.check_output(['docker']+args,env=env,text=True,stderr=subprocess.STDOUT,timeout=timeout).strip()
assert not (out/'restart-request.json').exists()
run(['stop','--time','15','bs-linux004-flutter-host']);run(['rm','bs-linux004-flutter-host'])
id=run(['run','-d','--name','bs-linux004-restart-probe','--label','bitestar.run=linux004','--platform=linux/amd64','--network=container:bs-linux004-pg','--memory=768m','--cpus=1','--pids-limit=128','--mount','type=bind,src='+str(out)+',dst=/evidence','-e','BS_POSTGIS_RESTART_TEST=1','--entrypoint=node','sha256:a2de5c9804255d17d275a974d2ce1923191f43b4a7e33c64f722f0566b33c6e4','/evidence/postgres-restart-check.cjs'])
start=time.monotonic()
while not (out/'restart-request.json').exists():
 if time.monotonic()-start>30:raise RuntimeError('No ready signal; '+run(['logs',id]))
 time.sleep(.1)
response=run(['exec','--user','postgres','bs-linux004-pg','pg_ctl','-D','/var/lib/postgresql/18/docker','-l','/tmp/bs-postgres.log','-m','fast','-w','-t','30','restart'])
(out/'restart-completed.json').write_text(json.dumps({'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'command':'docker exec --user postgres bs-linux004-pg pg_ctl -D /var/lib/postgresql/18/docker -l /tmp/bs-postgres.log -m fast -w -t30 restart','output':response},indent=2)+'\n')
code=run(['wait',id]);log=run(['logs',id]);(out/'postgres-restart.final.log').write_text(log+'\n');(out/'postgres-restart-container.inspect.json').write_text(run(['inspect',id])+'\n')
assert code=='0',(code,log)
run(['rm',id]);print(log)
