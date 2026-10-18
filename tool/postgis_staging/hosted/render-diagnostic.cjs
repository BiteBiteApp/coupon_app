'use strict';
// Offline only. This job has no server, runtime-key mount, source job or caller SQL.
const fs = require('node:fs');
function render(configuration, jobId) {
  const {nativePostgisDiagnosticIdentity} = require('../../../functions/lib/postgis_native_diagnostic.js');
  nativePostgisDiagnosticIdentity(configuration, jobId);
  const h = configuration.hosted, p = configuration.projectId, r = configuration.runId;
  if (jobId.length > 49 || h.network !== r || h.subnet !== r ||
      configuration.provider?.loadServiceAccount !== h.sql.serviceAccountEmail ||
      configuration.provider?.loadImageDigest !== h.imageDigest ||
      !new RegExp('^us-central1-docker\\.pkg\\.dev/' + p + '/[a-z0-9/_-]+@sha256:[a-f0-9]{64}$').test(h.imageDigest || '')) {
    throw Error('Exact isolated diagnostic image and private route required.');
  }
  const refs = ['config', 'approval', 'trust'].map(kind => {
    const ref = h[kind + 'Secret'];
    if (!ref || Object.keys(ref).sort().join(',') !== 'name,version' || ref.name !== r + '-' + kind ||
        !Number.isSafeInteger(ref.version) || ref.version < 1) throw Error('Exact versioned diagnostic inputs required.');
    return {kind, ref};
  });
  const labels = {'bs-run': r, 'bs-candidate-a': configuration.candidateDigest.slice(0, 32),
    'bs-candidate-b': configuration.candidateDigest.slice(32)};
  return {name: `projects/${p}/locations/us-central1/jobs/${jobId}`, labels,
    template: {taskCount: 1, parallelism: 1, labels, template: {
      serviceAccount: h.sql.serviceAccountEmail, maxRetries: 0, timeout: '600s',
      vpcAccess: {egress: 'PRIVATE_RANGES_ONLY', networkInterfaces: [{
        network: `projects/${p}/global/networks/${r}`, subnetwork: `projects/${p}/regions/us-central1/subnetworks/${r}`} ]},
      containers: [{image: h.imageDigest, command: ['node'], args: [
        'functions/lib/postgis_native_diagnostic.js', '--execute', '/config/value.json',
        '/approval/value.json', '/trust/value.json', jobId], resources: {limits: {cpu: '1', memory: '1Gi'}},
      volumeMounts: refs.map(({kind}) => ({name: kind, mountPath: '/' + kind}))}],
      volumes: refs.map(({kind, ref}) => ({name: kind, secret: {secret: `projects/${p}/secrets/${ref.name}`,
        items: [{version: String(ref.version), path: 'value.json', mode: 292}]}}))}}};
}
if (require.main === module) {
  try {
    if (process.argv.length !== 4) throw Error();
    const raw = fs.readFileSync(process.argv[2], 'utf8');
    if (Buffer.byteLength(raw) > 256 * 1024) throw Error();
    process.stdout.write(JSON.stringify(render(JSON.parse(raw), process.argv[3]), null, 2) + '\n');
  } catch {process.stderr.write('Native diagnostic descriptor refused.\n'); process.exitCode = 1;}
}
module.exports = {render};
