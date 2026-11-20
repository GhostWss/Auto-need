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

  /* Servere Overpass publice. Cererile pornesc eșalonat (vezi `race`) și câștigă primul răspuns bun,
     așa că un server căzut sau aglomerat nu mai blochează încărcarea. */
  var ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.openstreetmap.fr/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'
  ];
  /* hedge: după câte ms pornește și al doilea server dacă primul nu a răspuns; timeout: cât așteptăm un răspuns;
     cool: cât timp un server care a picat rămâne la coadă. headers și log sunt pentru scriptul de noapte (Node):
     antete în plus (User-Agent) și o funcție care află ce a răspuns fiecare server. */
  var CONFIG = { hedge: 6000, timeout: 40000, cool: 10 * 60 * 1000, headers: null, log: null };
  var cool = {}, good = null;

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
    return '[out:json][timeout:40];area["ISO3166-2"="' + ZONES[zone].iso + '"]->.a;(' + body + ');out center tags qt;';
  }
  function queryBox(zone) {
    var box = ZONES[zone].box.join(',');
    var body = FILTERS.map(function (f) { return 'nwr' + f + '(' + box + ');'; }).join('');
    return '[out:json][timeout:40];(' + body + ');out center tags qt;';
  }

  /* etichetele serviciilor, pe categorii (codurile nu se schimbă: serviciile completate de oameni pe telefon le folosesc) */
  var SVC = {
    benz: { b95: 'Benzină 95', bp: 'Benzină premium', ben: 'Benzină', mot: 'Motorină', motp: 'Motorină premium', gpl: 'GPL', gnc: 'GNC (CNG)', e85: 'E85', adblue: 'AdBlue', ev: 'Încărcare electrică', mag: 'Magazin', cafea: 'Cafea', aer: 'Aer pentru roți', wc: 'Toaletă', spalare: 'Spălătorie', nonstop: 'Non-stop' },
    service: { ulei: 'Schimb ulei', geo: 'Geometrie roți', diag: 'Diagnoză computerizată', frane: 'Frâne', distr: 'Distribuție', clima: 'Climatizare', elec: 'Electrică și baterii', evac: 'Evacuare', tinich: 'Tinichigerie și vopsitorie', parbriz: 'Parbrize', anv: 'Anvelope', general: 'Reparații generale', itp: 'ITP', cutie: 'Cutie de viteze', susp: 'Suspensie', motor: 'Motor', rev: 'Revizii', tract: 'Tractări', autor: 'Service autorizat', piese: 'Vânzare piese', camioane: 'Camioane', detail: 'Detailing', nonstop: 'Non-stop' },
    vulc: { montaj: 'Montat și demontat roți', echil: 'Echilibrare', pana: 'Reparat pană', schimb: 'Schimb anvelope', hotel: 'Hotel de anvelope', jante: 'Îndreptat jante', geo: 'Geometrie roți', vanzare: 'Vânzare anvelope', nonstop: 'Non-stop' },
    spal: { ext: 'Spălare exterioară', int: 'Spălare interioară', detail: 'Detailing', self: 'Self-service', auto: 'Spălare automată', asp: 'Aspirare', polish: 'Ceară și polish', camioane: 'Camioane', nonstop: 'Non-stop' },
    piese: { noi: 'Piese noi', sh: 'Piese second-hand', ulei: 'Uleiuri și lichide', baterii: 'Baterii', anv: 'Anvelope', acc: 'Accesorii', livrare: 'Livrare' }
  };
  /* la toate categoriile: cum se plătește și Wi-Fi */
  var EXTRA = { card: 'Plată cu cardul', cash: 'Plată cash', wifi: 'Wi-Fi' };
  Object.keys(SVC).forEach(function (t) { Object.keys(EXTRA).forEach(function (c) { SVC[t][c] = EXTRA[c]; }); });

  /* Ce scrie în numele sau descrierea locului. Se caută pe text fără diacritice, cu cuvinte separate prin spațiu.
     Ce iese de aici nu e o etichetă OpenStreetMap, ci o deducere din text: se păstrează separat (câmpul `sd`) și se arată altfel. */
  var WORDS = {
    service: [
      ['tinich', /tinichigeri|vopsitori|caroseri|body ?shop/], ['parbriz', /parbriz|autoglass|geamuri auto|lunet/],
      ['itp', /\bitp\b|\bi t p\b|inspectie tehnica/], ['clima', /climatiz|freon|aer conditionat/],
      ['geo', /geometri|reglaj directi|alinier/], ['elec', /electric|electron|\becu\b/],
      ['diag', /diagnoz|diagnostic|testar\w* computeriz|\bobd\b/], ['tract', /tractar|remorcar|asistenta rutiera/],
      ['anv', /vulcaniz|anvelop|\btyres?\b|\btires?\b|service roti|reparatii roti/], ['autor', /autorizat|\bdealer/],
      ['camioane', /camion|\btrucks?\b|\btir\b|autotractoare/], ['frane', /\bfrane\b|\bbrakes?\b/],
      ['piese', /\bpiese\b|\bparts\b/], ['cutie', /cutii? de viteze|cutia de viteze|transmisi/],
      ['susp', /suspensi|amortizoare/], ['evac', /esapament|\btobe\b|catalizator/],
      ['rev', /revizi|intretinere periodica|mentenanta/], ['detail', /detailing/],
      ['general', /mecanic|reparatii|atelier|\brepair/]
    ],
    vulc: [
      ['echil', /echilibr|balansar/], ['geo', /geometri/], ['hotel', /hotel de anvelope|hotel anvelope|depozitare anvelope/],
      ['jante', /\bjante\b|\bjanta\b/], ['vanzare', /vanzar|vindem|anvelope noi|second hand/],
      ['pana', /reparat\w* pana|reparati\w* pana|petic|\bpene\b/], ['montaj', /montaj|demontaj|schimb\w* (de )?(roti|anvelop)|service roti/]
    ],
    spal: [
      ['self', /self ?service|self wash|autoservire/], ['auto', /automat|tunel|touchless|fara contact/],
      ['asp', /aspirat|aspirator|vacuum/], ['detail', /detailing/], ['ext', /exterior/], ['int', /interior/],
      ['polish', /polish|ceara|ceramic|cerar/], ['camioane', /camion|\btir\b|\btruck/]
    ],
    piese: [
      ['sh', /second hand|dezmembr|uzate/], ['ulei', /\bulei|lichide/], ['baterii', /baterii|acumulator/],
      ['anv', /anvelop|\btyre|\btire/], ['acc', /accesorii/], ['livrare', /livrare|curier/], ['noi', /piese noi|originale/]
    ],
    benz: []
  };
  /* ce spune în `service=` / `services=` (liste cu „;” sau „,”) */
  var SERVICE_TAG = {
    service: { repair: 'general', repairs: 'general', parts: 'piese', tyres: 'anv', tyre: 'anv', glass: 'parbriz', dealer: 'autor', electrical: 'elec', body: 'tinich', bodywork: 'tinich', painting: 'tinich', inspection: 'itp', towing: 'tract' },
    vulc: { tyres: 'schimb', tyre: 'schimb' }
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

  /* servicii scrise în etichete (cele sigure). Etichetele `service:vehicle:*` sunt scrise în practică în mai multe feluri
     (alignment / wheel_alignment, batteries / battery, repairs / car_repair...), așa că le luăm pe toate. */
  function servicesFor(type, tags, nonstop) {
    var sv = [];
    function add(c) { if (sv.indexOf(c) < 0 && SVC[type][c]) sv.push(c); }
    var V = function () {
      for (var i = 0; i < arguments.length; i++) if (yes(tags['service:vehicle:' + arguments[i]])) return true;
      return false;
    };
    if (type === 'benz') {
      if (yes(tags['fuel:octane_95'])) add('b95');
      if (yes(tags['fuel:octane_98']) || yes(tags['fuel:octane_100']) || yes(tags['fuel:octane_102'])) add('bp');
      if (!sv.length && (yes(tags['fuel:gasoline']) || yes(tags['fuel:octane']) || yes(tags['fuel:e10']))) add('ben');
      if (yes(tags['fuel:diesel'])) add('mot');
      if (yes(tags['fuel:GTL_diesel']) || yes(tags['fuel:diesel:class2'])) add('motp');
      if (yes(tags['fuel:lpg'])) add('gpl');
      if (yes(tags['fuel:cng'])) add('gnc');
      if (yes(tags['fuel:e85'])) add('e85');
      if (yes(tags['fuel:adblue'])) add('adblue');
      if (yes(tags['fuel:electricity'])) add('ev');
      if (yes(tags.compressed_air)) add('aer');
      if (yes(tags.toilets)) add('wc');
      if (yes(tags.car_wash)) add('spalare');
    } else if (type === 'service') {
      if (V('oil_change', 'oil_filter_change')) add('ulei');
      if (V('wheel_alignment', 'alignment')) add('geo');
      if (V('diagnostics')) add('diag');
      if (V('brakes')) add('frane');
      if (V('air_conditioning')) add('clima');
      if (V('electrical', 'battery', 'batteries')) add('elec');
      if (V('exhaust')) add('evac');
      if (V('body_repair', 'painting')) add('tinich');
      if (V('glass')) add('parbriz');
      if (V('tyres', 'tyre_repair', 'wheels', 'wheel_balancing')) add('anv');
      if (V('car_repair', 'repairs', 'repair')) add('general');
      if (V('inspection', 'statie_itp')) add('itp');
      if (V('transmission', 'transmission_repair')) add('cutie');
      if (V('suspension')) add('susp');
      if (V('motor', 'engine')) add('motor');
      if (V('maintenance')) add('rev');
      if (V('truck_repair')) add('camioane');
      if (V('car_parts')) add('piese');
      if (V('detailing', 'car_care')) add('detail');
    } else if (type === 'vulc') {
      if (V('tyres')) add('schimb');
      if (V('tyre_repair', 'tyre_puncture')) add('pana');
      if (V('wheel_balancing', 'balancing')) add('echil');
      if (V('wheel_alignment', 'alignment')) add('geo');
      if (V('wheels')) add('montaj');
      if (V('tyres_sale', 'new_tyres')) add('vanzare');
    } else if (type === 'spal') {
      if (yes(tags.self_service) || tags.self_service === 'only') add('self');
      if (yes(tags.automated)) add('auto');
      if (yes(tags.vacuum_cleaner) || yes(tags.vacuum)) add('asp');
      if (yes(tags.hgv) || tags.hgv === 'only') add('camioane');
    } else if (type === 'piese') {
      if (tags.second_hand === 'yes' || tags.second_hand === 'only') add('sh');
      if (yes(tags.delivery)) add('livrare');
      if (V('tyres')) add('anv');
    }
    /* service= / services= : „repair;parts;tyres” */
    var map = SERVICE_TAG[type];
    if (map) {
      [tags.service, tags.services].forEach(function (v) {
        if (typeof v !== 'string') return;
        v.split(/[;,]/).forEach(function (x) { var c = map[x.trim().toLowerCase()]; if (c) add(c); });
      });
    }
    /* cum se plătește, Wi-Fi */
    var cards = ['credit_cards', 'debit_cards', 'cards', 'visa', 'mastercard', 'maestro', 'account_cards', 'visa_debit', 'visa_electron', 'contactless', 'nfc', 'apple_pay', 'google_pay', 'mastercard_contactless'];
    if (cards.some(function (k) { return yes(tags['payment:' + k]); })) add('card');
    if (yes(tags['payment:cash'])) add('cash');
    if (tags.internet_access === 'wlan' || tags.internet_access === 'wifi') add('wifi');
    if (nonstop && SVC[type].nonstop) add('nonstop');
    return sv;
  }

  /* text -> cuvinte mici, fără diacritice, separate prin spațiu */
  function words(s) {
    return ' ' + String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  }
  /* Ce se poate deduce din descriere și din nume, fără ce știm deja din etichete. */
  function derivedFor(type, name, desc, have) {
    var rules = WORDS[type] || [], out = [];
    if (!rules.length) return out;
    var text = words(desc) + ' ' + words(name);
    rules.forEach(function (r) {
      if (have.indexOf(r[0]) < 0 && out.indexOf(r[0]) < 0 && r[1].test(text) && SVC[type][r[0]]) out.push(r[0]);
    });
    return out;
  }

  /* descrierea scrisă de cine a cartografiat locul: curățată, fără MAJUSCULE întregi, nu prea lungă */
  function descOf(tags, name) {
    var d = clean(tags['description:ro']) || clean(tags.description);
    if (d.length < 8 || /^hotspot\b/i.test(d)) return '';
    if (d === d.toUpperCase() && d !== d.toLowerCase()) {
      d = d.toLowerCase().replace(/(^|[.!?]\s+)(\S)/g, function (m, a, b) { return a + b.toUpperCase(); });
      d = d.charAt(0).toUpperCase() + d.slice(1);
    }
    d = d.replace(/^[-–•*\s]+/, '');
    if (d.length > 500) d = d.slice(0, 500).replace(/\s+\S*$/, '') + '…';
    return d === name ? '' : d;
  }

  function emailOf(tags) {
    var e = clean(tags['contact:email']) || clean(tags.email);
    e = e.split(/[;,\s]/)[0];
    return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(e) && e.length <= 80 ? e : '';
  }
  /* pagină de Facebook / Instagram: adresă întreagă sau doar numele paginii; întoarce mereu o adresă https de pe site-ul respectiv */
  function socialOf(raw, hosts, base) {
    var v = clean(raw).split(/[;,]/)[0].trim();
    if (!v || /\s/.test(v)) return '';   /* un nume de pagină nu are spații */
    var m = /^(?:https?:\/\/)?(?:(?:www|m|mobile|web)\.)?([a-z0-9-]+\.[a-z]{2,3})(\/[^\s"'<>]*)?$/i.exec(v);
    if (m && hosts.indexOf(m[1].toLowerCase()) >= 0) {
      var path = m[2] || '';
      return path.length > 1 ? (base + path.slice(1)).slice(0, 200) : '';
    }
    if (/^https?:\/\//i.test(v)) return '';   /* altă adresă: nu e o pagină de rețea socială */
    v = v.replace(/^@/, '');
    return /^[A-Za-z0-9._-]{2,60}$/.test(v) ? base + v : '';
  }
  function facebookOf(tags) { return socialOf(tags['contact:facebook'] || tags.facebook || tags['brand:facebook'], ['facebook.com', 'fb.com'], 'https://www.facebook.com/'); }
  function instagramOf(tags) { return socialOf(tags['contact:instagram'] || tags.instagram || tags['brand:instagram'], ['instagram.com'], 'https://www.instagram.com/'); }

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
    var raw = [tags.phone, tags['contact:phone'], tags.mobile, tags['contact:mobile'], tags['phone:mobile']];
    if (typeof tags.contact === 'string' && /^\+?[\d][\d\s().\-;,]{6,}$/.test(tags.contact.trim())) raw.push(tags.contact);   /* uneori telefonul e scris în `contact` */
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
      var desc = descOf(tags, name);
      var sv = servicesFor(t, tags, /^24\s*\/\s*7$/.test(h));
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
        sv: sv,
        b: brand,
        d: desc,
        e: emailOf(tags),
        fb: facebookOf(tags),
        ig: instagramOf(tags),
        sd: derivedFor(t, name === brand ? '' : name, desc, sv),
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

  function post(endpoint, q, timeout, ctrl) {
    ctrl = ctrl || (typeof AbortController !== 'undefined' ? new AbortController() : null);
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeout) : null;
    var done = function () { if (timer) clearTimeout(timer); };
    return fetch(endpoint, {
      method: 'POST',
      body: 'data=' + encodeURIComponent(q),
      headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }, CONFIG.headers || {}),
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

  /* Cere aceeași interogare de la mai multe servere: pornește primul, iar dacă pică sau nu răspunde în
     CONFIG.hedge ms pornește și următorul. Câștigă primul răspuns bun, iar celelalte cereri se opresc.
     `valid(json)` fals = „serverul n-are zona”: oprește totul și raportează `empty`, ca să se treacă la dreptunghi.
     Serverele care au picat rămân la coadă CONFIG.cool ms; cel care a răspuns ultima dată merge primul. */
  function race(q, valid) {
    return new Promise(function (resolve, reject) {
      var now = Date.now();
      var isCool = function (e) { return !!cool[e] && now - cool[e] < CONFIG.cool; };
      var list = ENDPOINTS.filter(function (e) { return !isCool(e); }).concat(ENDPOINTS.filter(isCool));
      if (good && list.indexOf(good) > 0 && !isCool(good)) { list.splice(list.indexOf(good), 1); list.unshift(good); }
      var started = 0, active = 0, finished = false, timer = null, lastErr = null, ctrls = [];
      function end(fn, value) {
        if (finished) return;
        finished = true; clearTimeout(timer);
        ctrls.forEach(function (c) { try { c.abort(); } catch (e) {} });
        fn(value);
      }
      function next() {
        clearTimeout(timer);
        if (finished || started >= list.length) return;
        var ep = list[started++];
        var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        if (ctrl) ctrls.push(ctrl);
        active++;
        post(ep, q, CONFIG.timeout, ctrl).then(function (j) {
          if (valid && !valid(j)) { var none = new Error('Zona nu a întors rezultate'); none.empty = true; throw none; }
          return j;
        }).then(function (j) {
          active--;
          if (CONFIG.log) CONFIG.log(ep, 'ok, ' + j.elements.length + ' elemente');
          good = ep; delete cool[ep];
          end(resolve, { j: j, ep: ep });
        }, function (err) {
          active--;
          if (finished) return;
          if (CONFIG.log) CONFIG.log(ep, (err && err.empty) ? 'fără rezultate' : 'eroare: ' + (err && (err.name === 'AbortError' ? 'nu a răspuns la timp' : err.message)));
          lastErr = err;
          if (err && err.empty) { end(reject, err); return; }
          cool[ep] = Date.now();
          if (started < list.length) next();
          else if (active === 0) end(reject, lastErr || new Error('Nu am putut încărca datele'));
        });
        if (!finished && started < list.length) timer = setTimeout(next, CONFIG.hedge);
      }
      next();
    });
  }

  /* Încarcă o zonă: întâi după limitele administrative, apoi (dacă zona nu s-a găsit) după dreptunghi.
     `info`, dacă e dat, primește `ts` (momentul datelor din OpenStreetMap, în ms) și `endpoint`. */
  async function load(zone, info) {
    var has = function (j) { return j.elements.length > 0; };
    var got;
    try {
      got = await race(query(zone), has);
    } catch (err) {
      if (!(err && err.empty)) throw err;   /* serverele nu răspund: același lucru cerut altfel nu ajută */
      got = await race(queryBox(zone), has);
    }
    if (info) {
      var base = got.j.osm3s ? Date.parse(got.j.osm3s.timestamp_osm_base) : NaN;
      info.ts = isFinite(base) ? base : Date.now();
      info.endpoint = got.ep;
    }
    return normalize(got.j.elements, zone);
  }

  return {
    ZONES: ZONES, ENDPOINTS: ENDPOINTS, CONFIG: CONFIG, SVC: SVC,
    query: query, queryBox: queryBox, classify: classify, normalize: normalize,
    fmtPhone: fmtPhone, osmUrl: osmUrl, osmEditUrl: osmEditUrl, load: load, post: post, race: race,
    reset: function () { cool = {}; good = null; }
  };
});
