# How Clippee got built

My words are quoted as I wrote them, typos fixed, nothing else. Commit hashes are from this repo. "Private note" means a dated record I keep offline.

## 1. The short version

I wrote the idea down on August 27, 2026, researched it in 11 lanes, specced it in 21 decisions, and had a working Chrome and Firefox extension at 126 passing tests the next day. Then it sat on my machine, uncommitted, for two months.

The real build happened November 2 to 5. In four days he learned to edit Google Docs, show every fix as a preview, write fixes before you ask and run his own panel from plain words. His panel came out of a design lab that opened with 54 options. He was called Mr. Clippy for most of that. On November 5 he became Clippee by Microshaft, with a logo, a palette and art of his own, and that night he became v2: entrances, exits, and more jumping. Then v2.1: a History and Undo on every fixed row, and a Settings that is just the key and a Show / Hide button. Then v2.2, after a bug hunt. The repo went from 126 tests to 354.

## 2. Origin, in my words

Clippy was the right idea with nothing behind it. In 1997 he could tell you were writing a letter and had nothing useful to say about the letter. Twenty nine years later the missing half exists, so I wrote it up as a video idea called Clippo: the paperclip with a real writing agent behind him, living in Google Docs.

The research said I'd already lost. Grammarly's agent shipped into Docs that August for 40 million daily users, and Google built the same help into Docs itself. I built it anyway. Nobody wants another Grammarly. People want Clippy. The character is the product, and the build is the point.

Partway through the first build I stopped everything to write a spec:

> "Really tighten up exactly what it does."

Two months later I went to list it with my other projects and got told it had no code yet. It was running in my Chrome.

> "Wdym there's no code... it's active on my Chrome, we already built it?"

> "It's actually probably the most finished thing I have lol."

Then I asked for the README you're probably reading next to this:

> "This readme needs to be really funny, explain the logic behind hoping to receive a cease and desist..."

## 3. Timeline

| Date (2026) | What happened | Evidence |
|---|---|---|
| Aug 27 | Written up as Clippo, a video idea: Clippy with a real writing agent | Private note |
| Aug 27 to 28 | 11 research lanes. The live Docs bundle decompiled: any value opens the page flag | Private note |
| Aug 28 | 21 decision spec in 5 rounds. Renamed Mr. Clippy | Private note |
| Aug 28 | Extension built: Docs bridge, 66 checks, interruption rules, chat panel, Drive memory (switched off). 126 tests. First live catch | Private note |
| Nov 2 | First commit, with the cease and desist README and the MIT license | `4641f9b` |
| Nov 2 to 3 | Editing in Docs through the page. Two selection bugs found live. 146 tests | `9bac377` |
| Nov 3 | Buttons fixed, editors only, Settings, previews, highlights, threads, background drafts, Fix all. 167 tests | `401688e` |
| Nov 3 | Quick UI tightening, then a 4 round panel design lab. D3 locked | `a11cfd5`, private note |
| Nov 3 | D3 built into the extension. 183 tests | `6e964cf` |
| Nov 4 | Close X on the panel; his own X fixed. 185 tests | `012ff6f` |
| Nov 4 | Hardening release: page lifecycle, settings, document safety. 249 tests plus 15 checks on the built extension | `c58885a` |
| Nov 5 | The closed panel that stayed open. Plainer notes. 254 tests | `d7e725c` |
| Nov 5 | Renamed Clippee by Microshaft | `51417a2`, `552e888` |
| Nov 5 | No key means one line and one Settings window. 257 tests | `d5c1058` |
| Nov 5 | Google Docs only in the description and docs | `4ce9ba2` |
| Nov 5 | Settings opens on every click | `7dae981` |
| Nov 5 | Ask box on every screen; the panel runs from plain words. 280 tests | `388b054` |
| Nov 5 | Palette lab, 2 rounds. Warmer locked | `47f88a3` |
| Nov 5 | Logo lab, 4 rounds and a final. Microshaft icon shipped | `5864105` |
| Nov 5 | Clippee's own art: 18 animations redrawn on the 1997 timings, Microsoft's pack removed, Thinking while fixes draft. 285 tests | `9d0d335` |
| Nov 5 | Tagged v1 | `v1` |
| Nov 5 | v2: random entrances and exits, he comes back after 5 minutes, hops, Victory, a waddle, the mark in the title bar. 311 tests | `v2` |
| Nov 5 | v2.1: Undo on each fixed row, a History per doc, the toolbar button calls him back while he's away, the full name in the title bar. 332 tests | `v2.1` |
| Nov 5 | v2.1.1: X is not a snooze, Settings is just the key and Show / Hide, idles never stall or repeat, a reload never leaves a doc without him. 342 tests | `v2.1.1` |
| Nov 5 | v2.2: the bug hunt's fixes (never stuck hidden, never off screen), the panel keeps its tail, a new small icon, the boot splash banner. 354 tests | `v2.2` |
| Nov 5 | v2.2.1: the cut in every icon and the banner is white | `v2.2.1` |

