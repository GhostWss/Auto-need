/* Locuri inventate, în formatul în care le dă Overpass, pentru teste. */
'use strict';

function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* locuri cu valori cunoscute, ca să le putem verifica una câte una */
function knownB() {
  const els = [
    { type: 'node', id: 1001, lat: 44.4260, lon: 26.1030, tags: { amenity: 'fuel', name: 'Petrom Unirii', brand: 'Petrom', opening_hours: '24/7', 'fuel:diesel': 'yes', 'fuel:octane_95': 'yes', 'fuel:lpg': 'yes', toilets: 'yes', phone: '+40 21 123 4567', 'addr:street': 'Bulevardul Unirii', 'addr:housenumber': '10', website: 'petrom.ro' } },
    { type: 'way', id: 1002, center: { lat: 44.4300, lon: 26.1100 }, tags: { shop: 'car_repair', name: 'Auto Rapid Service', opening_hours: 'Mo-Fr 08:00-18:00; Sa 09:00-14:00; Su off', phone: '0722 111 222;021 345 6789', 'service:vehicle:oil_change': 'yes', 'service:vehicle:brakes': 'yes', 'service:vehicle:diagnostics': 'yes', 'addr:street': 'Strada Ion Câmpineanu', 'addr:housenumber': '5', website: 'https://autorapid.example' } },
    { type: 'node', id: 1003, lat: 44.4350, lon: 26.0950, tags: { shop: 'tyres', name: 'Vulcanizare Non-Stop Dristor', opening_hours: '24/7', phone: '0733 555 666', 'service:vehicle:tyres': 'yes', 'service:vehicle:tyre_repair': 'yes', 'service:vehicle:wheel_balancing': 'yes' } },
    { type: 'node', id: 1004, lat: 44.4400, lon: 26.1200, tags: { amenity: 'car_wash', name: 'Self Wash Floreasca', self_service: 'yes', vacuum_cleaner: 'yes', opening_hours: 'sunrise-sunset' } },
    { type: 'node', id: 1005, lat: 44.4200, lon: 26.0900, tags: { shop: 'car_parts', name: 'Piese Auto Centrale', opening_hours: 'Mo-Fr 09:00-19:00', phone: '021 222 3333' } },
    { type: 'node', id: 1006, lat: 44.4450, lon: 26.0800, tags: { amenity: 'fuel', brand: 'MOL' } },
    /* același loc mapat de două ori: trebuie să rămână unul */
    { type: 'node', id: 1007, lat: 44.4500, lon: 26.0700, tags: { amenity: 'fuel', name: 'OMV Băneasa' } },
    { type: 'way', id: 1008, center: { lat: 44.45003, lon: 26.07004 }, tags: { amenity: 'fuel', name: 'OMV Băneasa', opening_hours: '24/7', phone: '0744 000 111' } },
    /* nume cu cod HTML: nu are voie să se execute */
    { type: 'node', id: 1010, lat: 44.4100, lon: 26.0600, tags: { shop: 'car_repair', name: 'Service <img src=x onerror=window.__xss=1> "Șt" & Co', opening_hours: 'Mo-Fr 08:00-17:00' } },
    /* nu e loc auto și nu are coordonate: se ignoră */
    { type: 'node', id: 1011, lat: 44.4000, lon: 26.0500, tags: { shop: 'bakery', name: 'Pâine caldă' } },
    { type: 'relation', id: 1012, tags: { shop: 'tyres', name: 'Fără coordonate' } }
  ];
  /* un mănunchi de 12 locuri la câțiva metri unul de altul: se strâng într-un grup pe hartă */
  const types = [{ amenity: 'fuel' }, { shop: 'car_repair' }, { shop: 'tyres' }, { amenity: 'car_wash' }, { shop: 'car_parts' }];
  for (let i = 0; i < 12; i++) {
    els.push({ type: 'node', id: 1100 + i, lat: 44.4150 + (i % 4) * 0.00012, lon: 26.1500 + Math.floor(i / 4) * 0.00016, tags: Object.assign({ name: 'Grup ' + 'ABCDEFGHIJKL'[i], opening_hours: 'Mo-Su 08:00-20:00' }, types[i % 5]) });
  }
  return els;
}
function knownI() {
  return [
    { type: 'node', id: 2001, lat: 44.5300, lon: 26.1400, tags: { amenity: 'fuel', name: 'Rompetrol Otopeni', opening_hours: '24/7', 'addr:city': 'Otopeni', phone: '+40 21 555 0101' } },
    { type: 'node', id: 2002, lat: 44.4600, lon: 26.2000, tags: { shop: 'car_repair', name: 'Service Pantelimon', opening_hours: 'Mo-Fr 08:00-17:00', 'addr:city': 'Pantelimon' } },
    { type: 'way', id: 2003, center: { lat: 44.3850, lon: 26.1750 }, tags: { shop: 'tyres', name: 'Vulcanizare Popești', opening_hours: 'Mo-Sa 08:00-20:00', 'addr:city': 'Popești-Leordeni' } },
    { type: 'node', id: 2004, lat: 44.4700, lon: 25.9800, tags: { amenity: 'car_wash', name: 'Spălătorie Chiajna', automated: 'yes', opening_hours: '24/7' } }
  ];
}

