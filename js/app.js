/* Harta Auto București–Ilfov
   Harta: plăci OpenStreetMap desenate pe canvas (fără bibliotecă externă).
   Locurile: din OpenStreetMap, luate dintr-un fișier de pe site (data/places.json, refăcut zilnic) sau, dacă lipsește, de la Overpass;
   păstrate în telefon ca să meargă și fără net.
   Evaluările și serviciile completate de tine rămân deocamdată doar în telefon. */
(function () {
'use strict';

const OSM = window.HAOsm, HRS = window.HAHours;

/* ---------- ajutoare ---------- */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const SVGNS = 'http://www.w3.org/2000/svg';
const mk = (tag, attrs, parent) => {
  const e = document.createElementNS(SVGNS, tag);
  if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
};
const f1 = v => Math.round(v * 10) / 10;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const ro1 = n => n.toFixed(1).replace('.', ',');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ic = (id, cls) => '<svg class="ic' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#i-' + id + '"/></svg>';
const plural = (n, one, many) => n === 1 ? '1 ' + one : n + ((n % 100 === 0 || n % 100 >= 20) ? ' de ' : ' ') + many;
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } };

/* ---------- memorie locală (evaluări, servicii completate de tine) ---------- */
const mem = {};
const store = {
  get(k, d) {
    try { const v = localStorage.getItem('ha:' + k); if (v !== null) return JSON.parse(v); } catch (e) {}
    return (k in mem) ? mem[k] : d;
  },
  set(k, v) {
    mem[k] = v;
    try { localStorage.setItem('ha:' + k, JSON.stringify(v)); } catch (e) {}
  }
};
const RT = store.get('rt', {});   // id loc -> nota ta (1-5)
const SV = store.get('sv', {});   // id loc -> serviciile bifate de tine

/* locurile descărcate: IndexedDB (încap mai mult decât localStorage) */
const idb = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    try {
      const r = indexedDB.open('harta-auto', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  }));
  return {
    get: k => open().then(db => new Promise((res, rej) => {
      const t = db.transaction('kv', 'readonly').objectStore('kv').get(k);
      t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error);
    })).catch(() => undefined),
    set: (k, v) => open().then(db => new Promise((res, rej) => {
      const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k);
      t.oncomplete = res; t.onerror = () => rej(t.error);
    })).catch(() => {})
  };
})();

/* ---------- setări ---------- */
/* Plăcile vin de la serverul comun OpenStreetMap, potrivit pentru încercări și trafic mic.
   Pentru multă lume, schimbă adresa de mai jos cu a unui furnizor de plăci (vezi README). */
const DEBUG = /[?&]debug\b/.test(location.search);
const TILE_URL = (DEBUG && new URLSearchParams(location.search).get('tiles')) || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const MIN_Z = 9, MAX_Z = 19;
const BOUNDS = { lat0: 44.12, lat1: 44.82, lon0: 25.62, lon1: 26.58 };
const HOME = { lat0: 44.325, lat1: 44.565, lon0: 25.945, lon1: 26.265 };
const DATA_V = 1, MAX_AGE = 7 * 864e5;
/* Fișierul cu locurile (se reface zilnic din OpenStreetMap) e luat de pe același site: rapid și fără serverele Overpass.
   Overpass rămâne pentru când fișierul lipsește sau e mai vechi de MAX_AGE. */
const SNAP_URL = 'data/places.json', SNAP_AGE = 864e5, RETRY_GAP = 6 * 36e5;

const TYPES = {
  service: { label: 'Service', cv: '--c-service', words: 'service auto atelier mecanic reparatii' },
  benz:    { label: 'Benzinărie', cv: '--c-benz', gv: '--g-benz', iv: '--i-benz', words: 'benzinarie benzina motorina combustibil pompa carburant' },
  vulc:    { label: 'Vulcanizare', cv: '--c-vulc', words: 'vulcanizare anvelope cauciucuri roti' },
  spal:    { label: 'Spălătorie', cv: '--c-spal', words: 'spalatorie spalare auto' },
  piese:   { label: 'Piese', cv: '--c-piese', words: 'piese auto magazin' }
};
const tv = t => 'var(' + TYPES[t].cv + ')';
const tg = t => 'var(' + (TYPES[t].gv || '--pin-glyph') + ')';
const ti = t => 'var(' + (TYPES[t].iv || TYPES[t].cv) + ')';
const SVC = OSM.SVC;
const DAYS = HRS.DAYS;

/* ---------- Mercator: (0,0) = colț stânga-sus al lumii, (1,1) = dreapta-jos ---------- */
const mxOf = lon => (lon + 180) / 360;
const myOf = lat => {
  const s = Math.sin(clamp(lat, -85.0511, 85.0511) * Math.PI / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};
const latOf = my => { const n = Math.PI * (1 - 2 * my); return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); };
const Sz = z => 256 * Math.pow(2, z);
const BMX = [mxOf(BOUNDS.lon0), mxOf(BOUNDS.lon1)], BMY = [myOf(BOUNDS.lat1), myOf(BOUNDS.lat0)];

/* ---------- elemente și stare ---------- */
const app = $('#app'), mapEl = $('#map'), cv = $('#tiles'), ov = $('#ov');
const gCl = $('#g-cl'), gPin = $('#g-pin'), gMe = $('#g-me');
const topEl = $('#top'), sheetEl = $('#sheet'), listEl = $('#list'), listBody = $('#listBody'), listHead = $('#listHead');
const msgEl = $('#msg'), toastEl = $('#toast'), qEl = $('#q'), qx = $('#qx'), modeBtn = $('#mode');
const chipsEl = $('#chips'), scaleBarEl = $('#scaleBar'), scaleTxt = $('#scaleTxt');
const aboutEl = $('#about'), aboutCard = $('#aboutCard'), netEl = $('#net'), locBtn = $('#loc');
const ctx = cv.getContext('2d');
const mqDesk = matchMedia('(min-width:900px)');
const REDUCED = matchMedia('(prefers-reduced-motion:reduce)').matches;

let W = 0, H = 0, DPR = 1, peekH = 0, anim = 0, raf = 0, editing = false, listLimit = 120;
let zChangedAt = 0, settleTimer = 0;
let atHome = true;   /* harta e încă în vederea de pornire: omul n-a mutat-o, deci o putem potrivi din nou cu ecranul */
const view = { cx: .5, cy: .5, z: 10 };
const state = { types: new Set(), open: false, q: '', sel: null, view: 'map' };
let PLACES = [], byId = {}, me = null;
let loadState = 'loading', loadError = '', slowT = 0;
const zoneData = { b: null, i: null }, zoneTs = { b: 0, i: 0 };

/* ---------- ora în România ---------- */
function bucharestNow() {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date());
    const get = t => (parts.find(x => x.type === t) || {}).value;
    const d = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[get('weekday')];
    const h = parseInt(get('hour'), 10) % 24, m = parseInt(get('minute'), 10);
    if (d === undefined || isNaN(h) || isNaN(m)) throw 0;
    return { d, m: h * 60 + m };
  } catch (e) {
    const n = new Date();
    return { d: (n.getDay() + 6) % 7, m: n.getHours() * 60 + n.getMinutes() };
  }
}
let NOW = bucharestNow();
const statusOf = p => p.wk ? HRS.status(p.wk.week, NOW.d, NOW.m) : null;

