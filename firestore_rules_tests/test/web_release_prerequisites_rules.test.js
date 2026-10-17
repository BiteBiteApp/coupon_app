'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {initializeTestEnvironment, assertFails, assertSucceeds} = require('@firebase/rules-unit-testing');
const {doc, setDoc, updateDoc, deleteDoc, getDoc, writeBatch, runTransaction} = require('firebase/firestore');

const projectId = 'demo-coupon-app-rules';
const candidatePath = path.resolve(__dirname, '../../release/web_prerequisites_003/firestore.rules');
const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../release/web_prerequisites_003/firestore-patch.json')));
const rules = fs.readFileSync(candidatePath, 'utf8');
let env;
const actor = (uid, role = 'user') => env.authenticatedContext(uid, {
  email: role === 'beta' ? 'schuyler.cole@gmail.com' : `${uid}@example.test`,
  email_verified: true, admin: role === 'admin', firebase: {sign_in_provider: 'password'},
}).firestore();
const seed = rows => env.withSecurityRulesDisabled(async context => {
  for (const [p, data] of Object.entries(rows)) await setDoc(doc(context.firestore(), p), data);
});
const roots = uid => ({
  [`user_profiles/${uid}`]: {userId: uid, displayName: 'Local customer'},
  [`public_reviewer_profiles/${uid}`]: {userId: uid, publicDisplayName: 'Local reviewer'},
  [`public_usernames/name-${uid}`]: {userId: uid},
  [`restaurant_accounts/${uid}`]: {uid, displayName: 'Local owner', approvalStatus: 'pending'},
});
const patchFor = p => p.startsWith('public_usernames/') ? {userId: 'A'} :
  p.startsWith('public_reviewer_profiles/') ? {publicDisplayName: 'Changed'} : {displayName: 'Changed'};

test.before(async () => {
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8792');
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9198');
  assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS, undefined);
  env = await initializeTestEnvironment({projectId, firestore: {rules}});
});
test.beforeEach(async () => { await env.clearFirestore(); });
test.after(async () => { if (env) await env.cleanup(); });

test('candidate is exactly the captured live baseline plus eleven guarded predicates', () => {
  assert.equal(createHash('sha256').update(rules).digest('hex'), manifest.candidateSha256);
  let baseline = rules;
  assert.equal(Object.keys(manifest.replacements).length, 11);
  for (const [before, after] of Object.entries(manifest.replacements)) {
    assert.equal(baseline.split(after).length - 1, 1);
    baseline = baseline.replace(after, before);
  }
  assert.equal(createHash('sha256').update(baseline).digest('hex'), manifest.baselineSha256);
  assert.equal(manifest.baselineSha256, '4ac78070148af5b8478f0fb06d51392a46479a4ac2a58b607621ec8dd366d06e');
});

test('normal eligible customer and owner root creates/updates retain prior permission', async () => {
  const a = actor('A');
  for (const [p, value] of Object.entries(roots('A'))) {
    await assertSucceeds(setDoc(doc(a, p), value));
    await assertSucceeds(updateDoc(doc(a, p), patchFor(p)));
  }
  await assertSucceeds(deleteDoc(doc(a, 'public_usernames/name-A')));
  await assertFails(deleteDoc(doc(a, 'restaurant_accounts/A')));
});

for (const [name, marker] of Object.entries({requested: {state: 'requested'}, processing: {state: 'processing'}, pending: {state: 'pending'}, complete: {state: 'complete'}, malformed: {}})) {
  test(`${name} marker fences all four own root creates, updates and username deletion`, async () => {
    await seed({'private_account_deletions/A': marker});
    const a = actor('A');
    for (const [p, value] of Object.entries(roots('A'))) await assertFails(setDoc(doc(a, p), value));
    await seed(roots('A'));
    for (const p of Object.keys(roots('A'))) await assertFails(updateDoc(doc(a, p), patchFor(p)));
    await assertFails(deleteDoc(doc(a, 'public_usernames/name-A')));
    await assertSucceeds(setDoc(doc(actor('B'), 'user_profiles/B'), roots('B')['user_profiles/B']));
  });
}

