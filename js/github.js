const GH_TOKEN_KEY = "bytesio:gh-token";

function getGithubToken() {
  try {
    return localStorage.getItem(GH_TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

function setGithubToken(token) {
  try {
    if (token) localStorage.setItem(GH_TOKEN_KEY, token);
    else localStorage.removeItem(GH_TOKEN_KEY);
    return true;
  } catch {
    return false;
  }
}

function hasGithubToken() {
  return !!getGithubToken();
}

function githubHeaders(extra = {}) {
  const token = getGithubToken();
  const headers = { Accept: "application/vnd.github+json", ...extra };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/**
 * Last known api.github.com rate-limit state, read off response headers —
 * every api.github.com response includes x-ratelimit-remaining/limit/reset
 * for free, so this costs nothing extra to track. raw.githubusercontent.com
 * responses don't send these headers, so this only ever updates from real
 * API calls. Session-only (a fresh page load starts blind again, which is
 * fine — the first api.github.com call re-populates it immediately).
 */
let lastKnownRateLimit = null;

function trackRateLimitFromResponse(res) {
  const remaining = res?.headers?.get?.("x-ratelimit-remaining");
  if (remaining == null) return; // not an api.github.com response
  const limit = res.headers.get("x-ratelimit-limit");
  const reset = res.headers.get("x-ratelimit-reset");
  lastKnownRateLimit = {
    remaining: Number(remaining),
    limit: limit != null ? Number(limit) : null,
    resetAt: reset != null ? Number(reset) * 1000 : null, // header is unix seconds
  };
}

/** { remaining, limit, resetAt } from the most recent api.github.com response this session, or null before the first one. */
function getKnownRateLimit() {
  return lastKnownRateLimit;
}

/** True once a response has told us the budget is nearly exhausted. Used to
 * skip firing lower-priority api.github.com calls (like the manifest
 * changelog) pre-emptively instead of spending a round trip on a request
 * that would just 403 anyway, so what little budget remains goes to the
 * core features (manifest, languages, source browser) instead.
 */
function isRateBudgetLow(threshold = 3) {
  return lastKnownRateLimit != null && lastKnownRateLimit.remaining <= threshold;
}

/**
 * A short "resets at 3:45 PM" / "resets in ~12 min" string from the last
 * known rate-limit state, or null if nothing's been tracked yet this
 * session. GitHub's unauthenticated limit (60/hour) is shared by every
 * request from the same IP address — not per browser, per tab, or per
 * day — so it can already be exhausted the very first time someone opens
 * the page today if that IP used it up earlier (their own testing, a
 * shared office/campus network, etc). Showing the concrete reset time
 * makes that distinction obvious instead of looking like a broken retry.
 */
function rateLimitResetNote() {
  if (!lastKnownRateLimit?.resetAt) return null;
  const msLeft = lastKnownRateLimit.resetAt - Date.now();
  if (msLeft <= 0) return "resets any moment now";
  const minutes = Math.ceil(msLeft / 60_000);
  const clock = new Date(lastKnownRateLimit.resetAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return minutes <= 1 ? `resets any moment now (~${clock})` : `resets in ~${minutes} min (~${clock})`;
}

/** fetch() with the token attached when present. Safe to use for any github.com/*.githubusercontent.com URL. */
async function githubFetch(url, opts = {}) {
  const headers = { ...githubHeaders(), ...(opts.headers || {}) };
  const res = await fetch(url, { ...opts, headers });
  trackRateLimitFromResponse(res);
  return res;
}

/** Like githubFetch, but returns parsed JSON or null, and flags auth/rate-limit failures distinctly. */
async function githubFetchJson(url, opts = {}) {
  try {
    const res = await githubFetch(url, opts);
    if (res.status === 401) {
      const err = new Error("GitHub token was rejected (401) — check it's valid and not expired.");
      err.status = 401;
      throw err;
    }
    if (res.status === 403) {
      const remaining = res.headers.get("x-ratelimit-remaining");
      const err = new Error(
        remaining === "0"
          ? "GitHub API rate limit hit. Add a token in the settings (key icon) to raise the limit."
          : "GitHub API request forbidden (403)."
      );
      err.status = 403;
      throw err;
    }
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    if (e && e.status) throw e;
    return null;
  }
}

/** Current rate-limit status for whatever credentials (or lack thereof) are in use. */
async function githubRateLimit() {
  try {
    const res = await githubFetch("https://api.github.com/rate_limit");
    if (!res.ok) return null;
    const data = await res.json();
    return data.resources?.core || null;
  } catch {
    return null;
  }
}
