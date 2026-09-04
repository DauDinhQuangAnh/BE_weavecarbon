const metrics = require('../operations/metrics');

class TtlCache {
  constructor({ ttlMs = 30000, owner = 'legacy', version = 'v1' } = {}) {
    this.ttlMs = ttlMs;
    this.owner = owner;
    this.version = version;
    this.store = new Map();
  }

  _storageKey(key) {
    return `${this.owner}:${this.version}:${String(key)}`;
  }

  _isExpired(entry) {
    return !entry || entry.expiresAt <= Date.now();
  }

  _deleteIfExpired(key, entry) {
    if (!this._isExpired(entry)) {
      return false;
    }

    this.store.delete(key);
    return true;
  }

  get(key) {
    const storageKey = this._storageKey(key);
    const entry = this.store.get(storageKey);
    if (this._deleteIfExpired(storageKey, entry)) {
      metrics.increment('weavecarbon_cache_requests_total', { cache: this.owner, result: 'expired' });
      return undefined;
    }
    metrics.increment('weavecarbon_cache_requests_total', {
      cache: this.owner, result: entry ? 'hit' : 'miss'
    });
    return entry ? entry.value : undefined;
  }

  set(key, value, ttlMs = this.ttlMs) {
    this.store.set(this._storageKey(key), {
      rawKey: key,
      value,
      expiresAt: Date.now() + ttlMs
    });
    return value;
  }

  delete(key) {
    this.store.delete(this._storageKey(key));
  }

  deleteWhere(predicate) {
    for (const [storageKey, entry] of this.store.entries()) {
      if (this._deleteIfExpired(storageKey, entry)) {
        continue;
      }

      if (predicate(entry.rawKey, entry.value)) {
        this.store.delete(storageKey);
      }
    }
  }

  clear() {
    this.store.clear();
  }

  policy() {
    return { owner: this.owner, version: this.version, ttlMs: this.ttlMs };
  }
}

module.exports = TtlCache;
