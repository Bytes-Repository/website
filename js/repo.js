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
  readmeBody: document.getElementById("readme-body"),
  readmeSourceLink: document.getElementById("readme-source-link"),
};

// ownerRepoFromUrl, fetchRepoMeta, manifestCandidateUrls, uniq are defined
// once in js/enrich.js (loaded before this file).

let currentIds = null;
let currentRepoMeta = null; // GitHub repo metadata: description, stars, default branch, ...

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
  loadReadme(currentIds);
  initSourceBrowser(currentIds);
}

/* ------------------------------------------------------------------ readme */

const README_FILENAMES = ["README.md", "Readme.md", "readme.md", "README.MD", "README.markdown"];
const README_PLAINTEXT_FILENAMES = ["README", "README.txt", "README.rst"];

/** Fetches and renders the repo's README, crates.io-style — the main "what is this" content on the page. */
async function loadReadme(ids) {
  if (!els.readmeBody) return;
  if (!ids) return renderReadmeError("Malformed repository URL.");

  const cacheKey = `readme:${ids.owner}/${ids.repo}`;
  const fresh = cacheGet(cacheKey);
  if (fresh) {
    // Still within TTL.README — no network calls needed at all.
    renderReadme(fresh);
    return;
  }

  const cached = cacheGetStale(cacheKey);
  if (cached) renderReadme(cached);

  // Independent of loadManifest's own fetchRepoMeta call — fetchRepoMeta
  // dedupes concurrent in-flight requests for the same repo, so this
  // doesn't cost an extra GitHub API call when both run at once.
  const meta = await fetchRepoMeta(ids);
  if (!currentRepoMeta) currentRepoMeta = meta;
  const branches = uniq([meta?.default_branch, "main", "master"]);
  const candidates = [];
  for (const branch of branches) {
    for (const file of README_FILENAMES) candidates.push({ branch, file, plain: false });
    for (const file of README_PLAINTEXT_FILENAMES) candidates.push({ branch, file, plain: true });
  }

  for (const { branch, file, plain } of candidates) {
    try {
      const res = await githubFetch(`https://raw.githubusercontent.com/${ids.owner}/${ids.repo}/${branch}/${file}`, {
        cache: "no-store",
      });
      if (!res.ok) continue;
      const text = await res.text();
      const result = { text, plain, branch, file };
      cacheSet(cacheKey, result, TTL.README);
      renderReadme(result);
      return;
    } catch {
      /* try next candidate */
    }
  }
  if (!cached) renderReadmeError("No README found at the repo root.");
}

function renderReadme(result) {
  const { text, plain, branch, file } = result;
  const ids = currentIds;

  if (els.readmeSourceLink && ids) {
    els.readmeSourceLink.href = `https://github.com/${ids.owner}/${ids.repo}/blob/${branch}/${file}`;
    els.readmeSourceLink.hidden = false;
  }

  if (plain) {
    els.readmeBody.innerHTML = `<pre class="readme-plain">${escapeHtml(text)}</pre>`;
    return;
  }

  try {
    els.readmeBody.innerHTML = renderMarkdown(text, { owner: ids?.owner, repo: ids?.repo, branch });
  } catch (err) {
    console.error("[bytes.io] README render failed:", err);
    els.readmeBody.innerHTML = `<pre class="readme-plain">${escapeHtml(text)}</pre>`;
  }
}

function renderReadmeError(message) {
  els.readmeBody.innerHTML = `
    <p style="color:var(--muted);font-size:13px;margin:0 0 10px;">${escapeHtml(message)}</p>
    <button class="retry-btn" id="retry-readme">Try again</button>
  `;
  document.getElementById("retry-readme")?.addEventListener("click", () => {
    els.readmeBody.innerHTML = `<p style="color:var(--muted);font-size:13px;">Loading README…</p>`;
    loadReadme(currentIds);
  });
}

/* ---------------------------------------------------------------- manifest */

