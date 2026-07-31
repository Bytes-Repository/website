const params = new URLSearchParams(location.search);
const repoName = params.get("name");
const repoUrl = params.get("url");

const els = {
  glyph: document.getElementById("repo-glyph"),
  title: document.getElementById("repo-title"),
  desc: document.getElementById("repo-desc"),
  ghLink: document.getElementById("repo-gh-link"),
  packagePanel: document.getElementById("panel-package"),
  depsPanel: document.getElementById("panel-deps"),
  buildPanel: document.getElementById("panel-build"),
  code: document.getElementById("hk-code"),
  codeHead: document.getElementById("hk-code-head"),
  widget: document.getElementById("lang-widget"),
  widgetBody: document.getElementById("lang-widget-body"),
  widgetToggle: document.getElementById("lang-widget-toggle"),
};

function ownerRepoFromUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    return { owner: parts[0], repo: parts[1] };
  } catch {
    return null;
  }
}

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

  const ids = ownerRepoFromUrl(repoUrl);
  loadManifest(ids);
  loadLanguages(ids);
}

/* ---------------------------------------------------------------- manifest */

async function loadManifest(ids) {
  if (!ids) return renderManifestError("Malformed repository URL.");

  const branches = ["main", "master"];
  const candidates = branches.flatMap((branch) => [
    `https://raw.githubusercontent.com/${ids.owner}/${ids.repo}/${branch}/bytes.hk`,
    `https://cdn.jsdelivr.net/gh/${ids.owner}/${ids.repo}@${branch}/bytes.hk`,
  ]);

  const failures = [];
  for (const url of candidates) {
    try {
      const bust = url.includes("?") ? "&" : "?";
      const res = await fetch(`${url}${bust}_=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) {
        failures.push(`${new URL(url).hostname} → HTTP ${res.status}`);
        continue;
      }
      const text = await res.text();
      console.info(`[bytes.io] bytes.hk loaded from ${new URL(url).hostname}`);
      renderManifest(text);
      return;
    } catch (err) {
      failures.push(`${new URL(url).hostname} → ${err.message}`);
    }
  }
  console.error("[bytes.io] failed to load bytes.hk:", failures.join(" | "));
  renderManifestError(
    "No bytes.hk found at the repo root (checked main and master, raw + jsDelivr)."
  );
}

function renderManifest(source) {
  const parsed = parseBytesHk(source);
  const pkg = parsed.package || {};
  const deps = parsed.deps || {};
  const build = parsed.build || {};

  els.desc.textContent = pkg.description || "No description in bytes.hk.";

  els.packagePanel.innerHTML = `
    <h3>Package</h3>
    ${row("name", pkg.name)}
    ${row("version", pkg.version)}
    ${row("license", pkg.license)}
    ${row("authors", Array.isArray(pkg.authors) ? pkg.authors.join(", ") : pkg.authors)}
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

  els.codeHead.textContent = "bytes.hk";
  els.code.innerHTML = highlightBytesHk(source);
}

function renderManifestError(message) {
  els.desc.textContent = message;
  els.packagePanel.innerHTML = `<h3>Package</h3><p style="color:var(--muted);font-size:13px;margin:0;">Unavailable.</p>`;
  els.depsPanel.innerHTML = `<h3>Dependencies</h3><p style="color:var(--muted);font-size:13px;margin:0;">Unavailable.</p>`;
  els.buildPanel.innerHTML = `<h3>Build</h3><p style="color:var(--muted);font-size:13px;margin:0;">Unavailable.</p>`;
  els.codeHead.textContent = "bytes.hk — not found";
  els.code.textContent = `# ${message}`;
}

function row(k, v) {
  if (!v) return "";
  return `<div class="kv-row"><span class="k">${k}</span><span class="v">${v}</span></div>`;
}

/* --------------------------------------------------------------- languages */

async function loadLanguages(ids) {
  if (!ids) return renderLangError();

  const [githubBytes, customBytes] = await Promise.all([
    fetchGithubLanguages(ids),
    fetchCustomLanguageBytes(ids),
  ]);

  const merged = Object.assign({}, githubBytes, customBytes);
  const total = Object.values(merged).reduce((a, b) => a + b, 0);

  if (!total) return renderLangError();

  const breakdown = Object.entries(merged)
    .map(([name, bytes]) => ({ name, bytes, pct: (bytes / total) * 100 }))
    .sort((a, b) => b.bytes - a.bytes);

  renderLangWidget(breakdown);
}

async function fetchGithubLanguages(ids) {
  try {
    const res = await fetch(`https://api.github.com/repos/${ids.owner}/${ids.repo}/languages`);
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
}

/** Scans the repo's file tree for extensions GitHub's linguist doesn't know: .h#, .h#i, .hk */
async function fetchCustomLanguageBytes(ids) {
  const totals = {};
  for (const branch of ["main", "master"]) {
    try {
      const res = await fetch(
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
        }"></span>`
    )
    .join("");

  const legend = breakdown
    .map(
      (l) => `
      <div class="lang-legend-item ${l.name === "H#" ? "is-hsharp" : ""}">
        <span class="dot" style="background:${colorForLanguage(l.name)}"></span>
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
    <p style="color:var(--muted);margin:0;">Couldn't determine language breakdown for this repository.</p>
  `;
}

els.widgetToggle?.addEventListener("click", () => {
  els.widget.classList.toggle("is-collapsed");
  els.widgetBody.style.display = els.widget.classList.contains("is-collapsed") ? "none" : "";
});

init();
