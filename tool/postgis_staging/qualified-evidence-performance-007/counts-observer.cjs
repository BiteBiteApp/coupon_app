const {appendFileSync}=require("node:fs"), {AsyncLocalStorage}=require("node:async_hooks"),{performance}=require("node:perf_hooks"),{createRequire}=require("node:module"); const requireSource=createRequire(process.env.BS_PERF_SOURCE+"/functions/package.json");
function observe(runtime, database) {
  const destination = process.env.BS_POSTGIS_FLUTTER_TIMINGS;
  if (!destination) return runtime;
  const active = new AsyncLocalStorage();
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
    try {
      const result = await operation();
      if (kind.endsWith("queryDocuments")) observation.authorityQueryReturnedDocuments += result.length;
      if (sdk && result && Array.isArray(result.docs)) observation.sdkQueryReturnedDocuments += result.docs.length;
      if (kind === "sql.allStatements" && result && Array.isArray(result.rows)) observation.sqlReturnedRows += result.rows.length;
      return result;
    }
    catch (error) { metric.failures++; throw error; }
    finally { metric.milliseconds += performance.now() - start; }
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
        for (const name of ["get", "getAll"]) {
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
      return connect((error, client, release) => args[0](error, client && instrumentClient(client), release));
    }
    return connect(...args).then(instrumentClient);
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
      sqlReturnedRows: 0, operations: {}};
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
        observation.authorityUniqueRequestedDocuments = observation.authorityDocumentPaths.size;
        observation.sdkUniqueRequestedDocuments = observation.sdkDocumentPaths.size;
        delete observation.authorityDocumentPaths;
        delete observation.sdkDocumentPaths;
        appendFileSync(destination, JSON.stringify(observation) + "\n");
      }
    });
  }};
}

module.exports={observe};