async function loadManifest(ids) {
  if (!ids) return renderManifestError("Malformed repository URL.");

  const cacheKey = `manifest:${ids.owner}/${ids.repo}`;
  // Guard against a stale localStorage entry from an older version of this
  // site, which cached the manifest as a plain string instead of
  // { text, filename }.
  const isValidShape = (v) => v && typeof v === "object" && "text" in v;

  const fresh = cacheGet(cacheKey);
  if (isValidShape(fresh)) {
    // Still within TTL.MANIFEST — render it and stop. No network calls at
    // all, not even fetchRepoMeta for the branch, since re-checking a
    // manifest we already know is current wastes budget for no benefit.
    renderManifest(fresh.text, fresh.filename);
    setFreshness(els.codeHead, cacheAge(cacheKey), fresh.filename || "Bytes.hk");
    return;
  }

  const rawStale = cacheGetStale(cacheKey);
  const cached = isValidShape(rawStale) ? rawStale : null;
  if (cached) {
    renderManifest(cached.text, cached.filename);
    setFreshness(els.codeHead, cacheAge(cacheKey), cached.filename || "Bytes.hk");
  }

  // Repo metadata (real GitHub description, stars, default branch, ...) is
  // fetched up front: it tells us which branch to check first, and its
  // `description` is what we fall back to if the manifest is missing one
  // or can't be found at all — this is the repo's actual GitHub
  // description, distinct from anything declared inside Bytes.hk.
  currentRepoMeta = await fetchRepoMeta(ids);
  if (!cached) {
    els.desc.textContent = currentRepoMeta?.description || "Fetching manifest…";
  }

  const branches = uniq([currentRepoMeta?.default_branch, "main", "master"]);
  const candidates = manifestCandidateUrls(ids, branches);

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
      const filename = url.split("/").pop();
      console.info(`[bytes.io] ${filename} loaded from ${new URL(url).hostname}`);
      cacheSet(cacheKey, { text, filename }, TTL.MANIFEST);
      renderManifest(text, filename);
      setFreshness(els.codeHead, 0, filename);
      return;
    } catch (err) {
      failures.push(`${new URL(url).hostname} → ${err.message}`);
    }
  }
  console.error("[bytes.io] failed to load Bytes.hk:", failures.join(" | "));
  if (!cached) {
    renderManifestError(
      `No Bytes.hk (or bytes.hk) found at the repo root (checked ${branches.join(", ")}, raw + jsDelivr).`
    );
  }
}

/** Appends a "· cached Xm ago" / "· just now" freshness note. With a label, replaces el's text as "label · suffix"; without, just sets "· suffix" (for small inline tags). */
function setFreshness(el, ageMs, label) {
  if (!el) return;
  const suffix = ageMs === 0 || ageMs == null ? "just now" : `cached ${formatAge(ageMs)}`;
  el.textContent = label ? `${label} · ${suffix}` : `· ${suffix}`;
}

