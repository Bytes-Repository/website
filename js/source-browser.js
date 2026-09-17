const SRC_MAX_PREVIEW_BYTES = 400_000; // ~400kb — above this we link out instead of fetching
const SRC_BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg", "pdf",
  "zip", "gz", "tgz", "tar", "7z", "rar", "bz2", "xz",
  "woff", "woff2", "ttf", "eot", "otf",
  "mp3", "mp4", "mov", "wav", "ogg", "webm", "avi",
  "exe", "dll", "so", "dylib", "a", "o", "class", "jar", "wasm", "bin", "dat", "pyc", "lock",
]);

/** Line-comment token per extension, used for the source viewer's light highlighting. */
const SRC_COMMENT_TOKENS = {
  "h#": "//", "h#i": "//", hk: ";;", hcs: "//", hl: "//",
  js: "//", jsx: "//", ts: "//", tsx: "//", mjs: "//", cjs: "//",
  c: "//", h: "//", cpp: "//", cc: "//", hpp: "//", rs: "//", go: "//",
  java: "//", cs: "//", swift: "//", kt: "//", scala: "//", zig: "//",
  py: "#", rb: "#", sh: "#", bash: "#", yml: "#", yaml: "#", toml: "#", pl: "#", r: "#",
  lua: "--", sql: "--",
};

let srcState = null; // { ids, branch, entries, root }

function sourceBrowserEls() {
  return {
    tree: document.getElementById("src-tree"),
    view: document.getElementById("src-view"),
    filter: document.getElementById("src-filter"),
    branchPill: document.getElementById("src-branch-pill"),
  };
}

function initSourceBrowser(ids) {
  const els2 = sourceBrowserEls();
  if (!els2.tree || !ids) return;

  loadSourceTree(ids);

  let filterTimer = null;
  els2.filter?.addEventListener("input", () => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => filterSourceTree(els2.filter.value.trim().toLowerCase()), 120);
  });
}

async function loadSourceTree(ids) {
  const els2 = sourceBrowserEls();
  // Independent of loadManifest's own fetchRepoMeta call — deduped via its
  // in-flight cache, so this doesn't cost an extra GitHub API call.
  const meta = await fetchRepoMeta(ids);
  if (!currentRepoMeta) currentRepoMeta = meta;
  const branches = uniq([meta?.default_branch, "main", "master"]);
  const result = await fetchRepoTree(ids, branches);

  if (!result.entries.some((e) => e.type === "blob")) {
    const rateLimited = result.error === "rate-limit";
    const resetNote = rateLimited && typeof rateLimitResetNote === "function" ? rateLimitResetNote() : null;
    console.warn(`[bytes.io] source browser: couldn't load a file tree for ${ids.owner}/${ids.repo} (${result.error || "empty tree"})`);
    els2.tree.innerHTML = `
      <p style="color:var(--muted);font-size:13px;">${
        rateLimited
          ? `GitHub API rate limit hit while loading the file tree.${resetNote ? ` This IP's limit ${escapeHtml(resetNote)}.` : ""}`
          : "Couldn't load the file tree."
      }</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="retry-btn" id="retry-src-tree">Try again</button>
        ${rateLimited ? `<button class="retry-btn" id="open-gh-settings-src">Add token</button>` : ""}
      </div>
    `;
    document.getElementById("retry-src-tree")?.addEventListener("click", () => {
      els2.tree.innerHTML = `<p style="color:var(--muted);font-size:13px;">Loading file tree…</p>`;
      loadSourceTree(ids);
    });
    document.getElementById("open-gh-settings-src")?.addEventListener("click", () => {
      document.querySelector("[data-gh-settings]")?.click();
    });
    return;
  }

  const blobCount = result.entries.filter((e) => e.type === "blob").length;
  srcState = {
    ids,
    branch: result.branch,
    entries: result.entries,
    root: buildFileTree(result.entries),
  };

  if (els2.branchPill) els2.branchPill.textContent = result.branch;

  els2.tree.innerHTML = "";
  els2.tree.appendChild(renderTreeLevel(srcState.root, 0, blobCount <= 60));

  if (result.truncated) {
    const note = document.createElement("p");
    note.className = "src-truncated-note";
    note.innerHTML = `This repository is large — showing a partial listing. <a href="https://github.com/${ids.owner}/${ids.repo}/tree/${result.branch}" target="_blank" rel="noopener">View the full source on GitHub →</a>`;
    els2.tree.appendChild(note);
  }

  // Auto-open a sensible first file.
  const preferred = ["Bytes.hk", "bytes.hk", "README.md", "Readme.md", "readme.md"];
  for (const name of preferred) {
    const hit = srcState.entries.find((e) => e.type === "blob" && e.path === name);
    if (hit) {
      openSourceFile(hit.path, hit.size);
      return;
    }
  }
  els2.view.innerHTML = `<p class="src-placeholder">Select a file from the tree to preview it.</p>`;
}

