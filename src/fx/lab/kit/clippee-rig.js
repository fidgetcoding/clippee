/* ============================================================================
   kit/clippee-rig.js · the final Clippee rig (char-r7 n1), shared by every animation builder.
   Classic script, no modules. Drawing code is extracted unchanged from char-r7/d/n/n1.

   drawClippee(ctx, pose)   draws one frame in 124 x 93 frame units (scale ctx for bigger views).
                            Wrap it in kit/retro.js: retroRender(drawClippee, pose, 'prerender').
   REST                     the rest pose for the pack: transparent background (paper: 0).
   rest(o)                  REST with some fields changed (returns a full pose).
   pose(o), blend(a, b, t)  fill a pose with defaults; blend two poses (numbers lerp).
   POSES                    the round 7 key poses (lab versions, paper on); borrow parts from them.
   drawNotebook(ctx)        N8's notebook sheet alone, for lab scenery under the sprite.
   hold(keys), springLoop(target, durSeconds)   the F4 per-part spring engine.
   registerAnim(name, def)  every anim/<Name>.js calls this once:
                              registerAnim('Show', { frame(i, info) { return pose or null } })
                            frame(i) returns the pose for ORIGINAL frame i, or null for a blank frame.
                            info = { n, index, startMs, durMs, totalMs } (timing of frame i).
   Pose fields (POSE0 below): lean, leanTop, tilt, stretch, scale (keep 1), dx, dy (keep 0),
     lookX, lookY, pupil, eyeS, blink, happy, browY, browTilt, browL, browR, headTilt,
     reach, hx, hy, elbow, curl, pAng, pencil, paper, front, check, dots, dotsA, ink, inkA,
     draw (0..1 wire bent into shape so far), face (0 hides eyes and brows), pad (hand notepad 0..1),
     padInk (0..4 rows written on it), frontY (lowers the held sheet by px so the pupils show).
   keyed(keys, {lag}) -> frame(i)   keys [frameIndex, overrides on REST, ease?]; blends by frame index.
   aimPencil(pose, [x, y])          moves the hand so the pencil tip lands on a frame point.
   padPoint(pose, row, u)           a frame point on the notepad's ink row (0..3) at fraction u.
   Custom wire (idles that reshape him): wire / wireFront = [[ [x,y], ... ], ...] clip-local control-point lists
     (wireFront draws after the eyes), eyes = [[x,y],[x,y]] clip-local, brows 0..1; restWire(pose) gives the normal
     body + arm as clip-local lists to morph from. These fields are not blended by blend()/keyed(): set them per frame.
   Rules: never change scale/dx/dy (no resizing, stays in place); start and end on REST.
   ============================================================================ */
/* ================= Clippee rig core =================
   Units are sprite pixels. The frame is 124 x 93. The clip is built in a local
   space (origin = bottom of the clip, up is negative y), as a spline through
   control points. Pose parameters move those control points (bend, stretch,
   head tilt, arm reach), then the spline is drawn as a shaded tube.          */
const PI = Math.PI;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const mix = (a, b, t) => a + (b - a) * t;
const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const LIGHT = [-0.56, -0.83]; // upper-left key light

/* ---------- pose ---------- */
const POSE0 = {
  lean: 0, leanTop: null, tilt: 0, stretch: 0, scale: 1, dx: 0, dy: 0,
  lookX: 0, lookY: 0, pupil: 1, eyeS: 1, blink: 0, happy: 0,
  browY: 0, browTilt: 0, browL: 0, browR: 0, headTilt: 0,
  reach: 0, hx: 24, hy: -46, elbow: 1, curl: 0, pAng: 2.35,
  pencil: 0, paper: 1, front: 0, check: 0, dots: 0, dotsA: 1, ink: 0, inkA: 1,
  draw: 1, face: 1, pad: 0, padInk: 0, frontY: 0   // animation parts: wire drawn so far, eyes+brows shown, hand notepad, its ink rows, held sheet lowered by px
};
function pose(o) {
  const p = Object.assign({}, POSE0, o || {});
  if (p.leanTop == null) p.leanTop = p.lean;
  return p;
}
function blend(a, b, t) {
  a = pose(a); b = pose(b); const o = {};
  for (const k in POSE0) {
    const va = a[k], vb = b[k];
    o[k] = (typeof va === 'number' && typeof vb === 'number') ? va + (vb - va) * t : (t < .5 ? va : vb);
  }
  if (a.inkPts || b.inkPts) o.inkPts = t < .5 ? a.inkPts : b.inkPts;
  return o;
}
const bump = (t, a, b) => (t <= a || t >= b) ? 0 : Math.sin(PI * (t - a) / (b - a)); // 0..1..0 window

