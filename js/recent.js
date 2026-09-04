const listEl = document.getElementById("recent-list");
const NEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // badge "NEW" for anything first-seen in the last 7 days
let ogSlugs = new Set();
let lastLibs = [];
let lastSeen = {};

function initials(name) {
  return name.slice(0, 2).toUpperCase();
}

function relativeTime(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diffMs < hour) return `${Math.max(1, Math.floor(diffMs / min))}m ago`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)}h ago`;
  if (diffMs < 30 * day) return `${Math.floor(diffMs / day)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function render(libs, seen) {
  lastLibs = libs;
  lastSeen = seen;
  if (!libs.length) {
    listEl.innerHTML = `<div class="state-note">No libraries found. Check back later.</div>`;
    return;
  }

  const sorted = [...libs].sort((a, b) => {
    const av = seen[a.name] ? new Date(seen[a.name]).getTime() : 0;
    const bv = seen[b.name] ? new Date(seen[b.name]).getTime() : 0;
    return bv - av;
  });

  listEl.innerHTML = sorted
    .map((lib) => {
      const seenAt = seen[lib.name];
      const isNew = seenAt && Date.now() - new Date(seenAt).getTime() < NEW_WINDOW_MS;
      return `
        <a class="recent-item" href="${libHref(lib, ogSlugs, true)}">
          <div class="lib-glyph">${initials(lib.name)}</div>
          <div class="info">
            <h3>${lib.name}${isNew ? `<span class="new-badge">NEW</span>` : ""}</h3>
          </div>
          <span class="when">${seenAt ? relativeTime(seenAt) : "—"}</span>
        </a>`;
    })
    .join("");
}

async function init() {
  loadOgSlugs("../data/og-data.json").then((slugs) => {
    ogSlugs = slugs;
    if (lastLibs.length) render(lastLibs, lastSeen);
  });

  const cached = cacheGetStale(INDEX_CACHE_KEY);
  const libs = cached ? normalizeIndex(cached) : [];
  const seen = rememberSeen(libs.length ? libs : []);
  if (libs.length) render(libs, seen);

  try {
    const raw = await fetchIndexJsonLive();
    cacheSet(INDEX_CACHE_KEY, raw, TTL.INDEX);
    const freshLibs = normalizeIndex(raw);
    const freshSeen = rememberSeen(freshLibs);
    render(freshLibs, freshSeen);
  } catch (err) {
    if (!libs.length) {
      listEl.innerHTML = `
        <div class="state-note">
          Couldn't reach <code>index.json</code> (${err.message}).
          <div style="margin-top:14px;"><button class="retry-btn" id="retry-recent">Try again</button></div>
        </div>`;
      document.getElementById("retry-recent")?.addEventListener("click", init);
    }
  }
}

init();
