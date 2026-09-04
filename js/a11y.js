function setupModalA11y(modal) {
  let lastFocused = null;

  function getFocusable() {
    return Array.from(
      modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    ).filter((el) => !el.disabled && el.offsetParent !== null);
  }

  function onKeydown(e) {
    if (e.key !== "Tab") return;
    const focusables = getFocusable();
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return {
    open() {
      lastFocused = document.activeElement;
      modal.addEventListener("keydown", onKeydown);
      const focusables = getFocusable();
      (focusables[0] || modal).focus();
    },
    close() {
      modal.removeEventListener("keydown", onKeydown);
      if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
      lastFocused = null;
    },
  };
}
