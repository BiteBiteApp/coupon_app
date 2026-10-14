'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, updateDoc } = require('firebase/firestore');
const { ref, uploadBytes, deleteObject } = require('firebase/storage');
const functionRequire = require('node:module').createRequire(path.resolve(__dirname, '../../functions/package.json'));
const { initializeApp, deleteApp } = functionRequire('firebase-admin/app');
const { getFirestore } = functionRequire('firebase-admin/firestore');
const { createOwnerMediaDependencies } = require('../../functions/lib/bitesaver_owner_media_runtime.js');
const { saveOwnerMedia, removeOwnerImage } = require('../../functions/lib/bitesaver_owner_media.js');
const projectId = 'demo-coupon-app-rules', id = 'a'.repeat(32), other = 'b'.repeat(32), generation = '9007199254740993123';
let env, app, db, deps, deleteCalls, deleteHook;
const auth = uid => ({ uid, token: { firebase: { sign_in_provider: 'password' }, email_verified: true } });
const actor = uid => env.authenticatedContext(uid, { email_verified: true, firebase: { sign_in_provider: 'password' } });
const call = data => saveOwnerMedia({ auth: auth('owner'), data: { intent: 'ownerMediaUpdate', ...data } }, deps);
const register = (imageId = id, version = 0) => call({ action: 'register', imageId, extension: 'png', expectedVersion: version, requestId: `register_${imageId}_${version}` });
const remove = () => removeOwnerImage({ auth: auth('owner'), data: { imageId: id, registrationVersion: 1 } }, deps);
test.before(async () => {
    if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8792' || process.env.FIREBASE_STORAGE_EMULATOR_HOST !== '127.0.0.1:9298')
        throw Error('Exact isolated emulator hosts required');
    env = await initializeTestEnvironment({ projectId, firestore: { rules: fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8') }, storage: { rules: fs.readFileSync(path.resolve(__dirname, '../../storage.rules'), 'utf8') } });
    app = initializeApp({ projectId }, 'owner-media-local-test');
    db = getFirestore(app);
    const bucket = { file(objectPath) { return { async getMetadata() { return [{ generation, size: '100', contentType: 'image/png', metadata: { mediaId: objectPath.includes(other) ? other : id } }]; }, async delete(options) { deleteCalls.push({ objectPath, options }); if (deleteHook)
                await deleteHook(); } }; } };
    deps = createOwnerMediaDependencies(db, bucket, async () => 'https://example.test/local-photo');
});
test.beforeEach(async () => { await env.clearFirestore(); await env.clearStorage(); deleteCalls = []; deleteHook = null; await db.doc('restaurant_accounts/owner').set({ uid: 'owner', couponApplicationSubmitted: true, approvalStatus: 'approved', couponPostingEnabled: true }); });
test.after(async () => { await db.terminate(); await deleteApp(app); await env.cleanup(); });
test('unchanged Rules protect root metadata; only actual owner may upload existing namespace', async () => {
    await assertFails(updateDoc(doc(actor('owner').firestore(), 'restaurant_accounts/owner'), { ownerMedia: { version: 999 } }));
    const objectPath = `bitesaver_restaurants/owner/restaurant_images/managed_${id}.png`, bytes = new Uint8Array([137, 80, 78, 71]), metadata = { contentType: 'image/png', customMetadata: { mediaId: id } };
    await assertSucceeds(uploadBytes(ref(actor('owner').storage(), objectPath), bytes, metadata));
    await assertFails(uploadBytes(ref(actor('other').storage(), objectPath), bytes, metadata));
    await assertFails(deleteObject(ref(actor('other').storage(), objectPath)));
    await db.doc('private_account_deletions/owner').set({ state: 'requested' });
    await assertFails(uploadBytes(ref(actor('owner').storage(), objectPath), bytes, metadata));
});
test('real transaction registers server metadata, blocks competing version and preserves all references', async () => {
    const outcomes = await Promise.allSettled([register(), register(other)]);
    assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1);
    const state = (await db.doc('restaurant_accounts/owner').get()).data().ownerMedia;
    assert.equal(state.version, 1);
    assert.equal(state.images.length, 1);
    assert.equal(state.images[0].generation, generation);
    await assert.rejects(() => saveOwnerMedia({ auth: auth('other'), data: { action: 'load' } }, deps));
});
test('adapter preserves full string generation and match, 412 failure intent can retry', async () => {
    await register();
    deleteHook = async () => { throw Object.assign(Error('precondition'), { code: 412 }); };
    await assert.rejects(remove, /precondition/);
    assert.equal((await db.doc('restaurant_accounts/owner').get()).data().ownerMedia.images[0].state, 'deleting');
    assert.deepEqual(deleteCalls[0].options, { generation, ifGenerationMatch: generation });
    deleteHook = null;
    await remove();
    await remove();
    assert.equal(deleteCalls.length, 2);
    assert.equal((await db.doc('restaurant_accounts/owner').get()).data().ownerMedia.images.length, 0);
});
test('404 exact-generation absence is idempotent, ordinary Storage failure is not swallowed', async () => {
    await register();
    deleteHook = async () => { throw Object.assign(Error('storage failed'), { code: 500 }); };
    await assert.rejects(remove, /storage failed/);
    deleteHook = async () => { throw Object.assign(Error('missing exact object'), { code: 404 }); };
    await remove();
    assert.equal((await db.doc('restaurant_accounts/owner').get()).data().ownerMedia.images.length, 0);
});
test('account deletion fence between object removal and completion prevents root rewrite', async () => {
    await register();
    deleteHook = async () => db.doc('private_account_deletions/owner').set({ state: 'requested' });
    await assert.rejects(remove);
    assert.equal((await db.doc('restaurant_accounts/owner').get()).data().ownerMedia.images[0].state, 'deleting');
    await assert.rejects(() => call({ action: 'load' }));
    await db.doc('restaurant_accounts/owner').delete();
    await assert.rejects(remove);
    assert.equal((await db.doc('restaurant_accounts/owner').get()).exists, false);
});
test('over-limit legacy entries never block registered unused image cleanup or erase unread specials', async () => {
    await register();
    const batch = db.batch();
    for (let i = 0; i < 55; i++)
        batch.set(db.doc(`restaurant_accounts/owner/daily_specials/s${i}`), { title: `Special ${i}` });
    await batch.commit();
    const loaded = await call({ action: 'load' });
    assert.equal(loaded.specialsOverflow, true);
    assert.equal(loaded.specials.length, 52);
    await assert.rejects(() => call({ action: 'publish', section: 'specials', expectedVersion: 1, requestId: 'save', gallery: [], mode: 'manual', specials: [], contentFingerprint: loaded.contentFingerprint }));
    await call({action:'publish',section:'photos',expectedVersion:1,requestId:'photos',gallery:[],specials:loaded.specials});
    await remove();
    assert.equal((await db.collection('restaurant_accounts/owner/daily_specials').get()).size, 55);
});
test('real special transaction preserves unknown fields, authorizes mode and refuses stale direct edits', async () => {
    await db.doc('restaurant_accounts/owner/daily_specials/lunch').set({ title: 'Original', custom: 'preserved', createdAt: new Date('2020-01-01') });
    await register();
    const loaded = await call({ action: 'load' });
    const special = { id: 'lunch', title: 'Lunch', details: null, isActive: true, availabilityMode: 'specificDays', daysOfWeek: [1, 2], allDay: true, hideWhenUnavailable: true, imageId: null };
    const payload = { action: 'publish', section: 'specials', expectedVersion: 1, requestId: 'save', gallery: [], mode: 'photo', boardImage: id, specials: [special], board: { ...special, title: 'Board' }, contentFingerprint: loaded.contentFingerprint };
    await call(payload);
    await call(payload);
    const source = (await db.doc('restaurant_accounts/owner/daily_specials/lunch').get()).data();
    assert.equal(source.custom, 'preserved');
    assert.equal(source.createdAt.toDate().getUTCFullYear(), 2020);
    const saved = await call({ action: 'load' });
    await db.doc('restaurant_accounts/owner/daily_specials/lunch').update({ title: 'Newer' });
    await assert.rejects(() => call({ ...payload, expectedVersion: saved.media.version, requestId: 'another', contentFingerprint: saved.contentFingerprint }));
    assert.equal((await db.doc('restaurant_accounts/owner/daily_specials/lunch').get()).data().title, 'Newer');
});
