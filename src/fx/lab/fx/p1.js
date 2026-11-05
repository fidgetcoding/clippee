/* p1 · Bent from wire · family P (Paperclip physics). registerFx format; needs kit/retro.js + kit/clippee-rig.js. */
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

  /* ======================= P1 · Bent from wire =======================
     In: a straight steel wire zips in from the left edge and lies flat at his feet. Invisible pliers
     bend it, one snap at a time: the two bottom lobes, the head loop, the inner turn, the arm. Clink,
     clink, clink, clink. The eyes pop on last.
     Out: the eyes pop off, every bend springs open in reverse, the straight wire twangs, draws back
     like a bowstring and shoots off the left edge like an arrow. */
  const FIN = restWirePts(300), N = FIN.length, SEGL = [], HEAD = [], TURN = new Array(N).fill(0);
  for (let i = 0; i < N - 1; i++) { SEGL.push(Math.hypot(FIN[i + 1][0] - FIN[i][0], FIN[i + 1][1] - FIN[i][1])); HEAD.push(Math.atan2(FIN[i + 1][1] - FIN[i][1], FIN[i + 1][0] - FIN[i][0])); }
  for (let i = 1; i < N - 1; i++) { let d = HEAD[i] - HEAD[i - 1]; while (d > PI) d -= 2 * PI; while (d < -PI) d += 2 * PI; TURN[i] = d; }
  const LEN = SEGL.reduce((a, b) => a + b, 0), S_AT = [0]; for (let i = 0; i < N - 1; i++) S_AT.push(S_AT[i] + SEGL[i]);
  // the four bends, by distance along the wire from the inner free end: 0 inner turn, 1 head loop, 2 bottom lobes, 3 arm
  const REG = S_AT.map(s => s < LEN * 0.287 ? 0 : s < LEN * 0.503 ? 1 : s < LEN * 0.852 ? 2 : 3);
  // the pivot: the bottom of the left lobe, where the finished wire runs flat
  let K = 0; for (let i = 0; i < N; i++) if (S_AT[i] > LEN * 0.6 && S_AT[i] < LEN * 0.76 && (K === 0 || FIN[i][1] > FIN[K][1])) K = i;
  const MID = [0.13, 0.4, null, 0.93].map(f => f == null ? K : S_AT.findIndex(s => s >= LEN * f));
  /* the wire with each bend closed by b[r] (0 straight .. 1 as at rest), flat through the pivot, moved by (ox, oy) */
  function shape(b, ox, oy, twang) {
    const P = new Array(N), th0 = lp(0, HEAD[K], b[2]);
    P[K] = [FIN[K][0] + ox, FIN[K][1] + oy];
    let th = th0;
    for (let i = K; i < N - 1; i++) { if (i > K) th += TURN[i] * b[REG[i]]; P[i + 1] = [P[i][0] + SEGL[i] * Math.cos(th), P[i][1] + SEGL[i] * Math.sin(th)]; }
    th = th0;
    for (let j = K - 1; j >= 0; j--) { th -= TURN[j + 1] * b[REG[j + 1]]; P[j] = [P[j + 1][0] - SEGL[j] * Math.cos(th), P[j + 1][1] - SEGL[j] * Math.sin(th)]; }
    if (twang) for (let i = 0; i < N; i++) P[i][1] += twang * Math.sin(PI * S_AT[i] / LEN);
    return P;
  }
  function wire(ctx, st, P) { region(ctx, st, c => drawWirePts(c, P), rgOf(P, 4, st)); }
  const toStage = (st, q) => [st.anchor.x + q[0], st.anchor.y + q[1]];
  const CLINKS = [[2, 0.235], [1, 0.375], [0, 0.505], [3, 0.625]], SNAP = 0.1, T_EYES = 0.73;
  const EYES = [[41, 43], [54, 42]];

  registerFx({
    id: 'p1', name: 'Bent from wire', appearMs: 2600, disappearMs: 1900,
    appear(ctx, t, st) {
      if (t >= 1) return him(ctx, st, REST);
      if (t >= T_EYES) { // the eyes pop on, brows drop, a happy settle onto rest
        const u = seg(t, T_EYES, 1);
        const p = RG.blend(pose({ blink: 1 - seg(t, T_EYES, T_EYES + 0.03), browY: 5 * (1 - snap(seg(t, T_EYES + 0.01, T_EYES + 0.13))), pupil: 1.25, happy: 0.5 * bump(t, T_EYES + 0.05, 0.95), lookX: 0, lookY: 0.2 }), REST, eIO(seg(u, 0.25, 1)));
        him(ctx, st, p);
        if (t < T_EYES + 0.06) EYES.forEach((e, i) => spark(ctx, st.anchor.x + e[0] + (i ? 9 : -9), st.anchor.y + e[1] - 9, 3, '#ffffff', '#ffe27a'));
        return;
      }
      const zip = seg(t, 0, 0.2), far = -(st.anchor.x + 260);
      const ox = t < 0.2 ? lp(far, 0, backOut(zip)) : 0;
      const b = [0, 0, 0, 0]; CLINKS.forEach(([r, t0]) => { b[r] = snap(seg(t, t0, t0 + SNAP)); });
      const P = shape(b, ox, 0);
      if (t < 0.2) { // speed streaks behind the zipping wire
        const v = (lp(far, 0, backOut(Math.min(1, zip + 0.02))) - ox), tail = toStage(st, P[0]);
        if (v > 1) streaks(ctx, tail[0] - 3, tail[1], 1, 0, Math.min(140, v * 4), 3, 3, '#b4b7de');
      }
      wire(ctx, st, P);
      CLINKS.forEach(([r, t0], i) => { // a spark where the pliers bite, and the sound word
        if (t < t0 || t > t0 + 0.085) return;
        const q = toStage(st, P[MID[r]]), up = Math.round(6 * seg(t, t0, t0 + 0.085));
        spark(ctx, q[0], q[1], t < t0 + 0.04 ? 5 : 3, '#ffffff', '#ffe27a');
        sfx(ctx, 'CLINK!', q[0] + (i % 2 ? -34 : 34), q[1] - 26 - up, 2);
      });
    },
    disappear(ctx, t, st) {
      if (t <= 0) return him(ctx, st, REST);
      if (t < 0.07) return him(ctx, st, pose({ blink: seg(t, 0.02, 0.07), browY: 3 * seg(t, 0, 0.04), lookY: 0.3 }));
      if (t >= 0.92) return;
      const OPEN = [[3, 0.11], [0, 0.18], [1, 0.25], [2, 0.32]], b = [1, 1, 1, 1];
      OPEN.forEach(([r, t0]) => { b[r] = 1 - snap(seg(t, t0, t0 + 0.11), 6, 12); });
      let ox = 0, tw = 0;
      if (t > 0.43) tw = 3.2 * Math.exp(-9 * (t - 0.43)) * Math.sin((t - 0.43) * 95);       // the straight wire twangs
      if (t > 0.47) ox = 12 * eOut(seg(t, 0.47, 0.58));                                       // draws back like a bowstring
      const fly = seg(t, 0.6, 0.76); if (t > 0.6) ox = 12 - eIn2(fly) * (st.anchor.x + 420); // and shoots off the left edge
      const P = shape(b, ox, 0, t > 0.6 ? 0 : tw);
      if (t < 0.6 || fly < 1) wire(ctx, st, P);
      if (t < 0.12) EYES.forEach((e, i) => { spark(ctx, st.anchor.x + e[0] + (i ? 4 : -4), st.anchor.y + e[1] - 4 - 30 * seg(t, 0.07, 0.12), 2, '#ffffff'); });
      if (t > 0.6 && fly < 1) { // the arrow's wake: three streaks trailing its tail
        const tail = toStage(st, P[N - 1]), v = (eIn2(fly) - eIn2(Math.max(0, fly - 0.06))) * (st.anchor.x + 420);
        const L = Math.min(260, 24 + v * 5);
        for (let i = -1; i <= 1; i++) pline(ctx, tail[0] + 4, tail[1] + i * 3, tail[0] + 4 + L * (i ? 0.7 : 1), tail[1] + i * 3, i ? '#cbcdea' : '#9ea2cf', 1);
      }
      if (t > 0.6 && t < 0.69) { const q = toStage(st, [FIN[K][0] + 12, FIN[K][1]]); sfx(ctx, 'ZING!', q[0] - 10, q[1] - 44, 2); }
    }
  });

})();
