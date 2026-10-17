#!/usr/bin/env python3
"""Fail-closed staging checks. This command has no cloud execution adapter."""
import argparse,copy,hashlib,json,math,re,time
from pathlib import Path
class Rejected(ValueError): pass
def need(condition,reason):
    if not condition: raise Rejected(reason)
def digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def number(value):return isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value) and value>=0

def project_check(config):
    p=config.get('projectId')
    need(isinstance(p,str) and re.fullmatch(r'[a-z][a-z0-9-]{4,28}[a-z0-9]',p),'missing/invalid exact staging project')
    need(p!='coupon-app-29446','production rejected')
    need(config.get('allowedProjectIds')==[p],'project not exact singleton allowlist')
    need(config.get('syntheticOnly') is True,'synthetic-only required')
    return p

def envelope(config,approval,now):
    p=project_check(config)
    need(number(now),'invalid current time')
    need(number(config.get('lifetimeSeconds')) and 0 < config['lifetimeSeconds'] <= 259200,'lifetime exceeds 72h')
    need(number(config.get('activeLoadSeconds')) and 0 < config['activeLoadSeconds'] <= 21600,'active load exceeds six hours')
    need(number(config.get('earlyApprovalCheckpointUsd')) and config['earlyApprovalCheckpointUsd']==100,'early owner checkpoint must remain $100')
    need(config.get('alertRecipients') and all(isinstance(r,str) and r.strip() for r in config['alertRecipients']),'alert recipients required')
    app=config['application']
    need(app['poolPerInstance']*app['maxInstances']+app['reservedConnections']<=24,'connection budget exceeds 24')
    need(app['minInstances']==0 and app['maxInstances']<=4,'instance budget exceeded')
    need(approval.get('approved') is True and bool(approval.get('ownerApprovalReference')),'missing owner approval')
    need(approval.get('projectId')==p and approval.get('runId')==config['runId'],'approval identity mismatch')
    need(approval.get('configDigest')==digest(config),'config changed after approval')
    need(approval.get('candidateDigest')==config.get('candidateDigest') and bool(config.get('candidateDigest')),'changed/missing candidate hash')
    need(number(approval.get('validUntil')) and now<approval['validUntil'],'expired approval')
    need(config.get('gate0Ready') is True,'local implementation prerequisites remain')
    return p

def launch(config,approval,state,now):
    envelope(config,approval,now)
    need(state is None,'duplicate launch; reconcile existing run')
    verified = config.get('guardianTested') is True and config.get('alertTested') is True
    bootstrap = not verified
    if bootstrap:
        need(approval.get('supervisedControlBootstrap') is True and 1 in approval.get('approvedGates',[]),'alert/shutdown receipts missing')
        need(number(config.get('bootstrapAllowanceUsd')) and 0 < config['bootstrapAllowanceUsd'] <= 5,'bootstrap allowance missing/too large')
        need(config.get('bootstrapMaximumSeconds')==900,'bootstrap must be bounded to 15min')
    # Reserve first possible billable instant BEFORE provisioning. Retries can never reset it.
    return {'runId':config['runId'],'projectId':config['projectId'],'configDigest':digest(config),'candidateDigest':config['candidateDigest'],'firstBillableAt':now,'deadline':now+config['lifetimeSeconds'],'status':'supervised-bootstrap' if bootstrap else 'provisioning','controlsVerified':verified,'bootstrapDeadline':now+900 if bootstrap else None,'completedGates':[0],'phaseUsed':{'1':config['bootstrapAllowanceUsd']} if bootstrap else {},'counts':{k:0 for k in config['caps']},'activeSeconds':0,'costUpper':config['bootstrapAllowanceUsd'] if bootstrap else 0,'heartbeatAt':now,'reservationIds':[]}

