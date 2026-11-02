// Writes the Mood choice's pictures, thumbs/moods/<id>.webp, 112 x 112 (the block page draws them at 56 x 56), and shots/cover.png (1920 x 1080), from the
// running demo in installed Chrome, muted. Needs ffmpeg with libwebp on PATH.
//
//   npm run dev   (in another terminal), then: node tools/make-thumbs.mjs [url, default http://127.0.0.1:5497/]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MOODS, FIRST_MOOD } from '../src/moods.js';

const { chromium } = await import(pathToFileURL('C:/Users/drini/src/patch-lab/harness/node_modules/playwright-core/index.mjs').href);
const here = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = process.argv[2] ?? 'http://127.0.0.1:5497/';
const out = path.join(here, 'thumbs', 'moods');
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(path.join(here, 'shots'), { recursive: true });

const open = async (width, height) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-thumbs-'));
	const ctx = await chromium.launchPersistentContext(dir, { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: false, viewport: { width, height }, args: ['--mute-audio', '--no-first-run', '--no-default-browser-check'] });
	const page = ctx.pages()[0] ?? (await ctx.newPage());
	await page.goto(url);
	await page.waitForFunction(() => window.__block?.times?.ready, null, { timeout: 60000 });
	await page.addStyleTag({ content: '.hud { display: none !important; }' });
	return { ctx, page };
};

{
	const { ctx, page } = await open(448, 448);
	for (const id of Object.keys(MOODS)) {
		await page.evaluate((m) => {
			const a = window.__block.app;
			a.set('storms', false);
			a.set('mood', m);
			// Wider and lifted a little, so a small square holds sky, hills and lake.
			a.view.goalFov = 66;
			a.view.goalPitch = 0.04;
		}, id);
		await page.waitForTimeout(3600);
		const png = path.join(out, `${id}.png`);
		await page.screenshot({ path: png });
		const webp = path.join(out, `${id}.webp`);
		execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', png, '-vf', 'scale=112:112:flags=lanczos', '-c:v', 'libwebp', '-quality', '86', webp]);
		fs.rmSync(png);
		console.log(`${id}: ${fs.statSync(webp).size} bytes`);
	}
	await ctx.close();
}
{
	const { ctx, page } = await open(1920, 1080);
	await page.evaluate((m) => window.__block.app.set('mood', m), FIRST_MOOD);
	await page.waitForTimeout(4000);
	await page.screenshot({ path: path.join(here, 'shots', 'cover.png') });
	await ctx.close();
	execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(here, 'shots', 'cover.png'), '-vf', 'scale=1280:720:flags=lanczos', '-q:v', '3', path.join(here, 'cover.jpg')]);
}
