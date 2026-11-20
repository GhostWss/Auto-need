/* Teste pentru programul și datele din OpenStreetMap.
   Rulare: node tests/unit.js */
'use strict';
const assert = require('assert');
const H = require('../js/hours.js');
const O = require('../js/osm.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { console.error('✗ ' + name + '\n  ' + e.message); process.exitCode = 1; }
}
const same = (a, b) => assert.deepStrictEqual(a, b);

/* ---------- program ---------- */
test('Mo-Fr + Sa + Su off', () => {
  const r = H.parse('Mo-Fr 08:00-18:00; Sa 09:00-14:00; Su off');
  same(r.week[0], [[480, 1080]]);
  same(r.week[4], [[480, 1080]]);
  same(r.week[5], [[540, 840]]);
  same(r.week[6], []);
});
test('24/7 și Mo-Su 00:00-24:00', () => {
  assert.ok(H.isNonstop(H.parse('24/7').week));
  assert.ok(H.isNonstop(H.parse('Mo-Su 00:00-24:00').week));
  assert.ok(!H.isNonstop(H.parse('Mo-Fr 00:00-24:00').week));
});
test('pauză de masă', () => {
  same(H.parse('Mo-Fr 08:00-12:00,14:00-18:00').week[2], [[480, 720], [840, 1080]]);
});
test('reguli adiționale cu virgulă', () => {
  const r = H.parse('Mo-Fr 09:00-18:00, Sa 09:00-13:00');
  same(r.week[1], [[540, 1080]]);
  same(r.week[5], [[540, 780]]);
  same(r.week[6], []);
});
test('listă de zile și interval cu wrap', () => {
  const r = H.parse('Mo,We,Fr 10:00-12:00');
  same(r.week[0], [[600, 720]]); same(r.week[1], []); same(r.week[2], [[600, 720]]);
  const w = H.parse('Sa-Mo 10:00-12:00').week;
  same(w[5], [[600, 720]]); same(w[6], [[600, 720]]); same(w[0], [[600, 720]]); same(w[1], []);
});
test('sărbători ignorate', () => {
  const r = H.parse('Mo-Sa 08:00-20:00; Su 09:00-14:00; PH off');
  same(r.week[6], [[540, 840]]);
  const r2 = H.parse('Mo-Fr 07:00-19:00; Sa 07:00-14:00; Su,PH off');
  same(r2.week[6], []);
  same(r2.week[0], [[420, 1140]]);
});
test('ore cu o cifră, comentarii, diacritice de linie', () => {
  same(H.parse('Mo-Fr 8:00-18:00').week[0], [[480, 1080]]);
  same(H.parse('Mo-Fr 08:00–18:00 "sună înainte"').week[0], [[480, 1080]]);
});
test('program peste miezul nopții', () => {
  const w = H.parse('Mo-Su 22:00-02:00').week;
  same(w[1], [[0, 120], [1320, 1440]]);
  same(H.parse('Fr 22:00-04:00').week[5], [[0, 240]]);
});
test('forme neacceptate întorc null', () => {
  [undefined, '', 'sunrise-sunset', 'Jan-Mar Mo-Fr 08:00-12:00', 'Mo-Fr 08:00+', 'off', 'Mo-Fr', 'L-V 08:00-18:00', 'Mo-Fr 25:00-26:00', 'Mo-Fr 08:00-18:00 unknown']
    .forEach(s => assert.strictEqual(H.parse(s), null, 'ar fi trebuit null pentru: ' + s));
});
test('status: deschis / închis', () => {
  const w = H.parse('Mo-Fr 08:00-18:00; Sa 09:00-14:00; Su off').week;
  let s = H.status(w, 2, 10 * 60);
  assert.ok(s.open); assert.strictEqual(s.text, 'până la 18:00');
  s = H.status(w, 2, 7 * 60);
  assert.ok(!s.open); assert.strictEqual(s.text, 'se deschide la 08:00');
  s = H.status(w, 2, 19 * 60);
  assert.strictEqual(s.text, 'se deschide mâine la 08:00');
  s = H.status(w, 4, 19 * 60);
  assert.strictEqual(s.text, 'se deschide mâine la 09:00');
  s = H.status(w, 5, 15 * 60);
  assert.strictEqual(s.text, 'se deschide luni la 08:00');
});
test('status: non-stop și peste miezul nopții', () => {
  assert.strictEqual(H.status(H.parse('24/7').week, 3, 3 * 60).text, 'non-stop');
  const w = H.parse('Mo-Su 22:00-02:00').week;
  assert.strictEqual(H.status(w, 0, 23 * 60).text, 'până mâine la 02:00');
  assert.strictEqual(H.status(w, 1, 60).text, 'până la 02:00');
  assert.strictEqual(H.status(w, 1, 12 * 60).text, 'se deschide la 22:00');
});
test('grupare pentru afișare', () => {
  const g = H.groups(H.parse('Mo-Fr 08:00-18:00; Sa 09:00-14:00; Su off').week);
  same(g, [{ a: 0, b: 4, text: '08:00–18:00' }, { a: 5, b: 5, text: '09:00–14:00' }, { a: 6, b: 6, text: 'Închis' }]);
  same(H.groups(H.parse('24/7').week), [{ a: 0, b: 6, text: 'Non-stop' }]);
});

