// A stylised sky for three.js (WebGPU renderer, and its WebGL 2 fallback): painted-looking clouds, a day and a night,
// weather that morphs, and clouds' shadows on your ground. The block's one file: copy it into a game.
//
// The look and its maths are lifted from Eanpa Sky's engine/sky_system.js and engine/weather_system.js by SkyeShark (MIT):
// the time-of-day palette, the cloud density (a 1/f weather map carved by two stages of erosion), the Mie phase, the Beer
// and powder lighting, the sun and moon arcs and the weather states. See LICENSE-eanpa-sky in licenses/.
//
// What made the original slow is left out or replaced (README, "What made it slow"):
//   - loops written in JavaScript are unrolled into the shader. Here every loop is a loop on the GPU, and its length is a
//     uniform, so changing quality changes no shader and compiles nothing.
//   - a 3D light volume rebuilt by compute a few times a second, replaced by a few cheap taps towards the sun per lit step.
//   - three passes per pixel with no history, replaced by one jittered pass and a history that collects it across frames.
//   - a whole cloud pass for the cloud shadow map, replaced by two texture reads in the receiving material.
//   - the ring world, the sealed storm canopy, its reflection bakes, the PNG atlases, the moon and star textures.
import * as THREE from 'three/webgpu';
import {
	Break, Fn, If, Loop, abs, clamp, cos, dot, exp, float, floor, fract, getViewPosition, int, length, log2, max, min, mix, normalize, positionWorld, pow, screenCoordinate, screenUV, sin, smoothstep, sqrt, texture, texture3D, uniform, vec2, vec3, vec4,
} from 'three/tsl';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const lerp = (a, b, k) => a + (b - a) * k;
const saturate = (x) => Math.max(0, Math.min(1, x));
const R_EARTH = 6371000;

// ---------------- time-of-day palette, keyed on the sun's elevation in degrees (Eanpa's table) ----------------
const TOD = [
	{ el: -18, zen: [0.01, 0.016, 0.055], hor: [0.03, 0.042, 0.1], sun: [0.55, 0.65, 0.95], int: 0.0, star: 1.0 },
	{ el: -6, zen: [0.022, 0.045, 0.115], hor: [0.19, 0.12, 0.19], sun: [1.0, 0.42, 0.22], int: 0.1, star: 0.85 },
	{ el: 0, zen: [0.07, 0.13, 0.3], hor: [0.92, 0.42, 0.2], sun: [1.0, 0.48, 0.23], int: 0.55, star: 0.25 },
	{ el: 8, zen: [0.14, 0.3, 0.66], hor: [1.0, 0.62, 0.36], sun: [1.0, 0.69, 0.41], int: 1.6, star: 0.0 },
	{ el: 30, zen: [0.15, 0.38, 0.82], hor: [0.62, 0.78, 0.92], sun: [1.0, 0.94, 0.86], int: 2.6, star: 0.0 },
	{ el: 70, zen: [0.11, 0.35, 0.8], hor: [0.6, 0.76, 0.9], sun: [1.0, 1.0, 1.0], int: 3.0, star: 0.0 },
];
const mixArr = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
function paletteAt(el) {
	if (el <= TOD[0].el) return TOD[0];
	if (el >= TOD[TOD.length - 1].el) return TOD[TOD.length - 1];
	for (let i = 0; i < TOD.length - 1; i++) {
		const a = TOD[i];
		const b = TOD[i + 1];
		if (el >= a.el && el <= b.el) {
			const k = (el - a.el) / (b.el - a.el);
			return { zen: mixArr(a.zen, b.zen, k), hor: mixArr(a.hor, b.hor, k), sun: mixArr(a.sun, b.sun, k), int: lerp(a.int, b.int, k), star: lerp(a.star, b.star, k) };
		}
	}
	return TOD[2];
}

// ---------------- weather: everything that morphs, in numbers (Eanpa's weather table, cut to what shows here) ----------------
/** Each state's look. `cover` (0 to 1) stays apart, because a game or a slider sets it on its own. */
export const WEATHER = {
	clear: { weatherFloor: 0, largeA: 3.0, finalMul: 0.2, height: 520, start: 700, wispOn: 0.3, wispThreshold: 0.5, wispStrength: 0.85, wispOpacity: 1.1, wispFilament: 0.92, wispTint: [1.02, 0.99, 0.94], sunDim: 1, cloudRadiance: 1, grey: 0, dark: 1, horMul: 1, celestial: 1, rain: 0 },
	fair: { weatherFloor: 0, largeA: 3.0, finalMul: 0.2, height: 520, start: 700, wispOn: 0.2, wispThreshold: 0.5, wispStrength: 0.7, wispOpacity: 1.45, wispFilament: 0.18, wispTint: [1, 0.98, 0.94], sunDim: 1, cloudRadiance: 1, grey: 0, dark: 1, horMul: 1, celestial: 1, rain: 0 },
	overcast: { weatherFloor: 0.04, largeA: 2.0, finalMul: 0.2, height: 300, start: 620, wispOn: 0.9, wispThreshold: 0.3, wispStrength: 0.9, wispOpacity: 0.96, wispFilament: 0.05, wispTint: [0.66, 0.74, 0.84], sunDim: 0.45, cloudRadiance: 0.5, grey: 0.6, dark: 0.62, horMul: 0.85, celestial: 0.3, rain: 0 },
	rain: { weatherFloor: 0.08, largeA: 2.0, finalMul: 0.26, height: 320, start: 560, wispOn: 0.94, wispThreshold: 0.27, wispStrength: 0.96, wispOpacity: 1.0, wispFilament: 0.12, wispTint: [0.57, 0.66, 0.78], sunDim: 0.3, cloudRadiance: 0.65, grey: 0.75, dark: 0.55, horMul: 0.75, celestial: 0.15, rain: 0.7 },
	storm: { weatherFloor: 0.24, largeA: 4.0, finalMul: 0.34, height: 950, start: 550, wispOn: 0.52, wispThreshold: 0.36, wispStrength: 0.88, wispOpacity: 1.05, wispFilament: 0.32, wispTint: [0.53, 0.6, 0.7], sunDim: 0.18, cloudRadiance: 0.45, grey: 0.8, dark: 0.42, horMul: 0.6, celestial: 0.1, rain: 1 },
};
const KEYS = Object.keys(WEATHER.fair).filter((k) => k !== 'wispTint');

/** How much each quality spends: the march's steps, the taps towards the sun and how big the cloud picture is. No shader changes. */
export const QUALITY = {
	low: { steps: 20, lightSteps: 3, scale: 1 / 3, maxHeight: 360, mirrorSteps: 12, history: 0.1 },
	medium: { steps: 28, lightSteps: 4, scale: 1 / 2, maxHeight: 540, mirrorSteps: 18, history: 0.1 },
	high: { steps: 48, lightSteps: 6, scale: 1 / 1.5, maxHeight: 900, mirrorSteps: 28, history: 0.12 },
};

