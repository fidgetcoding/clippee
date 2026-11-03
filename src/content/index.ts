import { Agent } from '../character/Agent';
import { loadPack } from '../character/packLoader';
import { review } from '../checks';
import { ext } from '../platform';
import { BreakpointDetector } from '../scheduler/BreakpointDetector';
import { Renderer } from '../scheduler/Renderer';
import { SuggestionQueue } from '../scheduler/SuggestionQueue';
import {
  isActiveOn,
  isSilenced,
  loadSettings,
  onSettingsChanged,
  saveSettings,
  type Settings,
} from '../settings';
import { resolveSource } from './documentSource';
import { isWritingSurface } from './surfaces';
import { Highlighter } from './highlight';
import { loadLayout, makePanelMovable, saveLayout } from './layout';
import { ChatPanel, type AgentChange, type AgentReply } from './chatPanel';
import type { AskResponse, AuditResponse, ChatTurn, DocumentEdit } from '../agent/types';
import type { EditFailure } from '../docs/protocol';

/** What each failure means to someone who is not debugging the bridge. */
const FAILURE_REASONS: Readonly<Record<EditFailure, string>> = {
  'not-found': "Couldn't find that passage. It may have changed.",
  ambiguous: 'That phrase appears more than once, so I left it alone.',
  unavailable: "The page wouldn't let me type there. Reloading the tab usually fixes it.",
  unverified: "I typed it, but couldn't confirm it landed. Check the document.",
};

const DISMISSAL_KEY = 'mrclippy:dismissals';

/** Clicking the X sends him away for the rest of the working day. */
const HIDE_DURATION_MS = 8 * 60 * 60_000;

/** "Just let me write" — quiet for an hour, but he stays on screen. */
const SNOOZE_DURATION_MS = 60 * 60_000;

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
/** Ask the background to open Settings. It owns the window; we only ask. */
function openSettings(): void {
  void ext.runtime.sendMessage({ type: 'mrclippy:open-settings' }).catch(() => undefined);
}

async function hasApiKey(): Promise<boolean> {
  try {
    const reply = (await ext.runtime.sendMessage({ type: 'mrclippy:has-key' })) as
      | { hasKey?: boolean }
      | undefined;
    return reply?.hasKey === true;
  } catch {
    return true; // Unknown: don't nag on a guess.
  }
}

/** The greeting holds for 7s; the key prompt follows once it has cleared. */
const KEY_PROMPT_DELAY_MS = 9_000;

