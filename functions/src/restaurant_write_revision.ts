export const restaurantWriteRevisionField = "restaurantWriteRevision";
export const maximumRestaurantWriteRevision = Number.MAX_SAFE_INTEGER;

export function readRestaurantWriteRevision(
  data: Readonly<Record<string, unknown>> | undefined,
): number | null {
  if (data === undefined ||
      !Object.prototype.hasOwnProperty.call(data, restaurantWriteRevisionField)) {
    return null;
  }
  const value = data[restaurantWriteRevisionField];
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? value as number
    : null;
}

export function nextRestaurantWriteRevision(
  currentRevision: number,
): number | null {
  if (!Number.isSafeInteger(currentRevision) ||
      currentRevision < 0 ||
      currentRevision >= maximumRestaurantWriteRevision) {
    return null;
  }
  return currentRevision + 1;
}

export type RestaurantInviteRevisionWriteDecision =
  | Readonly<{type: "terminal"; reason: string}>
  | Readonly<{type: "ready"}>
  | Readonly<{type: "invalid"}>
  | Readonly<{
    type: "write";
    patch: Readonly<Record<typeof restaurantWriteRevisionField, number>>;
  }>;

export function decideRestaurantInviteRevisionWrite(
  unavailableReason: string | null,
  restaurantData?: Readonly<Record<string, unknown>>,
): RestaurantInviteRevisionWriteDecision {
  if (unavailableReason !== null) {
    return Object.freeze({type: "terminal", reason: unavailableReason});
  }
  if (restaurantData === undefined) {
    return Object.freeze({type: "ready"});
  }
  const currentRevision = readRestaurantWriteRevision(restaurantData);
  const nextRevision = currentRevision === null
    ? null
    : nextRestaurantWriteRevision(currentRevision);
  if (nextRevision === null) {
    return Object.freeze({type: "invalid"});
  }
  return Object.freeze({
    type: "write",
    patch: Object.freeze({[restaurantWriteRevisionField]: nextRevision}),
  });
}

export type RevisionGuardedRestaurantGeohashWriteDecision<
  Patch extends Record<string, unknown>,
> =
  | Readonly<{type: "skip"}>
  | Readonly<{
    type: "write";
    preservedRevision: number;
    patch: Patch;
  }>;

export function decideRevisionGuardedRestaurantGeohashWrite<
  Patch extends Record<string, unknown>,
>(
  restaurantData: Readonly<Record<string, unknown>> | undefined,
  patchFactory: () => Patch | null,
): RevisionGuardedRestaurantGeohashWriteDecision<Patch> {
  const currentRevision = readRestaurantWriteRevision(restaurantData);
  if (currentRevision === null) {
    return Object.freeze({type: "skip"});
  }
  const patch = patchFactory();
  if (patch === null ||
      Object.keys(patch).length !== 1 ||
      !Object.prototype.hasOwnProperty.call(patch, "geohash")) {
    return Object.freeze({type: "skip"});
  }
  return Object.freeze({
    type: "write",
    preservedRevision: currentRevision,
    patch,
  });
}
