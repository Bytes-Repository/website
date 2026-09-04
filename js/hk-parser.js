function parseBytesHk(source) {
  const sections = {};
  const cleaned = source
    .split("\n")
    .map((line) => stripComment(line))
    .join("\n");

  const blockPattern = /@([a-zA-Z0-9_]+)\s*\{([^}]*)\}/g;
  let match;
  while ((match = blockPattern.exec(cleaned)) !== null) {
    const [, sectionName, body] = match;
    sections[sectionName] = parseBlockBody(body);
  }
  return sections;
}

function stripComment(line) {
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inString = !inString;
    if (ch === "#" && !inString) return line.slice(0, i);
  }
  return line;
}

function parseBlockBody(body) {
  const entries = {};
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    let key = line.slice(0, idx).trim();
    if (key.startsWith('"') && key.endsWith('"') && key.length >= 2) key = key.slice(1, -1);
    const rawValue = line.slice(idx + 1).trim().replace(/,$/, "");
    entries[key] = parseValue(rawValue);
  }
  return entries;
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
  if (raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1);
  }
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (!isNaN(Number(raw)) && raw !== "") return Number(raw);
  return raw;
}

/** Produces a lightly syntax-highlighted HTML string for display in the code panel. */
function highlightBytesHk(source) {
  const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escape(source)
    .replace(/(@[a-zA-Z0-9_]+)/g, '<span class="tok-sec">$1</span>')
    .replace(/(#.*)$/gm, '<span class="tok-com">$1</span>')
    .replace(/^(\s*)([a-zA-Z0-9_]+)(\s*:)/gm, '$1<span class="tok-key">$2</span>$3')
    .replace(/"([^"]*)"/g, '"<span class="tok-str">$1</span>"');
}
