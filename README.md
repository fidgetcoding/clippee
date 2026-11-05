# Clippee by Microshaft

**The paperclip is back, and this time he read your doc. Notes and one-click fixes for Google Docs.**

It looks like you’re reading a README. Would you like help?

Short version: [ESSENCE.md](ESSENCE.md). How he got built, round by round: [EVOLUTION.md](EVOLUTION.md).

Clippee is the paperclip from Office 97, back from the dead, with a brain this time. He’s a Chrome extension that lives in Google Docs. He reads what you wrote, gives you a short list of notes pinned to the exact spots in your doc, and has a fix ready for each one by the time you look. Every fix shows up as a before and after, and nothing in your doc changes until you click Apply. Then he leaves you alone. Mostly.

He runs on Claude, with your own Anthropic API key.

## Why I made this

In 1997, Clippy could tell you were writing a letter. He had nothing to say about the letter.

That was the whole problem. Right idea, no intelligence behind it. Twenty nine years later the missing half exists, so I put it in.

Before writing any code I checked who else was doing this. Grammarly already puts an AI writing assistant inside Google Docs for 40 million people a day. Google built the same thing into Docs itself. I lost the race before I started.

I built it anyway. Nobody wants a Grammarly. People want Clippy. The paperclip is the product.

## The legal strategy (Microsoft, please read this part)

Microsoft has a pending trademark application for CLIPPY. It covers software.

This is software. It’s called Clippee, by Microshaft.

My lawyer would tell me not to do this. I don’t have a lawyer. That’s also part of the strategy.

Here is the business plan in full:

1. Microsoft finds a free browser extension called Clippee, by Microshaft.
2. Microsoft’s lawyers send me a cease and desist.
3. I frame it.
4. I post a photo of the frame.
5. “Microsoft legally asked me to stop making Clippy useful” becomes the most viewed thing I’ve ever made.
6. I rename him to something nobody owns. Clippo. Paperclip Guy. Steve.
7. Everyone who saw the post installs Steve.

What the letter costs me: one rename. What the same reach costs in ads: more than I have.

A cease and desist is the only marketing a trillion dollar company will ever do for me for free. It arrives on letterhead. Someone with a law degree had to read my README to write it. That’s more engagement than most of my posts get.

And no, that isn’t Clippy. Look closer. That’s Clippee. Heavier eyebrows. Rounder head. A bottom loop that, if you squint, explains the name Microshaft. All 18 of his animations are redrawn from scratch on the original 1997 timings, so he blinks where Clippy blinked and knocks on the glass where Clippy knocked. The resemblance is the point. It took seven rounds to get exactly this close.

Microsoft retired him in 2001 and spent the next 25 years putting him in jokes, stickers, and Teams backgrounds. They know he’s better than they let him be. I’m just finishing the job.

Dear Microsoft legal: you own GitHub. You know where I live. Please use the nice paper.

## Install

You need three things:

