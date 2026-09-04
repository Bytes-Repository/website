document.addEventListener("DOMContentLoaded", () => {
  const burger = document.getElementById("nav-burger");
  const links = document.getElementById("nav-links");
  if (!burger || !links) return;

  function setOpen(open) {
    links.classList.toggle("is-open", open);
    burger.setAttribute("aria-expanded", String(open));
  }

  burger.addEventListener("click", () => setOpen(!links.classList.contains("is-open")));
  links.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => setOpen(false)));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setOpen(false);
  });
  document.addEventListener("click", (e) => {
    if (!links.classList.contains("is-open")) return;
    if (!links.contains(e.target) && e.target !== burger && !burger.contains(e.target)) setOpen(false);
  });
});