## 4. Round by round

### Round 1: recon, spec, build (August 27 and 28)

- **Built:** a Chromium and Firefox extension. A Google Docs bridge that sets the page flag at document start and reads text two ways, the annotated API first and the drawn page as a fallback. 66 local checks across 5 tiers, including the document level ones a sentence linter can't reach: echoes, repeated openers, and readability by a vote of seven formulas. The interruption rules as code: 15 seconds of quiet, one tip per 10 minutes, three wave offs and a kind of tip is gone for good. The clippy.js animation engine ported to TypeScript without jQuery. A chat panel that calls Claude from the background worker so the key never touches the page. Drive memory, built and left switched off.
- **Tested:** 126 of 126 tests, clean typecheck, both builds. The checks ran 11,000 words in 63 ms. Live, signed in, on a doc I own: he read it, and his first catch was "the same man the reader met on p12", written twice in one of my comic scripts.
- **Broke:** the window closing bug took three tries. The real cause was a lock taken after an await, so anything firing in that gap hit an unlocked balloon. The manifest never declared `action`, so the toolbar click handler did nothing. Two content scripts named `index.ts` collided and failed the build. A heading and its body text got split because they shared a baseline. Documents under 80 characters were invisible to Drive memory. The hedging check fired on "which was its own kind of win".
- **Fixed:** the lock is claimed the moment you click. `action` declared, the Docs script renamed, lines banded on their vertical center, short notes indexed, and "kind of", "sort of", "fairly" and "rather" dropped from the hedge list.
- **Wanted next:** Google sign in for Drive memory, a folder picker, and a real test of writing into a Doc.

### Round 2: first commit, and he edits (November 2 and 3)

- **Built:** the first commit, `4641f9b`. Then an `edit_document` tool: find and replace that matches curly and straight quotes and Docs' odd spaces, refuses when a match isn't unique, reads the doc back to confirm each edit landed, explains failures in plain English, and undoes in reverse. Each reply gets a receipt with Undo. A Chrome extension can't use an MCP server, so edits go through the page: select the passage, paste into Docs' own text box.
- **Tested:** a live probe in my Chrome on a scratch Doc. Replace, delete and a two paragraph paste all landed. 146 tests, 20 of them new, against a fake Docs shaped like the live one.
- **Broke:** `getSelection()` returns an array, and the code expected one object, so selection reads always came back empty. `setSelection` takes two numbers, and the code passed an object, so pastes landed at the end of the doc. Also, the README said "he edits when you ask" before he could.
- **Fixed:** both selection shapes. Now the README was true.
- **Wanted next:** to use it for real, which went badly the next morning.

### Round 3: one fix at a time (November 3)

I opened it on a real doc:

> "None of the buttons work, nothing on screen correlates to what I'm seeing."