def confirm_controls(config,approval,state,receipt,now):
    envelope(config,approval,now)
    need(state['status']=='supervised-bootstrap','not a supervised bootstrap')
    need(now<state['bootstrapDeadline'] and now<state['deadline'],'bootstrap expired; reconcile/stop')
    for k in ('runId','projectId','configDigest','firstBillableAt','deadline'):
        need(receipt.get(k)==state[k],'control receipt mismatch '+k)
    need(receipt.get('alertDelivered') is True and receipt.get('shutdownObserved') is True and bool(receipt.get('evidenceDigest')),'actual control proof missing')
    out=copy.deepcopy(state);out['controlsVerified']=True;out['controlEvidenceDigest']=receipt['evidenceDigest'];out['status']='running';out['heartbeatAt']=now
    return out

def permit(config,approval,state,request,now):
    envelope(config,approval,now)
    need(state['configDigest']==digest(config) and state['candidateDigest']==config['candidateDigest'],'state artifact mismatch')
    need(state['projectId']==config['projectId'] and state['runId']==config['runId'],'state identity mismatch')
    need(state['deadline']==state['firstBillableAt']+config['lifetimeSeconds'],'deadline reset/tamper')
    need(now<state['deadline'],'expired run')
    need(state.get('controlsVerified') is True,'managed alert/shutdown proofs missing')
    need(state['status']=='running','interrupted/paused run needs reconciliation')
    need(number(state.get('heartbeatAt')) and 0<=now-state['heartbeatAt']<=config['heartbeatMaxAgeSeconds'],'stale/future accounting heartbeat')
    gate=request['gate'];need(gate in (1,2,3,4),'invalid workload gate')
    need(gate in approval.get('approvedGates',[]),'gate not explicitly approved')
    need(all(g in state['completedGates'] for g in range(gate)),'earlier gate not passed')
    need(request['reservationId'] not in state['reservationIds'],'duplicate reservation')
    need(set(request['counts'])==set(config['caps']),'all billable/count dimensions required')
    for k,limit in config['caps'].items():
        v=request['counts'][k];need(number(v) and int(v)==v,'invalid count')
        need(state['counts'][k]+v<=limit,'exhausted global '+k)
    for k in ('activeSeconds','costUpper','remainingHoldUpper','delayedChargeUpper'):
        need(number(request.get(k)),'missing/nonfinite forecast '+k)
    need(state['activeSeconds']+request['activeSeconds']<=config['activeLoadSeconds'],'active load exhausted')
    used=state['phaseUsed'].get(str(gate),0)
    need(used+request['costUpper']<=config['phaseAllowancesUsd'][str(gate)],'exhausted phase allowance')
    forecast=state['costUpper']+request['costUpper']+request['remainingHoldUpper']+request['delayedChargeUpper']+config['cleanupReserveUsd']
    need(forecast<=config['approvedForecastUsd'],'OWNER APPROVAL REQUIRED — ACTIVE LOAD PAUSED')
    # Delayed charges, reserved holding time and safe cleanup are already liabilities.
    # Use the same conservative forecast at both owner approval boundaries.
    if forecast>=config['earlyApprovalCheckpointUsd']:
        receipt=state.get('earlyApprovalReceipt',{})
        need(receipt.get('runId')==state['runId'] and receipt.get('configDigest')==state['configDigest'] and
             receipt.get('candidateDigest')==state['candidateDigest'] and
             receipt.get('firstBillableAt')==state['firstBillableAt'] and
             receipt.get('deadline')==state['deadline'] and
             bool(receipt.get('ownerApprovalReference')) and
             receipt.get('approvedBeyondUsd')==100,
             'OWNER APPROVAL REQUIRED — $100 checkpoint reached')
    need(len(state['reservationIds'])<config['maxOutstandingReservations'],'unreconciled reservation bound reached')
    out=copy.deepcopy(state)
    for k,v in request['counts'].items():out['counts'][k]+=v
    out['activeSeconds']+=request['activeSeconds'];out['costUpper']+=request['costUpper']
    out['phaseUsed'][str(gate)]=used+request['costUpper'];out['reservationIds'].append(request['reservationId'])
    # Reservations survive crash; no refund without reconciled provider evidence.
    return out

