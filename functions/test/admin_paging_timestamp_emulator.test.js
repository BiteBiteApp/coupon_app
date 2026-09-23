"use strict";

const assert = require("node:assert/strict");
const {createHash, randomBytes} = require("node:crypto");
const test = require("node:test");

// Refuse a production project, non-loopback host, or credential file before
// loading Firebase. There is no non-emulator fallback in this regression.
function requireSafeEmulatorConfiguration() {
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? "";
  const firstProject = process.env.GCLOUD_PROJECT ?? "";
  const secondProject = process.env.GOOGLE_CLOUD_PROJECT ?? "";
  const projectId = firstProject || secondProject;
  const match = /^(?:localhost|127\.0\.0\.1):([1-9][0-9]{0,4})$/u.exec(host) ??
    /^\[::1\]:([1-9][0-9]{0,4})$/u.exec(host);
  if (!match || Number(match[1]) > 65_535 ||
      !/^demo-bs-adapter-admin-paging(?:-[a-z0-9-]+)?$/u.test(projectId) ||
      (firstProject && secondProject && firstProject !== secondProject) ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error("Admin timestamp tests require the dedicated demo-bs-adapter-admin-paging project, explicit loopback Firestore emulator, and no credential file.");
  }
  return {projectId};
}

if (process.env.BITESTAR_ADMIN_PAGING_EMULATOR_TEST !== "1") {
  test("real Firestore Admin timestamp regression requires its explicit local gate", {
    skip: "set BITESTAR_ADMIN_PAGING_EMULATOR_TEST=1 with the dedicated local emulator",
  }, () => {});
} else {
  const safety = requireSafeEmulatorConfiguration();
  const {initializeApp, deleteApp} = require("firebase-admin/app");
  const {getFirestore, Timestamp, FieldPath} = require("firebase-admin/firestore");
  const coupon = require("../lib/coupon_admin_paging.js");
  const rating = require("../lib/rating_admin_paging.js");
  const {OpaqueCursorCodec} = require("../lib/opaque_cursor.js");
  const secret = "A".repeat(43); // Synthetic local key, never a deployed secret.
  const nowMs = Date.UTC(2026, 8, 23);
  const privateMarker = "synthetic-private-value-must-not-leak";
  const branches = [
    {
      name: "coupon list", pageSize: 25, family: "couponAdmin",
      source: "couponAdminCoupons", searchMode: "restaurantCoupons",
      handler: coupon.listCouponAdminCouponsPageHandler,
      adapter: coupon.createFirestoreCouponAdminPagingDatabase,
      collection: (id) => `restaurant_accounts/${id}/coupons`,
      criteria: (id) => ({restaurantAccountId: id}),
      changedCriteria: (id) => ({restaurantAccountId: `${id}-different`}),
    },
    {
      name: "Coupon invite history", pageSize: 50, family: "couponAdmin",
      source: "couponAdminInvites", searchMode: "couponInvites", side: "coupon",
      handler: coupon.listCouponAdminInviteHistoryPageHandler,
      adapter: coupon.createFirestoreCouponAdminPagingDatabase,
      collection: () => "restaurant_invites", criteria: () => ({side: "coupon"}),
      changedCriteria: () => ({side: "bitescore"}),
      otherHandler: rating.listRatingAdminInviteHistoryPageHandler,
    },
    {
      name: "Rating invite history", pageSize: 50, family: "ratingAdmin",
      source: "ratingAdminInvites", searchMode: "bitescoreInvites", side: "bitescore",
      handler: rating.listRatingAdminInviteHistoryPageHandler,
      adapter: rating.createFirestoreRatingAdminPagingDatabase,
      collection: () => "restaurant_invites", criteria: () => ({side: "bitescore"}),
      changedCriteria: () => ({side: "coupon"}),
      otherHandler: coupon.listCouponAdminInviteHistoryPageHandler,
    },
    {
      name: "Rating review directory", pageSize: 50, family: "ratingAdmin",
      source: "ratingAdminDirectory", searchMode: "reviews",
      handler: rating.listRatingAdminDirectoryPageHandler,
      adapter: rating.createFirestoreRatingAdminPagingDatabase,
      collection: () => "dish_reviews", criteria: () => ({directoryKind: "reviews"}),
      changedCriteria: () => ({directoryKind: "claimedRestaurants"}),
    },
  ];

  for (const branch of branches) {
    test(`real Firestore ${branch.name} preserves timestamp paging`, {
      concurrency: false, timeout: 120_000,
    }, async (t) => {
      const namespace = `admin_stamp_${randomBytes(8).toString("hex")}`;
      const app = initializeApp({projectId: safety.projectId}, namespace);
      const firestore = getFirestore(app);
      const real = branch.adapter(firestore);
      const owned = new Set();
      const queries = [];
      let readCount = 0;
      const database = {
        queryDocuments: (query) => {
          readCount += 1;
          queries.push(query);
          return real.queryDocuments(query);
        },
        countDocuments: (query) => { readCount += 1; return real.countDocuments(query); },
        getDocuments: (paths) => { readCount += 1; return real.getDocuments(paths); },
      };
      const context = {adminUid: namespace, cursorSecret: secret, database, now: () => nowMs};
      const codec = new OpaqueCursorCodec({key: Buffer.from(secret, "base64url"), clock: () => nowMs});
      const collectionPath = branch.collection(namespace);
      const criteria = branch.criteria(namespace);
      let requestNumber = 0;
      const request = (overrides = {}) => ({
        protocolVersion: "bitestar.page.v1", pageSize: branch.pageSize, criteria,
        direction: "first", requestExactCount: true,
        clientRequestId: `actual-admin-client-envelope-${++requestNumber}`,
        ...overrides,
      });
      const load = (overrides = {}, changedContext = context) =>
        branch.handler(request(overrides), changedContext);
      const ids = (page) => page.items.map((row) => row.id);
      const binding = (page, purpose) => ({
        queryFingerprint: page.queryFingerprint, source: branch.source,
        searchMode: branch.searchMode, pageSize: branch.pageSize,
        callerBinding: createHash("sha256")
          .update(JSON.stringify([branch.family, namespace])).digest("hex"),
        purposes: [purpose],
      });
      async function deleteOwned() {
        const paths = [...owned];
        for (let offset = 0; offset < paths.length; offset += 400) {
          const batch = firestore.batch();
          for (const path of paths.slice(offset, offset + 400)) batch.delete(firestore.doc(path));
          await batch.commit();
        }
        owned.clear();
      }
      try {
        assert.equal((await firestore.collection(collectionPath).limit(1).get()).size, 0,
          "the dedicated emulator collection must start empty; never erase pre-existing rows");
        const size = branch.pageSize * 3 + 7;
        const written = new Map();
        const batch = firestore.batch();
        for (let index = 0; index < size; index += 1) {
          const id = `${namespace}_${String(index).padStart(4, "0")}`;
          // Firestore persists microseconds. All distinct values below are inside
          // one millisecond; groups of three are exact timestamp ties across pages.
          const createdAt = new Timestamp(1_790_000_000, 123_100_000 + Math.floor(index / 3) * 1_000);
          const path = `${collectionPath}/${id}`;
          owned.add(path);
          written.set(id, createdAt);
          batch.set(firestore.doc(path), {
            createdAt, ...(branch.side ? {side: branch.side} : {}),
            dishId: `${namespace}_dish`, restaurantId: namespace, userId: `${namespace}_reviewer`,
            headline: "Synthetic local review", name: "Synthetic local coupon", status: "active",
            invitationToken: privateMarker, stripeCustomerId: privateMarker, deviceToken: privateMarker,
          });
        }
        if (branch.side) {
          const path = `${collectionPath}/${namespace}_wrong_side`;
          owned.add(path);
          batch.set(firestore.doc(path), {
            createdAt: new Timestamp(1_790_000_001, 0),
            side: branch.side === "coupon" ? "bitescore" : "coupon",
          });
        }
        await batch.commit();
        let reference = firestore.collection(collectionPath);
        if (branch.side) reference = reference.where("side", "==", branch.side);
        const snapshot = await reference.orderBy("createdAt", "desc")
          .orderBy(FieldPath.documentId(), "desc").limit(size + 1).get();
        assert.equal(snapshot.size, size);
        const expected = snapshot.docs.map((doc) => doc.id);
        const stored = new Map(snapshot.docs.map((doc) => [doc.id, doc.get("createdAt")]));
        for (const [id, timestamp] of stored) {
          assert(timestamp instanceof Timestamp);
          assert.equal(timestamp.seconds, written.get(id).seconds);
          assert.equal(timestamp.nanoseconds, written.get(id).nanoseconds,
            "persisted fixture retains exact microsecond/nanosecond boundary");
          assert.equal(Math.floor(timestamp.toMillis()), 1_790_000_000_123);
        }
        for (let index = 1; index < expected.length; index += 1) {
          const previous = stored.get(expected[index - 1]);
          const current = stored.get(expected[index]);
          if (previous.isEqual(current)) assert(expected[index - 1] > expected[index],
            "equal timestamps use the existing descending document-ID tie breaker");
        }
        function assertSignedBoundary(page, cursorKey, anchorId, targetPage, purpose) {
          const timestamp = stored.get(anchorId);
          const decoded = codec.decode(page[cursorKey], binding(page, purpose));
          assert.deepEqual(decoded.sortTuple,
            [timestamp.seconds, timestamp.nanoseconds, anchorId, targetPage]);
          return decoded;
        }
        function assertQueryBoundary(anchorId, kind) {
          const query = queries.at(-1);
          const timestamp = query.cursor.values[0];
          assert.equal(query.cursor.kind, kind);
          assert(timestamp instanceof Timestamp, "actual Firestore query receives a Timestamp, never Date");
          assert.equal(timestamp.seconds, stored.get(anchorId).seconds);
          assert.equal(timestamp.nanoseconds, stored.get(anchorId).nanoseconds);
          assert.equal(query.cursor.values[1], anchorId);
          assert.deepEqual(query.orders, [
            {field: "createdAt", direction: "desc"}, {field: "__name__", direction: "desc"},
          ]);
        }
        let first;
        await t.test("A-F/J: several forward and previous pages are exact, signed boundaries retain precision", async () => {
          const pages = [];
          let page = first = await load();
          for (let pageIndex = 0; pageIndex < 4; pageIndex += 1) {
            assert.equal(page.pageSize, branch.pageSize);
            assert.equal(page.currentPageNumber, pageIndex + 1);
            assert.deepEqual(page.total, {state: "exact", value: size});
            assert.deepEqual(ids(page), expected.slice(pageIndex * branch.pageSize, (pageIndex + 1) * branch.pageSize));
            assert.equal(page.hasPrevious, pageIndex > 0);
            assert.equal(page.hasNext, pageIndex < 3);
            assert(!JSON.stringify(page.items).includes(privateMarker));
            pages.push(page);
            if (pageIndex < 3) {
              const anchor = ids(page).at(-1);
              assertSignedBoundary(page, "nextCursor", anchor, pageIndex + 2, "forward");
              page = await load({direction: "forward", cursor: page.nextCursor});
              assertQueryBoundary(anchor, "startAfter");
            }
          }
          const all = pages.flatMap(ids);
          assert.deepEqual(all, expected, "every row appears exactly once, without boundary omission");
          assert.equal(new Set(all).size, size, "no duplicate at any page boundary");
          for (let index = 3; index > 0; index -= 1) {
            const anchor = ids(page)[0];
            assertSignedBoundary(page, "previousCursor", anchor, index, "backward");
            page = await load({direction: "backward", cursor: page.previousCursor});
            assertQueryBoundary(anchor, "endBefore");
            assert.deepEqual(ids(page), ids(pages[index - 1]), "Previous returns the exact preceding page");
          }
          assert.equal(page.hasPrevious, false);
          assert.equal(page.previousCursor, undefined);
          const last = await load({direction: "last"});
          assert.deepEqual(ids(last), ids(pages[3]));
          assert.equal(last.currentPageNumber, 4);
          assert.equal(last.hasNext, false);
          assert.equal(last.nextCursor, undefined);
          const beforeLast = await load({direction: "backward", cursor: last.previousCursor});
          assert.deepEqual(ids(beforeLast), ids(pages[2]));
          assert.deepEqual(ids(await load()), ids(first), "First returns the initial page unchanged");
          assert(queries.every((query) => query.limit <= branch.pageSize + 1));
        });
        await t.test("G-H/J: tampering, caller/filter replay, wrong direction and page size fail before reads", async () => {
          assert(first?.nextCursor);
          const tokenBytes = Buffer.from(first.nextCursor.slice("bsp1.".length), "base64url");
          tokenBytes[Math.floor(tokenBytes.length / 2)] ^= 1;
          const badToken = "bsp1." + tokenBytes.toString("base64url");
          const reject = async (operation) => {
            const beforeReads = readCount;
            await assert.rejects(operation(), (error) => error.code === "invalid-argument");
            assert.equal(readCount, beforeReads, "rejected continuation cannot query Firestore");
          };
          await reject(() => load({direction: "forward", cursor: badToken}));
          await reject(() => load({direction: "forward", cursor: first.nextCursor},
            {...context, adminUid: `${namespace}_other_admin`}));
          await reject(() => load({direction: "forward", cursor: first.nextCursor,
            criteria: branch.changedCriteria(namespace)}));
          await reject(() => load({direction: "backward", cursor: first.nextCursor}));
          await reject(() => load({direction: "forward", cursor: first.nextCursor, pageSize: branch.pageSize - 1}));
          if (branch.otherHandler) await reject(() => branch.otherHandler(request({
            direction: "forward", cursor: first.nextCursor, criteria: branch.changedCriteria(namespace),
          }), context));
        });
        await t.test("I: empty First and Last have no cursor or navigation", async () => {
          await deleteOwned();
          for (const direction of ["first", "last"]) {
            const empty = await load({direction});
            assert.deepEqual(empty.items, []);
            assert.deepEqual(empty.total, {state: "exact", value: 0});
            assert.equal(empty.currentPageNumber, 1);
            assert.equal(empty.pageSize, branch.pageSize);
            assert.equal(empty.hasNext, false);
            assert.equal(empty.hasPrevious, false);
            assert.equal(empty.nextCursor, undefined);
            assert.equal(empty.previousCursor, undefined);
            for (const key of ["first", "previous", "next", "last"]) assert.equal(empty.capabilities[key], false);
          }
        });
      } finally {
        await deleteOwned();
        await deleteApp(app);
      }
    });
  }
}
