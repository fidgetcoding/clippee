import type { Agent } from '../character/Agent';
import { ext } from '../platform';

/**
 * Ask the background to open Settings. It owns the window; we only ask. A
 * click always goes through; an automatic ask (a request failed for want of
 * a key) goes once per few seconds, since several failing together is one
 * problem.
 */
let lastAutoSettings = 0;
export function openSettings(clicked = true): void {
  if (!clicked) {
    if (Date.now() - lastAutoSettings < 5_000) return;
    lastAutoSettings = Date.now();
  }
  void ext.runtime.sendMessage({ type: 'mrclippy:open-settings' }).catch(() => undefined);
}

export async function hasApiKey(): Promise<boolean> {
  try {
    const reply = (await ext.runtime.sendMessage({ type: 'mrclippy:has-key' })) as
      | { hasKey?: boolean }
      | undefined;
    return typeof reply?.hasKey === 'boolean' ? reply.hasKey : true;
  } catch {
    return true; // Unknown: don't nag on a guess.
  }
}

/** First run, right after the greeting: the one setup step that matters. */
export function askForKey(agent: Agent): void {
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
    'Clippee by Microshaft',
  );
}
