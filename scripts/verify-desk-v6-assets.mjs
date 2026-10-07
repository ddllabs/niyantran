import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { DESK_IMAGES, DESK_IMAGE_CREDITS, DESK_IMAGE_COMPOSITES, DESK_VISUALS } from '../src/desks/landing/deskImages.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const imageRoot = join(root, 'public/images/desks-v6');
const manifest = JSON.parse(readFileSync(join(imageRoot, 'manifest.json'), 'utf8'));
const frozenCommit = '50e3004fb53a1abc670b06fe8333f214e0e85eb0';
assert.equal(manifest.referenceCommit, frozenCommit, 'Reference commit changed');
const reference = (path) => execFileSync('git', ['show', `${frozenCommit}:${path}`], { cwd: root, maxBuffer: 20 * 1024 * 1024 });
const referenceManifest = JSON.parse(reference('previews/desk-reference-v6/asset-manifest.json'));
assert.equal(manifest.sourceSha256, referenceManifest.source_sha256);
const expected = new Map(referenceManifest.assets.map((asset) => [asset.path, asset]));
assert.equal(manifest.assets.length, expected.size, 'Missing or extra reference asset');
assert.deepEqual(readdirSync(imageRoot).sort(), ['manifest.json', ...manifest.assets.map((asset) => asset.path.split('/').at(-1))].sort());
const paths = new Set();
for (const asset of manifest.assets) {
  assert.match(asset.path, /^\/images\/desks-v6\/[a-f0-9]{20}\.(?:png|jpg|svg|txt)$/);
  assert(!paths.has(asset.path), `Duplicate asset ${asset.path}`);
  paths.add(asset.path);
  const original = expected.get(asset.referencePath.replace('previews/desk-reference-v6/', ''));
  assert(original, `Unknown reference path ${asset.referencePath}`);
  assert.equal(asset.sha256, original.sha256);
  assert.equal(asset.mime, original.mime);
  const bytes = readFileSync(join(root, 'public', asset.path));
  assert.equal(bytes.length, original.bytes, `Size mismatch ${asset.path}`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256, `Hash mismatch ${asset.path}`);
  assert(bytes.equals(reference(asset.referencePath)), `Reference bytes differ ${asset.path}`);
  assert.deepEqual(asset.names.sort(), Object.entries(DESK_IMAGES).filter(([, path]) => path === asset.path).map(([name]) => name).sort());
}
const html = reference('previews/desk-reference-v6/index.html').toString();
const originalImages = JSON.parse(html.match(/const ASSET_MAP=(\{[^\n]+\});/)[1]);
assert.deepEqual(DESK_IMAGES, Object.fromEntries(Object.entries(originalImages).map(([name, path]) => [name, `/images/desks-v6/${path.split('/').at(-1)}`])));
assert(paths.has(DESK_IMAGE_CREDITS) && DESK_IMAGE_CREDITS.endsWith('.txt'), 'Missing image credits');
const filename = (key) => /\.(png|jpg|jpeg|svg|webp)$/.test(key) ? key : `${key}${key === 'india-hero' ? '.png' : '.jpg'}`;
const resolve = (key) => {
  const names = DESK_IMAGE_COMPOSITES[key] || [filename(key)];
  for (const name of names) assert(DESK_IMAGES[name] && paths.has(DESK_IMAGES[name]), `Unresolved image ${key}: ${name}`);
};
assert.equal(Object.keys(DESK_VISUALS).length, 9);
for (const visual of Object.values(DESK_VISUALS)) {
  assert.deepEqual(Object.keys(visual).sort(), ['title', 'desc', 'label', 'image', 'heading', 'images', 'titles', 'summaries'].sort(), 'Visual configuration must not include mock data');
  assert.equal(visual.images.length, visual.titles.length);
  assert.equal(visual.images.length, visual.summaries.length);
  resolve(visual.image);
  visual.images.forEach(resolve);
}
Object.keys(DESK_IMAGE_COMPOSITES).forEach(resolve);
console.log(`Verified ${paths.size} byte-identical assets, ${Object.keys(DESK_IMAGES).length} named images, credits and 9 visual configurations against ${frozenCommit}.`);
