import type { DocumentEdit } from '../agent/types';
import type { AgentChange, ChatPanelOptions, Thread } from './chatTypes';
import { renderDiff } from './diffView';
import { button, checkbox, groupBox } from './panelChrome';
import { bullet, statusIcon } from './statusIcons';

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
  const n = edits.length;
  const { box: group, well } = groupBox(n === 1 ? 'Proposed change (1)' : `Proposed changes (${n})`);
  box.appendChild(group);

  const rows: { edit: DocumentEdit; row: HTMLElement; done: boolean }[] = [];
  let applyAll: HTMLButtonElement | undefined;
  let appliedAny = false;
  let failure: string | undefined;
  const settle = (): void => {
    if (!rows.every((r) => r.done)) return;
    applyAll?.parentElement?.remove();
    thread.onStatus?.(
      appliedAny
        ? { kind: 'applied' }
        : failure !== undefined
          ? { kind: 'failed', reason: failure }
          : { kind: 'skipped' },
    );
  };

  const apply = async (picked: typeof rows): Promise<AgentChange[]> => {
    const { onApply } = ctx.options;
    if (!onApply || picked.length === 0) return [];
    for (const r of picked) {
      r.done = true;
      r.row.classList.add('mrclippy-proposal-busy');
      for (const b of r.row.querySelectorAll('button')) b.disabled = true;
    }
    try {
      const changes = await onApply(picked.map((r) => r.edit));
      if (changes.some((c) => c.applied)) appliedAny = true;
      const missed = changes.find((c) => !c.applied);
      if (missed) failure ??= missed.reason ?? "Couldn't apply it.";
      picked.forEach((r, i) => {
        const change = changes[i];
        r.row.replaceWith(receipt(ctx, change ? [change] : [], thread));
      });
      settle();
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

    row.append(bullet(), renderDiff(edit.find, edit.replace));
    ctx.pointsAt(row, edit.find);

    const buttons = document.createElement('div');
    buttons.className = 'mrclippy-proposal-actions';

    const take = button('Apply', 'mrclippy-btn-sm mrclippy-btn-primary');
    take.addEventListener('click', () => void apply([entry]));

    const skip = button('Skip', 'mrclippy-btn-sm');
    skip.addEventListener('click', () => {
      entry.done = true;
      row.classList.add('mrclippy-proposal-skipped');
      buttons.remove();
      settle();
    });

    buttons.append(take, skip);
    row.appendChild(buttons);
    well.appendChild(row);
  }

  thread.applyAll = () => apply(rows.filter((r) => !r.done));

  if (n > 1) {
    const foot = document.createElement('div');
    foot.className = 'mrclippy-apply-all';
    applyAll = button(`Apply all ${n}`, 'mrclippy-btn-primary');
    applyAll.addEventListener('click', () => void apply(rows.filter((r) => !r.done)));
    foot.appendChild(applyAll);
    box.appendChild(foot);
  }

  return box;
}

/** One row of a receipt: a tick or a cross, the diff, and why when it failed. */
function changeRow(ctx: CardContext, change: AgentChange): HTMLElement {
  const row = document.createElement('div');
  row.className = `mrclippy-change mrclippy-rc${change.applied ? '' : ' mrclippy-change-failed'}`;
  if (change.applied) row.dataset.fixed = '';
  const body = document.createElement('div');
  body.appendChild(renderDiff(change.find, change.replace));
  if (!change.applied && change.reason) {
    const why = document.createElement('div');
    why.className = 'mrclippy-change-why mrclippy-why';
    why.textContent = `Not applied. ${change.reason}`;
    body.appendChild(why);
  }
  row.append(statusIcon(change.applied ? 'ok' : 'err'), body);
  ctx.pointsAt(row, change.applied ? change.replace || change.find : change.find);
  return row;
}

/**
 * Undo and Redo over one set of applied changes, as many times as the user
 * likes. `draw` repaints whichever buttons the caller shows.
 */
