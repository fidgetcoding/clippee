/**
 * Does a URL fall under a Chrome match pattern ("*://docs.google.com/document/d/*")?
 * Enough of the syntax for the patterns in this manifest: http(s) schemes, an
 * exact or `*.` host, and a path glob.
 */
export function matchesPattern(url: string | undefined, pattern: string): boolean {
  const m = /^(\*|https?):\/\/([^/]+)(\/.*)$/.exec(pattern);
  if (!url || !m) return false;
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  const scheme = m[1]!, host = m[2]!, path = m[3]!;
  if (scheme === '*' ? !/^https?:$/.test(u.protocol) : u.protocol !== `${scheme}:`) return false;
  const hostOk = host.startsWith('*.')
    ? u.hostname === host.slice(2) || u.hostname.endsWith(host.slice(1))
    : u.hostname === host;
  const glob = new RegExp(`^${path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
  return hostOk && glob.test(u.pathname + u.search);
}
