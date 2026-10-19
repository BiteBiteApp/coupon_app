from pathlib import Path
import json,statistics,collections
import summarize
r=Path(__file__).parent
med=statistics.median
out={'timingBoundaries':{'flutter':'accepted center to useful render, geocoding/server startup excluded','native':'each page handler through completion; first excludes admission; later includes explicit200ms probe wait on unavailable checkpoint','noHostedTailClaim':True},'relayBalanced':{},'codeBalanced':{},'finalConsumer':{},'phases':{},'resources':{}}
for prefix,dest,variants in [('relay','relayBalanced',['original','nodelay']),('code','codeBalanced',['baseline','candidate'])]:
 for v in variants:
  a=[x for p in sorted(r.glob(prefix+'-[0-9]-'+v+'.json')) for x in json.loads(p.read_text())['observations']]
  out[dest][v]={'n':len(a),'medianMs':med(x['milliseconds'] for x in a),'warmSubsetN':sum(x['run']>0 for x in a),'warmSubsetMedianMs':med(x['milliseconds'] for x in a if x['run']>0),'allMilliseconds':[x['milliseconds'] for x in a],'exactOrderedDigest':sorted(set(x['orderedMembershipDigest'] for x in a))}
a=json.loads((r/'final-useful-render.json').read_text())['observations']
for flow in dict.fromkeys(x['flow'] for x in a):
 b=[x for x in a if x['flow']==flow];out['finalConsumer'][flow]={'n':len(b),'medianMs':med(x['milliseconds'] for x in b),'allMilliseconds':[x['milliseconds'] for x in b],'successes':sum(x['status']=='success' for x in b)}
for prefix in ['trace-linux-original','trace-nodelay-baseline','trace-final']:
 a=[json.loads(x) for x in (r/(prefix+'-operations.jsonl')).read_text().splitlines()][:6];b=a[3:6]
 out['phases'][prefix]={'warmSecondGuestHandlerMs':sum(x['milliseconds'] for x in b),'warmSecondGuestCpuMs':sum(sum(x['cpu'].values()) for x in b)/1000,'partitionMs':{k:sum(summarize.phase(x).get(k,0) for x in b) for k in ['firestore','sql','both','outsideMeasuredIo']},'sdkTransactions':sum(x['operations']['sdk.transaction']['calls'] for x in b),'authorityTransactions':sum(x['operations'].get('firestore.transaction',{}).get('calls',0) for x in b),'sdkRequestedDocuments':sum(x['sdkRequestedDocuments'] for x in b),'authorityRequestedDocuments':sum(x['authorityRequestedDocuments'] for x in b),'sqlStatements':sum(x['operations'].get('sql.allStatements',{}).get('calls',0) for x in b),'gcMs':sum(g['duration'] for x in b for g in x['gc'])}
for prefix in ['repro-linux','trace-linux','trace-nodelay-baseline','trace-final','final']:
 bp=r/(prefix+'-resources-before.json');ap=r/(prefix+'-resources-after.json')
 if not bp.exists():continue
 b=json.loads(bp.read_text());a=json.loads(ap.read_text());summary={'seconds':a['time']-b['time'],'hostLoadBefore':b['loadAverage'],'hostLoadAfter':a['loadAverage'],'containers':{}}
 for name in b['containers']:
  def stats(j):
   lines=j['containers'][name]['stats'].splitlines();v={};bare=[]
   for line in lines:
    p=line.split()
    if len(p)==2 and p[1].isdigit():v[p[0]]=int(p[1])
    elif len(p)==1 and p[0].isdigit():bare.append(int(p[0]))
   return v,bare
  x,xb=stats(b);y,yb=stats(a);summary['containers'][name]={'cpuUseMs':(y['usage_usec']-x['usage_usec'])/1000,'throttledMs':(y['throttled_usec']-x['throttled_usec'])/1000,'throttledPeriods':y['nr_throttled']-x['nr_throttled'],'oomKills':y['oom_kill']-x['oom_kill'],'memoryCurrentMiB':yb[0]/1048576,'memoryPeakMiB':yb[1]/1048576}
 out['resources'][prefix]=summary
out['nativeBalanced']=json.loads((r/'measurement-summary.json').read_text())['nativeBalanced'];out['nativeBalanced']['nonmatchingHistoryControl']=out['nativeBalanced'].pop('moderate');out['nativeBalanced']['moderateMatching']=json.loads((r/'moderate-matching-summary.json').read_text());out['heavyTrace']=json.loads((r/'trace-heavy-comparison.json').read_text())
(r/'final-measurement-summary.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({k:out[k] for k in ['codeBalanced','phases']},indent=2))
