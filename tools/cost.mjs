// node tools/cost.mjs <url> [--w 1920 --h 1080]: how long the GPU takes over a frame at each quality and mood, in installed Chrome (own profile, muted).
// Each frame is drawn and then waited for (the queue's onSubmittedWorkDone), so it reads GPU work plus a small overhead, without the 60 Hz cap.
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
	for (const quality of ['low', 'medium', 'high']) {
		a.set('quality', quality);
		for (const mood of ['day', 'storm', 'night']) {
			a.set('mood', mood);
			for (let i = 0; i < 150; i++) {
				a.frame(1 / 60);
				if (i % 8 === 0) await device.queue.onSubmittedWorkDone();
			}
			let sum = 0;
			let worst = 0;
			const N = 60;
			for (let i = 0; i < N; i++) {
				await device.queue.onSubmittedWorkDone();
				const t = performance.now();
				a.frame(1 / 60);
				await device.queue.onSubmittedWorkDone();
				const d = performance.now() - t;
				sum += d;
				worst = Math.max(worst, d);
			}
			out.push({ quality, mood, ms: Number((sum / N).toFixed(2)), worst: Number(worst.toFixed(1)) });
		}
	}
	return out;
});
for (const r of rows) console.log(`${r.quality.padEnd(7)} ${r.mood.padEnd(6)} ${String(r.ms).padStart(6)} ms a frame, worst ${r.worst} ms`);
await ctx.close();
