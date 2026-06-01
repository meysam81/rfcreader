<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, type Ref } from "vue";
import MiniSearch from "minisearch";

import { withBase } from "@/lib/base";
import { isDraftId, resolveDraft } from "@/lib/rfc-sources";
import {
  cacheMeta,
  getBookmarks,
  getRecents,
  metaKey,
  pushRecent,
  type RfcMeta,
} from "@/lib/store";

interface Rfc {
  // RFCs carry a number; internet-drafts carry an `id` (and optional `rev`).
  n?: number;
  id?: string;
  rev?: string | null;
  title: string;
  authors: string[];
  year: number | null;
  month: string;
  status: string;
  stream: string;
  abstract: string;
  keywords: string[];
  obsoletedBy: number[];
  updatedBy: number[];
}

/** Stable string identity for a catalogue entry: draft name, else RFC number. */
const keyOf = (r: Rfc): string => r.id ?? String(r.n);
// Numeric sort key; drafts have no number, so they sort to the end.
const num = (r: Rfc): number => r.n ?? -Infinity;

const PAGE_SIZE = 40;

const STATUS_ORDER = [
  "INTERNET STANDARD",
  "PROPOSED STANDARD",
  "DRAFT STANDARD",
  "BEST CURRENT PRACTICE",
  "INFORMATIONAL",
  "EXPERIMENTAL",
  "HISTORIC",
  "UNKNOWN",
];

const loading = ref(true);
const error = ref("");
const total = ref(0);

const query = ref("");
const sort = ref<"relevance" | "number-desc" | "number-asc" | "newest">("relevance");
const selectedStatuses = ref<Set<string>>(new Set());
const selectedStreams = ref<Set<string>>(new Set());
const excludeObsoleted = ref(false);
const showFilters = ref(false);
const limit = ref(PAGE_SIZE);

const bookmarks = ref<RfcMeta[]>([]);
const recents = ref<RfcMeta[]>([]);

const byKey = new Map<string, Rfc>();
let mini: MiniSearch | null = null;

const statusOptions = ref<string[]>([]);
const streamOptions = ref<string[]>([]);

const debouncedQuery = ref("");
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
watch(query, (q) => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debouncedQuery.value = q;
    limit.value = PAGE_SIZE;
    const url = new URL(window.location.href);
    if (q.trim()) url.searchParams.set("q", q.trim());
    else url.searchParams.delete("q");
    history.replaceState(null, "", url);
  }, 180);
});

function refreshLists() {
  bookmarks.value = getBookmarks();
  recents.value = getRecents();
}

function onStoreChange() {
  refreshLists();
}

