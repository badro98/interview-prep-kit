// Low-level localStorage adapter — the ONLY module allowed to touch localStorage.
// Feature code goes through store.js; store.js goes through here.
// Keys passed in are namespace-bare; the iprep: prefix is added internally.

const NS = "iprep:";

let quotaHandler = null;

/** Register a callback fired when a write fails on storage quota (null to clear). */
export function onQuotaError(handler) {
  quotaHandler = handler;
}

export function get(key, fallback = null) {
  try {
    const raw = localStorage.getItem(NS + key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function set(key, value) {
  try {
    localStorage.setItem(NS + key, JSON.stringify(value));
    return true;
  } catch (err) {
    if (err?.name === "QuotaExceededError" && quotaHandler) quotaHandler(key, err);
    return false;
  }
}

export function remove(key) {
  try {
    localStorage.removeItem(NS + key);
    return true;
  } catch {
    return false;
  }
}

/** All keys in our namespace (namespace stripped), optionally filtered by prefix. */
export function listKeys(prefix = "") {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(NS)) continue;
    const bare = k.slice(NS.length);
    if (bare.startsWith(prefix)) keys.push(bare);
  }
  return keys;
}
