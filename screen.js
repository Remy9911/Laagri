/* Laagri Karts — TV screen (AirConsole screen.html)
   Top-down party kart battle on real Laagri (Saue vald) streets.
   Map: OpenStreetMap contributors (ODbL), see laagri-data.js. */
(function () {
  "use strict";

  // ------------------------------------------------------------------ settings
  var CFG = {
    // The map is 1:1 real Laagri. Road half-width comes from the real street class (see roadHalf), karts are ~3 m long.
    VERGE: 3.2,        // pavement / grass shoulder you can drive on slowly before the fence (m)
    vmax: 20,          // top speed m/s (72 km/h)
    accel: 12,
    brake: 30,
    turn: 2.75,        // rad/s at speed
    grip: 7,           // lateral velocity decay 1/s
    offroad: 0.55,     // speed factor on the shoulder
    carR: 1.6,         // collision radius
    KS: 0.9,           // kart drawing scale (~4 m kart, a bit larger than life for the TV)
    turbo: { t: 1.7, mul: 1.45 },
    mega: { t: 3.2, mul: 1.6 },
    pad: { t: 0.9, mul: 1.35 },
    rescue: { t: 1.4, mul: 1.38, cd: 3.5 },   // automatic catch-up boost near the screen edge
    shieldT: 5,
    spinT: 1.15,
    rocketSpeed: 44,
    oilLife: 28,
    boxEvery: 180,     // m between ? box rows
    boxRespawn: 3.5,
    viewH: 74,         // metres visible vertically at zoom 1
    squeezeFrom: 12,   // s into a heat when the widest allowed view starts shrinking
    squeezeOver: 33,
    viewMin: 52,       // closest view (m visible vertically)
    viewWide: 125,     // widest view early in a heat (whole pack visible)
    viewTight: 56,     // widest view allowed at the end of the squeeze
    heatMax: 60,       // after this many seconds the leader takes the heat

    behindMax: 125,    // m behind the leader = out, even if still on screen
    heatPause: 3.2,
    countdown: 3.0,
    regridCountdown: 2.2
  };

  var TRACK_CFG = [
    { start: [180, -178] },   // Veskitammi Ring: grid on Veskitammi by Selver ABC, heading east
    { start: [-200, 163] },   // Express: grid on Hoiu, heading west
    { start: [-24, 250] }     // Kuuse Loop: grid on Vae, heading south
  ];

  var QS = (function () { var o = {}; location.search.replace(/[?&]([^=&]+)=?([^&]*)/g, function (m, k, v) { o[k] = decodeURIComponent(v || "1"); }); return o; })();
  var TEST = !!QS.test, AUTOPILOT = !!QS.autopilot, SIMSPEED = Math.max(1, Math.min(8, +QS.speed || 1));

  // ------------------------------------------------------------------ helpers
  var $ = function (id) { return document.getElementById(id); };
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function angNorm(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function fmtTime(s) { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2); }
  var esc = LK.escapeHtml;

  // ------------------------------------------------------------------ map decode
  var RAW = window.LAAGRI_RAW;
  function dec(s) {
    var a = s.split(",").map(Number), x = a[0], y = a[1], p = [[x, y]];
    for (var i = 2; i + 1 < a.length; i += 2) { x += a[i]; y += a[i + 1]; p.push([x, y]); }
    return p;
  }
  function rows(block) { return block.split("\n").filter(function (l) { return l.trim(); }).map(function (l) { return l.split("|"); }); }
  function bboxOf(pts) {
    var b = [1e9, 1e9, -1e9, -1e9];
    pts.forEach(function (p) { if (p[0] < b[0]) b[0] = p[0]; if (p[1] < b[1]) b[1] = p[1]; if (p[0] > b[2]) b[2] = p[0]; if (p[1] > b[3]) b[3] = p[1]; });
    return b;
  }
  function pathOf(pts, close) {
    var p = new Path2D();
    pts.forEach(function (q, i) { if (i) p.lineTo(q[0], q[1]); else p.moveTo(q[0], q[1]); });
    if (close) p.closePath();
    return p;
  }

  var ROAD_W = { T: 14, P: 12, S: 10, t: 7.6, u: 6.8, r: 6.2, l: 5.6, s: 4.8, k: 6 };   // real carriageway widths (m)
  var MAP = {
    roads: rows(RAW.roads).map(function (r) { var pts = dec(r[2]); return { c: r[0], name: r[1], pts: pts, bb: bboxOf(pts), path: pathOf(pts), w: ROAD_W[r[0]] || 6 }; }),
    buildings: rows(RAW.buildings).map(function (r) {
      var pts = dec(r[1]); var cx = 0, cy = 0; pts.forEach(function (p) { cx += p[0]; cy += p[1]; });
      return { k: r[0][0], lv: +r[0].slice(1) || 1, pts: pts, c: [cx / pts.length, cy / pts.length], bb: bboxOf(pts), path: pathOf(pts, true) };
    }),
    areas: rows(RAW.areas).map(function (r) { var pts = dec(r[1]); return { k: r[0], pts: pts, bb: bboxOf(pts), path: pathOf(pts, true) }; }),
    lines: rows(RAW.lines).map(function (r) { var pts = dec(r[1]); return { k: r[0], pts: pts, bb: bboxOf(pts), path: pathOf(pts) }; }),
    pois: rows(RAW.pois).map(function (r) { var xy = r[2].split(",").map(Number); return { name: r[0], type: r[1], x: xy[0], y: xy[1] }; })
  };
  // de-duplicate POI names close to each other
  (function () {
    var keep = [];
    MAP.pois.forEach(function (p) {
      if (/parcel_locker|construction/.test(p.type)) return;
      if (keep.some(function (q) { return q.name === p.name && Math.hypot(q.x - p.x, q.y - p.y) < 120; })) return;
      keep.push(p);
    });
    MAP.pois = keep;
  })();

  // ------------------------------------------------------------------ track build
  var T = null;  // current track geometry
  var TRACKS_RAW = RAW.tracks.map(function (t) { return { key: t[0], name: t[1], streets: t[2], pts: dec(t[3]) }; });

  function resampleClosed(pts, step) {
    var out = [], n = pts.length, carry = 0;
    for (var i = 0; i < n; i++) {
      var a = pts[i], b = pts[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      var d = carry;
      while (d < len) { out.push([a[0] + dx * d / len, a[1] + dy * d / len]); d += step; }
      carry = d - len;
    }
    return out;
  }
  function smoothClosed(pts, k, passes) {
    var n = pts.length;
    for (var p = 0; p < passes; p++) {
      var out = new Array(n);
      for (var i = 0; i < n; i++) {
        var sx = 0, sy = 0;
        for (var j = -k; j <= k; j++) { var q = pts[(i + j + n) % n]; sx += q[0]; sy += q[1]; }
        out[i] = [sx / (2 * k + 1), sy / (2 * k + 1)];
      }
      pts = out;
    }
    return pts;
  }

  var TRACK_CACHE = {};
  function buildTrack(ti) {
    if (TRACK_CACHE[ti]) { T = TRACK_CACHE[ti]; return T; }
    var raw = TRACKS_RAW[ti];
    var pts = resampleClosed(raw.pts, 2);
    pts = smoothClosed(pts, 3, 2);
    pts = resampleClosed(pts, 2);
    // rotate so index 0 is the start
    var st = TRACK_CFG[ti].start, bi = 0, bd = 1e18;
    pts.forEach(function (p, i) { var d = (p[0] - st[0]) * (p[0] - st[0]) + (p[1] - st[1]) * (p[1] - st[1]); if (d < bd) { bd = d; bi = i; } });
    pts = pts.slice(bi).concat(pts.slice(0, bi));
    var n = pts.length, tx = [], ty = [], nx = [], ny = [], s = [0], ang = [];
    for (var i = 0; i < n; i++) {
      var a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      tx.push(dx / l); ty.push(dy / l); nx.push(dy / l); ny.push(-dx / l);  // n = right-hand normal in screen coords
      ang.push(Math.atan2(dy, dx));
      if (i > 0) s.push(s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    }
    var L = s[n - 1] + Math.hypot(pts[0][0] - pts[n - 1][0], pts[0][1] - pts[n - 1][1]);
    // curvature: heading change over the next 30 m
    var curv = [];
    for (i = 0; i < n; i++) curv.push(angNorm(ang[(i + 15) % n] - ang[i]));
    // spatial grid of samples for global nearest lookups
    var G = 20, grid = {};
    pts.forEach(function (p, i) { var k = Math.floor(p[0] / G) + "," + Math.floor(p[1] / G); (grid[k] = grid[k] || []).push(i); });
    var tr = { ti: ti, name: raw.name, streets: raw.streets, pts: pts, n: n, tx: tx, ty: ty, nx: nx, ny: ny, s: s, L: L, ang: ang, curv: curv, grid: grid, G: G, bb: bboxOf(pts) };
    // real street under each sample -> name + half width
    var nm = [], hw = [];
    for (i = 0; i < n; i++) {
      var q = pts[i], best = null, bdist = 10;
      MAP.roads.forEach(function (rd) {
        if (rd.c === "s" || q[0] < rd.bb[0] - 10 || q[0] > rd.bb[2] + 10 || q[1] < rd.bb[1] - 10 || q[1] > rd.bb[3] + 10) return;
        for (var k = 0; k + 1 < rd.pts.length; k++) { var d = segDist(q[0], q[1], rd.pts[k], rd.pts[k + 1]); if (d < bdist) { bdist = d; best = rd; } }
      });
      nm.push(best && best.name ? best.name.replace(" — ", "–") : null);
      hw.push(best ? roadHalf(best.c) : 3.3);
    }
    for (i = 0; i < n; i++) if (!nm[i]) nm[i] = nm[(i - 1 + n) % n] || null;
    for (i = n - 1; i >= 0; i--) if (!nm[i]) nm[i] = nm[(i + 1) % n];
    // drop very short name flickers (< 16 m), e.g. at junctions
    var runs = [], rs = 0;
    for (i = 1; i <= n; i++) if (i === n || nm[i] !== nm[rs]) { runs.push([rs, i, nm[rs]]); rs = i; }
    runs.forEach(function (r, k) { if (r[1] - r[0] < 8 && runs.length > 2) { var prev = runs[(k - 1 + runs.length) % runs.length][2]; for (var j = r[0]; j < r[1]; j++) nm[j] = prev; } });
    var w = [];
    for (i = 0; i < n; i++) { var sum = 0; for (var k = -10; k <= 10; k++) sum += hw[(i + k + n) % n]; w.push(Math.max(3.3, sum / 21 + 0.4)); }
    tr.street = nm; tr.w = w;
    T = tr;
    decorateTrack(tr);
    TRACK_CACHE[ti] = tr;
    return tr;
  }

  // real carriageway half widths (m) by OSM road class
  function roadHalf(c) { return { T: 7, P: 6, S: 5, t: 3.8, u: 3.4, r: 3.1, l: 2.8, k: 3, s: 2.4 }[c] || 3.2; }
  function wallAt(i) { return T.w[i] + CFG.VERGE; }
  function nearestGlobal(x, y, maxR) {
    var G = T.G, gx = Math.floor(x / G), gy = Math.floor(y / G), r = Math.ceil((maxR || 40) / G), bi = -1, bd = 1e18;
    for (var i = -r; i <= r; i++) for (var j = -r; j <= r; j++) {
      var c = T.grid[(gx + i) + "," + (gy + j)]; if (!c) continue;
      for (var k = 0; k < c.length; k++) { var p = T.pts[c[k]], d = (p[0] - x) * (p[0] - x) + (p[1] - y) * (p[1] - y); if (d < bd) { bd = d; bi = c[k]; } }
    }
    return { i: bi, d: Math.sqrt(bd) };
  }
  function trackPoint(prog) {  // world point on the centre line at a progress value (m)
    var L = T.L, s = ((prog % L) + L) % L, i = Math.floor(s / 2) % T.n;
    while (i > 0 && T.s[i] > s) i--;
    while (i < T.n - 1 && T.s[i + 1] <= s) i++;
    var a = T.pts[i], b = T.pts[(i + 1) % T.n], seg = (i + 1 < T.n ? T.s[i + 1] : L) - T.s[i], f = seg > 0 ? (s - T.s[i]) / seg : 0;
    return { x: lerp(a[0], b[0], f), y: lerp(a[1], b[1], f), i: i, a: T.ang[i] };
  }

  // Everything that depends on the chosen track: hidden buildings, barriers, signs, boxes, pads, trees
  function decorateTrack(tr) {
    var wall = 7;  // typical fence distance, for decoration spacing
    tr.hidden = MAP.buildings.map(function (b) {
      var hide = false;
      var test = b.pts.concat([b.c]);
      for (var i = 0; i < test.length && !hide; i++) { var r = nearestGlobal(test[i][0], test[i][1], 40); if (r.i >= 0 && r.d < tr.w[r.i] + 1) hide = true; }
      return hide;
    });
    // barriers where side streets meet the fence
    tr.barriers = [];
    MAP.roads.forEach(function (rd) {
      var prev = null;
      for (var i = 0; i < rd.pts.length; i++) {
        var p = rd.pts[i], q = nearestGlobal(p[0], p[1], 60), d = q.i < 0 ? 999 : q.d - wallAt(q.i);
        if (prev && (prev.d > 0) !== (d > 0)) {
          // binary search for the crossing
          var a = prev.p, b = p, lo = 0, hi = 1;
          for (var it = 0; it < 14; it++) {
            var m = (lo + hi) / 2, x = lerp(a[0], b[0], m), y = lerp(a[1], b[1], m), dm = nearestGlobal(x, y, 60);
            var dd = dm.i < 0 ? 999 : dm.d - wallAt(dm.i);
            if ((prev.d > 0) === (dd > 0)) lo = m; else hi = m;
          }
          var mm = (lo + hi) / 2, cx = lerp(a[0], b[0], mm), cy = lerp(a[1], b[1], mm);
          var ok = tr.barriers.every(function (o) { return Math.hypot(o.x - cx, o.y - cy) > 6; });
          // skip when the side road runs along the track (it is the track itself)
          var segAng = Math.atan2(b[1] - a[1], b[0] - a[0]), ni = nearestGlobal(cx, cy, 60).i;
          var along = ni >= 0 ? Math.abs(Math.cos(segAng - tr.ang[ni])) : 0;
          if (ok && along < 0.85) tr.barriers.push({ x: cx, y: cy, a: segAng + Math.PI / 2, w: Math.max(4, roadHalf(rd.c) * 2 + 1.5) });
        }
        prev = { p: p, d: d };
      }
    });
    // street name signs along the track
    tr.signs = []; tr.paint = [];
    var lastName = "", lastS = -1e9, lastP = -1e9;
    for (var i = 0; i < tr.n; i += 2) {
      var p = tr.pts[i], best = tr.street[i];
      if (!best) continue;
      if (best !== lastName || tr.s[i] - lastS > 220) {
        var off = wallAt(i) + 2.2;
        tr.signs.push({ x: p[0] + tr.nx[i] * off, y: p[1] + tr.ny[i] * off, name: best });
        lastName = best; lastS = tr.s[i];
      }
      // street name painted on the asphalt on straight bits
      var straightHere = Math.abs(tr.curv[i]) < 0.12 && Math.abs(tr.curv[(i - 12 + tr.n) % tr.n]) < 0.12;
      if (straightHere && tr.s[i] - lastP > 140 && tr.s[i] > 40) {
        tr.paint.push({ x: p[0], y: p[1], a: tr.ang[i], name: best.toUpperCase(), w: tr.w[i] });
        lastP = tr.s[i];
      }
    }
    // ? box rows and boost pads
    tr.boxes = [];
    for (var sAt = 120; sAt < tr.L - 60; sAt += CFG.boxEvery) {
      var tp = trackPoint(sAt);
      if (Math.abs(tr.curv[tp.i]) > 0.5) { tp = trackPoint(sAt + 40); }
      [-0.72, -0.24, 0.24, 0.72].forEach(function (f) {
        var o = f * tr.w[tp.i];
        tr.boxes.push({ x: tp.x + tr.nx[tp.i] * o, y: tp.y + tr.ny[tp.i] * o, alive: true, t: 0, ph: Math.random() * 6 });
      });
    }
    tr.pads = [];
    // longest straight stretches get a boost pad
    var straights = [];
    var runStart = -1;
    for (i = 0; i < tr.n; i++) {
      var st = Math.abs(tr.curv[i]) < 0.12;
      if (st && runStart < 0) runStart = i;
      if ((!st || i === tr.n - 1) && runStart >= 0) { straights.push([runStart, i]); runStart = -1; }
    }
    straights.sort(function (a, b) { return (b[1] - b[0]) - (a[1] - a[0]); });
    straights.slice(0, tr.L > 3000 ? 3 : 2).forEach(function (r) {
      if (r[1] - r[0] < 40) return;
      var mid = Math.floor((r[0] + r[1]) / 2);
      tr.pads.push({ i: mid, lat: (Math.random() < 0.5 ? -1 : 1) * tr.w[mid] * 0.45, x: tr.pts[mid][0], y: tr.pts[mid][1], a: tr.ang[mid] });
    });
    // jump ramps on the next-longest straights (a third of the way in, away from pads)
    tr.ramps = [];
    straights.slice(0, tr.L > 3000 ? 4 : 3).forEach(function (r) {
      if (r[1] - r[0] < 35) return;
      var at = Math.floor(r[0] + (r[1] - r[0]) * 0.3);
      if (tr.s[at] < 60) return;
      var clash = tr.pads.some(function (pd) { return Math.abs(tr.s[pd.i] - tr.s[at]) < 25; });
      if (!clash) tr.ramps.push({ i: at, x: tr.pts[at][0], y: tr.pts[at][1], a: tr.ang[at], hw: tr.w[at] * 0.55 });
    });
    // pedestrian crossings at real side-street junctions (barrier spots), spread out along the lap
    tr.peds = []; tr.crossings = [];
    var lastC = -1e9;
    tr.barriers.slice().map(function (b) { var q = nearestGlobal(b.x, b.y, 40); return { b: b, i: q.i }; })
      .filter(function (o) { return o.i >= 0; })
      .sort(function (a, b) { return tr.s[a.i] - tr.s[b.i]; })
      .forEach(function (o) {
        var sv = tr.s[o.i];
        if (sv < 90 || sv > tr.L - 40 || sv - lastC < 230) return;
        if (tr.ramps.some(function (r) { return Math.abs(tr.s[r.i] - sv) < 30; })) return;
        if (Math.abs(tr.curv[o.i]) > 0.35) return;
        lastC = sv;
        var ci = Math.min(tr.n - 1, o.i + 3);
        tr.crossings.push({ i: ci, x: tr.pts[ci][0], y: tr.pts[ci][1], a: tr.ang[ci], w: tr.w[ci] });
        var nP = 1 + (tr.crossings.length % 2);
        for (var k = 0; k < nP; k++) {
          tr.peds.push({ ci: tr.crossings.length - 1, i: ci, lat: (k ? 1 : -1) * (tr.w[ci] + 1.6), dir: k ? -1 : 1, wait: 1 + k * 2.5 + Math.random() * 3,
            speed: 1.2 + Math.random() * 0.5, shirt: ["#e53935", "#1e88e5", "#43a047", "#fdd835", "#8e24aa", "#fb8c00", "#00acc1"][(tr.peds.length * 3) % 7],
            dodge: 0, ph: Math.random() * 6, alert: 0 });
        }
      });
    // trees inside forest/park areas near the track
    tr.trees = [];
    var seed = 12345 + tr.ti * 777;
    function srand() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    MAP.areas.forEach(function (a) {
      if (a.k !== "f" && a.k !== "g") return;
      var bb = a.bb, step = a.k === "f" ? 6.5 : 16;
      if (bb[2] < tr.bb[0] - 150 || bb[0] > tr.bb[2] + 150 || bb[3] < tr.bb[1] - 150 || bb[1] > tr.bb[3] + 150) return;
      for (var x = bb[0]; x < bb[2]; x += step) for (var y = bb[1]; y < bb[3]; y += step) {
        var px = x + srand() * step, py = y + srand() * step;
        if (!pip(px, py, a.pts)) continue;
        var nn = nearestGlobal(px, py, 140);
        if (nn.i < 0 || nn.d < tr.w[nn.i] + CFG.VERGE + 3 || nn.d > 130) continue;
        if (a.k === "g" && srand() < 0.5) continue;
        tr.trees.push({ x: px, y: py, r: 2.4 + srand() * 2.2, s: srand() });
        if (tr.trees.length > 4500) return;
      }
    });
    // occasional street trees along the fence
    for (i = 0; i < tr.n; i += 9) {
      if (srand() < 0.45) continue;
      var side2 = srand() < 0.5 ? -1 : 1, o2 = tr.w[i] + CFG.VERGE + 2 + srand() * 3;
      var tx2 = tr.pts[i][0] + tr.nx[i] * o2 * side2, ty2 = tr.pts[i][1] + tr.ny[i] * o2 * side2;
      var hitB = MAP.buildings.some(function (b, bi) { return !tr.hidden[bi] && tx2 > b.bb[0] - 2 && tx2 < b.bb[2] + 2 && ty2 > b.bb[1] - 2 && ty2 < b.bb[3] + 2; });
      var onRoad = MAP.roads.some(function (rd) { if (tx2 < rd.bb[0] - 8 || tx2 > rd.bb[2] + 8 || ty2 < rd.bb[1] - 8 || ty2 > rd.bb[3] + 8) return false; for (var k = 0; k + 1 < rd.pts.length; k++) if (segDist(tx2, ty2, rd.pts[k], rd.pts[k + 1]) < rd.w / 2 + 2) return true; return false; });
      if (!hitB && !onRoad) tr.trees.push({ x: tx2, y: ty2, r: 2.2 + srand() * 1.6, s: srand() });
    }
    // tree grid for culling
    tr.treeGrid = {};
    tr.trees.forEach(function (t) { var k = Math.floor(t.x / 50) + "," + Math.floor(t.y / 50); (tr.treeGrid[k] = tr.treeGrid[k] || []).push(t); });
    // pre-built paths
    var off = function (sg, extra) { return tr.pts.map(function (p, i) { var d = sg * (tr.w[i] + extra); return [p[0] + tr.nx[i] * d, p[1] + tr.ny[i] * d]; }); };
    tr.center = pathOf(tr.pts, true);
    tr.edgeL = pathOf(off(-1, 0), true); tr.edgeR = pathOf(off(1, 0), true);
    tr.fenceL = pathOf(off(-1, CFG.VERGE), true); tr.fenceR = pathOf(off(1, CFG.VERGE), true);
    // centre line in short chunks so road and corridor can be stroked with the real, varying width
    tr.chunks = [];
    for (i = 0; i < tr.n; i += 6) {
      var cp = [], ws = 0;
      for (var k2 = 0; k2 <= 6; k2++) { var q2 = tr.pts[(i + k2) % tr.n]; cp.push(q2); ws += tr.w[(i + k2) % tr.n]; }
      tr.chunks.push({ path: pathOf(cp), w: ws / 7, bb: bboxOf(cp) });
    }
  }
  function segDist(x, y, a, b) {
    var vx = b[0] - a[0], vy = b[1] - a[1], l = vx * vx + vy * vy, t = l ? ((x - a[0]) * vx + (y - a[1]) * vy) / l : 0;
    t = clamp(t, 0, 1); return Math.hypot(x - a[0] - t * vx, y - a[1] - t * vy);
  }
  function pip(x, y, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  // ------------------------------------------------------------------ state
  var S = {
    phase: "lobby",          // lobby | countdown | race | heatend | results
    trackIdx: 0,
    nextTrack: 0,
    lenIdx: LK.DEFAULT_LENGTH,
    cpuMode: 1,              // 0 off, 1 fill to 4, 2 fill to 8
    timeLeft: 0,
    heat: 0,
    heatTime: 0,
    phaseT: 0,
    finalHeat: false,
    lastWinner: null,
    results: null,
    battles: 0
  };
  var DBG = {};
  var players = [];          // humans + cpus (cpus only during a battle)
  var cars = [];             // players with a car in this heat
  var rockets = [], oils = [], parts = [], skids = [], toasts = [];
  var cam = { x: 0, y: 0, zoom: 1, viewH: 80, limit: 0 };
  var airCode = "";

  // ------------------------------------------------------------------ AirConsole
  var ac = new AirConsole({ translation: false, synchronize_time: false });
  ac.onReady = function (code) { airCode = code ? String(code) : ""; renderPanel(); };
  ac.onConnect = function (id) { onJoin(id); };
  ac.onDisconnect = function (id) { onLeave(id); };
  ac.onMessage = function (from, data) { onMessage(from, data); };
  ac.onDeviceProfileChange = function (id) { var p = byDevice(id); if (p) { p.name = nickname(id); renderPanel(); sync(p); } };

  function nickname(id) {
    var n = "";
    try { n = ac.getNickname(id); } catch (e) {}
    if (!n || /^Guest/i.test(n) && false) n = "";
    return String(n || ("Player " + id)).slice(0, 14);
  }
  function send(p, msg) { if (p && !p.cpu && p.device != null) { try { ac.message(p.device, msg); } catch (e) {} } }
  function byDevice(id) { for (var i = 0; i < players.length; i++) if (!players[i].cpu && players[i].device === id) return players[i]; return null; }
  function humans() { return players.filter(function (p) { return !p.cpu; }); }
  function hostOf() { var h = humans().slice().sort(function (a, b) { return a.joinedAt - b.joinedAt; }); return h[0] || null; }

  var joinCounter = 0, pending = {};   // pending: phones told "full", retried when a seat frees up
  function retryPending() { Object.keys(pending).forEach(function (id) { if (freeSlot() >= 0) onJoin(+id); }); }
  function freeSlot() {
    for (var s = 0; s < LK.MAX_PLAYERS; s++) if (!players.some(function (p) { return p.slot === s; })) return s;
    return -1;
  }
  function makePlayer(o) {
    var sl = LK.SLOTS[o.slot];
    return {
      device: o.device, cpu: !!o.cpu, slot: o.slot, name: o.name, color: sl.color, dark: sl.dark,
      ready: false, vote: -1, wins: 0, surv: 0, battleWins: o.battleWins || 0, joinedAt: joinCounter++,
      inp: { l: 0, r: 0, b: 0 }, useQ: false, item: null, car: null, waiting: false
    };
  }

  function onJoin(id) {
    if (id === AirConsole.SCREEN) return;
    var p = byDevice(id);
    if (!p) {
      // a CPU gives its seat to a real player between battles only
      var slot = freeSlot();
      if (slot < 0 && S.phase === "lobby" || slot < 0 && S.phase === "results") {
        var cpu = players.filter(function (q) { return q.cpu; })[0];
        if (cpu) { removePlayer(cpu); slot = freeSlot(); }
      }
      if (slot < 0) { pending[id] = 1; try { ac.message(id, { t: "view", view: "full" }); } catch (e) {} return; }
      delete pending[id];
      p = makePlayer({ device: id, slot: slot, name: nickname(id) });
      players.push(p);
      if (S.phase !== "lobby" && S.phase !== "results") p.waiting = true;  // joins at the next heat
      sfx("join");
      toast(p.name + " joined", p.color);
    }
    renderPanel(); syncAll();
  }
  function removePlayer(p) {
    if (p.car) p.car.alive = false;
    players.splice(players.indexOf(p), 1);
    var ci = cars.indexOf(p); if (ci >= 0) cars.splice(ci, 1);
  }
  function onLeave(id) {
    delete pending[id];
    var p = byDevice(id); if (!p) return;
    removePlayer(p);
    toast(p.name + " left", "#8aa0b8");
    if (S.phase === "countdown" || S.phase === "race" || S.phase === "heatend") {
      if (!humans().length) { endBattle(true); return; }
      if (cars.length < 2) { endBattle(false); return; }
    }
    renderPanel(); syncAll();
    retryPending();
    maybeStart();
  }

  function onMessage(from, d) {
    var p = byDevice(from);
    if (!p && d && d.t === "hello") { onJoin(from); return; }
    if (!p || !d) return;
    switch (d.t) {
      case "hello": sync(p); break;
      case "vote":
        if (typeof d.track === "number" && d.track >= 0 && d.track < LK.TRACKS.length) { p.vote = d.track; computeNext(); renderPanel(); syncLobby(); }
        break;
      case "set":
        if (p !== hostOf()) break;
        if (typeof d.len === "number" && d.len >= 0 && d.len < LK.LENGTHS.length) S.lenIdx = d.len;
        if (typeof d.cpu === "number" && d.cpu >= 0 && d.cpu <= 2) S.cpuMode = d.cpu;
        renderPanel(); syncLobby(); maybeStart(); break;
      case "ready":
        if (S.phase === "lobby" || S.phase === "results") { p.ready = true; renderPanel(); syncLobby(); maybeStart(); }
        break;
      case "in":
        p.inp.l = d.l ? 1 : 0; p.inp.r = d.r ? 1 : 0; p.inp.b = d.b ? 1 : 0; break;
      case "use": p.useQ = true; break;
    }
  }

  function computeNext() {
    var counts = LK.TRACKS.map(function () { return 0; });
    humans().forEach(function (p) { if (p.vote >= 0) counts[p.vote]++; });
    var best = -1, bi = S.nextTrack;
    counts.forEach(function (c, i) { if (c > best || (c === best && i === S.nextTrack)) { best = c; bi = i; } });
    if (best > 0) S.nextTrack = bi;
    return counts;
  }
  function minHumans() { return S.cpuMode > 0 ? 1 : 2; }
  function maybeStart() {
    if (S.phase !== "lobby" && S.phase !== "results") return;
    var hs = humans();
    if (hs.length < minHumans()) return;
    if (hs.every(function (p) { return p.ready; })) startBattle();
  }

  // ------------------------------------------------------------------ controller sync
  function lobbyMsg(p) {
    var counts = computeNext(), host = hostOf();
    var msg = {
      t: "view", view: "lobby", name: p.name, color: p.color, dark: p.dark, slot: p.slot, ready: p.ready,
      vote: p.vote, counts: counts, next: S.nextTrack, host: host === p, hostName: host ? host.name : "",
      len: S.lenIdx, cpu: S.cpuMode, bw: p.battleWins, need: minHumans(), players: humans().length
    };
    if (S.phase === "results" && S.results) {
      msg.results = S.results.rows.map(function (r) { return { n: r.name, c: r.color, w: r.wins, me: r.p === p, cpu: r.cpu }; });
      var mine = S.results.rows.filter(function (r) { return r.p === p; })[0];
      var someone = S.results.rows.length && S.results.rows[0].wins > 0;
      msg.title = !someone || !mine ? "Battle over" : mine.place === 1 ? "You won the battle!" : "You finished #" + mine.place;
      msg.won = !!(someone && mine && mine.place === 1);
      msg.track = S.trackIdx;
    }
    return msg;
  }
  function raceMsg(p) {
    return {
      t: "view", view: "race", name: p.name, color: p.color, dark: p.dark, slot: p.slot, item: p.item,
      out: !!(p.car && !p.car.alive) || false, waiting: !!p.waiting, wins: p.wins, heat: S.heat, track: S.trackIdx,
      heatend: S.phase === "heatend", wonHeat: S.phase === "heatend" && S.lastWinner === p,
      winnerName: S.phase === "heatend" && S.lastWinner ? S.lastWinner.name : ""
    };
  }
  function sync(p) {
    if (!p || p.cpu) return;
    if (S.phase === "lobby" || S.phase === "results") send(p, lobbyMsg(p));
    else send(p, raceMsg(p));
  }
  function syncAll() { humans().forEach(sync); }
  function syncLobby() { if (S.phase === "lobby" || S.phase === "results") syncAll(); }
  function ev(p, e, extra) { var m = { t: "ev", e: e }; if (extra) for (var k in extra) m[k] = extra[k]; send(p, m); }

  // ------------------------------------------------------------------ battle flow
  function startBattle() {
    // remove previous CPUs, add fresh ones
    players.filter(function (p) { return p.cpu; }).forEach(removePlayer);
    var target = S.cpuMode === 1 ? 4 : S.cpuMode === 2 ? 8 : 0, k = 0;
    var names = LK.CPU_NAMES.slice().sort(function () { return Math.random() - 0.5; });
    while (players.length < target && freeSlot() >= 0) {
      var cp = makePlayer({ cpu: true, slot: freeSlot(), name: names[k++ % names.length] });
      cp.ai = { lane: rnd(-3, 3), laneT: 0, itemT: 0, skill: rnd(0.92, 0.985), err: 0 };
      players.push(cp);
    }
    S.trackIdx = S.nextTrack;
    buildTrack(S.trackIdx);
    prefetchTrack(T);
    players.forEach(function (p) { p.wins = 0; p.surv = 0; p.ready = false; p.item = null; p.waiting = false; p.vote = -1; if (p.ai) p.ai.itemT = 0; });
    S.timeLeft = LK.LENGTHS[S.lenIdx] * 60;
    S.heat = 0; S.finalHeat = false; S.results = null; S.lastWinner = null;
    oils = []; rockets = []; parts = []; skids = [];
    gridAt(0, true);
    setPhase("countdown", CFG.countdown);
    hidePanel();
    $("hud").classList.remove("hidden");
    buildMinimap();
    banner(T.name, T.streets, 2.6);
    sfx("start");
    syncAll();
  }

  function gridAt(prog, first) {
    S.heat++; S.heatTime = 0;
    oils = []; rockets = [];
    T.boxes.forEach(function (b) { b.alive = true; });
    T.peds.forEach(function (pd) { pd.lat = (pd.dir > 0 ? -1 : 1) * (T.w[pd.i] + 1.6); pd.wait = 1 + Math.random() * 3; pd.dodge = 0; });
    var list = players.slice();
    players.forEach(function (p) { p.waiting = false; });
    // catch-up grid: fewest heat wins on pole, the last heat winner starts at the back
    list.sort(function (a, b) {
      if (a === S.lastWinner) return 1; if (b === S.lastWinner) return -1;
      return (a.wins - b.wins) || (a.slot - b.slot);
    });
    if (first) list.sort(function () { return Math.random() - 0.5; });
    cars = list;
    prog = straightAt(prog);
    var gw = T.w[trackPoint(prog).i];
    var perRow = list.length > 4 && gw >= 3.6 ? 3 : 2;
    list.forEach(function (p, k) {
      var row = Math.floor(k / perRow), col = k % perRow;
      var tp = trackPoint(prog - 6 - row * 5);
      var w = T.w[tp.i];
      var lat = perRow === 3 ? (col - 1) * w * 0.6 : (col ? 0.42 : -0.42) * w;
      if (row % 2) lat += perRow === 3 ? 0.6 : 0;
      p.car = {
        x: tp.x + T.nx[tp.i] * lat, y: tp.y + T.ny[tp.i] * lat, h: tp.a, vx: 0, vy: 0,
        idx: tp.i, lap: Math.floor((prog - 6 - row * 5) / T.L), prog: 0, lat: lat,
        boostT: 0, boostMul: 1, shieldT: 0, spinT: 0, offT: 0, alive: true, dangerT: 0, steer: 0, hitT: 0
      };
      updateProgress(p.car, true);
      var want = prog - 6 - row * 5, dl = Math.round((want - p.car.prog) / T.L);
      if (dl) { p.car.lap += dl; p.car.prog += dl * T.L; }
      p.useQ = false; p.item = null;
      if (p.ai) { p.ai.lane = lat / Math.max(1, w - 1.1); p.ai.laneT = rnd(2.5, 4); }
    });
    var cp = trackPoint(prog);
    cam.x = cp.x; cam.y = cp.y; cam.viewH = viewTarget(); cam.zoom = CFG.viewH / cam.viewH;
  }

  function setPhase(ph, t) { S.phase = ph; S.phaseT = t || 0; }
  // move a grid anchor forward until the grid (30 m behind it) sits on a fairly straight piece of road
  function straightAt(prog) {
    for (var k = 0; k < 40; k++) {
      var pr = prog + k * 6, ok = true;
      for (var d = -30; d <= 12 && ok; d += 2) { var tp = trackPoint(pr + d); if (Math.abs(T.curv[tp.i]) > 0.3) ok = false; }
      if (ok) return pr;
    }
    return prog;
  }

  function eliminate(p, why) {
    var c = p.car; if (!c || !c.alive) return;
    c.alive = false; c.outAt = performance.now();
    if (TEST) { var Ld = leaderOf(); (DBG.elims = DBG.elims || []).push({ n: p.name, why: why, heat: S.heat, ht: +S.heatTime.toFixed(2), dx: Math.round(c.x - cam.x), dy: Math.round(c.y - cam.y), behind: Ld ? Math.round(Ld.car.prog - c.prog) : null, zoom: +cam.zoom.toFixed(2), spd: Math.round(Math.hypot(c.vx, c.vy)) }); }
    var alive = cars.filter(function (q) { return q.car && q.car.alive; }).length;
    p.surv += Math.max(0, cars.length - alive - 1);
    var s0 = scale(), hw0 = VW / 2 / s0 * 0.8, hh0 = VH / 2 / s0 * 0.75;
    var ex = clamp(c.x, cam.x - hw0, cam.x + hw0), ey = clamp(c.y, cam.y - hh0, cam.y + hh0);
    burst(ex, ey, p.color, 30, 16); burst(ex, ey, "#ffffff", 12, 10); ring(ex, ey, p.color, 7, 0.5);
    popText(ex, ey, p.name + " OUT", p.color); shake(5);
    toast(p.name + (why === "behind" ? " fell too far behind" : " is out!"), p.color);
    sfx("out");
    ev(p, "out");
    sync(p);
  }

  function heatOver(winner) {
    if (winner) {
      winner.wins++;
      S.lastWinner = winner;
      banner(winner.name + " wins heat " + S.heat + "!", "+1 point", CFG.heatPause - 0.3, winner.color);
      sfx("heatwin");
      ev(winner, "heatwin", { wins: winner.wins });
      humans().forEach(function (p) { if (p !== winner) ev(p, "heatlost", { name: winner.name, color: winner.color }); });
    }
    setPhase("heatend", CFG.heatPause);
    syncAll();
  }

  function endBattle(aborted) {
    var rows = players.map(function (p) { return { p: p, name: p.name, color: p.color, wins: p.wins, surv: p.surv, cpu: p.cpu }; });
    rows.sort(function (a, b) { return (b.wins - a.wins) || (b.surv - a.surv); });
    rows.forEach(function (r, i) { r.place = i + 1; });
    if (!aborted && rows.length && rows[0].wins > 0) { rows[0].p.battleWins++; }
    S.results = { rows: rows, aborted: aborted, track: S.trackIdx };
    S.battles++;
    // CPUs leave after the battle
    players.filter(function (p) { return p.cpu; }).forEach(removePlayer);
    players.forEach(function (p) { p.car = null; p.ready = false; p.item = null; p.waiting = false; });
    cars = [];
    setPhase(aborted ? "lobby" : "results", 0);
    $("hud").classList.add("hidden");
    hideBanner();
    if (!aborted) { sfx("champion"); humans().forEach(function (p) { ev(p, rows[0].p === p ? "champion" : "battleover"); }); }
    renderPanel();
    syncAll();
    retryPending();
  }

  // ------------------------------------------------------------------ physics
  function updateProgress(c, full) {
    var n = T.n, bi = c.idx, bd = 1e18, i, k;
    if (full) { var g = nearestGlobal(c.x, c.y, 80); if (g.i >= 0) bi = g.i; c.idx = bi; }
    for (k = -24; k <= 24; k++) {
      i = (c.idx + k + n) % n;
      var p = T.pts[i], d = (p[0] - c.x) * (p[0] - c.x) + (p[1] - c.y) * (p[1] - c.y);
      if (d < bd) { bd = d; bi = i; }
    }
    // lap wrap
    if (c.idx > n * 0.75 && bi < n * 0.25) c.lap++;
    else if (c.idx < n * 0.25 && bi > n * 0.75) c.lap--;
    c.idx = bi;
    var p0 = T.pts[bi];
    var along = (c.x - p0[0]) * T.tx[bi] + (c.y - p0[1]) * T.ty[bi];
    c.lat = (c.x - p0[0]) * T.nx[bi] + (c.y - p0[1]) * T.ny[bi];
    c.prog = c.lap * T.L + T.s[bi] + along;
  }

  function stepCar(p, dt) {
    var c = p.car; if (!c || !c.alive) return;
    var inp = p.inp;
    if (S.phase === "heatend") { inp = { l: 0, r: 0, b: 1 }; p.useQ = false; }
    else if (p.cpu || AUTOPILOT) inp = aiInput(p, dt);
    var steer = (inp.r ? 1 : 0) - (inp.l ? 1 : 0);
    c.steer = lerp(c.steer, steer, 1 - Math.exp(-14 * dt));
    var fx = Math.cos(c.h), fy = Math.sin(c.h), rx = -fy, ry = fx;
    var vf = c.vx * fx + c.vy * fy, vl = c.vx * rx + c.vy * ry;
    var spinning = c.spinT > 0;
    var air = c.air && c.air.t < c.air.dur;
    if (air) {
      // airborne: no steering, keep momentum
      c.air.t += dt; c.z = Math.sin(Math.PI * clamp(c.air.t / c.air.dur, 0, 1)) * c.air.h;
      if (c.air.t >= c.air.dur) { c.z = 0; c.air = null; land(p); }
    } else if (spinning) {
      c.spinT -= dt; c.h += 11 * dt;
      vf *= Math.exp(-2.2 * dt); vl *= Math.exp(-2.2 * dt);
    } else {
      var turnF = clamp(Math.abs(vf) / 5, 0.4, 1);
      c.h += c.steer * CFG.turn * turnF * (inp.b ? 1.18 : 1) * dt;
      var off = Math.abs(c.lat) > T.w[c.idx];
      var vmax = CFG.vmax * (p.ai ? p.ai.skill : 1) * (off ? CFG.offroad : 1);
      if (c.boostT > 0) { vmax *= c.boostMul; c.boostT -= dt; }
      if (inp.b) vf = Math.max(0, vf - CFG.brake * dt);
      else if (vf < vmax) vf = Math.min(vmax, vf + CFG.accel * (c.boostT > 0 ? 2.2 : 1) * (1 - 0.45 * vf / vmax) * dt);
      else vf -= (vf - vmax) * (off ? 3.5 : 1.6) * dt;
      vl *= Math.exp(-CFG.grip * dt);
      // skid marks when braking hard or drifting
      if ((inp.b && vf > 7) || Math.abs(vl) > 3) addSkid(c);
      if (off && vf > 5 && Math.random() < 0.35) puff(c.x - fx * 1.4, c.y - fy * 1.4, "rgba(150,120,80,0.55)", 1);
    }
    fx = Math.cos(c.h); fy = Math.sin(c.h); rx = -fy; ry = fx;
    c.vx = fx * vf + rx * vl; c.vy = fy * vf + ry * vl;
    c.x += c.vx * dt; c.y += c.vy * dt;
    if (c.shieldT > 0) c.shieldT -= dt;
    if (c.hitT > 0) c.hitT -= dt;
    if (c.boostT > 0 && Math.random() < 0.6) {
      var bx = c.x - Math.cos(c.h) * 1.9, by = c.y - Math.sin(c.h) * 1.9;
      parts.push({ x: bx, y: by, vx: -c.vx * 0.15 + rnd(-1, 1), vy: -c.vy * 0.15 + rnd(-1, 1), life: 0.35, max: 0.35, r: rnd(0.25, 0.45), col: c.rescueT > 0 ? "#6fd8ff" : "#ffb347", grow: -0.4 });
    }
    if (TEST && S.phase === "race") {
      var spd = Math.hypot(c.vx, c.vy);
      c.stuck = spd < 5 && !spinning ? (c.stuck || 0) + dt : 0;
      if (c.stuck > (DBG.maxStuck || 0)) { DBG.maxStuck = c.stuck; DBG.stuckAt = [Math.round(c.x), Math.round(c.y), T.ti, p.name]; }
      DBG.offFrac = (DBG.offFrac || 0) + (Math.abs(c.lat) > T.w[c.idx] ? dt : 0); DBG.drive = (DBG.drive || 0) + dt;
    }
    updateProgress(c);
    // fence
    var wall = wallAt(c.idx);
    if (Math.abs(c.lat) > wall) {
      var i = c.idx, sgn = c.lat > 0 ? 1 : -1, over = Math.abs(c.lat) - wall;
      c.x -= T.nx[i] * sgn * over; c.y -= T.ny[i] * sgn * over;
      var vn = c.vx * T.nx[i] + c.vy * T.ny[i];
      if (vn * sgn > 0) {
        c.vx -= T.nx[i] * vn * 1.35; c.vy -= T.ny[i] * vn * 1.35; c.vx *= 0.93; c.vy *= 0.93;
        if (Math.abs(vn) > 3) sparks(c.x + T.nx[i] * sgn * 1.2, c.y + T.ny[i] * sgn * 1.2, Math.abs(vn));
        if (Math.abs(vn) > 6) { sfx("bump"); puff(c.x, c.y, "rgba(255,255,255,0.7)", 3); }
      }
      c.lat = sgn * wall;
    }
    // jump ramps
    if (!c.air) T.ramps.forEach(function (rp) {
      var dx = c.x - rp.x, dy = c.y - rp.y, al = dx * T.tx[rp.i] + dy * T.ty[rp.i], la = dx * T.nx[rp.i] + dy * T.ny[rp.i];
      var sp = Math.hypot(c.vx, c.vy);
      if (al > -0.6 && al < 1.4 && Math.abs(la) < rp.hw && sp > 6) {
        var dur = clamp(0.3 + sp * 0.03, 0.5, 1.05);
        c.air = { t: 0, dur: dur, h: dur * 1.6 }; c.z = 0;
        sfx("jump"); ev(p, "jump");
        if (dur > 0.8) popText(c.x, c.y, "BIG AIR!", "#ffd23f");
      }
    });
    // pedestrians: you must not touch them — they jump aside and you spin
    if (!c.air) T.peds.forEach(function (pd) {
      if (pd.dodge > 0) return;
      var px = T.pts[pd.i][0] + T.nx[pd.i] * pd.lat, py = T.pts[pd.i][1] + T.ny[pd.i] * pd.lat;
      if (Math.abs(px - c.x) < 2 && Math.abs(py - c.y) < 2 && Math.hypot(px - c.x, py - c.y) < 1.75) {
        pd.dodge = 0.6; pd.dodgeDir = pd.lat > 0 ? 1 : -1; pd.alert = 1.2;
        if (c.shieldT <= 0) { popText(c.x, c.y, "WATCH OUT!", "#ff5252"); }
        hitCar(p, "ped");
      }
    });
    // boost pads
    T.pads.forEach(function (pd) {
      var dx = c.x - (pd.x + T.nx[pd.i] * pd.lat), dy = c.y - (pd.y + T.ny[pd.i] * pd.lat);
      if (Math.abs(dx * T.tx[pd.i] + dy * T.ty[pd.i]) < 2.8 && Math.abs(dx * T.nx[pd.i] + dy * T.ny[pd.i]) < 2) {
        if (c.boostT < CFG.pad.t * 0.6) { c.boostT = CFG.pad.t; c.boostMul = Math.max(CFG.pad.mul, c.boostT > 1.2 ? c.boostMul : 1); c.boostMul = CFG.pad.mul; sfx("pad"); if (TEST) DBG.pads = (DBG.pads || 0) + 1; }
      }
    });
    // ? boxes
    if (!p.item && !c.air) T.boxes.forEach(function (b) {
      if (b.alive && Math.abs(b.x - c.x) < 1.9 && Math.abs(b.y - c.y) < 1.9) {
        b.alive = false; b.t = CFG.boxRespawn;
        giveItem(p);
        burst(b.x, b.y, "#ffffff", 10, 7); burst(b.x, b.y, "#ffe14d", 8, 5);
        ring(b.x, b.y, "#ffffff", 3.5, 0.35);
        popText(b.x, b.y, LK.ITEMS[p.item].name + "!", LK.ITEMS[p.item].color);
      }
    });
    // oil
    for (var k = 0; k < oils.length; k++) {
      var o = oils[k];
      if ((o.owner === p && o.age < 1) || c.air) continue;
      if (Math.hypot(o.x - c.x, o.y - c.y) < o.r + 0.6) {
        oils.splice(k, 1); k--;
        hitCar(p, "oil");
      }
    }
    // item use
    if (p.useQ) { p.useQ = false; useItem(p); }
  }

  function hitCar(p, what) {
    var c = p.car;
    if (!c || !c.alive || c.hitT > 0) return;
    if (TEST) { DBG.hits = DBG.hits || {}; DBG.hits[what] = (DBG.hits[what] || 0) + 1; }
    if (c.shieldT > 0) { c.shieldT = 0; burst(c.x, c.y, "#2ec4ff", 14, 9); sfx("shieldpop"); ev(p, "shieldsaved"); return; }
    c.spinT = CFG.spinT; c.hitT = CFG.spinT + 0.6;
    c.vx *= 0.35; c.vy *= 0.35;
    burst(c.x, c.y, what === "oil" ? "#7a5cff" : what === "ped" ? "#ffffff" : "#ff9f1c", 18, 12);
    if (what === "rocket") { ring(c.x, c.y, "#ffcf4a", 6, 0.45); burst(c.x, c.y, "#ff3d00", 14, 16); shake(9); popText(c.x, c.y, "BOOM!", "#ff7043"); }
    else if (what === "oil") { popText(c.x, c.y, "SLIP!", "#b39dff"); shake(3); }
    else shake(4);
    sfx(what === "oil" ? "slip" : what === "ped" ? "bump" : "boom");
    ev(p, "hit", { what: what });
  }

  function collideCars() {
    for (var a = 0; a < cars.length; a++) {
      var A = cars[a].car; if (!A || !A.alive || A.air) continue;
      for (var b = a + 1; b < cars.length; b++) {
        var B = cars[b].car; if (!B || !B.alive || B.air) continue;
        var dx = B.x - A.x, dy = B.y - A.y, d2 = dx * dx + dy * dy, R = CFG.carR * 2;
        if (d2 >= R * R || d2 < 1e-6) continue;
        var d = Math.sqrt(d2), nx = dx / d, ny = dy / d, over = R - d;
        var mA = A.shieldT > 0 ? 3 : 1, mB = B.shieldT > 0 ? 3 : 1, tot = mA + mB;
        A.x -= nx * over * mB / tot; A.y -= ny * over * mB / tot;
        B.x += nx * over * mA / tot; B.y += ny * over * mA / tot;
        var rv = (B.vx - A.vx) * nx + (B.vy - A.vy) * ny;
        if (rv < 0) {
          var j = -(1 + 0.3) * rv / (1 / mA + 1 / mB);
          A.vx -= j * nx / mA; A.vy -= j * ny / mA; B.vx += j * nx / mB; B.vy += j * ny / mB;
          if (-rv > 5) { sfx("bump"); puff((A.x + B.x) / 2, (A.y + B.y) / 2, "rgba(255,240,200,0.8)", 3); }
          if (A.shieldT > 0 && B.shieldT <= 0 && -rv > 4) hitCar(cars[b], "shield");
          if (B.shieldT > 0 && A.shieldT <= 0 && -rv > 4) hitCar(cars[a], "shield");
        }
      }
    }
  }

  // ------------------------------------------------------------------ items
  function rankOf(p) {
    var alive = cars.filter(function (q) { return q.car && q.car.alive; }).sort(function (a, b) { return b.car.prog - a.car.prog; });
    var i = alive.indexOf(p);
    return { r: i, n: alive.length, list: alive };
  }
  function giveItem(p) {
    var rk = rankOf(p), f = rk.n > 1 ? rk.r / (rk.n - 1) : 0.5;
    var w = {
      turbo: lerp(34, 26, f), oil: lerp(32, 2, f), shield: lerp(26, 6, f), rocket: lerp(8, 34, f), mega: lerp(0, 32, f)
    };
    var tot = 0, k; for (k in w) tot += w[k];
    var r = Math.random() * tot;
    for (k in w) { r -= w[k]; if (r <= 0) break; }
    p.item = k;
    sfx("pickup");
    ev(p, "item", { item: k });
    sync(p);
    if (p.ai) p.ai.itemT = rnd(0.6, 2.6);
  }
  function useItem(p) {
    var c = p.car; if (!c || !c.alive || !p.item || c.spinT > 0) return;
    var it = p.item; p.item = null;
    var fx = Math.cos(c.h), fy = Math.sin(c.h);
    if (it === "turbo" || it === "mega") {
      var cfg = CFG[it]; c.boostT = cfg.t; c.boostMul = cfg.mul;
      var vf = c.vx * fx + c.vy * fy; c.vx += fx * 6; c.vy += fy * 6; void vf;
      sfx(it === "mega" ? "mega" : "turbo");
    } else if (it === "oil") {
      oils.push({ x: c.x - fx * 3, y: c.y - fy * 3, age: 0, owner: p, r: 1.7 });
      sfx("oil");
    } else if (it === "shield") {
      c.shieldT = CFG.shieldT; sfx("shield");
    } else if (it === "rocket") {
      var rk = rankOf(p), target = null;
      if (rk.r > 0) { var ahead = rk.list[rk.r - 1]; if (ahead.car.prog - c.prog < 120) target = ahead; }
      var sp = Math.max(CFG.rocketSpeed, Math.hypot(c.vx, c.vy) + 20);
      rockets.push({ x: c.x + fx * 2, y: c.y + fy * 2, h: c.h, v: sp, owner: p, target: target, life: 3.6 });
      sfx("rocket");
    }
    if (TEST) { DBG.used = DBG.used || {}; DBG.used[it] = (DBG.used[it] || 0) + 1; }
    ev(p, "used", { item: it });
    sync(p);
  }
  function stepRockets(dt) {
    for (var i = 0; i < rockets.length; i++) {
      var r = rockets[i];
      r.life -= dt;
      var tgt = r.target && r.target.car && r.target.car.alive ? r.target.car : null;
      if (tgt) {
        var want = Math.atan2(tgt.y - r.y, tgt.x - r.x), da = angNorm(want - r.h);
        r.h += clamp(da, -6 * dt, 6 * dt);
      } else {
        // follow the road when there is no target
        var g = nearestGlobal(r.x, r.y, 40);
        if (g.i >= 0) { var j = (g.i + 5) % T.n; var w2 = Math.atan2(T.pts[j][1] - r.y, T.pts[j][0] - r.x); r.h += clamp(angNorm(w2 - r.h), -4 * dt, 4 * dt); }
      }
      r.x += Math.cos(r.h) * r.v * dt; r.y += Math.sin(r.h) * r.v * dt;
      if (Math.random() < 0.8) puff(r.x - Math.cos(r.h) * 1.5, r.y - Math.sin(r.h) * 1.5, "rgba(220,220,220,0.55)", 1);
      var hit = false;
      for (var k = 0; k < cars.length && !hit; k++) {
        var q = cars[k]; if (q === r.owner && r.life > 3.2) continue;
        if (!q.car || !q.car.alive) continue;
        if (Math.hypot(q.car.x - r.x, q.car.y - r.y) < 1.8) { hitCar(q, "rocket"); hit = true; }
      }
      if (hit || r.life <= 0) { if (!hit) burst(r.x, r.y, "#ffb347", 8, 6); rockets.splice(i, 1); i--; }
    }
    stepPeds(dt);
    oils.forEach(function (o) { o.age += dt; });
    oils = oils.filter(function (o) { return o.age < CFG.oilLife; });
    T.boxes.forEach(function (b) { if (!b.alive) { b.t -= dt; if (b.t <= 0) b.alive = true; } });
  }

  // ------------------------------------------------------------------ CPU / autopilot
  function aiInput(p, dt) {
    var c = p.car, ai = p.ai || (p.ai = { lane: rnd(-3, 3), laneT: 0, itemT: 0, skill: 1, err: 0 });
    ai.laneT -= dt;
    if (ai.laneT <= 0) { ai.lane = rnd(-0.7, 0.7); ai.laneT = rnd(1.5, 4); }
    var sp = Math.hypot(c.vx, c.vy);
    var look = 6 + sp * 0.45, ti = (c.idx + Math.round(look / 2)) % T.n;
    var lane = clamp(ai.lane, -0.8, 0.8) * Math.max(0.5, T.w[ti] - 1.1);
    // dodge oil ahead
    oils.forEach(function (o) { var dx = o.x - c.x, dy = o.y - c.y; if (dx * dx + dy * dy < 225) lane = ((o.x - T.pts[ti][0]) * T.nx[ti] + (o.y - T.pts[ti][1]) * T.ny[ti] > 0 ? -0.6 : 0.6) * T.w[ti]; });
    T.peds.forEach(function (pd) {
      if (Math.abs(pd.lat) > T.w[pd.i] + 0.5) return;
      var ds = T.s[pd.i] - T.s[c.idx]; if (ds < 0) ds += T.L;
      if (ds < 4 || ds > 26) return;
      if (Math.abs(pd.lat - lane) < 2.2) lane = pd.lat > 0 ? pd.lat - 2.6 : pd.lat + 2.6;
      lane = clamp(lane, -T.w[ti] + 0.8, T.w[ti] - 0.8);
    });
    var tx = T.pts[ti][0] + T.nx[ti] * lane, ty = T.pts[ti][1] + T.ny[ti] * lane;
    var want = Math.atan2(ty - c.y, tx - c.x), da = angNorm(want - c.h);
    var out = { l: 0, r: 0, b: 0 };
    if (da > 0.05) out.r = 1; else if (da < -0.05) out.l = 1;
    var ahead = Math.abs(T.curv[(c.idx + Math.round((4 + sp * 0.5) / 2)) % T.n]);
    if (sp > 12 && ahead > 1.0) out.b = 1;
    if (Math.abs(da) > 1.1 && sp > 7) out.b = 1;
    if (p.item) {
      ai.itemT -= dt;
      if (ai.itemT <= 0) {
        if (p.item === "rocket") { var rk = rankOf(p); if (rk.r > 0) p.useQ = true; else ai.itemT = 0.5; if (rk.r === 0) { p.item = "rocket"; } }
        else p.useQ = true;
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ camera, elimination
  var canvas = $("game"), g = canvas.getContext("2d"), DPR = 1, VW = 0, VH = 0;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 1.5);
    VW = window.innerWidth; VH = window.innerHeight;
    canvas.width = Math.round(VW * DPR); canvas.height = Math.round(VH * DPR);
  }
  window.addEventListener("resize", resize); resize();
  function scale() { return VH / cam.viewH; }  // px per metre
  function toScreen(x, y) { var s = scale(); return { x: (x - cam.x) * s + VW / 2, y: (y - cam.y) * s + VH / 2 }; }

  function leaderOf() {
    var best = null;
    cars.forEach(function (p) { if (p.car && p.car.alive && (!best || p.car.prog > best.car.prog)) best = p; });
    return best;
  }
  function packCentre() {
    var a = cars.filter(function (p) { return p.car && p.car.alive; });
    if (!a.length) return null;
    var lo = a.reduce(function (m, p) { return p.car.prog < m.car.prog ? p : m; }, a[0]);
    var hi = a.reduce(function (m, p) { return p.car.prog > m.car.prog ? p : m; }, a[0]);
    var mid = trackPoint((lo.car.prog + hi.car.prog) / 2 + 8);
    return { car: { x: mid.x, y: mid.y, vx: 0, vy: 0, idx: mid.i, prog: (lo.car.prog + hi.car.prog) / 2 } };
  }
  // How much road to show: a bit more for more drivers, enough to fit the pack, never more than the
  // (slowly shrinking) heat limit. Changes are eased so the zoom never jumps.
  function viewTarget() {
    var a = cars.filter(function (p) { return p.car && p.car.alive; });
    if (!a.length) return CFG.viewH;
    var hi = -1e9, lo = 1e9;
    a.forEach(function (p) { hi = Math.max(hi, p.car.prog); lo = Math.min(lo, p.car.prog); });
    var base = 60 + 4.5 * Math.min(8, a.length);
    var fit = (hi - lo) * 0.95 + 34;
    var maxV = CFG.viewWide;
    if (S.phase === "race" && cars.length > 1) maxV = lerp(CFG.viewWide, CFG.viewTight, clamp((S.heatTime - CFG.squeezeFrom) / CFG.squeezeOver, 0, 1));
    cam.limit = clamp((fit - maxV) / 25, 0, 1);       // >0 when the limit is what keeps the pack from fitting
    return clamp(Math.max(base, fit), CFG.viewMin, maxV);
  }
  function updateCamera(dt, snap) {
    if (S.peek) { cam.x = S.peek[0]; cam.y = S.peek[1]; cam.viewH = CFG.viewH / (S.peek[2] || 1); cam.zoom = S.peek[2] || 1; return; }
    var L = leaderOf(); if (!L) return;
    if (S.phase === "countdown") { L = packCentre() || L; }
    var vt = viewTarget();
    cam.viewH += (vt - cam.viewH) * (snap ? 1 : 1 - Math.exp(-(vt > cam.viewH ? 1.4 : 0.7) * dt));
    cam.zoom = CFG.viewH / cam.viewH;
    // leader sits ahead of the centre by ~12 % of the view; feed forward the smoothing lag so the leader still sees ahead
    var K = 4, i = L.car.idx, sp = Math.hypot(L.car.vx, L.car.vy);
    var lead = (snap ? 0 : sp / K) - cam.viewH * 0.12;
    var tx = L.car.x + T.tx[i] * lead, ty = L.car.y + T.ty[i] * lead;
    var k = snap ? 1 : 1 - Math.exp(-K * dt);
    cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k;
  }
  function checkElims(dt) {
    var L = leaderOf(); if (!L) return;
    var s = scale(), halfW = VW / 2 / s, halfH = VH / 2 / s;
    cars.forEach(function (p) {
      var c = p.car; if (!c || !c.alive) return;
      var dx = Math.abs(c.x - cam.x), dy = Math.abs(c.y - cam.y);
      var off = dx > halfW + 0.5 || dy > halfH + 0.5;
      var near = dx > halfW * 0.84 || dy > halfH * 0.8;
      c.offT = off ? c.offT + dt : 0;
      if (near && !off) { c.dangerT += dt; if (c.dangerT > 0.25 && !c.warned) { c.warned = true; ev(p, "danger"); } } else { c.dangerT = 0; c.warned = false; }
      // catch-up boost: a kart about to drop off the back edge gets a short automatic burst
      c.rescueCD = Math.max(0, (c.rescueCD || 0) - dt);
      if ((near || off) && S.heatTime > 2.5 && c.rescueCD <= 0 && c.spinT <= 0 && L.car.prog - c.prog > 6) {
        c.rescueCD = CFG.rescue.cd; c.rescueT = CFG.rescue.t;
        c.boostT = Math.max(c.boostT, CFG.rescue.t); c.boostMul = Math.max(c.boostMul || 1, CFG.rescue.mul);
        sfx("pad"); ev(p, "rescue");
        if (TEST) DBG.rescues = (DBG.rescues || 0) + 1;
      }
      if (c.rescueT > 0) c.rescueT -= dt;
      if (S.heatTime < 2.5) c.offT = 0;   // grace period right after GO
      if (c.offT > 0.15) eliminate(p, "screen");
      else if (L.car.prog - c.prog > CFG.behindMax) eliminate(p, "behind");
    });
  }

  // ------------------------------------------------------------------ fx
  function addSkid(c) {
    var fx = Math.cos(c.h), fy = Math.sin(c.h), rx = -fy, ry = fx;
    [-1, 1].forEach(function (s) { skids.push({ x: c.x - fx * 1.0 + rx * s * 0.6, y: c.y - fy * 1.0 + ry * s * 0.6, a: 1 }); });
    if (skids.length > 1600) skids.splice(0, skids.length - 1600);
  }
  function puff(x, y, col, n) {
    for (var i = 0; i < n; i++) parts.push({ x: x, y: y, vx: rnd(-2, 2), vy: rnd(-2, 2), life: rnd(0.4, 0.8), max: 0.8, r: rnd(0.6, 1.4), col: col, grow: 2.2 });
  }
  function burst(x, y, col, n, sp) {
    for (var i = 0; i < n; i++) { var a = Math.random() * 6.283, v = rnd(sp * 0.3, sp); parts.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(0.4, 0.9), max: 0.9, r: rnd(0.4, 1.0), col: col, grow: 0.6 }); }
  }
  var texts = [], rings = [], shakeAmt = 0;
  function popText(x, y, text, color) { texts.push({ x: x, y: y, text: text, color: color, t: 0 }); if (texts.length > 14) texts.shift(); }
  function ring(x, y, color, maxR, dur) { rings.push({ x: x, y: y, color: color, maxR: maxR, dur: dur, t: 0 }); }
  function shake(px) { shakeAmt = Math.max(shakeAmt, px); }
  function sparks(x, y, v) {
    for (var i = 0; i < Math.min(10, 2 + v); i++) { var a = Math.random() * 6.283, sp = rnd(4, 9); parts.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rnd(0.15, 0.35), max: 0.35, r: 0.12, col: Math.random() < 0.5 ? "#fff59d" : "#ffb300", grow: 0 }); }
  }
  function land(p) {
    var c = p.car; puff(c.x, c.y, "rgba(230,220,200,0.8)", 6); sfx("bump"); shake(2);
  }
  function stepPeds(dt) {
    T.peds.forEach(function (pd) {
      pd.ph += dt * 7;
      if (pd.alert > 0) pd.alert -= dt;
      if (pd.dodge > 0) { pd.dodge -= dt; pd.lat += pd.dodgeDir * 6 * dt; return; }
      var edge = T.w[pd.i] + 1.6;
      if (pd.wait > 0) { pd.wait -= dt; return; }
      pd.lat += pd.dir * pd.speed * dt;
      if (pd.lat * pd.dir >= edge) { pd.lat = pd.dir * edge; pd.dir = -pd.dir; pd.wait = 3 + Math.random() * 6; }
    });
  }
  function stepParts(dt) {
    shakeAmt *= Math.exp(-7 * dt); if (shakeAmt < 0.2) shakeAmt = 0;
    texts.forEach(function (t) { t.t += dt; }); texts = texts.filter(function (t) { return t.t < 1.3; });
    rings.forEach(function (r) { r.t += dt; }); rings = rings.filter(function (r) { return r.t < r.dur; });
    for (var i = 0; i < parts.length; i++) { var q = parts[i]; q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 0.94; q.vy *= 0.94; q.r += q.grow * dt; }
    parts = parts.filter(function (q) { return q.life > 0; });
    if (parts.length > 900) parts.splice(0, parts.length - 900);
  }

  // ------------------------------------------------------------------ aerial photo (Maa- ja Ruumiamet orthophoto tiles)
  // Web-Mercator tiles, zoom 18 (~0,3 m/px). Drawn under the game; if they cannot load the vector map is shown instead.
  var PHOTO = { on: QS.photo !== "0", z: 18, cache: {}, loading: 0, ok: 0, fail: 0, queue: [] };
  var LAT0 = 59.350, LON0 = 24.610, KY = 111320, KX = 111320 * Math.cos(LAT0 * Math.PI / 180);
  var TN = Math.pow(2, PHOTO.z);
  function lon2tx(lon) { return (lon + 180) / 360 * TN; }
  function lat2ty(lat) { var r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * TN; }
  function tx2lon(tx) { return tx / TN * 360 - 180; }
  function ty2lat(ty) { return Math.atan(Math.sinh(Math.PI * (1 - 2 * ty / TN))) * 180 / Math.PI; }
  function tileAt(x, y) { return [Math.floor(lon2tx(LON0 + x / KX)), Math.floor(lat2ty(LAT0 - y / KY))]; }
  function tileRect(tx, ty) {
    return [(tx2lon(tx) - LON0) * KX, -(ty2lat(ty) - LAT0) * KY, (tx2lon(tx + 1) - LON0) * KX, -(ty2lat(ty + 1) - LAT0) * KY];
  }
  function tileUrl(tx, ty) { return "https://tiles.maaamet.ee/tm/tms/1.0.0/foto@GMC/" + PHOTO.z + "/" + tx + "/" + (TN - 1 - ty) + ".jpg"; }
  function photoTile(tx, ty, request) {
    var k = tx + "/" + ty, t = PHOTO.cache[k];
    if (!t && request) {
      t = PHOTO.cache[k] = { img: null, state: 0, r: tileRect(tx, ty), tx: tx, ty: ty };
      PHOTO.queue.push(t); pumpPhoto();
    }
    return t;
  }
  function pumpPhoto() {
    while (PHOTO.loading < 8 && PHOTO.queue.length) {
      var t = PHOTO.queue.shift(); if (t.state !== 0) continue;
      t.state = 1; PHOTO.loading++;
      (function (t) {
        var im = new Image();
        im.decoding = "async";
        im.onload = function () { t.img = im; t.state = 2; PHOTO.loading--; PHOTO.ok++; pumpPhoto(); };
        im.onerror = function () { t.state = 3; PHOTO.loading--; PHOTO.fail++; pumpPhoto(); };
        im.src = tileUrl(t.tx, t.ty);
      })(t);
    }
  }
  // queue every tile within ~70 m of the track so the whole lap is ready
  function prefetchTrack(tr) {
    if (!PHOTO.on) return;
    var seen = {};
    for (var i = 0; i < tr.n; i += 10) {
      for (var ox = -70; ox <= 70; ox += 35) for (var oy = -70; oy <= 70; oy += 35) {
        var t = tileAt(tr.pts[i][0] + ox, tr.pts[i][1] + oy), k = t[0] + "/" + t[1];
        if (!seen[k]) { seen[k] = 1; photoTile(t[0], t[1], true); }
      }
    }
  }
  function photoUsable() { return PHOTO.on && !(PHOTO.fail > 6 && PHOTO.ok === 0); }

  // ------------------------------------------------------------------ canvas icons (24x24 SVG paths)
  var ICONP = {
    turbo: new Path2D("M13.5 2 5 13.4h5.6L9.2 22 19 9.9h-5.8z"),
    mega: new Path2D("M9.5 2 3 11.5h4.3L6 20l7.5-10H9.3zM17.5 4 12 12h3.6l-1.1 8L21 11h-4z"),
    rocket: new Path2D("M12 1.5c3.2 2.4 4.8 5.8 4.8 10.2v4.6l2.7 2.8v2.4l-4.4-1.6H8.9l-4.4 1.6v-2.4l2.7-2.8v-4.6C7.2 7.3 8.8 3.9 12 1.5z"),
    oil: new Path2D("M12 2.5s-6.5 7.4-6.5 12A6.5 6.5 0 0 0 18.5 14.5C18.5 9.9 12 2.5 12 2.5z"),
    shield: new Path2D("M12 2 20 5v6.4c0 5-3.4 8.9-8 10.6-4.6-1.7-8-5.6-8-10.6V5z")
  };
  function iconAt(k, x, y, size, col) { g.save(); g.translate(x - size / 2, y - size / 2); g.scale(size / 24, size / 24); g.fillStyle = col || "#fff"; g.fill(ICONP[k]); g.restore(); }

  // ------------------------------------------------------------------ rendering
  var COL = {
    grass: "#86c06c", grass2: "#7bb563", verge: "#9fcd7f", asphalt: "#4d535c", asphalt2: "#5a616b", side: "#666d77",
    line: "rgba(255,255,255,0.9)", fence: "#2f5d3a", forest: "#5f9c52", park: "#93cf74", water: "#58b5e8", parking: "#9aa1aa", pitch: "#5fb35a"
  };
  var ROOF = { h: ["#d9826b", "#c96f5c", "#a7b3bf", "#8d98a6", "#e0a271", "#b9866d"], a: ["#c7ccd3", "#b8bec6", "#d5d0c4"], c: ["#9aa6b4", "#b5bec9", "#8f99a6"], o: ["#8b8f96", "#a3958a"] };

  function inView(bb, pad) {
    var s = scale(), hw = VW / 2 / s + (pad || 0), hh = VH / 2 / s + (pad || 0);
    return !(bb[2] < cam.x - hw || bb[0] > cam.x + hw || bb[3] < cam.y - hh || bb[1] > cam.y + hh);
  }

  var dimC = document.createElement("canvas"), dimCtx = dimC.getContext("2d");
  function sizeDim() { if (dimC.width !== canvas.width || dimC.height !== canvas.height) { dimC.width = canvas.width; dimC.height = canvas.height; } }
  // vector fallback map (used when the aerial photo is off or still loading)
  function drawVectorBase(hw, hh) {
    g.fillStyle = COL.grass2;
    for (var gx = Math.floor((cam.x - hw) / 24) * 24; gx < cam.x + hw; gx += 48) g.fillRect(gx, cam.y - hh, 24, hh * 2);
    MAP.areas.forEach(function (a) {
      if (!inView(a.bb, 5)) return;
      g.fillStyle = a.k === "f" ? COL.forest : a.k === "w" ? COL.water : a.k === "k" ? COL.parking : a.k === "p" ? COL.pitch : a.k === "x" ? COL.grass : COL.park;
      g.fill(a.path);
    });
    MAP.lines.forEach(function (l) {
      if (!inView(l.bb, 10)) return;
      if (l.k === "R") { g.strokeStyle = "#8a7a6a"; g.lineWidth = 3.4; g.stroke(l.path); g.strokeStyle = "#c9ccd1"; g.lineWidth = 1.6; g.stroke(l.path); g.strokeStyle = "#6e5f52"; g.lineWidth = 1.1; g.stroke(l.path); }
      else { g.strokeStyle = COL.water; g.lineWidth = l.k === "V" ? 4 : 2; g.lineCap = "round"; g.stroke(l.path); g.lineCap = "butt"; }
    });
    g.lineCap = "round"; g.lineJoin = "round";
    MAP.roads.forEach(function (r) { if (!inView(r.bb, 10)) return; g.strokeStyle = "#d7d9db"; g.lineWidth = r.w + 3; g.stroke(r.path); });
    MAP.roads.forEach(function (r) { if (!inView(r.bb, 10)) return; g.strokeStyle = COL.side; g.lineWidth = r.w; g.stroke(r.path); });
    g.lineCap = "butt"; g.lineJoin = "miter";
  }
  function drawVectorTop(hw, hh) {
    var vis = MAP.buildings.filter(function (b, bi) { return !T.hidden[bi] && inView(b.bb, 8); });
    g.fillStyle = "rgba(20,40,20,0.28)";
    vis.forEach(function (b) { var o = 0.6 + b.lv * 0.6; g.save(); g.translate(o, o * 0.8); g.fill(b.path); g.restore(); });
    vis.forEach(function (b) {
      var pal = ROOF[b.k] || ROOF.h, col = pal[(Math.abs(Math.round(b.c[0] * 7 + b.c[1] * 3))) % pal.length];
      g.fillStyle = col; g.fill(b.path); g.strokeStyle = "rgba(0,0,0,0.25)"; g.lineWidth = 0.2; g.stroke(b.path);
    });
    var x0 = Math.floor((cam.x - hw - 10) / 50), x1 = Math.floor((cam.x + hw + 10) / 50), y0 = Math.floor((cam.y - hh - 10) / 50), y1 = Math.floor((cam.y + hh + 10) / 50);
    var cells = [];
    for (var ix = x0; ix <= x1; ix++) for (var iy = y0; iy <= y1; iy++) { var cell = T.treeGrid[ix + "," + iy]; if (cell) cells.push(cell); }
    var pass = function (col, dx, dy, rf, sel) {
      g.fillStyle = col; g.beginPath();
      for (var ci = 0; ci < cells.length; ci++) for (var ti = 0; ti < cells[ci].length; ti++) {
        var t = cells[ci][ti]; if (sel && !sel(t)) continue;
        var r = t.r * rf, x = t.x + dx * t.r, y = t.y + dy * t.r; g.moveTo(x + r, y); g.arc(x, y, r, 0, 6.283);
      }
      g.fill();
    };
    pass("rgba(20,50,20,0.3)", 0.45, 0.4, 1);
    pass("#3f7d3a", 0, 0, 1, function (t) { return t.s < 0.5; });
    pass("#4b8d40", 0, 0, 1, function (t) { return t.s >= 0.5; });
    pass("rgba(255,255,255,0.12)", -0.3, -0.3, 0.5);
  }
  function render(now) {
    sizeDim();
    var t0 = TEST ? performance.now() : 0;
    renderInner(now);
    if (TEST) { var ms = performance.now() - t0; DBG.rN = (DBG.rN || 0) + 1; DBG.rMs = (DBG.rMs || 0) + ms; DBG.rMax = Math.max(DBG.rMax || 0, ms); }
  }
  function renderInner(now) {
    var s = scale();
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    g.fillStyle = COL.grass; g.fillRect(0, 0, VW, VH);
    if (!T) return;
    var shx = shakeAmt ? (Math.random() - 0.5) * 2 * shakeAmt : 0, shy = shakeAmt ? (Math.random() - 0.5) * 2 * shakeAmt : 0;
    g.setTransform(DPR * s, 0, 0, DPR * s, DPR * (VW / 2 - cam.x * s + shx), DPR * (VH / 2 - cam.y * s + shy));
    var hw = VW / 2 / s, hh = VH / 2 / s;
    // which photo tiles are visible, and are they all loaded?
    var tiles = [], allPhoto = false;
    if (photoUsable()) {
      var a0 = tileAt(cam.x - hw - 2, cam.y - hh - 2), a1 = tileAt(cam.x + hw + 2, cam.y + hh + 2);
      allPhoto = true;
      for (var ttx = a0[0]; ttx <= a1[0]; ttx++) for (var tty = a0[1]; tty <= a1[1]; tty++) {
        var tl = photoTile(ttx, tty, true); tiles.push(tl); if (tl.state !== 2) allPhoto = false;
      }
      // look-ahead ring so tiles are ready before they scroll in
      var b0 = tileAt(cam.x - hw - 60, cam.y - hh - 60), b1 = tileAt(cam.x + hw + 60, cam.y + hh + 60);
      for (ttx = b0[0]; ttx <= b1[0]; ttx++) for (tty = b0[1]; tty <= b1[1]; tty++) photoTile(ttx, tty, true);
    }
    if (!allPhoto) drawVectorBase(hw, hh);
    if (tiles.length) {
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
      tiles.forEach(function (t) { if (t.state === 2) { var r = t.r; g.drawImage(t.img, r[0] - 0.08, r[1] - 0.08, r[2] - r[0] + 0.16, r[3] - r[1] + 0.16); } });
    }
    var photoMode = allPhoto || tiles.some(function (t) { return t.state === 2; });
    var visChunks = T.chunks.filter(function (c) { return inView(c.bb, 12); });
    g.lineCap = "round"; g.lineJoin = "round";
    if (photoMode) {
      // dim everything outside the race corridor so the route reads clearly on the photo
      dimCtx.setTransform(1, 0, 0, 1, 0, 0);
      dimCtx.clearRect(0, 0, dimC.width, dimC.height);
      dimCtx.fillStyle = "rgba(10,20,30,0.38)"; dimCtx.fillRect(0, 0, dimC.width, dimC.height);
      dimCtx.setTransform(DPR * s, 0, 0, DPR * s, DPR * (VW / 2 - cam.x * s), DPR * (VH / 2 - cam.y * s));
      dimCtx.globalCompositeOperation = "destination-out"; dimCtx.lineCap = "round"; dimCtx.lineJoin = "round";
      dimCtx.strokeStyle = "#000";
      visChunks.forEach(function (c) { dimCtx.lineWidth = (c.w + CFG.VERGE) * 2; dimCtx.stroke(c.path); });
      dimCtx.globalCompositeOperation = "source-over";
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(dimC, 0, 0); g.restore();
    } else {
      g.strokeStyle = COL.verge; visChunks.forEach(function (c) { g.lineWidth = (c.w + CFG.VERGE) * 2; g.stroke(c.path); });
      g.strokeStyle = "#d9dcdf"; visChunks.forEach(function (c) { g.lineWidth = c.w * 2 + 1.6; g.stroke(c.path); });
      g.strokeStyle = COL.asphalt; visChunks.forEach(function (c) { g.lineWidth = c.w * 2; g.stroke(c.path); });
      g.lineCap = "butt";
      g.strokeStyle = "rgba(255,255,255,0.8)"; g.lineWidth = 0.15; g.setLineDash([3, 6]); g.stroke(T.center); g.setLineDash([]);
    }
    g.lineCap = "butt";
    // fence: red/white tape along the corridor edge
    g.strokeStyle = "#ffffff"; g.lineWidth = 0.45; g.stroke(T.fenceL); g.stroke(T.fenceR);
    g.strokeStyle = "#e53935"; g.setLineDash([1.2, 1.2]); g.stroke(T.fenceL); g.stroke(T.fenceR); g.setLineDash([]);
    g.lineJoin = "miter";
    // street names painted on the asphalt
    T.paint.forEach(function (pt) {
      if (Math.abs(pt.x - cam.x) > hw + 30 || Math.abs(pt.y - cam.y) > hh + 30) return;
      g.save(); g.translate(pt.x, pt.y);
      var ang = pt.a; if (Math.cos(ang) < -0.2) ang += Math.PI;   // keep text readable
      g.rotate(ang);
      var fsz = Math.min(2.4, pt.w * 0.7);
      g.font = "700 " + fsz + "px Fredoka, system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
      g.lineWidth = fsz * 0.14; g.strokeStyle = "rgba(20,25,30,0.55)"; g.strokeText(pt.name, 0, 0);
      g.fillStyle = "rgba(255,255,255,0.85)"; g.fillText(pt.name, 0, 0);
      g.restore();
    });
    // zebra crossings and ramps (on the road surface)
    T.crossings.forEach(function (cr) { if (Math.abs(cr.x - cam.x) < hw + 15 && Math.abs(cr.y - cam.y) < hh + 15) drawCrossing(cr); });
    T.ramps.forEach(function (rp) { if (Math.abs(rp.x - cam.x) < hw + 15 && Math.abs(rp.y - cam.y) < hh + 15) drawRamp(rp, now); });
    // start line
    drawStart();
    // pads
    T.pads.forEach(function (pd) { if (Math.abs(pd.x - cam.x) < hw + 20 && Math.abs(pd.y - cam.y) < hh + 20) drawPad(pd, now); });
    // skids
    g.fillStyle = "rgba(25,25,28,0.32)";
    skids.forEach(function (k) { if (Math.abs(k.x - cam.x) < hw && Math.abs(k.y - cam.y) < hh) { g.globalAlpha = clamp(k.a, 0, 1); g.fillRect(k.x - 0.18, k.y - 0.18, 0.36, 0.36); } });
    g.globalAlpha = 1;
    // oil
    oils.forEach(function (o) { drawOil(o, now); });
    // barriers
    T.barriers.forEach(function (b) { if (Math.abs(b.x - cam.x) < hw + 10 && Math.abs(b.y - cam.y) < hh + 10) drawBarrier(b); });
    if (!photoMode) drawVectorTop(hw, hh);
    // boxes
    T.boxes.forEach(function (b) { if (b.alive && Math.abs(b.x - cam.x) < hw + 4 && Math.abs(b.y - cam.y) < hh + 4) drawBox(b, now); });
    // rockets
    rockets.forEach(function (r) { drawRocket(r, now); });
    // pedestrians
    T.peds.forEach(function (pd) { drawPed(pd, now, hw, hh); });
    // karts: ground first, airborne on top
    cars.forEach(function (p) { if (p.car && p.car.alive && !p.car.air) drawCar(p, now); });
    cars.forEach(function (p) { if (p.car && p.car.alive && p.car.air) drawCar(p, now); });
    // shockwave rings
    rings.forEach(function (r) {
      var f = r.t / r.dur;
      g.strokeStyle = r.color; g.globalAlpha = 1 - f; g.lineWidth = 0.5 * (1 - f) + 0.1;
      g.beginPath(); g.arc(r.x, r.y, r.maxR * (0.2 + 0.8 * Math.sqrt(f)), 0, 6.283); g.stroke();
    });
    g.globalAlpha = 1;
    // particles
    parts.forEach(function (q) { g.globalAlpha = clamp(q.life / q.max, 0, 1); g.fillStyle = q.col; g.beginPath(); g.arc(q.x, q.y, q.r, 0, 6.283); g.fill(); });
    g.globalAlpha = 1;

    // ---- screen-space overlays
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    // POI and street signs
    var fs = clamp(VH / 58, 12, 22);
    g.font = "600 " + fs + "px Fredoka, system-ui, sans-serif"; g.textBaseline = "middle";
    tagBoxes = [];
    T.signs.forEach(function (sg) { if (Math.abs(sg.x - cam.x) < hw + 20 && Math.abs(sg.y - cam.y) < hh + 10) { var q = toScreen(sg.x, sg.y); tag(q.x, q.y, sg.name, "#1e5fb4", "#fff", fs * 1.1, true, false, true); } });
    MAP.pois.forEach(function (p) { if (Math.abs(p.x - cam.x) < hw + 20 && Math.abs(p.y - cam.y) < hh + 10) { var q = toScreen(p.x, p.y); landmark(q.x, q.y, p, fs); } });
    // name pills above cars + danger rings
    cars.forEach(function (p) {
      var c = p.car; if (!c || !c.alive) return;
      var q = toScreen(c.x, c.y);
      var fs2 = clamp(VH / 52, 13, 24);
      g.font = "700 " + fs2 + "px Fredoka, system-ui, sans-serif";
      var py = q.y - s * 2.4 - fs2 * 0.7;
      var tw = tag(q.x, py, p.name, p.color, "#fff", fs2, false, true);
      if (p.item) {
        var ic = LK.ITEMS[p.item], ix = q.x + tw / 2 + fs2 * 0.8, R2 = fs2 * 0.72;
        g.fillStyle = "#fff"; g.beginPath(); g.arc(ix, py, R2, 0, 6.283); g.fill();
        g.fillStyle = ic.color; g.beginPath(); g.arc(ix, py, R2 * 0.84, 0, 6.283); g.fill();
        iconAt(p.item, ix, py, R2 * 1.2, "#fff");
      }
      if (c.rescueT > 0) {
        g.globalAlpha = clamp(c.rescueT / 0.4, 0, 1);
        g.font = "700 " + Math.round(fs2 * 0.78) + "px Fredoka, system-ui, sans-serif";
        tag(q.x, py - fs2 * 1.55, "CATCH-UP BOOST!", "#13a8ff", "#fff", fs2 * 0.78, false, true);
        g.globalAlpha = 1;
      }
      if (c.dangerT > 0 && S.phase === "race") {
        var pulse = 0.5 + 0.5 * Math.sin(now / 90);
        g.strokeStyle = "rgba(255,60,60," + (0.5 + 0.5 * pulse) + ")"; g.lineWidth = 4;
        g.beginPath(); g.arc(q.x, q.y, s * 2.4 + pulse * 6, 0, 6.283); g.stroke();
      }
    });
    // floating texts
    texts.forEach(function (t) {
      var q = toScreen(t.x, t.y), f = t.t / 1.3, sz = clamp(VH / 30, 18, 40) * (t.t < 0.15 ? 0.6 + t.t / 0.15 * 0.6 : 1.2 - f * 0.2);
      g.globalAlpha = f < 0.7 ? 1 : (1 - f) / 0.3;
      g.font = "700 " + Math.round(sz) + "px Fredoka, system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
      var yy = q.y - s * 3.5 - f * sz * 1.6;
      g.lineWidth = sz * 0.16; g.strokeStyle = "rgba(10,15,25,0.85)"; g.strokeText(t.text, q.x, yy);
      g.fillStyle = t.color; g.fillText(t.text, q.x, yy);
    });
    g.globalAlpha = 1;
    // edge vignette when the camera squeezes
    if (S.phase === "race" && cam.limit > 0.02) {
      var a = cam.limit;
      var grd = g.createRadialGradient(VW / 2, VH / 2, Math.min(VW, VH) * 0.35, VW / 2, VH / 2, Math.max(VW, VH) * 0.7);
      grd.addColorStop(0, "rgba(255,40,60,0)"); grd.addColorStop(1, "rgba(255,40,60," + (0.35 * a) + ")");
      g.fillStyle = grd; g.fillRect(0, 0, VW, VH);
    }
  }

  var tagBoxes = [];
  function tag(x, y, text, bg, fg, fs, sign, pill, avoid) {
    var w = g.measureText(text).width + fs * (pill ? 1.0 : 0.9), h = fs * 1.55;
    if (avoid) {
      for (var i = 0; i < tagBoxes.length; i++) { var b = tagBoxes[i]; if (Math.abs(b[0] - x) < (b[2] + w) / 2 + 4 && Math.abs(b[1] - y) < (b[3] + h) / 2 + 3) return w; }
      tagBoxes.push([x, y, w, h]);
    }
    g.fillStyle = "rgba(0,0,0,0.25)"; rr(x - w / 2 + 2, y - h / 2 + 3, w, h, h * (pill ? 0.5 : 0.25)); g.fill();
    g.fillStyle = bg; rr(x - w / 2, y - h / 2, w, h, h * (pill ? 0.5 : 0.25)); g.fill();
    if (sign) { g.strokeStyle = "#fff"; g.lineWidth = 2; rr(x - w / 2 + 2.5, y - h / 2 + 2.5, w - 5, h - 5, h * 0.18); g.stroke(); }
    g.fillStyle = fg; g.textAlign = "center"; g.fillText(text, x, y + 1);
    return w;
  }
  var LM = [
    [/supermarket|convenience|bakery|wine|florist|hardware|bicycle|retail|hairdresser/, "#ff8a3d", "shop"],
    [/school|kindergarten|library/, "#3d8bff", "school"],
    [/pharmacy|doctors/, "#2ed573", "health"],
    [/fuel/, "#ffd23f", "fuel"],
    [/pitch|sports|recreation|park/, "#7bd65a", "sport"],
    [/restaurant|cafe/, "#ff5d8f", "food"]
  ];
  function landmark(x, y, p, fs) {
    var col = "#a0a8b4", kind = "dot";
    if (/korsten/i.test(p.name)) { col = "#c0392b"; kind = "chimney"; }
    else for (var i = 0; i < LM.length; i++) if (LM[i][0].test(p.type) || LM[i][0].test(p.name.toLowerCase())) { col = LM[i][1]; kind = LM[i][2]; break; }
    var w = g.measureText(p.name).width + fs * 2.4, h = fs * 1.7;
    for (var k = 0; k < tagBoxes.length; k++) { var b = tagBoxes[k]; if (Math.abs(b[0] - x) < (b[2] + w) / 2 + 4 && Math.abs(b[1] - y) < (b[3] + h) / 2 + 3) return; }
    tagBoxes.push([x, y, w, h]);
    // pin + label
    g.fillStyle = "rgba(0,0,0,0.3)"; rr(x - w / 2 + 2, y - h / 2 + 3, w, h, h / 2); g.fill();
    g.fillStyle = "rgba(255,255,255,0.95)"; rr(x - w / 2, y - h / 2, w, h, h / 2); g.fill();
    var cx = x - w / 2 + h / 2, cy = y, r = h * 0.38;
    g.fillStyle = col; g.beginPath(); g.arc(cx, cy, r, 0, 6.283); g.fill();
    g.fillStyle = "#fff"; g.strokeStyle = "#fff"; g.lineWidth = 1.6;
    if (kind === "shop") { g.fillRect(cx - r * 0.5, cy - r * 0.2, r, r * 0.6); g.beginPath(); g.arc(cx, cy - r * 0.2, r * 0.32, Math.PI, 0); g.stroke(); }
    else if (kind === "school") { g.beginPath(); g.moveTo(cx - r * 0.6, cy - r * 0.1); g.lineTo(cx, cy - r * 0.55); g.lineTo(cx + r * 0.6, cy - r * 0.1); g.fill(); g.fillRect(cx - r * 0.45, cy - r * 0.1, r * 0.9, r * 0.55); }
    else if (kind === "health") { g.fillRect(cx - r * 0.15, cy - r * 0.55, r * 0.3, r * 1.1); g.fillRect(cx - r * 0.55, cy - r * 0.15, r * 1.1, r * 0.3); }
    else if (kind === "fuel") { g.fillRect(cx - r * 0.4, cy - r * 0.5, r * 0.55, r); g.fillRect(cx + r * 0.2, cy - r * 0.2, r * 0.2, r * 0.6); }
    else if (kind === "chimney") { g.fillRect(cx - r * 0.18, cy - r * 0.6, r * 0.36, r * 1.15); g.beginPath(); g.arc(cx + r * 0.25, cy - r * 0.65, r * 0.22, 0, 6.283); g.fill(); }
    else if (kind === "sport") { g.beginPath(); g.arc(cx, cy, r * 0.5, 0, 6.283); g.stroke(); }
    else if (kind === "food") { g.fillRect(cx - r * 0.35, cy - r * 0.5, r * 0.15, r); g.fillRect(cx + r * 0.2, cy - r * 0.5, r * 0.15, r); }
    else { g.beginPath(); g.arc(cx, cy, r * 0.35, 0, 6.283); g.fill(); }
    g.fillStyle = "#1d2733"; g.textAlign = "left"; g.fillText(p.name, cx + r + fs * 0.4, y + 1);
  }
  function rr(x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

  function drawStart() {
    var i = 0, p = T.pts[i];
    g.save(); g.translate(p[0], p[1]); g.rotate(T.ang[i]);
    var W0 = T.w[0], sq = 0.9, rowsN = 2, cols = Math.round(W0 * 2 / sq);
    for (var r = 0; r < rowsN; r++) for (var k = 0; k < cols; k++) { g.fillStyle = (r + k) % 2 ? "#111" : "#fff"; g.fillRect(-sq + r * sq, -W0 + k * sq, sq, sq); }
    g.restore();
  }
  function drawPad(pd, now) {
    g.save(); g.translate(pd.x + T.nx[pd.i] * pd.lat, pd.y + T.ny[pd.i] * pd.lat); g.rotate(pd.a);
    var gl = g.createRadialGradient(0, 0, 0.5, 0, 0, 4);
    gl.addColorStop(0, "rgba(255,190,40,0.55)"); gl.addColorStop(1, "rgba(255,190,40,0)");
    g.fillStyle = gl; g.beginPath(); g.arc(0, 0, 4, 0, 6.283); g.fill();
    var pg = g.createLinearGradient(-2.6, 0, 2.6, 0); pg.addColorStop(0, "#ff8f00"); pg.addColorStop(1, "#ffd54f");
    g.fillStyle = pg; rr(-2.6, -1.5, 5.2, 3, 0.6); g.fill();
    g.strokeStyle = "rgba(255,255,255,0.8)"; g.lineWidth = 0.12; g.stroke();
    var ph = (now / 260) % 1;
    for (var k = 0; k < 3; k++) {
      var x = -1.9 + k * 1.45 + ph * 0.5;
      g.fillStyle = "rgba(255,255,255," + (0.55 + 0.45 * ((k + ph) % 1)) + ")";
      g.beginPath(); g.moveTo(x, -1.0); g.lineTo(x + 0.8, 0); g.lineTo(x, 1.0); g.lineTo(x - 0.45, 1.0); g.lineTo(x + 0.35, 0); g.lineTo(x - 0.45, -1.0); g.closePath(); g.fill();
    }
    g.restore();
  }
  function drawBarrier(b) {
    g.save(); g.translate(b.x, b.y); g.rotate(b.a);
    var w = b.w;
    g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(-w / 2 + 0.2, -0.3, w, 0.75);
    g.fillStyle = "#fff"; g.fillRect(-w / 2, -0.4, w, 0.7);
    g.fillStyle = "#e53935";
    for (var x = -w / 2; x < w / 2; x += 1.1) g.fillRect(x, -0.4, 0.55, 0.7);
    g.fillStyle = "#ff7a00";
    [-w / 2 - 0.4, w / 2 + 0.4].forEach(function (x) { g.beginPath(); g.arc(x, 0, 0.42, 0, 6.283); g.fill(); });
    g.restore();
  }
  function drawBox(b, now) {
    var t = now / 1000 + b.ph, bob = Math.sin(t * 3.2) * 0.18, S2 = 1.15;
    var minPx = 30 / scale(); S2 = Math.max(S2, minPx / 2);       // never smaller than ~30 px on screen
    g.save(); g.translate(b.x, b.y);
    // glow halo
    var gl = g.createRadialGradient(0, 0, 0, 0, 0, S2 * 2.3);
    gl.addColorStop(0, "rgba(255,240,150,0.55)"); gl.addColorStop(1, "rgba(255,240,150,0)");
    g.fillStyle = gl; g.beginPath(); g.arc(0, 0, S2 * 2.3, 0, 6.283); g.fill();
    // shadow on the ground
    g.fillStyle = "rgba(0,0,0,0.35)"; g.beginPath(); g.ellipse(0.25, 0.45, S2 * 0.95, S2 * 0.6, 0, 0, 6.283); g.fill();
    g.translate(0, -0.35 + bob * 0.4);
    g.rotate(Math.sin(t * 1.3) * 0.25);
    // rainbow rim
    var hue = (t * 90) % 360;
    var rim = g.createLinearGradient(-S2, -S2, S2, S2);
    rim.addColorStop(0, "hsl(" + hue + ",95%,60%)"); rim.addColorStop(0.5, "hsl(" + ((hue + 120) % 360) + ",95%,60%)"); rim.addColorStop(1, "hsl(" + ((hue + 240) % 360) + ",95%,60%)");
    g.fillStyle = rim; rr(-S2, -S2, S2 * 2, S2 * 2, S2 * 0.38); g.fill();
    // glossy face
    var face = g.createLinearGradient(0, -S2, 0, S2);
    face.addColorStop(0, "rgba(255,255,255,0.95)"); face.addColorStop(1, "rgba(215,230,255,0.9)");
    g.fillStyle = face; rr(-S2 * 0.78, -S2 * 0.78, S2 * 1.56, S2 * 1.56, S2 * 0.28); g.fill();
    g.fillStyle = "rgba(255,255,255,0.6)"; rr(-S2 * 0.7, -S2 * 0.72, S2 * 1.4, S2 * 0.45, S2 * 0.2); g.fill();
    g.fillStyle = "hsl(" + ((hue + 200) % 360) + ",80%,45%)";
    g.font = "700 " + (S2 * 1.55).toFixed(2) + "px Fredoka, system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("?", 0, S2 * 0.08);
    g.restore();
  }
  function drawCar(p, now) {
    var c = p.car, z = c.z || 0;
    if (z > 0) {   // shadow stays on the ground while the kart flies
      g.save(); g.translate(c.x + z * 0.9, c.y + z * 1.1); g.rotate(c.h); g.scale(CFG.KS, CFG.KS);
      g.fillStyle = "rgba(0,0,0," + (0.35 - z * 0.08) + ")"; g.beginPath(); g.ellipse(0, 0, 2.4, 1.35, 0, 0, 6.283); g.fill();
      g.restore();
    }
    g.save(); g.translate(c.x, c.y); g.rotate(c.h); g.scale(CFG.KS * (1 + z * 0.22), CFG.KS * (1 + z * 0.22));
    var spin = c.spinT > 0;
    // soft shadow
    if (z <= 0) {
      g.fillStyle = "rgba(0,0,0,0.22)"; g.beginPath(); g.ellipse(0.35, 0.5, 2.6, 1.55, 0, 0, 6.283); g.fill();
      g.fillStyle = "rgba(0,0,0,0.25)"; g.beginPath(); g.ellipse(0.3, 0.4, 2.25, 1.25, 0, 0, 6.283); g.fill();
    }
    // boost flame (blue for the catch-up boost)
    if (c.boostT > 0) {
      var big = c.boostMul > 1.5, blue = c.rescueT > 0, fl = (big ? 2.6 : 1.7) + Math.random() * 1.2;
      var fg = g.createLinearGradient(-2.2, 0, -2.2 - fl, 0);
      fg.addColorStop(0, blue ? "rgba(200,245,255,1)" : "rgba(255,250,200,1)");
      fg.addColorStop(0.35, blue ? "rgba(40,170,255,0.95)" : "rgba(255,170,30,0.95)");
      fg.addColorStop(1, blue ? "rgba(40,120,255,0)" : "rgba(255,60,0,0)");
      g.fillStyle = fg;
      [-0.55, 0.55].forEach(function (yy) { g.beginPath(); g.moveTo(-2.15, yy - 0.32); g.quadraticCurveTo(-2.2 - fl, yy, -2.15, yy + 0.32); g.fill(); });
    }
    // tyres
    var tyre = function (x, y, w, h, rot) {
      g.save(); g.translate(x, y); if (rot) g.rotate(rot);
      g.fillStyle = "#121417"; rr(-w / 2, -h / 2, w, h, 0.18); g.fill();
      g.strokeStyle = "rgba(255,255,255,0.13)"; g.lineWidth = 0.07;
      for (var k = -w / 2 + 0.15; k < w / 2; k += 0.22) { g.beginPath(); g.moveTo(k, -h / 2 + 0.05); g.lineTo(k, h / 2 - 0.05); g.stroke(); }
      g.fillStyle = "#6b7280"; g.beginPath(); g.arc(0, 0, h * 0.18, 0, 6.283); g.fill();
      g.restore();
    };
    tyre(-1.35, -1.2, 1.15, 0.72); tyre(-1.35, 1.2, 1.15, 0.72);
    tyre(1.35, -1.1, 0.95, 0.58, c.steer * 0.45); tyre(1.35, 1.1, 0.95, 0.58, c.steer * 0.45);
    // chassis rails
    g.fillStyle = "#2b2f36"; rr(-1.7, -0.95, 3.4, 1.9, 0.3); g.fill();
    // body: side pods + nose, team colour with highlight
    var body = new Path2D();
    body.moveTo(2.35, 0);
    body.quadraticCurveTo(2.25, -0.55, 1.6, -0.7);
    body.lineTo(0.6, -0.78); body.lineTo(0.2, -1.02); body.lineTo(-1.35, -1.0);
    body.quadraticCurveTo(-1.9, -0.95, -1.95, -0.55); body.lineTo(-1.95, 0.55);
    body.quadraticCurveTo(-1.9, 0.95, -1.35, 1.0); body.lineTo(0.2, 1.02); body.lineTo(0.6, 0.78); body.lineTo(1.6, 0.7);
    body.quadraticCurveTo(2.25, 0.55, 2.35, 0); body.closePath();
    var bg2 = g.createLinearGradient(0, -1.05, 0, 1.05);
    bg2.addColorStop(0, shade(p.color, 40)); bg2.addColorStop(0.45, p.color); bg2.addColorStop(1, p.dark);
    g.fillStyle = bg2; g.fill(body);
    g.lineWidth = 0.09; g.strokeStyle = "rgba(0,0,0,0.55)"; g.stroke(body);
    // racing stripe
    g.fillStyle = "rgba(255,255,255,0.85)"; g.fillRect(0.45, -0.13, 1.75, 0.26);
    // front wing and rear spoiler
    g.fillStyle = "#1d2127"; rr(2.15, -1.25, 0.32, 2.5, 0.1); g.fill();
    g.fillStyle = p.color; rr(2.17, -1.25, 0.28, 0.32, 0.06); g.fill(); rr(2.17, 0.93, 0.28, 0.32, 0.06); g.fill();
    g.fillStyle = "#1d2127"; rr(-2.35, -1.15, 0.45, 2.3, 0.12); g.fill();
    g.fillStyle = p.dark; rr(-2.3, -1.08, 0.35, 2.16, 0.1); g.fill();
    // number disc on the nose
    g.fillStyle = "#fff"; g.beginPath(); g.arc(1.25, 0, 0.36, 0, 6.283); g.fill();
    g.fillStyle = "#111"; g.font = "700 0.5px Fredoka, system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(String(p.slot + 1), 1.25, 0.03);
    // seat + driver helmet with visor
    g.fillStyle = "#1a1d22"; rr(-0.95, -0.55, 1.1, 1.1, 0.35); g.fill();
    var hg = g.createRadialGradient(-0.5, -0.18, 0.05, -0.4, 0, 0.55);
    hg.addColorStop(0, "#ffffff"); hg.addColorStop(0.5, shade(p.color, 55)); hg.addColorStop(1, p.dark);
    g.fillStyle = hg; g.beginPath(); g.arc(-0.4, 0, 0.5, 0, 6.283); g.fill();
    g.fillStyle = "rgba(20,30,50,0.9)"; g.beginPath(); g.ellipse(-0.08, 0, 0.16, 0.36, 0, 0, 6.283); g.fill();
    g.fillStyle = "rgba(255,255,255,0.7)"; g.beginPath(); g.arc(-0.58, -0.2, 0.12, 0, 6.283); g.fill();
    // shield bubble
    if (c.shieldT > 0) {
      var pulse = 0.5 + 0.5 * Math.sin(now / 110);
      var sg = g.createRadialGradient(0, 0, 1.2, 0, 0, 3.2);
      sg.addColorStop(0, "rgba(90,210,255,0.05)"); sg.addColorStop(0.8, "rgba(90,210,255,0.25)"); sg.addColorStop(1, "rgba(160,235,255," + (0.55 + 0.35 * pulse) + ")");
      g.fillStyle = sg; g.beginPath(); g.arc(0, 0, 3.2, 0, 6.283); g.fill();
      g.strokeStyle = "rgba(220,250,255," + (0.6 + 0.4 * pulse) + ")"; g.lineWidth = 0.18; g.stroke();
      g.fillStyle = "rgba(255,255,255,0.5)"; g.beginPath(); g.ellipse(-1.2, -1.4, 0.9, 0.35, -0.6, 0, 6.283); g.fill();
    }
    g.restore();
    // dizzy stars while spinning
    if (spin) {
      for (var k = 0; k < 3; k++) {
        var a = now / 180 + k * 2.094, sx = c.x + Math.cos(a) * 1.9, sy = c.y + Math.sin(a) * 1.9;
        g.save(); g.translate(sx, sy); g.rotate(a * 2);
        g.fillStyle = "#ffe14d"; g.beginPath();
        for (var q = 0; q < 10; q++) { var rr2 = q % 2 ? 0.18 : 0.45, aa = q * 0.628; g.lineTo(Math.cos(aa) * rr2, Math.sin(aa) * rr2); }
        g.closePath(); g.fill(); g.restore();
      }
    }
  }
  function drawRamp(rp, now) {
    g.save(); g.translate(rp.x, rp.y); g.rotate(rp.a);
    var hwid = rp.hw, len = 2.4;
    g.fillStyle = "rgba(0,0,0,0.35)"; g.fillRect(-0.6 + 0.3, -hwid + 0.3, len, hwid * 2);
    var rg = g.createLinearGradient(-0.6, 0, -0.6 + len, 0);
    rg.addColorStop(0, "#5d4037"); rg.addColorStop(1, "#d7a86e");
    g.fillStyle = rg; g.fillRect(-0.6, -hwid, len, hwid * 2);
    // planks
    g.strokeStyle = "rgba(60,30,10,0.45)"; g.lineWidth = 0.06;
    for (var x = -0.6 + 0.4; x < len - 0.6; x += 0.4) { g.beginPath(); g.moveTo(x, -hwid); g.lineTo(x, hwid); g.stroke(); }
    // hazard lip
    for (var y = -hwid, k = 0; y < hwid; y += 0.5, k++) { g.fillStyle = k % 2 ? "#111" : "#ffd600"; g.fillRect(len - 0.6 - 0.35, y, 0.35, Math.min(0.5, hwid - y)); }
    g.strokeStyle = "#fff"; g.lineWidth = 0.1; g.strokeRect(-0.6, -hwid, len, hwid * 2);
    // arrow
    g.fillStyle = "rgba(255,255,255,0.85)"; g.beginPath(); g.moveTo(0.9, 0); g.lineTo(0.2, -0.45); g.lineTo(0.2, 0.45); g.closePath(); g.fill();
    g.restore();
  }
  function drawCrossing(cr) {
    g.save(); g.translate(cr.x, cr.y); g.rotate(cr.a);
    g.fillStyle = "rgba(255,255,255,0.82)";
    for (var y = -cr.w + 0.2; y < cr.w - 0.2; y += 1.0) g.fillRect(-1.5, y, 3.0, 0.5);
    g.restore();
  }
  function drawPed(pd, now, hw, hh) {
    var x = T.pts[pd.i][0] + T.nx[pd.i] * pd.lat, y = T.pts[pd.i][1] + T.ny[pd.i] * pd.lat;
    if (Math.abs(x - cam.x) > hw + 5 || Math.abs(y - cam.y) > hh + 5) return;
    var onRoad = Math.abs(pd.lat) < T.w[pd.i] + 0.3, walking = pd.wait <= 0 && pd.dodge <= 0;
    var face = T.ang[pd.i] + (pd.dodge > 0 ? (pd.dodgeDir > 0 ? Math.PI / 2 : -Math.PI / 2) : (pd.dir > 0 ? Math.PI / 2 : -Math.PI / 2));
    g.save(); g.translate(x, y);
    // warning ring while on the road
    if (onRoad) {
      var pulse = 0.5 + 0.5 * Math.sin(now / 120);
      g.fillStyle = "rgba(255,214,0," + (0.18 + 0.15 * pulse) + ")"; g.beginPath(); g.arc(0, 0, 2.0, 0, 6.283); g.fill();
      g.strokeStyle = "rgba(255,214,0,0.9)"; g.lineWidth = 0.12; g.stroke();
    }
    g.rotate(face);
    var sw = walking ? Math.sin(pd.ph) * 0.28 : 0, sc = 1.9;
    g.scale(sc, sc);
    g.fillStyle = "rgba(0,0,0,0.3)"; g.beginPath(); g.ellipse(0.12, 0.12, 0.34, 0.42, 0, 0, 6.283); g.fill();
    // legs/feet
    g.fillStyle = "#263238"; g.beginPath(); g.ellipse(sw, -0.14, 0.13, 0.08, 0, 0, 6.283); g.fill(); g.beginPath(); g.ellipse(-sw, 0.14, 0.13, 0.08, 0, 0, 6.283); g.fill();
    // body + arms
    g.fillStyle = pd.shirt; g.beginPath(); g.ellipse(0, 0, 0.2, 0.36, 0, 0, 6.283); g.fill();
    g.beginPath(); g.ellipse(-sw * 0.8, -0.36, 0.11, 0.08, 0, 0, 6.283); g.fill(); g.beginPath(); g.ellipse(sw * 0.8, 0.36, 0.11, 0.08, 0, 0, 6.283); g.fill();
    // head
    g.fillStyle = "#f2c9a0"; g.beginPath(); g.arc(0, 0, 0.16, 0, 6.283); g.fill();
    g.fillStyle = "#4e342e"; g.beginPath(); g.arc(-0.04, 0, 0.13, Math.PI * 0.5, Math.PI * 1.5); g.fill();
    g.restore();
    if (pd.alert > 0) {   // "!" bubble after a near miss
      var q = toScreen(x, y);
      g.save(); g.setTransform(DPR, 0, 0, DPR, 0, 0);
      var r = clamp(VH / 70, 9, 16);
      g.fillStyle = "#ffd600"; g.beginPath(); g.arc(q.x, q.y - r * 2.4, r, 0, 6.283); g.fill();
      g.fillStyle = "#111"; g.font = "700 " + Math.round(r * 1.5) + "px Fredoka, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("!", q.x, q.y - r * 2.3);
      g.restore();
    }
  }
  function shade(hex, amt) {
    var n = parseInt(hex.slice(1), 16), r = (n >> 16) + amt, gg = ((n >> 8) & 255) + amt, b = (n & 255) + amt;
    return "rgb(" + clamp(r, 0, 255) + "," + clamp(gg, 0, 255) + "," + clamp(b, 0, 255) + ")";
  }
  function drawOil(o, now) {
    var a = clamp((CFG.oilLife - o.age) / 2, 0, 1);
    g.save(); g.translate(o.x, o.y); g.globalAlpha = a;
    var og = g.createRadialGradient(-0.3, -0.3, 0.1, 0, 0, o.r * 1.2);
    og.addColorStop(0, "#3a2a5c"); og.addColorStop(0.6, "#120c1c"); og.addColorStop(1, "rgba(10,6,16,0.85)");
    g.fillStyle = og;
    g.beginPath();
    for (var k = 0; k <= 12; k++) { var aa = k / 12 * 6.283, rr2 = o.r * (1 + 0.18 * Math.sin(aa * 3 + o.x)); g.lineTo(Math.cos(aa) * rr2 * 1.2, Math.sin(aa) * rr2 * 0.9); }
    g.closePath(); g.fill();
    // rainbow sheen
    var hue = (now / 20) % 360;
    g.strokeStyle = "hsla(" + hue + ",90%,65%,0.45)"; g.lineWidth = 0.18;
    g.beginPath(); g.ellipse(-0.2, -0.15, o.r * 0.6, o.r * 0.35, 0.5, 0, 6.283); g.stroke();
    g.fillStyle = "rgba(255,255,255,0.35)"; g.beginPath(); g.ellipse(-o.r * 0.4, -o.r * 0.35, 0.35, 0.15, 0.5, 0, 6.283); g.fill();
    g.restore();
  }
  function drawRocket(r, now) {
    g.save(); g.translate(r.x, r.y); g.rotate(r.h);
    // flame
    var fl = 1.2 + Math.random() * 0.8, fg = g.createLinearGradient(-0.9, 0, -0.9 - fl, 0);
    fg.addColorStop(0, "rgba(255,250,200,1)"); fg.addColorStop(0.4, "rgba(255,150,30,0.9)"); fg.addColorStop(1, "rgba(255,60,0,0)");
    g.fillStyle = fg; g.beginPath(); g.moveTo(-0.9, -0.28); g.quadraticCurveTo(-0.9 - fl, 0, -0.9, 0.28); g.fill();
    // fins
    g.fillStyle = "#b71c1c"; g.beginPath(); g.moveTo(-0.9, -0.25); g.lineTo(-1.15, -0.6); g.lineTo(-0.45, -0.25); g.fill();
    g.beginPath(); g.moveTo(-0.9, 0.25); g.lineTo(-1.15, 0.6); g.lineTo(-0.45, 0.25); g.fill();
    // body + nose
    var bg3 = g.createLinearGradient(0, -0.3, 0, 0.3); bg3.addColorStop(0, "#ff8a80"); bg3.addColorStop(1, "#c62828");
    g.fillStyle = bg3; rr(-0.95, -0.27, 1.5, 0.54, 0.2); g.fill();
    g.fillStyle = "#eceff1"; g.beginPath(); g.moveTo(0.5, -0.27); g.quadraticCurveTo(1.25, 0, 0.5, 0.27); g.fill();
    g.fillStyle = "#ffeb3b"; g.fillRect(-0.3, -0.27, 0.18, 0.54);
    g.restore();
    // target marker on the victim
    if (r.target && r.target.car && r.target.car.alive) {
      var tc = r.target.car, pulse = 0.5 + 0.5 * Math.sin(now / 80);
      g.strokeStyle = "rgba(255,50,50," + (0.5 + 0.5 * pulse) + ")"; g.lineWidth = 0.22;
      g.beginPath(); g.arc(tc.x, tc.y, 2.4 + pulse * 0.4, 0, 6.283); g.stroke();
      g.beginPath(); g.moveTo(tc.x - 3.2, tc.y); g.lineTo(tc.x - 1.6, tc.y); g.moveTo(tc.x + 1.6, tc.y); g.lineTo(tc.x + 3.2, tc.y);
      g.moveTo(tc.x, tc.y - 3.2); g.lineTo(tc.x, tc.y - 1.6); g.moveTo(tc.x, tc.y + 1.6); g.lineTo(tc.x, tc.y + 3.2); g.stroke();
    }
  }

  // ------------------------------------------------------------------ minimap
  var mini = $("minimap"), mg = mini.getContext("2d"), miniT = null;
  function buildMinimap() {
    var w = 240, h = 240, d = Math.min(DPR, 2);
    mini.width = w * d; mini.height = h * d;
    var bb = T.bb, sw = bb[2] - bb[0], sh = bb[3] - bb[1], sc = Math.min((w - 24) / sw, (h - 24) / sh);
    miniT = { sc: sc, ox: (w - sw * sc) / 2 - bb[0] * sc, oy: (h - sh * sc) / 2 - bb[1] * sc, d: d, w: w, h: h };
  }
  function drawMinimap() {
    if (!miniT || !T) return;
    var m = miniT;
    mg.setTransform(m.d, 0, 0, m.d, 0, 0);
    mg.clearRect(0, 0, m.w, m.h);
    mg.setTransform(m.d * m.sc, 0, 0, m.d * m.sc, m.d * m.ox, m.d * m.oy);
    mg.lineJoin = "round"; mg.lineCap = "round";
    mg.strokeStyle = "rgba(255,255,255,0.22)"; mg.lineWidth = 3 / m.sc;
    MAP.roads.forEach(function (r) { if (r.c !== "s") mg.stroke(r.path); });
    mg.strokeStyle = "rgba(255,255,255,0.9)"; mg.lineWidth = 14 / m.sc * 0.55; mg.stroke(T.center);
    mg.strokeStyle = "#4d535c"; mg.lineWidth = 9 / m.sc * 0.55; mg.stroke(T.center);
    // camera box
    var s = scale(), hw = VW / 2 / s, hh = VH / 2 / s;
    mg.strokeStyle = "rgba(255,207,74,0.9)"; mg.lineWidth = 2 / m.sc; mg.strokeRect(cam.x - hw, cam.y - hh, hw * 2, hh * 2);
    var p0 = T.pts[0];
    mg.fillStyle = "#fff"; mg.beginPath(); mg.arc(p0[0], p0[1], 5 / m.sc, 0, 6.283); mg.fill();
    cars.forEach(function (p) {
      if (!p.car || !p.car.alive) return;
      mg.fillStyle = p.color; mg.strokeStyle = "#fff"; mg.lineWidth = 1.5 / m.sc;
      mg.beginPath(); mg.arc(p.car.x, p.car.y, 5.5 / m.sc, 0, 6.283); mg.fill(); mg.stroke();
    });
  }

  // ------------------------------------------------------------------ HUD / DOM
  var bannerTimer = null;
  function banner(top, main, sec, color) {
    var b = $("banner");
    $("bannerTop").textContent = top || "";
    $("bannerMain").textContent = main || "";
    b.style.setProperty("--bc", color || "#ffcf4a");
    b.classList.remove("show"); void b.offsetWidth; b.classList.add("show");
    clearTimeout(bannerTimer);
    if (sec) bannerTimer = setTimeout(hideBanner, sec * 1000);
  }
  function hideBanner() { $("banner").classList.remove("show"); }
  var countEl = $("count");
  function showCount(txt, go) {
    countEl.textContent = txt; countEl.classList.toggle("go", !!go);
    countEl.classList.remove("pop"); void countEl.offsetWidth; countEl.classList.add("pop");
  }
  function toast(text, color) {
    var box = $("toasts"), el = document.createElement("div");
    el.className = "toast"; el.style.setProperty("--tc", color || "#fff");
    el.innerHTML = '<span class="dot"></span>' + esc(text);
    box.appendChild(el);
    setTimeout(function () { el.classList.add("off"); }, 2600);
    setTimeout(function () { el.remove(); }, 3100);
    while (box.children.length > 5) box.firstChild.remove();
  }

  var hudLast = "", streetLast = "";
  function renderStreet() {
    var L = leaderOf(), nm = L && T ? T.street[L.car.idx] : (T ? T.street[0] : "");
    if (!nm || nm === streetLast) return;
    streetLast = nm;
    var el = $("street");
    $("streetName").textContent = nm;
    el.classList.remove("hidden", "flip"); void el.offsetWidth; el.classList.add("flip");
  }
  function renderHud() {
    renderStreet();
    var timeTxt = S.phase === "race" || S.phase === "heatend" || S.phase === "countdown" ? (S.timeLeft > 0 ? fmtTime(S.timeLeft) : "FINAL HEAT") : "";
    var rowsH = cars.slice().sort(function (a, b) { return (b.wins - a.wins) || (a.slot - b.slot); }).map(function (p) {
      var st = p.car && p.car.alive ? "" : " out";
      return '<div class="srow' + st + '"><span class="sdot" style="background:' + p.color + '"></span><span class="sname">' + esc(p.name) + '</span><span class="swins">' + p.wins + '</span></div>';
    }).join("");
    var waiting = players.filter(function (p) { return p.waiting; }).map(function (p) { return esc(p.name); });
    var key = timeTxt + "|" + S.heat + "|" + rowsH + "|" + waiting.join(",") + "|" + (S.timeLeft <= 0);
    if (key === hudLast) return;
    hudLast = key;
    $("clock").textContent = timeTxt;
    $("clock").classList.toggle("final", S.timeLeft <= 0);
    $("heatNo").textContent = "HEAT " + S.heat + " · " + (T ? T.name : "");
    
    $("standings").innerHTML = '<div class="shead">HEAT WINS</div>' + rowsH + (waiting.length ? '<div class="swait">Next heat: ' + waiting.join(", ") + "</div>" : "");
  }

  function hidePanel() { $("overlay").classList.add("off"); }
  function renderPanel() {
    var ov = $("overlay");
    if (S.phase !== "lobby" && S.phase !== "results") { ov.classList.add("off"); return; }
    ov.classList.remove("off");
    var hs = humans(), host = hostOf(), counts = computeNext();
    var h = "";
    h += '<div class="ptop"><div class="logo"><div class="lt">LAAGRI<span>KARTS</span></div><div class="ls">KART BATTLES ON THE REAL STREETS OF LAAGRI · SAUE VALD</div></div>';
    h += '<div class="join"><div class="lbl">Join on your phone</div><div class="url">airconsole.com</div><div class="code">' + (airCode ? esc(airCode.replace(/(\d{3})(\d{3})(\d*)/, "$1 $2 $3").trim()) : "…") + "</div></div></div>";
    if (S.phase === "results" && S.results) {
      var rws = S.results.rows, w0 = rws[0];
      var hasW = w0 && w0.wins > 0;
      h += '<div class="results"><div class="champ">' + LK.ICONS.trophy + '<div><div class="ct">' + (hasW ? esc(w0.name) + " wins the battle!" : "Battle over") + '</div><div class="cs">' + esc(LK.TRACKS[S.results.track].name) + (hasW ? " · " + w0.wins + " heat win" + (w0.wins > 1 ? "s" : "") : " · no heat was finished") + "</div></div></div>";
      var tie = rws.length > 1 && rws[0].wins === rws[1].wins && rws[0].wins > 0;
      if (tie) h = h.replace(/<\/div><\/div><\/div>$/, " · tie broken by cars outlasted</div></div></div>");
      h += '<div class="rlist">' + rws.map(function (r) {
        var tied = rws.some(function (q) { return q !== r && q.wins === r.wins; });
        return '<div class="rrow' + (r.place === 1 ? " first" : "") + '"><div class="rpl">' + r.place + '</div><div class="rcar">' + LK.carSvg(r.color, "#00000055") + '</div><div class="rname">' + esc(r.name) + (r.cpu ? ' <span class="cpu">CPU</span>' : "") + '</div><div class="rw">' + r.wins + (tied ? '<span class="rs"> · ' + r.surv + "</span>" : "") + "</div></div>";
      }).join("") + "</div></div>";
    }
    h += '<div class="lobby"><div class="col players"><div class="lbl">Drivers ' + hs.length + "/" + LK.MAX_PLAYERS + "</div><div class=\"pgrid" + (hs.length > 4 ? " dense" : "") + "\">";
    for (var i = 0; i < Math.max(4, hs.length); i++) {
      var p = hs[i];
      if (p) h += '<div class="pcard' + (p.ready ? " ready" : "") + '" style="--pc:' + p.color + '"><div class="pcar">' + LK.carSvg(p.color, p.dark) + '</div><div class="pinfo"><div class="pname">' + esc(p.name) + (p === host ? ' <span class="crown">HOST</span>' : "") + '</div><div class="pstat">' + (p.ready ? "READY" : "not ready") + (p.battleWins ? " · " + p.battleWins + " battle win" + (p.battleWins > 1 ? "s" : "") : "") + "</div></div></div>";
      else h += '<div class="pcard empty"><div class="pinfo"><div class="pname">Waiting…</div><div class="pstat">join with your phone</div></div></div>';
    }
    h += "</div></div>";
    h += '<div class="col tracks"><div class="lbl">Track vote</div>';
    LK.TRACKS.forEach(function (t, i) {
      h += '<div class="tcard' + (i === S.nextTrack ? " next" : "") + '" style="--tc:' + t.color + '"><canvas class="tprev" data-i="' + i + '" width="160" height="110"></canvas><div class="tinfo"><div class="tname">' + esc(t.name) + '</div><div class="tdesc">' + esc(t.short) + '</div></div><div class="tvotes">' + counts[i] + "</div>" + (i === S.nextTrack ? '<div class="tnext">NEXT</div>' : "") + "</div>";
    });
    var cpuTxt = ["CPU drivers off", "CPU drivers fill to 4", "CPU drivers fill to 8"][S.cpuMode];
    h += '<div class="settings">Battle ' + LK.LENGTHS[S.lenIdx] + " min · " + cpuTxt + (host ? ' <span class="muted">(host ' + esc(host.name) + " can change)</span>" : "") + "</div></div></div>";
    var need = minHumans();
    var msg = hs.length < need ? "Need at least " + need + " drivers — or let the host turn on CPU drivers" : (hs.every(function (q) { return q.ready; }) ? "Starting…" : "Everyone taps READY on the phone to start");
    h += '<div class="pfoot"><div class="how"><b>Drive:</b> cars go by themselves — steer ◀ ▶, BRAKE for tight corners, BOOST fires your item from the <b>?</b> boxes. Stay on the TV: fall off the screen and you are out. Last car on screen wins the heat.</div><div class="msg">' + msg + "</div></div>";
    h += '<div class="osm">Aerial photo: Ortofoto © Maa- ja Ruumiamet (open data licence) · Streets &amp; places © OpenStreetMap contributors (ODbL)</div>';
    $("panel").innerHTML = h;
    Array.prototype.forEach.call(document.querySelectorAll(".tprev"), function (cv) { drawTrackPreview(cv, +cv.getAttribute("data-i")); });
  }
  var previewCache = {};
  function drawTrackPreview(cv, i) {
    var c = cv.getContext("2d"), pts = previewCache[i];
    if (!pts) { pts = previewCache[i] = smoothClosed(resampleClosed(TRACKS_RAW[i].pts, 6), 2, 2); }
    var bb = bboxOf(pts), w = cv.width, h = cv.height, sc = Math.min((w - 16) / (bb[2] - bb[0]), (h - 16) / (bb[3] - bb[1]));
    var ox = (w - (bb[2] - bb[0]) * sc) / 2 - bb[0] * sc, oy = (h - (bb[3] - bb[1]) * sc) / 2 - bb[1] * sc;
    c.clearRect(0, 0, w, h);
    c.lineJoin = "round"; c.lineCap = "round";
    c.beginPath(); pts.forEach(function (p, k) { var x = p[0] * sc + ox, y = p[1] * sc + oy; if (k) c.lineTo(x, y); else c.moveTo(x, y); }); c.closePath();
    c.strokeStyle = "rgba(255,255,255,0.95)"; c.lineWidth = 7; c.stroke();
    c.strokeStyle = LK.TRACKS[i].color; c.lineWidth = 4; c.stroke();
  }

  var soundBtn = $("soundBtn");
  function sfx(name) { try { if (window.LKSound) LKSound.play(name); } catch (e) {} }
  if (window.LKSound) {
    LKSound.onState(function (on) { soundBtn.classList.toggle("hidden", on); });
    var unlock = function () { LKSound.start(); };
    soundBtn.addEventListener("click", unlock);
    document.addEventListener("pointerdown", unlock);
    document.addEventListener("keydown", unlock);
    LKSound.start().then(function (ok) { if (!ok) soundBtn.classList.remove("hidden"); });
  }

  // ------------------------------------------------------------------ main loop
  var last = performance.now(), acc = 0, DT = 1 / 120, lastCount = -1;
  function frame(now) {
    var dt = Math.min(0.1, (now - last) / 1000); last = now;
    var steps = 0;
    acc += dt * SIMSPEED;
    while (acc >= DT && steps < 40) { tick(DT); acc -= DT; steps++; }
    if (steps >= 40) acc = 0;
    if (T && (S.phase === "countdown" || S.phase === "race" || S.phase === "heatend")) {
      render(now); drawMinimap(); renderHud();
    } else {
      renderIdle(now);
    }
    requestAnimationFrame(frame);
  }

  function tick(dt) {
    if (S.phase === "countdown") {
      S.phaseT -= dt;
      var n = Math.ceil(S.phaseT);
      if (n !== lastCount && n > 0) { lastCount = n; showCount(String(n)); sfx("beep"); }
      cars.forEach(function (p) { if (p.car) { p.car.vx = 0; p.car.vy = 0; } });
      updateCamera(dt, false);
      if (S.phaseT <= 0) {
        lastCount = -1;
        setPhase("race", 0);
        showCount("GO!", true); sfx("go");
        humans().forEach(function (p) { ev(p, "go"); });
        syncAll();
      }
    } else if (S.phase === "race") {
      S.heatTime += dt;
      if (S.timeLeft > 0) {
        S.timeLeft -= dt;
        if (S.timeLeft <= 0) { S.timeLeft = 0; S.finalHeat = true; banner("Time is up", "FINAL HEAT", 2.4, "#ff5d6c"); sfx("final"); }
      }
      cars.forEach(function (p) { stepCar(p, dt); });
      collideCars();
      stepRockets(dt);
      stepParts(dt);
      updateCamera(dt, false);
      checkElims(dt);
      var alive = cars.filter(function (p) { return p.car && p.car.alive; });
      if (cars.length > 1 && alive.length <= 1) heatOver(alive[0] || lastOut());
      else if (cars.length > 1 && S.heatTime > CFG.heatMax) { var ld = leaderOf(); cars.forEach(function (q) { if (q !== ld && q.car && q.car.alive) eliminate(q, "time"); }); heatOver(ld); }
      else if (cars.length === 1 && S.timeLeft <= 0) endBattle(false);
      else if (!alive.length) heatOver(null);
    } else if (S.phase === "heatend") {
      S.phaseT -= dt;
      cars.forEach(function (p) { if (p.car && p.car.alive) stepCar(p, dt); });
      stepParts(dt);
      updateCamera(dt, false);
      if (S.phaseT <= 0) {
        if (S.finalHeat || S.timeLeft <= 0) { endBattle(false); return; }
        var w = S.lastWinner && S.lastWinner.car ? S.lastWinner.car.prog : (leaderOf() ? leaderOf().car.prog : 0);
        gridAt(w + 20, false);
        setPhase("countdown", CFG.regridCountdown);
        syncAll();
      }
    }
    if (skids.length) { skids.forEach(function (k) { k.a -= dt * 0.05; }); if (skids[0].a <= 0) skids = skids.filter(function (k) { return k.a > 0; }); }
  }
  function lastOut() {
    var best = null;
    cars.forEach(function (p) { if (p.car && (!best || p.car.outAt > best.car.outAt || (p.car.outAt === best.car.outAt && p.car.prog > best.car.prog))) best = p; });
    return best;
  }

  // Lobby background: slow flyover of the voted track
  var idleT = 0;
  function renderIdle(now) {
    var ti = S.phase === "results" && S.results ? S.results.track : S.nextTrack;
    if (!T || T.ti !== ti) { buildTrack(ti); prefetchTrack(T); }
    idleT += 1 / 60;
    if (S.peek) { if (!T || T.ti !== (S.peek[3] || 0)) { buildTrack(S.peek[3] || 0); prefetchTrack(T); } cam.x = S.peek[0]; cam.y = S.peek[1]; cam.zoom = S.peek[2] || 1; cam.viewH = CFG.viewH / cam.zoom; render(now); return; }
    var p = trackPoint(idleT * 14);
    cam.x += (p.x - cam.x) * 0.05; cam.y += (p.y - cam.y) * 0.05; cam.viewH = 95; cam.zoom = CFG.viewH / cam.viewH;
    if (Math.hypot(p.x - cam.x, p.y - cam.y) > 300) { cam.x = p.x; cam.y = p.y; }
    render(now);
  }

  // ------------------------------------------------------------------ boot
  renderPanel();
  // ?demo=1 : CPU-only attract mode (no phones needed)
  if (QS.demo && QS.demo !== "0") {
    var demoStart = function () { if (humans().length) return; S.cpuMode = 2; S.lenIdx = 0; S.nextTrack = (+QS.track || 0) % LK.TRACKS.length; startBattle(); };
    setTimeout(demoStart, 1500);
    setInterval(function () { if (S.phase === "results" && !humans().length) { S.nextTrack = (S.trackIdx + 1) % LK.TRACKS.length; demoStart(); } }, 8000);
  }
  requestAnimationFrame(frame);

  if (TEST) {
    window.__lk = {
      S: S, CFG: CFG, players: players, DBG: DBG, get cars() { return cars; }, get T() { return T; }, cam: cam,
      buildTrack: buildTrack, trackPoint: trackPoint, MAP: MAP, peek: function (x, y, z, ti) { S.peek = x == null ? null : [x, y, z, ti]; }, giveItem: function (i, k) { var p = players[i]; p.item = k; sync(p); ev(p, "item", { item: k }); },
      fps: function () { return 0; }
    };
  }
})();