onMounted(async () => {
  refreshLists();
  window.addEventListener("rfcreader:store", onStoreChange);
  const initial = new URL(window.location.href).searchParams.get("q");
  if (initial) {
    query.value = initial;
    debouncedQuery.value = initial;
  }

  try {
    const res = await fetch(withBase("rfc-index.json"), { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { generated: string; count: number; rfcs: Rfc[] };
    total.value = data.count;

    const statuses = new Set<string>();
    const streams = new Set<string>();
    const docs = data.rfcs.map((r) => {
      const key = keyOf(r);
      byKey.set(key, r);
      if (r.status) statuses.add(r.status);
      if (r.stream) streams.add(r.stream);
      return {
        key,
        // Draft names are searchable; RFC numbers stay the strongest signal.
        num: r.id ?? String(r.n),
        title: r.title,
        abstract: r.abstract,
        authorsText: r.authors.join(" "),
        keywordsText: r.keywords.join(" "),
      };
    });

    statusOptions.value = [...statuses].toSorted(
      (a, b) => (STATUS_ORDER.indexOf(a) + 1 || 99) - (STATUS_ORDER.indexOf(b) + 1 || 99),
    );
    streamOptions.value = [...streams].toSorted();

    mini = new MiniSearch({
      idField: "key",
      fields: ["num", "title", "abstract", "authorsText", "keywordsText"],
      searchOptions: {
        prefix: true,
        fuzzy: 0.2,
        combineWith: "AND",
        boost: { num: 6, title: 3 },
      },
    });
    // Index asynchronously in chunks so the main thread stays responsive —
    // the search box remains focusable and typeable while the catalogue indexes.
    await mini.addAllAsync(docs, { chunkSize: 500 });
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to load the RFC catalogue.";
  } finally {
    loading.value = false;
  }
});

onUnmounted(() => {
  window.removeEventListener("rfcreader:store", onStoreChange);
  clearTimeout(debounceTimer);
});

const hasFilters = computed(
  () => selectedStatuses.value.size > 0 || selectedStreams.value.size > 0 || excludeObsoleted.value,
);

const isBrowsing = computed(() => !debouncedQuery.value.trim() && !hasFilters.value);

function passesFilters(r: Rfc): boolean {
  if (selectedStatuses.value.size && !selectedStatuses.value.has(r.status)) return false;
  if (selectedStreams.value.size && !selectedStreams.value.has(r.stream)) return false;
  if (excludeObsoleted.value && r.obsoletedBy.length > 0) return false;
  return true;
}

const results = computed<Rfc[]>(() => {
  if (loading.value || error.value) return [];
  const q = debouncedQuery.value.trim();

  let list: Rfc[];
  if (mini && q) {
    const ordered = mini
      .search(q)
      .map((hit) => byKey.get(String(hit.id)))
      .filter((r): r is Rfc => Boolean(r));
    // Exact number / draft-name queries: float the precise match to the top.
    if (/^\d+$/.test(q) || isDraftId(q)) {
      const exact = byKey.get(q);
      if (exact && !ordered.some((r) => keyOf(r) === keyOf(exact))) ordered.unshift(exact);
      else if (exact) {
        const i = ordered.findIndex((r) => keyOf(r) === keyOf(exact));
        if (i > 0) ordered.splice(0, 0, ordered.splice(i, 1)[0]);
      }
    }
    list = ordered;
  } else {
    list = [...byKey.values()];
  }

  list = list.filter(passesFilters);

  // Numeric sorts are RFC-centric; drafts (no number) sort to the end.
  const relevanceMatters = Boolean(mini && q);
  switch (sort.value) {
    case "number-desc":
      list.sort((a, b) => num(b) - num(a));
      break;
    case "number-asc":
      list.sort((a, b) => num(a) - num(b));
      break;
    case "newest":
      list.sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || num(b) - num(a));
      break;
    default:
      if (!relevanceMatters) list.sort((a, b) => num(b) - num(a));
  }
  return list;
});

const visible = computed(() => results.value.slice(0, limit.value));

// Runtime fallback: a draft-shaped query with no catalogue match is resolved
// live against the Datatracker, so uncurated drafts stay readable. A miss leaves
// `probedDraft` null and the view falls through to the empty state.
const probedDraft = ref<Rfc | null>(null);
const probing = ref(false);
let probeToken = 0;

watch(debouncedQuery, (raw) => {
  const q = raw.trim();
  const token = ++probeToken;
  probedDraft.value = null;
  if (loading.value || !isDraftId(q) || byKey.has(q) || results.value.length > 0) {
    probing.value = false;
    return;
  }
  probing.value = true;
  resolveDraft(q)
    .then((info) => {
      if (token !== probeToken) return; // a newer query superseded this probe
      probedDraft.value = info
        ? {
            id: info.id,
            rev: info.rev,
            title: info.title,
            authors: [],
            year: info.year,
            month: "",
            status: info.status,
            stream: "",
            abstract: info.abstract,
            keywords: [],
            obsoletedBy: [],
            updatedBy: [],
          }
        : null;
    })
    .catch(() => {
      if (token === probeToken) probedDraft.value = null;
    })
    .finally(() => {
      if (token === probeToken) probing.value = false;
    });
});

function toggleSet(set: Ref<Set<string>>, value: string) {
  const next = new Set(set.value);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  set.value = next;
  limit.value = PAGE_SIZE;
}

function clearFilters() {
  selectedStatuses.value = new Set();
  selectedStreams.value = new Set();
  excludeObsoleted.value = false;
}

function readerHref(d: { n?: number; id?: string }): string {
  return d.id ? withBase(`rfc/?id=${encodeURIComponent(d.id)}`) : withBase(`rfc/?number=${d.n}`);
}

/** Display label: the draft name for drafts, "RFC NNNN" otherwise. */
function label(d: { n?: number; id?: string }): string {
  return d.id ?? `RFC ${d.n}`;
}

function open(r: Rfc | RfcMeta) {
  const meta: RfcMeta = {
    n: r.n,
    id: "id" in r ? r.id : undefined,
    rev: "rev" in r ? r.rev : undefined,
    title: r.title,
    authors: "authors" in r ? r.authors : undefined,
    year: "year" in r ? r.year : undefined,
    status: "status" in r ? r.status : undefined,
    stream: "stream" in r ? r.stream : undefined,
  };
  cacheMeta(meta);
  pushRecent(meta);
}

function statusTone(status: string): string {
  if (status.includes("STANDARD") && !status.includes("DRAFT")) return "text-emerald-500";
  if (status.includes("DRAFT") || status.includes("PROPOSED")) return "text-sky-500";
  if (status.includes("BEST CURRENT")) return "text-teal-500";
  if (status === "HISTORIC") return "text-amber-500";
  if (status === "EXPERIMENTAL") return "text-violet-500";
  return "text-muted";
}
</script>

<template>
  <div>
    <!-- Search box -->
    <div role="search">
      <label for="rfc-q" class="sr-only">Search RFCs by number, title, keyword, or author</label>
      <div class="relative">
        <svg
          class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          id="rfc-q"
          v-model="query"
          type="search"
          inputmode="search"
          autocomplete="off"
          enterkeyhint="search"
          :disabled="!!error"
          :placeholder="
            loading
              ? 'Loading RFCs… start typing, results appear when ready'
              : 'Search 9000+ RFCs — try “HTTP”, “TLS 1.3”, or “2616”'
          "
          class="w-full rounded-xl border border-border bg-surface py-3 pl-10 pr-3 text-base text-fg placeholder:text-muted focus:border-accent disabled:opacity-60"
        />
      </div>

      <div class="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-fg hover:bg-elevated"
          :aria-expanded="showFilters"
          aria-controls="rfc-filters"
          @click="showFilters = !showFilters"
        >
          Filters
          <span
            v-if="hasFilters"
            class="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-semibold text-accent-fg"
            >{{ selectedStatuses.size + selectedStreams.size + (excludeObsoleted ? 1 : 0) }}</span
          >
        </button>

        <label class="ml-auto flex items-center gap-2 text-sm text-muted">
          <span class="sr-only sm:not-sr-only">Sort</span>
          <select
            v-model="sort"
            class="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm text-fg"
            aria-label="Sort results"
          >
            <option value="relevance">Relevance</option>
            <option value="number-desc">Number ↓ (newest #)</option>
            <option value="number-asc">Number ↑ (oldest #)</option>
            <option value="newest">Year published</option>
          </select>
        </label>
      </div>

      <!-- Filter panel -->
      <div
        v-show="showFilters"
        id="rfc-filters"
        class="mt-3 space-y-4 rounded-xl border border-border bg-surface p-4"
      >
        <fieldset>
          <legend class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Status
          </legend>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="s in statusOptions"
              :key="s"
              type="button"
              class="rounded-full border px-3 py-1 text-xs transition-colors"
              :class="
                selectedStatuses.has(s)
                  ? 'border-accent bg-accent text-accent-fg'
                  : 'border-border bg-elevated text-fg hover:border-accent'
              "
              :aria-pressed="selectedStatuses.has(s)"
              @click="toggleSet(selectedStatuses, s)"
            >
              {{ s.toLowerCase() }}
            </button>
          </div>
        </fieldset>

        <fieldset v-if="streamOptions.length">
          <legend class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Stream
          </legend>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="s in streamOptions"
              :key="s"
              type="button"
              class="rounded-full border px-3 py-1 text-xs transition-colors"
              :class="
                selectedStreams.has(s)
                  ? 'border-accent bg-accent text-accent-fg'
                  : 'border-border bg-elevated text-fg hover:border-accent'
              "
              :aria-pressed="selectedStreams.has(s)"
              @click="toggleSet(selectedStreams, s)"
            >
              {{ s }}
            </button>
          </div>
        </fieldset>

        <div class="flex flex-wrap items-center justify-between gap-3">
          <label class="flex items-center gap-2 text-sm text-fg">
            <input
              v-model="excludeObsoleted"
              type="checkbox"
              class="h-4 w-4 accent-[var(--color-accent)]"
            />
            Hide obsoleted RFCs
          </label>
          <button
            v-if="hasFilters"
            type="button"
            class="text-sm text-accent underline underline-offset-2"
            @click="clearFilters"
          >
            Clear filters
          </button>
        </div>
      </div>
    </div>

    <!-- States -->
    <p v-if="loading" class="mt-8 text-center text-muted" role="status">
      Loading the RFC catalogue… you can start typing now — results appear the moment it’s ready.
    </p>
    <div
      v-else-if="error"
      class="mt-8 rounded-xl border border-border bg-surface p-4 text-fg"
      role="alert"
    >
      <p class="font-medium">Couldn’t load the catalogue.</p>
      <p class="mt-1 text-sm text-muted">{{ error }}</p>
    </div>

    <!-- Browse view: bookmarks + recents -->
    <div v-else-if="isBrowsing" class="mt-8 space-y-8">
      <section v-if="bookmarks.length" aria-labelledby="bm-h">
        <h2 id="bm-h" class="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          Bookmarks
        </h2>
        <ul class="space-y-2">
          <li v-for="b in bookmarks" :key="metaKey(b)">
            <a
              :href="readerHref(b)"
              class="block rounded-lg border border-border bg-surface px-4 py-3 hover:border-accent"
              @click="open(b)"
            >
              <span class="font-mono text-sm text-accent">{{ label(b) }}</span>
              <span class="ml-2 text-fg">{{ b.title }}</span>
            </a>
          </li>
        </ul>
      </section>

      <section v-if="recents.length" aria-labelledby="rc-h">
        <h2 id="rc-h" class="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          Recently read
        </h2>
        <ul class="space-y-2">
          <li v-for="r in recents" :key="metaKey(r)">
            <a
              :href="readerHref(r)"
              class="block rounded-lg border border-border bg-surface px-4 py-3 hover:border-accent"
              @click="open(r)"
            >
              <span class="font-mono text-sm text-accent">{{ label(r) }}</span>
              <span class="ml-2 text-fg">{{ r.title }}</span>
            </a>
          </li>
        </ul>
      </section>

      <p v-if="!bookmarks.length && !recents.length" class="text-center text-muted">
        Start typing to search {{ total.toLocaleString() }} RFCs. Bookmarks and recently-read
        documents will show up here.
      </p>
    </div>

    <!-- Results view -->
    <div v-else class="mt-6">
      <p class="mb-3 text-sm text-muted" aria-live="polite">
        {{ results.length.toLocaleString() }}
        {{ results.length === 1 ? "result" : "results" }}
      </p>
      <ul class="space-y-3">
        <li v-for="r in visible" :key="keyOf(r)">
          <a
            :href="readerHref(r)"
            class="block rounded-xl border border-border bg-surface p-4 transition-colors hover:border-accent"
            @click="open(r)"
          >
            <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span class="break-all font-mono text-sm font-semibold text-accent">{{
                label(r)
              }}</span>
              <span v-if="r.status" class="text-xs" :class="statusTone(r.status)">{{
                r.status.toLowerCase()
              }}</span>
              <span v-if="r.year" class="text-xs text-muted">{{ r.year }}</span>
              <span
                v-if="r.obsoletedBy.length"
                class="rounded bg-elevated px-1.5 py-0.5 text-[11px] text-muted"
                >obsoleted</span
              >
            </div>
            <h3 class="mt-1 font-medium text-fg">{{ r.title }}</h3>
            <p v-if="r.authors.length" class="mt-0.5 text-xs text-muted">
              {{ r.authors.slice(0, 4).join(", ") }}{{ r.authors.length > 4 ? ", et al." : "" }}
            </p>
            <p v-if="r.abstract" class="mt-2 line-clamp-2 text-sm text-muted">{{ r.abstract }}</p>
          </a>
        </li>
      </ul>

      <template v-if="!results.length">
        <!-- Runtime-resolved internet-draft (not in the baked catalogue). -->
        <a
          v-if="probedDraft"
          :href="readerHref(probedDraft)"
          class="mt-6 block rounded-xl border border-border bg-surface p-4 transition-colors hover:border-accent"
          @click="open(probedDraft)"
        >
          <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span class="break-all font-mono text-sm font-semibold text-accent">{{
              probedDraft.id
            }}</span>
            <span class="text-xs text-sky-500">internet-draft</span>
            <span v-if="probedDraft.rev" class="text-xs text-muted">rev {{ probedDraft.rev }}</span>
          </div>
          <h3 class="mt-1 font-medium text-fg">{{ probedDraft.title }}</h3>
          <p v-if="probedDraft.abstract" class="mt-2 line-clamp-2 text-sm text-muted">
            {{ probedDraft.abstract }}
          </p>
        </a>
        <p v-else-if="probing" class="mt-8 text-center text-muted" role="status">
          Looking up internet-draft…
        </p>
        <p v-else class="mt-8 text-center text-muted">No RFCs match your search.</p>
      </template>

      <div v-if="visible.length < results.length" class="mt-6 text-center">
        <button
          type="button"
          class="rounded-lg border border-border bg-surface px-4 py-2 text-sm text-fg hover:bg-elevated"
          @click="limit += PAGE_SIZE"
        >
          Show more ({{ (results.length - visible.length).toLocaleString() }} remaining)
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
