/* ============================================================================
   retro.js — the shared 1997 treatment for the Clippee character lab (round 2).
   Classic script, no modules. Exposes:

     retro(ctx, mode)                    process a canvas in place (any size; built for 124 x 93)
     retroRender(drawFn, pose, mode, out) draw drawFn(ctx, pose) at 3x, area-average down to
                                          124 x 93, run retro(), return the 124 x 93 canvas

   mode 'prerender'  smooth shading snapped to a fixed 52-colour palette (steel ramp, eye
                     whites and greys, near-blacks, pale paper yellows and rules, a few
                     accents, the four Microshaft logo colours), nearest colour, NO dither:
                     gradients come out banded like a squeezed 3-D render.
   mode 'gif'        the 216 web-safe colours with a 4 x 4 ordered (Bayer) dither, per channel.
                     Near-blacks and near-whites are locked solid (no salt-and-pepper on
                     brows, pupils or eye whites). The four logo colours (glint.js) are
                     locked to fixed web-safe picks, so the pupil mark never flickers.
   both              hard 1-bit alpha: alpha >= 128 becomes fully opaque, the rest fully
                     transparent. Colours are never blended with the page.

   drawFn gets a context already scaled by 3, so it draws in the usual 124 x 93 frame units.
   Pass `out` (a 124 x 93 canvas) to reuse one canvas per animation; otherwise a new one is made.
   ========================================================================== */
