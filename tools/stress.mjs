// node tools/stress.mjs <url> [--seconds 240]: plays hard for minutes in installed Chrome with its own profile, muted: every control, every mood both ways, resets, lightning,
// quality changes, mouse drags and the wheel, window resizes. Logs device loss, GPU errors, long tasks, slow frames and memory.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL('C:/Users/drini/src/patch-lab/harness/node_modules/playwright-core/index.mjs').href);
const { fakePointerLock } = await import(pathToFileURL('C:/Users/drini/Patch/seeds/no-pointer-lock.mjs').href);
const argv = process.argv.slice(2);
const val = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const seconds = Number(val('--seconds', 240));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-stress-'));
const ctx = await chromium.launchPersistentContext(dir, { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: false, viewport: { width: 1600, height: 900 }, args: ['--mute-audio', '--no-first-run', '--no-default-browser-check', '--enable-precise-memory-info'] });
await ctx.addInitScript(fakePointerLock);
await ctx.addInitScript(() => {
	window.__m = { raf: [], long: [], lost: [], errors: [] };
	let l = performance.now();
	const t = (n) => {
		window.__m.raf.push(Math.round(n - l));
		l = n;
		requestAnimationFrame(t);
	};
	requestAnimationFrame(t);
	try {
		new PerformanceObserver((list) => {
			for (const e of list.getEntries()) window.__m.long.push(Math.round(e.duration));
		}).observe({ entryTypes: ['longtask'] });
	} catch {}
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror ${e.message.slice(0, 300)}`));
page.on('crash', () => problems.push('CRASH'));
page.on('console', (m) => {
	const t = m.text();
	if (m.type() === 'error' || /gpu error|device was lost|lost/i.test(t)) problems.push(`${m.type()} ${t.slice(0, 300)}`);
});
await page.goto(argv[0]);
await page.waitForFunction(() => window.__block?.times?.ready, null, { timeout: 90000 });
console.log('ready', JSON.stringify(await page.evaluate(() => window.__block.times)));
await page.evaluate(() => {
	const d = window.__block.renderer.backend.device;
	window.__m.raf.length = 0;
	window.__m.long.length = 0;
	d?.lost.then((i) => window.__m.lost.push(i.message));
	d?.addEventListener('uncapturederror', (e) => window.__m.errors.push(e.error.message));
});
const moods = ['day', 'dawn', 'dusk', 'wisps', 'overcast', 'storm', 'night'];
const rnd = (a, b) => a + Math.random() * (b - a);
const t0 = Date.now();
let steps = 0;
while ((Date.now() - t0) / 1000 < seconds) {
	const r = Math.random();
	if (r < 0.3) await page.evaluate((m) => window.__block.app.set('mood', m), moods[Math.floor(Math.random() * moods.length)]);
	else if (r < 0.45) await page.evaluate(([i, x]) => window.__block.app.set(i, x), [['time', 'cover', 'wind', 'rain', 'puffs', 'detail', 'depth', 'paint', 'sun_arc', 'shadows', 'wind_dir'][Math.floor(Math.random() * 11)], 0].map((v, k) => (k === 1 ? Math.random() : v)));
	else if (r < 0.55) await page.evaluate(() => window.__block.app.trigger('strike'));
	else if (r < 0.6) await page.evaluate(() => window.__block.app.trigger('reset'));
	else if (r < 0.66) await page.evaluate((q) => window.__block.app.set('quality', q), ['low', 'medium', 'high', 'auto'][Math.floor(Math.random() * 4)]);
	else if (r < 0.7) await page.evaluate((on) => window.__block.app.set('cycle', on), Math.random() < 0.5);
	else if (r < 0.73) await page.setViewportSize({ width: Math.round(rnd(640, 1800)), height: Math.round(rnd(400, 950)) });
	else if (r < 0.88) {
		const x = rnd(100, 500);
		const y = rnd(100, 350);
		await page.mouse.move(x, y);
		await page.mouse.down();
		for (let i = 0; i < 6; i++) await page.mouse.move(x + rnd(-200, 200), y + rnd(-150, 150));
		await page.mouse.up();
	} else await page.mouse.wheel(0, rnd(-400, 400));
	steps++;
	await page.waitForTimeout(rnd(30, 260));
}
const m = await page.evaluate(() => ({ raf: window.__m.raf, long: window.__m.long, lost: window.__m.lost, errors: window.__m.errors, heap: performance.memory?.usedJSHeapSize, values: window.__block.app.values, info: { textures: window.__block.renderer.info.memory.textures, geometries: window.__block.renderer.info.memory.geometries } }));
const frames = m.raf;
console.log(`${steps} actions in ${seconds} s; frames ${frames.length}; over 50 ms ${frames.filter((x) => x > 50).length}; over 100 ms ${frames.filter((x) => x > 100).length}; worst ${Math.max(...frames)} ms`);
console.log('long tasks', m.long.length, 'worst', Math.max(0, ...m.long));
console.log('device lost', m.lost.length, 'gpu errors', m.errors.length, m.errors.slice(0, 3).join(' | ').slice(0, 500));
console.log('heap MB', ((m.heap ?? 0) / 1048576).toFixed(1), JSON.stringify(m.info));
console.log('problems', problems.length, problems.slice(0, 6).join('\n'));
await ctx.close();