/* ---------- date per loc ---------- */
const getSv = p => SV[p.id] || p.sv;
function hay(p) {
  if (p._h === undefined) {
    p._h = norm([p.n, p.b, p.a, p.z, TYPES[p.t].label, TYPES[p.t].words].concat(getSv(p).map(c => SVC[p.t][c] || '')).join(' '));
  }
  return p._h;
}
function passes(p, skipType) {
  if (!skipType && state.types.size && !state.types.has(p.t)) return false;
  if (state.open) { const s = statusOf(p); if (!s || !s.open) return false; }
  if (state.q) {
    const h = hay(p);
    if (!state.q.split(/\s+/).every(t => h.indexOf(t) >= 0)) return false;
  }
  return true;
}
const serializable = p => ({ id: p.id, t: p.t, n: p.n, z: p.z, a: p.a, lat: p.lat, lon: p.lon, h: p.h, tel: p.tel, w: p.w, sv: p.sv, b: p.b });
/* un loc din fișierul de pe site: ce nu arată bine se ignoră */
function cleanPlace(p) {
  if (!p || typeof p.id !== 'string' || !Object.prototype.hasOwnProperty.call(TYPES, p.t)) return null;
  if (typeof p.lat !== 'number' || typeof p.lon !== 'number' || !(Math.abs(p.lat) <= 90) || !(Math.abs(p.lon) <= 180)) return null;
  const s = v => typeof v === 'string' ? v : '';
  return { id: p.id, t: p.t, n: s(p.n), z: s(p.z), a: s(p.a), lat: p.lat, lon: p.lon, h: s(p.h), tel: Array.isArray(p.tel) ? p.tel : [], w: s(p.w), sv: Array.isArray(p.sv) ? p.sv : [], b: s(p.b) };
}

/* distanța în metri (suficient de exactă pe distanțe mici) */
function distM(a, b) {
  const dy = (a.lat - b.lat) * 111200, dx = (a.lon - b.lon) * 111200 * Math.cos(a.lat * Math.PI / 180);
  return Math.sqrt(dx * dx + dy * dy);
}
const fmtDist = m => m < 1000 ? (Math.round(m / 10) * 10 || 10) + ' m' : ro1(m / 1000) + ' km';
function centerLL() {
  return { lat: latOf(view.cy), lon: view.cx * 360 - 180 };
}

/* ---------- vedere: centru + zoom ---------- */
function measure() {
  const r = mapEl.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  if (r.width !== W || r.height !== H || dpr !== DPR) {
    W = r.width; H = r.height; DPR = dpr;
    cv.width = Math.max(1, Math.round(W * DPR)); cv.height = Math.max(1, Math.round(H * DPR));
    scheduleRender();
  }
  app.style.setProperty('--top-h', topEl.offsetHeight + 'px');
  if (!sheetEl.hidden && sheetEl.dataset.state === 'peek') peekH = sheetEl.offsetHeight;
  const sh = (!mqDesk.matches && !sheetEl.hidden && state.view === 'map') ? (peekH || sheetEl.offsetHeight) : 0;
  app.style.setProperty('--sheet-h', sh + 'px');
}
function insets() {
  if (mqDesk.matches) return { top: 0, right: 0, bottom: 0, left: (!sheetEl.hidden || state.view === 'list') ? 464 : 0 };
  return { top: topEl.offsetHeight, right: 0, left: 0, bottom: (!sheetEl.hidden && state.view === 'map') ? (peekH || sheetEl.offsetHeight) : 0 };
}
/* vedere care pune punctul (mx,my) în mijlocul zonei libere de pe ecran */
function viewAt(mx, my, z) {
  const i = insets(), S = Sz(z);
  const fx = i.left + (W - i.left - i.right) / 2, fy = i.top + (H - i.top - i.bottom) / 2;
  return { z, cx: mx - (fx - W / 2) / S, cy: my - (fy - H / 2) / S };
}
function viewFit(b, pad, maxZ) {
  const i = insets();
  const aw = Math.max(40, W - i.left - i.right - 2 * pad), ah = Math.max(40, H - i.top - i.bottom - 2 * pad);
  const S = Math.min(aw / Math.max(b.x1 - b.x0, 1e-9), ah / Math.max(b.y1 - b.y0, 1e-9));
  const z = clamp(Math.log(S / 256) / Math.LN2, MIN_Z, maxZ || MAX_Z);
  return viewAt((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, z);
}
const clampView = v => ({ z: clamp(v.z, MIN_Z, MAX_Z), cx: clamp(v.cx, BMX[0], BMX[1]), cy: clamp(v.cy, BMY[0], BMY[1]) });
function setView(v, noClamp, home) {
  const c = noClamp ? v : clampView(v);
  if (!home) atHome = false;
  if (Math.abs(c.z - view.z) > 1e-4) zChangedAt = performance.now();
  view.cx = c.cx; view.cy = c.cy; view.z = c.z;
  scheduleRender();
}
function animateTo(v, ms) {
  const t = clampView(v);
  cancelAnimationFrame(anim);
  if (REDUCED || ms === 0) { setView(t, true); return; }
  const c0 = { cx: view.cx, cy: view.cy, z: view.z }, S0 = Sz(c0.z), t0 = performance.now();
  const dur = ms || Math.min(900, 420 + Math.abs(t.z - c0.z) * 70);
  const step = now => {
    const p = clamp((now - t0) / dur, 0, 1), e = p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    const z = c0.z + (t.z - c0.z) * e, k = S0 * (1 - e) / Sz(z);
    setView({ z, cx: t.cx - (t.cx - c0.cx) * k, cy: t.cy - (t.cy - c0.cy) * k }, true);
    if (p < 1) anim = requestAnimationFrame(step);
  };
  anim = requestAnimationFrame(step);
}
/* zoom cu factorul f; punctul de sub (sx,sy) ajunge sub (nx,ny) */
function zoomAt(f, sx, sy, nx, ny) {
  const S0 = Sz(view.z);
  const px = view.cx + (sx - W / 2) / S0, py = view.cy + (sy - H / 2) / S0;
  const z = clamp(view.z + Math.log(f) / Math.LN2, MIN_Z, MAX_Z), S = Sz(z);
  if (nx === undefined) { nx = sx; ny = sy; }
  setView({ z, cx: px - (nx - W / 2) / S, cy: py - (ny - H / 2) / S });
}
function panBy(dx, dy) {
  const S = Sz(view.z);
  setView({ z: view.z, cx: view.cx - dx / S, cy: view.cy - dy / S });
}
const mercBounds = arr => {
  const b = { x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9 };
  arr.forEach(p => { b.x0 = Math.min(b.x0, p.mx); b.x1 = Math.max(b.x1, p.mx); b.y0 = Math.min(b.y0, p.my); b.y1 = Math.max(b.y1, p.my); });
  return b;
};
function homeView() {
  return viewFit({ x0: mxOf(HOME.lon0), x1: mxOf(HOME.lon1), y0: myOf(HOME.lat1), y1: myOf(HOME.lat0) }, 20, 12);
}
/* Vederea de pornire: tot Bucureștiul pe ecran. Primul ecran măsurat nu e mereu cel final (pagină deschisă în fundal sau într-o
   fereastră încă închisă, bara de sus care își ia forma după fonturi, telefon rotit), așa că până ce omul mută harta
   o potrivim din nou cu ecranul de fiecare dată când acesta își schimbă mărimea. După prima mișcare nu o mai atingem. */
function fitHome() { setView(homeView(), true, true); }
function onResize() { measure(); if (atHome) fitHome(); scheduleRender(); }
const toScreen = (mx, my) => { const S = Sz(view.z); return [(mx - view.cx) * S + W / 2, (my - view.cy) * S + H / 2]; };

/* ---------- plăcile hărții (canvas) ---------- */
const tiles = new Map();
let frameNo = 0, netErr = 0, retryTimer = 0, useCors = true;

function getTile(z, x, y, load) {
  const k = z + '/' + x + '/' + y;
  let t = tiles.get(k), fails = 0;
  if (t) {
    t.f = frameNo;
    /* placă eșuată: se reia după 6 s, apoi 12 s, 24 s... cel mult 60 s */
    if (t.st === 2 && load && performance.now() - t.at > Math.min(60000, 6000 * Math.pow(2, t.fails - 1))) { fails = t.fails; tiles.delete(k); t = null; }
    else return t;
  }
  if (!load) return null;
  const img = new Image(), url = TILE_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  t = { img, st: 0, f: frameNo, at: performance.now(), retried: false, fails };
  img.onload = () => {
    if (t.st === 3) return;
    if (t.retried) useCors = false;   /* serverul de plăci nu trimite CORS: nu mai încerca cu CORS */
    t.st = 1; netErr = 0; showNet(false); scheduleRender();
  };
  img.onerror = () => {
    if (t.st === 3) return;
    if (useCors && !t.retried) { t.retried = true; img.removeAttribute('crossorigin'); img.src = url; return; }
    t.st = 2; t.at = performance.now(); t.fails++; netErr++;
    if (netErr >= 6) showNet(true);
    clearTimeout(retryTimer); retryTimer = setTimeout(scheduleRender, 6500);
  };
  img.decoding = 'async';
  if (useCors) img.crossOrigin = 'anonymous';   /* răspuns nu „opac”: poate fi păstrat de aplicație pentru offline */
  img.src = url;
  tiles.set(k, t);
  if (tiles.size > 170) trimTiles();
  return t;
}
function trimTiles() {
  Array.from(tiles.entries()).filter(e => e[1].f < frameNo - 1).sort((a, b) => a[1].f - b[1].f).slice(0, 60).forEach(e => {
    if (e[1].st === 0) { e[1].st = 3; e[1].img.src = ''; }
    tiles.delete(e[0]);
  });
}
function showNet(on) {
  const off = navigator.onLine === false;
  netEl.hidden = !(on || off);
  netEl.textContent = off ? 'Fără conexiune · harta poate fi incompletă' : 'Harta nu se încarcă acum · încerc din nou';
}

/* desenează o placă; dacă nu e gata, folosește una mai mare sau mai mică deja încărcată */
function paintTile(zt, tx, ty, X0, Y0, X1, Y1, load) {
  const t = getTile(zt, tx, ty, load);
  if (t && t.st === 1) { ctx.drawImage(t.img, X0, Y0, X1 - X0, Y1 - Y0); return; }
  for (let k = 1; k <= 4 && zt - k >= 0; k++) {
    const pt = getTile(zt - k, tx >> k, ty >> k, false);
    if (pt && pt.st === 1) {
      const size = 256 >> k, m = (1 << k) - 1;
      ctx.drawImage(pt.img, (tx & m) * size, (ty & m) * size, size, size, X0, Y0, X1 - X0, Y1 - Y0);
      return;
    }
  }
  if (zt < MAX_Z) {
    const XM = Math.round((X0 + X1) / 2), YM = Math.round((Y0 + Y1) / 2);
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      const c = getTile(zt + 1, tx * 2 + i, ty * 2 + j, false);
      if (c && c.st === 1) ctx.drawImage(c.img, i ? XM : X0, j ? YM : Y0, (i ? X1 : XM) - (i ? XM : X0), (j ? Y1 : YM) - (j ? YM : Y0));
    }
  }
}
function drawTiles() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#f2efe9';
  ctx.fillRect(0, 0, cv.width, cv.height);
  if (!W || !H) return;
  const z = view.z, S = Sz(z);
  const zt = clamp(Math.round(z), 0, MAX_Z), n = Math.pow(2, zt), ts = S / n;
  const cxn = view.cx * n, cyn = view.cy * n;
  const tx0 = Math.floor(cxn - W / 2 / ts), tx1 = Math.floor(cxn + W / 2 / ts);
  const ty0 = Math.max(0, Math.floor(cyn - H / 2 / ts)), ty1 = Math.min(n - 1, Math.floor(cyn + H / 2 / ts));
  const canLoad = performance.now() - zChangedAt > 140;
  const want = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) want.push([tx, ty]);
  want.sort((a, b) => Math.hypot(a[0] + .5 - cxn, a[1] + .5 - cyn) - Math.hypot(b[0] + .5 - cxn, b[1] + .5 - cyn));
  ctx.imageSmoothingEnabled = true;
  for (let i = 0; i < want.length; i++) {
    const tx = want[i][0], ty = want[i][1], wx = ((tx % n) + n) % n;
    const X0 = Math.round(((tx - cxn) * ts + W / 2) * DPR), X1 = Math.round(((tx + 1 - cxn) * ts + W / 2) * DPR);
    const Y0 = Math.round(((ty - cyn) * ts + H / 2) * DPR), Y1 = Math.round(((ty + 1 - cyn) * ts + H / 2) * DPR);
    paintTile(zt, wx, ty, X0, Y0, X1, Y1, canLoad);
  }
  if (!canLoad) { clearTimeout(settleTimer); settleTimer = setTimeout(scheduleRender, 170); }
}

