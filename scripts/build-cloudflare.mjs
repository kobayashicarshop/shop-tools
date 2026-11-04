import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Keep this list explicit: repository files and credentials must never become public.
const PUBLIC_FILES = [
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  'shared/shell.css',
  'shared/shell.js',
  'icons/app-icon.svg',
  'receipt/index.html',
  'receipt/style.css',
  'receipt/app.js',
  'estimate/index.html',
  'estimate/style.css',
  'estimate/app.js',
  'merchant-calculator/index.html',
  'merchant-calculator/style.css',
  'merchant-calculator/app.js',
  'merchant-calculator/manifest.webmanifest',
  'before-after-tsukurukun/index.html',
  'inventory/index.html',
  'inventory/app.js',
  'inventory/style.css',
  'inventory/store.js',
  'inventory/scanner.js',
  'inventory/vendor/zxing-browser-0.2.1.min.js',
  'inventory/vendor/zxing-library-0.23.0.min.js',
  'inventory/vendor/ZXING-BROWSER-LICENSE.txt',
  'inventory/vendor/ZXING-LIBRARY-LICENSE.txt',
  'inventory/vendor/TS-CUSTOM-ERROR-LICENSE.txt',
  'settings/index.html',
];

const HEADERS = `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Robots-Tag: noindex

/sw.js
  Cache-Control: no-cache
`;

// A root 404 disables Pages' automatic single-page-app fallback.
const NOT_FOUND = `<!doctype html>
<html lang="ja">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ページが見つかりません | 仕事の便利ツール</title>
<main>
  <h1>ページが見つかりません</h1>
  <p>URLをご確認ください。</p>
  <p><a href="/">仕事の便利ツールのホームへ</a></p>
</main>
</html>
`;

const root = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const output = path.resolve(root, 'dist');

if (path.dirname(output) !== root || path.basename(output) !== 'dist') {
  throw new Error('Refusing to write outside the repository dist directory.');
}

// Validate the entire allowlist before touching a previous build.
const sources = [];
for (const relative of PUBLIC_FILES) {
  const source = path.resolve(root, relative);
  if (!source.startsWith(root + path.sep)) throw new Error(`Unsafe public path: ${relative}`);
  let current = root;
  for (const segment of relative.split('/')) {
    current = path.join(current, segment);
    if ((await lstat(current)).isSymbolicLink()) {
      throw new Error(`Symbolic links are not allowed in public sources: ${relative}`);
    }
  }
  if (!(await lstat(source)).isFile()) throw new Error(`Not a regular file: ${relative}`);
  sources.push({ relative, bytes: await readFile(source) });
}

// The generated worker changes with deployed content, allowing its existing
// cache-first logic to refresh after a new worker activates. Source sw.js stays intact.
const digest = createHash('sha256');
for (const { relative, bytes } of sources) digest.update(relative).update('\0').update(bytes).update('\0');
digest.update(HEADERS).update(NOT_FOUND);
const revision = digest.digest('hex').slice(0, 16);
const worker = sources.find(({ relative }) => relative === 'sw.js').bytes.toString('utf8');
const cacheDeclaration = /\bconst CACHE='toolbox-shell-[^']+'/g;
if ([...worker.matchAll(cacheDeclaration)].length !== 1) {
  throw new Error('Expected one shell cache declaration in sw.js; review the Cloudflare build.');
}
const builtWorker = worker.replace(cacheDeclaration, `const CACHE='toolbox-shell-cf-${revision}'`);

// Check the exact absolute deletion target and refuse redirected output folders.
try {
  const info = await lstat(output);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(output) !== output) {
    throw new Error('Refusing to replace a dist path that is not a regular repository directory.');
  }
  await rm(output, { recursive: true });
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
await mkdir(output, { recursive: true });
for (const { relative, bytes } of sources) {
  const target = path.join(output, relative);
  await mkdir(path.dirname(target), { recursive: true });
  if (relative === 'sw.js') await writeFile(target, builtWorker);
  else await writeFile(target, bytes);
}
await writeFile(path.join(output, '_headers'), HEADERS);
await writeFile(path.join(output, '404.html'), NOT_FOUND);
console.log(`Cloudflare Pages: ${PUBLIC_FILES.length} public files + _headers + 404.html -> dist/`);
console.log(`Service worker cache: toolbox-shell-cf-${revision}`);
