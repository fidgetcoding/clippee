import { noteLabel, tallyLine, type PanelFinding, type ThreadState } from './chatTypes';
import { button, checkbox, groupBox, type Checkbox } from './panelChrome';
import { bullet, progressBar, statusIcon } from './statusIcons';

/** What a note's buttons do. The panel owns threads; this only draws them. */
export interface NoteHandlers {
  /** Absent when he cannot edit this document or the note points at nothing. */
  readonly fix?: {
    apply(): void;
    review(): void;
    retry(): void;
    /** Without background drafting the button reads "Fix" until first opened. */
    readonly label: 'Fix' | 'Review';
  };
  dismiss(): void;
}

export interface NoteRow {
  readonly el: HTMLElement;
  /** Where its fix stands. Undefined until a draft starts. */
  readonly state: ThreadState | undefined;
  setState(state: ThreadState): void;
  /** The Review/Fix button's label, once the thread exists. */
  opened(): void;
  /** What the Ignore button does. */
  ignore(): void;
}

export interface QuestionRow {
  setState(state: ThreadState): void;
  remove(): void;
}

/**
 * The notes screen: a big "N notes" heading with the document and a tally
 * under it, Fix all, an etched "Notes" group listing every note with its status
 * on the right, and "Your questions" below. Everything the user has finished
 * with can be hidden with one checkbox on the group's border.
 */
export class NotesView {
  readonly el: HTMLElement;
  private readonly big: HTMLElement;
  private readonly tally: HTMLElement;
  private readonly well: HTMLElement | undefined;
  private readonly hiddenLine: HTMLElement | undefined;
  private readonly hideToggle: Checkbox | undefined;
  private readonly groups: HTMLElement;
  private questions: HTMLElement | undefined;
  private readonly states = new Map<HTMLElement, ThreadState | undefined>();
  /** Rows whose fix is drafted in the background, so "not started" means waiting. */
  private readonly queued = new Set<HTMLElement>();

  constructor(
    findings: number,
    docTitle: string | undefined,
    private readonly onHideFixed: (on: boolean) => void,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'mrclippy-notes';

    const hd = document.createElement('div');
    hd.className = 'mrclippy-hd';
    this.big = document.createElement('div');
    this.big.className = 'mrclippy-big';
    const sub = document.createElement('div');
    sub.className = 'mrclippy-sub';
    // What this window is, in his words, so nobody has to work it out.
    const line = document.createElement('div');
    if (docTitle) {
      const b = document.createElement('b');
      b.textContent = docTitle;
      line.append('I read ', b);
    } else {
      line.append('I read your doc');
    }
    line.append(findings > 0 ? '. Here’s what I’d fix.' : '.');
    sub.appendChild(line);
    this.tally = document.createElement('div');
    this.tally.className = 'mrclippy-tally';
    sub.appendChild(this.tally);
    hd.append(this.big, sub);
    this.el.appendChild(hd);

    this.groups = document.createElement('div');
    this.groups.className = 'mrclippy-gp';

    if (findings === 0) {
      const say = document.createElement('div');
      say.className = 'mrclippy-say';
      say.textContent = "I've read it. Nothing I'd change. Ask me anything.";
      this.groups.appendChild(say);
    } else {
      this.hideToggle = checkbox('Hide fixed (0)', (on) => this.onHideFixed(on));
      const { box, well } = groupBox('Notes', this.hideToggle.el);
      box.classList.add('mrclippy-notes-group');
      const head = document.createElement('div');
      head.className = 'mrclippy-lvh';
      for (const t of ['Note', 'Fix']) {
        const s = document.createElement('span');
        s.textContent = t;
        head.appendChild(s);
      }
      this.hiddenLine = document.createElement('div');
      this.hiddenLine.className = 'mrclippy-hidden-note';
      well.classList.add('mrclippy-findings');
      well.append(head, this.hiddenLine);
      this.well = well;
      this.groups.appendChild(box);
    }
    this.el.appendChild(this.groups);
    this.refresh();
  }

