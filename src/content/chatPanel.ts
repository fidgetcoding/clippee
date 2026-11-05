import type { PanelAction, PanelState } from '../agent/panelTools';
import { MAX_HISTORY_TURNS, type ChatTurn } from '../agent/types';
import { proposalCard, receipt, receiptScreen, type CardContext, type FixAllBar } from './changeCards';
import { buildAskArea, buildChips, buildTitleBar, type AskArea, type TitleBar } from './panelChrome';
import { matchCommand } from './localCommands';
import { wireNotes, type NoteEntry } from './noteControls';
import { NotesView, type QuestionRow } from './notesView';
import { describePanel, runActions, type PanelHost, type QuestionEntry } from './panelActions';
import {
  describeForHistory,
  fixQuestion,
  fixTitle,
  type AgentChange,
  type ChatPanelOptions,
  type PanelFinding,
  type Thread,
  type ThreadState,
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

interface AskedEntry extends QuestionEntry {
  state: ThreadState | undefined;
  removed: boolean;
  readonly row: QuestionRow;
}

/**
 * The panel: one speech-balloon sheet beside him.
 *
 * The notes screen is home. Every fix and every question gets a thread of its
 * own, reached from its line in the list and left with "< Notes", so the list
 * stays a list. The Ask box sits at the foot of every screen, and anything a
 * button does can be asked for there. Nothing here is modal: the title-bar X,
 * clicking him, or Escape puts it away.
 */
export class ChatPanel {
  readonly el: HTMLElement;
  /** The title ribbon. Dragging it moves the panel. */
  readonly handle: HTMLElement;

  private readonly main: Thread;
  private active: Thread;
  private readonly fixes = new Map<number, Thread>();
  private fixAllThread: Thread | undefined;
  private readonly controls: NoteEntry[];
  private readonly fixAll: () => FixAllBar | undefined;
  private readonly asked: AskedEntry[] = [];
  private readonly title: TitleBar;
  private readonly viewport: HTMLElement;
  private readonly footSlot: HTMLElement;
  private readonly ask: AskArea;
  private readonly notes: NotesView;
  private readonly host: PanelHost;

  private readonly cards: CardContext;
  private disposed = false;
  private readonly hoverTimers = new Set<ReturnType<typeof setTimeout>>();

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

    // The chips are openers: from any screen, each starts a chat of its own.
    const chips = buildChips(
      () => void this.runAudit(),
      (question, label) => void this.submit(question, label, this.main),
    );
    this.ask = buildAskArea(chips);
    this.ask.form.addEventListener('submit', (event) => {
      event.preventDefault();
      const question = this.ask.input.value.trim();
      if (question.length === 0) return;
      this.ask.input.value = '';
      this.send(question);
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
    this.main = this.newThread('Clippee');
    this.main.log.appendChild(this.notes.el);
    this.active = this.main;
    this.viewport.appendChild(this.main.log);

    this.host = {
      options,
      notes: this.notes,
      main: this.main,
      active: () => this.active,
      allNotes: () => this.controls,
      noteOf: (thread) => this.controls.find((c) => this.fixes.get(c.index) === thread),
      questions: () => this.asked,
      fixAll: () => this.fixAll(),
      results: () => this.fixAllThread,
      threads: () => [...this.fixes.values(), ...this.asked.filter((q) => !q.removed).map((q) => q.thread)],
      show: (thread) => this.show(thread),
      audit: () => void this.runAudit(),
    };

    ({ controls: this.controls, fixAll: this.fixAll } = wireNotes({
      options,
      notes: this.notes,
      fixThread: (index, finding, onStatus) => this.fixThread(index, finding, onStatus),
      existing: (index) => this.fixes.get(index),
      forget: (index) => this.fixes.delete(index),
      show: (thread) => this.show(thread),
      pointsAt: (el, passage) => this.pointsAt(el, passage),
      showFixAll: (changes) => this.showFixAll(changes),
      isDisposed: () => this.disposed,
    }));
  }

  dispose(): void {
    this.disposed = true;
    for (const timer of this.hoverTimers) clearTimeout(timer);
    this.hoverTimers.clear();
    this.el.remove();
  }

  focus(): void {
    if (!this.disposed) this.ask.input.focus();
  }

  private newThread(
    title: string,
    onStatus?: (state: ThreadState) => void,
    quiet = false,
  ): Thread {
    const log = document.createElement('div');
    log.className = 'mrclippy-log';
    const thread: Thread = {
      log,
      title,
      history: [],
      busy: false,
      ...(onStatus ? { onStatus: (state: ThreadState) => { thread.state = state; onStatus(state); } } : {}),
      ...(quiet ? { quiet } : {}),
    };
    return thread;
  }

  /** A new chat, listed under "Your questions" so it can be reopened like a fix. */
  private startChat(title: string): Thread {
    let entry: AskedEntry | undefined;
    const row = this.notes.addQuestion(title, () => entry && this.show(entry.thread));
    const thread = this.newThread(title, (state) => {
      if (entry) entry.state = state;
      row.setState(state);
    });
    entry = { thread, title, row, state: undefined, removed: false };
    this.asked.push(entry);
    return thread;
  }

  /** A chat that turned out to be a request to work the panel was never a question. */
  private dropChat(thread: Thread): void {
    const entry = this.asked.find((q) => q.thread === thread);
    if (!entry) return;
    entry.removed = true;
    entry.row.remove();
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
    // A fix thread talks about its fix; everywhere else the box is the general one.
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

  /** His line above the box, for a request made from a list. Empty hides it. */
  private say(text: string, pending = false): void {
    this.ask.reply.textContent = text;
    this.ask.reply.hidden = text === '';
    this.ask.reply.classList.toggle('mrclippy-pending', pending);
  }

  /**
   * What the box does on every screen. A plain command ("hide applied") runs
   * at once; anything else goes to him with the panel in view, so he can
   * answer by working it.
   */
  private send(text: string): void {
    this.say('');
    const here = this.active;
    const command = matchCommand(text);
    if (command) void this.act(text, [command], here);
    else void this.submit(text, undefined, here, describePanel(this.host, here));
  }

  /**
   * Work the panel for something typed into the box, through the same paths
   * as the buttons. Asked in a chat, his answer goes in the chat. Asked on a
   * list, which is no place for chat, or if the request moved the panel off
   * the chat, it goes on the line above the box.
   */
  private async act(
    typed: string,
    actions: readonly PanelAction[],
    origin: Thread,
    pending?: HTMLElement,
  ): Promise<void> {
    const inChat = pending !== undefined || (origin !== this.main && !origin.quiet && !origin.busy);
    if (inChat && !pending) {
      this.appendText('user', typed, origin);
      pending = this.appendText('assistant', 'on it…', origin);
      pending.classList.add('mrclippy-pending');
    }
    if (!inChat) this.say('On it…', true);
    const said = (await runActions(this.host, actions, origin)).join(' ') || 'Done.';
    if (this.disposed) return;
    if (pending) {
      pending.classList.remove('mrclippy-pending');
      pending.textContent = said;
      origin.history.push({ role: 'user', text: typed }, { role: 'assistant', text: said });
      origin.history.splice(0, Math.max(0, origin.history.length - MAX_HISTORY_TURNS));
    }
    this.say(inChat && this.active === origin ? '' : said);
  }

  /**
   * Open the thread for one finding, starting the fix the first time. Later
   * clicks just go back to it — the proposals are still there.
   */
  private fixThread(
    index: number,
    finding: PanelFinding,
    onStatus: (state: ThreadState) => void,
  ): { thread: Thread; started: Promise<void> | undefined } {
    const existing = this.fixes.get(index);
    if (existing) return { thread: existing, started: undefined };
    const title = fixTitle(finding);
    const thread = this.newThread(title, onStatus);
    this.fixes.set(index, thread);
    thread.drafting = this.submit(fixQuestion(finding), `Fix: ${title}`, thread);
    return { thread, started: thread.drafting };
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
      if (timer !== undefined) { clearTimeout(timer); this.hoverTimers.delete(timer); }
      timer = setTimeout(() => {
        if (timer !== undefined) this.hoverTimers.delete(timer);
        if (!this.disposed) onLocate(passage);
      }, 250);
      this.hoverTimers.add(timer);
    });
    el.addEventListener('mouseleave', () => {
      if (timer !== undefined) { clearTimeout(timer); this.hoverTimers.delete(timer); }
    });
    el.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('button')) return;
      if (!this.disposed) onLocate(passage);
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
    if (this.disposed) return;
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
      if (this.disposed) return;
      pending.classList.remove('mrclippy-pending');
      pending.textContent = result;
      thread.history.push({ role: 'user', text: 'Check my structure' }, { role: 'assistant', text: result });
      thread.onStatus?.({ kind: 'answered' });
    } catch (error: unknown) {
      pending.remove();
      this.appendText('error', error instanceof Error ? error.message : 'Audit failed.', thread);
      thread.onStatus?.({ kind: 'failed' });
    } finally {
      thread.busy = false;
      this.syncComposer();
      if (!this.disposed && thread === this.active) this.ask.input.focus();
      this.scroll(thread);
    }
  }

  /**
   * One turn. `shownAs` lets a quick-action chip show its short label in the
   * transcript while the model receives the full instruction. `panel` rides
   * along with typed questions, and a reply that works the panel is run
   * instead of shown.
   */
  private async submit(
    question: string,
    shownAs?: string,
    thread: Thread = this.active,
    panel?: PanelState,
  ): Promise<void> {
    if (this.disposed) return;
    const origin = thread;
    // The list stays a list: a question asked from it gets a thread of its own.
    if (thread === this.main || thread.quiet) {
      thread = this.startChat(shownAs ?? question);
      this.show(thread);
    }
    if (thread.busy) return;

    thread.busy = true;
    this.syncComposer();
    const before = thread.state;
    thread.onStatus?.({ kind: 'working' });

    this.appendText('user', shownAs ?? question, thread);
    const pending = this.appendText('assistant', 'thinking…', thread);
    pending.classList.add('mrclippy-pending');

    try {
      const reply = await this.options.onAsk(question, [...thread.history], panel);
      if (this.disposed) return;
      if (reply.actions && reply.actions.length > 0 && !reply.proposals?.length) {
        if (thread === origin) {
          await this.act(question, reply.actions, origin, pending);
          // A request is not a turn of the fix: its row goes back to what it said.
          if (thread.state?.kind === 'working') thread.onStatus?.(before ?? { kind: 'answered' });
        } else {
          // Asked from a list, it was never a question: back to where it was asked.
          this.dropChat(thread);
          if (this.active === thread) this.show(origin);
          await this.act(question, reply.actions, origin);
        }
        return;
      }
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
      thread.history.splice(0, Math.max(0, thread.history.length - MAX_HISTORY_TURNS));
    } catch (error: unknown) {
      pending.remove();
      const message = error instanceof Error ? error.message : 'Something went wrong.';
      this.appendText('error', message, thread);
      thread.onStatus?.({ kind: 'failed', reason: message });
    } finally {
      thread.busy = false;
      this.syncComposer();
      if (!this.disposed && thread === this.active) this.ask.input.focus();
      this.scroll(thread);
    }
  }
}