async function main(): Promise<void> {
  if (!isWritingSurface(location)) return;
  // Word's editor is an iframe, so frames are allowed there and nowhere else.
  if (window.top !== window.self && !location.hostname.endsWith('.officeapps.live.com')) return;
  if (!document.body) return;

  let settings = await loadSettings();
  if (!isActiveOn(settings, location.hostname)) return;

  const { mountHost } = await import('./host');
  const host = mountHost();
  const pack = await loadPack(settings.characterPack);

  const stored = await ext.storage.local.get(DISMISSAL_KEY);
  const dismissals = (stored[DISMISSAL_KEY] ?? {}) as Record<string, number>;

  const queue = new SuggestionQueue({ dismissals });
  const detector = new BreakpointDetector(
    settings.debugMode ? { minSilenceMs: DEBUG_SILENCE_MS } : {},
  );

  const layout = await loadLayout();
  let releasePanel: (() => void) | undefined;

  const agent = new Agent(pack, {
    ...(layout.agent ? { position: layout.agent } : {}),
    onMoved: (position) => void saveLayout({ agent: position }),
    onClick: () => onAgentClick(),
    onDismiss: () => {
      agent.hide();
      void saveSettings({ snoozeUntil: Date.now() + HIDE_DURATION_MS });
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
          run: () => {
            renderer.resolveCurrent();
            openPanel();
          },
        },
        { label: 'Thanks', primary: true, run: () => renderer.resolveCurrent() },
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
  async function runChecks(): Promise<void> {
    if (renderer.isMuted) return;
    // Proactive notes are about the writer's own text. On an ordinary page that
    // means a field they have typed in; the page body is somebody else's prose,
    // and repeated nav or card titles read as echoes. Clicking him still reviews
    // the whole page on request.
    if (!source.canEdit()) return;
    const text = await source.read();
    if (!text || text === lastReviewed) return;
    lastReviewed = text;
    for (const suggestion of review(text)) queue.add(suggestion);
  }

  let panel: ChatPanel | undefined;

  /** Where each applied edit landed, so undo can find it again. */
  const landedAt = new WeakMap<AgentChange, number>();

  /**
   * Fix drafts, keyed by question and the document they were drafted against.
   * Reopening the panel on unchanged text reuses them instead of paying again.
   */
  const drafts = new Map<string, Promise<AgentReply>>();

  function askAgent(question: string, history: readonly ChatTurn[]): Promise<AgentReply> {
    if (history.length > 0) return askAgentUncached(question, history);
    return (async () => {
      const document_ = (await source.read()) ?? '';
      const key = `${question}\u0000${document_}`;
      let draft = drafts.get(key);
      if (!draft) {
        draft = askAgentUncached(question, history);
        drafts.set(key, draft);
        // A failure should be retryable, not remembered.
        draft.catch(() => drafts.delete(key));
      }
      return draft;
    })();
  }

  /** Send a question to the background worker, which owns the API key. */
  async function askAgentUncached(
    question: string,
    history: readonly ChatTurn[],
  ): Promise<AgentReply> {
    const document_ = (await source.read()) ?? '';
    const findings = review(document_).map((f) => f.text);

    const response = (await ext.runtime.sendMessage({
      type: 'mrclippy:ask',
      question,
      document: document_,
      history,
      findings,
      canEdit: source.canEdit(),
    })) as AskResponse | undefined;

    if (!response) throw new Error('No reply from the background worker. Try reloading the tab.');
    if (!response.ok) {
      if (response.needsKey) openSettings();
      throw new Error(response.error);
    }
    if (!response.edits || response.edits.length === 0) return { text: response.text };

    // Proposals only. Nothing touches the document until the user applies one.
    return { text: response.text, proposals: response.edits };
  }

  /** The user accepted one or more proposals. */
  async function applyProposals(edits: readonly DocumentEdit[]): Promise<AgentChange[]> {
    void agent.play('Writing');
    const changes = await applyEdits(edits);
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
      await source.select(passage);
      await new Promise((r) => setTimeout(r, 250));
      highlighter.show(source.boxes(passage));
    } catch {
      // Nothing to point at — the text may have changed since the check ran.
    }
  }

  /**
   * One at a time, in order. Each edit is located in the document as it stands
   * after the previous one, so earlier edits can never shift a later one onto
   * the wrong words.
   */
  async function applyEdits(edits: readonly DocumentEdit[]): Promise<AgentChange[]> {
    const changes: AgentChange[] = [];
    for (const edit of edits) {
      const outcome = await source.replace(edit.find, edit.replace);
      const change: AgentChange = outcome.applied
        ? { find: edit.find, replace: edit.replace, applied: true }
        : {
            find: edit.find,
            replace: edit.replace,
            applied: false,
            reason: FAILURE_REASONS[outcome.reason],
          };
      if (outcome.applied) landedAt.set(change, outcome.start);
      changes.push(change);
    }
    return changes;
  }

  /** Reverse order, each one pinned to where it was written. */
  async function undoChanges(changes: readonly AgentChange[]): Promise<string> {
    let undone = 0;
    for (const change of [...changes].reverse()) {
      const outcome = await source.replace(change.replace, change.find, landedAt.get(change));
      if (outcome.applied) undone += 1;
    }
    lastReviewed = '';
    if (undone === changes.length) return 'Put it back the way it was.';
    if (undone === 0) throw new Error("Couldn't undo that. The text has changed since. Cmd+Z still works.");
    return `Undid ${undone} of ${changes.length}. The rest had changed since. Cmd+Z can get them.`;
  }

  /** Run the structure ladder and render the result as one readable answer. */
  async function auditStructure(): Promise<string> {
    const text = (await source.read()) ?? '';
    if (!text) return source.explainFailure?.() ?? "I can't read this document.";

    const response = (await ext.runtime.sendMessage({
      type: 'mrclippy:audit',
      document: text,
    })) as AuditResponse | undefined;

    if (!response) throw new Error('No reply from the background worker. Try reloading the tab.');
    if (!response.ok) {
      if (response.needsKey) openSettings();
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
      const text = await source.read();

      // A failed read is worth saying out loud — the three Docs failure modes
      // need three different fixes, and "it didn't work" helps nobody.
      if (!text) {
        agent.balloon.unlock();
        agent.balloon.say(source.explainFailure?.() ?? "There's nothing here I can read.");
        agent.balloon.lock();
        return;
      }

      const findings = review(text);

      panel = new ChatPanel({
        findings: findings.map((f) => ({ text: f.text, ...(f.anchor ? { anchor: f.anchor } : {}) })),
        canEdit: source.canEdit(),
        prefetch: source.canEdit(),
        onAsk: askAgent,
        onApply: applyProposals,
        onLocate: locatePassage,
        onUndo: undoChanges,
        onAudit: auditStructure,
        onDismissFinding: (index) => {
          const finding = findings[index];
          if (!finding) return;
          queue.dismiss(finding.kind);
          void ext.storage.local.set({ [DISMISSAL_KEY]: queue.dismissalState() });
        },
        onClose: closePanel,
        onSettings: openSettings,
        onSnooze: () => {
          closePanel();
          void agent.play('GoodBye');
          void saveSettings({ snoozeUntil: Date.now() + SNOOZE_DURATION_MS });
        },
      });

      agent.balloon.render(panel.el);
      releasePanel?.();
      releasePanel = makePanelMovable(agent.balloon, panel.handle, (await loadLayout()).panel);
      panel.focus();
      void agent.play(findings.length > 0 ? 'Explain' : 'Congratulate');
    })();
  }

  function closePanel(): void {
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

  // Order matters: the producer subscribes before the renderer, so a breakpoint
  // populates the queue before anything tries to drain it. Listener order is
  // insertion order, which a Set guarantees.
  detector.on(() => void runChecks());

  detector.start();
  renderer.start();
  agent.show();

  void agent.play('Greeting');
  agent.nudge('It looks like you are writing something. Click me if you want a hand.');

  // First run: right after the greeting, the one setup step that matters.
  void hasApiKey().then((hasKey) => {
    if (hasKey) return;
    setTimeout(() => {
      if (agent.balloon.isLocked) return; // They already opened something.
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
      );
    }, KEY_PROMPT_DELAY_MS);
  });

  const stopWatching = onSettingsChanged((next: Settings) => {
    settings = next;
    renderer.setMuted(isSilenced(settings));
    if (!isActiveOn(settings, location.hostname)) teardown();
  });

  ext.runtime.onMessage.addListener((message: { type?: string }) => {
    if (message?.type === 'mrclippy:toggle') {
      if (agent.isVisible) agent.hide();
      else agent.show();
    }
    if (message?.type === 'mrclippy:mute') {
      void saveSettings({ muted: !settings.muted });
    }
  });

  function teardown(): void {
    stopWatching();
    detector.stop();
    renderer.stop();
    source.dispose?.();
    highlighter.dispose();
    agent.destroy();
    host.destroy();
  }

  window.addEventListener('pagehide', teardown);
}

void main().catch((error: unknown) => {
  // A broken character must never break the page it is sitting on.
  console.warn('[mr-clippy] failed to start:', error);
});
