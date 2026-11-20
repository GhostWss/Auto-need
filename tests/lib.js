/* Unelte pentru testele din browser: server local, plăci de hartă desenate pe loc,
   un „Overpass” simulat și o clasă mică de verificări. Nu are nevoie de internet. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml'
};

/* server static, ca pe GitHub Pages */
function serve(root) {
  return new Promise(resolve => {
    const srv = http.createServer((req, rsp) => {
      const u = new URL(req.url, 'http://x');
      let p = decodeURIComponent(u.pathname);
      if (p.endsWith('/')) p += 'index.html';
      const f = path.join(root, p);
      if (f.indexOf(root) !== 0) { rsp.writeHead(403); return rsp.end(); }
      fs.readFile(f, (err, buf) => {
        if (err) { rsp.writeHead(404); return rsp.end('nu există'); }
        rsp.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' });
        rsp.end(buf);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, base: 'http://127.0.0.1:' + srv.address().port + '/' }));
  });
}

/* ---------- PNG minimal ---------- */
const CRC = new Uint32Array(256);
for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; }
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgb) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const stride = w * 3 + 1, raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) rgb.copy(raw, y * stride + 1, y * w * 3, (y + 1) * w * 3);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 1 })), chunk('IEND', Buffer.alloc(0))]);
}

/* culoarea de bază a unei plăci: diferită de la o placă la alta, ca să se vadă dacă harta e pusă corect */
function tileBase(z, x, y) {
  return [120 + (x * 37 + z * 11) % 110, 120 + (y * 29 + z * 7) % 110, 120 + (x * 13 + y * 17) % 100];
}
const CROSS = [220, 30, 30];
const tileCache = new Map();
function tilePng(z, x, y, style) {
  const key = style + z + '/' + x + '/' + y;
  let b = tileCache.get(key);
  if (b) return b;
  const rgb = Buffer.alloc(256 * 256 * 3);
  const base = style === 'debug' ? tileBase(z, x, y) : [242 - (x + y) % 4, 239 - (x * 3 + y) % 4, 233 - (x + y * 3) % 4];
  const put = (px, py, c) => { const o = (py * 256 + px) * 3; rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2]; };
  for (let py = 0; py < 256; py++) for (let px = 0; px < 256; px++) put(px, py, base);
  if (style === 'debug') {
    for (let i = 0; i < 256; i++) for (let k = 127; k <= 129; k++) { put(i, k, CROSS); put(k, i, CROSS); }
  } else {
    /* străzi albe și o linie fină de margine, ca să arate a hartă */
    const road = [255, 255, 255], edge = [226, 222, 214];
    const h = (x * 31 + y * 17) % 160 + 40, v = (x * 13 + y * 29) % 160 + 40;
    for (let i = 0; i < 256; i++) { for (let k = 0; k < 7; k++) { put(i, Math.min(255, h + k), road); put(Math.min(255, v + k), i, road); } }
    for (let i = 0; i < 256; i++) { put(i, 0, edge); put(0, i, edge); }
  }
  b = png(256, 256, rgb);
  if (tileCache.size > 400) tileCache.clear();
  tileCache.set(key, b);
  return b;
}

/* ---------- simulări de rețea ---------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
function newState(extra) {
  return Object.assign({
    tileLog: [], overpassLog: [], snapLog: [], unexpected: [],
    cors: true, tileStyle: 'pretty', tilesFail: false, tileDelay: 0,
    elements: { b: [], i: [] },
    snapshot: null,           // fișierul data/places.json: obiect sau text; null = un răspuns care nu e un fișier de locuri; 404 = lipsește
    overpass: null            // fn({host, zone, strict, n}) -> {status?, json?, delay?}
  }, extra || {});
}

async function installMocks(ctx, S) {
  /* ce nu e prevăzut mai jos nu are voie să iasă pe net */
  await ctx.route(url => !/^http:\/\/127\.0\.0\.1[:/]/.test(url.href) && !/^(data|blob|about):/.test(url.href), route => {
    S.unexpected.push(route.request().url());
    route.abort();
  });
  /* fișierul cu locurile de pe site: îl hotărăște testul. Implicit nu e un fișier bun, ca să se vadă drumul prin Overpass
     (fără 404, ca să nu apară în consolă o eroare pe care aplicația n-o are în realitate cât timp fișierul există) */
  await ctx.route(/^http:\/\/127\.0\.0\.1:\d+\/data\/places\.json/, route => {
    S.snapLog.push(Date.now());
    if (S.snapshot === 404) return route.fulfill({ status: 404, body: 'nu există' });
    if (S.snapshot === null || S.snapshot === undefined) return route.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: 'null' });
    route.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: typeof S.snapshot === 'string' ? S.snapshot : JSON.stringify(S.snapshot) });
  });
  await ctx.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await ctx.route(/^https:\/\/tile\.openstreetmap\.org\//, async route => {
    const req = route.request(), m = /\/(\d+)\/(\d+)\/(\d+)\.png/.exec(req.url());
    if (!m) return route.abort();
    const z = +m[1], x = +m[2], y = +m[3];
    S.tileLog.push({ z, x, y, origin: !!req.headers().origin, referer: req.headers().referer || '' });
    if (S.tilesFail) return route.abort('internetdisconnected');
    if (S.tileDelay) await sleep(S.tileDelay);
    const headers = { 'content-type': 'image/png', 'cache-control': 'no-store' };
    if (S.cors) headers['access-control-allow-origin'] = '*';
    route.fulfill({ status: 200, headers, body: tilePng(z, x, y, S.tileStyle) });
  });
  await ctx.route(/^https:\/\/overpass[^/]*\/api\/interpreter/, async route => {
    const req = route.request(), url = new URL(req.url());
    const q = decodeURIComponent((req.postData() || '').replace(/^data=/, ''));
    const zone = /RO-IF|44\.15,25\.7,/.test(q) ? 'i' : 'b', strict = /ISO3166-2/.test(q);
    S.overpassLog.push({ host: url.host, zone, strict, q });
    const r = S.overpass ? await S.overpass({ host: url.host, zone, strict, n: S.overpassLog.length }) : null;
    const res = r || { json: { version: 0.6, elements: S.elements[zone] } };
    if (res.delay) await sleep(res.delay);
    route.fulfill({
      status: res.status || 200,
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
      body: JSON.stringify(res.json || {})
    });
  });
}

/* un server de plăci separat (altă origine), cu sau fără antete CORS */
function tileServer(opts) {
  opts = opts || {};
  const log = [];
  return new Promise(resolve => {
    const srv = http.createServer((req, rsp) => {
      const m = /\/(\d+)\/(\d+)\/(\d+)\.png/.exec(req.url);
      if (!m) { rsp.writeHead(404); return rsp.end(); }
      log.push({ z: +m[1], x: +m[2], y: +m[3], origin: !!req.headers.origin });
      const h = { 'content-type': 'image/png', 'cache-control': 'no-store' };
      if (opts.cors) h['access-control-allow-origin'] = '*';
      rsp.writeHead(200, h);
      rsp.end(tilePng(+m[1], +m[2], +m[3], opts.style || 'pretty'));
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, log, url: 'http://127.0.0.1:' + srv.address().port + '/{z}/{x}/{y}.png' }));
  });
}

module.exports = { serve, png, tilePng, tileBase, CROSS, newState, installMocks, tileServer, sleep };
