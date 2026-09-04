const els = {
  label: document.getElementById("b-label"),
  message: document.getElementById("b-message"),
  style: document.getElementById("b-style"),
  labelColor: document.getElementById("b-labelcolor"),
  swatches: document.getElementById("b-swatches"),
  preview: document.getElementById("b-preview"),
  md: document.getElementById("snippet-md"),
  html: document.getElementById("snippet-html"),
};

const SWATCHES = [
  { name: "bytes pink", value: "#EC4899" },
  { name: "brand purple", value: "#7C4DFF" },
  { name: "success green", value: "#2da44e" },
  { name: "H# red", value: "#9c1120" },
  { name: "Hacker Lang purple", value: "#8250df" },
  { name: "HackerScript gray", value: "#8a8a94" },
  { name: "info blue", value: "#0969da" },
  { name: "warning orange", value: "#FB923C" },
];

let messageColor = SWATCHES[0].value;

function buildSwatches() {
  els.swatches.innerHTML = SWATCHES.map(
    (s, i) =>
      `<span class="swatch ${i === 0 ? "is-active" : ""}" data-color="${s.value}" style="background:${s.value}" title="${s.name}"></span>`
  ).join("");
  els.swatches.querySelectorAll(".swatch").forEach((el) => {
    el.addEventListener("click", () => {
      messageColor = el.dataset.color;
      els.swatches.querySelectorAll(".swatch").forEach((s) => s.classList.remove("is-active"));
      el.classList.add("is-active");
      update();
    });
  });
}

/** Measures text width in the badge's font so segments size correctly, like shields.io. */
function textWidth(text, fontSize = 11) {
  const canvas = textWidth._canvas || (textWidth._canvas = document.createElement("canvas"));
  const ctx = canvas.getContext("2d");
  ctx.font = `bold ${fontSize}px Verdana, Geneva, sans-serif`;
  return ctx.measureText(text).width;
}

function escapeXml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildSvg({ label, message, style, labelColor, messageColor }) {
  const pad = 10;
  const labelW = Math.round(textWidth(label) + pad * 2);
  const messageW = Math.round(textWidth(message) + pad * 2);
  const height = 20;
  const totalW = labelW + messageW;
  const radius = style === "flat-square" ? 0 : 3;
  const gloss =
    style === "plastic"
      ? `<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#fff" stop-opacity=".2"/><stop offset=".1" stop-color="#aaa" stop-opacity=".1"/><stop offset=".9" stop-color="#000" stop-opacity=".1"/><stop offset="1" stop-color="#000" stop-opacity=".2"/></linearGradient>`
      : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${height}" role="img" aria-label="${escapeXml(label)}: ${escapeXml(message)}">
  <defs>${gloss}</defs>
  <clipPath id="r"><rect width="${totalW}" height="${height}" rx="${radius}" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelW}" height="${height}" fill="${labelColor}"/>
    <rect x="${labelW}" width="${messageW}" height="${height}" fill="${messageColor}"/>
    ${gloss ? `<rect width="${totalW}" height="${height}" fill="url(#s)"/>` : ""}
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana, Geneva, sans-serif" font-size="11" font-weight="bold">
    <text x="${labelW / 2}" y="14">${escapeXml(label)}</text>
    <text x="${labelW + messageW / 2}" y="14">${escapeXml(message)}</text>
  </g>
</svg>`;
}

function update() {
  const label = els.label.value.trim() || "label";
  const message = els.message.value.trim() || "message";
  const style = els.style.value;
  const labelColor = els.labelColor.value.trim() || "#4a4a58";

  const svg = buildSvg({ label, message, style, labelColor, messageColor });
  const dataUri = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;

  els.preview.innerHTML = `<img src="${dataUri}" alt="${label}: ${message}" width="${Math.round(
    (textWidth(label) + 20) + (textWidth(message) + 20)
  )}" height="20" />`;

  els.md.value = `[![${label}](${dataUri})](https://bytes-repository.github.io/index.html)`;
  els.html.value = `<a href="https://bytes-repository.github.io/index.html"><img src="${dataUri}" alt="${label}: ${message}" /></a>`;
}

document.querySelectorAll("[data-copy-target]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const target = document.getElementById(btn.dataset.copyTarget);
    try {
      await navigator.clipboard.writeText(target.value);
      const original = btn.textContent;
      btn.textContent = "Copied";
      setTimeout(() => (btn.textContent = original), 1300);
    } catch {
      target.select();
    }
  });
});

[els.label, els.message, els.style, els.labelColor].forEach((el) => el.addEventListener("input", update));

buildSwatches();
update();
