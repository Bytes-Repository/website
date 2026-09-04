const CACHE_VERSION = "bytesio-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./offline.html",
  "./styles/base.css",
  "./styles/index.css",
  "./styles/repo.css",
  "./styles/langbar.css",
  "./js/main.js",
  "./js/repo.js",
  "./js/hk-parser.js",
  "./js/langcolors.js",
  "./js/storage.js",
  "./js/index-data.js",
  "./js/enrich.js",
  "./js/theme.js",
  "./js/github.js",
  "./js/github-settings.js",
  "./js/a11y.js",
  "./js/nav.js",
  "./js/pwa.js",
  "./js/semver-lite.js",
  "./js/recent.js",
  "./js/author.js",
  "./js/badge.js",
  "./images/logo.png",
  "./manifest.webmanifest",
  "./pages/about.html",
  "./pages/repo.html",
  "./pages/recent.html",
  "./pages/author.html",
  "./pages/badge.html",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)));
  // No self.skipWaiting() here on purpose: a newly installed worker waits until
  // the page's update toast (js/pwa.js) gets an explicit "Refresh" click, so
  // people don't get swapped onto new JS/CSS mid-session without warning.
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isDataRequest(url) {
  return (
    url.hostname === "raw.githubusercontent.com" ||
    url.hostname === "api.github.com" ||
    url.hostname === "cdn.jsdelivr.net"
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (isDataRequest(url)) {
    // Network-first: try live data, fall back to whatever we last cached.
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  if (url.origin === self.location.origin) {
    // Cache-first for the app shell itself.
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request)
            .then((res) => {
              const copy = res.clone();
              caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
              return res;
            })
            .catch(() => {
              if (request.mode === "navigate") return caches.match("./offline.html");
              return undefined;
            })
      )
    );
  }
});
