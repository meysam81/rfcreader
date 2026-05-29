<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";

import { HOME } from "@/lib/base";
import { externalLinks, fetchRfcText } from "@/lib/rfc-sources";
import { formatRfc, type RfcSection } from "@/lib/rfc-text";
import {
  isBookmarked,
  pushRecent,
  readCachedMeta,
  toggleBookmark,
  type RfcMeta,
} from "@/lib/store";

const FONT_STEPS = [0.9, 1.0, 1.1, 1.25, 1.4, 1.6];

const number = ref<number | null>(null);
const meta = ref<RfcMeta | null>(null);
const loading = ref(true);
const error = ref("");
const sourceLabel = ref("");
const bodyHtml = ref("");
const sections = ref<RfcSection[]>([]);
const bookmarked = ref(false);
const showToc = ref(false);
const fontIndex = ref(2);
const activeId = ref("");
const progress = ref(0);
const tocNav = ref<HTMLElement | null>(null);

const links = computed(() => (number.value ? externalLinks(number.value) : []));
const fontSize = computed(() => `${FONT_STEPS[fontIndex.value]}rem`);
const title = computed(() => meta.value?.title ?? (number.value ? `RFC ${number.value}` : "RFC"));

function setFont(delta: number) {
  fontIndex.value = Math.min(FONT_STEPS.length - 1, Math.max(0, fontIndex.value + delta));
  try {
    localStorage.setItem("rfcreader:fontIndex", String(fontIndex.value));
  } catch {
    /* ignore */
  }
}

function onToggleBookmark() {
  if (!number.value) return;
  bookmarked.value = toggleBookmark(meta.value ?? { n: number.value, title: title.value });
}

function jumpTo(id: string) {
  showToc.value = false;
  activeId.value = id;
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Track reading progress and the section currently under the toolbar so the
// table of contents can highlight where the reader is.
let ticking = false;
function updateOnScroll() {
  const doc = document.documentElement;
  const scrollable = doc.scrollHeight - window.innerHeight;
  progress.value =
    scrollable > 0 ? Math.min(100, Math.max(0, (window.scrollY / scrollable) * 100)) : 0;

  // The active heading is the last one whose top sits above the sticky chrome.
  const threshold = 140;
  let current = "";
  for (const s of sections.value) {
    const el = document.getElementById(s.id);
    if (!el) continue;
    if (el.getBoundingClientRect().top <= threshold) current = s.id;
    else break; // headings are in document order, so we can stop early.
  }
  activeId.value = current || sections.value[0]?.id || "";
}

function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    updateOnScroll();
    ticking = false;
  });
}

// Keep the active entry visible inside the (independently scrolling) ToC rail,
// without nudging the page itself.
watch(activeId, async (id) => {
  if (!id) return;
  await nextTick();
  const nav = tocNav.value;
  if (!nav) return;
  const btn = nav.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
  if (!btn) return;
  const navRect = nav.getBoundingClientRect();
  const btnRect = btn.getBoundingClientRect();
  if (btnRect.top < navRect.top || btnRect.bottom > navRect.bottom) {
    const target = btn.offsetTop - nav.clientHeight / 2 + btn.clientHeight / 2;
    nav.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  }
});

onMounted(async () => {
  try {
    const saved = Number(localStorage.getItem("rfcreader:fontIndex"));
    if (Number.isInteger(saved) && saved >= 0 && saved < FONT_STEPS.length) fontIndex.value = saved;
  } catch {
    /* ignore */
  }

  const params = new URLSearchParams(window.location.search);
  const n = Number(params.get("number"));
  if (!Number.isInteger(n) || n <= 0) {
    error.value = "No RFC number was provided.";
    loading.value = false;
    return;
  }
  number.value = n;
  meta.value = readCachedMeta(n);
  bookmarked.value = isBookmarked(n);
  document.title = `${meta.value?.title ? `RFC ${n}: ${meta.value.title}` : `RFC ${n}`} · RFC Reader`;

  try {
    const { text, source } = await fetchRfcText(n);
    const formatted = formatRfc(text);
    bodyHtml.value = formatted.html;
    sections.value = formatted.sections;
    sourceLabel.value = source;
    pushRecent(meta.value ?? { n, title: title.value });

    await nextTick();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    updateOnScroll();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to load this RFC.";
  } finally {
    loading.value = false;
  }
});

onUnmounted(() => {
  window.removeEventListener("scroll", onScroll);
  window.removeEventListener("resize", onScroll);
});
</script>

