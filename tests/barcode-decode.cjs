// Synthetic labels and isolated browser contexts only. No real camera or user storage.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = (process.env.TEST_BASE_URL || 'http://127.0.0.1:8765').replace(/\/$/, '') + '/';
const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, 'barcode-fixtures/manifest.json'), 'utf8'));
const upceVariants = JSON.parse(fs.readFileSync(path.join(__dirname, 'barcode-fixtures/upce-variants.json'), 'utf8'));
const bytes = file => fs.readFileSync(path.join(__dirname, 'barcode-fixtures', file)).toString('base64');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage(), errors = [], violations = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.protocol === 'blob:' || url.protocol === 'data:') return;
    if (url.origin !== new URL(base).origin || request.method() !== 'GET') violations.push(request.method() + ' ' + url.origin + url.pathname);
  });
  try {
    await page.goto(base, { waitUntil: 'load' });
    await page.setContent('<!doctype html><main>Photo decoder test</main>');
    await page.evaluate(async url => {
      // Explicitly emulate a browser without the native detection API (e.g. Safari).
      Object.defineProperty(window, 'BarcodeDetector', { configurable: true, value: undefined });
      const { BarcodeScanner } = await import(url);
      window.scanResults = []; window.scanErrors = [];
      window.scanner = new BarcodeScanner({
        onResult: result => scanResults.push(result),
        onError: error => scanErrors.push({ name: error.name, message: error.message }),
      });
      window.makeFile = (base64, type = 'image/png') => new File([Uint8Array.from(atob(base64), char => char.charCodeAt(0))], 'synthetic.png', { type });
    }, new URL('inventory/scanner.js', base).href);

    for (const fixture of [...fixtures, ...upceVariants, { file: 'upce-rotated.png', text: '01234565', format: 'UPC_E' }]) {
      const result = await page.evaluate(async input => {
        const before = scanResults.length;
        const result = await scanner.readImage(makeFile(input.bytes));
        return { result, delivered: scanResults.length - before };
      }, { bytes: bytes(fixture.file) });
      assert.deepEqual(result.result, { text: fixture.text, format: fixture.format }, fixture.file + ' must decode with the local JavaScript library');
      assert.equal(result.delivered, 1, 'Each image must deliver its result exactly once');
    }
    // The same retail label must be readable while the iPhone stays in portrait.
    // Rotate actual fixture pixels; CSS-only rotation would not pass these cases.
    for (const fixture of [
      { file: 'ean13.png', text: '4900000000016', format: 'EAN_13', turns: 1 },
      { file: 'ean13.png', text: '4900000000016', format: 'EAN_13', turns: 2 },
      { file: 'ean13.png', text: '4900000000016', format: 'EAN_13', turns: 3 },
      { file: 'ean8.png', text: '12345670', format: 'EAN_8', turns: 1 },
      { file: 'code128.png', text: 'SHOP-TEST-128', format: 'CODE_128', turns: 3 },
    ]) {
      const rotated = await page.evaluate(async ({ encoded, turns }) => {
        const image = new Image(), url = URL.createObjectURL(makeFile(encoded));
        try {
          image.src = url;
          await image.decode();
          const canvas = document.createElement('canvas'), sideways = turns % 2 === 1;
          canvas.width = sideways ? image.naturalHeight : image.naturalWidth;
          canvas.height = sideways ? image.naturalWidth : image.naturalHeight;
          const context = canvas.getContext('2d');
          if (turns === 1) { context.translate(canvas.width, 0); context.rotate(Math.PI / 2); }
          else if (turns === 2) { context.translate(canvas.width, canvas.height); context.rotate(Math.PI); }
          else { context.translate(0, canvas.height); context.rotate(-Math.PI / 2); }
          context.drawImage(image, 0, 0);
          const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
          const before = scanResults.length;
          return { value: await scanner.readImage(blob), delivered: scanResults.length - before };
        } finally { URL.revokeObjectURL(url); }
      }, { encoded: bytes(fixture.file), turns: fixture.turns });
      assert.deepEqual(rotated.value, { text: fixture.text, format: fixture.format }, fixture.file + ' rotated ' + fixture.turns * 90 + ' degrees');
      assert.equal(rotated.delivered, 1, 'Rotated barcode must deliver one result');
    }
    assert.equal(await page.evaluate(() => scanErrors.length), 0);
    assert.equal(page.url(), base, 'QR URLs must never navigate');

    const failures = await page.evaluate(async blank => {
      const bad = [
        new File(['<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.invalid/photo.png"/></svg>'], 'unsupported.svg', { type: 'image/svg+xml' }),
        new File([new Uint8Array(30 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }),
        new File(['not an image'], 'corrupt.png', { type: 'image/png' }),
        makeFile(blank),
      ];
      const results = [];
      for (const file of bad) {
        const before = scanErrors.length, delivered = scanResults.length;
        const value = await scanner.readImage(file);
        results.push({ value, errorCount: scanErrors.length - before, delivered: scanResults.length - delivered, message: scanErrors.at(-1).message });
      }
      return results;
    }, bytes('blank.png'));
    for (const failure of failures) {
      assert.equal(failure.value, null);
      assert.equal(failure.errorCount, 1);
      assert.equal(failure.delivered, 0);
      assert(failure.message.length > 10, 'Failures must provide a useful Japanese message');
    }
    assert(failures[1].message.includes('30MiB'));
    for (const invalid of ['upce-invalid-checksum.png', 'upce-invalid-guard.png']) {
      const invalidUPC = await page.evaluate(async encoded => {
        const before = scanResults.length, errors = scanErrors.length;
        const result = await scanner.readImage(makeFile(encoded));
        return { result, delivered: scanResults.length - before, errors: scanErrors.length - errors };
      }, bytes(invalid));
      assert.deepEqual(invalidUPC, { result: null, delivered: 0, errors: 1 }, 'UPC-E with an invalid checksum/guard must not be accepted');
    }

    const cancellation = await page.evaluate(async encoded => {
      const OriginalImage = window.Image, before = scanErrors.length, delivered = scanResults.length;
      window.Image = class { set src(value) {} removeAttribute() {} };
      try {
        const pending = scanner.readImage(makeFile(encoded));
        scanner.stop();
        return { value: await pending, errors: scanErrors.length - before, delivered: scanResults.length - delivered };
      } finally { window.Image = OriginalImage; }
    }, bytes('ean13.png'));
    assert.deepEqual(cancellation, { value: null, errors: 0, delivered: 0 }, 'Closing during image loading must cancel promptly');

    const pageHide = await page.evaluate(async encoded => {
      const OriginalImage = window.Image, before = scanErrors.length;
      window.Image = class { set src(value) {} removeAttribute() {} };
      try {
        const pending = scanner.readImage(makeFile(encoded));
        window.dispatchEvent(new Event('pagehide'));
        return { value: await pending, errors: scanErrors.length - before };
      } finally { window.Image = OriginalImage; }
    }, bytes('ean13.png'));
    assert.deepEqual(pageHide, { value: null, errors: 0 });

    const superseded = await page.evaluate(async encoded => {
      const OriginalImage = window.Image, before = scanResults.length;
      window.Image = class { set src(value) {} removeAttribute() {} };
      const pending = scanner.readImage(makeFile(encoded));
      window.Image = OriginalImage;
      const current = await scanner.readImage(makeFile(encoded));
      return { old: await pending, current, delivered: scanResults.length - before };
    }, bytes('ean13.png'));
    assert.deepEqual(superseded, { old: null, current: { text: fixtures[0].text, format: 'EAN_13' }, delivered: 1 });

    // OS file/camera choosers may hide the document; image decoding must still work.
    const hiddenImage = await page.evaluate(async encoded => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
      try { return await scanner.readImage(makeFile(encoded)); }
      finally { delete document.hidden; }
    }, bytes('ean13.png'));
    assert.deepEqual(hiddenImage, { text: fixtures[0].text, format: 'EAN_13' });
    assert.equal(await page.evaluate(() => typeof scanner.start), 'undefined');
    await page.evaluate(() => scanner.destroy());
    assert.deepEqual(errors, [], 'No JavaScript runtime errors');
    assert.deepEqual(violations, [], 'No uploads, cross-origin requests or QR URL requests');
    console.log('PASS: 6 barcode formats without BarcodeDetector, image errors/cancel, hidden document image decoding, no live camera API, no external transmission');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
