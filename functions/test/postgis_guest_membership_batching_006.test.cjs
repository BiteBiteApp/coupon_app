'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
// Reuse the native handler fixtures without registering their complete suite.
const fixturePath = path.join(__dirname, 'customer_bitesaver_search_handlers.test.js');
const fixture = new Module(fixturePath, module);
fixture.filename = fixturePath;
fixture.paths = Module._nodeModulePaths(__dirname);
const actualRequire = Module.createRequire(fixturePath);
fixture.require = id => id === 'node:test' ? () => undefined : actualRequire(id);
fixture._compile(fs.readFileSync(fixturePath, 'utf8') + '\nmodule.exports.batching = {restaurantWindowFixture,finishRestaurantWindow,opaqueOfferId,guestAnswerRequest};', fixturePath);
const F = fixture.exports.batching;
const C = require('../lib/customer_bitesaver_search_contract.js');

function observe(f) {
  const calls = [];
  const query = f.database.queryDocuments.bind(f.database);
  f.database.queryDocuments = async input => {
    const rows = await query(input);
    if (input.collectionPath === C.privateCustomerBiteSaverResultCollection) calls.push({input, rows});
    return rows;
  };
  return calls;
}

test('opt-in window requests one bounded membership batch; serial stays one row', async () => {
  for (const enabled of [false, true]) {
    const f = await F.restaurantWindowFixture({enabled});
    const calls = observe(f);
    const first = await f.page();
    assert.equal(first.candidates.length, enabled ? 26 : 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].input.limit, enabled ? 26 : 1);
    const checkpoint = f.database.documents.get(`${C.privateCustomerBiteSaverGuestOfferCheckCollection}/${first.operationRef}`);
    assert.equal(checkpoint.progress.outerBoundary, null);
    const done = await F.finishRestaurantWindow(f, first);
    assert.deepEqual(done.response.result.restaurants.map(r => r.restaurantId), f.seeded.slice(0, 25).map(r => r.publicRestaurantId));
    assert.equal(done.response.result.hasMore, true);
    assert.equal(calls.length, enabled ? 1 : 26);
  }
});

test('whole prefetched batch rejected by current parent authority refills privately', async () => {
  const f = await F.restaurantWindowFixture({count: 60});
  for (const row of f.seeded.slice(0, 26)) f.database.documents.delete(`restaurant_accounts/${row.accountId}`);
  const calls = observe(f);
  const first = await f.page();
  assert.equal(first.candidates.length, 26);
  assert.equal(calls.length, 2);
  assert(calls.every(c => c.input.limit === 26));
  const done = await F.finishRestaurantWindow(f, first);
  assert.deepEqual(done.response.result.restaurants.map(r => r.restaurantId), f.seeded.slice(26, 51).map(r => r.publicRestaurantId));
  assert.equal(done.response.result.hasMore, true);
});

test('whole first history batch rejected refills with exact page cursor and order', async () => {
  const f = await F.restaurantWindowFixture({count: 60});
  const calls = observe(f);
  const excluded = f.seeded.slice(0, 26).map(r => F.opaqueOfferId(r, r.coupons[0]));
  const done = await F.finishRestaurantWindow(f, await f.page(), excluded);
  assert.deepEqual(done.response.result.restaurants.map(r => r.restaurantId), f.seeded.slice(26, 51).map(r => r.publicRestaurantId));
  assert.equal(calls.length, 2);
  const nextRequest = {...f.request, clientRequestId: 'batching-next-page-0001', cursor: done.response.result.nextCursor};
  let nextAnswer = 0;
  const nextFixture = {...f, request: nextRequest, page: (r = nextRequest) => f.page(r),
    answer: input => f.answer({...input, clientRequestId: `batching-next-answer-${++nextAnswer}`})};
  const next = await F.finishRestaurantWindow(nextFixture, await f.page(nextRequest), excluded);
  assert.deepEqual(next.response.result.restaurants.map(r => r.restaurantId), f.seeded.slice(51).map(r => r.publicRestaurantId));
  assert.equal(next.response.result.hasMore, false);
  assert.equal(next.response.result.nextCursor, null);
  assert(calls.every(c => c.input.limit >= 1 && c.input.limit <= 26));
  assert.equal(calls.at(-1).input.limit, 17, 'final exhaustion check needs only the missing slots');
});

