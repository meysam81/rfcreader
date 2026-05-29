// Reflows the canonical 72-column plain-text RFC into responsive, semantic HTML.
//
// RFCs ship hard-wrapped for a fixed-width terminal/printout, so the line breaks
// are baked into the text. Rendering them verbatim in a <pre> can never be
// responsive. Instead we parse the text into a block model and re-emit it:
//   - blank-line-separated prose is rejoined into reflowing <p> paragraphs
//   - numbered / appendix / well-known headings become real <h2>–<h4> (+ ToC)
//   - bullet / ordered lists become <ul>/<ol>
//   - genuine preformatted content (ASCII art, packet diagrams, code, tables,
//     the title/front-matter block) is kept verbatim in a scrollable <pre>
// URLs and "RFC NNNN" cross-references are linkified throughout.

import { withBase } from "@/lib/base";

export interface RfcSection {
  id: string;
  label: string;
  title: string;
  level: number;
}

export interface FormattedRfc {
  sections: RfcSection[];
  html: string;
}

const HEADING_RE = /^(\d+(?:\.\d+)*)\.?\s+(\S.*)$/;
const APPENDIX_RE = /^(Appendix\s+[A-Z][\dA-Z]*)\.?[:\s]+(\S.*)$/i;
const PAGE_FOOTER_RE = /\[Page\s+\d+\]\s*$/;
const PAGE_HEADER_RE = /^RFC\s+\d+\b.*\b(19|20)\d{2}\s*$/;

// Bullet ("o", "*", "-", "•") and ordered ("1.", "1)", "(1)", "a.") list markers.
const BULLET_RE = /^(\s*)([*+•o-])\s+(\S.*)$/;
const ORDERED_RE = /^(\s*)(\(\d+\)|\d+[.)]|[a-z][.)])\s+(\S.*)$/;

