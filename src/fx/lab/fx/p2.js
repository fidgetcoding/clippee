/* p2 · Magnet · family P (Paperclip physics). registerFx format; needs kit/retro.js + kit/clippee-rig.js. */
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

  /* ======================= P2 · Magnet =======================
     In: a giant red horseshoe magnet swings in on a cable from off the top right, with him stuck to
     its poles by his head. It sways to a stop over his spot, the field clicks off, he drops, lands
     and settles. The magnet hauls back up out of the window.
     Out: the magnet lowers back over him, the field crackles. He hooks the bottom edge of the window
     with his arm and holds on, stretching thin while it lifts him. His grip pops, he flies up and
     clanks onto the poles, and the magnet yanks him out the top. */
  const MG = { R: 40, r: 15, leg: 34, pole: 13 }, MAG_H = MG.R + MG.leg, DROP = 46;
  function drawMagnet(b, mx, my, ang) {
    const R = MG.R, r = MG.r, L = MG.leg;
    b.save(); b.translate(mx, my); b.rotate(ang);
    b.beginPath(); b.moveTo(-R, R); b.arc(0, R, R, PI, 2 * PI); b.lineTo(R, R + L); b.lineTo(r, R + L); b.lineTo(r, R); b.arc(0, R, r, 0, PI, true); b.lineTo(-r, R + L); b.lineTo(-R, R + L); b.closePath();
    const g = b.createLinearGradient(-R, 0, R, 8); g.addColorStop(0, '#e8584a'); g.addColorStop(0.42, '#c33a30'); g.addColorStop(1, '#8e2620');
    b.fillStyle = g; b.fill();
    b.save(); b.clip(); // banded highlight down the left of the arch and leg
    b.beginPath(); b.arc(0, R, R - 7, PI * 0.98, PI * 1.5); b.lineWidth = 5; b.strokeStyle = '#f09aa8'; b.stroke();
    b.fillStyle = '#f09aa8'; b.fillRect(-R + 4, R, 5, L - MG.pole); b.restore();
    for (const x0 of [-R, r]) { // steel pole tips
      b.fillStyle = '#e2e3f4'; b.fillRect(x0, R + L - MG.pole, R - r, MG.pole);
      b.fillStyle = '#9ea2cf'; b.fillRect(x0, R + L - MG.pole, R - r, 3); b.fillStyle = '#7579ad'; b.fillRect(x0, R + L - 3, R - r, 3);
    }
    b.beginPath(); b.moveTo(-R, R); b.arc(0, R, R, PI, 2 * PI); b.lineTo(R, R + L); b.lineTo(r, R + L); b.lineTo(r, R); b.arc(0, R, r, 0, PI, true); b.lineTo(-r, R + L); b.lineTo(-R, R + L); b.closePath();
    b.lineWidth = 1.2; b.strokeStyle = '#16172a'; b.stroke();
    b.beginPath(); b.moveTo(-R, R + L - MG.pole); b.lineTo(-r, R + L - MG.pole); b.moveTo(r, R + L - MG.pole); b.lineTo(R, R + L - MG.pole); b.stroke();
    b.beginPath(); b.arc(0, -4, 4, 0, 2 * PI); b.lineWidth = 2; b.strokeStyle = '#40446c'; b.stroke(); // the eye the cable hooks into
    b.restore();
  }
  /* the rig: pivot far above the window, cable length L, swing phi. Returns the hook point, the
     magnet's pole centre and its region, all in his frame units. */
  function rigAt(st, L, phi) {
    const piv = [HEADTOP[0], -st.anchor.y - 320], dir = [Math.sin(phi), Math.cos(phi)];
    const top = [piv[0] + dir[0] * L, piv[1] + dir[1] * L], tip = [top[0] + dir[0] * MAG_H, top[1] + dir[1] * MAG_H];
    return { piv, top, tip, phi };
  }
  const L_HANG = st => (HEADTOP[1] - DROP - MAG_H) - (-st.anchor.y - 320); // tips just over his head, him hanging DROP above rest
  function magnet(ctx, st, R) {
    const p0 = [st.anchor.x + R.piv[0], st.anchor.y + R.piv[1]], p1 = [st.anchor.x + R.top[0], st.anchor.y + R.top[1] - 4];
    const k = cl((0 - p0[1]) / ((p1[1] - p0[1]) || 1), 0, 1); // the cable from the top edge of the window down to the hook
    pline(ctx, lp(p0[0], p1[0], k), Math.max(0, lp(p0[1], p1[1], k)), p1[0], p1[1], '#33333d', 2);
    region(ctx, st, b => drawMagnet(b, R.top[0], R.top[1], -R.phi), rgOf([R.top, R.tip, [R.top[0] - 50, R.top[1] - 10], [R.top[0] + 50, R.top[1] - 10], [R.tip[0] - 50, R.tip[1]], [R.tip[0] + 50, R.tip[1]]], 6, st));
  }
  /* crackling field lines under the poles: dashed pixel arcs that crawl */
  function field(ctx, st, R, t, power) {
    const c = [st.anchor.x + R.tip[0], st.anchor.y + R.tip[1]];
    for (let k = 0; k < 3; k++) {
      const rx = 30 + k * 10, ry = (8 + k * 9) * power, n = 26;
      for (let i = 0; i < n; i++) {
        if ((i + Math.floor(t * 60) + k) % 3 === 0) continue;
        const a0 = PI * i / n, a1 = PI * (i + 1) / n;
        pline(ctx, c[0] + Math.cos(a0) * rx, c[1] + Math.sin(a0) * ry, c[0] + Math.cos(a1) * rx, c[1] + Math.sin(a1) * ry, k === 1 ? '#e2e3f4' : '#9fb2c8', 1);
      }
    }
    if (power > 0.6) for (let i = 0; i < 2; i++) { const r = rnd(Math.floor(t * 40) + i * 7); spark(ctx, c[0] + (r - 0.5) * 50, c[1] + 6 + r * 20, 2, '#ffffff', '#c7d3e0'); }
  }
  /* him hanging under the poles: his box follows the pole centre, he never rotates */
  const hangOff = R => [R.tip[0] - HEADTOP[0], R.tip[1] - HEADTOP[1] + 1];
  const dangle = (lean, extra) => pose(Object.assign({ lean: lean, leanTop: lean * 1.6, browY: 2.6, browTilt: 0.25, lookY: 0.8, lookX: 0, reach: 1, hx: RX_ + 5, hy: -58, elbow: 1, curl: 0.7 }, extra || {}));
  const RX_ = 11.93; // where his arm leaves the right lobe (rig armRoot x)

  registerFx({
    id: 'p2', name: 'Magnet', appearMs: 2800, disappearMs: 2600,
    appear(ctx, t, st) {
      if (t >= 1) return him(ctx, st, REST);
      const LH = L_HANG(st);
      // the swing: a damped pendulum from off the right edge, settled by 0.55
      const u = seg(t, 0, 0.55), phi = 0.34 * Math.exp(-2.6 * u) * Math.cos(2 * PI * 1.25 * u);
      const dphi = -0.34 * (2.6 * Math.exp(-2.6 * u) * Math.cos(2.5 * PI * u) + Math.exp(-2.6 * u) * 2.5 * PI * Math.sin(2.5 * PI * u));
      const up = t > 0.64 ? eIn(seg(t, 0.64, 0.9)) * (LH + 120) : 0;
      const R = rigAt(st, LH - up, t < 0.55 ? phi : 0);
      if (t < 0.9) magnet(ctx, st, R);
      if (t < 0.62) { // hanging on by his head
        const o = hangOff(R), lean = cl(-dphi * 0.08, -0.35, 0.35);
        field(ctx, st, R, t, 1);
        return him(ctx, st, dangle(lean), o[0], o[1]);
      }
      if (t < 0.66) sfx(ctx, 'CLICK', st.anchor.x + R.tip[0] + 58, st.anchor.y + R.tip[1] - 18, 2);
      // the drop, the landing, the settle
      const fall = seg(t, 0.62, 0.7), land = seg(t, 0.7, 0.8);
      let oy = -DROP * (1 - eIn2(fall)), p;
      if (t < 0.7) p = dangle(0, { lookY: 0.3, browY: 3.4, reach: 1 - fall, hy: -58 });
      else { oy = -7 * Math.sin(PI * land) * (land < 1 ? 1 : 0); p = RG.blend(pose({ happy: 0.6, browY: 2.2, lookY: 0.1 }), REST, eIO(seg(t, 0.78, 0.98))); }
      him(ctx, st, p, 0, oy);
      if (t > 0.7 && t < 0.79) { const fx = st.anchor.x + BASE[0], fy = st.anchor.y + BASE[1] + 2, k = seg(t, 0.7, 0.79); puffs(ctx, fx - 10, fy, k, -1); puffs(ctx, fx + 10, fy, k, 1); }
    },
    disappear(ctx, t, st) {
      if (t <= 0) return him(ctx, st, REST);
      const LH = L_HANG(st) - 26; // hovering well over his head, out of reach
      const down = eOut(seg(t, 0, 0.2)), sway = 0.05 * Math.exp(-5 * seg(t, 0.2, 1)) * Math.sin(seg(t, 0.2, 1) * 18);
      const yank = eIn(seg(t, 0.74, 0.9)) * (LH + 160);
      const hover = t < 0.2 ? lp(-200, LH, down) : LH;
      const R = rigAt(st, hover - (t > 0.74 ? yank : 0), t < 0.66 ? sway : 0);
      if (t >= 0.9) return;
      magnet(ctx, st, R);
      const winB = st.h - st.anchor.y;          // the window's bottom edge, in his frame
      if (t < 0.66) {
        field(ctx, st, R, t, cl(seg(t, 0.12, 0.3) + 0.2 * Math.sin(t * 70), 0, 1));
        const grab = seg(t, 0.32, 0.42), lift = seg(t, 0.44, 0.66), oy = Math.round(-44 * eIO(lift) + (t > 0.22 ? -1.2 * Math.abs(Math.sin(t * 160)) : 0));
        const p = pose({ lookY: lp(0.2, 0.85, seg(t, 0.15, 0.25)), browY: lp(0, 3.2, seg(t, 0.15, 0.25)), browTilt: 0.3, lean: -0.06 - 0.1 * lift, leanTop: -0.1 - 0.16 * lift,
          reach: eOut(grab), hx: RX_ + 9, hy: -4, elbow: 1, curl: 0, pupil: lp(1, 0.8, lift) });
        // the arm keeps going down to the window's bottom edge and hooks it, thinning as he is lifted
        const hand = rig(Sx, p).hand, edge = winB - oy, wv = lp(Sx.wire, 2.2, lift);
        const over = grab > 0.6 ? b => { const P = []; for (let i = 0; i <= 10; i++) P.push([hand[0] + 2 * Math.sin(i * 0.3) * (1 - lift), lp(hand[1], edge - 2, i / 10)]); P.push([hand[0] + 3, edge + 1], [hand[0] + 6, edge - 1]); drawWirePts(b, P, wv); } : null;
        himWide(ctx, st, p, 0, oy, { b: 60, r: 10 }, null, over);
        if (lift > 0.25) sfx(ctx, 'NNGH', st.anchor.x - 30, st.anchor.y + 40 + oy, 2);
        return;
      }
      // his grip pops: the arm springs back, he flies up and clanks onto the poles
      const fly = eIn2(seg(t, 0.66, 0.72)), hang = hangOff(R), oy = lp(-44, hang[1], fly);
      const rec = snap(seg(t, 0.66, 0.78), 6, 16);
      himWide(ctx, st, dangle(0, { reach: 1 - rec, browY: 3.6, pupil: 0.8, lookY: 0.9, hy: (winB - BASE[1]) + 44 }), hang[0], t > 0.72 ? hang[1] : oy, { b: 60, r: 10 });
      if (t < 0.71) sfx(ctx, 'BOING', st.anchor.x + 96, st.anchor.y + 112 - 30 * seg(t, 0.66, 0.71), 2);
      if (t > 0.72 && t < 0.8) { const q = [st.anchor.x + R.tip[0], st.anchor.y + R.tip[1]]; spark(ctx, q[0] - 14, q[1], 5, '#ffffff', '#ffe27a'); spark(ctx, q[0] + 16, q[1] + 2, 4, '#ffffff', '#ffe27a'); sfx(ctx, 'CLANK!', q[0] + 70, q[1] - 30, 2); }
    }
  });

})();
