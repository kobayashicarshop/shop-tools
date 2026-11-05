// Synthetic products and delayed database reads in an isolated browser context only.
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
    await page.locator('#scanBarcode').click();
    await page.evaluate(async () => {
      const { InventoryStore } = await import('./store.js');
      const original = InventoryStore.prototype.findBarcode;
      InventoryStore.prototype.findBarcode = () => new Promise(resolve => {
        inventorySafety.releaseLookup = () => { InventoryStore.prototype.findBarcode = original; resolve(null); };
      });
    });
    await page.locator('#manualBarcode').fill('LATE-CODE');
    await page.locator('#manualBarcodeForm button').click();
    await page.waitForFunction(() => typeof inventorySafety.releaseLookup === 'function');
    await page.locator('#closeScanner').click();
    await page.evaluate(() => inventorySafety.releaseLookup());
    await page.locator('#listView:not([hidden])').waitFor();
    assert.equal(await page.locator('#editView').isVisible(), false, 'Late lookup must not reopen a closed photo screen');
    const finalSnapshot = await page.evaluate(async () => new (await import('./store.js')).InventoryStore().exportData());
    assert.deepEqual(finalSnapshot, after, 'Cancelled barcode lookup never mutates products or movements');
    assert.deepEqual(errors, [], 'No unhandled JavaScript errors');
    assert.deepEqual(violations, [], 'Only same-origin static GET requests are allowed');
    console.log('PASS: save target/snapshot protected during delayed reads, navigation and duplicate submit locked, late barcode lookup cancelled after close, stock/history unchanged');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
