// node tools/trouble.mjs <url> <outdir>: the bad days. Ends the test browser's own GPU process twice (first recovers, second shows the message), then WebGL 2 turning the view, and no graphics at all.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL('C:/Users/drini/src/patch-lab/harness/node_modules/playwright-core/index.mjs').href);
const url = process.argv[2];
const out = process.argv[3];
fs.mkdirSync(out, { recursive: true });
const open = async (args = []) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-trouble-'));
	const ctx = await chromium.launchPersistentContext(dir, { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: false, viewport: { width: 960, height: 540 }, args: ['--mute-audio', '--no-first-run', '--no-default-browser-check', ...args] });
	ctx.__dir = dir;
	return { ctx, page: ctx.pages()[0] ?? (await ctx.newPage()) };
};
const state = (page) => page.evaluate(() => ({ ready: window.__block?.times?.ready ?? null, trouble: document.getElementById('nogpu')?.classList.contains('on') ?? false, heading: document.querySelector('#nogpu h1')?.textContent, why: document.querySelector('#nogpu .why')?.textContent })).catch(() => ({ gone: true }));
const until = async (page, test, ms = 30000) => {
	const t = Date.now();
	while (Date.now() - t < ms) {
		const s = await state(page);
		if (test(s)) return s;
		await page.waitForTimeout(250);
	}
	return state(page);
};
{
	const { ctx, page } = await open();
	await page.goto(url);
	console.log('first load', JSON.stringify(await until(page, (s) => s.ready)));
	// Only this test browser's GPU process: it's found by its own profile folder, so nothing else on the PC is touched.
	const crash = () => {
		const name = path.basename(ctx.__dir);
		const ps = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*--type=gpu-process*' -and $_.CommandLine -like '*${name}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; $_.ProcessId }`;
		console.log('ended GPU process', execFileSync('powershell', ['-NoProfile', '-Command', ps]).toString().trim() || '(none found)');
	};
	const before = await page.evaluate(() => performance.timeOrigin);
	crash();
	await page.waitForTimeout(4000);
	console.log('reloaded', (await page.evaluate(() => performance.timeOrigin)) !== before);
	const a = await until(page, (s) => s.ready || s.trouble);
	console.log('after the first crash', JSON.stringify(a));
	await page.waitForTimeout(1500);
	crash();
	const b = await until(page, (s) => s.trouble, 20000);
	console.log('after the second crash', JSON.stringify(b));
	await page.screenshot({ path: path.join(out, 'second-crash.png') }).catch(() => {});
	await ctx.close();
}
if (!process.argv.includes('--crash-only')) {
	const { ctx, page } = await open();
	await page.goto(`${url}?webgl`);
	console.log('webgl', JSON.stringify(await until(page, (s) => s.ready || s.trouble)));
	await page.evaluate(() => window.__block.app.set('mood', 'day'));
	await page.waitForTimeout(2500);
	await page.screenshot({ path: path.join(out, 'webgl-before-turn.png') });
	await page.evaluate(() => {
		window.__block.app.view.goalYaw += 0.5;
		window.__block.app.view.goalPitch = 0.45;
	});
	await page.waitForTimeout(70);
	await page.screenshot({ path: path.join(out, 'webgl-turning.png') });
	await page.waitForTimeout(1200);
	await page.screenshot({ path: path.join(out, 'webgl-after-turn.png') });
	await ctx.close();
}
if (!process.argv.includes('--crash-only')) {
	const { ctx, page } = await open(['--disable-gpu', '--disable-software-rasterizer', '--disable-webgl', '--disable-webgl2', '--disable-features=WebGPU,Vulkan']);
	await page.goto(url);
	console.log('no graphics', JSON.stringify(await until(page, (s) => s.ready || s.trouble, 25000)));
	await page.screenshot({ path: path.join(out, 'no-graphics.png') }).catch(() => {});
	await ctx.close();
}
