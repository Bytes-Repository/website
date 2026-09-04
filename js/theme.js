const THEME_KEY = "bytesio:theme";

function getStoredTheme() {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}

function getEffectiveTheme() {
  const stored = getStoredTheme();
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

function setTheme(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* private browsing / storage disabled — theme just won't persist */
  }
  applyTheme(theme);
  updateToggleIcon(theme);
}

function updateToggleIcon(theme) {
  document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
    btn.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
    btn.title = btn.getAttribute("aria-label");
    btn.classList.toggle("is-dark", theme === "dark");
  });
}

function initThemeToggle() {
  updateToggleIcon(getEffectiveTheme());
  document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = getEffectiveTheme() === "dark" ? "light" : "dark";
      setTheme(next);
    });
  });

  // Follow OS changes live, but only while the user hasn't made an explicit choice.
  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
      if (!getStoredTheme()) {
        applyTheme(e.matches ? "dark" : "light");
        updateToggleIcon(e.matches ? "dark" : "light");
      }
    });
  }
}

document.addEventListener("DOMContentLoaded", initThemeToggle);