/* ---------- pini și grupuri ---------- */
function buildPin(p) {
  const T = TYPES[p.t];
  const g = mk('g', { 'class': 'pin', 'data-id': p.id, tabindex: '0', role: 'button', 'aria-label': (p.n || T.label) + ', ' + T.label });
  g.style.setProperty('--c', tv(p.t));
  g.style.setProperty('--g', tg(p.t));
  mk('ellipse', { 'class': 'pin-sh', cx: 0, cy: .5, rx: 7, ry: 2.4 }, g);
  mk('path', { 'class': 'pin-b', d: 'M0 0C-3 -6 -13 -14 -13 -26a13 13 0 1 1 26 0C13 -14 3 -6 0 0Z' }, g);
  const u = mk('use', { 'class': 'pin-g', x: -8, y: -34, width: 16, height: 16 }, g);
  u.setAttribute('href', '#i-' + p.t);
  return g;
}

let clusters = [], clusterZ = -1, clusterDirty = true;
const clEls = new Map(), clByKey = new Map(), shown = new Set();

function computeClusters() {
  const S = Sz(view.z), R = 30, cell = R, grid = new Map(), out = [];
  const items = PLACES.filter(p => passes(p));
  for (let i = 0; i < items.length; i++) {
    const p = items[i];
    if (p.id === state.sel) { out.push({ items: [p], mx: p.mx, my: p.my, key: 'p' + p.id }); continue; }
    const px = p.mx * S, py = p.my * S, gx = Math.floor(px / cell), gy = Math.floor(py / cell);
    let best = null, bd = R * R;
    for (let ix = gx - 1; ix <= gx + 1; ix++) for (let iy = gy - 1; iy <= gy + 1; iy++) {
      const list = grid.get(ix + ',' + iy);
      if (!list) continue;
      for (let j = 0; j < list.length; j++) {
        const c = list[j], dx = c.lx - px, dy = c.ly - py, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = c; }
      }
    }
    if (best) { best.items.push(p); best.sx += px; best.sy += py; }
    else {
      const c = { items: [p], lx: px, ly: py, sx: px, sy: py };
      out.push(c);
      const k = gx + ',' + gy;
      (grid.get(k) || grid.set(k, []).get(k)).push(c);
    }
  }
  const keys = new Set();
  out.forEach(c => {
    if (c.key) { keys.add(c.key); return; }
    const n = c.items.length;
    c.mx = c.sx / n / S; c.my = c.sy / n / S;
    c.key = n === 1 ? 'p' + c.items[0].id : 'c' + c.items[0].id + ':' + n;
    keys.add(c.key);
  });
  clusters = out; clusterZ = view.z; clusterDirty = false;
  clByKey.clear();
  out.forEach(c => { if (c.items.length > 1) clByKey.set(c.key, c); });
  /* scoate din ecran ce nu mai există */
  clEls.forEach((el, k) => { if (!keys.has(k)) { clEls.delete(k); if (shown.has(el)) { el.remove(); shown.delete(el); } } });
  shown.forEach(el => {
    const id = el.getAttribute('data-id');
    if (id && !keys.has('p' + id)) { el.remove(); shown.delete(el); }
  });
}
function elFor(c) {
  if (c.items.length === 1) {
    const p = c.items[0];
    if (!p.el) p.el = buildPin(p);
    return p.el;
  }
  let el = clEls.get(c.key);
  if (!el) {
    el = mk('g', { 'class': 'cl', 'data-k': c.key, role: 'button', tabindex: '0', 'aria-label': c.items.length + ' locuri, apasă ca să mărești' });
    const same = c.items.every(p => p.t === c.items[0].t);
    el.style.setProperty('--c', same ? tv(c.items[0].t) : 'var(--ink)');
    el.style.setProperty('--g', same ? tg(c.items[0].t) : 'var(--pin-glyph)');
    mk('circle', { 'class': 'cl-h', r: 25 }, el);
    mk('circle', { 'class': 'cl-b', r: 18 }, el);
    mk('text', { 'class': 'cl-t', y: 5.5 }, el).textContent = c.items.length > 99 ? '99+' : c.items.length;
    clEls.set(c.key, el);
  }
  return el;
}
function syncOverlay() {
  if (clusterDirty || Math.abs(view.z - clusterZ) > 0.06) computeClusters();
  const S = Sz(view.z), seen = new Set();
  let selEl = null;
  for (let i = 0; i < clusters.length; i++) {
    const c = clusters[i];
    const sx = (c.mx - view.cx) * S + W / 2, sy = (c.my - view.cy) * S + H / 2;
    if (sx < -50 || sx > W + 50 || sy < -60 || sy > H + 50) continue;
    const el = elFor(c), single = c.items.length === 1, sel = single && c.items[0].id === state.sel;
    if (single) el.classList.toggle('sel', sel);
    el.setAttribute('transform', 'translate(' + f1(sx) + ' ' + f1(sy) + ')' + (sel ? ' scale(1.22)' : ''));
    seen.add(el);
    if (!shown.has(el)) { (single ? gPin : gCl).appendChild(el); shown.add(el); }
    if (sel) selEl = el;
  }
  shown.forEach(el => { if (!seen.has(el)) { el.remove(); shown.delete(el); } });
  if (selEl && gPin.lastChild !== selEl) gPin.appendChild(selEl);
  /* punctul „eu” */
  if (me) {
    if (!me.el) {
      me.el = mk('g', {}, gMe);
      me.acc = mk('circle', { 'class': 'me-acc', r: 20 }, me.el);
      mk('circle', { 'class': 'me-dot', r: 8 }, me.el);
    }
    const sx = (me.mx - view.cx) * S + W / 2, sy = (me.my - view.cy) * S + H / 2;
    const mpp = 156543.03392 * Math.cos(me.lat * Math.PI / 180) / Math.pow(2, view.z);
    me.acc.setAttribute('r', f1(Math.max(14, Math.min(me.acc0 / mpp, 400))));
    me.el.setAttribute('transform', 'translate(' + f1(sx) + ' ' + f1(sy) + ')');
  }
}

