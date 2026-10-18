import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {cpus, release} from "node:os";

let qualified = false;
/** The conservative-distance proof is runtime-specific. The Linux tuple below
 * qualifies only the locally reviewed Rosetta environment, never a hosted run.
 */
export function requireQualifiedPostgisRuntime(scope: "local" | "hosted" = "local"): void {
  if (scope !== "local" && scope !== "hosted") {
    throw new Error("Invalid PostGIS numerical qualification scope.");
  }
  if (process.env.NODE_OPTIONS || process.execArgv.some(value =>
    !value.startsWith("--test") && value !== "--max-old-space-size=512")) {
    throw new Error("PostGIS exact-distance runtime flags are unqualified.");
  }
  // A preceding local call must never lend its cached qualification to hosted
  // execution. Hosted CPU/server compatibility remains a separate gate.
  if (process.platform === "linux" && scope === "hosted") {
    throw new Error("PostGIS hosted Linux runtime is unqualified; local qualification is insufficient.");
  }
  if (qualified) return;
  if (process.version !== "v24.21.0" || process.versions.v8 !== "13.6.233.17-node.53" ||
      !((process.platform === "darwin" && process.arch === "arm64" &&
        createHash("sha256").update(readFileSync(process.execPath)).digest("hex") ===
          "e4b5a3af0e05c75de2eae013904145f40fe7fc2a6e6f17510128bf45cca4e79b") ||
        (process.platform === "linux" && process.arch === "x64" &&
          release() === "7.0.14-linuxkit" && cpus().length > 0 &&
          cpus().every(cpu => cpu.model === "VirtualApple @ 2.50GHz") &&
          createHash("sha256").update(readFileSync(process.execPath)).digest("hex") ===
            "7fde7b8afa198da66257f42ee2001d874c7355631e6d1579a5fb5ef1f246df4c"))) {
    throw new Error("PostGIS exact-distance runtime is unqualified; run the compatibility gate first.");
  }
  qualified = true;
}
