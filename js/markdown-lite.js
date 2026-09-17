function renderMarkdown(src, opts = {}) {
  const lines = String(src).replace(/\r\n?/g, "\n").split("\n");
  return renderBlocks(lines, opts);
}

function renderBlocks(lines, opts) {
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    // fenced code block
    const fence = line.match(/^(\s{0,3})(```|~~~)\s*([\w+.#-]*)\s*$/);
    if (fence) {
      const [, , fenceMark, lang] = fence;
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith(fenceMark)) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // consume closing fence (if any — tolerate an unterminated block at EOF)
      out.push(renderCodeBlock(codeLines.join("\n"), lang));
      continue;
    }

    // ATX heading
    const heading = line.match(/^(\s{0,3})(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      const level = heading[2].length;
      const text = heading[3];
      out.push(`<h${level} id="${slugify(stripMdSyntax(text))}">${renderInline(text, opts)}</h${level}>`);
      i++;
      continue;
    }

    // horizontal rule
    if (/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }

    // block quote
    if (/^\s{0,3}>/.test(line)) {
      const quoted = [];
      while (i < lines.length && (/^\s{0,3}>/.test(lines[i]) || (lines[i].trim() && quoted.length))) {
        if (!/^\s{0,3}>/.test(lines[i]) && !lines[i].trim()) break;
        quoted.push(lines[i].replace(/^\s{0,3}>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${renderBlocks(quoted, opts)}</blockquote>`);
      continue;
    }

    // GFM table: a header row immediately followed by a |---|---| separator row
    if (line.includes("|") && lines[i + 1] && isTableSeparator(lines[i + 1])) {
      const header = splitTableRow(line);
      const aligns = splitTableRow(lines[i + 1]).map(cellAlign);
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      out.push(renderTable(header, aligns, rows, opts));
      continue;
    }

    // list (ordered or unordered), with one level of nesting via indentation
    if (/^(\s*)([-*+]|\d+[.)])\s+/.test(line)) {
      const { html, next } = renderList(lines, i, opts);
      out.push(html);
      i = next;
      continue;
    }

    // paragraph: consume lines until a blank line or the start of another block
    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(\s{0,3})(```|~~~)/.test(lines[i]) &&
      !/^(\s{0,3})#{1,6}\s+/.test(lines[i]) &&
      !/^\s{0,3}>/.test(lines[i]) &&
      !/^(\s*)([-*+]|\d+[.)])\s+/.test(lines[i]) &&
      !/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    if (para.length) {
      out.push(`<p>${renderParagraphInline(para, opts)}</p>`);
    } else {
      i++; // safety valve — should be unreachable, but never loop forever
    }
  }

  return out.join("\n");
}

function isTableSeparator(line) {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line) && line.includes("-");
}

function splitTableRow(line) {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  return t.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

function cellAlign(spec) {
  const s = spec.trim();
  if (/^:-+:$/.test(s)) return "center";
  if (/^-+:$/.test(s)) return "right";
  if (/^:-+$/.test(s)) return "left";
  return "";
}

function renderTable(header, aligns, rows, opts) {
  const th = header
    .map((h, i) => `<th${aligns[i] ? ` style="text-align:${aligns[i]}"` : ""}>${renderInline(h, opts)}</th>`)
    .join("");
  const trs = rows
    .map(
      (r) =>
        `<tr>${r
          .map((c, i) => `<td${aligns[i] ? ` style="text-align:${aligns[i]}"` : ""}>${renderInline(c || "", opts)}</td>`)
          .join("")}</tr>`
    )
    .join("");
  return `<div class="md-table-wrap"><table class="md-table"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div>`;
}

/** Renders one contiguous run of same-indentation list items, recursing for nested sub-lists. */
function renderList(lines, start, opts) {
  const first = lines[start].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
  const baseIndent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items = [];
  let i = start;

  while (i < lines.length) {
    const m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (!m || m[1].length !== baseIndent) break;

    const ownLines = [m[3]];
    const nestedLines = [];
    i++;
    while (i < lines.length && lines[i].trim()) {
      const deeper = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
      if (deeper && deeper[1].length > baseIndent) {
        nestedLines.push(lines[i]);
        i++;
        continue;
      }
      if (!deeper && lines[i].search(/\S/) > baseIndent) {
        // lazy continuation of the current item's own text
        ownLines.push(lines[i].trim());
        i++;
        continue;
      }
      break;
    }

    let itemHtml = renderInline(ownLines.join(" "), opts);
    if (nestedLines.length) itemHtml += renderBlocks(nestedLines, opts);
    items.push(`<li>${itemHtml}</li>`);
  }

  const tag = ordered ? "ol" : "ul";
  return { html: `<${tag}>${items.join("")}</${tag}>`, next: i };
}

function renderCodeBlock(code, lang) {
  const cls = lang ? ` class="lang-${escapeHtml(lang)}"` : "";
  return `<pre class="md-code"><code${cls}>${escapeHtml(code)}</code></pre>`;
}

/** Joins a paragraph's lines with markdown's "soft break = space, trailing double-space = <br>" rule. */
function renderParagraphInline(paraLines, opts) {
  const withBreaks = paraLines.map((l) => (/ {2,}$/.test(l) ? l.replace(/ {2,}$/, "\u0000BR\u0000") : l));
  return renderInline(withBreaks.join(" "), opts).replace(/\u0000BR\u0000/g, "<br>");
}

function renderInline(text, opts) {
  // Pull out `code spans` first, on the raw text, so their contents are
  // escaped independently and never touched by any later regex (bold/
  // italic/link syntax inside a code span is literal, not markdown).
  const codeSpans = [];
  let s = String(text).replace(/`([^`]+)`/g, (_, code) => {
    codeSpans.push(escapeHtml(code));
    return `\u0000CODE${codeSpans.length - 1}\u0000`;
  });

  s = escapeHtml(s);

  // Titles' surrounding quotes were just escaped to &quot; above — match that.
  const TITLE_RE = /(?:\s+&quot;([^&]*)&quot;)?/;

  // images: ![alt](url "title")
  s = s.replace(new RegExp(`!\\[([^\\]]*)\\]\\(([^()\\s]+)${TITLE_RE.source}\\)`, "g"), (_, alt, url, title) => {
    const safe = resolveMediaUrl(url, opts);
    if (!safe) return alt;
    return `<img src="${safe}" alt="${alt}"${title ? ` title="${title}"` : ""} loading="lazy">`;
  });

  // links: [text](url "title")
  s = s.replace(new RegExp(`\\[([^\\]]+)\\]\\(([^()\\s]+)${TITLE_RE.source}\\)`, "g"), (_, label, url, title) => {
    const safe = resolveLinkUrl(url, opts);
    if (!safe) return label;
    return `<a href="${safe}"${title ? ` title="${title}"` : ""} target="_blank" rel="noopener noreferrer">${label}</a>`;
  });

  // autolinks: <https://example.com>
  s = s.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, (_, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);

  // bold + italic (order matters: strongest markers first)
  s = s.replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>");
  s = s.replace(/___([^_]+)___/g, "<strong><em>$1</em></strong>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  s = s.replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, "$1<em>$2</em>");

  // restore protected code spans
  s = s.replace(/\u0000CODE(\d+)\u0000/g, (_, idx) => `<code>${codeSpans[Number(idx)]}</code>`);

  return s;
}

/** Rejects javascript:/data:/vbscript:/etc — only http(s), mailto, in-page anchors, and relative repo paths are allowed. */
function isDangerousScheme(url) {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url) && !/^(https?|mailto):/i.test(url);
}

function resolveLinkUrl(url, opts) {
  if (url.startsWith("#")) return url;
  if (isDangerousScheme(url)) return null;
  if (/^(https?|mailto):/i.test(url)) return url;
  if (!opts?.owner || !opts?.repo) return null;
  const clean = url.replace(/^\.\//, "").replace(/^\//, "");
  return `https://github.com/${opts.owner}/${opts.repo}/blob/${opts.branch || "main"}/${clean}`;
}

function resolveMediaUrl(url, opts) {
  if (isDangerousScheme(url)) return null;
  if (/^https?:/i.test(url)) return url;
  if (!opts?.owner || !opts?.repo) return null;
  const clean = url.replace(/^\.\//, "").replace(/^\//, "");
  return `https://raw.githubusercontent.com/${opts.owner}/${opts.repo}/${opts.branch || "main"}/${clean}`;
}

/** Strips markdown syntax down to plain text — used only to build a clean heading-id slug. */
function stripMdSyntax(text) {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~]/g, "");
}

/** GitHub-style heading slug, close enough for in-page anchor links to work. */
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/<\/?[^>]+>/g, "")
    .replace(/[^\p{L}\p{N}\s-]+/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}
