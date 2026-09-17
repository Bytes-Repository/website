function parseBytesHk(source) {
  const sections = {};
  let currentSection = null;

  const lines = String(source).split("\n");
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const sectionMatch = line.match(/^\[([a-zA-Z0-9_.-]+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1].toLowerCase();
      if (!sections[currentSection]) sections[currentSection] = {};
      continue;
    }

    if (!currentSection) continue; // stray line before any [section] header

    const entryMatch = line.match(/^->\s*(.+?)\s*=>\s*(.*)$/);
    if (!entryMatch) continue;

    let [, key, rawValue] = entryMatch;
    key = stripQuotes(key.trim());
    rawValue = stripLineComment(rawValue).trim();

    sections[currentSection][key] = parseValue(rawValue);
  }

  normalizePackageSection(sections);
  return sections;
}

/** Strips a `;; trailing comment` from a value, respecting simple double-quoted strings. */
function stripLineComment(value) {
  let inString = false;
  for (let i = 0; i < value.length - 1; i++) {
    const ch = value[i];
    if (ch === '"') inString = !inString;
    if (!inString && ch === ";" && value[i + 1] === ";") return value.slice(0, i);
  }
  return value;
}

function stripQuotes(s) {
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
  return s;
}

function parseValue(raw) {
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const inner = raw.slice(1, -1).trim();
    if (!inner) return [];
    return inner
      .split(",")
      .map((v) => parseValue(v.trim()))
      .filter((v) => v !== "");
  }
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
    return raw.slice(1, -1);
  }
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw !== "" && !isNaN(Number(raw))) return Number(raw);
  return raw;
}

/**
 * Real manifests use a single `author => "Some Name"` entry rather than an
 * `authors` array. Normalize both onto `package.authors` (always an array)
 * so the rest of the app only has to deal with one shape.
 */
function normalizePackageSection(sections) {
  const pkg = sections.package;
  if (!pkg) return;

  if (pkg.authors == null && pkg.author != null) {
    pkg.authors = String(pkg.author)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  } else if (Array.isArray(pkg.authors)) {
    // already an array, keep as-is
  } else if (pkg.authors != null) {
    pkg.authors = [pkg.authors];
  }
}

/** Produces a lightly syntax-highlighted HTML string for display in the code panel. */
function highlightBytesHk(source) {
  const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // Order matters: string-quote highlighting must run first, on plain
  // escaped text with no tags yet. Section/comment/key highlighting insert
  // spans whose own class="..." attributes contain quote characters — if
  // the quote regex ran after them, it would match those attribute quotes
  // too and produce broken, nested markup.
  //
  // Note: escape() has already turned every literal ">" into "&gt;" by the
  // time these run, so "->" and "=>" show up as "-&gt;" and "=&gt;" — the
  // key-highlighting regex below matches against that escaped form, not
  // the original arrow characters.
  return escape(source)
    .replace(/"([^"]*)"/g, '"<span class="tok-str">$1</span>"')
    .replace(/^(\s*)(\[[a-zA-Z0-9_.-]+\])/gm, '$1<span class="tok-sec">$2</span>')
    .replace(/(;;.*)$/gm, '<span class="tok-com">$1</span>')
    .replace(/^(\s*)(-&gt;)(\s*)([a-zA-Z0-9_.-]+)(\s*)(=&gt;)/gm, '$1<span class="tok-key">$2$3$4$5$6</span>');
}
