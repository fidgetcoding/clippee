/* X2 · Jetpack.
   In (3.0 s): he swoops in from off the top right on a binder-clip jetpack, overshoots, swings back to hover,
   the pack sputters (flames cut, black cough, he drops), recovers, sets down, then unclips it and the pack
   takes off on its own, zig-zagging out of the window while he watches. Out (2.8 s): the pack homes back in
   and clamps onto his back, coughs three times while he hops, then full thrust: he rockets up, loops left
   and skywrites "BRB" in smoke as he exits right; the letters pop away puff by puff.
   Needs ../xkit.js. Pure function of t. */
(function () {
  'use strict';
  const R = window.ClippeeRig, XK = window.XK, seg = XK.seg, E = XK.ease, H = XK.hash;
  const RX = 11.9, AMS = 3000, DMS = 2800, PACK_Y = -34;
  const base = st => [st.anchor.x + 48, st.anchor.y + 86];
  const fr = s => Math.floor(s * 20 + 0.5);
  const pz = (a, b, u) => u <= 0 ? R.rest(a) : u >= 1 ? R.rest(b) : R.blend(R.rest(a), R.rest(b), u);
  const bez = (a, b, c, d, u) => { const m = 1 - u; return [m * m * m * a[0] + 3 * m * m * u * b[0] + 3 * m * u * u * c[0] + u * u * u * d[0], m * m * m * a[1] + 3 * m * m * u * b[1] + 3 * m * u * u * c[1] + u * u * u * d[1]]; };
  const clampL = v => Math.max(-0.55, Math.min(0.55, v));

  /* ---------- the binder-clip jetpack ---------- */
  function pack(ctx, cx, cy, flame, f) {
    XK.layer(ctx, cx - 26, cy - 30, 52, 80, 1, l => {
      for (const sd of [-1, 1]) { // steel wire handles
        const P = [[cx + sd * 8, cy - 6], [cx + sd * 13, cy - 22], [cx + sd * 4, cy - 24], [cx + sd * 3, cy - 6]];
        l.lineJoin = 'round'; l.lineWidth = 3; l.strokeStyle = '#40446c'; l.beginPath(); P.forEach((p, i) => i ? l.lineTo(p[0], p[1]) : l.moveTo(p[0], p[1])); l.stroke();
        l.lineWidth = 1.2; l.strokeStyle = '#cbcdea'; l.stroke();
      }
      for (const sd of [-1, 1]) { // nozzles
        const nx = cx + sd * 14;
        l.fillStyle = '#313456'; l.fillRect(nx - 4, cy + 2, 8, 13); l.fillStyle = '#7579ad'; l.fillRect(nx - 3, cy + 3, 6, 11); l.fillStyle = '#cbcdea'; l.fillRect(nx - 3, cy + 3, 2, 11);
        l.fillStyle = '#16172a'; l.fillRect(nx - 5, cy + 13, 10, 3);
        const L = flame > 0 ? flame * (16 + 10 * H(f, sd, 2)) : 0;
        if (L > 1) {
          const drop = (w, len, col) => { l.fillStyle = col; l.beginPath(); l.moveTo(nx - w, cy + 16); l.quadraticCurveTo(nx - w * 0.8, cy + 16 + len * 0.6, nx + (H(f, sd, 5) - 0.5) * 3, cy + 16 + len); l.quadraticCurveTo(nx + w * 0.8, cy + 16 + len * 0.6, nx + w, cy + 16); l.closePath(); l.fill(); };
          drop(5, L, '#d2361a'); drop(3.6, L * 0.72, '#ffa424'); drop(2, L * 0.42, '#fff4b0');
        }
      }
      // the black clip body, banded
      l.fillStyle = '#0b0b10'; l.beginPath(); l.moveTo(cx - 16, cy - 8); l.lineTo(cx + 16, cy - 8); l.lineTo(cx + 12, cy + 9); l.lineTo(cx - 12, cy + 9); l.closePath(); l.fill();
      l.fillStyle = '#33333d'; l.fillRect(cx - 14, cy - 7, 28, 4); l.fillStyle = '#1d1d26'; l.fillRect(cx - 13, cy - 3, 26, 5);
      l.fillStyle = '#a4a4ae'; l.fillRect(cx - 10, cy + 4, 2, 2); l.fillRect(cx + 8, cy + 4, 2, 2);
    });
  }
  function smoke(ctx, pts) { // pts: [x, y, r, tone, seed]
    if (!pts.length) return;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; pts.forEach(p => { x0 = Math.min(x0, p[0] - p[2] - 4); y0 = Math.min(y0, p[1] - p[2] - 4); x1 = Math.max(x1, p[0] + p[2] + 4); y1 = Math.max(y1, p[1] + p[2] + 4); });
    XK.layer(ctx, x0, y0, x1 - x0, y1 - y0, 2, l => pts.forEach(p => XK.cloud(l, p[0], p[1], p[2], p[3], p[4])));
  }
  const stepR = r => Math.max(0, Math.round(r / 2) * 2);

  /* ---------- appear ---------- */
  const A0 = [380, -660], A1 = [-560, -560], A2 = [-380, -60], A3 = [0, -130];
  function posA(s) {
    if (s < 1.1) return bez(A0, A1, A2, A3, 1 - Math.pow(1 - seg(s, 0, 1.1), 1.7));
    if (s < 1.95) {
      const u = seg(s, 1.1, 1.95), drop = s < 1.36 ? 0 : s < 1.46 ? 18 * E.in(seg(s, 1.36, 1.46)) : 18 * (1 - E.out(seg(s, 1.46, 1.66)));
      return [5 * Math.sin(u * 9) * (1 - u), -130 * (1 - E.inOut(u)) + drop * (1 - u)];
    }
    return [0, 0];
  }
  const flameA = s => s < 1.36 ? 1 : s < 1.46 ? 0 : s < 1.52 ? 0.35 : s < 1.86 ? 0.7 + 0.3 * ((fr(s) % 3) ? 1 : 0) : s < 1.95 ? 0.3 : 0;
  function packEscape(s) { // the empty pack after he unclips it: pops up, then zig-zags off the top left
    if (s < 2.25) { const u = E.out(seg(s, 2.12, 2.25)); return [0, PACK_Y - 60 * u]; }
    const u = seg(s, 2.25, 2.68);
    return [-60 * Math.sin(u * 15) * (1 - u) - 760 * E.in3(u), PACK_Y - 60 - 860 * E.in(u)];
  }
  function appear(ctx, t, st) {
    if (t >= 1) { XK.him(ctx, st, R.REST, 0, 0); return; }
    const s = t * AMS / 1000, B = base(st), f = fr(s), a = st.anchor;
    // smoke: trail puffs left along his path (and the runaway pack's), shrinking with age
    const pts = [];
    for (let k = 1; k <= 11; k++) {
      const sk = s - k * 0.05; if (sk < 0) continue;
      if (sk < 2.0 && flameA(sk) > 0.2) { const p = posA(sk); const r = stepR((5 + 6 * k / 11) * (1 - k / 11)); if (r) pts.push([a.x + 48 + p[0] + (k % 2 ? -14 : 14), a.y + 86 + PACK_Y + p[1] + 24 + k * 3, r, 'light', k]); }
      if (sk > 2.2 && sk < 2.68) { const p = packEscape(sk); const r = stepR(10 * (1 - k / 11)); if (r) pts.push([a.x + 48 + p[0], a.y + 86 + p[1] + 26, r, 'light', k + 3]); }
    }
    if (s > 1.36 && s < 1.7) { const u = seg(s, 1.36, 1.7), p = posA(1.36); pts.push([a.x + 48 + p[0] - 4, a.y + 86 + PACK_Y + p[1] + 22 + 30 * u, stepR(12 * (1 - u)), 'dark', 2]); }
    if (s > 1.9 && s < 2.4) { const u = seg(s, 1.9, 2.4); [-1, 1].forEach(sd => pts.push([B[0] + sd * (14 + 40 * E.out(u)), B[1] - 6, stepR(11 * (1 - u)), 'light', sd + 5])); }
    smoke(ctx, pts.filter(p => p[2] > 0));
    let p, P = posA(s);
    if (s < 1.1) { const q = posA(s + 0.03), vx = (q[0] - posA(s - 0.03)[0]) / 0.06; p = R.rest({ lean: clampL(vx / 2600), leanTop: clampL(vx / 2000), reach: 1, hx: RX + 14, hy: -34, elbow: 1, curl: 0.6, lookX: clampL(vx / 900) * 1.6, lookY: 0.2, browY: 1.8, browTilt: 0.3 }); }
    else if (s < 1.95) { const w = Math.sin(s * 22) * (s < 1.6 ? 0.18 : 0.08); p = R.rest({ lean: w, leanTop: w * 1.6, reach: 1, hx: RX + 14, hy: -34, elbow: 1, curl: 0.6, lookX: 0.1, lookY: 0.5, browY: s > 1.36 && s < 1.6 ? 3 : 1.4, pupil: s > 1.36 && s < 1.6 ? 0.7 : 1 }); }
    else if (s < 2.12) p = pz({ reach: 1, hx: RX + 14, hy: -34, elbow: 1, curl: 0.6, lookY: 0.4, browY: 1.2 }, { reach: 1, hx: RX - 3, hy: -46, elbow: -1, curl: 0.4, lookX: -0.4, lookY: -0.2, browY: 0.8 }, E.inOut(seg(s, 1.95, 2.12)));
    else if (s < 2.62) { const u = seg(s, 2.12, 2.62); p = R.rest({ reach: 1 - u, hx: RX - 3, hy: -46, elbow: -1, curl: 0.4, lookX: -0.2 - 0.7 * E.out(u), lookY: -1, browY: 2.6, pupil: 0.8 }); }
    else p = pz({ lookX: -0.9, lookY: -1, browY: 2.6, pupil: 0.8 }, R.REST, E.inOut(seg(s, 2.62, 2.92)));
    // pack behind him while it is on his back
    if (s < 2.12) pack(ctx, B[0] + P[0], B[1] + PACK_Y + P[1], flameA(s), f);
    XK.him(ctx, st, p, P[0], P[1]);
    if (s >= 2.12 && s < 2.68) { const q = packEscape(s); pack(ctx, B[0] + q[0], B[1] + q[1], s < 2.22 ? 0.4 : 1, f); }
  }

  /* ---------- disappear ---------- */
  const LETTERS = (() => { // B R B as stroke polylines in a 34 x 56 box, then sampled into smoke puffs
    const arc = (cx, cy, r, a0, a1, n) => Array.from({ length: n + 1 }, (_, i) => [cx + r * Math.cos(a0 + (a1 - a0) * i / n), cy + r * Math.sin(a0 + (a1 - a0) * i / n)]);
    const B = [[[0, 0], [0, 56]], [[0, 0], [14, 0]].concat(arc(14, 13, 13, -Math.PI / 2, Math.PI / 2, 6)).concat([[0, 26]]), [[0, 27], [16, 27]].concat(arc(16, 41.5, 14.5, -Math.PI / 2, Math.PI / 2, 6)).concat([[0, 56]])];
    const Rr = [[[0, 0], [0, 56]], [[0, 0], [14, 0]].concat(arc(14, 13, 13, -Math.PI / 2, Math.PI / 2, 6)).concat([[0, 26]]), [[10, 27], [30, 56]]];
    const out = [];
    [[B, 0], [Rr, 52], [B, 104]].forEach(([L, ox], li) => L.forEach(P => {
      for (let i = 1; i < P.length; i++) { const a = P[i - 1], b = P[i], n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 8)); for (let j = i === 1 ? 0 : 1; j <= n; j++) out.push([ox + a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n, li]); }
    }));
    return out;
  })();
  const LX0 = -372, LY0 = -300; // letters' top-left, relative to his feet
  function posD(s) {
    if (s < 1.3) { const hop = bumpA(s, 0.82, 0.94) * 5 + bumpA(s, 1.0, 1.12) * 9 + bumpA(s, 1.15, 1.29) * 14; return [0, -hop + (s > 0.45 && s < 0.5 ? 3 : 0)]; }
    if (s < 1.58) return [0, -320 * E.in(seg(s, 1.3, 1.58))];
    if (s < 1.78) return bez([0, -320], [0, -440], [-420, -450], [-420, -330], E.inOut(seg(s, 1.58, 1.78)));
    const u = seg(s, 1.78, 2.22); return [-420 + 640 * u, -330 - 6 * Math.sin(u * 20)];
  }
  function bumpA(s, a, b) { return s <= a || s >= b ? 0 : Math.sin(Math.PI * (s - a) / (b - a)); }
  function packReturn(s) { const u = seg(s, 0, 0.45), e = E.out(u); return [-720 * (1 - e) + 34 * Math.sin(u * 13) * (1 - u), PACK_Y - 700 * (1 - e) + 24 * Math.cos(u * 11) * (1 - u)]; }
  const flameD = s => s < 0.45 ? 1 : s < 1.3 ? ([0.8, 1.0, 1.15].some(c => s >= c && s < c + 0.06) ? 0.55 : 0) : 1;
  function disappear(ctx, t, st) {
    if (t <= 0) { XK.him(ctx, st, R.REST, 0, 0); return; }
    if (t >= 1) return;
    const s = t * DMS / 1000, B = base(st), f = fr(s), a = st.anchor;
    const pts = [];
    for (let k = 1; k <= 10; k++) {
      const sk = s - k * 0.05; if (sk < 0) continue;
      if (sk < 0.45) { const q = packReturn(sk), r = stepR(9 * (1 - k / 10)); if (r) pts.push([B[0] + q[0], B[1] + q[1] + 24, r, 'light', k]); }
      if (sk > 1.3 && sk < 1.78) { const q = posD(sk), r = stepR(12 * (1 - k / 10)); if (r) pts.push([B[0] + q[0], B[1] + PACK_Y + q[1] + 26, r, 'light', k]); }
    }
    [0.8, 1.0, 1.15].forEach((c, i) => { if (s > c && s < c + 0.42) { const u = seg(s, c, c + 0.42), q = posD(c); [-1, 1].forEach(sd => pts.push([B[0] + sd * 14 + q[0] + sd * 10 * u, B[1] + PACK_Y + q[1] + 20 + 22 * u, stepR((7 + i * 2) * (1 - u)), 'dark', i + sd])); } });
    if (s > 1.3 && s < 1.9) { const u = seg(s, 1.3, 1.9); [-1, 1, -2, 2].forEach(sd => pts.push([B[0] + sd * (10 + 30 * E.out(u)), B[1] - 6 - 4 * Math.abs(sd), stepR(14 * (1 - u)), 'light', sd + 9])); }
    // the skywriting: each puff appears when his nozzles pass it, pops left to right after a beat
    const pen = B[0] + posD(s)[0];
    LETTERS.forEach((q, i) => {
      const x = B[0] + LX0 + q[0], y = B[1] + LY0 + q[1];
      if (s < 1.78 || pen < x) return;
      const pop = 2.25 + 0.38 * (q[0] / 140), r = stepR(7 * (1 - seg(s, pop, pop + 0.1)) + (H(i, 2, 2) > 0.6 ? 1 : 0));
      if (r > 0) pts.push([x, y, r, 'light', i]);
    });
    smoke(ctx, pts.filter(p => p[2] > 0));
    const P = posD(s);
    let p;
    if (s < 0.45) p = pz(R.REST, { lookX: -0.8, lookY: -0.8, browY: 1.2, browTilt: 0.2 }, E.out(seg(s, 0, 0.3)));
    else if (s < 0.75) p = R.rest(s < 0.55 ? { pupil: 0.6, eyeS: 1.08, browY: 3.4, lookX: -0.2, lookY: -0.3 } : { reach: 1, hx: RX + 6, hy: -58, elbow: 1, curl: -0.8, lookX: 0.1, lookY: 0.1, browY: 2, browTilt: 0.35 });
    else if (s < 1.3) { const w = Math.sin(s * 30) * 0.16; p = R.rest({ lean: w, leanTop: w * 1.7, reach: 1, hx: RX + 14, hy: -34, elbow: 1, curl: 0.6, lookY: 0.7, lookX: -0.1, browY: 2.4, browTilt: 0.4, pupil: 0.85 }); }
    else if (s < 1.58) p = R.rest({ reach: 1, hx: RX - 1, hy: -86, elbow: 0.2, lookY: -1, browY: -0.8, browTilt: -0.7 });
    else if (s < 1.78) { const u = seg(s, 1.58, 1.78); p = R.rest({ lean: -0.45 + 0.9 * u, leanTop: -0.6 + 1.2 * u, reach: 1, hx: RX + 16, hy: -36, elbow: 1, curl: 0.6, lookX: -0.8 + 1.6 * u, lookY: 0, browY: 1.6 }); }
    else p = R.rest({ lean: 0.42, leanTop: 0.6, reach: 1, hx: RX + 18, hy: -42, elbow: 1, curl: 0.8, lookX: 0.9, lookY: 0.1, browY: 2, browTilt: 0.3, happy: 0 });
    if (s < 0.45) { const q = packReturn(s); pack(ctx, B[0] + q[0], B[1] + q[1], 1, f); }
    else if (s < 2.22) pack(ctx, B[0] + P[0], B[1] + PACK_Y + P[1], flameD(s), f);
    if (s < 2.22) XK.him(ctx, st, p, P[0], P[1]);
  }

  registerFx({
    id: 'x2', name: 'Jetpack', appearMs: AMS, disappearMs: DMS, fps: 20, appear, disappear,
    crop: st => ({ x: st.w - 560, y: st.h - 470, w: 560, h: 470 }),
    sheetCrop: st => ({ x: st.w - 540, y: st.h - 470, w: 540, h: 470 }),
    keys: { appear: [0.15, 0.45, 0.75, 1.0, 1.25, 1.4, 1.6, 1.9, 2.15, 2.35, 2.55, 3.0], disappear: [0, 0.2, 0.5, 0.82, 1.15, 1.4, 1.65, 1.85, 2.0, 2.2, 2.45, 2.8] },
    notes: 'He swoops in from the top right on a binder-clip jetpack, overshoots, swings back to hover; the pack sputters (flames cut, black cough, he drops), recovers and sets him down. He unclips it and it flies off by itself. Out: the pack homes back in and clamps on, coughs three times while he hops, then full thrust: up, a loop left, and he skywrites BRB as he exits right. The letters pop away puff by puff.',
    sound: 'Putt-putt jet whine with a Doppler swoop, a sputter and cough, a clunk on landing, then the empty pack whistling away like a let-go balloon. Out: a clamp CLACK, three coughs, a roaring WHOOSH, and a skywriter buzz.'
  });
})();