- **Broke:** chat failed with "Receiving end does not exist" because the service worker had loaded the content script's bundle. The two entry files shared a name. The suggestion buttons did nothing, because showing a suggestion locked the balloon and only unlocked balloons could close. He also popped up on every site and flagged menu text as echoes.
- **Fixed:** the worker entry renamed to `serviceWorker.ts`, the lock handled, and checks limited to document editors.
- **Built, from my notes that day:** a Settings button ("Don't call it Home, call it Settings"), and a key prompt right after his greeting. Then, after "There's no way to address things one by one... when I hover over one particular suggestion, it should take me to that part of the document, or highlight it or something, almost like what happens when someone leaves a comment on a Google Doc": every note anchored to its passage, a hover highlight, and a Fix button per note. Every Claude edit became a preview with Apply or Skip. "It has undo, but there's no redo" got Redo. "I don't like the way the red outline looks... the yellow bright highlight is enough, maybe red underline" got exactly that. An inline diff marks only changed words and shows a new paragraph as ¶. Each fix and each question gets its own thread with a status pill.
- **Then:** "The fix, then having to wait for Clippy to think and then hit apply seems redundant?" So fixes draft in the background when the panel opens. The first runs alone to put the document in Claude's prompt cache, then three at a time. Every row gets one click Apply, and Fix all applies the set with one Undo. The panel drags and resizes, and remembers where you left it. The rhythm and adverb notes came out, because they pointed at no text.
- **Tested:** 167 tests, typecheck clean.
- **Wanted next:** "Let's tighten up the UI, dial it in a bit." That became a design lab.

### Round 4: the panel design lab (November 3)

- **Built:** round 1 was 9 families of 6 options, 54 in all, each drawn on 5 screens: Win98 faithful, balloon native, margin comments, red pen, docked sidebar, card deck, change ledger, keyboard first, sticky notes. I starred 8, and said they "all still need to have that windowsy Microsoft style look... that yellowish light background, blue header ribbons, gray buttons." Round 2 refined each star into 32 options with that colorway settled. My notes: "Not sure what 'just let me write' or 'close' is, seems useless," and "Clippy for sure always needs to not be in the broader window, I like when he's independent and not embedded into these things," and "Let's start trimming and dialing in, not adding new." Round 3 trimmed the 7 stars: no menus inside his panel, no extra controls, and he always stands outside the window. I picked A1, Classic Dialog, and D2, Ribboned Sheet. Round 4 merged them both ways, and D3 won: D2's speech balloon sheet with its tail pointing at a free standing Clippy, plus A1's notes heading, tally and etched group boxes.
- **Tested:** D3 built into the extension, then 7 screens rendered side by side against the lab page. 183 tests.
- **Broke:** the first build run died halfway, leaving 10 files changed and nothing committed.
- **Fixed:** restarted from where the edits stopped. It closed three gaps against the design, and shipped as `6e964cf`.
- **Wanted next:** to try it on a real doc.

### Round 5: close buttons (November 4)

> "There's no close out button, and the close out button on Clippy doesn't work."

- **Broke:** round 3 of the lab had banned close controls, and that was wrong. His own X queued the Hide animation behind whatever animation was playing, and that one could wait forever, so he never left.
- **Fixed:** the panel's title bar got Settings plus an X. The queue can now drop the running task, with a counter so a stale "done" does nothing. Hide cuts the current animation, and a 2 second backstop removes him if the exit stalls.
- **Tested:** 185 tests.

### Round 6: hardening release (November 4)

- **Built:** a pass on everything that runs while you're not looking. Leaving a page and coming back through the back button now pauses him and restores him, with the same hidden or snoozed state, instead of losing him. Settings changes go through the background worker one at a time. More guards around writing into the doc.
- **Tested:** 249 of 249 tests across 29 files, strict types, both builds, then 15 checks on the built extension in clean Chromium profiles: startup, panel open and close, enable and disable, and settings surviving a popup reopen and a full browser restart.
- **Broke:** coming back to a page from the back/forward cache could never restore him. The test failed before the fix and passed after. Starting the built extension for real in Chromium also turned up a manifest resource pattern Chrome refused.
- **Fixed:** both, released as `c58885a`.

### Round 7: the window that wouldn't close (November 5)

> "I don't understand the purpose of that window at all, and it seems broken."

