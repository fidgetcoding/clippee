# Entrances, exits and the pack

## Entrances and exits

Every time Clippee arrives he plays a random entrance, and every time he leaves (his X, `Alt+Shift+C`) a random exit. After his X he comes back on his own 5 minutes later, as soon as the tab is in front of you, and a click on the toolbar button brings him back sooner. While he's away that button has no popup on his tab (`chrome.action.setPopup`), so the click calls him back instead of dropping Settings over his entrance; Settings stays under right click, Options.

- **The art** is the round 2 animation lab's own code, kept as written in `src/fx/lab/`: the shared kit (`kit/retro.js`, `kit/clippee-rig.js`, `kit/xkit.js`) and one file per effect (`fx/<id>.js`). Each effect is a pure function of time: `appear(ctx, t, stage)` and `disappear(ctx, t, stage)`, `t` from 0 to 1.
- **The pools** are in `src/fx/pools.ts`. 11 entrances (r1 r5 r4 p2 p1 c1 c4 x1 x2 x3 x4) and 8 exits (r1 r4 p2 p4 c4 x2 x3 x4). Each pool is a shuffle bag: every effect plays once before any repeats, and he never does the same one twice in a row. The bags live in `storage.local` under `mrclippy:fx-bags`, so the rotation carries across tabs and reloads.
- **The player** (`src/fx/FxPlayer.ts`) draws on one full-window canvas in Clippee's shadow root. It never takes a click and never touches the page underneath, which is why x1's landing cracks the canvas, not your doc. His sprite steps aside for the effect and is back, at rest, in the same frame the entrance ends.
- **Reduced motion:** with the OS asking for less motion, he uses the pack's plain Show and Hide instead.

### The build step

The lab files are classic scripts that share globals. A Chrome extension can't run them that way (Manifest V3: no `eval`, no remote code), so `scripts/build-fx.mjs` pastes them, unchanged and in the lab's load order, into one function in `src/fx/generated/labFx.js`. Vite bundles that like any other module, as a chunk loaded the first time he makes an entrance.

```bash
npm run fx       # regenerate src/fx/generated/labFx.js after editing src/fx/lab/
```

`npm run build` checks the generated file is current and stops if it isn't, and so does a test. Don't edit `labFx.js` by hand.

To add an effect: copy its `fx.js` into `src/fx/lab/fx/<id>.js`, add the id to `FX` in `scripts/build-fx.mjs` and to a pool in `src/fx/pools.ts`, then `npm run fx`.

## The pack

`src/packs/clippee/` (`pack.json` and `map.png`) holds his 20 animations at 124 x 93: the 18 from the round 1 animation lab, with Greeting and Congratulate replaced by round 2's hopping versions, plus two new ones, Victory (after Fix all lands) and IdleWaddle (one of the idles).

The pack was exported from the animation labs with their exporter, which draws every frame through the same rig and checks each animation's frame count, timings and branches against the original 1997 structure before writing anything:

```bash
python3 anim-r2/kit/export.py --anim-dir <anim folder> --out <pack folder> \
  --names Show,Hide,RestPose,Greeting,GetAttention,Writing,CheckingSomething,Explain,Congratulate,Thinking,Victory,IdleRopePile,IdleAtom,Idle1_1,IdleSideToSide,IdleHeadScratch,IdleFingerTap,IdleSnooze,IdleEyeBrowRaise,IdleWaddle
```

where the anim folder holds round 1's `anim/*.js` minus `Congratulate.js` and `Greeting.js`, plus round 2's `d/j/anim/*.js`. The labs aren't in this repo; `tests/clippee-pack.test.ts` pins the round 2 animations by pixel hash so a different drawing can't slip in.
