export type BalloonSide =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  /** Beside the character: the balloon sits to his left, the tail points right. */
  | 'left'
  /** Beside the character: the balloon sits to his right, the tail points left. */
  | 'right';

export interface BalloonAction {
  readonly label: string;
  readonly run: () => void;
  /** Rendered as the default action and given initial focus. */
  readonly primary?: boolean;
}

const MARGIN = 15;
/**
 * Space between a sheet and the character. A sheet's tail sits inside its own
 * padding (so the panel can clip for native resize without cutting the tail
 * off), which puts the tip at the sheet's edge: it only needs a hair of air.
 */
const TAIL_GAP = 2;

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * The Office 97 tail: a skewed wedge drawn as SVG so the 1px outline runs
 * cleanly from the balloon edge to the point. One shape per direction.
 */
const TAILS: Readonly<Record<'down' | 'up' | 'left' | 'right', { w: number; h: number; fill: string; line: string }>> = {
  down: { w: 30, h: 20, fill: 'M0 0 L30 0 L21 19 Z', line: 'M1 .5 L21 19 L29 .5' },
  up: { w: 30, h: 20, fill: 'M0 20 L30 20 L21 1 Z', line: 'M1 19.5 L21 1 L29 19.5' },
  left: { w: 22, h: 30, fill: 'M22 0 L22 30 L1 21 Z', line: 'M21.5 1 L1 21 L21.5 29' },
  right: { w: 22, h: 30, fill: 'M0 0 L0 30 L21 21 Z', line: 'M.5 1 L21 21 L.5 29' },
};

