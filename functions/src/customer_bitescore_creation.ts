import {requireAccountWritableInStore} from "./account_deletion_guard.js";
import {createHash, randomUUID} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {GeoPoint} from "firebase-admin/firestore";
import {HttpsError} from "firebase-functions/v2/https";
import {customerBiteScoreReviewDocumentId} from "./bitescore_review_aggregate.js";
import {canonicalCustomerBiteSaverState} from "./customer_bitesaver_search_contract.js";
import {readBiteScoreCatalogRestaurantId} from "./restaurant_invite_helpers.js";
import {canonicalRestaurantGeohash, validRestaurantCoordinates} from "./restaurant_geo_helpers.js";
import {biteScoreRestaurantIsActive} from "./search_index_builders.js";
import {ratingDishOperationLockPath, ratingRestaurantOperationLockPath} from "./rating_destructive_job_contract.js";
import type {RatingDestructivePrivateDatabase, RatingDestructivePrivateTransaction, RatingDestructiveStoredDocument, RatingDestructivePrivateQuery} from "./rating_destructive_job_store.js";
import type {OpaqueCursorCodec} from "./opaque_cursor.js";
import {createQueryFingerprint} from "./query_fingerprint.js";

type Data = Readonly<Record<string, unknown>>;
type Database = RatingDestructivePrivateDatabase;
type Transaction = RatingDestructivePrivateTransaction;
type Document = RatingDestructiveStoredDocument;
export type CustomerBiteScoreCreationContext = Readonly<{
  userId: string | null; email: string | null; emailVerified: boolean; isAnonymous: boolean;
  cursorCodec?: OpaqueCursorCodec;
}>;

function fail(code: "invalid-argument" | "permission-denied" | "failed-precondition" | "already-exists", message: string): never {
  throw new HttpsError(code, message);
}
function id(value: unknown): string {
  const result = readBiteScoreCatalogRestaurantId(value);
  if (result === null) fail("invalid-argument", "An exact BiteScore identity is required.");
  return result;
}
function actor(context: CustomerBiteScoreCreationContext): string {
  if (!context.userId || context.isAnonymous || context.emailVerified !== true) {
    fail("permission-denied", "A verified account is required.");
  }
  return id(context.userId);
}
function request(raw: unknown, fields: readonly string[]): Data {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("invalid-argument", "Invalid BiteScore request.");
  const data = raw as Data;
  if (data.schemaVersion !== 1 || Object.keys(data).some((key) => !["schemaVersion", "expectedUserId", ...fields].includes(key))) {
    fail("invalid-argument", "Invalid BiteScore request fields.");
  }
  return data;
}
function bindExpectedActor(data: Data, uid: string): void {
  if (id(data.expectedUserId) !== uid) fail("permission-denied", "Your account changed. Please try again.");
}
function text(value: unknown, required = true, maximum = 20000): string {
  if (value === undefined || value === null) {
    if (!required) return "";
    fail("invalid-argument", "Required BiteScore text is missing.");
  }
  if (typeof value !== "string" || value.length > maximum || (required && !value.trim())) {
    fail("invalid-argument", "Invalid BiteScore text.");
  }
  return value.trim();
}
function creationId(kind: "restaurant" | "dish", uid: string, value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(value)) fail("invalid-argument", "Invalid creation request identity.");
  return `bs${kind}_${createHash("sha256").update(JSON.stringify(["bitescore.creation.v1", kind, uid, value])).digest("hex")}`;
}
function revision(data: Data): number {
  if (!Number.isSafeInteger(data.restaurantWriteRevision) || (data.restaurantWriteRevision as number) < 0) {
    fail("failed-precondition", "Invalid BiteScore restaurant write state.");
  }
  return data.restaurantWriteRevision as number;
}
function coordinates(data: Data): {latitude: number; longitude: number} {
  const location = data.location as {latitude?: unknown; longitude?: unknown} | undefined;
  const latitude = location?.latitude ?? data.latitude;
  const longitude = location?.longitude ?? data.longitude;
  const result = validRestaurantCoordinates(latitude, longitude);
  if (result === null) {
    fail("failed-precondition", "Could not verify address. Please enter a valid address.");
  }
  return result;
}
function restaurant(document: Document | null): Document {
  if (!document || document.data.id !== document.id || !biteScoreRestaurantIsActive(document.data)) {
    fail("failed-precondition", "This BiteScore restaurant is unavailable.");
  }
  id(document.id);
  return document;
}
async function unlocked(transaction: Transaction, restaurantId: string, dishId?: string): Promise<void> {
  const paths = [ratingRestaurantOperationLockPath(restaurantId), ...(dishId ? [ratingDishOperationLockPath(dishId)] : [])];
  for (const path of paths) {
    if (await transaction.getDocument(path)) fail("failed-precondition", "BiteScore is being updated. Please try again shortly.");
  }
}

