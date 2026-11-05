import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const css = readFileSync('src/content/styles.css', 'utf8');

it('hidden beats the sheet display rule, so closing the panel hides it', () => {
  // The production bug: `.mrclippy-balloon[data-sheet] { display: flex }` came
  // later than `[hidden] { display: none }` at the same specificity, so a closed
  // panel stayed on screen, unsized and unpinned, with an X that did nothing.
  // jsdom does not cascade this the way Chrome does, so check the rule itself.
  const rule = /\.mrclippy-balloon\[hidden\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  expect(rule).toMatch(/display:\s*none\s*!important/);
});