function undoRedo(
  ctx: CardContext,
  applied: readonly AgentChange[],
  thread: Thread,
  draw: (state: { undone: boolean; busy?: 'Undoing…' | 'Redoing…'; many: boolean }) => void,
): { undo(): void; redo(): void } {
  let current = applied;
  let undone = false;
  let batch = applied;
  let busy = false;
  const undoneChanges = new Set<AgentChange>();
  const idle = (): void => draw({ undone, many: current.length > 1 });
  idle();
  return {
    undo: () => {
      const { onUndo } = ctx.options;
      if (!onUndo || undone || busy) return;
      busy = true;
      draw({ undone, busy: 'Undoing…', many: current.length > 1 });
      void onUndo(current)
        .then((result) => {
          const completed = typeof result === 'string' ? current : result.undone;
          for (const change of completed) undoneChanges.add(change);
          current = current.filter((change) => !undoneChanges.has(change));
          undone = current.length === 0;
          if (undone) {
            // Redo follows the original application order, not reverse undo order.
            current = batch.filter((change) => undoneChanges.has(change));
            thread.onStatus?.({ kind: 'answered' });
          }
          busy = false;
          idle();
          ctx.appendText('assistant', typeof result === 'string' ? result : result.message, thread);
        })
        .catch((error: unknown) => {
          busy = false;
          idle();
          ctx.appendText('error', error instanceof Error ? error.message : 'Undo failed.', thread);
        });
    },
    redo: () => {
      const { onApply, onRedo } = ctx.options;
      if ((!onApply && !onRedo) || !undone || busy) return;
      busy = true;
      draw({ undone, busy: 'Redoing…', many: current.length > 1 });
      const pending = onRedo ? onRedo(current)
        : onApply!(current.map((c) => ({ find: c.find, replace: c.replace })));
      void pending
        .then((changes) => {
          busy = false;
          const attempted = current.length;
          const landed = changes.filter((c) => c.applied);
          if (landed.length === 0) {
            idle();
            ctx.appendText('error', "Couldn't put it back. The text has changed since.", thread);
            return;
          }
          current = landed;
          batch = landed;
          undoneChanges.clear();
          undone = false;
          thread.onStatus?.({ kind: 'applied' });
          idle();
          ctx.appendText('assistant', landed.length === attempted ? 'Put the change back in.'
            : `Put back ${landed.length} of ${attempted} changes. The rest could not be applied.`, thread);
        })
        .catch((error: unknown) => {
          busy = false;
          idle();
          ctx.appendText('error', error instanceof Error ? error.message : 'Redo failed.', thread);
        });
    },
  };
}

/**
 * What he actually changed, inline under what he said. Every edit is listed,
 * so a change can never happen without the user being able to see it, and the
 * ones that failed say why instead of vanishing. One button flips between Undo
 * and Redo.
 */
export function receipt(
  ctx: CardContext,
  changes: readonly AgentChange[],
  thread: Thread,
): HTMLElement {
  const box = document.createElement('div');
  box.className = 'mrclippy-receipt';
  const applied = changes.filter((c) => c.applied);

  // Failures last: what landed is what the user needs to scan first.
  const ordered = [...changes].sort((a, b) => Number(b.applied) - Number(a.applied));
  for (const change of ordered) box.appendChild(changeRow(ctx, change));

  if (ctx.options.onUndo && applied.length > 0) {
    const toggle = button('Undo', 'mrclippy-btn-sm mrclippy-receipt-toggle');
    const control = undoRedo(ctx, applied, thread, ({ undone, busy, many }) => {
      toggle.disabled = busy !== undefined;
      toggle.textContent = busy ?? (undone ? 'Redo' : 'Undo') + (many ? ' all' : '');
      box.classList.toggle('mrclippy-receipt-undone', undone);
    });
    toggle.addEventListener('click', () => {
      if (box.classList.contains('mrclippy-receipt-undone')) control.redo();
      else control.undo();
    });
    box.appendChild(toggle);
  }
  return box;
}

/**
 * The Fix all result as a screen of its own: "Applied X of Y", the changes in
 * a group (failures muted, last, with the reason), and Undo all / Redo pinned
 * at the foot of the thread.
 */
