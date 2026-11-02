// node tools/ends.mjs <url> <outdir>: every number control at both ends on the Fair day, then Reset, with a sheet of pictures. Installed Chrome, own profile, muted.
// Also checks through the page's messages that Reset sends every control back. Writes <outdir>/ends.jpg (needs Pillow, run by the caller).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL('C:/Users/drini/src/patch-lab/harness/node_modules/playwright-core/index.mjs').href);
const url = process.argv[2];
const out = process.argv[3];
fs.mkdirSync(out, { recursive: true });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-ends-'));
const ctx = await chromium.launchPersistentContext(dir, { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: false, viewport: { width: 960, height: 540 }, args: ['--mute-audio', '--no-first-run', '--no-default-browser-check'] });
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.on('pageerror', (e) => console.log('pageerror', e.message.slice(0, 500)));
page.on('console', (m) => {
	if (m.type() === 'error') console.log('error', m.text().slice(0, 500));
});
await page.goto(url);
await page.waitForFunction(() => window.__block?.times?.ready, null, { timeout: 60000 });
await page.addStyleTag({ content: '.hud { display: none !important; }' });
const tests = [
	['time', 0],
	['time', 7],
	['time', 13],
	['time', 19],
	['cover', 0],
	['cover', 1],
	['wind', 0],
	['wind', 80],
	['rain', 1],
	['puffs', 0.4],
	['puffs', 2.5],
	['detail', 0.4],
	['detail', 2.5],
	['depth', 0.5],
	['depth', 2.5],
	['paint', 1],
	['sun_arc', 15],
	['sun_arc', 85],
	['shadows', 0],
	['quality', 'low'],
	['quality', 'high'],
];
await page.evaluate(() => {
	const a = window.__block.app;
	a.set('mood', 'day');
});
await page.waitForTimeout(2600);
await page.screenshot({ path: path.join(out, '00-base.png') });
const base = await page.evaluate(() => JSON.stringify(window.__block.app.values));
let n = 1;
for (const [id, value] of tests) {
	const was = await page.evaluate(([i, x]) => {
		const a = window.__block.app;
		const w = a.values[i];
		a.set(i, x);
		return w;
	}, [id, value]);
	await page.waitForTimeout(id === 'wind' ? 3200 : 2400);
	await page.screenshot({ path: path.join(out, `${String(n++).padStart(2, '0')}-${id}-${value}.png`) });
	await page.evaluate(([i, x]) => window.__block.app.set(i, x), [id, was]);
	await page.waitForTimeout(150);
}
// Reset, from a thoroughly moved state.
const after = await page.evaluate(async () => {
	const a = window.__block.app;
	const sent = {};
	const real = window.__block.block.state;
	window.__block.block.state = (x) => {
		Object.assign(sent, x);
		return real(x);
	};
	for (const [i, x] of [['mood', 'storm'], ['time', 3], ['cover', 1], ['wind', 80], ['rain', 1], ['puffs', 2], ['detail', 2], ['depth', 2], ['paint', 1], ['sun_arc', 20], ['shadows', 0], ['cycle', true], ['storms', false], ['quality', 'low'], ['wind_dir', 40]]) a.set(i, x);
	a.view.goalYaw += 1;
	a.view.goalPitch = 1;
	a.view.goalFov = 30;
	await new Promise((r) => setTimeout(r, 800));
	a.trigger('reset');
	await new Promise((r) => setTimeout(r, 3500));
	return { values: a.values, view: { yaw: a.view.yaw, pitch: a.view.pitch, fov: a.view.fov }, hours: a.sky.time, sent };
});
console.log('after reset', JSON.stringify(after));
await page.screenshot({ path: path.join(out, '99-reset.png') });
console.log('base', base);
await ctx.close();
