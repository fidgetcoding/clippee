# Clippee by Microshaft: the essence

**What it is.** A Chrome extension that puts the paperclip back on your screen, this time in Google Docs with Claude behind him. He reads your doc, lists notes pinned to the exact passages, writes a fix for each one in the background, and shows every fix as a before and after you apply or skip. There's an Ask box on every screen, and you can run the whole panel by typing what you want in plain words.

**Who it's for.** Anyone who writes in Google Docs, has an Anthropic API key, and misses the paperclip. Also anyone curious how an extension reads a Google Doc at all, since Docs draws your text as a picture.

**Why it exists.** In 1997 Clippy could tell you were writing a letter and had nothing to say about the letter. Right idea, no brain. The brain exists now. Grammarly and Google already put AI writing help inside Docs, so I lost that race before I started. I built it anyway, because nobody wants another Grammarly. People want the paperclip.

**What's different.**

- He's a character, not a sidebar. He stands on his own next to your doc, animates, and talks in a speech balloon.
- He knows when to shut up. He waits for 15 seconds of quiet, speaks up on his own at most once every 10 minutes, and a kind of tip you wave off three times never comes back.
- Nothing in your doc changes until you click. Every fix is a preview with Apply or Skip, every applied fix has Undo, and Undo turns into Redo. Fix all does the lot with one Undo.
- The fixes are already written when you look. Opening the panel starts drafting them in the background, three at a time after the first one warms Claude's cache.
- Hover a note and he highlights its passage in the doc, like clicking a comment.
- The panel runs itself from the chat. "hide applied", "undo all" and even "hid applied" run on your machine with no call to Claude. Anything looser goes to Claude with a snapshot of the panel, and he presses the same buttons you would.
- Your key stays in the extension's background worker. The page you're writing in never sees it, and edits go through the page, so there's no Google Cloud setup.

**How to try it.** It's a private build you load yourself:

```bash
git clone https://github.com/fidgetcoding/clippee.git
cd clippee
npm install
npm run build
```

Load `dist/` at `chrome://extensions` with Developer mode on, paste your key into the toolbar popup, and open (or reload) a Google Doc. The full steps are in the [README](README.md#install).

**What works today.**

- 280 of 280 tests pass across 33 files at `0b1a173`, with strict types and both the Chromium and Firefox builds. That's my own run on November 5, 2026. There's no CI on this repo yet.
- The local checks read an 11,040 word document in 64 ms (`tests/size.bench.test.ts`, same run).
- The release commit `39e96d6` passed 249 tests plus 15 checks on the built extension in clean Chromium profiles: startup, panel open and close, enable and disable, and settings that survive a full browser restart.
- In my own Chrome on my own Google Docs: reading a real doc (his first catch was a phrase I'd written twice in a comic script), replacing, deleting and splitting text through the page, and the preview, Apply and Undo flow.
- The character on screen is still the original 1997 sprite pack in `src/packs/clippy/`, which the MIT license doesn't cover. See [NOTICE.md](NOTICE.md).
- Running the panel from plain words passes its tests but hasn't had much real use against the live API yet. Firefox builds, but I test in Chrome.
