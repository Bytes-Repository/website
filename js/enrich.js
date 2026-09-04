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

async function fetchManifestSafe(ids) {
  for (const branch of ["main", "master"]) {
    try {
      const res = await githubFetch(
        `https://raw.githubusercontent.com/${ids.owner}/${ids.repo}/${branch}/bytes.hk`,
        { cache: "no-store" }
      );
      if (res.ok) return await res.text();
    } catch {
      /* try next branch */
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

  const [languages, manifest, lastCommit] = await Promise.all([
    fetchJsonSafe(`https://api.github.com/repos/${ids.owner}/${ids.repo}/languages`),
    fetchManifestSafe(ids),
    fetchLastCommitDate(ids, "bytes.hk"),
  ]);

  const primaryLanguage =
    languages && Object.keys(languages).length
      ? Object.entries(languages).sort((a, b) => b[1] - a[1])[0][0]
      : null;

  const parsed = manifest ? parseBytesHk(manifest) : null;
  const pkg = (parsed && parsed.package) || {};
  const stats = (parsed && parsed.stats) || {};
  const deps = (parsed && parsed.deps) || {};

  const result = {
    owner: ids.owner,
    repo: ids.repo,
    language: primaryLanguage,
    description: pkg.description || null,
    version: pkg.version || null,
    license: pkg.license || null,
    authors: Array.isArray(pkg.authors) ? pkg.authors : pkg.authors ? [pkg.authors] : [],
    downloads: typeof stats.downloads === "number" ? stats.downloads : null,
    stars: typeof stats.stars === "number" ? stats.stars : null,
    tags: Array.isArray(stats.tags) ? stats.tags : [],
    deps,
    depCount: Object.keys(deps).length,
    lastCommit: lastCommit || null,
  };

  cacheSet(cacheKey, result, TTL.ENRICH);
  return result;
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
