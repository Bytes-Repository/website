const INDEX_SOURCES = [
  "https://raw.githubusercontent.com/Bytes-Repository/repository/main/index.json",
  "https://cdn.jsdelivr.net/gh/Bytes-Repository/repository@main/index.json",
];
const INDEX_CACHE_KEY = "index.json";
const SEEN_LIBS_KEY = "seen-libraries"; // name -> first-seen ISO date (durable, no TTL)

async function fetchIndexJsonLive() {
  const failures = [];
  for (const url of INDEX_SOURCES) {
    try {
      const bust = url.includes("?") ? "&" : "?";
      const res = await fetch(`${url}${bust}_=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) {
        failures.push(`${new URL(url).hostname} → HTTP ${res.status}`);
        continue;
      }
      const raw = await res.json();
      console.info(`[bytes.io] index.json loaded from ${new URL(url).hostname}`);
      return raw;
    } catch (err) {
      failures.push(`${new URL(url).hostname} → ${err.message}`);
    }
  }
  throw new Error(failures.join(" | "));
}

function normalizeIndex(raw) {
  return raw
    .map((entry) => {
      const name = Object.keys(entry)[0];
      return { name, url: entry[name] };
    })
    .filter((lib) => lib.name && lib.url);
}

/** Records the first time each library name is seen in this browser — powers "recently added". */
function rememberSeen(libs) {
  const seen = cacheGetStale(SEEN_LIBS_KEY) || {};
  let changed = false;
  const nowIso = new Date().toISOString();
  libs.forEach((l) => {
    if (!seen[l.name]) {
      seen[l.name] = nowIso;
      changed = true;
    }
  });
  if (changed) cacheSet(SEEN_LIBS_KEY, seen, null); // no expiry — durable local log
  return seen;
}

function getSeenMap() {
  return cacheGetStale(SEEN_LIBS_KEY) || {};
}

/** Same slugify as scripts/generate-site-data.mjs — must stay in sync. */
function slugifyLibName(name) {
  return (
    String(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "library"
  );
}

const OG_SLUGS_CACHE_KEY = "og-slugs";
let ogSlugsPromise = null;

/** Slugs that have a build-time static share page (see scripts/generate-site-data.mjs) with real OG tags. */
async function loadOgSlugs(dataUrl) {
  if (ogSlugsPromise) return ogSlugsPromise;
  ogSlugsPromise = (async () => {
    const cached = cacheGetStale(OG_SLUGS_CACHE_KEY);
    if (cached) return new Set(cached);
    try {
      const res = await fetch(dataUrl, { cache: "no-store" });
      if (!res.ok) return new Set();
      const entries = await res.json();
      const slugs = entries.map((e) => e.slug);
      cacheSet(OG_SLUGS_CACHE_KEY, slugs, 24 * 60 * 60 * 1000);
      return new Set(slugs);
    } catch {
      return new Set();
    }
  })();
  return ogSlugsPromise;
}

/** Picks the shareable link for a library: the static OG-tagged page when one was built, otherwise the live repo page. `fromPagesDir` should be true when called from a page already inside /pages/ (recent.html, author.html), false from the site root (index.html). */
function libHref(lib, ogSlugs, fromPagesDir = false) {
  const slug = slugifyLibName(lib.name);
  const pagesPrefix = fromPagesDir ? "" : "pages/";
  if (ogSlugs && ogSlugs.has(slug)) return `${pagesPrefix}lib/${slug}.html`;
  return `${pagesPrefix}repo.html?name=${encodeURIComponent(lib.name)}&url=${encodeURIComponent(lib.url)}`;
}
