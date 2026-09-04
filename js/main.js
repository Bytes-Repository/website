const grid = document.getElementById("lib-grid");
const countEl = document.getElementById("lib-count");
const searchInput = document.getElementById("lib-search");
const langSelect = document.getElementById("filter-lang");
const sortSelect = document.getElementById("filter-sort");
const tagBar = document.getElementById("filter-tags");
const cacheNote = document.getElementById("cache-note");

let libraries = []; // [{ name, url }]
let enriched = {}; // url -> enrichment data (language, description, tags, stars, downloads, lastCommit)
let activeTags = new Set();
let compareSet = new Set(); // urls selected for comparison, max 3
let ogSlugs = new Set(); // slugs with a build-time static share page (see loadOgSlugs)

const compareBar = document.getElementById("compare-bar");
const compareCountEl = document.getElementById("compare-count");
const compareModal = document.getElementById("compare-modal");
const compareTableWrap = document.getElementById("compare-table-wrap");
const compareA11y = compareModal ? setupModalA11y(compareModal) : null;

function skeletons(n) {
  return Array.from({ length: n })
    .map(() => `<div class="skel"></div>`)
    .join("");
}

function initials(name) {
  return name.slice(0, 2).toUpperCase();
}

function formatCount(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return null;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(num);
}

function relativeTime(iso) {
  if (!iso) return null;
  const diffMs = Date.now() - new Date(iso).getTime();
  const day = 86_400_000;
  const days = Math.floor(diffMs / day);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function cardHtml(lib) {
  const data = enriched[lib.url];
  const lang = data?.language;
  const langColor = lang ? (typeof colorForLanguage === "function" ? colorForLanguage(lang) : "var(--b-pink)") : "var(--b-pink)";
  const desc =
    data?.description ||
    `Library manifest served from <code style="font-family:var(--f-mono);font-size:12px;">bytes.hk</code> at the repo root.`;
  const stars = formatCount(data?.stars);
  const downloads = formatCount(data?.downloads);
  const tags = (data?.tags || []).slice(0, 3);
  const checked = compareSet.has(lib.url);

  return `
    <div class="lib-card ${checked ? "is-comparing" : ""}" data-url="${lib.url}">
      <label class="compare-check" title="Add to comparison">
        <input type="checkbox" data-compare-url="${lib.url}" aria-label="Compare ${lib.name}" ${checked ? "checked" : ""} />
        <span></span>
      </label>
      <a class="lib-card-link" href="${libHref(lib, ogSlugs, false)}">
        <div class="lib-card-top">
          <div class="lib-glyph">${initials(lib.name)}</div>
          <h3>${lib.name}</h3>
        </div>
        <p>${desc}</p>
        ${
          tags.length
            ? `<div class="lib-card-tags">${tags.map((t) => `<span class="tag-pill">${t}</span>`).join("")}</div>`
            : ""
        }
        <div class="lib-card-foot">
          <span class="pill"><span class="dot" style="background:${langColor}"></span>${lang || "H#"}</span>
          <span class="lib-card-metrics">
            ${stars ? `<span title="stars">★ ${stars}</span>` : ""}
            ${downloads ? `<span title="downloads">⬇ ${downloads}</span>` : ""}
          </span>
          <span class="go">View manifest →</span>
        </div>
      </a>
    </div>`;
}

function render(list) {
  if (!list.length) {
    grid.innerHTML = `
      <div class="state-note">
        No libraries match that search/filter. Try different terms, or
        <a href="https://github.com/Bytes-Repository/repository/blob/main/index.json" target="_blank" rel="noopener">browse index.json</a> directly.
      </div>`;
    return;
  }
  grid.innerHTML = list.map(cardHtml).join("");
}

/* ------------------------------------------------------- filter + sort ---- */

function currentQuery() {
  return (searchInput?.value || "").trim().toLowerCase();
}

function matchesQuery(lib, q) {
  if (!q) return true;
  if (lib.name.toLowerCase().includes(q)) return true;
  const data = enriched[lib.url];
  if (data?.description && data.description.toLowerCase().includes(q)) return true;
  if (data?.tags?.some((t) => t.toLowerCase().includes(q))) return true;
  return false;
}

function matchesLang(lib) {
  const val = langSelect?.value;
  if (!val || val === "all") return true;
  return enriched[lib.url]?.language === val;
}

function matchesTags(lib) {
  if (!activeTags.size) return true;
  const tags = enriched[lib.url]?.tags || [];
  return [...activeTags].some((t) => tags.includes(t));
}

function sortLibs(list) {
  const mode = sortSelect?.value || "name";
  const withData = list.map((lib) => ({ lib, data: enriched[lib.url] || {} }));

  const byNum = (key) => (a, b) => {
    const av = a.data[key];
    const bv = b.data[key];
    if (av == null && bv == null) return a.lib.name.localeCompare(b.lib.name);
    if (av == null) return 1;
    if (bv == null) return -1;
    return bv - av;
  };

  if (mode === "downloads") withData.sort(byNum("downloads"));
  else if (mode === "stars") withData.sort(byNum("stars"));
  else if (mode === "recent") {
    withData.sort((a, b) => {
      const av = a.data.lastCommit ? new Date(a.data.lastCommit).getTime() : null;
      const bv = b.data.lastCommit ? new Date(b.data.lastCommit).getTime() : null;
      if (av == null && bv == null) return a.lib.name.localeCompare(b.lib.name);
      if (av == null) return 1;
      if (bv == null) return -1;
      return bv - av;
    });
  } else {
    withData.sort((a, b) => a.lib.name.localeCompare(b.lib.name));
  }

  return withData.map((x) => x.lib);
}

function applyFilters() {
  const q = currentQuery();
  const filtered = libraries.filter((l) => matchesQuery(l, q) && matchesLang(l) && matchesTags(l));
  render(sortLibs(filtered));
}

function populateLangOptions() {
  if (!langSelect) return;
  const langs = new Set(Object.values(enriched).map((d) => d?.language).filter(Boolean));
  const current = langSelect.value;
  langSelect.innerHTML =
    `<option value="all">All languages</option>` +
    [...langs].sort().map((l) => `<option value="${l}">${l}</option>`).join("");
  if ([...langs].includes(current)) langSelect.value = current;
}

function populateTagBar() {
  if (!tagBar) return;
  const tags = new Set();
  Object.values(enriched).forEach((d) => (d?.tags || []).forEach((t) => tags.add(t)));
  if (!tags.size) {
    tagBar.innerHTML = "";
    tagBar.hidden = true;
    return;
  }
  tagBar.hidden = false;
  tagBar.innerHTML = [...tags]
    .sort()
    .map(
      (t) =>
        `<button type="button" class="tag-chip ${activeTags.has(t) ? "is-active" : ""}" data-tag="${t}" aria-pressed="${activeTags.has(t)}">${t}</button>`
    )
    .join("");
  tagBar.querySelectorAll(".tag-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tag = btn.dataset.tag;
      if (activeTags.has(tag)) activeTags.delete(tag);
      else activeTags.add(tag);
      btn.classList.toggle("is-active");
      btn.setAttribute("aria-pressed", activeTags.has(tag) ? "true" : "false");
      applyFilters();
    });
  });
}

