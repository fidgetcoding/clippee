/* ============================================================================
   d/x/xkit.js · family x (Epic) helpers, shared by x1..x5 fx.js. Classic script.
   Load after kit/retro.js + kit/clippee-rig.js and before fx.js. Ports with the winning fx.js.

   registerFx(def)                 stores the option's effect as window.FX (defers to a kit one if present)
   XK.sprite(pose)                 Clippee through retroRender 'prerender', cached: a 124 x 93 canvas
   XK.him(ctx, stage, pose, dx, dy, clip?)
                                   draws him 1:1 at the anchor + (dx, dy), whole stage pixels, never scaled
                                   or rotated; clip = [x, y, w, h] in stage px keeps only that part
   XK.layer(ctx, x, y, w, h, k, draw)
                                   effects: draw(lctx) in stage coords into a layer 1/k the size, then every
                                   pixel snaps to the FX palette with 1-bit alpha and lands as k x k blocks
                                   on a stage-wide grid (k = 1 matches his pixels, 2 or 3 is chunky)
   XK.checker(lctx, col, k, odd)   a 50% checker fill (the 1997 way to show light), aligned to the grid
   XK.block(ctx, x, y, k, col)     one k x k pixel on the grid
   XK.spark(ctx, x, y, size, col, k)  a cross-shaped twinkle (size 0..3)
   XK.puff(lctx, x, y, r, tone)    a banded smoke ball (call inside a layer)
   XK.cloud(lctx, x, y, r, tone, seed)  a lumpy cartoon cloud with a dark rim: dust, light, dark, magic, fire
   XK.hash(a, b, c)                fixed-seed noise in 0..1, so every effect stays a pure function of t
   XK.seg(t, a, b)                 0..1 progress of t through [a, b]; XK.ease.* easing curves
   Rules kept here: no globalAlpha, no blur, no gradients that survive the palette snap as smooth.
   ============================================================================ */
