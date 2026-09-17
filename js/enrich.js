function ownerRepoFromUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    return { owner: parts[0], repo: parts[1] };
  } catch {
    return null;
  }
}

async function fetchJsonSafe(url) {
  try {
    const res = await githubFetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Real bytes.io manifests are checked into repos as "Bytes.hk" (capital B),
 * not "bytes.hk". Some repos may still use the all-lowercase spelling, so
 * both are tried. Filenames are tried in this order against every branch
 * candidate until one resolves.
 */
const MANIFEST_FILENAMES = ["Bytes.hk", "bytes.hk", "BYTES.HK"];

/** De-dupes while preserving order — used to put the repo's real default branch first. */
function uniq(list) {
  return [...new Set(list.filter(Boolean))];
}

function manifestCandidateUrls(ids, branches) {
  const urls = [];
  for (const branch of branches) {
    for (const file of MANIFEST_FILENAMES) {
      urls.push(`https://raw.githubusercontent.com/${ids.owner}/${ids.repo}/${branch}/${file}`);
      urls.push(`https://cdn.jsdelivr.net/gh/${ids.owner}/${ids.repo}@${branch}/${file}`);
    }
  }
  return urls;
}

/**
 * Fetches top-level GitHub repo metadata (description, stars, forks,
 * default branch, license, topics, ...). This is what actually backs a
 * repo's description on GitHub itself — separate from anything a project
 * chooses to put inside its own Bytes.hk manifest — so it's used both to
 * find the right default branch and as a description fallback when the
 * manifest doesn't declare one (or can't be found at all).
 *
 * Skips the network call entirely when a still-fresh cached copy exists
 * (cacheGet respects TTL.REPO_META) — every page visit used to re-fetch
 * this unconditionally regardless of how recently it was already fetched,
 * which was pure waste against the unauthenticated 60/hour budget for
 * anyone revisiting a repo, or navigating between repos that share an
 * owner, within the same hour.
 */
async function fetchRepoMeta(ids) {
  const cacheKey = `repometa:${ids.owner}/${ids.repo}`;
  const fresh = cacheGet(cacheKey);
  if (fresh) return fresh;

  const cached = cacheGetStale(cacheKey); // possibly-expired fallback if the network call below fails
  if (fetchRepoMeta._inflight?.has(cacheKey)) return fetchRepoMeta._inflight.get(cacheKey);

  const promise = (async () => {
    try {
      const res = await githubFetch(`https://api.github.com/repos/${ids.owner}/${ids.repo}`);
      if (!res.ok) return cached || null;
      const data = await res.json();
      cacheSet(cacheKey, data, TTL.REPO_META);
      return data;
    } catch {
      return cached || null;
    }
  })();

  fetchRepoMeta._inflight = fetchRepoMeta._inflight || new Map();
  fetchRepoMeta._inflight.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    fetchRepoMeta._inflight.delete(cacheKey);
  }
}

/** Tries every (branch × filename × host) manifest candidate, returns { text, url } for the first hit. */
async function fetchManifestSafe(ids, defaultBranch) {
  const branches = uniq([defaultBranch, "main", "master"]);
  for (const url of manifestCandidateUrls(ids, branches)) {
    try {
      const res = await githubFetch(url, { cache: "no-store" });
      if (res.ok) return { text: await res.text(), url };
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

async function fetchLastCommitDate(ids, path) {
  const data = await fetchJsonSafe(
    `https://api.github.com/repos/${ids.owner}/${ids.repo}/commits?path=${encodeURIComponent(path)}&per_page=1`
  );
  if (Array.isArray(data) && data[0]) {
    return data[0].commit?.committer?.date || data[0].commit?.author?.date || null;
  }
  return null;
}

/** Enriches one library. Cached per-URL for TTL.ENRICH so repeat visits skip the network. */
async function enrichLibrary(lib) {
  const cacheKey = `enrich:${lib.url}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const ids = ownerRepoFromUrl(lib.url);
  if (!ids) return null;

  const meta = await fetchRepoMeta(ids);

  const [languages, manifestResult, lastCommit] = await Promise.all([
    fetchJsonSafe(`https://api.github.com/repos/${ids.owner}/${ids.repo}/languages`),
    fetchManifestSafe(ids, meta?.default_branch),
    fetchLastCommitDate(ids, "Bytes.hk"),
  ]);

  const primaryLanguage =
    languages && Object.keys(languages).length
      ? Object.entries(languages).sort((a, b) => b[1] - a[1])[0][0]
      : null;

  const manifest = manifestResult?.text || null;
  const parsed = manifest ? parseBytesHk(manifest) : null;
  const pkg = (parsed && parsed.package) || {};
  const stats = (parsed && parsed.stats) || {};
  const deps = (parsed && parsed.deps) || {};

  const result = {
    owner: ids.owner,
    repo: ids.repo,
    language: primaryLanguage,
    // Prefer the description declared in the manifest itself; fall back to
    // the repo's actual GitHub description (Settings → repo description)
    // when the manifest doesn't have one or couldn't be found at all.
    description: pkg.description || meta?.description || null,
    version: pkg.version || null,
    license: pkg.license || meta?.license?.spdx_id || meta?.license?.name || null,
    authors: Array.isArray(pkg.authors) ? pkg.authors : pkg.authors ? [pkg.authors] : [],
    downloads: typeof stats.downloads === "number" ? stats.downloads : null,
    stars: typeof stats.stars === "number" ? stats.stars : typeof meta?.stargazers_count === "number" ? meta.stargazers_count : null,
    tags: Array.isArray(stats.tags) ? stats.tags : Array.isArray(meta?.topics) ? meta.topics : [],
    deps,
    depCount: Object.keys(deps).length,
    lastCommit: lastCommit || meta?.pushed_at || null,
    manifestFound: !!manifest,
  };

  cacheSet(cacheKey, result, TTL.ENRICH);
  return result;
}

/**
 * Fetches the full recursive git tree for the first branch that resolves.
 * Shared by language detection (custom-extension byte counting, in repo.js)
 * and the source browser (source-browser.js) so both features together
 * still cost a single GitHub API call instead of two.
 *
 * Skips the network call entirely when a still-fresh cached copy exists
 * (same reasoning as fetchRepoMeta above) — this is the single heaviest
 * api.github.com call the page makes, so avoiding a redundant repeat of it
 * matters most here.
 *
 * Always resolves to an object — never null — so callers don't need a
 * separate null-check path: entries is [] and error is set on failure.
 * error is "rate-limit" (403 with quota exhausted), "not-found" (every
 * branch 404'd — usually means `branches` didn't include the repo's real
 * default branch), or null on success.
 */
async function fetchRepoTree(ids, branches) {
  const cacheKey = `tree:${ids.owner}/${ids.repo}`;
  const fresh = cacheGet(cacheKey);
  if (fresh) return fresh;

  const cached = cacheGetStale(cacheKey);
  if (fetchRepoTree._inflight?.has(cacheKey)) return fetchRepoTree._inflight.get(cacheKey);

  const promise = (async () => {
    // Budget already known to be at (or near) zero from an earlier call
    // this session — don't spend one of the last requests on a call that
    // would almost certainly just 403. Fall back to whatever we have
    // cached, even if stale, rather than trying anyway.
    if (typeof isRateBudgetLow === "function" && isRateBudgetLow()) {
      console.warn(`[bytes.io] fetchRepoTree: skipping network call for ${ids.owner}/${ids.repo} — rate budget already low`);
      return cached ? { ...cached, error: null } : { branch: null, truncated: false, entries: [], error: "rate-limit" };
    }

    const attempts = [];
    for (const branch of uniq(branches)) {
      try {
        const res = await githubFetch(
          `https://api.github.com/repos/${ids.owner}/${ids.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`
        );
        if (res.status === 403) {
          const remaining = res.headers.get("x-ratelimit-remaining");
          if (remaining === "0") {
            console.warn(`[bytes.io] fetchRepoTree rate-limited for ${ids.owner}/${ids.repo}`);
            return cached ? { ...cached, error: null } : { branch: null, truncated: false, entries: [], error: "rate-limit" };
          }
          attempts.push(`${branch} → 403`);
          continue;
        }
        if (!res.ok) {
          attempts.push(`${branch} → HTTP ${res.status}`);
          continue;
        }
        const data = await res.json();
        if (!Array.isArray(data.tree)) {
          attempts.push(`${branch} → response had no tree array`);
          continue;
        }
        const result = {
          branch,
          truncated: !!data.truncated,
          entries: data.tree.filter((e) => e.type === "blob" || e.type === "tree"),
          error: null,
        };
        cacheSet(cacheKey, result, TTL.TREE);
        return result;
      } catch (err) {
        attempts.push(`${branch} → ${err.message}`);
      }
    }
    if (cached) return { ...cached, error: null };
    console.warn(`[bytes.io] fetchRepoTree: no branch resolved for ${ids.owner}/${ids.repo} (tried: ${branches.join(", ") || "none"}) — ${attempts.join(" | ")}`);
    return { branch: null, truncated: false, entries: [], error: "not-found" };
  })();

  fetchRepoTree._inflight = fetchRepoTree._inflight || new Map();
  fetchRepoTree._inflight.set(cacheKey, promise);
  try {
    return await promise;
  } finally {
    fetchRepoTree._inflight.delete(cacheKey);
  }
}

/** Extracts a lowercased file extension, handling multi-char ones like "h#" and "h#i". */
function extensionOf(path) {
  const name = path.split("/").pop() || "";
  const dot = name.indexOf(".");
  if (dot === -1) return "";
  return name.slice(dot + 1).toLowerCase();
}

/** Formats a raw integer as a compact count, e.g. 15234 -> "15.2k", 2100000 -> "2.1M". */
function formatCount(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(num);
}

/** HTML-escapes text for safe insertion into markup or an attribute value. */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Enriches many libraries with a small concurrency cap so the page doesn't
 * fire dozens of requests at once. Calls onEach(lib, data, index) as each
 * one resolves, so the UI can update progressively instead of blocking.
 */
async function enrichLibraries(libs, onEach, concurrency = 4) {
  let cursor = 0;
  async function worker() {
    while (cursor < libs.length) {
      const idx = cursor++;
      const lib = libs[idx];
      let data = null;
      try {
        data = await enrichLibrary(lib);
      } catch {
        data = null;
      }
      onEach(lib, data, idx);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, libs.length) }, worker);
  await Promise.all(workers);
}
