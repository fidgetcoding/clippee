import type { Balloon } from '../character/Balloon';
import { ext, hasExtensionApis } from '../platform';

/**
 * Where the user put things: Clippy's spot, and the panel's spot and size.
 * Per machine (storage.local), because screen sizes differ between machines.
 */
export interface Layout {
  agent?: { x: number; y: number };
  panel?: { left: number; top: number; width?: number; height?: number };
}

const KEY = 'mrclippy:layout';

export async function loadLayout(): Promise<Layout> {
  if (!hasExtensionApis()) return {};
  const stored = await ext.storage.local.get(KEY);
  const value = stored[KEY];
  return value && typeof value === 'object' ? (value as Layout) : {};
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
  if (saved) balloon.pin(saved.left, saved.top);
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
    if (at) void saveLayout({ panel: { ...currentSize(), left: at.left, top: at.top } });
  };

  const currentSize = (): { width: number; height: number } => {
    const rect = el.getBoundingClientRect();
    return { width: Math.round(rect.width), height: Math.round(rect.height) };
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
            const rect = el.getBoundingClientRect();
            const at = balloon.pinnedAt ?? { left: rect.left, top: rect.top };
            void saveLayout({ panel: { ...currentSize(), left: at.left, top: at.top } });
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