(function () {
  'use strict';
  const R = window.ClippeeRig;

  const prev = window.registerFx;
  window.registerFx = function (def) { window.FX = def; if (typeof prev === 'function') { try { prev(def); } catch (e) { /* kit stage owns it */ } } return def; };

  /* ---------- palette: the kit's 52 'prerender' colours plus the effect ramps ---------- */
  const HEX = (window.RETRO_PALETTE || []).concat([
    '#000000', '#404040', '#808080', '#c0c0c0', '#e0e0e0',
    '#f9fbfd', '#e3e7ec', '#c4cad2', '#9aa1ab', '#6a717b', '#454a52',          // the Docs canvas greys, cracks, dust
    '#fff4b0', '#ffd84a', '#ffa424', '#f26a1c', '#d2361a', '#8a1c12',          // fire
    '#f4f4f6', '#d6d7dc', '#b0b2ba', '#86888f', '#5c5e66', '#36373d',          // smoke
    '#2a060c', '#4e0c16', '#761420', '#a01e2c', '#c8303c', '#e65a58',          // velvet
    '#5c3c0a', '#8c6414', '#c49424', '#ecc44a', '#fff09a',                     // gold
    '#3e2412', '#6a3e1e', '#965c2c', '#c2864a',                                // stage boards
    '#08204e', '#123e94', '#2a6ed8', '#5aaaf6', '#a4dcff', '#dcf6ff',          // beam
    '#ffd6e0', '#b06ad0', '#6a2a9a', '#1a1030'                                 // magic
  ]);
  const PAL = HEX.map(h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; });
  const LUT = new Int16Array(32768).fill(-1);
  function nearest(r, g, b) {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3); let k = LUT[key];
    if (k >= 0) return k;
    const rr = (r & 248) | 4, gg = (g & 248) | 4, bb = (b & 248) | 4; let bd = 1e12; k = 0;
    for (let i = 0; i < PAL.length; i++) {
      const p = PAL[i], m = (rr + p[0]) / 2, dr = rr - p[0], dg = gg - p[1], db = bb - p[2];
      const d = (2 + m / 256) * dr * dr + 4 * dg * dg + (2 + (255 - m) / 256) * db * db;
      if (d < bd) { bd = d; k = i; }
    }
    LUT[key] = k; return k;
  }
  function snap(c, w, h) {
    const img = c.getImageData(0, 0, w, h), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) { d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0; continue; }
      const q = PAL[nearest(d[i], d[i + 1], d[i + 2])]; d[i] = q[0]; d[i + 1] = q[1]; d[i + 2] = q[2]; d[i + 3] = 255;
    }
    c.putImageData(img, 0, 0);
  }

  /* ---------- Clippee ---------- */
  const cache = new Map(), pxCache = new Map();
  const audit = { bad: 0, sprites: 0 };
  function sprite(p) {
    p = R.rest(p); // partial poses fill in from REST (paper off), never from POSE0
    if (p.scale !== 1 || p.dx || p.dy || p.tilt) audit.bad++;
    const key = JSON.stringify(p);
    let c = cache.get(key);
    if (!c) {
      if (cache.size > 900) { cache.clear(); pxCache.clear(); }
      c = retroRender(R.drawClippee, p, 'prerender');
      c.__clippee = true; cache.set(key, c); audit.sprites++;
    }
    return c;
  }
  function pixels(p) { // his opaque pixels for a pose: [{x, y, c:[r,g,b]}] in sprite space
    const key = JSON.stringify(R.rest(p)); let a = pxCache.get(key);
    if (a) return a;
    const c = sprite(p), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; a = [];
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) { const i = (y * c.width + x) * 4; if (d[i + 3]) a.push({ x, y, c: [d[i], d[i + 1], d[i + 2]] }); }
    pxCache.set(key, a); return a;
  }
  function him(ctx, stage, p, dx, dy, clip) {
    const s = sprite(p), x = stage.anchor.x + Math.round(dx || 0), y = stage.anchor.y + Math.round(dy || 0);
    if (clip) { ctx.save(); ctx.beginPath(); ctx.rect(Math.round(clip[0]), Math.round(clip[1]), Math.round(clip[2]), Math.round(clip[3])); ctx.clip(); }
    ctx.drawImage(s, x, y);
    if (clip) ctx.restore();
  }

  /* ---------- pixel layers ---------- */
  const LC = document.createElement('canvas'); LC.width = 64; LC.height = 64;
  const LX = LC.getContext('2d', { willReadFrequently: true });
  function layer(ctx, x, y, w, h, k, draw) {
    k = k || 1;
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    const x0 = Math.max(0, Math.floor(x / k) * k), y0 = Math.max(0, Math.floor(y / k) * k);
    const x1 = Math.min(Math.ceil(cw / k) * k, Math.ceil((x + w) / k) * k), y1 = Math.min(Math.ceil(ch / k) * k, Math.ceil((y + h) / k) * k);
    if (x1 <= x0 || y1 <= y0) return;
    const lw = (x1 - x0) / k, lh = (y1 - y0) / k;
    if (LC.width < lw || LC.height < lh) { LC.width = Math.max(LC.width, lw); LC.height = Math.max(LC.height, lh); }
    LX.setTransform(1, 0, 0, 1, 0, 0); LX.clearRect(0, 0, lw, lh);
    LX.save(); LX.setTransform(1 / k, 0, 0, 1 / k, -x0 / k, -y0 / k); LX.__k = k;
    draw(LX);
    LX.restore();
    snap(LX, lw, lh);
    ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(LC, 0, 0, lw, lh, x0, y0, lw * k, lh * k); ctx.restore();
  }
  const pats = new Map();
  function checker(lctx, col, k, odd) { // fill style: one stage-grid block on, one off
    k = k || lctx.__k || 1; const key = col + '|' + (odd ? 1 : 0);
    let pc = pats.get(key);
    if (!pc) { pc = document.createElement('canvas'); pc.width = pc.height = 2; const g = pc.getContext('2d'); g.fillStyle = col; g.fillRect(odd ? 1 : 0, 0, 1, 1); g.fillRect(odd ? 0 : 1, 1, 1, 1); pats.set(key, pc); }
    const pt = lctx.createPattern(pc, 'repeat'); pt.setTransform(new DOMMatrix([k, 0, 0, k, 0, 0]));
    return pt;
  }
  function block(ctx, x, y, k, col) { k = k || 1; ctx.fillStyle = col; ctx.fillRect(Math.floor(x / k) * k, Math.floor(y / k) * k, k, k); }
  function spark(ctx, x, y, size, col, k) { // 0 dot · 1 small plus · 2 plus · 3 long star; centre always white
    k = k || 1; x = Math.floor(x / k) * k; y = Math.floor(y / k) * k; ctx.fillStyle = col;
    const arm = [0, 1, 2, 4][Math.max(0, Math.min(3, Math.round(size)))];
    if (arm) { ctx.fillRect(x - arm * k, y, (arm * 2 + 1) * k, k); ctx.fillRect(x, y - arm * k, k, (arm * 2 + 1) * k); }
    if (size >= 3) { ctx.fillRect(x - k, y - k, k, k); ctx.fillRect(x + k, y - k, k, k); ctx.fillRect(x - k, y + k, k, k); ctx.fillRect(x + k, y + k, k, k); }
    ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y, k, k);
  }
  const TONES = { light: ['#86888f', '#b0b2ba', '#d6d7dc', '#f4f4f6'], dark: ['#36373d', '#5c5e66', '#86888f', '#b0b2ba'], dust: ['#9aa1ab', '#c4cad2', '#e3e7ec', '#f9fbfd'] };
  const CLOUD = { dust: ['#9aa1ab', '#e3e7ec', '#ffffff'], light: ['#86888f', '#d6d7dc', '#f4f4f6'], dark: ['#36373d', '#5c5e66', '#86888f'], magic: ['#6a2a9a', '#ffd6e0', '#ffffff'], fire: ['#d2361a', '#ffa424', '#fff4b0'] };
  const LUMPS = [[0, 0, 1], [-0.62, 0.18, 0.68], [0.6, 0.22, 0.62], [0.08, -0.5, 0.62], [-0.3, -0.3, 0.5]];
  function cloud(lctx, x, y, r, tone, seed) { // a lumpy cartoon cloud: dark rim, body, lit lumps (upper left)
    if (r < 1) return; const T = CLOUD[tone] || CLOUD.light, k = lctx.__k || 1, rot = (seed || 0) * 1.7;
    const L = LUMPS.map(q => { const c = Math.cos(rot), s = Math.sin(rot); return [x + (q[0] * c - q[1] * s) * r, y + (q[0] * s + q[1] * c) * r * 0.85, q[2] * r]; });
    const all = (col, grow, ox, oy, f) => { lctx.fillStyle = col; L.forEach(q => { lctx.beginPath(); lctx.arc(q[0] + ox, q[1] + oy, Math.max(0.5, q[2] * f + grow), 0, Math.PI * 2); lctx.fill(); }); };
    all(T[0], k * 1.2, 0, 0, 1); all(T[1], 0, 0, 0, 1); if (r > 3 * k) all(T[2], 0, -r * 0.18, -r * 0.22, 0.5);
  }
  function puff(lctx, x, y, r, tone) { // banded ball, lit from the upper left
    if (r <= 0.4) return; const T = TONES[tone] || TONES.light;
    const disk = (cx, cy, rr, c) => { lctx.fillStyle = c; lctx.beginPath(); lctx.arc(cx, cy, rr, 0, Math.PI * 2); lctx.fill(); };
    disk(x, y, r, T[0]); disk(x - r * 0.12, y - r * 0.14, r * 0.84, T[1]); disk(x - r * 0.26, y - r * 0.3, r * 0.56, T[2]); disk(x - r * 0.36, y - r * 0.42, r * 0.24, T[3]);
  }

  /* ---------- time + noise ---------- */
  function hash(a, b, c) {
    let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35) ^ Math.imul((c | 0) + 0x27d4eb2f, 0x165667b1);
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }
  const seg = (t, a, b) => t <= a ? 0 : t >= b ? 1 : (t - a) / (b - a);
  const ease = {
    lin: t => t, in: t => t * t, in3: t => t * t * t, out: t => 1 - (1 - t) * (1 - t), out3: t => 1 - Math.pow(1 - t, 3),
    inOut: t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2, sine: t => 0.5 - 0.5 * Math.cos(Math.PI * t),
    back: t => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
    bounce: t => { const n = 7.5625, d = 2.75; if (t < 1 / d) return n * t * t; if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75; if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375; return n * (t -= 2.625 / d) * t + 0.984375; }
  };
  // damped wobble that starts at 1 and settles to 0: amplitude * decay * cos
  const wobble = (t, cycles, decay) => t <= 0 ? 1 : t >= 1 ? 0 : Math.cos(2 * Math.PI * cycles * t) * Math.pow(1 - t, decay || 2);

  window.XK = { sprite, pixels, him, layer, checker, block, spark, puff, cloud, hash, seg, ease, wobble, snap, PAL: HEX, audit, REST: R.REST, rest: R.rest };
})();
