import { Agent } from '../character/Agent';
import { loadPack } from '../character/packLoader';
import { review } from '../checks';
import { ext } from '../platform';
import { BreakpointDetector } from '../scheduler/BreakpointDetector';
import { Renderer } from '../scheduler/Renderer';
import { SuggestionQueue } from '../scheduler/SuggestionQueue';
import type { Breakpoint } from '../scheduler/types';
import {
  isSilenced,
  savePreferences,
  toggleMuted,
  type Settings,
} from '../settings';
import { resolveSource } from './documentSource';
import { DraftCache } from './draftCache';
import { isWritingSurface } from './surfaces';
import { Highlighter } from './highlight';
import { loadLayout, makePanelMovable, saveLayout } from './layout';
import { ChatPanel, docTitleFrom, type AgentChange, type AgentReply } from './chatPanel';
import type { AskResponse, AuditResponse, ChatTurn, DocumentEdit } from '../agent/types';
import { EditHistory } from './editHistory';
import { startPageLifecycle, type PageRuntime } from './pageLifecycle';

const DISMISSAL_KEY = 'mrclippy:dismissals';

/** Clicking the X sends him away for the rest of the working day. */
const HIDE_DURATION_MS = 8 * 60 * 60_000;

/** Test mode drops both gates so suggestions surface immediately. */
const DEBUG_GAP_MS = 5_000;
const DEBUG_SILENCE_MS = 3_000;

/**
 * Content-script entry.
 *
 * Wiring order is the architecture: producers post to the queue, the detector
 * emits perceptual seams, the renderer decides. Nothing here calls
 * `agent.play()` for a suggestion — the only direct calls are the greeting and
 * an explicit click, both of which the user initiated.
 */
/**
 * Ask the background to open Settings. It owns the window; we only ask. A
 * click always goes through; an automatic ask (a request failed for want of
 * a key) goes once per few seconds, since several failing together is one
 * problem.
 */
let lastAutoSettings = 0;
function openSettings(clicked = true): void {
  if (!clicked) {
    if (Date.now() - lastAutoSettings < 5_000) return;
    lastAutoSettings = Date.now();
  }
  void ext.runtime.sendMessage({ type: 'mrclippy:open-settings' }).catch(() => undefined);
}

async function hasApiKey(): Promise<boolean> {
  try {
    const reply = (await ext.runtime.sendMessage({ type: 'mrclippy:has-key' })) as
      | { hasKey?: boolean }
      | undefined;
    return typeof reply?.hasKey === 'boolean' ? reply.hasKey : true;
  } catch {
    return true; // Unknown: don't nag on a guess.
  }
}

