// Synthetic fixtures only. Exercises the real Settings export/import UI and IndexedDB store.
const { chromium } = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const base = (process.env.TEST_BASE_URL || 'http://127.0.0.1:8765').replace(/\/$/, '');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9kEQ+5gAAAABJRU5ErkJggg==';
const clone = value => JSON.parse(JSON.stringify(value));
const withoutTime = value => { const { exportedAt, ...data } = value; return data; };

async function backup(page) {
  const pending = page.waitForEvent('download');
  await page.locator('#export').click();
  const download = await pending;
  assert.equal(await download.failure(), null);
  const result = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
  assert.equal(result.type, 'worktools_backup');
  assert.equal(result.version, 4);
  return result;
}

async function restore(page, payload, accept = true) {
  const dialogs = [];
  const handler = async dialog => {
    dialogs.push(dialog.message());
    assert.equal(dialog.type(), 'confirm');
    if (accept) await dialog.accept(); else await dialog.dismiss();
  };
  page.on('dialog', handler);
  try {
    await page.locator('#import').setInputFiles({
      name: 'synthetic-inventory-backup.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(payload))
    });
    await page.waitForFunction(() => {
      const input = document.querySelector('#import');
      return input.value === '' && !input.disabled;
    });
    return { dialogs, message: await page.locator('#status').textContent() };
  } finally {
    page.off('dialog', handler);
  }
}

async function inventorySnapshot(page) {
  return page.evaluate(async () => {
    const { InventoryStore } = await import('../inventory/store.js');
    return new InventoryStore().exportData();
  });
}

