// The demo's ground, made in code: a still lake in a bowl of low hills with far ridges, and low-poly firs. It's here to show
// the sky off, and isn't part of the block. Everything is one lit material, one water material and one instanced mesh.
import * as THREE from 'three/webgpu';
import { Discard, Fn, If, attribute, screenUV, texture, cameraPosition, cos, cross, dot, float, fract, mix, normalize, positionGeometry, positionWorld, reflect, sin, smoothstep, time, uniform, vec2, vec3, vertexColor } from 'three/tsl';

const hash = (x, y) => {
	const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
	return s - Math.floor(s);
};
const value = (x, y) => {
	const xi = Math.floor(x);
	const yi = Math.floor(y);
	const fx = x - xi;
	const fy = y - yi;
	const sx = fx * fx * (3 - 2 * fx);
	const sy = fy * fy * (3 - 2 * fy);
	const a = hash(xi, yi);
	const b = hash(xi + 1, yi);
	const c = hash(xi, yi + 1);
	const d = hash(xi + 1, yi + 1);
	return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
};
const fbm = (x, y, octaves = 4) => {
	let v = 0;
	let a = 0.5;
	for (let o = 0; o < octaves; o++) {
		v += a * value(x, y);
		x = x * 2.03 + 17.1;
		y = y * 2.03 - 9.2;
		a *= 0.5;
	}
	return v;
};
const smooth = (a, b, x) => {
	const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
	return t * t * (3 - 2 * t);
};

// The lake opens towards the noon sun, along +z and a little -x, with the camera on its near shore.
export const LOOK = new THREE.Vector3(-0.32, 0, 0.95).normalize();
const SIDE = new THREE.Vector3(LOOK.z, 0, -LOOK.x);

function heightAt(x, z) {
	const along = x * LOOK.x + z * LOOK.z;
	const across = x * SIDE.x + z * SIDE.z;
	// A long oval of water from just in front of the camera to the far shore.
	const dz = (along - 620) / 700;
	const dx = across / (360 + along * 0.32);
	const lake = Math.sqrt(dz * dz + dx * dx) + (fbm(x * 0.0052 + 11, z * 0.0052 - 3, 3) - 0.45) * 0.42;
	const shore = smooth(0.82, 1.28, lake);
	const hills = fbm(x * 0.0021 + 3.1, z * 0.0021 - 1.7, 5);
	const swell = fbm(x * 0.00042 + 9.2, z * 0.00042 + 4.1, 3);
	const r = Math.hypot(x, z);
	const ridge = smooth(1500, 5200, r) * (fbm(x * 0.00058 - 5.1, z * 0.00058 + 7.7, 5) ** 2) * 1500;
	return shore * (6 + hills * 95 * smooth(0.95, 2.2, lake) + swell * 70 * smooth(1.1, 3.2, lake)) + ridge - (1 - shore) * 16;
}