(function () {
  'use strict';
  var FW = 124, FH = 93, SS = 3;
  var BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

  // ---- 'prerender' palette: 52 colours ------------------------------------------------
  var PRE_HEX = [
    // steel, cool lavender grey, 12 steps (the wire)
    '#16172a', '#23253f', '#313456', '#40446c', '#505583', '#62679a', '#7579ad', '#898dbf', '#9ea2cf', '#b4b7de', '#cbcdea', '#e2e3f4',
    // whites and neutral greys (eyes, highlights)
    '#ffffff', '#f1f1f4', '#dcdce3', '#c3c3cc', '#a4a4ae', '#7e7e88',
    // near-blacks (brows, pupils)
    '#0b0b10', '#1d1d26', '#33333d',
    // pale paper yellows, light to shadow
    '#fffde6', '#fbf6cf', '#f4edb7', '#eae19f', '#ddd18a', '#cbbd74', '#b4a65f', '#958848',
    // paper rules: grey-green and blue-grey
    '#c9c9a8', '#b2b394', '#9fb2c8', '#c7d3e0',
    // pencil yellow, wood, red ink, eraser pink
    '#ffe27a', '#f5c037', '#d59a1c', '#a8711a', '#e9c493', '#c99561', '#e8584a', '#c33a30', '#8e2620', '#f09aa8', '#c86478',
    // a few stray hues so unexpected colours land somewhere sensible
    '#5aa05a', '#2f6e3a', '#3d6fd0', '#1f3f8a',
    // the Microshaft logo, exact (glint.js pupil mark): without these the green snaps to paper olive
    '#e05a2e', '#8fae2a', '#3a80cc', '#f2ad2a'
  ];
  var PRE = PRE_HEX.map(function (h) { var n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; });
  var preLUT = new Int16Array(32768).fill(-1); // 15-bit colour -> palette index, filled lazily

  // 'gif': the logo colours lock to fixed web-safe picks (red, green, blue, yellow), no dither
  var LOGO = [[224, 90, 46, 255, 102, 51], [143, 174, 42, 153, 204, 51], [58, 128, 204, 51, 153, 204], [242, 173, 42, 255, 204, 51]];

  function nearestPre(r, g, b) {
    var key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3), k = preLUT[key];
    if (k >= 0) return k;
    var rr = (r & 248) | 4, gg = (g & 248) | 4, bb = (b & 248) | 4, best = 0, bd = 1e12;
    for (var i = 0; i < PRE.length; i++) {
      var p = PRE[i], m = (rr + p[0]) / 2, dr = rr - p[0], dg = gg - p[1], db = bb - p[2];
      var d = (2 + m / 256) * dr * dr + 4 * dg * dg + (2 + (255 - m) / 256) * db * db; // "redmean" perceptual weighting
      if (d < bd) { bd = d; best = i; }
    }
    preLUT[key] = best; return best;
  }

  function retro(ctx, mode) {
    var cv = ctx.canvas, w = cv.width, h = cv.height;
    var img = ctx.getImageData(0, 0, w, h), d = img.data, gif = mode === 'gif';
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var i = (y * w + x) * 4;
      if (d[i + 3] < 128) { d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0; continue; } // hard 1-bit alpha
      d[i + 3] = 255;
      var r = d[i], g = d[i + 1], b = d[i + 2];
      if (gif) {
        var mx = r > g ? (r > b ? r : b) : (g > b ? g : b), mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
        if (mx < 45) { d[i] = 51 * Math.floor(r / 51 + 0.3); d[i + 1] = 51 * Math.floor(g / 51 + 0.3); d[i + 2] = 51 * Math.floor(b / 51 + 0.3); continue; }
        if (mn > 232) { d[i] = d[i + 1] = d[i + 2] = 255; continue; }
        var L = null;
        for (var li = 0; li < 4; li++) { var c = LOGO[li]; if (Math.abs(r - c[0]) < 7 && Math.abs(g - c[1]) < 7 && Math.abs(b - c[2]) < 7) { L = c; break; } }
        if (L) { d[i] = L[3]; d[i + 1] = L[4]; d[i + 2] = L[5]; continue; }
        var t = (BAYER[((y & 3) << 2) | (x & 3)] + 0.5) / 16;
        d[i] = 51 * Math.min(5, Math.floor(r / 51 + t));
        d[i + 1] = 51 * Math.min(5, Math.floor(g / 51 + t));
        d[i + 2] = 51 * Math.min(5, Math.floor(b / 51 + t));
      } else {
        var p = PRE[nearestPre(r, g, b)]; d[i] = p[0]; d[i + 1] = p[1]; d[i + 2] = p[2];
      }
    }
    ctx.putImageData(img, 0, 0);
    return ctx;
  }

  // ---- 3x draw, exact 3 x 3 box downsample (premultiplied), retro ------------------------
  var big = null, bctx = null;
  function retroRender(drawFn, pose, mode, out) {
    if (!big) { big = document.createElement('canvas'); big.width = FW * SS; big.height = FH * SS; bctx = big.getContext('2d', { willReadFrequently: true }); }
    bctx.setTransform(1, 0, 0, 1, 0, 0); bctx.clearRect(0, 0, big.width, big.height);
    bctx.save(); bctx.setTransform(SS, 0, 0, SS, 0, 0); drawFn(bctx, pose); bctx.restore();
    var src = bctx.getImageData(0, 0, big.width, big.height).data, BW = big.width;
    if (!out) { out = document.createElement('canvas'); out.width = FW; out.height = FH; }
    var octx = out.getContext('2d', { willReadFrequently: true }), img = octx.createImageData(FW, FH), d = img.data;
    for (var y = 0; y < FH; y++) for (var x = 0; x < FW; x++) {
      var r = 0, g = 0, b = 0, a = 0;
      for (var sy = 0; sy < SS; sy++) {
        var row = ((y * SS + sy) * BW + x * SS) * 4;
        for (var sx = 0; sx < SS; sx++) { var j = row + sx * 4, al = src[j + 3]; r += src[j] * al; g += src[j + 1] * al; b += src[j + 2] * al; a += al; }
      }
      var k = (y * FW + x) * 4;
      if (a > 0) { d[k] = r / a; d[k + 1] = g / a; d[k + 2] = b / a; d[k + 3] = a / (SS * SS); }
    }
    octx.putImageData(img, 0, 0);
    retro(octx, mode);
    return out;
  }

  window.retro = retro;
  window.retroRender = retroRender;
  window.RETRO_PALETTE = PRE_HEX.slice(); // the 'prerender' palette, for swatches
})();