// ---------------- noise, baked once: no files to load ----------------
const yieldNow = () => new Promise((go) => setTimeout(go));

/** A tiling 1/f weather map: .r the macro coverage, .g the puffs, .b long streaks for the high cloud. */
async function bakeWeather(size = 512) {
	const data = new Uint8Array(size * size * 4);
	const hash = (i, j, s) => {
		let n = (i * 374761393 + j * 668265263 + s * 2246822519) >>> 0;
		n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0;
		return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
	};
	const fbm = (u, v, seed, cellsU, cellsV = cellsU, octaves = 5) => {
		let val = 0;
		let amp = 0.5;
		let norm = 0;
		let cu = cellsU;
		let cv = cellsV;
		for (let o = 0; o < octaves; o++) {
			const x = u * cu;
			const y = v * cv;
			const xi = Math.floor(x);
			const yi = Math.floor(y);
			const xf = x - xi;
			const yf = y - yi;
			const sx = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
			const sy = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
			const x0 = ((xi % cu) + cu) % cu;
			const y0 = ((yi % cv) + cv) % cv;
			const x1 = (x0 + 1) % cu;
			const y1 = (y0 + 1) % cv;
			const a = hash(x0, y0, seed + o);
			const b = hash(x1, y0, seed + o);
			const c = hash(x0, y1, seed + o);
			const d = hash(x1, y1, seed + o);
			const n0 = a + (b - a) * sx;
			const n1 = c + (d - c) * sx;
			val += amp * (n0 + (n1 - n0) * sy);
			norm += amp;
			amp *= 0.55;
			cu *= 2;
			cv *= 2;
		}
		return Math.min(1, Math.max(0, (val / norm - 0.5) * 1.9 + 0.5));
	};
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const k = (y * size + x) * 4;
			const u = x / size;
			const v = y / size;
			data[k] = fbm(u, v, 11, 8) * 255;
			data[k + 1] = fbm(u, v, 137, 32) * 255;
			data[k + 2] = fbm(u, v, 311, 4, 48, 4) * 255;
			data[k + 3] = 255;
		}
		if (y % 64 === 63) await yieldNow();
	}
	const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
	tex.minFilter = THREE.LinearMipmapLinearFilter;
	tex.magFilter = THREE.LinearFilter;
	tex.generateMipmaps = true;
	tex.needsUpdate = true;
	tex.name = 'sky-weather';
	return tex;
}

/** Three octaves of tiling value noise in one 3D texture, so an erosion lookup is one read and not three. */
async function bakeErosion(size = 96) {
	const data = new Uint8Array(size * size * size);
	const lattice = (cells, seed) => {
		const t = new Float32Array(cells * cells * cells);
		let s = seed >>> 0;
		for (let i = 0; i < t.length; i++) {
			s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
			t[i] = s / 4294967296;
		}
		return t;
	};
	const octaves = [
		{ cells: 12, amp: 0.5, t: lattice(12, 987654321) },
		{ cells: 24, amp: 0.25, t: lattice(24, 123456789) },
		{ cells: 48, amp: 0.125, t: lattice(48, 555555555) },
	];
	let k = 0;
	for (let z = 0; z < size; z++) {
		for (let y = 0; y < size; y++) {
			for (let x = 0; x < size; x++) {
				let f = 0;
				for (const { cells, amp, t } of octaves) {
					const fx = (x / size) * cells;
					const fy = (y / size) * cells;
					const fz = (z / size) * cells;
					const ix = Math.floor(fx);
					const iy = Math.floor(fy);
					const iz = Math.floor(fz);
					const dx = fx - ix;
					const dy = fy - iy;
					const dz = fz - iz;
					const sx = dx * dx * (3 - 2 * dx);
					const sy = dy * dy * (3 - 2 * dy);
					const sz = dz * dz * (3 - 2 * dz);
					const x1 = (ix + 1) % cells;
					const y1 = (iy + 1) % cells;
					const z1 = (iz + 1) % cells;
					const at = (a, b, c) => t[a + cells * (b + cells * c)];
					const n00 = at(ix, iy, iz) + (at(x1, iy, iz) - at(ix, iy, iz)) * sx;
					const n10 = at(ix, y1, iz) + (at(x1, y1, iz) - at(ix, y1, iz)) * sx;
					const n01 = at(ix, iy, z1) + (at(x1, iy, z1) - at(ix, iy, z1)) * sx;
					const n11 = at(ix, y1, z1) + (at(x1, y1, z1) - at(ix, y1, z1)) * sx;
					const n0 = n00 + (n10 - n00) * sy;
					const n1 = n01 + (n11 - n01) * sy;
					f += amp * (n0 + (n1 - n0) * sz);
				}
				data[k++] = Math.min(255, f * 255 + 0.5);
			}
		}
		if (z % 16 === 15) await yieldNow();
	}
	const tex = new THREE.Data3DTexture(data, size, size, size);
	tex.format = THREE.RedFormat;
	tex.type = THREE.UnsignedByteType;
	tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
	tex.minFilter = tex.magFilter = THREE.LinearFilter;
	tex.generateMipmaps = false;
	tex.unpackAlignment = 1;
	tex.name = 'sky-erosion';
	tex.needsUpdate = true;
	return tex;
}

/**
 * Makes the sky. Add `sky.dome` to your scene (`createStylisedSky` does, given `scene`), and each frame call
 * `sky.update(dt)` and then `sky.render()` before you render the scene.
 *
 * @param {object} o
 * @param {THREE.WebGPURenderer} o.renderer an initialised renderer
 * @param {THREE.Scene} [o.scene] the dome is added to it
 * @param {THREE.PerspectiveCamera} o.camera the view the sky follows
 * @param {'low'|'medium'|'high'} [o.quality]
 * @param {boolean} [o.reflection] also draw clouds for mirrored rays, for still water (`sky.waterNode`)
 */