let lastScale = '';
function updateScale() {
  const lat = latOf(view.cy), mpp = 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, view.z);
  const nice = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
  let d = nice[0];
  for (let i = 0; i < nice.length; i++) { d = nice[i]; if (d / mpp >= 56) break; }
  const w = Math.round(d / mpp) + 'px', txt = d >= 1000 ? (d / 1000) + ' km' : d + ' m';
  if (w + txt !== lastScale) { lastScale = w + txt; scaleBarEl.style.width = w; scaleTxt.textContent = txt; }
}

function render() {
  raf = 0; frameNo++;
  drawTiles();
  syncOverlay();
  updateScale();
}
function scheduleRender() { if (!raf && W) raf = requestAnimationFrame(render); }

function zoomCluster(key) {
  const c = clByKey.get(key);
  if (!c) return;
  const S = Sz(view.z), b = mercBounds(c.items);
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  if ((b.x1 - b.x0) * S < 8 && (b.y1 - b.y0) * S < 8) { animateTo(viewAt(cx, cy, Math.min(MAX_Z, view.z + 2.2))); return; }
  let z = viewFit(b, 90, 18).z;
  if (z < view.z + .6) z = Math.min(MAX_Z, view.z + 1.6);
  animateTo(viewAt(cx, cy, z));
}

/* ---------- atingeri: tragere, ciupire, apăsare ---------- */
const ptrs = new Map();
let tap = null, pinch = null, moves = [], lastTap = null;
mapEl.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  cancelAnimationFrame(anim);
  if (document.activeElement === qEl) qEl.blur();
  try { mapEl.setPointerCapture(e.pointerId); } catch (x) {}
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptrs.size === 1) {
    tap = { x: e.clientX, y: e.clientY, t: performance.now(), target: e.target, moved: false };
    moves = [{ t: performance.now(), x: e.clientX, y: e.clientY }];
  } else {
    tap = null;
    const a = Array.from(ptrs.values());
    pinch = { d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), mx: (a[0].x + a[1].x) / 2, my: (a[0].y + a[1].y) / 2 };
  }
});
mapEl.addEventListener('pointermove', e => {
  const p = ptrs.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (ptrs.size === 1) {
    let mx = dx, my = dy;
    if (tap && !tap.moved) {
      if (Math.hypot(e.clientX - tap.x, e.clientY - tap.y) <= 6) return;
      tap.moved = true; mapEl.classList.add('drag');
      mx = e.clientX - tap.x; my = e.clientY - tap.y;
    }
    panBy(mx, my);
    moves.push({ t: performance.now(), x: e.clientX, y: e.clientY });
    if (moves.length > 8) moves.shift();
  } else if (pinch) {
    const a = Array.from(ptrs.values()), r = mapEl.getBoundingClientRect();
    const d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), mx = (a[0].x + a[1].x) / 2, my = (a[0].y + a[1].y) / 2;
    if (pinch.d > 0 && d > 0) zoomAt(d / pinch.d, pinch.mx - r.left, pinch.my - r.top, mx - r.left, my - r.top);
    pinch = { d, mx, my };
  }
});
function fling(vx, vy) {
  let last = performance.now();
  const step = now => {
    const dt = Math.min(now - last, 50); last = now;
    const k = Math.exp(-dt / 280);
    vx *= k; vy *= k;
    if (Math.hypot(vx, vy) < 0.02) return;
    panBy(vx * dt, vy * dt);
    anim = requestAnimationFrame(step);
  };
  anim = requestAnimationFrame(step);
}
function endPtr(e) {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.delete(e.pointerId);
  if (ptrs.size === 0) {
    mapEl.classList.remove('drag');
    const now = performance.now();
    if (tap && !tap.moved && e.type === 'pointerup' && now - tap.t < 700) {
      const onItem = tap.target.closest && (tap.target.closest('.pin') || tap.target.closest('.cl'));
      if (!onItem && lastTap && now - lastTap.t < 320 && Math.hypot(lastTap.x - tap.x, lastTap.y - tap.y) < 30) {
        const r = mapEl.getBoundingClientRect();
        zoomAt(2, tap.x - r.left, tap.y - r.top);
        lastTap = null;
      } else {
        lastTap = onItem ? null : { t: now, x: tap.x, y: tap.y };
        onTap(tap.target);
      }
    } else if (tap && tap.moved && e.type === 'pointerup' && moves.length > 1) {
      const last = moves[moves.length - 1];
      let first = moves[0];
      for (let i = 0; i < moves.length; i++) { if (last.t - moves[i].t <= 100) { first = moves[i]; break; } }
      const dt = last.t - first.t;
      if (dt > 0 && now - last.t < 80) {
        const vx = (last.x - first.x) / dt, vy = (last.y - first.y) / dt;
        if (Math.hypot(vx, vy) > 0.3) fling(Math.max(-4, Math.min(4, vx)), Math.max(-4, Math.min(4, vy)));
      }
    }
    tap = null; pinch = null; moves = [];
  } else if (ptrs.size === 1) {
    pinch = null; tap = null; moves = [];
    const rest = Array.from(ptrs.values())[0];
    moves = [{ t: performance.now(), x: rest.x, y: rest.y }];
  }
}
mapEl.addEventListener('pointerup', endPtr);
mapEl.addEventListener('pointercancel', endPtr);
mapEl.addEventListener('wheel', e => {
  e.preventDefault();
  cancelAnimationFrame(anim);
  const r = mapEl.getBoundingClientRect(), dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
  zoomAt(Math.exp(-dy * (e.ctrlKey ? .01 : .0017)), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });
mapEl.addEventListener('contextmenu', e => e.preventDefault());
function onTap(t) {
  const pin = t.closest && t.closest('.pin');
  if (pin) return select(pin.getAttribute('data-id'));
  const cl = t.closest && t.closest('.cl');
  if (cl) return zoomCluster(cl.getAttribute('data-k'));
  if (state.sel) deselect();
}
ov.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const pin = e.target.closest && e.target.closest('.pin'), cl = e.target.closest && e.target.closest('.cl');
  if (pin) { e.preventDefault(); select(pin.getAttribute('data-id')); }
  else if (cl) { e.preventDefault(); zoomCluster(cl.getAttribute('data-k')); }
});
mapEl.addEventListener('keydown', e => {
  if (e.target !== mapEl) return;
  const s = 90;
  if (e.key === '+' || e.key === '=') zoomAt(1.4, W / 2, H / 2);
  else if (e.key === '-') zoomAt(1 / 1.4, W / 2, H / 2);
  else if (e.key === 'ArrowLeft') panBy(s, 0);
  else if (e.key === 'ArrowRight') panBy(-s, 0);
  else if (e.key === 'ArrowUp') panBy(0, s);
  else if (e.key === 'ArrowDown') panBy(0, -s);
  else return;
  e.preventDefault();
});
const stepZoom = d => animateTo({ cx: view.cx, cy: view.cy, z: view.z + d }, 260);
$('#zin').addEventListener('click', () => stepZoom(1));
$('#zout').addEventListener('click', () => stepZoom(-1));

