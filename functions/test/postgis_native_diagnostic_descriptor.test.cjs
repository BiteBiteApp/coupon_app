'use strict';
const {test} = require('node:test'), assert = require('node:assert/strict');
const cp = require('node:child_process'), path = require('node:path');
const {render} = require('../../tool/postgis_staging/hosted/render-diagnostic.cjs');
function configuration() {
 const projectId = 'bitestar-isolated-test', runId = 'bs-postgis-test';
 const image = `us-central1-docker.pkg.dev/${projectId}/search/image@sha256:` + 'a'.repeat(64);
 const c = {syntheticOnly: true, projectId, projectNumber: '123456789', runId, candidateDigest: 'a'.repeat(64),
  gate: 1, allowedProjectIds: [projectId], region: 'us-central1', hosted: {
   sql: {instanceConnectionName: `${projectId}:us-central1:${runId}-db`, database: 'bs_postgis_diagnostic',
    restoreDatabase: 'bs_postgis_restore', schema: 'public', serviceAccountEmail: `${runId}-diag@${projectId}.iam.gserviceaccount.com`},
   nativeDiagnostic: {id: runId + '-native', action: 'numerical-only', protocolVersion: 'bitestar.postgis-native-diagnostic.v1'},
   network: runId, subnet: runId, imageDigest: image}};
 for (const kind of ['config', 'approval', 'trust']) c.hosted[kind + 'Secret'] = {name: runId + '-' + kind, version: 1};
 c.provider = {loadImageDigest: image, loadServiceAccount: c.hosted.sql.serviceAccountEmail, resources: []};
 return c;
}
test('diagnostic descriptor has only three signed inputs, no server or runtime keys, fixed bounded command', () => {
 const c = configuration(), d = render(c, c.runId + '-native'), task = d.template.template;
 assert.equal(d.template.taskCount, 1); assert.equal(d.template.parallelism, 1);
 assert.equal(task.maxRetries, 0); assert.equal(task.timeout, '600s');
 assert.equal(task.vpcAccess.egress, 'PRIVATE_RANGES_ONLY');
 assert.deepEqual(task.volumes.map(v => v.name), ['config', 'approval', 'trust']);
 assert.equal(task.containers.length, 1); assert.equal(task.containers[0].ports, undefined);
 assert.deepEqual(task.containers[0].args, ['functions/lib/postgis_native_diagnostic.js', '--execute',
  '/config/value.json', '/approval/value.json', '/trust/value.json', c.runId + '-native']);
 assert.deepEqual(task.containers[0].resources.limits, {cpu: '1', memory: '1Gi'});
});
test('diagnostic descriptor refuses substituted targets, mutable images, missing or moving input versions', () => {
 for (const edit of [c => {c.gate = 2;}, c => {c.hosted.network = 'other';},
  c => {c.hosted.sql.database = 'bs_postgis_search';}, c => {c.hosted.nativeDiagnostic.action = 'serve';},
  c => {c.hosted.nativeDiagnostic.sql = 'SELECT 1';}, c => {c.hosted.imageDigest = 'image:latest';},
  c => {c.hosted.trustSecret.version = 'latest';}, c => {delete c.hosted.approvalSecret;},
  c => {c.provider.loadServiceAccount = 'other';}]) {
  const c = configuration(); edit(c); assert.throws(() => render(c, c.runId + '-native'));
 }
 const c = configuration(); assert.throws(() => render(c, c.runId + '-search'));
});
test('fixed diagnostic descriptor satisfies the existing provider exact-body contract without provider requests', () => {
 const c = configuration(); c.provider.resources = [{kind: 'run.job', id: c.runId + '-native', disposable: true, body: render(c, c.runId + '-native')}];
 const script = "import sys,json;sys.path.insert(0,sys.argv[1]);from cloud_provider import GoogleResources;c=json.load(sys.stdin);calls=[]\nclass T:\n def request(self,*args):calls.append(args);return {}\np=GoogleResources(c,T());p.create(c['provider']['resources'][0]);assert len(calls)==1;print('PASS')";
 const r = cp.spawnSync('python3', ['-c', script, path.resolve(__dirname, '../../tool/postgis_staging/scripts')],
  {input: JSON.stringify(c), encoding: 'utf8', timeout: 5000});
 assert.equal(r.status, 0, r.stderr || String(r.error)); assert.equal(r.stdout.trim(), 'PASS');
});
