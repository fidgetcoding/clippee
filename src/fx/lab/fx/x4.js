/* X4 · Teleporter.
   In (2.6 s): a hairline beam stabs down from the top of the window onto his spot and snaps wide, a pad
   rings the floor, sparkles spiral in the column, and he is built from the feet up: each new row of him
   flickers in as sparks before it locks to his real colours. Eyes last: they blink open, the beam pulls
   back up to a line and is gone, and he shakes off a few leftover sparks. Out (2.2 s): he looks up and
   salutes, the beam slams down, and it takes him back pixel by pixel: every pixel of him lifts off, turns
   to light and streaks up the column, head first. The beam pulls up and out. Needs ../xkit.js. */
(function () {
  'use strict';
  const R = window.ClippeeRig, XK = window.XK, seg = XK.seg, E = XK.ease, H = XK.hash;
  const RX = 11.9, AMS = 2600, DMS = 2200, HW = 24;
  const base = st => [st.anchor.x + 48, st.anchor.y + 86];
  const fr = s => Math.floor(s * 20 + 0.5);
  const pz = (a, b, u) => u <= 0 ? R.rest(a) : u >= 1 ? R.rest(b) : R.blend(R.rest(a), R.rest(b), u);

  /* the beam: bottom = lowest y it reaches, w = half width; scroll = scanline direction */
  function beam(ctx, B, bottom, w, f, dir) {
    if (w <= 0 || bottom <= 0) return;
    const x = B[0] - 1;
    XK.layer(ctx, x - w - 4, 0, w * 2 + 8, bottom + 4, 2, l => {
      if (w > 3) {
        l.fillStyle = XK.checker(l, '#a4dcff', 2); l.fillRect(x - w, 0, w * 2, bottom);
        l.fillStyle = XK.checker(l, '#ffffff', 2, true); l.fillRect(x - w * 0.3, 0, w * 0.6, bottom);
        l.fillStyle = '#dcf6ff'; for (let y = ((f * 8 * dir) % 32 + 32) % 32; y < bottom; y += 32) l.fillRect(x - w, y, w * 2, 4);
      }
      l.fillStyle = '#2a6ed8'; l.fillRect(x - w - 2, 0, 2, bottom); l.fillRect(x + w, 0, 2, bottom);
      if (w <= 3) { l.fillStyle = '#ffffff'; l.fillRect(x - 1, 0, 2, bottom); }
    });
  }
  function pad(ctx, B, rx) {
    if (rx <= 10) return;
    XK.layer(ctx, B[0] - rx - 6, B[1] - 14, rx * 2 + 12, 24, 2, l => {
      l.lineWidth = 4; l.strokeStyle = '#123e94'; l.beginPath(); l.ellipse(B[0], B[1] + 1, rx, rx * 0.22, 0, 0, 7); l.stroke();
      l.lineWidth = 2; l.strokeStyle = '#a4dcff'; l.beginPath(); l.ellipse(B[0], B[1], rx - 2, rx * 0.22 - 1, 0, 0, 7); l.stroke();
    });
  }
  function swirl(ctx, B, top, bottom, w, f, n, seed) { // sparkles corkscrewing inside the column
    XK.layer(ctx, B[0] - w - 6, top - 6, w * 2 + 12, bottom - top + 12, 1, l => {
      for (let i = 0; i < n; i++) {
        const ph = H(i, seed, 1) * 6.283 + f * 0.55, y = top + ((H(i, seed, 2) * (bottom - top) + f * (14 + 10 * H(i, seed, 3))) % (bottom - top));
        const x = B[0] + Math.sin(ph) * w * 0.85, sz = [3, 2, 1, 2][(f + i) % 4];
        XK.spark(l, x, y, sz, Math.cos(ph) > 0 ? '#2a6ed8' : '#5aaaf6', 1);
      }
    });
  }
  /* his sprite, rows below cut drawn true; the band just above cut flickers as sparks */
  function build(ctx, st, p, cut, f) {
    const px = XK.pixels(p), ax = st.anchor.x, ay = st.anchor.y;
    for (const q of px) {
      if (q.y >= cut) { ctx.fillStyle = `rgb(${q.c[0]},${q.c[1]},${q.c[2]})`; ctx.fillRect(ax + q.x, ay + q.y, 1, 1); }
      else if (q.y >= cut - 6 && H(q.x, q.y, f) < 0.45) { ctx.fillStyle = H(q.x, q.y, f + 9) < 0.5 ? '#ffffff' : '#a4dcff'; ctx.fillRect(ax + q.x, ay + q.y, 1, 1); }
    }
  }

  /* ---------- appear ---------- */
  const BUILT = R.rest({ blink: 1, lookY: 0.1 });
  function appear(ctx, t, st) {
    if (t >= 1) { XK.him(ctx, st, R.REST, 0, 0); return; }
    const s = t * AMS / 1000, B = base(st), f = fr(s), floor = B[1] + 3;
    // beam in: a line stabs down, snaps wide; out: narrows to a line, the line pulls up
    let bottom = 0, w = 0;
    if (s < 0.16) { bottom = floor * E.in(seg(s, 0, 0.16)); w = 1; }
    else if (s < 1.72) { bottom = floor; w = 1 + (HW - 1) * E.back(seg(s, 0.16, 0.3)); }
    else if (s < 1.84) { bottom = floor; w = Math.max(1, HW * (1 - seg(s, 1.72, 1.84))); }
    else if (s < 1.98) { bottom = floor * (1 - E.in(seg(s, 1.84, 1.98))); w = 1; }
    beam(ctx, B, bottom, w, f, 1);
    if (s > 0.16 && s < 1.84) pad(ctx, B, s < 1.72 ? 34 * E.back(seg(s, 0.16, 0.32)) : 34 * (1 - seg(s, 1.72, 1.84)));
    if (s >= 0.34 && s < 1.5) { const cut = Math.round(93 - 86 * E.inOut(seg(s, 0.36, 1.42))); build(ctx, st, BUILT, cut, f); }
    else if (s >= 1.5) {
      let p;
      if (s < 1.66) p = R.rest({ blink: s < 1.56 ? 1 : 0.5, lookY: 0.1 });
      else if (s < 2.3) { const k = Math.floor((s - 1.95) / 0.07), w2 = s < 1.95 ? 0 : [0.12, -0.12, 0.09, -0.07, 0.04, 0][Math.min(5, Math.max(0, k))]; p = R.rest({ lean: w2, leanTop: w2 * 1.8, lookX: -w2 * 3, browY: s > 1.95 ? 1.2 : 0.4, browTilt: 0.2 }); }
      else p = pz({ browY: 0.6 }, R.REST, E.out(seg(s, 2.3, 2.5)));
      XK.him(ctx, st, p, 0, 0);
    }
    if (s > 0.28 && s < 1.72) swirl(ctx, B, 40, floor - 4, HW - 4, f, 22, 3);
    if (s >= 1.95 && s < 2.35) XK.layer(ctx, B[0] - 50, B[1] - 100, 100, 110, 1, l => {
      for (let i = 0; i < 6; i++) { const u = seg(s, 1.95 + i * 0.04, 2.2 + i * 0.03); if (u <= 0 || u >= 1) continue; const sd = i % 2 ? 1 : -1; XK.spark(l, B[0] + sd * (12 + 26 * E.out(u)), B[1] - 30 - 30 * H(i, 1, 1) + 30 * u * u, Math.round(2 - 2 * u), '#a4dcff', 1); }
    });
  }

  /* ---------- disappear ---------- */
  const WORRY = R.rest({ lookY: -0.9, lookX: 0.05, browY: 2.8, browTilt: 0.45, pupil: 0.75 });
  const T0 = 0.6, T1 = 1.42, ACC = 4200;
  function disappear(ctx, t, st) {
    if (t <= 0) { XK.him(ctx, st, R.REST, 0, 0); return; }
    if (t >= 1) return;
    const s = t * DMS / 1000, B = base(st), f = fr(s), floor = B[1] + 3;
    let bottom = 0, w = 0;
    if (s >= 0.3 && s < 0.4) { bottom = floor * E.in(seg(s, 0.3, 0.4)); w = 1; }
    else if (s >= 0.4 && s < 1.74) { bottom = floor; w = 1 + (HW - 1) * E.back(seg(s, 0.4, 0.52)); }
    else if (s >= 1.74 && s < 1.86) { bottom = floor; w = Math.max(1, HW * (1 - seg(s, 1.74, 1.86))); }
    else if (s >= 1.86 && s < 2.0) { bottom = floor * (1 - E.in(seg(s, 1.86, 2.0))); w = 1; }
    beam(ctx, B, bottom, w, f, -1);
    if (s > 0.4 && s < 1.86) pad(ctx, B, s < 1.74 ? 34 * E.back(seg(s, 0.4, 0.55)) : 34 * (1 - seg(s, 1.74, 1.86)));
    if (s < T0) {
      const p = s < 0.3 ? pz(R.REST, { reach: 1, hx: RX + 3, hy: -52, elbow: 1, curl: -0.7, lookY: -1, lookX: 0.05, browY: 1.6, browTilt: 0.2 }, E.out(seg(s, 0.05, 0.22))) : pz({ reach: 1, hx: RX + 3, hy: -52, elbow: 1, curl: -0.7, lookY: -1, browY: 1.6 }, WORRY, E.out(seg(s, 0.42, 0.56)));
      XK.him(ctx, st, p, 0, 0);
    } else {
      // every pixel leaves on its own clock (head first, with scatter) and streaks up the beam as light
      const px = XK.pixels(WORRY), ax = st.anchor.x, ay = st.anchor.y, cx = B[0] - 1;
      for (const q of px) {
        const go = T0 + (T1 - T0) * (0.62 * (q.y / 93) + 0.38 * H(q.x, q.y, 77));
        if (s < go) { ctx.fillStyle = `rgb(${q.c[0]},${q.c[1]},${q.c[2]})`; ctx.fillRect(ax + q.x, ay + q.y, 1, 1); continue; }
        const tau = s - go, y = ay + q.y - 30 * tau - 0.5 * ACC * tau * tau; if (y < 0) continue;
        const x0 = ax + q.x, x = Math.round(x0 + (cx - x0) * Math.min(1, tau * 5) * 0.8), len = Math.min(10, 1 + Math.round(ACC * tau * 0.02));
        if (tau < 0.05) { ctx.fillStyle = `rgb(${q.c[0]},${q.c[1]},${q.c[2]})`; ctx.fillRect(x, Math.round(y), 1, 1); continue; }
        ctx.fillStyle = '#123e94'; ctx.fillRect(x, Math.round(y), 1, len); ctx.fillStyle = '#ffffff'; ctx.fillRect(x, Math.round(y), 1, 1);
      }
    }
    if (s > 0.45 && s < 1.74) swirl(ctx, B, 40, floor - 4, HW - 4, f, 18, 8);
  }

  registerFx({
    id: 'x4', name: 'Teleporter', appearMs: AMS, disappearMs: DMS, fps: 20, appear, disappear,
    crop: st => ({ x: st.w - 400, y: st.h - 330, w: 400, h: 330 }),
    sheetCrop: st => ({ x: st.w - 456, y: st.h - 300, w: 456, h: 285 }),
    keys: { appear: [0.08, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.45, 1.6, 1.8, 2.05, 2.6], disappear: [0.15, 0.35, 0.5, 0.65, 0.8, 0.95, 1.1, 1.25, 1.45, 1.65, 1.8, 1.95] },
    notes: 'A hairline beam stabs down from the top of the window onto his spot and snaps wide, a pad rings the floor, sparkles spiral in the column, and he is built from the feet up, each new row flickering in as sparks before it locks. Eyes last: they blink open, the beam pulls up and out, and he shakes off a few leftover sparks. Out: he looks up and salutes, the beam slams down, and it takes him back pixel by pixel, head first, every pixel streaking up the column as light.',
    sound: 'A rising VWORP and a shimmering chime that climbs as he is built, a soft ping as the eyes open, a brrr shake-off. Out: "beam me up" salute, a descending shimmer, sparkly fizz streaking upward, a closing ping.'
  });
})();