export function receiptScreen(
  ctx: CardContext,
  changes: readonly AgentChange[],
  thread: Thread,
): HTMLElement {
  const box = document.createElement('div');
  box.className = 'mrclippy-receipt mrclippy-receipt-screen';
  const applied = changes.filter((c) => c.applied);

  const hd = document.createElement('div');
  hd.className = 'mrclippy-hd';
  const big = document.createElement('div');
  big.className = 'mrclippy-big';
  big.textContent = `Applied ${applied.length} of ${changes.length}`;
  hd.appendChild(big);
  if (applied.length > 0 && ctx.options.onUndo) {
    const sub = document.createElement('div');
    sub.className = 'mrclippy-sub';
    sub.textContent = 'One Undo all takes every change back out.';
    hd.appendChild(sub);
  }

  const hide = checkbox(`Hide applied (${applied.length})`, (on) =>
    box.classList.toggle('mrclippy-hide-fixed', on),
  );
  const { box: group, well } = groupBox('Changes', hide.el);
  const hidden = document.createElement('div');
  hidden.className = 'mrclippy-hidden-note';
  hidden.textContent = `${applied.length} applied change${applied.length === 1 ? '' : 's'} hidden. Untick to show them.`;
  well.appendChild(hidden);
  const ordered = [...changes].sort((a, b) => Number(b.applied) - Number(a.applied));
  for (const change of ordered) well.appendChild(changeRow(ctx, change));

  const gp = document.createElement('div');
  gp.className = 'mrclippy-gp';
  gp.appendChild(group);
  box.append(hd, gp);

  if (ctx.options.onUndo && applied.length > 0) {
    const foot = document.createElement('div');
    foot.className = 'mrclippy-foot-bar';
    const undo = button('Undo all', 'mrclippy-btn-primary');
    const redo = button('Redo');
    const control = undoRedo(ctx, applied, thread, ({ undone, busy }) => {
      undo.disabled = undone || busy !== undefined;
      redo.disabled = !undone || busy !== undefined;
      undo.textContent = busy === 'Undoing…' ? busy : 'Undo all';
      redo.textContent = busy === 'Redoing…' ? busy : 'Redo';
      box.classList.toggle('mrclippy-receipt-undone', undone);
    });
    undo.addEventListener('click', () => control.undo());
    redo.addEventListener('click', () => control.redo());
    foot.append(undo, redo);
    thread.foot = foot;
  }
  return box;
}

/**
 * "Fix all": says exactly what it will do before it does it, waits for any
 * drafts still in flight, applies every one, then hands the whole set to
 * `onDone`, which shows it with a single Undo that takes all of it back.
 */
export function fixAllBar(
  fixable: readonly (() => { thread: Thread })[],
  onDone: (changes: AgentChange[]) => void,
): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'mrclippy-fixall';

  const run = button(`Fix all ${fixable.length}`, 'mrclippy-btn-primary mrclippy-btn-big');

  const hint = document.createElement('span');
  hint.className = 'mrclippy-fixall-hint';
  hint.textContent = `Applies all ${fixable.length} fixes below to your document. One Undo takes them all back.`;

  run.addEventListener('click', () => {
    void (async () => {
      run.disabled = true;
      const threads = fixable.map((ensure) => ensure().thread);
      let ready = 0;
      const progress = (): void => {
        hint.textContent = `Writing fixes: ${ready} of ${threads.length} done.`;
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

      hint.textContent = 'Applying…';
      const changes: AgentChange[] = [];
      // One at a time: each edit is located in the document as it stands now.
      for (const t of threads) changes.push(...((await t.applyAll?.()) ?? []));

      if (changes.length === 0) {
        run.remove();
        hint.textContent = 'Nothing left to apply.';
        return;
      }
      const landed = changes.filter((c) => c.applied).length;
      const again = button('Show changes', 'mrclippy-btn-big');
      again.addEventListener('click', () => onDone(changes));
      run.replaceWith(again);
      hint.textContent = `Applied ${landed} of ${changes.length}. Undo all is on that screen.`;
      onDone(changes);
    })();
  });

  bar.append(run, hint);
  return bar;
}
