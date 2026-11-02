// Builds the block demo into dist/ (index.html at the top) with its pictures and every licence it ships:
// `npm install`, then `npm run build`.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist');
execSync('node make-recipe.mjs', { cwd: here, stdio: 'inherit' });
execSync(`node "${path.join(here, 'node_modules/vite/bin/vite.js')}" build --config vite.config.mjs`, { cwd: here, stdio: 'inherit' });

const put = (from, to) => {
	fs.mkdirSync(path.dirname(path.join(dist, to)), { recursive: true });
	fs.cpSync(path.join(here, from), path.join(dist, to), { recursive: true });
};
put('thumbs', 'thumbs');
put('LICENSE', 'LICENSE.txt');
put('CREDITS.txt', 'CREDITS.txt');
put('licenses/LICENSE-eanpa-sky.txt', 'licenses/LICENSE-eanpa-sky.txt');
put('node_modules/three/LICENSE', 'licenses/LICENSE-three.txt');

let bytes = 0;
let count = 0;
const sum = (dir) => {
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) sum(p);
		else {
			bytes += fs.statSync(p).size;
			count++;
		}
	}
};
sum(dist);
console.log(`dist: ${count} files, ${(bytes / 1048576).toFixed(2)} MB`);
