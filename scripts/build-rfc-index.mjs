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
const INDEX_URL = "https://www.rfc-editor.org/rfc-index.xml";
const FETCH_TIMEOUT_MS = 90_000;

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

  const payload = { generated: new Date().toISOString(), source, count: rfcs.length, rfcs };
  writeFileSync(OUT, JSON.stringify(payload));
  console.log(
    `rfc-index: wrote ${rfcs.length} entries to public/rfc-index.json (source=${source})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
