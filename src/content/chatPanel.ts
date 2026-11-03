import type { ChatTurn } from '../agent/types';

export interface QuickAction {
  readonly id: string;
  readonly label: string;
  readonly question: string;
}

/** One edit as it actually went, for the receipt under his reply. */
export interface AgentChange {
  readonly find: string;
  readonly replace: string;
  readonly applied: boolean;
  /** Plain-English reason, when it did not apply. */
  readonly reason?: string;
}

export interface AgentReply {
  readonly text: string;
  readonly changes?: readonly AgentChange[];
}

export interface ChatPanelOptions {
  readonly onAsk: (question: string, history: readonly ChatTurn[]) => Promise<AgentReply>;
  /** Reverse the applied changes from one reply. Resolves to a line for the log. */
  readonly onUndo?: (changes: readonly AgentChange[]) => Promise<string>;
  /** The structure audit. Runs the local-then-cloud ladder, not a chat turn. */
  readonly onAudit: () => Promise<string>;
  /** Local findings, offered as an opening move rather than shoved at the user. */
  readonly findings: readonly string[];
  readonly onDismissFinding: (index: number) => void;
  readonly onClose: () => void;
  /** "Just let me write" — snooze rather than merely closing. */
  readonly onSnooze: () => void;
}

/**
 * Quick-start chips.
 *
 * A blank text box asks the user to invent a question, which is where most
 * people close the thing. These are openings, not a menu — picking one drops its
 * text into the conversation and the chat continues from there, so there is
 * never a mode to back out of.
 */
export const QUICK_ACTIONS: readonly QuickAction[] = [
  {
    id: 'tighten',
    label: 'Tighten this',
    question:
      'Pick the flabbiest paragraph in this document and tighten it in place. Keep my voice and every fact.',
  },
  {
    id: 'summarize',
    label: 'Sum it up',
    question: 'Summarise this document in three sentences.',
  },
  {
    id: 'holes',
    label: "What's missing?",
    question:
      'What is missing from this document — an unanswered question, a promise I made and never delivered, a gap in the argument? Name the single biggest one.',
  },
  {
    id: 'structure',
    label: 'Check my structure',
    // Handled locally rather than as a chat turn — it runs the signal ladder.
    question: '',
  },
  {
    id: 'critique',
    label: 'Be harsh',
    question:
      'What is the weakest part of this document and why? Be specific and quote the sentence. Do not soften it.',
  },
];

/**
 * A conversation, permanently.
 *
 * There is one view and it is the chat. Findings appear as an opening message
 * from him; quick actions are chips above the input; everything else is turns.
 * Nothing here is modal, so nothing can strand the user somewhere they have to
 * navigate out of.
 */
export class ChatPanel {
  readonly el: HTMLElement;

  private readonly log: HTMLElement;
  private readonly input: HTMLTextAreaElement;
  private readonly send: HTMLButtonElement;
  private readonly chips: HTMLElement;
  private readonly history: ChatTurn[] = [];
  private busy = false;

