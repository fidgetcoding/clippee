import type { DocumentEdit } from '../agent/types';
import type { AgentChange, ChatPanelOptions, Thread } from './chatTypes';
import { renderDiff } from './diffView';

/**
 * The cards that carry document changes: proposals (before/after, Apply or
 * Skip), receipts (what landed, Undo/Redo), and the Fix all bar. Plain
 * functions over a small context so the panel class stays about threads.
 */
export interface CardContext {
  readonly options: ChatPanelOptions;
  appendText(role: 'user' | 'assistant' | 'error', text: string, thread: Thread): HTMLElement;
  pointsAt(el: HTMLElement, passage: string): void;
}

/**
 * What it would look like. Every edit is a before/after row with its own
 * Apply and Skip, so the user takes the changes they want and only those.
 */
export function proposalCard(
ctx: CardContext,
edits: readonly DocumentEdit[],
thread: Thread,
): HTMLElement {
  const box = document.createElement('div');
  box.className = 'mrclippy-proposals';

  const head = document.createElement('div');
  head.className = 'mrclippy-receipt-head';
  head.textContent =
    edits.length === 1
      ? 'Here is what it would look like. Nothing changes until you apply it.'
      : `${edits.length} changes. Take the ones you want. Nothing changes until you apply.`;
  box.appendChild(head);

  const rows: { edit: DocumentEdit; row: HTMLElement; done: boolean }[] = [];
  let applyAll: HTMLButtonElement | undefined;
  let appliedAny = false;
  const settle = (): void => {
    if (!rows.every((r) => r.done)) return;
    applyAll?.remove();
    thread.onStatus?.(appliedAny ? 'Applied' : 'Skipped', 'done');
  };

  const apply = async (picked: typeof rows): Promise<AgentChange[]> => {
    const { onApply } = ctx.options;
    if (!onApply || picked.length === 0) return [];
    for (const r of picked) {
      r.done = true;
      r.row.classList.add('mrclippy-proposal-busy');
      for (const b of r.row.querySelectorAll('button')) b.disabled = true;
    }
    settle();
    try {
      const changes = await onApply(picked.map((r) => r.edit));
      if (changes.some((c) => c.applied)) {
        appliedAny = true;
        if (rows.every((r) => r.done)) thread.onStatus?.('Applied', 'done');
      }
      picked.forEach((r, i) => {
        const change = changes[i];
        r.row.replaceWith(receipt(ctx, change ? [change] : [], thread));
      });
      return changes;
    } catch (error: unknown) {
      ctx.appendText('error', error instanceof Error ? error.message : 'Could not apply that.', thread);
      for (const r of picked) {
        r.done = false;
        r.row.classList.remove('mrclippy-proposal-busy');
        for (const b of r.row.querySelectorAll('button')) b.disabled = false;
      }
      return [];
    }
  };

  for (const edit of edits) {
    const row = document.createElement('div');
    row.className = 'mrclippy-change mrclippy-proposal';
    const entry = { edit, row, done: false };
    rows.push(entry);

    row.appendChild(renderDiff(edit.find, edit.replace));
    ctx.pointsAt(row, edit.find);

    const buttons = document.createElement('div');
    buttons.className = 'mrclippy-proposal-actions';

    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'mrclippy-btn';
    skip.textContent = 'Skip';
    skip.addEventListener('click', () => {
      entry.done = true;
      row.classList.add('mrclippy-proposal-skipped');
      buttons.remove();
      settle();
    });

    const take = document.createElement('button');
    take.type = 'button';
    take.className = 'mrclippy-btn mrclippy-btn-primary';
    take.textContent = 'Apply';
    take.addEventListener('click', () => void apply([entry]));

    buttons.append(skip, take);
    row.appendChild(buttons);
    box.appendChild(row);
  }

  thread.applyAll = () => apply(rows.filter((r) => !r.done));

  if (edits.length > 1) {
    applyAll = document.createElement('button');
    applyAll.type = 'button';
    applyAll.className = 'mrclippy-btn mrclippy-btn-primary';
    applyAll.textContent = 'Apply all';
    applyAll.addEventListener('click', () => void apply(rows.filter((r) => !r.done)));
    box.appendChild(applyAll);
  }

  return box;
}

/**
 * What he actually changed, under what he said. Every edit is listed, so a
 * change can never happen without the user being able to see it, and the ones
 * that failed say why instead of vanishing.
 */