/* -------------------------------------------------------- data loading ---- */
/* fetchIndexJsonLive, normalizeIndex, rememberSeen come from js/index-data.js */

function showLibraries(libs, { fromCache }) {
  libraries = libs;
  countEl.textContent = `${libraries.length} ${libraries.length === 1 ? "library" : "libraries"}`;
  applyFilters();
  updateCacheNote(fromCache);
  rememberSeen(libs);
  startEnrichment(libs);
}

let cacheNoteTimer = null;

/** Shows when the currently-displayed data was cached, and keeps that age ticking. */
function updateCacheNote(fromCache) {
  if (!cacheNote) return;
  clearInterval(cacheNoteTimer);

  if (!fromCache) {
    cacheNote.textContent = "Updated just now.";
    cacheNoteTimer = setInterval(() => {
      const age = cacheAge(INDEX_CACHE_KEY);
      if (age != null) cacheNote.textContent = `Data from ${formatAge(age)}.`;
    }, 30_000);
    return;
  }

  const render = () => {
    const age = cacheAge(INDEX_CACHE_KEY);
    cacheNote.textContent = age != null ? `Showing cached data from ${formatAge(age)} — refreshing…` : "Showing cached data — refreshing…";
  };
  render();
  cacheNoteTimer = setInterval(render, 15_000);
}

function startEnrichment(libs) {
  enrichLibraries(libs, (lib, data) => {
    if (!data) return;
    enriched[lib.url] = data;
    populateLangOptions();
    populateTagBar();
    applyFilters();
  }, 4);
}

function renderErrorState(message) {
  grid.innerHTML = `
    <div class="state-note">
      Couldn't reach <code>index.json</code> from any source (${message}).
      This can happen if the page was opened directly as a local file
      (<code>file://…</code>) — some browsers block cross-origin fetches
      from that context — or if you're offline right now.
      <div style="margin-top:14px;">
        <button class="retry-btn" id="retry-index">Try again</button>
      </div>
    </div>`;
  countEl.textContent = "— libraries";
  document.getElementById("retry-index")?.addEventListener("click", loadIndex);
}