  constructor(private readonly options: ChatPanelOptions) {
    this.el = document.createElement('div');
    this.el.className = 'mrclippy-panel';
    this.el.appendChild(this.buildTitleBar());

    const body = document.createElement('div');
    body.className = 'mrclippy-body';

    this.log = document.createElement('div');
    this.log.className = 'mrclippy-log';
    body.appendChild(this.log);

    this.chips = this.buildChips();
    body.appendChild(this.chips);

    const form = document.createElement('form');
    form.className = 'mrclippy-composer';

    this.input = document.createElement('textarea');
    this.input.className = 'mrclippy-input';
    this.input.rows = 2;
    this.input.placeholder = 'Ask a question, or tell me what to change…';
    this.input.setAttribute('aria-label', 'Ask Mr. Clippy');

    this.send = document.createElement('button');
    this.send.type = 'submit';
    this.send.className = 'mrclippy-btn mrclippy-btn-primary';
    this.send.textContent = 'Ask';

    form.append(this.input, this.send);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const question = this.input.value.trim();
      if (question.length === 0) return;
      this.input.value = '';
      void this.submit(question);
    });

    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        form.requestSubmit();
      }
      if (event.key === 'Escape') this.options.onClose();
    });

    body.appendChild(form);
    this.el.appendChild(body);

    this.opening();
  }

  focus(): void {
    this.input.focus();
  }

  private buildTitleBar(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'mrclippy-titlebar';

    const title = document.createElement('span');
    title.className = 'mrclippy-title';
    title.textContent = 'Mr. Clippy';

    const controls = document.createElement('span');
    controls.className = 'mrclippy-titlebtns';

    const quiet = document.createElement('button');
    quiet.type = 'button';
    quiet.className = 'mrclippy-titlebtn';
    quiet.title = 'Just let me write';
    quiet.setAttribute('aria-label', 'Just let me write');
    quiet.textContent = '–';
    quiet.addEventListener('click', () => this.options.onSnooze());

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'mrclippy-titlebtn';
    close.title = 'Close';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '✕';
    close.addEventListener('click', () => this.options.onClose());

    controls.append(quiet, close);
    bar.append(title, controls);
    return bar;
  }

  private buildChips(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'mrclippy-chips';

    for (const action of QUICK_ACTIONS) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'mrclippy-chip';
      chip.textContent = action.label;
      chip.addEventListener('click', () => {
        if (action.id === 'structure') void this.runAudit();
        else void this.submit(action.question, action.label);
      });
      row.appendChild(chip);
    }

    return row;
  }

  /** His first turn: what the local checks found, or an invitation. */
  private opening(): void {
    const { findings } = this.options;

    if (findings.length === 0) {
      this.appendText('assistant', "I've read it. Nothing I'd change — ask me anything.");
      return;
    }

    const line = document.createElement('div');
    line.className = 'mrclippy-turn mrclippy-turn-assistant';

    const intro = document.createElement('div');
    intro.textContent = `I noticed ${findings.length} thing${findings.length === 1 ? '' : 's'}:`;
    line.appendChild(intro);

    const list = document.createElement('div');
    list.className = 'mrclippy-findings';

    findings.forEach((finding, index) => {
      const row = document.createElement('div');
      row.className = 'mrclippy-finding';

      const text = document.createElement('span');
      text.textContent = finding;

      const dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.className = 'mrclippy-dismiss';
      dismiss.title = 'Never show this kind again';
      dismiss.setAttribute('aria-label', 'Never show this kind again');
      dismiss.textContent = '✕';
      dismiss.addEventListener('click', () => {
        this.options.onDismissFinding(index);
        row.remove();
      });

      row.append(text, dismiss);
      list.appendChild(row);
    });

    line.appendChild(list);
    this.log.appendChild(line);
    this.scroll();
  }

  private appendText(role: ChatTurn['role'] | 'error', text: string): HTMLElement {
    const line = document.createElement('div');
    line.className = `mrclippy-turn mrclippy-turn-${role}`;
    line.textContent = text;
    this.log.appendChild(line);
    this.scroll();
    return line;
  }

  private scroll(): void {
    this.log.scrollTop = this.log.scrollHeight;
  }

  /**
   * The structure audit. Not a chat turn: the local pass decides whether any
   * cloud call happens, so a document with nothing structurally interesting
   * costs nothing and answers instantly.
   */
  private async runAudit(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.chips.hidden = true;
    this.send.disabled = true;

    this.appendText('user', 'Check my structure');
    const pending = this.appendText('assistant', 'reading the whole thing…');
    pending.classList.add('mrclippy-pending');

    try {
      const result = await this.options.onAudit();
      pending.classList.remove('mrclippy-pending');
      pending.textContent = result;
    } catch (error: unknown) {
      pending.remove();
      this.appendText('error', error instanceof Error ? error.message : 'Audit failed.');
    } finally {
      this.busy = false;
      this.send.disabled = false;
      this.input.focus();
      this.scroll();
    }
  }

  /**
   * What he actually changed, under what he said. Every edit is listed, so a
   * change can never happen without the user being able to see it, and the ones
   * that failed say why instead of vanishing.
   */
  private receipt(changes: readonly AgentChange[]): HTMLElement {
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

      const before = document.createElement('del');
      before.textContent = clip(change.find);
      row.appendChild(before);

      if (change.replace.length > 0) {
        const after = document.createElement('ins');
        after.textContent = clip(change.replace);
        row.appendChild(after);
      }

      if (!change.applied && change.reason) {
        const why = document.createElement('div');
        why.className = 'mrclippy-change-why';
        why.textContent = change.reason;
        row.appendChild(why);
      }
      box.appendChild(row);
    }

    const { onUndo } = this.options;
    if (onUndo && applied.length > 0) {
      const undo = document.createElement('button');
      undo.type = 'button';
      undo.className = 'mrclippy-btn';
      undo.textContent = 'Undo';
      undo.addEventListener('click', () => {
        undo.disabled = true;
        undo.textContent = 'Undoing…';
        void onUndo(applied)
          .then((line) => {
            undo.remove();
            this.appendText('assistant', line);
          })
          .catch((error: unknown) => {
            undo.disabled = false;
            undo.textContent = 'Undo';
            this.appendText('error', error instanceof Error ? error.message : 'Undo failed.');
          });
      });
      box.appendChild(undo);
    }

    return box;
  }

  /**
   * One turn. `shownAs` lets a quick-action chip show its short label in the
   * transcript while the model receives the full instruction.
   */
  private async submit(question: string, shownAs?: string): Promise<void> {
    if (this.busy) return;

    this.busy = true;
    this.send.disabled = true;
    this.send.textContent = '…';
    this.chips.hidden = true;

    this.appendText('user', shownAs ?? question);
    const pending = this.appendText('assistant', 'thinking…');
    pending.classList.add('mrclippy-pending');

    try {
      const reply = await this.options.onAsk(question, [...this.history]);
      pending.classList.remove('mrclippy-pending');
      pending.textContent = reply.text;
      if (reply.changes && reply.changes.length > 0) {
        pending.appendChild(this.receipt(reply.changes));
      }
      this.history.push(
        { role: 'user', text: question },
        { role: 'assistant', text: describeForHistory(reply) },
      );
    } catch (error: unknown) {
      pending.remove();
      this.appendText('error', error instanceof Error ? error.message : 'Something went wrong.');
    } finally {
      this.busy = false;
      this.send.disabled = false;
      this.send.textContent = 'Ask';
      this.input.focus();
      this.scroll();
    }
  }
}

/** Long passages are shortened in the receipt; the document has the full text. */
function clip(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}\u2026` : flat;
}

/**
 * The model's memory of its own turn. Without the edits in it, a follow-up like
 * "undo the second one" or "now do the same to the intro" has nothing to refer to.
 */
function describeForHistory(reply: AgentReply): string {
  const applied = reply.changes?.filter((c) => c.applied) ?? [];
  if (applied.length === 0) return reply.text;
  const list = applied.map((c) => `- "${c.find}" -> "${c.replace}"`).join('\n');
  return `${reply.text}\n\n[Edits I made to the document:\n${list}]`;
}