/* ---------- unde sunt ---------- */
function toast(msg, ms) {
  toastEl.textContent = msg; toastEl.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { toastEl.hidden = true; }, ms || 3400);
}
function locate() {
  if (!navigator.geolocation) { toast('Acest telefon nu oferă locația.'); return; }
  toast('Caut locația ta…', 5000);
  navigator.geolocation.getCurrentPosition(pos => {
    const lat = pos.coords.latitude, lon = pos.coords.longitude;
    me = { lat, lon, mx: mxOf(lon), my: myOf(lat), acc0: pos.coords.accuracy || 30 };
    gMe.textContent = '';
    locBtn.classList.add('on');
    toastEl.hidden = true;
    if (lat < BOUNDS.lat0 || lat > BOUNDS.lat1 || lon < BOUNDS.lon0 || lon > BOUNDS.lon1) {
      toast('Ești în afara zonei București–Ilfov. Harta arată doar această zonă.', 4200);
      scheduleRender();
      return;
    }
    animateTo(viewAt(me.mx, me.my, Math.max(view.z, 14.5)));
    if (!listEl.hidden) renderList();
  }, err => {
    toast(err && err.code === 1 ? 'Nu ai dat acces la locație. Îl poți porni din setările telefonului.' : 'Nu am putut afla unde ești. Încearcă din nou.', 4600);
  }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
}
locBtn.addEventListener('click', locate);

/* ---------- fișa locului ---------- */
function stars(avg) {
  const row = ic('star').repeat(5);
  return '<span class="stars" role="img" aria-label="' + ro1(avg) + ' din 5"><span class="st-bg">' + row + '</span><span class="st-fg" style="width:' + Math.round(avg / 5 * 100) + '%">' + row + '</span></span>';
}
function sheetHTML(p) {
  const T = TYPES[p.t], st = statusOf(p), mine = RT[p.id] || 0, sv = getSv(p), usv = SV[p.id];
  const title = p.n || (T.label + ' fără nume');
  const addr = p.a || p.z;
  const ref = me, dist = ref ? fmtDist(distM(ref, p)) : '';
  const ll = p.lat + ',' + p.lon;

  let hoursHTML;
  if (p.wk) {
    hoursHTML = '<div class="hours">' + HRS.groups(p.wk.week).map(g => {
      const today = NOW.d >= g.a && NOW.d <= g.b;
      return '<div class="hr' + (today ? ' today' : '') + '"><span>' + (g.a === g.b ? DAYS[g.a] : DAYS[g.a] + '–' + DAYS[g.b]) + '</span><span>' + g.text + '</span></div>';
    }).join('') + '</div>';
  } else if (p.h) {
    hoursHTML = '<p class="raw">' + esc(p.h) + '</p><p class="hint">Programul e scris într-un format pe care aplicația nu îl poate citi încă.</p>';
  } else hoursHTML = '<p class="empty-sv">Programul nu e completat în OpenStreetMap.</p>';

  let contact = '';
  if (p.tel.length) {
    contact += p.tel.map(t => '<div class="tel"><span class="tel-n">' + esc(t[0]) + '</span><span class="tel-b"><a class="copy call" href="tel:' + esc(t[1]) + '">' + ic('phone') + '<span>Sună</span></a><button class="copy" data-act="copy" data-copy="' + esc(t[0]) + '">' + ic('copy') + '<span>Copiază</span></button></span></div>').join('');
  } else contact += '<p class="empty-sv">Niciun telefon completat în OpenStreetMap.</p>';
  if (p.w) contact += '<a class="web" href="' + esc(p.w) + '" target="_blank" rel="noopener noreferrer">' + ic('globe') + '<span>' + esc(hostOf(p.w)) + '</span></a>';

  let svc;
  if (editing) {
    svc = '<p class="hint" style="margin:0 0 12px">Bifează ce se poate face aici.</p><div class="sv">' +
      Object.keys(SVC[p.t]).map(c => '<button class="sv-chip tgl" data-act="sv-toggle" data-sv="' + c + '" aria-pressed="' + (sv.indexOf(c) >= 0) + '">' + ic('check') + esc(SVC[p.t][c]) + '</button>').join('') +
      '</div><div class="row-btns"><button class="btn primary sm" data-act="save-sv">Salvează</button><button class="btn ghost sm" data-act="cancel-sv">Renunță</button></div>';
  } else if (sv.length) {
    svc = '<div class="sv">' + sv.map(c => '<span class="sv-chip">' + esc(SVC[p.t][c] || c) + '</span>').join('') + '</div>' +
      (usv ? '<p class="hint">Modificat de tine, doar pe acest telefon.</p>' : '') +
      '<button class="link" data-act="edit-sv">Lipsește ceva? Completează</button>';
  } else {
    svc = '<p class="empty-sv">Serviciile nu sunt completate încă.</p><button class="btn ghost sm" data-act="edit-sv">Completează serviciile</button>';
  }

  const rateRow = [1, 2, 3, 4, 5].map(n => '<button class="rate-b' + (mine >= n ? ' on' : '') + '" data-act="rate" data-n="' + n + '" aria-label="' + n + ' din 5">' + ic('star', 'lg') + '</button>').join('');
  const rateTxt = mine
    ? '<p class="hint">Ai dat ' + mine + ' din 5. Nota se salvează doar pe acest telefon.<button class="link" data-act="unrate">Șterge nota</button></p>'
    : '<p class="hint">Atinge o stea. Notele se salvează deocamdată doar pe acest telefon; notele comune, de la toți șoferii, vin odată cu conturile.</p>';

  return '<div class="grab" role="button" tabindex="0" aria-label="Arată sau ascunde detaliile"></div>' +
    '<div class="s-title"><h2 class="s-name">' + esc(title) + '</h2><button class="icon-btn s-close" data-act="close" aria-label="Închide">' + ic('x') + '</button></div>' +
    '<div class="s-meta"><span class="s-type" style="--ci:' + ti(p.t) + '">' + ic(p.t) + T.label + '</span>' + (addr ? '<span>' + esc(addr) + '</span>' : '') + (dist ? '<span>' + dist + '</span>' : '') + '</div>' +
    (st
      ? '<div class="s-status"><i class="dot' + (st.open ? ' on' : '') + '"></i><b class="' + (st.open ? 'ok' : 'no') + '">' + (st.open ? 'Deschis' : 'Închis') + '</b>' + (st.text ? '<span>· ' + st.text + '</span>' : '') + '</div>'
      : '<div class="s-status"><i class="dot unk"></i><span>Program necunoscut</span></div>') +
    '<div class="s-rate">' + (mine ? '<b>' + mine + ',0</b>' + stars(mine) + '<span>nota ta</span>' : '<span>Nicio evaluare încă</span>') + '</div>' +
    '<div class="s-actions"><a class="btn primary" href="https://www.google.com/maps/dir/?api=1&amp;destination=' + ll + '&amp;travelmode=driving" target="_blank" rel="noopener">' + ic('nav') + 'Navighează</a>' +
    (p.tel.length ? '<a class="btn ghost round" href="tel:' + esc(p.tel[0][1]) + '" aria-label="Sună la ' + esc(p.tel[0][0]) + '">' + ic('phone') + '</a>' : '') +
    '<button class="btn ghost" data-act="toggle"><span>Detalii</span>' + ic('chev') + '</button></div>' +
    '<div class="s-body">' +
      '<section class="sec"><h3>Program</h3>' + hoursHTML + '</section>' +
      '<section class="sec"><h3>Contact</h3>' + contact + '</section>' +
      '<section class="sec"><h3>' + (p.t === 'benz' ? 'Combustibil și servicii' : 'Servicii') + '</h3>' + svc + '</section>' +
      '<section class="sec"><h3>Evaluează locul</h3><div class="rate">' + rateRow + '</div>' + rateTxt + '</section>' +
      '<section class="sec"><h3>Deschide în</h3><div class="navs">' +
        '<a class="copy" href="https://www.google.com/maps/dir/?api=1&amp;destination=' + ll + '&amp;travelmode=driving" target="_blank" rel="noopener">Google Maps</a>' +
        '<a class="copy" href="https://waze.com/ul?ll=' + ll + '&amp;navigate=yes" target="_blank" rel="noopener">Waze</a>' +
        '<a class="copy" href="https://maps.apple.com/?daddr=' + ll + '&amp;dirflg=d" target="_blank" rel="noopener">Apple Maps</a></div></section>' +
      '<p class="s-note">Date din <a href="' + OSM.osmUrl(p.id) + '" target="_blank" rel="noopener">OpenStreetMap</a>, © contribuitorii OpenStreetMap. Lipsește ceva sau e greșit? <a href="' + OSM.osmEditUrl(p.id) + '" target="_blank" rel="noopener">Corectează în OpenStreetMap</a> și apare pentru toți.</p>' +
    '</div>';
}
function syncToggle() {
  const b = sheetEl.querySelector('.btn[data-act="toggle"] span');
  if (b) b.textContent = sheetEl.dataset.state === 'full' ? 'Mai puțin' : 'Detalii';
}
function setSheetState(s) {
  sheetEl.dataset.state = s; app.dataset.sheet = s;
  syncToggle();
  if (s === 'full') sheetEl.scrollTop = 0;
  measure();
}
function drawSheet(p) {
  const st = sheetEl.scrollTop;
  sheetEl.innerHTML = sheetHTML(p);
  sheetEl.scrollTop = st;
  syncToggle();
}
function select(id, o) {
  o = o || {};
  const p = byId[id];
  if (!p) return;
  state.sel = id; editing = false;
  sheetEl.dataset.state = 'peek';
  drawSheet(p);
  sheetEl.hidden = false;
  setSheetState('peek');
  clusterDirty = true; scheduleRender();
  if (o.fly !== false) animateTo(viewAt(p.mx, p.my, Math.max(view.z, 15.5)));
}
function deselect() {
  state.sel = null; editing = false;
  sheetEl.hidden = true; app.dataset.sheet = '';
  measure();
  clusterDirty = true; scheduleRender();
}
const toggleSheet = () => setSheetState(sheetEl.dataset.state === 'full' ? 'peek' : 'full');

sheetEl.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.getAttribute('data-act'), p = byId[state.sel];
  if (!p) return;
  if (act === 'close') deselect();
  else if (act === 'toggle') toggleSheet();
  else if (act === 'copy') {
    const label = b.querySelector('span'), txt = b.getAttribute('data-copy');
    const done = t => { label.textContent = t; setTimeout(() => { label.textContent = 'Copiază'; }, 1600); };
    const pick = () => { const r = document.createRange(); r.selectNodeContents(b.parentNode.parentNode.querySelector('.tel-n')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); done('Selectat'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(() => done('Copiat'), pick); else pick();
  }
  else if (act === 'rate') { RT[p.id] = +b.getAttribute('data-n'); store.set('rt', RT); drawSheet(p); }
  else if (act === 'unrate') { delete RT[p.id]; store.set('rt', RT); drawSheet(p); }
  else if (act === 'edit-sv') { editing = true; drawSheet(p); }
  else if (act === 'cancel-sv') { editing = false; drawSheet(p); }
  else if (act === 'sv-toggle') b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
  else if (act === 'save-sv') {
    SV[p.id] = $$('[data-act="sv-toggle"][aria-pressed="true"]', sheetEl).map(x => x.getAttribute('data-sv'));
    store.set('sv', SV);
    p._h = undefined;
    editing = false; drawSheet(p); refresh();
  }
});
let gy = null;
sheetEl.addEventListener('dragstart', e => e.preventDefault());
sheetEl.addEventListener('pointerdown', e => {
  gy = e.target.closest('.grab') ? e.clientY : null;
  if (gy !== null) { try { sheetEl.setPointerCapture(e.pointerId); } catch (x) {} }   /* ca și mouse-ul să primească „ridicat” în afara fișei */
});
sheetEl.addEventListener('pointercancel', () => { gy = null; });
sheetEl.addEventListener('pointerup', e => {
  if (gy === null) return;
  const dy = e.clientY - gy; gy = null;
  if (Math.abs(dy) < 8) toggleSheet();
  else if (dy < 0) setSheetState('full');
  else if (sheetEl.dataset.state === 'full') setSheetState('peek');
  else deselect();
});
sheetEl.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('grab')) { e.preventDefault(); toggleSheet(); }
});

