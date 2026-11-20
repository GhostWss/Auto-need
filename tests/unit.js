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

console.log(passed + ' teste trecute' + (process.exitCode ? ', cu erori' : ''));
