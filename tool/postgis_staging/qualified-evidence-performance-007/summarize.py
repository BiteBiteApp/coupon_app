from pathlib import Path
import json,statistics,collections
r=Path(__file__).parent

def median(v):return statistics.median(v) if v else None

def phase(c):
 fs={'sdk.getAll','sdk.query','sdk.transaction.get','sdk.transaction.getAll','sdk.transaction.commit','sdk.transaction.rollback','firestore.commitWrites'}
 events=[]
 for s in c['spans']:
  kind='fs' if s['kind'] in fs else 'sql' if s['kind'] in {'sql.allStatements','sql.acquire'} else None
  if kind:events.extend([(s['start'],kind,1),(s['end'],kind,-1)])
 active={'fs':0,'sql':0};prev=0;total=collections.Counter()
 for t,k,delta in sorted(events):
  label='both' if active['fs'] and active['sql'] else 'firestore' if active['fs'] else 'sql' if active['sql'] else 'outsideMeasuredIo'
  total[label]+=t-prev;active[k]+=delta;prev=t
 total['outsideMeasuredIo']+=c['milliseconds']-prev
 return dict(total)

def trace(name):
 p=r/(('trace-linux-original' if name=='trace-linux' and (r/'trace-linux-original-operations.jsonl').exists() else name)+'-operations.jsonl')
 if not p.exists():return None
 a=[json.loads(x) for x in p.read_text().splitlines()]
 return {'requests':len(a),'handlerMilliseconds':sum(x['milliseconds'] for x in a),'cpuMilliseconds':sum(sum(x['cpu'].values()) for x in a)/1000,'phases':{k:sum(phase(x).get(k,0) for x in a) for k in ['firestore','sql','both','outsideMeasuredIo']},'operations':{k:{'calls':sum(x['operations'].get(k,{}).get('calls',0) for x in a),'inclusiveMs':sum(x['operations'].get(k,{}).get('milliseconds',0) for x in a)} for k in sorted(set(k for x in a for k in x['operations']))},'sdkRequestedDocuments':sum(x['sdkRequestedDocuments'] for x in a),'authorityRequestedDocuments':sum(x['authorityRequestedDocuments'] for x in a),'transactionAttempts':sum(x['sdkTransactionAttempts'] for x in a),'gcMs':sum(g['duration'] for x in a for g in x['gc']),'endpointPhases':[{'endpoint':x['endpoint'],'ms':x['milliseconds'],'cpuMs':sum(x['cpu'].values())/1000,'phases':phase(x),'gcMs':sum(g['duration'] for g in x['gc']),'eventLoop':x['eventLoop'],'eventLoopDelay':x['eventLoopDelay']} for x in a]}
result={'trace-heavy':trace('trace-heavy'),'trace-linux':trace('trace-linux')}
p=r/'native-balanced-results.json'
if p.exists():
 attempts=json.loads(p.read_text());out={}
 for mode in ['empty','moderate','heavy']:
  by={};oracle=None
  for variant in ['baseline','candidate']:
   a=[json.loads((r/x['evidence']).read_text()) for x in attempts if x['scenario']==mode and x['variant']==variant]
   for x in a:
    if oracle is None:oracle=x['historyAfter']['pages']
    assert x['historyAfter']['pages']==oracle
   by[variant]={'attempts':len(a),'firstMedianMs':median([x['historyAfter']['pageTimings'][0]['milliseconds'] for x in a]),'laterMedianMs':median([x['historyAfter']['pageTimings'][1]['milliseconds'] for x in a]),'traces':[{'pages':x['historyAfter']['pageTimings'],'challenges':len(x['historyAfter']['challengeSizes']),'candidates':sum(x['historyAfter']['challengeSizes']),'suppressed':sum(x['historyAfter']['suppressedAnswers']),'unavailable':len(x['historyAfter']['transientAttempts'])} for x in a]}
  out[mode]=by
 result['nativeBalanced']=out
(r/'measurement-summary.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result.get('nativeBalanced'),indent=2)[:1000])
