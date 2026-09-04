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

/** Maps a file extension (no dot, lowercase) to a language name bytes.io understands. */
const EXTENSION_TO_LANGUAGE = {
  "h#": "H#",
  "h#i": "H# Interface",
  "hk": "hk",
  "hcs": "HackerScript",
  "hl": "Hacker Lang"
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