/* ---------- listă, filtre, căutare ---------- */
function rowHTML(p) {
  const st = statusOf(p), T = TYPES[p.t], mine = RT[p.id] || 0;
  const sub = T.label + (p.a || p.z ? ' · ' + (p.a || p.z) : '');
  return '<button class="l-row" data-id="' + esc(p.id) + '"><span class="l-ic" style="--c:' + tv(p.t) + ';--g:' + tg(p.t) + '">' + ic(p.t) + '</span>' +
    '<span class="l-main"><b>' + esc(p.n || (T.label + ' fără nume')) + '</b><span>' + esc(sub) + '</span>' +
    (st ? '<span><span class="' + (st.open ? 'ok' : 'no') + '">' + (st.open ? 'Deschis' : 'Închis') + '</span>' + (st.text ? ' · ' + st.text : '') + '</span>' : '<span>Program necunoscut</span>') + '</span>' +
    '<span class="l-r">' + (mine ? mine + ic('star', 's') + ' ' : '') + fmtDist(p._d) + '</span></button>';
}
function renderList() {
  const ref = me || centerLL();
  const arr = PLACES.filter(p => passes(p));
  arr.forEach(p => { p._d = distM(ref, p); });
  arr.sort((a, b) => a._d - b._d);
  listHead.textContent = plural(arr.length, 'loc', 'locuri') + ' · ' + (me ? 'cele mai apropiate de tine' : 'cele mai apropiate de centrul hărții');
  const part = arr.slice(0, listLimit);
  listBody.innerHTML = part.map(rowHTML).join('') +
    (arr.length > part.length ? '<button class="l-more" data-act="more">Arată încă ' + Math.min(120, arr.length - part.length) + '</button>' : '');
}
listBody.addEventListener('click', e => {
  if (e.target.closest('[data-act="more"]')) { listLimit += 120; renderList(); return; }
  const r = e.target.closest('.l-row');
  if (!r) return;
  setMode('map'); select(r.getAttribute('data-id'));
});
function setMode(m) {
  state.view = m; app.dataset.view = m; listEl.hidden = (m !== 'list');
  modeBtn.setAttribute('aria-label', m === 'list' ? 'Arată harta' : 'Arată lista');
  modeBtn.innerHTML = ic(m === 'list' ? 'map' : 'list');
  if (m === 'list') { listLimit = 120; renderList(); listEl.scrollTop = 0; }
  measure();
  scheduleRender();
}
modeBtn.addEventListener('click', () => setMode(state.view === 'list' ? 'map' : 'list'));

