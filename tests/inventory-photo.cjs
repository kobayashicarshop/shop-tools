// Isolated browser storage and synthetic labels; no real device camera or user data.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const base = (process.env.TEST_BASE_URL || 'http://127.0.0.1:8765').replace(/\/$/, '');
const fixture = name => path.join(__dirname, 'barcode-fixtures', name);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage(), errors = [], violations = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (['blob:', 'data:'].includes(url.protocol)) return;
    if (url.origin !== new URL(base).origin || request.method() !== 'GET') violations.push(request.method() + ' ' + url.href);
  });
  page.on('response', response => { if (response.status() >= 400) violations.push(String(response.status()) + ' ' + response.url()); });
  await page.addInitScript(() => {
    window.cameraCalls = 0;
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { cameraCalls++; throw Error('Live camera must never be requested'); };
  });
  const snapshot = () => page.evaluate(async () => new (await import('./store.js')).InventoryStore().exportData());
  const open = async () => { await page.locator('#scanBarcode').click(); await page.locator('#scannerView:not([hidden])').waitFor(); };
  try {
    await page.goto(base + '/inventory/');
    await page.waitForFunction(() => document.querySelector('#productCount').textContent === '0');
    assert.equal(await page.locator('#scanBarcode').innerText(), '写真からバーコードを読み取る');
    await open();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Photo controls fit a narrow phone viewport');
    assert.equal(await page.locator('video,#restartCamera,#stopCamera').count(), 0);
    const input = page.locator('#barcodeImage');
    assert.equal(await input.getAttribute('accept'), 'image/*');
    assert.equal(await input.getAttribute('capture'), null, 'Photo library must not be restricted by capture');
    assert.equal(await input.getAttribute('type'), 'file');
    const chooser = page.waitForEvent('filechooser');
    await input.click();
    await (await chooser).setFiles(fixture('ean13.png'));
    await page.locator('#editView:not([hidden])').waitFor();
    assert.equal(await page.locator('#barcode').inputValue(), '4900000000016');
    assert.equal((await snapshot()).products.length, 0, 'An image must not create a product without save');
    await page.locator('#productName').fill('写真テスト・架空商品');
    await page.locator('#initialQuantity').fill('3');
    await page.locator('#saveProduct').click();
    await page.locator('#detailView:not([hidden])').waitFor();
    await page.waitForFunction(() => !document.querySelector('#back').disabled);
    const before = await snapshot();
    await page.locator('#back').click(); await open();
    await input.setInputFiles(fixture('ean13.png'));
    await page.locator('#detailView:not([hidden])').waitFor();
    assert.match(await page.locator('#productDetail').innerText(), /写真テスト・架空商品/);
    assert.deepEqual(await snapshot(), before, 'Known photo lookup never changes stock or history');
    await page.locator('#back').click(); await open();
    await page.locator('#manualBarcode').fill('4900000000016');
    await page.locator('#manualBarcodeForm button').click();
    await page.locator('#detailView:not([hidden])').waitFor();
    assert.deepEqual(await snapshot(), before);

    await page.locator('#back').click(); await open();
    for (let attempt = 0; attempt < 2; attempt++) {
      await input.setInputFiles(fixture('blank.png'));
      await page.waitForFunction(() => document.querySelector('#photoStatus').textContent.includes('写真を撮り直'));
      assert.equal(await input.inputValue(), '', 'Same image can be selected again');
      assert.equal(await input.isDisabled(), false);
    }
    await input.setInputFiles(fixture('upce.png'));
    await page.locator('#editView:not([hidden])').waitFor();
    assert.equal(await page.locator('#barcode').inputValue(), '01234565', 'Leading zero survives photo lookup');
    await page.locator('#back').click(); await open();
    await input.setInputFiles(fixture('qr.png'));
    await page.locator('#editView:not([hidden])').waitFor();
    assert.match(await page.locator('#barcode').inputValue(), /^https?:/);
    assert.equal(page.url(), base + '/inventory/', 'QR URLs must never navigate');

    // Delay real image loading to observe progress and close cancellation reliably.
    await page.locator('#back').click(); await open();
    await page.evaluate(() => {
      window.originalImage = window.Image;
      const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
      window.Image = function () {
        const img = new originalImage();
        Object.defineProperty(img, 'src', { set(value) { window.releasePhoto = () => descriptor.set.call(img, value); } });
        return img;
      };
    });
    await input.setInputFiles(fixture('ean13.png'));
    await page.waitForFunction(() => typeof window.releasePhoto === 'function');
    assert.match(await page.locator('#photoStatus').innerText(), /解析しています/);
    assert.equal(await page.locator('#scannerView').getAttribute('aria-busy'), 'true');
    assert.equal(await input.isDisabled(), true);
    assert.equal(await page.locator('#manualBarcodeForm button').isDisabled(), true);
    await page.locator('#closeScanner').click();
    await page.locator('#listView:not([hidden])').waitFor();
    await page.evaluate(() => { window.Image = originalImage; });
    assert.equal(await page.locator('#scannerView').getAttribute('aria-busy'), 'false');
    assert.deepEqual(await snapshot(), before, 'Closing during photo analysis preserves all data');
    await open(); await input.setInputFiles(fixture('ean13.png'));
    await page.locator('#detailView:not([hidden])').waitFor();
    assert.equal(await page.evaluate(() => cameraCalls), 0);
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(errors, []);
    assert.deepEqual(violations, []);
    console.log('PASS: native photo file chooser without capture, known/unknown/manual lookup, leading zero/QR safety, retry, progress/cancel, no camera, no stock mutation/uploads/404/errors');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
