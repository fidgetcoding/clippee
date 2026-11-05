import type { AgentChange, ChangeControl, Thread } from './chatTypes';
import type { HistoryApi, HistoryEntry, HistoryOutcome } from './docHistory';
import { renderDiff } from './diffView';
import { button, groupBox } from './panelChrome';
import { bullet, statusIcon } from './statusIcons';

/**
 * The History screen: every change he has made to this doc, newest first,
 * each with its own Undo or Redo, and Undo all / Redo all / Clear history at
 * the top. Reached from the title bar; works from the chat too.
 */
export interface HistoryScreen {
  readonly el: HTMLElement;
  /** Read the History again and redraw. */
  refresh(): Promise<void>;
  undoAll(): Promise<string>;
  redoAll(): Promise<string>;
  /** The newest change still in, with the rest of the Apply it came from. */
  undoLast(): Promise<string>;
  dispose(): void;
}

export interface HistoryScreenOptions {
  readonly api: HistoryApi;
  /** Bring this page's receipts in line after the History swapped their changes. */
  readonly afterSwap?: (done: readonly string[], direction: 'undo' | 'redo') => Promise<void>;
  readonly pointsAt?: (el: HTMLElement, passage: string) => void;
  readonly now?: () => number;
}

const CHANGED_SINCE = "Changed since. Can't undo safely.";

/** "just now", "4 min ago", "2 h ago", "yesterday", "6 days ago". */
export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, now - at) / 1000;
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  if (s < 172_800) return 'yesterday';
  return `${Math.floor(s / 86_400)} days ago`;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