  /** What ticking "Hide fixed" does. Undefined when there is no list to hide from. */
  setHideFixed(on: boolean): number | undefined {
    if (!this.hideToggle) return undefined;
    this.hideToggle.set(on);
    return this.el.querySelectorAll('[data-fixed]').length;
  }

  get hidingFixed(): boolean {
    return this.hideToggle?.on ?? false;
  }

  /** In place of Fix all when there is no API key: one line and one button. */
  askForKey(openSettings: () => void): void {
    const line = document.createElement('div');
    line.className = 'mrclippy-fixall mrclippy-needkey';
    const go = button('Open Settings', 'mrclippy-btn-primary');
    go.addEventListener('click', () => openSettings());
    const hint = document.createElement('span');
    hint.className = 'mrclippy-fixall-hint';
    hint.textContent = 'Paste your Claude API key in Settings and I\u2019ll write a fix for each note.';
    line.append(go, hint);
    this.el.insertBefore(line, this.groups);
  }

  /** Fix all sits between the heading and the list. */
  setFixAll(bar?: HTMLElement): void {
    this.el.querySelector('.mrclippy-fixall:not(.mrclippy-needkey)')?.remove();
    if (bar) this.el.insertBefore(bar, this.groups);
  }

  addNote(finding: PanelFinding, handlers: NoteHandlers): NoteRow {
    const row = document.createElement('div');
    row.className = 'mrclippy-finding mrclippy-nr';

    const ic = document.createElement('span');
    ic.className = 'mrclippy-nr-ic';
    const tx = document.createElement('span');
    tx.className = 'mrclippy-finding-text mrclippy-nr-tx';
    const { label, body } = noteLabel(finding);
    if (label) {
      const k = document.createElement('b');
      k.textContent = `${label}.`;
      tx.append(k, ` ${body}`);
    } else {
      tx.textContent = body;
    }
    const st = document.createElement('span');
    st.className = 'mrclippy-nr-st';

    const ac = document.createElement('div');
    ac.className = 'mrclippy-finding-actions mrclippy-nr-ac';
    const fix = handlers.fix;
    const apply = button('Apply', 'mrclippy-btn-sm mrclippy-btn-primary mrclippy-fix-apply');
    const review = button(fix?.label ?? 'Review', 'mrclippy-btn-sm mrclippy-review');
    review.title = 'See the before and after, or talk it through';
    const retry = button('Retry', 'mrclippy-btn-sm mrclippy-retry');
    const bar = progressBar();
    const note = document.createElement('span');
    note.className = 'mrclippy-nr-note';
    const ignore = button('Ignore', 'mrclippy-dismiss');
    ignore.title = 'Never show this kind again';
    ignore.setAttribute('aria-label', 'Never show this kind of note again');

    if (fix) {
      apply.addEventListener('click', () => fix.apply());
      review.addEventListener('click', () => fix.review());
      retry.addEventListener('click', () => fix.retry());
      ac.append(apply, review, retry, bar);
    }
    ac.appendChild(note);
    let dropped = false;
    const drop = (): void => {
      if (dropped) return;
      dropped = true;
      handlers.dismiss();
      row.remove();
      this.states.delete(row);
      this.queued.delete(row);
      this.refresh();
    };
    ignore.addEventListener('click', drop);

    row.append(ic, tx, st, ac, ignore);
    if (fix?.label === 'Review') this.queued.add(row);
    this.well?.appendChild(row);

    let current: ThreadState | undefined;
    const draw = (state: ThreadState | undefined): void => {
      current = state;
      const kind = state?.kind ?? 'idle';
      row.dataset.state = kind;
      if (kind === 'applied') row.dataset.fixed = '';
      else delete row.dataset.fixed;
      // Queued for background drafting: nothing is written yet, so no bulb.
      const waiting = kind === 'idle' && fix?.label === 'Review';
      ic.replaceChildren(
        kind === 'working' || waiting
          ? statusIcon('glass')
          : kind === 'applied'
            ? statusIcon('ok')
            : kind === 'failed'
              ? statusIcon('err')
              : kind === 'answered' || kind === 'skipped'
                ? bullet(true)
                : kind === 'ready'
                  ? statusIcon('bulb')
                  : bullet(),
      );
      st.textContent =
        state?.kind === 'ready'
          ? `${state.count} change${state.count === 1 ? '' : 's'}`
          : kind === 'working'
            ? 'Writing…'
            : waiting
              ? 'Waiting'
            : kind === 'applied'
              ? 'Applied'
              : kind === 'failed'
                ? 'Failed'
                : kind === 'answered'
                  ? 'No change'
                  : kind === 'skipped'
                    ? 'Skipped'
                    : '';
      apply.hidden = kind !== 'ready';
      review.hidden = !fix || waiting || kind === 'working' || kind === 'applied' || kind === 'failed';
      retry.hidden = kind !== 'failed';
      bar.hidden = kind !== 'working';
      ignore.hidden = kind === 'applied' || kind === 'working';
      note.className = `mrclippy-nr-note${kind === 'failed' ? ' mrclippy-why' : ''}`;
      note.textContent =
        kind === 'working'
          ? 'Writing a fix'
          : state?.kind === 'failed'
            ? `Not done. ${state.reason ?? 'Try again.'}`
            : '';
      ac.hidden =
        !fix || (apply.hidden && review.hidden && retry.hidden && bar.hidden && note.textContent === '');
      this.states.set(row, state);
      this.refresh();
    };
    draw(undefined);

    return {
      el: row,
      get state() { return current; },
      setState: draw,
      opened: () => {
        review.textContent = 'Review';
      },
      ignore: drop,
    };
  }

