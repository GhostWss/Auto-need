/* Locurile din OpenStreetMap: interogare Overpass pentru București și Ilfov,
   apoi transformarea etichetelor OSM în categorii, servicii, program și telefon. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HAOsm = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ZONES = {
    b: { name: 'București', iso: 'RO-B', box: [44.30, 25.92, 44.58, 26.30] },
    i: { name: 'Ilfov', iso: 'RO-IF', box: [44.15, 25.70, 44.80, 26.50] }
  };

  /* Servere Overpass publice, încercate pe rând */
  var ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter'
  ];

  var FILTERS = [
    '["amenity"="fuel"]',
    '["amenity"="car_wash"]',
    '["shop"="car_repair"]',
    '["craft"="car_repair"]',
    '["shop"="tyres"]',
    '["shop"="car_parts"]'
  ];

  function query(zone) {
    var body = FILTERS.map(function (f) { return 'nwr' + f + '(area.a);'; }).join('');
    return '[out:json][timeout:90];area["ISO3166-2"="' + ZONES[zone].iso + '"]->.a;(' + body + ');out center tags qt;';
  }
  function queryBox(zone) {
    var box = ZONES[zone].box.join(',');
    var body = FILTERS.map(function (f) { return 'nwr' + f + '(' + box + ');'; }).join('');
    return '[out:json][timeout:90];(' + body + ');out center tags qt;';
  }

  /* etichetele serviciilor, pe categorii */
  var SVC = {
    benz: { b95: 'Benzină 95', bp: 'Benzină premium', mot: 'Motorină', motp: 'Motorină premium', gpl: 'GPL', gnc: 'GNC (CNG)', e85: 'E85', adblue: 'AdBlue', ev: 'Încărcare electrică', mag: 'Magazin', cafea: 'Cafea', aer: 'Aer pentru roți', wc: 'Toaletă', spalare: 'Spălătorie', nonstop: 'Non-stop' },
    service: { ulei: 'Schimb ulei', geo: 'Geometrie roți', diag: 'Diagnoză computerizată', frane: 'Frâne', distr: 'Distribuție', clima: 'Climatizare', elec: 'Electrică și baterii', evac: 'Evacuare', tinich: 'Tinichigerie și vopsitorie', parbriz: 'Parbrize', anv: 'Anvelope', general: 'Reparații generale', itp: 'ITP', nonstop: 'Non-stop' },
    vulc: { montaj: 'Montat și demontat roți', echil: 'Echilibrare', pana: 'Reparat pană', schimb: 'Schimb anvelope', hotel: 'Hotel de anvelope', jante: 'Îndreptat jante', geo: 'Geometrie roți', vanzare: 'Vânzare anvelope', nonstop: 'Non-stop' },
    spal: { ext: 'Spălare exterioară', int: 'Spălare interioară', detail: 'Detailing', self: 'Self-service', auto: 'Spălare automată', asp: 'Aspirare', polish: 'Ceară și polish', camioane: 'Camioane', nonstop: 'Non-stop' },
    piese: { noi: 'Piese noi', sh: 'Piese second-hand', ulei: 'Uleiuri și lichide', baterii: 'Baterii', anv: 'Anvelope', acc: 'Accesorii', livrare: 'Livrare' }
  };

  function clean(s) { return typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : ''; }
  function yes(v) { return v === 'yes' || v === 'true' || v === '1'; }
  function plain(s) {
    return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  function classify(tags) {
    var label = (tags.name || '') + ' ' + (tags.brand || '');
    if (tags.amenity === 'fuel') return 'benz';
    if (tags.amenity === 'car_wash') return 'spal';
    if (tags.shop === 'tyres') return 'vulc';
    if (tags.shop === 'car_repair' || tags.craft === 'car_repair') {
      if (/vulcaniz|anvelop/i.test(label)) return 'vulc';
      return 'service';
    }
    if (tags.shop === 'car_parts') return 'piese';
    return null;
  }

  function servicesFor(type, tags, nonstop) {
    var sv = [];
    function add(c) { if (sv.indexOf(c) < 0) sv.push(c); }
    var V = function (k) { return yes(tags['service:vehicle:' + k]); };
    if (type === 'benz') {
      if (yes(tags['fuel:octane_95'])) add('b95');
      if (yes(tags['fuel:octane_98']) || yes(tags['fuel:octane_100']) || yes(tags['fuel:octane_102'])) add('bp');
      if (yes(tags['fuel:diesel'])) add('mot');
      if (yes(tags['fuel:GTL_diesel']) || yes(tags['fuel:diesel:class2'])) add('motp');
      if (yes(tags['fuel:lpg'])) add('gpl');
      if (yes(tags['fuel:cng'])) add('gnc');
      if (yes(tags['fuel:e85'])) add('e85');
      if (yes(tags['fuel:adblue'])) add('adblue');
      if (yes(tags.compressed_air)) add('aer');
      if (yes(tags.toilets)) add('wc');
      if (yes(tags.car_wash)) add('spalare');
    } else if (type === 'service') {
      if (V('oil_change')) add('ulei');
      if (V('wheel_alignment')) add('geo');
      if (V('diagnostics')) add('diag');
      if (V('brakes')) add('frane');
      if (V('air_conditioning')) add('clima');
      if (V('electrical') || V('battery')) add('elec');
      if (V('exhaust')) add('evac');
      if (V('body_repair') || V('painting')) add('tinich');
      if (V('glass')) add('parbriz');
      if (V('tyres') || V('tyre_repair') || V('wheels')) add('anv');
      if (V('car_repair')) add('general');
      if (V('inspection')) add('itp');
    } else if (type === 'vulc') {
      if (V('tyres')) add('schimb');
      if (V('tyre_repair') || V('tyre_puncture')) add('pana');
      if (V('wheel_balancing') || V('balancing')) add('echil');
      if (V('wheel_alignment')) add('geo');
      if (V('wheels')) add('montaj');
      if (V('tyres_sale') || V('new_tyres')) add('vanzare');
    } else if (type === 'spal') {
      if (yes(tags.self_service)) add('self');
      if (yes(tags.automated)) add('auto');
      if (yes(tags.vacuum_cleaner) || yes(tags.vacuum)) add('asp');
      if (yes(tags.hgv)) add('camioane');
    } else if (type === 'piese') {
      if (tags.second_hand === 'yes' || tags.second_hand === 'only') add('sh');
      if (yes(tags.delivery)) add('livrare');
    }
    if (nonstop && SVC[type].nonstop) add('nonstop');
    return sv;
  }

  /* telefon: 0721 234 567 / 021 234 5678 + varianta pentru tel: */
  function fmtPhone(raw) {
    var s = clean(String(raw));
    var d = s.replace(/[^\d+]/g, '');
    if (d.replace(/\D/g, '').length < 5) return null;
    if (d.indexOf('00') === 0) d = '+' + d.slice(2);
    var nat = null;
    if (d.indexOf('+40') === 0) nat = '0' + d.slice(3);
    else if (/^40\d{9}$/.test(d)) nat = '0' + d.slice(2);
    else if (/^0\d{9}$/.test(d)) nat = d;
    if (nat && /^0\d{9}$/.test(nat)) {
      var cut = (nat.indexOf('021') === 0 || nat.indexOf('031') === 0) ? 3 : 4;
      return [nat.slice(0, cut) + ' ' + nat.slice(cut, cut + 3) + ' ' + nat.slice(cut + 3), '+40' + nat.slice(1)];
    }
    return [s, d];
  }

  function phonesOf(tags) {
    var raw = [tags.phone, tags['contact:phone'], tags.mobile, tags['contact:mobile']];
    var out = [], seen = {};
    raw.forEach(function (v) {
      if (!v) return;
      String(v).split(/[;,]/).forEach(function (x) {
        var p = fmtPhone(x);
        if (p && !seen[p[1]]) { seen[p[1]] = 1; out.push(p); }
      });
    });
    return out.slice(0, 3);
  }

  function websiteOf(tags) {
    var w = clean(tags.website) || clean(tags['contact:website']) || clean(tags.url);
    if (!w) return '';
    if (!/^https?:\/\//i.test(w)) {
      if (/^[a-z][a-z0-9+.\-]*:/i.test(w)) return '';
      w = 'https://' + w;
    }
    return w.length > 200 ? '' : w;
  }

  function addressOf(tags) {
    var street = clean(tags['addr:street']), num = clean(tags['addr:housenumber']);
    var line = street ? (num ? street + ' ' + num : street) : '';
    var area = clean(tags['addr:suburb']) || clean(tags['addr:village']) || clean(tags['addr:city']);
    if (line && area) return line + ', ' + area;
    return line || area;
  }

  function meters(a, b) {
    var dy = (a.lat - b.lat) * 111200;
    var dx = (a.lon - b.lon) * 111200 * Math.cos(a.lat * Math.PI / 180);
    return Math.sqrt(dx * dx + dy * dy);
  }

  /* același loc mapat de două ori (punct + clădire): îl păstrăm o singură dată */
  function dedupe(list) {
    list.sort(function (a, b) { return b.s - a.s; });
    var grid = {}, out = [];
    list.forEach(function (p) {
      var gx = Math.floor(p.lat / 0.0004), gy = Math.floor(p.lon / 0.0006), dup = false;
      var pn = plain(p.n);
      for (var dx = -1; dx <= 1 && !dup; dx++) {
        for (var dy = -1; dy <= 1 && !dup; dy++) {
          var arr = grid[(gx + dx) + ',' + (gy + dy)];
          if (!arr) continue;
          for (var i = 0; i < arr.length; i++) {
            var q = arr[i];
            if (q.t !== p.t || meters(p, q) > 45) continue;
            var qn = plain(q.n);
            if (!pn || !qn || pn === qn || pn.indexOf(qn) >= 0 || qn.indexOf(pn) >= 0) { dup = true; break; }
          }
        }
      }
      if (dup) return;
      out.push(p);
      var k = gx + ',' + gy;
      (grid[k] || (grid[k] = [])).push(p);
    });
    return out;
  }

  /* elemente Overpass -> locuri */
  function normalize(elements, zone) {
    var zoneName = ZONES[zone] ? ZONES[zone].name : '';
    var list = [];
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i], tags = el && el.tags;
      if (!tags) continue;
      var lat = el.lat, lon = el.lon;
      if (typeof lat !== 'number' && el.center) { lat = el.center.lat; lon = el.center.lon; }
      if (typeof lat !== 'number' || typeof lon !== 'number') continue;
      var t = classify(tags);
      if (!t) continue;
      if (tags.access === 'private' || tags.access === 'no' || tags.opening_hours === 'off') continue;
      var brand = clean(tags.brand);
      var name = clean(tags.name) || clean(tags['name:ro']) || brand || clean(tags.operator);
      var h = clean(tags.opening_hours);
      list.push({
        id: String(el.type || 'node').charAt(0) + el.id,
        t: t,
        n: name,
        z: zoneName,
        a: addressOf(tags),
        lat: Math.round(lat * 1e6) / 1e6,
        lon: Math.round(lon * 1e6) / 1e6,
        h: h,
        tel: phonesOf(tags),
        w: websiteOf(tags),
        sv: servicesFor(t, tags, /^24\s*\/\s*7$/.test(h)),
        b: brand,
        s: Object.keys(tags).length + (name ? 3 : 0)
      });
    }
    return dedupe(list);
  }

  function osmUrl(id) {
    var kind = { n: 'node', w: 'way', r: 'relation' }[id.charAt(0)] || 'node';
    return 'https://www.openstreetmap.org/' + kind + '/' + id.slice(1);
  }
  function osmEditUrl(id) {
    var kind = { n: 'node', w: 'way', r: 'relation' }[id.charAt(0)] || 'node';
    return 'https://www.openstreetmap.org/edit?' + kind + '=' + id.slice(1);
  }

  function post(endpoint, q, timeout) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeout) : null;
    var done = function () { if (timer) clearTimeout(timer); };
    return fetch(endpoint, {
      method: 'POST',
      body: 'data=' + encodeURIComponent(q),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      done();
      if (!j || !Array.isArray(j.elements)) throw new Error('Răspuns neașteptat');
      if (j.remark && !j.elements.length && /error|timed out|too much/i.test(j.remark)) throw new Error(j.remark);
      return j;
    }, function (e) { done(); throw e; });
  }

  /* Încarcă o zonă: întâi după limitele administrative, apoi (dacă nu merge) după dreptunghi. */
  async function load(zone) {
    var tries = [{ q: query(zone), strict: true }, { q: queryBox(zone), strict: false }];
    var lastErr = null;
    for (var a = 0; a < tries.length; a++) {
      for (var e = 0; e < ENDPOINTS.length; e++) {
        try {
          var j = await post(ENDPOINTS[e], tries[a].q, 35000);
          if (!j.elements.length && tries[a].strict) { var none = new Error('Zona nu a întors rezultate'); none.empty = true; throw none; }
          return normalize(j.elements, zone);
        } catch (err) {
          lastErr = err;
          if (err && err.empty) break;   /* zona nu există în interogarea pe limite: treci direct la dreptunghi */
        }
      }
    }
    throw lastErr || new Error('Nu am putut încărca datele');
  }

  return {
    ZONES: ZONES, ENDPOINTS: ENDPOINTS, SVC: SVC,
    query: query, queryBox: queryBox, classify: classify, normalize: normalize,
    fmtPhone: fmtPhone, osmUrl: osmUrl, osmEditUrl: osmEditUrl, load: load, post: post
  };
});
