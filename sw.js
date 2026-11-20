/* Harta Auto: merge și fără internet.
   - fișierele aplicației: întâi de pe net (ca să primești versiunile noi), iar dacă nu merge, ce e salvat;
   - plăcile hărții: ce ai văzut deja rămâne salvat (cel mult MAX_TILES, câteva zile);
   - fonturile: salvate la prima folosire;
   - fișierul cu locurile (data/places.json) se ia ca restul fișierelor aplicației: întâi de pe net, apoi ce e salvat;
   - interogările Overpass nu trec pe aici: aplicația își păstrează singură locurile.
   Când schimbi fișiere ale aplicației, mărește VERSION ca telefoanele să ia varianta nouă. */
const VERSION = 'v2';
const SHELL = 'ha-shell-' + VERSION;
const TILES = 'ha-tiles';
const FONTS = 'ha-fonts';
const MAX_TILES = 500;
const TILE_TTL = 3 * 24 * 3600 * 1000;
const NET_WAIT = 4000;
const ASSETS = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/hours.js', 'js/osm.js', 'js/app.js', 'data/places.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon.svg', 'icons/apple-touch-icon.png'
];
const TILE_RE = /\/\d{1,2}\/\d+\/\d+(@2x)?\.(png|jpe?g|webp)$/i;

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL)
      .then(c => Promise.all(ASSETS.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.indexOf('ha-shell-') === 0 && k !== SHELL).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    e.respondWith(shell(req));
  } else if (TILE_RE.test(url.pathname)) {
    e.respondWith(tile(e, req));
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(swr(e, req));
  }
  /* orice altceva (Overpass, OpenStreetMap) merge direct pe net */
});

/* fișierele aplicației: rețea mai întâi, cu răbdare scurtă, apoi ce e salvat */
function shell(req) {
  return new Promise(resolve => {
    let settled = false;
    const cached = () => caches.match(req, { ignoreSearch: true })
      .then(r => r || (req.mode === 'navigate' ? caches.match('index.html') : undefined));
    const timer = setTimeout(() => {
      cached().then(r => { if (r && !settled) { settled = true; resolve(r); } });
    }, NET_WAIT);
    fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then(res => {
      clearTimeout(timer);
      if (res && res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(SHELL).then(c => c.put(req, copy)).catch(() => {});
      }
      if (!settled) { settled = true; resolve(res); }
    }).catch(() => {
      clearTimeout(timer);
      cached().then(r => { if (!settled) { settled = true; resolve(r || Response.error()); } });
    });
  });
}

/* plăcile hărții: dacă am văzut-o recent, o dăm din memorie; altfel o luăm de pe net și o păstrăm */
let puts = 0;
async function tile(e, req) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(req, { ignoreVary: true });
  const age = hit ? Date.now() - Number(hit.headers.get('x-cached-at') || 0) : Infinity;
  if (hit && age < TILE_TTL) return hit;
  try {
    const res = await fetch(req);
    if (res && res.ok && res.type !== 'opaque') {
      const work = res.clone().blob().then(body => {
        const headers = new Headers(res.headers);
        headers.set('x-cached-at', String(Date.now()));
        return cache.put(req, new Response(body, { status: 200, headers }));
      }).then(() => (++puts % 25 === 0) ? trim(cache) : undefined).catch(() => {});
      e.waitUntil(work);
    }
    return res;
  } catch (err) {
    return hit || Response.error();
  }
}
async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length > MAX_TILES) await Promise.all(keys.slice(0, keys.length - MAX_TILES).map(k => cache.delete(k)));
}

/* fonturi: ce avem se afișează imediat, iar în fundal se reîmprospătează */
async function swr(e, req) {
  const cache = await caches.open(FONTS);
  const hit = await cache.match(req);
  const net = fetch(req).then(res => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  e.waitUntil(net);
  return hit || (await net) || Response.error();
}
