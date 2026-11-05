/* anim-r2 · family r · r1 Dot-matrix printer
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

/* ---- r1 · Dot-matrix printer ----
   In:  a print head and platen rise into his spot, tractor-feed paper feeds up, the head screeches across
        and prints him three rows a pass (bidirectional), line-feeding between passes. Printed, the sheet
        rips at the perforation and drops away behind him; he stays standing.
   Out: the sheet shoots up behind him, the printer pulls him back in three rows at a time, the head
        zips back and forth, the blank leader tears off at the perforation and flutters down. */
const PW = 156, LEAD = 26;
const PAPER = '#fbfbf2', BAR = '#dcebd2', HOLE = '#c8c8bc', HOLE2 = '#a7a79a', EDGE = '#a9a99a', PERF = '#b9b9ab';
const geo = st => { const ax = st.anchor.x, ay = st.anchor.y; return { ax, ay, px: ax + 62 - PW / 2, yL: ay + FH, h: st.h }; };
// a run of tractor-feed paper from y0 to y1; `scroll` slides the bars, holes and perforations with the feed
function paper(ctx, g, y0, y1, scroll, x0) {
  const x = Math.round(x0 == null ? g.px : x0), top = Math.max(0, Math.round(y0)), bot = Math.round(y1);
  if (bot <= top) return;
  rect(ctx, x, top, PW, bot - top, PAPER);
  for (let y = top; y < bot; y++) {
    const yy = y + scroll;
    if ((Math.floor(yy / 12) & 1) === 0) rect(ctx, x + 15, y, PW - 30, 1, BAR);
    if ((yy & 3) < 2) { rect(ctx, x + 12, y, 1, 1, PERF); rect(ctx, x + PW - 13, y, 1, 1, PERF); }
    if (((yy % 96) + 96) % 96 === 0) for (let i = 0; i < PW; i += 4) rect(ctx, x + i, y, 2, 1, PERF);
  }
  for (let k = Math.floor((top + scroll) / 8) - 1; k * 8 - scroll < bot; k++) {
    const cy = k * 8 - scroll + 2;
    if (cy < top || cy + 4 > bot) continue;
    [x + 3, x + PW - 7].forEach(hx => { rect(ctx, hx + 1, cy, 2, 1, HOLE2); rect(ctx, hx, cy + 1, 4, 2, HOLE); rect(ctx, hx + 1, cy + 3, 2, 1, HOLE); });
  }
  rect(ctx, x, top, 1, bot - top, EDGE); rect(ctx, x + PW - 1, top, 1, bot - top, EDGE);
}
// the printer: a beige 1997 case rising from below the window; paper exits its slot at y, the head rides on top
function printer(ctx, g, y, headX, t) {
  const x0 = g.px - 22, w = PW + 44, yi = Math.round(y);
  if (yi >= g.h) return;
  rect(ctx, x0, yi - 3, w, 48, '#d3cbb2'); rect(ctx, x0, yi - 3, w, 1, '#efe9d6'); rect(ctx, x0, yi - 3, 1, 48, '#efe9d6');
  rect(ctx, x0 + w - 1, yi - 3, 1, 48, '#8d846c'); rect(ctx, x0 + 3, yi + 9, w - 6, 1, '#b5ac92'); rect(ctx, x0 + 3, yi + 10, w - 6, 1, '#efe9d6');
  rect(ctx, g.px - 4, yi - 1, PW + 8, 3, '#1f1f23'); rect(ctx, g.px - 4, yi - 2, PW + 8, 1, '#8d846c');            // the paper slot
  rect(ctx, x0 + w - 13, yi + 1, 8, 8, '#3a3a40'); rect(ctx, x0 + w - 12, yi + 2, 6, 6, '#56565e'); rect(ctx, x0 + w - 10, yi + 4, 2, 2, '#2a2a2e');  // platen knob
  const on = t == null || (Math.floor(t * 40) & 1) === 0;
  rect(ctx, x0 + 8, yi + 4, 3, 2, '#2f9a3a'); rect(ctx, x0 + 14, yi + 4, 3, 2, on ? '#ffb52e' : '#7a5a20');      // ON LINE + busy lights
  txt(ctx, 'LQ-97', x0 + 22, yi + 2, 'bold 9px Tahoma', '#8d846c');
  const hx = Math.round(headX) - 9;                                                                              // the print head
  rect(ctx, hx, yi - 13, 18, 12, '#26262b'); rect(ctx, hx + 1, yi - 12, 16, 1, '#5a5a64'); rect(ctx, hx + 1, yi - 12, 1, 10, '#44444c');
  rect(ctx, hx + 6, yi - 16, 6, 3, '#26262b'); rect(ctx, hx + 7, yi - 16, 4, 1, '#5a5a64');
  rect(ctx, hx + 2, yi - 2, 14, 1, '#b23a32'); rect(ctx, hx + 8, yi - 6, 2, 2, '#e4e4e4');
}
// the part of him printed so far: rows above `rows`, plus `cols` of the current band
function printed(ctx, g, yTop, rows, band, c0, c1) {
  const s = restSprite();
  blitPart(ctx, s, 0, 0, FW, rows, g.ax, yTop);
  if (band > 0 && c1 > c0) blitPart(ctx, s, c0, rows, c1 - c0, band, g.ax + c0, yTop + rows);
}
const NB = 31, P0 = 0.12, P1 = 0.84, BD = (P1 - P0) / NB;
function appear(ctx, t, st) {
  const g = geo(st), r = restSprite();
  if (t >= 1) { blit(ctx, r, g.ax, g.ay); return; }
  // where the feed is: F rows fed; band k being printed, head progress u
  let F = 0, k = -1, u = 0;
  if (t >= P0) {
    const q = (Math.min(t, P1) - P0) / BD; k = Math.min(NB - 1, Math.floor(q)); const f = q - k;
    u = clamp(f / 0.78, 0, 1); const feed = k < NB - 1 ? eOut(seg(f, 0.78, 1)) : 0;
    F = 3 * k + 3 * feed; if (t >= P1) { k = NB; u = 1; F = 90; }
  }
  const yRow0 = g.yL - 3 - F;                       // y of his row 0 on the paper
  const rise = eOut(seg(t, 0, 0.1)), railY = mix(g.h + 8, g.yL, rise);
  const leadTop = mix(g.h, g.yL - 3 - LEAD * 0.4, eOut(seg(t, 0.03, 0.12)));
  const drop = eIn(seg(t, 0.87, 1)) * 190, rip = t > 0.85 ? 2 : 0;
  const sheetTop = (t < P0 ? leadTop : yRow0 - LEAD) - rip + drop;
  // the sheet above the print line (it rips free at 0.85 and drops), then the paper still in the printer
  if (t < 0.85) paper(ctx, g, sheetTop, g.h, F);
  else {
    paper(ctx, g, sheetTop, g.yL - rip + drop, F);
    for (let i = 0; i < PW; i += 6) rect(ctx, g.px + i, g.yL - rip + drop, 3, 2, PAPER);   // the torn zig-zag
    paper(ctx, g, g.yL + 2 + eIn(seg(t, 0.86, 0.97)) * 60, g.h, F);
  }
  // paper bits off the rip
  const bits = seg(t, 0.85, 0.95);
  if (bits > 0 && bits < 1) { const R = rng(13); for (let i = 0; i < 14; i++) { const x = g.px + R() * PW, vx = (R() - 0.5) * 60, vy = -20 - R() * 30; rect(ctx, x + vx * bits, g.yL + vy * bits + 120 * bits * bits, 2, 1 + (i & 1), i % 3 ? PAPER : BAR); } }
  // him: printed rows while printing, then the real sprite once he is torn free
  if (t >= 0.85) blit(ctx, r, g.ax, g.ay);
  else if (k >= 0) {
    const rows = Math.min(FH, 3 * Math.min(k, NB)), band = k < NB ? Math.min(3, FH - rows) : 0;
    const hc = Math.round(mix(-6, FW + 6, k % 2 ? 1 - u : u));
    const c0 = k % 2 ? clamp(hc, 0, FW) : 0, c1 = k % 2 ? FW : clamp(hc, 0, FW);
    printed(ctx, g, yRow0, rows, band, c0, c1);
  }
  // the head screeches across with each band, then the printer drops away once he is out
  const away = eIn(seg(t, 0.86, 0.97)) * 60;
  if (t > 0 && t < 0.97) {
    const hx = k < 0 ? g.ax - 6 : k >= NB ? g.ax + FW + 8 : g.ax + mix(-6, FW + 6, k % 2 ? 1 - u : u);
    const chat = k >= 0 && k < NB && u > 0 && u < 1 ? ((Math.floor(t * 500) & 1) ? 1 : 0) : 0;
    printer(ctx, g, railY + away + chat, hx, k >= 0 && k < NB ? t : null);
    // ink spatter behind the head while it prints
    if (k >= 0 && k < NB && u > 0 && u < 1) { const sx = Math.round(hx), sy = g.yL - 4, R = rng(k * 7 + Math.floor(u * 9)); for (let i = 0; i < 3; i++) rect(ctx, sx + (k % 2 ? 10 : -12) + Math.floor(R() * 4), sy - Math.floor(R() * 8), 1, 1, '#3d4168'); }
  }
}
function disappear(ctx, t, st) {
  const g = geo(st), r = restSprite();
  if (t >= 1) return;
  const up = eOut(seg(t, 0, 0.1)), railY = mix(g.h + 8, g.yL, up);
  const sheetTop0 = mix(g.h, g.ay - LEAD - 6, eOut(seg(t, 0.02, 0.12)));
  // reverse feed: 31 steps of 3 px, the head zips across on each
  const q = clamp((t - 0.14) / 0.64, 0, 1) * NB, k = Math.floor(q), f = q - k, G = Math.min(96, 3 * k + 3 * eOut(seg(f, 0.7, 1)));
  const scroll = -G, tear = t >= 0.82, fall = seg(t, 0.84, 1);
  if (!tear) {
    if (t > 0) paper(ctx, g, sheetTop0 + G, g.h, scroll);
    // him, riding the paper down; anything past the print line is inside the printer
    const y = g.ay + G, vis = Math.max(0, Math.min(FH, g.yL - y));
    if (t < 0.12) blit(ctx, r, g.ax, g.ay); else blitPart(ctx, r, 0, 0, FW, vis, g.ax, y);
  } else {
    // the blank leader tears off at the perforation and flutters down, swaying a column at a time
    const top = sheetTop0 + 96, hgt = Math.round(g.yL - top), dy = eIn(fall) * 210, sw = Math.sin(fall * Math.PI * 2.2) * 0.22, dx = -fall * 40;
    for (let c = 0; c < PW; c += 2) {
      const yo = top + dy + (c - PW / 2) * sw, x = g.px + c + dx;
      rect(ctx, x, yo, 2, hgt - ((c / 2) & 1 ? 2 : 0), PAPER);
      if (c === 0 || c >= PW - 2) rect(ctx, x + (c ? 1 : 0), yo, 1, hgt, EDGE);
      if (((c >> 2) & 1) === 0 && c > 14 && c < PW - 16) rect(ctx, x, yo + 4, 2, 1, BAR);
    }
    paper(ctx, g, g.yL + 1 + eIn(seg(t, 0.86, 0.98)) * 60, g.h, scroll);
  }
  const away = eIn(seg(t, 0.86, 0.98)) * 60;
  if (t > 0 && t < 0.98) printer(ctx, g, railY + away, g.ax + mix(-6, FW + 6, k % 2 ? 1 - f : f), t > 0.14 && t < 0.8 ? t : null);
}
const FX_DEF = { id: 'r1', name: 'Dot-matrix printer', appearMs: 3000, disappearMs: 2400, appear, disappear,
  focus: { w: 300, h: 188 },
  notes: 'In: a print head rises into his spot and prints him onto tractor-feed paper three rows a pass, line-feeding between passes; the sheet rips at the perforation and drops away behind him. Out: the paper shoots up behind him, the printer pulls him back in row by row, and the blank leader tears off and flutters down.',
  sound: 'Dot-matrix screech on every pass (eeee-eeee), a ratchet click on each line feed, a sharp paper rip, a soft flutter.' };

(window.registerFx || function (d) { window.FX = d; })(FX_DEF);
})();
