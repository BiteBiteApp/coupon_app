'use strict';
// Offline descriptor renderer; never deploys or initializes any credential client.
const fs=require('node:fs');
function render(configuration){
 const {cloudSqlPostgisIdentity}=require('../../../functions/lib/postgis_cloudsql.js');
 cloudSqlPostgisIdentity(configuration);const h=configuration.hosted,p=configuration.projectId,r=configuration.runId;
 if(!/^bs-postgis-[a-z0-9-]+$/.test(r)||`${r}-search`.length>49||h.network!==r||h.subnet!==r||
 !/^[a-z0-9.-]+(?:\/[a-z0-9._-]+)+@sha256:[a-f0-9]{64}$/.test(h.imageDigest||''))throw Error('Complete immutable isolated deployment identity is required.');
 const refs=['config','approval','trust','keys'].map(kind=>{const ref=h[`${kind}Secret`];if(!ref||Object.keys(ref).sort().join(',')!=='name,version'||ref.name!==`${r}-${kind}`||!Number.isSafeInteger(ref.version)||ref.version<1)throw Error('Exact secret version references are required.');return{kind,ref};});
 return{name:`projects/${p}/locations/us-central1/services/${r}-search`,labels:{'bs-run':r,'bs-candidate-a':configuration.candidateDigest.slice(0,32),'bs-candidate-b':configuration.candidateDigest.slice(32)},annotations:{'bitestar.dev/candidate-digest':configuration.candidateDigest},ingress:'INGRESS_TRAFFIC_ALL',invokerIamDisabled:true,
 template:{serviceAccount:h.sql.serviceAccountEmail,scaling:{minInstanceCount:0,maxInstanceCount:4},maxInstanceRequestConcurrency:4,timeout:'30s',executionEnvironment:'EXECUTION_ENVIRONMENT_GEN2',
 vpcAccess:{egress:'PRIVATE_RANGES_ONLY',networkInterfaces:[{network:`projects/${p}/global/networks/${r}`,subnetwork:`projects/${p}/regions/us-central1/subnetworks/${r}`}]},
 containers:[{image:h.imageDigest,command:['node'],args:['functions/lib/postgis_hosted_entrypoint.js','--execute','/config/value.json','/approval/value.json','/trust/value.json','/keys/value.json'],ports:[{containerPort:8080}],resources:{limits:{cpu:'1',memory:'1Gi'}},volumeMounts:refs.map(({kind})=>({name:kind,mountPath:`/${kind}`}))}],
 volumes:refs.map(({kind,ref})=>({name:kind,secret:{secret:`projects/${p}/secrets/${ref.name}`,items:[{version:String(ref.version),path:'value.json',mode:292}]}}))}};
}
if(require.main===module){try{if(process.argv.length!==3)throw Error('Expected one config path');const value=fs.readFileSync(process.argv[2],'utf8');if(Buffer.byteLength(value)>256*1024)throw Error('Config too large');process.stdout.write(JSON.stringify(render(JSON.parse(value)),null,2)+'\n');}catch{process.stderr.write('Hosted service descriptor refused: incomplete or invalid isolated configuration.\n');process.exitCode=1;}}
module.exports={render};
