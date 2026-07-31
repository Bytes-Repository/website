const INDEX_SOURCES = [
  "https://raw.githubusercontent.com/Bytes-Repository/repository/main/index.json",
  "https://cdn.jsdelivr.net/gh/Bytes-Repository/repository@main/index.json",
];

const grid = document.getElementById("lib-grid");
const countEl = document.getElementById("lib-count");
const searchInput = document.getElementById("lib-search");

let libraries = []; // [{ name, url }]

function skeletons(n) {
  return Array.from({ length: n })
    .map(() => `<div class="skel"></div>`)
    .join("");
}

function initials(name) {
  return name.slice(0, 2).toUpperCase();
}

function ownerRepoFromUrl(url) {
  try {
    const u = new URL(url);
    const [, owner, repo] = u.pathname.split("/");
    return { owner, repo };
  } catch {
    return null;
  }
}

function cardHtml(lib) {
  return `
    <a class="lib-card" href="pages/repo.html?name=${encodeURIComponent(lib.name)}&url=${encodeURIComponent(lib.url)}">
      <div class="lib-card-top">
        <div class="lib-glyph">${initials(lib.name)}</div>
        <h3>${lib.name}</h3>
      </div>
      <p>Library manifest served from <code style="font-family:var(--f-mono);font-size:12px;">bytes.hk</code> at the repo root.</p>
      <div class="lib-card-foot">
        <span class="pill"><span class="dot" style="background:var(--b-pink)"></span>H#</span>
        <span class="go">View manifest →</span>
      </div>
    </a>`;
}

function render(list) {
  if (!list.length) {
    grid.innerHTML = `
      <div class="state-note">
        No libraries match that search. Try a different name, or
        <a href="${INDEX_URL}" target="_blank" rel="noopener">browse index.json</a> directly.
      </div>`;
    return;
  }
  grid.innerHTML = list.map(cardHtml).join("");
}

async function fetchIndexJson() {
  const failures = [];
  for (const url of INDEX_SOURCES) {
    try {
      // cache-bust so a stale CDN/browser cache never masks a real update
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

async function loadIndex() {
  grid.innerHTML = skeletons(6);
  try {
    const raw = await fetchIndexJson();

    libraries = raw
      .map((entry) => {
        const name = Object.keys(entry)[0];
        return { name, url: entry[name] };
      })
      .filter((lib) => lib.name && lib.url);

    countEl.textContent = `${libraries.length} ${libraries.length === 1 ? "library" : "libraries"}`;
    render(libraries);
  } catch (err) {
    console.error("[bytes.io] failed to load index.json:", err.message);
    grid.innerHTML = `
      <div class="state-note">
        Couldn't reach <code>index.json</code> from any source (${err.message}).
        This usually means the page was opened directly as a local file
        (<code>file://…</code>) — some browsers block cross-origin fetches
        from that context. Serve this folder over http(s), e.g.
        <code>python3 -m http.server</code> in this directory, or view it
        once deployed on GitHub Pages, and it will load live.
      </div>`;
    countEl.textContent = "— libraries";
  }
}

searchInput?.addEventListener("input", (e) => {
  const q = e.target.value.trim().toLowerCase();
  const filtered = q ? libraries.filter((l) => l.name.toLowerCase().includes(q)) : libraries;
  render(filtered);
});

loadIndex();
