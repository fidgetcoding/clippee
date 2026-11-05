/* ============================================================================
   C1 · Drill-up
   In:  the page cracks out from his spot, a hole tears open, and his wire comes up through it wound
        into a spinning drill bit, spraying paper chips. Clear of the hole he unwinds back into
        himself, his eyes pop open, he shakes off the last chips, and the page knits back together.
   Out: he pulls a portable hole out from behind his back and flings it on the floor, hops in feet
        first, then his wire end pokes back up, hooks the edge of the hole and drags it down in
        after him until there is nothing left.
   Sound: a rising grind and crackle, a drill whine with paper ripping, a "pop" as he unwinds, a
        rattle as he shakes off; out: a "fwump" as the hole lands, a slide-whistle drop, a "shloop" as
        the hole folds in.
   Clippee is only ever moved, wound or unwound; he never scales. Effects are 2 px pixel art.
   ========================================================================== */
(function () {
  'use strict';
  /* ---- helpers (inlined in every family-c fx so each one ports on its own) ---- */
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v, lerp = (a, b, t) => a + (b - a) * t;
  const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
  const eIn = t => t * t * t, eOut = t => 1 - Math.pow(1 - t, 3), eIO = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const eBack = t => { const c = 1.7; t -= 1; return 1 + (c + 1) * t * t * t + c * t * t; };
  function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let q = Math.imul(seed ^ seed >>> 15, 1 | seed); q = q + Math.imul(q ^ q >>> 7, 61 | q) ^ q; return ((q ^ q >>> 14) >>> 0) / 4294967296; }; }
  const POOL = {};
  // his sprite for a pose: drawn by the rig, squeezed through the 1997 'prerender' pass, never scaled
  function sprite(p, slot) {
    const c = POOL[slot] || (POOL[slot] = Object.assign(document.createElement('canvas'), { width: 124, height: 93 }));
    return retroRender(drawClippee, p, 'prerender', c);
  }
  const blit = (ctx, spr, x, y) => ctx.drawImage(spr, Math.round(x), Math.round(y));
  const box = (ctx, x, y, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
  const dot = (ctx, x, y, g, col) => { ctx.fillStyle = col; ctx.fillRect(Math.floor(x / g) * g, Math.floor(y / g) * g, g, g); };
  function pline(ctx, x0, y0, x1, y1, g, col) { const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / g)); for (let i = 0; i <= n; i++) dot(ctx, lerp(x0, x1, i / n), lerp(y0, y1, i / n), g, col); }
  // a filled pixel disc on a g grid, with a one-cell rim
  function pdisc(ctx, cx, cy, r, g, fill, rim) {
    const R = Math.ceil(r / g) + 1, c0 = Math.floor(cx / g), r0 = Math.floor(cy / g);
    for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
      const d = Math.hypot(i, j) * g; if (d > r) continue;
      ctx.fillStyle = rim && d > r - g ? rim : fill; ctx.fillRect((c0 + i) * g, (r0 + j) * g, g, g);
    }
  }
  // a pixel ellipse outline on a g grid (a = angle offset for dashed spinning rings)
  function pring(ctx, cx, cy, rx, ry, g, col, dash, ph) {
    const n = Math.ceil((rx + ry) * 3.2 / g);
    for (let i = 0; i < n; i++) { if (dash && ((i + Math.floor(ph || 0)) % dash) === 0) continue; const a = i / n * Math.PI * 2; dot(ctx, cx + rx * Math.cos(a), cy + ry * Math.sin(a), g, col); }
  }
  let MASK = null;   // his rest silhouette: every opaque sprite pixel with its colour
  function restPixels() {
    if (MASK) return MASK;
    const d = sprite(REST, 'mask').getContext('2d').getImageData(0, 0, 124, 93).data; MASK = [];
    for (let y = 0; y < 93; y++) for (let x = 0; x < 124; x++) { const i = (y * 124 + x) * 4; if (d[i + 3]) MASK.push([x, y, 'rgb(' + d[i] + ',' + d[i + 1] + ',' + d[i + 2] + ')']); }
    return MASK;
  }
  const FEET = 89, MIDX = 49;   // his feet row and body centre column inside the 124 x 93 box
  // a cartoon cloud: several pixel discs merged, rim first then fill, so inner edges never show
  function cloud(ctx, discs, g, fill, rim, hi) {
    discs.forEach(d => pdisc(ctx, d[0], d[1], d[2], g, rim));
    discs.forEach(d => pdisc(ctx, d[0], d[1], d[2] - g, g, fill));
    if (hi) discs.forEach(d => { if (d[2] > 4 * g) pdisc(ctx, d[0] - d[2] * 0.3, d[1] - d[2] * 0.35, d[2] * 0.35, g, hi); });
  }
  const puffDiscs = (cx, cy, r) => [[cx, cy, r], [cx + r * 0.65, cy - r * 0.35, r * 0.72], [cx - r * 0.7, cy + r * 0.12, r * 0.62], [cx + r * 0.15, cy + r * 0.3, r * 0.6]];

  const CRACK = '#2b2b33', CRACK_HI = '#ffffff', CHIP = ['#ffffff', '#dcdce3', '#a4a4ae'], VOID = '#0b0b10', VOID2 = '#33333d';
  const N = 180;
  let CLIP = null;   // his normal wire, resampled (inner end -> head loop -> lobes -> arm tip)
  function rs(P, n) {
    const L = [0]; for (let i = 1; i < P.length; i++) L.push(L[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const T = L[L.length - 1], out = []; let j = 0;
    for (let k = 0; k < n; k++) { const s = T * k / (n - 1); while (j < L.length - 2 && L[j + 1] < s) j++; const u = (s - L[j]) / ((L[j + 1] - L[j]) || 1); out.push([lerp(P[j][0], P[j + 1][0], u), lerp(P[j][1], P[j + 1][1], u)]); }
    return out;
  }
  const clip = () => CLIP || (CLIP = rs(restWire(REST)[0], N));
  // his wire wound into a drill bit: a cone, point up, turning with spin
  const drill = spin => Array.from({ length: N }, (_, i) => { const u = i / (N - 1), r = 2 + 15 * u, a = 2 * Math.PI * 5 * u + spin; return [1 + r * Math.cos(a), -8 - 72 * (1 - u) + 3.2 * Math.sin(a)]; });
  // jagged cracks running out from a point, fixed seed
  let CRACKS = null;
  function cracks() {
    if (CRACKS) return CRACKS; const R = rng(11); CRACKS = [];
    for (let k = 0; k < 9; k++) { let a = (k / 9) * Math.PI * 2 + R() * 0.5, x = 0, y = 0; const P = [[0, 0]], len = 34 + R() * 70;
      for (let s = 0; s < len; s += 5) { a += (R() - 0.5) * 0.9; x += 5 * Math.cos(a); y += 5 * Math.sin(a) * 0.62; P.push([x, y]); }
      CRACKS.push(P); if (R() < 0.5) { const b = P[Math.floor(P.length * 0.5)]; let a2 = a + (R() < 0.5 ? 0.9 : -0.9), x2 = b[0], y2 = b[1]; const Q = [[x2, y2]]; for (let s = 0; s < len * 0.45; s += 5) { a2 += (R() - 0.5) * 0.8; x2 += 5 * Math.cos(a2); y2 += 5 * Math.sin(a2) * 0.62; Q.push([x2, y2]); } CRACKS.push(Q); } }
    return CRACKS;
  }
  function drawCracks(ctx, cx, cy, amt) {    // amt 0..1 grows each crack from the centre out
    cracks().forEach(P => { const n = Math.floor((P.length - 1) * amt); for (let i = 0; i < n; i++) { pline(ctx, cx + P[i][0], cy + P[i][1] + 2, cx + P[i + 1][0], cy + P[i + 1][1] + 2, 2, CRACK_HI); pline(ctx, cx + P[i][0], cy + P[i][1], cx + P[i + 1][0], cy + P[i + 1][1], 2, CRACK); } });
  }
  function hole(ctx, cx, cy, rx, ry, torn) {   // a black hole in the page, with a torn white lip
    if (rx < 1) return;
    if (torn) for (let k = 0; k < 28; k++) { const a = k / 28 * Math.PI * 2, j = 3 + 3 * ((k * 7) % 3); dot(ctx, cx + (rx + j) * Math.cos(a), cy + (ry + j * 0.5) * Math.sin(a), 2, k % 2 ? CHIP[0] : CHIP[1]); }
    for (let y = -ry; y <= ry; y += 2) { const w = rx * Math.sqrt(Math.max(0, 1 - (y / ry) * (y / ry))); box(ctx, cx - w, cy + y, 2 * w, 2, y < -ry * 0.45 ? VOID2 : VOID); }
  }
  // paper chips: born at a point with a seeded velocity, fly in an arc, gone after `life`
  function chips(ctx, ox, oy, t, t0, t1, count, seed, spreadUp) {
    for (let k = 0; k < count; k++) { const R = rng(seed + k), born = lerp(t0, t1, R()), a = t - born, life = 0.16 + R() * 0.08; if (a < 0 || a > life) continue;
      const vx = (R() - 0.5) * 900, vy = (spreadUp ? 700 : 300) + R() * 500, x = ox + vx * a, y = oy - vy * a + 2600 * a * a;
      box(ctx, x, y, R() < 0.5 ? 4 : 2, 2, CHIP[k % 3]); if (k % 3 === 0) box(ctx, x, y + 2, 2, 2, CHIP[2]); }
  }

  const IN = 2600, OUT = 2400;
  function appear(ctx, t, st) {
    const A = st.anchor, cx = A.x + MIDX, cy = A.y + FEET - 1;
    // the page cracks and tears open, and later knits back together
    const crack = seg(t, 0.0, 0.2) * (1 - seg(t, 0.76, 0.92)), open = eOut(seg(t, 0.14, 0.3)) * (1 - eIn(seg(t, 0.68, 0.86)));
    if (crack > 0) drawCracks(ctx, cx, cy, crack);
    if (t > 0.04 && t < 0.22) for (let k = 0; k < 6; k++) { const ph = (t * 40 + k * 1.3) % 2; if (ph < 1) box(ctx, cx - 30 + k * 12, cy - 2 - 6 * Math.sin(ph * Math.PI), 2, 2, CHIP[k % 3]); }
    hole(ctx, cx, cy, 30 * open, 9 * open, open > 0.2);
    chips(ctx, cx, cy - 4, t, 0.28, 0.66, 46, 500, true);
    if (t < 0.3) return;
    // the drill rises out of the hole (hidden below the hole's middle line), then unwinds into him
    const rise = eOut(seg(t, 0.3, 0.6)), unwind = eIO(seg(t, 0.6, 0.78)), spin = t * 70 * (1 - unwind * 0.8);
    const y = A.y + 92 * (1 - rise);
    if (unwind < 1) {
      const D = drill(spin), C = clip(), wire = D.map((d, i) => [lerp(d[0], C[i][0], unwind), lerp(d[1], C[i][1], unwind)]);
      const p = rest({ wire: [wire], face: unwind > 0.6 ? 1 : 0, blink: unwind > 0.6 ? 1 - seg(unwind, 0.6, 1) : 0, browY: 2 });
      ctx.save(); if (rise < 1) { ctx.beginPath(); ctx.rect(0, 0, st.w, cy); ctx.clip(); } blit(ctx, sprite(p, 'main'), A.x, y); ctx.restore();
      if (rise < 1 && open > 0) { ctx.save(); ctx.beginPath(); ctx.rect(0, cy, st.w, 40); ctx.clip(); hole(ctx, cx, cy, 30 * open, 9 * open, false); ctx.restore(); }
      return;
    }
    // shake off the paper: a fast wiggle that settles to rest, chips flying off him
    const w = seg(t, 0.78, 0.93), wig = Math.exp(-w * 3) * Math.sin(w * 30) * (1 - w);
    chips(ctx, cx, A.y + 40, t, 0.72, 0.76, 18, 900, false);
    blit(ctx, sprite(t >= 0.94 ? REST : rest({ lean: 0.03 + 0.16 * wig, leanTop: 0.03 + 0.26 * wig, headTilt: 0.08 * wig, browY: 1.5 * (1 - w), lookX: -0.18 + 0.5 * wig }), 'main'), A.x, A.y);
  }

  function disappear(ctx, t, st) {
    const A = st.anchor, hx = A.x - 70, hy = A.y + FEET - 1, R = 30, Rv = 9;
    // 1. pull the hole from behind his back and fling it to the floor beside him
    if (t < 0.2) {
      const u = seg(t, 0.02, 0.2), wind = Math.sin(Math.PI * seg(t, 0.02, 0.1)), fl = seg(t, 0.08, 0.2);
      const reach = t < 0.1 ? eOut(seg(t, 0.02, 0.08)) : 1 - eIO(seg(t, 0.12, 0.2));
      const p = rest({ reach, hx: fl > 0 ? lerp(40, -6, eOut(fl)) : 40, hy: fl > 0 ? -44 : -36, elbow: 1, curl: 0.3, lookX: lerp(-0.18, -0.8, fl), lookY: lerp(0.1, 0.4, fl), browY: 1.2 * wind });
      blit(ctx, sprite(p, 'main'), A.x, A.y);
      if (fl > 0) { const fx = lerp(A.x + 70, hx, eOut(fl)), fy = lerp(A.y + 40, hy, eIn(fl)) - 40 * Math.sin(Math.PI * fl), flip = Math.abs(Math.cos(fl * 14));
        hole(ctx, fx, fy, fl < 1 ? 13 : R, fl < 1 ? Math.max(2, 13 * flip) : Rv, false); }
      return;
    }
    const spread = eBack(seg(t, 0.2, 0.28)), fold = seg(t, 0.7, 0.9), rx = R * spread * (1 - eIn(fold)), ry = Rv * spread * (1 - eIn(fold));
    hole(ctx, hx + fold * 4, hy, rx, ry, false);
    // 2. a look, a grin, a hop up and over, and down the hole feet first
    if (t < 0.55) {
      const look = seg(t, 0.2, 0.32), hop = seg(t, 0.32, 0.47), sink = seg(t, 0.47, 0.55);
      const x = lerp(A.x, hx - MIDX, eIO(hop)), y = A.y - 46 * Math.sin(Math.PI * Math.min(1, hop * 1.1)) + 100 * eIn(sink);
      const p = rest({ lookX: -0.8 + 0.5 * hop, lookY: 0.55 - 0.3 * hop, happy: look > 0.4 && hop < 0.3 ? 0.6 : 0, lean: hop > 0 ? -0.06 * Math.sin(Math.PI * hop) : -0.05 * look, browY: 1 + hop, blink: sink > 0.4 ? 0.6 : 0 });
      ctx.save(); if (sink > 0) { ctx.beginPath(); ctx.rect(0, 0, st.w, hy); ctx.clip(); } blit(ctx, sprite(p, 'main'), x, y); ctx.restore();
      return;
    }
    // 3. his wire end pokes back up, hooks the near lip, and drags the hole in after him
    const poke = seg(t, 0.6, 0.68), pull = fold;
    if (poke > 0 && pull < 0.95) {
      const up = 26 * eOut(poke) * (1 - eIn(pull)), lip = [hx - rx * 0.7, hy + ry * 0.55];
      const tip = pull > 0 ? [lerp(hx - 4, lip[0] + 4, Math.min(1, pull * 3)), hy - up + 6] : [hx - 2, hy - up];
      const W = [[hx + 2, hy + 14], [hx + 1, hy - up * 0.5], [tip[0] + 3, tip[1] - 6], tip, [tip[0] - 3, tip[1] + 4]];
      const bx = hx - 47, local = W.map(q => [q[0] - (bx + 47), q[1] - (A.y + 86)]);   // the arm's own sprite box sits over the hole
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, st.w, hy + 1); ctx.clip();
      blit(ctx, sprite(rest({ wire: [local], face: 0 }), 'arm'), bx, A.y); ctx.restore();
    }
    if (fold >= 1 && t < 0.97) { const u = seg(t, 0.9, 0.97); for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; dot(ctx, hx + 4 + Math.cos(a) * 10 * u, hy + Math.sin(a) * 5 * u, 2, k % 2 ? VOID : VOID2); } }
  }

  registerFx({ id: 'c1', name: 'Drill-up', appearMs: IN, disappearMs: OUT, appear, disappear,
    focus: { x: 1100, y: 640, w: 340, h: 260 }, thumbMs: IN * 0.5,
    notes: 'In: the page cracks, a hole tears open, his wire comes up through it wound into a spinning drill bit spraying paper chips, unwinds into him, he shakes off the chips and the page knits shut. Out: he flings a portable hole on the floor, hops in feet first, then his wire end pokes up, hooks the lip and drags the hole in after him.',
    sound: 'rising grind and crackle, drill whine with paper ripping, a "pop" as he unwinds, a rattle; out: a "fwump", a slide-whistle drop, a "shloop" as the hole folds in' });
})();
