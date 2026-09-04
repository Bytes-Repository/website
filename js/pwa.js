function registerServiceWorker(swPath) {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register(swPath);

      // A worker was already waiting before this page even attached listeners.
      if (reg.waiting && navigator.serviceWorker.controller) showUpdateToast(reg);

      reg.addEventListener("updatefound", () => {
        const incoming = reg.installing;
        if (!incoming) return;
        incoming.addEventListener("statechange", () => {
          if (incoming.state === "installed" && navigator.serviceWorker.controller) {
            showUpdateToast(reg);
          }
        });
      });
    } catch {
      /* offline support just won't be available on this page */
    }
  });

  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });
}

function showUpdateToast(reg) {
  if (document.getElementById("sw-update-toast")) return;

  const toast = document.createElement("div");
  toast.id = "sw-update-toast";
  toast.className = "sw-toast";
  toast.setAttribute("role", "status");
  toast.innerHTML = `
    <span>A new version of bytes.io is available.</span>
    <button id="sw-update-btn">Refresh</button>
    <button id="sw-update-dismiss" aria-label="Dismiss">✕</button>
  `;
  document.body.appendChild(toast);

  document.getElementById("sw-update-btn").addEventListener("click", () => {
    reg.waiting?.postMessage({ type: "SKIP_WAITING" });
  });
  document.getElementById("sw-update-dismiss").addEventListener("click", () => {
    toast.classList.remove("is-visible");
    setTimeout(() => toast.remove(), 250);
  });

  requestAnimationFrame(() => toast.classList.add("is-visible"));
}
