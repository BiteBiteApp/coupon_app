"use strict";
function compare(left, right) {
  if (left instanceof Uint8Array && right instanceof Uint8Array) return Buffer.compare(left, right);
  const timestampParts = (value) => {
    if (value instanceof Date) {
      const seconds = Math.floor(value.getTime() / 1_000);
      return {seconds, nanoseconds: (value.getTime() - seconds * 1_000) * 1_000_000};
    }
    if (value !== null && typeof value === "object") {
      const seconds = value.seconds ?? value._seconds;
      const nanoseconds = value.nanoseconds ?? value._nanoseconds;
      if (Number.isSafeInteger(seconds) && Number.isSafeInteger(nanoseconds)) {
        return {seconds, nanoseconds};
      }
    }
    return null;
  };
  const leftTimestamp = timestampParts(left);
  const rightTimestamp = timestampParts(right);
  if (leftTimestamp !== null && rightTimestamp !== null) {
    if (leftTimestamp.seconds !== rightTimestamp.seconds) {
      return leftTimestamp.seconds < rightTimestamp.seconds ? -1 : 1;
    }
    if (leftTimestamp.nanoseconds !== rightTimestamp.nanoseconds) {
      return leftTimestamp.nanoseconds < rightTimestamp.nanoseconds ? -1 : 1;
    }
    return 0;
  }
  const a = left instanceof Date ? left.getTime() : left;
  const b = right instanceof Date ? right.getTime() : right;
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (typeof a === "string" && typeof b === "string") {
    return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
  }
  return a < b ? -1 : 1;
}

class MemoryDatabase {
  constructor() {
    this.documents = new Map();
    this.queries = [];
    this.gets = [];
    this.getMany = [];
    this.writes = [];
    this.failQuery = false;
  }

  set(path, data) {
    this.documents.set(path, data);
  }

  stored(path) {
    const data = this.documents.get(path);
    return data === undefined ? null : Object.freeze({
      id: path.slice(path.lastIndexOf("/") + 1),
      path,
      data,
    });
  }

  async getDocument(path) {
    this.gets.push(path);
    return this.stored(path);
  }

  async getDocuments(paths) {
    this.getMany.push([...paths]);
    return paths.map((path) => this.stored(path));
  }

  async queryDocuments(query) {
    this.queries.push(query);
    if (this.failQuery) throw new Error("query failure canary");
    const prefix = `${query.collectionPath}/`;
    let documents = [...this.documents.keys()]
      .filter((path) =>
        path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .map((path) => this.stored(path));
    for (const filter of query.filters) {
      documents = documents.filter((document) => {
        const candidate = filter.field === "__name__"
          ? document.id
          : document.data[filter.field];
        if (filter.operation === "in") {
          return Array.isArray(filter.value) && filter.value.includes(candidate);
        }
        const ordering = compare(candidate, filter.value);
        if (filter.operation === "==") return ordering === 0;
        if (filter.operation === ">=") return ordering >= 0;
        if (filter.operation === "<=") return ordering <= 0;
        if (filter.operation === ">") return ordering > 0;
        return ordering < 0;
      });
    }
    documents.sort((left, right) => {
      for (const order of query.orders) {
        const leftValue = order.field === "__name__"
          ? left.id
          : left.data[order.field];
        const rightValue = order.field === "__name__"
          ? right.id
          : right.data[order.field];
        const ordering = compare(leftValue, rightValue);
        if (ordering !== 0) {
          return order.direction === "desc" ? -ordering : ordering;
        }
      }
      return 0;
    });
    if (query.startAfter !== undefined) {
      documents = documents.filter((document) => {
        for (let index = 0; index < query.orders.length; index += 1) {
          const order = query.orders[index];
          const value = order.field === "__name__"
            ? document.id
            : document.data[order.field];
          const ordering = compare(value, query.startAfter[index]) *
            (order.direction === "desc" ? -1 : 1);
          if (ordering !== 0) return ordering > 0;
        }
        return false;
      });
    }
    return documents.slice(0, query.limit);
  }

  async runTransaction(operation) {
    const staged = [];
    const result = await operation({
      getDocument: (path) => this.getDocument(path),
      getDocuments: (paths) => this.getDocuments(paths),
      queryDocuments: (query) => this.queryDocuments(query),
      createDocument: (path, data) => staged.push({type: "create", path, data}),
      setDocument: (path, data) => staged.push({type: "set", path, data}),
      deleteDocument: (path) => staged.push({type: "delete", path}),
    });
    for (const write of staged) {
      if (write.type === "create" && this.documents.has(write.path)) {
        throw new Error(`document already exists: ${write.path}`);
      }
      if (write.type === "delete") this.documents.delete(write.path);
      else this.documents.set(write.path, write.data);
    }
    this.writes.push(...staged);
    return result;
  }

  async commitWrites(writes) {
    this.writes.push(...writes);
  }
}

module.exports = {MemoryDatabase};