for (const role of ['admin', 'beta']) {
  test(`${role} preserves active-target authority and cannot bypass actor or target deletion`, async () => {
    const admin = actor('admin', role);
    for (const p of ['user_profiles/A', 'public_reviewer_profiles/A', 'restaurant_accounts/A']) {
      await assertSucceeds(setDoc(doc(admin, p), roots('A')[p]));
      await assertSucceeds(updateDoc(doc(admin, p), patchFor(p)));
    }
    await seed({'public_usernames/name-A': {userId: 'A'}});
    await assertSucceeds(deleteDoc(doc(admin, 'public_usernames/name-A')));
    await assertSucceeds(deleteDoc(doc(admin, 'user_profiles/A')));
    await assertSucceeds(deleteDoc(doc(admin, 'public_reviewer_profiles/A')));
    await assertFails(deleteDoc(doc(admin, 'restaurant_accounts/A')));
    await seed({...roots('A'), 'private_account_deletions/A': {state: 'complete'}});
    for (const p of Object.keys(roots('A'))) {
      await assertFails(updateDoc(doc(admin, p), patchFor(p)));
      await assertFails(deleteDoc(doc(admin, p)));
    }
    await seed({'private_account_deletions/admin': {state: 'pending'}, ...roots('B')});
    for (const p of ['user_profiles/B', 'public_reviewer_profiles/B', 'restaurant_accounts/B']) {
      await assertFails(updateDoc(doc(admin, p), patchFor(p)));
    }
    await assertFails(deleteDoc(doc(admin, 'public_usernames/name-B')));
  });
}

test('foreign user, username reassignment and signed-out writes remain denied', async () => {
  await seed(roots('A'));
  for (const p of Object.keys(roots('A'))) {
    await assertFails(setDoc(doc(actor('B'), p), roots('A')[p]));
    await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), p), roots('A')[p]));
  }
  await assertFails(updateDoc(doc(actor('A'), 'public_usernames/name-A'), {userId: 'B'}));
  await seed({'private_account_deletions/B': {state: 'complete'}});
  await assertFails(updateDoc(doc(actor('A'), 'public_usernames/name-A'), {userId: 'B'}));
  await assertFails(updateDoc(doc(actor('admin', 'admin'), 'public_usernames/name-A'), {userId: 'B'}));
});

test('reads and private deletion-marker denial remain unchanged', async () => {
  await seed({...roots('A'), 'private_account_deletions/A': {state: 'complete'}});
  await assertSucceeds(getDoc(doc(actor('A'), 'user_profiles/A')));
  await assertSucceeds(getDoc(doc(actor('admin', 'admin'), 'user_profiles/A')));
  await assertFails(getDoc(doc(actor('B'), 'user_profiles/A')));
  for (const p of ['public_reviewer_profiles/A', 'public_usernames/name-A']) {
    await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), p)));
  }
  for (const a of [actor('A'), actor('admin', 'admin')]) {
    await assertFails(getDoc(doc(a, 'private_account_deletions/A')));
    await assertFails(deleteDoc(doc(a, 'private_account_deletions/A')));
  }
});

test('billing, content maintenance and future writers remain protected', async () => {
  await seed(roots('A'));
  await assertFails(updateDoc(doc(actor('A'), 'restaurant_accounts/A'), {subscriptionStatus: 'active'}));
  await assertFails(updateDoc(doc(actor('A'), 'restaurant_accounts/A'), {couponPostingEnabled: true}));
  await assertFails(updateDoc(doc(actor('A'), 'user_profiles/A'), {contributionPoints: 20}));
  await assertFails(updateDoc(doc(actor('admin', 'admin'), 'user_profiles/A'), {contributionPoints: 20}));
  for (const a of [actor('A'), actor('admin', 'admin')]) {
    for (const p of ['dish_reviews/review', 'bitescore_restaurants/catalog', 'bitescore_dishes/dish', 'bitescore_dish_images/image', 'restaurant_accounts/A/menu_images/image', 'restaurant_accounts/A/menu_sections/section']) {
      await assertFails(setDoc(doc(a, p), {id: p.split('/').at(-1), userId: 'A'}));
    }
  }
});