function tailFor(side: BalloonSide): keyof typeof TAILS {
  if (side === 'left') return 'right';
  if (side === 'right') return 'left';
  return side.startsWith('top') ? 'down' : 'up';
}

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
  private holdingSuggestion = false;
  /** Set when the user has dragged the panel somewhere: stop following him. */
  private pinned: { left: number; top: number } | undefined;

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
    this.holdingSuggestion = false;
    this.clearHideTimer();
    this.content.replaceChildren(document.createTextNode(placeholder));
    delete this.el.dataset.sheet;
    this.locked = true;
    this.show();
  }

  unlock(): void {
    this.locked = false;
  }

  /**
   * True while the balloon shows a proactive suggestion and nothing else.
   * `suggest` takes the lock so a queued speak cannot overwrite it, which means
   * the lock alone cannot tell a suggestion from a panel the user opened. The
   * renderer reads this to know its own content is safe to close.
   */
  get showingSuggestion(): boolean {
    return this.holdingSuggestion && !this.el.hidden;
  }

  get isLocked(): boolean {
    return this.locked;
  }

  /** Show a plain-text line. Ignored while locked. */
  say(text: string): void {
    if (this.locked) return;
    this.content.replaceChildren(document.createTextNode(text));
    delete this.el.dataset.sheet;
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
  suggest(
    text: string,
    actions: readonly BalloonAction[],
    title = 'Mr. Clippy suggests',
  ): void {
    if (this.locked) return;
    const ribbon = document.createElement('div');
    ribbon.className = 'mrclippy-rib mrclippy-rib-first';
    ribbon.textContent = title;

    const body = document.createElement('div');
    body.className = 'mrclippy-balloon-text';
    body.textContent = text;

    const row = document.createElement('div');
    row.className = 'mrclippy-balloon-actions';

    for (const action of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `mrclippy-btn mrclippy-btn-sm${action.primary ? ' mrclippy-btn-primary' : ''}`;
      button.textContent = action.label;
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        action.run();
      });
      row.appendChild(button);
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'mrclippy-nudge';
    wrapper.append(ribbon, body, row);
    this.render(wrapper);
    this.holdingSuggestion = true;

    // Focus the primary action so the keyboard path works without a mouse.
    row.querySelector<HTMLButtonElement>('.mrclippy-btn-primary')?.focus();
  }

  /**
   * Show arbitrary content — a menu, a chat, a list. This is the deliberate
   * path, so it overrides the lock and takes it: whatever is rendered here is
   * now the thing the user is interacting with.
   */
  render(node: Node): void {
    this.holdingSuggestion = false;
    this.clearHideTimer();
    this.content.replaceChildren(node);
    // A sheet: ribbons edge to edge, placed beside him rather than above.
    this.el.dataset.sheet = '';
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
    this.holdingSuggestion = false;
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

  /** Hold the balloon at a spot the user chose, instead of beside the character. */
  pin(left: number, top: number): void {
    this.pinned = { left, top };
    this.el.dataset.pinned = '';
    this.position();
  }

  unpin(): void {
    this.pinned = undefined;
    delete this.el.dataset.pinned;
  }

  get pinnedAt(): { left: number; top: number } | undefined {
    return this.pinned;
  }

  /**
   * Sheets (the panel, a suggestion) go beside him; plain lines go in whichever
   * quadrant has room, preferring above-left of
   * the character. Measured against the viewport, not the document, because the
   * character is fixed-position.
   */
  position(): void {
    if (this.pinned) {
      const b = this.el.getBoundingClientRect();
      const left = Math.min(Math.max(0, this.pinned.left), Math.max(0, window.innerWidth - b.width));
      const top = Math.min(Math.max(0, this.pinned.top), Math.max(0, window.innerHeight - 40));
      this.el.style.left = `${left}px`;
      this.el.style.top = `${top}px`;
      return;
    }
    if (this.el.dataset.sheet !== undefined && this.placeBeside()) return;

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
    this.setSide(side);
  }

  /**
   * Sheets sit beside him, foot level with his, the tail pointing at him from
   * the near edge. Returns false when neither side has room, so the caller can
   * fall back to the quadrant placement.
   */
  private placeBeside(): boolean {
    const a = this.anchor.getBoundingClientRect();
    const b = this.el.getBoundingClientRect();
    const roomLeft = a.left >= b.width + TAIL_GAP + MARGIN;
    const roomRight = window.innerWidth - a.right >= b.width + TAIL_GAP + MARGIN;
    if (!roomLeft && !roomRight) return false;

    // His right first, as the design has it; his left when he is near the edge.
    const side: BalloonSide = roomRight ? 'right' : 'left';
    const left = side === 'left' ? a.left - b.width - TAIL_GAP : a.right + TAIL_GAP;
    const maxTop = Math.max(MARGIN, window.innerHeight - b.height - MARGIN);
    const top = Math.min(Math.max(MARGIN, a.bottom - b.height), maxTop);

    // The tail aims at his middle, but never leaves the balloon's edge.
    const aim = a.top + a.height * 0.4 - top - 15;
    const tailY = Math.min(Math.max(10, aim), Math.max(10, b.height - 40));

    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
    this.el.style.setProperty('--mrclippy-tail-y', `${Math.round(tailY)}px`);
    this.setSide(side);
    return true;
  }

  private setSide(side: BalloonSide): void {
    if (this.el.dataset.side === side && this.tip.firstChild) return;
    this.el.dataset.side = side;
    const shape = TAILS[tailFor(side)];
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', String(shape.w));
    svg.setAttribute('height', String(shape.h));
    svg.setAttribute('viewBox', `0 0 ${shape.w} ${shape.h}`);
    const fill = document.createElementNS(SVG_NS, 'path');
    fill.setAttribute('d', shape.fill);
    fill.setAttribute('class', 'mrclippy-tail-fill');
    const line = document.createElementNS(SVG_NS, 'path');
    line.setAttribute('d', shape.line);
    line.setAttribute('class', 'mrclippy-tail-line');
    svg.append(fill, line);
    this.tip.replaceChildren(svg);
  }

  private chooseSide(): BalloonSide {
    const a = this.anchor.getBoundingClientRect();
    const b = this.el.getBoundingClientRect();
    const roomAbove = a.top > b.height + MARGIN * 2;
    const roomLeft = a.right > b.width + MARGIN * 2;
    return `${roomAbove ? 'top' : 'bottom'}-${roomLeft ? 'left' : 'right'}` as BalloonSide;
  }
}
