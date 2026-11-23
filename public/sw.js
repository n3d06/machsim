/* MachSim – Service Worker: lưu ứng dụng vào bộ nhớ đệm để mở tức thì và chạy offline.
 * __VERSION__ được workflow deploy thay bằng mã commit; mỗi bản deploy có một bộ cache riêng,
 * bản cũ tự bị xoá khi bản mới kích hoạt. */
const VERSION = '__VERSION__';
const CACHE = 'machsim-' + VERSION;
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('machsim-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    // Trang HTML: ưu tiên mạng để nhận bản mới, mất mạng thì dùng bản đã lưu
    e.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('./index.html', copy)); return res; })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }
  // assets/*: tên có mã băm nội dung nên cache-first; còn lại mạng trước, mất mạng dùng bản lưu
  const hashed = new URL(req.url).pathname.includes('/assets/');
  const net = () => fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  });
  e.respondWith(hashed ? caches.match(req).then((hit) => hit || net()) : net().catch(() => caches.match(req)));
});
