// Belt-and-suspenders RFC text fetching.
//
// A static site can't proxy, and the canonical hosts (rfc-editor.org, ietf.org)
// don't reliably send CORS headers for browser fetches. So we try the direct
// hosts first (cheap if they ever allow it / are cached by the service worker)
// and then fall back through public read-only CORS proxies. Whatever succeeds
// first wins; if everything fails we surface links to read it on the source.

export interface FetchResult {
  text: string;
  source: string;
}

type Provider = {
  label: string;
  url: (n: number) => string;
  /** Some providers wrap the payload; extract the plain text. */
  extract?: (raw: string) => string;
};

const txt = (n: number) => `https://www.rfc-editor.org/rfc/rfc${n}.txt`;

const PROVIDERS: Provider[] = [
  { label: "rfc-editor.org", url: txt },
  { label: "ietf.org", url: (n) => `https://www.ietf.org/rfc/rfc${n}.txt` },
  {
    label: "allorigins.win",
    url: (n) => `https://api.allorigins.win/raw?url=${encodeURIComponent(txt(n))}`,
  },
  {
    label: "corsproxy.io",
    url: (n) => `https://corsproxy.io/?url=${encodeURIComponent(txt(n))}`,
  },
  {
    label: "jina.ai",
    url: (n) => `https://r.jina.ai/${txt(n)}`,
  },
];

const PER_PROVIDER_TIMEOUT_MS = 12_000;
const MIN_VALID_LENGTH = 200;

async function tryProvider(p: Provider, n: number): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PER_PROVIDER_TIMEOUT_MS);
  try {
    const res = await fetch(p.url(n), { signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) return null;
    let body = await res.text();
    if (p.extract) body = p.extract(body);
    // Guard against proxy error pages / HTML stubs masquerading as success.
    if (body.length < MIN_VALID_LENGTH) return null;
    if (/^\s*<(!doctype|html)/i.test(body) && !/RFC\s*\d+/i.test(body.slice(0, 2000))) {
      return null;
    }
    return body;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchRfcText(n: number): Promise<FetchResult> {
  // Deliberately sequential: providers are an ordered fallback chain, so we
  // stop at the first that works rather than hammering every source at once.
  for (const p of PROVIDERS) {
    // eslint-disable-next-line no-await-in-loop
    const body = await tryProvider(p, n);
    if (body) return { text: body, source: p.label };
  }
  throw new Error(`Could not load RFC ${n} from any source.`);
}

/** External canonical links shown alongside the reader / as a fallback. */
export function externalLinks(n: number): { label: string; href: string }[] {
  return [
    { label: "rfc-editor.org", href: `https://www.rfc-editor.org/rfc/rfc${n}.html` },
    { label: "Plain text", href: txt(n) },
    { label: "IETF Datatracker", href: `https://datatracker.ietf.org/doc/rfc${n}/` },
  ];
}
