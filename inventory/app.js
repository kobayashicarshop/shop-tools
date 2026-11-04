import {InventoryStore,parseQuantity,formatQuantity,stockStatus,REASONS} from './store.js';
import {BarcodeScanner} from './scanner.js';
const $=id=>document.getElementById(id),store=new InventoryStore();
const categoryName=v=>v==='sale'?'販売商品':'消耗品',kindName={initial:'初期登録',in:'入庫',out:'出庫',adjust:'棚卸調整'};
const dateLabel=value=>new Date(value).toLocaleString('ja-JP');
const normalize=value=>String(value).normalize('NFKC').toLocaleLowerCase('ja-JP');
let products=[],editing=null,selected=null,moveKind=null,visibleCount=40,historyCount=40,historyRows=[],view='listView',busy=false;
const node=(tag,value,className)=>{const el=document.createElement(tag);if(value!==undefined)el.textContent=value;if(className)el.className=className;return el};
function button(label,action,className=''){const el=node('button',label,className);el.type='button';el.onclick=()=>safe(action);return el}
function status(message,error=false){const el=$('status');el.textContent=message;el.hidden=false;el.className=error?'error':'';el.setAttribute('role',error?'alert':'status');if(error)el.scrollIntoView({block:'nearest'})}
function readable(error){return error?.name==='QuotaExceededError'?'端末の空き容量が不足しています。保存できませんでした。バックアップを保管し、空き容量をご確認ください。':error?.name==='ConstraintError'?'同じバーコードまたは操作が登録済みです。商品を確認してください。':error?.message||'保存できませんでした。ブラウザーの保存設定をご確認ください。'}
async function safe(action){if(busy)return;try{await action()}catch(error){console.error(error);status(readable(error),true)}}
async function saving(buttonId,action){
  if(busy)return;busy=true;
  const controls=[...document.querySelectorAll('button,input,select,textarea')].map(el=>[el,el.disabled]);
  for(const [el] of controls)el.disabled=true;$(buttonId).setAttribute('aria-busy','true');
  try{await action()}finally{for(const [el,disabled] of controls)el.disabled=disabled;$(buttonId).removeAttribute('aria-busy');busy=false}
}
document.addEventListener('click',event=>{if(busy&&event.target.closest('a')){event.preventDefault();event.stopImmediatePropagation()}},true);
const scanner=new BarcodeScanner($('camera'),{
  onResult:result=>safe(()=>barcodeResult(typeof result==='string'?result:result.text)),
  onError:error=>{$('cameraStatus').textContent=readable(error)+' 手入力または画像ファイルからの読み取りも使えます。';}
});
function show(id){if(id!=='scannerView')scanner.stop();view=id;$('status').hidden=true;for(const name of ['listView','editView','detailView','moveView','historyView','scannerView'])$(name).hidden=name!==id;$('back').hidden=id==='listView';window.scrollTo(0,0)}
async function refresh(){products=await store.list();renderList()}
async function home(){scanner.stop();show('listView');await refresh()}
function badges(p){const box=node('div'),state=stockStatus(p);box.append(node('span',categoryName(p.category),'badge'));if(p.archived)box.append(node('span','アーカイブ','badge'));if(state.empty)box.append(node('span','在庫なし','badge empty'));if(state.low)box.append(node('span','要補充','badge low'));return box}
function renderList(){
  const active=products.filter(p=>!p.archived);$('productCount').textContent=active.length;$('lowCount').textContent=active.filter(p=>stockStatus(p).low).length;
  const query=normalize($('search').value.trim()),filter=$('categoryFilter').value;
  const filtered=products.filter(p=>(!p.archived||$('includeArchived').checked)&&(filter==='all'||p.category===filter)&&(!$('lowOnly').checked||stockStatus(p).low)&&(!query||[p.name,p.sku,p.barcode].some(v=>normalize(v).includes(query)))).sort((a,b)=>a.name.localeCompare(b.name,'ja')||a.id.localeCompare(b.id));
  $('listSummary').textContent=filtered.length+'件'+(filtered.length>visibleCount?'（'+visibleCount+'件を表示）':'');
  const list=$('productList');list.replaceChildren();
  if(!filtered.length)list.append(node('p',products.length?'条件に合う商品がありません。':'商品はまだありません。「商品を登録」またはバーコード読み取りから始めてください。','empty-list'));
  for(const p of filtered.slice(0,visibleCount)){
    const card=node('article',undefined,'product'+(p.archived?' archived':''));card.dataset.productId=p.id;
    card.append(node('h3',p.name),badges(p),node('p','品番：'+(p.sku||'未設定')),node('p',formatQuantity(p.quantityMilli)+' '+p.unit,'stock'));
    const actions=node('div',undefined,'actions');if(!p.archived)actions.append(button('入庫',()=>openMove(p.id,'in'),'in'),button('出庫',()=>openMove(p.id,'out'),'out'));actions.append(button('詳細',()=>detail(p.id)));card.append(actions);list.append(card);
  }
  $('moreProducts').hidden=filtered.length<=visibleCount;
}
async function detail(productId){
  const p=await store.get(productId);if(!p)throw Error('商品が見つかりません');selected=p;
  const card=node('article',undefined,'card');card.append(node('h2',p.name),badges(p),node('p',formatQuantity(p.quantityMilli)+' '+p.unit,'stock'));
  const dl=node('dl',undefined,'details-grid');
  for(const [label,value] of [['品番',p.sku||'未設定'],['バーコード',p.barcode||'未設定'],['補充基準',p.reorderMilli===null?'未設定':formatQuantity(p.reorderMilli)+' '+p.unit],['仕入単価',p.costYen===null?'未設定':p.costYen.toLocaleString()+'円（税込）'],['参考販売単価',p.saleYen===null?'未設定':p.saleYen.toLocaleString()+'円（税込）'],['メモ',p.memo||'なし'],['商品ID',p.id],['作成日時',dateLabel(p.createdAt)],['更新日時',dateLabel(p.updatedAt)]])dl.append(node('dt',label),node('dd',value));
  card.append(dl);const actions=node('div',undefined,'actions');if(!p.archived)actions.append(button('入庫',()=>openMove(p.id,'in'),'in'),button('出庫',()=>openMove(p.id,'out'),'out'),button('棚卸調整',()=>openMove(p.id,'adjust')));card.append(actions);
  const manage=node('div',undefined,'actions');manage.append(button('商品を編集',()=>openEdit(p.id)),button('この商品の履歴',()=>openHistory(p.id)),button(p.archived?'管理対象に戻す':'アーカイブ',async()=>{
    if(!confirm(p.archived?'この商品を管理対象に戻しますか？':'管理対象から除外します。商品と過去の履歴は残ります。アーカイブしますか？'))return;
    await store.archive(p.id,!p.archived,p.revision);await refresh();await detail(p.id);status(p.archived?'管理対象に戻しました':'アーカイブしました');
  }));card.append(manage);$('productDetail').replaceChildren(card);show('detailView');
}
function unitHelp(){const decimals=['m','L'].includes($('unit').value);$('unitHint').textContent=(editing?'現在庫は「入庫・出庫・棚卸調整」から変更できます。履歴があるため単位は変更できません。':'初期在庫も履歴に記録します。')+(decimals?' 数量は小数第3位まで入力できます。':' 数量は整数で入力してください。')}
async function openEdit(productId=null,barcode=''){
  editing=productId?await store.get(productId):null;if(productId&&!editing)throw Error('商品が見つかりません');
  $('productForm').reset();$('productForm').querySelector('details').open=false;const p=editing||{name:'',category:'sale',unit:'個',sku:'',barcode,quantityMilli:0,reorderMilli:null,costYen:null,saleYen:null,memo:''};
  for(const [input,field] of [['productName','name'],['productCategory','category'],['unit','unit'],['sku','sku'],['barcode','barcode'],['memo','memo']])$(input).value=p[field];
  $('initialQuantity').value=formatQuantity(p.quantityMilli);$('initialQuantity').readOnly=!!editing;$('unit').disabled=!!editing;
  $('reorder').value=p.reorderMilli===null?'':formatQuantity(p.reorderMilli);$('cost').value=p.costYen??'';$('salePrice').value=p.saleYen??'';
  $('editTitle').textContent=editing?'商品を編集':'商品登録';$('productMeta').hidden=!editing;$('productMeta').textContent=editing?'商品ID：'+p.id+' ／ 作成：'+dateLabel(p.createdAt):'';
  $('skuWarning').hidden=true;$('duplicateBarcode').hidden=true;unitHelp();show('editView');
}
function price(value){if(!value.trim())return null;if(!/^\d+$/.test(value.trim())||Number(value)>999999999)throw Error('単価は0〜999,999,999円の整数で入力してください');return Number(value)}
async function checkCode(code=$('barcode').value.trim(),editingId=editing?.id){const box=$('duplicateBarcode');box.hidden=true;box.replaceChildren();if(!code)return null;const p=await store.findBarcode(code);if(p&&p.id!==editingId){box.append(node('p','同じバーコードが登録済みです：'+p.name+(p.archived?'（アーカイブ中）':'')),button('既存商品を確認',()=>detail(p.id)));box.hidden=false;return p}return null}
async function skuDuplicates(sku=$('sku').value.trim(),editingId=editing?.id){const all=await store.list();return sku?all.filter(p=>p.id!==editingId&&normalize(p.sku)===normalize(sku)):[]}
$('productForm').onsubmit=event=>{event.preventDefault();safe(()=>saving('saveProduct',async()=>{
  const target=editing?{id:editing.id,revision:editing.revision}:null,unit=$('unit').value,input={name:$('productName').value,category:$('productCategory').value,sku:$('sku').value,barcode:$('barcode').value,unit,
    quantityMilli:parseQuantity($('initialQuantity').value,unit),reorderMilli:$('reorder').value.trim()?parseQuantity($('reorder').value,unit):null,costYen:price($('cost').value),saleYen:price($('salePrice').value),memo:$('memo').value};
  if(await checkCode(input.barcode.trim(),target?.id))throw Error('同じバーコードの商品があります。既存商品を確認してください。');
  const duplicates=await skuDuplicates(input.sku.trim(),target?.id);if(duplicates.length&&!confirm('同じ品番の商品があります（'+duplicates.slice(0,3).map(p=>p.name).join('、')+'）。別商品として保存しますか？'))return;
  const saved=target?await store.update(target.id,input,target.revision):await store.create(input);await refresh();await detail(saved.id);status('商品を保存しました');
}))};
$('sku').onblur=()=>safe(async()=>{const duplicates=await skuDuplicates();$('skuWarning').textContent=duplicates.length?'同じ品番の商品があります：'+duplicates.slice(0,3).map(p=>p.name).join('、'):'';$('skuWarning').hidden=!duplicates.length});
$('barcode').onblur=()=>safe(checkCode);$('unit').onchange=unitHelp;
async function openMove(productId,kind){
  const p=await store.get(productId);if(!p||p.archived)throw Error('管理対象の商品を選択してください');selected=p;moveKind=kind;$('moveForm').reset();
  $('moveTitle').textContent=kindName[kind];$('moveProduct').textContent=p.name;$('currentStock').textContent='現在庫：'+formatQuantity(p.quantityMilli)+' '+p.unit;
  $('quantityLabel').textContent=kind==='adjust'?'実際に数えた数量（'+p.unit+'）':kindName[kind]+'数量（'+p.unit+'）';$('moveQuantity').value=kind==='adjust'?formatQuantity(p.quantityMilli):'';
  $('reasonSelectLabel').hidden=kind==='adjust';$('adjustReasonLabel').hidden=kind!=='adjust';$('adjustReason').required=kind==='adjust';$('reasonSelect').replaceChildren();for(const reason of REASONS[kind]||[])$('reasonSelect').append(new Option(reason,reason));
  $('confirmMove').className=kind==='in'?'in':kind==='out'?'out':'primary';previewMove();show('moveView');
}
function movementInput(){const quantityMilli=parseQuantity($('moveQuantity').value,selected.unit);if(moveKind!=='adjust'&&quantityMilli===0)throw Error('数量は0より大きい値で入力してください');const after=moveKind==='adjust'?quantityMilli:selected.quantityMilli+(moveKind==='in'?quantityMilli:-quantityMilli);if(after<0)throw Error('現在庫を超える出庫はできません');return {quantityMilli,after,reason:moveKind==='adjust'?$('adjustReason').value.trim():$('reasonSelect').value}}
function previewMove(){try{const {after}=movementInput();$('stockPreview').textContent='変更後：'+formatQuantity(after)+' '+selected.unit}catch(error){$('stockPreview').textContent=$('moveQuantity').value?error.message:'数量を入力してください'}}
$('moveQuantity').oninput=previewMove;
$('moveForm').onsubmit=event=>{event.preventDefault();safe(()=>saving('confirmMove',async()=>{
  const input=movementInput();if(!input.reason)throw Error('調整理由を入力してください');
  if(!confirm(selected.name+'\n'+kindName[moveKind]+'：'+formatQuantity(selected.quantityMilli)+' → '+formatQuantity(input.after)+' '+selected.unit+'\n理由：'+input.reason+'\nこの内容で確定しますか？'))return;
  const result=await store.move(selected.id,{kind:moveKind,quantityMilli:input.quantityMilli,reason:input.reason,memo:$('moveMemo').value,expectedRevision:selected.revision});
  await refresh();await detail(result.product.id);status(kindName[moveKind]+'を記録しました');
}))};
async function openHistory(productId=null){await refresh();historyRows=await store.history(productId);historyCount=40;const p=products.find(p=>p.id===productId);$('historyTitle').textContent=p?p.name+'の履歴':'全商品の入出庫履歴';renderHistory();show('historyView')}
function renderHistory(){const list=$('historyList');list.replaceChildren();if(!historyRows.length)list.append(node('p','履歴はありません。','empty-list'));const map=new Map(products.map(p=>[p.id,p]));for(const m of historyRows.slice(0,historyCount)){
  const p=map.get(m.productId),card=node('article',undefined,'history');card.append(node('h3',(p?.name||m.productId)+(p?.archived?'（アーカイブ）':'')),node('p',kindName[m.kind]+'　'+(m.deltaMilli>0?'+':'')+formatQuantity(m.deltaMilli)+' '+m.unit),node('p',formatQuantity(m.beforeMilli)+' → '+formatQuantity(m.afterMilli)+' '+m.unit),node('p','理由：'+m.reason));if(m.memo)card.append(node('p',m.memo));card.append(node('small',dateLabel(m.at)+' ／ 操作ID：'+m.id),button('商品を確認',()=>detail(m.productId)));list.append(card)}$('moreHistory').hidden=historyRows.length<=historyCount;}
