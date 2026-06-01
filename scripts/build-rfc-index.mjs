// Builds the search catalogue served at /rfc-index.json.
//
// At deploy time (GitHub Actions has open network) this downloads the full
// canonical RFC index from rfc-editor.org and distils it into a compact JSON
// document. When the network is unavailable (e.g. sandboxed CI) it transparently
// falls back to the committed seed set so the build always succeeds.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { XMLParser } from "fast-xml-parser";

const dir = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(dir, "../public/rfc-index.json");
const SEED = resolve(dir, "./seed-rfc-index.json");
const SEED_DRAFTS = resolve(dir, "./seed-drafts.json");
const INDEX_URL = "https://www.rfc-editor.org/rfc-index.xml";
const FETCH_TIMEOUT_MS = 90_000;

// Internet-drafts to bake into the catalogue so they're searchable + offline.
// Add draft names here; their metadata is pulled from the IETF Datatracker at
// build time (with a seed fallback when the network is unavailable). Drafts not
// listed here are still readable — the UI resolves them live on demand.
const CURATED_DRAFTS = ["draft-ietf-dkim-dkim2-spec"];
const DRAFT_API = (id) => `https://datatracker.ietf.org/api/v1/doc/document/${id}/?format=json`;

const asArray = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);

function numFromId(id) {
  const m = /^RFC0*?(\d+)$/.exec(String(id ?? "").trim());
  return m ? Number(m[1]) : null;
}

function parseIndex(xml) {
  const parser = new XMLParser({ ignoreAttributes: true, trimValues: true });
  const root = parser.parse(xml)?.["rfc-index"] ?? {};
  const rfcs = [];

  for (const e of asArray(root["rfc-entry"])) {
    const n = numFromId(e["doc-id"]);
    if (!n) continue;

    const authors = asArray(e.author)
      .map((a) => (a && typeof a === "object" ? a.name : a))
      .filter(Boolean)
      .map(String);
    const keywords = asArray(e.keywords?.kw).filter(Boolean).map(String);
    const abstract = asArray(e.abstract?.p)
      .map((p) => (p && typeof p === "object" ? "" : String(p)))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    rfcs.push({
      n,
      title: String(e.title ?? "").trim(),
      authors,
      year: Number(e.date?.year) || null,
      month: String(e.date?.month ?? "").trim(),
      status: String(e["current-status"] ?? "").trim(),
      stream: String(e.stream ?? "").trim(),
      abstract,
      keywords,
      obsoletedBy: asArray(e["obsoleted-by"]?.["doc-id"]).map(numFromId).filter(Boolean),
      updatedBy: asArray(e["updated-by"]?.["doc-id"]).map(numFromId).filter(Boolean),
    });
  }

  rfcs.sort((a, b) => b.n - a.n);
  return rfcs;
}

async function fetchIndex() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(INDEX_URL, {
      signal: ctrl.signal,
      headers: { "user-agent": "rfcreader-build (+https://github.com/meysam81/rfcreader)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function normalizeDraft(id, d) {
  const time = String(d.time ?? d.expires ?? "");
  return {
    id,
    title: String(d.title ?? id).trim(),
    authors: [],
    year: /^\d{4}/.test(time) ? Number(time.slice(0, 4)) : null,
    month: "",
    status: "INTERNET-DRAFT",
    stream: "IETF",
    abstract: String(d.abstract ?? "")
      .replace(/\s+/g, " ")
      .trim(),
    keywords: [],
    obsoletedBy: [],
    updatedBy: [],
    rev: d.rev ? String(d.rev).trim() : null,
  };
}

async function fetchDraftMeta(id) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(DRAFT_API(id), {
      signal: ctrl.signal,
      headers: { "user-agent": "rfcreader-build (+https://github.com/meysam81/rfcreader)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return normalizeDraft(id, await res.json());
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve curated drafts live, falling back per-draft to the committed seed. */
async function buildDrafts() {
  if (!CURATED_DRAFTS.length) return [];
  let seed = [];
  try {
    seed = JSON.parse(readFileSync(SEED_DRAFTS, "utf8"));
  } catch {
    /* no seed file — fine */
  }
  const seedById = new Map(seed.map((d) => [d.id, d]));

  const drafts = [];
  for (const id of CURATED_DRAFTS) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const meta = await fetchDraftMeta(id);
      drafts.push(meta);
      console.log(`rfc-index: fetched draft ${id} (rev ${meta.rev ?? "?"}) from datatracker`);
    } catch (err) {
      const fallback = seedById.get(id);
      if (fallback) {
        drafts.push(fallback);
        console.warn(`rfc-index: draft ${id} live fetch failed (${err.message}); using seed`);
      } else {
        console.warn(`rfc-index: draft ${id} unavailable (${err.message}); skipping`);
      }
    }
  }
  return drafts;
}

async function main() {
  mkdirSync(dirname(OUT), { recursive: true });

  let rfcs = [];
  let source = "live";

  try {
    rfcs = parseIndex(await fetchIndex());
    if (rfcs.length < 1000) throw new Error(`suspiciously few entries parsed (${rfcs.length})`);
    console.log(`rfc-index: fetched ${rfcs.length} RFCs from rfc-editor.org`);
  } catch (err) {
    source = "seed";
    console.warn(`rfc-index: live fetch failed (${err.message}); using seed fallback`);
    rfcs = JSON.parse(readFileSync(SEED, "utf8"));
  }

  const drafts = await buildDrafts();
  // Drafts lead the catalogue (no number to sort by); the UI orders for display.
  const entries = [...drafts, ...rfcs];

  const payload = {
    generated: new Date().toISOString(),
    source,
    count: entries.length,
    rfcs: entries,
  };
  writeFileSync(OUT, JSON.stringify(payload));
  console.log(
    `rfc-index: wrote ${entries.length} entries (${rfcs.length} RFCs + ${drafts.length} drafts) to public/rfc-index.json (source=${source})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
