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
    await page.setContent('<!doctype html><video id="scanner-video" muted playsinline></video>');
    await page.evaluate(async url => {
      // Explicitly emulate a browser without the native detection API (e.g. Safari).
      Object.defineProperty(window, 'BarcodeDetector', { configurable: true, value: undefined });
      const { BarcodeScanner } = await import(url);
      window.scanResults = []; window.scanErrors = [];
      window.scanner = new BarcodeScanner(document.querySelector('video'), {
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

    const denied = await page.evaluate(async () => {
      const original = navigator.mediaDevices.getUserMedia, before = scanErrors.length;
      navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Synthetic permission denial', 'NotAllowedError'); };
      try { return { started: await scanner.start(), errors: scanErrors.length - before, message: scanErrors.at(-1).message }; }
      finally { navigator.mediaDevices.getUserMedia = original; }
    });
    assert.equal(denied.started, false);
    assert.equal(denied.errors, 1);
    assert(denied.message.includes('許可'));

    const lifecycle = await page.evaluate(async () => {
      const original = navigator.mediaDevices.getUserMedia;
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
      canvas.getContext('2d').fillRect(0, 0, 64, 64);
      const first = canvas.captureStream(1), second = canvas.captureStream(1);
      let resolveFirst, calls = 0;
      navigator.mediaDevices.getUserMedia = () => ++calls === 1 ? new Promise(resolve => { resolveFirst = resolve; }) : Promise.resolve(second);
      try {
        const oldStart = scanner.start();
        const newStarted = await scanner.start();
        resolveFirst(first);
        const oldStarted = await oldStart;
        const secondAlive = second.getTracks().every(track => track.readyState === 'live');
        const firstStopped = first.getTracks().every(track => track.readyState === 'ended');
        window.dispatchEvent(new Event('pagehide'));
        const pageHideStopped = second.getTracks().every(track => track.readyState === 'ended') && scanner.video.srcObject === null;
        return { oldStarted, newStarted, firstStopped, secondAlive, pageHideStopped };
      } finally { scanner.stop(); navigator.mediaDevices.getUserMedia = original; }
    });
    assert.deepEqual(lifecycle, { oldStarted: false, newStarted: true, firstStopped: true, secondAlive: true, pageHideStopped: true }, 'Late permission results must not reopen or stop a newer camera session');

    const lateClose = await page.evaluate(async () => {
      const original = navigator.mediaDevices.getUserMedia;
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
      canvas.getContext('2d').fillRect(0, 0, 64, 64);
      const stream = canvas.captureStream(1); let resolve;
      navigator.mediaDevices.getUserMedia = () => new Promise(done => { resolve = done; });
      try {
        const pending = scanner.start(); scanner.stop(); resolve(stream);
        return { started: await pending, stopped: stream.getTracks().every(track => track.readyState === 'ended'), empty: scanner.video.srcObject === null };
      } finally { navigator.mediaDevices.getUserMedia = original; }
    });
    assert.deepEqual(lateClose, { started: false, stopped: true, empty: true });

    const hidden = await page.evaluate(async () => {
      const original = navigator.mediaDevices.getUserMedia;
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
      canvas.getContext('2d').fillRect(0, 0, 64, 64);
      const stream = canvas.captureStream(1);
      navigator.mediaDevices.getUserMedia = async () => stream;
      try {
        await scanner.start();
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
        return stream.getTracks().every(track => track.readyState === 'ended') && scanner.video.srcObject === null;
      } finally { delete document.hidden; navigator.mediaDevices.getUserMedia = original; scanner.stop(); }
    });
    assert.equal(hidden, true, 'Hiding the document must stop the camera');

    const countBeforeCamera = await page.evaluate(() => scanResults.length);
    await page.evaluate(async encoded => {
      const image = new Image(); image.src = URL.createObjectURL(makeFile(encoded)); await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      canvas.getContext('2d').drawImage(image, 0, 0); URL.revokeObjectURL(image.src);
      const stream = canvas.captureStream(2), original = navigator.mediaDevices.getUserMedia;
      window.cameraFixture = { stream, canvas, original, constraints: null };
      navigator.mediaDevices.getUserMedia = async constraints => { cameraFixture.constraints = constraints; return stream; };
      await scanner.start();
    }, bytes('ean13.png'));
    await page.waitForFunction(count => scanResults.length === count + 1, countBeforeCamera);
    const camera = await page.evaluate(() => {
      navigator.mediaDevices.getUserMedia = cameraFixture.original;
      return { result: scanResults.at(-1), count: scanResults.length, stopped: cameraFixture.stream.getTracks().every(track => track.readyState === 'ended'), empty: scanner.video.srcObject === null, audio: cameraFixture.constraints.audio, facing: cameraFixture.constraints.video.facingMode.ideal, inline: scanner.video.playsInline, timer: scanner.timer };
    });
    assert.deepEqual(camera.result, { text: fixtures[0].text, format: 'EAN_13' });
    assert.equal(camera.count, countBeforeCamera + 1);
    assert.equal(camera.stopped, true);
    assert.equal(camera.empty, true);
    assert.equal(camera.audio, false);
    assert.equal(camera.facing, 'environment');
    assert.equal(camera.inline, true);
    assert.equal(camera.timer, null, 'Successful camera decode must stop continuous scanning');
    await page.evaluate(() => scanner.destroy());
    assert.deepEqual(errors, [], 'No JavaScript runtime errors');
    assert.deepEqual(violations, [], 'No uploads, cross-origin requests or QR URL requests');
    console.log('PASS: 6 barcode formats without BarcodeDetector, image errors/cancel, camera permission/races/once, hidden/pagehide stop, no external transmission');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