<template>
  <div class="w-full">
    <!-- Sticky toolbar: back, text size, save — always reachable while reading. -->
    <div class="sticky top-14 z-10 -mx-4 mb-6 border-b border-border bg-bg/85 px-4 backdrop-blur">
      <div class="flex flex-wrap items-center gap-3 py-3">
        <a
          :href="HOME"
          class="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-elevated"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
          Search
        </a>

        <div class="ml-auto flex items-center gap-2">
          <div
            class="flex items-center overflow-hidden rounded-lg border border-border bg-surface"
            role="group"
            aria-label="Text size"
          >
            <button
              type="button"
              class="px-2.5 py-1.5 text-sm text-fg transition-colors hover:bg-elevated disabled:opacity-40"
              :disabled="fontIndex === 0"
              aria-label="Decrease text size"
              @click="setFont(-1)"
            >
              A−
            </button>
            <span class="h-5 w-px bg-border" aria-hidden="true"></span>
            <button
              type="button"
              class="px-2.5 py-1.5 text-base text-fg transition-colors hover:bg-elevated disabled:opacity-40"
              :disabled="fontIndex === FONT_STEPS.length - 1"
              aria-label="Increase text size"
              @click="setFont(1)"
            >
              A+
            </button>
          </div>

          <button
            type="button"
            class="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors"
            :class="
              bookmarked
                ? 'border-accent bg-accent text-accent-fg'
                : 'border-border bg-surface text-fg hover:bg-elevated'
            "
            :aria-pressed="bookmarked"
            @click="onToggleBookmark"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              :fill="bookmarked ? 'currentColor' : 'none'"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
            <span>{{ bookmarked ? "Saved" : "Save" }}</span>
          </button>
        </div>
      </div>
      <!-- Reading-progress indicator sits on the toolbar's bottom edge. -->
      <div
        class="absolute bottom-0 left-0 h-0.5 bg-accent transition-[width] duration-150 ease-out"
        :style="{ width: `${progress}%` }"
        role="progressbar"
        aria-label="Reading progress"
        :aria-valuenow="Math.round(progress)"
        aria-valuemin="0"
        aria-valuemax="100"
      ></div>
    </div>

    <!-- Title block -->
    <header v-if="number" class="mb-8 border-b border-border pb-6">
      <p class="font-mono text-sm font-semibold text-accent">RFC {{ number }}</p>
      <h1 class="mt-2 text-3xl font-bold leading-tight tracking-tight text-fg sm:text-4xl">
        {{ title }}
      </h1>
      <p v-if="meta?.authors?.length" class="mt-3 text-sm text-muted">
        {{ meta.authors.join(", ") }}
      </p>
      <!-- Compact meta pills; on very wide screens this moves to the details rail. -->
      <div class="mt-4 flex flex-wrap items-center gap-2 text-xs xl:hidden">
        <span
          v-if="meta?.status"
          class="rounded-full border border-border bg-surface px-2.5 py-1 font-medium text-muted"
        >
          {{ meta.status.toLowerCase() }}
        </span>
        <span
          v-if="meta?.year"
          class="rounded-full border border-border bg-surface px-2.5 py-1 font-medium text-muted"
        >
          {{ meta.year }}
        </span>
        <span v-if="sourceLabel" class="px-1 text-muted">via {{ sourceLabel }}</span>
      </div>
    </header>

    <!-- Loading skeleton -->
    <div v-if="loading" class="animate-pulse space-y-4 py-6" role="status" aria-live="polite">
      <span class="sr-only">Fetching RFC {{ number }}…</span>
      <div class="h-4 w-3/4 rounded bg-surface"></div>
      <div class="h-4 w-full rounded bg-surface"></div>
      <div class="h-4 w-5/6 rounded bg-surface"></div>
      <div class="h-4 w-full rounded bg-surface"></div>
      <div class="h-32 w-full rounded-lg bg-surface"></div>
      <div class="h-4 w-2/3 rounded bg-surface"></div>
      <div class="h-4 w-full rounded bg-surface"></div>
    </div>

    <!-- Error / fallback -->
    <div v-else-if="error" class="rounded-xl border border-border bg-surface p-5" role="alert">
      <p class="font-medium text-fg">Couldn’t load this RFC in the app.</p>
      <p class="mt-1 text-sm text-muted">{{ error }}</p>
      <p v-if="number" class="mt-4 text-sm text-fg">Read it on an official source instead:</p>
      <ul v-if="number" class="mt-2 flex flex-wrap gap-2">
        <li v-for="l in links" :key="l.href">
          <a
            :href="l.href"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-block rounded-lg border border-border bg-elevated px-3 py-1.5 text-sm text-accent hover:border-accent"
          >
            {{ l.label }} ↗
          </a>
        </li>
      </ul>
    </div>

    <!-- Document: details rail (xl) · content · table of contents (lg+) -->
    <div
      v-else
      class="lg:grid lg:grid-cols-[minmax(0,1fr)_16rem] lg:gap-12 xl:grid-cols-[14rem_minmax(0,1fr)_16rem]"
    >
      <!-- Details rail (very wide screens only) -->
      <aside class="order-first mb-10 hidden xl:block">
        <div class="sticky top-28 space-y-6">
          <div v-if="meta?.status || meta?.year || sourceLabel">
            <p class="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Details</p>
            <dl class="space-y-2 text-sm">
              <div v-if="meta?.status" class="flex items-baseline justify-between gap-3">
                <dt class="text-muted">Status</dt>
                <dd class="text-right text-fg">{{ meta.status.toLowerCase() }}</dd>
              </div>
              <div v-if="meta?.year" class="flex items-baseline justify-between gap-3">
                <dt class="text-muted">Published</dt>
                <dd class="text-right text-fg">{{ meta.year }}</dd>
              </div>
              <div v-if="sourceLabel" class="flex items-baseline justify-between gap-3">
                <dt class="text-muted">Source</dt>
                <dd class="text-right text-fg">{{ sourceLabel }}</dd>
              </div>
            </dl>
          </div>
          <div v-if="links.length" class="border-t border-border pt-6">
            <p class="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
              Read on source
            </p>
            <ul class="space-y-1.5">
              <li v-for="l in links" :key="l.href">
                <a
                  :href="l.href"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-sm text-accent hover:underline"
                >
                  {{ l.label }} ↗
                </a>
              </li>
            </ul>
          </div>
        </div>
      </aside>

      <article aria-label="RFC document" class="min-w-0">
        <div class="rfc-body" :style="{ '--rfc-fs': fontSize }" v-html="bodyHtml"></div>

        <!-- Source links live in the details rail on very wide screens. -->
        <footer class="mt-12 border-t border-border pt-6 xl:hidden">
          <p class="text-sm font-medium text-muted">Read on the source</p>
          <ul class="mt-3 flex flex-wrap gap-2">
            <li v-for="l in links" :key="l.href">
              <a
                :href="l.href"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-block rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-accent transition-colors hover:border-accent"
              >
                {{ l.label }} ↗
              </a>
            </li>
          </ul>
        </footer>
      </article>

      <!-- Table of contents (sidebar on desktop) -->
      <aside v-if="sections.length" class="mt-12 hidden lg:mt-0 lg:block">
        <nav
          ref="tocNav"
          aria-label="Table of contents"
          class="sticky top-28 max-h-[calc(100vh-8rem)] overflow-y-auto pb-6"
        >
          <p class="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">On this page</p>
          <ul class="border-l border-border">
            <li
              v-for="s in sections"
              :key="s.id"
              :style="{ paddingLeft: `${(s.level - 1) * 0.75}rem` }"
            >
              <button
                type="button"
                :data-id="s.id"
                class="-ml-px block w-full truncate border-l-2 py-1 pl-3 text-left text-sm transition-colors"
                :class="
                  activeId === s.id
                    ? 'border-accent font-medium text-accent'
                    : 'border-transparent text-muted hover:border-border hover:text-fg'
                "
                :title="`${s.label} ${s.title}`"
                @click="jumpTo(s.id)"
              >
                <span class="font-mono text-xs opacity-70">{{ s.label }}</span> {{ s.title }}
              </button>
            </li>
          </ul>
        </nav>
      </aside>
    </div>

    <!-- Floating ToC button (mobile) -->
    <button
      v-if="!loading && !error && sections.length"
      type="button"
      class="fixed bottom-5 right-5 z-30 inline-flex h-12 w-12 items-center justify-center rounded-full border border-border bg-accent text-accent-fg shadow-lg lg:hidden"
      aria-label="Open table of contents"
      @click="showToc = true"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
      </svg>
    </button>

    <!-- ToC drawer (mobile) -->
    <div
      v-if="showToc"
      class="fixed inset-0 z-40 lg:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Table of contents"
    >
      <div class="absolute inset-0 bg-black/50" @click="showToc = false"></div>
      <nav
        class="absolute bottom-0 left-0 right-0 max-h-[75vh] overflow-y-auto rounded-t-2xl border-t border-border bg-elevated p-5"
      >
        <div class="mb-3 flex items-center justify-between">
          <p class="text-sm font-semibold text-fg">Contents</p>
          <button
            type="button"
            class="text-muted hover:text-fg"
            aria-label="Close"
            @click="showToc = false"
          >
            ✕
          </button>
        </div>
        <ul class="space-y-1 text-sm">
          <li
            v-for="s in sections"
            :key="s.id"
            :style="{ paddingLeft: `${(s.level - 1) * 0.75}rem` }"
          >
            <button
              type="button"
              class="block w-full rounded-md px-2 py-1.5 text-left transition-colors"
              :class="
                activeId === s.id
                  ? 'bg-surface font-medium text-accent'
                  : 'text-muted hover:text-accent'
              "
              @click="jumpTo(s.id)"
            >
              <span class="font-mono text-xs opacity-70">{{ s.label }}</span> {{ s.title }}
            </button>
          </li>
        </ul>
      </nav>
    </div>
  </div>
</template>