/** The greeting holds for 7s; the key prompt follows once it has cleared. */
const KEY_PROMPT_DELAY_MS = 9_000;

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
  const detector = new BreakpointDetector(
    settings.debugMode ? { minSilenceMs: DEBUG_SILENCE_MS } : {},
  );

  let releasePanel: (() => void) | undefined;
  let disposed = false;
  let panelGeneration = 0;
  let keyPromptTimer: ReturnType<typeof setTimeout> | undefined;

  const agent = new Agent(pack, {
    ...(layout.agent ? { position: layout.agent } : {}),
    onMoved: (position) => void saveLayout({ agent: position }),
    onClick: () => onAgentClick(),
    onDismiss: () => {
      closePanel();
      agent.hide();
      void savePreferences({ snoozeUntil: Date.now() + HIDE_DURATION_MS }).catch(() => undefined);
    },
  });
  host.root.append(agent.root, agent.balloon.el);

  const renderer = new Renderer(agent, queue, detector, {
    ...(settings.debugMode ? { minGapMs: DEBUG_GAP_MS } : {}),
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

  const editHistory = new EditHistory(source);

  /**
   * Fix drafts, keyed by question and the document they were drafted against.
   * Reopening the panel on unchanged text reuses them instead of paying again.
   */
  const drafts = new DraftCache<AgentReply>();

  async function askAgent(question: string, history: readonly ChatTurn[]): Promise<AgentReply> {
    const generation = panelGeneration;
    const context = source.context?.();
    const document_ = (await source.read()) ?? '';
    if (context !== source.context?.()) throw new Error('The active editor changed. Reopen the panel.');
    if (disposed || generation !== panelGeneration) throw new Error('Panel closed.');
    const canEdit = source.canEdit();
    const build = () => askAgentUncached(question, history, document_, canEdit);
    return history.length > 0 ? build() : drafts.get(document_, canEdit, question, build);
  }

  /** Send a question to the background worker, which owns the API key. */
  async function askAgentUncached(
    question: string,
    history: readonly ChatTurn[],
    document_: string,
    canEdit: boolean,
  ): Promise<AgentReply> {
    if (disposed) throw new Error('Panel closed.');
    const findings = review(document_).map((f) => f.text);

    const response = (await ext.runtime.sendMessage({
      type: 'mrclippy:ask',
      question,
      document: document_,
      history,
      findings,
      canEdit,
    })) as AskResponse | undefined;

    if (!response) throw new Error('No reply from the background worker. Try reloading the tab.');
    if (!response.ok) {
      if (response.needsKey) openSettings(false);
      throw new Error(response.error);
    }
    if (!response.edits || response.edits.length === 0) return { text: response.text };

    // Proposals only. Nothing touches the document until the user applies one.
    return { text: response.text, proposals: response.edits };
  }

  /** The user accepted one or more proposals. */
  async function applyProposals(edits: readonly DocumentEdit[], context = source.context?.()): Promise<AgentChange[]> {
    void agent.play('Writing');
    const changes = await editHistory.apply(edits, context);
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

    const response = (await ext.runtime.sendMessage({
      type: 'mrclippy:audit',
      document: text,
    })) as AuditResponse | undefined;

    if (!response) throw new Error('No reply from the background worker. Try reloading the tab.');
    if (!response.ok) {
      if (response.needsKey) openSettings(false);
      throw new Error(response.error);
    }

    if (response.findings.length === 0) {
      return 'Structurally it holds up. Nothing promised that you did not deliver.';
    }

    return response.findings
      .map((f) => (f.evidence ? `${f.problem}\n\n  "${f.evidence}"` : f.problem))
      .join('\n\n');
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
        onAsk: (question, history) => context === source.context?.()
          ? askAgent(question, history)
          : Promise.reject(new Error('The active editor changed. Reopen the panel.')),
        onApply: (edits) => applyProposals(edits, context),
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
        // The title-bar X and Escape. Snooze lives in Settings, not on the panel.
        onClose: closePanel,
        onSettings: openSettings,
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
  if (!hidden) {
    agent.show();
    void agent.play('Greeting');
    agent.nudge('It looks like you are writing something. Click me if you want a hand.');
  }

  // First run: right after the greeting, the one setup step that matters.
  void hasApiKey().then((hasKey) => {
    if (hasKey || disposed || !agent.isVisible) return;
    keyPromptTimer = setTimeout(() => {
      if (disposed || !agent.isVisible || agent.balloon.isLocked) return; // They already opened something.
      void agent.play('GetAttention');
      agent.balloon.suggest(
        'Before I can help, I need your Claude API key. Paste it in Settings.',
        [
          { label: 'Later', run: () => agent.balloon.hide() },
          {
            label: 'Open Settings',
            primary: true,
            run: () => {
              agent.balloon.hide();
              openSettings();
            },
          },
        ],
        'Clippee',
      );
    }, KEY_PROMPT_DELAY_MS);
  });

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

  const onMessage = (message: unknown): void => {
    if (!message || typeof message !== 'object') return;
    const type = (message as { type?: unknown }).type;
    if (disposed) return;
    if (type === 'mrclippy:toggle') {
      if (agent.isVisible) {
        closePanel();
        agent.hide();
      } else agent.show();
    }
    if (type === 'mrclippy:mute') {
      void toggleMuted().catch(() => undefined);
    }
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
    agent.destroy();
    host.destroy();
  }

  return {
    get hidden() { return !agent.isVisible; },
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
