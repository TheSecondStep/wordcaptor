// Draws the toolbar icon from the sprite's own drawing, so the two cannot drift apart.
// Run with `npm run icons` after changing src/lib/sprite-art.ts.
import { writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { RIDER } from '../src/lib/sprite-art.ts';

const SIZES = [16, 32, 48, 128];

// At 16 pixels only a face reads, so the icon is her head, with the wand's star beside it.
const head = RIDER.match(/<g class="head">[\s\S]*?\n {4}<\/g>/)?.[0];
if (!head) throw new Error('The head is no longer where sprite-art.ts used to keep it.');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="8 -3.5 44 44">
  <style>
    .hair { fill: #c98b52; stroke: #a56a36; stroke-width: 0.4; stroke-linejoin: round; }
    .eyes.shut, .eyes.dizzy, .mouth.open, .mouth.wavy, .sweat { display: none; }
  </style>
  ${head}
  <path d="M44 25.5 L46.1 30.6 L51.6 31 L47.4 34.6 L48.7 40 L44 37.1 L39.3 40 L40.6 34.6 L36.4 31 L41.9 30.6 Z"
    fill="#ffd23f" stroke="#e8a317" stroke-width="0.9" stroke-linejoin="round" />
</svg>
`;

await writeFile('docs/icon.svg', svg);

const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of SIZES) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html, body { margin: 0; } svg { display: block; width: ${size}px; height: ${size}px; }</style>${svg}`);
  await page.screenshot({ path: `public/icon/${size}.png`, omitBackground: true });
}
await browser.close();
