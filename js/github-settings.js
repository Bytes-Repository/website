function initGithubSettings() {
  const openBtns = document.querySelectorAll("[data-gh-settings]");
  const modal = document.getElementById("gh-modal");
  if (!openBtns.length || !modal) return;

  const input = document.getElementById("gh-token-input");
  const saveBtn = document.getElementById("gh-token-save");
  const clearBtn = document.getElementById("gh-token-clear");
  const closeBtn = document.getElementById("gh-token-close");
  const rateNote = document.getElementById("gh-rate-note");
  const statusNote = document.getElementById("gh-token-status");
  const a11y = setupModalA11y(modal);

  function refreshStatus() {
    const has = hasGithubToken();
    if (statusNote) {
      statusNote.textContent = has ? "A token is currently saved in this browser." : "No token saved — using the unauthenticated rate limit.";
      statusNote.classList.toggle("is-active", has);
    }
    updateToggleDot(has);
  }

  function updateToggleDot(has) {
    openBtns.forEach((btn) => btn.classList.toggle("has-token", has));
  }

  async function refreshRateLimit() {
    if (!rateNote) return;
    rateNote.textContent = "Checking rate limit…";
    const core = await githubRateLimit();
    if (!core) {
      rateNote.textContent = "Couldn't check the current rate limit right now.";
      return;
    }
    const resetTime = new Date(core.reset * 1000).toLocaleTimeString();
    rateNote.textContent = `${core.remaining} / ${core.limit} GitHub API requests left this hour (resets ${resetTime}).`;
  }

  function openModal() {
    input.value = getGithubToken();
    modal.hidden = false;
    refreshStatus();
    refreshRateLimit();
    a11y.open();
  }

  function closeModal() {
    modal.hidden = true;
    a11y.close();
  }

  openBtns.forEach((btn) => btn.addEventListener("click", openModal));
  closeBtn?.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.hidden) closeModal();
  });

  saveBtn?.addEventListener("click", () => {
    setGithubToken(input.value.trim());
    refreshStatus();
    refreshRateLimit();
    const original = saveBtn.textContent;
    saveBtn.textContent = "Saved";
    setTimeout(() => (saveBtn.textContent = original), 1300);
  });

  clearBtn?.addEventListener("click", () => {
    setGithubToken("");
    input.value = "";
    refreshStatus();
    refreshRateLimit();
  });

  refreshStatus();
}

document.addEventListener("DOMContentLoaded", initGithubSettings);
