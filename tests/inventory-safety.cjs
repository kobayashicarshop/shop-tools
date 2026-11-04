// Synthetic products and canvas camera streams in an isolated browser context only.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const base = (process.env.TEST_BASE_URL || 'http://127.0.0.1:8765').replace(/\/$/, '');
assert(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'Run safety fault injection against a local server only');

async function createProduct(page, name, quantity) {
  await page.locator('#newProduct').click();
  await page.locator('#productName').fill(name);
  await page.locator('#initialQuantity').fill(String(quantity));
  await page.locator('#saveProduct').click();
  await page.locator('#detailView:not([hidden])').waitFor();
  await page.waitForFunction(() => !document.querySelector('#back').disabled);
  const id = await page.evaluate(async productName => {
    const { InventoryStore } = await import('./store.js');
    return (await new InventoryStore().list()).find(product => product.name === productName).id;
  }, name);
  await page.locator('#back').click();
  await page.locator('#listView:not([hidden])').waitFor();
  return id;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  context.setDefaultTimeout(15000);
  const page = await context.newPage(), errors = [], violations = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.protocol === 'blob:' || url.protocol === 'data:') return;
    if (url.origin !== new URL(base).origin || request.method() !== 'GET') violations.push(request.method() + ' ' + url.origin + url.pathname);
  });
  try {
    await page.goto(base + '/inventory/');
    await page.waitForFunction(() => document.querySelector('#productCount').textContent === '0');
    const firstId = await createProduct(page, '架空商品A・保存対象', 2);
    const secondId = await createProduct(page, '架空商品B・別商品', 3);
    const before = await page.evaluate(async () => new (await import('./store.js')).InventoryStore().exportData());

    await page.locator(`[data-product-id="${firstId}"]`).getByRole('button', { name: '詳細', exact: true }).click();
    await page.getByRole('button', { name: '商品を編集', exact: true }).click();
    await page.locator('#productName').fill('架空商品A・送信時の内容');
    await page.evaluate(async () => {
      const { InventoryStore } = await import('./store.js');
      const originalList = InventoryStore.prototype.list;
      window.inventorySafety = { originalList };
      let pending = false;
      InventoryStore.prototype.list = function () {
        if (pending) return originalList.call(this);
        pending = true;
        return new Promise((resolve, reject) => {
          inventorySafety.releaseSave = async () => {
            InventoryStore.prototype.list = originalList;
            try { resolve(await originalList.call(this)); } catch (error) { reject(error); }
          };
        });
      };
    });
    await page.locator('#saveProduct').click();
    await page.waitForFunction(() => typeof inventorySafety.releaseSave === 'function');
    assert.equal(await page.locator('#saveProduct').getAttribute('aria-busy'), 'true');
    assert.equal(await page.locator('#back').isDisabled(), true, 'Pending save disables navigation buttons');
    assert.equal(await page.locator('#productName').isDisabled(), true, 'Pending save locks form fields');
    assert.equal(await page.locator('#newProduct').isDisabled(), true, 'Pending save cannot create a different edit target');

    // Bypass native disabled-button dispatch as well: the busy handler must reject it.
    await page.locator('#back').dispatchEvent('click');
    await page.locator('#newProduct').dispatchEvent('click');
    await page.locator('a.home-link').click();
    await page.locator('nav.tool-nav [data-tool-link="home"]').click();
    assert.equal(page.url(), base + '/inventory/', 'Links must not leave a pending save');
    assert.equal(await page.locator('#editView').isVisible(), true, 'Delayed save must retain the original edit target');

    // A late DOM change must not replace the values captured by the original submit.
    await page.evaluate(() => {
      document.querySelector('#productName').value = '送信後に変わった未保存の内容';
      document.querySelector('#productForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await page.evaluate(() => inventorySafety.releaseSave());
    await page.waitForFunction(() => document.querySelector('#status').textContent === '商品を保存しました' && !document.querySelector('#back').disabled);
    const after = await page.evaluate(async () => new (await import('./store.js')).InventoryStore().exportData());
    const firstBefore = before.products.find(product => product.id === firstId);
    const firstAfter = after.products.find(product => product.id === firstId);
    assert.equal(firstAfter.name, '架空商品A・送信時の内容', 'Saved product uses the submit-time snapshot');
    assert.equal(firstAfter.revision, firstBefore.revision + 1, 'Repeated submission saves exactly once');
    assert.equal(firstAfter.quantityMilli, firstBefore.quantityMilli, 'Metadata save never changes stock');
    assert.deepEqual(after.products.find(product => product.id === secondId), before.products.find(product => product.id === secondId), 'Unrelated product remains byte-for-byte unchanged');
    assert.deepEqual(after.movements, before.movements, 'Metadata save never adds or rewrites stock history');
    assert.equal(await page.locator('#saveProduct').getAttribute('aria-busy'), null);

    await page.locator('#back').click();
    await page.evaluate(() => {
      const originalCamera = navigator.mediaDevices.getUserMedia;
      inventorySafety.originalCamera = originalCamera;
      navigator.mediaDevices.getUserMedia = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 64;
        canvas.getContext('2d').fillRect(0, 0, 64, 64);
        const stream = canvas.captureStream(2);
        inventorySafety.camera = { canvas, stream };
        return stream;
      };
    });
    await page.locator('#scanBarcode').click();
    await page.waitForFunction(() => document.querySelector('#cameraStatus').textContent.includes('バーコード全体'));
    assert.equal(await page.evaluate(() => inventorySafety.camera.stream.getTracks().every(track => track.readyState === 'live')), true);

    // Closing must stop real MediaStream tracks before a database read can complete.
    await page.evaluate(async () => {
      const { InventoryStore } = await import('./store.js');
      InventoryStore.prototype.list = function () {
        return new Promise(resolve => { inventorySafety.finishCloseRead = resolve; });
      };
    });
    await page.locator('#closeScanner').click();
    await page.waitForFunction(() => typeof inventorySafety.finishCloseRead === 'function');
    const stoppedBeforeRead = await page.evaluate(() => ({
      stopped: inventorySafety.camera.stream.getTracks().every(track => track.readyState === 'ended'),
      cleared: document.querySelector('#camera').srcObject === null,
      closed: document.querySelector('#scannerView').hidden,
      listShown: !document.querySelector('#listView').hidden,
    }));
    assert.deepEqual(stoppedBeforeRead, { stopped: true, cleared: true, closed: true, listShown: true }, 'Closing the camera must not depend on IndexedDB');
    await page.evaluate(async () => {
      const { InventoryStore } = await import('./store.js');
      InventoryStore.prototype.list = inventorySafety.originalList;
      inventorySafety.finishCloseRead(await new InventoryStore().list());
    });

    // The same guarantee holds when the read fails instead of completing later.
    await page.locator('#scanBarcode').click();
    await page.waitForFunction(() => document.querySelector('#cameraStatus').textContent.includes('バーコード全体'));
    await page.evaluate(async () => {
      const { InventoryStore } = await import('./store.js');
      InventoryStore.prototype.list = () => Promise.reject(new Error('架空のDB読み取り失敗'));
    });
    await page.locator('#closeScanner').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('架空のDB読み取り失敗'));
    assert.equal(await page.locator('#scannerView').isVisible(), false);
    assert.equal(await page.locator('#listView').isVisible(), true);
    assert.equal(await page.evaluate(() => inventorySafety.camera.stream.getTracks().every(track => track.readyState === 'ended') && document.querySelector('#camera').srcObject === null), true, 'Database failure must leave no running camera track');
    await page.evaluate(async () => {
      const { InventoryStore } = await import('./store.js');
      InventoryStore.prototype.list = inventorySafety.originalList;
      navigator.mediaDevices.getUserMedia = inventorySafety.originalCamera;
    });
    const finalSnapshot = await page.evaluate(async () => new (await import('./store.js')).InventoryStore().exportData());
    assert.deepEqual(finalSnapshot, after, 'Camera close failures never mutate products or movements');
    assert.deepEqual(errors, [], 'No unhandled JavaScript errors');
    assert.deepEqual(violations, [], 'Only same-origin static GET requests are allowed');
    console.log('PASS: save target/snapshot protected during delayed reads, navigation and duplicate submit locked, camera stopped before delayed/failed DB reads, stock/history unchanged');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