- **Broke:** the "other window" I kept seeing was the panel I had just closed. A CSS rule giving the sheet `display: flex` came after `[hidden] { display: none }` at the same weight, so closing stripped the panel's size and position and left it on screen, narrow, with a dead X, running off the bottom. The test DOM couldn't reproduce it. A real Chromium could. The notes list had its own problems: notes still waiting showed the "fix ready" bulb, one long repeat showed up as two echoes, and one note said "grade 48".
- **Fixed:** hidden always wins now. Waiting notes say Waiting. The panel opens with "I read <doc>. Here's what I'd fix." The tally reads as progress. One echo per repeat, and a reading band instead of a grade. I checked it live: "Looks perfect!"
- **Then the rename:** "We're gonna call it Clippee from here forward, not Mr. Clippy," and "We're also gonna have to do a slight redesign so it doesn't look 100% identical." Every name you see changed. Internal ids stayed, so saved keys, layouts and shortcuts survive.
- **Also broke that morning:** with no API key, every background draft failed and each failure opened Settings, so four Settings windows piled up. The panel also grew past the bottom of the window as notes filled in. Fixed: no drafting without a key, one line that says Open Settings, one Settings window at most, and the panel placed again whenever its size changes. 257 tests.
- **And:** "I never tested Word or Notion, not sure why that's in there." When I asked for document editors only, Word for the web and Notion had come along with Google Docs. I only ever tested Docs, so the description and docs claim Docs only now. Then "the open settings button was a bit laggy and buggy" got fixed in `7dae981`.

### Round 8: chat everywhere (November 5)

> "Even on this page I should still always see the chat. And if I type into the chat things like 'hid applied' it should do that for me... like the app should understand itself and be able to use itself through that conversational natural language."

- **Built:** the Ask box is pinned to the foot of every screen. Exact commands like "hide applied", "undo all" or "go back" run on my machine with no call to Claude, and phrases of 7 or more characters forgive one typo, so "hid applied" works. Anything else goes to Claude with a snapshot of the panel and one `use_panel` tool. His actions run through the same handlers as the buttons, and he says in one line what he did. The tool rides along on every ask, so the cached document part of the prompt never changes.
- **Tested:** 280 of 280 tests. Paraphrases and typos against the live API haven't had much real use yet.
- **Wanted next:** a brand of his own.

### Round 9: logo and palette (November 5)

- **Built, logo:** "I like the 4 squares and colors situation, we need to parody stuff." Microshaft parodies a famous four square logo. Round 1 was 54 options in 9 families. Rounds 2 and 3 narrowed it, and a final put 6 finalists side by side on one screen. After the palette lock, the finalists were recolored to match, and I called the winner with "THIS IS THE ONE." It ships as the toolbar icon in `5864105`, with the 16 and 32 pixel sizes tuned by hand so the gaps between the squares stay crisp.
- **Built, palette:** 6 palettes on the real panel CSS, then a 2 by 2 of my two favorites and their merges. Warmer won: an indigo ribbon, butter cream, taupe bevels and a spruce primary button, a few shades off the Windows 98 values. My note on cohesion: "The logos will have to be recolored also and probably at least one of the tiles need to include our recolor that's chosen for the header banners in the actual UI." So the bulb, error and tick icons in the panel take the logo's yellow, red and a darker green.
- **Tested:** 280 tests after the palette, and again after the icon.
- **Where the art stands:** the paperclip on screen was still the original 1997 sprite pack in `src/packs/clippy/` at the end of this round.

### Round 10: his own paperclip (November 5)

- **Built, character:** "It needs to be REALLY close, different enough but similar." Seven lab rounds, starting from 24 looks. Later rounds pushed the Microshaft joke into his body and his pupils, then pulled it back out. My call after round 6: give him regular eyes like Clippy had. The winner is round 3's N1 body with round 2's regular eyes, heavy brows and a 1997 pre-rendered look.
- **Built, animations:** all 18 the extension plays, redrawn on the original frame counts, durations, branches and exit paths, so every trigger works as before. Show, Hide and GetAttention used to zoom; ours never change his size, because I don't like a character that resizes. My verdict: "love all the clippy stuff."
- **Built, Thinking:** he now plays Thinking while fixes are being written, and winds it down when the last draft lands.
- **Removed:** Microsoft's sprite pack. Clippee started out wearing their 1997 sprite sheet because I was trying to evolve their paperclip, not invent a new one, and every round above ran on it. Once he had art of his own, I took their files out of the repo and out of its history before going public. What's left is the evolution. Old settings that still name the pack fall back to Clippee.
- **Tested:** 285 tests, including a check that the pack has every animation the code plays by name and that every frame points inside the sprite sheet.

### Round 11: v2 (November 5)

"Let's call the current version v1, and this next one is v2." Then: "All the feedback from all these labs weaved in, ya? Colors, animations, logo, etc."

