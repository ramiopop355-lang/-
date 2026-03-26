const CACHE = "sigma-v7";
const PENDING_CACHE = "sigma-pending";
const OFFLINE_URL = "/offline.html";

const PRECACHE = [
  "/",
  "/index.html",
  "/offline.html",
  "/manifest.json",
  "/favicon.svg",
  "/favicon.png",
  "/icon-512.png",
  "/screenshot-narrow.jpg",
  "/opengraph.jpg",
  "/icon-maskable.png",
  "/.well-known/assetlinks.json",
];

// ─── Install: precache الأصول الأساسية ──────────────────────────────────────
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

// ─── Activate: حذف الكاشات القديمة ──────────────────────────────────────────
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

// ─── Fetch ───────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // 1. تجاهل طلبات غير GET
  if (request.method !== "GET") return;

  // 2. تجاهل API و SSE و Chrome Extensions
  if (
    url.pathname.startsWith("/api/") ||
    url.protocol === "chrome-extension:" ||
    url.origin.includes("chrome-extension")
  ) return;

  // 3. الخطوط من Google: Stale-While-Revalidate
  if (url.origin === "https://fonts.googleapis.com" || url.origin === "https://fonts.gstatic.com") {
    e.respondWith(
      caches.open(CACHE).then(async (c) => {
        const cached = await c.match(request);
        const fetchPromise = fetch(request).then((res) => {
          if (res.ok) c.put(request, res.clone());
          return res;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // 4. الملفات الثابتة (JS, CSS, صور, خطوط محلية): Cache First
  if (
    request.destination === "script" ||
    request.destination === "style" ||
    request.destination === "font" ||
    request.destination === "image" ||
    url.pathname.match(/\.(js|css|woff2?|ttf|otf|png|svg|jpg|ico)$/)
  ) {
    e.respondWith(
      caches.open(CACHE).then(async (c) => {
        const cached = await c.match(request);
        if (cached) return cached;
        try {
          const res = await fetch(request);
          if (res.ok) c.put(request, res.clone());
          return res;
        } catch {
          return new Response("", { status: 408 });
        }
      })
    );
    return;
  }

  // 5. التنقل بين الصفحات: Network First → Cache → Offline Page
  if (request.mode === "navigate") {
    e.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            caches.open(CACHE).then((c) => c.put(request, res.clone()));
          }
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const offline = await caches.match(OFFLINE_URL);
          return offline || new Response("لا يوجد اتصال بالإنترنت", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        })
    );
    return;
  }
});

// ─── Push Notifications ─────────────────────────────────────────────────────
self.addEventListener("push", (e) => {
  if (!e.data) return;
  let data = { title: "سِيغْمَا", body: "لديك إشعار جديد", url: "/" };
  try { data = { ...data, ...JSON.parse(e.data.text()) }; } catch {}
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/favicon.png",
      badge: "/favicon.png",
      dir: "rtl",
      lang: "ar",
      tag: "sigma-notif",
      renotify: true,
      data: { url: data.url },
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url ?? "/";
  e.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const existing = list.find((c) => c.url.includes(self.location.origin));
      if (existing) { existing.focus(); existing.navigate(url); }
      else clients.openWindow(url);
    })
  );
});

// ─── Background Sync — إعادة محاولة اشتراك الإشعارات عند استعادة الاتصال ────
self.addEventListener("sync", (e) => {
  if (e.tag === "sigma-push-retry") {
    e.waitUntil(
      (async () => {
        try {
          const pending = await caches.open(PENDING_CACHE);
          const stored  = await pending.match("/push-payload");
          if (!stored) return;
          const payload = await stored.json();
          const res = await fetch("/api/push/subscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (res.ok) await pending.delete("/push-payload");
        } catch {}
      })()
    );
  }
});

// ─── Periodic Background Sync ───────────────────────────────────────────────
self.addEventListener("periodicsync", (e) => {
  if (e.tag === "sigma-keepalive") {
    e.waitUntil(
      caches.open(CACHE).then((c) =>
        fetch("/").then((r) => { if (r.ok) c.put("/", r); }).catch(() => {})
      )
    );
  }
});
