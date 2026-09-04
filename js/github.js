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

/** fetch() with the token attached when present. Safe to use for any github.com/*.githubusercontent.com URL. */
async function githubFetch(url, opts = {}) {
  const headers = { ...githubHeaders(), ...(opts.headers || {}) };
  return fetch(url, { ...opts, headers });
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