// Only presentation and the revision needed for the creator's completion are
// returned. Ownership, invitations, linkage and other creators' provenance are
// never copied from the mixed source document to the customer response.
function restaurantDto(document: Document): Data {
  const data = document.data;
  const point = coordinates(data);
  return {
    id: document.id, name: text(data.name), normalizedName: text(data.normalizedName),
    address: text(data.address ?? data.streetAddress), city: text(data.city),
    state: text(data.state, false), zipCode: text(data.zipCode ?? data.zip),
    latitude: point.latitude, longitude: point.longitude,
    isActive: true, isClaimed: data.isClaimed === true,
    restaurantWriteRevision: revision(data),
  };
}
function dishDto(document: Document): Data {
  const data = document.data;
  const optional = (key: string) => typeof data[key] === "string" ? data[key] : null;
  return {
    id: document.id, restaurantId: id(data.restaurantId), restaurantName: text(data.restaurantName),
    name: text(data.name), normalizedName: text(data.normalizedName),
    category: optional("category"), subcategory: optional("subcategory"),
    categoryManualKeywords: optional("categoryManualKeywords"),
    categoryTags: Array.isArray(data.categoryTags) ? data.categoryTags.filter((v) => typeof v === "string") : [],
    priceLabel: optional("priceLabel"), primaryImageUrl: optional("primaryImageUrl"), primaryImageId: optional("primaryImageId"),
    imageCount: Number.isSafeInteger(data.imageCount) && (data.imageCount as number) >= 0 ? data.imageCount : 0,
    isActive: true, mergedIntoDishId: null,
  };
}
function document(id: string, data: Data): Document { return {id, data, createTime: null}; }

// Firestore truncates indexed strings at 1,500 bytes. Long-name resolution
// advances through the remaining exact scope in independently bounded calls;
// it never trusts a truncated equality match or caps the total source set.
async function matchingName(transaction: Transaction, data: Data, context: CustomerBiteScoreCreationContext,
  uid: string, kind: "restaurant" | "dish", where: NonNullable<RatingDestructivePrivateQuery["where"]>,
  normalizedName: string): Promise<{match: Document | null; nextCursor: string | null}> {
  const collectionPath = kind === "restaurant" ? "bitescore_restaurants" : "bitescore_dishes";
  if (Buffer.byteLength(normalizedName, "utf8") < 1500) {
    if (data.cursor !== undefined && data.cursor !== null) fail("invalid-argument", "Unexpected creation continuation.");
    const matches = await transaction.queryDocuments({collectionPath,
      where: [...where, {field: "normalizedName", operator: "==", value: normalizedName}], limit: 1});
    if (matches[0] && matches[0].data.normalizedName !== normalizedName) fail("failed-precondition", "The restaurant or dish changed. Please try again.");
    return {match: matches[0] ?? null, nextCursor: null};
  }
  const codec = context.cursorCodec;
  if (!codec) fail("failed-precondition", "Creation continuation is unavailable.");
  const {cursor: _cursor, location: rawLocation, ...criteria} = data;
  const point = rawLocation == null ? null : coordinates({location: rawLocation});
  const queryFingerprint = createQueryFingerprint({version: "bitescore.creation-name.v1", kind, criteria,
    location: point === null ? null : {latitude: String(point.latitude), longitude: String(point.longitude)}});
  const callerBinding = createHash("sha256").update(JSON.stringify(["bitescore.creation-actor.v1", uid])).digest("hex");
  const binding = {queryFingerprint, source: "customerBiteScoreCreation", searchMode: kind, pageSize: 25, callerBinding};
  let after: string | null = null;
  if (data.cursor !== undefined && data.cursor !== null) {
    if (typeof data.cursor !== "string") fail("invalid-argument", "Invalid creation continuation.");
    const decoded = codec.decode(data.cursor, {...binding, purposes: ["forward"]});
    if (decoded.sortTuple.some((part) => typeof part !== "string")) fail("invalid-argument", "Invalid creation continuation.");
    after = id(decoded.sortTuple.join(""));
  }
  const page = await transaction.queryDocuments({collectionPath, where, orderBy: [{field: "__name__", direction: "asc"}],
    ...(after === null ? {} : {startAfter: [after]}), limit: 25});
  const match = page.find((candidate) => candidate.data.normalizedName === normalizedName) ?? null;
  if (match || page.length < 25) return {match, nextCursor: null};
  const last = id(page[page.length - 1].id);
  const parts: string[] = [];
  for (let offset = 0; offset < last.length; offset += 256) parts.push(last.slice(offset, offset + 256));
  return {match: null, nextCursor: codec.encode({...binding, purpose: "forward", sortTuple: parts})};
}

