// node tools/try.mjs <url> <outdir> [moods, comma separated] [--w 1280 --h 720]: opens the demo in installed Chrome (own profile, muted), logs the
// boot and any errors, and takes a picture of each mood. It's for looking, not timing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL('C:/Users/drini/src/patch-lab/harness/node_modules/playwright-core/index.mjs').href);
const { fakePointerLock } = await import(pathToFileURL('C:/Users/drini/Patch/seeds/no-pointer-lock.mjs').href);
const argv = process.argv.slice(2);
const val = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const url = argv[0];
const out = argv[1];
const moods = (argv[2] && !argv[2].startsWith('--') ? argv[2] : 'dusk').split(',');
const W = Number(val('--w', 1280));
const H = Number(val('--h', 720));
fs.mkdirSync(out, { recursive: true });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-try-'));
const ctx = await chromium.launchPersistentContext(dir, { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: false, viewport: { width: W, height: H }, args: ['--mute-audio', '--no-first-run', '--no-default-browser-check'] });
await ctx.addInitScript(fakePointerLock);
const page = ctx.pages()[0] ?? (await ctx.newPage());
page.on('console', (m) => {
	const t = m.text();
	if (m.type() === 'error' || m.type() === 'warning' || t.startsWith('[stylised-sky]')) console.log(`[${m.type()}]`, t.slice(0, 1500));
});
page.on('pageerror', (e) => console.log('pageerror', e.message.slice(0, 1500)));
const t0 = Date.now();
await page.goto(url);
for (let i = 0; i < 600; i++) {
	const s = await page.evaluate(() => ({ ready: window.__block?.times?.ready, trouble: document.getElementById('nogpu')?.classList.contains('on') ? document.querySelector('#nogpu .why')?.textContent : null })).catch(() => ({}));
	if (s.ready || s.trouble) {
		console.log(`after ${((Date.now() - t0) / 1000).toFixed(1)} s`, JSON.stringify(s), JSON.stringify(await page.evaluate(() => window.__block.times)));
		if (s.trouble) {
			await page.screenshot({ path: path.join(out, 'trouble.png') });
			await ctx.close();
			process.exit(1);
		}
		break;
	}
	await page.waitForTimeout(100);
}
await page.addStyleTag({ content: '.hud { display: none !important; }' });
for (const mood of moods) {
	const [name, ...rest] = mood.split(':');
	await page.evaluate(([m, extra]) => {
		const a = window.__block.app;
		a.set('mood', m);
		for (const kv of extra) {
			const [k, x] = kv.split('=');
			a.set(k, Number(x));
		}
	}, [name, rest]);
	await page.waitForTimeout(Number(val('--wait', 3500)));
	await page.screenshot({ path: path.join(out, `${mood.replace(/[:=]/g, '-')}.png`) });
	console.log(mood, JSON.stringify(await page.evaluate(() => ({ fps: window.__block.fps }))));
}
await ctx.close();
