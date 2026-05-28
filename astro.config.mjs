import { fileURLToPath } from "node:url";

import { defineConfig } from "astro/config";
import vue from "@astrojs/vue";
import sitemap from "@astrojs/sitemap";
import AstroPWA from "@vite-pwa/astro";

// Deployed as a GitHub Pages project site: https://meysam81.github.io/rfcreader
const SITE = "https://meysam81.github.io";
const BASE = "/rfcreader";

export default defineConfig({
  site: SITE,
  base: BASE,
  trailingSlash: "ignore",
  prefetch: { prefetchAll: true, defaultStrategy: "viewport" },
  build: { inlineStylesheets: "auto" },
  integrations: [
    vue(),
    sitemap(),
    AstroPWA({
      registerType: "autoUpdate",
      injectRegister: false,
      manifest: {
        name: "RFC Reader",
        short_name: "RFCReader",
        description: "Search and read IETF RFCs on any device — fast, offline-friendly.",
        display: "standalone",
        orientation: "portrait-primary",
        background_color: "#0b0f14",
        theme_color: "#0b0f14",
        categories: ["productivity", "reference", "utilities"],
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icons/maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: null,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // The search catalogue — refresh in the background, serve instantly.
            urlPattern: ({ url }) => url.pathname.endsWith("/rfc-index.json"),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "rfc-index",
              expiration: { maxEntries: 2, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
          {
            // Full RFC text fetched from any upstream provider — keep what you read.
            urlPattern: ({ url }) =>
              /rfc\d+\.txt$/i.test(url.pathname) ||
              /(rfc-editor\.org|ietf\.org|allorigins|corsproxy|jina\.ai)/i.test(url.hostname),
            handler: "CacheFirst",
            options: {
              cacheName: "rfc-text",
              expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  vite: {
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
  },
});