async function loadIndex() {
  const cached = cacheGetStale(INDEX_CACHE_KEY);

  if (cached && cached.length) {
    // Stale-while-revalidate: render instantly from cache, then refresh quietly.
    showLibraries(normalizeIndex(cached), { fromCache: true });
  } else {
    grid.innerHTML = skeletons(6);
  }

  try {
    const raw = await fetchIndexJsonLive();
    cacheSet(INDEX_CACHE_KEY, raw, TTL.INDEX);
    showLibraries(normalizeIndex(raw), { fromCache: false });
  } catch (err) {
    console.error("[bytes.io] failed to load index.json:", err.message);
    if (!cached) renderErrorState(err.message);
    else if (cacheNote) {
      clearInterval(cacheNoteTimer);
      const age = cacheAge(INDEX_CACHE_KEY);
      cacheNote.textContent = `Showing cached data from ${age != null ? formatAge(age) : "earlier"} — couldn't refresh (offline?).`;
    }
  }
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

searchInput?.addEventListener("input", debounce(applyFilters, 150));
langSelect?.addEventListener("change", applyFilters);
sortSelect?.addEventListener("change", applyFilters);

/* ------------------------------------------------------------- compare ---- */

const MAX_COMPARE = 3;

grid.addEventListener("change", (e) => {
  const target = e.target.closest("[data-compare-url]");
  if (!target) return;
  const url = target.dataset.compareUrl;

  if (target.checked) {
    if (compareSet.size >= MAX_COMPARE) {
      target.checked = false;
      flashCompareLimit();
      return;
    }
    compareSet.add(url);
  } else {
    compareSet.delete(url);
  }
  target.closest(".lib-card")?.classList.toggle("is-comparing", target.checked);
  updateCompareBar();
});

function flashCompareLimit() {
  if (!compareBar) return;
  compareBar.classList.add("is-shake");
  compareCountEl.textContent = `Up to ${MAX_COMPARE} at a time — remove one first`;
  setTimeout(() => {
    compareBar.classList.remove("is-shake");
    updateCompareBar();
  }, 1400);
}

function updateCompareBar() {
  if (!compareBar) return;
  if (!compareSet.size) {
    compareBar.hidden = true;
    return;
  }
  compareBar.hidden = false;
  compareCountEl.textContent = `${compareSet.size} selected — compare up to ${MAX_COMPARE}`;
}

document.getElementById("compare-clear")?.addEventListener("click", () => {
  compareSet.clear();
  updateCompareBar();
  applyFilters(); // re-render to clear checkbox state
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && compareModal && !compareModal.hidden) closeCompareModal();
});

document.getElementById("compare-open")?.addEventListener("click", openCompareModal);
document.getElementById("compare-close")?.addEventListener("click", closeCompareModal);
compareModal?.addEventListener("click", (e) => {
  if (e.target === compareModal) closeCompareModal();
});

function closeCompareModal() {
  if (!compareModal) return;
  compareModal.hidden = true;
  compareA11y?.close();
}

function compareCell(value, unit) {
  return value == null ? `<span class="cmp-empty">—</span>` : `${value}${unit || ""}`;
}

function openCompareModal() {
  if (!compareModal || !compareTableWrap) return;
  const libs = libraries.filter((l) => compareSet.has(l.url));

  const rows = [
    {
      label: "Library",
      cells: libs.map((l) => `<a href="${libHref(l, ogSlugs, false)}"><b>${l.name}</b></a>`),
    },
    {
      label: "Language",
      cells: libs.map((l) => {
        const d = enriched[l.url];
        return d?.language
          ? `<span class="pill"><span class="dot" style="background:${colorForLanguage(d.language)}"></span>${d.language}</span>`
          : compareCell(null);
      }),
    },
    { label: "Version", cells: libs.map((l) => compareCell(enriched[l.url]?.version)) },
    { label: "License", cells: libs.map((l) => compareCell(enriched[l.url]?.license)) },
    { label: "Downloads", cells: libs.map((l) => compareCell(formatCount(enriched[l.url]?.downloads))) },
    { label: "Stars", cells: libs.map((l) => compareCell(formatCount(enriched[l.url]?.stars))) },
    {
      label: "Dependencies",
      cells: libs.map((l) => {
        const deps = enriched[l.url]?.deps;
        if (!deps || !Object.keys(deps).length) return compareCell(null);
        return `<span class="cmp-deps">${Object.entries(deps)
          .map(([k, v]) => `${k} <span class="cmp-dep-ver">${v}</span>`)
          .join("<br/>")}</span>`;
      }),
    },
    {
      label: "Tags",
      cells: libs.map((l) => {
        const tags = enriched[l.url]?.tags || [];
        return tags.length ? tags.map((t) => `<span class="tag-pill">${t}</span>`).join(" ") : compareCell(null);
      }),
    },
  ];

  const colStyle = `style="grid-template-columns:130px repeat(${libs.length},1fr);"`;
  compareTableWrap.innerHTML = `
    <div class="cmp-table">
      ${rows
        .map(
          (r) => `
        <div class="cmp-row" ${colStyle}>
          <div class="cmp-label">${r.label}</div>
          ${r.cells.map((c) => `<div class="cmp-cell">${c}</div>`).join("")}
        </div>`
        )
        .join("")}
    </div>
  `;

  compareModal.hidden = false;
  compareA11y?.open();
}

loadIndex();
loadOgSlugs("data/og-data.json").then((slugs) => {
  ogSlugs = slugs;
  applyFilters();
});

/* ------------------------------------------------------------------ PWA ---- */
registerServiceWorker("sw.js");
