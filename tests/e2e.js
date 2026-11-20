/* Teste în browser (Chromium): pornesc aplicația pe un server local și o încerc ca un om,
   cu plăci de hartă desenate pe loc și un Overpass simulat. Nu iese pe internet.
   Rulare: node tests/e2e.js   (are nevoie de pachetul „playwright”) */
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const L = require('./lib');
const F = require('./fixtures');
const OSM = require('../js/osm.js');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = process.env.SHOTS || path.join(ROOT, '..', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const FRI_10 = new Date('2026-11-20T10:00:00+02:00');   // vineri, 10:00 în București
const SAT_16 = new Date('2026-11-21T16:00:00+02:00');

let pass = 0, fail = 0;
const failed = [];
function ok(c, msg) {
  if (c) { pass++; console.log('  ✓ ' + msg); } else { fail++; failed.push(msg); console.log('  ✗ ' + msg); }
}
const eq = (a, b, msg) => { const same = JSON.stringify(a) === JSON.stringify(b); ok(same, msg + (same ? '' : '  → am primit ' + JSON.stringify(a) + ', așteptam ' + JSON.stringify(b))); };
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, msg + '  (' + (typeof a === 'number' ? a.toFixed(2) : a) + ' față de ' + (typeof b === 'number' ? b.toFixed(2) : b) + ')');
async function T(name, fn) {
  if (process.env.ONLY && !new RegExp(process.env.ONLY, 'i').test(name)) return;   // ONLY="Overpass|fișier" node tests/e2e.js → doar testele cu aceste cuvinte
  console.log('\n● ' + name);
  const t0 = Date.now();
  try { await fn(); } catch (e) { fail++; failed.push(name + ': ' + e.message); console.log('  ✗ EROARE: ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n    ')); }
  console.log('  (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
}

const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ro-RO', timezoneId: 'Europe/Bucharest' };
const DESKTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, locale: 'ro-RO', timezoneId: 'Europe/Bucharest' };

let browser, base;
const state0 = extra => L.newState(Object.assign({ elements: { b: F.knownB(), i: F.knownI() } }, extra));
/* fișierul data/places.json, făcut din aceleași locuri de probă */
const strip = p => ({ id: p.id, t: p.t, n: p.n, z: p.z, a: p.a, lat: p.lat, lon: p.lon, h: p.h, tel: p.tel, w: p.w, sv: p.sv, b: p.b });
const NEW_B = [{ type: 'node', id: 7001, lat: 44.43, lon: 26.12, tags: { amenity: 'fuel', name: 'Benzinărie nouă', opening_hours: '24/7' } }];
const snapshotOf = (ts, withNew) => ({
  v: 1, ts, osm: new Date(ts).toISOString(),
  zones: { b: OSM.normalize(F.knownB().concat(withNew ? NEW_B : []), 'b').map(strip), i: OSM.normalize(F.knownI(), 'i').map(strip) }
});
const HOUR = 36e5;
const SW_VER = /VERSION = '(v\d+)'/.exec(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'))[1];

async function session(S, o) {
  o = o || {};
  const ctx = await browser.newContext(Object.assign({ serviceWorkers: 'block' }, o.device || PHONE, o.ctx || {}));
  await L.installMocks(ctx, S);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !(o.allowErrors && o.allowErrors.test(m.text()))) errors.push('console: ' + m.text()); });
  if (o.time !== null) await page.clock.setFixedTime(o.time || FRI_10);
  await page.goto(base + (o.path === undefined ? '?debug' : o.path));
  if (o.wait !== false) await page.waitForFunction(() => window.HA && window.HA.places.length > 0, null, { timeout: 20000 });
  return { ctx, page, errors };
}
const raf2 = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const pxAt = (page, x, y) => page.evaluate(([x, y]) => {
  const c = document.getElementById('tiles'), d = window.devicePixelRatio, g = c.getContext('2d');
  const p = g.getImageData(Math.min(c.width - 1, Math.round(x * d)), Math.min(c.height - 1, Math.round(y * d)), 1, 1).data;
  return [p[0], p[1], p[2]];
}, [x, y]);
const close = (a, b, tol) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;
const idleTiles = (page, ms) => page.waitForFunction(() => { let p = 0; window.HA.tiles.forEach(t => { if (t.st === 0) p++; }); return p === 0; }, null, { timeout: ms || 8000 });
const settle = async (page, ms) => { await page.waitForTimeout(ms || 450); await idleTiles(page); await raf2(page); };
const placeBy = (page, name) => page.evaluate(n => { const p = HA.places.find(x => x.n === n); return p ? { id: p.id, mx: p.mx, my: p.my, lat: p.lat, lon: p.lon } : null; }, name);
const mercX = lon => (lon + 180) / 360;
const mercY = lat => { const s = Math.sin(lat * Math.PI / 180); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); };
const countText = (page, t) => page.locator('.chip[data-type="' + t + '"] b').textContent();
const chipCounts = async page => { const o = {}; for (const t of ['service', 'benz', 'vulc', 'spal', 'piese']) o[t] = +(await countText(page, t)); return o; };
const sum = o => Object.values(o).reduce((a, b) => a + b, 0);

