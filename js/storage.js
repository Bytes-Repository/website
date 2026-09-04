const CACHE_PREFIX = "bytesio:cache:";

const TTL = {
  INDEX: 10 * 60 * 1000, // 10 min — index.json
  ENRICH: 6 * 60 * 60 * 1000, // 6h — per-repo language / manifest / commit data
  COMMITS: 30 * 60 * 1000, // 30 min — bytes.hk changelog
  USER: 60 * 60 * 1000, // 1h — GitHub user profile
  MANIFEST: 15 * 60 * 1000, // 15 min — raw bytes.hk contents on the repo page
  LANGS: 60 * 60 * 1000, // 1h — language breakdown on the repo page
};

function cacheGet(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const { value, expires } = JSON.parse(raw);
    if (expires && Date.now() > expires) {
      localStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function cacheSet(key, value, ttlMs) {
  try {
    const payload = JSON.stringify({
      value,
      expires: ttlMs ? Date.now() + ttlMs : null,
      savedAt: Date.now(),
    });
    localStorage.setItem(CACHE_PREFIX + key, payload);
    return true;
  } catch {
    return false; // storage full/disabled — caller should still work without cache
  }
}

function cacheRemove(key) {
  try {
    localStorage.removeItem(CACHE_PREFIX + key);
  } catch {
    /* ignore */
  }
}

/** Age of a cached entry in ms, or null if missing/unreadable — used for "cached Xm ago" UI. */
function cacheAge(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const { savedAt } = JSON.parse(raw);
    return savedAt ? Date.now() - savedAt : null;
  } catch {
    return null;
  }
}

/** Reads a stale cache entry even if it's past its TTL — used for stale-while-revalidate. */
function cacheGetStale(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    return JSON.parse(raw).value;
  } catch {
    return null;
  }
}

/** Formats an age in ms as "just now" / "3m ago" / "2h ago" — used for cache-freshness indicators. */
function formatAge(ms) {
  if (ms == null) return null;
  if (ms < 20_000) return "just now";
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (ms < min) return `${Math.round(ms / 1000)}s ago`;
  if (ms < hour) return `${Math.round(ms / min)}m ago`;
  if (ms < day) return `${Math.round(ms / hour)}h ago`;
  return `${Math.round(ms / day)}d ago`;
}
