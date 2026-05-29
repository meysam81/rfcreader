// Turns the canonical plain-text RFC into accessible, navigable HTML:
//  - strips pagination headers/footers and form feeds
//  - detects numbered section headings to build a table of contents
//  - linkifies URLs and "RFC NNNN" cross-references
// ASCII art / alignment is preserved via white-space: pre-wrap on .rfc-body.

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
const APPENDIX_RE = /^(Appendix\s+[A-Z][\dA-Z]*)\.?\s+(\S.*)$/i;
const PAGE_FOOTER_RE = /\[Page\s+\d+\]\s*$/;
const PAGE_HEADER_RE = /^RFC\s+\d+\b.*\b(19|20)\d{2}\s*$/;

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

export function formatRfc(raw: string): FormattedRfc {
  const sourceLines = raw.replace(/\r\n?/g, "\n").replace(/\f/g, "\n").split("\n");

  // Pass 1: drop pagination noise.
  const cleaned: string[] = [];
  for (const line of sourceLines) {
    if (PAGE_FOOTER_RE.test(line)) continue;
    if (line.length > 40 && PAGE_HEADER_RE.test(line)) continue;
    cleaned.push(line.replace(/\s+$/, ""));
  }

  // Pass 2: collapse runs of blank lines, build TOC + HTML.
  const sections: RfcSection[] = [];
  const out: string[] = [];
  const seen = new Set<string>();
  let blankRun = 0;

  for (const line of cleaned) {
    if (line.trim() === "") {
      blankRun += 1;
      if (blankRun > 2) continue;
      out.push("");
      continue;
    }
    blankRun = 0;

    const isFlush = /^\S/.test(line);
    const match = isFlush ? (HEADING_RE.exec(line) ?? APPENDIX_RE.exec(line)) : null;

    if (match) {
      const label = match[1];
      let id = sectionId(label);
      while (seen.has(id)) id += "x";
      seen.add(id);
      const level = label.startsWith("Appendix") ? 1 : (label.match(/\./g)?.length ?? 0) + 1;
      sections.push({ id, label, title: match[2].trim(), level });
      out.push(`<span class="rfc-h" id="${id}">${linkify(escapeHtml(line))}</span>`);
    } else {
      out.push(linkify(escapeHtml(line)));
    }
  }

  return { sections, html: out.join("\n") };
}
