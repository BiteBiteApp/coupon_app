import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";

let qualified = false;
/** The recovered conservative-distance proof is runtime-specific. Gate 1 must
 * qualify its Linux runtime explicitly before adding another approved tuple.
 */
export function requireQualifiedPostgisRuntime(): void {
  if (process.env.NODE_OPTIONS || process.execArgv.some(value =>
    !value.startsWith("--test") && value !== "--max-old-space-size=512")) {
    throw new Error("PostGIS exact-distance runtime flags are unqualified.");
  }
  if (qualified) return;
  if (process.version !== "v24.21.0" || process.versions.v8 !== "13.6.233.17-node.53" ||
      process.platform !== "darwin" || process.arch !== "arm64" ||
      createHash("sha256").update(readFileSync(process.execPath)).digest("hex") !==
        "e4b5a3af0e05c75de2eae013904145f40fe7fc2a6e6f17510128bf45cca4e79b") {
    throw new Error("PostGIS exact-distance runtime is unqualified; run the compatibility gate first.");
  }
  qualified = true;
}
