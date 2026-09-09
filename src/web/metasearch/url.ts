
const TRACKING_PREFIXES: readonly string[] = ['utm_'];

const TRACKING_PARAMS: ReadonlySet<string> = new Set([
  'ref', 'referrer', 'source', 'src', 'fbclid', 'gclid', 'igshid', 'igsh',
  'mc_cid', 'mc_eid', 'msclkid', 'spm', 'si', 'yclid', 'dclid', 'wickedid',
  'vero_id', 'twclid',
]);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const TRACKING_RE = new RegExp(
  `^(?:${TRACKING_PREFIXES.map(escapeRegExp).join('|')})` +
  `|^(?:${[...TRACKING_PARAMS].map(escapeRegExp).join('|')})$`,
  'i',
);

export function isTrackingParam(name: string): boolean {
  return TRACKING_RE.test(name);
}

export function dedupKey(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

  const host = u.hostname.toLowerCase();

  const isDefaultPort =
    (u.port === '80' && u.protocol === 'http:') || (u.port === '443' && u.protocol === 'https:');
  const port = u.port && !isDefaultPort ? `:${u.port}` : '';

  let path = u.pathname;
  if (path.length > 1) path = path.replace(/\/+$/, '');

  const kept: string[] = [];
  for (const [k, v] of u.searchParams) {
    if (!isTrackingParam(k)) kept.push(`${k}=${v}`);
  }
  kept.sort();
  const qs = kept.length ? `?${kept.join('&')}` : '';

  return `${host}${port}${path}${qs}`;
}
