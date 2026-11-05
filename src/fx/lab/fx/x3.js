/* X3 · Magic hat.
   In (3.0 s): a black top hat drops onto his spot upside down and bounces, a magic wand flies in and taps the
   brim three times (each tap spits sparks, the hat shudders harder), then he springs out of the hat with a
   burst of stars, the hat goes POOF under him, and he lands in a deep showman's bow before standing up.
   Out (2.6 s): the hat drops beside him, he waves, hops and dives in head first, the hat hops, flips edge-on
   and vanishes with a ting, and a white rabbit with his eyebrows is left sitting there; it twitches its nose
   and hops off the right edge. Needs ../xkit.js. Pure function of t. */
(function () {
  'use strict';
  const R = window.ClippeeRig, XK = window.XK, seg = XK.seg, E = XK.ease, H = XK.hash;
  const RX = 11.9, AMS = 3000, DMS = 2600;
  const base = st => [st.anchor.x + 48, st.anchor.y + 86];
  const fr = s => Math.floor(s * 20 + 0.5);
  const pz = (a, b, u) => u <= 0 ? R.rest(a) : u >= 1 ? R.rest(b) : R.blend(R.rest(a), R.rest(b), u);
  const HAT_H = 36;

  /* hat, upside down (opening up). (x, floor) = bottom centre; sy squashes it (1 normal, -1 flipped right way up) */
  function hatBack(l, x, fl, sy, jig) {
    const top = fl - HAT_H * sy, bx = x + jig;
    // crown (toward the floor), banded left to right
    const cols = ['#0b0b10', '#1d1d26', '#33333d', '#1d1d26', '#0b0b10'];
    cols.forEach((c, i) => { l.fillStyle = c; const w = 38 - i * 7; l.fillRect(Math.round(bx - 19 + i * 3.5 - (i === 2 ? 3 : 0)), Math.min(top, fl), Math.max(1, w - (i === 2 ? 14 : 0)), Math.abs(fl - top)); });
    l.fillStyle = '#0b0b10'; l.beginPath(); l.ellipse(bx, fl, 19, 4 * Math.abs(sy) + 0.5, 0, 0, 7); l.fill();
    // red band just under the brim
    l.fillStyle = '#a01e2c'; l.fillRect(bx - 19, Math.min(top + 4 * sy, top + 10 * sy), 38, Math.abs(6 * sy)); l.fillStyle = '#e65a58'; l.fillRect(bx - 12, Math.min(top + 4 * sy, top + 10 * sy), 6, Math.abs(6 * sy));
    // brim back half + the dark opening
    l.fillStyle = '#33333d'; l.beginPath(); l.ellipse(bx, top, 30, 7 * Math.abs(sy) + 0.5, 0, Math.PI, 2 * Math.PI); l.fill();
    if (sy > 0.3) { l.fillStyle = '#000000'; l.beginPath(); l.ellipse(bx, top, 20, 4.5 * sy, 0, 0, 7); l.fill(); }
  }
  function hatFront(l, x, fl, sy, jig) {
    const top = fl - HAT_H * sy, bx = x + jig;
    l.fillStyle = '#1d1d26'; l.beginPath(); l.ellipse(bx, top, 30, 7 * Math.abs(sy) + 0.5, 0, 0, Math.PI); l.ellipse(bx, top, 20, 4.5 * Math.abs(sy), 0, Math.PI, 0, true); l.fill();
    l.fillStyle = '#5c5e66'; l.fillRect(bx - 24, Math.round(top + 4 * Math.abs(sy)), 12, 1);
  }
  function drawHat(ctx, x, fl, sy, jig, part) {
    XK.layer(ctx, x - 40, fl - 60, 80, 70, 1, l => (part === 'front' ? hatFront : part === 'back' ? hatBack : (a, ...r) => { hatBack(a, ...r); hatFront(a, ...r); })(l, x, fl, sy, jig));
  }
  function wand(ctx, tx, ty, ang) { // tip at (tx, ty), pointing along ang (radians, toward the tip)
    XK.layer(ctx, tx - 50, ty - 50, 100, 100, 1, l => {
      const c = Math.cos(ang), s = Math.sin(ang), L = 38;
      const seg2 = (a, b, w, col) => { l.strokeStyle = col; l.lineWidth = w; l.lineCap = 'butt'; l.beginPath(); l.moveTo(tx - c * a, ty - s * a); l.lineTo(tx - c * b, ty - s * b); l.stroke(); };
      seg2(0, L, 4, '#0b0b10'); seg2(0, 7, 4, '#ffffff'); seg2(L - 7, L, 4, '#ffffff'); seg2(8, L - 8, 1, '#5c5e66');
    });
  }
  function stars(ctx, cx, cy, u, n, spread, seed, cols) { // a burst of twinkles flying out and blinking out in steps
    if (u <= 0 || u >= 1) return;
    XK.layer(ctx, cx - spread - 10, cy - spread - 10, spread * 2 + 20, spread * 2 + 20, 1, l => {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + H(i, seed, 1), d = spread * (0.3 + 0.7 * H(i, seed, 2)) * E.out3(u);
        const sz = Math.round((3 - 3 * u) * (0.6 + 0.6 * H(i, seed, 3)) + ((Math.floor(u * 12) + i) % 2));
        if (sz > 0) XK.spark(l, cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.8, Math.min(3, sz), cols[i % cols.length], 1);
      }
    });
  }
  function poof(ctx, x, y, u, tone) {
    if (u <= 0 || u >= 1) return;
    XK.layer(ctx, x - 50, y - 50, 100, 90, 2, l => { for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2, d = 6 + 20 * E.out(u), r = Math.round(14 * (1 - u) / 2) * 2; if (r > 0) XK.cloud(l, x + Math.cos(a) * d, y + Math.sin(a) * d * 0.6, r, tone, i); } });
  }
  /* the rabbit (with his eyebrows). (x, fl) = feet; hop 0 sitting, 1 stretched mid-hop; tw = nose twitch */
  function rabbit(ctx, x, fl, hop, tw, f) {
    XK.layer(ctx, x - 24, fl - 44, 48, 48, 1, l => {
      const E2 = (cx, cy, rx, ry, col) => { l.fillStyle = col; l.beginPath(); l.ellipse(cx, cy, rx, ry, 0, 0, 7); l.fill(); };
      const bw = 10 + 4 * hop, bh = 8 - 2 * hop, by = fl - bh - 1 - hop * 2, hx = x + 6 + 4 * hop, hy = by - 7 + hop * 3;
      E2(x - 9 - 2 * hop, by + 2, 3, 3, '#ffffff'); // tail
      E2(x, by, bw + 1, bh + 1, '#7e7e88'); E2(x, by, bw, bh, '#f1f1f4'); E2(x - 2, by - 2, bw - 4, bh - 4, '#ffffff');
      // ears: back when hopping
      const ea = hop ? 0.9 : 0.15;
      [[-2, 0], [2, 0.25]].forEach(([o, da]) => { l.save(); l.translate(hx + o, hy - 4); l.rotate(-ea - da); E2(0, -9, 3.6, 10, '#7e7e88'); E2(0, -9, 2.6, 9, '#ffffff'); E2(0, -8, 1.2, 6, '#f09aa8'); l.restore(); });
      E2(hx, hy, 7.5, 6.5, '#7e7e88'); E2(hx, hy, 6.6, 5.6, '#ffffff'); E2(hx - 1, hy - 1, 4.5, 3.5, '#ffffff');
      l.fillStyle = '#0b0b10'; l.fillRect(Math.round(hx + 1), Math.round(hy - 2), 2, 3); // eye
      l.fillRect(Math.round(hx - 2), Math.round(hy - 6 - (tw ? 1 : 0)), 7, 2); l.fillRect(Math.round(hx + 3), Math.round(hy - 7 - (tw ? 1 : 0)), 3, 1); // his brow
      l.fillStyle = '#f09aa8'; l.fillRect(Math.round(hx + 5 + (tw ? 1 : 0)), Math.round(hy + (tw ? -1 : 0)), 2, 2);
      if (!hop) { l.fillStyle = '#c3c3cc'; l.fillRect(x - 4, fl - 2, 6, 2); l.fillRect(x + 4, fl - 2, 5, 2); }
    });
  }

  /* ---------- appear ---------- */
  const POP = 1.2;
  const POSE = {
    tada: { reach: 1, hx: RX + 12, hy: -72, elbow: 1, curl: 0.9, browY: 2.4, browTilt: 0.3, lookY: -0.2, stretch: 0.03 },
    bow: { lean: -0.55, leanTop: -1.3, reach: 1, hx: RX + 21, hy: -18, elbow: 1, curl: 0.9, happy: 1, browY: 1.6, browTilt: 0.2 },
    wave: { reach: 1, hx: RX + 14, hy: -50, elbow: 1, curl: 0.9, lean: -0.08, leanTop: -0.16, lookX: -0.2, browY: 1.6, browTilt: 0.2 }
  };
  function appear(ctx, t, st) {
    if (t >= 1) { XK.him(ctx, st, R.REST, 0, 0); return; }
    const s = t * AMS / 1000, B = base(st), f = fr(s), x = B[0];
    // hat: drops from above the window, squash-bounces, shudders under the taps, poofs at the top of his jump
    const hatOn = s < 1.5;
    let hy = B[1], sy = 1, jig = 0;
    if (s < 0.36) hy = B[1] - (B[1] + 60) * (1 - E.in(seg(s, 0, 0.36)));
    else if (s < 0.52) { const u = seg(s, 0.36, 0.52); sy = 1 - 0.22 * Math.sin(Math.PI * u) * (u < 0.5 ? 1 : 0.4); hy = B[1] - 10 * Math.sin(Math.PI * seg(s, 0.42, 0.52)); }
    [0.78, 0.94, 1.1].forEach((c, i) => { if (s >= c && s < c + 0.1) jig = ((f % 2) ? 1 : -1) * (1 + i); });
    if (s >= POP - 0.04 && s < POP + 0.08) sy = 1.18;
    // he springs out: from inside the hat up past the window line, then lands on the spot
    let dy = 120, show = false;
    if (s >= POP) { show = true; dy = s < 1.48 ? 100 - 230 * E.out(seg(s, POP, 1.48)) : s < 1.86 ? -130 * (1 - E.in(seg(s, 1.48, 1.86))) : 0; }
    if (hatOn) drawHat(ctx, x, hy, sy, jig, 'back');
    if (show) {
      let p = s < 1.86 ? R.rest(POSE.tada) : s < 2.0 ? pz(POSE.tada, POSE.bow, E.out(seg(s, 1.86, 2.0))) : s < 2.5 ? R.rest(POSE.bow) : pz(POSE.bow, R.REST, E.inOut(seg(s, 2.5, 2.85)));
      if (s >= 1.86 && s < 1.9) p = R.rest(Object.assign({}, POSE.tada, { stretch: -0.04 }));
      XK.him(ctx, st, p, 0, dy, hatOn ? [0, 0, st.w, Math.round(hy - HAT_H * sy)] : null);
    }
    if (hatOn) drawHat(ctx, x, hy, sy, jig, 'front');
    // the wand: flies in from the top right, three taps, flies off
    if (s >= 0.5 && s < 1.32) {
      const tip = [x + 26, hy - HAT_H - 2];
      let tx, ty, ang = 2.3;
      if (s < 0.72) { const u = E.out(seg(s, 0.5, 0.72)); tx = tip[0] + 220 * (1 - u); ty = tip[1] - 260 * (1 - u) - 14; }
      else if (s < 1.16) { const k = ((s - 0.72) % 0.16) / 0.16; tx = tip[0] + 4; ty = tip[1] - 14 * Math.abs(Math.cos(Math.PI * k)); ang = 2.3 - 0.25 * Math.abs(Math.cos(Math.PI * k)); }
      else { const u = E.in(seg(s, 1.16, 1.32)); tx = tip[0] + 260 * u; ty = tip[1] - 14 - 300 * u; }
      wand(ctx, tx, ty, ang);
    }
    [0.78, 0.94, 1.1].forEach((c, i) => stars(ctx, x + 28, hy - HAT_H - 2, seg(s, c, c + 0.22), 4 + i * 2, 14 + i * 6, i, ['#ecc44a', '#fff09a']));
    stars(ctx, x, B[1] - HAT_H - 10, seg(s, POP, POP + 0.6), 16, 90, 7, ['#ecc44a', '#a4dcff', '#ffd6e0', '#fff09a']);
    poof(ctx, x, B[1] - 18, seg(s, 1.5, 1.85), 'magic');
    stars(ctx, x + 6, B[1] - 50, seg(s, 1.95, 2.55), 8, 60, 12, ['#ecc44a', '#fff09a']);
  }

  /* ---------- disappear ---------- */
  const HAT_DX = -62;
  function disappear(ctx, t, st) {
    if (t <= 0) { XK.him(ctx, st, R.REST, 0, 0); return; }
    if (t >= 1) return;
    const s = t * DMS / 1000, B = base(st), f = fr(s), hx = B[0] + HAT_DX;
    let hy = B[1], sy = 1, jig = 0;
    if (s < 0.3) hy = B[1] - (B[1] + 60) * (1 - E.in(seg(s, 0, 0.3)));
    else if (s < 0.42) sy = 1 - 0.2 * Math.sin(Math.PI * seg(s, 0.3, 0.42));
    if (s >= 1.1 && s < 1.25) jig = (f % 2) ? 2 : -2;
    let flipVisible = s < 1.42;
    if (s >= 1.25 && s < 1.42) { const u = seg(s, 1.25, 1.42); hy = B[1] - 34 * Math.sin(Math.PI * u * 0.5 + 0.0) ; sy = Math.cos(Math.PI / 2 * E.in(u)); }
    // him: look, wave, hop and dive in
    let p = null, dx = 0, dy = 0, clip = null;
    if (s < 0.65) p = s < 0.42 ? pz(R.REST, { lookX: -0.85, lookY: 0.6, browY: 1.4, browTilt: 0.2 }, E.out(seg(s, 0.26, 0.4))) : pz({ lookX: -0.85, lookY: 0.6, browY: 1.4 }, POSE.wave, E.out(seg(s, 0.42, 0.55)));
    else if (s < 0.76) p = pz(POSE.wave, { lean: 0.25, leanTop: 0.35, lookX: -0.9, lookY: 0.4, browY: -0.6, browTilt: -0.6, stretch: -0.03 }, E.out(seg(s, 0.65, 0.74)));
    else if (s < 1.12) {
      const u = seg(s, 0.76, 1.12); dx = HAT_DX * E.inOut(Math.min(1, u * 1.4)); dy = -80 * Math.sin(Math.PI * Math.min(1, u * 1.25)) + (u > 0.8 ? 110 * E.in(seg(u, 0.8, 1)) : 0);
      p = R.rest({ lean: -0.35, leanTop: -0.5, reach: 1, hx: RX - 1, hy: -84, elbow: 0.3, lookX: -0.4, lookY: 0.9, browY: 2, browTilt: 0.3, happy: 0.5 });
      if (u > 0.55) clip = [0, 0, st.w, Math.round(hy - HAT_H)];
    }
    if (flipVisible) drawHat(ctx, hx, hy, sy, jig, s >= 1.25 ? 'all' : 'back');
    if (p) XK.him(ctx, st, p, dx, dy, clip);
    if (flipVisible && s < 1.25) drawHat(ctx, hx, hy, sy, jig, 'front');
    stars(ctx, hx, B[1] - 26, seg(s, 1.4, 1.75), 8, 40, 4, ['#ecc44a', '#fff09a', '#ffd6e0']);
    poof(ctx, hx, B[1] - 12, seg(s, 1.42, 1.7), 'magic');
    // the rabbit: sits, twitches, three hops off the right edge
    if (s >= 1.5) {
      let rx = hx, ry = B[1], hop = 0;
      if (s >= 1.86) { const k = Math.floor((s - 1.86) / 0.2), u = ((s - 1.86) % 0.2) / 0.2; rx = hx + 64 * k + 64 * u; ry = B[1] - 28 * Math.sin(Math.PI * u); hop = u > 0.1 && u < 0.9 ? 1 : 0; }
      if (rx < st.w + 30) rabbit(ctx, rx, ry, hop, s < 1.86 && (f % 3 === 0), f);
    }
  }

  registerFx({
    id: 'x3', name: 'Magic hat', appearMs: AMS, disappearMs: DMS, fps: 20, appear, disappear,
    crop: st => ({ x: st.w - 400, y: st.h - 330, w: 400, h: 330 }),
    sheetCrop: st => ({ x: st.w - 456, y: st.h - 300, w: 456, h: 285 }),
    keys: { appear: [0.2, 0.42, 0.62, 0.8, 0.96, 1.12, 1.25, 1.4, 1.6, 1.9, 2.3, 3.0], disappear: [0.2, 0.36, 0.55, 0.72, 0.88, 1.0, 1.15, 1.32, 1.45, 1.75, 2.0, 2.3] },
    notes: 'A top hat drops onto his spot and bounces. A magic wand flies in and taps the brim three times, the hat shuddering harder each time, then he springs out in a burst of stars, the hat goes POOF under him, and he lands in a deep showman\'s bow. Out: the hat drops beside him, he waves, hops and dives in head first, the hat flips edge-on and vanishes with a ting, and a white rabbit with his eyebrows hops off the right edge.',
    sound: 'A thunk and boing for the hat, tink-tink-TINK for the wand, a drumroll into a TA-DAA with harp gliss. Out: a slide whistle down, a soft fwump, a ting, and three tiny boing hops.'
  });
})();
