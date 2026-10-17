'use strict';
const path = require('node:path');
const {MemoryDatabase} = require('./customer_bitesaver_memory_database');
const root = process.env.BITESTAR_RELEASE_FUNCTIONS_ROOT || path.resolve(__dirname, '../..');
const {getCustomerBiteSaverSearchPageHandler} = require(path.join(root, 'lib/customer_bitesaver_search_session'));
const {buildBiteSaverRestaurantIndex} = require(path.join(root, 'lib/search_index_builders'));
const key = Buffer.alloc(32, 59);
const now = new Date('2026-10-17T16:00:00Z');
function fixture(mode = 'manual') {
  const database = new MemoryDatabase();
  const imageId = 'a'.repeat(32);
  const account = {
    restaurantName: 'Release Cafe', approvalStatus: 'approved',
    couponApplicationSubmitted: true, subscriptionStatus: 'active', couponPostingEnabled: true,
    streetAddress: '1 Main St', city: 'Hartford', state: 'CT', zipCode: '06103',
    latitude: 41.7658, longitude: -72.6734, businessHours: [],
    ownerMedia: {version: 1, images: [{id: imageId,
      path: 'bitesaver_restaurants/release-owner/restaurant_images/a.png', generation: '100',
      registrationVersion: 1, url: 'https://example.test/published-board.png', state: 'ready'}],
      gallery: [imageId], legacyMain: null, mode, boardImage: mode === 'photo' ? imageId : null, specialImages: {}},
  };
  const projection = buildBiteSaverRestaurantIndex({sourceDocumentId: 'release-owner', source: account, now, identityKeyV1: key});
  database.set('restaurant_accounts/release-owner', account);
  database.set(`restaurant_search_index/${projection.indexDocumentId}`, projection);
  database.set('restaurant_accounts/release-owner/daily_specials/bitesaver_managed_board', {
    title: 'Daily Specials board', restaurantId: 'release-owner', ownerUid: 'release-owner',
    isActive: true, availabilityMode: 'specificDays', daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    allDay: true, hideWhenUnavailable: true, createdAt: now,
    imageUrl: 'https://example.test/unapproved-image.png',
  });
  const request = {schemaVersion: 1, kind: 'restaurantMedia', restaurantId: projection.publicRestaurantId};
  const context = {database, identityKeyV1: key, discoveryKey: Buffer.alloc(32, 41),
    identity: {authUid: null, authIsAnonymous: false}, now: () => now.getTime()};
  return {account, database, projection, request, context};
}
async function responses() {
  const manual = fixture('manual'), photo = fixture('photo');
  return {request: manual.request,
    manual: await getCustomerBiteSaverSearchPageHandler(manual.request, manual.context),
    photo: await getCustomerBiteSaverSearchPageHandler(photo.request, photo.context)};
}
module.exports = {fixture, responses, getCustomerBiteSaverSearchPageHandler};