/* ---------- OpenStreetMap ---------- */
test('telefoane românești', () => {
  same(O.fmtPhone('+40 721 234 567'), ['0721 234 567', '+40721234567']);
  same(O.fmtPhone('0213456789'), ['021 345 6789', '+40213456789']);
  same(O.fmtPhone('021 345 67 89'), ['021 345 6789', '+40213456789']);
  same(O.fmtPhone('0040721234567'), ['0721 234 567', '+40721234567']);
  same(O.fmtPhone('0268 123 456'), ['0268 123 456', '+40268123456']);
  assert.strictEqual(O.fmtPhone('112'), null);
  same(O.fmtPhone('+49 30 123456'), ['+49 30 123456', '+4930123456']);
});
test('clasificare', () => {
  assert.strictEqual(O.classify({ amenity: 'fuel' }), 'benz');
  assert.strictEqual(O.classify({ amenity: 'car_wash' }), 'spal');
  assert.strictEqual(O.classify({ shop: 'tyres' }), 'vulc');
  assert.strictEqual(O.classify({ shop: 'car_repair', name: 'Vulcanizare Dristor' }), 'vulc');
  assert.strictEqual(O.classify({ shop: 'car_repair', name: 'Auto Service Rapid' }), 'service');
  assert.strictEqual(O.classify({ shop: 'car_parts' }), 'piese');
  assert.strictEqual(O.classify({ shop: 'bakery' }), null);
});
test('interogări Overpass', () => {
  const q = O.query('b');
  assert.ok(q.indexOf('"ISO3166-2"="RO-B"') > 0 && q.indexOf('nwr["amenity"="fuel"](area.a);') > 0 && /out center tags/.test(q));
  assert.ok(O.query('i').indexOf('RO-IF') > 0);
  assert.ok(/nwr\["shop"="tyres"\]\(44\.3,25\.92,44\.58,26\.3\);/.test(O.queryBox('b')));
});
test('normalizare: etichete -> locuri', () => {
  const els = [
    { type: 'node', id: 1, lat: 44.43, lon: 26.1, tags: { amenity: 'fuel', name: 'Petrom', brand: 'Petrom', opening_hours: '24/7', 'fuel:diesel': 'yes', 'fuel:octane_95': 'yes', 'fuel:octane_100': 'yes', 'fuel:lpg': 'yes', toilets: 'yes', phone: '+40 21 123 4567; 0721 000 111', 'addr:street': 'Șoseaua Pipera', 'addr:housenumber': '12', 'addr:city': 'Voluntari', website: 'petrom.ro' } },
    { type: 'way', id: 2, center: { lat: 44.44, lon: 26.11 }, tags: { shop: 'car_repair', name: 'Auto Rapid', 'service:vehicle:oil_change': 'yes', 'service:vehicle:brakes': 'yes', 'service:vehicle:tyres': 'no', opening_hours: 'Mo-Fr 08:00-18:00' } },
    { type: 'node', id: 3, lat: 44.45, lon: 26.12, tags: { amenity: 'car_wash', brand: 'Spălătoria Mea', self_service: 'yes', access: 'private' } },
    { type: 'node', id: 4, lat: 44.46, lon: 26.13, tags: { amenity: 'car_wash', self_service: 'yes', vacuum_cleaner: 'yes' } },
    { type: 'node', id: 5, lat: 44.47, lon: 26.14, tags: { shop: 'bakery', name: 'Pâine' } },
    { type: 'node', id: 6, lat: 44.48, lon: 26.15 },
    { type: 'relation', id: 7, tags: { shop: 'tyres', name: 'Fără coordonate' } },
    { type: 'node', id: 8, lat: 44.49, lon: 26.16, tags: { shop: 'car_parts', name: 'Piese Auto', website: 'javascript:alert(1)', second_hand: 'yes' } }
  ];
  const r = O.normalize(els, 'b');
  assert.strictEqual(r.length, 4);
  const byId = {}; r.forEach(p => { byId[p.id] = p; });
  const p1 = byId.n1;
  assert.strictEqual(p1.t, 'benz'); assert.strictEqual(p1.z, 'București');
  assert.strictEqual(p1.a, 'Șoseaua Pipera 12, Voluntari');
  same(p1.sv, ['b95', 'bp', 'mot', 'gpl', 'wc', 'nonstop']);
  same(p1.tel, [['021 123 4567', '+40211234567'], ['0721 000 111', '+40721000111']]);
  assert.strictEqual(p1.w, 'https://petrom.ro');
  const p2 = byId.w2;
  assert.strictEqual(p2.t, 'service'); assert.strictEqual(p2.lat, 44.44);
  same(p2.sv, ['ulei', 'frane']);
  assert.strictEqual(byId.n3, undefined, 'acces privat exclus');
  same(byId.n4.sv, ['self', 'asp']); assert.strictEqual(byId.n4.n, '');
  assert.strictEqual(byId.n8.w, ''); same(byId.n8.sv, ['sh']);
});
test('deduplicare punct + clădire', () => {
  const els = [
    { type: 'node', id: 10, lat: 44.4300, lon: 26.1000, tags: { amenity: 'fuel', name: 'OMV' } },
    { type: 'way', id: 11, center: { lat: 44.43005, lon: 26.10004 }, tags: { amenity: 'fuel', name: 'OMV', phone: '0721111222', opening_hours: '24/7' } },
    { type: 'node', id: 12, lat: 44.4400, lon: 26.1000, tags: { amenity: 'fuel', name: 'OMV' } }
  ];
  const r = O.normalize(els, 'b');
  assert.strictEqual(r.length, 2);
  assert.ok(r.some(p => p.id === 'w11'), 'rămâne varianta cu mai multe date');
});
test('adrese de legătură OSM', () => {
  assert.strictEqual(O.osmUrl('n123'), 'https://www.openstreetmap.org/node/123');
  assert.strictEqual(O.osmEditUrl('w9'), 'https://www.openstreetmap.org/edit?way=9');
});