async function barcodeResult(raw){const code=String(raw??'').trim();if(!code||code.length>2048)throw Error('バーコード番号は1〜2048文字で入力してください');scanner.stop();const found=await store.findBarcode(code);if(found){await detail(found.id);status(found.archived?'アーカイブ中の商品です。必要に応じて管理対象に戻してください。':'登録済みの商品です。入庫・出庫を選び、数量を確認してください。')}else{await openEdit(null,code);status('未登録のバーコードです。商品情報を入力して保存してください。')}}
async function startCamera(){show('scannerView');$('cameraStatus').textContent='カメラの使用許可を確認しています…';const started=await scanner.start();if(started&&view==='scannerView')$('cameraStatus').textContent='バーコード全体を枠内に映してください。読み取り後にカメラは停止します。'}
$('scanBarcode').onclick=()=>safe(startCamera);$('restartCamera').onclick=()=>safe(startCamera);$('stopCamera').onclick=()=>{scanner.stop();$('cameraStatus').textContent='カメラを停止しました。手入力や画像ファイルから読み取れます。'};
$('closeScanner').onclick=()=>safe(home);$('manualBarcodeForm').onsubmit=event=>{event.preventDefault();safe(()=>barcodeResult($('manualBarcode').value))};
$('barcodeImage').onchange=event=>safe(async()=>{const file=event.target.files?.[0];if(!file)return;try{$('cameraStatus').textContent='画像を読み取っています…';await scanner.readImage(file)}finally{event.target.value=''}});
document.addEventListener('visibilitychange',()=>{if(document.hidden){scanner.stop();if(view==='scannerView')$('cameraStatus').textContent='画面を離れたためカメラを停止しました。再開するときは「カメラを開始」を押してください。'}});
window.addEventListener('pagehide',()=>scanner.stop());
$('back').onclick=()=>safe(home);$('newProduct').onclick=()=>safe(()=>openEdit());$('allHistory').onclick=()=>safe(()=>openHistory());
for(const id of ['search','categoryFilter','lowOnly','includeArchived'])$(id).addEventListener(id==='search'?'input':'change',()=>{visibleCount=40;renderList()});
$('moreProducts').onclick=()=>{visibleCount+=40;renderList()};$('moreHistory').onclick=()=>{historyCount+=40;renderHistory()};
window.__toolBeforeLeave=()=>{scanner.stop();return Promise.resolve()};
safe(home);
