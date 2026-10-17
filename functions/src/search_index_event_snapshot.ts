/** Preserve unknown snapshot/read failure separately from a genuine deletion. */
export function readSearchIndexEventSnapshotData(snapshot: unknown): Record<string, unknown> | null | undefined {
  try {
    if (snapshot === null || typeof snapshot !== "object") return undefined;
    const exists = (snapshot as {exists?: unknown}).exists;
    if (exists === false) return null;
    if (exists !== true) return undefined;
    const readData = (snapshot as {data?: unknown}).data;
    if (typeof readData !== "function") return undefined;
    const data = readData.call(snapshot);
    return data !== null && typeof data === "object" && !Array.isArray(data)
      ? data as Record<string, unknown> : undefined;
  } catch { return undefined; }
}
