import { Agent } from '../character/Agent';
import { loadPack } from '../character/packLoader';
import { review } from '../checks';
import { ext } from '../platform';
import { BreakpointDetector } from '../scheduler/BreakpointDetector';
import { Renderer } from '../scheduler/Renderer';
import { SuggestionQueue } from '../scheduler/SuggestionQueue';
import type { Breakpoint } from '../scheduler/types';
import {
  SNOOZE_DURATIONS_MS,
  isSilenced,
  savePreferences,
  type Settings,
} from '../settings';
import { resolveSource } from './documentSource';
import { DraftCache } from './draftCache';
import { isWritingSurface } from './surfaces';
import { Highlighter } from './highlight';
import { loadLayout, makePanelMovable, saveLayout } from './layout';
import { ChatPanel, docTitleFrom, type AgentChange, type AgentReply } from './chatPanel';
import type { ChatTurn, DocumentEdit } from '../agent/types';
import type { PanelState, SnoozeLength } from '../agent/panelTools';
import { DocEdits } from './docEdits';
import { storageBag } from './bagStore';
import { startPageLifecycle, type PageRuntime } from './pageLifecycle';
import {
  GREETING_WAVE_FRAME, Presence, prefersReducedMotion, reportAway, returnWhenSeen,
} from './presence';
import { askForKey, hasApiKey, openSettings } from './settingsLink';
import { askWorker, auditWorker } from './workerClient';
import { FxPlayer } from '../fx/FxPlayer';
import { FxDeck } from '../fx/pools';

const DISMISSAL_KEY = 'mrclippy:dismissals';

/** Snooze lengths the chat can ask for, as the popup's buttons time them. */
const SNOOZE_MS: Readonly<Record<SnoozeLength, number>> = {
  '15m': SNOOZE_DURATIONS_MS['15 minutes'],
  '1h': SNOOZE_DURATIONS_MS['1 hour'],
  today: SNOOZE_DURATIONS_MS['Rest of today'],
};

/** The greeting holds for 7s; the key prompt follows once it has cleared. */
const KEY_PROMPT_DELAY_MS = 9_000;

/**
 * Content-script entry.
 *
 * Wiring order is the architecture: producers post to the queue, the detector
 * emits perceptual seams, the renderer decides. Nothing here calls
 * `agent.play()` for a suggestion — the only direct calls are the greeting and
 * an explicit click, both of which the user initiated.
 */