function renderManifest(source, filename) {
  const parsed = parseBytesHk(source);
  const pkg = parsed.package || {};
  const deps = parsed.deps || {};
  const build = parsed.build || {};

  // Manifest description wins when present; otherwise fall back to the
  // repo's real GitHub description, then a generic note.
  els.desc.textContent = pkg.description || currentRepoMeta?.description || "No description available.";

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
    ${row("language", build.lang)}
    ${row("entry", build.entry)}
    ${row("output", build.output)}
    ${row("emit", build.emit)}
    ${row("target", build.target)}
  `;

  renderInstallPanel(pkg, currentIds);
  renderStatsPanel(parsed.stats || {}, currentRepoMeta);
  renderVersionsPanel(parsed.downloads || {}, pkg.version);

  els.codeHead.textContent = filename || "Bytes.hk";
  els.code.innerHTML = highlightBytesHk(source);
  els.code.dataset.raw = source;
}

/** Renders a copyable "how to install" command using the package name from Bytes.hk. */
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
    <p class="install-label">Or add to your Bytes.hk</p>
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

/** Renders the optional [stats] block from Bytes.hk (downloads, tags), plus
 *  live GitHub stars/forks — falling back to GitHub's numbers for stars
 *  when the manifest doesn't declare its own [stats] -> stars. */
function renderStatsPanel(stats, meta) {
  if (!els.statsPanel) return;

  const downloads = stats.downloads;
  const tags = Array.isArray(stats.tags) ? stats.tags : Array.isArray(meta?.topics) ? meta.topics : [];
  const stars = stats.stars != null ? stats.stars : meta?.stargazers_count;
  const forks = meta?.forks_count;
  const openIssues = meta?.open_issues_count;

  const hasAny = downloads != null || tags.length || stars != null || forks != null;

  if (!hasAny) {
    els.statsPanel.innerHTML = `
      <h3>Stats</h3>
      <p style="color:var(--muted);font-size:13px;margin:0;">No [stats] block in Bytes.hk and no GitHub stats available.</p>
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

  const starsHtml = stars != null ? row("stars", formatCount(stars)) : "";
  const forksHtml = forks != null ? row("forks", formatCount(forks)) : "";
  const issuesHtml = openIssues != null ? row("open issues", formatCount(openIssues)) : "";

  const tagsHtml = tags.length
    ? `<div class="tag-list">${tags.map((t) => `<span class="tag-pill">${t}</span>`).join("")}</div>`
    : "";

  els.statsPanel.innerHTML = `
    <h3>Stats</h3>
    ${downloadsHtml}
    ${starsHtml}
    ${forksHtml}
    ${issuesHtml}
    ${tagsHtml}
  `;
}

/* formatCount is defined once in js/enrich.js (loaded before this file). */

/* compareVersionsDesc now comes from js/semver-lite.js (spec-correct SemVer precedence). */

