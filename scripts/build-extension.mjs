// Bundles the MV3 extension into extension/dist/.
// Content scripts CANNOT be ES modules, so that entry is iife. The background
// service worker is declared "type": "module" in the manifest, so it is esm.
import { build } from 'esbuild';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
await copyFile(join(src, 'popup', 'popup.css'), join(out, 'popup.css'));

// The action icon is the ugly-news app icon, resized. Chrome refuses to load an
// extension whose manifest names an icon file that is not in the bundle.
await mkdir(join(out, 'icons'), { recursive: true });
for (const size of [16, 32, 48, 128]) {
  await copyFile(
    join(root, 'extension', 'icons', `icon-${size}.png`),
    join(out, 'icons', `icon-${size}.png`),
  );
}

// Ship the loadable bundle as a static asset so the site can hand it to a
// reader directly. Built from `out` every time, so the download can never be a
// stale copy of code that has since changed.
const zipPath = join(root, 'client', 'public', 'ugly-fact-checker.zip');
await rm(zipPath, { force: true });
try {
  await promisify(execFile)('zip', ['-r', '-q', zipPath, '.'], { cwd: out });
  console.log('extension zipped →', zipPath);
} catch (err) {
  // Loud, not silent: a missing zip means the website's download button 404s,
  // and that is not something to discover from a user report.
  console.error('[build-extension] could not create the zip:', err.message);
  process.exitCode = 1;
}

console.log('extension built →', out);
