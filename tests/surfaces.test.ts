import { describe, expect, it } from 'vitest';
import { isWritingSurface } from '../src/content/surfaces';

const at = (url: string) => {
  const u = new URL(url);
  return { hostname: u.hostname, pathname: u.pathname };
};

describe('writing surfaces', () => {
  it('shows up in a Google Doc', () => {
    expect(isWritingSurface(at('https://docs.google.com/document/d/abc/edit'))).toBe(true);
  });

  it('stays off the Docs file list', () => {
    expect(isWritingSurface(at('https://docs.google.com/document/u/0/'))).toBe(false);
  });

  it('shows up in the Word editor frame', () => {
    expect(
      isWritingSurface(at('https://word-edit.officeapps.live.com/we/wordeditorframe.aspx?ui=en')),
    ).toBe(true);
  });

  it('stays out of Excel frames on the same host family', () => {
    expect(isWritingSurface(at('https://excel.officeapps.live.com/x/_layouts/xlviewerinternal.aspx'))).toBe(false);
  });

  it('stays off ordinary sites', () => {
    expect(isWritingSurface(at('https://www.linkedin.com/feed/'))).toBe(false);
    expect(isWritingSurface(at('https://news.ycombinator.com/'))).toBe(false);
  });
});
