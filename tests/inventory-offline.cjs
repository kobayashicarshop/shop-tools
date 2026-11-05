// Standalone loopback-only test; no deployed site or user's browser profile is used.
// localhost is a secure context, but shared/shell.js intentionally auto-registers only on HTTPS.
// This test manually registers the unchanged worker lifecycle on HTTP localhost.
// By default both / and /shop-tools/ are checked. TEST_BASE_URL adds its path prefix only;
// TEST_WEB_ROOT can point at dist to check built files instead of the current source tree.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(process.env.TEST_WEB_ROOT || path.join(__dirname, '..'));
const workerSource = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const coreMatch = workerSource.match(/const CORE=\[([\s\S]*?)\];/);
assert(coreMatch, 'Worker must declare its static CORE assets');
const core = [...coreMatch[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
assert(core.includes('./inventory/store.js') && core.includes('./settings/'));
assert(!/\bskipWaiting\s*\(/.test(workerSource), 'Test must exercise the normal waiting-worker lifecycle');
const normalizePrefix = value => (value === '/' ? '/' : '/' + value.replace(/^\/+|\/+$/g, '') + '/');
const prefixes = [...new Set(['/', '/shop-tools/', ...(process.env.TEST_BASE_URL ? [normalizePrefix(new URL(process.env.TEST_BASE_URL).pathname)] : [])])];
const withoutTime = value => { const { exportedAt, ...data } = value; return data; };
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8' };

async function serve(prefix, cacheStem) {
  let revision = 1;
  const server = http.createServer((request, response) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      if (!pathname.startsWith(prefix)) { response.writeHead(404).end(); return; }
      const relative = pathname.slice(prefix.length), resolved = path.resolve(root, relative || 'index.html');
      if (resolved !== root && !resolved.startsWith(root + path.sep)) { response.writeHead(404).end(); return; }
      let filename = resolved;
      if (fs.statSync(filename).isDirectory()) filename = path.join(filename, 'index.html');
      let body = fs.readFileSync(filename);
      if (relative === 'sw.js') {
        const changed = workerSource.replace(/const CACHE='[^']+'/, "const CACHE='" + cacheStem + '-v' + revision + "'");
        assert.notEqual(changed, workerSource, 'Test cache revision must replace the worker CACHE declaration');
        body = Buffer.from(changed);
      }
      response.writeHead(200, { 'Content-Type': mime[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch (_) { if (!response.headersSent) response.writeHead(404); response.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  return {
    base: 'http://127.0.0.1:' + port + prefix,
    update: () => { revision = 2; },
    close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); })
  };
}

async function cachedCore(page, name, base) {
  await page.waitForFunction(async ({ name, base, core }) => {
    if (!(await caches.keys()).includes(name)) return false;
    const cache = await caches.open(name);
    return (await Promise.all(core.map(relative => cache.match(new URL(relative, base).href)))).every(Boolean);
  }, { name, base, core });
}

async function snapshot(page, base) {
  return page.evaluate(async base => {
    const { InventoryStore, validateBackup } = await import(new URL('inventory/store.js', base).href);
    return validateBackup(await new InventoryStore().exportData());
  }, base);
}

async function backup(page, base) {
  await page.goto(base + 'settings/');
  const pending = page.waitForEvent('download');
  await page.locator('#export').click();
  const download = await pending;
  assert.equal(await download.failure(), null);
  const payload = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
  assert.equal(payload.version, 4);
  return payload;
}

async function registerProduct(page, name, quantity, barcode = '') {
  await page.locator('#newProduct').click();
  await page.locator('#productName').fill(name);
  await page.locator('#barcode').fill(barcode);
  await page.locator('#initialQuantity').fill(quantity);
  await page.locator('#saveProduct').click();
  await page.locator('#detailView:not([hidden])').waitFor();
  assert.equal(await page.locator('#detailView h2').innerText(), name);
}

async function move(page, label, quantity, expectedStock) {
  await page.locator('#detailView').getByRole('button', { name: label, exact: true }).click();
  await page.locator('#moveQuantity').fill(quantity);
  if (label === '棚卸調整') await page.locator('#adjustReason').fill('オフライン棚卸確認');
  const confirmation = page.waitForEvent('dialog');
  const click = page.locator('#confirmMove').click();
  await (await confirmation).accept();
  await click;
  await page.locator('#detailView:not([hidden])').waitFor();
  assert.equal(await page.locator('#detailView .stock').innerText(), expectedStock + ' 個');
}

async function seedOtherCustomerData(page) {
  await page.evaluate(async () => {
    localStorage.setItem('worktools_profile_v1', JSON.stringify({ business: '架空のオフライン事業者', staff: '架空担当', phone: '', address: '', registration: '' }));
    localStorage.setItem('receipt_unified_draft_v2', JSON.stringify({ recipient: '更新後も保持する架空領収書宛先' }));
    localStorage.setItem('estimate_worktools_draft_v1', JSON.stringify({ recipient: '更新後も保持する架空見積宛先', items: [] }));
    localStorage.setItem('merchant_calcs_v1', JSON.stringify({ rating: [1, 2, 3, 4, 5] }));
    localStorage.setItem('receipt_unified_history_v2', JSON.stringify([{ id: 'offline_receipt' }]));
    localStorage.setItem('estimate_worktools_history_v1', JSON.stringify([{ id: 'offline_estimate' }]));
    const put = (name, store, id, data) => new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(store);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(data, id);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
    await put('before_after_tsukurukun_v1', 'drafts', 'current', {
      customer: '更新後も保持する架空写真宛先', note: '元の写真下書き',
      pairs: [{ id: 'offline_photo', kind: 'single', title: '架空の写真', comment: '', photo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9kEQ+5gAAAABJRU5ErkJggg==', photoAdj: { zoom: 1, x: 0, y: 0 } }]
    });
    await put('receipt_unified_pdf_v2', 'files', 'offline_receipt', new Blob(['%PDF-1.4\nsynthetic saved receipt'], { type: 'application/pdf' }));
    await put('estimate_worktools_pdfs_v1', 'files', 'offline_estimate', new Blob(['%PDF-1.4\nsynthetic saved estimate'], { type: 'application/pdf' }));
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [index, prefix] of prefixes.entries()) {
      const stem = 'toolbox-shell-offline-test-' + index, oldCache = stem + '-v1', newCache = stem + '-v2';
      const server = await serve(prefix, stem);
      const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 390, height: 844 } });
      context.setDefaultTimeout(20000);
      const errors = [], unexpectedRequests = [];
      context.on('request', request => {
        const url = new URL(request.url());
        if (['data:', 'blob:'].includes(url.protocol)) return;
        if (request.method() !== 'GET' || url.origin !== new URL(server.base).origin || (!url.pathname.startsWith(prefix) && url.pathname !== '/favicon.ico')) unexpectedRequests.push(request.method() + ' ' + url.origin + url.pathname);
      });
      try {
        let page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(server.base + 'inventory/');
        await page.waitForFunction(() => document.querySelector('#productCount').textContent === '0');
        await page.evaluate(async base => {
          if (!isSecureContext || !('serviceWorker' in navigator)) throw Error('Loopback test must be a service-worker-capable secure context');
          await navigator.serviceWorker.register(new URL('sw.js', base).href, { scope: new URL(base).pathname, updateViaCache: 'none' });
          await navigator.serviceWorker.ready;
        }, server.base);
        await page.waitForFunction(() => !!navigator.serviceWorker.controller);
        await cachedCore(page, oldCache, server.base);
        await registerProduct(page, 'オンラインで登録した架空商品', '3', '0012345678905');
        await seedOtherCustomerData(page);

        await context.setOffline(true);
        await page.reload({ waitUntil: 'load' });
        await page.locator('#productList .product').waitFor();
        assert((await page.locator('#productList').innerText()).includes('オンラインで登録した架空商品'));
        assert((await page.locator('#productList').innerText()).includes('3 個'));
        const beforePhoto = await snapshot(page, server.base);
        await page.locator('#scanBarcode').click();
        await page.locator('#barcodeImage').setInputFiles(path.join(__dirname, 'barcode-fixtures/ean13.png'));
        await page.locator('#editView:not([hidden])').waitFor();
        assert.equal(await page.locator('#barcode').inputValue(), '4900000000016', 'Photo barcode decodes offline using bundled libraries');
        assert.deepEqual(await snapshot(page, server.base), beforePhoto, 'Offline lookup must not mutate inventory');
        await page.locator('#back').click();
        await registerProduct(page, 'オフラインで登録した架空商品', '2');
        await move(page, '入庫', '4', '6');
        await move(page, '出庫', '1', '5');
        await move(page, '棚卸調整', '7', '7');
        await page.reload({ waitUntil: 'load' });
        await page.waitForFunction(() => document.querySelector('#productCount').textContent === '2');
        assert((await page.locator('#productList').innerText()).includes('7 個'));
        const beforeUpdate = await snapshot(page, server.base);
        assert.equal(beforeUpdate.products.length, 2);
        assert.equal(beforeUpdate.movements.length, 5);
        assert.equal(beforeUpdate.products.find(product => product.barcode).barcode, '0012345678905');
        const allBeforeUpdate = await backup(page, server.base);
        assert.deepEqual(allBeforeUpdate.inventory, beforeUpdate);
        assert.deepEqual(allBeforeUpdate.calculator.rating, [1, 2, 3, 4, 5]);
        assert(allBeforeUpdate.photoDraft.pairs[0].photo.startsWith('data:image/png;base64,'));

        await context.setOffline(false);
        server.update();
        const nextWorker = context.waitForEvent('serviceworker', { predicate: worker => worker.url() === server.base + 'sw.js' });
        await page.evaluate(async base => {
          const registration = await navigator.serviceWorker.getRegistration(base);
          await registration.update();
        }, server.base);
        const updatedWorker = await nextWorker;
        await page.waitForFunction(async base => {
          const registration = await navigator.serviceWorker.getRegistration(base);
          return registration.active?.state === 'activated' && registration.waiting?.state === 'installed';
        }, server.base);
        await cachedCore(page, newCache, server.base);
        assert.deepEqual((await page.evaluate(() => caches.keys())).sort(), [oldCache, newCache].sort(), 'Old worker stays active while a controlled tab remains open');
        assert.deepEqual(await snapshot(page, server.base), beforeUpdate, 'Installing a waiting update does not mutate inventory');

        // No skipWaiting message: close every controlled tab and let the browser activate normally.
        await page.close();
        assert.equal(context.pages().length, 0);
        await updatedWorker.evaluate(async ({ oldCache, newCache }) => {
          const deadline = Date.now() + 20000;
          while (Date.now() < deadline) {
            const names = await caches.keys();
            if (self.registration.active?.state === 'activated' && !self.registration.waiting && names.includes(newCache) && !names.includes(oldCache)) return;
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          throw Error('Waiting update did not activate and remove the old shell cache');
        }, { oldCache, newCache });
        page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(server.base + 'inventory/');
        await page.waitForFunction(() => document.querySelector('#productCount').textContent === '2' && !!navigator.serviceWorker.controller);
        await cachedCore(page, newCache, server.base);
        assert.deepEqual(await page.evaluate(() => caches.keys()), [newCache]);
        assert.deepEqual(await snapshot(page, server.base), beforeUpdate, 'Activating an update retains all product IDs, stock, revisions and movement history');
        const allAfterUpdate = await backup(page, server.base);
        assert.deepEqual(withoutTime(allAfterUpdate), withoutTime(allBeforeUpdate), 'Worker updates retain inventory, old ratings, customer drafts, photo draft and saved PDF bytes');
        await context.setOffline(true);
        await page.goto(server.base + 'inventory/');
        await page.reload({ waitUntil: 'load' });
        await page.waitForFunction(() => document.querySelector('#productCount').textContent === '2');
        assert.deepEqual(await snapshot(page, server.base), beforeUpdate);
        assert.deepEqual(errors, [], 'No browser JavaScript runtime errors');
        assert.deepEqual(unexpectedRequests, [], 'All requests stay on the loopback origin and configured path');
        console.log('PASS: ' + prefix + ' cached CORE, offline registration/stock/backup, waiting update activation and all saved data preserved');
      } finally {
        await context.close();
        await server.close();
      }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
