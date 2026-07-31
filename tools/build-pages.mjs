// Builds the static site published to GitHub Pages into docs/.
//
// GitHub Pages serves files, not processes, so the published build runs the
// server inside the browser (client/offline.js). Everything else — the client,
// the shared simulation and the slice of three.js the game imports — is copied
// verbatim, and the paths in index.html are rewritten to be relative so the
// site works from a project subpath like /Splagoon/.
//
//   node tools/build-pages.mjs [outDir]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.resolve(ROOT, process.argv[2] || 'docs');

// three.js modules the client actually imports, plus their own imports.
const THREE_FILES = [
  'build/three.module.js',
  'examples/jsm/geometries/RoundedBoxGeometry.js',
  'examples/jsm/postprocessing/EffectComposer.js',
  'examples/jsm/postprocessing/Pass.js',
  'examples/jsm/postprocessing/RenderPass.js',
  'examples/jsm/postprocessing/ShaderPass.js',
  'examples/jsm/postprocessing/MaskPass.js',
  'examples/jsm/postprocessing/UnrealBloomPass.js',
  'examples/jsm/postprocessing/OutputPass.js',
  'examples/jsm/shaders/CopyShader.js',
  'examples/jsm/shaders/LuminosityHighPassShader.js',
  'examples/jsm/shaders/OutputShader.js',
];

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyDir(from, to, filter = () => true) {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst, filter);
    else if (filter(entry.name)) copy(src, dst);
  }
}

// --- clean ---------------------------------------------------------------
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// --- game code -----------------------------------------------------------
copyDir(path.join(ROOT, 'client'), path.join(OUT, 'client'),
  (name) => name !== 'index.html');
copyDir(path.join(ROOT, 'shared'), path.join(OUT, 'shared'));
copyDir(path.join(ROOT, 'server'), path.join(OUT, 'server'),
  (name) => name !== 'index.js');   // the Node host is not part of the build

// --- three.js ------------------------------------------------------------
let missing = 0;
for (const rel of THREE_FILES) {
  const src = path.join(ROOT, 'node_modules', 'three', rel);
  if (!fs.existsSync(src)) { console.error(`  missing ${rel}`); missing++; continue; }
  copy(src, path.join(OUT, 'vendor', 'three', rel));
}
if (missing) {
  console.error('\nRun `npm install` first.');
  process.exit(1);
}

// --- index.html ----------------------------------------------------------
let html = fs.readFileSync(path.join(ROOT, 'client', 'index.html'), 'utf8');
html = html
  .replace('href="./style.css"', 'href="./client/style.css"')
  .replace('src="./main.js"', 'src="./client/main.js"')
  .replace('"three": "/vendor/three/build/three.module.js"', '"three": "./vendor/three/build/three.module.js"')
  .replace('"three/addons/": "/vendor/three/examples/jsm/"', '"three/addons/": "./vendor/three/examples/jsm/"')
  // Static hosting: skip the websocket attempt entirely.
  .replace('<canvas id="view"></canvas>',
    '<script>window.SPLAGOON_OFFLINE = true;</script>\n<canvas id="view"></canvas>');
if (html.includes('"/vendor/three/') || !html.includes('SPLAGOON_OFFLINE')) {
  console.error('index.html rewrite failed — check the markers in client/index.html');
  process.exit(1);
}
fs.writeFileSync(path.join(OUT, 'index.html'), html);

// Tell Pages not to run the output through Jekyll (it ignores files that
// start with an underscore and can mangle directories).
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

const count = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .reduce((n, e) => n + (e.isDirectory() ? count(path.join(dir, e.name)) : 1), 0);
console.log(`built ${path.relative(ROOT, OUT)}/ — ${count(OUT)} files`);
