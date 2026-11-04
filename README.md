---
kind: effect
engine: three
---

# Stylised sky

A painted-looking sky for three.js games: soft cumulus with a time of day, weather that morphs, and clouds' shadows on your ground. It loads in about 2 seconds, with nothing to download but code.

It's the sky and clouds of [Eanpa Sky](https://github.com/SkyeShark/Eanpa-Sky) by SkyeShark (MIT), lifted out of its engine: the palette through the day, the cloud shapes and the way they catch the light. One file, `src/stylised-sky.js`, runs on three's WebGPU renderer and on its WebGL 2 fallback. There are no textures to fetch: the noise it needs is baked in the browser at startup. In the live demo, pick a mood, drag to look round, scroll to zoom, and move the time, cover, wind and rain.

Sky model: Eanpa Sky by SkyeShark (MIT), its code only. Code here is MIT, and there are no art files beyond stills of the demo.

## What this owns

- **Renderer:** WebGPU, and it takes yours: `createStylisedSky({ renderer, scene, camera })` wants an initialised `WebGPURenderer`. On `WebGLRenderer` it fails with `TypeError: Cannot read properties of undefined (reading 'replace')`. The demo can force `WebGPURenderer`'s WebGL backend, which wasn't run with other blocks.
- **Frame loop:** It doesn't draw the frame. Call `sky.update(dt)` and `sky.render()`, which draws the clouds into its own targets, then your own `renderer.render(scene, camera)`.
- **three:** `package.json` pins 0.186.1. It imports `three/webgpu` and `three/tsl`, and no other library has to match.
- **Copy:** `src/stylised-sky.js`.
- **Elsewhere:** `createStylisedSky` adds a dome to your `scene`, with `depthWrite: false` and `renderOrder` -100, so a host's own sky drawn later covers it, as forests' did.

## Use it in a game

Copy `src/stylised-sky.js` into your game. It needs `three` 0.186 and nothing else.

```js
import * as THREE from 'three/webgpu';
import { createStylisedSky } from './stylised-sky.js';

const renderer = new THREE.WebGPURenderer({ antialias: true });
await renderer.init();
renderer.setSize(innerWidth, innerHeight);
document.body.append(renderer.domElement);
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x8899aa, 1400, 17000);
const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.5, 32000);
camera.position.set(0, 6, 0);
camera.rotation.x = 0.25;

const sky = await createStylisedSky({ renderer, scene, camera, quality: 'medium' });
const sun = new THREE.DirectionalLight();
const hemi = new THREE.HemisphereLight();
scene.add(sun, hemi);
sky.applyToLights({ sun, hemi, fog: scene.fog }); // the first call tells it which light is the sun

// Your ground: cloud shadows fall on its sun light. Call this before the material is first drawn.
const groundMaterial = new THREE.MeshStandardNodeMaterial({ color: 0x55803a, roughness: 1 });
sky.receiveCloudShadows(groundMaterial);
scene.add(new THREE.Mesh(new THREE.CircleGeometry(9000, 64).rotateX(-Math.PI / 2), groundMaterial));

sky.setTime(17.4);          // hours, 0 to 24
sky.setCover(0.4, true);    // 0 clear, about 0.4 scattered cumulus, 1 a closed deck; true: at once
sky.setWind(16);            // metres a second

await sky.warm(scene);      // compiles every pass: do this behind your loading screen

let last = performance.now();
renderer.setAnimationLoop((now) => {
	sky.update((now - last) / 1000);
	last = now;
	sky.applyToLights({ sun, hemi, fog: scene.fog });
	sky.render();           // draws the clouds into their own targets: call it before the scene
	renderer.render(scene, camera);
});
```

Call `sky.resize()` after you resize the renderer.

### What else it does