/** Builds the ground into `scene`. The sky gives the water its reflection and the land its cloud shadows. */
export function buildGround(scene, sky) {
	const group = new THREE.Group();
	scene.add(group);

	// ---------------- land: rings, tight near the camera and coarse far off, flat shaded ----------------
	const RINGS = 110;
	const SEGS = 180;
	const radius = (i) => 8 + 12000 * (i / RINGS) ** 2.6;
	const pos = [];
	const col = [];
	const grassA = new THREE.Color(0.17, 0.3, 0.1);
	const grassB = new THREE.Color(0.31, 0.38, 0.13);
	const rock = new THREE.Color(0.24, 0.23, 0.22);
	const sand = new THREE.Color(0.55, 0.47, 0.31);
	const c = new THREE.Color();
	const n = new THREE.Vector3();
	const ab = new THREE.Vector3();
	const ac = new THREE.Vector3();
	const vert = (i, j) => {
		const a = (j / SEGS) * Math.PI * 2 + (i % 2) * (Math.PI / SEGS);
		const r = radius(i);
		const x = Math.cos(a) * r;
		const z = Math.sin(a) * r;
		return new THREE.Vector3(x, heightAt(x, z), z);
	};
	const paint = (a, b, d) => {
		ab.subVectors(b, a);
		ac.subVectors(d, a);
		n.crossVectors(ab, ac).normalize();
		if (n.y < 0) {
			n.negate();
			const swap = b;
			b = d;
			d = swap;
		}
		const mx = (a.x + b.x + d.x) / 3;
		const my = (a.y + b.y + d.y) / 3;
		const mz = (a.z + b.z + d.z) / 3;
		const patch = fbm(mx * 0.011, mz * 0.011, 3);
		c.copy(grassA).lerp(grassB, patch);
		c.lerp(rock, smooth(0.92, 0.78, n.y) * 0.9);
		c.lerp(sand, smooth(5.5, 1.2, my));
		const tone = 0.92 + hash(mx, mz) * 0.16;
		for (let v = 0; v < 3; v++) col.push(c.r * tone, c.g * tone, c.b * tone);
		pos.push(a.x, a.y, a.z, b.x, b.y, b.z, d.x, d.y, d.z);
	};
	for (let i = 0; i < RINGS; i++) {
		for (let j = 0; j < SEGS; j++) {
			const a = vert(i, j);
			const b = vert(i, j + 1);
			const d = vert(i + 1, j);
			const e = vert(i + 1, j + 1);
			paint(a, d, b);
			paint(b, d, e);
		}
	}
	const land = new THREE.BufferGeometry();
	land.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	land.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
	land.computeVertexNormals();
	const landMaterial = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
	sky.receiveCloudShadows(landMaterial);
	const landMesh = new THREE.Mesh(land, landMaterial);
	landMesh.frustumCulled = false;
	group.add(landMesh);

	// ---------------- firs: two cones and a trunk, instanced ----------------
	const cone = (r, h, y, shade) => {
		const g = new THREE.ConeGeometry(r, h, 6, 1).toNonIndexed();
		g.translate(0, y, 0);
		g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count * 3).fill(0).map((_, i) => [0.075, 0.17, 0.08][i % 3] * shade), 3));
		g.computeVertexNormals();
		return g;
	};
	const parts = [cone(3.4, 7, 5.4, 0.8), cone(2.5, 5.6, 8.6, 1.05), cone(1.6, 4.2, 11.4, 1.3)];
	const treeGeo = new THREE.BufferGeometry();
	const merge = (name, size) => {
		const out = [];
		for (const p of parts) out.push(...p.attributes[name].array);
		treeGeo.setAttribute(name, new THREE.Float32BufferAttribute(out, size));
	};
	merge('position', 3);
	merge('normal', 3);
	merge('color', 3);
	const treeMaterial = new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
	sky.receiveCloudShadows(treeMaterial);
	const spots = [];
	for (let i = 0; i < 9000 && spots.length < 700; i++) {
		const a = hash(i, 1.3) * Math.PI * 2;
		const r = 60 + 1300 * Math.sqrt(hash(i, 7.7));
		const x = Math.cos(a) * r;
		const z = Math.sin(a) * r;
		const y = heightAt(x, z);
		if (y < 7 || y > 170) continue;
		if (fbm(x * 0.006 + 40, z * 0.006, 2) < 0.46) continue;
		// Nothing tall right in front of the view.
		if (Math.hypot(x, z) < 110 && x * LOOK.x + z * LOOK.z > -10) continue;
		spots.push([x, y, z, 0.75 + hash(i, 3.1) * 0.9, hash(i, 9.9) * 6.28]);
	}
	// A few close by on the near shore, either side of the view, for the sky's scale.
	for (const [along, across, s] of [[-70, 92, 1.5], [-48, 124, 1.15], [-92, 66, 1.05], [-60, -104, 1.6], [-30, -142, 1.2], [-96, -78, 1.0], [-20, 170, 1.3]]) {
		const x = LOOK.x * along + SIDE.x * across;
		const z = LOOK.z * along + SIDE.z * across;
		spots.push([x, Math.max(1, heightAt(x, z)), z, s, along]);
	}
	const trees = new THREE.InstancedMesh(treeGeo, treeMaterial, spots.length);
	const m = new THREE.Matrix4();
	const q = new THREE.Quaternion();
	const up = new THREE.Vector3(0, 1, 0);
	spots.forEach(([x, y, z, s, rot], i) => {
		q.setFromAxisAngle(up, rot);
		m.compose(new THREE.Vector3(x, y - 0.4, z), q, new THREE.Vector3(s, s * (0.9 + (i % 5) * 0.09), s));
		trees.setMatrixAt(i, m);
	});
	trees.frustumCulled = false;
	group.add(trees);

	// ---------------- water: mirrors the whole sky, clouds and all, with a few moving ripples ----------------
	const wind = uniform(0.5);
	const rainOnWater = uniform(0);
	const fogColor = uniform(new THREE.Color());
	// The land's reflection, its own small picture: see the end of this function.
	const mirrorLand = new THREE.RenderTarget(4, 4, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
	mirrorLand.texture.colorSpace = THREE.NoColorSpace;
	const mirrorLandNode = texture(mirrorLand.texture);
	const waterMaterial = new THREE.MeshBasicNodeMaterial({ fog: false });
	const waterColor = Fn(() => {
		const p = positionWorld.xz;
		const view = normalize(positionWorld.sub(cameraPosition)).toVar();
		const dist = positionWorld.sub(cameraPosition).length().toVar();
		// Four sine ripples, cheap, fading out with distance so the far lake lies flat.
		const t = time.mul(wind.mul(1.2).add(0.2));
		const r1 = cos(dot(p, vec2(0.11, 0.07)).add(t.mul(1.1))).mul(0.5);
		const r2 = cos(dot(p, vec2(-0.09, 0.19)).add(t.mul(1.5))).mul(0.3);
		const r3 = cos(dot(p, vec2(0.47, 0.31)).add(t.mul(2.1))).mul(0.14);
		const r4 = sin(dot(p, vec2(-0.71, 0.53)).add(t.mul(2.7))).mul(0.1);
		const size = wind.mul(0.03).add(0.004).add(rainOnWater.mul(0.09)).mul(float(1).sub(smoothstep(40, 1100, dist)));
		const nx = r1.mul(0.11).add(r2.mul(-0.09)).add(r3.mul(0.47)).add(r4.mul(-0.71)).mul(size);
		const nz = r1.mul(0.07).add(r2.mul(0.19)).add(r3.mul(0.31)).add(r4.mul(0.53)).mul(size);
		const normal = normalize(vec3(nx, 1, nz)).toVar();
		const dir = reflect(view, normal).toVar();
		dir.y.assign(dir.y.abs());
		const offset = vec2(nx, nz.mul(2.2)).mul(0.5).toVar();
		const land = mirrorLandNode.sample(screenUV.add(offset)).level(0).toVar();
		const seen = mix(sky.waterNode(normalize(dir), offset), land.rgb, land.a).toVar();
		const cosV = view.y.abs().max(0);
		const fres = float(0.03).add(float(0.97).mul(float(1).sub(cosV).pow(5))).toVar();
		const deep = vec3(0.02, 0.05, 0.06).mul(dot(sky.uniforms.horizon, vec3(0.3, 0.6, 0.1)).mul(1.4).add(0.02));
		const body = mix(deep, seen, fres.max(0.34));
		// Fog as the land has it, to the far shore.
		return mix(body, fogColor, smoothstep(1400, 17000, dist));
	});
	waterMaterial.colorNode = waterColor();
	const water = new THREE.Mesh(new THREE.CircleGeometry(14000, 96).rotateX(-Math.PI / 2), waterMaterial);
	water.position.y = 0;
	water.frustumCulled = false;
	water.renderOrder = -50;
	group.add(water);

	// ---------------- what the lake mirrors of the land: the same geometry upside down, lit flat, drawn into the sky's mirror ----------------
	const mirrorLight = uniform(new THREE.Color(1, 1, 1));
	const mirrorMaterial = new THREE.MeshBasicNodeMaterial({ fog: false, side: THREE.DoubleSide });
	mirrorMaterial.colorNode = Fn(() => {
		// What's under the water, turned over, would stand in front of the reflection.
		If(positionWorld.y.greaterThan(-0.2), () => {
			Discard();
		});
		const dist = positionWorld.sub(cameraPosition).length();
		return mix(vertexColor().rgb.mul(mirrorLight), fogColor, smoothstep(1400, 17000, dist));
	})();
	mirrorMaterial.toneMapped = false;
	const mirrorScene = new THREE.Scene();
	const landMirror = new THREE.Mesh(land, mirrorMaterial);
	landMirror.scale.y = -1;
	landMirror.frustumCulled = false;
	mirrorScene.add(landMirror);
	const treesMirror = new THREE.InstancedMesh(treeGeo, mirrorMaterial, spots.length);
	treesMirror.instanceMatrix = trees.instanceMatrix;
	treesMirror.scale.y = -1;
	treesMirror.frustumCulled = false;
	mirrorScene.add(treesMirror);

	return {
		group,
		/** Draws the land's reflection. Call between `sky.render` and rendering the scene. */
		renderMirror(renderer, camera) {
			const size = renderer.getDrawingBufferSize(new THREE.Vector2());
			const w = Math.max(16, size.x >> 1);
			const h = Math.max(16, size.y >> 1);
			if (mirrorLand.width !== w || mirrorLand.height !== h) mirrorLand.setSize(w, h);
			const alpha = renderer.getClearAlpha();
			renderer.setClearAlpha(0);
			renderer.setRenderTarget(mirrorLand);
			renderer.render(mirrorScene, camera);
			renderer.setRenderTarget(null);
			renderer.setClearAlpha(alpha);
		},
		update({ windKnots, fog, sun, hemi, rain }) {
			wind.value = Math.min(1, windKnots / 50);
			rainOnWater.value = rain;
			fogColor.value.copy(fog);
			// The land's own light, near enough, without lighting it a second time.
			mirrorLight.value.copy(sun.color).multiplyScalar(sun.intensity * Math.max(0, sun.position.y / 1000) * 0.26).add(new THREE.Color(hemi.color).multiplyScalar(hemi.intensity * 0.2));
		},
		/** The view starts on the shore, looking along the lake. */
		eye: new THREE.Vector3(-LOOK.x * 130, Math.max(0, heightAt(-LOOK.x * 130, -LOOK.z * 130)) + 7, -LOOK.z * 130),
	};
}

