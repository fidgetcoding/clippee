/* anim-r2 · family r · r4 Install wizard
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

/* ---- r4 · Install wizard ----
   In:  a Win98 "Clippee Setup" box zooms open on his spot and copies his files while the progress bar
        fills; setup completes, the window collapses into the bar, the bar fuses into one steel wire,
        and the wire bends itself into him. His eyes boot up last.
   Out: "Uninstall Clippee?" pops up over his head. He hops and head-butts No, three times, while the
        box keeps asking; he sighs, shuffles over and butts Yes. "Removing Clippee..." unbends him into a
        straight wire that drains away with the progress bar, and the box zooms shut. */
const WR = RIG.restWire(RIG.REST)[0];                          // his rest wire, clip-local control points
const WLEN = (() => { const L = [0]; for (let i = 1; i < WR.length; i++) L.push(L[i - 1] + Math.hypot(WR[i][0] - WR[i - 1][0], WR[i][1] - WR[i - 1][1])); return L; })();
const AX = RIG.S.anchor[0], AY = RIG.S.anchor[1];               // clip base inside the 124 x 93 frame
// the wire laid flat along frame row fy from frame x a to b (by arc length, so it keeps its proportions)
const flat = (a, b, fy) => WR.map((q, i) => [mix(a, b, WLEN[i] / WLEN[WLEN.length - 1]) - AX, fy - AY]);
// blend flat <-> rest, one end leading: from = 0 bends from the inner end, 1 from the arm tip
function bent(u, F, from) {
  const n = WR.length - 1;
  return [WR.map((q, i) => { const k = from ? 1 - i / n : i / n, v = eIO(clamp(u * 1.7 - k * 0.7, 0, 1)); return [mix(F[i][0], q[0], v), mix(F[i][1], q[1], v)]; })];
}
const FILES = ['CLIPPEE.EXE', 'WIRE.VXD', 'BROWS.DLL', 'EYES.SYS', 'SPRING.DRV', 'PAPER.INF', 'HELLO.WAV', 'CLIPPEE.INI'];
function setupIcon(ctx, x, y) {   // a little boxed CD and floppy, setup style
  rect(ctx, x + 2, y + 6, 24, 20, '#000'); rect(ctx, x + 3, y + 7, 22, 18, '#ffff00'); rect(ctx, x + 3, y + 7, 22, 4, '#c0a000');
  rect(ctx, x + 8, y, 18, 12, '#000'); rect(ctx, x + 9, y + 1, 16, 10, '#c0c0c0'); rect(ctx, x + 13, y + 3, 8, 6, '#ffffff'); rect(ctx, x + 16, y + 5, 2, 2, '#808080');
  rect(ctx, x + 6, y + 14, 12, 10, '#000080'); rect(ctx, x + 9, y + 14, 6, 4, '#c0c0c0');
}
function bar(ctx, x, y, w, p, col) {
  sunken(ctx, x, y, w, 14, '#ffffff');
  const n = Math.floor((w - 6) / 8); for (let i = 0; i < Math.round(p * n); i++) rect(ctx, x + 3 + i * 8, y + 3, 6, 8, col || W98.navy);
}
function appear(ctx, t, st) {
  const ax = st.anchor.x, ay = st.anchor.y;
  if (t >= 1) { blit(ctx, restSprite(), ax, ay); return; }
  if (t <= 0) return;
  const D = [ax - 104, ay - 8, 236, 114], BX = ax + 10, BY = ay + 57, BW = 106;
  if (t < 0.08) { zoomBoxes(ctx, [ax + 50, ay + 50, 2, 2], D, seg(t, 0, 0.08) * 1.36); return; }
  if (t < 0.62) {
    const p = seg(t, 0.1, 0.55), done = t >= 0.56, k = Math.min(FILES.length - 1, Math.floor(p * FILES.length));
    win98(ctx, D[0], D[1], D[2], D[3], 'Clippee Setup');
    setupIcon(ctx, D[0] + 12, D[1] + 30);
    txt(ctx, done ? 'Setup is complete.' : 'Installing Clippee...', D[0] + 50, D[1] + 29, 'bold 11px Tahoma', '#000');
    txt(ctx, done ? 'Clippee is ready to help.' : 'Copying: ' + FILES[k], D[0] + 50, D[1] + 44, '11px Tahoma', '#000');
    txt(ctx, Math.round(p * 100) + '%', BX - 8, BY + 1, '11px Tahoma', '#000', 'right');
    bar(ctx, BX, BY, BW, p);
    const fin = t >= 0.585;
    (fin ? pressedBtn : raised)(ctx, D[0] + D[2] - 82, D[1] + D[3] - 30, 72, 22);
    txt(ctx, done ? 'Finish' : 'Cancel', D[0] + D[2] - 46 + (fin ? 1 : 0), D[1] + D[3] - 25 + (fin ? 1 : 0), '11px Tahoma', done ? '#000' : '#808080', 'center');
    return;
  }
  if (t < 0.68) {   // the window folds into its own progress bar, which stays put
    zoomBoxes(ctx, D, [BX, BY, BW, 14], seg(t, 0.62, 0.68) * 1.36);
    bar(ctx, BX, BY, BW, 1);
    return;
  }
  if (t < 0.705) { rect(ctx, BX + 3, BY + 3, 96, 8, (Math.floor(t * 300) & 1) ? '#ffffff' : '#c3c7cf'); return; }   // the blocks fuse
  // the wire bends itself into him; the eyes boot up at the end
  const u = seg(t, 0.705, 0.9), F = flat(BX - ax + 3, BX - ax + 99, BY - ay + 7);
  const face = t >= 0.885 ? 1 : 0, blink = t < 0.885 ? 0 : t < 0.93 ? 1 - seg(t, 0.905, 0.93) : 0;
  blit(ctx, sprite(RIG.rest({ wire: bent(u, F, 0), face, blink })), ax, ay);
}
function disappear(ctx, t, st) {
  const ax = st.anchor.x, ay = st.anchor.y;
  if (t >= 1) return;
  if (t <= 0) { blit(ctx, restSprite(), ax, ay); return; }
  const D = [ax - 137, ay - 84, 222, 90], NO = [ax + 15, ay - 30, 60, 22], YES = [ax - 53, ay - 30, 60, 22];
  // three No butts, a sigh, a shuffle, one Yes
  const HOPS = [[0.05, 0.17, NO], [0.18, 0.30, NO], [0.31, 0.43, NO], [0.56, 0.665, YES]];
  let hop = 0, press = null, shift = 0;
  HOPS.forEach(([a, b, B]) => { const u = seg(t, a, b); if (u > 0 && u < 1) { hop = u < 0.42 ? eOut(u / 0.42) * 17 : u < 0.58 ? 17 : (1 - eIn((u - 0.58) / 0.42)) * 17; if (u >= 0.4 && u < 0.62) press = B; } });
  shift = -68 * eIO(seg(t, 0.49, 0.56));
  const asks = ['Uninstall Clippee?', 'Are you sure?', 'Really? He just got here.', 'Remove Clippee for good?'];
  const nNo = t < 0.17 ? 0 : t < 0.30 ? 1 : t < 0.43 ? 2 : 3;
  const removing = t >= 0.665, drain = seg(t, 0.76, 0.9);
  if (t < 0.05) zoomBoxes(ctx, [ax + 44, ay, 2, 2], D, seg(t, 0, 0.05) * 1.36);
  else if (t < 0.92) {
    const jit = press && !removing ? ((Math.floor(t * 200) & 1) ? 1 : -1) : 0;
    win98(ctx, D[0] + jit, D[1], D[2], D[3], removing ? 'Clippee Setup' : 'Confirm Uninstall');
    const ix = D[0] + 12 + jit, iy = D[1] + 30;
    if (!removing) {   // the question balloon icon
      rect(ctx, ix + 4, iy, 22, 18, '#000'); rect(ctx, ix + 5, iy + 1, 20, 16, '#ffffff'); rect(ctx, ix + 8, iy + 17, 4, 4, '#000');
      txt(ctx, '?', ix + 15, iy + 1, 'bold 13px Tahoma', '#000080', 'center');
      txt(ctx, asks[nNo], D[0] + 46 + jit, D[1] + 32, nNo ? '11px Tahoma' : 'bold 11px Tahoma', '#000');
      [[YES, 'Yes'], [NO, 'No']].forEach(([B, l]) => { const pr = press === B; (pr ? pressedBtn : raised)(ctx, B[0] + jit, B[1], B[2], B[3]); txt(ctx, l, B[0] + B[2] / 2 + jit + (pr ? 1 : 0), B[1] + 5 + (pr ? 1 : 0), '11px Tahoma', '#000', 'center'); });
    } else {
      setupIcon(ctx, ix, iy - 2);
      txt(ctx, drain >= 1 ? 'Clippee was removed.' : 'Removing Clippee...', D[0] + 46, D[1] + 30, 'bold 11px Tahoma', '#000');
      bar(ctx, D[0] + 46, D[1] + 50, 162, 1 - drain);
    }
  } else zoomBoxes(ctx, D, [D[0] + 108, D[1] + 44, 2, 2], seg(t, 0.92, 0.98) * 1.36);
  // him: butting the buttons, sighing, then unbending into a wire that drains away with the bar
  const sx = ax + shift, sy = ay - hop;
  if (!removing) {
    const sigh = seg(t, 0.43, 0.49) > 0 && t < 0.56;
    const p = press ? RIG.rest({ lookY: -0.9, browY: -0.6, browTilt: -0.35, blink: 0.35 }) : hop > 0 ? RIG.rest({ lookY: -0.8, browY: 0.8, browTilt: -0.2 }) :
      sigh ? RIG.rest({ browY: -1.2, browTilt: 0.4, blink: 0.45, lookY: 0.4, lean: 0.06, leanTop: 0.14 }) : nNo ? RIG.rest({ lookY: -0.6, browTilt: -0.15 }) : null;
    blit(ctx, p ? sprite(p) : restSprite(), sx, sy);
    if (press) { const B = press, cx = B[0] + B[2] / 2; rect(ctx, cx - 1, B[1] + B[3] + 1, 2, 2, '#ffff00'); rect(ctx, cx - 7, B[1] + B[3] + 3, 3, 1, '#ffffff'); rect(ctx, cx + 5, B[1] + B[3] + 3, 3, 1, '#ffffff'); }
  } else if (t < 0.92) {
    const u = seg(t, 0.665, 0.76), end = mix(110, 10, drain), F = flat(10, 110, 60);
    let W = u < 1 ? bent(1 - u, F, 1)[0] : F;
    if (drain > 0) W = W.map(q => [Math.min(q[0], end - AX), q[1]]).filter((q, i, a) => i === 0 || q[0] > a[i - 1][0] - 0.01 || q[0] < end - AX - 0.01);
    if (drain < 0.985) blit(ctx, sprite(RIG.rest({ wire: [W], face: u < 0.25 ? 1 : 0, blink: u < 0.25 ? 0.7 : 0 })), sx, ay);
  }
}
const FX_DEF = { id: 'r4', name: 'Install wizard', appearMs: 3400, disappearMs: 3000, appear, disappear,
  focus: { w: 360, h: 225 },
  notes: 'In: a Win98 "Clippee Setup" box zooms open on his spot and copies his files while the progress bar fills; setup completes, the window folds into its own bar, the blocks fuse into one steel wire and it bends itself into him, eyes booting up last. Out: "Uninstall Clippee?" pops up over his head; he hops and head-butts No three times while the box keeps asking, sighs, shuffles over and butts Yes, then unbends into a wire that drains away with the progress bar.',
  sound: 'The Win98 startup chord, drive chatter while copying, a tada on Finish and a bendy wire twang; out: the chord.wav ding on each popup, a thunk per head-butt, a sigh, then a descending blip as he drains.' };

(window.registerFx || function (d) { window.FX = d; })(FX_DEF);
})();
