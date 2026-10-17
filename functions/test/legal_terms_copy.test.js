'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {createHash} = require('node:crypto');
const {resolve} = require('node:path');
const {approvedBiteScoreTerms} = require('../lib/bitescore_terms.js');
const root = resolve(__dirname, '../..');

test('future approved acceptance text must match the approved visible legal artifact', () => {
  const manifest = JSON.parse(readFileSync(resolve(root, 'legal/review-manifest.json'), 'utf8'));
  const entry = manifest.documents['terms-of-service'];
  const visible = readFileSync(resolve(root, entry.textFile), 'utf8');
  assert.equal(createHash('sha256').update(visible).digest('hex'), entry.textSha256);
  if (!manifest.ownerApproved) {
    assert.equal(approvedBiteScoreTerms, null, 'Unapproved text cannot be installed in the acceptance policy.');
  }
  if (approvedBiteScoreTerms === null) {
    return; // Finalizing legal copy does not require activating acceptance.
  }
  assert.equal(manifest.ownerApproved, true, 'Legal text needs explicit owner approval.');
  assert.equal(approvedBiteScoreTerms.version, manifest.approvedTermsVersion);
  assert.equal(approvedBiteScoreTerms.text, visible, 'Accepted Terms must not drift from the displayed document.');
});
