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
import { ChatPanel } from './chatPanel';
import type { AskResponse, AuditResponse, ChatTurn } from '../agent/types';

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
async function main(): Promise<void> {
  if (window.top !== window.self) return;
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

  const agent = new Agent(pack, {
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
    const text = await source.read();
    if (!text || text === lastReviewed) return;
    lastReviewed = text;
    for (const suggestion of review(text)) queue.add(suggestion);
  }

  let panel: ChatPanel | undefined;

  /** Send a question to the background worker, which owns the API key. */
  async function askAgent(question: string, history: readonly ChatTurn[]): Promise<string> {
    const document_ = (await source.read()) ?? '';
    const findings = review(document_).map((f) => f.text);

    const response = (await ext.runtime.sendMessage({
      type: 'mrclippy:ask',
      question,
      document: document_,
      history,
      findings,
    })) as AskResponse | undefined;

    if (!response) throw new Error('No reply from the background worker. Try reloading the tab.');
    if (!response.ok) throw new Error(response.error);
    return response.text;
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
    if (!response.ok) throw new Error(response.error);

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
        findings: findings.map((f) => f.text),
        onAsk: askAgent,
        onAudit: auditStructure,
        onDismissFinding: (index) => {
          const finding = findings[index];
          if (!finding) return;
          queue.dismiss(finding.kind);
          void ext.storage.local.set({ [DISMISSAL_KEY]: queue.dismissalState() });
        },
        onClose: closePanel,
        onSnooze: () => {
          closePanel();
          void agent.play('GoodBye');
          void saveSettings({ snoozeUntil: Date.now() + SNOOZE_DURATION_MS });
        },
      });

      agent.balloon.render(panel.el);
      panel.focus();
      void agent.play(findings.length > 0 ? 'Explain' : 'Congratulate');
    })();
  }

  function closePanel(): void {
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
    agent.destroy();
    host.destroy();
  }

  window.addEventListener('pagehide', teardown);
}

void main().catch((error: unknown) => {
  // A broken character must never break the page it is sitting on.
  console.warn('[mr-clippy] failed to start:', error);
});
