// node tools/readme-check.mjs [dev url]: runs the README's code sample, as written, in installed Chrome through the dev server, and takes a picture of it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL('C:/Users/drini/src/patch-lab/harness/node_modules/playwright-core/index.mjs').href);
const here = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] ?? 'http://127.0.0.1:5497/';
const readme = fs.readFileSync(path.join(here, 'README.md'), 'utf8');
const code = readme.match(/```js\n([\s\S]*?)```/)[1].replace("'./stylised-sky.js'", "'/src/stylised-sky.js'");
fs.mkdirSync(path.join(here, 'shots'), { recursive: true });
fs.writeFileSync(path.join(here, 'shots', 'readme-code.js'), code);
fs.writeFileSync(path.join(here, 'shots', 'readme.html'), '<!doctype html><body style="margin:0;overflow:hidden"><script type="module" src="./readme-code.js"></script></body>');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sky-readme-'));
const ctx = await chromium.launchPersistentContext(dir, { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: false, viewport: { width: 960, height: 540 }, args: ['--mute-audio', '--no-first-run', '--no-default-browser-check'] });
const page = ctx.pages()[0] ?? (await ctx.newPage());
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
page.on('console', (m) => {
	if (m.type() === 'error') problems.push(m.text());
});
await page.goto(`${base}shots/readme.html`);
await page.waitForTimeout(7000);
await page.screenshot({ path: path.join(here, 'shots', 'readme.png') });
console.log(problems.length ? `problems: ${problems.join(' | ').slice(0, 1500)}` : 'README code ran with no errors');
await ctx.close();
