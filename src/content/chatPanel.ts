import type { ChatTurn } from '../agent/types';
import { fixAllBar, proposalCard, receipt, receiptScreen, type CardContext } from './changeCards';
import { buildAskArea, buildChips, buildTitleBar, type AskArea, type TitleBar } from './panelChrome';
import { NotesView } from './notesView';
import {
  describeForHistory,
  fixQuestion,
  fixTitle,
  type AgentChange,
  type ChatPanelOptions,
  type PanelFinding,
  type Thread,
} from './chatTypes';

export {
  QUICK_ACTIONS,
  docTitleFrom,
  fixQuestion,
  fixTitle,
  noteLabel,
  tallyLine,
  type AgentChange,
  type AgentReply,
  type ChatPanelOptions,
  type PanelFinding,
  type QuickAction,
} from './chatTypes';

const MAIN_PLACEHOLDER = 'Ask a question, or tell me what to change…';
const FIX_PLACEHOLDER = 'Ask about this fix, or tell me to change it…';

/**
 * The panel: one speech-balloon sheet beside him.
 *
 * The notes screen is home. Every fix and every question gets a thread of its
 * own, reached from its line in the list and left with "< Notes", so the list
 * stays a list. Nothing here is modal: the title-bar X, clicking him, or
 * Escape puts it away.
 */
export class ChatPanel {
  readonly el: HTMLElement;
  /** The title ribbon. Dragging it moves the panel. */
  readonly handle: HTMLElement;

  private readonly main: Thread;
  private active: Thread;
  private readonly fixes = new Map<number, Thread>();
  private fixAllThread: Thread | undefined;
  private readonly title: TitleBar;
  private readonly viewport: HTMLElement;
  private readonly footSlot: HTMLElement;
  private readonly ask: AskArea;
  private readonly chips: HTMLElement;
  private readonly notes: NotesView;

  private readonly cards: CardContext;

