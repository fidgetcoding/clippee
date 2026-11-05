import { fixAllBar, type FixAllBar } from './changeCards';
import type { AgentChange, ChatPanelOptions, PanelFinding, Thread, ThreadState } from './chatTypes';
import type { NoteRow, NotesView } from './notesView';
import type { NoteControl } from './panelActions';

export interface NoteEntry extends NoteControl {
  dismissed: boolean;
  ensure(): { thread: Thread; started: Promise<void> | undefined };
}

/** What the notes screen needs from the panel that owns its threads. */
export interface NotesWiring {
  readonly options: ChatPanelOptions;
  readonly notes: NotesView;
  /** The fix thread for one finding, started the first time it is asked for. */
  fixThread(
    index: number,
    finding: PanelFinding,
    onStatus: (state: ThreadState) => void,
  ): { thread: Thread; started: Promise<void> | undefined };
  existing(index: number): Thread | undefined;
  forget(index: number): void;
  show(thread: Thread): void;
  pointsAt(el: HTMLElement, passage: string): void;
  showFixAll(changes: AgentChange[]): void;
  isDisposed(): boolean;
}

/**
 * Draft every fix in the background, a few at a time, so by the time the user
 * reads the list each row can be applied in one click.
 */
function prefetchFixes(starters: (() => Promise<void> | undefined)[], disposed: () => boolean): void {
  const queue = [...starters];
  const worker = async (): Promise<void> => {
    for (let next = queue.shift(); next && !disposed(); next = queue.shift()) await next();
  };
  // The first draft runs alone so it writes the document to the prompt cache;
  // the rest then read it from there instead of paying for it again.
  const first = queue.shift();
  void Promise.resolve(first?.()).finally(() => {
    for (let i = 0; i < Math.min(3, queue.length); i++) void worker();
  });
}

/**
 * The notes screen: every local finding, each with its own fix. A row's
 * buttons and the chat go through the same entry, so asking for a thing and
 * clicking it can never do two different things.
 */
export function wireNotes(w: NotesWiring): { controls: NoteEntry[]; fixAll(): FixAllBar | undefined } {
  const { options, notes } = w;
  const controls: NoteEntry[] = [];
  const prefetch: (() => Promise<void> | undefined)[] = [];
  let bar: FixAllBar | undefined;
  const refreshFixAll = (): void => {
    const fixable = controls.filter((c) => c.canFix && !c.dismissed);
    bar = fixable.length > 1 ? fixAllBar(fixable.map((c) => () => c.ensure()), (changes) => w.showFixAll(changes)) : undefined;
    notes.setFixAll(bar?.el);
  };

  options.findings.forEach((finding, index) => {
    const canFix = finding.anchor !== undefined && options.canEdit !== false && !options.needsKey;
    const row: NoteRow = notes.addNote(finding, {
      dismiss: () => {
        entry.dismissed = true;
        refreshFixAll();
        options.onDismissFinding(index);
      },
      ...(canFix
        ? {
            fix: {
              label: options.prefetch ? 'Review' : 'Fix',
              // One click: applies the drafted fix straight from the list.
              apply: () => void entry.apply(),
              review: () => entry.open(),
              retry: () => entry.retry(),
            },
          }
        : {}),
    });
    const ensure = (): ReturnType<NoteEntry['ensure']> => w.fixThread(index, finding, (state) => row.setState(state));
    const entry: NoteEntry = {
      index, finding, row, canFix, dismissed: false, ensure,
      thread: () => w.existing(index),
      open: () => {
        if (!canFix) {
          if (finding.anchor) options.onLocate?.(finding.anchor);
          return;
        }
        w.show(ensure().thread);
        row.opened();
      },
      apply: async () => {
        if (!canFix) return [];
        const { thread } = ensure();
        await thread.drafting;
        return (await thread.applyAll?.()) ?? [];
      },
      retry: () => {
        w.forget(index);
        ensure();
      },
    };
    controls.push(entry);
    if (finding.anchor) w.pointsAt(row.el, finding.anchor);
    if (canFix && options.prefetch) prefetch.push(() => entry.dismissed ? undefined : ensure().started);
  });

  refreshFixAll();
  if (options.needsKey && options.findings.length > 0) notes.askForKey(options.onSettings);
  if (prefetch.length > 0) prefetchFixes(prefetch, w.isDisposed);
  return { controls, fixAll: () => bar };
}
