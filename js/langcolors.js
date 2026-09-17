const GITHUB_LANG_COLORS = {
  "JavaScript": "#f1e05a",
  "TypeScript": "#3178c6",
  "Python": "#3572A5",
  "Java": "#b07219",
  "C": "#555555",
  "C++": "#f34b7d",
  "C#": "#178600",
  "Go": "#00ADD8",
  "Rust": "#dea584",
  "Ruby": "#701516",
  "PHP": "#4F5D95",
  "Swift": "#F05138",
  "Kotlin": "#A97BFF",
  "Dart": "#00B4AB",
  "HTML": "#e34c26",
  "CSS": "#563d7c",
  "Shell": "#89e051",
  "PowerShell": "#012456",
  "Scala": "#c22d40",
  "Haskell": "#5e5086",
  "Lua": "#000080",
  "Perl": "#0298c3",
  "R": "#198CE7",
  "Objective-C": "#438eff",
  "Elixir": "#6e4a7e",
  "Clojure": "#db5855",
  "Zig": "#ec915c",
  "OCaml": "#3be133",
  "Erlang": "#B83998",
  "Julia": "#a270ba",
  "Vim script": "#199f4b",
  "Dockerfile": "#384d54",
  "Makefile": "#427819",
  "YAML": "#cb171e",
  "JSON": "#292929",
  "Markdown": "#083fa1",
  "Vue": "#41b883",
  "Svelte": "#ff3e00",
  "Assembly": "#6E4C13",
  "Crystal": "#000100",
  "Nim": "#ffc200",
  "Solidity": "#AA6746"
};

const BYTES_CUSTOM_LANG_COLORS = {
  "H#": "#9c1120",
  "H# Interface": "#c23b4e",
  "hk": "#ffffff",
  "HackerScript": "#8a8a94",
  "Hacker Lang": "#8250df"
};

const LANGUAGE_COLORS = Object.assign({}, GITHUB_LANG_COLORS, BYTES_CUSTOM_LANG_COLORS);

const FALLBACK_COLOR = "#8f8fa3";

/**
 * Maps a file extension (no dot, lowercase) to a language name bytes.io
 * understands. This covers both bytes.io's own H#-ecosystem extensions
 * (which GitHub's linguist has never heard of) AND the common standard
 * languages, because the whole language breakdown — not just the custom
 * part — is computed from a single recursive file-tree listing rather
 * than from GitHub's separate `/languages` endpoint. That endpoint used
 * to be queried too, but every extra api.github.com call eats into the
 * unauthenticated 60-requests/hour budget, and needing BOTH that call and
 * the tree call to succeed made language detection fail twice as often as
 * it needed to. One shared, already-fetched tree is enough on its own.
 */
const EXTENSION_TO_LANGUAGE = {
  // bytes.io / H# ecosystem — unknown to GitHub's own linguist
  "h#": "H#",
  "h#i": "H# Interface",
  "hk": "hk",
  "hcs": "HackerScript",
  "hl": "Hacker Lang",
  // common standard languages, kept in sync with GITHUB_LANG_COLORS above
  "js": "JavaScript", "jsx": "JavaScript", "mjs": "JavaScript", "cjs": "JavaScript",
  "ts": "TypeScript", "tsx": "TypeScript",
  "py": "Python", "pyw": "Python",
  "java": "Java",
  "c": "C", "h": "C",
  "cpp": "C++", "cc": "C++", "cxx": "C++", "hpp": "C++", "hh": "C++", "hxx": "C++",
  "cs": "C#",
  "go": "Go",
  "rs": "Rust",
  "rb": "Ruby",
  "php": "PHP",
  "swift": "Swift",
  "kt": "Kotlin", "kts": "Kotlin",
  "dart": "Dart",
  "html": "HTML", "htm": "HTML",
  "css": "CSS",
  "sh": "Shell", "bash": "Shell", "zsh": "Shell",
  "ps1": "PowerShell", "psm1": "PowerShell",
  "scala": "Scala", "sc": "Scala",
  "hs": "Haskell", "lhs": "Haskell",
  "lua": "Lua",
  "pl": "Perl", "pm": "Perl",
  "r": "R",
  "m": "Objective-C", "mm": "Objective-C",
  "ex": "Elixir", "exs": "Elixir",
  "clj": "Clojure", "cljs": "Clojure", "cljc": "Clojure",
  "zig": "Zig",
  "ml": "OCaml", "mli": "OCaml",
  "erl": "Erlang", "hrl": "Erlang",
  "jl": "Julia",
  "vim": "Vim script",
  "vue": "Vue",
  "svelte": "Svelte",
  "asm": "Assembly", "s": "Assembly",
  "cr": "Crystal",
  "nim": "Nim",
  "sol": "Solidity",
  // Deliberately NOT mapped: md/markdown, json, yml/yaml — GitHub's own
  // linguist treats these as documentation/data rather than "language" by
  // default, and counting them here would make READMEs and config files
  // dominate the breakdown for small libraries.
};

/** Languages whose swatch color is (near-)white and needs a visible outline wherever it's drawn. */
const LIGHT_LANGUAGE_NAMES = new Set(["hk"]);

function needsOutline(name) {
  return LIGHT_LANGUAGE_NAMES.has(name);
}

function colorForLanguage(name) {
  return LANGUAGE_COLORS[name] || FALLBACK_COLOR;
}

function isCustomLanguage(name) {
  return Object.prototype.hasOwnProperty.call(BYTES_CUSTOM_LANG_COLORS, name);
}
