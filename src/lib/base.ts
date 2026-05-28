// Slash-safe helpers around Astro's configured base path.
// import.meta.env.BASE_URL may or may not carry a trailing slash depending on
// config, so we normalise once and build URLs predictably.

const RAW = import.meta.env.BASE_URL;

/** Base path without a trailing slash, e.g. "/rfcreader" (or "" at root). */
export const BASE = RAW.replace(/\/+$/, "");

/** Site root with a trailing slash, e.g. "/rfcreader/". */
export const HOME = `${BASE}/`;

/** Join a path onto the base, guaranteeing exactly one separating slash. */
export function withBase(path: string): string {
  return `${BASE}/${path.replace(/^\/+/, "")}`;
}