export async function submitCustomerBiteScoreRestaurantClaimHandler(database: Database, raw: unknown,
  context: CustomerBiteScoreCreationContext, now = new Date()): Promise<Data> {
  const uid = actor(context);
  const data = request(raw, ["restaurantId", "claimantName", "phone", "message"]);
  bindExpectedActor(data, uid);
  const restaurantId = id(data.restaurantId);
  const claimantName = text(data.claimantName), phone = text(data.phone), message = text(data.message, false);
  const email = text(context.email);
  const claimId = `bsclaim_${randomUUID()}`;
  return database.runTransaction(async (transaction) => {
    await requireAccountWritableInStore(transaction, uid);
    const target = restaurant(await transaction.getDocument(`bitescore_restaurants/${restaurantId}`));
    const source = target.data;
    if ((Object.prototype.hasOwnProperty.call(source, "isClaimed") && source.isClaimed !== false) ||
        (Object.prototype.hasOwnProperty.call(source, "ownerUserId") && source.ownerUserId !== null && source.ownerUserId !== "")) {
      fail("failed-precondition", "This BiteScore restaurant is unavailable for claiming.");
    }
    await unlocked(transaction, restaurantId);
    const existing = await transaction.queryDocuments({collectionPath: "restaurant_claim_requests", where: [
      {field: "restaurantId", operator: "==", value: restaurantId},
      {field: "requesterUserId", operator: "==", value: uid},
      {field: "status", operator: "==", value: "pending"},
    ], limit: 1});
    if (existing.length) fail("already-exists", "You already have a pending claim request for this restaurant.");
    const path = `restaurant_claim_requests/${claimId}`;
    transaction.setDocument(path, {id: claimId, restaurantId, restaurantName: text(source.name),
      requesterUserId: uid, claimantName, email, phone, message: message || null,
      status: "pending", createdAt: now, updatedAt: now});
    return {schemaVersion: 1, claimId};
  });
}

export async function resolveCustomerBiteScoreRestaurantCreationHandler(database: Database, raw: unknown,
  context: CustomerBiteScoreCreationContext, now = new Date()): Promise<Data> {
  const uid = actor(context);
  const data = request(raw, ["requestId", "name", "address", "city", "state", "zipCode", "location", "cursor"]);
  bindExpectedActor(data, uid);
  const newId = creationId("restaurant", uid, data.requestId);
  const name = text(data.name), normalizedName = name.toLowerCase();
  const address = text(data.address), city = text(data.city), rawState = text(data.state), rawZip = text(data.zipCode);
  const state = canonicalCustomerBiteSaverState(rawState) ?? (rawState.length === 2 ? rawState.toUpperCase() : rawState);
  const zipCode = /\d{5}(?:-\d{4})?/.exec(rawZip)?.[0] ?? rawZip;
  return database.runTransaction(async (transaction) => {
    await requireAccountWritableInStore(transaction, uid);
    const own = await transaction.getDocument(`bitescore_restaurants/${newId}`);
    if (own) {
      const target = restaurant(own);
      if (target.data.createdByUserId !== uid || target.data.createdFromCreateFlow !== true ||
          target.data.name !== name || target.data.address !== address || target.data.city !== city ||
          target.data.state !== state || target.data.zipCode !== zipCode) fail("failed-precondition", "Creation request was already used.");
      await unlocked(transaction, newId);
      return {schemaVersion: 1, restaurant: restaurantDto(target), wasCreated: true};
    }
    const matched = await matchingName(transaction, data, context, uid, "restaurant", [
      {field: "zipCode", operator: "==", value: rawZip},
    ], normalizedName);
    if (matched.nextCursor) return {schemaVersion: 1, state: "preparing", nextCursor: matched.nextCursor};
    if (matched.match) {
      const target = restaurant(matched.match);
      await unlocked(transaction, target.id);
      return {schemaVersion: 1, restaurant: restaurantDto(target), wasCreated: false};
    }
    if (data.location === undefined || data.location === null) return {schemaVersion: 1, requiresLocation: true};
    const point = coordinates({location: data.location});
    await unlocked(transaction, newId);
    const location = new GeoPoint(point.latitude, point.longitude);
    const formattedAddress = `${address}, ${city}, ${state} ${zipCode}`;
    const created: Data = {id: newId, name, restaurantName: name, normalizedName, address, streetAddress: address,
      formattedAddress, fullAddress: formattedAddress, city, state, stateCode: state, zip: zipCode, zipCode, postalCode: zipCode,
      location, geoPoint: location, latitude: point.latitude, longitude: point.longitude,
      geohash: canonicalRestaurantGeohash(point), phone: null, website: null,
      bio: null, businessHours: [], ownerUserId: null, cuisineTags: [], isClaimed: false, isActive: true, active: true,
      createdByUserId: uid, createdFromCreateFlow: true, restaurantWriteRevision: 0, createdAt: now, updatedAt: now};
    transaction.setDocument(`bitescore_restaurants/${newId}`, created);
    return {schemaVersion: 1, restaurant: restaurantDto(document(newId, created)), wasCreated: true};
  });
}

