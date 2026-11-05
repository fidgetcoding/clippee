/* ============================================================================
   C4 · Road runner
   In:  a dust trail streaks along the bottom of the window from the left edge; he blurs in on
        whirling wire legs, slams on the brakes, skids with sparks and smoke, leaves two black
        skid marks, wobbles, and settles. The marks and smoke crumble away.
   Out: he glances left, his legs spin up into a whirl, he revs, and ZIP, he is gone, leaving a
        Clippee-shaped cloud of dust that hangs for a beat and then collapses into a heap and blows away.
   Sound: "meep meep", a whine of tiny legs, a long rubber screech, a pop. Out: revving whirr, a
        twang-zip, the dust cloud settling with a soft "pff".
   Clippee is only ever moved; he never scales. Effects are 2 px chunky pixel art.
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

  const DUST = ['#e9e4d0', '#d8d2b8', '#b9b29a'], SMOKE = ['#f1f1f4', '#c3c3cc', '#7e7e88'], MARK = '#2b2b33', SPARK = ['#ffe27a', '#f5c037', '#e8584a'];
  const STEEL = ['#313456', '#62679a', '#b4b7de'];

  // the whirling-legs blur where his lobes were (he is clipped above it while running): Looney Tunes wheel legs
  function legs(ctx, x, y, ph, g) {
    for (let k = 0; k < 4; k++) pring(ctx, x + (k % 2 ? 3 : -3), y, 19 - k * 3, 7 - (k % 2) * 2, g, STEEL[k % 3], 3, ph * 7 + k * 2);
    for (let k = 0; k < 5; k++) { const a = ph * 11 + k * Math.PI * 2 / 5; pline(ctx, x, y, x + 17 * Math.cos(a), y + 6.5 * Math.sin(a), g, k % 2 ? STEEL[0] : STEEL[1]); }
    pdisc(ctx, x, y, 3, g, STEEL[0]);
  }
  function speedLines(ctx, x0, x1, y, seed, g) {     // horizontal streaks behind a fast mover
    const R = rng(seed), a = Math.min(x0, x1), b = Math.max(x0, x1);
    for (let k = 0; k < 9; k++) { const yy = y + 6 + R() * 76, len = 60 + R() * 220, off = R() * 70, th = k % 3 ? g : 2 * g;
      const s = x1 > x0 ? clamp(b - off - len, a, b) : clamp(a + off, a, b), e = x1 > x0 ? clamp(b - off, a, b) : clamp(a + off + len, a, b);
      if (e - s > 4) { box(ctx, s, Math.floor(yy / g) * g, e - s, th, k % 3 ? '#c9cbe0' : '#8a8fbf'); box(ctx, x1 > x0 ? e - 2 * g : s, Math.floor(yy / g) * g, 2 * g, th, '#e2e3f4'); } }
  }
  // a smoke puff born at (x, y): bursts up, grows, drifts back and rises, then breaks into crumbs and is gone
  function puff(ctx, x, y, age, life, R, g, big) {
    if (age < 0 || age > life) return;
    const u = age / life, r = (big || 1) * (4 + 9 * eOut(Math.min(1, u * 1.8))), cx = x - 26 * u * (big || 1), cy = y - 4 - 20 * u;
    if (u < 0.74) cloud(ctx, puffDiscs(cx, cy, r), g, SMOKE[0], SMOKE[1], '#ffffff');
    else { const k = Math.ceil((1 - u) / 0.26 * 7); for (let i = 0; i < k; i++) dot(ctx, cx + (R() - 0.5) * r * 2.6, cy + (R() - 0.5) * r * 1.6 - (u - 0.74) * 24, g, SMOKE[1]); }
  }

  const IN = 2200, OUT = 2000;
  const RUN = rest({ lean: 0.22, leanTop: 0.34, headTilt: 0.06, lookX: 0.9, lookY: 0.15, browY: -0.4, browTilt: -0.4 });
  const BRAKE = rest({ lean: -0.32, leanTop: -0.5, headTilt: -0.1, lookX: 0.75, lookY: 0.05, browY: 3, browTilt: 0.35, reach: 1, hx: 30, hy: -46, elbow: 1, curl: -0.6 });

  function appear(ctx, t, st) {
    const A = st.anchor, fy = A.y + FEET, R = rng(41);
    const tRun = 0.36, tStop = 0.6, startX = -150, skidX = A.x - 270;
    let x, p, clipLegs = false, ph = t * 40;
    if (t < tRun) { x = lerp(startX, skidX, t / tRun); p = Object.assign({}, RUN, { reach: 1, hx: 20 + 6 * Math.sin(ph), hy: -40 + 4 * Math.cos(ph), elbow: 1, curl: 0.3 }); clipLegs = true; }
    else if (t < tStop) { const u = eOut(seg(t, tRun, tStop)); x = lerp(skidX, A.x, u); p = blend(RUN, BRAKE, Math.min(1, seg(t, tRun, tRun + 0.05))); p.blink = 0.25; }
    else { x = A.x; const w = seg(t, tStop, 0.86), damp = Math.exp(-w * 4.5) * Math.cos(w * 16);
      p = rest({ lean: 0.03 + 0.2 * damp * (1 - w), leanTop: 0.03 + 0.32 * damp * (1 - w), headTilt: 0.07 * damp * (1 - w), browY: 2.4 * (1 - eOut(w)), lookX: -0.18 + 0.4 * damp, lookY: 0.1 }); }
    // dust trail and speed lines while he runs; they shrink away after he has passed
    if (t < tStop + 0.1) {
      const tail = t < tRun ? x : skidX, shrink = seg(t, tRun, tStop + 0.1);
      speedLines(ctx, Math.max(0, lerp(startX, tail, shrink)), tail, A.y + 4, 7, 2);
      for (let k = 0; k < 18; k++) { const px = lerp(startX + 60, tail, k / 17), born = (px - startX) / (skidX - startX) * tRun; puff(ctx, px + 30, fy - 2, t - born, 0.24, rng(100 + k), 2, 1); }
    }
    // skid: two black marks behind his lobes, sparks off the wire, smoke boiling up
    if (t >= tRun) {
      const end = Math.min(x, A.x) + 34, crumble = seg(t, 0.72, 0.9);
      const RM = rng(5);
      for (let lane = 0; lane < 2; lane++) for (let mx = skidX + 30; mx < end; mx += 2) { const r = RM(); if (r < crumble * 1.15) continue; box(ctx, mx + lane * 14, fy - 2 + lane * 4, 2, 4 - (r > 0.85 ? 2 : 0), MARK); }
      for (let k = 0; k < 12; k++) { const born = tRun + k * 0.019; puff(ctx, lerp(skidX, A.x, eOut(seg(born, tRun, tStop))) + 30, fy - 2, t - born, 0.32, rng(200 + k), 2, 1.25); }
      // screech: little bent lines flicking off the front of his feet while he slides
      if (t < tStop) for (let k = 0; k < 3; k++) { const ex = x + MIDX + 26, ey = fy - 10 - k * 7, on = (Math.floor(t * 50) + k) % 2;
        if (on) { pline(ctx, ex + 2 * k, ey, ex + 10 + 2 * k, ey - 4, 2, '#3d4168'); pline(ctx, ex + 10 + 2 * k, ey - 4, ex + 14 + 2 * k, ey - 1, 2, '#3d4168'); } }
      if (t < tStop + 0.03) for (let k = 0; k < 14; k++) { const Rs = rng(300 + k), born = tRun + Rs() * (tStop - tRun), a = t - born; if (a < 0 || a > 0.09) continue;
        const bx = lerp(skidX, A.x, eOut(seg(born, tRun, tStop))) + 36; dot(ctx, bx - 400 * a * (0.5 + Rs()), fy - 4 - 260 * a + 1600 * a * a, 2, SPARK[k % 3]); }
    }
    const spr = sprite(t >= 0.92 ? REST : p, 'main');
    if (clipLegs) { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, st.w, A.y + 78); ctx.clip(); blit(ctx, spr, x, A.y); ctx.restore(); legs(ctx, Math.round(x) + MIDX + 2, A.y + 83, ph, 2); }
    else blit(ctx, spr, x, A.y);
  }

  function disappear(ctx, t, st) {
    const A = st.anchor, fy = A.y + FEET, tZip = 0.42;
    if (t < tZip) {
      const rev = seg(t, 0.12, tZip), shake = t > 0.18 ? ((Math.floor(t * 120) % 2) ? 1 : -1) : 0;
      const p = rest({ lean: lerp(0.03, -0.24, eOut(rev)), leanTop: lerp(0.03, -0.36, eOut(rev)), headTilt: -0.05 * rev, lookX: lerp(-0.18, -0.95, seg(t, 0, 0.1)), lookY: 0.1, browY: -0.6 * rev, browTilt: -0.4 * rev, blink: t > 0.06 && t < 0.1 ? 1 : 0 });
      const spr = sprite(p, 'main');
      if (rev > 0.15) {
        ctx.save(); ctx.beginPath(); ctx.rect(0, 0, st.w, A.y + 78); ctx.clip(); blit(ctx, spr, A.x + shake, A.y); ctx.restore();
        legs(ctx, A.x + shake + MIDX + 2, A.y + 83, t * 30 * (0.4 + rev * 2), 2);
        for (let k = 0; k < 8; k++) { const Rk = rng(400 + k), ph = (t * 6 + Rk()) % 1; dot(ctx, A.x + MIDX + 16 + ph * 40 * (0.6 + Rk()), fy - 2 - ph * 14 * Rk(), 2, DUST[k % 3]); }
      } else blit(ctx, spr, A.x, A.y);
      return;
    }
    // ZIP: he is gone off the left edge in a blink; speed lines and the dust ghost stay behind
    const z = seg(t, tZip, tZip + 0.12);
    if (z < 1) {
      const x = lerp(A.x, -170, eIn(z)), spr = sprite(rest({ lean: -0.24, leanTop: -0.36, lookX: -0.95, browTilt: -0.4, browY: -0.6 }), 'main');
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, st.w, A.y + 78); ctx.clip(); blit(ctx, spr, x, A.y); ctx.restore(); legs(ctx, Math.round(x) + MIDX + 2, A.y + 83, t * 80, 2);
    }
    const lines = seg(t, tZip, tZip + 0.3);
    if (lines < 1) speedLines(ctx, lerp(A.x + 90, -170, Math.max(lines, eIn(z) * 0)) , lerp(A.x + 90, -170, eIn(Math.min(1, z))), A.y + 4, 9, 2);
    // the dust ghost: his silhouette in dust, holds, then every grain drops to the floor and blows away
    const hold = tZip + 0.22, PX = restPixels(), R = rng(77), fall = seg(t, hold, 0.86), gone = seg(t, 0.84, 1);
    for (let i = 0; i < PX.length; i += 2) {
      const [sx, sy] = PX[i], r1 = R(), r2 = R(), r3 = R();
      if (t < tZip + 0.03 * r1) continue;                       // the cloud puffs in right behind him
      const delay = r1 * 0.45 + (1 - sy / 93) * 0.35, u = clamp((fall - delay) / 0.4, 0, 1);
      const x0 = A.x + sx + (t < hold ? (r2 - 0.5) * 2 : 0), y0 = A.y + sy;
      const y = Math.min(fy - r3 * 4, y0 + 260 * u * u), drift = u >= 1 ? (gone * 140 * (0.4 + r2)) : 0;
      if (gone > r3 * 0.9 + 0.05) continue;
      box(ctx, x0 + drift - (sx & 1), y, 2, 2, DUST[Math.floor(r2 * 3)]);
    }
  }

  registerFx({ id: 'c4', name: 'Road runner', appearMs: IN, disappearMs: OUT, appear, disappear,
    focus: { x: 760, y: 700, w: 680, h: 200 },
    notes: 'In: he blurs in from the left edge on whirling wire legs, skids to a stop with sparks, smoke and black skid marks, wobbles, settles. Out: legs spin up, ZIP, he is gone and a dust cloud in his shape hangs, then collapses and blows away.',
    sound: '"meep meep", tiny-leg whine, long rubber screech; out: revving whirr, twang-zip, a soft "pff" as the dust drops' });
})();