export function receipt(
ctx: CardContext,
changes: readonly AgentChange[],
thread: Thread,
): HTMLElement {
  const box = document.createElement('div');
  box.className = 'mrclippy-receipt';

  const applied = changes.filter((c) => c.applied);
  const head = document.createElement('div');
  head.className = 'mrclippy-receipt-head';
  head.textContent =
    applied.length === changes.length
      ? `Changed ${applied.length} thing${applied.length === 1 ? '' : 's'}.`
      : `Changed ${applied.length} of ${changes.length}.`;
  box.appendChild(head);

  for (const change of changes) {
    const row = document.createElement('div');
    row.className = `mrclippy-change${change.applied ? '' : ' mrclippy-change-failed'}`;
    row.appendChild(renderDiff(change.find, change.replace));
    ctx.pointsAt(row, change.applied ? change.replace || change.find : change.find);

    if (!change.applied && change.reason) {
      const why = document.createElement('div');
      why.className = 'mrclippy-change-why';
      why.textContent = change.reason;
      row.appendChild(why);
    }
    box.appendChild(row);
  }

  const { onUndo, onApply } = ctx.options;
  if (onUndo && applied.length > 0) {
    // One button that flips between Undo and Redo, so a change can be taken
    // back and put back as many times as the user likes.
    let current: readonly AgentChange[] = applied;
    let undone = false;
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'mrclippy-btn';
    toggle.textContent = 'Undo';
    const idle = (): void => {
      toggle.disabled = false;
      toggle.textContent = undone ? 'Redo' : 'Undo';
      box.classList.toggle('mrclippy-receipt-undone', undone);
    };
    toggle.addEventListener('click', () => {
      toggle.disabled = true;
      if (!undone) {
        toggle.textContent = 'Undoing…';
        void onUndo(current)
          .then((line) => {
            undone = true;
            idle();
            ctx.appendText('assistant', line, thread);
          })
          .catch((error: unknown) => {
            idle();
            ctx.appendText('error', error instanceof Error ? error.message : 'Undo failed.', thread);
          });
        return;
      }
      if (!onApply) return;
      toggle.textContent = 'Redoing…';
      void onApply(current.map((c) => ({ find: c.find, replace: c.replace })))
        .then((changes) => {
          const landed = changes.filter((c) => c.applied);
          if (landed.length === 0) {
            idle();
            ctx.appendText('error', "Couldn't put it back. The text has changed since.", thread);
            return;
          }
          current = landed;
          undone = false;
          idle();
          ctx.appendText('assistant', 'Put the change back in.', thread);
        })
        .catch((error: unknown) => {
          idle();
          ctx.appendText('error', error instanceof Error ? error.message : 'Redo failed.', thread);
        });
    });
    box.appendChild(toggle);
  }

  return box;
}

/**
 * "Fix all": says exactly what it will do before it does it, waits for any
 * drafts still in flight, applies every one, then shows the whole set with a
 * single Undo that takes all of it back.
 */
export function fixAllBar(
ctx: CardContext,
fixable: readonly (() => { thread: Thread })[],
main: Thread,
): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'mrclippy-fixall';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mrclippy-btn mrclippy-btn-primary';
  button.textContent = `Fix all ${fixable.length}`;

  const hint = document.createElement('span');
  hint.className = 'mrclippy-fixall-hint';
  hint.textContent = `Applies all ${fixable.length} fixes below to your document. One Undo takes them all back.`;

  button.addEventListener('click', () => {
    void (async () => {
      button.disabled = true;
      const threads = fixable.map((ensure) => ensure().thread);
      let ready = 0;
      const progress = (): void => {
        button.textContent = `Drafting\u2026 ${ready} of ${threads.length} ready`;
      };
      progress();
      await Promise.all(
        threads.map((t) =>
          (t.drafting ?? Promise.resolve()).then(() => {
            ready += 1;
            progress();
          }),
        ),
      );

      button.textContent = 'Applying\u2026';
      const changes: AgentChange[] = [];
      // One at a time: each edit is located in the document as it stands now.
      for (const t of threads) changes.push(...((await t.applyAll?.()) ?? []));

      const landed = changes.filter((c) => c.applied).length;
      bar.replaceChildren();
      const done = document.createElement('div');
      done.className = 'mrclippy-receipt-head';
      done.textContent =
        changes.length === 0
          ? 'Nothing left to apply.'
          : `Applied ${landed} of ${changes.length} changes.`;
      bar.appendChild(done);
      if (changes.length > 0) bar.appendChild(receipt(ctx, changes, main));
    })();
  });

  bar.append(button, hint);
  return bar;
}
