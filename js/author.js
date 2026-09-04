const username = new URLSearchParams(location.search).get("u");
let ogSlugs = new Set();

const els = {
  crumb: document.getElementById("author-crumb-name"),
  avatarWrap: document.querySelector(".author-avatar"),
  head: document.getElementById("author-head"),
  name: document.getElementById("author-name"),
  handle: document.getElementById("author-handle"),
  libs: document.getElementById("author-libs"),
};

function initials(name) {
  return name.slice(0, 2).toUpperCase();
}

async function loadProfile() {
  const cacheKey = `user:${username}`;
  let user = cacheGet(cacheKey);
  if (!user) {
    try {
      const res = await githubFetch(`https://api.github.com/users/${encodeURIComponent(username)}`);
      if (res.ok) {
        user = await res.json();
        cacheSet(cacheKey, user, TTL.USER);
      } else if (res.status === 403) {
        els.handle.innerHTML = `GitHub rate limit hit — <a href="#" id="open-gh-settings">add a token</a> to raise it.`;
        document.getElementById("open-gh-settings")?.addEventListener("click", (e) => {
          e.preventDefault();
          document.querySelector("[data-gh-settings]")?.click();
        });
      }
    } catch {
      /* fall through to the not-found state below */
    }
  }

  if (!user || user.message === "Not Found") {
    els.name.textContent = username;
    if (!els.handle.querySelector("#open-gh-settings")) {
      els.handle.textContent = "GitHub profile not found — showing bytes.io contributions only.";
    }
    return;
  }

  els.avatarWrap.innerHTML = `<img src="${user.avatar_url}" alt="${username}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" />`;
  els.name.textContent = user.name || user.login;
  els.handle.innerHTML = `<a href="${user.html_url}" target="_blank" rel="noopener">@${user.login} ↗</a>`;

  const statsEl = document.createElement("div");
  statsEl.className = "author-stats";
  statsEl.innerHTML = `
    ${user.followers != null ? `<span><b>${user.followers}</b> followers</span>` : ""}
    ${user.public_repos != null ? `<span><b>${user.public_repos}</b> public repos</span>` : ""}
  `;
  els.head.querySelector("div:last-child").appendChild(statsEl);

  if (user.bio) {
    const bio = document.createElement("p");
    bio.className = "bio";
    bio.textContent = user.bio;
    els.head.querySelector("div:last-child").insertBefore(bio, statsEl);
  }
}

function libCardHtml(lib, data) {
  const lang = data?.language;
  const langColor = lang && typeof colorForLanguage === "function" ? colorForLanguage(lang) : "var(--b-pink)";
  return `
    <a class="lib-card" data-lib-url="${lib.url}" href="${libHref(lib, ogSlugs, true)}">
      <div class="lib-card-top">
        <div class="lib-glyph">${initials(lib.name)}</div>
        <h3>${lib.name}</h3>
      </div>
      <p>${data?.description || "Library manifest served from bytes.hk at the repo root."}</p>
      <div class="lib-card-foot">
        <span class="pill"><span class="dot" style="background:${langColor}"></span>${lang || "H#"}</span>
        <span class="go">View manifest →</span>
      </div>
    </a>`;
}

async function loadLibraries() {
  const authorIndex = await loadAuthorIndex();
  const key = username.toLowerCase();
  const entry = authorIndex?.authors?.[key];

  if (entry && entry.libraries.length) {
    renderFreshnessNote(authorIndex.generatedAt, entry.libraries.length);
    els.libs.innerHTML = entry.libraries.map((l) => libCardHtml(l, null)).join("");
    // Enrich just these few matches (not the whole index) for language/description on the cards.
    enrichLibraries(entry.libraries, (lib, data) => {
      if (!data) return;
      const el = els.libs.querySelector(`[data-lib-url="${cssEscape(lib.url)}"]`);
      if (el) el.outerHTML = libCardHtml(lib, data);
    }, 4);
    return;
  }

  renderFreshnessNote(authorIndex?.generatedAt, 0, true);
  await scanAllLibrariesLive();
}

/** Falls back to a full live scan across every library's bytes.hk — used when the prebuilt author index doesn't have this author yet (e.g. added since the last build). */
async function scanAllLibrariesLive() {
  const cached = cacheGetStale(INDEX_CACHE_KEY);
  let libs = cached ? normalizeIndex(cached) : [];

  if (!libs.length) {
    try {
      const raw = await fetchIndexJsonLive();
      cacheSet(INDEX_CACHE_KEY, raw, TTL.INDEX);
      libs = normalizeIndex(raw);
    } catch {
      els.libs.innerHTML = `<div class="state-note">Couldn't load the library index.</div>`;
      return;
    }
  }

  const matches = [];
  let scanned = 0;

  await enrichLibraries(
    libs,
    (lib, data) => {
      scanned++;
      if (data && data.authors.some((a) => a.replace(/^@/, "").toLowerCase() === username.toLowerCase())) {
        matches.push({ lib, data });
        els.libs.innerHTML = matches.map((m) => libCardHtml(m.lib, m.data)).join("");
      }
      if (scanned === libs.length && !matches.length) {
        els.libs.innerHTML = `<div class="state-note">No bytes.io libraries list <b>${username}</b> as an author.</div>`;
      }
    },
    4
  );
}

const AUTHOR_INDEX_CACHE_KEY = "authors-index.json";
const AUTHOR_INDEX_TTL = 24 * 60 * 60 * 1000; // 1 day — rebuilt by scripts/generate-site-data.mjs

/** Loads the prebuilt author -> libraries reverse index (see scripts/generate-site-data.mjs), so author.html doesn't have to scan every library live on every visit. */
async function loadAuthorIndex() {
  const cached = cacheGetStale(AUTHOR_INDEX_CACHE_KEY);
  if (cached && cacheAge(AUTHOR_INDEX_CACHE_KEY) < AUTHOR_INDEX_TTL) return cached;
  try {
    const res = await fetch("../data/authors-index.json", { cache: "no-store" });
    if (!res.ok) return cached || null;
    const data = await res.json();
    cacheSet(AUTHOR_INDEX_CACHE_KEY, data, AUTHOR_INDEX_TTL);
    return data;
  } catch {
    return cached || null;
  }
}

function renderFreshnessNote(generatedAt, matchCount, isFallback) {
  const note = document.getElementById("author-libs-note");
  if (!note) return;
  if (isFallback) {
    note.textContent = generatedAt
      ? `Not in the prebuilt index (built ${formatAge(Date.now() - new Date(generatedAt).getTime())} ago) — scanning every library live instead.`
      : "Prebuilt author index unavailable — scanning every library live instead.";
    return;
  }
  const age = generatedAt ? formatAge(Date.now() - new Date(generatedAt).getTime()) : null;
  note.textContent = `${matchCount} ${matchCount === 1 ? "library" : "libraries"} · from the author index${age ? ` built ${age} ago` : ""}.`;
}

/** Minimal CSS.escape polyfill for the attribute-selector lookups above. */
function cssEscape(s) {
  return String(s).replace(/["\\]/g, "\\$&");
}

function init() {
  if (!username) {
    els.name.textContent = "No author specified";
    els.handle.textContent = "";
    els.libs.innerHTML = `<div class="state-note">Head back to <a href="../index.html">the index</a> and click an author's name.</div>`;
    return;
  }
  els.crumb.textContent = username;
  loadProfile();
  loadOgSlugs("../data/og-data.json").then((slugs) => (ogSlugs = slugs));
  loadLibraries();
}

init();