export async function createStylisedSky({ renderer, scene, camera, quality = 'medium', reflection = false, onProgress }) {
	const say = onProgress ?? (() => {});
	say(0.05, 'Making noise');
	const weatherTex = await bakeWeather();
	say(0.2, 'Making noise');
	const erosionTex = await bakeErosion();
	const weatherNode = texture(weatherTex);
	const erosionNode = texture3D(erosionTex);

	// ---------------- uniforms ----------------
	const u = {
		origin: uniform(V(0, 2, 0)),
		projInv: uniform(new THREE.Matrix4()),
		camWorld: uniform(new THREE.Matrix4()),
		steps: uniform(28, 'int'),
		lightSteps: uniform(4, 'int'),
		mirror: uniform(0),
		jitter: uniform(0),
		jitterK: uniform(1),
		evolve: uniform(0),
		displacement: uniform(V(0, 0, 0)),
		sunDir: uniform(V(0, 0.3, 1).normalize()),
		moonDir: uniform(V(0, -1, 0)),
		lightDir: uniform(V(0, 0.3, 1).normalize()),
		lightColor: uniform(V(1, 0.9, 0.8)),
		ambSky: uniform(V(0.2, 0.5, 1)),
		ambGround: uniform(V(0.8, 0.8, 0.8)),
		zenith: uniform(V(0.15, 0.38, 0.82)),
		horizon: uniform(V(0.62, 0.78, 0.92)),
		sunColor: uniform(V(1, 0.95, 0.9)),
		sunDiscI: uniform(48),
		starFade: uniform(0),
		moonK: uniform(0),
		celestial: uniform(1),
		largeT: uniform(0.42),
		largeA: uniform(3),
		weatherT: uniform(0.3),
		finalMul: uniform(0.2),
		wScale: uniform(1),
		dScale: uniform(1),
		start: uniform(700),
		height: uniform(520),
		lightK: uniform(1),
		lightMass: uniform(0.4),
		radiance: uniform(1),
		grey: uniform(0),
		tint: uniform(V(1, 1, 1)),
		wispOn: uniform(0.28),
		wispThreshold: uniform(0.48),
		wispStrength: uniform(0.7),
		wispOpacity: uniform(1.45),
		wispFilament: uniform(0.18),
		wispColor: uniform(V(0.8, 0.8, 0.8)),
		fadeDist: uniform(26000),
		flash: uniform(0),
		strike: uniform(V(0, 0, 0)),
		shadowStrength: uniform(1),
		paint: uniform(0),
	};

	// ---------------- cloud field ----------------
	const atmoHeight = (p) => p.y.mul(p.y.add(2 * R_EARTH)).add(p.x.mul(p.x)).add(p.z.mul(p.z)).div(length(vec3(p.x, p.y.add(R_EARTH), p.z)).add(R_EARTH));
	// The far root of a ray against a shell above a curved Earth, stable at planet scale (Eanpa's comment on it says why).
	const shellFar = (org, dir, s) => {
		const ocy = org.y.add(R_EARTH);
		const b = dot(dir, vec3(org.x, ocy, org.z)).mul(2);
		const c = org.x.mul(org.x).add(org.z.mul(org.z)).add(org.y.sub(s).mul(org.y.add(s).add(2 * R_EARTH)));
		const D = max(b.mul(b).sub(c.mul(4)), 0);
		return c.mul(-2).div(b.add(sqrt(D)));
	};
	const weatherL = (uvNode) => weatherNode.sample(uvNode).level(0).r;
	const weatherS = (uvNode) => weatherNode.sample(uvNode).level(0).g;
	// One read of the baked FBM. Its 96 texels hold 12 cells of the first octave, so a coordinate of 12 is one tile.
	const erosion = (p) => erosionNode.sample(p.div(12)).level(0).r;
	const massAt = (p, h) => {
		const ch = h.sub(u.start).div(u.height).clamp(0, 1);
		const p1 = p.sub(vec3(u.displacement.x, 0, u.displacement.z));
		const lw = clamp(weatherL(vec2(p1.z, p1.x).mul(u.wScale.mul(-0.00005))).sub(u.largeT).mul(u.largeA), 0, 2);
		const p2 = p1.add(vec3(u.displacement.z.negate().mul(0.4), 0, u.displacement.x.mul(0.4)));
		const w2 = max(weatherS(vec2(p2.z, p2.x).mul(u.wScale.mul(0.00005)).add(vec2(0.37, 0.11))).sub(u.weatherT), 0).div(0.72);
		const weather = lw.mul(w2).mul(smoothstep(0, 0.5, ch)).mul(float(1).sub(smoothstep(0.5, 1, ch)));
		const shape = pow(weather.max(1e-6), float(0.3).add(float(1.5).mul(smoothstep(0.2, 0.5, ch))));
		return lw.mul(u.finalMul).mul(min(shape.mul(3.5), 1));
	};
	const phaseMie = (c) => {
		const p1 = c.add(0.8194068);
		return exp(c.mul(-65).sub(55)).mul(9.805233e-6)
			.add(exp(p1.mul(p1).mul(-83.70334)).mul(0.1388198))
			.add(exp(c.mul(7.810083)).mul(2.054747e-3))
			.add(exp(c.mul(-4.552125e-12)).mul(2.600563e-2));
	};
	const rayDir = () => normalize(u.camWorld.mul(vec4(normalize(getViewPosition(screenUV, float(0.5), u.projInv)), 0)).xyz);

	const cloudFrag = Fn(() => {
		const raw = rayDir().toVar();
		// The mirror pass draws what still water sees: the same sky along each ray turned upward.
		const dir = vec3(raw.x, mix(raw.y, abs(raw.y), u.mirror), raw.z).toVar();
		const org = u.origin;
		const out = vec4(0, 0, 0, 0).toVar();
		const wanted = dir.y.greaterThan(0.008).and(u.mirror.lessThan(0.5).or(raw.y.lessThan(0)));
		If(wanted, () => {
			const t0 = shellFar(org, dir, u.start).toVar();
			const t1 = min(shellFar(org, dir, u.start.add(u.height)), u.fadeDist.mul(1.1)).toVar();
			const col = vec3(0).toVar();
			const Tr = float(1).toVar();
			If(t0.lessThan(u.fadeDist).and(u.finalMul.greaterThan(0.0001)), () => {
				const stepS = max(t1.sub(t0), 0).div(float(u.steps)).toVar();
				const mu = dot(u.lightDir, dir).toVar();
				const phaseF = phaseMie(mu).toVar();
				// Interleaved noise moved along a golden-ratio step each frame: the history below collects it.
				const ign = fract(float(52.9829189).mul(fract(dot(screenCoordinate.xy, vec2(0.06711056, 0.00583715)))));
				const jit = mix(float(0.5), fract(ign.add(u.jitter)), u.jitterK).toVar();
				const p = org.add(dir.mul(t0.add(stepS.mul(jit)))).toVar();
				const stepL = clamp(u.height.mul(2.2), 380, 700).div(float(u.lightSteps)).toVar();
				// Eanpa's floor here is 0.008, which leaves clouds near the sun dead grey. A little more lets them glow, which is the look.
				const scatter = mix(float(0.09), float(1), float(1).sub(smoothstep(0, 0.96, mu))).toVar();
				const keyChroma = u.lightColor.div(max(max(u.lightColor.x, u.lightColor.y), u.lightColor.z).max(0.0001)).toVar();
				const t = t0.add(stepS.mul(jit)).toVar();
				Loop({ start: int(0), end: u.steps, type: 'int' }, () => {
					If(Tr.lessThanEqual(0.01), () => {
						Break();
					});
					const h = atmoHeight(p).toVar();
					const ch = h.sub(u.start).div(u.height).clamp(0, 1).toVar();
					const p1 = p.sub(vec3(u.displacement.x, 0, u.displacement.z)).toVar();
					const lw = clamp(weatherL(vec2(p1.z, p1.x).mul(u.wScale.mul(-0.00005))).sub(u.largeT).mul(u.largeA), 0, 2).toVar();
					const density = float(0).toVar();
					// Most of a sparse sky is empty at this first read, which is what makes the rest affordable.
					If(lw.greaterThan(0), () => {
						const p2 = p1.add(vec3(u.displacement.z.negate().mul(0.4), 0, u.displacement.x.mul(0.4))).toVar();
						const w2 = max(weatherS(vec2(p2.z, p2.x).mul(u.wScale.mul(0.00005)).add(vec2(0.37, 0.11))).sub(u.weatherT), 0).div(0.72);
						const weather = lw.mul(w2).mul(smoothstep(0, 0.5, ch)).mul(float(1).sub(smoothstep(0.5, 1, ch))).toVar();
						If(weather.greaterThan(0.0005), () => {
							const shape = pow(weather.max(1e-6), float(0.3).add(float(1.5).mul(smoothstep(0.2, 0.5, ch))));
							const p3 = p2.add(vec3(u.evolve.mul(12.3), 0, 0)).toVar();
							const den1 = max(shape.sub(erosion(p3.mul(u.dScale.mul(0.01))).mul(0.7)), 0).toVar();
							If(den1.greaterThan(0), () => {
								// The fine erosion turns to its mean far off, where its 20 m features only ever showed as speckle.
								const near = float(1).sub(smoothstep(5000, 16000, t)).toVar();
								const fine = mix(float(0.4375), erosion(p3.add(vec3(0, u.evolve.mul(15.2), 0)).mul(u.dScale.mul(0.05))), near);
								density.assign(lw.mul(u.finalMul).mul(min(max(den1.sub(fine.mul(0.2)), 0).mul(5), 1)));
							});
						});
					});
					If(density.greaterThan(0), () => {
						// A few taps of the erosion-free mass towards the light, instead of Eanpa's light volume.
						const od = float(0).toVar();
						Loop({ start: int(0), end: u.lightSteps, type: 'int' }, ({ i }) => {
							const q = p.add(u.lightDir.mul(stepL.mul(float(i).add(0.5))));
							od.addAssign(massAt(q, q.y));
						});
						const tau = stepL.mul(od).mul(u.lightMass).toVar();
						const beers = exp(tau.negate()).add(exp(tau.negate().mul(0.1)).mul(scatter).mul(0.5)).add(exp(tau.negate().mul(0.02)).mul(scatter).mul(0.4));
						const powdered = float(0.05).add(pow(min(density.mul(8.5), 1).max(1e-6), float(0.3).add(ch.mul(5.5))).mul(1.5));
						const lit = mix(powdered, float(1), clamp(od.mul(u.lightMass).mul(0.4), 0, 1));
						const intensity = beers.mul(phaseF).mul(mix(float(1), lit, u.lightK));
						const clearAmb = u.ambSky.mul(float(0.5).add(ch.mul(0.6))).add(u.ambGround.mul(max(float(1).sub(ch.mul(2)), 0)));
						const ambFlat = mix(clearAmb, vec3(dot(clearAmb, vec3(0.2126, 0.7152, 0.0722))).mul(keyChroma), u.grey);
						// With no sun to shape it, a storm's form comes from how much cloud lies over each point.
						const amb = ambFlat.mul(mix(float(1), exp(od.mul(u.lightMass).mul(u.height).mul(0.0042).negate()).mul(3.4).add(0.3), u.grey));
						// Lightning lights the cloud from inside, around where it struck.
						const bolt = vec3(0.75, 0.82, 1).mul(u.flash).mul(exp(length(p.xz.sub(u.strike.xz)).mul(-0.0006))).mul(float(1.15).sub(ch.mul(0.7)));
						const radiance = amb.add(u.lightColor.mul(intensity).mul(u.celestial)).mul(u.radiance).add(bolt).mul(density);
						const trStep = exp(density.mul(stepS).negate());
						col.addAssign(Tr.mul(radiance.sub(radiance.mul(trStep)).div(max(density, 1e-6))));
						Tr.assign(Tr.mul(trStep));
					});
					p.assign(p.add(dir.mul(stepS)));
					t.addAssign(stepS);
				});
			});
			// The high layer: Eanpa's four FBMs per pixel become a few reads of the baked map, with its mips for the distance.
			const wispA = float(0).toVar();
			If(u.wispOn.greaterThan(0.0001), () => {
				const hitT = shellFar(org, dir, u.start.add(u.height).add(1000)).toVar();
				const range = float(1).sub(smoothstep(u.fadeDist.mul(0.55), u.fadeDist.mul(1.25), hitT));
				const w = org.add(dir.mul(hitT)).sub(vec3(u.displacement.x, 0, u.displacement.z)).toVar();
				const lod = clamp(log2(hitT.mul(0.00035)), 0, 5).toVar();
				const warp = weatherNode.sample(vec2(w.x, w.z).mul(0.000031)).level(lod.add(1)).toVar();
				const wuv = vec2(w.x, w.z).mul(0.00011).add(warp.rg.sub(0.45).mul(0.07)).toVar();
				const sheetN = weatherNode.sample(wuv).level(lod).toVar();
				const patch = weatherNode.sample(vec2(w.z, w.x).mul(0.000023).add(vec2(0.31, 0.77))).level(lod.add(2)).r;
				const sheet = smoothstep(u.wispThreshold, u.wispThreshold.add(0.34), sheetN.r.mul(0.6).add(sheetN.g.mul(0.4))).mul(smoothstep(0.3, 0.62, patch));
				const fibres = smoothstep(0.36, 0.92, sheetN.b).mul(smoothstep(0.26, 0.6, patch));
				const shapeW = mix(sheet, fibres, smoothstep(0.35, 0.85, u.wispFilament));
				wispA.assign(min(shapeW.mul(u.wispOn).mul(u.wispStrength).mul(u.wispOpacity), 0.88).mul(range));
				col.addAssign(Tr.mul(u.wispColor).mul(wispA).mul(u.radiance));
			});
			const distFade = float(1).sub(smoothstep(u.fadeDist.mul(0.35), u.fadeDist, t0));
			const fade = distFade.mul(smoothstep(0.008, 0.06, dir.y));
			const cover = float(1).sub(Tr.mul(float(1).sub(wispA)));
			out.assign(vec4(col.mul(u.tint).mul(fade), cover.mul(fade)));
		});
		return out;
	});
	const cloudMaterial = new THREE.NodeMaterial();
	cloudMaterial.name = 'Stylised sky clouds';
	cloudMaterial.fragmentNode = cloudFrag();
	cloudMaterial.depthTest = cloudMaterial.depthWrite = false;
	cloudMaterial.blending = THREE.NoBlending;
	cloudMaterial.toneMapped = false;
	const cloudQuad = new THREE.QuadMesh(cloudMaterial);

	// ---------------- history: one noisy pass a frame adds up to many, and turning the view keeps it ----------------
	const makeTarget = (name) => {
		const target = new THREE.RenderTarget(4, 4, { depthBuffer: false, type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
		target.texture.name = name;
		target.texture.colorSpace = THREE.NoColorSpace;
		return target;
	};
	const rawTarget = makeTarget('sky-clouds-raw');
	const history = [makeTarget('sky-clouds-a'), makeTarget('sky-clouds-b')];
	const mirrorRaw = reflection ? makeTarget('sky-mirror-raw') : null;
	const mirrorHistory = reflection ? [makeTarget('sky-mirror-a'), makeTarget('sky-mirror-b')] : null;
	let mirrorCurrent = 0;
	let mirrorOk = false;
	let current = 0;
	const rawNode = texture(rawTarget.texture);
	const historyNode = texture(history[1].texture);
	const prevViewProj = uniform(new THREE.Matrix4());
	const historyK = uniform(0.1);
	const texel = uniform(new THREE.Vector2(1, 1));
	const resolveFrag = Fn(() => {
		const dir = rayDir();
		// The sky is at infinity: where this direction was on screen last frame depends only on the view's turn.
		const clip = prevViewProj.mul(vec4(dir, 0)).toVar();
		const prev = clip.xy.div(clip.w.max(1e-5)).mul(vec2(0.5, -0.5)).add(0.5).toVar();
		const c = rawNode.sample(screenUV).level(0).toVar();
		const n = rawNode.sample(screenUV.add(vec2(0, texel.y))).level(0).toVar();
		const s = rawNode.sample(screenUV.sub(vec2(0, texel.y))).level(0).toVar();
		const e = rawNode.sample(screenUV.add(vec2(texel.x, 0))).level(0).toVar();
		const w = rawNode.sample(screenUV.sub(vec2(texel.x, 0))).level(0).toVar();
		const lo = min(min(min(min(c, n), s), e), w);
		const hi = max(max(max(max(c, n), s), e), w);
		const mid = lo.add(hi).mul(0.5).toVar();
		const half = hi.sub(lo).mul(0.5).mul(1.6).add(0.002).toVar();
		const old = clamp(historyNode.sample(prev).level(0), mid.sub(half), mid.add(half));
		const inside = clip.w.greaterThan(0).and(prev.x.greaterThan(0)).and(prev.x.lessThan(1)).and(prev.y.greaterThan(0)).and(prev.y.lessThan(1));
		const k = historyK.toVar();
		If(inside.not(), () => {
			k.assign(1);
		});
		return mix(old, c.add(n).add(s).add(e).add(w).mul(0.2).mul(0.5).add(c.mul(0.5)), k);
	});
	const resolveMaterial = new THREE.NodeMaterial();
	resolveMaterial.name = 'Stylised sky history';
	resolveMaterial.fragmentNode = resolveFrag();
	resolveMaterial.depthTest = resolveMaterial.depthWrite = false;
	resolveMaterial.blending = THREE.NoBlending;
	resolveMaterial.toneMapped = false;
	const resolveQuad = new THREE.QuadMesh(resolveMaterial);

	// ---------------- the dome: gradient, sun, moon and stars at full size, the cloud picture over them ----------------
	const skyColor = (dir) => {
		const upK = pow(clamp(dir.y.mul(1.35).add(0.02), 0, 1), 0.82);
		const col = mix(u.horizon, u.zenith, upK).toVar();
		const mu = dot(dir, u.sunDir).toVar();
		col.addAssign(u.sunColor.mul(pow(max(mu, 0), 6)).mul(0.35).mul(float(1).sub(upK)));
		// Stars: a cell's random point, only by night. Patch's in place of Eanpa's star map.
		If(u.starFade.greaterThan(0.002), () => {
			const ra = u.evolve.mul(0.004);
			const d = vec3(dir.x.mul(cos(ra)).sub(dir.z.mul(sin(ra))), dir.y, dir.x.mul(sin(ra)).add(dir.z.mul(cos(ra)))).mul(190).toVar();
			const cell = floor(d);
			const f = fract(d).sub(0.5);
			const hv = fract(cell.mul(vec3(0.1031, 0.103, 0.0973))).toVar();
			hv.addAssign(dot(hv, vec3(hv.y, hv.z, hv.x).add(33.33)));
			const rnd = fract(hv.x.add(hv.y).mul(hv.z));
			const bright = smoothstep(0.93, 1, rnd).mul(smoothstep(0.42, 0.0, length(f)));
			col.addAssign(vec3(0.85, 0.92, 1).mul(bright.mul(bright)).mul(u.starFade).mul(1.8).mul(smoothstep(0, 0.12, dir.y)));
		});
		// The moon: a disc with its phase from the sun, and the baked map for its seas.
		If(u.moonDir.y.greaterThan(-0.05), () => {
			const cosA = dot(dir, u.moonDir).toVar();
			If(cosA.greaterThan(0.9992), () => {
				const disc = smoothstep(0.99925, 0.99935, cosA);
				const right = normalize(vec3(u.moonDir.z, 0, u.moonDir.x.negate()));
				const up = vec3(u.moonDir.y.mul(right.z).negate(), u.moonDir.z.mul(right.x).sub(u.moonDir.x.mul(right.z)), u.moonDir.y.mul(right.x));
				const lx = dot(dir, right).div(0.0375);
				const ly = dot(dir, up).div(0.0375);
				const nz = sqrt(max(float(1).sub(lx.mul(lx)).sub(ly.mul(ly)), 0));
				const seas = weatherNode.sample(vec2(lx, ly).mul(0.07).add(vec2(0.2, 0.6))).level(0).r;
				const n = right.mul(lx).add(up.mul(ly)).add(u.moonDir.mul(nz.negate()));
				const lit = max(dot(n, u.sunDir), 0.04);
				col.addAssign(vec3(0.82, 0.86, 0.95).mul(mix(float(0.55), float(1.1), seas)).mul(lit).mul(disc).mul(mix(float(0.5), float(1.15), u.moonK)).mul(u.celestial));
			});
		});
		const disc = smoothstep(0.99995, 0.999985, mu);
		col.addAssign(u.sunColor.mul(disc).mul(u.sunDiscI).mul(u.celestial));
		col.addAssign(u.sunColor.mul(pow(max(mu, 0), 900)).mul(3).mul(u.celestial));
		col.addAssign(u.sunColor.mul(pow(max(mu, 0), 60)).mul(0.22).mul(u.celestial));
		return col;
	};
	const cloudsOut = texture(history[0].texture);
	const domeColor = Fn(() => {
		const dir = normalize(positionWorld.sub(u.origin));
		const bg = skyColor(dir).toVar();
		const cloud = cloudsOut.sample(screenUV).level(0).toVar();
		const rgb = cloud.rgb.toVar();
		// `paint` bands the clouds' light a little: a flatter, more drawn look for a game that wants one.
		If(u.paint.greaterThan(0.001), () => {
			const l = max(dot(rgb, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
			const bands = floor(pow(l, 0.5).mul(7).add(0.5)).div(7);
			rgb.assign(mix(rgb, rgb.mul(bands.mul(bands).div(l)), u.paint));
		});
		return bg.mul(float(1).sub(cloud.a)).add(rgb);
	});
	const domeMaterial = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
	domeMaterial.name = 'Stylised sky dome';
	domeMaterial.colorNode = domeColor();
	const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), domeMaterial);
	dome.name = 'Stylised sky';
	dome.renderOrder = -100;
	dome.frustumCulled = false;
	if (scene) scene.add(dome);

	// ---------------- what the sky hands your materials ----------------
	const mirrorNode = reflection ? texture(mirrorHistory[0].texture) : null;
	/** A TSL scalar, 1 in the clear and less under cloud, for a world position: two texture reads, no shadow map. */
	const shadowNode = (p) => {
		const dy = max(u.lightDir.y, 0.05);
		const q = p.add(u.lightDir.mul(u.start.add(u.height.mul(0.5)).sub(p.y).div(dy)));
		const od = massAt(q, u.start.add(u.height.mul(0.5))).mul(u.height.mul(0.75).div(dy));
		const daylight = smoothstep(-0.005, 0.012, u.lightDir.y);
		return float(1).sub(float(1).sub(exp(od.negate())).mul(u.shadowStrength).mul(daylight));
	};
	const fog = { color: new THREE.Color(), bright: 1 };
	const wrapped = new Map();
	let sunLight = null;

	// ---------------- JS state ----------------
	const now = { ...WEATHER.fair, wispTint: [...WEATHER.fair.wispTint], cover: 0.5 };
	const goal = { ...WEATHER.fair, wispTint: [...WEATHER.fair.wispTint], cover: 0.5 };
	const state = { hours: 12, azBase: 1.9, elMax: 62, azSpan: 0.32, wind: 18, windDir: 0, windBias: 1, palette: paletteAt(40), elDeg: 40, weather: 'fair', morph: 1.5, rainK: 0 };
	const tier = { ...QUALITY[quality] };
	const motion = { x: 0, z: 0 };
	const sunDir = V(0, 1, 0);
	const moonDir = V(0, -1, 0);
	let frame = 0;
	let flashLeft = 0;
	let flashBig = 0;
	let frameOk = false;
	const prevMat = new THREE.Matrix4();
	const viewRot = new THREE.Matrix4();

	const arcAz = (h, span) => {
		const w = ((h % 24) + 24) % 24;
		if (w >= 6 && w < 18) return ((w - 12) / 12) * span * Math.PI;
		const n = (w - 18 + 24) % 24;
		return span * Math.PI * 0.5 + (n / 12) * (2 - span) * Math.PI;
	};
	const greyed = (rgb, s, g, d) => {
		const l = (rgb[0] * 0.35 + rgb[1] * 0.5 + rgb[2] * 0.15) * s;
		return rgb.map((v) => (v + (l - v) * g) * d * s);
	};
	function applyPalette() {
		const dayK = (state.hours - 6) / 12;
		const el = Math.sin(dayK * Math.PI) * state.elMax;
		const az = state.azBase + arcAz(state.hours, state.azSpan);
		const elR = (el * Math.PI) / 180;
		sunDir.set(Math.cos(elR) * Math.cos(az), Math.sin(elR), Math.cos(elR) * Math.sin(az)).normalize();
		u.sunDir.value.copy(sunDir);
		const mel = (Math.sin(((state.hours + 6) / 12) * Math.PI) * 48 * Math.PI) / 180;
		const maz = state.azBase + arcAz(state.hours + 12, state.azSpan);
		moonDir.set(Math.cos(mel) * Math.cos(maz), Math.sin(mel), Math.cos(mel) * Math.sin(maz)).normalize();
		u.moonDir.value.copy(moonDir);
		const pal = paletteAt(el);
		state.palette = pal;
		state.elDeg = el;
		const nightK = saturate((-el - 2) / 8);
		u.moonK.value = nightK;
		const g = now.grey;
		const d = now.dark;
		u.zenith.value.set(...greyed(pal.zen, 1, g, d));
		// Low sun runs warmer than Eanpa's table: tone mapping washes its colours pale otherwise.
		const warm = saturate(1 - (el - 2) / 14) * saturate((el + 8) / 8);
		u.horizon.value.set(...greyed([pal.hor[0], pal.hor[1] * (1 - warm * 0.2), pal.hor[2] * (1 - warm * 0.42)], now.horMul, g, d));
		u.sunColor.value.set(...pal.sun);
		u.starFade.value = pal.star * (1 - saturate(now.cover * 1.1 - 0.5)) * (1 - g);
		u.celestial.value = now.celestial;
		u.sunDiscI.value = 48 * Math.max(0.02, 1 - g * 0.98);
		// The clouds' key is the sun by day and the moon by night.
		const moonUp = saturate(moonDir.y / 0.12);
		const moonGain = 0.8 * nightK * moonUp * moonUp * (3 - 2 * moonUp);
		const sunGain = pal.int * 5.4 * (1 - nightK);
		const moonTint = [0.45, 0.55, 0.85];
		const warmKey = 1 + warm * 0.9;
		u.lightColor.value.set(pal.sun[0] ** warmKey * sunGain + moonTint[0] * moonGain, pal.sun[1] ** warmKey * sunGain + moonTint[1] * moonGain, pal.sun[2] ** warmKey * sunGain + moonTint[2] * moonGain);
		u.lightDir.value.copy(nightK > 0.5 ? moonDir : sunDir);
		const ambDay = V(...pal.zen).multiplyScalar(0.34 * (0.25 + pal.int * 0.55));
		u.ambSky.value.copy(ambDay.lerp(V(0.04, 0.05, 0.09), nightK));
		// Light bouncing up off the horizon's haze: warm undersides at dawn and dusk.
		u.ambGround.value.set(...pal.hor).multiplyScalar(Math.max(0.008, pal.int * 0.05 * (1 - nightK)));
		const pk = Math.max(pal.sun[0], pal.sun[1], pal.sun[2], 1e-4);
		const k = 0.22 + pal.int * 0.34;
		u.wispColor.value.set(...pal.sun.map((v) => lerp(v, v / pk, 0.62) * k)).multiply(V(...now.wispTint));
	}
	function applyCloudState() {
		const c = saturate(now.cover);
		// The cover slider, on the scale of Eanpa's presets: 0.5 is its Cumulus, 0.85 its Storm and 1 a closed deck.
		u.largeT.value = 0.82 * (1 - c);
		u.weatherT.value = Math.max(now.weatherFloor, 0.36 * (1 - c ** 2.5));
		const some = saturate(c / 0.08);
		u.finalMul.value = now.finalMul * some;
		u.largeA.value = now.largeA;
		u.start.value = now.start;
		u.height.value = now.height * state.heightK;
		u.radiance.value = Math.max(0.1, now.cloudRadiance);
		u.grey.value = now.grey;
		u.wispOn.value = now.wispOn * some;
		u.wispThreshold.value = now.wispThreshold;
		u.wispStrength.value = now.wispStrength;
		u.wispOpacity.value = now.wispOpacity;
		u.wispFilament.value = now.wispFilament;
	}
	state.heightK = 1;

	const sky = {
		dome,
		uniforms: u,
		/** The scene fog's colour after `applyToLights`, for materials that draw their own fog. */
		fogColor: fog.color,
		state,
		/** Hours, 0 to 24: the sun, the moon, the sky's colours and the clouds' light all follow. */
		setTime(hours) {
			state.hours = ((hours % 24) + 24) % 24;
		},
		/** How much of the sky is cloud, 0 to 1. 0.5 is scattered cumulus, 1 a closed deck. Fades over the weather's morph time. */
		setCover(cover, snap = false) {
			goal.cover = saturate(cover);
			if (snap) now.cover = goal.cover;
		},
		/** Metres a second, and where it blows to in degrees. The clouds drift and churn in step with it. */
		setWind(speed, degrees = state.windDir) {
			state.wind = Math.max(0, speed);
			state.windDir = degrees;
		},
		/** `clear`, `fair`, `overcast`, `rain` or `storm`: morphs over `seconds`. */
		setWeather(name, seconds = 1.5, snap = false) {
			const w = WEATHER[name];
			if (!w) return;
			Object.assign(goal, w, { wispTint: [...w.wispTint], cover: goal.cover });
			state.weather = name;
			state.morph = Math.max(0.05, seconds);
			if (snap) {
				const cover = now.cover;
				Object.assign(now, w, { wispTint: [...w.wispTint], cover });
			}
		},
		/** Overrides one number of the current weather for good, like `rain`: see WEATHER for the names. */
		setLook(key, value) {
			if (key in goal) goal[key] = value;
		},
		setRain(amount) {
			goal.rain = saturate(amount);
		},
		/** The size of the puffs: above 1 smaller and more of them, below 1 fewer and bigger. */
		setPuffs(scale) {
			u.wScale.value = scale;
		},
		/** The erosion's size: above 1 a finer, busier edge, below 1 a softer one. */
		setDetail(scale) {
			u.dScale.value = scale;
		},
		setCloudHeight(k) {
			state.heightK = k;
		},
		setPaint(amount) {
			u.paint.value = saturate(amount);
		},
		setQuality(name) {
			if (!QUALITY[name]) return;
			Object.assign(tier, QUALITY[name]);
			sky.resize();
		},
		/** How much rain to draw right now, 0 to 1, for your own rain or wet ground. */
		get rain() {
			return now.rain;
		},
		get time() {
			return state.hours;
		},
		get sunDir() {
			return sunDir;
		},
		get moonDir() {
			return moonDir;
		},
		/** Lights the clouds from inside. `strike` is a world position; `big` above 1 for a close one. */
		flash(strike = null, big = 1) {
			if (strike) u.strike.value.copy(strike);
			flashLeft = 0.45;
			flashBig = big;
		},
		/** The cloud shadow as a TSL scalar, for your own material. */
		shadowNode,
		/** Sky behind everything, for a direction: gradient, sun, moon and stars, without clouds. */
		skyColorNode: skyColor,
		/**
		 * What still water sees, as a TSL colour, given the reflected direction and a small offset of the screen position
		 * for ripples. Needs `reflection: true`.
		 */
		waterNode(reflected, offset) {
			const c = mirrorNode.sample(screenUV.add(offset)).level(0).toVar();
			return skyColor(reflected).mul(float(1).sub(c.a)).add(c.rgb);
		},
		/** Makes a PBR material's sun light fall under the clouds' shadow. Call it once per material, before it's first drawn. */
		receiveCloudShadows(material) {
			if (wrapped.has(material)) return;
			const setup = material.setupLightingModel ?? (material.isMeshPhysicalMaterial ? THREE.MeshPhysicalNodeMaterial.prototype.setupLightingModel : THREE.MeshStandardNodeMaterial.prototype.setupLightingModel);
			const original = material.setupLightingModel;
			// A material with no node of its own counts as unchanging, and three stops refreshing its uniforms. This one's change every frame.
			if (!material.aoNode) material.aoNode = float(1);
			material.setupLightingModel = function (builder) {
				const model = setup.call(this, builder);
				const direct = model.direct;
				model.direct = function (lightData, lightBuilder) {
					if (lightData.lightNode?.light === sunLight) lightData = { ...lightData, lightColor: lightData.lightColor.mul(shadowNode(positionWorld)) };
					return direct.call(this, lightData, lightBuilder);
				};
				return model;
			};
			wrapped.set(material, original);
			material.needsUpdate = true;
		},
		/** Puts your lights and fog in step with the sky. Pass any of them; call it each frame while the sky changes. */
		applyToLights({ sun, hemi, fog: sceneFog } = {}) {
			const pal = state.palette;
			const nightK = u.moonK.value;
			const dim = 0.32 + Math.max(0.02, now.sunDim) * 0.68;
			if (sun) {
				sunLight = sun;
				const ml = [0.5, 0.6, 0.95];
				sun.color.setRGB(lerp(pal.sun[0], ml[0], nightK), lerp(pal.sun[1], ml[1], nightK), lerp(pal.sun[2], ml[2], nightK));
				const moonUp = saturate(moonDir.y / 0.12);
				sun.intensity = Math.max(0.08, pal.int * 1.15) * (1 - nightK) * now.sunDim + 0.35 * nightK * moonUp * moonUp * (3 - 2 * moonUp);
				const d = nightK > 0.5 ? moonDir : sunDir;
				sun.position.copy(d).multiplyScalar(1000);
			}
			if (hemi) {
				const zen = u.zenith.value;
				const hor = u.horizon.value;
				hemi.color.setRGB(zen.x, zen.y, zen.z).multiplyScalar(2.2);
				hemi.groundColor.setRGB(hor.x * 0.25, hor.y * 0.2, hor.z * 0.18);
				hemi.intensity = (0.25 + pal.int * 0.25 + nightK * 0.06) * dim + u.flash.value * 0.8;
			}
			if (sceneFog?.color) {
				const h = u.horizon.value;
				sceneFog.color.setRGB(h.x, h.y, h.z).multiplyScalar(0.5 + pal.int * 0.12);
				fog.color.copy(sceneFog.color);
			}
			return pal;
		},
		/** Call each frame with the seconds since the last. */
		update(dt) {
			const step = Math.min(0.1, Math.max(0, dt));
			const k = 1 - Math.exp(-step * (3 / state.morph));
			for (const key of KEYS) now[key] += (goal[key] - now[key]) * k;
			now.cover += (goal.cover - now.cover) * k;
			now.wispTint = now.wispTint.map((v, i) => v + (goal.wispTint[i] - v) * k);
			const r = (state.windDir * Math.PI) / 180;
			motion.x += Math.sin(r) * state.wind * step;
			motion.z += Math.cos(r) * state.wind * step;
			u.displacement.value.set(motion.x, 0, motion.z);
			u.evolve.value += step * (state.wind / 10.3);
			if (flashLeft > 0) {
				flashLeft -= step;
				const s = saturate(flashLeft / 0.45);
				// Two beats, as lightning's return strokes flicker.
				u.flash.value = flashBig * 5 * s * s * (0.6 + 0.4 * Math.sin(s * 34));
			} else u.flash.value = 0;
			applyPalette();
			applyCloudState();
		},
		resize() {
			const size = renderer.getDrawingBufferSize(new THREE.Vector2());
			const scale = Math.min(tier.scale, tier.maxHeight / Math.max(1, size.y));
			const w = Math.max(16, Math.round(size.x * scale));
			const h = Math.max(16, Math.round(size.y * scale));
			if (rawTarget.width !== w || rawTarget.height !== h) {
				rawTarget.setSize(w, h);
				history[0].setSize(w, h);
				history[1].setSize(w, h);
				frameOk = false;
			}
			if (reflection && mirrorRaw.width !== w >> 1) {
				const mw = Math.max(8, w >> 1);
				const mh = Math.max(8, h >> 1);
				mirrorRaw.setSize(mw, mh);
				mirrorHistory[0].setSize(mw, mh);
				mirrorHistory[1].setSize(mw, mh);
				mirrorOk = false;
			}
		},
		/**
		 * Draws the clouds into their targets. Call before you render the scene, after `update` and with the camera placed.
		 * `water` false skips the mirrored pass when no water is on screen.
		 */
		render({ water = true } = {}) {
			camera.updateMatrixWorld();
			u.projInv.value.copy(camera.projectionMatrixInverse);
			u.camWorld.value.copy(camera.matrixWorld);
			camera.getWorldPosition(u.origin.value);
			dome.position.copy(u.origin.value);
			dome.scale.setScalar(Math.max(10, camera.far * 0.9));
			dome.updateMatrixWorld();
			const savedTarget = renderer.getRenderTarget();
			const savedAutoClear = renderer.autoClear;
			renderer.autoClear = false;
			frame++;
			u.steps.value = tier.steps;
			u.lightSteps.value = tier.lightSteps;
			u.mirror.value = 0;
			u.jitterK.value = 1;
			u.jitter.value = (frame * 0.61803398875) % 1;
			renderer.setRenderTarget(rawTarget);
			cloudQuad.render(renderer);
			// The view's turn alone, as the history is a picture of directions.
			viewRot.copy(camera.matrixWorldInverse);
			viewRot.setPosition(0, 0, 0);
			const thisMat = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, viewRot);
			prevViewProj.value.copy(frameOk ? prevMat : thisMat);
			prevMat.copy(thisMat);
			historyK.value = frameOk ? tier.history : 1;
			texel.value.set(1 / rawTarget.width, 1 / rawTarget.height);
			const next = 1 - current;
			rawNode.value = rawTarget.texture;
			historyNode.value = history[current].texture;
			renderer.setRenderTarget(history[next]);
			resolveQuad.render(renderer);
			current = next;
			cloudsOut.value = history[current].texture;
			frameOk = true;
			if (reflection) {
				if (water) {
					u.steps.value = tier.mirrorSteps;
					u.lightSteps.value = Math.min(3, tier.lightSteps);
					u.mirror.value = 1;
					renderer.setRenderTarget(mirrorRaw);
					cloudQuad.render(renderer);
					historyK.value = mirrorOk ? tier.history : 1;
					texel.value.set(1 / mirrorRaw.width, 1 / mirrorRaw.height);
					const m = 1 - mirrorCurrent;
					rawNode.value = mirrorRaw.texture;
					historyNode.value = mirrorHistory[mirrorCurrent].texture;
					renderer.setRenderTarget(mirrorHistory[m]);
					resolveQuad.render(renderer);
					mirrorCurrent = m;
					mirrorNode.value = mirrorHistory[m].texture;
					mirrorOk = true;
				} else mirrorOk = false;
			}
			renderer.setRenderTarget(savedTarget);
			renderer.autoClear = savedAutoClear;
		},
		/** Compiles every pass before anyone sees it. Await this, with your scene ready, before your first frame. */
		async warm(sceneToWarm) {
			sky.resize();
			sky.update(0);
			say(0.3, 'Building shaders');
			const savedTarget = renderer.getRenderTarget();
			renderer.setRenderTarget(rawTarget);
			await renderer.compileAsync(cloudQuad, cloudQuad.camera);
			say(0.55, 'Building shaders');
			await renderer.compileAsync(resolveQuad, resolveQuad.camera);
			renderer.setRenderTarget(savedTarget);
			say(0.7, 'Building shaders');
			if (sceneToWarm) await renderer.compileAsync(sceneToWarm, camera);
			say(0.85, 'Settling the clouds');
		},
		dispose() {
			if (scene) scene.remove(dome);
			for (const [material, original] of wrapped) {
				if (original === undefined) delete material.setupLightingModel;
				else material.setupLightingModel = original;
				material.needsUpdate = true;
			}
			wrapped.clear();
			dome.geometry.dispose();
			domeMaterial.dispose();
			cloudMaterial.dispose();
			resolveMaterial.dispose();
			cloudQuad.geometry?.dispose?.();
			rawTarget.dispose();
			history[0].dispose();
			history[1].dispose();
			mirrorRaw?.dispose();
			mirrorHistory?.forEach((t) => t.dispose());
			weatherTex.dispose();
			erosionTex.dispose();
		},
	};
	sky.resize();
	sky.update(0);
	return sky;
}