function updateChips() {
  const cnt = { service: 0, benz: 0, vulc: 0, spal: 0, piese: 0 };
  PLACES.forEach(p => { if (passes(p, true)) cnt[p.t]++; });
  $$('.chip[data-type]').forEach(c => {
    const t = c.getAttribute('data-type');
    c.querySelector('b').textContent = PLACES.length ? cnt[t] : '';
    c.setAttribute('aria-pressed', state.types.has(t) ? 'true' : 'false');
  });
  $('.chip[data-open]').setAttribute('aria-pressed', state.open ? 'true' : 'false');
}
function showMsg(kind, extra) {
  if (!kind) { msgEl.hidden = true; msgEl.removeAttribute('data-kind'); return; }
  if (msgEl.getAttribute('data-kind') === kind && kind !== 'error') { msgEl.hidden = false; return; }
  msgEl.setAttribute('data-kind', kind);
  if (kind === 'loading') msgEl.innerHTML = '<div class="spin" aria-hidden="true"></div><b>Se încarcă locurile</b><span>Iau service-uri, benzinării, vulcanizări și spălătorii din OpenStreetMap. La prima deschidere poate dura câteva secunde.</span>';
  else if (kind === 'error') msgEl.innerHTML = '<b>Nu pot încărca locurile</b><span>' + esc(extra || 'Verifică internetul și încearcă din nou.') + '</span><button class="btn primary sm" data-act="retry">Încearcă din nou</button>';
  else msgEl.innerHTML = '<b>Niciun loc găsit</b><span>Încearcă alt nume sau scoate un filtru.</span><button class="btn primary sm" data-act="reset">Șterge filtrele</button>';
  msgEl.hidden = false;
}
function updateMsg() {
  if (!PLACES.length) {
    if (loadState === 'error') showMsg('error', loadError);
    else showMsg('loading');
    return;
  }
  showMsg(PLACES.some(p => passes(p)) ? null : 'none');
}
function refresh() {
  updateChips();
  clusterDirty = true; scheduleRender();
  if (!listEl.hidden) renderList();
  if (state.sel && (!byId[state.sel] || !passes(byId[state.sel]))) deselect();
  updateMsg();
}
function fitResults() {
  const arr = PLACES.filter(p => passes(p));
  if (!arr.length || state.view !== 'map') return;
  const b = mercBounds(arr);
  animateTo(viewFit(b, 70, 16));
}
function resetFilters() {
  state.q = ''; state.types.clear(); state.open = false; qEl.value = ''; qx.hidden = true; refresh();
}
chipsEl.addEventListener('click', e => {
  const c = e.target.closest('.chip');
  if (!c) return;
  if (c.hasAttribute('data-open')) state.open = !state.open;
  else { const t = c.getAttribute('data-type'); if (state.types.has(t)) state.types.delete(t); else state.types.add(t); }
  refresh();
});
let qT = 0;
qEl.addEventListener('input', () => {
  qx.hidden = !qEl.value;
  clearTimeout(qT);
  qT = setTimeout(() => { state.q = norm(qEl.value.trim()); refresh(); if (state.q) fitResults(); }, 220);
});
qEl.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  clearTimeout(qT); state.q = norm(qEl.value.trim()); refresh(); if (state.q) fitResults(); qEl.blur();
});
qEl.addEventListener('focus', () => qEl.parentNode.classList.add('foc'));
qEl.addEventListener('blur', () => qEl.parentNode.classList.remove('foc'));
qx.addEventListener('click', () => { qEl.value = ''; qx.hidden = true; state.q = ''; refresh(); qEl.focus(); });
msgEl.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.getAttribute('data-act') === 'reset') resetFilters();
  else if (b.getAttribute('data-act') === 'retry') loadData(true);
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!aboutEl.hidden) closeAbout();
  else if (editing && state.sel) { editing = false; drawSheet(byId[state.sel]); }
  else if (state.sel) deselect();
});

/* ---------- datele: încărcare, păstrare, actualizare ---------- */
function ingest() {
  const all = [], seen = new Set();
  ['b', 'i'].forEach(z => {
    if (zoneData[z]) for (let i = 0; i < zoneData[z].length; i++) {
      const p = zoneData[z][i];
      if (!seen.has(p.id)) { seen.add(p.id); all.push(p); }   /* același loc nu apare de două ori */
    }
  });
  PLACES = all; byId = {};
  gPin.textContent = ''; gCl.textContent = ''; shown.clear(); clEls.clear(); clByKey.clear();
  all.forEach(p => {
    p.mx = mxOf(p.lon); p.my = myOf(p.lat);
    p.wk = HRS.parse(p.h);
    p.el = null; p._h = undefined;
    byId[p.id] = p;
  });
  clusterDirty = true;
  refresh();
}
let loadJob = null;
function loadData(force) {
  if (loadJob) return loadJob;
  const done = () => { loadJob = null; };
  loadJob = doLoad(force).then(r => { done(); return r; }, err => { done(); throw err; });
  return loadJob;
}
/* fișierul cu locurile de pe site; null dacă nu e, nu merge sau nu arată cum trebuie */
async function fetchSnapshot() {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 20000) : 0;
  try {
    const r = await fetch(SNAP_URL, { cache: 'no-cache', signal: ctrl ? ctrl.signal : undefined });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j || j.v !== 1 || typeof j.ts !== 'number' || !j.zones) return null;
    const zones = {};
    ['b', 'i'].forEach(z => {
      if (!Array.isArray(j.zones[z])) return;
      const list = j.zones[z].map(cleanPlace).filter(Boolean);
      if (list.length) zones[z] = list;
    });
    return (zones.b || zones.i) ? { ts: j.ts, zones } : null;
  } catch (e) { return null; }
  finally { if (timer) clearTimeout(timer); }
}
async function doLoad(force) {
  loadState = 'loading'; loadError = '';
  if (!PLACES.length) updateMsg();
  /* dacă ține mai mult decât de obicei, spune de ce */
  clearTimeout(slowT);
  slowT = setTimeout(() => {
    const s = !PLACES.length && loadState === 'loading' && msgEl.getAttribute('data-kind') === 'loading' && msgEl.querySelector('span');
    if (s) s.textContent = 'Durează mai mult decât de obicei: serverele OpenStreetMap sunt aglomerate acum. Mai aștept…';
  }, 9000);
  try { return await runLoad(force); }
  finally { clearTimeout(slowT); }
}
async function runLoad(force) {
  if (!force) {
    for (const z of ['b', 'i']) {
      const rec = await idb.get('zone-' + z);
      if (rec && rec.v === DATA_V && Array.isArray(rec.places)) { zoneData[z] = rec.places; zoneTs[z] = rec.ts; }
    }
    if (zoneData.b || zoneData.i) { loadState = 'ready'; ingest(); }
  }
  if (navigator.onLine === false && PLACES.length) { if (force) toast('Nu ai internet. Folosesc locurile salvate.'); return 0; }

  /* 1) fișierul cu locurile, de pe site: se ia când ce avem lipsește sau are peste o zi */
  const stale = z => !zoneData[z] || Date.now() - zoneTs[z] > SNAP_AGE;
  let snap = null, fresh = 0;
  if (force || stale('b') || stale('i')) {
    snap = await fetchSnapshot();
    if (snap) {
      ['b', 'i'].forEach(z => {
        if (!snap.zones[z] || (zoneData[z] && snap.ts <= zoneTs[z])) return;
        zoneData[z] = snap.zones[z]; zoneTs[z] = snap.ts; fresh++;
        idb.set('zone-' + z, { v: DATA_V, ts: snap.ts, places: snap.zones[z].map(serializable) });
      });
      if (fresh) { loadState = 'ready'; ingest(); }
    }
  }

  /* 2) Overpass doar pentru ce lipsește sau e foarte vechi (sau dacă ai cerut tu și nu avem fișierul) */
  const now = Date.now();
  let jobs = ['b', 'i'].filter(z => !zoneData[z] || now - zoneTs[z] > MAX_AGE);
  if (force && !snap) jobs = ['b', 'i'];
  if (jobs.length && !force && PLACES.length && now - store.get('la', 0) < RETRY_GAP) jobs = [];   /* nu bat serverele la fiecare pornire */
  if (!jobs.length) {
    loadState = 'ready'; updateMsg();
    if (force) toast(fresh ? 'Locurile au fost actualizate.' : 'Ai deja cele mai noi locuri.');
    return 0;
  }
  store.set('la', now);
  const fails = [];
  await Promise.all(jobs.map(async z => {
    try {
      const places = await OSM.load(z);
      zoneData[z] = places; zoneTs[z] = Date.now();
      idb.set('zone-' + z, { v: DATA_V, ts: zoneTs[z], places: places.map(serializable) });
      loadState = 'ready';
      ingest();
    } catch (e) { fails.push(z); }
  }));
  const missing = fails.filter(z => !zoneData[z]);
  if (!PLACES.length) {
    loadState = 'error'; loadError = 'Serverele OpenStreetMap nu răspund acum. Încearcă din nou peste puțin.'; updateMsg();
  } else {
    loadState = 'ready';
    if (missing.length) toast('Nu am putut încărca încă ' + missing.map(z => OSM.ZONES[z].name).join(' și ') + '. Mai încerc data viitoare.', 4800);
    else if (fails.length) { if (force) toast('Nu am putut actualiza tot. Folosesc locurile salvate.', 4200); }
    else if (force) toast('Locurile au fost actualizate.');
  }
  return fails.length;
}

