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

// ── Internet-Drafts ──────────────────────────────────────────────────────────
//
// Drafts aren't in the RFC index and have no number — they're identified by name
// (e.g. "draft-ietf-dkim-dkim2-spec") and a two-digit revision. We resolve the
// current revision + title from the IETF Datatracker, then fetch the versioned
// plain text from the archive. As with RFCs, the canonical hosts don't reliably
// send CORS headers, so we try direct then fall back through read-only proxies.

export interface DraftInfo {
  id: string;
  title: string;
  rev: string | null;
  status: string;
  abstract: string;
  year: number | null;
}

const DRAFT_ID_RE = /^draft-[a-z0-9]+(?:-[a-z0-9]+)*$/i;

/** True for strings that look like an internet-draft name. */
export function isDraftId(s: string): boolean {
  return DRAFT_ID_RE.test(s.trim());
}

const draftTxt = (id: string, rev: string) => `https://www.ietf.org/archive/id/${id}-${rev}.txt`;
const draftApi = (id: string) =>
  `https://datatracker.ietf.org/api/v1/doc/document/${id}/?format=json`;

// Proxy wrappers reused for both the metadata API and the document text.
const PROXIES: { label: string; wrap: (u: string) => string }[] = [
  {
    label: "allorigins.win",
    wrap: (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  },
  { label: "corsproxy.io", wrap: (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}` },
  { label: "jina.ai", wrap: (u) => `https://r.jina.ai/${u}` },
];

async function fetchWithTimeout(url: string): Promise<Response | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PER_PROVIDER_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: ctrl.signal, redirect: "follow" });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve a draft's current revision + title via Datatracker (direct, then proxied). */
export async function resolveDraft(id: string): Promise<DraftInfo | null> {
  const direct = draftApi(id);
  const candidates = [direct, ...PROXIES.map((p) => p.wrap(direct))];
  for (const url of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const res = await fetchWithTimeout(url);
    if (!res || !res.ok) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      const d = JSON.parse(await res.text());
      if (!d || typeof d.title !== "string") continue;
      const time = String(d.time ?? d.expires ?? "");
      return {
        id,
        title: d.title.trim(),
        rev: d.rev ? String(d.rev).trim() : null,
        status: "INTERNET-DRAFT",
        abstract: String(d.abstract ?? "")
          .replace(/\s+/g, " ")
          .trim(),
        year: /^\d{4}/.test(time) ? Number(time.slice(0, 4)) : null,
      };
    } catch {
      /* not JSON (proxy error page) — try the next candidate */
    }
  }
  return null;
}

/**
 * Fetch a draft's plain text. If the revision is unknown it is resolved first.
 * Returns the text plus the resolved revision so callers can label/display it.
 */
export async function fetchDraftText(
  id: string,
  rev?: string | null,
): Promise<FetchResult & { rev: string | null }> {
  let resolvedRev = rev ?? null;
  if (!resolvedRev) resolvedRev = (await resolveDraft(id))?.rev ?? null;
  if (!resolvedRev) throw new Error(`Could not resolve a revision for ${id}.`);

  const base = draftTxt(id, resolvedRev);
  const candidates: { label: string; url: string }[] = [
    { label: "ietf.org", url: base },
    ...PROXIES.map((p) => ({ label: p.label, url: p.wrap(base) })),
  ];
  for (const { label, url } of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const res = await fetchWithTimeout(url);
    if (!res || !res.ok) continue;
    // eslint-disable-next-line no-await-in-loop
    const body = await res.text();
    if (body.length < MIN_VALID_LENGTH) continue;
    if (/^\s*<(!doctype|html)/i.test(body) && !/draft-/i.test(body.slice(0, 2000))) continue;
    return { text: body, source: label, rev: resolvedRev };
  }
  throw new Error(`Could not load ${id}-${resolvedRev} from any source.`);
}

/** External canonical links shown alongside the reader for a draft. */
export function draftExternalLinks(
  id: string,
  rev?: string | null,
): { label: string; href: string }[] {
  const links = [{ label: "IETF Datatracker", href: `https://datatracker.ietf.org/doc/${id}/` }];
  if (rev) {
    links.push(
      { label: "Plain text", href: draftTxt(id, rev) },
      { label: "HTML", href: `https://www.ietf.org/archive/id/${id}-${rev}.html` },
    );
  }
  return links;
}