| Call | What it does |
|---|---|
| `sky.setWeather('storm', 20)` | `clear`, `fair`, `overcast`, `rain` or `storm`, morphing over that many seconds. Nothing compiles. Set `sky.setCover` to go with it: the demo's Storm is 0.74 |
| `sky.rain` | How much rain the weather wants now, 0 to 1. The block doesn't draw rain itself; `buildRain` in `src/ground.js` is a small one to copy |
| `sky.flash(position, 1)` | Lights the clouds from inside around a world position, for lightning. `buildBolt` in `src/ground.js` draws a bolt |
| `sky.setQuality('low')` | `low`, `medium` or `high`. It only changes how many steps and how big a picture, so it compiles nothing and can change mid-game |
| `sky.shadowNode(positionWorld)` | The cloud shadow as a TSL number, 1 in the clear, for your own materials. It's two texture reads |
| `sky.setPuffs(x)`, `sky.setDetail(x)`, `sky.setCloudHeight(x)`, `sky.setPaint(x)` | Bigger or smaller clouds, softer or busier edges, a taller layer, and flat painted bands of light |
| `createStylisedSky({ reflection: true })` and `sky.waterNode(direction, offset)` | Clouds for mirrored rays, for still water. `src/ground.js` shows it on the demo's lake |

## What it's bad at

- **Flying through or above the clouds.** The clouds are a shell seen from below. A camera above about 700 m gets wrong pictures, and it can't enter one. For a flight game, use a real volumetric sky.
- **Realism.** The clouds are soft and painted, and don't have the fine detail of a physically based sky. Patch's realistic clouds block is the one for that.
- **It's not free on the GPU.** It's a ray march on every cloud pixel, at reduced size. Weak integrated graphics will want `low`, and it hasn't been tried on one yet.
- **Sudden jumps.** A history collects the clouds over about ten frames, so an instant change of cover or time takes a moment to settle. Moving the view doesn't smear.
- **Storms are stylised.** There's dark cloud, rain and a flash, but no shelf cloud or rain shafts in the distance, and the sky doesn't light up evenly as in a real storm.
- **No reflections or image-based light for your materials.** It sets a sun, a hemisphere light and fog. Shiny things won't mirror the clouds unless you use `waterNode`.
- **Rain doesn't wet anything.** The original's wet surfaces aren't in this block.

## What made it slow, and what changed

Eanpa Sky's own demo is a whole first-person world, and most of its wait is that world, not the sky. A cold first visit took 70.9 s and 199 MB here (RTX 4090 with other work on the card, staged by its own loading messages). Its notes record 77.8 s and 132 s on a 5090 laptop, and about 345 MB.

| Its stage | Time | Here |
|---|---|---|
| Downloading and building the world: terrain, temple, plants, arms | 21 s, 194 MB | Gone. The sky needs no files |
| Loading the sky and weather code | 2 s | One small file |
| Preparing clouds | 5 s | About 1 s for every shader in the demo, ground included |
| Preparing local reflections | 11 s | Gone |
| Surface lighting and weather: every world material compiled again with wetness and cloud shadows | 27 s | Gone. Shadows are two texture reads, and wet surfaces aren't in this block |
| Finishing the first frame | 4 s | Under 1 s, with the clouds' history filled first |

And the sky itself got cheaper to run and to change:

- **Shader size.** Loops written in JavaScript are unrolled into the shader, so its cloud shader is 169,000 characters by its own count. Here every loop runs on the GPU, and how long it runs is a uniform, so changing quality compiles nothing.
- **Light.** A 3D light volume rebuilt by compute a few times a second became a few taps towards the sun for each lit step, reading only the big shapes.
- **Passes.** Three cloud passes a pixel with no history became one pass with moving noise, gathered over a few frames. That is also what removes the speckled edges.
- **High cloud.** Four noise functions a pixel became three reads of a baked map.
- **Shadows.** A shadow map rendered by a cloud march at 10 Hz became two texture reads in the receiving material.
- **Left out.** The ring world, the sealed storm canopy, reflection bakes, the moon and star textures, and the cirrus atlas.

**Measured here,** on an RTX 4090 with another game and other work on the card:

| | Eanpa Sky's demo, first visit | This block, first visit |
|---|---|---|
| Time until it shows | 70.9 s | 2.9 s (2.1 s from the page starting, 1.1 s of it shaders) |
| Download | 199 MB | 0.9 MB, 0.26 MB of it gzipped code |
| Largest shader | 169,309 characters, by its own notes | 14,899 characters |
| Worst frame in the first 30 s | not measured | 18 ms |

Both were a new browser profile on a 2560 x 1400 window, but the graphics driver keeps its own shader cache, so a real first visit on another PC can take longer. The sky's own passes took roughly 0.5 to 1.3 ms a frame at 1080p here, too noisy with the card shared to rank the quality levels by. That says little about a laptop: **it has only been run on this card.**

<!-- measured -->

## Controls

<!-- controls -->
**For people** (the block page shows these):

| id | Control | Type | Range | What it does |
|---|---|---|---|---|
| `mood` | Mood | choice | `day`, `dawn`, `dusk`, `wisps`, `overcast`, `storm`, `night`; default `dusk` | A time of day, a cloud cover, a wind and a weather together. Picking one moves the sliders. |
| `time` | Time of day | number | 0 to 24h, default 17.45 | Hours, 0 to 24: the sun, the moon, the colours of the sky and the light on the clouds. |
| `cover` | Cloud cover | number | 0 to 1, default 0.3 | From a clear sky, through scattered cumulus at about half, to a closed deck. |
| `wind` | Wind | number | 0 to 80 m/s, default 12 | How fast the clouds drift and churn, and how much the lake ripples. At 0 the sky holds still. |
| `rain` | Rain | number | 0 to 1, default 0 | Streaks of rain round the camera. It rains from any sky, so pair it with cover for a real downpour. |

Triggers: `strike` (Lightning): A strike somewhere in view, with the clouds lit round it. `reset` (Reset): Everything back to the start: the mood, every slider and the view.

**For agents** (steer them over the channel):

| id | Control | Type | Range | What it does |
|---|---|---|---|---|
| `wind_dir` | Wind direction | number | 0 to 360°, default 200 | Where the wind blows to, in degrees. |
| `puffs` | Puff size | number | 0.4 to 2.5, default 1 | Above 1, more and smaller clouds; below 1, fewer and bigger. |
| `detail` | Edge detail | number | 0.4 to 2.5, default 1 | The scale of the erosion that carves the clouds: low is soft and rounded, high is busy and torn. |
| `depth` | Cloud depth | number | 0.5 to 2.5×, default 1 | How tall the cloud layer is, against what the weather asks for. |
| `paint` | Painted bands | number | 0 to 1, default 0 | Bands the light on the clouds into flat steps, for a more drawn look. |
| `sun_arc` | Sun height | number | 15 to 85°, default 62 | How high the sun gets at noon, in degrees. |
| `shadows` | Cloud shadows | number | 0 to 1, default 1 | How dark the clouds' shadows lie on the land. |
| `cycle` | Time passing | toggle | default false | Runs the time of day on its own, a day in a minute, until turned off. |
| `storms` | Lightning by itself | toggle | default true | Strikes every few seconds while the weather is a storm. |
| `quality` | Quality | choice | `auto`, `low`, `medium`, `high`; default `auto` | How much the clouds spend. Auto starts at Medium and drops to Low if frames run slow. Changing it compiles nothing. |
<!-- /controls -->

## Build the demo

```bash
npm install
npm run build
```

`npm run dev` serves it at http://127.0.0.1:5497/. `tools/` has what checked it: `cost.mjs` (GPU time at each quality), `ends.mjs` (every control at both ends, and Reset), `make-thumbs.mjs` (the pictures).

## Licences

Code MIT. The sky model is from Eanpa Sky by SkyeShark, MIT, at commit `a197d3d`: only its code was used, and no audio, textures or models from that repo are here or in this repo's history. Its licence is in `licenses/LICENSE-eanpa-sky.txt`. three.js is MIT. Every picture in `thumbs/` and `cover.jpg` is a still of this demo. The demo's land, trees, water, rain and lightning (`src/ground.js`) are Patch's, made in code. There's no sound.
