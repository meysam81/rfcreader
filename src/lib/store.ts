// Tiny localStorage-backed store for bookmarks and recently-read history.
// No accounts, no network — everything lives on the device.

export interface RfcMeta {
  n: number;
  title?: string;
  authors?: string[];
  year?: number | null;
  status?: string;
  stream?: string;
}

const BOOKMARKS_KEY = "rfcreader:bookmarks";
const RECENTS_KEY = "rfcreader:recents";
const MAX_RECENTS = 30;

const isBrowser = typeof window !== "undefined" && typeof localStorage !== "undefined";

function read<T>(key: string, fallback: T): T {
  if (!isBrowser) return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  if (!isBrowser) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    // Let other islands / tabs react.
    window.dispatchEvent(new CustomEvent("rfcreader:store", { detail: { key } }));
  } catch {
    /* storage full or unavailable — ignore */
  }
}

export function getBookmarks(): RfcMeta[] {
  return read<RfcMeta[]>(BOOKMARKS_KEY, []);
}

export function isBookmarked(n: number): boolean {
  return getBookmarks().some((b) => b.n === n);
}

export function toggleBookmark(meta: RfcMeta): boolean {
  const list = getBookmarks();
  const idx = list.findIndex((b) => b.n === meta.n);
  if (idx >= 0) {
    list.splice(idx, 1);
    write(BOOKMARKS_KEY, list);
    return false;
  }
  list.unshift(meta);
  write(BOOKMARKS_KEY, list);
  return true;
}

export function getRecents(): RfcMeta[] {
  return read<RfcMeta[]>(RECENTS_KEY, []);
}

export function pushRecent(meta: RfcMeta): void {
  const list = getRecents().filter((r) => r.n !== meta.n);
  list.unshift(meta);
  write(RECENTS_KEY, list.slice(0, MAX_RECENTS));
}

export function clearRecents(): void {
  write(RECENTS_KEY, []);
}

// Pass metadata between the search list and the reader without re-loading the
// whole catalogue on a deep link.
export function cacheMeta(meta: RfcMeta): void {
  if (!isBrowser) return;
  try {
    sessionStorage.setItem(`rfcreader:meta:${meta.n}`, JSON.stringify(meta));
  } catch {
    /* ignore */
  }
}

export function readCachedMeta(n: number): RfcMeta | null {
  if (!isBrowser) return null;
  try {
    const raw = sessionStorage.getItem(`rfcreader:meta:${n}`);
    return raw ? (JSON.parse(raw) as RfcMeta) : null;
  } catch {
    return null;
  }
}
