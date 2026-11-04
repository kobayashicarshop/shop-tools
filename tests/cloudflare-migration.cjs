// Synthetic data only. Run against two local servers; never against a user's browser profile.
const { chromium } = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const source = new URL(process.env.TEST_SOURCE_URL || 'http://127.0.0.1:8765/');
const target = new URL(process.env.TEST_TARGET_URL || 'http://127.0.0.1:8766/');
assert.notEqual(source.origin, target.origin, 'Migration must cross browser storage origins');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP9kEQ+5gAAAABJRU5ErkJggg==', 'base64');
const profile = {
  business: '移行確認用の架空事業者',
  staff: '架空の担当者',
  phone: '03-0000-0000',
  address: 'テスト用の架空住所1-2-3',
  registration: 'T0000000000000'
};
const receiptRecipient = '領収書PDF・架空の宛先';
const receiptDraft = '領収書下書き・架空の宛先';
const estimateRecipient = '見積書PDF・架空の宛先';
const estimateDraft = '見積書下書き・架空の宛先';
const photoCustomer = '写真報告書・架空のお客様';
const legacyRating = [1, 2, 3, 4, 25];

function watchPrivacy(page, base, violations, errors) {
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', () => violations.push('Unexpected WebSocket connection'));
  page.on('request', request => {
    const url = new URL(request.url());
    // Local image previews and PDF/JSON downloads use these browser-only URLs.
    if (url.protocol === 'blob:' || url.protocol === 'data:') return;
    const relative = url.pathname.startsWith(base.pathname) ? url.pathname.slice(base.pathname.length) : null;
    const staticPath = relative !== null && (
      relative === '' ||
      /^(receipt|estimate|merchant-calculator|before-after-tsukurukun|inventory|settings)\/$/.test(relative) ||
      /^(?:[a-z0-9-]+\/)*(?:[a-z0-9.-]+\.(?:html|css|js|svg|webmanifest|ico))$/i.test(relative)
    );
    // The existing calculator uses a fixed asset version query string.
    const staticQuery = [...url.searchParams].every(([key, value]) => key === 'v' && /^[a-z0-9]+$/i.test(value));
    if (request.method() !== 'GET' || url.origin !== base.origin || !staticPath || !staticQuery) {
      violations.push(`${request.method()} ${url.origin}${url.pathname}`);
    }
  });
}

async function downloadedBytes(page, action) {
  const pending = page.waitForEvent('download');
  await action();
  const download = await pending;
  assert.equal(await download.failure(), null, 'Download must finish');
  return fs.readFileSync(await download.path());
}

async function pdfBytes(page, action) {
  const bytes = await downloadedBytes(page, action);
  assert.equal(bytes.subarray(0, 4).toString(), '%PDF', 'Download must contain a PDF');
  return bytes;
}

async function exportBackup(page) {
  const bytes = await downloadedBytes(page, () => page.locator('#export').click());
  const payload = JSON.parse(bytes.toString('utf8'));
  assert.equal(payload.type, 'worktools_backup');
  assert.equal(payload.version, 4);
  return { bytes, payload };
}

