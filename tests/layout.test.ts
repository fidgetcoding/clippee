import { expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ data: {} as Record<string, unknown> }));
vi.mock('../src/platform', () => ({
  hasExtensionApis: () => true,
  ext: { storage: { local: {
    get: async (key: string) => ({ [key]: store.data[key] }),
    set: async (items: Record<string, unknown>) => { Object.assign(store.data, items); },
  } } },
}));

import { Balloon } from '../src/character/Balloon';
import { layoutToSave, loadLayout, makePanelMovable } from '../src/content/layout';

function panelBalloon(): Balloon {
  const anchor = document.createElement('div');
  document.body.appendChild(anchor);
  const balloon = new Balloon(anchor);
  const sheet = document.createElement('div');
  balloon.render(sheet);
  return balloon;
}

it('drops a panel layout the old versions saved on their own, so he opens beside you with his tail', async () => {
  // v2.1 saved the spot after any change, notes filling in included.
  store.data['mrclippy:layout'] = { agent: { x: 5, y: 6 }, panel: { left: 900, top: 300, width: 446, height: 600 } };
  expect(await loadLayout()).toEqual({ agent: { x: 5, y: 6 } });
  store.data['mrclippy:layout'] = { panel: { left: 10, top: 20, v: 2 } };
  expect((await loadLayout()).panel).toEqual({ left: 10, top: 20, v: 2 });
});

it('remembers only what the user chose: never a panel that just grew', () => {
  const el = document.createElement('div');
  expect(layoutToSave(el, undefined)).toBeUndefined();
  el.style.width = '470px'; // the corner grip writes this
  expect(layoutToSave(el, undefined)).toEqual({ width: 470, v: 2 });
  expect(layoutToSave(el, { left: 40, top: 50 })).toEqual({ width: 470, left: 40, top: 50, v: 2 });
});

it('reopens beside him, tail and all, at a size the user chose without a spot', () => {
  const balloon = panelBalloon();
  const release = makePanelMovable(balloon, document.createElement('div'), { width: 470, v: 2 });
  expect(balloon.el.dataset.pinned).toBeUndefined();
  expect(balloon.pinnedAt).toBeUndefined();
  expect(balloon.el.style.width).toBe('470px');
  release();
});

it('reopens where the user dragged it', () => {
  const balloon = panelBalloon();
  const release = makePanelMovable(balloon, document.createElement('div'), { left: 30, top: 40, v: 2 });
  expect(balloon.pinnedAt).toEqual({ left: 30, top: 40 });
  release();
});
