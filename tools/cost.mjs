// node tools/cost.mjs <url> [--w 1920 --h 1080]: how long the sky's own passes take, in installed Chrome (own profile, muted). It draws them 30 times over and waits
// for the GPU to finish, so the wait for the queue hardly counts. It reads wall time, so other work on the card adds to it: take the GPU lock and say what else ran.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL('C:/Users/drini/src/patch-lab/harness/node_modules/playwright-core/index.mjs').href);
const argv = process.argv.slice(2);
const val = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const W = Number(val('--w', 1920));
const H = Number(val('--h', 1080));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-cost-'));
const ctx = await chromium.launchPersistentContext(dir, { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: false, viewport: { width: W, height: H }, args: ['--mute-audio', '--no-first-run', '--no-default-browser-check'] });
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto(argv[0]);
await page.waitForFunction(() => window.__block?.times?.ready, null, { timeout: 60000 });
const rows = await page.evaluate(async () => {
	const a = window.__block.app;
	a.visible(false);
	const device = a.renderer.backend.device;
	const out = [];
	const timed = async (water) => {
		let best = Infinity;
		let sum = 0;
		for (let round = 0; round < 8; round++) {
			await device.queue.onSubmittedWorkDone();
			const t = performance.now();
			for (let i = 0; i < 30; i++) a.sky.render({ water });
			await device.queue.onSubmittedWorkDone();
			const ms = (performance.now() - t) / 30;
			best = Math.min(best, ms);
			sum += ms;
		}
		return { best: Number(best.toFixed(2)), mean: Number((sum / 8).toFixed(2)) };
	};
	for (const quality of ['low', 'medium', 'high']) {
		a.set('quality', quality);
		for (const mood of ['day', 'storm', 'night']) {
			a.set('mood', mood);
			for (let i = 0; i < 150; i++) {
				a.frame(1 / 60);
				if (i % 8 === 0) await device.queue.onSubmittedWorkDone();
			}
			out.push({ quality, mood, clouds: await timed(false), withMirror: await timed(true) });
		}
	}
	return out;
});
for (const r of rows) console.log(`${r.quality.padEnd(7)} ${r.mood.padEnd(6)} clouds best ${r.clouds.best} ms, mean ${r.clouds.mean}; with the mirror best ${r.withMirror.best} ms, mean ${r.withMirror.mean}`);
await ctx.close();
