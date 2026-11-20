/* Program (opening_hours din OpenStreetMap) -> orar săptămânal + „deschis acum”.
   Înțelege forma uzuală: "Mo-Fr 08:00-18:00; Sa 09:00-14:00; Su off", "24/7",
   liste de zile și intervale, program peste miezul nopții. Ce nu înțelege
   (sărbători, luni, răsărit/apus) întoarce null, ca să nu afișăm ceva greșit. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HAHours = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY_IDX = { mo: 0, tu: 1, we: 2, th: 3, fr: 4, sa: 5, su: 6 };
  var DAYS = ['Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri', 'Sâmbătă', 'Duminică'];
  var DAYS_L = ['luni', 'marți', 'miercuri', 'joi', 'vineri', 'sâmbătă', 'duminică'];

  function isDay(t) { return Object.prototype.hasOwnProperty.call(DAY_IDX, t); }
  function isTime(t) { return /^\d{1,2}(:\d{2})?$/.test(t); }

  function toMin(t) {
    var m = /^(\d{1,2})(?::(\d{2}))?$/.exec(t);
    if (!m) return -1;
    var h = +m[1], mi = m[2] ? +m[2] : 0;
    if (h > 24 || mi > 59 || (h === 24 && mi > 0)) return -1;
    return h * 60 + mi;
  }

  function tokenize(seg) {
    var re = /\s*(24\/7|\d{1,2}:\d{2}|\d{1,2}|[A-Za-z]+|[-,+])/g, out = [], pos = 0, m;
    while ((m = re.exec(seg)) !== null) {
      if (m.index !== pos) return null;
      out.push(m[1].toLowerCase());
      pos = re.lastIndex;
    }
    if (seg.slice(pos).trim() !== '') return null;
    return out;
  }

  function dayRange(a, b) {
    var out = [], d = a;
    for (var i = 0; i < 7; i++) {
      out.push(d);
      if (d === b) break;
      d = (d + 1) % 7;
    }
    return out;
  }

  /* un segment (între ;) poate avea mai multe reguli adiționale despărțite prin virgulă */
  function parseSegment(seg) {
    var t = tokenize(seg);
    if (!t || !t.length) return null;
    var rules = [], i = 0, n = t.length;
    while (i < n) {
      var rule = { days: null, times: [], off: false, open: false, phsh: false, additive: rules.length > 0 };
      if (t[i] === '24/7') {
        rule.times.push([0, 1440]);
        i++;
      } else {
        /* selector de zile */
        var days = [], sawDay = false;
        for (;;) {
          var tk = t[i];
          if (isDay(tk)) {
            var d1 = DAY_IDX[tk]; i++;
            if (t[i] === '-' && isDay(t[i + 1])) {
              days = days.concat(dayRange(d1, DAY_IDX[t[i + 1]]));
              i += 2;
            } else days.push(d1);
            sawDay = true;
          } else if (tk === 'ph' || tk === 'sh') {
            rule.phsh = true; i++;
          } else break;
          if (t[i] === ',' && (isDay(t[i + 1]) || t[i + 1] === 'ph' || t[i + 1] === 'sh')) { i++; continue; }
          break;
        }
        if (days.length) rule.days = days;
        /* intervale orare */
        while (i < n && isTime(t[i])) {
          if (t[i + 1] !== '-' || !isTime(t[i + 2])) return null;
          var s = toMin(t[i]), e = toMin(t[i + 2]);
          if (s < 0 || e < 0) return null;
          rule.times.push([s, e]);
          i += 3;
          if (t[i] === ',' && isTime(t[i + 1])) i++;
          else break;
        }
        /* modificator */
        if (t[i] === 'off' || t[i] === 'closed') { rule.off = true; i++; }
        else if (t[i] === 'open') { rule.open = true; i++; }
        if (!sawDay && !rule.phsh && !rule.times.length && !rule.off && !rule.open) return null;
        if (sawDay && !rule.times.length && !rule.off && !rule.open) return null;
      }
      rules.push(rule);
      if (i >= n) break;
      if (t[i] === ',' && i + 1 < n) { i++; continue; }
      return null;
    }
    return rules;
  }

  function merge(list) {
    if (list.length < 2) return list;
    list.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    var out = [list[0].slice()];
    for (var i = 1; i < list.length; i++) {
      var last = out[out.length - 1];
      if (list[i][0] <= last[1]) { if (list[i][1] > last[1]) last[1] = list[i][1]; }
      else out.push(list[i].slice());
    }
    return out;
  }

  function build(rules) {
    var week = [[], [], [], [], [], [], []], spill = [];
    rules.forEach(function (r) {
      var days = r.days;
      if (!days) {
        if (r.phsh) return;
        days = [0, 1, 2, 3, 4, 5, 6];
      }
      days.forEach(function (d) {
        if (r.off) { if (!r.additive) week[d] = []; return; }
        if (r.times.length) {
          if (!r.additive) week[d] = [];
          r.times.forEach(function (tm) {
            var s = tm[0], e = tm[1];
            if (e > s) week[d].push([s, e]);
            else {
              week[d].push([s, 1440]);
              if (e > 0) spill.push([(d + 1) % 7, [0, e]]);
            }
          });
        } else if (r.open) week[d] = [[0, 1440]];
      });
    });
    spill.forEach(function (sp) { week[sp[0]].push(sp[1]); });
    var any = false;
    for (var d = 0; d < 7; d++) {
      week[d] = merge(week[d]);
      if (week[d].length) any = true;
    }
    return any ? { week: week } : null;
  }

  /* text OSM -> { week: [7][[start,end]...] } (minute din zi; luni = 0) sau null */
  function parse(raw) {
    if (!raw) return null;
    var s = String(raw).replace(/"[^"]*"/g, ' ').replace(/[–—]/g, '-');
    var bar = s.indexOf('||');
    if (bar >= 0) s = s.slice(0, bar);
    s = s.replace(/\s+/g, ' ').trim();
    if (!s) return null;
    var segs = s.split(';'), rules = [];
    for (var i = 0; i < segs.length; i++) {
      var seg = segs[i].trim();
      if (!seg) continue;
      var rs = parseSegment(seg);
      if (!rs) return null;
      rules = rules.concat(rs);
    }
    if (!rules.length) return null;
    return build(rules);
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  /* 1440 -> "24:00" */
  function fmt(min) { return pad(Math.floor(min / 60)) + ':' + pad(min % 60); }

  /* d = ziua (0 = luni), m = minutul din zi */
  function status(week, d, m) {
    var today = week[d], i;
    for (i = 0; i < today.length; i++) {
      var iv = today[i];
      if (m >= iv[0] && m < iv[1]) {
        var end = iv[1], off = 0;
        while (end === 1440 && off < 7) {
          var nd = week[(d + off + 1) % 7];
          if (nd.length && nd[0][0] === 0) { end = nd[0][1]; off++; } else break;
        }
        if (off >= 7) return { open: true, nonstop: true, text: 'non-stop' };
        var text;
        if (off === 0) text = 'până la ' + fmt(end);
        else if (off === 1) text = 'până mâine la ' + fmt(end);
        else text = 'până ' + DAYS_L[(d + off) % 7] + ' la ' + fmt(end);
        return { open: true, nonstop: false, text: text };
      }
    }
    for (i = 0; i < today.length; i++) {
      if (today[i][0] > m) return { open: false, text: 'se deschide la ' + fmt(today[i][0]) };
    }
    for (var k = 1; k <= 7; k++) {
      var dd = (d + k) % 7;
      if (week[dd].length) {
        var t = fmt(week[dd][0][0]);
        return { open: false, text: k === 1 ? 'se deschide mâine la ' + t : 'se deschide ' + DAYS_L[dd] + ' la ' + t };
      }
    }
    return { open: false, text: '' };
  }

  function fmtDay(ivs) {
    if (!ivs.length) return 'Închis';
    if (ivs.length === 1 && ivs[0][0] === 0 && ivs[0][1] === 1440) return 'Non-stop';
    return ivs.map(function (iv) { return fmt(iv[0]) + '–' + fmt(iv[1]); }).join(', ');
  }

  /* zile consecutive cu același program, pentru afișare */
  function groups(week) {
    var out = [], i = 0;
    while (i < 7) {
      var j = i, key = JSON.stringify(week[i]);
      while (j + 1 < 7 && JSON.stringify(week[j + 1]) === key) j++;
      out.push({ a: i, b: j, text: fmtDay(week[i]) });
      i = j + 1;
    }
    return out;
  }

  function isNonstop(week) {
    for (var d = 0; d < 7; d++) {
      if (week[d].length !== 1 || week[d][0][0] !== 0 || week[d][0][1] !== 1440) return false;
    }
    return true;
  }

  return { parse: parse, status: status, groups: groups, fmt: fmt, isNonstop: isNonstop, DAYS: DAYS, DAYS_L: DAYS_L };
});