const withoutExportTime = payload => {
  const { exportedAt, ...data } = payload;
  return data;
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 390, height: 844 } });
  context.setDefaultTimeout(15000);
  const oldPage = await context.newPage();
  const newPage = await context.newPage();
  const violations = [], errors = [];
  watchPrivacy(oldPage, source, violations, errors);
  watchPrivacy(newPage, target, violations, errors);
  try {
    // Create ordinary source data through the UI; seed the hidden legacy rating below.
    await oldPage.goto(new URL('settings/', source).href);
    for (const [key, value] of Object.entries(profile)) await oldPage.locator('#' + key).fill(value);
    await oldPage.locator('#saveProfile').click();
    await oldPage.waitForFunction(() => document.querySelector('#status').textContent.includes('保存しました'));

    await oldPage.goto(new URL('receipt/', source).href);
    await oldPage.locator('#s-home [data-go="edit"]').click();
    await oldPage.locator('#recipient').fill(receiptRecipient);
    await oldPage.locator('#amount').fill('28000');
    await oldPage.locator('#purpose').fill('架空の取付工賃');
    await oldPage.locator('#issuerText').fill(profile.business + '\n' + profile.address);
    await oldPage.locator('#saveIssuer').click();
    await oldPage.locator('#create').click();
    await oldPage.locator('#s-preview.active').waitFor();
    const receiptPdf = await pdfBytes(oldPage, () => oldPage.locator('#downloadPdf').click());
    await oldPage.waitForFunction(() => JSON.parse(localStorage.getItem('receipt_unified_history_v2') || '[]').length === 1);
    await oldPage.locator('#back').click();
    await oldPage.locator('#recipient').fill(receiptDraft);
    await oldPage.locator('#back').click();

    await oldPage.goto(new URL('estimate/', source).href);
    await oldPage.locator('#s-home [data-go="edit"]').click();
    await oldPage.locator('#recipient').fill(estimateRecipient);
    await oldPage.locator('#subject').fill('架空の機器取付見積もり');
    await oldPage.locator('#issuerText').fill(profile.business);
    await oldPage.locator('[data-field="description"]').first().fill('テスト用の工賃');
    await oldPage.locator('[data-field="quantity"]').first().fill('2');
    await oldPage.locator('[data-field="unitPrice"]').first().fill('10000');
    await oldPage.locator('#create').click();
    await oldPage.locator('#s-preview.active').waitFor();
    const estimatePdf = await pdfBytes(oldPage, () => oldPage.locator('#downloadPdf').click());
    await oldPage.waitForFunction(() => JSON.parse(localStorage.getItem('estimate_worktools_history_v1') || '[]').length === 1);
    await oldPage.locator('#back').click();
    await oldPage.locator('#recipient').fill(estimateDraft);
    await oldPage.locator('#back').click();

    await oldPage.goto(new URL('before-after-tsukurukun/', source).href);
    await oldPage.waitForFunction(() => document.querySelector('#saveStatus').textContent.includes('自動保存'));
    await oldPage.locator('#customerName').fill(photoCustomer);
    await oldPage.locator('[data-kind="single"]').first().click();
    await oldPage.locator('input[data-file="photo"]').first().setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: png });
    await oldPage.waitForFunction(() => document.querySelectorAll('img.photo').length === 1 && document.querySelector('img.photo').complete);
    await oldPage.waitForFunction(() => document.querySelector('#saveStatus').textContent.includes('保存済み'));
    const photoData = await oldPage.locator('img.photo').getAttribute('src');
    assert(photoData.startsWith('data:image/jpeg;'), 'Photo must be encoded inside the browser');
    // The navigation waits for pending IndexedDB writes before leaving the photo editor.
    await oldPage.locator('nav.tool-nav [data-tool-link="calc"]').click();
    await oldPage.waitForURL(new URL('merchant-calculator/', source).href);
    await oldPage.locator('[data-page="fee"]').click();
    await oldPage.locator('#rate').fill('18');
    await oldPage.locator('#rate').press('Tab');
    await oldPage.waitForFunction(() => JSON.parse(localStorage.getItem('merchant_calcs_v1')).feeRate === 18);
    await oldPage.locator('#amount').fill('30000');
    assert((await oldPage.locator('#feeResults').innerText()).includes('24,060円'), 'Representative calculator result');
    await oldPage.locator('#home').click();
    // Simulate a pre-existing installation whose last screen was the now-hidden rating.
    await oldPage.evaluate(rating => {
      const saved = JSON.parse(localStorage.getItem('merchant_calcs_v1'));
      localStorage.setItem('merchant_calcs_v1', JSON.stringify({ ...saved, rating, page: 'rating', lastUsedAt: Date.now() }));
    }, legacyRating);
    await oldPage.reload();
    assert.equal(await oldPage.locator('#heading').innerText(), '出店者の計算機', 'Legacy rating screen falls back to calculator home');
    assert.equal(await oldPage.locator('[data-page="rating"]').count(), 0, 'Rating tile stays hidden');
    assert.equal(await oldPage.locator('[data-star], #editStars').count(), 0, 'Rating controls stay hidden');
    assert.equal(await oldPage.locator('[data-page]').count(), 3, 'Fee, cancellation and review tools remain available');
    assert.deepEqual(await oldPage.evaluate(() => JSON.parse(localStorage.getItem('merchant_calcs_v1')).rating), legacyRating);
    await oldPage.locator('nav.tool-nav [data-tool-link="home"]').click();
    await oldPage.waitForURL(source.href);
    await oldPage.locator('a.settings').click();
    const original = await exportBackup(oldPage);
    assert.equal(original.payload.receipt.draft.recipient, receiptDraft);
    assert.equal(original.payload.estimate.draft.recipient, estimateDraft);
    assert.equal(original.payload.photoDraft.customer, photoCustomer);
    assert.deepEqual(original.payload.calculator.rating, legacyRating, 'Unified backup retains hidden rating values');
    assert.equal(original.payload.calculator.page, 'rating', 'Display fallback does not discard the saved legacy screen');
    assert.equal(Object.keys(original.payload.receiptPdfs).length, 1);
    assert.equal(Object.keys(original.payload.estimatePdfs).length, 1);

    // A different origin starts empty, and import is performed through its file picker.
    await newPage.goto(new URL('settings/', target).href);
    assert.equal(await newPage.locator('#business').inputValue(), '');
    assert.equal(await newPage.evaluate(() => localStorage.getItem('receipt_unified_history_v2')), null);
    const confirmation = newPage.waitForEvent('dialog');
    const upload = newPage.locator('#import').setInputFiles({
      name: 'synthetic-worktools-backup.json', mimeType: 'application/json', buffer: original.bytes
    });
    const dialog = await confirmation;
    assert.equal(dialog.type(), 'confirm');
    await dialog.accept();
    await upload;
    await newPage.waitForFunction(() => document.querySelector('#status').textContent.startsWith('復元しました'));
    // Before opening tools, all backed-up values and PDF binaries should round-trip exactly.
    const restored = await exportBackup(newPage);
    assert.deepEqual(withoutExportTime(restored.payload), withoutExportTime(original.payload), 'Unified backup must restore all included fields and binary data');
    await newPage.reload();
    for (const [key, value] of Object.entries(profile)) assert.equal(await newPage.locator('#' + key).inputValue(), value);

    await newPage.goto(new URL('receipt/', target).href);
    await newPage.locator('#s-home [data-go="edit"]').click();
    assert.equal(await newPage.locator('#recipient').inputValue(), receiptDraft);
    assert.equal(await newPage.locator('#amount').inputValue(), '28000');
    await newPage.locator('#back').click();
    await newPage.locator('#s-home [data-go="history"]').click();
    assert.equal(await newPage.locator('#historyList .item').count(), 1);
    assert((await newPage.locator('#historyList').innerText()).includes(receiptRecipient));
    const restoredReceipt = await pdfBytes(newPage, () => newPage.locator('[data-open-history]').click());
    assert.deepEqual(restoredReceipt, receiptPdf, 'Stored receipt PDF must be restored byte for byte');

    await newPage.goto(new URL('estimate/', target).href);
    await newPage.locator('#s-home [data-go="edit"]').click();
    assert.equal(await newPage.locator('#recipient').inputValue(), estimateDraft);
    assert.equal(await newPage.locator('[data-field="description"]').first().inputValue(), 'テスト用の工賃');
    assert.equal((await newPage.locator('#liveTotal').innerText()).trim(), '¥20,000');
    await newPage.locator('#back').click();
    await newPage.locator('#s-home [data-go="history"]').click();
    assert.equal(await newPage.locator('#historyList .item').count(), 1);
    assert((await newPage.locator('#historyList').innerText()).includes(estimateRecipient));
    const restoredEstimate = await pdfBytes(newPage, () => newPage.locator('[data-history]').click());
    assert.deepEqual(restoredEstimate, estimatePdf, 'Stored estimate PDF must be restored byte for byte');

    await newPage.goto(new URL('before-after-tsukurukun/', target).href);
    await newPage.waitForFunction(() => document.querySelector('#saveStatus').textContent.includes('復元しました'));
    assert.equal(await newPage.locator('#customerName').inputValue(), photoCustomer);
    assert.equal(await newPage.locator('#companyName').inputValue(), profile.business);
    assert.equal(await newPage.locator('#staffName').inputValue(), profile.staff);
    assert.equal(await newPage.locator('img.photo').count(), 1);
    assert.equal(await newPage.locator('img.photo').getAttribute('src'), photoData);
    await newPage.waitForFunction(() => document.querySelector('img.photo').complete && document.querySelector('img.photo').naturalWidth > 0);
    const photoPdf = await pdfBytes(newPage, () => newPage.locator('#createPdf').click());
    assert(photoPdf.includes(Buffer.from('/Count 1')), 'Restored photo must still produce a one-page PDF');

    await newPage.goto(new URL('merchant-calculator/', target).href);
    assert.equal(await newPage.locator('#heading').innerText(), '出店者の計算機');
    assert.equal(await newPage.locator('[data-page="rating"], [data-star], #editStars').count(), 0, 'Imported legacy rating remains hidden');
    const importedCalculator = await newPage.evaluate(() => JSON.parse(localStorage.getItem('merchant_calcs_v1')));
    assert.deepEqual(importedCalculator.rating, legacyRating, 'Rating values survive import and calculator startup');
    assert.equal(importedCalculator.page, 'rating', 'Imported hidden screen falls back visually without changing its backup value');
    await newPage.locator('[data-page="fee"]').click();
    assert.equal(await newPage.locator('#rate').inputValue(), '18');
    assert.equal(await newPage.locator('#amount').inputValue(), '', 'Calculator amounts intentionally remain transient');
    await newPage.locator('#amount').fill('30000');
    assert((await newPage.locator('#feeResults').innerText()).includes('24,060円'));

    // Target-side edits prove the origins are independent and do not alter the old site.
    await newPage.goto(new URL('settings/', target).href);
    await newPage.locator('#business').fill('新しい公開先だけの架空事業者');
    await newPage.locator('#saveProfile').click();
    const stillOriginal = await exportBackup(oldPage);
    assert.deepEqual(withoutExportTime(stillOriginal.payload), withoutExportTime(original.payload), 'Old-origin storage, photos and PDFs must remain untouched');
    assert.equal(await oldPage.locator('#business').inputValue(), profile.business);
    assert.deepEqual(violations, [], 'No requests other than same-origin static GETs may occur');
    assert.deepEqual(errors, [], 'No JavaScript runtime errors');
    console.log('PASS: cross-origin backup restore, receipt/estimate PDF bytes, photo PDF, calculator, source preservation and no data upload');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
