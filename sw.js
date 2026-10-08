/* MIXMIND — service worker: a aplicação abre e funciona sem internet depois da primeira visita.
 * Pré-carrega tudo o que index.html referencia (+ codificador MP3, fontes, biblioteca de estilos e ícones).
 * Navegação: rede primeiro (para receber atualizações), cache se estiver offline. Ficheiros: cache primeiro.
 * Pedidos a outros domínios (loja/licenças, Supabase) nunca passam pela cache. */
const CACHE = 'mixmind-1.8';
const EXTRA = ['./', 'index.html', 'manifest.webmanifest', 'js/vendor/lame.min.js', 'styles/library.json', 'assets/favicon.svg', 'assets/icon-192.png', 'assets/icon-512.png', 'assets/fonts/Geist-Variable.woff2', 'assets/fonts/GeistMono-Variable.woff2'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    const html = await (await fetch('index.html', { cache: 'no-cache' })).text();
    const refs = [...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map((m) => m[1]).filter((u) => !u.startsWith('//'));
    const all = [...new Set([...EXTRA, ...refs])];
    await Promise.all(all.map((u) => c.add(new Request(u, { cache: 'no-cache' })).catch(() => null))); // um ficheiro em falta não impede a instalação
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('mixmind-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (req.mode === 'navigate' || url.pathname.endsWith('.json')) { // páginas e dados (ex.: biblioteca de estilos): rede primeiro
    const key = req.mode === 'navigate' ? 'index.html' : req;
    e.respondWith(fetch(req).then((r) => { if (r.ok) { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(key, cp)); } return r; }).catch(() => caches.match(key)));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => {
    if (r.ok && r.type === 'basic') { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(req, cp)); }
    return r;
  })));
});