/* ---------- încărcarea de la mai multe servere Overpass ---------- */
const asyncTests = [];
function atest(name, fn) { asyncTests.push([name, fn]); }
const HOSTS = ['overpass-api.de', 'overpass.openstreetmap.fr', 'overpass.private.coffee', 'overpass.kumi.systems'];
const EL = [{ type: 'node', id: 1, lat: 44.43, lon: 26.10, tags: { amenity: 'fuel', name: 'Test' } }];

/* „rețea” falsă: pentru fiecare server hotărăște comportamentul (pică, nu răspunde, răspunde după un timp) */
function fakeNet(behaviour) {
  const log = [], t0 = Date.now();
  global.fetch = (url, opts) => {
    const host = new URL(url).host;
    const q = decodeURIComponent((opts.body || '').replace(/^data=/, ''));
    const rec = { host, at: Date.now() - t0, aborted: false, strict: /ISO3166-2/.test(q) };
    log.push(rec);
    const b = behaviour(host, rec) || { fail: 502 };
    return new Promise((resolve, reject) => {
      const onAbort = () => { rec.aborted = true; const e = new Error('aborted'); e.name = 'AbortError'; reject(e); };
      if (opts.signal) { if (opts.signal.aborted) return onAbort(); opts.signal.addEventListener('abort', onAbort); }
      if (b.hang) return;
      setTimeout(() => {
        if (rec.aborted) return;
        if (b.fail) return resolve({ ok: false, status: b.fail });
        resolve({ ok: true, status: 200, json: async () => ({ version: 0.6, osm3s: { timestamp_osm_base: '2026-11-20T18:00:00Z' }, elements: b.elements || [] }) });
      }, b.delay || 0);
    });
  };
  return log;
}
const wait = ms => new Promise(r => setTimeout(r, ms));
async function withNet(fn) {
  const saved = Object.assign({}, O.CONFIG), realFetch = global.fetch;
  O.CONFIG.hedge = 80; O.CONFIG.timeout = 600;
  O.reset();
  try { await fn(); } finally { Object.assign(O.CONFIG, saved); global.fetch = realFetch; O.reset(); }
}

