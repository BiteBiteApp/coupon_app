import {createHash} from "node:crypto";
type Data = Record<string, any>;
export const ownerPhotoHash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export function ownerPhotoId(row: Data): string {
  return `bso_${ownerPhotoHash(JSON.stringify([row.uploaderUserId, row.authCreatedAt, row.ownerUserId, row.sourceType, row.sourceId,
    row.sourceVersion, row.family, row.targetId, row.targetVersion, row.contentType, row.sha256]))}`;
}
export function ownerPhotoPath(row: Data): string {
  return `bitescore_user_uploads/${ownerPhotoHash(`bitestar.dish-upload.v1:${row.ownerUserId}`)}/owner_images/screened_${row.imageId}.jpg`;
}
export function validOwnerPhotoIdentity(row: Data): boolean {
  return row.lane === "owner" && typeof row.ownerUserId === "string" && /^[^/\u0000-\u001f]{1,128}$/.test(row.ownerUserId) &&
    row.imageId === ownerPhotoId(row) && row.storagePath === ownerPhotoPath(row) && /^[a-f0-9]{64}$/.test(row.sha256 ?? "");
}
export function ownerPhotoMetadata(row: Data): Record<string, string> {
  return {ownershipVersion: "1", screeningImageId: row.imageId, screeningSha256: row.sha256,
    screeningUploadToken: row.uploadToken, uploaderKey: ownerPhotoHash(`bitestar.dish-upload.v1:${row.ownerUserId}`)};
}
export function ownerPhotoTargetPath(row: Data): string {
  const root = `${row.sourceType === "biteSaver" ? "restaurant_accounts" : "restaurant_menus"}/${row.sourceId}`;
  return row.family === "menu" ? `${root}/menu_images/${row.targetId}` : row.family === "coupon" ? `${root}/coupons/${row.targetId}` : root;
}
export function ownerPhotoBoundTargetPath(row: Data): string {
  return row.family === "managed" && !["gallery", "board"].includes(row.targetId) ?
    `restaurant_accounts/${row.sourceId}/daily_specials/${row.targetId}` : ownerPhotoTargetPath(row);
}
export function ownerPhotoPublicationPath(row: Data): string {
  return row.family === "managed" && row.targetId === "board" ?
    `restaurant_accounts/${row.sourceId}/daily_specials/bitesaver_managed_board` : ownerPhotoBoundTargetPath(row);
}
export function ownerPhotoIsAttached(row: Data, target: Data | undefined): boolean {
  if (!target || row.state !== "approved") return false;
  if (row.family === "managed") {
    if (row.targetId !== "gallery") return target.imageUrl === row.publicUrl &&
      (row.targetId === "board" || target.screeningTargetToken === row.targetToken);
    const media = target.ownerMedia;
    return !!media && media.images?.some((i: Data) => i.id === row.imageId && i.generation === row.generation && i.state === "ready") &&
      (media.gallery?.includes(row.imageId) || media.boardImage === row.imageId || Object.values(media.specialImages ?? {}).includes(row.imageId));
  }
  if (row.family === "main") return target.mainImageUrl === row.publicUrl ||
    (target.ownerMedia?.legacyMain === row.publicUrl && target.ownerMedia?.gallery?.includes("legacy-main"));
  return target.imageUrl === row.publicUrl;
}