- **The ask:** something big every time he appears, and every time he leaves after you click X. "I don't like the basic fade in fade out." Twenty entrance and exit pairs came back in four families: 1997 machines, paperclip physics, cartoon physics and big superhero stuff.
- **Picked:** 11 entrances and 8 exits. Some only half won. On the blue screen: "I like the entry here, not the exit." On the rubber band: "I like the exit, not the entry." I'd planned on alternating two, then changed my mind: "I guess the entrances and exits will have to be random and just cycle through as the person uses it... more than 2 options like I said last time."
- **Built, entrances and exits:** every arrival is a random entrance and every departure a random exit, from shuffle bags that remember their place across tabs, so nothing repeats until he's used them all. The effects are the lab's own code, bundled as is and checked frame by frame against the lab. They draw on their own layer: the superhero landing still cracks the ground, but your doc never shakes. Reduce motion on your computer and he walks on and off plain.
- **Built, coming back:** "He should always reappear again after a certain amount of time as a rule, or you can click the extension button up top." His X sends him off for 5 minutes (15 at first; I cut it to 5) and keeps tips quiet for exactly that long. The toolbar button brings him back sooner.
- **Built, jumping:** "I think he can jump around a bit more when he's excited, or like penguin waddle in certain situations." Greeting hops while he waves, Congratulate does hops and a pogo bounce, Victory is a waddle after Fix all lands, and a new idle waddles a few steps and back.
- **Built, logo in context:** the Microshaft mark now sits left of "Clippee" in the panel's title bar and in Settings, like the logo lab showed it.
- **Tested:** 311 tests, including the pools, the bag never repeating back to back, the 5 minute return, the toolbar summon, the reduced motion path and the new animations pinned by pixel hash. The built extension ran in a clean Chromium against a stand-in Docs page.

### Round 12: v2.1 (November 5)

My verdict on v2, minus one word: "This is literally PERFECT." Then a few things I wanted.

- **Asked, undo:** "We need an edit history archive type button, so you can go and undo stuff. Or maybe when you unhide fixed there's an undo near them." Which one? "Why not both!"
- **Built, Undo on the row:** a fixed note in the list gets Undo where Review was, through the same path as the fix's own Undo, and it flips to Redo. The row says Undone while it's out.
- **Built, History:** a History button next to Settings opens every change he's made to this doc, newest first: the before and after, which note or question it came from, and when. Undo or Redo on each one, Undo all and Redo all at the top, and Clear history. It's kept per doc on this computer, so it survives a reload, and it's never synced or sent anywhere. Undo only goes through if the text he wrote is still there with the same words around it. If you've changed it since, it says "Changed since. Can't undo safely." and leaves your doc alone. The chat knows it too: "show history", "undo the last fix", "undo all".
- **Asked, the popup:** "Can we reorient this panel somehow. It often conflicts with Clippee's animations that bring him in." Chrome pins that popup under the icon, so it can't move. It gets out of the way instead: while he's away on a tab, the toolbar button has no popup there, and a click just brings him back. Settings is still a right click away under Options. And if his 5 minutes run out while you're in another tab or app, he waits for you to come back before he makes his entrance.
- **Asked, the name:** "Need to say Clippee by Microshaft." The title bar and Settings now say the whole thing.
- **Tested:** 332 tests, including Undo and Redo on a row, the History recording fixes, Fix all and chat edits, the History surviving a remount, the cap and Clear, refusing an undo over changed text, the chat commands, the button per tab and the return that waits for you. The built extension ran on a stand-in Docs page that really takes edits.

Then, the same night, v2.1.1:

- **Asked, X is not a snooze:** after his X, Settings said "Snoozed 5 more minutes". Mine: "Shouldn't say this." Now X only sends him away. "Snoozed" means a snooze somebody asked for.
- **Asked, Settings:** "Tbh we can get rid of all these settings. No sound is default." Settings is now the key and one button. The master switch, the per-site switch, sounds, test mode, the snooze row and "Forget what I've dismissed" are gone, and an old install that had any of them set the wrong way comes back on, unmuted, with no sound. Mute and snooze still work from his chat.
- **Asked, idles:** "He's a bit too dormant when he's idle. And also you shouldn't repeat ANYTHING until he has cycled through all animations." Two causes. After one idle ended, nothing booked the next, so he froze until something happened. And the 1997 idles mostly roll the dice and skip themselves (one does 97 times in 100), while two others loop for minutes. Now each idle books the next, every idle he picks actually plays and winds down after a few seconds, and he goes through all nine before any repeats, remembered across tabs and reloads.
- **Asked, Show / Hide:** "There should be a show hide button in here that ALWAYS works no matter what." It's the big button in Settings. It cuts off whatever he was doing and puts him there or takes him away. If the extension was reloaded under an open doc, the old copy of him now takes itself down and a fresh one goes in, so the button, and the doc, never end up with nobody, or with two.
- **Tested:** 342 tests. The built extension, on a stand-in Docs page, came back for an old install with every old switch set wrong, idled 45 seconds without sitting still longer than 6, showed and hid from Settings, and after a reload of the extension itself, ended up with exactly one of him on the open doc.

