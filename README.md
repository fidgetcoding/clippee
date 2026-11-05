# Clippee by Microshaft

**It looks like you’re reading a README. Would you like help?**

Clippee is the paperclip from Office 97, back from the dead, with a brain this time. He lives in Google Docs, reads what you wrote, and tells you something useful about it. Then he leaves you alone. Mostly.

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

And yes, that’s the real Clippy. Same sprite sheet. Same 43 animations. Same eyebrows. The art belongs to Microsoft (drawn by Kevan Atteberry, who deserves all of the credit and none of this), and nobody gave me permission to use it. I checked. Nobody gave anyone permission. Clippy has been living on the internet unlicensed since 1997, and it’s the most fun he’s ever had.

Microsoft retired him in 2001 and spent the next 25 years putting him in jokes, stickers, and Teams backgrounds. They know he’s better than they let him be. I’m just finishing the job.

Dear Microsoft legal: you own GitHub. You know where I live. Please use the nice paper.

## What he actually does

**He reads Google Docs.** Google Docs draws your text as a picture, which normally leaves extensions blind. I took apart the code Google ships to every browser and found the switch that lets an extension read the page. It doesn’t check who’s asking. Any value turns it on.

**He catches what spellcheck can’t.** The same phrase used twice three pages apart. Every paragraph opening the same way. Sentences that all run the same length. Readability scored by seven formulas that vote. 66 checks in all.

His first real catch was in a comic script of mine: “the same man the reader met on p12,” written twice. He was right. I was annoyed.

**He knows when to shut up.** This is the part 1997 got wrong. He waits for 15 seconds of quiet, speaks at most once every 10 minutes, and never interrupts you mid thought. Wave off the same kind of tip three times and he never shows it again. Clippy learned nothing. Clippee learns that.

**He edits when you ask.** Click him, tell him what to fix, and he fixes it. When he’s guessing on his own, he suggests instead, and you accept or reject.

**He checks your structure.** He notices when your intro promises a section you never wrote.

**He looks right.** Navy title bar. Beveled buttons. MS Sans Serif. Zero rounded corners.

**He’s fast.** An 11,000 word document takes him 63 milliseconds.

## Install

You need Node.js and an Anthropic API key.

```bash
git clone https://github.com/fidgetcoding/clippee.git
cd clippee
npm install
npm run build
```

**Chrome, Arc, Brave, Edge, Opera, Vivaldi:** go to `chrome://extensions`, turn on Developer mode, click **Load unpacked**, and pick the `dist` folder.

**Firefox:** run `npm run build:firefox`, go to `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on**, and pick `dist-firefox/manifest.json`.

Then click the extension icon, paste your Anthropic API key, and open a Google Doc. Your key stays on your machine and never touches the page you’re writing in.

**Bring your own paperclip.** Characters load as data from `src/packs/<name>/`: a sprite sheet (`map.png`) and a timing file (`pack.json`), in the same format clippy.js uses. Draw your own, or bring one you have the rights to.

## Not done yet

- **Memory of your own writing.** He can search the Drive folders you pick and tell you when today’s draft contradicts something you wrote four months ago. The code exists. It needs a Google Cloud sign in setup I haven’t done yet, so it’s off.
- **A folder picker** for choosing those folders.
- **Live testing of edits** written straight into a Doc.

## For developers

```bash
npm run dev         # watch mode
npm test            # regression suite
npm run typecheck
```

## Credits

- [clippy.js](https://github.com/clippyjs/clippy.js) (MIT): the animation engine, ported to TypeScript without jQuery.
- [Harper](https://github.com/Automattic/harper) (Apache 2.0): the approach for reading Google Docs.
- Kevan Atteberry: the original paperclip. Legend.

Full notices in [NOTICE.md](NOTICE.md).

## License

The code is MIT © Nate Davidovich. The paperclip in `src/packs/clippy/` is Microsoft’s, and the MIT license doesn’t cover it. The code is mine to give away. The paperclip never was.