test('approved owner content, active Admin and deletion fences preserve restored child behavior', async () => {
  await seed({'restaurant_accounts/A': {uid: 'A', approvalStatus: 'approved', couponPostingEnabled: true}});
  const writes = {'restaurant_accounts/A/coupons/c': {id: 'c'}, 'restaurant_accounts/A/daily_specials/s': {id: 's', restaurantId: 'A', ownerUid: 'A'}, 'restaurant_accounts/A/menu_items/m': {id: 'm'}};
  for (const [p, value] of Object.entries(writes)) {
    await assertSucceeds(setDoc(doc(actor('A'), p), value));
    await assertSucceeds(setDoc(doc(actor('admin', 'admin'), p), value));
    await assertFails(setDoc(doc(actor('B'), p), value));
  }
  await seed({'restaurant_accounts/A': {uid: 'A', approvalStatus: 'approved', couponPostingEnabled: false, subscriptionStatus: 'active'}});
  for (const [p, value] of Object.entries(writes)) await assertFails(setDoc(doc(actor('A'), p), value));
  await seed({'private_account_deletions/A': {state: 'requested'}});
  for (const [p, value] of Object.entries(writes)) await assertFails(setDoc(doc(actor('admin', 'admin'), p), value));
});

test('ordinary username transaction and bounded ten-target Admin batch fit access budgets', async () => {
  await seed(roots('A'));
  const a = actor('A');
  await assertSucceeds(runTransaction(a, async tx => {
    await tx.get(doc(a, 'public_usernames/name-A'));
    tx.set(doc(a, 'public_usernames/new-A'), {userId: 'A'});
    tx.update(doc(a, 'public_reviewer_profiles/A'), {username: 'new-A'});
    tx.delete(doc(a, 'public_usernames/name-A'));
  }));
  const admin = actor('admin', 'admin'), batch = writeBatch(admin);
  for (let i = 0; i < 10; i++) batch.set(doc(admin, `user_profiles/local-${i}`), {userId: `local-${i}`, displayName: 'Active'});
  await assertSucceeds(batch.commit());
});

test('actual locally issued token cannot recreate any root after Auth deletion; trusted cleanup still works', async () => {
  const authUrl = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:`;
  const signed = await fetch(`${authUrl}signUp?key=local-fixture`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({returnSecureToken: true})});
  assert.equal(signed.status, 200);
  const {localId: uid, idToken} = await signed.json();
  await seed({[`private_account_deletions/${uid}`]: {state: 'complete'}});
  const deleted = await fetch(`${authUrl}delete?key=local-fixture`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({idToken})});
  assert.equal(deleted.status, 200);
  for (const [p, data] of Object.entries(roots(uid))) {
    const fields = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, {stringValue: v}]));
    const result = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${projectId}/databases/(default)/documents/${p}`, {method: 'PATCH', headers: {authorization: `Bearer ${idToken}`, 'content-type': 'application/json'}, body: JSON.stringify({fields})});
    assert.equal(result.status, 403, p);
  }
  // Existing deletion workers use trusted server access, not client Rules.
  await seed(roots(uid));
  await env.withSecurityRulesDisabled(async context => {
    for (const p of Object.keys(roots(uid))) {
      await deleteDoc(doc(context.firestore(), p));
      assert.equal((await getDoc(doc(context.firestore(), p))).exists(), false);
    }
    assert.equal((await getDoc(doc(context.firestore(), `private_account_deletions/${uid}`))).exists(), true);
  });
});