(async () => {
  const { srv, base: b } = await L.serve(ROOT);
  base = b;
  browser = await chromium.launch();

  /* ---------------------------------------------------------------- */
  await T('Pornire proaspătă pe telefon', async () => {
    const S = state0({ tileStyle: 'debug', overpass: async ({ zone }) => ({ delay: 700, json: { version: 0.6, elements: S.elements[zone] } }) });
    const { ctx, page, errors } = await session(S, { wait: false });
    await page.waitForSelector('#msg:not([hidden])', { timeout: 4000 });
    ok(/Se încarcă locurile/.test(await page.locator('#msg').innerText()), 'cât se descarcă, apare „Se încarcă locurile”');
    await page.waitForFunction(() => window.HA && window.HA.places.length > 0, null, { timeout: 15000 });
    await page.waitForSelector('#msg', { state: 'hidden' });
    ok(true, 'mesajul dispare după încărcare');
    eq(await page.evaluate(() => HA.places.length), 24, '24 de locuri după curățare (ignoră ce nu e auto și duplicatele)');
    const cc = await chipCounts(page);
    eq(sum(cc), 24, 'numerele de pe butoane însumează 24: ' + JSON.stringify(cc));
    eq(cc, { service: 6, benz: 7, vulc: 4, spal: 4, piese: 3 }, 'numere pe categorii');
    await settle(page, 700);
    const mid = await pxAt(page, 195, 400);
    ok(!close(mid, [242, 239, 233], 6), 'harta are plăci desenate (nu doar fundalul): ' + mid);
    ok(S.tileLog.length > 3 && S.tileLog.length < 60, 'cerere rezonabilă de plăci la pornire: ' + S.tileLog.length);
    ok(S.tileLog.every(t => t.z >= 9 && t.z <= 19 && t.x >= 0 && t.y >= 0 && t.x < 2 ** t.z && t.y < 2 ** t.z), 'toate plăcile cerute au coordonate valide');
    ok(S.tileLog.some(t => t.origin), 'plăcile se cer în mod CORS (se pot păstra pentru offline)');
    eq(S.overpassLog.filter(r => r.strict).length, 2, 'o interogare Overpass pentru București și una pentru Ilfov');
    eq(S.unexpected, [], 'nicio cerere în afara OpenStreetMap');
    eq(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'fără derulare orizontală');
    eq(errors, [], 'fără erori în consolă');
    await ctx.close();
  });

  /* ---------------------------------------------------------------- */
  await T('Pinii stau exact pe harta OpenStreetMap (zoom întreg și fracționar, ecran 1× și 2×)', async () => {
    for (const dpr of [1, 2]) {
      const z0 = 16, n = 2 ** z0;
      const tx = Math.floor(mercX(26.1025) * n), ty = Math.floor(mercY(44.4268) * n);
      const cLon = (tx + 0.5) / n * 360 - 180, cLat = 180 / Math.PI * Math.atan(Math.sinh(Math.PI * (1 - 2 * (ty + 0.5) / n)));
      const els = F.knownB().concat([{ type: 'node', id: 9999, lat: cLat, lon: cLon, tags: { amenity: 'fuel', name: 'Reper' } }]);
      const S = state0({ tileStyle: 'debug', elements: { b: els, i: F.knownI() } });
      const { ctx, page, errors } = await session(S, { ctx: { deviceScaleFactor: dpr } });
      const [W, H] = await page.evaluate(() => [innerWidth, innerHeight]);
      for (const z of [16, 16.4, 15.6, 15.5]) {
        await page.evaluate(([x, y, z]) => HA.setView({ cx: x, cy: y, z }, true), [(tx + 0.5) / n, (ty + 0.5) / n, z]);
        await page.waitForFunction(k => { const t = HA.tiles.get(k); return t && t.st === 1; }, z0 + '/' + tx + '/' + ty, { timeout: 8000 });
        await settle(page, 500);
        const ts = 256 * 2 ** (z - z0);
        const scr = await page.evaluate(() => { const p = HA.places.find(x => x.n === 'Reper'); return HA.toScreen(p.mx, p.my); });
        near(scr[0], W / 2, 0.5, dpr + '× z' + z + ': pinul e la mijloc, pe orizontală');
        near(scr[1], H / 2, 0.5, dpr + '× z' + z + ': pinul e la mijloc, pe verticală');
        ok(close(await pxAt(page, scr[0], scr[1]), L.CROSS, 4), dpr + '× z' + z + ': vârful pinului e pe crucea din centrul plăcii');
        ok(close(await pxAt(page, scr[0] + 30, scr[1] + 30), L.tileBase(z0, tx, ty), 3), dpr + '× z' + z + ': în jur e placa potrivită (x=' + tx + ', y=' + ty + ')');
        ok(close(await pxAt(page, scr[0] + ts / 2 + 8, scr[1] + 30), L.tileBase(z0, tx + 1, ty), 3), dpr + '× z' + z + ': placa din dreapta e x+1');
        ok(close(await pxAt(page, scr[0] - ts / 2 - 8, scr[1] + 30), L.tileBase(z0, tx - 1, ty), 3), dpr + '× z' + z + ': placa din stânga e x−1');
        ok(close(await pxAt(page, scr[0] + 30, scr[1] + ts / 2 + 8), L.tileBase(z0, tx, ty + 1), 3), dpr + '× z' + z + ': placa de jos e y+1 (nord sus)');
      }
      /* pinul rămâne pe cruce și când harta e mutată */
      await page.evaluate(([x, y, z]) => HA.setView({ cx: x + 70 / (256 * 2 ** z), cy: y - 130 / (256 * 2 ** z), z }, true), [(tx + 0.5) / n, (ty + 0.5) / n, 16]);
      await settle(page, 500);
      const scr = await page.evaluate(() => { const p = HA.places.find(x => x.n === 'Reper'); return HA.toScreen(p.mx, p.my); });
      near(scr[0], W / 2 - 70, 0.5, dpr + '×: după mutare, pinul s-a mutat la fel');
      ok(close(await pxAt(page, scr[0], scr[1]), L.CROSS, 4), dpr + '×: și tot pe cruce');
      const dom = await page.locator('g.pin[data-id="n9999"]').getAttribute('transform');
      ok(/translate\(/.test(dom || ''), dpr + '×: pinul există în ecran (' + dom + ')');
      eq(errors, [], dpr + '×: fără erori în consolă');
      await ctx.close();
    }
  });

  /* ---------------------------------------------------------------- */
  await T('Pin → fișa locului (atingere pe telefon)', async () => {
    const S = state0();
    const { ctx, page, errors } = await session(S);
    const p = await placeBy(page, 'Petrom Unirii');
    await page.evaluate(([x, y]) => HA.setView({ cx: x, cy: y, z: 15.6 }, true), [p.mx, p.my]);
    await raf2(page);
    const box = await page.locator('g.pin[data-id="' + p.id + '"]').boundingBox();
    ok(!!box, 'pinul „Petrom Unirii” se vede pe hartă');
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2 - 4);
    await page.waitForSelector('#sheet:not([hidden])');
    eq(await page.locator('.s-name').textContent(), 'Petrom Unirii', 'fișa arată numele');
    ok(/Benzinărie/.test(await page.locator('.s-type').textContent()), 'și categoria');
    ok(/Bulevardul Unirii 10/.test(await page.locator('.s-meta').textContent()), 'și adresa din OSM');
    ok(/Deschis/.test(await page.locator('.s-status').textContent()) && /non-stop/.test(await page.locator('.s-status').textContent()), 'e deschis non-stop vineri la 10:00');
    eq(await page.locator('#sheet').getAttribute('data-state'), 'peek', 'fișa pornește pe jumătate');
    eq(await page.locator('.s-body').isVisible(), false, 'detaliile sunt ascunse până o deschizi');
    await page.waitForTimeout(900);
    const [W, H, peekH, topH] = await page.evaluate(() => [innerWidth, innerHeight, document.getElementById('sheet').offsetHeight, document.getElementById('top').offsetHeight]);
    const scr = await page.evaluate(id => { const q = HA.places.find(x => x.id === id); return HA.toScreen(q.mx, q.my); }, p.id);
    near(scr[0], W / 2, 1.5, 'harta a pus pinul la mijloc, pe orizontală');
    near(scr[1], topH + (H - peekH - topH) / 2, 3, 'și la mijlocul zonei libere de deasupra fișei');
    await page.locator('[data-act="toggle"]').click();
    eq(await page.locator('#sheet').getAttribute('data-state'), 'full', '„Detalii” desface fișa');
    const hrs = await page.locator('.hours').textContent();
    ok(/Non-stop/.test(hrs), 'programul: ' + hrs.trim());
    const sv = await page.locator('.sv-chip').allTextContents();
    eq(sv.sort(), ['Benzină 95', 'GPL', 'Motorină', 'Non-stop', 'Toaletă'].sort(), 'serviciile citite din etichetele OSM');
    eq(await page.locator('a.copy.call').getAttribute('href'), 'tel:+40211234567', 'butonul „Sună” are numărul bun');
    eq(await page.locator('.tel-n').textContent(), '021 123 4567', 'numărul e scris citeț');
    ok((await page.locator('.web').getAttribute('href')) === 'https://petrom.ro', 'site-ul primește https://');
    ok((await page.locator('.s-note a').first().getAttribute('href')) === 'https://www.openstreetmap.org/node/1001', 'legătură către locul din OpenStreetMap');
    ok(/edit\?node=1001/.test(await page.locator('.s-note a').nth(1).getAttribute('href')), 'și către corectare în OpenStreetMap');
    const nav = await page.locator('.navs a').evaluateAll(a => a.map(x => x.href));
    ok(nav.length === 3 && nav.every(h => /44\.426,26\.103/.test(h)), 'Google Maps, Waze, Apple Maps cu coordonatele locului');
    await page.locator('.s-close').click();
    await page.waitForSelector('#sheet', { state: 'hidden' });
    ok(true, 'X închide fișa');
    /* cod HTML în nume nu se execută */
    await page.evaluate(() => { const q = HA.places.find(x => /img src=x/.test(x.n)); HA.select(q.id, { fly: false }); });
    await page.waitForTimeout(300);
    eq(await page.evaluate(() => window.__xss), undefined, 'codul HTML din numele unui loc nu se execută');
    ok((await page.locator('.s-name').textContent()).indexOf('<img src=x') >= 0, 'numele apare ca text, cu semnele < și > vizibile');
    eq(errors, [], 'fără erori în consolă');
    await ctx.close();
  });

  /* ---------------------------------------------------------------- */
  await T('Căutare, categorii și „Deschise acum”', async () => {
    const S = state0();
    const { ctx, page, errors } = await session(S);
    await page.fill('#q', 'petrom');
    await page.waitForTimeout(500);
    eq(await chipCounts(page), { service: 0, benz: 1, vulc: 0, spal: 0, piese: 0 }, 'căutarea „petrom” găsește doar Petrom (nu Rompetrol)');
    await page.waitForTimeout(900);
    ok(await page.evaluate(() => HA.view.z >= 15), 'harta se apropie de rezultat (z=' + (await page.evaluate(() => HA.view.z.toFixed(1))) + ')');
    await page.fill('#q', 'ulei');
    await page.waitForTimeout(500);
    eq((await chipCounts(page)).service, 1, 'după serviciu: „ulei” găsește service-ul cu schimb de ulei');
    await page.fill('#q', 'MOTORINĂ');
    await page.waitForTimeout(500);
    eq((await chipCounts(page)).benz, 7, 'diacriticele și literele mari nu contează: „MOTORINĂ” arată toate benzinăriile');
    await page.fill('#q', 'zzzz');
    await page.waitForTimeout(500);
    ok(/Niciun loc găsit/.test(await page.locator('#msg').innerText()), 'fără rezultat: „Niciun loc găsit”');
    await page.locator('#msg [data-act="reset"]').click();
    await page.waitForSelector('#msg', { state: 'hidden' });
    eq(await page.inputValue('#q'), '', '„Șterge filtrele” golește căutarea');
    eq(sum(await chipCounts(page)), 24, 'și revin toate cele 24 de locuri');
    await page.locator('.chip[data-type="benz"]').click();
    await raf2(page);
    eq(await page.locator('.chip[data-type="benz"]').getAttribute('aria-pressed'), 'true', 'butonul Benzinărie se apasă');
    const shownTypes = await page.evaluate(() => { const t = new Set(); HA.clusters.forEach(c => c.items.forEach(p => t.add(p.t))); return Array.from(t); });
    eq(shownTypes, ['benz'], 'pe hartă rămân doar benzinăriile');
    await page.locator('.chip[data-type="benz"]').click();
    await page.locator('.chip[data-open]').click();
    eq(sum(await chipCounts(page)), 22, 'vineri 10:00 sunt 22 deschise (fără „Self Wash” și „MOL”, care n-au program citibil)');
    await page.evaluate(() => { const q = HA.places.find(x => x.n === 'Auto Rapid Service'); HA.select(q.id, { fly: false }); });
    ok(/Deschis\s*·\s*până la 18:00/.test(await page.locator('.s-status').innerText()), 'Auto Rapid: „Deschis · până la 18:00”');
    await page.evaluate(() => { const q = HA.places.find(x => x.n === 'Self Wash Floreasca'); HA.select(q.id, { fly: false }); });
    await page.locator('[data-act="toggle"]').click();
    ok(/Program necunoscut/.test(await page.locator('.s-status').innerText()), 'Self Wash: „Program necunoscut”');
    ok(/sunrise-sunset/.test(await page.locator('.raw').innerText()), 'și arată programul brut din OSM, pe care nu-l poate citi');
    eq(errors, [], 'fără erori în consolă');
    await ctx.close();

    const S2 = state0();
    const s2 = await session(S2, { time: SAT_16, path: '?debug&open=1' });
    eq(await s2.page.locator('.chip[data-open]').getAttribute('aria-pressed'), 'true', '?open=1 pornește cu „Deschise acum”');
    eq(sum(await chipCounts(s2.page)), 18, 'sâmbătă 16:00 sunt 18 deschise (Auto Rapid, Piese, Service și Pantelimon sunt închise)');
    await s2.page.evaluate(() => { const q = HA.places.find(x => x.n === 'Auto Rapid Service'); HA.select(q.id, { fly: false }); });
    ok(/Închis\s*·\s*se deschide luni la 08:00/.test(await s2.page.locator('.s-status').innerText()), 'Auto Rapid sâmbătă 16:00: „Închis · se deschide luni la 08:00”');
    eq(s2.errors, [], 'fără erori în consolă');
    await s2.ctx.close();

    const s3 = await session(state0(), { path: '?debug&t=benz' });
    eq(await s3.page.locator('.chip[data-type="benz"]').getAttribute('aria-pressed'), 'true', 'scurtătura ?t=benz pornește cu Benzinării');
    eq(await s3.page.evaluate(() => HA.clusters.reduce((a, c) => a + c.items.length, 0)), 7, 'și arată cele 7 benzinării');
    await s3.ctx.close();
  });

  /* ---------------------------------------------------------------- */
  await T('Evaluări și servicii completate de tine (rămân în telefon)', async () => {
    const S = state0();
    const { ctx, page, errors } = await session(S);
    await page.evaluate(() => { const q = HA.places.find(x => x.n === 'Auto Rapid Service'); HA.select(q.id, { fly: false }); });
    await page.locator('[data-act="toggle"]').click();
    ok(/Nicio evaluare încă/.test(await page.locator('.s-rate').innerText()), 'la început: „Nicio evaluare încă”');
    await page.locator('.rate-b[data-n="4"]').click();
    ok(/4,0/.test(await page.locator('.s-rate').innerText()) && /nota ta/.test(await page.locator('.s-rate').innerText()), 'steaua 4 → „4,0 nota ta”');
    eq(await page.locator('.rate-b.on').count(), 4, 'patru stele aprinse');
    eq(await page.evaluate(() => localStorage.getItem('ha:rt')), '{"w1002":4}', 'nota se salvează în telefon');
    await page.locator('[data-act="edit-sv"]').click();
    await page.locator('[data-sv="clima"]').click();
    await page.locator('[data-sv="parbriz"]').click();
    await page.locator('[data-sv="ulei"]').click();       // scoate „Schimb ulei”
    await page.locator('[data-act="save-sv"]').click();
    const sv = (await page.locator('.sv-chip').allTextContents()).sort();
    eq(sv, ['Climatizare', 'Diagnoză computerizată', 'Frâne', 'Parbrize'].sort(), 'serviciile rămân cum le-ai bifat');
    ok(/Modificat de tine/.test(await page.locator('#sheet').innerText()), 'apare „Modificat de tine, doar pe acest telefon”');
    await page.fill('#q', 'climatizare');
    await page.waitForTimeout(500);
    eq((await chipCounts(page)).service, 1, 'căutarea găsește serviciul adăugat de tine');
    await page.reload();
    await page.waitForFunction(() => window.HA && window.HA.places.length > 0);
    await page.evaluate(() => { const q = HA.places.find(x => x.n === 'Auto Rapid Service'); HA.select(q.id, { fly: false }); });
    ok(/4,0/.test(await page.locator('.s-rate').innerText()), 'după reîncărcare nota e tot acolo');
    await page.locator('[data-act="toggle"]').click();
    ok((await page.locator('.sv-chip').allTextContents()).indexOf('Climatizare') >= 0, 'și serviciile tot acolo');
    await page.locator('[data-act="unrate"]').click();
    ok(/Nicio evaluare încă/.test(await page.locator('.s-rate').innerText()), '„Șterge nota” o scoate');
    eq(errors, [], 'fără erori în consolă');
    await ctx.close();
  });

  /* ---------------------------------------------------------------- */
  await T('Lista de locuri (cele mai apropiate primele) și cum se alege un rând', async () => {
    const S = state0();
    const { ctx, page, errors } = await session(S);
    await page.locator('#mode').click();
    await page.waitForSelector('#list:not([hidden])');
    ok(/24 de locuri/.test(await page.locator('#listHead').innerText()), 'titlul: „24 de locuri”');
    const rows = await page.locator('.l-row').count();
    eq(rows, 24, '24 de rânduri');
    const order = await page.evaluate(() => Array.from(document.querySelectorAll('.l-row')).map(r => HA.places.find(p => p.id === r.dataset.id)._d));
    ok(order.every((d, i) => i === 0 || d >= order[i - 1]), 'sunt ordonate după distanța față de centrul hărții');
    const first = await page.evaluate(() => { const c = { lat: 180 / Math.PI * Math.atan(Math.sinh(Math.PI * (1 - 2 * HA.view.cy))), lon: HA.view.cx * 360 - 180 }; let best = null, bd = 1e12; HA.places.forEach(p => { const dy = (p.lat - c.lat) * 111200, dx = (p.lon - c.lon) * 111200 * Math.cos(c.lat * Math.PI / 180), d = Math.hypot(dx, dy); if (d < bd) { bd = d; best = p; } }); return best.id; });
    eq(await page.locator('.l-row').first().getAttribute('data-id'), first, 'primul rând e locul cel mai apropiat de centru');
    ok(/Deschis|Închis|Program necunoscut/.test(await page.locator('.l-row').first().innerText()), 'fiecare rând arată starea programului');
    await page.locator('.l-row[data-id="n1001"]').click();
    await page.waitForSelector('#sheet:not([hidden])');
    eq(await page.locator('#list').isVisible(), false, 'un rând duce înapoi pe hartă');
    eq(await page.locator('.s-name').textContent(), 'Petrom Unirii', 'cu fișa locului ales');
    eq(errors, [], 'fără erori în consolă');
    await ctx.close();
  });

  /* ---------------------------------------------------------------- */
  await T('Locația ta („Arată unde sunt”)', async () => {
    const geo = { latitude: 44.4268, longitude: 26.1025, accuracy: 25 };
    const S = state0();
    const { ctx, page, errors } = await session(S, { ctx: { geolocation: geo, permissions: ['geolocation'] } });
    await page.locator('#loc').click();
    await page.waitForFunction(() => HA.me && HA.view.z >= 14.4, null, { timeout: 5000 });
    await page.waitForTimeout(1000);
    ok(await page.locator('.me-dot').count() === 1, 'apare punctul albastru');
    ok((await page.locator('#loc').getAttribute('class') || '').indexOf('on') >= 0, 'butonul devine activ');
    const ctr = await page.evaluate(() => { const s = HA.toScreen(HA.me.mx, HA.me.my); return [s[0], s[1], innerWidth, innerHeight]; });
    near(ctr[0], ctr[2] / 2, 2, 'harta se mută pe tine');
    await page.locator('#mode').click();
    ok(/cele mai apropiate de tine/.test(await page.locator('#listHead').innerText()), 'lista se ordonează după tine');
    const firstId = await page.locator('.l-row').first().getAttribute('data-id');
    eq(firstId, 'n1001', 'primul e Petrom Unirii (la ~100 m): ' + (await page.locator('.l-row').first().locator('.l-r').innerText()));
    ok(/^\d+ m$/.test((await page.locator('.l-row').first().locator('.l-r').innerText()).trim()), 'distanța e în metri');
    eq(errors, [], 'fără erori în consolă');
    await ctx.close();

    const out = await session(state0(), { ctx: { geolocation: { latitude: 47.1585, longitude: 27.6014, accuracy: 30 }, permissions: ['geolocation'] } });
    await out.page.locator('#loc').click();
    await out.page.waitForSelector('#toast:not([hidden])');
    await out.page.waitForFunction(() => /afara zonei/.test(document.getElementById('toast').textContent), null, { timeout: 4000 });
    ok(true, 'în afara zonei (Iași): „Ești în afara zonei București–Ilfov”');
    await out.ctx.close();

    const den = await session(state0(), { ctx: { permissions: [] } });
    await den.page.evaluate(() => { navigator.geolocation.getCurrentPosition = (ok, err) => err({ code: 1 }); });
    await den.page.locator('#loc').click();
    await den.page.waitForFunction(() => /Nu ai dat acces/.test(document.getElementById('toast').textContent), null, { timeout: 4000 });
    ok(true, 'fără permisiune: „Nu ai dat acces la locație”');
    await den.ctx.close();
  });

  /* ---------------------------------------------------------------- */
  await T('Datele se păstrează în telefon și se reîmprospătează după 7 zile', async () => {
    const S = state0();
    const { ctx, page, errors } = await session(S);
    eq(S.overpassLog.length, 2, 'prima pornire: 2 cereri Overpass');
    await page.waitForTimeout(400);
    await page.reload();
    await page.waitForFunction(() => window.HA && window.HA.places.length > 0);
    await page.waitForTimeout(600);
    eq(S.overpassLog.length, 2, 'a doua pornire: nicio cerere nouă, locurile vin din telefon');
    eq(await page.evaluate(() => HA.places.length), 24, 'și sunt tot cele 24');
    /* trec 8 zile, iar serverele nu răspund: rămân locurile salvate, fără mesaj de eroare */
    S.overpass = async () => ({ status: 504, json: {} });
    await page.clock.setFixedTime(new Date(FRI_10.getTime() + 8 * 864e5));
    await page.reload();
    await page.waitForFunction(() => window.HA && window.HA.places.length > 0);
    await page.waitForTimeout(1500);
    ok(S.overpassLog.length > 2, 'după 8 zile aplicația încearcă să reîmprospăteze (' + S.overpassLog.length + ' cereri)');
    eq(await page.evaluate(() => HA.places.length), 24, 'dar păstrează locurile salvate când serverele nu răspund');
    eq(await page.locator('#msg').isVisible(), false, 'fără mesaj de eroare');
    /* pierd conexiunea cât timp folosesc harta */
    await ctx.setOffline(true);
    await page.waitForSelector('#net:not([hidden])');
    ok(/Fără conexiune/.test(await page.locator('#net').innerText()), 'fără net apare „Fără conexiune · harta poate fi incompletă”');
    await page.evaluate(() => HA.setView({ cx: HA.view.cx + 0.01, cy: HA.view.cy, z: 15 }, true));
    await page.waitForTimeout(700);
    await page.locator('.chip[data-type="benz"]').click();
    ok(await page.evaluate(() => HA.clusters.length > 0), 'locurile și filtrele merg și fără net');
    await ctx.setOffline(false);
    await page.waitForSelector('#net', { state: 'hidden' });
    ok(true, 'când revine netul, mesajul dispare');
    eq(errors.filter(e => !/Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(e)), [], 'fără erori de cod în consolă');
    await ctx.close();
  });

  /* ---------------------------------------------------------------- */
  await T('Când Overpass nu răspunde: alt server, interogare pe dreptunghi, mesaj și „Încearcă din nou”', async () => {
    /* (a) toate serverele cad, apoi își revin */
    let down = true;
    const Sa = state0({ overpass: async () => down ? { status: 504, json: {} } : null });
    const a = await session(Sa, { wait: false, allowErrors: /Failed to load resource/ });
    await a.page.waitForSelector('#msg[data-kind="error"]', { timeout: 15000 });
    ok(/Nu pot încărca locurile/.test(await a.page.locator('#msg').innerText()), '(a) fără răspuns de la servere: „Nu pot încărca locurile”');
    ok(!Sa.overpassLog.some(r => !r.strict), '(a) când serverele nu răspund nu mai cere și dreptunghiul (ar dubla așteptarea)');
    const hosts = new Set(Sa.overpassLog.map(r => r.host));
    eq(hosts.size, 4, '(a) a încercat toate cele 4 servere');
    down = false;
    await a.page.locator('#msg [data-act="retry"]').click();
    await a.page.waitForFunction(() => HA.places.length > 0, null, { timeout: 15000 });
    await a.page.waitForSelector('#msg', { state: 'hidden' });
    ok(true, '(a) „Încearcă din nou” aduce locurile');
    await a.ctx.close();

    /* (b) primul server are limită (429): trece la al doilea */
    const Sb = state0({ overpass: async ({ host }) => host === 'overpass-api.de' ? { status: 429, json: {} } : null });
    const b = await session(Sb, { allowErrors: /Failed to load resource/ });
    const order = Sb.overpassLog.filter(r => r.zone === 'b' && r.strict).map(r => r.host);
    eq(order.slice(0, 2), ['overpass-api.de', 'overpass.openstreetmap.fr'], '(b) 429 la primul server → încearcă imediat al doilea');
    await b.page.waitForFunction(() => HA.places.length === 24, null, { timeout: 5000 });
    ok(true, '(b) și locurile vin (24)');
    await b.ctx.close();

    /* (c) zona nu se găsește după limite administrative: trece direct la dreptunghi */
    const Sc = state0({ overpass: async ({ strict }) => strict ? { json: { version: 0.6, elements: [] } } : null });
    const c = await session(Sc);
    eq(Sc.overpassLog.filter(r => r.strict).length, 2, '(c) o singură încercare după limite pe zonă (nu 3)');
    eq(Sc.overpassLog.filter(r => !r.strict).length, 2, '(c) apoi interogarea pe dreptunghi, pe fiecare zonă');
    await c.page.waitForFunction(() => HA.places.length === 24, null, { timeout: 5000 });
    ok(true, '(c) locurile vin (24)');
    await c.ctx.close();

    /* (d) doar Ilfov nu merge: București apare și te anunță */
    const Sd = state0({ overpass: async ({ zone }) => zone === 'i' ? { status: 504, json: {} } : null });
    const d = await session(Sd, { allowErrors: /Failed to load resource/ });
    await d.page.waitForFunction(() => /Ilfov/.test(document.getElementById('toast').textContent) || !document.getElementById('toast').hidden, null, { timeout: 15000 });
    ok(/Nu am putut încărca încă Ilfov/.test(await d.page.locator('#toast').innerText()), '(d) doar Ilfov lipsește: „Nu am putut încărca încă Ilfov”');
    eq(await d.page.evaluate(() => HA.places.length), 20, '(d) București apare (20 de locuri)');
    await d.ctx.close();
  });

  /* ---------------------------------------------------------------- */
  await T('Locurile vin dintr-un fișier de pe site, fără să depindă de Overpass', async () => {
    /* (a) prima pornire: totul vine din fișier, Overpass nici nu e întrebat */
    const S = state0({ snapshot: snapshotOf(FRI_10.getTime() - 5 * HOUR), overpass: async () => ({ status: 504, json: {} }) });
    const { ctx, page, errors } = await session(S, { allowErrors: /Failed to load resource/ });
    eq(await page.evaluate(() => HA.places.length), 24, '(a) cele 24 de locuri apar din fișier');
    eq(S.overpassLog.length, 0, '(a) nicio cerere către Overpass');
    eq(S.snapLog.length, 1, '(a) o singură cerere pentru fișier');
    ok(await page.locator('#msg').isHidden(), '(a) fără mesajul „Se încarcă” rămas pe ecran');
    /* (b) a doua pornire, în aceeași zi: locurile sunt deja în telefon */
    await page.waitForTimeout(300);
    await page.reload();
    await page.waitForFunction(() => window.HA && window.HA.places.length > 0);
    await page.waitForTimeout(500);
    eq(S.snapLog.length, 1, '(b) a doua pornire, în aceeași zi: fișierul nu se mai cere');
    eq(S.overpassLog.length, 0, '(b) nici Overpass');
    /* (c) a doua zi fișierul are un loc nou: aplicația îl ia */
    S.snapshot = snapshotOf(FRI_10.getTime() + 25 * HOUR, true);
    await page.clock.setFixedTime(new Date(FRI_10.getTime() + 30 * HOUR));
    await page.reload();
    await page.waitForFunction(() => HA.places.length === 25, null, { timeout: 8000 });
    ok(true, '(c) a doua zi, cu fișier nou: apare și locul nou (25)');
    eq(S.overpassLog.length, 0, '(c) tot fără Overpass');
    /* (d) peste o zi și jumătate fișierul nu mai e (404): rămân locurile din telefon, fără Overpass (au sub 7 zile) */
    S.snapshot = 404;
    await page.clock.setFixedTime(new Date(FRI_10.getTime() + 60 * HOUR));
    await page.reload();
    await page.waitForFunction(() => window.HA && window.HA.places.length > 0);
    await page.waitForTimeout(500);
    eq(await page.evaluate(() => HA.places.length), 25, '(d) fișierul lipsește, dar locurile salvate rămân');
    eq(S.overpassLog.length, 0, '(d) și fără Overpass');
    eq(errors.filter(e => !/Failed to load resource|404/.test(e)), [], 'fără erori de cod');
    await ctx.close();
  });

  /* ---------------------------------------------------------------- */
  await T('Fișier stricat sau vechi: se ia de la OpenStreetMap, fără greșeli', async () => {
    const good = snapshotOf(FRI_10.getTime() - HOUR);
    /* (a) altă versiune de fișier */
    const Sa = state0({ snapshot: Object.assign({}, good, { v: 2 }) });
    const a = await session(Sa);
    await a.page.waitForFunction(() => HA.places.length === 24, null, { timeout: 5000 });
    ok(true, '(a) fișier de altă versiune → ignorat, locurile vin de la Overpass (24)');
    eq(Sa.overpassLog.filter(r => r.strict).length, 2, '(a) cele două interogări Overpass');
    await a.ctx.close();
    /* (b) fișierul nu e JSON (de pildă o pagină de eroare) */
    const Sb = state0({ snapshot: '<html><body>Server în mentenanță</body></html>' });
    const b = await session(Sb, { allowErrors: /Failed to load resource/ });
    await b.page.waitForFunction(() => HA.places.length === 24, null, { timeout: 5000 });
    ok(true, '(b) fișier care nu e JSON → ignorat, locurile vin de la Overpass (24)');
    await b.ctx.close();
    /* (c) locuri stricate printre cele bune: se ignoră doar ele */
    const bad = JSON.parse(JSON.stringify(good));
    bad.zones.b.push({ id: 'n1', t: 'constructor', n: 'x', lat: 44.4, lon: 26.1 }, { id: 'n2', t: 'benz', n: 'fără coordonate' },
      { id: 'n3', t: 'benz', n: 'coordonate text', lat: 'sus', lon: 26 }, { id: 'n4', t: 'benz', n: 'în ocean', lat: 95, lon: 26 }, null, 5);
    const Sc = state0({ snapshot: bad, overpass: async () => ({ status: 504, json: {} }) });
    const c = await session(Sc, { allowErrors: /Failed to load resource/ });
    eq(await c.page.evaluate(() => HA.places.length), 24, '(c) locurile stricate sunt ignorate, cele bune rămân (24)');
    eq(Sc.overpassLog.length, 0, '(c) fără Overpass');
    await c.ctx.close();
    /* (d) fișier vechi de 10 zile și Overpass căzut: locurile din fișier se văd, fără mesaj de eroare */
    const Sd = state0({ snapshot: snapshotOf(FRI_10.getTime() - 10 * 864e5), overpass: async () => ({ status: 504, json: {} }) });
    const d = await session(Sd, { allowErrors: /Failed to load resource/ });
    await d.page.waitForTimeout(1200);
    eq(await d.page.evaluate(() => HA.places.length), 24, '(d) fișier vechi: locurile din el apar');
    ok(Sd.overpassLog.length > 0, '(d) iar aplicația încearcă să le reîmprospăteze (' + Sd.overpassLog.length + ' cereri)');
    eq(await d.page.locator('#msg').isVisible(), false, '(d) fără mesaj de eroare');
    await d.ctx.close();
    /* (e) la fel, dar Overpass răspunde: ia datele noi */
    const Se = state0({ snapshot: snapshotOf(FRI_10.getTime() - 10 * 864e5), elements: { b: F.knownB().concat(NEW_B), i: F.knownI() } });
    const e = await session(Se);
    await e.page.waitForFunction(() => HA.places.length === 25, null, { timeout: 8000 });
    ok(true, '(e) fișier vechi + Overpass care răspunde: locurile se reîmprospătează (25)');
    await e.ctx.close();
  });

  /* ---------------------------------------------------------------- */
  await T('„Actualizează acum” ia fișierul de pe site', async () => {
    const S = state0({ snapshot: snapshotOf(FRI_10.getTime() - HOUR), overpass: async () => ({ status: 504, json: {} }) });
    const { ctx, page } = await session(S, { allowErrors: /Failed to load resource/ });
    const refresh = async () => { await page.locator('#aboutBtn').click(); await page.locator('[data-act="refresh-data"]').click(); };
    await refresh();
    await page.waitForFunction(() => /Ai deja cele mai noi locuri/.test(document.getElementById('toast').textContent), null, { timeout: 5000 });
    ok(true, 'același fișier → „Ai deja cele mai noi locuri.”');
    S.snapshot = snapshotOf(FRI_10.getTime() - 1000, true);
    await refresh();
    await page.waitForFunction(() => HA.places.length === 25, null, { timeout: 5000 });
    await page.waitForFunction(() => /Locurile au fost actualizate/.test(document.getElementById('toast').textContent), null, { timeout: 5000 });
    ok(true, 'fișier mai nou → „Locurile au fost actualizate.” și apare locul nou');
    eq(S.overpassLog.length, 0, 'fără Overpass');
    /* dacă fișierul nu mai e, ce ceri tu se face de la OpenStreetMap */
    S.snapshot = 404; S.overpass = null; S.elements = { b: F.knownB(), i: F.knownI() };
    await refresh();
    await page.waitForFunction(() => HA.places.length === 24, null, { timeout: 8000 });
    ok(S.overpassLog.length >= 2, 'fără fișier, „Actualizează acum” întreabă Overpass (' + S.overpassLog.length + ' cereri)');
    await ctx.close();
  });

  /* ---------------------------------------------------------------- */
  await T('Server de plăci fără antete CORS: harta tot apare', async () => {
    const key = t => t.z + '/' + t.x + '/' + t.y;
    const pan = page => page.evaluate(() => HA.setView({ cx: HA.view.cx + 0.004, cy: HA.view.cy + 0.004, z: HA.view.z }, true));
    const loadedCount = page => page.evaluate(() => { let n = 0; HA.tiles.forEach(t => { if (t.st === 1) n++; }); return n; });
    /* (a) serverul NU trimite CORS: prima dată încearcă cu CORS, apoi fără, și învață */
    const ts = await L.tileServer({ cors: false, style: 'debug' });
    const a = await session(state0(), { path: '?debug&tiles=' + encodeURIComponent(ts.url), allowErrors: /Failed to load resource|CORS|ERR_FAILED/ });
    await settle(a.page, 1200);
    ok(await loadedCount(a.page) >= 4, '(a) fără CORS, plăcile tot se încarcă (' + await loadedCount(a.page) + ')');
    ok(ts.log.some(t => t.origin) && ts.log.some(t => !t.origin), '(a) întâi încearcă cu CORS, apoi fără');
    const first = ts.log.length;
    await pan(a.page);
    await settle(a.page, 1200);
    const later = ts.log.slice(first);
    ok(later.length > 0 && later.every(t => !t.origin), '(a) după ce a aflat, nu mai încearcă CORS: ' + later.length + ' plăci noi, câte o cerere');
    eq(new Set(later.map(key)).size, later.length, '(a) fiecare placă nouă se cere o singură dată');
    await a.ctx.close(); ts.srv.close();
    /* (b) serverul trimite CORS: o singură cerere pe placă, tot în mod CORS */
    const ts2 = await L.tileServer({ cors: true, style: 'debug' });
    const b = await session(state0(), { path: '?debug&tiles=' + encodeURIComponent(ts2.url) });
    await settle(b.page, 1000);
    await pan(b.page);
    await settle(b.page, 1000);
    ok(ts2.log.length > 8 && ts2.log.every(t => t.origin), '(b) cu CORS: ' + ts2.log.length + ' cereri, toate în mod CORS');
    eq(new Set(ts2.log.map(key)).size, ts2.log.length, '(b) fiecare placă o singură dată');
    ok(!close(await pxAt(b.page, 195, 400), [242, 239, 233], 6), '(b) harta are plăci desenate');
    eq(b.errors, [], '(b) fără erori în consolă');
    await b.ctx.close(); ts2.srv.close();
  });

  /* ---------------------------------------------------------------- */
  await T('Plăcile care nu vin se reiau singure, când revine semnalul', async () => {
    const S = state0({ tileStyle: 'debug', tilesFail: true });
    const { ctx, page, errors } = await session(S, { allowErrors: /Failed to load resource|ERR_/ });
    await page.waitForSelector('#net:not([hidden])', { timeout: 6000 });
    ok(/Harta nu se încarcă acum/.test(await page.locator('#net').innerText()), 'cu internet, dar fără plăci: „Harta nu se încarcă acum · încerc din nou”');
    const n1 = S.tileLog.length;
    S.tilesFail = false;
    await page.waitForFunction(() => { let n = 0; HA.tiles.forEach(t => { if (t.st === 1) n++; }); return n >= 4; }, null, { timeout: 12000 });
    ok(true, 'după ce serverul răspunde, plăcile se încarcă singure (fără să atingi nimic)');
    await page.waitForSelector('#net', { state: 'hidden', timeout: 4000 });
    ok(true, 'iar mesajul dispare');
    ok(S.tileLog.length < n1 + 80, 'fără furtună de cereri (' + (S.tileLog.length - n1) + ' cereri noi)');
    await ctx.close();
  });

  /* ---------------------------------------------------------------- */
  await T('Gesturi: tragere, inerție, ciupire, dublu-atingere, rotiță, grupuri, fișa trasă cu degetul', async () => {
    const S = state0({ tileStyle: 'pretty' });
    const { ctx, page, errors } = await session(S, { device: DESKTOP });
    const snap = () => page.evaluate(() => ({ cx: HA.view.cx, cy: HA.view.cy, z: HA.view.z }));
    const S1 = z => 256 * 2 ** z;
    await page.evaluate(() => HA.setView({ cx: HA.view.cx, cy: HA.view.cy, z: 14 }, true));
    await raf2(page);
    let a = await snap();
    await page.mouse.move(700, 400); await page.mouse.down(); await page.mouse.move(760, 440, { steps: 6 });
    await page.mouse.up();
    let b = await snap();
    near((a.cx - b.cx) * S1(a.z), 60, 1.2, 'tragere: harta urmează mouse-ul cu 60 px pe orizontală');
    near((a.cy - b.cy) * S1(a.z), 40, 1.2, 'și cu 40 px pe verticală (fără săritură la început)');
    const atUp = await snap();
    await page.waitForTimeout(450);
    const later = await snap();
    ok(Math.hypot((later.cx - atUp.cx), (later.cy - atUp.cy)) * S1(14) > 8, 'după o mișcare rapidă harta mai alunecă (inerție)');
    await page.waitForTimeout(1200);

    /* dublu-click */
    a = await snap();
    await page.mouse.click(500, 300); await page.mouse.click(500, 300);
    b = await snap();
    near(b.z, a.z + 1, 0.01, 'dublu-click: zoom +1');

    /* rotița */
    a = await snap();
    await page.mouse.move(400, 300); await page.mouse.wheel(0, -200);
    await page.waitForTimeout(100);
    b = await snap();
    ok(b.z > a.z + 0.3 && b.z < a.z + 0.7, 'rotița mărește harta (+' + (b.z - a.z).toFixed(2) + ')');

    /* ciupire cu două degete (evenimente de atingere) */
    await page.evaluate(() => HA.setView({ cx: HA.view.cx, cy: HA.view.cy, z: 13 }, true));
    await raf2(page);
    const pinch = (from, to) => page.evaluate(([f, t]) => {
      const m = document.getElementById('map');
      const fire = (type, id, x, y) => m.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: y, bubbles: true, cancelable: true }));
      fire('pointerdown', 1, f[0], f[1]); fire('pointerdown', 2, f[2], f[3]);
      for (let i = 1; i <= 12; i++) { const k = i / 12; fire('pointermove', 1, f[0] + (t[0] - f[0]) * k, f[1] + (t[1] - f[1]) * k); fire('pointermove', 2, f[2] + (t[2] - f[2]) * k, f[3] + (t[3] - f[3]) * k); }
      fire('pointerup', 1, t[0], t[1]); fire('pointerup', 2, t[2], t[3]);
    }, [from, to]);
    const under = (v, x, y) => { const S = 256 * 2 ** v.z; return [v.cx + (x - 640) / S, v.cy + (y - 400) / S]; };
    a = await snap();
    const geo = under(a, 600, 400);
    await pinch([550, 400, 650, 400], [500, 400, 700, 400]);
    b = await snap();
    near(b.z, a.z + 1, 0.01, 'ciupire: degetele se depărtează de 2× → zoom +1');
    const back = await page.evaluate(g => HA.toScreen(g[0], g[1]), geo);
    near(back[0], 600, 0.6, 'punctul de sub degete rămâne sub degete (x)');
    near(back[1], 400, 0.6, 'și pe verticală');
    a = await snap();
    const geo2 = under(a, 640, 400);
    await pinch([590, 400, 690, 400], [650, 380, 730, 380]);   // mijlocul se mută cu (+50, −20), distanța 100→80
    b = await snap();
    near(b.z, a.z + Math.log2(0.8), 0.01, 'ciupire + mutare: zoom −0,32');
    const back2 = await page.evaluate(g => HA.toScreen(g[0], g[1]), geo2);
    near(back2[0], 690, 0.8, 'ciupire + mutare: punctul urmează degetele (x)');
    near(back2[1], 380, 0.8, 'ciupire + mutare: punctul urmează degetele (y)');

    /* grup: se strânge, apăsat mărește, apoi se desface în pini */
    await page.evaluate(() => HA.setView({ cx: (26.1508 + 180) / 360, cy: (() => { const s = Math.sin(44.4155 * Math.PI / 180); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); })(), z: 15 }, true));
    await raf2(page);
    const cl = page.locator('.cl').first();
    ok(await cl.count() === 1, 'cele 12 locuri apropiate se strâng într-un grup');
    eq((await cl.locator('.cl-t').textContent()), '12', 'grupul arată „12”');
    for (let i = 0; i < 5; i++) {
      const c = page.locator('.cl'); if (await c.count() === 0) break;
      const bx = await c.first().boundingBox();
      await page.mouse.click(bx.x + bx.width / 2, bx.y + bx.height / 2);
      await page.waitForTimeout(1100);
    }
    const nPins = await page.locator('g.pin').count();
    ok(nPins >= 6, 'apăsând grupul, harta se apropie și locurile se desfac în pini (' + nPins + ' pini)');

    /* fișa se trage cu degetul */
    const pid = (await placeBy(page, 'Petrom Unirii')).id;
    await page.evaluate(id => HA.select(id, { fly: false }), pid);
    await page.waitForTimeout(200);
    const phone = await session(state0(), { device: PHONE });
    await phone.page.evaluate(() => HA.select('n1001', { fly: false }));
    await phone.page.waitForTimeout(250);
    const g = await phone.page.locator('.grab').boundingBox();
    const dragGrab = async dy => { const gb = await phone.page.locator('.grab').boundingBox(); await phone.page.mouse.move(gb.x + gb.width / 2, gb.y + 12); await phone.page.mouse.down(); await phone.page.mouse.move(gb.x + gb.width / 2, gb.y + 12 + dy, { steps: 5 }); await phone.page.mouse.up(); await phone.page.waitForTimeout(150); };
    await dragGrab(-90);
    eq(await phone.page.locator('#sheet').getAttribute('data-state'), 'full', 'tras în sus → fișa se desface');
    await dragGrab(90);
    eq(await phone.page.locator('#sheet').getAttribute('data-state'), 'peek', 'tras în jos → fișa revine pe jumătate');
    await dragGrab(90);
    eq(await phone.page.locator('#sheet').isVisible(), false, 'tras în jos încă o dată → fișa se închide');
    eq(phone.errors, [], 'fără erori în consolă (telefon)');
    await phone.ctx.close();

    /* tastatura */
    await page.evaluate(() => { HA.deselect(); HA.setView({ cx: HA.view.cx, cy: HA.view.cy, z: 14 }, true); });
    await page.locator('#map').focus();
    a = await snap();
    await page.keyboard.press('+');
    b = await snap();
    ok(b.z > a.z, 'tasta + mărește harta');
    await page.keyboard.press('ArrowLeft');
    const c2 = await snap();
    ok(c2.cx < b.cx, 'săgeata stânga mută harta');
    const pp = await placeBy(page, 'Petrom Unirii');
    await page.evaluate(([x, y]) => HA.setView({ cx: x, cy: y, z: 16 }, true), [pp.mx, pp.my]);
    await raf2(page);
    const pin = page.locator('g.pin').first();
    await pin.focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector('#sheet:not([hidden])');
    ok(true, 'tastatura: Tab până la un pin și Enter deschide fișa');
    eq(errors, [], 'fără erori în consolă');
    await ctx.close();
  });

  /* ---------------------------------------------------------------- */
  await T('Viteză cu ~2500 de locuri', async () => {
    const S = state0({ elements: { b: F.bulk('b', 1900, 11).concat(F.knownB()), i: F.bulk('i', 600, 29) } });
    const t0 = Date.now();
    const { ctx, page, errors } = await session(S, { device: PHONE });
    const t1 = Date.now() - t0;
    await page.waitForTimeout(600);
    const n = await page.evaluate(() => HA.places.length);
    ok(n > 2300, 'încărcate ' + n + ' locuri (pornire până la locuri: ' + t1 + ' ms)');
    const res = await page.evaluate(() => {
      const out = {};
      const v0 = HA.view;
      for (const z of [10.5, 12, 13.5, 15, 16.5]) {
        let tot = 0, ts = [];
        for (let i = 0; i < 24; i++) {
          HA.setView({ cx: 0.5725 + (i % 6) * 0.0002 / (2 ** (z - 10)), cy: 0.3475 + (i % 5) * 0.0002 / (2 ** (z - 10)), z: z + (i % 2 ? 0.1 : 0) }, true);
          const a = performance.now(); HA.render(); const d = performance.now() - a; tot += d; ts.push(d);
        }
        ts.sort((a, b) => a - b);
        out[z] = { avg: +(tot / 24).toFixed(1), p90: +ts[Math.floor(ts.length * 0.9)].toFixed(1), nodes: document.getElementById('ov').querySelectorAll('.pin,.cl').length };
      }
      return out;
    });
    console.log('    timp pe cadru (ms), zoom → ' + JSON.stringify(res));
    ok(Object.values(res).every(r => r.avg < 25), 'orice nivel de zoom desenează sub 25 ms în medie (fără placă video, în Chromium de test)');
    ok(Object.values(res).every(r => r.nodes < 700), 'cel mult câteva sute de elemente pe ecran');
    const list = await page.evaluate(() => { const a = performance.now(); document.getElementById('mode').click(); const d = performance.now() - a; return { d, rows: document.querySelectorAll('.l-row').length, more: !!document.querySelector('.l-more'), head: document.getElementById('listHead').textContent }; });
    ok(list.d < 200, 'lista cu 2500 de locuri se deschide în ' + list.d.toFixed(0) + ' ms');
    eq(list.rows, 120, 'lista arată 120 de rânduri odată');
    ok(list.more, 'și un buton pentru încă 120');
    await page.locator('.l-more').click();
    eq(await page.locator('.l-row').count(), 240, '„Arată încă” adaugă 120');
    const srch = await page.evaluate(() => new Promise(res => { const q = document.getElementById('q'); const a = performance.now(); q.value = 'auto'; q.dispatchEvent(new Event('input')); setTimeout(() => res(performance.now() - a), 600); }));
    ok(true, 'căutarea „auto” în 2500 de locuri se aplică fără blocaje');
    eq(errors, [], 'fără erori în consolă');
    await ctx.close();
  });

  /* ---------------------------------------------------------------- */
  await T('Aplicație instalabilă: manifest, iconițe, offline cu service worker', async () => {
    const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
    ok(man.display === 'standalone' && man.start_url === './' && man.scope === './', 'manifestul: standalone, start_url și scope „./”');
    ok(man.lang === 'ro' && /Harta Auto/.test(man.name), 'manifestul: limba și numele');
    const pngSize = f => { const b = fs.readFileSync(path.join(ROOT, f)); return b.slice(0, 8).toString('hex') === '89504e470d0a1a0a' ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null; };
    for (const ic of man.icons) { const [w, h] = pngSize(ic.src) || [0, 0]; eq([w, h], ic.sizes.split('x').map(Number), 'iconița ' + ic.src + ' are ' + ic.sizes + ' (' + ic.purpose + ')'); }
    eq(pngSize('icons/apple-touch-icon.png'), [180, 180], 'apple-touch-icon e 180×180');
    ok(man.icons.some(i => i.purpose === 'maskable') && man.icons.some(i => /512/.test(i.sizes) && i.purpose === 'any'), 'are iconiță 512 și una „maskable”');
    ok(man.shortcuts.every(s => /^\.\/\?t=(benz|vulc|service|spal)$/.test(s.url)), 'scurtăturile duc la categorii');

    const S = state0({ tileStyle: 'debug' });
    const { ctx, page, errors } = await session(S, { ctx: { serviceWorkers: 'allow' }, allowErrors: /Failed to load resource/ });
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 8000 });
    ok(true, 'service worker-ul e înregistrat și preia pagina');
    await page.evaluate(() => HA.setView({ cx: HA.view.cx, cy: HA.view.cy, z: 15 }, true));
    await settle(page, 900);
    const caches = await page.evaluate(async () => { const o = {}; for (const k of await window.caches.keys()) o[k] = (await (await window.caches.open(k)).keys()).map(r => new URL(r.url).pathname); return o; });
    ok(caches['ha-shell-' + SW_VER] && ['/js/app.js', '/js/osm.js', '/js/hours.js', '/styles.css', '/index.html', '/manifest.webmanifest'].every(p => caches['ha-shell-' + SW_VER].indexOf(p) >= 0), 'fișierele aplicației sunt păstrate pentru offline');
    ok(caches['ha-tiles'] && caches['ha-tiles'].length >= 4, 'plăcile văzute se păstrează pentru offline (' + (caches['ha-tiles'] || []).length + ')');
    const before = S.tileLog.length, overBefore = S.overpassLog.length;
    await ctx.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => window.HA && window.HA.places.length > 0, null, { timeout: 10000 });
    ok(true, 'fără net: pagina se deschide din memorie');
    eq(await page.evaluate(() => HA.places.length), 24, 'și are cele 24 de locuri salvate');
    await page.waitForTimeout(800);
    const px = await pxAt(page, 195, 400);
    ok(!close(px, [242, 239, 233], 6), 'și harta văzută mai devreme se vede din memorie: ' + px);
    ok(await page.locator('#net').isVisible(), 'cu mesajul „Fără conexiune”');
    eq(S.overpassLog.length, overBefore, 'fără cereri noi către Overpass');
    await ctx.setOffline(false);
    await ctx.close();
  });

  /* ---------------------------------------------------------------- */
  await T('Instalare și „Despre”', async () => {
    const S = state0();
    const { ctx, page, errors } = await session(S);
    await page.evaluate(() => { window.__prompted = 0; const e = new Event('beforeinstallprompt'); e.prompt = () => { window.__prompted++; }; e.userChoice = Promise.resolve({ outcome: 'accepted' }); window.dispatchEvent(e); });
    await page.locator('#aboutBtn').click();
    await page.waitForSelector('#about:not([hidden])');
    const txt = await page.locator('#aboutCard').innerText();
    ok(/24/.test(txt) && /OpenStreetMap/.test(txt) && /ODbL/.test(txt), '„Despre” arată numărul de locuri și sursa datelor (ODbL)');
    ok(await page.locator('[data-act="install"]').count() === 1, 'când browserul permite, apare „Instalează aplicația”');
    await page.locator('[data-act="install"]').click();
    eq(await page.evaluate(() => window.__prompted), 1, '„Instalează aplicația” cere instalarea');
    await page.waitForSelector('#about', { state: 'hidden' });
    await page.locator('#aboutBtn').click();
    ok(await page.locator('[data-act="install"]').count() === 0 && /Pe Android/.test(await page.locator('#aboutCard').innerText()), 'altfel: indicații pentru Android');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#about', { state: 'hidden' });
    ok(true, 'Escape închide „Despre”');
    await page.locator('#aboutBtn').click();
    await page.locator('[data-act="refresh-data"]').click();
    await page.waitForFunction(() => /Locurile au fost actualizate/.test(document.getElementById('toast').textContent), null, { timeout: 8000 });
    ok(true, '„Actualizează acum” descarcă din nou și anunță');
    eq(errors, [], 'fără erori în consolă');
    await ctx.close();

    const ios = await browser.newContext(Object.assign({ serviceWorkers: 'block' }, require('playwright').devices['iPhone 13']));
    await L.installMocks(ios, state0());
    const ip = await ios.newPage();
    await ip.goto(base + '?debug');
    await ip.waitForFunction(() => window.HA && HA.places.length > 0);
    await ip.locator('#aboutBtn').click();
    ok(/Adaugă pe ecranul principal/.test(await ip.locator('#aboutCard').innerText()), 'pe iPhone: „Distribuie → Adaugă pe ecranul principal”');
    await ios.close();
  });

  /* ---------------------------------------------------------------- */
  await T('Aspect: telefon, întuneric, ecran mare (capturi)', async () => {
    const S = state0({ tileStyle: 'pretty' });
    const shots = [];
    for (const [name, dev, scheme] of [['telefon-zi', PHONE, 'light'], ['telefon-noapte', PHONE, 'dark'], ['desktop', DESKTOP, 'light']]) {
      const { ctx, page, errors } = await session(S, { device: dev, ctx: { colorScheme: scheme } });
      await settle(page, 900);
      await page.screenshot({ path: path.join(SHOTS, name + '-1-harta.png') });
      await page.evaluate(() => HA.select('n1001'));
      await page.waitForTimeout(1100);
      await page.screenshot({ path: path.join(SHOTS, name + '-2-fisa.png') });
      await page.locator('[data-act="toggle"]').click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(SHOTS, name + '-3-detalii.png') });
      await page.locator('.s-close').click();
      await page.locator('#mode').click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(SHOTS, name + '-4-lista.png') });
      await page.locator('#mode').click();
      await page.locator('#aboutBtn').click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(SHOTS, name + '-5-despre.png') });
      if (scheme === 'dark') ok((await page.evaluate(() => getComputedStyle(document.getElementById('tiles')).filter)) !== 'none', 'în tema închisă harta e întunecată');
      eq(errors, [], name + ': fără erori în consolă');
      await ctx.close();
    }
  });

  await browser.close();
  srv.close();
  console.log('\n' + (fail ? '✗ ' + fail + ' verificări căzute' : '✓ toate verificările au trecut') + ' (' + pass + ' trecute)');
  if (fail) { console.log(failed.map(f => ' - ' + f).join('\n')); process.exitCode = 1; }
})().catch(e => { console.error(e); process.exit(1); });