/** Rain: streaks that wrap round the camera, moved entirely in the vertex shader, so it adds one draw and no work on the CPU. */
export function buildRain(scene, count = 7000) {
	const seeds = new Float32Array(count * 4 * 3);
	const corners = new Float32Array(count * 4 * 2);
	const index = new Uint32Array(count * 6);
	for (let i = 0; i < count; i++) {
		const sx = hash(i, 1);
		const sy = hash(i, 2);
		const sz = hash(i, 3);
		for (let k = 0; k < 4; k++) {
			const o = (i * 4 + k) * 3;
			seeds[o] = sx;
			seeds[o + 1] = sy;
			seeds[o + 2] = sz;
			const c = (i * 4 + k) * 2;
			corners[c] = k === 0 || k === 2 ? -1 : 1;
			corners[c + 1] = k < 2 ? 0 : 1;
		}
		const b = i * 6;
		const v = i * 4;
		index[b] = v;
		index[b + 1] = v + 2;
		index[b + 2] = v + 1;
		index[b + 3] = v + 1;
		index[b + 4] = v + 2;
		index[b + 5] = v + 3;
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.BufferAttribute(seeds, 3));
	g.setAttribute('corner', new THREE.BufferAttribute(corners, 2));
	g.setIndex(new THREE.BufferAttribute(index, 1));
	const amount = uniform(0);
	const windU = uniform(new THREE.Vector2(0, 0));
	const tint = uniform(new THREE.Color(0.7, 0.75, 0.8));
	const clock = uniform(0);
	const BOX = 46;
	const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
	const corner = attribute('corner', 'vec2');
	const seed = positionGeometry;
	const velocity = vec3(windU.x.mul(0.55), float(-26), windU.y.mul(0.55));
	const wrapped = fract(seed.add(velocity.mul(clock).div(BOX)).sub(cameraPosition.div(BOX))).sub(0.5).mul(BOX).add(cameraPosition);
	const axis = normalize(velocity);
	const toEye = normalize(cameraPosition.sub(wrapped));
	const side = normalize(cross(axis, toEye));
	const shown = seed.x.lessThan(amount).toFloat();
	material.positionNode = wrapped.add(side.mul(corner.x).mul(0.014).mul(shown)).add(axis.mul(corner.y).mul(1.15).mul(shown));
	material.colorNode = tint;
	material.opacityNode = corner.y.mul(0.42).mul(smoothstep(1.5, 9, wrapped.sub(cameraPosition).length()));
	const mesh = new THREE.Mesh(g, material);
	mesh.frustumCulled = false;
	mesh.renderOrder = 10;
	scene.add(mesh);
	return {
		mesh,
		update(dt, rain, wind, tintColor) {
			amount.value = rain;
			clock.value += dt;
			windU.value.set(wind.x, wind.z);
			tint.value.copy(tintColor);
			mesh.visible = rain > 0.004;
		},
	};
}

