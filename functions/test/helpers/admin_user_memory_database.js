"use strict";
const assert = require("node:assert/strict");

class AdminUserMemoryDatabase {
  constructor(initial = {}) {
    this.records = new Map(Object.entries(initial));
    this.operations = [];
    this.transactionCount = 0;
    this.tail = Promise.resolve();
    this.failRead = null;
  }
  runTransaction(operation) {
    const execute = async () => {
      const transactionId = ++this.transactionCount;
      const writes = [];
      const read = (path) => {
        assert.equal(writes.length, 0, "Firestore requires all reads before writes");
        if (this.failRead?.(path)) throw new Error("synthetic read failure");
      };
      const result = await operation({
        getDocument: async path => {
          read(path); this.operations.push({transactionId, operation: "get", path});
          return this.records.has(path) ? {id: path.split("/").at(-1), data: structuredClone(this.records.get(path))} : null;
        },
        queryDocuments: async query => {
          read(query.collectionPath); this.operations.push({transactionId, operation: "query", query});
          const prefix = query.collectionPath + "/";
          let rows = [...this.records].filter(([path]) => path.startsWith(prefix) && path.split("/").length === prefix.split("/").length)
            .map(([path, data]) => ({id: path.slice(prefix.length), data: structuredClone(data)}))
            .filter(row => !query.where || row.data[query.where.field] === query.where.value)
            .filter(row => !query.idPrefix || row.id.startsWith(query.idPrefix));
          for (const order of [...query.orderBy].reverse()) {
            const value = row => order.field === "__name__" ? row.id : row.data[order.field];
            rows.sort((a, b) => (value(a) < value(b) ? -1 : value(a) > value(b) ? 1 : 0) * (order.direction === "desc" ? -1 : 1));
          }
          if (query.startAfter !== undefined) rows = rows.filter(row => row.id > query.startAfter);
          return rows.slice(0, query.limit);
        },
        setDocument: (path, data) => writes.push({path, data: structuredClone(data), operation: "set"}),
        deleteDocument: path => writes.push({path, operation: "delete"}),
      });
      for (const write of writes) {
        this.operations.push({transactionId, ...write});
        if (write.operation === "delete") this.records.delete(write.path);
        else this.records.set(write.path, write.data);
      }
      return result;
    };
    const promise = this.tail.then(execute, execute);
    this.tail = promise.then(() => undefined, () => undefined);
    return promise;
  }
}
module.exports = {AdminUserMemoryDatabase};
