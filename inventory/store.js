// Inventory quantities are integers in thousandths. No network access is used.
export const DB_NAME = 'worktools_inventory_v1';
export const UNITS = ['個','本','巻','箱','袋','セット','m','L','その他'];
export const REASONS = {in:['仕入','返品','補充','その他'],out:['販売','作業使用','廃棄','その他']};
export const MAX_QUANTITY = 9999999999;
const DECIMAL_UNITS = new Set(['m','L']);
const fail = message => { throw new Error(message); };
const id = prefix => prefix + '_' + crypto.randomUUID();
const now = () => new Date().toISOString();
// A device clock adjustment must not make an otherwise valid ledger unrestorable.
const nextTime = previous => {const value=now();return value<previous?previous:value};
const integer = (value,min,max,label) => Number.isSafeInteger(value) && value>=min && value<=max ? value : fail(label+'が不正です');
const text = (value,max,label,required=false) => {
  if(typeof value!=='string'||value.length>max)fail(label+'が不正です');
  const result=value.trim();if(required&&!result)fail(label+'を入力してください');return result;
};
const identifier = value => typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value)?value:fail('IDが不正です');
const date = value => typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString()===value?value:fail('日時が不正です');
const nullable = (value,max,label) => value===null?null:integer(value,0,max,label);
export function parseQuantity(value,unit) {
  if(!UNITS.includes(unit))fail('単位を選択してください');
  const raw=String(value).trim();
  if(!/^\d+(?:\.\d{1,3})?$/.test(raw))fail('数量は0以上、小数第3位までで入力してください');
  const [whole,part='']=raw.split('.');
  const milli=Number(whole)*1000+Number(part.padEnd(3,'0'));
  integer(milli,0,MAX_QUANTITY,'数量');
  if(!DECIMAL_UNITS.has(unit)&&milli%1000)fail('この単位の数量は整数で入力してください');
  return milli;
}
export function formatQuantity(milli) {
  integer(milli,-MAX_QUANTITY,MAX_QUANTITY,'数量');
  const sign=milli<0?'-':'',n=Math.abs(milli),whole=Math.floor(n/1000),part=String(n%1000).padStart(3,'0').replace(/0+$/,'');
  return sign+whole+(part?'.'+part:'');
}
export function stockStatus(product) {
  return {empty:product.quantityMilli===0,low:product.reorderMilli!==null&&product.quantityMilli<=product.reorderMilli};
}
function productFields(input) {
  if(!input||typeof input!=='object')fail('商品データが不正です');
  const p={name:text(input.name,120,'商品名',true),category:input.category,sku:text(input.sku,100,'品番'),barcode:text(input.barcode,2048,'バーコード'),unit:input.unit,
    reorderMilli:nullable(input.reorderMilli,MAX_QUANTITY,'補充基準'),costYen:nullable(input.costYen,999999999,'仕入単価'),saleYen:nullable(input.saleYen,999999999,'参考販売単価'),memo:text(input.memo,2000,'メモ')};
  if(!['sale','supply'].includes(p.category))fail('分類を選択してください');
  if(!UNITS.includes(p.unit))fail('単位を選択してください');
  if(p.reorderMilli!==null&&!DECIMAL_UNITS.has(p.unit)&&p.reorderMilli%1000)fail('補充基準は整数で入力してください');
  if(p.barcode)p.barcodeKey=p.barcode;
  return p;
}
function validateProduct(input) {
  const p={...productFields(input),id:identifier(input.id),quantityMilli:integer(input.quantityMilli,0,MAX_QUANTITY,'在庫数'),
    createdAt:date(input.createdAt),updatedAt:date(input.updatedAt),archived:input.archived,
    revision:integer(input.revision,1,Number.MAX_SAFE_INTEGER,'更新番号'),stockSequence:integer(input.stockSequence,1,Number.MAX_SAFE_INTEGER,'履歴番号')};
  if(typeof p.archived!=='boolean'||p.createdAt>p.updatedAt||p.revision<p.stockSequence)fail('商品の更新情報が不正です');
  if(!DECIMAL_UNITS.has(p.unit)&&p.quantityMilli%1000)fail('在庫数の単位が不正です');
  return p;
}
function validateMovement(input) {
  if(!input||typeof input!=='object')fail('履歴データが不正です');
  const m={id:identifier(input.id),productId:identifier(input.productId),at:date(input.at),kind:input.kind,
    beforeMilli:integer(input.beforeMilli,0,MAX_QUANTITY,'変更前数量'),deltaMilli:integer(input.deltaMilli,-MAX_QUANTITY,MAX_QUANTITY,'増減数量'),
    afterMilli:integer(input.afterMilli,0,MAX_QUANTITY,'変更後数量'),reason:text(input.reason,200,'理由',true),memo:text(input.memo,2000,'備考'),unit:input.unit,
    sequence:integer(input.sequence,1,Number.MAX_SAFE_INTEGER,'履歴番号')};
  if(!['initial','in','out','adjust'].includes(m.kind)||!UNITS.includes(m.unit)||m.beforeMilli+m.deltaMilli!==m.afterMilli)fail('履歴の数量が一致しません');
  if(!DECIMAL_UNITS.has(m.unit)&&(m.beforeMilli%1000||m.afterMilli%1000))fail('履歴の単位が不正です');
  if(m.kind==='initial'&&(m.beforeMilli!==0||m.sequence!==1||m.reason!=='初期登録'))fail('初期登録の履歴が不正です');
  if(m.kind==='in'&&(m.deltaMilli<=0||!REASONS.in.includes(m.reason)))fail('入庫の履歴が不正です');
  if(m.kind==='out'&&(m.deltaMilli>=0||!REASONS.out.includes(m.reason)))fail('出庫の履歴が不正です');
  return m;
}
export function validateBackup(data) {
  if(!data||data.version!==1||!Array.isArray(data.products)||!Array.isArray(data.movements))fail('在庫バックアップの形式が不正です');
  if(data.products.length>50000||data.movements.length>500000)fail('在庫バックアップの件数が上限を超えています');
  const products=data.products.map(validateProduct),movements=data.movements.map(validateMovement),byId=new Map(),codes=new Set(),ops=new Set(),groups=new Map();
  for(const p of products){if(byId.has(p.id))fail('商品IDが重複しています');byId.set(p.id,p);if(p.barcode){if(codes.has(p.barcode))fail('バーコードが重複しています');codes.add(p.barcode)}groups.set(p.id,[])}
  for(const m of movements){if(ops.has(m.id))fail('操作IDが重複しています');ops.add(m.id);if(!byId.has(m.productId))fail('履歴に対応する商品がありません');groups.get(m.productId).push(m)}
  for(const p of products){
    const history=groups.get(p.id).sort((a,b)=>a.sequence-b.sequence);let previous=0,at=p.createdAt;
    if(!history.length||history.length!==p.stockSequence)fail('商品の履歴が不足しています');
    for(const [i,m] of history.entries()){
      if(m.sequence!==i+1||m.unit!==p.unit||m.beforeMilli!==previous||m.at<at||m.at>p.updatedAt||(i===0?m.kind!=='initial'||m.at!==p.createdAt:m.kind==='initial'))fail('商品と履歴の整合性が取れていません');
      previous=m.afterMilli;at=m.at;
    }
    if(previous!==p.quantityMilli)fail('現在庫と履歴の数量が一致しません');
  }
  return {version:1,products,movements};
}
export class InventoryStore {
  constructor(name=DB_NAME){this.name=name;}
  open(){return new Promise((resolve,reject)=>{
    const request=indexedDB.open(this.name,1);
    request.onupgradeneeded=()=>{
      const db=request.result,p=db.createObjectStore('products',{keyPath:'id'});
      p.createIndex('barcode','barcodeKey',{unique:true});p.createIndex('sku','sku');
      const m=db.createObjectStore('movements',{keyPath:'id'});m.createIndex('productId','productId');
    };
    request.onerror=()=>reject(request.error||new Error('在庫データを開けませんでした'));
    request.onblocked=()=>reject(new Error('他のタブを閉じて再度お試しください'));
    request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result)};
  })}
  async run(mode,work){
    const db=await this.open();return new Promise((resolve,reject)=>{
      let result,error;const tx=db.transaction(['products','movements'],mode);
      const abort=e=>{error=e;try{tx.abort()}catch(_){}};
      const guard=fn=>(...args)=>{try{fn(...args)}catch(e){abort(e)}};
      tx.oncomplete=()=>{db.close();resolve(result)};
      tx.onabort=()=>{db.close();reject(error||tx.error||new Error('保存を完了できませんでした'))};
      tx.onerror=()=>{error=error||tx.error};
      try{work({products:tx.objectStore('products'),movements:tx.objectStore('movements'),result:v=>{result=v},guard,abort})}catch(e){abort(e)}
    });
  }
  exportData(){return this.run('readonly',ctx=>{
    const p=ctx.products.getAll(),m=ctx.movements.getAll();let products,movements;
    const done=()=>{if(products&&movements)ctx.result({version:1,products,movements})};
    p.onsuccess=()=>{products=p.result;done()};m.onsuccess=()=>{movements=m.result;done()};
  })}
  list(){return this.run('readonly',ctx=>{const q=ctx.products.getAll();q.onsuccess=()=>ctx.result(q.result)})}
  get(productId){return this.run('readonly',ctx=>{const q=ctx.products.get(productId);q.onsuccess=()=>ctx.result(q.result||null)})}
  history(productId=null){return this.run('readonly',ctx=>{
    const q=productId?ctx.movements.index('productId').getAll(productId):ctx.movements.getAll();
    q.onsuccess=()=>ctx.result(q.result.sort((a,b)=>b.at.localeCompare(a.at)||b.sequence-a.sequence||b.id.localeCompare(a.id)));
  })}
  findBarcode(barcode){return this.run('readonly',ctx=>{const q=ctx.products.index('barcode').get(barcode);q.onsuccess=()=>ctx.result(q.result||null)})}
  unique(ctx,p,write){
    if(!p.barcode){write();return}
    const q=ctx.products.index('barcode').get(p.barcode);
    q.onsuccess=ctx.guard(()=>{if(q.result&&q.result.id!==p.id)fail('同じバーコードの商品が登録済みです。一覧から既存商品を開いてください');write()});
  }
  create(input){
    const at=now(),p=validateProduct({...input,id:id('p'),createdAt:at,updatedAt:at,archived:false,revision:1,stockSequence:1});
    const m=validateMovement({id:id('op'),productId:p.id,at,kind:'initial',beforeMilli:0,deltaMilli:p.quantityMilli,afterMilli:p.quantityMilli,reason:'初期登録',memo:'',unit:p.unit,sequence:1});
    return this.run('readwrite',ctx=>this.unique(ctx,p,()=>{ctx.products.add(p);ctx.movements.add(m);ctx.result(p)}));
  }
  update(productId,input,expectedRevision){
    const fields=productFields(input);
    return this.run('readwrite',ctx=>{const q=ctx.products.get(productId);q.onsuccess=ctx.guard(()=>{
      const old=q.result;if(!old)fail('商品が見つかりません');if(old.revision!==expectedRevision)fail('別の画面で更新されました。商品を開き直してください');
      if(old.unit!==fields.unit)fail('履歴がある商品の単位は変更できません。別の商品として登録してください');
      const p={...old,...fields,updatedAt:nextTime(old.updatedAt),revision:old.revision+1};delete p.barcodeKey;if(p.barcode)p.barcodeKey=p.barcode;
      this.unique(ctx,p,()=>{ctx.products.put(p);ctx.result(p)});
    })});
  }
  archive(productId,archived,expectedRevision){
    if(typeof archived!=='boolean')fail('アーカイブ指定が不正です');
    return this.run('readwrite',ctx=>{const q=ctx.products.get(productId);q.onsuccess=ctx.guard(()=>{
      const p=q.result;if(!p)fail('商品が見つかりません');if(p.revision!==expectedRevision)fail('別の画面で更新されました。商品を開き直してください');
      p.archived=archived;p.updatedAt=nextTime(p.updatedAt);p.revision++;ctx.products.put(p);ctx.result(p);
    })});
  }
  move(productId,{kind,quantityMilli,reason,memo='',expectedRevision}){
    if(!['in','out','adjust'].includes(kind))fail('操作を選択してください');
    integer(quantityMilli,kind==='adjust'?0:1,MAX_QUANTITY,'数量');text(reason,200,'理由',true);text(memo,2000,'備考');
    if(kind!=='adjust'&&!REASONS[kind].includes(reason))fail('理由を選択してください');
    return this.run('readwrite',ctx=>{const q=ctx.products.get(productId);q.onsuccess=ctx.guard(()=>{
      const p=q.result;if(!p)fail('商品が見つかりません');if(p.archived)fail('アーカイブ中の商品は操作できません');
      if(p.revision!==expectedRevision)fail('在庫が別の画面で更新されました。現在庫を確認し直してください');
      if(!DECIMAL_UNITS.has(p.unit)&&quantityMilli%1000)fail('この単位は整数で入力してください');
      const before=p.quantityMilli,after=kind==='adjust'?quantityMilli:before+(kind==='in'?quantityMilli:-quantityMilli);
      if(after<0)fail('現在庫を超える出庫はできません');integer(after,0,MAX_QUANTITY,'変更後数量');
      const at=nextTime(p.updatedAt),m=validateMovement({id:id('op'),productId,at,kind,beforeMilli:before,deltaMilli:after-before,afterMilli:after,reason,memo,unit:p.unit,sequence:p.stockSequence+1});
      p.quantityMilli=after;p.updatedAt=at;p.revision++;p.stockSequence++;
      ctx.products.put(p);ctx.movements.add(m);ctx.result({product:p,movement:m});
    })});
  }
  replaceData(data){
    const checked=validateBackup(data);
    return this.run('readwrite',ctx=>{ctx.products.clear();ctx.movements.clear();for(const p of checked.products)ctx.products.add(p);for(const m of checked.movements)ctx.movements.add(m);ctx.result(checked.products.length)});
  }
}
