// Writes recipe.json, the block demo's recipe (mode browser + block), and the README's list of controls: `node make-recipe.mjs`.
// demo.js reads its controls from that file. People get the mood with its picture and four sliders; everything else is for
// agents. `--no-images` leaves out the pictures, which come from tools/make-thumbs.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIRST_MOOD, MOODS } from './src/moods.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const images = !process.argv.includes('--no-images') && fs.existsSync(path.join(here, 'thumbs/moods', `${FIRST_MOOD}.webp`));
const first = MOODS[FIRST_MOOD];
const recipe = {
	mode: 'browser',
	block: {
		controls: [
			{
				id: 'mood',
				label: '분위기',
				hint: '시간대, 구름량, 바람, 날씨를 한 번에. 고르면 슬라이더가 함께 움직입니다.',
				type: 'choice',
				options: Object.entries(MOODS).map(([value, m]) => ({ value, label: m.label, ...(images ? { image: `thumbs/moods/${value}.webp` } : {}) })),
				default: FIRST_MOOD,
				essential: true,
			},
			{ id: 'time', label: '시간대', hint: '0시부터 24시까지: 해와 달, 하늘색과 구름에 드는 빛이 모두 바뀝니다.', type: 'number', min: 0, max: 24, step: 0.05, default: first.time, unit: 'h', essential: true },
			{ id: 'cover', label: '구름량', hint: '맑은 하늘에서, 절반쯤 흩어진 뭉게구름을 지나, 하늘을 덮는 구름층까지.', type: 'number', min: 0, max: 1, step: 0.01, default: first.cover, essential: true },
			{ id: 'wind', label: '바람', hint: '구름이 흐르고 소용돌이치는 속도, 그리고 호수의 잔물결. 0이면 하늘이 멈춥니다.', type: 'number', min: 0, max: 80, step: 1, default: first.wind, unit: ' m/s', essential: true },
			{ id: 'rain', label: '비', hint: '카메라 주위로 내리는 비 줄기. 어떤 하늘에서도 비가 오니, 구름량과 함께 올리면 진짜 폭우가 됩니다.', type: 'number', min: 0, max: 1, step: 0.01, default: first.rain, essential: true },
			{ id: 'wind_dir', label: '풍향', hint: '바람이 불어가는 방향, 도(°) 단위.', type: 'number', min: 0, max: 360, step: 1, default: 200, unit: '°' },
			{ id: 'puffs', label: '구름 덩어리 크기', hint: '1보다 크면 더 많고 작은 구름, 작으면 더 적고 큰 구름.', type: 'number', min: 0.4, max: 2.5, step: 0.05, default: 1 },
			{ id: 'detail', label: '가장자리 디테일', hint: '구름을 깎아내는 침식의 정도: 낮으면 부드럽고 둥글게, 높으면 복잡하고 찢어진 듯하게.', type: 'number', min: 0.4, max: 2.5, step: 0.05, default: 1 },
			{ id: 'depth', label: '구름 두께', hint: '날씨가 요구하는 높이에 견준 구름층의 높이.', type: 'number', min: 0.5, max: 2.5, step: 0.05, default: 1, unit: '×' },
			{ id: 'paint', label: '그림체 명암 단계', hint: '구름 위의 빛을 평평한 단계로 나눠, 더 그려낸 듯한 느낌으로.', type: 'number', min: 0, max: 1, step: 0.01, default: 0 },
			{ id: 'sun_arc', label: '태양 높이', hint: '정오에 태양이 얼마나 높이 뜨는지, 도(°) 단위.', type: 'number', min: 15, max: 85, step: 1, default: 62, unit: '°' },
			{ id: 'shadows', label: '구름 그림자', hint: '땅에 드리운 구름 그림자가 얼마나 어두운지.', type: 'number', min: 0, max: 1, step: 0.01, default: 1 },
			{ id: 'cycle', label: '시간 흐름', hint: '끌 때까지 시간대가 저절로 흐릅니다. 하루가 1분.', type: 'toggle', default: false },
			{ id: 'storms', label: '자동 번개', hint: '날씨가 폭풍인 동안 몇 초마다 번개가 칩니다.', type: 'toggle', default: true },
			{
				id: 'quality',
				label: '품질',
				hint: '구름이 쓰는 연산량. 자동은 보통에서 시작해 프레임이 느려지면 낮음으로 내립니다. 바꿔도 재컴파일은 없습니다.',
				type: 'choice',
				options: [
					{ value: 'auto', label: '자동' },
					{ value: 'low', label: '낮음' },
					{ value: 'medium', label: '보통' },
					{ value: 'high', label: '높음' },
				],
				default: 'auto',
			},
		],
		presets: [],
		triggers: [
			{ id: 'strike', label: '번개', hint: '보이는 곳 어딘가에 번개가 치고, 주변 구름이 환하게 밝아집니다.' },
			{ id: 'reset', label: '초기화', hint: '분위기, 모든 슬라이더, 시점을 처음으로 되돌립니다.' },
		],
	},
	credits: [
		{ files: 'assets/', license: 'MIT', source: 'https://github.com/SkyeShark/Eanpa-Sky', author: 'SkyeShark (Eanpa Sky: the sky and weather model, commit a197d3d. Its code only)' },
		{ files: 'assets/', license: 'MIT', source: 'https://github.com/mrdoob/three.js', author: 'three.js authors' },
		{ files: 'thumbs/', license: 'MIT', author: 'Patch (stills of this demo)' },
	],
};
fs.writeFileSync(path.join(here, 'recipe.json'), `${JSON.stringify(recipe, null, '\t')}\n`);
const c = recipe.block.controls;

// The README's controls section comes from the same list, so the two can't disagree.
const cell = (s) => String(s).replace(/\|/g, '\\|');
const range = (x) => (x.type === 'number' ? `${x.min} to ${x.max}${x.unit ?? ''}, default ${x.default}` : x.type === 'choice' ? `${x.options.map((o) => `\`${o.value}\``).join(', ')}; default \`${x.default}\`` : `default ${x.default}`);
const table = (rows) => ['| id | 컨트롤 | 타입 | 범위 | 하는 일 |', '|---|---|---|---|---|', ...rows.map((x) => `| \`${x.id}\` | ${x.label} | ${x.type} | ${cell(range(x))} | ${cell(x.hint)} |`)].join('\n');
const section = [
	'**사람용** (블록 페이지에 보이는 컨트롤):',
	'',
	table(c.filter((x) => x.essential)),
	'',
	`트리거: ${recipe.block.triggers.map((x) => `\`${x.id}\` (${x.label}): ${x.hint}`).join(' ')}`,
	'',
	'**에이전트용** (채널로 조작하는 컨트롤):',
	'',
	table(c.filter((x) => !x.essential)),
].join('\n');
const readme = path.join(here, 'README.md');
if (fs.existsSync(readme)) fs.writeFileSync(readme, fs.readFileSync(readme, 'utf8').replace(/<!-- controls -->[\s\S]*<!-- \/controls -->/, () => `<!-- controls -->\n${section}\n<!-- /controls -->`));
console.log(`recipe.json: ${c.length} controls (${c.filter((x) => x.essential).length} essential), ${recipe.block.triggers.length} triggers`);
