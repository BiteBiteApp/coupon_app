'use strict';
// Report-only probe. No network, credentials, approval, SQL or application startup.
const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const sha = path => crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex');
const selected = Object.fromEntries(Object.entries(process.config.variables).filter(([k]) => /^(target_arch|host_arch|node_shared|v8_target_arch|v8_enable_|v8_use_)/.test(k)));
let cpu = [];
try { cpu = fs.readFileSync('/proc/cpuinfo','utf8').split('\n').filter(line => /^(vendor_id|model name|flags|Features|CPU architecture)\s*:/.test(line)).slice(0,3); } catch {}
let distribution = null;
try { distribution = fs.readFileSync('/etc/os-release','utf8'); } catch {}
console.log(JSON.stringify({kind:'actual-runtime-metadata-only',node:process.version,v8:process.versions.v8,platform:process.platform,arch:process.arch,execPath:process.execPath,nodeSha256:sha(process.execPath),execArgv:process.execArgv,nodeOptionsPresent:Boolean(process.env.NODE_OPTIONS),kernel:os.release(),machine:os.machine(),cpu,distribution,buildVariables:selected,servingQualified:false},null,2));
