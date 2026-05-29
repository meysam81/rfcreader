<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

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
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

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
  } catch (err) {
    error.value = err instanceof Error ? err.message : "Failed to load this RFC.";
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="mx-auto max-w-3xl">
    <!-- Header -->
    <div class="mb-4 flex flex-wrap items-start gap-3">
      <a
        :href="HOME"
        class="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-fg hover:bg-elevated"
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
          class="flex items-center rounded-lg border border-border bg-surface"
          role="group"
          aria-label="Text size"
        >
          <button
            type="button"
            class="px-2.5 py-1.5 text-sm text-fg hover:bg-elevated disabled:opacity-40"
            :disabled="fontIndex === 0"
            aria-label="Decrease text size"
            @click="setFont(-1)"
          >
            A−
          </button>
          <button
            type="button"
            class="px-2.5 py-1.5 text-base text-fg hover:bg-elevated disabled:opacity-40"
            :disabled="fontIndex === FONT_STEPS.length - 1"
            aria-label="Increase text size"
            @click="setFont(1)"
          >
            A+
          </button>
        </div>

        <button
          type="button"
          class="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors"
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

    <!-- Title block -->
    <header v-if="number" class="mb-6 border-b border-border pb-5">
      <p class="font-mono text-sm font-semibold text-accent">RFC {{ number }}</p>
      <h1 class="mt-1 text-2xl font-semibold leading-tight text-fg sm:text-3xl">{{ title }}</h1>
      <p v-if="meta?.authors?.length" class="mt-2 text-sm text-muted">
        {{ meta.authors.join(", ") }}
      </p>
      <div class="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted">
        <span v-if="meta?.status">{{ meta.status.toLowerCase() }}</span>
        <span v-if="meta?.year">{{ meta.year }}</span>
        <span v-if="sourceLabel">via {{ sourceLabel }}</span>
      </div>
    </header>

    <!-- Loading -->
    <p v-if="loading" class="py-16 text-center text-muted" role="status">
      Fetching RFC {{ number }}…
    </p>

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

    <!-- Document -->
    <div v-else class="lg:grid lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-8">
      <article aria-label="RFC document" class="min-w-0">
        <div class="rfc-body" :style="{ '--rfc-fs': fontSize }" v-html="bodyHtml"></div>

        <footer class="mt-10 border-t border-border pt-5">
          <p class="text-sm text-muted">Read on the source:</p>
          <ul class="mt-2 flex flex-wrap gap-2">
            <li v-for="l in links" :key="l.href">
              <a
                :href="l.href"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-block rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-accent hover:border-accent"
              >
                {{ l.label }} ↗
              </a>
            </li>
          </ul>
        </footer>
      </article>

      <!-- Table of contents (sidebar on desktop) -->
      <aside v-if="sections.length" class="mt-10 hidden lg:mt-0 lg:block">
        <nav aria-label="Table of contents" class="sticky top-20 max-h-[80vh] overflow-y-auto">
          <p class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Contents</p>
          <ul class="space-y-1 text-sm">
            <li
              v-for="s in sections"
              :key="s.id"
              :style="{ paddingLeft: `${(s.level - 1) * 0.75}rem` }"
            >
              <button
                type="button"
                class="block w-full truncate text-left text-muted hover:text-accent"
                :title="`${s.label} ${s.title}`"
                @click="jumpTo(s.id)"
              >
                <span class="font-mono text-xs">{{ s.label }}</span> {{ s.title }}
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
        <ul class="space-y-2 text-sm">
          <li
            v-for="s in sections"
            :key="s.id"
            :style="{ paddingLeft: `${(s.level - 1) * 0.75}rem` }"
          >
            <button
              type="button"
              class="block w-full text-left text-muted hover:text-accent"
              @click="jumpTo(s.id)"
            >
              <span class="font-mono text-xs">{{ s.label }}</span> {{ s.title }}
            </button>
          </li>
        </ul>
      </nav>
    </div>
  </div>
</template>
