// Service worker for «Install as app». It never caches data: API calls, files and pages always go to
// the server (the app shows live financial data). Only when the network is down does a page
// navigation get a small offline notice instead of the browser's error page.
const OFFLINE_HTML = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Нет соединения</title><body style="font-family:system-ui,sans-serif;background:#f2f2f7;color:#1b2333;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0">
<div style="text-align:center;padding:24px"><h1 style="font-size:20px">Нет соединения с интернетом</h1>
<p style="color:#555">Приложение работает только онлайн. Проверьте подключение и обновите страницу.</p>
<button onclick="location.reload()" style="margin-top:12px;padding:10px 18px;border-radius:999px;border:0;background:#1b2333;color:#fff;font-size:15px">Обновить</button></div></body></html>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", event => {
  if (event.request.mode !== "navigate") return; // everything else: straight to the network
  event.respondWith(
    fetch(event.request).catch(
      () => new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } })
    )
  );
});
