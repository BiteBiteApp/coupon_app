'use strict';
const fs=require('node:fs');
function render(configuration,jobId){
 const service=require('./render-service.cjs').render(configuration),provider=configuration.provider,job=configuration.hosted.jobs?.find(j=>j.id===jobId);
 if(!job||!/^[a-z][a-z0-9-]{1,61}[a-z0-9]$/.test(jobId)||provider?.loadServiceAccount!==configuration.hosted.sql.serviceAccountEmail||
 !new RegExp('^us-central1-docker\\.pkg\\.dev/'+configuration.projectId+'/[a-z0-9/_-]+@sha256:[a-f0-9]{64}$').test(provider.loadImageDigest||''))throw Error('Exact approved job identity required');
 const container={...service.template.containers[0],image:provider.loadImageDigest,args:['functions/lib/postgis_hosted_job_entrypoint.js','--execute','/config/value.json','/approval/value.json','/trust/value.json','/keys/value.json',jobId]};delete container.ports;
 return{name:`projects/${configuration.projectId}/locations/us-central1/jobs/${jobId}`,labels:service.labels,
 template:{taskCount:1,parallelism:1,labels:service.labels,template:{serviceAccount:provider.loadServiceAccount,maxRetries:0,timeout:'600s',vpcAccess:service.template.vpcAccess,containers:[container],volumes:service.template.volumes}}};
}
if(require.main===module){try{if(process.argv.length!==4)throw Error();const raw=fs.readFileSync(process.argv[2],'utf8');if(Buffer.byteLength(raw)>256*1024)throw Error();process.stdout.write(JSON.stringify(render(JSON.parse(raw),process.argv[3]),null,2)+'\n');}catch{process.stderr.write('Hosted job descriptor refused.\n');process.exitCode=1;}}
module.exports={render};
