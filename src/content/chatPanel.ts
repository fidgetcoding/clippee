import type { ChatTurn } from '../agent/types';
import { fixAllBar, proposalCard, receipt, type CardContext } from './changeCards';
import { buildChips, buildTitleBar } from './panelChrome';
import {
  describeForHistory,
  fixQuestion,
  type ChatPanelOptions,
  type PanelFinding,
  type Thread,
} from './chatTypes';

export {
  QUICK_ACTIONS,
  fixQuestion,
  type AgentChange,
  type AgentReply,
  type ChatPanelOptions,
  type PanelFinding,
  type QuickAction,
} from './chatTypes';

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
  /** The title bar. Dragging it moves the panel. */
  readonly handle: HTMLElement;

  private readonly main: Thread;
  private active: Thread;
  private readonly fixes = new Map<number, Thread>();
  private readonly viewport: HTMLElement;
  private readonly crumb: HTMLElement;
  private readonly crumbTitle: HTMLElement;
  private chatList: HTMLElement | undefined;
  private readonly input: HTMLTextAreaElement;
  private readonly send: HTMLButtonElement;
  private readonly chips: HTMLElement;

  private readonly cards: CardContext;

  constructor(private readonly options: ChatPanelOptions) {
    this.cards = {
      options,
      appendText: (role, text, thread) => this.appendText(role, text, thread),
      pointsAt: (el, passage) => this.pointsAt(el, passage),
    };
    this.el = document.createElement('div');
    this.el.className = 'mrclippy-panel';
    this.handle = buildTitleBar(options);
    this.el.appendChild(this.handle);

    const body = document.createElement('div');
    body.className = 'mrclippy-body';

    // "← All notes" bar, shown only inside a Fix thread.
    this.crumb = document.createElement('div');
    this.crumb.className = 'mrclippy-crumb';
    this.crumb.hidden = true;
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'mrclippy-btn mrclippy-back';
    back.textContent = '\u2190 All notes';
    back.addEventListener('click', () => this.show(this.main));
    this.crumbTitle = document.createElement('span');
    this.crumbTitle.className = 'mrclippy-crumb-title';
    this.crumb.append(back, this.crumbTitle);
    body.appendChild(this.crumb);

    this.viewport = document.createElement('div');
    this.viewport.className = 'mrclippy-viewport';
    body.appendChild(this.viewport);

    this.main = this.newThread('All notes');
    this.active = this.main;
    this.viewport.appendChild(this.main.log);

    this.chips = buildChips(
      () => void this.runAudit(),
      (question, label) => void this.submit(question, label),
    );
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

  /**
   * A new chat, listed under "Your questions" on the notes view so it can be
   * reopened like a fix.
   */
  private startChat(title: string): Thread {
    if (!this.chatList) {
      const section = document.createElement('div');
      section.className = 'mrclippy-turn mrclippy-turn-assistant mrclippy-chats';
      const head = document.createElement('div');
      head.className = 'mrclippy-receipt-head';
      head.textContent = 'Your questions';
      this.chatList = document.createElement('div');
      this.chatList.className = 'mrclippy-findings';
      section.append(head, this.chatList);
      this.main.log.appendChild(section);
    }

    const row = document.createElement('div');
    row.className = 'mrclippy-finding mrclippy-locatable';
    const label = document.createElement('span');
    label.className = 'mrclippy-finding-text';
    label.textContent = title;
    const pill = document.createElement('span');
    pill.className = 'mrclippy-pill';
    pill.hidden = true;
    const actions = document.createElement('span');
    actions.className = 'mrclippy-finding-actions';
    actions.appendChild(pill);
    row.append(label, actions);

    const thread = this.newThread(title, (status, tone) => {
      pill.textContent = status;
      pill.dataset.tone = tone ?? '';
      pill.hidden = false;
    });
    row.addEventListener('click', () => this.show(thread));
    this.chatList.appendChild(row);
    return thread;
  }

  private newThread(title: string, onStatus?: Thread['onStatus']): Thread {
    const log = document.createElement('div');
    log.className = 'mrclippy-log';
    return { log, title, history: [], busy: false, ...(onStatus ? { onStatus } : {}) };
  }

  /** Swap the visible thread. Each keeps its own scroll position and history. */
  private show(thread: Thread): void {
    this.active = thread;
    this.viewport.replaceChildren(thread.log);
    const inFix = thread !== this.main;
    this.crumb.hidden = !inFix;
    this.crumbTitle.textContent = inFix ? thread.title : '';
    this.chips.hidden = inFix;
    this.input.placeholder = inFix
      ? 'Ask about this fix, or tell me to change it\u2026'
      : 'Ask a question, or tell me what to change\u2026';
    this.syncComposer();
    this.scroll(thread);
  }

  private syncComposer(): void {
    this.send.disabled = this.active.busy;
    this.send.textContent = this.active.busy ? '\u2026' : 'Ask';
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
    const thread = this.newThread(finding.text, onStatus);
    this.fixes.set(index, thread);
    thread.drafting = this.submit(fixQuestion(finding), `Fix: ${finding.text}`, thread);
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

    const prefetch: (() => Promise<void> | undefined)[] = [];
    const fixable: (() => { thread: Thread })[] = [];

    findings.forEach((finding, index) => {
      const row = document.createElement('div');
      row.className = 'mrclippy-finding';

      const text = document.createElement('span');
      text.className = 'mrclippy-finding-text';
      text.textContent = finding.text;
      if (finding.anchor) this.pointsAt(row, finding.anchor);

      const actions = document.createElement('span');
      actions.className = 'mrclippy-finding-actions';

      if (finding.anchor && this.options.canEdit !== false) {
        const pill = document.createElement('span');
        pill.className = 'mrclippy-pill';
        pill.hidden = true;

        // One click: applies the drafted fix straight from the list.
        const apply = document.createElement('button');
        apply.type = 'button';
        apply.className = 'mrclippy-fix mrclippy-fix-apply';
        apply.textContent = 'Apply';
        apply.title = 'Apply this fix';
        apply.hidden = true;

        const review = document.createElement('button');
        review.type = 'button';
        review.className = 'mrclippy-fix mrclippy-review';
        review.textContent = this.options.prefetch ? 'Review' : 'Fix';
        review.title = 'See the before and after, or talk it through';

        const onStatus: NonNullable<Thread['onStatus']> = (status, tone) => {
          pill.textContent = status;
          pill.dataset.tone = tone ?? '';
          pill.hidden = tone === 'ready';
          apply.hidden = tone !== 'ready';
        };
        const ensure = () => this.fixThread(index, finding, onStatus);

        apply.addEventListener('click', () => {
          apply.disabled = true;
          void ensure().thread.applyAll?.().finally(() => {
            apply.disabled = false;
          });
        });
        review.addEventListener('click', () => {
          this.show(ensure().thread);
          review.textContent = 'Review';
        });
        if (this.options.prefetch) prefetch.push(() => ensure().started);
        fixable.push(ensure);

        actions.append(pill, apply, review);
      }

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

      actions.appendChild(dismiss);
      row.append(text, actions);
      list.appendChild(row);
    });

    line.appendChild(list);
    if (fixable.length > 1) line.insertBefore(fixAllBar(this.cards, fixable, this.main), list);
    this.main.log.appendChild(line);
    this.scroll(this.main);
    if (prefetch.length > 0) this.prefetchFixes(prefetch);
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
    thread.onStatus?.('Working\u2026', 'busy');
    this.syncComposer();

    this.appendText('user', 'Check my structure', thread);
    const pending = this.appendText('assistant', 'reading the whole thing…', thread);
    pending.classList.add('mrclippy-pending');

    try {
      const result = await this.options.onAudit();
      pending.classList.remove('mrclippy-pending');
      pending.textContent = result;
      thread.onStatus?.('Answered', 'done');
    } catch (error: unknown) {
      pending.remove();
      this.appendText('error', error instanceof Error ? error.message : 'Audit failed.', thread);
    } finally {
      thread.busy = false;
      thread.history.push({ role: 'user', text: 'Check my structure' });
      thread.history.push({ role: 'assistant', text: pending.textContent ?? '' });
      this.syncComposer();
      this.input.focus();
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
    if (thread === this.main) {
      thread = this.startChat(shownAs ?? question);
      this.show(thread);
    }
    if (thread.busy) return;

    thread.busy = true;
    this.syncComposer();
    thread.onStatus?.('Working\u2026', 'busy');

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
      thread.onStatus?.(ready > 0 ? `${ready} to review` : 'Answered', ready > 0 ? 'ready' : 'done');
      thread.history.push(
        { role: 'user', text: question },
        { role: 'assistant', text: describeForHistory(reply) },
      );
    } catch (error: unknown) {
      pending.remove();
      this.appendText('error', error instanceof Error ? error.message : 'Something went wrong.', thread);
      thread.onStatus?.('Failed', 'error');
    } finally {
      thread.busy = false;
      this.syncComposer();
      if (thread === this.active) this.input.focus();
      this.scroll(thread);
    }
  }
}


/**
 * The model's memory of its own turn. Without the edits in it, a follow-up like
 * "undo the second one" or "now do the same to the intro" has nothing to refer to.
 */
