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
				label: 'Mood',
				hint: 'A time of day, a cloud cover, a wind and a weather together. Picking one moves the sliders.',
				type: 'choice',
				options: Object.entries(MOODS).map(([value, m]) => ({ value, label: m.label, ...(images ? { image: `thumbs/moods/${value}.webp` } : {}) })),
				default: FIRST_MOOD,
				essential: true,
			},
			{ id: 'time', label: 'Time of day', hint: 'Hours, 0 to 24: the sun, the moon, the colours of the sky and the light on the clouds.', type: 'number', min: 0, max: 24, step: 0.05, default: first.time, unit: 'h', essential: true },
			{ id: 'cover', label: 'Cloud cover', hint: 'From a clear sky, through scattered cumulus at about half, to a closed deck.', type: 'number', min: 0, max: 1, step: 0.01, default: first.cover, essential: true },
			{ id: 'wind', label: 'Wind', hint: 'How fast the clouds drift and churn, and how much the lake ripples. At 0 the sky holds still.', type: 'number', min: 0, max: 80, step: 1, default: first.wind, unit: ' m/s', essential: true },
			{ id: 'rain', label: 'Rain', hint: 'Streaks of rain round the camera. It rains from any sky, so pair it with cover for a real downpour.', type: 'number', min: 0, max: 1, step: 0.01, default: first.rain, essential: true },
			{ id: 'wind_dir', label: 'Wind direction', hint: 'Where the wind blows to, in degrees.', type: 'number', min: 0, max: 360, step: 1, default: 200, unit: '°' },
			{ id: 'puffs', label: 'Puff size', hint: 'Above 1, more and smaller clouds; below 1, fewer and bigger.', type: 'number', min: 0.4, max: 2.5, step: 0.05, default: 1 },
			{ id: 'detail', label: 'Edge detail', hint: 'The scale of the erosion that carves the clouds: low is soft and rounded, high is busy and torn.', type: 'number', min: 0.4, max: 2.5, step: 0.05, default: 1 },
			{ id: 'depth', label: 'Cloud depth', hint: 'How tall the cloud layer is, against what the weather asks for.', type: 'number', min: 0.5, max: 2.5, step: 0.05, default: 1, unit: '×' },
			{ id: 'paint', label: 'Painted bands', hint: 'Bands the light on the clouds into flat steps, for a more drawn look.', type: 'number', min: 0, max: 1, step: 0.01, default: 0 },
			{ id: 'sun_arc', label: 'Sun height', hint: 'How high the sun gets at noon, in degrees.', type: 'number', min: 15, max: 85, step: 1, default: 62, unit: '°' },
			{ id: 'shadows', label: 'Cloud shadows', hint: "How dark the clouds' shadows lie on the land.", type: 'number', min: 0, max: 1, step: 0.01, default: 1 },
			{ id: 'cycle', label: 'Time passing', hint: 'Runs the time of day on its own, a day in a minute, until turned off.', type: 'toggle', default: false },
			{ id: 'storms', label: 'Lightning by itself', hint: 'Strikes every few seconds while the weather is a storm.', type: 'toggle', default: true },
			{
				id: 'quality',
				label: 'Quality',
				hint: 'How much the clouds spend. Auto starts at Medium and drops to Low if frames run slow. Changing it compiles nothing.',
				type: 'choice',
				options: [
					{ value: 'auto', label: 'Auto' },
					{ value: 'low', label: 'Low' },
					{ value: 'medium', label: 'Medium' },
					{ value: 'high', label: 'High' },
				],
				default: 'auto',
			},
		],
		presets: [],
		triggers: [
			{ id: 'strike', label: 'Lightning', hint: 'A strike somewhere in view, with the clouds lit round it.' },
			{ id: 'reset', label: 'Reset', hint: 'Everything back to the start: the mood, every slider and the view.' },
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
const table = (rows) => ['| id | Control | Type | Range | What it does |', '|---|---|---|---|---|', ...rows.map((x) => `| \`${x.id}\` | ${x.label} | ${x.type} | ${cell(range(x))} | ${cell(x.hint)} |`)].join('\n');
const section = [
	'**For people** (the block page shows these):',
	'',
	table(c.filter((x) => x.essential)),
	'',
	`Triggers: ${recipe.block.triggers.map((x) => `\`${x.id}\` (${x.label}): ${x.hint}`).join(' ')}`,
	'',
	'**For agents** (steer them over the channel):',
	'',
	table(c.filter((x) => !x.essential)),
].join('\n');
const readme = path.join(here, 'README.md');
if (fs.existsSync(readme)) fs.writeFileSync(readme, fs.readFileSync(readme, 'utf8').replace(/<!-- controls -->[\s\S]*<!-- \/controls -->/, () => `<!-- controls -->\n${section}\n<!-- /controls -->`));
console.log(`recipe.json: ${c.length} controls (${c.filter((x) => x.essential).length} essential), ${recipe.block.triggers.length} triggers`);