- **Chrome**, or another Chromium browser that loads unpacked extensions (Arc, Brave, Edge, Opera, Vivaldi). I test in Chrome.
- **Node.js 22.12 or newer.** 20.19 works too.
- **An Anthropic API key.** Get one at [console.anthropic.com](https://console.anthropic.com/settings/keys). Opening the panel has him write fixes with Claude on your key, so it spends your credits.

**1. Build it**

```bash
git clone https://github.com/fidgetcoding/clippee.git
cd clippee
npm install
npm run build
```

The extension lands in `dist/`.

**2. Load it into Chrome**

1. Go to `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `dist` folder.
4. Pin **Clippee by Microshaft** to the toolbar so you can find him.

Leave the folder where it is. Chrome knows the extension by its path, so a moved folder comes back as a brand new extension with empty Settings.

**3. Give him your key**

Click the toolbar button and paste your key into **Step 1 · Your Claude API key**. It’s stored on this machine only, never synced, and it stays in the extension’s background worker, so the page you’re writing in never sees it. If your key says it needs a workspace, open **Key says it needs a workspace?** and paste the workspace ID.

**4. Open a Google Doc**

Open any doc at `docs.google.com/document/d/…`. If the doc was already open before you installed him, reload the tab. He has to get in before Docs starts up, or the page stays unreadable to him.

He shows up in the corner and says hello. Click him to open the panel. `Alt+Shift+C` shows or hides him.

**Updating**

```bash
git pull
npm install
npm run build
```

Then hit the reload arrow on his card at `chrome://extensions` and reload your Doc tab.

**Firefox:** run `npm run build:firefox`, go to `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on**, and pick `dist-firefox/manifest.json`. Firefox forgets temporary add-ons when it restarts. The Firefox build compiles, but I do all my testing in Chrome, so treat Firefox as untried.

**Bring your own paperclip.** Characters load as data from `src/packs/<name>/`: a sprite sheet (`map.png`) and a timing file (`pack.json`), in the same format clippy.js uses. Clippee lives in `src/packs/clippee/`. Draw your own, or bring one you have the rights to.

## What he actually does

**He reads Google Docs.** Google Docs draws your text as a picture, which normally leaves extensions blind. I took apart the code Google ships to every browser and found the switch that lets an extension read the page. It doesn’t check who’s asking. Any value turns it on.

**He leaves notes you can find.** Every note points at a real passage. Hover one and he highlights it in your doc, bright yellow with a red underline, the way clicking a comment does. He catches what spellcheck can’t: the same phrase twice within a few paragraphs, a run of sentences that all start the same way, a paragraph twice your average length, hedges, weasel words, wordiness, passive voice. For reading level, seven readability formulas vote, and when most of them say it’s hard, he points at the one sentence doing the most damage.

His first real catch was in a comic script of mine: “the same man the reader met on p12,” written twice. He was right. I was annoyed.

**He has the fix ready.** When you open the panel he starts writing a fix for every note in the background, a few at a time, so most rows already have Apply waiting. Each fix is a before and after with only the changed words marked. Apply it or skip it. An applied fix gets Undo, and Undo turns into Redo. **Fix all** does the whole list, with one Undo for the set.

**You can talk to him on every screen.** The Ask box sits at the bottom of every view. Ask about a fix, ask him to change something, or tell him what to do with the panel. “hide applied”, “undo all”, “go back” and “snooze 1h” run instantly on your machine with no call to Claude, and “hid applied” still works. Anything looser goes to Claude with a snapshot of the panel. He presses the same buttons you would, then tells you in one line what he did.

**He knows when to shut up.** This is the part 1997 got wrong. He waits for 15 seconds of quiet, speaks up on his own at most once every 10 minutes, and never interrupts you mid thought. Wave off the same kind of tip three times and he never shows it again. Clippy learned nothing. Clippee learns that.

**He checks your structure when you ask.** Type “check my structure” and he looks for things your intro promises that the rest of the doc never delivers.

**He looks the part.** A cream speech balloon with an indigo ribbon, beveled buttons, Tahoma and etched group boxes, all a few shades off the Windows 98 originals. He stands on his own next to the panel, never boxed inside it.

**He’s fast where it counts.** The local checks read an 11,000 word document in about 64 milliseconds. The fixes come from Claude and take longer, which is why he writes them while you read.

## Not done yet

- **Memory of your own writing.** He can search the Drive folders you pick and tell you when today’s draft contradicts something you wrote four months ago. The code exists. It needs a Google Cloud sign in setup I haven’t done yet, so it’s off.
- **A folder picker** for choosing those folders.
- **CI.** The tests run on my machine. None of them touch a real Google Doc: the suite uses a fake Docs shaped like the live one, and I check the real thing by hand in my own Chrome.
- **Running the panel from plain words** passes its tests, but it hasn’t had much real use against the live API yet. Expect him to misread a loose request now and then.

## For developers

```bash
npm run dev            # watch mode
npm test               # 285 tests across 34 files
npm run typecheck
npm run build          # Chromium build into dist/
npm run build:firefox  # Firefox build into dist-firefox/
```

Where things live:

- `src/docs/`: the Google Docs bridge. It sets the page flag, reads the text, moves the selection and writes edits.
- `src/checks/`: the local checks.
- `src/scheduler/`: the rules for when he’s allowed to speak.
- `src/agent/`: the Claude calls, the prompts, the edit tool and the panel tool.
- `src/content/`: the panel, notes, previews, Undo and the Ask box.
- `src/character/`: the animation engine.
- `src/background/`: the service worker, which holds your key and makes the API calls.
- `src/popup/`: Settings.
- `src/corpus/`: Drive memory, built and switched off.
- `src/packs/`: character packs.

Edits go through the page, not the Docs API. He selects the passage, pastes the replacement into Docs’ own text box, then reads the doc back to check it landed. That’s why there’s no Google Cloud project or sign in to set up. The model is `claude-opus-5-5`, set in `src/agent/client.ts`.

## Credits

- [clippy.js](https://github.com/clippyjs/clippy.js) (MIT): the animation engine, ported to TypeScript without jQuery.
- [Harper](https://github.com/Automattic/harper) (Apache 2.0): the approach for reading Google Docs.
- Kevan Atteberry: the original 1997 paperclip, which Clippee is shamelessly in awe of. Legend.

Full notices in [NOTICE.md](NOTICE.md).

## License

The code is MIT © Nate Davidovich, and so is Clippee. The old paperclip was never mine to give away. This one is.
