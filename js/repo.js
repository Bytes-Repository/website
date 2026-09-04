const params = new URLSearchParams(location.search);
const repoName = params.get("name");
const repoUrl = params.get("url");

const els = {
  glyph: document.getElementById("repo-glyph"),
  title: document.getElementById("repo-title"),
  desc: document.getElementById("repo-desc"),
  ghLink: document.getElementById("repo-gh-link"),
  packagePanel: document.getElementById("panel-package"),
  installPanel: document.getElementById("panel-install"),
  depsPanel: document.getElementById("panel-deps"),
  buildPanel: document.getElementById("panel-build"),
  statsPanel: document.getElementById("panel-stats"),
  versionsPanel: document.getElementById("panel-versions"),
  code: document.getElementById("hk-code"),
  codeHead: document.getElementById("hk-code-head"),
  codeCopy: document.getElementById("hk-code-copy"),
  widget: document.getElementById("lang-widget"),
  widgetBody: document.getElementById("lang-widget-body"),
  widgetFreshness: document.getElementById("lang-widget-freshness"),
  widgetToggle: document.getElementById("lang-widget-toggle"),
  changelogPanel: document.getElementById("panel-changelog"),
};

// ownerRepoFromUrl is defined once in js/enrich.js (loaded before this file).

let currentIds = null;

function init() {
  if (!repoName || !repoUrl) {
    document.querySelector(".repo-body").innerHTML =
      `<div class="repo-state">No repository specified. Head back to <a href="../index.html">the index</a>.</div>`;
    return;
  }

  els.glyph.textContent = repoName.slice(0, 2).toUpperCase();
  els.title.textContent = repoName;
  els.desc.textContent = "Fetching manifest…";
  els.ghLink.href = repoUrl;

  currentIds = ownerRepoFromUrl(repoUrl);
  loadManifest(currentIds);
  loadLanguages(currentIds);
  loadChangelog(currentIds);
}

/* ---------------------------------------------------------------- manifest */