### Round 13: v2.2 (November 5)

"Clippy randomly broke... I kept opening and closing it a bunch of times and eventually it just stopped showing up. Make sure that's not a bug..." A separate bug hunt took it apart while the rest of this round got built.

- **Found, mostly a reload:** most of what I hit was the extension reloading under an open doc, which left that tab with a dead copy of him. v2.1.1 already fixed that: the dead copy takes itself down and a fresh one goes in.
- **Found and fixed, stuck hidden:** a storage read that's in flight while the extension reloads never answers. He was waiting on one before every entrance and exit, with his sprite already hidden, so one stranded read kept him gone, and every draw after it queued behind it. Now nothing he waits on can hang: storage gives up after 400 milliseconds and he carries on without it, and if anything is ever still "playing" after 12 seconds, he resets himself without anyone clicking.
- **Found and fixed, off screen:** he only checked the window size when he first appeared. Shrink the window, or drag him past the edge, and he was off screen, and Show put him right back there. Now a drag stops at the edge, a smaller window pulls him back in, and every entrance and Show checks first.
- **Found and fixed, the panel without its tail:** after a reload the panel sometimes opened a bit wider with no tail pointing at him. It had been saving its own position every time its notes filled in, and a saved position pins it. Now it remembers only where you dragged it and a size you set yourself.
- **Owed from 2.1.1:** the no-repeat idle bag was supposed to carry across tabs and reloads. It wasn't hooked up. Now it is.
- **Picked, a smaller icon:** the option called "1.5x, heavier shaft". The 16 and 32 pixel icons in the toolbar, the panel's title bar and Settings are new, squares snapped to whole pixels and the curves smoothed. The big icons stay as they were.
- **Picked, a banner:** the boot splash, "this one for sure!" It's at the top of the README: a 1997 boot screen with Clippee waiting at the end of the progress bar.
- **v2.2.1, white:** "Can we actually keep the [cut-out] part white for all of them, same size and shape but white regardless of background, banner as well." Every icon, the title-bar and Settings marks and the banner now cut the same shape out in white.
- **Tested:** 354 tests, including the bug hunt's own repro of the stranded read, the watchdog, a shrinking window, a drag past the edge and the panel layout. The built extension, in Chromium: dragged past the corner he stayed inside, a window shrunk to 900 by 560 brought him back fully in view, and the panel opened beside him with its tail across three reloads.

## 5. Feature family tree

```
1997: Clippy knows it's a letter, has nothing to say
└─ recon: Docs draws text as a picture → the page flag, any value opens it
   ├─ read the doc → local checks → notes
   │  └─ "when should he speak?" → 15 s quiet, 1 per 10 min, 3 strikes
   ├─ chat panel → edit tool → edits through the page, read back
   │  └─ previews with Apply / Skip → Undo → Redo
   │     └─ "waiting to apply is redundant" → background drafts → Fix all
   │        └─ "like a comment on a Google Doc" → hover highlight
   ├─ "dial it in" → panel design lab → D3 balloon sheet
   │  └─ no close button → close X → the closed panel that stayed open
   ├─ chat on every screen → the panel runs from plain words
   └─ rename → Microshaft logo lab → Warmer palette → recolored logo → icon
      └─ his own art → Thinking while fixes draft
         └─ v2: random entrances and exits → back in 5 min → hops, Victory, waddle
            └─ v2.1: Undo on the row → History per doc → the button calls him back
               └─ v2.1.1: Settings shrinks to the key → Show / Hide that always works → idles that never stall
                  └─ v2.2: bug hunt → nothing can hang him → never off screen → the panel keeps its tail
```

