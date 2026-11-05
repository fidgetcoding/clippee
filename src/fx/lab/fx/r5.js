/* anim-r2 · family r · r5 Blue screen
   registerFx({ id, name, appearMs, disappearMs, appear(ctx, t, stage), disappear(ctx, t, stage) })
   ctx: a stage-sized canvas context (cleared by the caller). stage = { w, h, anchor: { x, y } },
   anchor = top-left of his 124 x 93 rest box. Pure functions of t (0..1): no timers, no state, fixed seeds.
   Needs kit/retro.js and kit/clippee-rig.js loaded first. */
(function () {
'use strict';
/* ---- shared 1997 helpers (copied into every r-family fx.js so each one ports on its own) ---- */
const RIG = window.ClippeeRig;
const FW = 124, FH = 93;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const mix = (a, b, t) => a + (b - a) * t;
const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
const eOut = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const eIn = t => Math.pow(clamp(t, 0, 1), 3);
const eIO = t => { t = clamp(t, 0, 1); return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const eBack = t => { t = clamp(t, 0, 1) - 1; return 1 + 2.7 * t * t * t + 1.7 * t * t; };
const RX = RIG.POSES.greeting.hx - 14;                       // where his arm leaves the clip (clip-local x)
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// Clippee is always the real 124 x 93 pre-render sprite (kit/retro.js), placed on whole pixels, never scaled
const SPR = new Map();
function sprite(p, key) {
  if (key && SPR.has(key)) return SPR.get(key);
  const c = document.createElement('canvas'); c.width = FW; c.height = FH;
  retroRender(RIG.drawClippee, RIG.pose(p), 'prerender', c);
  if (key) SPR.set(key, c);
  return c;
}
const restSprite = () => sprite(RIG.REST, 'rest');
function pixels(c) { if (!c._px) c._px = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height); return c._px; }
function blit(ctx, c, x, y) { ctx.imageSmoothingEnabled = false; ctx.drawImage(c, Math.round(x), Math.round(y)); }
function blitPart(ctx, c, sx, sy, sw, sh, x, y) { if (sw <= 0 || sh <= 0) return; ctx.imageSmoothingEnabled = false; ctx.drawImage(c, sx, sy, sw, sh, Math.round(x), Math.round(y), sw, sh); }
function rect(ctx, x, y, w, h, col) { if (w <= 0 || h <= 0) return; ctx.fillStyle = col; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
function frame1(ctx, x, y, w, h, col) { rect(ctx, x, y, w, 1, col); rect(ctx, x, y + h - 1, w, 1, col); rect(ctx, x, y, 1, h, col); rect(ctx, x + w - 1, y, 1, h, col); }
// Win98 3-D edges
const W98 = { face: '#c0c0c0', hi: '#ffffff', lite: '#dfdfdf', shade: '#808080', dark: '#000000', navy: '#000080', text: '#000000' };
function raised(ctx, x, y, w, h) {
  rect(ctx, x, y, w, h, W98.face);
  rect(ctx, x, y, w - 1, 1, W98.lite); rect(ctx, x, y, 1, h - 1, W98.lite);
  rect(ctx, x + 1, y + 1, w - 3, 1, W98.hi); rect(ctx, x + 1, y + 1, 1, h - 3, W98.hi);
  rect(ctx, x, y + h - 1, w, 1, W98.dark); rect(ctx, x + w - 1, y, 1, h, W98.dark);
  rect(ctx, x + 1, y + h - 2, w - 2, 1, W98.shade); rect(ctx, x + w - 2, y + 1, 1, h - 2, W98.shade);
}
function sunken(ctx, x, y, w, h, fill) {
  rect(ctx, x, y, w, h, fill || '#ffffff');
  rect(ctx, x, y, w - 1, 1, W98.shade); rect(ctx, x, y, 1, h - 1, W98.shade);
  rect(ctx, x + 1, y + 1, w - 3, 1, W98.dark); rect(ctx, x + 1, y + 1, 1, h - 3, W98.dark);
  rect(ctx, x, y + h - 1, w, 1, W98.hi); rect(ctx, x + w - 1, y, 1, h, W98.hi);
  rect(ctx, x + 1, y + h - 2, w - 2, 1, W98.lite); rect(ctx, x + w - 2, y + 1, 1, h - 2, W98.lite);
}
function pressedBtn(ctx, x, y, w, h) {
  rect(ctx, x, y, w, h, W98.face); frame1(ctx, x, y, w, h, W98.dark); frame1(ctx, x + 1, y + 1, w - 2, h - 2, W98.shade);
}
// Win98 window: face, edges, a solid navy title bar (no gradient), title text, a close box
function win98(ctx, x, y, w, h, title, active) {
  raised(ctx, x, y, w, h);
  rect(ctx, x + 3, y + 3, w - 6, 18, active === false ? '#808080' : W98.navy);
  txt(ctx, title, x + 6, y + 5, 'bold 11px Tahoma', '#ffffff');
  raised(ctx, x + w - 21, y + 5, 16, 14);
  const cx = x + w - 17, cy = y + 8;
  for (let i = 0; i < 7; i++) { rect(ctx, cx + i, cy + i, 2, 1, '#000'); rect(ctx, cx + 6 - i, cy + i, 2, 1, '#000'); }
}
// crisp 1-bit text: draw once off screen, snap every glyph pixel to on or off, cache it
const TXT = new Map();
function txtCanvas(s, font, col) {
  const key = s + '|' + font + '|' + col; if (TXT.has(key)) return TXT.get(key);
  const m = document.createElement('canvas').getContext('2d'); m.font = font;
  const w = Math.ceil(m.measureText(s).width) + 4, size = parseInt(/(\d+)px/.exec(font)[1], 10), h = Math.ceil(size * 1.5) + 2;
  const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = h;
  const x = c.getContext('2d'); x.font = font; x.textBaseline = 'top'; x.fillStyle = '#000'; x.fillText(s, 1, 1);
  const d = x.getImageData(0, 0, w, h), a = d.data, n = parseInt(col.slice(1), 16);
  for (let i = 0; i < a.length; i += 4) { const on = a[i + 3] >= 120; a[i] = n >> 16; a[i + 1] = n >> 8 & 255; a[i + 2] = n & 255; a[i + 3] = on ? 255 : 0; }
  x.putImageData(d, 0, 0); c._w = Math.ceil(m.measureText(s).width);
  TXT.set(key, c); return c;
}
function txt(ctx, s, x, y, font, col, align) { const c = txtCanvas(s, font, col || '#000000'); blit(ctx, c, align === 'center' ? x - c._w / 2 - 1 : align === 'right' ? x - c._w - 1 : x - 1, y - 1); return c._w; }
// Win95 window-zoom: three 1-px outline boxes stepping between two rectangles
function zoomBoxes(ctx, A, B, u) {
  for (let k = 0; k < 3; k++) {
    const v = clamp(u - k * 0.18, 0, 1); if (v <= 0 || v >= 1) continue;
    frame1(ctx, mix(A[0], B[0], v), mix(A[1], B[1], v), Math.max(2, mix(A[2], B[2], v)), Math.max(2, mix(A[3], B[3], v)), k === 1 ? '#808080' : '#000000');
  }
}

/* ---- r5 · Blue screen ----
   In:  a tiny blue screen glitches in over his spot, "A fatal exception 0E has occurred at ... in VXD
        CLIPPEE", two thumps crack it from behind, his fist punches through and the screen shatters
        into blue shards that rain off the window. He drops the fist and stands.
   Out: he crashes himself: his sprite tears into glitch bands, a blue screen slams in behind him, he
        melts down into the blue column by column, and the screen switches off like a CRT. */
const BLUE = '#0000aa', GREY = '#aaaaaa', WHITE = '#ffffff', CRACK = '#aaffff';
const LINES_IN = ['A fatal exception 0E has', 'occurred at 0028:C0011E36', 'in VXD CLIPPEE(01).', '', '* Press any key to', '  continue _'];
const LINES_OUT = ['CLIPPEE.EXE has performed', 'an illegal operation and', 'will be shut down.', '', '* Press any key to', '  continue _'];
const panelRect = st => ({ x: st.anchor.x - 36, y: st.anchor.y - 26, w: 186, h: 134 });
// the screen itself, drawn into its own canvas so it can be torn, cracked and shattered
const PNL = document.createElement('canvas');
function screen(P, lines, nLines, cursor, cracks) {
  PNL.width = P.w; PNL.height = P.h; const x = PNL.getContext('2d');
  rect(x, 0, 0, P.w, P.h, BLUE);
  const hw = 56; rect(x, P.w / 2 - hw / 2, 12, hw, 13, GREY); txt(x, 'CLIPPEE', P.w / 2, 12, 'bold 11px "Courier New"', BLUE, 'center');
  for (let i = 0; i < nLines; i++) { let s = lines[i]; if (s.endsWith('_')) s = cursor ? s : s.slice(0, -1); txt(x, s, 8, 36 + i * 13, 'bold 11px "Courier New"', WHITE); }
  (cracks || []).forEach(c => drawCrack(x, c));
  return PNL;
}
// a jagged crack from a centre point: seeded spokes with a fork each
function crackSpokes(cx, cy, len, seed) {
  const R = rng(seed), out = [];
  for (let s = 0; s < 7; s++) {
    const a = s / 7 * Math.PI * 2 + R() * 0.6, pts = [[cx, cy]]; let x = cx, y = cy, ang = a;
    for (let d = 0; d < len; d += 4) { ang += (R() - 0.5) * 0.9; x += Math.cos(ang) * 4; y += Math.sin(ang) * 4; pts.push([x, y]); }
    out.push(pts);
  }
  return out;
}
function drawCrack(x, spokes) { spokes.forEach(P => { for (let i = 1; i < P.length; i++) { const a = P[i - 1], b = P[i], n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]))); for (let k = 0; k <= n; k++) rect(x, Math.round(mix(a[0], b[0], k / n)), Math.round(mix(a[1], b[1], k / n)), 1, 1, k % 3 ? CRACK : WHITE); } }); }
// tear a canvas into horizontal bands, each slid sideways, a few recoloured (the 1997 sync-loss glitch)
function torn(ctx, src, x, y, step, seed, shades) {
  const R = rng(seed * 31 + step), H = src.height, W = src.width;
  for (let by = 0; by < H;) {
    const bh = 3 + Math.floor(R() * 12), off = Math.round((R() - 0.5) * 36), drop = R() < 0.18;
    if (!drop) blitPart(ctx, src, 0, by, W, Math.min(bh, H - by), x + off, y + by);
    if (shades && R() < 0.25) rect(ctx, x + off, y + by, W, 1, R() < 0.5 ? '#00aaaa' : '#aa00aa');
    by += bh;
  }
}
const PUNCH = [80, 40];                                                     // frame point his fist goes through
const punchPose = u => RIG.rest({ reach: u, hx: PUNCH[0] - RIG.S.anchor[0], hy: PUNCH[1] - RIG.S.anchor[1], elbow: 0.2, curl: 0, browY: -0.8, browTilt: -0.5, lookX: 0.8, lean: 0.06, leanTop: 0.1 });
function appear(ctx, t, st) {
  const ax = st.anchor.x, ay = st.anchor.y, P = panelRect(st);
  if (t >= 1) { blit(ctx, restSprite(), ax, ay); return; }
  if (t <= 0) return;
  const cx = ax + PUNCH[0] - P.x, cy = ay + PUNCH[1] - P.y;
  const nL = t < 0.18 ? 0 : Math.min(6, Math.floor(seg(t, 0.18, 0.34) * 6.99)), cur = (Math.floor(t * 12) & 1) === 0;
  const k1 = t >= 0.37 ? crackSpokes(cx, cy, 12, 4) : null, k2 = t >= 0.45 ? crackSpokes(cx, cy, 30, 8) : null;
  const shake = (t > 0.37 && t < 0.41) || (t > 0.45 && t < 0.49) ? ((Math.floor(t * 400) & 1) ? 2 : -2) : 0;
  // him, behind the screen: still, then the punch, then the fist comes back down
  const fist = t < 0.5 ? 0 : t < 0.55 ? eOut(seg(t, 0.5, 0.55)) : t < 0.8 ? 1 : 1 - eIO(seg(t, 0.8, 0.92));
  if (t >= 0.5) blit(ctx, fist > 0.01 ? sprite(punchPose(fist)) : restSprite(), ax, ay);
  if (t < 0.18) { screen(P, LINES_IN, 0, false); torn(ctx, PNL, P.x, P.y, Math.floor(t / 0.03), 3, true); return; }
  const scr = screen(P, LINES_IN, nL, cur, [k1, k2].filter(Boolean));
  if (t < 0.53) {
    blit(ctx, scr, P.x + shake, P.y);
    if (t >= 0.5) { // the fist is through: a ragged hole round it
      const hx = P.x + cx, hy = P.y + cy, R = rng(21);
      ctx.save(); ctx.beginPath(); for (let a = 0; a < 12; a++) { const r = 9 + R() * 6, an = a / 12 * Math.PI * 2; (a ? ctx.lineTo : ctx.moveTo).call(ctx, Math.round(hx + Math.cos(an) * r), Math.round(hy + Math.sin(an) * r)); } ctx.closePath(); ctx.clip();
      ctx.clearRect(P.x, P.y, P.w, P.h); blit(ctx, sprite(punchPose(fist)), ax, ay); ctx.restore();
    }
    return;
  }
  // shatter: 10 px shards blown out from the fist, then gravity
  const g = seg(t, 0.53, 0.9), R = rng(17), S = 10;
  for (let sy = 0; sy < P.h; sy += S) for (let sx = 0; sx < P.w; sx += S) {
    const dx = sx + S / 2 - cx, dy = sy + S / 2 - cy, d = Math.hypot(dx, dy) || 1, v = 160 / (8 + d * 0.35) * (0.6 + R() * 0.8), spin = R();
    if (d < 14) continue;                                   // the hole
    const ox = dx / d * v * g * 1.6, oy = dy / d * v * g * 1.6 + 260 * g * g;
    const X = P.x + sx + ox, Y = P.y + sy + oy;
    if (Y > st.h || X > st.w + S || X < -S) continue;
    const w = spin < 0.3 && g > 0.15 ? S / 2 : S;          // some shards flip edge-on as they tumble
    blitPart(ctx, scr, sx, sy, Math.min(w, P.w - sx), Math.min(S, P.h - sy), X, Y);
  }
}
function disappear(ctx, t, st) {
  const ax = st.anchor.x, ay = st.anchor.y, P = panelRect(st), r = restSprite();
  if (t >= 1) return;
  if (t <= 0) { blit(ctx, r, ax, ay); return; }
  // the screen behind him: slams in, then switches off like a CRT (collapse to a line, then a dot)
  if (t >= 0.2 && t < 0.95) {
    const cur = (Math.floor(t * 12) & 1) === 0, scr = screen(P, LINES_OUT, 6, cur);
    if (t < 0.7) blit(ctx, scr, P.x, P.y + (t < 0.23 ? -3 : 0));
    else if (t < 0.82) { const h = Math.max(2, Math.round(P.h * (1 - Math.ceil(seg(t, 0.7, 0.82) * 6) / 6))); rect(ctx, P.x, P.y + (P.h - h) / 2, P.w, h, h > 3 ? BLUE : WHITE); }
    else if (t < 0.9) { const w = Math.max(2, Math.round(P.w * (1 - Math.ceil(seg(t, 0.82, 0.9) * 6) / 6))); rect(ctx, P.x + (P.w - w) / 2, P.y + P.h / 2 - 1, w, 2, WHITE); }
    else if ((Math.floor(t * 80) & 1) === 0) rect(ctx, P.x + P.w / 2 - 1, P.y + P.h / 2 - 1, 2, 2, WHITE);
  }
  // him: tears into glitch bands, then melts down into the blue, column by column
  if (t < 0.2) {
    const step = Math.floor(t / 0.025);
    if (step === 0) blit(ctx, r, ax, ay); else torn(ctx, r, ax, ay, step, 7, step > 3);
  } else if (t < 0.66) {
    const u = seg(t, 0.24, 0.66), R = rng(5), floor = P.y + P.h;
    for (let c = 0; c < FW; c += 2) {
      const d = 0.35 * R(), m = clamp((u - d) / (1 - d * 0.6), 0, 1), dy = Math.round(eIn(m) * 140);
      const vis = Math.max(0, Math.min(FH, floor - (ay + dy)));
      if (vis > 0) blitPart(ctx, r, c, 0, 2, vis, ax + c, ay + dy);
    }
  }
}
const FX_DEF = { id: 'r5', name: 'Blue screen', appearMs: 2600, disappearMs: 2400, appear, disappear,
  focus: { w: 300, h: 188 },
  notes: 'In: a tiny blue screen glitches in over his spot, "A fatal exception 0E has occurred at 0028:C0011E36 in VXD CLIPPEE", two thumps crack it from behind, his fist punches through and the screen shatters into blue shards that rain off the window. Out: he crashes himself, tearing into glitch bands, a blue screen slams in behind him, he melts down into the blue column by column, and the screen switches off like an old CRT.',
  sound: 'A hard-drive grind and a sync-loss buzz, two muffled thumps, a glass smash; out: the Win98 critical-stop chord, a falling pitch as he melts, the CRT power-off thoonk.' };

(window.registerFx || function (d) { window.FX = d; })(FX_DEF);
})();