async function loadManifest(ids) {
  if (!ids) return renderManifestError("Malformed repository URL.");

  const cacheKey = `manifest:${ids.owner}/${ids.repo}`;
  const cached = cacheGetStale(cacheKey);
  if (cached) {
    renderManifest(cached);
    setFreshness(els.codeHead, cacheAge(cacheKey), "bytes.hk");
  }

  const branches = ["main", "master"];
  const candidates = branches.flatMap((branch) => [
    `https://raw.githubusercontent.com/${ids.owner}/${ids.repo}/${branch}/bytes.hk`,
    `https://cdn.jsdelivr.net/gh/${ids.owner}/${ids.repo}@${branch}/bytes.hk`,
  ]);

  const failures = [];
  for (const url of candidates) {
    try {
      const bust = url.includes("?") ? "&" : "?";
      const res = await githubFetch(`${url}${bust}_=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) {
        failures.push(`${new URL(url).hostname} → HTTP ${res.status}`);
        continue;
      }
      const text = await res.text();
      console.info(`[bytes.io] bytes.hk loaded from ${new URL(url).hostname}`);
      cacheSet(cacheKey, text, TTL.MANIFEST);
      renderManifest(text);
      setFreshness(els.codeHead, 0, "bytes.hk");
      return;
    } catch (err) {
      failures.push(`${new URL(url).hostname} → ${err.message}`);
    }
  }
  console.error("[bytes.io] failed to load bytes.hk:", failures.join(" | "));
  if (!cached) {
    renderManifestError("No bytes.hk found at the repo root (checked main and master, raw + jsDelivr).");
  }
}

/** Appends a "· cached Xm ago" / "· just now" freshness note. With a label, replaces el's text as "label · suffix"; without, just sets "· suffix" (for small inline tags). */
function setFreshness(el, ageMs, label) {
  if (!el) return;
  const suffix = ageMs === 0 || ageMs == null ? "just now" : `cached ${formatAge(ageMs)}`;
  el.textContent = label ? `${label} · ${suffix}` : `· ${suffix}`;
}

function renderManifest(source) {
  const parsed = parseBytesHk(source);
  const pkg = parsed.package || {};
  const deps = parsed.deps || {};
  const build = parsed.build || {};

  els.desc.textContent = pkg.description || "No description in bytes.hk.";

  const authorList = Array.isArray(pkg.authors) ? pkg.authors : pkg.authors ? [pkg.authors] : [];

  els.packagePanel.innerHTML = `
    <h3>Package</h3>
    ${row("name", pkg.name)}
    ${row("version", pkg.version)}
    ${row("license", pkg.license)}
    ${authorList.length ? row("authors", authorList.map(authorLinkHtml).join(", ")) : ""}
  `;

  const depEntries = Object.entries(deps);
  els.depsPanel.innerHTML = `
    <h3>Dependencies</h3>
    ${
      depEntries.length
        ? `<div class="dep-list">${depEntries
            .map(([k, v]) => `<div class="dep-item"><span class="name">${k}</span><span class="ver">${v}</span></div>`)
            .join("")}</div>`
        : `<p style="color:var(--muted);font-size:13px;margin:0;">No dependencies declared.</p>`
    }
  `;

  els.buildPanel.innerHTML = `
    <h3>Build</h3>
    ${row("entry", build.entry)}
    ${row("target", build.target)}
  `;

  renderInstallPanel(pkg, currentIds);
  renderStatsPanel(parsed.stats || {});
  renderVersionsPanel(parsed.downloads || {}, pkg.version);

  els.codeHead.textContent = "bytes.hk";
  els.code.innerHTML = highlightBytesHk(source);
  els.code.dataset.raw = source;
}

/** Renders a copyable "how to install" command using the package name from bytes.hk. */
function renderInstallPanel(pkg, ids) {
  if (!els.installPanel) return;
  const name = pkg.name || (ids ? ids.repo : repoName);
  const version = pkg.version;

  const cliCmd = `bytes add ${name}`;
  const manifestSnippet = version ? `${name} = "${version}"` : `${name} = "*"`;

  els.installPanel.innerHTML = `
    <h3>Install</h3>
    <p class="install-label">Via the CLI</p>
    <div class="install-cmd">
      <code>${escapeHtml(cliCmd)}</code>
      <button class="install-copy" data-copy="${escapeHtml(cliCmd)}" title="Copy">Copy</button>
    </div>
    <p class="install-label">Or add to your bytes.hk</p>
    <div class="install-cmd">
      <code>${escapeHtml(manifestSnippet)}</code>
      <button class="install-copy" data-copy="${escapeHtml(manifestSnippet)}" title="Copy">Copy</button>
    </div>
  `;

  els.installPanel.querySelectorAll(".install-copy").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy);
        const original = btn.textContent;
        btn.textContent = "Copied";
        setTimeout(() => (btn.textContent = original), 1300);
      } catch {
        /* clipboard unavailable — ignore */
      }
    });
  });
}

/** Renders the optional @stats block from bytes.hk: downloads, stars, tags. */
function renderStatsPanel(stats) {
  if (!els.statsPanel) return;

  const downloads = stats.downloads;
  const tags = Array.isArray(stats.tags) ? stats.tags : [];
  const hasAny = downloads != null || tags.length || stats.stars != null;

  if (!hasAny) {
    els.statsPanel.innerHTML = `
      <h3>Stats</h3>
      <p style="color:var(--muted);font-size:13px;margin:0;">No @stats block in bytes.hk.</p>
    `;
    return;
  }

  const downloadsHtml =
    downloads != null
      ? `<div class="stat-figure">
           <span class="stat-figure-num">${formatCount(downloads)}</span>
           <span class="stat-figure-label">downloads</span>
         </div>`
      : "";

  const starsHtml = stats.stars != null ? row("stars", formatCount(stats.stars)) : "";

  const tagsHtml = tags.length
    ? `<div class="tag-list">${tags.map((t) => `<span class="tag-pill">${t}</span>`).join("")}</div>`
    : "";

  els.statsPanel.innerHTML = `
    <h3>Stats</h3>
    ${downloadsHtml}
    ${starsHtml}
    ${tagsHtml}
  `;
}

/** Formats a raw integer as a compact count, e.g. 15234 -> "15.2k", 2100000 -> "2.1M". */
function formatCount(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(num);
}

/* compareVersionsDesc now comes from js/semver-lite.js (spec-correct SemVer precedence). */

/** Renders the optional @downloads block from bytes.hk: per-version download counts, crates.io-style. */
function renderVersionsPanel(downloadsByVersion, currentVersion) {
  if (!els.versionsPanel) return;

  const entries = Object.entries(downloadsByVersion).filter(([, v]) => typeof v === "number");

  if (!entries.length) {
    els.versionsPanel.innerHTML = `
      <h3>Downloads by version</h3>
      <p style="color:var(--muted);font-size:13px;margin:0;">No @downloads block in bytes.hk.</p>
    `;
    return;
  }

  entries.sort((a, b) => compareVersionsDesc(a[0], b[0]));
  const max = Math.max(...entries.map(([, v]) => v));
  const total = entries.reduce((sum, [, v]) => sum + v, 0);

  const rows = entries
    .map(([version, count]) => {
      const pct = max > 0 ? (count / max) * 100 : 0;
      const isCurrent = currentVersion && version === currentVersion;
      return `
        <div class="version-row ${isCurrent ? "is-current" : ""}">
          <span class="version-tag">${version}${isCurrent ? ` <span class="current-flag">current</span>` : ""}</span>
          <div class="version-bar-track"><div class="version-bar-fill" style="width:${pct}%"></div></div>
          <span class="version-count">${formatCount(count)}</span>
        </div>`;
    })
    .join("");

  els.versionsPanel.innerHTML = `
    <h3>Downloads by version</h3>
    <p class="version-total">${formatCount(total)} total across ${entries.length} version${entries.length === 1 ? "" : "s"}</p>
    <div class="version-list">${rows}</div>
  `;
}

function renderManifestError(message) {
  els.desc.textContent = message;
  els.packagePanel.innerHTML = `<h3>Package</h3><p style="color:var(--muted);font-size:13px;margin:0;">Unavailable.</p>`;
  if (els.installPanel) {
    els.installPanel.innerHTML = `<h3>Install</h3><p style="color:var(--muted);font-size:13px;margin:0;">Unavailable.</p>`;
  }
  els.depsPanel.innerHTML = `<h3>Dependencies</h3><p style="color:var(--muted);font-size:13px;margin:0;">Unavailable.</p>`;
  els.buildPanel.innerHTML = `<h3>Build</h3><p style="color:var(--muted);font-size:13px;margin:0;">Unavailable.</p>`;
  if (els.statsPanel) {
    els.statsPanel.innerHTML = `<h3>Stats</h3><p style="color:var(--muted);font-size:13px;margin:0;">Unavailable.</p>`;
  }
  if (els.versionsPanel) {
    els.versionsPanel.innerHTML = `<h3>Downloads by version</h3><p style="color:var(--muted);font-size:13px;margin:0;">Unavailable.</p>`;
  }
  els.codeHead.textContent = "bytes.hk — not found";
  els.code.innerHTML = `# ${message}<br/><button class="retry-btn" id="retry-manifest" style="margin-top:12px;">Try again</button>`;
  document.getElementById("retry-manifest")?.addEventListener("click", () => {
    els.desc.textContent = "Fetching manifest…";
    loadManifest(currentIds);
  });
}

function row(k, v) {
  if (!v) return "";
  return `<div class="kv-row"><span class="k">${k}</span><span class="v">${v}</span></div>`;
}

/** Renders one @package.authors entry as a link to that author's bytes.io profile page. */
function authorLinkHtml(username) {
  const clean = String(username).replace(/^@/, "");
  return `<a class="author-link" href="author.html?u=${encodeURIComponent(clean)}">${clean}</a>`;
}

/* --------------------------------------------------------------- languages */

async function loadLanguages(ids) {
  if (!ids) return renderLangError();

  const cacheKey = `langs:${ids.owner}/${ids.repo}`;
  const cached = cacheGetStale(cacheKey);
  if (cached) {
    renderLangWidget(cached);
    setFreshness(els.widgetFreshness, cacheAge(cacheKey), null);
  }

  const [githubBytes, customBytes] = await Promise.all([
    fetchGithubLanguages(ids),
    fetchCustomLanguageBytes(ids),
  ]);

  const merged = Object.assign({}, githubBytes, customBytes);
  const total = Object.values(merged).reduce((a, b) => a + b, 0);

  if (!total) {
    if (!cached) renderLangError();
    return;
  }

  const breakdown = Object.entries(merged)
    .map(([name, bytes]) => ({ name, bytes, pct: (bytes / total) * 100 }))
    .sort((a, b) => b.bytes - a.bytes);

  cacheSet(cacheKey, breakdown, TTL.LANGS);
  renderLangWidget(breakdown);
  setFreshness(els.widgetFreshness, 0, null);
}

async function fetchGithubLanguages(ids) {
  try {
    const res = await githubFetch(`https://api.github.com/repos/${ids.owner}/${ids.repo}/languages`);
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
}

/** Scans the repo's file tree for extensions GitHub's linguist doesn't know: .h#, .h#i, .hk, .hcs, .hl */
async function fetchCustomLanguageBytes(ids) {
  const totals = {};
  for (const branch of ["main", "master"]) {
    try {
      const res = await githubFetch(
        `https://api.github.com/repos/${ids.owner}/${ids.repo}/git/trees/${branch}?recursive=1`
      );
      if (!res.ok) continue;
      const data = await res.json();
      if (!Array.isArray(data.tree)) continue;

      for (const entry of data.tree) {
        if (entry.type !== "blob") continue;
        const ext = extensionOf(entry.path);
        const lang = EXTENSION_TO_LANGUAGE[ext];
        if (!lang) continue;
        totals[lang] = (totals[lang] || 0) + (entry.size || 0);
      }
      break; // stop once a branch resolves
    } catch {
      /* try next branch */
    }
  }
  return totals;
}

function extensionOf(path) {
  // handles multi-char extensions like "h#" and "h#i"
  const name = path.split("/").pop() || "";
  const dot = name.indexOf(".");
  if (dot === -1) return "";
  return name.slice(dot + 1).toLowerCase();
}

function renderLangWidget(breakdown) {
  const top = breakdown[0];
  const dominant = top && isCustomLanguage(top.name) ? "hsharp" : "other";
  els.widget.dataset.dominant = dominant;

  const bar = breakdown
    .map(
      (l) =>
        `<span style="flex-basis:${l.pct}%;background:${colorForLanguage(l.name)};" class="${
          l.name === "H#" ? "is-hsharp" : ""
        } ${needsOutline(l.name) ? "is-light" : ""}"></span>`
    )
    .join("");

  const legend = breakdown
    .map(
      (l) => `
      <div class="lang-legend-item ${l.name === "H#" ? "is-hsharp" : ""}">
        <span class="dot ${needsOutline(l.name) ? "is-light" : ""}" style="background:${colorForLanguage(l.name)}"></span>
        <b>${l.name}</b><span class="pct">${l.pct.toFixed(1)}%</span>
      </div>`
    )
    .join("");

  const hsharpBadge =
    top && top.name === "H#"
      ? `<div class="hsharp-badge">
           <div class="hsharp-hex"><span class="hsharp-hex-label">H#</span></div>
           <div class="hsharp-badge-text">
             <div class="top">H# leads this repo</div>
             <div class="sub">${top.pct.toFixed(1)}% of tracked bytes</div>
           </div>
         </div>`
      : "";

  els.widgetBody.innerHTML = `
    ${hsharpBadge}
    <div class="lang-bar">${bar}</div>
    <div class="lang-legend">${legend}</div>
  `;
}

function renderLangError() {
  els.widgetBody.innerHTML = `
    <p style="color:var(--muted);margin:0 0 10px;">Couldn't determine language breakdown for this repository.</p>
    <button class="retry-btn" id="retry-lang">Try again</button>
  `;
  document.getElementById("retry-lang")?.addEventListener("click", () => {
    els.widgetBody.innerHTML = `<p style="color:var(--muted);margin:0;">Detecting…</p>`;
    loadLanguages(currentIds);
  });
}

/* ---------------------------------------------------------- changelog ---- */

/** Manifest "versioning": shows the real commit history for bytes.hk from GitHub. */
async function loadChangelog(ids) {
  if (!els.changelogPanel) return;
  if (!ids) return renderChangelogError("Malformed repository URL.");

  const cacheKey = `commits:${ids.owner}/${ids.repo}`;
  const cached = cacheGet(cacheKey);
  if (cached) return renderChangelog(cached);

  try {
    const res = await githubFetch(
      `https://api.github.com/repos/${ids.owner}/${ids.repo}/commits?path=bytes.hk&per_page=8`
    );
    if (res.status === 403) {
      return renderChangelogError("rate limit hit — add a GitHub token in settings", true);
    }
    if (!res.ok) return renderChangelogError(`GitHub API → HTTP ${res.status}`);
    const commits = await res.json();
    if (!Array.isArray(commits)) return renderChangelogError("Unexpected response from GitHub.");
    cacheSet(cacheKey, commits, TTL.COMMITS);
    renderChangelog(commits);
  } catch (err) {
    renderChangelogError(err.message);
  }
}

function renderChangelog(commits) {
  if (!commits.length) {
    els.changelogPanel.innerHTML = `
      <h3>Manifest history</h3>
      <p style="color:var(--muted);font-size:13px;margin:0;">No commits found that touched bytes.hk.</p>
    `;
    return;
  }

  const items = commits
    .map((c) => {
      const sha = (c.sha || "").slice(0, 7);
      const message = (c.commit?.message || "").split("\n")[0];
      const author = c.commit?.author?.name || c.author?.login || "unknown";
      const authorUrl = c.author?.login ? `author.html?u=${encodeURIComponent(c.author.login)}` : null;
      const date = c.commit?.author?.date ? new Date(c.commit.author.date).toLocaleDateString() : "";
      return `
        <div class="changelog-item">
          <div class="changelog-top">
            <a class="changelog-msg" href="${c.html_url}" target="_blank" rel="noopener">${escapeHtml(message)}</a>
            <span class="changelog-sha">${sha}</span>
          </div>
          <div class="changelog-meta">
            ${authorUrl ? `<a href="${authorUrl}">${escapeHtml(author)}</a>` : escapeHtml(author)}
            <span>·</span>
            <span>${date}</span>
          </div>
        </div>`;
    })
    .join("");

  els.changelogPanel.innerHTML = `<h3>Manifest history</h3><div class="changelog-list">${items}</div>`;
}

function renderChangelogError(message, isRateLimit) {
  els.changelogPanel.innerHTML = `
    <h3>Manifest history</h3>
    <p style="color:var(--muted);font-size:13px;margin:0 0 10px;">Couldn't load commit history (${escapeHtml(
      message
    )}).</p>
    <div style="display:flex;gap:8px;">
      <button class="retry-btn" id="retry-changelog">Try again</button>
      ${isRateLimit ? `<button class="retry-btn" id="open-gh-settings">Add token</button>` : ""}
    </div>
  `;
  document.getElementById("retry-changelog")?.addEventListener("click", () => loadChangelog(currentIds));
  document.getElementById("open-gh-settings")?.addEventListener("click", () => {
    document.querySelector("[data-gh-settings]")?.click();
  });
}

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

els.codeCopy?.addEventListener("click", async () => {
  const raw = els.code.dataset.raw || els.code.textContent || "";
  try {
    await navigator.clipboard.writeText(raw);
    const original = els.codeCopy.textContent;
    els.codeCopy.textContent = "Copied";
    els.codeCopy.classList.add("is-copied");
    setTimeout(() => {
      els.codeCopy.textContent = original;
      els.codeCopy.classList.remove("is-copied");
    }, 1400);
  } catch {
    /* clipboard unavailable — ignore silently */
  }
});

els.widgetToggle?.addEventListener("click", () => {
  els.widget.classList.toggle("is-collapsed");
  els.widgetBody.style.display = els.widget.classList.contains("is-collapsed") ? "none" : "";
});

init();
