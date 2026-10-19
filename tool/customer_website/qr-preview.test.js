'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { browserDestination } = require('./qr-preview');
for (const side of ['coupons', 'bitescore']) {
  test(`${side} preserves the permanent ID, including literal percent sequences`, () => {
    const url = new URL(browserDestination(`/r/${side}/permanent%252Fidentity`));
    assert.equal(url.origin, 'https://bitestar.app');
    assert.equal(url.hash, `#/r/${side}/permanent%252Fidentity`);
    assert.equal(browserDestination(`/r/${side}/a`, 'http://localhost:8765'),
      `http://localhost:8765/#/r/${side}/a`);
  });
}
test('protected invites and malformed/extra customer paths have no shortcut', () => {
  for (const path of ['/invite/coupon/private-token', '/invite/bitescore/private-token',
    '/r/coupons/', '/r/coupons/a/b', '/r/coupons/%2F', '/r/coupons/%ZZ',
    '/r/coupons/%20a', '/r/coupons/%00', '/r/other/id']) {
    assert.equal(browserDestination(path), null);
  }
});
test('preview script is absent from production Hosting assets', () => {
  const fs = require('node:fs');
  for (const path of ['web/qr-fallback.html', 'web/qr-fallback.js', 'firebase.json']) {
    assert.doesNotMatch(fs.readFileSync(path, 'utf8'), /_customer-preview|qr-preview/);
  }
});