/** A lightning bolt: one jagged ribbon with a fork or two, rebuilt when it strikes and shown for the flash. */
export function buildBolt(scene) {
	const MAX = 96;
	const positions = new Float32Array(MAX * 6 * 3);
	const g = new THREE.BufferGeometry();
	const attr = new THREE.BufferAttribute(positions, 3);
	attr.setUsage(THREE.DynamicDrawUsage);
	g.setAttribute('position', attr);
	const glow = uniform(0);
	const material = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, blending: THREE.AdditiveBlending });
	material.colorNode = vec3(0.8, 0.86, 1).mul(glow);
	const mesh = new THREE.Mesh(g, material);
	mesh.frustumCulled = false;
	mesh.visible = false;
	scene.add(mesh);
	const side = new THREE.Vector3();
	const dir = new THREE.Vector3();
	let n = 0;
	const ribbon = (from, to, width, depth, eye) => {
		const segments = 22 >> depth;
		const a = from.clone();
		const b = new THREE.Vector3();
		for (let i = 1; i <= segments && n < MAX; i++) {
			const k = i / segments;
			const spread = from.distanceTo(to) * 0.06 * Math.sin(k * Math.PI) ** 0.6;
			b.lerpVectors(from, to, k);
			b.x += (Math.random() - 0.5) * spread * 2;
			b.z += (Math.random() - 0.5) * spread * 2;
			dir.subVectors(b, a);
			side.subVectors(a, eye).cross(dir).normalize().multiplyScalar(width * (1 - k * 0.65));
			positions.set([a.x - side.x, a.y, a.z - side.z, a.x + side.x, a.y, a.z + side.z, b.x - side.x, b.y, b.z - side.z, b.x - side.x, b.y, b.z - side.z, a.x + side.x, a.y, a.z + side.z, b.x + side.x, b.y, b.z + side.z], n * 18);
			n++;
			if (depth < 2 && Math.random() < 0.09) {
				const fork = new THREE.Vector3(b.x + (Math.random() - 0.5) * 700, b.y - (from.y - to.y) * (0.12 + Math.random() * 0.18), b.z + (Math.random() - 0.5) * 700);
				ribbon(b.clone(), fork, width * 0.55, depth + 1, eye);
			}
			a.copy(b);
		}
	};
	return {
		mesh,
		strike(from, to, eye) {
			n = 0;
			positions.fill(0);
			ribbon(from, to, 4.5, 0, eye);
			attr.needsUpdate = true;
			g.setDrawRange(0, n * 6);
		},
		update(flash) {
			glow.value = flash * 3.5;
			mesh.visible = flash > 0.02;
		},
	};
}
