import { describe, expect, it, vi } from 'vitest';
import { Balloon } from '../src/character/Balloon';

function make(): Balloon {
  const anchor = document.createElement('div');
  document.body.appendChild(anchor);
  const balloon = new Balloon(anchor);
  document.body.appendChild(balloon.el);
  return balloon;
}

function panel(text = 'menu'): HTMLElement {
  const node = document.createElement('div');
  node.className = 'test-panel';
  node.textContent = text;
  return node;
}

describe('balloon lock', () => {
  it('refuses a queued speak once the user has opened something', () => {
    // The exact production bug: the greeting's speak() was queued behind an
    // animation, fired after the user clicked, and replaced their menu.
    const balloon = make();
    balloon.render(panel('the menu'));

    balloon.say('It looks like you are writing something.');

    expect(balloon.el.querySelector('.test-panel')).not.toBeNull();
    expect(balloon.el.textContent).toContain('the menu');
  });

  it('refuses a proactive suggestion while locked', () => {
    const balloon = make();
    balloon.render(panel());

    const run = vi.fn();
    balloon.suggest('you repeat yourself', [{ label: 'Not that', run }]);

    expect(balloon.el.querySelector('.test-panel')).not.toBeNull();
  });

  it('ignores an auto-hide scheduled against locked content', () => {
    vi.useFakeTimers();
    const balloon = make();
    balloon.render(panel());

    balloon.hideAfter(10);
    vi.advanceTimersByTime(100);

    expect(balloon.visible).toBe(true);
    vi.useRealTimers();
  });

  it('cancels a hide timer that was already pending when content is rendered', () => {
    // Ordering matters: a greeting can schedule its dismissal *before* the user
    // clicks. That timer must not fire against what replaced it.
    vi.useFakeTimers();
    const balloon = make();

    balloon.say('greeting');
    balloon.hideAfter(50);
    balloon.render(panel());

    vi.advanceTimersByTime(200);

    expect(balloon.visible).toBe(true);
    expect(balloon.el.querySelector('.test-panel')).not.toBeNull();
    vi.useRealTimers();
  });

  it('lets the user close it regardless', () => {
    const balloon = make();
    balloon.render(panel());
    expect(balloon.isLocked).toBe(true);

    balloon.hide();

    expect(balloon.visible).toBe(false);
    expect(balloon.isLocked).toBe(false);
  });

  it('accepts casual writes again once closed', () => {
    const balloon = make();
    balloon.render(panel());
    balloon.hide();

    balloon.say('back to normal');

    expect(balloon.el.textContent).toContain('back to normal');
  });
});

describe('suggestion buttons', () => {
  /** The balloon a real Renderer sees: suggest() locks it, then a button fires. */
  function wired() {
    const anchor = document.createElement('div');
    document.body.appendChild(anchor);
    const balloon = new Balloon(anchor);
    document.body.appendChild(balloon.el);
    const agent = { balloon, play: () => Promise.resolve(), speak: () => Promise.resolve() };
    return { balloon, agent: agent as unknown as import('../src/character/Agent').Agent };
  }

  it('Thanks closes the suggestion it showed', async () => {
    const { Renderer } = await import('../src/scheduler/Renderer');
    const { SuggestionQueue } = await import('../src/scheduler/SuggestionQueue');
    const { BreakpointDetector } = await import('../src/scheduler/BreakpointDetector');
    const { balloon, agent } = wired();
    const renderer = new Renderer(agent, new SuggestionQueue(), new BreakpointDetector());

    balloon.suggest('You use "x y z" 2 times close together.', [
      { label: 'Thanks', primary: true, run: () => renderer.resolveCurrent() },
    ]);
    balloon.el.querySelector<HTMLButtonElement>('.mrclippy-btn-primary')?.click();

    expect(balloon.visible).toBe(false);
  });

  it('Not that closes the suggestion it showed', async () => {
    const { Renderer } = await import('../src/scheduler/Renderer');
    const { SuggestionQueue } = await import('../src/scheduler/SuggestionQueue');
    const { BreakpointDetector } = await import('../src/scheduler/BreakpointDetector');
    const { balloon, agent } = wired();
    const renderer = new Renderer(agent, new SuggestionQueue(), new BreakpointDetector());

    balloon.suggest('note', [{ label: 'Not that', run: () => renderer.dismissCurrent() }]);
    balloon.el.querySelector<HTMLButtonElement>('.mrclippy-btn')?.click();

    expect(balloon.visible).toBe(false);
  });

  it('still never closes a panel the user opened', async () => {
    const { Renderer } = await import('../src/scheduler/Renderer');
    const { SuggestionQueue } = await import('../src/scheduler/SuggestionQueue');
    const { BreakpointDetector } = await import('../src/scheduler/BreakpointDetector');
    const { balloon, agent } = wired();
    const renderer = new Renderer(agent, new SuggestionQueue(), new BreakpointDetector());

    balloon.suggest('note', []);
    balloon.render(panel());
    renderer.resolveCurrent();

    expect(balloon.visible).toBe(true);
  });
});

describe('balloon placement', () => {
  it('keeps a moved panel fully on screen, not just its title bar', () => {
    // From a live doc: the panel opened low and its Ask box ran past the
    // bottom of the window.
    const balloon = make();
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
    balloon.el.getBoundingClientRect = () =>
      ({ top: 0, left: 0, right: 400, bottom: 600, width: 400, height: 600, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

    balloon.pin(700, 500);

    expect(balloon.el.style.top).toBe('200px');
  });
});
