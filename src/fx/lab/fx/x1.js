/* X1 · Superhero landing.
   In (2.6 s): a twinkle at the top of the window and a shadow growing on his spot, then he drops in feet first
   with his arm wound up, SLAMS a three-point landing (fist on the floor), the page cracks, chips fly, dust kicks
   out, a shockwave rolls across the document and the text ripples as it passes. He holds the pose far too long,
   raises his eyes at you, stands, notices the crack, and it zips shut. Out (2.0 s): looks up, crouches and
   powers up (pebbles lift, the floor cracks, he trembles), blasts off the top of the window with a sonic boom
   ring on the ground and a vapour ring in the air, the text ripples again, and a star twinkles where he left.
   Needs ../xkit.js. Pure function of t. */
(function () {
  'use strict';
  const R = window.ClippeeRig, XK = window.XK, seg = XK.seg, E = XK.ease, H = XK.hash;
  const RX = 11.9, AMS = 2600, DMS = 2000;
  const base = st => [st.anchor.x + 48, st.anchor.y + 86];   // where his feet meet the floor
  const fr = s => Math.floor(s * 20 + 0.5);                   // frame number, for flicker
  const P = {
    dive: { reach: 1, hx: RX - 1, hy: -84, elbow: 0.25, curl: 0, lookY: 0.95, lookX: -0.05, browY: -0.8, browTilt: -0.7 },
    slam: { lean: -0.66, leanTop: -1.55, reach: 1, hx: RX + 19, hy: -1, elbow: 1, curl: 0.35, lookY: 0.95, lookX: -0.4, browY: -1.3, browTilt: -0.75, stretch: -0.045 },
    hero: { lean: -0.6, leanTop: -1.45, reach: 1, hx: RX + 18, hy: -1, elbow: 1, curl: 0.35, lookY: 0.95, lookX: -0.4, browY: -1.2, browTilt: -0.7 },
    glare: { lean: -0.6, leanTop: -1.45, reach: 1, hx: RX + 18, hy: -1, elbow: 1, curl: 0.35, lookY: -0.6, lookX: 0.35, browY: -1.5, browTilt: -0.85 },
    peek: { lean: -0.06, leanTop: -0.16, reach: 0.5, hx: RX + 8, hy: -16, elbow: 1, curl: 0.2, lookY: 0.95, lookX: -0.25, browY: 2.2, browTilt: 0.35 },
    oops: { lean: 0.04, leanTop: 0.1, lookY: 0.2, lookX: -0.05, browY: 1.4, browTilt: 0.2, blink: 0 },
    up: { lookY: -1, lookX: 0.05, browY: -0.9, browTilt: -0.75 },
    crouch: { lean: -0.48, leanTop: -1.15, reach: 1, hx: RX + 17, hy: -1, elbow: 1, curl: 0.3, lookY: -0.95, lookX: 0.15, browY: -1.4, browTilt: -0.85, stretch: -0.03 },
    launch: { reach: 1, hx: RX - 1, hy: -86, elbow: 0.2, curl: 0, lookY: -1, lookX: 0, browY: -1, browTilt: -0.8 }
  };
  const pz = (a, b, u) => u <= 0 ? R.rest(a) : u >= 1 ? R.rest(b) : R.blend(R.rest(a), R.rest(b), u);

  /* ---------- effect pieces ---------- */
  function twinkle(ctx, x, y, u) { // a star that pops 0 -> big -> 0 in whole steps
    const sz = [1, 2, 3, 3, 2, 3, 2, 1, 0][Math.min(8, Math.floor(u * 9))];
    if (sz > 0) XK.layer(ctx, x - 12, y - 12, 24, 24, 1, l => XK.spark(l, x, y, sz, '#ecc44a', 1));
  }
  function shadow(ctx, B, u) {
    const rx = 3 + 18 * u, ry = Math.max(1.5, rx * 0.22);
    XK.layer(ctx, B[0] - rx - 2, B[1] - ry - 2, rx * 2 + 4, ry * 2 + 4, 2, l => { l.fillStyle = '#c4cad2'; l.beginPath(); l.ellipse(B[0], B[1], rx, ry, 0, 0, 7); l.fill(); });
  }
  function speedLines(ctx, x, top, len, f) {
    XK.layer(ctx, x - 30, top - len - 4, 60, len + 8, 2, l => {
      [-15, -7, 1, 9, 17].forEach((o, i) => {
        const L = len * (0.55 + 0.45 * H(i, f, 3)), y0 = top - 6 - L * 0.15 * H(i, f, 9);
        l.fillStyle = i % 2 ? '#c4cad2' : '#9aa1ab'; l.fillRect(x + o, y0 - L, 2, L);
      });
    });
  }
  const CRACK = (() => { // fixed zig-zag branches radiating up and sideways from the impact, [x, y] offsets
    const out = [], A = [3.25, 3.6, 3.95, 4.3, 4.71, 5.1, 5.45, 5.8, 6.15, 2.75, 0.5];
    A.forEach((a, b) => {
      const L = (b > 8 ? 26 : 55) + (b > 8 ? 10 : 70) * H(b, 2, 1), pts = [[0, 0]]; let x = 0, y = 0, d = 0, z = 1;
      while (d < L) { const st = 8 + 7 * H(b, d | 0, 3), ang = a + z * (0.35 + 0.3 * H(b, d | 0, 4)); x += Math.cos(ang) * st; y += Math.sin(ang) * st * 0.8; d += st; z = -z; pts.push([x, Math.min(y, 34)]); }
      out.push(pts);
      if (b < 9 && H(b, 7, 7) > 0.4) { const k = 2, p = pts[k], fa = a + (H(b, 8, 8) > 0.5 ? 0.8 : -0.8), q = [p]; let fx = p[0], fy = p[1];
        for (let i = 0; i < 3; i++) { fx += Math.cos(fa + (i % 2 ? 0.4 : -0.4)) * 9; fy += Math.sin(fa) * 7; q.push([fx, fy]); } out.push(q); }
    });
    return out;
  })();
  function trim(P, frac) { // first frac of a polyline by length
    let tot = 0; for (let i = 1; i < P.length; i++) tot += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
    let left = tot * frac; const o = [P[0]];
    for (let i = 1; i < P.length && left > 0; i++) { const s = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); const u = Math.min(1, left / s); o.push([P[i - 1][0] + (P[i][0] - P[i - 1][0]) * u, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * u]); left -= s; }
    return o;
  }
  function taperPoly(l, P, w0, w1, ox, oy) {
    const L = [], Rr = [];
    P.forEach((p, i) => { const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)], tx = b[0] - a[0], ty = b[1] - a[1], n = Math.hypot(tx, ty) || 1, w = (w0 + (w1 - w0) * i / Math.max(1, P.length - 1)) / 2;
      L.push([p[0] - ty / n * w + ox, p[1] + tx / n * w + oy]); Rr.push([p[0] + ty / n * w + ox, p[1] - tx / n * w + oy]); });
    l.beginPath(); L.forEach((q, i) => i ? l.lineTo(q[0], q[1]) : l.moveTo(q[0], q[1])); for (let i = Rr.length - 1; i >= 0; i--) l.lineTo(Rr[i][0], Rr[i][1]); l.closePath(); l.fill();
  }
  function crack(ctx, B, g, scale) { // g: 0..1 drawn length of every branch
    if (g <= 0) return; scale = scale || 1;
    XK.layer(ctx, B[0] - 190, B[1] - 150, 380, 196, 2, l => {
      const br = CRACK.map(c => trim(c, g).map(p => [B[0] + p[0] * scale, B[1] + p[1] * scale])).filter(P => P.length > 1);
      const cw = 9 * scale;
      l.fillStyle = '#ffffff'; br.forEach(P => taperPoly(l, P, cw, 2, 2, 3));
      l.fillStyle = '#6a717b'; br.forEach(P => taperPoly(l, P, cw, 2, 0, 0));
      l.fillStyle = '#1d1d26'; br.forEach(P => taperPoly(l, P, cw * 0.5, 0.5, 0, 0));
      const cr = Math.min(1, g * 1.6);
      l.fillStyle = '#ffffff'; l.beginPath(); l.ellipse(B[0] + 2, B[1] + 2, 26 * scale * cr, 7 * scale, 0, 0, 7); l.fill();
      l.fillStyle = '#6a717b'; l.beginPath(); l.ellipse(B[0], B[1], 26 * scale * cr, 7 * scale, 0, 0, 7); l.fill();
      l.fillStyle = '#1d1d26'; l.beginPath(); l.ellipse(B[0], B[1] + 1, 19 * scale * cr, 4.5 * scale, 0, 0, 7); l.fill();
    });
  }
  function burst(ctx, B, k) { // comic impact star behind him, two frames only
    const cx = B[0] + 4, cy = B[1] - 26, n = 14, r0 = k ? 58 : 40, r1 = k ? 34 : 20;
    XK.layer(ctx, cx - 64, cy - 64, 128, 128, 2, l => {
      const star = (ro, ri) => { l.beginPath(); for (let i = 0; i < n * 2; i++) { const a = Math.PI * i / n + 0.1, r = (i % 2 ? ri : ro) * (0.85 + 0.3 * H(i, 5, k)); i ? l.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.9) : l.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.9); } l.closePath(); };
      star(r0, r1); l.fillStyle = '#ffa424'; l.fill(); star(r0 - 5, r1 - 4); l.fillStyle = k ? '#ffffff' : '#fff4b0'; l.fill();
      if (!k) { star(r0 * 0.55, r1 * 0.5); l.fillStyle = '#ffd84a'; l.fill(); }
    });
  }
  function dust(ctx, B, u, n, spread, seed) { // puffs that roll outward along the floor and shrink in steps
    if (u <= 0 || u >= 1) return;
    XK.layer(ctx, B[0] - spread - 40, B[1] - 60, spread * 2 + 80, 80, 2, l => {
      for (let i = 0; i < n; i++) {
        const side = i % 2 ? 1 : -1, d = (14 + spread * (0.45 + 0.55 * H(i, seed, 1))) * E.out3(u), r0 = 11 + 9 * H(i, seed, 2);
        const r = Math.round(r0 * Math.max(0, 1 - u * (1 + 0.4 * H(i, seed, 3))) / 3) * 3;
        XK.cloud(l, B[0] + side * d, B[1] - 4 - 14 * u * H(i, seed, 4) - r * 0.4, r, 'dust', i + seed);
      }
    });
  }
  function chips(ctx, B, tau, n, seed, vmax) { // page fragments thrown out by the impact, falling off the bottom
    if (tau <= 0) return;
    for (let i = 0; i < n; i++) {
      const vx = (H(i, seed, 1) - 0.5) * 520, vy = -(220 + vmax * H(i, seed, 2)), g = 2600;
      const x = B[0] + vx * tau, y = B[1] - 6 + vy * tau + 0.5 * g * tau * tau;
      if (y > 905 || y < -10) continue;
      const s = 2 + Math.floor(H(i, seed, 3) * 3) * 2, flip = (Math.floor(tau * 20) + i) % 2;
      ctx.fillStyle = '#6a717b'; ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, flip ? s + 2 : s, flip ? s : s + 2);
      ctx.fillStyle = i % 3 ? '#ffffff' : '#e3e7ec'; ctx.fillRect(Math.round(x), Math.round(y), flip ? s : s - 2 + 2, flip ? s - 2 : s);
    }
  }
  function ring(ctx, cx, cy, rx, ry, u, w, k) { // a white band with grey edges; solid at first, then it breaks into dashes
    if (u <= 0 || u >= 1) return;
    XK.layer(ctx, cx - rx - w - 6, cy - ry - w - 6, rx * 2 + w * 2 + 12, ry * 2 + w * 2 + 12, k, l => {
      const b = XK.seg(u, 0.3, 1); l.setLineDash(b > 0 ? [Math.max(3, 40 * (1 - b)), 4 + 34 * b] : []);
      const e = () => { l.beginPath(); l.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI); l.stroke(); };
      l.lineWidth = w + 2 * k; l.strokeStyle = '#86888f'; e(); l.lineWidth = w; l.strokeStyle = '#ffffff'; e();
      l.lineWidth = Math.max(1, w * 0.34); l.strokeStyle = '#a4dcff'; e();
    });
  }
  function pebbles(ctx, B, u, lift, f) { // power-up: grit rises off the floor and trembles
    for (let i = 0; i < 9; i++) {
      const x = B[0] + (H(i, 4, 1) - 0.5) * 120, y = B[1] - 2 - lift * (6 + 26 * H(i, 4, 2)) * E.out(u) + ((f + i) % 2);
      const s = 2 + 2 * Math.floor(H(i, 4, 3) * 2);
      ctx.fillStyle = '#6a717b'; ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, s + 2, s + 2); ctx.fillStyle = '#c4cad2'; ctx.fillRect(Math.round(x), Math.round(y), s, s);
    }
  }

  /* ---------- appear ---------- */
  const IMP = 0.7, FALL0 = 0.24;
  function appear(ctx, t, st) {
    if (t >= 1) { XK.him(ctx, st, R.REST, 0, 0); return; }
    const s = t * AMS / 1000, B = base(st), f = fr(s);
    if (s < 0.34) twinkle(ctx, B[0] - 2, 30, s / 0.34);
    if (s >= 0.16 && s < IMP) shadow(ctx, B, seg(s, 0.16, IMP));
    if (s < FALL0) return;
    if (s < IMP) {
      const u = seg(s, FALL0, IMP), dy = -(st.anchor.y + 120) * (1 - u * u);
      speedLines(ctx, B[0] - 2, st.anchor.y + dy + 6, 40 + 260 * u, f);
      XK.him(ctx, st, P.dive, 0, dy);
      return;
    }
    const tau = s - IMP;
    const ru = seg(tau, 0, 0.62);
    ring(ctx, B[0], B[1], 30 + 1150 * E.out(ru), 30 + 1150 * E.out(ru), ru, 6, 3);
    const zip = seg(s, 1.78, 2.02);
    crack(ctx, B, tau < 0.05 ? 0.55 : 1 - zip);
    dust(ctx, B, seg(tau, 0, 0.62), 8, 110, 3);
    if (tau < 0.1) burst(ctx, B, tau < 0.05 ? 0 : 1);
    let p;
    if (tau < 0.05) p = R.rest(P.slam);
    else if (s < 1.0) p = pz(P.slam, P.hero, seg(tau, 0.05, 0.15));
    else if (s < 1.6) p = pz(P.hero, P.glare, E.inOut(seg(s, 1.0, 1.18)));
    else if (s < 1.8) p = pz(P.glare, P.peek, E.out(seg(s, 1.6, 1.78)));
    else if (s < 2.06) { p = R.rest(P.peek); p.lookX = -0.25 + 0.2 * Math.sin(seg(s, 1.8, 2.06) * 6); p.browY = 2.2 + (f % 2) * 0.3; }
    else if (s < 2.3) p = pz(P.peek, P.oops, E.out(seg(s, 2.06, 2.3)));
    else p = pz(P.oops, R.REST, E.inOut(seg(s, 2.3, 2.55)));
    XK.him(ctx, st, p, 0, 0);
    chips(ctx, B, tau, 16, 7, 520);
  }

  /* ---------- disappear ---------- */
  const LAUNCH = 0.56;
  function disappear(ctx, t, st) {
    if (t <= 0) { XK.him(ctx, st, R.REST, 0, 0); return; }
    if (t >= 1) return;
    const s = t * DMS / 1000, B = base(st), f = fr(s);
    if (s < LAUNCH) {
      const cu = seg(s, 0.2, 0.42);
      crack(ctx, B, seg(s, 0.36, 0.5) * 0.5, 0.7);
      if (s > 0.28) pebbles(ctx, B, seg(s, 0.28, 0.5), 1, f);
      let p = s < 0.2 ? pz(R.REST, P.up, E.out(seg(s, 0, 0.16))) : pz(P.up, P.crouch, E.inOut(cu));
      const shake = s > 0.36 ? ((f % 2) ? 1 : -1) : 0;
      XK.him(ctx, st, p, shake, 0);
      return;
    }
    const tau = s - LAUNCH;
    ring(ctx, B[0], B[1] - 2, 20 + 300 * E.out(seg(tau, 0, 0.6)), (20 + 300 * E.out(seg(tau, 0, 0.6))) * 0.26, seg(tau, 0, 0.6), 6, 2);
    const vy = B[1] - 300;
    if (tau > 0.07) { const u = seg(tau, 0.07, 0.55); ring(ctx, B[0] - 2, vy, 26 + 170 * E.out(u), (26 + 170 * E.out(u)) * 0.32, u, 5, 2); }
    crack(ctx, B, 0.5 * (1 - seg(tau, 0.3, 0.52)), 0.7);
    dust(ctx, B, seg(tau, 0, 0.7), 10, 170, 11);
    const dy = -(st.anchor.y + 140) * Math.pow(seg(tau, 0, 0.16), 1.4), feet = B[1] + dy - 2;
    // vapour trail: puffs left at each height as he passes, popping away bottom-first
    XK.layer(ctx, B[0] - 40, 0, 80, B[1] + 10, 2, l => {
      for (let i = 0; i < 16; i++) {
        const y = B[1] - 18 - i * 24, passed = Math.pow((B[1] - y) / (st.anchor.y + 140), 1 / 1.4) * 0.16;
        if (tau < passed) continue;
        const age = seg(tau - passed, 0, 0.42 + i * 0.012), r = Math.round((13 - i * 0.35) * (1 - age) / 3) * 3;
        if (r > 0) XK.cloud(l, B[0] - 2 + (H(i, 3, 3) - 0.5) * 10, y, r, 'light', i);
      }
      if (tau < 0.16) [-10, -3, 4, 11].forEach((o, i) => { l.fillStyle = i % 2 ? '#9aa1ab' : '#6a717b'; l.fillRect(B[0] + o - 2, feet, 2, 90 + 70 * H(i, f, 1)); });
    });
    if (tau < 0.16) XK.him(ctx, st, P.launch, 0, dy);
    chips(ctx, B, tau, 12, 19, 640);
    if (s > 1.42 && s < 1.86) twinkle(ctx, B[0] - 2, 26, seg(s, 1.42, 1.86));
  }

  /* ---------- the document under him ---------- */
  function page(phase, t, st) {
    const B = base(st), s = t * (phase === 'appear' ? AMS : DMS) / 1000, tau = s - (phase === 'appear' ? IMP : LAUNCH);
    if (tau < 0 || tau > 0.7) return null;
    const ru = seg(tau, 0, 0.62), r = 30 + 1150 * E.out(ru), amp = (phase === 'appear' ? 9 : 7) * (1 - ru), f = fr(s);
    const sa = tau < 0.4 ? (phase === 'appear' ? 6 : 5) * Math.pow(1 - tau / 0.4, 2) : 0;
    return {
      shake: [Math.round(sa * (f % 2 ? 1 : -1)), Math.round(sa * 0.6 * ((f >> 1) % 2 ? 1 : -1))],
      warp: (x, y) => {
        const dx = x - B[0], dy = y - B[1], d = Math.hypot(dx, dy) || 1, band = Math.exp(-Math.pow((d - r) / 34, 2));
        return [dx / d * amp * band, dy / d * amp * band - amp * 0.7 * band];
      }
    };
  }

  registerFx({
    id: 'x1', name: 'Superhero landing', appearMs: AMS, disappearMs: DMS, fps: 20, appear, disappear, page,
    crop: st => ({ x: st.w - 560, y: st.h - 350, w: 560, h: 350 }), sheetCrop: st => ({ x: st.w - 456, y: st.h - 330, w: 456, h: 285 }),
    keys: { appear: [0.1, 0.3, 0.5, 0.62, 0.7, 0.75, 0.85, 1.1, 1.65, 1.9, 2.2, 2.6], disappear: [0, 0.15, 0.35, 0.5, 0.56, 0.6, 0.66, 0.75, 0.9, 1.1, 1.6, 2.0] },
    notes: 'A twinkle up top and a growing shadow, then he drops in arm-first and slams a three-point landing: the page cracks, chips fly, a shockwave ripples the text. He holds the pose too long, glares up at you, stands, spots the crack, and it zips shut. Out: crouch, power-up tremble, he blasts off the top with a sonic boom ring, and a star twinkles where he left.',
    sound: 'Rising whistle, KRAK-THOOM with glass tinkle, a dramatic orchestra sting on the glare, a zipper for the crack. Out: low hum building, KA-BOOM, a fading jet roar, a tiny "ting".'
  });
})();