def owned_resource(config,approved_resource,observed):
    p=project_check(config)
    need(approved_resource in config['resources'],'resource absent from exact manifest')
    need(approved_resource.get('disposable') is True,'not disposable')
    for k in ('kind','id','uid'):
        need(isinstance(approved_resource.get(k),str) and bool(approved_resource[k]),'missing ownership '+k)
        need(observed.get(k)==approved_resource[k],'ownership mismatch '+k)
    need(observed.get('projectId')==p,'teardown project mismatch')
    need(observed.get('runId')==config['runId'],'teardown run mismatch')
    need(observed.get('createTime')==approved_resource.get('createTime') and number(observed.get('createTime')),'creation receipt mismatch')
    return {'action':'delete','projectId':p,'kind':observed['kind'],'id':observed['id'],'uid':observed['uid']}

def checkpoint(manifest,receipt):
    need(manifest.get('syntheticOnly') is True,'not synthetic')
    for k in ('candidateDigest','datasetDigest','projectId','databaseId','partition','fence'):
        need(k in manifest and manifest[k] is not None and manifest[k]==receipt.get(k),'checkpoint mismatch '+k)
    need(receipt.get('verified') is True and receipt.get('gapCount')==0,'unverified/gapped checkpoint')
    need(isinstance(receipt.get('lastSequence'),int) and receipt['lastSequence']>=0,'sequence absent')
    return receipt['lastSequence']

def watchdog(config,state,now):
    project_check(config)
    need(state['projectId']==config['projectId'] and state['runId']==config['runId'],'watchdog identity mismatch')
    # Independent deadline ignores application approval expiry and candidate drift: safety cleanup must remain possible.
    need(state['deadline']==state['firstBillableAt']+config['lifetimeSeconds'],'deadline tamper')
    if now>=state['deadline']-config['teardownLeadSeconds']:return 'stop-load-export-and-teardown'
    if not number(state.get('heartbeatAt')) or not 0<=now-state['heartbeatAt']<=config['heartbeatMaxAgeSeconds'] or state['status']!='running':return 'pause-load-stop-sql-and-alert'
    return 'observe'

def verify_artifacts(root,manifest=None):
    manifest=root/'candidate-manifest.json' if manifest is None else manifest
    if not manifest.is_file():
        return {'candidateVerified':False,'cloudReady':False,'executionBlocker':'final candidate manifest not frozen'}
    from freeze import verify
    result=verify(root.parents[1],manifest)
    return {'candidateVerified':True,'candidateDigest':result['candidateDigest'],'cloudReady':False,
            'executionBlocker':'separate hosted authorization, exact targets, runtime and control proofs required'}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--mode',choices=['dry-run','execute'],default='dry-run');p.add_argument('--config',type=Path,default=Path(__file__).resolve().parents[1]/'config/staging.json')
    p.add_argument('--manifest',type=Path,help='Exact frozen manifest to verify; defaults to candidate-manifest.json without selecting a newer version.')
    a=p.parse_args()
    root=Path(__file__).resolve().parents[1];result=verify_artifacts(root,a.manifest)
    if a.mode=='execute':raise Rejected('NO CLOUD EXECUTOR IN THIS PACKAGE: local integration, exact identifiers and later execution approval required')
    c=json.loads(a.config.read_text());result['mode']='dry-run'
    try:project_check(c);result['identifiersComplete']=True
    except Rejected as e:result['identifiersComplete']=False;result['executionBlocker']=str(e)
    print(json.dumps(result,indent=2))
if __name__=='__main__':
    try:main()
    except (Rejected,KeyError,TypeError,ValueError) as e:raise SystemExit(str(e))