/** Renders the optional [downloads] block from Bytes.hk: per-version download counts, crates.io-style. */
function renderVersionsPanel(downloadsByVersion, currentVersion) {
  if (!els.versionsPanel) return;

  const entries = Object.entries(downloadsByVersion).filter(([, v]) => typeof v === "number");

  if (!entries.length) {
    els.versionsPanel.innerHTML = `
      <h3>Downloads by version</h3>
      <p style="color:var(--muted);font-size:13px;margin:0;">No [downloads] block in Bytes.hk.</p>
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
  // The manifest itself couldn't be found/parsed, but the repo's real
  // GitHub description (fetched in loadManifest via fetchRepoMeta) is
  // still worth showing at the top instead of just an error string.
  els.desc.textContent = currentRepoMeta?.description || message;
  els.packagePanel.innerHTML = `<h3>Package</h3><p style="color:var(--muted);font-size:13px;margin:0;">Unavailable.</p>`;
  if (els.installPanel) {
    els.installPanel.innerHTML = `<h3>Install</h3><p style="color:var(--muted);font-size:13px;margin:0;">Unavailable.</p>`;
  }
  els.depsPanel.innerHTML = `<h3>Dependencies</h3><p style="color:var(--muted);font-size:13px;margin:0;">Unavailable.</p>`;
  els.buildPanel.innerHTML = `<h3>Build</h3><p style="color:var(--muted);font-size:13px;margin:0;">Unavailable.</p>`;
  renderStatsPanel({}, currentRepoMeta); // still show GitHub stars/forks/topics if we have them
  if (els.versionsPanel) {
    els.versionsPanel.innerHTML = `<h3>Downloads by version</h3><p style="color:var(--muted);font-size:13px;margin:0;">Unavailable.</p>`;
  }
  els.codeHead.textContent = "Bytes.hk — not found";
  els.code.innerHTML = `;; ${escapeHtml(message)}<br/><button class="retry-btn" id="retry-manifest" style="margin-top:12px;">Try again</button>`;
  document.getElementById("retry-manifest")?.addEventListener("click", () => {
    els.desc.textContent = currentRepoMeta?.description || "Fetching manifest…";
    loadManifest(currentIds);
  });
}

function row(k, v) {
  if (!v) return "";
  return `<div class="kv-row"><span class="k">${k}</span><span class="v">${v}</span></div>`;
}

/** Renders one [package] author entry as a link to that author's bytes.io profile page. */
function authorLinkHtml(username) {
  const clean = String(username).replace(/^@/, "");
  return `<a class="author-link" href="author.html?u=${encodeURIComponent(clean)}">${clean}</a>`;
}

/* --------------------------------------------------------------- languages */

async function loadLanguages(ids) {
  if (!ids) return renderLangError();

  const cacheKey = `langs:${ids.owner}/${ids.repo}`;
  const fresh = cacheGet(cacheKey);
  if (fresh) {
    renderLangWidget(fresh);
    setFreshness(els.widgetFreshness, cacheAge(cacheKey), null);
    return; // still within TTL.LANGS — the underlying tree fetch would also
    // short-circuit on its own cache, but skip the whole call chain anyway
  }

  const cached = cacheGetStale(cacheKey);
  if (cached) {
    renderLangWidget(cached);
    setFreshness(els.widgetFreshness, cacheAge(cacheKey), null);
  }

  const result = await fetchLanguageBytesFromTree(ids);

  const total = Object.values(result.totals).reduce((a, b) => a + b, 0);

  if (!total) {
    if (!cached) {
      console.warn(`[bytes.io] language detection found nothing for ${ids.owner}/${ids.repo}:`, {
        treeError: result.error,
      });
      renderLangError(result.error === "rate-limit");
    }
    return;
  }

  const breakdown = Object.entries(result.totals)
    .map(([name, bytes]) => ({ name, bytes, pct: (bytes / total) * 100 }))
    .sort((a, b) => b.bytes - a.bytes);

  cacheSet(cacheKey, breakdown, TTL.LANGS);
  renderLangWidget(breakdown);
  setFreshness(els.widgetFreshness, 0, null);
}

/**
 * Computes the full language breakdown — standard languages AND the 4
 * bytes.io/H# ones GitHub's linguist doesn't know (H#, H# Interface, hk,
 * HackerScript, Hacker Lang) — from a single recursive file-tree listing.
 *
 * This used to be two separate calls: GitHub's own `/languages` endpoint
 * for standard languages, plus our own tree scan just for the custom
 * extensions. Merging them into one avoids spending a second
 * api.github.com request (and a second point of failure) on every single
 * repo page view — under the unauthenticated 60/hour limit, that second
 * call was often the difference between the widget working and hitting
 * "rate limit hit" for anyone browsing more than a handful of repos.
 */
async function fetchLanguageBytesFromTree(ids) {
  const totals = {};
  // Must resolve the repo's real default branch before building the tree
  // candidates — reading currentRepoMeta straight off wasn't safe here:
  // loadLanguages() runs concurrently with loadManifest() from init(), so
  // currentRepoMeta was frequently still null at this point, silently
  // falling back to ["main", "master"] and failing outright for any repo
  // whose default branch is neither (fetchRepoMeta is deduped, so this
  // costs no extra request when loadManifest already kicked it off).
  const meta = currentRepoMeta || (await fetchRepoMeta(ids));
  if (!currentRepoMeta) currentRepoMeta = meta;
  const branches = uniq([meta?.default_branch, "main", "master"]);
  const treeResult = await fetchRepoTree(ids, branches);

  for (const entry of treeResult.entries) {
    if (entry.type !== "blob") continue;
    const ext = extensionOf(entry.path);
    const lang = EXTENSION_TO_LANGUAGE[ext];
    if (!lang) continue;
    totals[lang] = (totals[lang] || 0) + (entry.size || 0);
  }
  return { totals, error: treeResult.error };
}

// extensionOf is defined once in js/enrich.js (loaded before this file).

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

function renderLangError(rateLimited) {
  const resetNote = rateLimited && typeof rateLimitResetNote === "function" ? rateLimitResetNote() : null;
  els.widgetBody.innerHTML = `
    <p style="color:var(--muted);margin:0 0 10px;">${
      rateLimited
        ? `GitHub API rate limit hit while detecting languages.${resetNote ? ` This IP's limit ${escapeHtml(resetNote)}.` : ""}`
        : "Couldn't determine language breakdown for this repository."
    }</p>
    <div style="display:flex;gap:8px;">
      <button class="retry-btn" id="retry-lang">Try again</button>
      ${rateLimited ? `<button class="retry-btn" id="open-gh-settings-lang">Add token</button>` : ""}
    </div>
  `;
  document.getElementById("retry-lang")?.addEventListener("click", () => {
    els.widgetBody.innerHTML = `<p style="color:var(--muted);margin:0;">Detecting…</p>`;
    loadLanguages(currentIds);
  });
  document.getElementById("open-gh-settings-lang")?.addEventListener("click", () => {
    document.querySelector("[data-gh-settings]")?.click();
  });
}

/* ---------------------------------------------------------- changelog ---- */

/** Manifest "versioning": shows the real commit history for Bytes.hk from GitHub. */
async function loadChangelog(ids) {
  if (!els.changelogPanel) return;
  if (!ids) return renderChangelogError("Malformed repository URL.");

  const cacheKey = `commits:${ids.owner}/${ids.repo}`;
  const cached = cacheGet(cacheKey);
  if (cached) return renderChangelog(cached);

  // This is the least essential of the page's api.github.com calls — the
  // manifest, languages, and source browser all matter more. When an
  // earlier call this session has already shown the budget is nearly
  // gone, skip this one pre-emptively rather than spend one of the last
  // few requests on a call that would almost certainly just 403 anyway.
  if (typeof isRateBudgetLow === "function" && isRateBudgetLow()) {
    const resetNote = typeof rateLimitResetNote === "function" ? rateLimitResetNote() : null;
    return renderChangelogError(
      `skipped to save your remaining GitHub requests${resetNote ? ` — this IP's limit ${resetNote}` : ""}`,
      true
    );
  }

  try {
    // GitHub's commits-by-path filter is case-sensitive, and real repos use
    // "Bytes.hk" (capital B), so that's tried first; "bytes.hk" is a
    // fallback for the few repos that spell it lowercase. Deliberately
    // only 2 attempts (not all of MANIFEST_FILENAMES) — this endpoint
    // counts against the same api.github.com rate limit as everything
    // else on the page, and the all-caps spelling is rare enough not to
    // be worth a 3rd request on every page view.
    let commits = null;
    let lastStatus = null;
    for (const path of ["Bytes.hk", "bytes.hk"]) {
      const res = await githubFetch(
        `https://api.github.com/repos/${ids.owner}/${ids.repo}/commits?path=${encodeURIComponent(path)}&per_page=8`
      );
      lastStatus = res.status;
      if (res.status === 403) {
        const resetNote = typeof rateLimitResetNote === "function" ? rateLimitResetNote() : null;
        return renderChangelogError(
          `rate limit hit — add a GitHub token in settings${resetNote ? ` (this IP's limit ${resetNote})` : ""}`,
          true
        );
      }
      if (!res.ok) continue;
      const data = await res.json();
      if (Array.isArray(data) && data.length) {
        commits = data;
        break;
      }
      if (Array.isArray(data) && !commits) commits = data; // keep an empty-but-valid result as a fallback
    }
    if (!commits) return renderChangelogError(`GitHub API → HTTP ${lastStatus}`);
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
      <p style="color:var(--muted);font-size:13px;margin:0;">No commits found that touched Bytes.hk.</p>
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

/* escapeHtml is defined once in js/enrich.js (loaded before this file). */

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
