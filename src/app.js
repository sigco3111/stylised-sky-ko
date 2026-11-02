// The block demo: the sky over a lake, with the page's controls. Everything heavy happens before `ready`.
import * as THREE from 'three/webgpu';
import { buildBolt, buildGround, buildRain } from './ground.js';
import { FIRST_MOOD, MOODS } from './moods.js';
import { createStylisedSky } from './stylised-sky.js';

const wait = (ms = 0) => new Promise((go) => setTimeout(go, ms));

/** An adapter, asked for a few times over a few seconds, as a GPU process restarting takes a moment to come back. */
async function findAdapter() {
	if (!navigator.gpu) return null;
	for (const pause of [0, 500, 1500, 3000]) {
		if (pause) await wait(pause);
		const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }).catch(() => null);
		if (adapter) return adapter;
	}
	return null;
}

export async function boot({ block, recipe, times, started, deviceLost }) {
	const canvas = document.getElementById('view');
	const adapter = await findAdapter();
	const params = new URLSearchParams(location.search);
	const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL: !adapter || params.has('webgl') });
	await renderer.init();
	const backend = renderer.backend;
	if (backend.isWebGPUBackend && backend.device) {
		backend.device.lost.then(deviceLost);
		backend.device.addEventListener?.('uncapturederror', (e) => console.warn('gpu error:', e.error?.message));
	}
	canvas.addEventListener('webglcontextlost', (e) => {
		e.preventDefault();
		deviceLost({ message: 'WebGL context lost' });
	});
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 0.88;

	const scene = new THREE.Scene();
	scene.fog = new THREE.Fog(0x8899aa, 1400, 17000);
	const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.5, 32000);
	const fit = () => {
		renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
		renderer.setSize(innerWidth, innerHeight, false);
		camera.aspect = innerWidth / Math.max(1, innerHeight);
		camera.updateProjectionMatrix();
	};
	fit();

	const sky = await createStylisedSky({
		renderer,
		scene,
		camera,
		quality: 'medium',
		reflection: true,
		onProgress: (k, words) => block.progress(k * 0.9, words),
	});
	await wait();
	const sun = new THREE.DirectionalLight(0xffffff, 2);
	const hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 0.5);
	scene.add(sun, hemi);
	sky.applyToLights({ sun, hemi, fog: scene.fog });
	const ground = buildGround(scene, sky);
	const rain = buildRain(scene);
	const bolt = buildBolt(scene);
	block.progress(0.28, 'Laying the ground');
	await wait();

	// ---------------- view ----------------
	const BASE_YAW = Math.atan2(-0.32, 0.95);
	const START = { yaw: BASE_YAW, pitch: 0.13, fov: 58 };
	const view = { ...START, goalYaw: START.yaw, goalPitch: START.pitch, goalFov: START.fov };
	camera.position.copy(ground.eye);
	const look = new THREE.Vector3();
	const placeCamera = () => {
		const cp = Math.cos(view.pitch);
		look.set(Math.sin(view.yaw) * cp, Math.sin(view.pitch), Math.cos(view.yaw) * cp).add(camera.position);
		camera.lookAt(look);
		if (Math.abs(camera.fov - view.fov) > 0.001) {
			camera.fov = view.fov;
			camera.updateProjectionMatrix();
		}
		camera.updateMatrixWorld();
	};
	placeCamera();
	let dragging = null;
	canvas.addEventListener('pointerdown', (e) => {
		dragging = { x: e.clientX, y: e.clientY };
		canvas.setPointerCapture?.(e.pointerId);
		canvas.classList.add('drag');
	});
	canvas.addEventListener('pointermove', (e) => {
		if (!dragging) return;
		const speed = (view.fov / 58) * 0.0032;
		view.goalYaw -= (e.clientX - dragging.x) * speed;
		view.goalPitch = Math.max(-0.32, Math.min(1.45, view.goalPitch + (e.clientY - dragging.y) * speed));
		dragging = { x: e.clientX, y: e.clientY };
	});
	const endDrag = () => {
		dragging = null;
		canvas.classList.remove('drag');
	};
	canvas.addEventListener('pointerup', endDrag);
	canvas.addEventListener('pointercancel', endDrag);
	canvas.addEventListener('wheel', (e) => {
		e.preventDefault();
		view.goalFov = Math.max(18, Math.min(85, view.goalFov * Math.exp(e.deltaY * 0.0012)));
	}, { passive: false });
	addEventListener('resize', () => {
		fit();
		sky.resize();
	});

	// ---------------- what the controls hold ----------------
	const defaults = Object.fromEntries(recipe.block.controls.map((c) => [c.id, c.default]));
	const v = { ...defaults };
	/** A time on its way somewhere after picking a mood. Touching the slider stops it. */
	let timeMove = null;
	let auto = true;
	let slowFor = 0;
	let nextBolt = 6;
	const applyMood = (name, snap) => {
		const m = MOODS[name];
		if (!m) return;
		v.mood = name;
		sky.setWeather(m.weather, snap ? 0.05 : 1.6, snap);
		v.cover = m.cover;
		sky.setCover(m.cover, snap);
		v.wind = m.wind;
		sky.setWind(m.wind);
		v.rain = m.rain;
		sky.setRain(m.rain);
		if (snap) {
			timeMove = null;
			v.time = m.time;
			sky.setTime(m.time);
		} else {
			let d = m.time - sky.time;
			if (d > 12) d -= 24;
			if (d < -12) d += 24;
			timeMove = { from: sky.time, by: d, t: 0, length: 1.8 };
			v.time = m.time;
		}
		nextBolt = 2.5;
	};
	const strike = () => {
		const a = view.yaw + (Math.random() - 0.5) * 1.0;
		const r = 1200 + Math.random() * 3000;
		const x = camera.position.x + Math.sin(a) * r;
		const z = camera.position.z + Math.cos(a) * r;
		const base = sky.uniforms.start.value + 40;
		const from = new THREE.Vector3(x + (Math.random() - 0.5) * 300, base, z + (Math.random() - 0.5) * 300);
		bolt.strike(from, new THREE.Vector3(x, 0, z), camera.position);
		sky.flash(from, 1.2);
	};
	const set = (id, value) => {
		if (v[id] === value && id !== 'mood') return;
		v[id] = value;
		if (id === 'mood') {
			applyMood(value, false);
			block.state({ time: v.time, cover: v.cover, wind: v.wind, rain: v.rain });
		} else if (id === 'time') {
			timeMove = null;
			sky.setTime(value);
		} else if (id === 'cover') sky.setCover(value);
		else if (id === 'wind') sky.setWind(value);
		else if (id === 'wind_dir') sky.setWind(v.wind, value);
		else if (id === 'rain') sky.setRain(value);
		else if (id === 'puffs') sky.setPuffs(value);
		else if (id === 'detail') sky.setDetail(value);
		else if (id === 'depth') sky.setCloudHeight(value);
		else if (id === 'paint') sky.setPaint(value);
		else if (id === 'sun_arc') sky.state.elMax = value;
		else if (id === 'shadows') sky.uniforms.shadowStrength.value = value;
		else if (id === 'quality') {
			auto = value === 'auto';
			slowFor = 0;
			sky.setQuality(auto ? 'medium' : value);
		}
	};
	const reset = () => {
		for (const id of ['wind_dir', 'puffs', 'detail', 'depth', 'paint', 'sun_arc', 'shadows', 'cycle', 'storms', 'quality']) set(id, defaults[id]);
		applyMood(FIRST_MOOD, false);
		view.goalYaw = START.yaw;
		view.goalPitch = START.pitch;
		view.goalFov = START.fov;
		block.state({ ...defaults });
	};
	sky.setWind(defaults.wind, defaults.wind_dir);
	applyMood(FIRST_MOOD, true);

	// ---------------- one frame ----------------
	let paused = false;
	let last = performance.now();
	const windVec = new THREE.Vector3();
	const rainTint = new THREE.Color();
	const drawn = { frames: 0 };
	const frame = (dt) => {
		const k = 1 - Math.exp(-dt * 12);
		view.yaw += (view.goalYaw - view.yaw) * k;
		view.pitch += (view.goalPitch - view.pitch) * k;
		view.fov += (view.goalFov - view.fov) * k;
		placeCamera();
		if (timeMove) {
			timeMove.t += dt / timeMove.length;
			const s = Math.min(1, timeMove.t);
			sky.setTime(timeMove.from + timeMove.by * s * s * (3 - 2 * s));
			if (s >= 1) timeMove = null;
		} else if (v.cycle) {
			v.time = (v.time + dt * 0.4) % 24;
			sky.setTime(v.time);
			if (drawn.frames % 15 === 0) block.state({ time: Number(v.time.toFixed(2)) });
		}
		if (v.storms && sky.state.weather === 'storm' && !paused) {
			nextBolt -= dt;
			if (nextBolt <= 0) {
				nextBolt = 4 + Math.random() * 7;
				strike();
			}
		}
		sky.update(dt);
		const f = sky.uniforms.flash.value;
		bolt.update(f);
		sky.applyToLights({ sun, hemi, fog: scene.fog });
		ground.update({ windKnots: v.wind, fog: sky.fogColor, sun, hemi });
		const r = (v.wind_dir * Math.PI) / 180;
		windVec.set(Math.sin(r) * v.wind, 0, Math.cos(r) * v.wind);
		rainTint.copy(sky.fogColor).multiplyScalar(1.1).addScalar(0.05 + f * 0.3);
		rain.update(dt, sky.rain, windVec, rainTint);
		// The mirror pass is only for the lake: looking well above the horizon it can rest.
		const halfFov = (view.fov * Math.PI) / 360;
		const water = view.pitch - halfFov < 0.03;
		sky.render({ water });
		if (water) ground.renderMirror(renderer, camera);
		renderer.render(scene, camera);
		drawn.frames++;
	};

	// ---------------- warm up, behind the cover ----------------
	bolt.update(1);
	rain.update(0, 0.5, windVec, rainTint);
	bolt.strike(new THREE.Vector3(0, 700, 2000), new THREE.Vector3(0, 0, 2000), camera.position);
	await sky.warm(scene);
	times.compiled = Math.round(performance.now() - started);
	await wait();
	const gpuDone = async () => {
		if (backend.device) await backend.device.queue.onSubmittedWorkDone();
		await new Promise((go) => requestAnimationFrame(go));
	};
	// The clouds' history fills here, and each kind of draw happens once: the first frames also draw the rain and a bolt.
	for (let i = 0; i < 24; i++) {
		if (i < 2) {
			sky.flash(new THREE.Vector3(0, 700, 2000), 0);
			frame(1 / 60);
			bolt.mesh.visible = true;
			bolt.update(1);
			rain.mesh.visible = true;
			renderer.render(scene, camera);
		} else frame(1 / 60);
		if (i % 4 === 0) await gpuDone();
		block.progress(0.9 + (i / 24) * 0.08, 'Settling the clouds');
	}
	bolt.update(0);
	times.warmed = Math.round(performance.now() - started);
	// The settled view under the page's loader for a little before ready, as showing a covered canvas costs a frame.
	document.getElementById('cover')?.remove();
	document.getElementById('credit').hidden = false;
	document.getElementById('tip').hidden = false;
	let steady = 0;
	let before = performance.now();
	for (let i = 0; i < 240 && (i < 20 || steady < 12); i++) {
		frame(1 / 60);
		await new Promise((go) => requestAnimationFrame(go));
		const t = performance.now();
		steady = t - before < 40 ? steady + 1 : 0;
		before = t;
	}
	if (backend.device) await backend.device.queue.onSubmittedWorkDone();

	// ---------------- run ----------------
	last = performance.now();
	const loop = () => {
		requestAnimationFrame(loop);
		if (paused) return;
		const t = performance.now();
		const dt = Math.min(0.1, (t - last) / 1000);
		last = t;
		frame(dt);
		if (auto) {
			// A long stretch of slow frames steps the clouds down once. That compiles nothing.
			slowFor = dt > 0.026 ? slowFor + dt : Math.max(0, slowFor - dt);
			if (slowFor > 2) {
				auto = false;
				sky.setQuality('low');
			}
		}
	};
	requestAnimationFrame(loop);
	times.ready = Math.round(performance.now() - started);
	block.ready();
	console.log('[stylised-sky] ready', JSON.stringify(times), backend.isWebGPUBackend ? 'webgpu' : 'webgl2');

	return {
		renderer,
		scene,
		ground,
		sky,
		camera,
		view,
		values: v,
		set,
		trigger(id) {
			if (id === 'strike') strike();
			else if (id === 'reset') reset();
		},
		visible(on) {
			paused = !on;
			if (on) last = performance.now();
		},
		frame,
		reset,
		strike,
	};
}
