import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const publicFiles = [
  'index.html', 'manifest.webmanifest', 'sw.js', 'shared/shell.css', 'shared/shell.js',
  'icons/app-icon.svg', 'receipt/index.html', 'receipt/style.css', 'receipt/app.js',
  'estimate/index.html', 'estimate/style.css', 'estimate/app.js',
  'merchant-calculator/index.html', 'merchant-calculator/style.css',
  'merchant-calculator/app.js', 'merchant-calculator/manifest.webmanifest',
  'before-after-tsukurukun/index.html', 'settings/index.html',
  'inventory/index.html', 'inventory/app.js', 'inventory/style.css',
  'inventory/store.js', 'inventory/scanner.js',
  'inventory/vendor/zxing-browser-0.2.1.min.js', 'inventory/vendor/zxing-library-0.23.0.min.js',
  'inventory/vendor/ZXING-BROWSER-LICENSE.txt', 'inventory/vendor/ZXING-LIBRARY-LICENSE.txt',
  'inventory/vendor/TS-CUSTOM-ERROR-LICENSE.txt',
];
const checksum = bytes => createHash('sha256').update(bytes).digest('hex');
const filesUnder = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? filesUnder(path.join(dir, entry.name)).map(p => entry.name + '/' + p) : [entry.name]);

test('Pages artifact preserves application bytes, includes all paths, and excludes private/repository files', () => {
  const sandbox = mkdtempSync(path.join(tmpdir(), 'shop-tools-pages-test-'));
  assert.equal(path.dirname(sandbox), path.resolve(tmpdir()));
  try {
    for (const relative of [...publicFiles, 'scripts/build-cloudflare.mjs']) {
      cpSync(path.join(root, relative), path.join(sandbox, relative), { recursive: true });
    }
    // Deliberately place secrets beside public files. A broad directory copy would expose them.
    for (const relative of ['.env', 'receipt/credentials.json', 'settings/private.json', 'README.md']) {
      writeFileSync(path.join(sandbox, relative), 'test-only-nonsecret-canary');
    }
    const originals = new Map(publicFiles.map(p => [p, checksum(readFileSync(path.join(sandbox, p)))]));
    const build = () => execFileSync(process.execPath, [path.join(sandbox, 'scripts/build-cloudflare.mjs')]);
    build();
    const output = path.join(sandbox, 'dist');
    assert.deepEqual(filesUnder(output).sort(), [...publicFiles, '_headers', '404.html'].sort());
    for (const relative of publicFiles) {
      assert.equal(checksum(readFileSync(path.join(sandbox, relative))), originals.get(relative), relative + ' source changed');
      if (relative !== 'sw.js') assert.equal(checksum(readFileSync(path.join(output, relative))), originals.get(relative), relative + ' output changed');
    }
    const sw = readFileSync(path.join(output, 'sw.js'), 'utf8');
    assert.match(sw, /const CACHE='toolbox-shell-cf-[a-f0-9]{16}'/);
    assert.equal(sw.replace(/toolbox-shell-cf-[a-f0-9]{16}/, 'toolbox-shell-v9'), readFileSync(path.join(sandbox, 'sw.js'), 'utf8'));
    const headers = readFileSync(path.join(output, '_headers'), 'utf8');
    assert.match(headers, /X-Robots-Tag: noindex/);
    assert.match(headers, /\/sw\.js\s+Cache-Control: no-cache/);
    assert(existsSync(path.join(output, '404.html')));

    // Resolve actual HTML assets/links and manifest paths under both deployment bases.
    for (const prefix of ['/', '/shop-tools/']) {
      for (const relative of publicFiles.filter(p => p.endsWith('.html'))) {
        const html = readFileSync(path.join(output, relative), 'utf8').replace(/(<script\b[^>]*>)[\s\S]*?<\/script>/gi, '$1</script>');
        const pageUrl = new URL(prefix + relative.replace(/index\.html$/, ''), 'https://test.invalid');
        for (const match of html.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/g)) {
          const value = match[1];
          if (/^(?:#|data:|blob:)/.test(value)) continue;
          const url = new URL(value, pageUrl);
          assert.equal(url.origin, pageUrl.origin, 'Unexpected external asset/link: ' + value);
          assert(url.pathname.startsWith(prefix), 'Path escaped deployment base: ' + value);
          const local = decodeURIComponent(url.pathname.slice(prefix.length));
          assert(existsSync(path.join(output, local, local.endsWith('/') || !local ? 'index.html' : '')), relative + ' missing ' + value);
        }
      }
      for (const relative of publicFiles.filter(p => p.endsWith('.webmanifest'))) {
        const manifest = JSON.parse(readFileSync(path.join(output, relative), 'utf8'));
        const base = new URL(prefix + relative, 'https://test.invalid');
        for (const value of [manifest.start_url, manifest.scope, ...(manifest.icons || []).map(i => i.src)]) {
          const url = new URL(value, base);
          assert(url.pathname.startsWith(prefix));
          const local = decodeURIComponent(url.pathname.slice(prefix.length));
          assert(existsSync(path.join(output, local, local.endsWith('/') || !local ? 'index.html' : '')));
        }
      }
    }
    build();
    assert.equal(readFileSync(path.join(output, 'sw.js'), 'utf8'), sw, 'Unchanged builds must retain cache revision');
    writeFileSync(path.join(sandbox, 'shared/shell.css'), readFileSync(path.join(sandbox, 'shared/shell.css'), 'utf8') + '\n/* test update */\n');
    build();
    assert.notEqual(readFileSync(path.join(output, 'sw.js'), 'utf8'), sw, 'Asset changes must update worker revision');
  } finally {
    // mkdtemp creates this exact, direct child of the system temporary directory.
    assert.equal(path.dirname(sandbox), path.resolve(tmpdir()));
    assert(path.basename(sandbox).startsWith('shop-tools-pages-test-'));
    rmSync(sandbox, { recursive: true, force: true });
  }
});
