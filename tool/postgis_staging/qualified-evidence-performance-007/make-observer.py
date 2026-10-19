from pathlib import Path
r=Path(__file__).parent
host=(r/'baseline-source/functions/test/support/postgis_flutter_host.cjs').read_text()
s=host[host.index('function observe('):host.index('\nasync function main()')]
s=s.replace('const active = new AsyncLocalStorage();','const active = new AsyncLocalStorage();\n  const parents = new AsyncLocalStorage();')
s=s.replace('const start = performance.now();\n    try {\n      const result = await operation();','''const start = performance.now();
    const span = {id: observation.spans.length, parent: parents.getStore() ?? null, kind, start: start - observation.started};
    observation.spans.push(span);
    try {
      const result = await parents.run(span.id, operation);''')
s=s.replace('finally { metric.milliseconds += performance.now() - start; }','finally { span.end = performance.now() - observation.started; metric.milliseconds += span.end - span.start; }')
s=s.replace('return connect((error, client, release) => args[0](error, client && instrumentClient(client), release));','''return measure("sql.acquire", () => new Promise((resolve, reject) => connect((error, client, release) => {
        if (error) reject(error); else resolve({client: instrumentClient(client), release});
      }))).then(({client,release})=>args[0](null,client,release),error=>args[0](error));''')
s=s.replace('return connect(...args).then(instrumentClient);','return measure("sql.acquire", () => connect(...args).then(instrumentClient));')
s=s.replace('for (const name of ["get", "getAll"]) {','for (const name of ["get", "getAll", "commit", "rollback"]) {')
s=s.replace('sqlReturnedRows: 0, operations: {}};','''sqlReturnedRows: 0, operations: {}, spans: [], started: performance.now()};
    const cpu = process.cpuUsage(), elu = performance.eventLoopUtilization();
    const delay = monitorEventLoopDelay({resolution:10}); delay.enable();
    const gc = [];
    const gcObserver = new PerformanceObserver(list => { for (const e of list.getEntries()) gc.push({start:e.startTime-observation.started, duration:e.duration,kind:e.detail.kind}); });
    gcObserver.observe({entryTypes:["gc"]});''')
s=s.replace('observation.milliseconds = performance.now() - start;','''observation.milliseconds = performance.now() - start;
        observation.cpu = process.cpuUsage(cpu);
        observation.eventLoop = performance.eventLoopUtilization(elu);
        delay.disable(); observation.eventLoopDelay = {meanMs:delay.mean/1e6,maxMs:delay.max/1e6,p99Ms:delay.percentile(99)/1e6};
        gcObserver.disconnect(); observation.gc = gc;
        observation.memory = process.memoryUsage(); delete observation.started;''')
s='''"use strict";
const {appendFileSync} = require("node:fs");
const {AsyncLocalStorage} = require("node:async_hooks");
const {performance, monitorEventLoopDelay, PerformanceObserver} = require("node:perf_hooks");
const {createRequire} = require("node:module");
const requireSource = createRequire(process.env.BS_PERF_SOURCE + "/functions/package.json");
'''+s.replace('require("@google-cloud/firestore")','requireSource("@google-cloud/firestore")')+'\nmodule.exports = {observe};\n'
(r/'observer.cjs').write_text(s)
# Keep every source and fixture statement unchanged; replace only test observer.
custom=host[:host.index('function observe(')]+'const {observe} = require(process.env.BS_PERF_OBSERVER);\n'+host[host.index('\nasync function main()'):]
(r/'trace-flutter-host.cjs').write_text(custom)
