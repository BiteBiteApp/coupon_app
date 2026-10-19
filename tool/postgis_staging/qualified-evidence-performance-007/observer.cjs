"use strict";
const {appendFileSync} = require("node:fs");
const {AsyncLocalStorage} = require("node:async_hooks");
const {performance, monitorEventLoopDelay, PerformanceObserver} = require("node:perf_hooks");
const {createRequire} = require("node:module");
const requireSource = createRequire(process.env.BS_PERF_SOURCE + "/functions/package.json");
function observe(runtime, database) {
  const destination = process.env.BS_POSTGIS_FLUTTER_TIMINGS;
  if (!destination) return runtime;
  const active = new AsyncLocalStorage();
  const parents = new AsyncLocalStorage();
  let sequence = 0;
  async function measure(kind, operation, paths = [], sdk = false) {
    const observation = active.getStore();
    if (!observation) return operation();
    const metric = observation.operations[kind] ??= {calls: 0, milliseconds: 0, failures: 0};
    metric.calls++;
    for (const path of paths) {
      const prefix = sdk ? "sdk" : "authority";
      observation[`${prefix}RequestedDocuments`]++;
      if (observation[`${prefix}DocumentPaths`].has(path)) observation[`${prefix}RepeatedDocumentReads`]++;
      observation[`${prefix}DocumentPaths`].add(path);
    }
    const start = performance.now();
    const span = {id: observation.spans.length, parent: parents.getStore() ?? null, kind, start: start - observation.started};
    observation.spans.push(span);
    try {
      const result = await parents.run(span.id, operation);
      if (kind.endsWith("queryDocuments")) observation.authorityQueryReturnedDocuments += result.length;
      if (sdk && result && Array.isArray(result.docs)) observation.sdkQueryReturnedDocuments += result.docs.length;
      if (kind === "sql.allStatements" && result && Array.isArray(result.rows)) observation.sqlReturnedRows += result.rows.length;
      return result;
    }
    catch (error) { metric.failures++; throw error; }
    finally { span.end = performance.now() - observation.started; metric.milliseconds += span.end - span.start; }
  }
  // SDK boundary counters include the source-fence reads as well as customer
  // authority. They are distinct from the historical adapter counters below.
  // DocumentReference.get delegates to Firestore.getAll; transaction.get uses
  // its own SDK reader. Counting only these leaves avoids duplicate requests.
  const {Query, DocumentReference} = requireSource("@google-cloud/firestore");
  const documentPaths = args => args.filter(value => value instanceof DocumentReference).map(value => value.path);
  const instrumentedTransactions = new WeakSet();
  const sdkGetAll = database.getAll.bind(database);
  database.getAll = (...args) => measure("sdk.getAll", () => sdkGetAll(...args),
    documentPaths(args), true);
  const sdkTransaction = database.runTransaction.bind(database);
  database.runTransaction = (operation, ...options) => measure("sdk.transaction", () =>
    sdkTransaction(tx => {
      const observation = active.getStore();
      if (observation) observation.sdkTransactionAttempts++;
      if (!instrumentedTransactions.has(tx)) {
        instrumentedTransactions.add(tx);
        for (const name of ["get", "getAll", "commit", "rollback"]) {
          const original = tx[name].bind(tx);
          tx[name] = (...args) => measure(`sdk.transaction.${name}`, () => original(...args), documentPaths(args), true);
        }
      }
      return operation(tx);
    }, ...options));
  const sdkQueryGet = Query.prototype.get;
  Query.prototype.get = function (...args) {
    return measure("sdk.query", () => sdkQueryGet.apply(this, args), [], true);
  };
  // Wrap borrowed clients once; pool.query also borrows a client, so it is not
  // separately wrapped. BEGIN/COMMIT, admission and selector statements count.
  const instrumented = new WeakSet();
  function instrumentClient(client) {
    if (!instrumented.has(client)) {
      instrumented.add(client);
      const query = client.query.bind(client);
      client.query = (...args) => {
        if (typeof args.at(-1) === "function") {
          const callback = args.pop();
          measure("sql.allStatements", () => new Promise((resolve, reject) => {
            query(...args, (error, result) => error ? reject(error) : resolve(result));
          })).then(result => callback(null, result), error => callback(error));
          return;
        }
        return measure("sql.allStatements", () => query(...args));
      };
    }
    return client;
  }
  const connect = runtime.pool.connect.bind(runtime.pool);
  runtime.pool.connect = (...args) => {
    if (typeof args[0] === "function") {
      return measure("sql.acquire", () => new Promise((resolve, reject) => connect((error, client, release) => {
        if (error) reject(error); else resolve({client: instrumentClient(client), release});
      }))).then(({client,release})=>args[0](null,client,release),error=>args[0](error));
    }
    return measure("sql.acquire", () => connect(...args).then(instrumentClient));
  };
  function reads(target, prefix) {
    for (const name of ["getDocument", "getDocuments", "queryDocuments"]) {
      const original = target[name].bind(target);
      target[name] = (...args) => measure(`${prefix}.${name}`, () => original(...args),
        name === "getDocument" ? [args[0]] : name === "getDocuments" ? args[0] : []);
    }
  }
  reads(runtime.authority, "firestore");
  const commit = runtime.authority.commitWrites.bind(runtime.authority);
  runtime.authority.commitWrites = (...args) => measure("firestore.commitWrites", () => commit(...args));
  const transaction = runtime.authority.runTransaction.bind(runtime.authority);
  runtime.authority.runTransaction = operation => measure("firestore.transaction", () => transaction(tx => {
    reads(tx, "firestore.transactionRead");
    return operation(tx);
  }));
  for (const name of ["pinRevision", "queryResults"]) {
    const original = runtime.provider[name].bind(runtime.provider);
    runtime.provider[name] = (...args) => measure(`membership.${name}`, () => original(...args));
  }
  const withPinnedRevision = runtime.model.withPinnedRevision.bind(runtime.model);
  runtime.model.withPinnedRevision = (revision, expiry, operation) => withPinnedRevision(revision, expiry, client =>
    operation({query: (...args) => measure("sql.membershipQuery", () => client.query(...args))}));
  return {...runtime, async invoke(name, request) {
    const observation = {sequence: ++sequence, endpoint: name, signed: Boolean(request.auth),
      authorityRequestedDocuments: 0, authorityRepeatedDocumentReads: 0, authorityDocumentPaths: new Set(),
      authorityQueryReturnedDocuments: 0, sdkRequestedDocuments: 0, sdkRepeatedDocumentReads: 0,
      sdkDocumentPaths: new Set(), sdkQueryReturnedDocuments: 0, sdkTransactionAttempts: 0,
      sqlReturnedRows: 0, operations: {}, spans: [], started: performance.now()};
    const cpu = process.cpuUsage(), elu = performance.eventLoopUtilization();
    const delay = monitorEventLoopDelay({resolution:10}); delay.enable();
    const gc = [];
    const gcObserver = new PerformanceObserver(list => { for (const e of list.getEntries()) gc.push({start:e.startTime-observation.started, duration:e.duration,kind:e.detail.kind}); });
    gcObserver.observe({entryTypes:["gc"]});
    const start = performance.now();
    return active.run(observation, async () => {
      try {
        const result = await runtime.invoke(name, request);
        observation.status = "success";
        observation.challengeCandidates = Array.isArray(result?.candidates) ? result.candidates.length : 0;
        return result;
      } catch (error) { observation.status = "failure"; throw error; }
      finally {
        observation.milliseconds = performance.now() - start;
        observation.cpu = process.cpuUsage(cpu);
        observation.eventLoop = performance.eventLoopUtilization(elu);
        delay.disable(); observation.eventLoopDelay = {meanMs:delay.mean/1e6,maxMs:delay.max/1e6,p99Ms:delay.percentile(99)/1e6};
        gcObserver.disconnect(); observation.gc = gc;
        observation.memory = process.memoryUsage(); delete observation.started;
        observation.authorityUniqueRequestedDocuments = observation.authorityDocumentPaths.size;
        observation.sdkUniqueRequestedDocuments = observation.sdkDocumentPaths.size;
        delete observation.authorityDocumentPaths;
        delete observation.sdkDocumentPaths;
        appendFileSync(destination, JSON.stringify(observation) + "\n");
      }
    });
  }};
}

module.exports = {observe};
