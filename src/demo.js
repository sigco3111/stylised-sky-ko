// The block demo's first file: small, so the page hears from it before three.js has even arrived.
import { patchBlock } from 'patch-block';
import recipe from '../recipe.json';

const started = performance.now();
const times = {};
let app = null;
const pending = [];
const block = patchBlock({
	...recipe.block,
	onSet(id, value) {
		if (app) app.set(id, value);
		else pending.push([id, value]);
	},
	onTrigger(id) {
		app?.trigger(id);
	},
	onVisible(visible) {
		app?.visible(visible);
	},
});
window.__block = { block, times };
block.progress(0.02, 'Loading');

function showTrouble(why, reload) {
	const b = document.getElementById('nogpu');
	if (reload) {
		b.querySelector('h1').textContent = 'The graphics card stopped answering';
		b.querySelector('.say').textContent = "Your browser's graphics process stopped responding. Reload this page, and if that doesn't help, restart the browser.";
		b.querySelector('.more').hidden = true;
		const again = b.querySelector('button');
		again.hidden = false;
		again.onclick = () => location.reload();
	}
	b.querySelector('.why').textContent = why;
	b.classList.add('on');
	document.getElementById('view').style.display = 'none';
	document.getElementById('cover')?.remove();
	document.getElementById('credit').hidden = true;
	document.getElementById('tip').hidden = true;
}
// A lost device reloads once a minute at most, then says so.
function deviceLost(info) {
	if (info?.reason === 'destroyed') return;
	const why = `The graphics device was lost: ${info?.message ?? 'no reason given'}`.slice(0, 300);
	console.warn(why);
	const KEY = 'stylised-sky-device-lost';
	try {
		const last = Number(sessionStorage.getItem(KEY) ?? 0);
		if (Date.now() - last > 60000) {
			sessionStorage.setItem(KEY, String(Date.now()));
			location.reload();
			return;
		}
	} catch {
		// (No storage in this frame: nothing to stop a reload loop with, so show the message)
	}
	showTrouble(why, true);
}

try {
	const { boot } = await import('./app.js');
	times.code = Math.round(performance.now() - started);
	app = await boot({ block, recipe, times, started, deviceLost });
	window.__block.app = app;
	window.__block.renderer = app.renderer;
	for (const [id, value] of pending) app.set(id, value);
} catch (error) {
	console.error(error);
	showTrouble(String(error?.message ?? error).slice(0, 300), false);
}
