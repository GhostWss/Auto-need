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

test('program pe scurt', () => {
  same(H.summary(H.parse('Mo-Fr 08:00-18:00; Sa 09:00-14:00; Su off').week), [
    { a: 0, b: 4, label: 'L–V', text: '08:00–18:00' }, { a: 5, b: 5, label: 'S', text: '09:00–14:00' }, { a: 6, b: 6, label: 'D', text: 'închis' }]);
  same(H.summary(H.parse('Mo-Su 08:00-20:00').week), [{ a: 0, b: 6, label: 'Zilnic', text: '08:00–20:00' }]);
  same(H.summary(H.parse('24/7').week), [{ a: 0, b: 6, label: 'Zilnic', text: 'Non-stop' }]);
  same(H.summary(H.parse('Mo-Fr 08:00-12:00,13:00-17:00').week).map(x => x.label + ' ' + x.text), ['L–V 08:00–12:00, 13:00–17:00', 'S–D închis']);
  same(H.summary(H.parse('Mo-We 09:00-17:00; Th 09:00-19:00; Fr 09:00-17:00').week).map(x => x.label), ['L–Mi', 'J', 'V', 'S–D']);
  same(H.summary(H.parse('Tu 10:00-12:00; We 10:00-12:00').week).map(x => x.label + ' ' + x.text), ['L închis', 'Ma–Mi 10:00–12:00', 'J–D închis']);
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

/* ---------- date în plus: servicii din etichete, deduse din text, descriere, contact ---------- */
const one = tags => O.normalize([{ type: 'node', id: 77, lat: 44.43, lon: 26.1, tags }], 'b')[0];
test('servicii din etichete: variante de scriere, plată, Wi-Fi, service=', () => {
  same(one({ shop: 'car_repair', name: 'X', 'service:vehicle:alignment': 'yes', 'service:vehicle:batteries': 'yes', 'service:vehicle:repairs': 'yes' }).sv, ['geo', 'elec', 'general']);
  same(one({ shop: 'car_repair', name: 'X', 'service:vehicle:wheel_alignment': 'yes', 'service:vehicle:battery': 'yes', 'service:vehicle:car_repair': 'yes' }).sv, ['geo', 'elec', 'general']);
  same(one({ shop: 'car_repair', name: 'X', 'service:vehicle:brakes': 'no' }).sv, []);
  same(one({ shop: 'car_repair', name: 'X', service: 'repair;parts;tyres' }).sv, ['general', 'piese', 'anv']);
  same(one({ shop: 'car_repair', name: 'X', services: 'glass, towing, ceva_necunoscut' }).sv, ['parbriz', 'tract']);
  same(one({ shop: 'tyres', name: 'X', 'service:vehicle:tyres': 'yes', 'service:vehicle:wheel_balancing': 'yes', 'service:vehicle:alignment': 'yes' }).sv, ['schimb', 'echil', 'geo']);
  same(one({ amenity: 'fuel', name: 'X', 'payment:visa': 'yes', 'payment:cash': 'yes', internet_access: 'wlan' }).sv, ['card', 'cash', 'wifi']);
  same(one({ amenity: 'fuel', name: 'X', 'payment:cards': 'no', 'payment:cash': 'no', internet_access: 'no' }).sv, []);
  same(one({ amenity: 'car_wash', name: 'X', 'payment:debit_cards': 'yes', opening_hours: '24/7' }).sv, ['card', 'nonstop']);
});
test('telefon: și în mobile, contact:mobile, phone:mobile, contact', () => {
  same(one({ shop: 'car_repair', name: 'X', mobile: '0722 333 444' }).tel, [['0722 333 444', '+40722333444']]);
  same(one({ shop: 'car_repair', name: 'X', 'contact:mobile': '+40 733 111 222', phone: '021 345 6789' }).tel, [['021 345 6789', '+40213456789'], ['0733 111 222', '+40733111222']]);
  same(one({ shop: 'car_repair', name: 'X', 'phone:mobile': '0744555666', 'contact:phone': '0744 555 666' }).tel, [['0744 555 666', '+40744555666']]);
  same(one({ shop: 'car_repair', name: 'X', contact: '0755 000 111' }).tel, [['0755 000 111', '+40755000111']]);
  same(one({ shop: 'car_repair', name: 'X', contact: 'prin e-mail' }).tel, []);
  assert.strictEqual(one({ shop: 'car_repair', name: 'X', phone: '0711 000 001; 0711 000 002; 0711 000 003; 0711 000 004' }).tel.length, 3, 'cel mult trei numere');
});
test('servicii deduse din nume și descriere (separat de etichete)', () => {
  const p = one({ shop: 'car_repair', name: 'Tinichigerie și Vopsitorie Auto', description: 'ITP, climatizare și geometrie. Diagnoză computerizată.' });
  same(p.sv, []);
  same(p.sd, ['tinich', 'itp', 'clima', 'geo', 'diag']);
  const q = one({ shop: 'car_repair', name: 'Service Frâne', 'service:vehicle:brakes': 'yes', description: 'frâne și suspensie' });
  same(q.sv, ['frane']); same(q.sd, ['susp'], 'ce e deja în etichete nu se mai deduce');
  same(one({ shop: 'tyres', name: 'Vulcanizare Echilibrare și Jante' }).sd, ['echil', 'jante']);
  same(one({ amenity: 'car_wash', name: 'Spălătorie Self Service' }).sd, ['self']);
  same(one({ shop: 'car_parts', name: 'Piese Second Hand', description: 'livrare rapidă cu curier' }).sd, ['sh', 'livrare']);
  same(one({ amenity: 'fuel', name: 'Petrom cafea și mâncare', description: 'toaletă gratuită' }).sd, [], 'benzinăriile nu deduc nimic din nume');
  same(one({ shop: 'car_repair', name: 'Auto Mecanic', brand: 'Auto Mecanic' }).sd, [], 'numele care e doar marca nu se ia în seamă');
  same(one({ shop: 'car_repair', name: 'Service Roți Rapid' }).sd, ['anv']);
  assert.strictEqual(one({ shop: 'car_repair', name: 'Service Anvelopă Rapid' }).t, 'vulc', 'cu „anvelopă” în nume e vulcanizare');
  same(one({ shop: 'car_repair', name: 'Service Electrician Auto' }).sd, ['elec']);
  same(one({ shop: 'car_repair', name: 'Service Parbriz Express' }).sd, ['parbriz']);
});
test('descrierea: curățată, fără MAJUSCULE întregi, nu prea lungă', () => {
  assert.strictEqual(one({ shop: 'car_repair', name: 'X', description: '  Service   pentru toate mărcile.  ' }).d, 'Service pentru toate mărcile.');
  assert.strictEqual(one({ shop: 'car_repair', name: 'X', 'description:ro': 'Descriere în română', description: 'English one' }).d, 'Descriere în română');
  assert.strictEqual(one({ shop: 'car_repair', name: 'X', description: 'SERVICE AUTO SPECIALIZAT. PROGRAM LA TELEFON' }).d, 'Service auto specializat. Program la telefon');
  assert.strictEqual(one({ shop: 'car_repair', name: 'X', description: 'ok' }).d, '', 'prea scurtă');
  assert.strictEqual(one({ amenity: 'car_wash', name: 'X', description: 'Hotspot WiFi gratuit' }).d, '', 'hotspot nu e descriere');
  assert.strictEqual(one({ shop: 'car_repair', name: 'Service Rapid', description: 'Service Rapid' }).d, '', 'la fel cu numele: nu se repetă');
  assert.strictEqual(one({ shop: 'car_repair', name: 'X', description: '- Reparații auto' }).d, 'Reparații auto');
  const long = one({ shop: 'car_repair', name: 'X', description: ('cuvânt ').repeat(120) }).d;
  assert.ok(long.length <= 501 && /…$/.test(long), 'tăiată la 500 de semne, cu „…”');
});
test('e-mail, Facebook, Instagram', () => {
  assert.strictEqual(one({ shop: 'car_repair', name: 'X', 'contact:email': 'office@rapid.ro' }).e, 'office@rapid.ro');
  assert.strictEqual(one({ shop: 'car_repair', name: 'X', email: 'a@b.ro; c@d.ro' }).e, 'a@b.ro');
  assert.strictEqual(one({ shop: 'car_repair', name: 'X', email: 'nu e adresă' }).e, '');
  assert.strictEqual(one({ shop: 'car_repair', name: 'X', email: 'javascript:alert(1)@x.ro' }).e, '');
  assert.strictEqual(one({ shop: 'car_repair', name: 'X', email: 'a@b.ro?bcc=x@y.ro' }).e, '');
  const fb = v => one({ shop: 'car_repair', name: 'X', facebook: v }).fb;
  assert.strictEqual(fb('https://www.facebook.com/AtelierRapid'), 'https://www.facebook.com/AtelierRapid');
  assert.strictEqual(fb('facebook.com/atelier.rapid'), 'https://www.facebook.com/atelier.rapid');
  assert.strictEqual(fb('https://m.facebook.com/atelier.rapid/'), 'https://www.facebook.com/atelier.rapid/');
  assert.strictEqual(fb('fb.com/atelier'), 'https://www.facebook.com/atelier');
  assert.strictEqual(fb('@atelier.rapid'), 'https://www.facebook.com/atelier.rapid');
  assert.strictEqual(fb('atelierrapid'), 'https://www.facebook.com/atelierrapid');
  assert.strictEqual(fb('https://facebook.com/'), '', 'fără pagină');
  assert.strictEqual(fb('https://example.com/atelier'), '', 'alt site nu e Facebook');
  assert.strictEqual(fb('javascript:alert(1)'), '');
  assert.strictEqual(fb('Atelier Rapid Auto'), '', 'cu spații: nu e o pagină');
  assert.strictEqual(fb('două cuvinte'), '');
  assert.strictEqual(fb('https://www.facebook.com/prima; https://www.facebook.com/a-doua'), 'https://www.facebook.com/prima', 'dintr-o listă se ia prima');
  const ig = v => one({ shop: 'car_repair', name: 'X', 'contact:instagram': v }).ig;
  assert.strictEqual(ig('https://instagram.com/rapid_auto/'), 'https://www.instagram.com/rapid_auto/');
  assert.strictEqual(ig('@rapid_auto'), 'https://www.instagram.com/rapid_auto');
  assert.strictEqual(ig('https://facebook.com/rapid'), '', 'Facebook în câmpul Instagram: nu');
  assert.strictEqual(one({ shop: 'car_repair', name: 'X', 'contact:facebook': 'https://www.facebook.com/Contact', facebook: 'https://www.facebook.com/Altul' }).fb, 'https://www.facebook.com/Contact', 'contact:* are întâietate');
});
test('toate câmpurile noi există mereu (goale când lipsesc)', () => {
  const p = one({ shop: 'car_repair', name: 'X' });
  assert.strictEqual(p.d, ''); assert.strictEqual(p.e, ''); assert.strictEqual(p.fb, ''); assert.strictEqual(p.ig, ''); same(p.sd, []);
  same(O.SVC.service.card, 'Plată cu cardul'); assert.ok(['benz', 'service', 'vulc', 'spal', 'piese'].every(t => O.SVC[t].card && O.SVC[t].cash && O.SVC[t].wifi), 'plata și Wi-Fi la toate categoriile');
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
atest('antete în plus (User-Agent) și jurnal pentru scriptul de noapte', async () => {
  await withNet(async () => {
    O.CONFIG.hedge = 5000; O.CONFIG.headers = { 'User-Agent': 'proba/1' };
    const lines = []; O.CONFIG.log = (ep, what) => lines.push(new URL(ep).host + ': ' + what);
    const seen = [];
    const base = global.fetch;
    fakeNet(h => h === HOSTS[1] ? { elements: EL } : { fail: 502 });
    const inner = global.fetch;
    global.fetch = (url, opts) => { seen.push(opts.headers); return inner(url, opts); };
    try { await O.race('q'); } finally { O.CONFIG.headers = null; O.CONFIG.log = null; }
    assert.ok(seen.every(h => h['User-Agent'] === 'proba/1' && /x-www-form-urlencoded/.test(h['Content-Type'])), 'antetele ajung la cerere');
    same(lines, [HOSTS[0] + ': eroare: HTTP 502', HOSTS[1] + ': ok, 1 elemente']);
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
