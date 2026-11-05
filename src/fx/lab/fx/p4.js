/* p4 · Rubber band · family P (Paperclip physics). registerFx format; needs kit/retro.js + kit/clippee-rig.js. */
(function () {
  'use strict';
  /* ---------- shared kit (family P): timing, the 1997 render, pixel-art props ---------- */
  const RG = window.ClippeeRig, REST = RG.REST, drawClippee = RG.drawClippee, Sx = window.S || RG.S;
  const PI = Math.PI;
  const cl = (v, a, b) => v < a ? a : v > b ? b : v, lp = (a, b, t) => a + (b - a) * t;
  const seg = (t, a, b) => cl((t - a) / (b - a), 0, 1);
  const eIn = t => t * t * t, eOut = t => 1 - Math.pow(1 - t, 3), eIO = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const eIn2 = t => t * t, eOut2 = t => 1 - (1 - t) * (1 - t);
  const backOut = t => { t = cl(t, 0, 1) - 1; return 1 + 2.4 * t * t * t + 1.4 * t * t; };
  // a snap that closes with a damped wobble: u is 0..1 of the snap's time, ends exactly on 1
  const snap = (u, k, w) => u <= 0 ? 0 : u >= 1 ? 1 : 1 - Math.exp(-(k || 7) * u) * Math.cos((w || 13) * u);
  const bump = (t, a, b) => (t <= a || t >= b) ? 0 : Math.sin(PI * (t - a) / (b - a));
  const rnd = s => { const x = Math.sin(s * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }; // fixed-seed noise
  const pose = o => RG.rest(o);

  /* ---------- canvases (a pool, so frames do not allocate; output never depends on it) ---------- */
  const POOL = {};
  function pooled(key, w, h) { const k = key + ':' + w + 'x' + h; let c = POOL[k]; if (!c) { c = POOL[k] = document.createElement('canvas'); c.width = w; c.height = h; } return c; }
  /* The 1997 render of any drawing in his frame units (his 124 x 93 box: x right, y down) over a region
     rg = {x, y, w, h} that may reach outside the box. Same 3x supersample, premultiplied box average and
     'prerender' pass as kit retroRender, so a region equal to his box gives the same pixels. */
  function retroRegion(draw, rg) {
    const SS = 3, BW = rg.w * SS, BH = rg.h * SS, big = pooled('big', BW, BH), b = big.getContext('2d', { willReadFrequently: true });
    b.setTransform(1, 0, 0, 1, 0, 0); b.clearRect(0, 0, BW, BH);
    b.save(); b.setTransform(SS, 0, 0, SS, -rg.x * SS, -rg.y * SS); draw(b); b.restore();
    const src = b.getImageData(0, 0, BW, BH).data;
    const out = pooled('out', rg.w, rg.h), o = out.getContext('2d', { willReadFrequently: true }), img = o.createImageData(rg.w, rg.h), d = img.data;
    for (let y = 0; y < rg.h; y++) for (let x = 0; x < rg.w; x++) {
      let r = 0, g = 0, bl = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        const row = ((y * SS + sy) * BW + x * SS) * 4;
        for (let sx = 0; sx < SS; sx++) { const j = row + sx * 4, al = src[j + 3]; r += src[j] * al; g += src[j + 1] * al; bl += src[j + 2] * al; a += al; }
      }
      const k = (y * rg.w + x) * 4;
      if (a > 0) { d[k] = r / a; d[k + 1] = g / a; d[k + 2] = bl / a; d[k + 3] = a / (SS * SS); }
    }
    o.putImageData(img, 0, 0); retro(o, 'prerender'); return out;
  }
  /* region from frame points, padded, clipped to the stage, whole pixels; null when off stage */
  function rgOf(pts, pad, st) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const q of pts) { if (q[0] < x0) x0 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[0] > x1) x1 = q[0]; if (q[1] > y1) y1 = q[1]; }
    return rgClip(Math.floor(x0 - pad), Math.floor(y0 - pad), Math.ceil(x1 + pad), Math.ceil(y1 + pad), st);
  }
  function rgClip(x0, y0, x1, y1, st) {
    const ax = st.anchor.x, ay = st.anchor.y;
    x0 = Math.max(x0, -ax); y0 = Math.max(y0, -ay); x1 = Math.min(x1, st.w - ax); y1 = Math.min(y1, st.h - ay);
    return (x1 - x0 < 1 || y1 - y0 < 1) ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  function put(ctx, c, x, y) { ctx.imageSmoothingEnabled = false; ctx.drawImage(c, Math.round(x), Math.round(y)); }
  /* Clippee alone in his own box, moved by whole pixels: exactly kit retroRender (never scaled) */
  function him(ctx, st, p, ox, oy) { put(ctx, retroRender(drawClippee, p, 'prerender', pooled('him', 124, 93)), st.anchor.x + Math.round(ox || 0), st.anchor.y + Math.round(oy || 0)); }
  /* any frame-unit drawing through the 1997 render over region rg */
  function region(ctx, st, draw, rg) { if (rg) put(ctx, retroRegion(draw, rg), st.anchor.x + rg.x, st.anchor.y + rg.y); }
  /* Clippee moved by (ox, oy) with room around his box (a stretched arm, a held prop) */
  function himWide(ctx, st, p, ox, oy, extra, under, over) {
    ox = Math.round(ox); oy = Math.round(oy); const e = extra || {};
    region(ctx, st, b => { b.translate(ox, oy); if (under) under(b); drawClippee(b, p); if (over) over(b); },
      rgClip(ox - (e.l || 0), oy - (e.t || 0), ox + 124 + (e.r || 0), oy + 93 + (e.b || 0), st));
  }

  /* ---------- crisp pixel primitives on the stage (CSS px) ---------- */
  function pr(ctx, x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
  function pline(ctx, x0, y0, x1, y1, c, w) {
    w = w || 1; ctx.fillStyle = c; const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)))), h = Math.floor(w / 2);
    for (let i = 0; i <= n; i++) ctx.fillRect(Math.round(lp(x0, x1, i / n)) - h, Math.round(lp(y0, y1, i / n)) - h, w, w);
  }
  function spark(ctx, x, y, r, c, c2) {
    x = Math.round(x); y = Math.round(y); r = Math.max(1, Math.round(r));
    pr(ctx, x - r, y, 2 * r + 1, 1, c); pr(ctx, x, y - r, 1, 2 * r + 1, c);
    const d = Math.max(1, Math.round(r * 0.45));
    for (let i = 1; i <= d; i++) [[-i, -i], [i, -i], [-i, i], [i, i]].forEach(q => pr(ctx, x + q[0], y + q[1], 1, 1, c2 || c));
  }
  const FONT = {
    A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'], B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
    C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'], D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
    E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'], F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
    G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'], H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    I: ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'], J: ['..###', '...#.', '...#.', '...#.', '#..#.', '#..#.', '.##..'],
    K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'], L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
    M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'], N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
    O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'], P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
    R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'], S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
    T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'], U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'], W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
    Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'], Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
    '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'], '1': ['.#.', '##.', '.#.', '.#.', '.#.', '.#.', '###'],
    '!': ['#', '#', '#', '#', '#', '.', '#'], '-': ['...', '...', '...', '###', '...', '...', '...'], '.': ['.', '.', '.', '.', '.', '.', '#'], ' ': ['..', '..', '..', '..', '..', '..', '..']
  };
  const sfxW = (s, k) => { let w = 0; for (const ch of s) w += ((FONT[ch] || FONT[' '])[0].length + 1); return (w - 1) * k; };
  /* a comic sound word in a 5x7 pixel font, k px per font pixel, with an ink outline (centred on x) */
  function sfx(ctx, s, x, y, k, fill, ink) {
    k = k || 2; const cells = []; let cx = 0;
    for (const ch of s) { const g = FONT[ch] || FONT[' ']; for (let j = 0; j < 7; j++) for (let i = 0; i < g[j].length; i++) if (g[j][i] === '#') cells.push([cx + i, j]); cx += g[0].length + 1; }
    const X = Math.round(x - sfxW(s, k) / 2), Y = Math.round(y);
    ctx.fillStyle = ink || '#16172a'; for (const [i, j] of cells) ctx.fillRect(X + (i - 1) * k, Y + (j - 1) * k, k * 3, k * 3);
    ctx.fillStyle = fill || '#ffe27a'; for (const [i, j] of cells) ctx.fillRect(X + i * k, Y + j * k, k, k);
  }
  /* motion streaks: n short pixel lines trailing behind a moving thing */
  function streaks(ctx, x, y, dx, dy, len, n, gap, c) {
    const l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l, nx = -uy, ny = ux;
    for (let i = 0; i < n; i++) { const o = (i - (n - 1) / 2) * gap, L = len * (0.6 + 0.4 * rnd(i + 3)); pline(ctx, x + nx * o, y + ny * o, x + nx * o - ux * L, y + ny * o - uy * L, c, 1); }
  }
  /* dust puffs: little banded pixel clouds that roll outward and shrink */
  function puffs(ctx, x, y, u, dir) {
    if (u <= 0 || u >= 1) return;
    for (let i = 0; i < 3; i++) {
      const s = dir * (6 + i * 7) * eOut(u), r = Math.round((3 - i * 0.7) * (1 - u) + 1);
      pr(ctx, x + s - r, y - r - i * 2 * u, 2 * r, 2 * r - 1, '#dcdce3'); pr(ctx, x + s - r, y - i * 2 * u, 2 * r, 1, '#a4a4ae');
    }
  }
  /* the wire, as drawn at rest, in frame units: one even polyline (body, then the arm) */
  function restWirePts(n) { const R0 = rig(Sx, REST); return resample(R0.body.concat(R0.arm.slice(2)), n); }
  function drawWirePts(b, P, w) { tube(b, [[P, w || Sx.wire, true, true]]); }
  const BASE = [48, 86];       // the middle of his feet in his box
  const HEADTOP = [45, 13];    // the top of his head loop in his box

  /* ======================= P4 · Rubber band =======================
     In: a rubber band pinned at the left edge of the window snaps, TWANG, and fires him across the
     page in a high arc. He slams into the right edge above his spot, BOING, ricochets down and
     sticks the landing, arms out. Three judges hold up 10s.
     Out: two pushpins stab into the page either side of his feet with a band between them. He sits
     in it, hauls himself down until it's taut, and fires straight up out of the top. The band
     twangs, the pins pop and fly up after him. */
  const BAND_HI = '#e9c493', BAND = '#c99561', BAND_LO = '#a8711a';
  function pin(ctx, x, y, k) { // a red pushpin seen from the side, needle down; k = how far it's stuck in (0 out .. 1 in)
    x = Math.round(x); y = Math.round(y);
    pr(ctx, x, y - 3, 1, 6 - Math.round(3 * k), '#9ea2cf');
    pr(ctx, x - 4, y - 9, 9, 6, '#c33a30'); pr(ctx, x - 4, y - 9, 9, 2, '#e8584a'); pr(ctx, x - 3, y - 8, 2, 1, '#f09aa8');
    pr(ctx, x - 2, y - 12, 5, 3, '#e8584a'); pr(ctx, x - 1, y - 12, 2, 1, '#f09aa8'); pr(ctx, x - 4, y - 4, 9, 1, '#8e2620');
  }
  function band(ctx, a, m, b) { // two straight runs a->m->b, 2 px tan with a dark edge
    [[a, m], [m, b]].forEach(([p, q]) => { pline(ctx, p[0], p[1] + 1, q[0], q[1] + 1, BAND_LO, 2); pline(ctx, p[0], p[1], q[0], q[1], BAND, 2); pline(ctx, p[0], p[1] - 1, q[0], q[1] - 1, BAND_HI, 1); });
  }
  function judges(ctx, st, u) { // three score cards pop up out of the bottom edge and drop back
    if (u <= 0 || u >= 1) return;
    const rise = u < 0.25 ? eOut(u / 0.25) : u > 0.75 ? 1 - eIn2((u - 0.75) / 0.25) : 1;
    for (let i = 0; i < 3; i++) {
      const x = st.anchor.x - 140 + i * 40, y = st.h - Math.round(58 * rise) + i % 2 * 3;
      pr(ctx, x + 12, y + 26, 4, 40, '#a8711a');
      pr(ctx, x, y, 28, 28, '#16172a'); pr(ctx, x + 1, y + 1, 26, 26, '#ffffff'); pr(ctx, x + 1, y + 23, 26, 4, '#dcdce3');
      sfx(ctx, '10', x + 14, y + 6, 2, '#16172a', '#ffffff');
    }
  }
  // the flight in: launched from the left edge, a high arc into the right wall, a ricochet down onto his spot
  function flightIn(st, t) {
    const x0 = -124 - st.anchor.x, y0 = -150, wallX = st.w - 124 - st.anchor.x, wallY = -150;
    if (t < 0.5) { const u = seg(t, 0.06, 0.5); return [lp(x0, wallX, u), lp(y0, wallY, u) - 330 * 4 * u * (1 - u), 1, u]; }
    const u = seg(t, 0.5, 0.72);
    return [wallX * (1 - eOut(u)), wallY + (-wallY) * (u * u * 0.75 + u * 0.25) - 22 * Math.sin(PI * u) * (1 - u), -1, u];
  }

  registerFx({
    id: 'p4', name: 'Rubber band', appearMs: 2600, disappearMs: 2200,
    appear(ctx, t, st) {
      if (t >= 1) return him(ctx, st, REST);
      // the band at the left edge: drawn back off screen, released at 0.06, twangs, then slides away
      const by = st.anchor.y - 150 + 50, gone = eIn2(seg(t, 0.3, 0.42)) * 60;
      if (t < 0.42) {
        const pA = [14 - gone, by - 34], pB = [14 - gone, by + 34];
        const vx = t < 0.06 ? -60 : 14 - gone + 30 * Math.exp(-12 * (t - 0.06)) * Math.cos((t - 0.06) * 130);
        band(ctx, pA, [vx, by], pB); pin(ctx, pA[0], pA[1], 1); pin(ctx, pB[0], pB[1], 1);
        if (t > 0.06 && t < 0.14) sfx(ctx, 'TWANG!', 74, by - 70, 2);
      }
      if (t < 0.06) return;
      if (t < 0.72) {
        const [ox, oy, dir, u] = flightIn(st, t), prev = flightIn(st, Math.max(0.061, t - 0.012));
        const vx = ox - prev[0], vy = oy - prev[1];
        const p = pose({ lean: cl(vx * 0.004, -0.3, 0.3) * (dir < 0 ? -1 : 1), leanTop: cl(vx * 0.007, -0.4, 0.4), browY: 3, browTilt: 0.3, pupil: 0.8, lookX: dir * 0.6, lookY: cl(-vy * 0.05, -0.8, 0.8),
          reach: 1, hx: RX_4 + 14, hy: -52 + 10 * Math.sin(t * 90), elbow: 1, curl: 0.6 });
        if (Math.hypot(vx, vy) > 2) streaks(ctx, st.anchor.x + ox + 62, st.anchor.y + oy + 46, vx, vy, Math.min(90, Math.hypot(vx, vy) * 3), 5, 9, '#c3c3cc');
        him(ctx, st, p, ox, oy);
        if (t > 0.49 && t < 0.58) { const x = st.w - 3, y = st.anchor.y - 150 + 40; spark(ctx, x, y, 7, '#ffffff', '#ffe27a'); sfx(ctx, 'BOING!', x - 70, y - 40, 2); }
        return;
      }
      // the landing: arms out, a tiny dip, the judges, then rest
      const u = seg(t, 0.72, 1), dip = Math.round(3 * bump(t, 0.72, 0.78));
      const stuck = pose({ reach: 1, hx: RX_4 + 20, hy: -40, elbow: 1, curl: -0.4, happy: 0.7, browY: 2.4, lookX: -0.3, lookY: 0.1, lean: -0.05, leanTop: -0.1 });
      him(ctx, st, RG.blend(stuck, REST, eIO(seg(u, 0.5, 1))), 0, dip);
      puffs(ctx, st.anchor.x + BASE[0] - 10, st.anchor.y + BASE[1] + 2, seg(t, 0.72, 0.8), -1); puffs(ctx, st.anchor.x + BASE[0] + 10, st.anchor.y + BASE[1] + 2, seg(t, 0.72, 0.8), 1);
      if (t < 0.78) sfx(ctx, 'THUNK', st.anchor.x - 60, st.anchor.y + 46, 2);
      judges(ctx, st, seg(t, 0.74, 0.97));
    },
    disappear(ctx, t, st) {
      if (t <= 0) return him(ctx, st, REST);
      // the pins stab in either side of his feet, the band between them
      const fx = st.anchor.x + BASE[0], fy = st.anchor.y + BASE[1] + 3;
      const stab = [seg(t, 0.02, 0.07), seg(t, 0.07, 0.12)], pull = eIO(seg(t, 0.14, 0.42)), fired = t >= 0.47;
      const pinsUp = eIn2(seg(t, 0.74, 0.86)) * (st.anchor.y + 160);
      const pA = [fx - 52, fy - (1 - stab[0]) * 120 - pinsUp], pB = [fx + 52, fy - (1 - stab[1]) * 120 - pinsUp];
      let oy = 0, pouchY = fy;
      if (!fired) { oy = Math.round(30 * pull + (t > 0.3 && t < 0.47 ? Math.sin(t * 220) : 0)); pouchY = fy + oy; }
      else pouchY = fy - pinsUp + 30 * Math.exp(-9 * (t - 0.47)) * Math.cos((t - 0.47) * 120);
      if (t >= 0.86) return;
      if (!fired) {
        const p = pose({ browY: -0.6 * pull, browTilt: -0.4 * pull, lookY: lp(0.1, 0.9, pull), lookX: 0, lean: 0.03, happy: 0.2 * pull,
          reach: 1, hx: RX_4 + 6, hy: -6 + 4 * pull, elbow: 1, curl: 0.9 });
        him(ctx, st, p, 0, oy);
      } else {
        const u = seg(t, 0.47, 0.57), up = (st.anchor.y + 93 + 60) * eOut2(u) + 30 * (1 - eOut2(u));
        if (u < 1) {
          him(ctx, st, pose({ lookY: 0.9, browY: 3, pupil: 0.8, reach: 1, hx: RX_4 + 2, hy: -70, elbow: 1, curl: 0.8, lean: -0.02 }), 0, 30 - up);
          streaks(ctx, fx, st.anchor.y + 30 - up + 90, 0, -1, 70, 5, 8, '#c3c3cc');
        }
        if (t < 0.56) sfx(ctx, 'TWANG!', fx - 110, fy - 50, 2);
      }
      if (stab[0] > 0) {
        band(ctx, pA, [fx, Math.max(pouchY, Math.min(pA[1], pB[1]))], pB);
        pin(ctx, pA[0], pA[1], stab[0]); pin(ctx, pB[0], pB[1], stab[1]);
        if (t > 0.04 && t < 0.11) sfx(ctx, 'TINK', fx - 92, fy - 40, 2);
        if (t > 0.74 && t < 0.8) sfx(ctx, 'PLINK', fx + 60, fy - 60, 2);
      }
    }
  });
  const RX_4 = 11.93;

})();