atest('4 servere Overpass, toate https, fără repetări', () => {
  assert.strictEqual(O.ENDPOINTS.length, 4);
  assert.strictEqual(new Set(O.ENDPOINTS).size, 4);
  assert.ok(O.ENDPOINTS.every(e => /^https:\/\/[^/]+\/api\/interpreter$/.test(e)));
  same(O.ENDPOINTS.map(e => new URL(e).host), HOSTS);
});
atest('primul server pică (502): al doilea pornește imediat, fără să aștepte', async () => {
  await withNet(async () => {
    O.CONFIG.hedge = 5000;
    const log = fakeNet(h => h === HOSTS[1] ? { elements: EL } : { fail: 502 });
    const t0 = Date.now();
    const r = await O.race('q');
    assert.strictEqual(r.ep, 'https://' + HOSTS[1] + '/api/interpreter');
    assert.ok(Date.now() - t0 < 1000, 'a durat ' + (Date.now() - t0) + ' ms');
    same(log.map(l => l.host), [HOSTS[0], HOSTS[1]]);
  });
});
atest('primul server nu răspunde: după pauza de așteptare pornește al doilea, iar primul e oprit', async () => {
  await withNet(async () => {
    const log = fakeNet(h => h === HOSTS[1] ? { elements: EL, delay: 10 } : { hang: true });
    const r = await O.race('q');
    assert.strictEqual(r.ep, 'https://' + HOSTS[1] + '/api/interpreter');
    assert.ok(log[1].at >= 70, 'al doilea a pornit prea devreme: ' + log[1].at + ' ms');
    assert.strictEqual(log[0].aborted, true, 'cererea rămasă fără răspuns trebuie oprită');
    assert.strictEqual(log.length, 2, 'nu pornesc mai multe servere decât e nevoie');
  });
});
atest('dacă primul răspunde bine, nu se mai cere de la altele', async () => {
  await withNet(async () => {
    const log = fakeNet(() => ({ elements: EL, delay: 20 }));
    await O.race('q');
    await wait(150);
    same(log.map(l => l.host), [HOSTS[0]]);
  });
});
atest('serverul care a pierdut merge la coadă data viitoare, cel care a mers merge primul', async () => {
  await withNet(async () => {
    O.CONFIG.hedge = 5000;
    let log = fakeNet(h => h === HOSTS[1] ? { elements: EL } : { fail: 502 });
    await O.race('q');
    log = fakeNet(() => ({ elements: EL }));
    await O.race('q');
    same(log.map(l => l.host), [HOSTS[1]], 'a doua oară începe cu serverul care a răspuns');
    log = fakeNet(h => h === HOSTS[1] ? { fail: 429 } : { elements: EL });
    O.reset();
    await O.race('q');
    log = fakeNet(() => ({ elements: EL }));
    await O.race('q');
    assert.notStrictEqual(log[0].host, HOSTS[1], 'serverul cu 429 nu mai e primul');
  });
});
atest('toate serverele pică: eroare după ce au fost încercate toate, o singură dată fiecare', async () => {
  await withNet(async () => {
    const log = fakeNet(() => ({ fail: 504 }));
    await assert.rejects(() => O.race('q'), /HTTP 504/);
    same(log.map(l => l.host).sort(), HOSTS.slice().sort());
  });
});
atest('toate serverele tac: se oprește la limita de timp, nu așteaptă la nesfârșit', async () => {
  await withNet(async () => {
    O.CONFIG.hedge = 50; O.CONFIG.timeout = 200;
    const log = fakeNet(() => ({ hang: true }));
    const t0 = Date.now();
    await assert.rejects(() => O.race('q'));
    assert.ok(Date.now() - t0 < 1000, 'a durat ' + (Date.now() - t0) + ' ms');
    assert.strictEqual(log.length, 4);
  });
});
atest('load: zona nu e găsită după limite → interogare pe dreptunghi', async () => {
  await withNet(async () => {
    const log = fakeNet((h, rec) => rec.strict ? { elements: [] } : { elements: EL });
    const info = {};
    const r = await O.load('b', info);
    assert.strictEqual(r.length, 1);
    same(log.map(l => l.strict), [true, false]);
    assert.strictEqual(info.ts, Date.parse('2026-11-20T18:00:00Z'));
    assert.ok(/^https:\/\/overpass-api\.de/.test(info.endpoint));
  });
});
atest('load: serverele pică → nu cere și dreptunghiul (ar dubla așteptarea)', async () => {
  await withNet(async () => {
    const log = fakeNet(() => ({ fail: 502 }));
    await assert.rejects(() => O.load('i'), /HTTP 502/);
    assert.ok(log.every(l => l.strict), 'doar interogarea pe limite');
  });
});
atest('load: dreptunghiul gol = eroare (nu salvăm o zonă fără locuri)', async () => {
  await withNet(async () => {
    fakeNet(() => ({ elements: [] }));
    await assert.rejects(() => O.load('b'), /nu a întors/);
  });
});
atest('load: răspuns cu eroare de la server (remark) = server picat, trece la următorul', async () => {
  await withNet(async () => {
    O.CONFIG.hedge = 5000;
    const log = fakeNet(h => h === HOSTS[0] ? { elements: [], remark: 'runtime error: Query timed out' } : { elements: EL });
    global.fetch = (url, opts) => {
      const host = new URL(url).host;
      return Promise.resolve({ ok: true, status: 200, json: async () => host === HOSTS[0] ? { elements: [], remark: 'runtime error: Query timed out' } : { elements: EL } });
    };
    const r = await O.load('b');
    assert.strictEqual(r.length, 1);
  });
});

(async () => {
  for (const [name, fn] of asyncTests) {
    try { await fn(); passed++; }
    catch (e) { console.error('✗ ' + name + '\n  ' + (e && e.message)); process.exitCode = 1; }
  }
  console.log(passed + ' teste trecute' + (process.exitCode ? ', cu erori' : ''));
})();