## 6. Test log

| When | What ran | Result | Where |
|---|---|---|---|
| Aug 28 | Tests, typecheck, both builds | 126 of 126 | Private note, `4641f9b` |
| Aug 28 | Local checks at 11,000 words | 63 ms | Private note |
| Aug 28 | Live read of a doc I own | Read it, first real catch | Private note |
| Nov 2 | Live probe on a scratch Doc in my Chrome | Replace, delete, paragraph split landed | Private note |
| Nov 3 | Tests after editing | 146 | `9bac377` |
| Nov 3 | Tests after previews and threads | 167 | `401688e` |
| Nov 3 | Tests after D3, plus 7 side by side screens | 183 | `6e964cf` |
| Nov 4 | Tests after the close fix | 185 | Private note, `012ff6f` |
| Nov 4 | 29 test files, types, both builds, built extension in clean Chromium | 249 of 249, 15 of 15 | `c58885a`, private release report |
| Nov 5 | Closed panel bug in real Chromium | Reproduced, fixed. 254 tests | Private note, `d7e725c` |
| Nov 5 | Tests after the no key fix | 257 | Private note, `d5c1058` |
| Nov 5 | Tests after chat everywhere and the palette | 280 | Private note, `388b054`, `47f88a3` |
| Nov 5 | My run for these docs, at `5864105` | 280 of 280 across 33 files, types, both builds | Local run |
| Nov 5 | `tests/size.bench.test.ts`, same run | 64 ms at 11,040 words | Local run |
| Nov 5 | My run again, at `9d0d335` after the new art | 285 of 285 across 34 files, types, both builds; bench 48 ms | Local run |
| Nov 5 | v2: tests, types, build; built extension in clean Chromium; entrances and exits against the lab | 311 of 311 across 35 files; 504 of 504 frames identical to the lab | `v2`, local run |
| Nov 5 | v2.1: tests, types, both builds; built extension on a stand-in Docs page that takes edits | 332 of 332 across 37 files; apply, row Undo and Redo, History across a reload, the button while he's away | `v2.1`, local run |
| Nov 5 | v2.1.1: tests, types, both builds; built extension, including a reload of the extension under an open doc | 342 of 342 across 40 files; one copy of him after the reload | `v2.1.1`, local run |
| Nov 5 | v2.2: tests, types, both builds; built extension: drag past the edge, a shrinking window, the panel across three reloads, the new marks at 1x and 2x | 354 of 354 across 42 files | `v2.2`, local run |

There's no CI on this repo yet. Every number above comes from a run on my machine. The fake Docs in the tests is shaped like the live API, and the real Docs gets checked by hand.

## 7. Roads not taken

- **The name Clippo.** The research picked a name nobody owns. I went with Mr. Clippy, then Clippee by Microshaft.
- **Safari.** It has no lasting mode for personal extensions. Temporary ones die on quit, so it's out.
- **Editing through an MCP or the Docs API.** A Chrome extension can't talk to an MCP server, and the Docs API needs Google sign in. Edits go through the page, so nobody sets up a Google Cloud project.
- **Watching the screen on a timer.** Local checks first and Claude on demand came out about 148 times cheaper in the recon.
- **A "What are you writing?" setting.** My answer: "A setting is the wrong format for this."
- **Rhythm and adverb notes.** They pointed at no text, so there was nothing to fix.
- **Docked sidebars, menu bars and "Just let me write".** Cut in the lab. He stands on his own.
- **No close button.** A lab rule for one night. I couldn't close the panel the next morning, so it went.
- **Word and Notion.** I never tested either, so the claim came out.

## 8. My method

1. **Recon before code.** Eleven lanes, and every claim needed a fetched link or a command that ran.
2. **Spec it when the build starts guessing.** Twenty one decisions, before any more code.
3. **Labs for looks.** Lots of real options, I star, it narrows, then it gets built to match.
4. **Use it on a real doc after every round.** Most of what's in section 4 came from that.

## 9. Sources

- Commits: `git log` of `fidgetcoding/clippee`.
- Third party code and art: [NOTICE.md](NOTICE.md).
- Private, kept by me: the content note dated August 27, the recon and build note dated August 28, session notes from November 2 to 5, and the release report dated November 4, 2026.
