const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {chromium}=require('playwright');
const base=(process.env.TEST_BASE_URL||'http://127.0.0.1:8765').replace(/\/$/,'');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'shop-inventory-test-'));
(async()=>{
 let context;const errors=[],unexpected=[];
 const launch=()=>chromium.launchPersistentContext(profile,{headless:true,viewport:{width:390,height:844}});
 try{
  context=await launch();const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  page.on('request',request=>{const url=new URL(request.url());if(!['data:','blob:'].includes(url.protocol)&&(url.origin!==new URL(base).origin||request.method()!=='GET'))unexpected.push(request.url())});
  await page.addInitScript(()=>{navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('denied','NotAllowedError')}});
  await page.goto(base+'/inventory/');await page.waitForFunction(()=>document.getElementById('productCount').textContent==='0');
  assert.equal(await page.locator('nav.tool-nav a').count(),5);
  await page.click('#newProduct');await page.fill('#productName','作業用テープ');await page.fill('#sku','TAPE-01');await page.fill('#barcode','0012345678905');await page.fill('#initialQuantity','5');
  await page.locator('#productForm summary').click();await page.fill('#reorder','2');await page.fill('#cost','300');await page.fill('#salePrice','500');await page.fill('#memo','作業用の備品');await page.click('#saveProduct');
  await page.locator('#detailView:not([hidden])').waitFor();assert((await page.locator('#productDetail').innerText()).includes('5 個'));
  let snapshot=await page.evaluate(async()=>new (await import('./store.js')).InventoryStore().exportData());
  const tape=snapshot.products[0];assert.equal(tape.barcode,'0012345678905');assert.equal(tape.quantityMilli,5000);assert.equal(snapshot.movements[0].kind,'initial');assert.equal(snapshot.movements.length,1);
  await page.getByRole('button',{name:'商品を編集',exact:true}).click();await page.locator('#editView:not([hidden])').waitFor();assert.equal(await page.locator('#unit').isDisabled(),true);assert.equal(await page.locator('#initialQuantity').getAttribute('readonly'),'');
  await page.fill('#productName','作業用テープ 改');await page.click('#saveProduct');await page.locator('#detailView:not([hidden])').waitFor();
  await page.getByRole('button',{name:'出庫',exact:true}).click();await page.fill('#moveQuantity','6');await page.click('#confirmMove');assert((await page.locator('#status').innerText()).includes('現在庫を超える'));
  await page.fill('#moveQuantity','3');await page.selectOption('#reasonSelect','作業使用');page.once('dialog',d=>d.dismiss());await page.click('#confirmMove');
  assert.equal(await page.evaluate(async()=> (await new (await import('./store.js')).InventoryStore().list())[0].quantityMilli),5000,'Cancel never changes stock');
  page.once('dialog',d=>d.accept());await page.click('#confirmMove');await page.locator('#detailView:not([hidden])').waitFor();assert((await page.locator('#productDetail').innerText()).includes('要補充'));
  await page.getByRole('button',{name:'入庫',exact:true}).click();await page.fill('#moveQuantity','2');await page.selectOption('#reasonSelect','返品');page.once('dialog',d=>d.accept());await page.click('#confirmMove');await page.locator('#detailView:not([hidden])').waitFor();
  await page.getByRole('button',{name:'棚卸調整',exact:true}).click();await page.fill('#moveQuantity','1');await page.fill('#adjustReason','現物を数えて訂正');page.once('dialog',d=>d.accept());await page.click('#confirmMove');await page.locator('#detailView:not([hidden])').waitFor();
  snapshot=await page.evaluate(async()=>new (await import('./store.js')).InventoryStore().exportData());assert.equal(snapshot.products[0].quantityMilli,1000);assert.deepEqual(snapshot.movements.sort((a,b)=>a.sequence-b.sequence).map(m=>[m.kind,m.beforeMilli,m.afterMilli]),[['initial',0,5000],['out',5000,2000],['in',2000,4000],['adjust',4000,1000]]);
  await page.click('#back');await page.fill('#search','TAPE-01');assert.equal(await page.locator('#productList article').count(),1);await page.fill('#search','0012345678905');assert.equal(await page.locator('#productList article').count(),1);await page.fill('#search','存在しない');assert.equal(await page.locator('#productList article').count(),0);await page.fill('#search','');
  await page.click('#scanBarcode');await page.waitForFunction(()=>document.getElementById('cameraStatus').textContent.includes('手入力'));await page.fill('#manualBarcode','0012345678905');await page.locator('#manualBarcodeForm button').click();await page.locator('#detailView:not([hidden])').waitFor();
  assert.equal((await page.evaluate(async()=>new (await import('./store.js')).InventoryStore().exportData())).movements.length,4,'Reading does not mutate inventory');
  await page.click('#back');await page.click('#newProduct');await page.fill('#productName','重複');await page.fill('#barcode','0012345678905');await page.click('#saveProduct');await page.locator('#duplicateBarcode:not([hidden])').waitFor();assert.equal((await page.evaluate(async()=>new (await import('./store.js')).InventoryStore().list())).length,1);
  await page.fill('#barcode','NEW-2');await page.fill('#sku','TAPE-01');await page.locator('#productName').focus();await page.locator('#skuWarning:not([hidden])').waitFor();
  page.once('dialog',d=>d.dismiss());await page.click('#saveProduct');assert.equal((await page.evaluate(async()=>new (await import('./store.js')).InventoryStore().list())).length,1);
  await page.fill('#sku','');await page.fill('#productName','作業用テープ 改');await page.selectOption('#productCategory','supply');await page.selectOption('#unit','m');await page.fill('#initialQuantity','0.1');await page.click('#saveProduct');await page.locator('#detailView:not([hidden])').waitFor();
  const decimal=await page.evaluate(async()=> (await new (await import('./store.js')).InventoryStore().list()).find(p=>p.barcode==='NEW-2'));
  assert.equal(decimal.category,'supply');assert.equal(decimal.quantityMilli,100);assert.equal(decimal.reorderMilli,null,'Unset threshold stays null');
  await page.getByRole('button',{name:'入庫',exact:true}).click();await page.fill('#moveQuantity','0.2');page.once('dialog',d=>d.accept());await page.click('#confirmMove');await page.locator('#detailView:not([hidden])').waitFor();assert((await page.locator('#productDetail .stock').innerText()).includes('0.3 m'));
  await page.click('#back');await page.selectOption('#categoryFilter','supply');assert.equal(await page.locator('#productList article').count(),1);await page.selectOption('#categoryFilter','sale');assert.equal(await page.locator('#productList article').count(),1);await page.selectOption('#categoryFilter','all');await page.check('#lowOnly');assert.equal(await page.locator('#productList article').count(),1);await page.uncheck('#lowOnly');
  await page.locator(`[data-product-id="${tape.id}"]`).getByRole('button',{name:'詳細'}).click();page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'アーカイブ',exact:true}).click();await page.getByRole('button',{name:'管理対象に戻す',exact:true}).waitFor();
  await page.getByRole('button',{name:'この商品の履歴',exact:true}).click();await page.locator('#historyView:not([hidden])').waitFor();assert.equal(await page.locator('#historyList article').count(),4);assert((await page.locator('#historyList').innerText()).includes('アーカイブ'));
  await page.click('#back');assert.equal(await page.locator('#productList article').count(),1);await page.check('#includeArchived');assert.equal(await page.locator('#productList article').count(),2);
  const atomic=await page.evaluate(async()=>{
    const {InventoryStore,parseQuantity,validateBackup,stockStatus}=await import('./store.js'),store=new InventoryStore(),before=await store.exportData(),p=before.products.find(p=>p.category==='supply');
    const rejected=[];for(const [raw,unit] of [['0.0011','m'],['0.1','個'],['-1','m'],['1e3','m']]){try{parseQuantity(raw,unit)}catch(e){rejected.push(raw)}}
    const original=IDBObjectStore.prototype.add;let failed=false;
    IDBObjectStore.prototype.add=function(...args){if(this.name==='movements'){this.transaction.abort();throw new DOMException('test abort','QuotaExceededError')}return original.apply(this,args)};
    try{await store.move(p.id,{kind:'in',quantityMilli:100,reason:'仕入',expectedRevision:p.revision})}catch(e){failed=true}finally{IDBObjectStore.prototype.add=original}
    const after=await store.exportData();
    const competing=await Promise.allSettled([store.move(p.id,{kind:'out',quantityMilli:100,reason:'作業使用',expectedRevision:p.revision}),store.move(p.id,{kind:'out',quantityMilli:100,reason:'作業使用',expectedRevision:p.revision})]);
    let blocked=false;try{await store.update(p.id,{...p,unit:'L'},(await store.get(p.id)).revision)}catch(e){blocked=true}
    const backup=await store.exportData();validateBackup(backup);
    return {unchanged:JSON.stringify(before)===JSON.stringify(after),failed,rejected,successes:competing.filter(r=>r.status==='fulfilled').length,blocked,stock:(await store.get(p.id)).quantityMilli,unset:stockStatus({...p,quantityMilli:0,reorderMilli:null})};
  });
  assert(atomic.failed&&atomic.unchanged,'Product and history roll back together');assert.equal(atomic.rejected.length,4);assert.equal(atomic.successes,1,'Concurrent stale confirmation is rejected');assert(atomic.blocked);assert.equal(atomic.stock,200);assert.deepEqual(atomic.unset,{empty:true,low:false});
  const clockSafe=await page.evaluate(async()=>{
    const {InventoryStore,validateBackup}=await import('./store.js'),store=new InventoryStore('worktools_inventory_clock_test');
    const p=await store.create({name:'時計変更テスト',category:'sale',sku:'',barcode:'',unit:'個',quantityMilli:0,reorderMilli:null,costYen:null,saleYen:null,memo:''});
    const RealDate=Date;window.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[RealDate.now()-60000]))}};
    try{const moved=await store.move(p.id,{kind:'in',quantityMilli:1000,reason:'補充',expectedRevision:1});const updated=await store.update(p.id,{...moved.product,name:'変更済み'},2);await store.archive(p.id,true,updated.revision);validateBackup(await store.exportData());return true}
    finally{window.Date=RealDate;indexedDB.deleteDatabase('worktools_inventory_clock_test')}
  });assert(clockSafe,'Clock rollback cannot invalidate the ledger or backup');
  // Literal HTML in customer-controlled fields is displayed without execution.
  const injected='<img src=x onerror="window.inventoryXss=true">';
  await page.click('#newProduct');await page.fill('#productName',injected);await page.fill('#sku','<script>alert(1)</script>');await page.locator('#productForm summary').click();await page.fill('#memo',injected);await page.click('#saveProduct');await page.locator('#detailView:not([hidden])').waitFor();assert((await page.locator('#productDetail').innerText()).includes(injected));assert.equal(await page.locator('#productDetail img,#productDetail script').count(),0);assert.equal(await page.evaluate(()=>window.inventoryXss),undefined);
  await page.click('#back');await page.click('#newProduct');await page.fill('#productName','保存失敗テスト');
  await page.evaluate(async()=>{const {InventoryStore}=await import('./store.js');window.originalCreate=InventoryStore.prototype.create;InventoryStore.prototype.create=async()=>{throw new DOMException('test full','QuotaExceededError')}});
  await page.click('#saveProduct');await page.waitForFunction(()=>document.getElementById('status').textContent.includes('空き容量'));assert.equal(await page.locator('#editView').isVisible(),true);assert.equal((await page.evaluate(async()=>new (await import('./store.js')).InventoryStore().list())).length,3);
  await page.evaluate(async()=>{(await import('./store.js')).InventoryStore.prototype.create=window.originalCreate;delete window.originalCreate});
  await page.click('#back');await page.click('#scanBarcode');await page.fill('#manualBarcode','https://example.invalid/no-navigation');await page.locator('#manualBarcodeForm button').click();await page.locator('#editView:not([hidden])').waitFor();assert.equal(await page.inputValue('#barcode'),'https://example.invalid/no-navigation');assert(page.url().startsWith(base+'/inventory/'));
  await page.click('#back');await page.click('#allHistory');await page.locator('#historyView:not([hidden])').waitFor();assert.equal(await page.locator('#historyList article').count(),8);
  await page.click('#back');if(process.env.INVENTORY_SCREENSHOT)await page.screenshot({path:process.env.INVENTORY_SCREENSHOT,fullPage:true});
  const saved=await page.evaluate(async()=>new (await import('./store.js')).InventoryStore().exportData());
  assert.equal(unexpected.length,0,'Unexpected requests: '+unexpected.join(', '));assert.equal(errors.length,0,'Runtime errors: '+errors.join(', '));
  await context.close();context=await launch();const reopened=await context.newPage();await reopened.goto(base+'/inventory/');await reopened.waitForFunction(()=>document.getElementById('productCount').textContent!=='—');
  assert.deepEqual(await reopened.evaluate(async()=>new (await import('./store.js')).InventoryStore().exportData()),saved,'Data survives a full browser restart');
  console.log('PASS: inventory UI, categories/search, leading-zero/duplicate barcodes, atomic movements, decimals, history/archive, XSS, persistence, no uploads');
 }finally{if(context)await context.close();assert.equal(path.dirname(profile),path.resolve(os.tmpdir()));assert(path.basename(profile).startsWith('shop-inventory-test-'));fs.rmSync(profile,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