async function addExtraProduct(page) {
  return page.evaluate(async () => {
    const { InventoryStore } = await import('../inventory/store.js');
    return new InventoryStore().create({
      name: '復元先だけの架空商品', category: 'supply', sku: '', barcode: '', unit: '本',
      quantityMilli: 5000, reorderMilli: null, costYen: null, saleYen: null, memo: ''
    });
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const violations = [], errors = [];
  async function settingsPage() {
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 390, height: 844 } });
    context.setDefaultTimeout(15000);
    context.on('request', request => {
      const url = new URL(request.url());
      if (['data:', 'blob:'].includes(url.protocol)) return;
      if (request.method() !== 'GET' || url.origin !== new URL(base).origin) violations.push(request.method() + ' ' + url.origin + url.pathname);
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/settings/');
    return page;
  }
  try {
    const source = await settingsPage();
    await source.evaluate(async image => {
      const put = (name, store, id, value) => new Promise((resolve, reject) => {
        const request = indexedDB.open(name, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(store);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result, tx = db.transaction(store, 'readwrite');
          tx.objectStore(store).put(value, id);
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onabort = () => { db.close(); reject(tx.error); };
        };
      });
      localStorage.setItem('worktools_profile_v1', JSON.stringify({ business: '架空の在庫テスト事業者', staff: '架空担当', phone: '', address: '', registration: '' }));
      // Rating records must survive even if a simplified calculator hides their UI.
      localStorage.setItem('merchant_calcs_v1', JSON.stringify({ rating: [1, 2, 3, 4, 5], months: { '2026-01': { work: 30, cancel: 2, review: 20 } }, goals: { cancel: 5, review: 80 }, feeRate: 18, page: 'home' }));
      localStorage.setItem('receipt_maker_issuer_templates_v1', JSON.stringify([{ templateName: '以前の架空テンプレート' }]));
      localStorage.setItem('receipt_unified_draft_v2', JSON.stringify({ recipient: '架空宛先', amount: '12000', stampData: image }));
      localStorage.setItem('receipt_unified_issuer_v2', JSON.stringify({ issuerText: '架空事業者', stampData: image }));
      localStorage.setItem('receipt_unified_templates_v2', JSON.stringify([{ id: 'rt1', name: '架空領収書', data: { recipient: '架空宛先' } }]));
      localStorage.setItem('receipt_unified_history_v2', JSON.stringify([{ id: 'r_fixture', recipient: '架空宛先', amount: 12000, issueDate: '2026-01-01', data: { recipient: '架空宛先' } }]));
      localStorage.setItem('estimate_worktools_draft_v1', JSON.stringify({ recipient: '架空見積宛先', items: [{ description: '架空工賃', quantity: '1', unitPrice: '10000', rate: '10' }] }));
      localStorage.setItem('estimate_worktools_templates_v1', JSON.stringify([{ id: 'et1', name: '架空見積', data: { items: [] } }]));
      localStorage.setItem('estimate_worktools_history_v1', JSON.stringify([{ id: 'e_fixture', recipient: '架空見積宛先', total: 10000, data: { items: [] } }]));
      await put('receipt_unified_pdf_v2', 'files', 'r_fixture', new Blob(['%PDF-1.4\nsynthetic receipt bytes'], { type: 'application/pdf' }));
      await put('estimate_worktools_pdfs_v1', 'files', 'e_fixture', new Blob(['%PDF-1.4\nsynthetic estimate bytes'], { type: 'application/pdf' }));
      await put('before_after_tsukurukun_v1', 'drafts', 'current', {
        schemaVersion: 2, title: '架空の写真報告', date: '2026-01-01', company: '架空事業者', staff: '架空担当', customer: '架空のお客様', note: '保存確認',
        pairs: [{ id: 'photo_fixture', kind: 'single', title: 'テスト写真', comment: '', photo: image, photoAdj: { zoom: 1, x: 0, y: 0 } }]
      });
      const { InventoryStore } = await import('../inventory/store.js');
      const store = new InventoryStore();
      const product = await store.create({ name: '架空の販売商品', category: 'sale', sku: 'TEST-01', barcode: '0012345678905', unit: '個', quantityMilli: 1000, reorderMilli: 2000, costYen: 100, saleYen: 200, memo: '先頭0を保持' });
      await store.move(product.id, { kind: 'in', quantityMilli: 2000, reason: '仕入', expectedRevision: product.revision });
      await store.create({ name: '架空の作業用資材', category: 'supply', sku: '', barcode: '', unit: 'm', quantityMilli: 1250, reorderMilli: null, costYen: null, saleYen: null, memo: '' });
    }, png);
    const original = await backup(source);
    assert.equal(original.inventory.version, 1);
    assert.equal(original.inventory.products.length, 2);
    assert.equal(original.inventory.movements.length, 3);
    assert.equal(original.inventory.products.find(product => product.name === '架空の販売商品').barcode, '0012345678905');
    assert.deepEqual(original.calculator.rating, [1, 2, 3, 4, 5]);
    assert.equal(original.photoDraft.pairs[0].photo, png);
    assert(original.receiptPdfs.r_fixture && original.estimatePdfs.e_fixture);

    const target = await settingsPage();
    const imported = await restore(target, original);
    assert.equal(imported.dialogs.length, 1);
    assert(imported.dialogs[0].includes('商品2件') && imported.dialogs[0].includes('入出庫履歴3件') && imported.dialogs[0].includes('すべて置き換え'));
    assert(imported.message.startsWith('復元しました'));
    const roundTrip = await backup(target);
    assert.deepEqual(withoutTime(roundTrip), withoutTime(original), 'v4 restores inventory, leading-zero barcodes, legacy ratings, photo and both PDF binaries');
    assert.deepEqual(withoutTime(await backup(source)), withoutTime(original), 'Source data remains unchanged');

    await addExtraProduct(target);
    const keptInventory = await inventorySnapshot(target);
    // Old versions must not even open a readwrite inventory transaction.
    const oldWriteGuard = await target.evaluateHandle(() => {
      const original = IDBDatabase.prototype.transaction;
      let calls = 0;
      IDBDatabase.prototype.transaction = function (...args) {
        if (this.name === 'worktools_inventory_v1' && args[1] === 'readwrite') { calls++; throw Error('Old backup attempted an inventory write'); }
        return original.apply(this, args);
      };
      return { count: () => calls, restore: () => { IDBDatabase.prototype.transaction = original; } };
    });
    try {
      for (const version of [1, 2, 3]) {
        const legacy = clone(original); legacy.version = version;
        legacy.inventory = { version: 1, products: [], movements: [] }; // Must be ignored for an old format.
        if (version < 2) { delete legacy.receipt; delete legacy.receiptPdfs; }
        if (version < 3) { delete legacy.estimate; delete legacy.estimatePdfs; }
        const result = await restore(target, legacy);
        assert(result.message.startsWith('復元しました'), 'Legacy version ' + version + ' remains readable');
        assert(result.dialogs[0].includes('在庫は変更しません'));
        assert.deepEqual(await inventorySnapshot(target), keptInventory);
      }
      assert.equal(await oldWriteGuard.evaluate(guard => guard.count()), 0);
    } finally { await oldWriteGuard.evaluate(guard => guard.restore()); await oldWriteGuard.dispose(); }

    const beforeInvalid = await backup(target);
    const invalidCases = [
      payload => { delete payload.inventory; },
      payload => { payload.inventory.products[0].barcode = 123; },
      payload => { payload.inventory.movements[0].productId = 'unknown_product'; },
      payload => { payload.inventory.products[0].quantityMilli += 1000; },
      payload => { payload.estimatePdfs.e_fixture = 'ab=c'; },
      payload => { payload.receipt.history = {}; }
    ];
    for (const damage of invalidCases) {
      const invalid = clone(original);
      invalid.profile.business = '不正ファイルから反映されてはいけない値';
      invalid.photoDraft.note = '不正ファイルの写真下書き';
      damage(invalid);
      const result = await restore(target, invalid);
      assert.equal(result.dialogs.length, 0, 'Invalid data is rejected before confirmation and all writes');
      assert(result.message.startsWith('復元できませんでした'));
      assert.deepEqual(withoutTime(await backup(target)), withoutTime(beforeInvalid), 'Invalid data must leave every store unchanged');
    }
    const cancelled = await restore(target, original, false);
    assert.equal(cancelled.dialogs.length, 1);
    assert.deepEqual(withoutTime(await backup(target)), withoutTime(beforeInvalid), 'Cancelling a valid replacement leaves every store unchanged');

    const partial = clone(original);
    partial.profile.business = '復元が中断する架空設定';
    partial.photoDraft.note = '途中まで反映された写真下書き';
    partial.receiptPdfs.r_fixture = Buffer.from('%PDF-1.4\nchanged receipt bytes').toString('base64');
    // Abort an earlier PDF database: inventory replacement must never begin.
    const earlierFailure = await target.evaluateHandle(() => {
      const original = IDBDatabase.prototype.transaction;
      let inventoryWrites = 0;
      IDBDatabase.prototype.transaction = function (...args) {
        const tx = original.apply(this, args);
        if (args[1] === 'readwrite' && this.name === 'worktools_inventory_v1') inventoryWrites++;
        if (args[1] === 'readwrite' && this.name === 'estimate_worktools_pdfs_v1') queueMicrotask(() => tx.abort());
        return tx;
      };
      return { count: () => inventoryWrites, restore: () => { IDBDatabase.prototype.transaction = original; } };
    });
    try {
      const result = await restore(target, partial);
      assert(result.message.startsWith('復元できませんでした') && result.message.includes('在庫は変更していません') && result.message.includes('写真・PDFの一部'));
      assert.equal(await earlierFailure.evaluate(guard => guard.count()), 0);
      assert.deepEqual(await inventorySnapshot(target), keptInventory);
      const after = await backup(target);
      assert.deepEqual(after.profile, beforeInvalid.profile, 'LocalStorage is rolled back after an earlier database failure');
      assert.equal(after.photoDraft.note, partial.photoDraft.note, 'Error message accurately acknowledges cross-database partial restoration');
    } finally { await earlierFailure.evaluate(guard => guard.restore()); await earlierFailure.dispose(); }

    // Abort inventory after its first replacement add succeeds; clears/adds must all roll back.
    const inventoryFailure = await target.evaluateHandle(() => {
      const original = IDBObjectStore.prototype.add;
      let aborts = 0, armed = true;
      IDBObjectStore.prototype.add = function (...args) {
        const request = original.apply(this, args);
        if (armed && this.transaction.db.name === 'worktools_inventory_v1') {
          armed = false; const tx = this.transaction;
          request.addEventListener('success', () => { aborts++; tx.abort(); }, { once: true });
        }
        return request;
      };
      return { count: () => aborts, restore: () => { IDBObjectStore.prototype.add = original; } };
    });
    try {
      const result = await restore(target, partial);
      assert(result.message.startsWith('復元できませんでした') && result.message.includes('在庫は変更していません') && result.message.includes('写真・PDFの一部'));
      assert.equal(await inventoryFailure.evaluate(guard => guard.count()), 1, 'Failure injection must reach an inventory write');
      assert.deepEqual(await inventorySnapshot(target), keptInventory, 'Aborted atomic replacement keeps all prior products and movements');
      const after = await backup(target);
      assert.deepEqual(after.profile, beforeInvalid.profile);
      assert.deepEqual(after.calculator.rating, [1, 2, 3, 4, 5]);
    } finally { await inventoryFailure.evaluate(guard => guard.restore()); await inventoryFailure.dispose(); }

    const unavailable = await settingsPage();
    await unavailable.route('**/inventory/store.js', route => route.abort());
    let downloads = 0;
    unavailable.on('download', () => downloads++);
    await unavailable.locator('#export').click();
    await unavailable.waitForFunction(() => document.querySelector('#status').textContent.includes('在庫機能を読み込めませんでした'));
    assert.equal(downloads, 0, 'A missing inventory module must not silently produce an incomplete backup');
    const oldWithoutModule = clone(original); oldWithoutModule.version = 3; delete oldWithoutModule.inventory;
    assert((await restore(unavailable, oldWithoutModule)).message.startsWith('復元しました'), 'Legacy restore must remain available without the inventory module');
    assert.deepEqual(violations, [], 'Backup and restore must not upload data');
    assert.deepEqual(errors, [], 'No unhandled JavaScript errors');
    console.log('PASS: inventory backup v4, leading zeros, legacy v1-v3 preservation, ratings/photo/PDF compatibility, validation, cancellation and atomic failure handling');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