const NAMES = {
  fuel: ['Petrom', 'OMV', 'MOL', 'Rompetrol', 'Lukoil', 'Socar', 'Gazprom'],
  car_repair: ['Auto Service', 'Mecanic Rapid', 'Atelier Auto', 'Service Prompt', 'AutoFix', 'Garaj Pro'],
  tyres: ['Vulcanizare Express', 'Anvelope Plus', 'Roți Sigure', 'Vulcanizare Non-Stop'],
  car_wash: ['Spălătorie Auto', 'Self Wash', 'Auto Spa', 'Splash'],
  car_parts: ['Piese Auto', 'Auto Parts', 'Depozit Piese', 'Autodoc Local']
};
const HOURS = ['Mo-Fr 08:00-18:00; Sa 09:00-14:00; Su off', 'Mo-Su 08:00-20:00', '24/7', 'Mo-Fr 09:00-17:00', 'Mo-Sa 07:00-22:00; Su 08:00-20:00', 'Mo-Fr 08:00-12:00,13:00-18:00', '', '', 'sunrise-sunset'];

/* multe locuri la întâmplare, ca să măsurăm cât de repede merge harta */
function bulk(zone, n, seed) {
  const r = rng(seed), out = [];
  const box = zone === 'b' ? [44.35, 25.98, 44.54, 26.22] : [44.20, 25.75, 44.75, 26.45];
  const kinds = [['fuel', 0.15], ['car_repair', 0.4], ['tyres', 0.12], ['car_wash', 0.13], ['car_parts', 0.2]];
  for (let i = 0; i < n; i++) {
    let u = r(), kind = 'car_repair';
    for (const k of kinds) { if (u < k[1]) { kind = k[0]; break; } u -= k[1]; }
    const g = (r() + r() + r()) / 3;   // mai dese spre mijloc
    const lat = box[0] + (box[2] - box[0]) * (zone === 'b' ? g : r()), lon = box[1] + (box[3] - box[1]) * (zone === 'b' ? (r() + r()) / 2 : r());
    const tags = {};
    if (kind === 'fuel') tags.amenity = 'fuel'; else if (kind === 'car_wash') tags.amenity = 'car_wash'; else tags.shop = kind;
    const nm = NAMES[kind][Math.floor(r() * NAMES[kind].length)];
    if (r() > 0.1) tags.name = nm + ' ' + (1 + Math.floor(r() * 90));
    const h = HOURS[Math.floor(r() * HOURS.length)];
    if (h) tags.opening_hours = h;
    if (r() > 0.4) tags.phone = '07' + (20 + Math.floor(r() * 50)) + ' ' + (100 + Math.floor(r() * 900)) + ' ' + (100 + Math.floor(r() * 900));
    if (kind === 'fuel' && r() > 0.3) { tags['fuel:diesel'] = 'yes'; tags['fuel:octane_95'] = 'yes'; }
    out.push({ type: r() > 0.7 ? 'way' : 'node', id: (zone === 'b' ? 5000000 : 7000000) + i, lat, lon, center: { lat, lon }, tags });
  }
  return out;
}

module.exports = { knownB, knownI, bulk, rng };