export async function resolveCustomerBiteScoreDishCreationHandler(database: Database, raw: unknown,
  context: CustomerBiteScoreCreationContext, now = new Date()): Promise<Data> {
  const uid = actor(context);
  const data = request(raw, ["requestId", "restaurantId", "dishName", "category", "subcategory", "categoryManualKeywords", "categoryTags", "priceLabel", "allowExistingMatch", "cursor"]);
  bindExpectedActor(data, uid);
  const newId = creationId("dish", uid, data.requestId), restaurantId = id(data.restaurantId);
  const name = text(data.dishName).split(/\s+/).map((word) => word.split("-").map((part) =>
    part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part).join("-")).join(" ");
  if (!/[A-Za-z0-9]/.test(name)) fail("invalid-argument", "Dish name is required.");
  if (typeof data.allowExistingMatch !== "boolean") fail("invalid-argument", "Invalid dish matching choice.");
  const normalizedName = name.toLowerCase(), category = text(data.category);
  const subcategory = text(data.subcategory, false) || null, categoryManualKeywords = text(data.categoryManualKeywords, false) || null;
  // Category editing is already allowed to every verified customer. Keep the
  // established Dart category tag derivation, accepting only its string field,
  // never arbitrary source fields or ownership/provenance from the request.
  if (!Array.isArray(data.categoryTags) || data.categoryTags.length > 1000 ||
      data.categoryTags.some((tag) => typeof tag !== "string" || tag.length > 20000)) fail("invalid-argument", "Invalid category tags.");
  const categoryTags = [...data.categoryTags];
  const priceLabel = text(data.priceLabel, false) || null;
  return database.runTransaction(async (transaction) => {
    await requireAccountWritableInStore(transaction, uid);
    const parent = restaurant(await transaction.getDocument(`bitescore_restaurants/${restaurantId}`));
    coordinates(parent.data);
    await unlocked(transaction, restaurantId, newId);
    const own = await transaction.getDocument(`bitescore_dishes/${newId}`);
    const activeWhere = [{field: "restaurantId", operator: "==" as const, value: restaurantId},
      {field: "isActive", operator: "==" as const, value: true}, {field: "mergedIntoDishId", operator: "==" as const, value: null}];
    const any = await transaction.queryDocuments({collectionPath: "bitescore_dishes", where: activeWhere, limit: 1});
    const restaurantHadNoDishesBefore = any.length === 0;
    if (own) {
      if (own.data.id !== newId || own.data.createdByUserId !== uid || own.data.createdFromCreateFlow !== true ||
          own.data.restaurantId !== restaurantId || own.data.normalizedName !== normalizedName || own.data.isActive !== true || own.data.mergedIntoDishId !== null) {
        fail("failed-precondition", "Creation request was already used.");
      }
      return {schemaVersion: 1, dish: dishDto(own), wasCreated: true, restaurantHadNoDishesBefore: false};
    }
    if (!data.allowExistingMatch && data.cursor !== undefined && data.cursor !== null) fail("invalid-argument", "Unexpected creation continuation.");
    const matched = data.allowExistingMatch ? await matchingName(transaction, data, context, uid, "dish", activeWhere, normalizedName)
      : {match: null, nextCursor: null};
    if (matched.nextCursor) return {schemaVersion: 1, state: "preparing", nextCursor: matched.nextCursor};
    const fields = {category, subcategory, categoryManualKeywords, categoryTags};
    if (matched.match) {
      const match = matched.match;
      if (match.data.id !== match.id) fail("failed-precondition", "Invalid dish identity.");
      await unlocked(transaction, restaurantId, id(match.id));
      const changed = Object.entries(fields).some(([key, value]) => !isDeepStrictEqual(match.data[key] ?? null, value));
      const result = {...match.data, ...fields};
      if (changed) transaction.setDocument(`bitescore_dishes/${match.id}`, {...fields, updatedAt: now}, {merge: true});
      return {schemaVersion: 1, dish: dishDto(document(match.id, result)), wasCreated: false, restaurantHadNoDishesBefore};
    }
    const created: Data = {id: newId, restaurantId, restaurantName: text(parent.data.name), name, normalizedName,
      ...fields, priceLabel, primaryImageUrl: null, primaryImageId: null, imageCount: 0, isActive: true, mergedIntoDishId: null,
      createdByUserId: uid, createdFromReviewId: customerBiteScoreReviewDocumentId(newId, uid),
      createdWithRestaurantId: restaurantId, createdFromCreateFlow: true, createdAt: now, updatedAt: now};
    transaction.setDocument(`bitescore_dishes/${newId}`, created);
    return {schemaVersion: 1, dish: dishDto(document(newId, created)), wasCreated: true, restaurantHadNoDishesBefore};
  });
}

