/**
 * Where he shows up: document editors only. The manifest already limits
 * injection to these sites; this is the finer cut inside them (Docs' file list
 * and Office's Excel and PowerPoint frames share hosts with the editors).
 */
export function isWritingSurface(loc: Pick<Location, 'hostname' | 'pathname'>): boolean {
  const { hostname, pathname } = loc;
  if (hostname === 'docs.google.com') return pathname.startsWith('/document/d/');
  // Word for the web edits inside an officeapps iframe, not the outer page.
  if (hostname.endsWith('.officeapps.live.com')) return /word/i.test(hostname + pathname);
  if (hostname === 'www.notion.so' || hostname.endsWith('.notion.site')) return true;
  return false;
}