/** Turns the flat recursive git-tree listing into a nested folder structure. */
function buildFileTree(entries) {
  const root = { name: "", path: "", type: "tree", children: new Map() };
  for (const entry of entries) {
    if (entry.type !== "blob") continue;
    const parts = entry.path.split("/");
    let node = root;
    let acc = "";
    parts.forEach((part, idx) => {
      acc = acc ? `${acc}/${part}` : part;
      const isLeaf = idx === parts.length - 1;
      if (!node.children.has(part)) {
        node.children.set(part, {
          name: part,
          path: acc,
          type: isLeaf ? "blob" : "tree",
          size: isLeaf ? entry.size : undefined,
          children: new Map(),
        });
      }
      node = node.children.get(part);
    });
  }
  return root;
}

/** Renders one <ul> for a tree node's children; subfolders are <details> so they nest/collapse for free. */
function renderTreeLevel(node, depth, forceOpen) {
  const ul = document.createElement("ul");
  ul.className = "src-list";
  const children = [...node.children.values()].sort((a, b) => {
    if (a.type !== b.type) return a.type === "tree" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  for (const child of children) {
    const li = document.createElement("li");
    if (child.type === "tree") {
      const details = document.createElement("details");
      details.open = forceOpen || depth === 0;
      const summary = document.createElement("summary");
      summary.className = "src-node is-dir";
      summary.innerHTML = `<span class="src-icon" aria-hidden="true">📁</span><span class="src-name">${escapeHtml(child.name)}</span>`;
      details.appendChild(summary);
      details.appendChild(renderTreeLevel(child, depth + 1, forceOpen));
      li.appendChild(details);
    } else {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "src-node is-file";
      btn.dataset.path = child.path;
      btn.innerHTML = `<span class="src-icon" aria-hidden="true">${fileIcon(child.name)}</span><span class="src-name">${escapeHtml(child.name)}</span>`;
      btn.addEventListener("click", () => openSourceFile(child.path, child.size));
      li.appendChild(btn);
    }
    ul.appendChild(li);
  }
  return ul;
}

function fileIcon(name) {
  const ext = extensionOf(name);
  if (ext === "h#" || ext === "hk" || ext === "h#i") return "⚡";
  if (["md", "markdown", "rst", "txt"].includes(ext)) return "📄";
  if (["json", "yml", "yaml", "toml"].includes(ext)) return "🔧";
  if (SRC_BINARY_EXTENSIONS.has(ext)) return "🗂";
  return "📄";
}

function filterSourceTree(query) {
  const els2 = sourceBrowserEls();
  if (!srcState) return;
  const allLis = els2.tree.querySelectorAll("li");
  const fileButtons = els2.tree.querySelectorAll(".src-node.is-file");

  if (!query) {
    allLis.forEach((li) => (li.style.display = ""));
    els2.tree.querySelectorAll(":scope > ul details").forEach((d) => (d.open = false));
    els2.tree.querySelectorAll(":scope > ul > li > details").forEach((d) => (d.open = true));
    return;
  }

  allLis.forEach((li) => (li.style.display = "none"));
  fileButtons.forEach((btn) => {
    if (!btn.dataset.path.toLowerCase().includes(query)) return;
    let li = btn.closest("li");
    while (li) {
      li.style.display = "";
      const parentDetails = li.parentElement?.closest("details");
      li = parentDetails ? (parentDetails.open = true, parentDetails.closest("li")) : null;
    }
  });
}

async function openSourceFile(path, size) {
  const els2 = sourceBrowserEls();
  if (!srcState) return;
  const { ids, branch } = srcState;

  els2.tree.querySelectorAll(".src-node.is-file.is-active").forEach((n) => n.classList.remove("is-active"));
  const activeBtn = [...els2.tree.querySelectorAll(".src-node.is-file")].find((b) => b.dataset.path === path);
  activeBtn?.classList.add("is-active");

  els2.view.innerHTML = renderSourceHead(path, ids, branch) + `<p style="color:var(--muted);font-size:13px;padding:16px 18px;margin:0;">Loading…</p>`;

  const ext = extensionOf(path);
  if (SRC_BINARY_EXTENSIONS.has(ext) || (size != null && size > SRC_MAX_PREVIEW_BYTES)) {
    const reason =
      size != null && size > SRC_MAX_PREVIEW_BYTES
        ? `File is ${formatCount(size)} bytes — too large to preview here.`
        : "This file type can't be previewed here.";
    els2.view.innerHTML =
      renderSourceHead(path, ids, branch) +
      `<div class="src-unavailable"><p>${reason}</p><a href="https://github.com/${ids.owner}/${ids.repo}/blob/${branch}/${path}" target="_blank" rel="noopener">View on GitHub →</a></div>`;
    return;
  }

  try {
    const res = await githubFetch(`https://raw.githubusercontent.com/${ids.owner}/${ids.repo}/${branch}/${path}`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    els2.view.innerHTML = renderSourceHead(path, ids, branch) + renderSourceCode(text, ext);
    els2.view.querySelector(".src-copy")?.addEventListener("click", async (e) => {
      try {
        await navigator.clipboard.writeText(text);
        const btn = e.currentTarget;
        const original = btn.textContent;
        btn.textContent = "Copied";
        setTimeout(() => (btn.textContent = original), 1300);
      } catch {
        /* clipboard unavailable — ignore */
      }
    });
  } catch (err) {
    els2.view.innerHTML =
      renderSourceHead(path, ids, branch) +
      `<div class="src-unavailable"><p>Couldn't load this file (${escapeHtml(err.message)}).</p><a href="https://github.com/${ids.owner}/${ids.repo}/blob/${branch}/${path}" target="_blank" rel="noopener">View on GitHub →</a></div>`;
  }
}

function renderSourceHead(path, ids, branch) {
  const parts = path.split("/");
  const crumbs = parts.map((part) => `<span class="src-crumb">${escapeHtml(part)}</span>`).join('<span class="src-crumb-sep">/</span>');
  return `
    <div class="src-view-head">
      <div class="src-breadcrumb">${crumbs}</div>
      <div class="src-view-actions">
        <button class="code-copy src-copy" title="Copy file contents">Copy</button>
        <a class="code-copy" href="https://raw.githubusercontent.com/${ids.owner}/${ids.repo}/${branch}/${path}" target="_blank" rel="noopener">Raw</a>
        <a class="code-copy" href="https://github.com/${ids.owner}/${ids.repo}/blob/${branch}/${path}" target="_blank" rel="noopener">GitHub ↗</a>
      </div>
    </div>`;
}

/** Read-only viewer with CSS-counter line numbers and light comment/string highlighting. */
function renderSourceCode(text, ext) {
  const token = SRC_COMMENT_TOKENS[ext];
  let lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop(); // trailing newline artifact

  const MAX_LINES = 5000;
  const truncated = lines.length > MAX_LINES;
  if (truncated) lines = lines.slice(0, MAX_LINES);

  const body = lines
    .map((line) => {
      const idx = token ? findUnquotedToken(line, token) : -1;
      let html;
      if (idx !== -1) {
        // Highlight strings within the code part only, *before* the comment
        // span is added — otherwise the quote-matching regex below would
        // also match the quotes inside our own class="tok-com" attribute.
        const codePart = highlightStrings(escapeHtml(line.slice(0, idx)));
        const commentPart = escapeHtml(line.slice(idx));
        html = `${codePart}<span class="tok-com">${commentPart}</span>`;
      } else {
        html = highlightStrings(escapeHtml(line));
      }
      return `<div class="src-line">${html}</div>`;
    })
    .join("");

  const truncNote = truncated
    ? `<p class="src-truncated-note">Showing the first ${MAX_LINES.toLocaleString()} lines of ${lines.length.toLocaleString()}+.</p>`
    : "";

  return `<div class="src-code-wrap"><pre class="src-code"><code>${body}</code></pre></div>${truncNote}`;
}

/** Wraps double-quoted strings in a highlight span. Only safe to call on already-HTML-escaped
 *  text with no tags added yet — escapeHtml() turns `"` into `&quot;`, which is what this matches. */
function highlightStrings(escapedText) {
  return escapedText.replace(/&quot;([^&]*)&quot;/g, '&quot;<span class="tok-str">$1</span>&quot;');
}

/** Finds the first index of `token` in `line` that isn't inside a "double-quoted string". */
function findUnquotedToken(line, token) {
  let inString = false;
  for (let i = 0; i <= line.length - token.length; i++) {
    if (line[i] === '"') inString = !inString;
    if (!inString && line.startsWith(token, i)) return i;
  }
  return -1;
}
