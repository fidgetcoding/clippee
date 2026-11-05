import type { Balloon } from '../character/Balloon';
import { ext, hasExtensionApis } from '../platform';

/**
 * Where the user put things: Clippy's spot, and the panel's spot and size.
 * Per machine (storage.local), because screen sizes differ between machines.
 */
export interface Layout {
  agent?: { x: number; y: number };
  /**
   * Only what the user chose: a spot from dragging the title bar (then the
   * panel is pinned there, with no tail), a size from the corner grip.
   * `v: 2` marks a layout saved by those alone.
   */
  panel?: { left?: number; top?: number; width?: number; height?: number; v?: 2 };
}

const KEY = 'mrclippy:layout';

/**
 * Before v2.2 the panel saved its spot and size after any change, his own
 * notes filling in included, so the next open came back pinned: a little
 * wider and with no tail pointing at him. Those layouts carry no mark and are
 * dropped; the panel goes back beside him.
 */
export async function loadLayout(): Promise<Layout> {
  if (!hasExtensionApis()) return {};
  const stored = await ext.storage.local.get(KEY);
  const value = stored[KEY];
  if (!value || typeof value !== 'object') return {};
  const layout = { ...(value as Layout) };
  if (layout.panel?.v !== 2) delete layout.panel;
  return layout;
}

export async function saveLayout(patch: Layout): Promise<void> {
  if (!hasExtensionApis()) return;
  const current = await loadLayout();
  await ext.storage.local.set({ [KEY]: { ...current, ...patch } });
}

const MIN_WIDTH = 280;
const MIN_HEIGHT = 220;

/**
 * Make the open panel movable by its title bar and resizable from its corner,
 * and remember both. Returns a cleanup for when the panel closes.
 */
export function makePanelMovable(
  balloon: Balloon,
  handle: HTMLElement,
  saved: Layout['panel'],
): () => void {
  const el = balloon.el;
  el.classList.add('mrclippy-balloon-panel');

  if (saved?.width) el.style.width = `${Math.max(MIN_WIDTH, saved.width)}px`;
  if (saved?.height) el.style.height = `${Math.max(MIN_HEIGHT, saved.height)}px`;
  if (saved?.left !== undefined && saved.top !== undefined) balloon.pin(saved.left, saved.top);
  // The panel is wider than the placeholder it replaced: place it again.
  else balloon.position();

  let drag: { dx: number; dy: number } | undefined;
  const down = (e: PointerEvent): void => {
    if ((e.target as HTMLElement).closest('button')) return;
    const rect = el.getBoundingClientRect();
    drag = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const move = (e: PointerEvent): void => {
    if (!drag) return;
    balloon.pin(e.clientX - drag.dx, e.clientY - drag.dy);
  };
  const up = (e: PointerEvent): void => {
    if (!drag) return;
    drag = undefined;
    if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
    const at = balloon.pinnedAt;
    if (at) void saveLayout({ panel: { ...chosenSize(el), left: at.left, top: at.top, v: 2 } });
  };

  handle.addEventListener('pointerdown', down);
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', up);
  handle.addEventListener('pointercancel', up);

  // The corner grip is native CSS `resize`; watch for it and remember the size.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const observer =
    typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver(() => {
          // Notes and drafts fill in after it opens; a panel placed at its
          // first height grew past the bottom of the window. Place it again.
          balloon.position();
          if (timer !== undefined) clearTimeout(timer);
          timer = setTimeout(() => {
            const panel = layoutToSave(el, balloon.pinnedAt);
            if (panel) void saveLayout({ panel });
          }, 400);
        });
  observer?.observe(el);

  return () => {
    observer?.disconnect();
    if (timer !== undefined) clearTimeout(timer);
    handle.removeEventListener('pointerdown', down);
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', up);
    handle.removeEventListener('pointercancel', up);
    el.classList.remove('mrclippy-balloon-panel');
    el.style.width = '';
    el.style.height = '';
    balloon.unpin();
  };
}

/**
 * The size the user gave it with the corner grip, which the browser writes as
 * an inline width and height. Content growing on its own sets neither.
 */
function chosenSize(el: HTMLElement): { width?: number; height?: number } {
  const width = parseFloat(el.style.width), height = parseFloat(el.style.height);
  return { ...(width > 0 ? { width: Math.round(width) } : {}), ...(height > 0 ? { height: Math.round(height) } : {}) };
}

/**
 * What a resize is worth remembering: a size the user chose, and the spot only
 * if they dragged it there. Nothing when the panel merely grew with its notes.
 */
export function layoutToSave(el: HTMLElement, pinned: { left: number; top: number } | undefined): Layout['panel'] {
  const size = chosenSize(el);
  if (size.width === undefined && size.height === undefined && !pinned) return undefined;
  return { ...size, ...(pinned ? { left: pinned.left, top: pinned.top } : {}), v: 2 };
}