export async function completeCustomerBiteScoreRestaurantProvenanceHandler(database: Database, raw: unknown,
  context: CustomerBiteScoreCreationContext): Promise<Data> {
  const uid = actor(context);
  const data = request(raw, ["restaurantId", "dishId", "expectedRestaurantRevision"]);
  bindExpectedActor(data, uid);
  const restaurantId = id(data.restaurantId), dishId = id(data.dishId);
  const expected = data.expectedRestaurantRevision;
  if (!Number.isSafeInteger(expected) || (expected as number) < 0 || (expected as number) >= Number.MAX_SAFE_INTEGER) {
    fail("invalid-argument", "Invalid restaurant revision.");
  }
  return database.runTransaction(async (transaction) => {
    await requireAccountWritableInStore(transaction, uid);
    const parent = restaurant(await transaction.getDocument(`bitescore_restaurants/${restaurantId}`));
    const dish = await transaction.getDocument(`bitescore_dishes/${dishId}`);
    await unlocked(transaction, restaurantId, dishId);
    const reviewId = customerBiteScoreReviewDocumentId(dishId, uid);
    if (parent.data.createdByUserId !== uid || parent.data.createdFromCreateFlow !== true ||
        !dish || dish.data.id !== dishId || dish.data.restaurantId !== restaurantId ||
        dish.data.createdByUserId !== uid || dish.data.createdFromCreateFlow !== true ||
        dish.data.createdWithRestaurantId !== restaurantId || dish.data.createdFromReviewId !== reviewId) {
      fail("permission-denied", "Only the original creator can complete creation provenance.");
    }
    const currentRevision = revision(parent.data);
    if (parent.data.createdFromDishId === dishId && parent.data.createdFromReviewId === reviewId && currentRevision === (expected as number) + 1) {
      return {schemaVersion: 1, restaurant: restaurantDto(parent)};
    }
    if (currentRevision !== expected || Object.prototype.hasOwnProperty.call(parent.data, "createdFromDishId") || Object.prototype.hasOwnProperty.call(parent.data, "createdFromReviewId")) {
      fail("failed-precondition", "This restaurant changed. Please reload and try again.");
    }
    const fields = {createdFromDishId: dishId, createdFromReviewId: reviewId, restaurantWriteRevision: currentRevision + 1};
    transaction.setDocument(`bitescore_restaurants/${restaurantId}`, fields, {merge: true});
    return {schemaVersion: 1, restaurant: restaurantDto(document(restaurantId, {...parent.data, ...fields}))};
  });
}
