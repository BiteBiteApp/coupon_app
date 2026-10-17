'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {fixture, responses, getCustomerBiteSaverSearchPageHandler} = require('./helpers/web_release_media_fixture');
test('actual deployed-baseline media responses match the fixture consumed by Flutter', async () => {
  const expected = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../test/fixtures/web_release_specials_media.json'), 'utf8'));
  assert.deepEqual(JSON.parse(JSON.stringify(await responses())), expected);
  assert.equal(expected.manual.mode, 'manual');
  assert.equal(expected.manual.board, null);
  assert.equal(expected.photo.mode, 'photo');
  assert.equal(expected.photo.board.imageUrl, 'https://example.test/published-board.png');
  assert.equal(JSON.stringify(expected).includes('unapproved-image'), false);
});
test('media-only version change during read fails closed without altering existing search fingerprints', async () => {
  const f = fixture();
  const get = f.database.getDocument.bind(f.database);
  let reads = 0;
  f.database.getDocument = async path => {
    const value = await get(path);
    if (path === 'restaurant_accounts/release-owner' && ++reads === 2)
      return {...value, data: {...value.data, ownerMedia: {...value.data.ownerMedia, version: 2}}};
    return value;
  };
  await assert.rejects(getCustomerBiteSaverSearchPageHandler(f.request, f.context), {code: 'failed-precondition'});
  assert.deepEqual(f.database.writes, []);
});
