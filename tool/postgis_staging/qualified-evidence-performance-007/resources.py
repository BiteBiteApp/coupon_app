import subprocess,json,sys,time,os
from pathlib import Path
D='/Applications/Docker.app/Contents/Resources/bin/docker'
names=sys.argv[2:]
def cmd(args):
 p=subprocess.run(args,capture_output=True,text=True);return p.stdout.strip() if p.returncode==0 else {'error':p.stderr.strip()}
x={'time':time.time(),'loadAverage':os.getloadavg(),'hostVm':cmd(['vm_stat']),'containers':{}}
for name in names:
 x['containers'][name]={'stats':cmd([D,'exec',name,'sh','-c','cat /sys/fs/cgroup/cpu.stat /sys/fs/cgroup/memory.current /sys/fs/cgroup/memory.peak /sys/fs/cgroup/memory.events /sys/fs/cgroup/memory.pressure /sys/fs/cgroup/cpu.pressure'])}
Path(sys.argv[1]).write_text(json.dumps(x,indent=2)+'\n')
