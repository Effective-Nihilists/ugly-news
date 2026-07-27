// Bundles the MV3 extension into extension/dist/.
// Content scripts CANNOT be ES modules, so that entry is iife. The background
// service worker is declared "type": "module" in the manifest, so it is esm.
import { build } from 'esbuild';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'extension', 'src');
const out = join(root, 'extension', 'dist');
const dev = process.argv.includes('--dev');

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const common = {
  bundle: true,
  target: 'chrome110',
  minify: !dev,
  sourcemap: dev ? 'inline' : false,
  logLevel: 'info',
};

await build({
  ...common,
  entryPoints: [join(src, 'content', 'index.ts')],
  outfile: join(out, 'content.js'),
  format: 'iife',
});

await build({
  ...common,
  entryPoints: [join(src, 'background', 'index.ts')],
  outfile: join(out, 'background.js'),
  format: 'esm',
});

await build({
  ...common,
  entryPoints: [join(src, 'popup', 'index.ts')],
  outfile: join(out, 'popup.js'),
  format: 'iife',
});

await copyFile(
  join(root, 'extension', 'manifest.json'),
  join(out, 'manifest.json'),
);
await copyFile(join(src, 'popup', 'popup.html'), join(out, 'popup.html'));

console.log('extension built →', out);