test('75-ID global cap discards unused private tail and later resumes without loss', async () => {
  const f = await F.restaurantWindowFixture({count: 26, offers: 3});
  const calls = observe(f);
  const first = await f.page();
  assert.equal(first.candidates.length, 75);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].rows.length, 26);
  const checkpoint = f.database.documents.get(`${C.privateCustomerBiteSaverGuestOfferCheckCollection}/${first.operationRef}`);
  assert.equal(checkpoint.progress.pendingRestaurants.length, 24);
  assert.equal(checkpoint.progress.outerBoundary, null);
  const done = await F.finishRestaurantWindow(f, first);
  assert.equal(done.response.result.restaurants.length, 25);
  assert.equal(done.response.result.hasMore, true);
  assert.equal(new Set(done.history.checkedBatches.flat()).size, 78);
  assert(calls.length >= 2, 'discarded membership must be retrieved again on continuation');
});

test('unused prefetched authority is rechecked and all-filtered exhaustion is truthful', async () => {
  const f = await F.restaurantWindowFixture({count: 26, offers: 3});
  const first = await f.page();
  f.database.documents.delete(`restaurant_accounts/${f.seeded[25].accountId}`);
  const done = await F.finishRestaurantWindow(f, first);
  assert.equal(done.response.result.restaurants.length, 25);
  assert.equal(done.response.result.hasMore, false);
  const empty = await F.restaurantWindowFixture({count: 52});
  const calls = observe(empty);
  for (const row of empty.seeded) empty.database.documents.delete(`restaurant_accounts/${row.accountId}`);
  const response = await empty.page();
  assert.equal(response.outcome, 'complete');
  assert.equal(response.result.restaurants.length, 0);
  assert.equal(response.result.hasMore, false);
  assert.equal(calls.length, 3, 'full final batch needs an actual exhaustion read');
});

test('accepted-answer interruption retains replay and no cross-account cached membership', async () => {
  const f = await F.restaurantWindowFixture();
  const first = await f.page();
  const answer = F.guestAnswerRequest(f.started, first, []);
  const original = f.database.runTransaction.bind(f.database);
  let interrupted = false;
  f.database.runTransaction = async operation => {
    const result = await original(operation);
    if (!interrupted && result?.document?.state === 'answerAccepted') {
      interrupted = true; throw new Error('test accepted-answer interruption');
    }
    return result;
  };
  await assert.rejects(f.answer(answer), /test accepted-answer interruption/);
  f.database.runTransaction = original;
  assert(interrupted);
  await assert.rejects(f.api.continueCustomerBiteSaverGuestOfferCheckV2(answer,
    {...f.context, identity: {authUid: 'other-account', authIsAnonymous: false}}));
  const complete = await f.answer(answer);
  assert.equal(complete.result.restaurants.length, 25);
  assert.deepEqual(await f.answer(answer), complete);
});

test('stored ready restaurants cap subsequent membership to missing useful slots plus lookahead', async () => {
  for (const rejected of [1, 2]) {
    const f = await F.restaurantWindowFixture({count: 40});
    const calls = observe(f);
    const excluded = f.seeded.slice(0, rejected).map(r => F.opaqueOfferId(r, r.coupons[0]));
    const done = await F.finishRestaurantWindow(f, await f.page(), excluded);
    assert.deepEqual(calls.map(call => call.input.limit), [26, rejected]);
    assert.deepEqual(calls.map(call => call.rows.length), [26, rejected]);
    assert.deepEqual(done.response.result.restaurants.map(r => r.restaurantId), f.seeded.slice(rejected, rejected + 25).map(r => r.publicRestaurantId));
    assert.equal(done.response.result.hasMore, true);
  }
});

test('one remaining slot refills after whole bounded history or authority rejection batches', async () => {
  for (const reason of ['history', 'authority']) {
    const f = await F.restaurantWindowFixture({count: 56});
    const calls = observe(f);
    const excludedRows = reason === 'history' ? [f.seeded[0], ...f.seeded.slice(26, 52)] : [f.seeded[0]];
    if (reason === 'authority') for (const row of f.seeded.slice(26, 52)) f.database.documents.delete(`restaurant_accounts/${row.accountId}`);
    const done = await F.finishRestaurantWindow(f, await f.page(), excludedRows.map(r => F.opaqueOfferId(r, r.coupons[0])));
    assert.equal(calls[0].input.limit, 26);
    assert(calls.slice(1).length >= 27);
    assert(calls.slice(1).every(call => call.input.limit === 1));
    assert.deepEqual(done.response.result.restaurants.map(r => r.restaurantId), f.seeded.slice(1, 26).map(r => r.publicRestaurantId));
    assert.equal(done.response.result.hasMore, true, 'a rejected full one-row fetch must not claim exhaustion');
    assert(done.history.checkedBatches.every(batch => batch.length <= 75));
  }
});
