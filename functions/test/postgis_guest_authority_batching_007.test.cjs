'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const fixturePath = path.join(__dirname, 'customer_bitesaver_search_handlers.test.js');
const fixture = new Module(fixturePath, module);
fixture.filename = fixturePath;
fixture.paths = Module._nodeModulePaths(__dirname);
const actualRequire = Module.createRequire(fixturePath);
fixture.require = id => id === 'node:test' ? () => undefined : actualRequire(id);
fixture._compile(fs.readFileSync(fixturePath, 'utf8') + '\nmodule.exports.authority = {restaurantWindowFixture,finishRestaurantWindow,guestAnswerRequest};', fixturePath);
const F = fixture.exports.authority;

function transactions(f) {
  const calls = [];
  const original = f.database.runTransaction.bind(f.database);
  f.database.runTransaction = operation => original(tx => {
    const reads = []; calls.push(reads);
    const get = tx.getDocuments.bind(tx);
    tx.getDocuments = paths => { reads.push([...paths]); return get(paths); };
    return operation(tx);
  });
  return calls;
}
function windows(calls) {
  return calls.filter(reads => reads.some(paths => paths.length > 1 &&
    paths.every(p => /^restaurant_accounts\/[^/]+$/u.test(p))));
}

test('existing window checks all parents and offers in one bounded coherent transaction', async () => {
  for (const offers of [1, 3]) {
    const f = await F.restaurantWindowFixture({offers, count: 26});
    const calls = transactions(f);
    const first = await f.page();
    assert.equal(first.candidates.length, offers === 1 ? 26 : 75);
    const initial = windows(calls);
    assert.equal(initial.length, 1);
    assert.deepEqual(initial[0].map(paths => paths.length), offers === 1 ? [26, 26] : [25, 75]);
    assert(calls.flat().every(paths => paths.length <= 100));
    const done = await F.finishRestaurantWindow(f, first);
    assert.equal(done.response.result.restaurants.length, 25);
    assert.equal(done.response.result.hasMore, true);
    assert(done.history.checkedBatches.every(batch => batch.length <= 75));
    assert(windows(calls).length >= 3, 'answer and final delivery obtain separate current snapshots');
  }
});

test('last-parent or raw-offer withdrawal before window snapshot cannot escape the batched check', async () => {
  for (const kind of ['parent', 'offer']) {
    const f = await F.restaurantWindowFixture();
    const first = await f.page();
    const last = f.seeded[25];
    const original = f.database.runTransaction.bind(f.database);
    let changed = false;
    f.database.runTransaction = operation => original(tx => {
      const get = tx.getDocuments.bind(tx);
      tx.getDocuments = paths => {
        if (!changed && paths.length === 26 && paths.every(p => /^restaurant_accounts\/[^/]+$/u.test(p))) {
          changed = true;
          if (kind === 'parent') f.database.documents.delete(`restaurant_accounts/${last.accountId}`);
          else {
            const prefix = `restaurant_accounts/${last.accountId}/coupons/`;
            for (const key of f.database.documents.keys()) if (key.startsWith(prefix)) f.database.documents.delete(key);
          }
        }
        return get(paths);
      };
      return operation(tx);
    });
    const response = await f.answer(F.guestAnswerRequest(f.started, first, []));
    assert(changed);
    assert.equal(response.outcome, 'retryRequired');
    assert.equal(response.reason, 'sourceChanged');
    assert.equal(response.result, undefined);
  }
});