// Well-known unnumbered section titles that should read as headings.
const UNNUMBERED_RE =
  /^(Abstract|Status of This Memo|Copyright Notice|Table of Contents|Acknowledge?ments?|Contributors?|Authors?'? Addresses?|Author Information|References|Normative References|Informative References|Index|Full Copyright Statement)\b/i;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function linkify(escaped: string): string {
  // URLs first (operates on already-escaped text, so no stray angle brackets).
  let out = escaped.replace(
    /\bhttps?:\/\/[^\s<]+[^\s<.,;:)\]}'"]/g,
    (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`,
  );
  // RFC cross-references → internal reader links.
  out = out.replace(
    /\bRFC[\s-]?0*(\d{1,5})\b/g,
    (full, n) => `<a href="${withBase(`rfc/?number=${n}`)}">${full}</a>`,
  );
  return out;
}

function sectionId(label: string): string {
  return (
    "sec-" +
    label
      .replace(/[^0-9A-Za-z]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
  );
}

// A line carries column-aligned content (table/diagram) if it has an interior
// gap of 3+ spaces, or a 2-space gap that isn't ordinary sentence spacing.
function looksTabular(line: string): boolean {
  const body = line.replace(/^\s+/, "").replace(/\s+$/, "");
  const re = /(\S)( {2,})(?=\S)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    if (m[2].length >= 3) return true;
    if (!".?!:,;".includes(m[1])) return true;
  }
  return false;
}

// Box-drawing characters, rules, and ASCII-art glyphs.
function looksDrawing(line: string): boolean {
  return (
    /[┌┐└┘├┤┬┴┼─│╔╗╚╝═║╬╠╣╦╩]/.test(line) ||
    /[-=_*]{4,}/.test(line) ||
    /[|+].*[|+]/.test(line) ||
    /\+[-+]{2,}/.test(line)
  );
}

function isPreBlock(lines: string[]): boolean {
  let signal = 0;
  for (const l of lines) {
    if (looksDrawing(l) || looksTabular(l)) signal += 1;
  }
  // Any drawing/alignment in a short block, or a sustained share in a long one.
  if (lines.length <= 2) return signal > 0;
  return signal / lines.length >= 0.4;
}

function listKind(block: string[]): "ul" | "ol" | null {
  if (BULLET_RE.test(block[0])) return "ul";
  if (ORDERED_RE.test(block[0])) return "ol";
  return null;
}

// Strip the common leading indentation so preformatted blocks don't sit far
// to the right, while keeping their internal relative alignment intact.
function dedent(lines: string[]): string[] {
  let min = Infinity;
  for (const l of lines) {
    if (l.trim() === "") continue;
    min = Math.min(min, l.length - l.replace(/^ +/, "").length);
  }
  if (!Number.isFinite(min) || min === 0) return lines;
  return lines.map((l) => l.slice(min));
}

function renderListItems(block: string[], kind: "ul" | "ol"): string {
  const marker = kind === "ul" ? BULLET_RE : ORDERED_RE;
  const items: string[] = [];
  for (const line of block) {
    const m = marker.exec(line);
    if (m) {
      items.push(m[3].trim());
    } else if (items.length) {
      items[items.length - 1] += " " + line.trim();
    } else {
      items.push(line.trim());
    }
  }
  return items.map((t) => `<li>${linkify(escapeHtml(t.replace(/\s+/g, " ")))}</li>`).join("");
}

export function formatRfc(raw: string): FormattedRfc {
  const sourceLines = raw.replace(/\r\n?/g, "\n").replace(/\f/g, "\n").split("\n");

  // Pass 1: drop pagination noise and trailing whitespace.
  const cleaned: string[] = [];
  for (const line of sourceLines) {
    if (PAGE_FOOTER_RE.test(line)) continue;
    if (line.length > 40 && PAGE_HEADER_RE.test(line)) continue;
    cleaned.push(line.replace(/\s+$/, ""));
  }

  // Pass 2: group into blank-line-separated blocks and re-emit as semantic HTML.
  const sections: RfcSection[] = [];
  const out: string[] = [];
  const seen = new Set<string>();

  function pushHeading(label: string, title: string, level: number, inToc: boolean) {
    let id = sectionId(label || title);
    while (seen.has(id)) id += "x";
    seen.add(id);
    if (inToc) sections.push({ id, label, title, level });
    const tag = `h${Math.min(level + 1, 6)}`;
    const num = label ? `<span class="rfc-h-num">${escapeHtml(label)}</span> ` : "";
    out.push(`<${tag} class="rfc-h" id="${id}">${num}${linkify(escapeHtml(title))}</${tag}>`);
  }

  let i = 0;
  while (i < cleaned.length) {
    if (cleaned[i].trim() === "") {
      i += 1;
      continue;
    }

    const block: string[] = [];
    while (i < cleaned.length && cleaned[i].trim() !== "") {
      block.push(cleaned[i]);
      i += 1;
    }

    // Headings: a single flush-left line.
    if (block.length === 1 && /^\S/.test(block[0])) {
      const line = block[0];
      const match = HEADING_RE.exec(line) ?? APPENDIX_RE.exec(line);
      if (match) {
        const label = match[1];
        const level = /^appendix/i.test(label) ? 1 : (label.match(/\./g)?.length ?? 0) + 1;
        pushHeading(label, match[2].trim(), level, true);
        continue;
      }
      if (UNNUMBERED_RE.test(line) && line.length <= 60) {
        pushHeading("", line.trim(), 1, false);
        continue;
      }
    }

    // Lists (checked before preformatted: bullet markers can look tabular).
    const kind = listKind(block);
    if (kind) {
      const itemsHtml = renderListItems(block, kind);
      const last = out[out.length - 1];
      const closeTag = `</${kind}>`;
      if (last && last.startsWith(`<${kind} `) && last.endsWith(closeTag)) {
        out[out.length - 1] = last.slice(0, -closeTag.length) + itemsHtml + closeTag;
      } else {
        out.push(`<${kind} class="rfc-list">${itemsHtml}${closeTag}`);
      }
      continue;
    }

    // Preformatted: ASCII art, diagrams, tables, code, front matter.
    if (isPreBlock(block)) {
      const body = dedent(block)
        .map((l) => linkify(escapeHtml(l)))
        .join("\n");
      out.push(`<pre class="rfc-pre">${body}</pre>`);
      continue;
    }

    // Default: reflow the hard-wrapped lines into a single paragraph.
    const text = block
      .map((l) => l.trim())
      .join(" ")
      .replace(/\s+/g, " ");
    out.push(`<p>${linkify(escapeHtml(text))}</p>`);
  }

  return { sections, html: out.join("\n") };
}
