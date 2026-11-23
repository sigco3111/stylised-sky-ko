// The block demo's first file: small, so the page hears from it before three.js has even arrived.
import { patchBlock } from 'patch-block';
import recipe from '../recipe.json';

const started = performance.now();
const times = {};
let app = null;
const pending = [];
// 스탠드얼론(GitHub Pages)일 때만 커버 위에 진행 문구를 보여준다. patch.gg 임베드에서는 호스트의 로더가 뜬다.
const standalone = window.parent === window;
const say = (k, words) => {
	if (standalone && typeof words === 'string') {
		const el = document.getElementById('progress');
		if (el) el.textContent = `${words}… ${Math.round(k * 100)}%`;
	}
};
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
{
	const progress = block.progress.bind(block);
	block.progress = (k, words) => {
		progress(k, words);
		say(k, words);
	};
}
block.progress(0.02, '불러오는 중');

function showTrouble(why, reload) {
	const b = document.getElementById('nogpu');
	if (reload) {
		b.querySelector('h1').textContent = '그래픽 카드가 응답하지 않습니다';
		b.querySelector('.say').textContent = '브라우저의 그래픽 프로세스가 응답을 멈췄습니다. 이 페이지를 다시 로드해 보고, 그래도 안 되면 브라우저를 다시 시작해 주세요.';
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
	const why = `그래픽 장치 연결이 끊어졌습니다: ${info?.message ?? '이유 없음'}`.slice(0, 300);
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
	if (standalone) {
		document.getElementById('progress')?.remove();
		const { mountPanel } = await import('./panel.js');
		mountPanel(app, recipe);
	}
} catch (error) {
	console.error(error);
	showTrouble(String(error?.message ?? error).slice(0, 300), false);
}
