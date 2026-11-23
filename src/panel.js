// 스탠드얼론(GitHub Pages) 전용 컨트롤 패널: patch.gg 임베드에서는 호스트가 recipe.json의 컨트롤을
// 그려주지만, 단독 배포에서는 그 호스트가 없으므로 같은 recipe.json을 읽어 여기서 그린다.
// recipe.json을 번역해 두면 이 패널도 그대로 한글로 나온다.
export function mountPanel(app, recipe) {
	const root = document.getElementById('panel');
	if (!root) return;
	const controls = recipe?.block?.controls ?? [];
	const triggers = recipe?.block?.triggers ?? [];

	const head = document.createElement('div');
	head.className = 'head';
	head.innerHTML = '<span>하늘 조작</span><span class="fold">접기</span>';
	const body = document.createElement('div');
	body.className = 'body';
	root.append(head, body);
	root.classList.add('on');
	head.addEventListener('click', () => {
		root.classList.toggle('folded');
		head.querySelector('.fold').textContent = root.classList.contains('folded') ? '펼치기' : '접기';
	});

	const updaters = [];
	let dragging = null;
	const fmt = (c, v) => {
		const n = c.type === 'number' && c.step < 1 ? Number(v).toFixed(2) : String(Math.round(Number(v) * 100) / 100);
		return `${n}${c.unit ?? ''}`;
	};

	for (const c of controls) {
		const wrap = document.createElement('div');
		wrap.className = 'ctl';
		if (c.type === 'choice' && c.options?.some((o) => o.image)) {
			// 썸네일이 있는 선택지(분위기)
			const lab = document.createElement('div');
			lab.className = 'row';
			lab.innerHTML = `<label>${c.label}</label>`;
			const grid = document.createElement('div');
			grid.className = 'moods';
			const btns = new Map();
			for (const o of c.options) {
				const b = document.createElement('button');
				b.type = 'button';
				b.title = o.label;
				b.innerHTML = `${o.image ? `<img src="${o.image}" alt="${o.label}" loading="lazy">` : ''}<span>${o.label}</span>`;
				b.addEventListener('click', () => {
					app.set(c.id, o.value);
					refresh();
				});
				btns.set(o.value, b);
				grid.append(b);
			}
			const hint = document.createElement('div');
			hint.className = 'hint';
			hint.textContent = c.hint ?? '';
			wrap.append(lab, grid, hint);
			updaters.push(() => {
				for (const [v, b] of btns) b.classList.toggle('sel', app.values[c.id] === v);
			});
		} else if (c.type === 'choice') {
			const lab = document.createElement('div');
			lab.className = 'row';
			lab.innerHTML = `<label>${c.label}</label>`;
			const row = document.createElement('div');
			row.className = 'choices';
			const btns = new Map();
			for (const o of c.options) {
				const b = document.createElement('button');
				b.type = 'button';
				b.textContent = o.label;
				b.addEventListener('click', () => {
					app.set(c.id, o.value);
					refresh();
				});
				btns.set(o.value, b);
				row.append(b);
			}
			const hint = document.createElement('div');
			hint.className = 'hint';
			hint.textContent = c.hint ?? '';
			wrap.append(lab, row, hint);
			updaters.push(() => {
				for (const [v, b] of btns) b.classList.toggle('sel', app.values[c.id] === v);
			});
		} else if (c.type === 'toggle') {
			const lab = document.createElement('label');
			lab.className = 'tog';
			const input = document.createElement('input');
			input.type = 'checkbox';
			input.addEventListener('change', () => {
				app.set(c.id, input.checked);
				refresh();
			});
			const span = document.createElement('span');
			span.textContent = c.label;
			lab.append(span, input);
			const hint = document.createElement('div');
			hint.className = 'hint';
			hint.textContent = c.hint ?? '';
			wrap.append(lab, hint);
			updaters.push(() => {
				input.checked = Boolean(app.values[c.id]);
			});
		} else if (c.type === 'number') {
			const row = document.createElement('div');
			row.className = 'row';
			const lab = document.createElement('label');
			lab.textContent = c.label;
			const val = document.createElement('span');
			val.className = 'val';
			row.append(lab, val);
			const input = document.createElement('input');
			input.type = 'range';
			input.min = c.min;
			input.max = c.max;
			input.step = c.step;
			input.addEventListener('pointerdown', () => (dragging = c.id));
			input.addEventListener('pointerup', () => (dragging = null));
			input.addEventListener('input', () => {
				app.set(c.id, Number(input.value));
				val.textContent = fmt(c, input.value);
			});
			const hint = document.createElement('div');
			hint.className = 'hint';
			hint.textContent = c.hint ?? '';
			wrap.append(row, input, hint);
			updaters.push(() => {
				const v = app.values[c.id];
				val.textContent = fmt(c, v);
				if (dragging !== c.id) input.value = v;
			});
		}
		body.append(wrap);
	}

	if (triggers.length) {
		const wrap = document.createElement('div');
		wrap.className = 'ctl';
		const row = document.createElement('div');
		row.className = 'trigs';
		for (const t of triggers) {
			const b = document.createElement('button');
			b.type = 'button';
			b.textContent = t.label;
			b.title = t.hint ?? '';
			b.addEventListener('click', () => {
				app.trigger(t.id);
				if (t.id === 'reset') refresh();
			});
			row.append(b);
		}
		wrap.append(row);
		body.append(wrap);
	}

	const refresh = () => {
		for (const u of updaters) u();
	};
	refresh();
	// 분위기 선택이나 시간 흐름으로 값이 바뀌는 경우를 따라가기 위한 느린 폴링.
	setInterval(refresh, 500);
}