  constructor(private readonly options: ChatPanelOptions) {
    this.cards = {
      options,
      appendText: (role, text, thread) => this.appendText(role, text, thread),
      pointsAt: (el, passage) => this.pointsAt(el, passage),
    };
    this.el = document.createElement('div');
    this.el.className = 'mrclippy-panel';
    this.title = buildTitleBar(options);
    this.handle = this.title.el;
    this.title.back.addEventListener('click', () => this.show(this.main));
    this.el.appendChild(this.handle);

    const body = document.createElement('div');
    body.className = 'mrclippy-body';

    this.viewport = document.createElement('div');
    this.viewport.className = 'mrclippy-viewport';
    body.appendChild(this.viewport);

    this.footSlot = document.createElement('div');
    this.footSlot.className = 'mrclippy-foot';
    this.footSlot.hidden = true;
    body.appendChild(this.footSlot);

    this.chips = buildChips(
      () => void this.runAudit(),
      (question, label) => void this.submit(question, label),
    );
    this.ask = buildAskArea(this.chips);
    this.ask.form.addEventListener('submit', (event) => {
      event.preventDefault();
      const question = this.ask.input.value.trim();
      if (question.length === 0) return;
      this.ask.input.value = '';
      void this.submit(question);
    });
    this.ask.input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        this.ask.form.requestSubmit();
      }
    });
    body.appendChild(this.ask.el);
    this.el.appendChild(body);

    // Escape from anywhere in the panel puts it away.
    this.el.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.options.onClose();
    });

    this.notes = new NotesView(options.findings.length, options.docTitle, (on) =>
      this.el.classList.toggle('mrclippy-hide-fixed', on),
    );
    this.main = this.newThread('Mr. Clippy');
    this.main.log.appendChild(this.notes.el);
    this.active = this.main;
    this.viewport.appendChild(this.main.log);

    this.opening();
  }

  focus(): void {
    this.ask.input.focus();
  }

  private newThread(
    title: string,
    onStatus?: Thread['onStatus'],
    quiet = false,
  ): Thread {
    const log = document.createElement('div');
    log.className = 'mrclippy-log';
    return {
      log,
      title,
      history: [],
      busy: false,
      ...(onStatus ? { onStatus } : {}),
      ...(quiet ? { quiet } : {}),
    };
  }

  /** A new chat, listed under "Your questions" so it can be reopened like a fix. */
  private startChat(title: string): Thread {
    let thread: Thread | undefined;
    const row = this.notes.addQuestion(title, () => thread && this.show(thread));
    thread = this.newThread(title, (state) => row.setState(state));
    return thread;
  }

  /** Swap the visible thread. Each keeps its own scroll position and history. */
  private show(thread: Thread): void {
    this.active = thread;
    this.viewport.replaceChildren(thread.log);
    const inThread = thread !== this.main;
    this.el.dataset.view = inThread ? 'thread' : 'notes';
    this.title.back.hidden = !inThread;
    this.title.settings.hidden = inThread;
    this.title.title.textContent = thread.title;
    this.title.title.title = inThread ? thread.title : '';
    this.chips.hidden = inThread;
    this.ask.el.hidden = thread.quiet === true;
    // A fix thread talks about its fix; a question's chat is the general box.
    const isFix = [...this.fixes.values()].includes(thread);
    this.ask.input.placeholder = isFix ? FIX_PLACEHOLDER : MAIN_PLACEHOLDER;
    this.footSlot.replaceChildren(...(thread.foot ? [thread.foot] : []));
    this.footSlot.hidden = !thread.foot;
    this.syncComposer();
    this.scroll(thread);
  }

  private syncComposer(): void {
    this.ask.send.disabled = this.active.busy;
    this.ask.send.textContent = this.active.busy ? '…' : 'Ask';
  }

  /**
   * Open the thread for one finding, starting the fix the first time. Later
   * clicks just go back to it — the proposals are still there.
   */
  private fixThread(
    index: number,
    finding: PanelFinding,
    onStatus: NonNullable<Thread['onStatus']>,
  ): { thread: Thread; started: Promise<void> | undefined } {
    const existing = this.fixes.get(index);
    if (existing) return { thread: existing, started: undefined };
    const title = fixTitle(finding);
    const thread = this.newThread(title, onStatus);
    this.fixes.set(index, thread);
    thread.drafting = this.submit(fixQuestion(finding), `Fix: ${title}`, thread);
    return { thread, started: thread.drafting };
  }

  /**
   * Draft every fix in the background, a few at a time, so by the time the user
   * reads the list each row can be applied in one click.
   */
  private prefetchFixes(starters: (() => Promise<void> | undefined)[]): void {
    const queue = [...starters];
    const worker = async (): Promise<void> => {
      for (let next = queue.shift(); next; next = queue.shift()) await next();
    };
    // The first draft runs alone so it writes the document to the prompt cache;
    // the rest then read it from there instead of paying for it again.
    const first = queue.shift();
    void Promise.resolve(first?.()).finally(() => {
      for (let i = 0; i < Math.min(3, queue.length); i++) void worker();
    });
  }

  /** The notes screen: every local finding, each with its own fix. */
  private opening(): void {
    const { findings } = this.options;
    const prefetch: (() => Promise<void> | undefined)[] = [];
    const fixable: (() => { thread: Thread })[] = [];

    findings.forEach((finding, index) => {
      const canFix = finding.anchor !== undefined && this.options.canEdit !== false;
      let ensure: (() => { thread: Thread; started: Promise<void> | undefined }) | undefined;
      const row = this.notes.addNote(finding, {
        dismiss: () => this.options.onDismissFinding(index),
        ...(canFix
          ? {
              fix: {
                label: this.options.prefetch ? 'Review' : 'Fix',
                // One click: applies the drafted fix straight from the list.
                apply: () => void ensure?.().thread.applyAll?.(),
                review: () => {
                  if (ensure) this.show(ensure().thread);
                  row.opened();
                },
                retry: () => {
                  this.fixes.delete(index);
                  ensure?.();
                },
              },
            }
          : {}),
      });
      if (finding.anchor) this.pointsAt(row.el, finding.anchor);
      if (!canFix) return;
      ensure = () => this.fixThread(index, finding, (state) => row.setState(state));
      const start = ensure;
      if (this.options.prefetch) prefetch.push(() => start().started);
      fixable.push(start);
    });

    if (fixable.length > 1) {
      this.notes.setFixAll(fixAllBar(fixable, (changes) => this.showFixAll(changes)));
    }
    if (prefetch.length > 0) this.prefetchFixes(prefetch);
  }

  /** Fix all's result gets a screen of its own, reached again from the bar. */
  private showFixAll(changes: AgentChange[]): void {
    if (!this.fixAllThread) {
      const thread = this.newThread('Fix all', undefined, true);
      thread.log.appendChild(receiptScreen(this.cards, changes, thread));
      this.fixAllThread = thread;
    }
    this.show(this.fixAllThread);
  }

  /**
   * Hovering (or clicking) a note selects its passage in the document, the way
   * a Docs comment does. Debounced so sweeping the pointer across the list does
   * not yank the page around.
   */
  private pointsAt(el: HTMLElement, passage: string): void {
    const { onLocate } = this.options;
    if (!onLocate) return;
    el.classList.add('mrclippy-locatable');
    let timer: ReturnType<typeof setTimeout> | undefined;
    el.addEventListener('mouseenter', () => {
      timer = setTimeout(() => onLocate(passage), 250);
    });
    el.addEventListener('mouseleave', () => {
      if (timer !== undefined) clearTimeout(timer);
    });
    el.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('button')) return;
      onLocate(passage);
    });
  }

  private appendText(
    role: ChatTurn['role'] | 'error',
    text: string,
    thread: Thread = this.active,
  ): HTMLElement {
    const line = document.createElement('div');
    line.className = `mrclippy-turn mrclippy-turn-${role}`;
    line.textContent = text;
    thread.log.appendChild(line);
    this.scroll(thread);
    return line;
  }

  private scroll(thread: Thread = this.active): void {
    if (thread === this.main) return; // The list reads from the top.
    thread.log.scrollTop = thread.log.scrollHeight;
  }

  /**
   * The structure audit. Not a chat turn: the local pass decides whether any
   * cloud call happens, so a document with nothing structurally interesting
   * costs nothing and answers instantly.
   */
  private async runAudit(): Promise<void> {
    const thread = this.startChat('Check my structure');
    this.show(thread);
    thread.busy = true;
    thread.onStatus?.({ kind: 'working' });
    this.syncComposer();

    this.appendText('user', 'Check my structure', thread);
    const pending = this.appendText('assistant', 'reading the whole thing…', thread);
    pending.classList.add('mrclippy-pending');

    try {
      const result = await this.options.onAudit();
      pending.classList.remove('mrclippy-pending');
      pending.textContent = result;
      thread.onStatus?.({ kind: 'answered' });
    } catch (error: unknown) {
      pending.remove();
      this.appendText('error', error instanceof Error ? error.message : 'Audit failed.', thread);
      thread.onStatus?.({ kind: 'failed' });
    } finally {
      thread.busy = false;
      thread.history.push({ role: 'user', text: 'Check my structure' });
      thread.history.push({ role: 'assistant', text: pending.textContent ?? '' });
      this.syncComposer();
      this.ask.input.focus();
      this.scroll(thread);
    }
  }

  /**
   * One turn. `shownAs` lets a quick-action chip show its short label in the
   * transcript while the model receives the full instruction.
   */
  private async submit(
    question: string,
    shownAs?: string,
    thread: Thread = this.active,
  ): Promise<void> {
    // The list stays a list: a question asked from it gets a thread of its own.
    if (thread === this.main || thread.quiet) {
      thread = this.startChat(shownAs ?? question);
      this.show(thread);
    }
    if (thread.busy) return;

    thread.busy = true;
    this.syncComposer();
    thread.onStatus?.({ kind: 'working' });

    this.appendText('user', shownAs ?? question, thread);
    const pending = this.appendText('assistant', 'thinking…', thread);
    pending.classList.add('mrclippy-pending');

    try {
      const reply = await this.options.onAsk(question, [...thread.history]);
      pending.classList.remove('mrclippy-pending');
      pending.textContent = reply.text;
      if (reply.proposals && reply.proposals.length > 0) {
        pending.appendChild(proposalCard(this.cards, reply.proposals, thread));
      }
      if (reply.changes && reply.changes.length > 0) {
        pending.appendChild(receipt(this.cards, reply.changes, thread));
      }
      const ready = reply.proposals?.length ?? 0;
      thread.onStatus?.(ready > 0 ? { kind: 'ready', count: ready } : { kind: 'answered' });
      thread.history.push(
        { role: 'user', text: question },
        { role: 'assistant', text: describeForHistory(reply) },
      );
    } catch (error: unknown) {
      pending.remove();
      const message = error instanceof Error ? error.message : 'Something went wrong.';
      this.appendText('error', message, thread);
      thread.onStatus?.({ kind: 'failed', reason: message });
    } finally {
      thread.busy = false;
      this.syncComposer();
      if (thread === this.active) this.ask.input.focus();
      this.scroll(thread);
    }
  }
}
