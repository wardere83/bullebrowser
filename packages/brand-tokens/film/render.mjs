// Renders film.html to MP4 + a poster image, frame by frame.
//
//   FFMPEG=/path/to/ffmpeg node packages/brand-tokens/film/render.mjs
//   node packages/brand-tokens/film/render.mjs --preview 3,9,15,21   # PNG stills only
//
// Needs Google Chrome (driven through the desktop app's Playwright) and an
// ffmpeg with libx264 (on PATH, or FFMPEG=…; `npx ffmpeg-static` prints one).
// Writes the film into both places that ship it: the website's public/media
// and the desktop start page's assets.

import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const require = createRequire(resolve(repo, 'apps/desktop/package.json'));
const { chromium } = require('playwright');

const FPS = 30;
const POSTER_AT = 15.6;
const OUT_DIRS = [resolve(repo, 'apps/web/public/media'), resolve(repo, 'apps/desktop/src/renderer/assets')];
const args = process.argv.slice(2);
const previewIdx = args.indexOf('--preview');

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(resolve(here, 'film.html')).href + '?frames');
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);
const duration = await page.evaluate(() => window.DURATION);

const shot = async (t, opts) => {
  await page.evaluate((x) => window.render(x), t);
  return page.screenshot(opts);
};

if (previewIdx !== -1) {
  const dir = resolve(here, 'preview');
  mkdirSync(dir, { recursive: true });
  for (const t of args[previewIdx + 1].split(',').map(Number)) {
    await shot(t, { path: resolve(dir, `t${t}.png`) });
    console.log(`preview/t${t}.png`);
  }
  await browser.close();
  process.exit(0);
}

const tmp = resolve(here, '.out');
mkdirSync(tmp, { recursive: true });
const mp4 = resolve(tmp, 'bullebrowser-film.mp4');
const ff = spawn(process.env.FFMPEG || 'ffmpeg', [
  '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-pix_fmt', 'yuv420p',
  '-profile:v', 'high', '-movflags', '+faststart', '-an', mp4,
], { stdio: ['pipe', 'inherit', 'inherit'] });

const frames = Math.round(duration * FPS);
for (let i = 0; i < frames; i++) {
  const buf = await shot(i / FPS, { type: 'jpeg', quality: 94 });
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  if (i % 60 === 0) process.stdout.write(`\rframe ${i}/${frames}`);
}
ff.stdin.end();
await new Promise((r, j) => ff.on('close', (c) => (c === 0 ? r() : j(new Error(`ffmpeg exited ${c}`)))));

const poster = resolve(tmp, 'bullebrowser-film-poster.jpg');
await shot(POSTER_AT, { type: 'jpeg', quality: 82, path: poster });
await browser.close();

for (const d of OUT_DIRS) {
  mkdirSync(d, { recursive: true });
  copyFileSync(mp4, resolve(d, 'bullebrowser-film.mp4'));
  copyFileSync(poster, resolve(d, 'bullebrowser-film-poster.jpg'));
}
console.log(`\nwrote ${frames} frames → ${OUT_DIRS.join(', ')}`);