async function mountRuntime(
  settings: Settings, current: () => boolean, hidden: boolean,
): Promise<PageRuntime | undefined> {
  // No DOM/listeners/timers until all startup reads finish and this attempt is
  // still enabled on the same page. Disabled or superseded attempts stay inert.
  const [{ mountHost }, pack, stored, layout] = await Promise.all([
    import('./host'), loadPack(settings.characterPack),
    ext.storage.local.get(DISMISSAL_KEY), loadLayout(),
  ]);
  if (!current()) return undefined;
  const host = mountHost();
  const dismissals = (stored[DISMISSAL_KEY] ?? {}) as Record<string, number>;

  const queue = new SuggestionQueue({ dismissals });
  const detector = new BreakpointDetector();

  let releasePanel: (() => void) | undefined;
  let disposed = false;
  let panelGeneration = 0;
  let keyPromptTimer: ReturnType<typeof setTimeout> | undefined;

  const agent = new Agent(pack, {
    ...(layout.agent ? { position: layout.agent } : {}),
    // No idle repeats until all nine have played, across tabs and reloads.
    idleStore: storageBag('mrclippy:idle-bag'),
    onMoved: (position) => void saveLayout({ agent: position }),
    onClick: () => onAgentClick(),
    // X: he leaves with an exit and comes back on his own, or with the toolbar
    // button. Being away is not a snooze: no tips can show while he's gone, and
    // Settings says "Snoozed" only for a snooze somebody chose.
    onDismiss: () => {
      closePanel();
      presence.leave();
    },
  });
  host.root.append(agent.root, agent.balloon.el);
  const player = new FxPlayer(host.root), deck = new FxDeck();
  const presence = new Presence({
    agent, player, next: (kind) => deck.next(kind),
    // Loaded the first time he makes an entrance, not with the page.
    effects: () => import('../fx/generated/labFx').then((m) => m.createLabFx()),
    reducedMotion: prefersReducedMotion,
    // Away, the toolbar button calls him back instead of opening Settings over his entrance.
    onAway: (away) => reportAway(away),
    ...returnWhenSeen,
    onArrived: (returning, entered) => {
      // Greeting draws him in from a bare wire before he waves. After an
      // entrance he is already standing there, so it starts at the wave.
      void agent.play('Greeting', entered ? GREETING_WAVE_FRAME : 0);
      if (!returning) {
        agent.nudge('It looks like you are writing something. Click me if you want a hand.');
        promptForKey();
      }
    },
  });

  const renderer = new Renderer(agent, queue, detector, {
    onShown: (suggestion) => {
      // One line, two buttons, plus a way into the full panel. A proactive
      // interruption should stay small — the user did not ask for it.
      agent.balloon.suggest(suggestion.text, [
        {
          label: 'Not that',
          run: () => {
            renderer.dismissCurrent();
            void agent.play('RestPose');
          },
        },
        {
          label: 'Show me',
          primary: true,
          run: () => {
            renderer.resolveCurrent();
            openPanel();
          },
        },
        { label: 'Thanks', run: () => renderer.resolveCurrent() },
      ]);
    },
    onDismissed: () => {
      void ext.storage.local.set({ [DISMISSAL_KEY]: queue.dismissalState() });
    },
  });

  renderer.setMuted(isSilenced(settings));

  const source = resolveSource();
  let lastReviewed = '';

  /**
   * Produce candidates. Never renders — keeping "found something" separate from
   * "said something" is what makes the interruption policy auditable.
   */
  let checking = false;
  async function runChecks(breakpoint: Breakpoint): Promise<void> {
    if (checking || disposed || !agent.isVisible) return;
    checking = true;
    try {
      // Snooze expiry is time-based, not a storage-change event.
      renderer.setMuted(isSilenced(settings));
      if (renderer.isMuted || !source.canEdit()) return;
      const context = source.context?.();
      const text = await source.read();
      if (context !== source.context?.()) { queue.clear(); return; }
      if (disposed || !agent.isVisible || isSilenced(settings)) return;
      if (!text) { queue.clear(); lastReviewed = ''; return; }
      if (text !== lastReviewed) {
        lastReviewed = text;
        queue.clear();
        for (const suggestion of review(text)) queue.add(suggestion);
      }
      // Reading is asynchronous. Drain only after fresh candidates exist; the
      // renderer rechecks silence/engagement so typing during the read is safe.
      renderer.renderAt(breakpoint);
    } finally {
      checking = false;
    }
  }

  let panel: ChatPanel | undefined;
  /** The open panel was built without a key, so it drafts nothing yet. */
  let panelNeedsKey = false;

  const editHistory = new DocEdits(source);

  /**
   * Fix drafts, keyed by question and the document they were drafted against.
   * Reopening the panel on unchanged text reuses them instead of paying again.
   */
  const drafts = new DraftCache<AgentReply>();

  async function askAgent(
    question: string,
    history: readonly ChatTurn[],
    panel?: PanelState,
  ): Promise<AgentReply> {
    const generation = panelGeneration;
    const context = source.context?.();
    const document_ = (await source.read()) ?? '';
    if (context !== source.context?.()) throw new Error('The active editor changed. Reopen the panel.');
    if (disposed || generation !== panelGeneration) throw new Error('Panel closed.');
    const canEdit = source.canEdit();
    const build = () => askAgentUncached(question, history, document_, canEdit, panel);
    // A typed request depends on what the panel shows, so it is never a cached draft.
    return history.length > 0 || panel
      ? build()
      : drafts.get(document_, canEdit, question, () => thinkWhile(build()));
  }

  /** Fix drafts in flight. He thinks while any are being written. */
  let drafting = 0;
  let draftsDone: (() => void) | undefined;

  function thinkWhile<T>(work: Promise<T>): Promise<T> {
    if (drafting++ === 0) {
      void agent.playUntil('Thinking', new Promise<void>((resolve) => { draftsDone = resolve; }));
    }
    const settle = (): void => {
      if (--drafting === 0) draftsDone?.();
    };
    work.then(settle, settle);
    return work;
  }

  /** Send a question to the background worker, which owns the API key. */
  async function askAgentUncached(
    question: string, history: readonly ChatTurn[], document_: string, canEdit: boolean, panel?: PanelState,
  ): Promise<AgentReply> {
    if (disposed) throw new Error('Panel closed.');
    return askWorker(question, history, document_, canEdit, panel);
  }

  /** The user accepted one or more proposals. */
  async function applyProposals(
    edits: readonly DocumentEdit[], context = source.context?.(), origin?: string,
  ): Promise<AgentChange[]> {
    void agent.play('Writing');
    const changes = await editHistory.apply(edits, context, origin);
    // Anything he typed is new text: re-review it at the next seam, not now.
    lastReviewed = '';
    return changes;
  }

  const highlighter = new Highlighter(host.root);

  /**
   * Point at a passage: select it (which scrolls the page to it), then paint a
   * loud box over it once the page has settled. Failure is silent: it is a hover.
   */
  async function locatePassage(passage: string): Promise<void> {
    try {
      const generation = panelGeneration;
      if (disposed || !(await source.select(passage))) return;
      await new Promise((r) => setTimeout(r, 250));
      if (!disposed && generation === panelGeneration) highlighter.show(source.boxes(passage));
    } catch {
      // Nothing to point at — the text may have changed since the check ran.
    }
  }

  /** Run the structure ladder and render the result as one readable answer. */
  async function auditStructure(): Promise<string> {
    const generation = panelGeneration;
    const context = source.context?.();
    const text = (await source.read()) ?? '';
    if (disposed || generation !== panelGeneration || context !== source.context?.()) {
      throw new Error('The active editor changed or the panel closed. Reopen the panel.');
    }
    if (!text) return source.explainFailure?.() ?? "I can't read this document.";

    return auditWorker(text);
  }

  function openPanel(): void {
    if (disposed) return;
    const generation = ++panelGeneration;
    const context = source.context?.();
    // Everything that protects the panel happens NOW, synchronously, before any
    // await. Reading a Google Doc is a bridge round-trip, and taking the lock
    // only once the text arrives leaves a window where a queued speak or a
    // proactive suggestion lands on an unlocked balloon and takes the panel with
    // it. That window is the bug this closes.
    renderer.setEngaged(true);
    agent.interrupt();
    agent.balloon.claim('Reading\u2026');
    void agent.play('CheckingSomething');

    void (async () => {
      const [text, savedLayout, hasKey] = await Promise.all([source.read(), loadLayout(), hasApiKey()]);
      if (disposed || generation !== panelGeneration) return;
      if (context !== source.context?.()) throw new Error('The active editor changed.');

      // A failed read is worth saying out loud — the three Docs failure modes
      // need three different fixes, and "it didn't work" helps nobody.
      if (!text) {
        agent.balloon.unlock();
        agent.balloon.say(source.explainFailure?.() ?? "There's nothing here I can read.");
        agent.balloon.lock();
        return;
      }

      const findings = review(text);

      const docTitle = docTitleFrom(document.title);
      panel = new ChatPanel({
        findings: findings.map((f) => ({
          text: f.text,
          kind: f.kind,
          ...(f.anchor ? { anchor: f.anchor } : {}),
        })),
        ...(docTitle ? { docTitle } : {}),
        canEdit: source.canEdit(),
        // Without a key every draft would fail; say so once instead.
        prefetch: source.canEdit() && hasKey,
        needsKey: !hasKey,
        onAsk: (question, history, panelState) => context === source.context?.()
          ? askAgent(question, history, panelState)
          : Promise.reject(new Error('The active editor changed. Reopen the panel.')),
        onApply: (edits, origin) => applyProposals(edits, context, origin),
        history: editHistory.history,
        liveChanges: (ids) => editHistory.history.liveChanges(ids),
        onLocate: locatePassage,
        onRedo: async (changes) => {
          const result = await editHistory.redo(changes, context);
          lastReviewed = '';
          return result;
        },
        onUndo: async (changes) => {
          const result = await editHistory.undo(changes);
          lastReviewed = '';
          return result;
        },
        onAudit: () => context === source.context?.()
          ? auditStructure()
          : Promise.reject(new Error('The active editor changed. Reopen the panel.')),
        onDismissFinding: (index) => {
          const finding = findings[index];
          if (!finding) return;
          queue.dismiss(finding.kind);
          void ext.storage.local.set({ [DISMISSAL_KEY]: queue.dismissalState() });
        },
        // The title-bar X and Escape. Snooze lives in Settings, or in the chat.
        onClose: closePanel,
        onSettings: openSettings,
        onSnooze: (length) => savePreferences({ snoozeUntil: Date.now() + SNOOZE_MS[length] }),
        // Unmute means suggestions again now, so it ends a snooze as well.
        onMute: (muted) => savePreferences(muted ? { muted } : { muted, snoozeUntil: 0 }),
        onFixAllLanded: () => void agent.play('Victory'),
      });

      panelNeedsKey = !hasKey;
      agent.balloon.render(panel.el);
      releasePanel?.();
      releasePanel = makePanelMovable(agent.balloon, panel.handle, savedLayout.panel);
      panel.focus();
      void agent.play(findings.length > 0 ? 'Explain' : 'Congratulate');
    })().catch(() => {
      if (disposed || generation !== panelGeneration) return;
      closePanel();
      agent.balloon.say('Could not read this document. Try again.');
    });
  }

  function closePanel(): void {
    panelGeneration++;
    panelNeedsKey = false;
    panel?.dispose();
    highlighter.clear();
    releasePanel?.();
    releasePanel = undefined;
    agent.balloon.hide();
    panel = undefined;
    renderer.setEngaged(false);
  }

  function onAgentClick(): void {
    if (renderer.visible) renderer.resolveCurrent();
    if (agent.balloon.visible) {
      closePanel();
      return;
    }
    openPanel();
  }

  // Refresh first, then let the renderer consider that same seam.
  const stopChecks = detector.on((bp) => void runChecks(bp).catch(() => undefined));

  detector.start();
  if (hidden) presence.startAway();
  else presence.arrive();

  // First run: right after the greeting, the one setup step that matters.
  function promptForKey(): void {
    void hasApiKey().then((hasKey) => {
      if (hasKey || disposed || !agent.isVisible) return;
      keyPromptTimer = setTimeout(() => {
        if (disposed || !agent.isVisible || agent.balloon.isLocked) return; // They already opened something.
        askForKey(agent);
      }, KEY_PROMPT_DELAY_MS);
    });
  }

  // Settings is another window. Coming back from it with a key pasted, the
  // open panel starts over and drafts every fix, with no second click.
  const onFocus = (): void => {
    if (!panel || !panelNeedsKey) return;
    void hasApiKey().then((hasKey) => {
      if (!hasKey || disposed || !panel || !panelNeedsKey) return;
      closePanel();
      openPanel();
    });
  };
  window.addEventListener('focus', onFocus);

  const onMessage = (message: unknown): unknown => {
    if (!message || typeof message !== 'object') return undefined;
    const type = (message as { type?: unknown }).type;
    if (disposed) return undefined;
    // Settings asks where he is, and its Show / Hide put him there outright.
    if (type === 'mrclippy:presence') return { here: presence.here };
    if (type === 'mrclippy:force-show') {
      presence.force('present');
      return { here: true };
    }
    if (type === 'mrclippy:force-hide') {
      closePanel();
      presence.force('away');
      return { here: false };
    }
    // The shortcut sends him off or calls him back, with the same entrances
    // and exits as X and the toolbar button.
    if (type === 'mrclippy:toggle') {
      if (presence.here) closePanel();
      presence.toggle();
    }
    // The toolbar button while he's away. Clicked while he's here (the button
    // fell out of step), it puts Settings back on the button and opens it.
    if (type === 'mrclippy:summon') {
      if (!presence.here) presence.arrive();
      else {
        reportAway(false);
        openSettings();
      }
    }
    return undefined;
  };

  function teardown(): void {
    if (disposed) return;
    disposed = true;
    window.removeEventListener('focus', onFocus);
    closePanel();
    if (keyPromptTimer !== undefined) clearTimeout(keyPromptTimer);
    drafts.clear();
    stopChecks();
    detector.stop();
    renderer.stop();
    editHistory.dispose();
    source.dispose?.();
    highlighter.dispose();
    presence.dispose();
    reportAway(false);
    player.destroy();
    agent.destroy();
    host.destroy();
  }

  return {
    get hidden() { return !presence.here; },
    update(next) {
      settings = next;
      renderer.setMuted(isSilenced(settings));
    },
    message: onMessage,
    dispose: teardown,
  };
}

// Word's editor is an iframe, so frames are allowed there and nowhere else.
if (window.top === window.self || location.hostname.endsWith('.officeapps.live.com')) {
  startPageLifecycle(mountRuntime, () => !!document.body && isWritingSurface(location));
}
