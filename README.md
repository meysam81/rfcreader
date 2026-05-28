# RFC Reader

A fast, minimalist, **mobile-first** reader for IETF RFCs. Search the full
catalogue by number, title, keyword, or author and read any RFC in a clean,
accessible view — with dark mode, bookmarks, in-document navigation, and
offline support.

🔗 **Live:** https://meysam81.github.io/rfcreader

## Features

- **Search everything** — a prebuilt index of every RFC (number, title,
  authors, abstract, keywords) powers instant client-side fuzzy search.
- **Filters & sorting** — narrow by status and stream, hide obsoleted RFCs,
  sort by relevance, number, or year.
- **Clean reader** — pagination noise stripped, auto table of contents,
  `RFC NNNN` cross-references linked, adjustable text size.
- **Bookmarks & history** — saved locally on your device, no account.
- **Installable PWA** — add to your home screen; the app shell and the RFCs
  you've read are cached for offline use.
- **Dark mode**, full keyboard access, and reduced-motion support.

## How RFC content is loaded

This is a fully static site (GitHub Pages, no backend). The search index is
generated at build time. Full RFC text is fetched in the browser on demand,
trying multiple providers in order for resilience:

1. `rfc-editor.org` (direct)
2. `ietf.org` (direct)
3. public read-only CORS proxies (allorigins, corsproxy.io, jina.ai)

Whatever responds first wins; if every provider fails, the reader links out to
the canonical sources. Fetched documents are cached by the service worker.

## Tech stack

[Astro](https://astro.build) · [Vue 3](https://vuejs.org) islands ·
[Tailwind CSS 4](https://tailwindcss.com) · [MiniSearch](https://github.com/lucaong/minisearch) ·
[vite-plugin-pwa](https://vite-pwa-org.netlify.app) · built with [Bun](https://bun.sh).

## Develop

```bash
bun install
bun run dev      # generates assets + starts the dev server
bun run build    # type-check + production build into dist/
bun run preview  # preview the production build
```

`bun run prepare:assets` generates the PWA icons and the search index
(`public/rfc-index.json`). When the live RFC index can't be fetched (e.g. an
offline build), it falls back to `scripts/seed-rfc-index.json` so the build
always succeeds.

## Deployment

Pushing to `main` runs `.github/workflows/ci.yml`, which builds the site and
deploys it to GitHub Pages. A weekly scheduled run keeps the catalogue current.
Enable Pages with **Settings → Pages → Source: GitHub Actions**.

## License

Apache-2.0