/* ---------- curves ---------- */
function cr(P, n) { // centripetal Catmull-Rom through every control point
  if (P.length < 3) return P.map(p => p.slice());
  const L = P.length, ext = [[2 * P[0][0] - P[1][0], 2 * P[0][1] - P[1][1]], ...P, [2 * P[L - 1][0] - P[L - 2][0], 2 * P[L - 1][1] - P[L - 2][1]]];
  const d = (a, b) => Math.max(1e-3, Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5));
  const out = [];
  for (let i = 1; i < ext.length - 2; i++) {
    const p0 = ext[i - 1], p1 = ext[i], p2 = ext[i + 1], p3 = ext[i + 2];
    const t0 = 0, t1 = d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
    const Lr = (a, b, ta, tb, t) => { const u = (t - ta) / (tb - ta); return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]; };
    for (let j = 0; j < n; j++) {
      const t = t1 + (t2 - t1) * j / n;
      const A1 = Lr(p0, p1, t0, t1, t), A2 = Lr(p1, p2, t1, t2, t), A3 = Lr(p2, p3, t2, t3, t);
      const B1 = Lr(A1, A2, t0, t2, t), B2 = Lr(A2, A3, t1, t3, t);
      out.push(Lr(B1, B2, t1, t2, t));
    }
  }
  out.push(P[L - 1].slice());
  return out;
}
function resample(P, N) {
  const Ls = [0]; for (let i = 1; i < P.length; i++) Ls.push(Ls[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const tot = Ls[Ls.length - 1] || 1, out = []; let j = 0;
  for (let k = 0; k < N; k++) {
    const s = tot * k / (N - 1);
    while (j < Ls.length - 2 && Ls[j + 1] < s) j++;
    const u = (s - Ls[j]) / ((Ls[j + 1] - Ls[j]) || 1);
    out.push(lerp2(P[j], P[j + 1], clamp(u, 0, 1)));
  }
  return out;
}
function cubic(a, b, c, d, n) { const o = []; for (let i = 0; i <= n; i++) { const t = i / n, m = 1 - t; o.push([m * m * m * a[0] + 3 * m * m * t * b[0] + 3 * m * t * t * c[0] + t * t * t * d[0], m * m * m * a[1] + 3 * m * m * t * b[1] + 3 * m * t * t * c[1] + t * t * t * d[1]]); } return o; }
function normals(P) {
  return P.map((p, i) => {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
    const tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1;
    return [-ty / l, tx / l];
  });
}
/* shift each point toward (or away from) the light along its normal: tube highlights */
function lit(P, amt, L) {
  L = L || LIGHT; const N = normals(P);
  return P.map((p, i) => { const n = N[i], d = n[0] * L[0] + n[1] * L[1], a = typeof amt === 'number' ? amt : amt[i]; return [p[0] + n[0] * d * a, p[1] + n[1] * d * a]; });
}
/* widths may be one number or one per point (a wire that thins where it stretches) */
const W = (w, k) => typeof w === 'number' ? w * k : w.map(v => v * k);
function poly(ctx, P) { ctx.beginPath(); ctx.moveTo(P[0][0], P[0][1]); for (let i = 1; i < P.length; i++) ctx.lineTo(P[i][0], P[i][1]); }
/* stroke with butt caps, then add round caps only where asked (keeps body/arm joins seamless) */
function line(ctx, P, w, col, capA, capB) {
  if (P.length < 2) return;
  if (typeof w !== 'number') { // per-point width: segment by segment, round joints, ends as asked
    ctx.strokeStyle = col; ctx.lineJoin = 'round';
    for (let i = 0; i < P.length - 1; i++) {
      ctx.lineCap = (i === 0 && !capA) || (i === P.length - 2 && !capB) ? 'butt' : 'round';
      ctx.lineWidth = (w[i] + w[i + 1]) / 2; ctx.beginPath(); ctx.moveTo(P[i][0], P[i][1]); ctx.lineTo(P[i + 1][0], P[i + 1][1]); ctx.stroke();
    }
    return;
  }
  if (w <= 0) return;
  ctx.lineJoin = 'round'; ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'butt';
  poly(ctx, P); ctx.stroke();
  ctx.lineCap = 'round';
  if (capA) { poly(ctx, [P[0], P[1]]); ctx.stroke(); }
  if (capB) { poly(ctx, [P[P.length - 2], P[P.length - 1]]); ctx.stroke(); }
}
/* filled stroke whose width runs w0 -> w1 (brows, ink, tapered tips) */
function taper(ctx, P, w0, w1, col, wf) {
  const N = normals(P), Lft = [], Rgt = [];
  P.forEach((p, i) => { const u = i / (P.length - 1), w = (wf ? wf(u) : mix(w0, w1, u)) / 2; Lft.push([p[0] + N[i][0] * w, p[1] + N[i][1] * w]); Rgt.push([p[0] - N[i][0] * w, p[1] - N[i][1] * w]); });
  ctx.beginPath(); ctx.moveTo(Lft[0][0], Lft[0][1]);
  for (const q of Lft) ctx.lineTo(q[0], q[1]);
  for (let i = Rgt.length - 1; i >= 0; i--) ctx.lineTo(Rgt[i][0], Rgt[i][1]);
  ctx.closePath(); ctx.fillStyle = col; ctx.fill();
}
function arcPts(cx, cy, r, a0, a1, n) { const o = []; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; o.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return o; }

/* ---------- the clip, neutral ----------
   S = { H, Rt, topX, headR, headWrap, neck, neckLen, Ri, innerX, gap, innerWrap, innerPinch,
         end1Y, bR, bx, ballX, rootA, dipSoft, dipDrop, armY, shY, armIn, neckY, eyeY } */
function clipControlPoints(S) { return clipR3(S); }
/* where the free outer end (the arm) leaves the bottom of the clip, and the direction it leaves in */
function armRoot(S) { const a = -(S.rootA || 0); return [S.ballX + S.bx + S.bR * Math.cos(a), -S.bR + S.bR * Math.sin(a)]; }
function armRootDir(S) { const r = S.rootA || 0; return [-Math.sin(r), -Math.cos(r)]; }
/* The two long wires run as a shaft; the head loop is a rounded
   head that overhangs a narrower neck (the rim); the big bottom bend becomes two round lobes side by
   side, with the wire dipping up between them. bx/bR sets how separate the lobes are. */
function clipR3(S) {
  const P = [], push = a => a.forEach(q => P.push(q));
  const hx = S.topX, Rt = S.Rt, hR = S.headR, hCy = -S.H + hR, hw = S.headWrap, nk = S.neck;
  const neckY = hCy + hR * Math.sin(hw) + S.neckLen;
  const iCx = S.innerX, Ri = S.Ri, iCy = -S.gap - Ri, iw = S.innerWrap, ip = S.innerPinch;
  const iLx = iCx - Ri + ip, iRx = iCx + Ri - ip, iTop = iCy - Ri * Math.sin(iw);
  // inner free end, down into the small inner turn
  P.push([iLx, S.end1Y]); if (iTop - 2.2 > S.end1Y + 2) P.push([iLx, iTop - 2.2]);
  push(arcPts(iCx, iCy, Ri, PI + iw, -iw, 9));
  // up the right side of the shaft, into the neck, round the head
  P.push([iRx, iTop - 2.2]); P.push([mix(iRx, hx + Rt, .5), mix(iTop, neckY, .45)]);
  P.push([hx + Rt, neckY + 4.5]); P.push([hx + Rt - nk, neckY]);
  push(arcPts(hx, hCy, hR, hw, -PI - hw, 12));
  P.push([hx - Rt + nk, neckY]); P.push([hx - Rt, neckY + 4.5]);
  // down the left side of the shaft, round the left lobe, up into the dip, round the right lobe
  const bR = S.bR, Lc = [S.ballX - S.bx, -bR], Rc = [S.ballX + S.bx, -bR];
  const th = Math.acos(clamp(S.bx / bR, -1, 1)), soft = S.dipSoft || 0.16;
  const aIn = 2 * PI - Math.acos(clamp((hx - Rt - Lc[0]) / bR, -1, 1));
  const entry = [Lc[0] + bR * Math.cos(aIn), Lc[1] + bR * Math.sin(aIn)];
  P.push([hx - Rt, mix(neckY + 4.5, entry[1], .5)]); P.push([mix(hx - Rt, entry[0], .5), entry[1] - 2.2]);
  push(arcPts(Lc[0], Lc[1], bR, aIn, -th + soft, 12));
  P.push([S.ballX, -bR - bR * Math.sin(th) + (S.dipDrop || 0.5)]);
  push(arcPts(Rc[0], Rc[1], bR, PI + th - soft, -(S.rootA || 0), 12));
  return P;
}
/* the free outer end is the arm. reach moves the hand from its rest tip to (hx,hy);
   the wire bows to keep its length, or stretches thin when pulled past it. */
function armControl(S, p) {
  const ai = S.armIn || 0, A0 = armRoot(S), Sh = [A0[0] - ai * 0.55, S.shY], rest = [A0[0] - ai, S.armY];
  const r = clamp(p.reach, 0, 1);
  const H = lerp2(rest, [p.hx, p.hy], r);
  const c = [H[0] - Sh[0], H[1] - Sh[1]], d = Math.hypot(c[0], c[1]) || 1, ch = [c[0] / d, c[1] / d];
  const L0 = Math.abs(S.armY - S.shY) * (S.armSlack || 1.12);
  const s = d < L0 ? Math.sqrt(3 * d * (L0 - d) / 8) : 0;
  const pr = [-ch[1] * p.elbow, ch[0] * p.elbow];
  const k1 = d * 0.42, k2 = d * 0.3;
  const rd = armRootDir(S), A1 = [A0[0] + rd[0] * 2.4, A0[1] + rd[1] * 2.4];
  const P = [A0, A1, lerp2(A1, Sh, .5)];
  const seg = cubic(Sh, [Sh[0] + pr[0] * s * 0.9, Sh[1] - k1 + pr[1] * s * 0.9], [H[0] - ch[0] * k2 + pr[0] * s * 1.2, H[1] - ch[1] * k2 + pr[1] * s * 1.2], H, 10);
  seg.forEach(q => P.push(q));
  // tip curl: a small hook continuing the end tangent
  const cu = p.curl * r;
  let tipC = null;
  if (Math.abs(cu) > 0.02) {
    const a = P[P.length - 2], b = P[P.length - 1];
    let tx = b[0] - a[0], ty = b[1] - a[1]; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    const sg = cu > 0 ? 1 : -1, rc = S.curlR || 2;
    const nx = -ty * sg, ny = tx * sg; // turn side
    const cx = b[0] + nx * rc, cy = b[1] + ny * rc;
    const a0 = Math.atan2(b[1] - cy, b[0] - cx), sweep = Math.abs(cu) * 1.5 * PI * sg;
    for (let i = 1; i <= 8; i++) { const an = a0 + sweep * i / 8; P.push([cx + rc * Math.cos(an), cy + rc * Math.sin(an)]); }
    tipC = [cx, cy];
  }
  return { P, hand: H, curlC: tipC || H, stretch: d > L0 ? d / L0 : 1 };
}
/* congratulate: the arm itself becomes a check mark beside him */
function armCheck(S) {
  const A0 = armRoot(S), x = A0[0];
  return cr([A0, [x + 0.2, -18], [x + 1.6, -24.5], [x + 3.6, -21], [x + 7.2, -14.5], [x + 12, -27], [x + 17, -40], [x + 21, -51]], 5);
}

/* bend deformer: the spine bends with curvature that blends from lean (base) to leanTop (top);
   stretch keeps volume; head tilt twists everything above the neck. */
function makeDeform(S, p) {
  const s = 1 + p.stretch, sx = 1 / Math.sqrt(s), K = S.bendK || 0.85, Hs = S.H * s;
  const step = 0.5, n = Math.ceil(S.H * 1.9 / step) + 2, tab = [];
  let th = 0, x = 0, y = 0;
  for (let i = 0; i < n; i++) {
    tab.push([x, y, th]);
    const u = clamp(i * step / Hs, 0, 1.2);
    const k = K / Hs * mix(p.lean, p.leanTop, Math.min(u, 1)) * (S.bendShape ? S.bendShape(u) : 1);
    th += k * step; x += Math.sin(th) * step; y -= Math.cos(th) * step;
  }
  const at = h => { const f = clamp(h / step, 0, n - 1.001), i = Math.floor(f), u = f - i, A = tab[i], B = tab[i + 1]; return [mix(A[0], B[0], u), mix(A[1], B[1], u), mix(A[2], B[2], u)]; };
  const tl = p.tilt + (S.tilt0 || 0), ct = Math.cos(tl), st = Math.sin(tl), sc = p.scale, ax = S.anchor[0] + p.dx, ay = S.anchor[1] + p.dy;
  const pivot = [S.headX || 0, S.eyeY];
  const head = q => {
    if (!p.headTilt) return q;
    const w = smooth((S.neckY - q[1]) / 9);
    if (w <= 0) return q;
    const a = p.headTilt * w, c = Math.cos(a), si = Math.sin(a), X = q[0] - pivot[0], Y = q[1] - pivot[1];
    return [pivot[0] + X * c - Y * si, pivot[1] + X * si + Y * c];
  };
  const map = q0 => {
    const q = head(q0), h = -q[1] * s, lat = q[0] * sx, A = at(h);
    const X = A[0] + Math.cos(A[2]) * lat, Y = A[1] + Math.sin(A[2]) * lat;
    return [ax + sc * (X * ct - Y * st), ay + sc * (X * st + Y * ct)];
  };
  map.angle = y0 => at(-y0 * s)[2] + tl;
  map.s = s; map.sx = sx;
  return map;
}

/* ---------- full rig: everything drawClippee needs, in frame space ---------- */
function rig(S, p) {
  const D = makeDeform(S, p);
  const bodyC = clipControlPoints(S).map(D);
  const body = cr(bodyC, S.seg || 5);
  const am = armControl(S, p);
  let armL = am.P;
  if (p.check > 0.001) { const A = resample(armL, 30), B = resample(armCheck(S), 30); armL = A.map((q, i) => lerp2(q, B[i], smooth(p.check))); }
  const armPts = cr(armL.map(D), 3);
  // prepend the body's last samples so the arm starts inside the body tube (seamless join)
  const arm = [body[body.length - 3], body[body.length - 2]].concat(armPts.slice(1));
  const eyeA = D.angle(S.eyeY) + p.headTilt;
  const eye = (e, side) => {
    const c = D([e[0], e[1]]);
    return { x: c[0], y: c[1], rx: S.eye.rx * p.scale * p.eyeS * (1 - p.stretch * 0.25), ry: S.eye.ry * p.scale * p.eyeS * (1 + p.stretch * 0.45), a: eyeA + (S.eye.tilt || 0) * side, side };
  };
  const hand = D(am.hand), grip = D(am.curlC);
  const pa = p.pAng, pd = [Math.cos(pa), Math.sin(pa)];
  const pen = S.pencil || { len: 12, back: 4.2, w: 2.3 };
  const pencil = { grip, dir: pd, back: [grip[0] - pd[0] * pen.back, grip[1] - pd[1] * pen.back], tip: [grip[0] + pd[0] * (pen.len - pen.back), grip[1] + pd[1] * (pen.len - pen.back)], w: pen.w };
  const w = S.wire * p.scale, aw = w * clamp(1 / Math.sqrt(am.stretch), 0.72, 1);
  // stretched arm: the wire thins over its first third, so it still meets the body at full width
  const armW = aw > w - 0.01 ? w : arm.map((q, i) => i < 2 ? w : mix(w, aw, smooth((i - 2) / ((arm.length - 3) * 0.35))));
  return { D, body, arm, armW, w, eyes: [eye(S.eyeL, -1), eye(S.eyeR, 1)], hand, grip, pencil, base: D([0, 0]) };
}
/* where the pencil tip is for a pose, without drawing (used to lay down the writing trail) */
function pencilTip(S, p) { return rig(S, pose(p)).pencil.tip; }

/* ---------- shared props ---------- */
function drawPencil(ctx, pc, a) {
  if (a <= 0) return;
  ctx.save(); ctx.globalAlpha = a;
  const d = pc.dir, n = [-d[1], d[0]], w = pc.w / 2, b = pc.back, t = pc.tip;
  const L = Math.hypot(t[0] - b[0], t[1] - b[1]), cone = 3.2;
  const at = (s, o) => [b[0] + d[0] * s + n[0] * o, b[1] + d[1] * s + n[1] * o];
  // eraser + ferrule
  ctx.fillStyle = '#d98f8a'; ctx.beginPath(); [at(-1.6, -w), at(0, -w), at(0, w), at(-1.6, w)].forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.fill();
  ctx.fillStyle = '#b9bcc6'; ctx.beginPath(); [at(0, -w), at(1.4, -w), at(1.4, w), at(0, w)].forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.fill();
  // body
  ctx.fillStyle = '#e9b93c'; ctx.beginPath(); [at(1.4, -w), at(L - cone, -w), at(L - cone, w), at(1.4, w)].forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.fill();
  ctx.fillStyle = '#c99520'; ctx.beginPath(); [at(1.4, w * 0.15), at(L - cone, w * 0.15), at(L - cone, w), at(1.4, w)].forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.fill();
  ctx.lineWidth = 0.45; ctx.strokeStyle = '#6b5418'; ctx.lineJoin = 'round';
  ctx.beginPath(); [at(-1.6, -w), at(L - cone, -w), at(L, 0), at(L - cone, w), at(-1.6, w)].forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.closePath(); ctx.stroke();
  // wood cone + graphite
  ctx.fillStyle = '#efd3a6'; ctx.beginPath(); [at(L - cone, -w), at(L, 0), at(L - cone, w)].forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.fill();
  ctx.fillStyle = '#3c3f48'; ctx.beginPath(); [at(L - 1.1, -w * 0.35), at(L, 0), at(L - 1.1, w * 0.35)].forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.fill();
  ctx.restore();
}
function drawInk(ctx, P, a, col) {
  if (!P || P.length < 2 || a <= 0) return;
  ctx.save(); ctx.globalAlpha = a; line(ctx, P, 0.85, col || '#5b6070', true, true); ctx.restore();
}
function drawDots(ctx, base, n, col, rim, rs) {
  // up to three thought beads rising above-right of the head; fractional n fades the newest
  rs = rs || [1.25, 1.7, 2.3];
  for (let i = 0; i < 3; i++) {
    const a = clamp(n - i, 0, 1); if (a <= 0) continue;
    const q = base[i];
    ctx.save(); ctx.globalAlpha = a;
    ctx.beginPath(); ctx.arc(q[0], q[1], rs[i], 0, 2 * PI); ctx.fillStyle = col; ctx.fill();
    if (rim) { ctx.lineWidth = 0.6; ctx.strokeStyle = rim; ctx.stroke(); }
    ctx.restore();
  }
}
/* bilinear paper patch with a bend; lines run along u */
function paperPatch(c, bend) {
  return (u, v) => {
    const top = lerp2(c.TL, c.TR, u), bot = lerp2(c.BL, c.BR, u), q = lerp2(top, bot, v);
    if (bend) { const b = bend(u, v); q[0] += b[0]; q[1] += b[1]; }
    return q;
  };
}
function patchOutline(F, n) {
  const P = []; n = n || 16;
  for (let i = 0; i <= n; i++) P.push(F(i / n, 0));
  for (let i = 0; i <= n; i++) P.push(F(1, i / n));
  for (let i = n; i >= 0; i--) P.push(F(i / n, 1));
  for (let i = n; i >= 0; i--) P.push(F(0, i / n));
  return P;
}

/* ---------------- the final character (char-r7 n1, unchanged) ---------------- */
const S = {
  H: 73, headR: 9.6, headWrap: 0.55, neck: 1.5, neckLen: 2.8, eyeY: -43, bR: 6.4, bx: 4.6, rootA: 0.15, armIn: 0.6, gap: 18, end1Y: -36, armY: -37,
  Rt: 7.8, topX: -1.6, Ri: 4.8, innerX: 1.4, innerWrap: 0.32, innerPinch: 0.6, ballX: 1.0, dipSoft: 0.16, dipDrop: 0.5,
  shY: -15, headX: -1.6, eye: { rx: 7.3, ry: 7.6 }, farEye: 0.84, pupilR: 3.0,
  wire: 4.4, anchor: [47, 86], bendK: 0.95, curlR: 2.3, seg: 5, armSlack: 1.14,
  pencil: { len: 17, back: 4.5, w: 3 }
};
S.neckY = S.eyeY + 9.4; S.eyeL = [-5.6, S.eyeY + 0.2]; S.eyeR = [6.6, S.eyeY - 1];
const RX = armRoot(S)[0];



const C = { rim: '#3d4168', body: '#8a8fbf', bounce: '#c2b98f', sheen: '#b2b5dc', sheen2: '#dfe1f3', cut: '#d6d8ee',
  brow: '#16161c', pupil: '#15151b', eyeRim: '#3d4168', lid: '#a9add3',
  // N8's notebook
  pad0: '#ffffcc', pad1: '#fbf3c0', rule: '#99ccff', margin: '#ff9999', pedge: '#cccc99' };

function cutEnd(x, P, w, atStart) {
  if (typeof w !== 'number') w = atStart ? w[0] : w[w.length - 1];
  const a = atStart ? P[0] : P[P.length - 1], b = atStart ? P[2] : P[P.length - 3];
  const ang = Math.atan2(a[1] - b[1], a[0] - b[0]);
  x.save(); x.translate(a[0], a[1]); x.rotate(ang);
  x.beginPath(); x.ellipse(0, 0, w * 0.26, w * 0.5, 0, 0, 2 * PI); x.fillStyle = C.cut; x.fill();
  x.lineWidth = 0.45; x.strokeStyle = C.rim; x.stroke(); x.restore();
}
/* passes run across every wire part before the next pass (no seam at the arm), then the cut faces */
const PASSES = [
  (x, P, w) => line(x, P, w, C.rim),
  (x, P, w) => line(x, P, W(w, 0.74), C.body),
  (x, P, w) => line(x, lit(P, W(w, -0.25)), W(w, 0.2), C.bounce),
  (x, P, w) => line(x, lit(P, W(w, 0.15)), W(w, 0.42), C.sheen),
  (x, P, w) => line(x, lit(P, W(w, 0.2)), W(w, 0.17), C.sheen2)];
function tube(x, parts) {
  PASSES.forEach(f => parts.forEach(q => f(x, q[0], q[1])));
  parts.forEach(q => { if (q[2]) cutEnd(x, q[0], q[1], true); if (q[3]) cutEnd(x, q[0], q[1], false); });
}
function eyePath(x, rx, ry, h) {
  x.beginPath(); x.moveTo(-rx, 0); x.ellipse(0, 0, rx, ry, 0, PI, 2 * PI);
  const k = 4 / 3 * ry * (1 - 1.75 * h); x.bezierCurveTo(rx, k, -rx, k, -rx, 0); x.closePath();
}
function drawEye(x, e, p) {
  const far = e.side > 0 ? S.farEye : 1, h = clamp(p.happy, 0, 1), bl = clamp(p.blink, 0, 1), rx = e.rx * far, ry = e.ry * far;
  x.save(); x.translate(e.x, e.y); x.rotate(e.a);
  // round 6: the eyeball is white again, exactly as in rounds 3 and 4
  eyePath(x, rx, ry, h);
  const g = x.createRadialGradient(-rx * 0.3, -ry * 0.35, 0.5, 0, 0, rx * 1.4); g.addColorStop(0, '#ffffff'); g.addColorStop(0.65, '#f4f5f8'); g.addColorStop(1, e.side > 0 ? '#cfd3de' : '#dadde6');
  x.fillStyle = g; x.fill();
  x.save(); x.clip();
  // regular eyes, exactly round 2 N9's pupil and look travel; the catchlight is one white sprite pixel
  // at the pupil's upper right, snapped so the retro pass keeps it white
  const pr = S.pupilR * p.pupil * (e.rx / S.eye.rx) * far, pa = clamp(1 - (h - 0.45) * 3, 0, 1);
  if (pa > 0) {
    const px = clamp(p.lookX, -1, 1) * (rx - pr - 0.8), py = clamp(p.lookY, -1, 1) * (ry - pr - 0.8);
    x.globalAlpha = pa; x.beginPath(); x.arc(px, py, pr, 0, 2 * PI); x.fillStyle = C.pupil; x.fill();
    if (pa > 0.6) {
      const ca = Math.cos(e.a), sa = Math.sin(e.a), lx = px + pr * 0.4, ly = py - pr * 0.42;
      const cx = Math.floor(e.x + ca * lx - sa * ly), cy = Math.floor(e.y + sa * lx + ca * ly);
      x.save(); x.setTransform(FRAME_T); x.fillStyle = '#ffffff'; x.fillRect(cx, cy, 1, 1); x.restore();
    }
    x.globalAlpha = 1;
  }
  if (bl > 0.01) {
    const yl = -ry + 2.1 * ry * bl;
    x.fillStyle = C.lid; x.fillRect(-rx - 1, -ry - 1, rx * 2 + 2, yl + ry + 1);
    x.beginPath(); x.moveTo(-rx - 1, yl); x.quadraticCurveTo(0, yl + ry * 0.2, rx + 1, yl); x.lineWidth = 0.85; x.strokeStyle = C.eyeRim; x.stroke();
  }
  x.restore();
  eyePath(x, rx, ry, h); x.lineWidth = 0.85; x.strokeStyle = C.eyeRim; x.stroke();
  x.restore();
}
function drawBrow(x, e, p) {
  const far = e.side > 0 ? S.farEye : 1, sd = e.side, rx = e.rx * far, ry = e.ry * far, raise = p.browY + (sd < 0 ? p.browL : p.browR);
  x.save(); x.translate(e.x, e.y); x.rotate(e.a);
  const base = -ry - 3.4 - raise, P = [];
  for (let i = 0; i <= 12; i++) {
    const u = i / 12;
    P.push([mix(-sd * rx * 0.6, sd * rx * 0.95, u), base - 2.3 * Math.sin(PI * u) - p.browTilt * 2.6 * (0.5 - u)]);
  }
  const sc = p.scale * far;
  taper(x, P, 0, 0, C.brow, u => sc * 3.9 * Math.pow(Math.sin(PI * clamp(u * 0.94 + 0.03, 0, 1)), 0.38) * (1 - 0.18 * u));
  x.restore();
}
/* N8's notebook: a legal-pad sheet with blue rules, a red double margin and a soft wave */
function drawPad(x, p) {
  if (p.paper <= 0) return;
  const F = paperPatch({ TL: [34, 38], TR: [116, 29], BL: [12, 89], BR: [119, 83] }, (u, v) => [0, Math.sin(PI * 1.3 * u) * 2.4 * (1 - 0.6 * v)]);
  x.save(); x.globalAlpha = p.paper;
  poly(x, patchOutline(F, 16)); x.closePath();
  const g = x.createLinearGradient(30, 30, 90, 92); g.addColorStop(0, C.pad0); g.addColorStop(1, C.pad1);
  x.fillStyle = g; x.fill(); x.lineWidth = 0.7; x.strokeStyle = C.pedge; x.lineJoin = 'round'; x.stroke();
  x.lineWidth = 0.8; x.strokeStyle = C.rule;
  for (let v = 0.16; v < 0.97; v += 0.092) { const L = []; for (let i = 0; i <= 12; i++) L.push(F(mix(0.02, 0.985, i / 12), v)); poly(x, L); x.stroke(); }
  x.strokeStyle = C.margin; x.lineWidth = 0.7;
  [0.15, 0.168].forEach(u => { const L = []; for (let i = 0; i <= 8; i++) L.push(F(u, mix(0.01, 0.99, i / 8))); poly(x, L); x.stroke(); });
  x.restore();
}
function drawFront(x, p, R) {
  if (p.front <= 0) return;
  const top = Math.min(R.eyes[0].y, R.eyes[1].y) + R.eyes[0].ry * 0.45 + (p.frontY || 0) + (1 - p.front) * 50;
  x.save(); x.translate(55, top); x.rotate(0.04);
  const W = 78, Hh = 70;
  x.beginPath(); x.moveTo(-W / 2, 1); x.quadraticCurveTo(0, -2.2, W / 2, 0.5); x.lineTo(W / 2 + 1, Hh); x.lineTo(-W / 2 - 1, Hh); x.closePath();
  x.fillStyle = C.pad0; x.fill(); x.lineWidth = 0.7; x.strokeStyle = C.pedge; x.stroke();
  x.lineWidth = 0.8; x.strokeStyle = C.rule;
  for (let y = 7; y < Hh; y += 5.4) { x.beginPath(); x.moveTo(-W / 2 + 1, y); x.lineTo(W / 2, y); x.stroke(); }
  x.strokeStyle = C.margin; x.lineWidth = 0.7; [-W / 2 + 10, -W / 2 + 11.4].forEach(mx => { x.beginPath(); x.moveTo(mx, 0); x.lineTo(mx, Hh); x.stroke(); });
  const hx = 24, w = S.wire;
  tube(x, [[cr([[hx, 7.5], [hx, -0.5], [hx + 2.1, -2.8], [hx + 4.2, -0.5], [hx + 4.2, 3.2]], 4), w, true, true]]);
  x.restore();
}
/* the normal body + arm control points as clip-local polylines for pose p (idles morph from and back to these) */
function restWire(p) { p = pose(p); return [clipControlPoints(S).concat(armControl(S, p).P.slice(1))]; }
let FRAME_T = null;
function drawClippee(x, p0) {
  FRAME_T = x.getTransform();
  // custom-wire parts (idles): wire / wireFront are lists of clip-local control-point lists drawn through the
  // same deform and tube passes; eyes [[x,y],[x,y]] moves the eyes; brows 0..1 hides the brows below 0.5
  const p = pose(p0), S2 = p.eyes ? Object.assign({}, S, { eyeL: p.eyes[0], eyeR: p.eyes[1] }) : S, R = rig(S2, p);
  const custom = L => L.map(P => [cr(P.map(R.D), S.seg || 5), R.w, true, true]);
  drawPad(x, p);
  if (p.inkPts) drawInk(x, p.inkPts, p.inkA, '#4c5163');
  x.save(); x.globalAlpha = 0.16 * p.paper * (p.front > 0.5 ? 0 : 1); x.fillStyle = '#6b5b1c';
  x.beginPath(); x.ellipse(R.base[0] + S.ballX + 1, R.base[1] + 0.5, S.bx + S.bR + 3, 2.4, 0, 0, 2 * PI); x.fill(); x.restore();
  if (p.pad > 0) drawHandPad(x, p);
  const parts = p.wire ? custom(p.wire) : wireParts(R, p.draw);
  if (parts.length) tube(x, parts);
  drawPencil(x, R.pencil, p.pencil);
  if (p.face >= 0.5) {
    const brows = (p.brows == null ? 1 : p.brows) >= 0.5;
    drawEye(x, R.eyes[1], p); if (brows) drawBrow(x, R.eyes[1], p);
    drawEye(x, R.eyes[0], p); if (brows) drawBrow(x, R.eyes[0], p);
  }
  if (p.wireFront) tube(x, custom(p.wireFront));
  drawFront(x, p, R);
  if (p.dots > 0) {
    const t = R.D([S.topX, -S.H]);
    x.save(); x.globalAlpha = p.dotsA;
    drawDots(x, [[t[0] + 12, t[1] + 3], [t[0] + 17, t[1] - 2], [t[0] + 23.5, t[1] - 6.5]], p.dots, C.body, C.rim, [1.3, 1.8, 2.4]);
    x.restore();
  }
}

/* ---------- poses ---------- */
const EY = S.eyeY, ER = S.eyeR[0];
const POSES = {
  rest: { lean: 0.03, lookX: -0.18, lookY: 0.1 },
  greeting: { reach: 1, hx: RX + 14, hy: -45, elbow: 1, curl: 0.9, lean: -0.1, leanTop: -0.18, headTilt: -0.07, lookX: -0.25, lookY: 0.05, browY: 1.5, browTilt: 0.2 },
  attention: { stretch: 0.03, eyeS: 1.05, pupil: 1.2, browY: 2.8, lookX: -0.05, lookY: 0.05, reach: 0.85, hx: RX + 8, hy: -39, elbow: 1, curl: 0.4 },
  checking: { paper: 0, front: 1, lookX: -0.4, lookY: 0.4, browY: -0.5, browTilt: -0.35, lean: 0.02 },
  explain: { reach: 1, hx: RX + 21, hy: -31, elbow: 1, curl: -0.3, lean: -0.14, leanTop: -0.22, lookX: 0.85, lookY: 0.1, browR: 1.8, browTilt: 0.2, headTilt: 0.05 },
  congratulate: { check: 1, happy: 1, browY: 2.2, lean: -0.1, leanTop: -0.16, stretch: 0.04 },
  writing: { pencil: 1, reach: 1, hx: RX + 11, hy: -31, elbow: 1, curl: 0.85, pAng: 1.05, lean: 0.11, leanTop: 0.18, lookX: 0.55, lookY: 0.75, browY: -0.5, browTilt: -0.45, headTilt: 0.08 },
  thinking: { reach: 1, hx: ER + 4.9, hy: EY + 8.9, elbow: 1, curl: -0.7, lookX: 0.6, lookY: -0.75, browL: 2.2, browR: -0.3, browTilt: 0.1, headTilt: 0.07, lean: 0.04, dots: 3 }
};


/* ---------- spring engine ---------- */
const GROUPS = [
  { w: 28, z: 0.9, k: ['lookX', 'lookY', 'pupil', 'eyeS'] },
  { w: 13, z: 0.62, k: ['lean', 'stretch', 'scale', 'dx', 'dy', 'tilt'] },
  { w: 9.5, z: 0.55, k: ['leanTop'] },
  { w: 8.5, z: 0.62, k: ['headTilt'] },
  { w: 10, z: 0.62, k: ['reach', 'hx', 'hy', 'curl', 'pAng'] },
  { w: 15, z: 0.5, k: ['browY', 'browL', 'browR', 'browTilt'] }];
/* held targets: the pose jumps, the springs do the in-betweens */
function hold(keys) { return t => { let p = keys[0][1]; for (const k of keys) if (t >= k[0]) p = k[1]; return pose(p); }; }
function springLoop(target, dur, N) {
  N = N || 144; const sub = Math.max(1, Math.round(dur * 240 / N)), dt = dur / (N * sub);
  const st = pose(target(0)), v = {}; GROUPS.forEach(g => g.k.forEach(k => v[k] = 0));
  const out = [];
  for (let loop = 0; loop < 3; loop++) for (let j = 0; j < N; j++) for (let s = 0; s < sub; s++) {
    const t = (j * sub + s) / (N * sub), tg = target(t);
    for (const key in POSE0) if (!(key in v)) st[key] = tg[key];
    GROUPS.forEach(g => g.k.forEach(k => { const a = g.w * g.w * (tg[k] - st[k]) - 2 * g.z * g.w * v[k]; v[k] += a * dt; st[k] += v[k] * dt; }));
    if (loop === 2 && s === 0) out.push(Object.assign({}, st));
  }
  const f = t => { t = ((t % 1) + 1) % 1; const q = t * N, i = Math.floor(q) % N; return blend(out[i], out[(i + 1) % N], q - Math.floor(q)); };
  f.samples = out; return f;
}

/* ---------------- shared helpers for animation builders ---------------- */
const REST = Object.freeze(pose(Object.assign({}, POSES.rest, { paper: 0 })));
function rest(o) { return pose(Object.assign({}, REST, o || {})); }
function drawNotebook(ctx) { drawPad(ctx, pose({ paper: 1 })); }
const easeInOut = t => { t = clamp(t, 0, 1); return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const easeOut = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const easeIn = t => Math.pow(clamp(t, 0, 1), 3);
window.CLIPPEE_ANIMS = window.CLIPPEE_ANIMS || {};
function registerAnim(name, def) {
  if (!def || typeof def.frame !== 'function') throw new Error('registerAnim(' + name + '): def.frame(i, info) is required');
  window.CLIPPEE_ANIMS[name] = def;
}
window.ClippeeRig = { drawClippee, REST, rest, pose, blend, POSES, POSE0, S, rig, drawNotebook, hold, springLoop, registerAnim, easeInOut, easeOut, easeIn, smooth, bump, mix, clamp };

/* ---------------- animation parts (all default off; REST draws exactly as char-r7 n1) ---------------- */
const pathLen = P => { let s = 0; for (let i = 1; i < P.length; i++) s += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); return s; };
function trimPath(P, len) {
  const out = [P[0]]; let acc = 0;
  for (let i = 1; i < P.length; i++) {
    const s = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
    if (acc + s >= len) { out.push(lerp2(P[i - 1], P[i], (len - acc) / (s || 1))); return out; }
    acc += s; out.push(P[i]);
  }
  return out;
}
/* draw < 1 shows only the first part of the wire, from the inner free end round to the arm: he bends into shape */
function wireParts(R, d) {
  if (d >= 0.999) return [[R.body, R.w, true, false], [R.arm, R.armW, false, true]];
  if (d <= 0.002) return [];
  const Lb = pathLen(R.body), ov = pathLen(R.arm.slice(0, 3)), La = pathLen(R.arm) - ov, keep = d * (Lb + La);
  if (keep <= Lb) { const P = trimPath(R.body, keep); return P.length > 1 ? [[P, R.w, true, true]] : []; }
  const A = trimPath(R.arm, ov + keep - Lb), w = typeof R.armW === 'number' ? R.armW : R.armW.slice(0, A.length);
  return [[R.body, R.w, true, false], [A, w, false, true]];
}
/* Writing's hand notepad: N8's legal pad in miniature, leaning on his right side. pad 0..1 slides it up into
   place (no scaling); padInk 0..4 = rows written so far (fraction = part of the current row). */
const PAD = { cx: () => S.anchor[0] + RX + 12.5, cy: () => S.anchor[1] - 26, w: 16, h: 20, rot: -0.12, rows: [-6, -2, 2, 6] };
function padFrame(p) { const rise = (1 - smooth(p.pad)) * 32; return { x: PAD.cx(), y: PAD.cy() + rise, c: Math.cos(PAD.rot), s: Math.sin(PAD.rot) }; }
function padPoint(p, row, u) { // frame point on ink row `row` at fraction u (0 left, 1 right)
  const f = padFrame(p), lx = mix(-3.8, 6, u), ly = PAD.rows[row] - 0.6;
  return [f.x + f.c * lx - f.s * ly, f.y + f.s * lx + f.c * ly];
}
function inkRow(p, row, upTo) { const P = []; const n = Math.max(2, Math.round(24 * upTo)); for (let k = 0; k <= n; k++) { const u = upTo * k / n, q = padPoint(p, row, u), ph = u * 26; P.push([q[0] + 0.45 * Math.sin(ph), q[1] - 0.55 * Math.abs(Math.sin(ph * 0.5))]); } return P; }
function drawHandPad(x, p) {
  const f = padFrame(p);
  x.save(); x.translate(f.x, f.y); x.rotate(PAD.rot);
  x.beginPath(); x.rect(-PAD.w / 2, -PAD.h / 2, PAD.w, PAD.h); x.fillStyle = C.pad0; x.fill();
  x.lineWidth = 0.7; x.strokeStyle = C.rule; PAD.rows.forEach(y => { x.beginPath(); x.moveTo(-PAD.w / 2 + 0.5, y); x.lineTo(PAD.w / 2 - 0.5, y); x.stroke(); });
  x.strokeStyle = C.margin; x.beginPath(); x.moveTo(-PAD.w / 2 + 3, -PAD.h / 2); x.lineTo(-PAD.w / 2 + 3, PAD.h / 2); x.stroke();
  x.beginPath(); x.rect(-PAD.w / 2, -PAD.h / 2, PAD.w, PAD.h); x.lineWidth = 0.7; x.strokeStyle = C.pedge; x.stroke();
  x.restore();
  const r = clamp(p.padInk, 0, 4);
  for (let k = 0; k < 4; k++) { const upTo = clamp(r - k, 0, 1); if (upTo > 0.02) line(x, inkRow(p, k, upTo), 0.8, '#4c5163', true, true); }
}
/* aim the pencil: adjust the hand (hx, hy) until the pencil tip lands on a frame point */
function aimPencil(p0, target) {
  const p = pose(p0);
  for (let k = 0; k < 6; k++) { const t = rig(S, p).pencil.tip; p.hx += target[0] - t[0]; p.hy += target[1] - t[1]; }
  return p;
}
/* keyed(keys, {lag}) -> frame(i): keys are [frameIndex, overrides on REST, ease?], blended by frame index.
   lag: {field: frames} makes a part read the keys a little late (overlapping action, the F4 feel). */
const EASES = { inOut: easeInOut, out: easeOut, in: easeIn, lin: t => clamp(t, 0, 1), sine: t => 0.5 - 0.5 * Math.cos(PI * clamp(t, 0, 1)),
  back: t => { t = clamp(t, 0, 1) - 1; return 1 + 2.2 * t * t * t + 1.2 * t * t; }, hold: t => (t >= 1 ? 1 : 0) };
function keyed(keys, opts) {
  const lag = (opts && opts.lag) || {};
  const at = f => {
    if (f <= keys[0][0]) return rest(keys[0][1]);
    for (let k = 0; k < keys.length - 1; k++) {
      const [i0, p0] = keys[k], [i1, p1, e] = keys[k + 1];
      if (f <= i1) return blend(rest(p0), rest(p1), (EASES[e] || easeInOut)((f - i0) / ((i1 - i0) || 1)));
    }
    return rest(keys[keys.length - 1][1]);
  };
  const first = keys[0][0], last = keys[keys.length - 1][0];
  return i => {
    if (i <= first || i >= last) return at(i); // the end keys are exact: animations start and end on their key pose
    const p = at(i); for (const k in lag) p[k] = at(Math.max(first, i - lag[k]))[k]; return p;
  };
}
window.ClippeeRig = Object.assign(window.ClippeeRig || {}, { keyed, EASES, aimPencil, padPoint, wireParts, restWire });
