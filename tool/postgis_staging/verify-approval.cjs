"use strict";
// Offline subprocess boundary for the Python controller. No cloud imports.
const fs = require("node:fs"), path = require("node:path");
async function main() {
  if (process.argv.length !== 3 || !path.isAbsolute(process.argv[2])) throw Error("A separate absolute trusted-key file is required.");
  const keyFile = process.argv[2];
  if (fs.statSync(keyFile).size > 64 * 1024) throw Error("Trusted key file exceeds its bound.");
  const trust = JSON.parse(fs.readFileSync(keyFile, "utf8"));
  let bytes = 0, body = "";
  for await (const chunk of process.stdin) {bytes += chunk.length;if(bytes > 64*1024)throw Error("Approval input exceeds its bound.");body += chunk;}
  const input = JSON.parse(body);
  if (Object.keys(input).sort().join(",") !== "approval,expected") throw Error("Invalid verification input.");
  const {verifyPostgisExecutionApproval} = require("../../functions/lib/postgis_execution_approval.js");
  const claims = verifyPostgisExecutionApproval(input.approval, trust, input.expected);
  process.stdout.write(JSON.stringify({verified:true,claims}) + "\n");
}
if (require.main === module) main().catch(() => {process.stdout.write(JSON.stringify({verified:false,error:"approval_rejected"})+"\n");process.exitCode=1;});
module.exports = {main};
