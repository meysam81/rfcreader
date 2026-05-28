// Rasterises the app icons (regular + maskable) from inline SVG so the PWA
// manifest has the PNGs it needs. Runs as part of `prepare:assets`.
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const dir = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(dir, "../public/icons");
mkdirSync(outDir, { recursive: true });

const BG = "#0b0f14";
const ACCENT = "#5b9cff";
const MUTED = "#9aa7b8";

/** @param {{ rounded?: boolean, safe?: boolean }} opts */
function svg({ rounded = true, safe = false } = {}) {
  const radius = rounded ? 96 : 0;
  // Maskable icons need their content within the ~80% safe zone.
  const scale = safe ? 0.78 : 1;
  const cx = 256;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${radius}" fill="${BG}"/>
  <g transform="translate(${cx} ${cx}) scale(${scale}) translate(${-cx} ${-cx})">
    <text x="256" y="248" font-family="ui-monospace, 'SFMono-Regular', Menlo, monospace" font-size="148" font-weight="700" fill="${ACCENT}" text-anchor="middle" dominant-baseline="middle">RFC</text>
    <rect x="148" y="312" width="216" height="16" rx="8" fill="${MUTED}"/>
    <rect x="148" y="348" width="150" height="16" rx="8" fill="${MUTED}" opacity="0.6"/>
  </g>
</svg>`;
}

async function render(name, svgString, size) {
  await sharp(Buffer.from(svgString)).resize(size, size).png().toFile(resolve(outDir, name));
  console.log(`icons: wrote ${name}`);
}

await Promise.all([
  render("icon-192.png", svg(), 192),
  render("icon-512.png", svg(), 512),
  render("maskable-512.png", svg({ rounded: false, safe: true }), 512),
  render("apple-touch-icon.png", svg(), 180),
]);