  /** A question asked from the list, so its chat can be reopened like a fix. */
  addQuestion(title: string, open: () => void): QuestionRow {
    if (!this.questions) {
      const { box, well } = groupBox('Your questions');
      box.classList.add('mrclippy-chats');
      this.groups.appendChild(box);
      this.questions = well;
    }
    const row = document.createElement('div');
    row.className = 'mrclippy-q';
    row.tabIndex = 0;
    const bul = bullet();
    const qt = document.createElement('span');
    qt.className = 'mrclippy-qt';
    qt.textContent = title;
    const st = document.createElement('span');
    st.className = 'mrclippy-q-st';
    row.append(bul, qt, st);
    row.addEventListener('click', open);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') open();
    });
    this.questions.appendChild(row);

    return {
      remove: () => {
        row.remove();
        if (this.questions?.childElementCount === 0) {
          this.questions.closest('.mrclippy-chats')?.remove();
          this.questions = undefined;
        }
        this.refresh();
      },
      setState: (state) => {
        const done = state.kind !== 'working' && state.kind !== 'failed';
        bul.className = `mrclippy-bul${done ? ' mrclippy-bul-done' : ''}`;
        st.textContent =
          state.kind === 'working'
            ? 'Working…'
            : state.kind === 'failed'
              ? 'Failed'
              : state.kind === 'ready'
                ? `${state.count} to review`
                : 'Answered';
        row.dataset.state = state.kind;
        if (state.kind === 'answered') row.dataset.fixed = '';
        else delete row.dataset.fixed;
        this.refresh();
      },
    };
  }

  /** Heading count, tally line and the hide-fixed count, from the rows as they are. */
  private refresh(): void {
    const notes = this.states.size;
    this.big.textContent = notes === 0 ? 'No notes' : `${notes} note${notes === 1 ? '' : 's'}`;
    this.tally.textContent = tallyLine(
      [...this.states].filter(([row, state]) => state !== undefined || this.queued.has(row)).map(([, state]) => state),
    );
    this.tally.hidden = this.tally.textContent === '';
    const fixed = this.el.querySelectorAll('[data-fixed]').length;
    this.hideToggle?.setLabel(`Hide fixed (${fixed})`);
    if (this.hiddenLine) {
      this.hiddenLine.textContent =
        fixed > 0 ? `${fixed} fixed item${fixed === 1 ? '' : 's'} hidden. Untick to show ${fixed === 1 ? 'it' : 'them'}.` : '';
    }
  }
}
