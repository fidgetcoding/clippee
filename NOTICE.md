# Third-party notices

## clippy.js — MIT

`src/character/Animator.ts`, `Queue.ts` and `Balloon.ts` are ports of
`src/animator.js`, `src/queue.js` and `src/balloon.js` from
[clippy.js](https://github.com/clippyjs/clippy.js), rewritten in TypeScript
without jQuery. The character pack format in `src/character/types.ts` follows the
same data shape.

> Copyright © Smore Inc.
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of
> this software and associated documentation files (the "Software"), to deal in
> the Software without restriction, including without limitation the rights to
> use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
> the Software, and to permit persons to whom the Software is furnished to do so,
> subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
> FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
> COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
> IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
> CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

The clippy.js license explicitly covers its code only.

## Character artwork — NOT licensed

`src/packs/clippy/map.png` and `src/packs/clippy/pack.json` contain the Clippit
sprite sheet and animation timings. **These are Microsoft's property and no
licence to them is granted by anyone**, including clippy.js, whose own licence
states this in as many words.

The character was designed by **Kevan Atteberry**.

This repository is a personal, non-distributed tool, which is why the pack is
present. Character packs are loaded as data at runtime rather than imported, so a
public build ships an original character and lets a user side-load this one. Any
public or commercial release must not bundle this directory.

The speech balloon is authored CSS in `src/content/styles.css` and contains no
Microsoft artwork.

## Automattic/harper — Apache-2.0

`src/docs/` follows the Google Docs integration approach shipped in
[harper](https://github.com/Automattic/harper) `packages/chrome-plugin`: setting
`window._docs_annotate_canvas_by_ext` from a main-world script at
`document_start`, then reading the `rect[aria-label]` nodes the annotated canvas
emits. The bridge protocol — `CustomEvent` on `document`, versioned envelope,
request ids, per-request timeouts — is modelled on their
`GoogleDocsBridgeClient`.

The code here is an independent implementation; the mechanism and protocol shape
are theirs. Apache-2.0, which permits this with attribution.