/* ---------- despre aplicație, instalare ---------- */
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; });
window.addEventListener('appinstalled', () => { installEvt = null; });
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function openAbout() {
  const ts = Math.min.apply(null, ['b', 'i'].filter(z => zoneTs[z]).map(z => zoneTs[z]).concat([Infinity]));
  const when = isFinite(ts) ? new Date(ts).toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' }) : 'încă nu s-au descărcat';
  const mineN = Object.keys(RT).length + Object.keys(SV).length;
  let inst;
  if (isStandalone()) inst = '<p>Aplicația e instalată pe acest telefon.</p>';
  else if (installEvt) inst = '<p>Pune aplicația pe ecranul telefonului, ca pe oricare alta.</p><div class="row-btns"><button class="btn primary sm" data-act="install">' + ic('install') + 'Instalează aplicația</button></div>';
  else if (isIOS()) inst = '<p>Pe iPhone: atinge <b>Distribuie</b> în Safari, apoi <b>Adaugă pe ecranul principal</b>.</p>';
  else inst = '<p>Pe Android: din meniul browserului alege <b>Instalează aplicația</b> sau <b>Adaugă pe ecranul principal</b>.</p>';
  aboutCard.innerHTML =
    '<div class="modal-head"><h2 id="aboutT">Harta Auto București–Ilfov</h2><button class="icon-btn" data-act="about-close" aria-label="Închide">' + ic('x') + '</button></div>' +
    '<section class="sec"><p>Service-uri, benzinării, vulcanizări, spălătorii și magazine de piese din București și Ilfov, cu program, telefon și ce servicii oferă.</p></section>' +
    '<section class="sec"><h3>Date</h3>' +
      '<div class="kv"><span>Locuri</span><b>' + PLACES.length + '</b></div>' +
      '<div class="kv"><span>Date din OpenStreetMap de la</span><b>' + esc(when) + '</b></div>' +
      '<div class="row-btns"><button class="btn ghost sm" data-act="refresh-data">' + ic('refresh') + 'Actualizează acum</button></div></section>' +
    '<section class="sec"><h3>Instalează</h3>' + inst + '</section>' +
    '<section class="sec"><h3>Sursa datelor</h3><p>Harta și locurile vin din <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>, © contribuitorii OpenStreetMap, sub licența ODbL. Datele sunt făcute de oameni și pot fi incomplete. Dacă lipsește un loc sau un program, îl poți adăuga pe <a href="https://www.openstreetmap.org" target="_blank" rel="noopener">openstreetmap.org</a>, iar aplicația îl ia la următoarea actualizare.</p></section>' +
    '<section class="sec"><h3>Pe acest telefon</h3><p>Notele și serviciile completate de tine se păstrează doar aici (' + mineN + ' salvate).</p>' +
      (mineN ? '<div class="row-btns"><button class="btn ghost sm" data-act="reset-mine">Șterge notele și completările mele</button></div>' : '') + '</section>';
  aboutEl.hidden = false;
  const cb = aboutCard.querySelector('[data-act="about-close"]');
  if (cb) cb.focus();
}
function closeAbout() { aboutEl.hidden = true; }
$('#aboutBtn').addEventListener('click', openAbout);
aboutEl.addEventListener('click', async e => {
  if (e.target === aboutEl) { closeAbout(); return; }
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.getAttribute('data-act');
  if (act === 'about-close') closeAbout();
  else if (act === 'install' && installEvt) {
    installEvt.prompt();
    try { await installEvt.userChoice; } catch (x) {}
    installEvt = null; closeAbout();
  } else if (act === 'refresh-data') {
    closeAbout();
    toast('Descarc locurile din OpenStreetMap…', 6000);
    loadData(true);
  } else if (act === 'reset-mine') {
    if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Sigur? Apasă încă o dată'; return; }
    Object.keys(RT).forEach(k => delete RT[k]); Object.keys(SV).forEach(k => delete SV[k]);
    store.set('rt', RT); store.set('sv', SV);
    PLACES.forEach(p => { p._h = undefined; });
    if (state.sel) drawSheet(byId[state.sel]);
    refresh(); closeAbout(); toast('Am șters notele și completările tale.');
  }
});

/* ---------- pornire ---------- */
function start() {
  measure();
  fitHome();
  try {   /* scurtături: ?t=benz  sau  ?t=vulc,service&open=1 */
    const q = new URLSearchParams(location.search);
    (q.get('t') || '').split(',').forEach(t => { if (TYPES[t]) state.types.add(t); });
    if (q.get('open') === '1') state.open = true;
  } catch (e) {}
  if (navigator.onLine === false) showNet(true);
  if (location.protocol === 'file:') toast('Ai deschis fișierul direct: așa nu se vede harta OpenStreetMap. Pune aplicația pe un site (vezi README).', 9000);
  updateChips();
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(onResize).observe(mapEl);
    new ResizeObserver(onResize).observe(topEl);
    new ResizeObserver(measure).observe(sheetEl);   /* foaia de jos nu schimbă vederea de pornire */
  } else window.addEventListener('resize', onResize);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(onResize);
  window.addEventListener('online', () => { netErr = 0; tiles.forEach(t => { if (t.st === 2) t.at = 0; }); showNet(false); scheduleRender(); if (!PLACES.length || loadState === 'error') loadData(false); });
  window.addEventListener('offline', () => showNet(true));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { NOW = bucharestNow(); scheduleRender(); } });
  setInterval(() => { NOW = bucharestNow(); if (state.open) refresh(); }, 60000);
  scheduleRender();
  loadData(false);
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }
  if (DEBUG) {
    window.HA = { view, state, toScreen, mxOf, myOf, Sz, get places() { return PLACES; }, get clusters() { return clusters; }, select, deselect, animateTo, viewAt, setView, tiles, locate, loadData, get me() { return me; }, render };
  }
}
start();
})();
