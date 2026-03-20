class TtlCache {
  constructor({ ttlMs = 30000 } = {}) {
    this.ttlMs = ttlMs;
    this.store = new Map();
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
    const entry = this.store.get(key);
    if (this._deleteIfExpired(key, entry)) {
      return undefined;
    }

    return entry ? entry.value : undefined;
  }

  set(key, value, ttlMs = this.ttlMs) {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs
    });
    return value;
  }

  delete(key) {
    this.store.delete(key);
  }

  deleteWhere(predicate) {
    for (const [key, entry] of this.store.entries()) {
      if (this._deleteIfExpired(key, entry)) {
        continue;
      }

      if (predicate(key, entry.value)) {
        this.store.delete(key);
      }
    }
  }

  clear() {
    this.store.clear();
  }
}

module.exports = TtlCache;