export function historyScreen(options: HistoryScreenOptions): HistoryScreen {
  const { api } = options;
  const now = options.now ?? Date.now;
  const el = document.createElement('div');
  el.className = 'mrclippy-history';

  const hd = document.createElement('div');
  hd.className = 'mrclippy-hd';
  const big = document.createElement('div');
  big.className = 'mrclippy-big';
  big.textContent = 'History';
  const sub = document.createElement('div');
  sub.className = 'mrclippy-sub';
  sub.textContent = 'Every change I’ve made to this doc, newest first.';
  const privacy = document.createElement('div');
  privacy.className = 'mrclippy-history-privacy';
  privacy.textContent = 'Kept on this computer only. Never synced, never sent anywhere.';
  sub.appendChild(privacy);
  hd.append(big, sub);

  const bar = document.createElement('div');
  bar.className = 'mrclippy-history-bar';
  const undoAllBtn = button('Undo all', 'mrclippy-btn-primary');
  const redoAllBtn = button('Redo all');
  const gap = document.createElement('span');
  gap.className = 'mrclippy-history-gap';
  const clearBtn = button('Clear history', 'mrclippy-btn-sm');
  bar.append(undoAllBtn, redoAllBtn, gap, clearBtn);

  const said = document.createElement('div');
  said.className = 'mrclippy-history-said';
  said.hidden = true;

  const gp = document.createElement('div');
  gp.className = 'mrclippy-gp';
  el.append(hd, bar, said, gp);

  let entries: readonly HistoryEntry[] = [];
  /** What the last Undo all (or "undo the last fix") took out, for Redo all to put back. */
  let lastUndoAll: string[] = [];
  /** Per entry, the last thing that went wrong with it. */
  const problems = new Map<string, string>();
  let busy = false;
  let disposed = false;
  let clearArmed: ReturnType<typeof setTimeout> | undefined;

  const say = (text: string): string => {
    said.textContent = text;
    said.hidden = text === '';
    return text;
  };

  function draw(): void {
    const applied = entries.filter((e) => e.state === 'applied');
    const redoable = entries.filter((e) => e.state === 'undone' && lastUndoAll.includes(e.id));
    undoAllBtn.disabled = busy || applied.length === 0;
    redoAllBtn.disabled = busy || redoable.length === 0;
    clearBtn.disabled = busy || entries.length === 0;

    const { box, well } = groupBox(entries.length === 0 ? 'Changes' : `Changes (${entries.length})`);
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'mrclippy-say';
      empty.textContent = 'Nothing yet. Every change I make to this doc shows up here.';
      well.appendChild(empty);
    }
    for (const entry of entries) well.appendChild(row(entry));
    gp.replaceChildren(box);
  }

  function row(entry: HistoryEntry): HTMLElement {
    const out = entry.state === 'undone';
    const el = document.createElement('div');
    el.className = 'mrclippy-change mrclippy-hist';
    el.dataset.state = entry.state;
    const body = document.createElement('div');
    body.className = 'mrclippy-hist-body';
    body.appendChild(renderDiff(entry.find, entry.replace));
    const meta = document.createElement('div');
    meta.className = 'mrclippy-hist-meta';
    meta.textContent = `${entry.origin} · ${ago(entry.at, now())}${out ? ' · Undone' : ''}`;
    body.appendChild(meta);
    const problem = problems.get(entry.id) ?? (entry.anchor ? undefined : CHANGED_SINCE);
    if (problem) {
      const why = document.createElement('div');
      why.className = 'mrclippy-why';
      why.textContent = problem;
      body.appendChild(why);
    }
    const toggle = button(out ? 'Redo' : 'Undo', 'mrclippy-btn-sm mrclippy-hist-toggle');
    toggle.disabled = busy || !entry.anchor;
    toggle.addEventListener('click', () => void swap([entry.id], out ? 'redo' : 'undo'));
    el.append(out ? bullet(true) : statusIcon('ok'), body, toggle);
    options.pointsAt?.(el, out ? entry.find : entry.replace || entry.find);
    return el;
  }

  async function refresh(): Promise<void> {
    const next = await api.list();
    if (disposed) return;
    entries = next;
    if (!busy) draw();
  }

  /** Run one swap over some entries; resolves to how many went through. */
  async function swap(ids: readonly string[], direction: 'undo' | 'redo'): Promise<{ done: string[]; tried: number }> {
    if (busy || ids.length === 0) return { done: [], tried: 0 };
    busy = true;
    say(direction === 'undo' ? 'Undoing…' : 'Redoing…');
    draw();
    let outcomes: ReadonlyMap<string, HistoryOutcome> = new Map();
    try {
      outcomes = await (direction === 'undo' ? api.undo(ids) : api.redo(ids));
    } catch {
      // Treated as nothing done.
    }
    const done: string[] = [];
    for (const id of ids) {
      const outcome = outcomes.get(id);
      if (outcome === 'done') {
        done.push(id);
        problems.delete(id);
      } else if (outcome === 'changed' || outcome === 'failed') {
        problems.set(id, outcome === 'changed' ? CHANGED_SINCE
          : direction === 'undo' ? "Couldn't undo it. Check the doc." : "Couldn't put it back. Check the doc.");
      }
    }
    if (done.length > 0) await options.afterSwap?.(done, direction).catch(() => undefined);
    busy = false;
    say('');
    await refresh();
    return { done, tried: ids.length };
  }

  const tally = (verb: string, r: { done: string[]; tried: number }): string =>
    r.done.length === r.tried
      ? `${verb} ${plural(r.done.length, 'change')}.`
      : r.done.length === 0
        ? `Couldn't. ${r.tried === 1 ? 'It' : 'They'} changed since, so I left the doc alone.`
        : `${verb} ${r.done.length} of ${r.tried}. The rest changed since, so I left them alone.`;

  async function undoAll(): Promise<string> {
    await refresh();
    const ids = entries.filter((e) => e.state === 'applied').map((e) => e.id);
    if (ids.length === 0) return say("There's nothing in the History to undo.");
    const result = await swap(ids, 'undo');
    lastUndoAll = result.done;
    draw();
    return say(tally('Took back out', result));
  }

  async function redoAll(): Promise<string> {
    await refresh();
    const ids = entries.filter((e) => e.state === 'undone' && lastUndoAll.includes(e.id)).map((e) => e.id);
    if (ids.length === 0) return say("There's nothing to redo.");
    const result = await swap(ids, 'redo');
    lastUndoAll = lastUndoAll.filter((id) => !result.done.includes(id));
    draw();
    return say(tally('Put back', result));
  }

  async function undoLast(): Promise<string> {
    await refresh();
    const newest = entries.find((e) => e.state === 'applied');
    if (!newest) return "There's nothing to undo.";
    const ids = entries.filter((e) => e.batch === newest.batch && e.state === 'applied').map((e) => e.id);
    const result = await swap(ids, 'undo');
    lastUndoAll = result.done;
    draw();
    if (result.done.length === result.tried) return `Took "${newest.origin}" back out.`;
    return tally('Took back out', result);
  }

  undoAllBtn.addEventListener('click', () => void undoAll());
  redoAllBtn.addEventListener('click', () => void redoAll());
  clearBtn.addEventListener('click', () => {
    if (clearArmed === undefined) {
      // One more click to be sure: the doc keeps its changes, only the list goes.
      clearBtn.textContent = 'Click again to clear';
      clearArmed = setTimeout(() => {
        clearArmed = undefined;
        clearBtn.textContent = 'Clear history';
      }, 3_000);
      return;
    }
    clearTimeout(clearArmed);
    clearArmed = undefined;
    clearBtn.textContent = 'Clear history';
    lastUndoAll = [];
    problems.clear();
    void api.clear().then(() => {
      say('History cleared. Your doc keeps every change.');
      return refresh();
    });
  });

  const unsubscribe = api.subscribe(() => void refresh());
  draw();

  return {
    el,
    refresh,
    undoAll,
    redoAll,
    undoLast,
    dispose: () => {
      disposed = true;
      if (clearArmed !== undefined) clearTimeout(clearArmed);
      unsubscribe();
    },
  };
}

/** The History as a screen of the panel: its own thread, holding the screen. */
export function openHistory(
  api: HistoryApi,
  thread: Thread,
  options: Omit<HistoryScreenOptions, 'api'>,
): { thread: Thread; screen: HistoryScreen } {
  const screen = historyScreen({ api, ...options });
  thread.log.appendChild(screen.el);
  return { thread, screen };
}

/** Receipts whose changes the History just moved show it, without touching the doc again. */
export function settleReceipts(
  moved: readonly AgentChange[],
  controls: readonly ChangeControl[],
  direction: 'undo' | 'redo',
): void {
  const set = new Set(moved);
  if (set.size === 0) return;
  for (const control of controls) {
    if (control.changes.length > 0 && control.changes.every((c) => set.has(c))) control.settle(direction === 'undo');
  }
}
