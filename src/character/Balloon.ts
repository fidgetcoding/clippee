export type BalloonSide = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface BalloonAction {
  readonly label: string;
  readonly run: () => void;
  /** Rendered as the default action and given initial focus. */
  readonly primary?: boolean;
}

const MARGIN = 15;

/**
 * The speech balloon.
 *
 * Keeps clippy.js's visual language — tip pointer, 15px margin, four-quadrant
 * auto-placement — and throws away its behaviour. The original is a speak-and-fade
 * tooltip with a 2s auto-hide, which is right for a one-line greeting and useless
 * for a review queue. This one holds arbitrary content and never hides itself
 * unless asked.
 *
 * The Office 97 balloon look is authored CSS plus a border, not Microsoft artwork,
 * so it carries no licensing weight.
 */
export class Balloon {
  readonly el: HTMLElement;
  private readonly content: HTMLElement;
  private readonly tip: HTMLElement;
  private hideTimer: ReturnType<typeof setTimeout> | undefined;
  private locked = false;

  constructor(private readonly anchor: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'mrclippy-balloon';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-live', 'polite');
    this.el.hidden = true;

    this.content = document.createElement('div');
    this.content.className = 'mrclippy-balloon-content';

    this.tip = document.createElement('div');
    this.tip.className = 'mrclippy-balloon-tip';

    this.el.append(this.content, this.tip);
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  /**
   * Locked means the user is interacting with what is in here — a menu, a chat,
   * a list they are reading. Casual writers (`say`, `suggest`, `hideAfter`)
   * become no-ops until it is released.
   *
   * This exists because gating the renderer was not enough: a `speak()` queued
   * before the panel opened still fired afterwards and replaced it, and its
   * auto-hide then took the whole balloon down. Making the surface itself refuse
   * to be overwritten is the fix that holds no matter who calls what.
   */
  lock(): void {
    this.locked = true;
    this.clearHideTimer();
  }

  /**
   * Take the lock and show a placeholder immediately.
   *
   * Reading a Google Doc is a bridge round-trip, so there is real time between
   * the click and having anything to render. Locking only once content is ready
   * leaves that window open for a queued speak or a proactive suggestion to land
   * on an unlocked balloon — which is exactly the bug this closes.
   */
  claim(placeholder: string): void {
    this.clearHideTimer();
    this.content.replaceChildren(document.createTextNode(placeholder));
    this.locked = true;
    this.show();
  }

  unlock(): void {
    this.locked = false;
  }

  get isLocked(): boolean {
    return this.locked;
  }

  /** Show a plain-text line. Ignored while locked. */
  say(text: string): void {
    if (this.locked) return;
    this.content.replaceChildren(document.createTextNode(text));
    this.show();
  }

  /**
   * Show a suggestion with its actions.
   *
   * Rejection has to cost nothing. The single most-cited complaint about the
   * original Clippy was that dismissing it did not stick, so every suggestion
   * carries a visible, one-click way out and the dismissal is remembered by
   * kind. Escape does the same thing from the keyboard.
   */
  suggest(text: string, actions: readonly BalloonAction[]): void {
    if (this.locked) return;
    const body = document.createElement('div');
    body.className = 'mrclippy-balloon-text';
    body.textContent = text;

    const row = document.createElement('div');
    row.className = 'mrclippy-balloon-actions';

    for (const action of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `mrclippy-btn${action.primary ? ' mrclippy-btn-primary' : ''}`;
      button.textContent = action.label;
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        action.run();
      });
      row.appendChild(button);
    }

    const wrapper = document.createElement('div');
    wrapper.append(body, row);
    this.render(wrapper);

    // Focus the primary action so the keyboard path works without a mouse.
    row.querySelector<HTMLButtonElement>('.mrclippy-btn-primary')?.focus();
  }

  /**
   * Show arbitrary content — a menu, a chat, a list. This is the deliberate
   * path, so it overrides the lock and takes it: whatever is rendered here is
   * now the thing the user is interacting with.
   */
  render(node: Node): void {
    this.clearHideTimer();
    this.content.replaceChildren(node);
    this.locked = true;
    this.show();
  }

  show(): void {
    this.clearHideTimer();
    this.el.hidden = false;
    this.position();
  }

  /** Always works — the user closing something is never blocked. */
  hide(): void {
    this.clearHideTimer();
    this.locked = false;
    this.el.hidden = true;
  }

  /** Hide after `ms`. Used for greetings, never for anything actionable. */
  hideAfter(ms: number): void {
    if (this.locked) return;
    this.clearHideTimer();
    this.hideTimer = setTimeout(() => this.hide(), ms);
  }

  private clearHideTimer(): void {
    if (this.hideTimer !== undefined) clearTimeout(this.hideTimer);
    this.hideTimer = undefined;
  }

  /**
   * Place the balloon in whichever quadrant has room, preferring above-left of
   * the character. Measured against the viewport, not the document, because the
   * character is fixed-position.
   */
  position(): void {
    const side = this.chooseSide();
    const a = this.anchor.getBoundingClientRect();
    const b = this.el.getBoundingClientRect();

    const top = side.startsWith('top') ? a.top - b.height - MARGIN : a.bottom + MARGIN;
    const left = side.endsWith('left')
      ? Math.max(MARGIN, a.left + a.width / 2 - b.width + a.width / 2)
      : Math.max(MARGIN, a.left);

    const clampedLeft = Math.min(left, window.innerWidth - b.width - MARGIN);

    this.el.style.top = `${Math.max(MARGIN, top)}px`;
    this.el.style.left = `${Math.max(MARGIN, clampedLeft)}px`;
    this.el.dataset.side = side;
  }

  private chooseSide(): BalloonSide {
    const a = this.anchor.getBoundingClientRect();
    const b = this.el.getBoundingClientRect();
    const roomAbove = a.top > b.height + MARGIN * 2;
    const roomLeft = a.right > b.width + MARGIN * 2;
    return `${roomAbove ? 'top' : 'bottom'}-${roomLeft ? 'left' : 'right'}` as BalloonSide;
  }
}
