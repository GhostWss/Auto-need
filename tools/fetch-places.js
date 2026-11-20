/* Descarcă din OpenStreetMap locurile pentru București și Ilfov și le scrie în data/places.json,
   fișierul din care își ia aplicația locurile (rapid, fără să depindă de serverele Overpass).

   Rulează singur în fiecare noapte, într-o acțiune GitHub (.github/workflows/actualizeaza-locuri.yml).
   De mână: node tools/fetch-places.js   (Node 18 sau mai nou). */
'use strict';
const fs = require('fs');
const path = require('path');
const OSM = require('../js/osm.js');

const OUT = path.join(__dirname, '..', 'data', 'places.json');
const MIN = process.env.PLACES_MIN ? { b: +process.env.PLACES_MIN, i: +process.env.PLACES_MIN } : { b: 300, i: 100 };   // sub atâtea locuri, ceva nu e în regulă
const ROUNDS = +process.env.PLACES_ROUNDS || 5, PAUSE = process.env.PLACES_PAUSE !== undefined ? +process.env.PLACES_PAUSE : 60000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
/* serverele publice Overpass cer să te prezinți; și vrem să aflăm, din rezumatul rulării, ce a răspuns fiecare */
OSM.CONFIG.headers = { 'User-Agent': 'harta-auto/1.0 (+https://github.com/GhostWss/Auto-need)' };
const trace = [];
OSM.CONFIG.log = (ep, what) => { const line = new URL(ep).host + ': ' + what; trace.push(line); console.log('  ' + line); };
/* în fișier intră câmpurile de bază ale fiecărui loc, plus cele rare (descriere, e-mail, Facebook, Instagram, servicii deduse) doar când locul le are */
const RARE = ['d', 'e', 'fb', 'ig', 'sd'];
const strip = p => {
  const o = { id: p.id, t: p.t, n: p.n, z: p.z, a: p.a, lat: p.lat, lon: p.lon, h: p.h, tel: p.tel, w: p.w, sv: p.sv, b: p.b };
  RARE.forEach(k => { if (p[k] && p[k].length) o[k] = p[k]; });
  return o;
};
const byId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

async function loadZone(z) {
  let last;
  for (let round = 1; round <= ROUNDS; round++) {
    const info = {};
    try {
      const places = await OSM.load(z, info);
      if (places.length >= MIN[z]) {
        console.log(OSM.ZONES[z].name + ': ' + places.length + ' locuri (de la ' + new URL(info.endpoint).host + ')');
        return { places, info };
      }
      last = new Error('Prea puține locuri în ' + OSM.ZONES[z].name + ': ' + places.length + ' (minim ' + MIN[z] + ')');
    } catch (e) { last = e; }
    console.log('Încercarea ' + round + ' din ' + ROUNDS + ' pentru ' + OSM.ZONES[z].name + ' n-a mers: ' + (last && last.message));
    console.log('::warning title=Încercarea ' + round + ' pentru ' + OSM.ZONES[z].name + '::' + trace.slice(-4).join(' | '));
    if (round < ROUNDS) await sleep(PAUSE);
  }
  throw last;
}

(async () => {
  const zones = {}, stamps = [];
  for (const z of ['b', 'i']) {
    const { places, info } = await loadZone(z);
    zones[z] = places.map(strip).sort(byId);
    stamps.push(info.ts);
  }
  let old = null;
  try { old = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) {}
  if (old && JSON.stringify(old.zones) === JSON.stringify(zones)) { console.log('Locurile nu s-au schimbat, las fișierul cum e.'); return; }
  const ts = Math.min.apply(null, stamps);
  const out = { v: 1, ts: ts, osm: new Date(ts).toISOString().replace(/\.\d+Z$/, 'Z'), zones: zones };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out) + '\n');
  console.log('Scris ' + path.relative(process.cwd(), OUT) + ': ' + zones.b.length + ' în București, ' + zones.i.length + ' în Ilfov (date OpenStreetMap din ' + out.osm + ').');
})().catch(e => {
  const msg = 'Nu am putut actualiza locurile: ' + (e && e.message) + ' (' + trace.slice(-4).join(' | ') + ').';
  /* Overpass e deseori aglomerat. Cât timp fișierul de acum e recent, aplicația merge bine cu el, deci nu dau eroare
     (ca să nu primești în fiecare noapte un e-mail de la GitHub). Dacă fișierul s-a învechit, eroarea apare. */
  let age = Infinity;
  try { age = Date.now() - JSON.parse(fs.readFileSync(OUT, 'utf8')).ts; } catch (x) {}
  if (age < 6 * 864e5) { console.log('::warning::' + msg + ' Las fișierul de acum (are ' + Math.round(age / 36e5) + ' ore).'); return; }
  console.log('::error::' + msg);
  process.exit(1);
});
