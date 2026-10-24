(()=>{'use strict';
const $=id=>document.getElementById(id);
const DRAFT='estimate_worktools_draft_v1',TEMPLATES='estimate_worktools_templates_v1',HISTORY='estimate_worktools_history_v1',DB='estimate_worktools_pdfs_v1';
const RECEIPT_ISSUER='receipt_unified_issuer_v2',PROFILE='worktools_profile_v1';
const today=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
const newLine=()=>({description:'',quantity:'1',unit:'式',unitPrice:'',rate:'10'});
const fresh=()=>({quoteDate:today(),showNumber:false,quoteNo:'',recipient:'',suffix:'様',subject:'',validUntil:'',notes:'',issuerText:'',stampData:'',showSeal:true,items:[newLine()]});
const load=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||'null')??fallback}catch(_){return fallback}};
const save=(key,value)=>localStorage.setItem(key,JSON.stringify(value));
let state={...fresh(),...load(DRAFT,{})},templates=load(TEMPLATES,[]),history=load(HISTORY,[]);
if(!Array.isArray(state.items)||!state.items.length)state.items=[newLine()];
let screen='home',snapshot=null,busy=false,toastTimer=null;
const basic=['quoteDate','showNumber','quoteNo','recipient','suffix','subject','validUntil','notes','issuerText','showSeal'];
const checks=new Set(['showNumber','showSeal']);
const esc=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const yen=n=>'¥'+Math.round(n).toLocaleString('ja-JP');
function note(s){const el=$('toast');el.textContent=s;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3300)}
function readInputs(){
 for(const id of basic){const element=$(id);state[id]=checks.has(id)?element.checked:element.value}
 return state;
}
function persist(){try{save(DRAFT,readInputs())}catch(error){console.error(error);note('端末に保存できませんでした')}}
function show(name){
 if(screen==='edit')persist();
 screen=name;
 for(const s of document.querySelectorAll('.screen'))s.classList.toggle('active',s.id==='s-'+name);
 $('back').hidden=name==='home';
 $('screenTitle').textContent=({home:'見積書作成',edit:'見積書を入力',preview:'見積書の完成イメージ',templates:'テンプレートから作成',history:'履歴から作成'})[name]||'見積書作成';
 if(name==='edit')fill();
 if(name==='templates')renderTemplates();
 if(name==='history')renderHistory();
 scrollTo(0,0);
}
$('back').onclick=()=>show(screen==='preview'?'edit':'home');
document.addEventListener('click',event=>{const button=event.target.closest('[data-go]');if(button){event.preventDefault();show(button.dataset.go)}});
function fill(){
 for(const id of basic)$(id)[checks.has(id)?'checked':'value']=state[id]??(checks.has(id)?false:'');
 $('numberField').hidden=!state.showNumber;
 $('sealStatus').textContent=state.stampData?'設定済み':'未設定';
 $('sealPreview').hidden=!state.stampData;
 if(state.stampData)$('sealPreview').src=state.stampData;
 renderItems();
}
function calc(data=state){
 const buckets={10:0,8:0,none:0};
 const lines=[];
 for(const line of data.items){
  const quantity=Number(line.quantity),price=Number(String(line.unitPrice).replace(/[,，]/g,''));
  const amount=Number.isFinite(quantity)&&Number.isFinite(price)&&quantity>0&&price>=0?Math.round(quantity*price):0;
  const rate=['10','8','none'].includes(String(line.rate))?String(line.rate):'10';
  buckets[rate]+=amount;
  lines.push({...line,amount,rate});
 }
 const base=buckets[10]+buckets[8]+buckets.none;
 const tax10=Math.floor(buckets[10]*.10),tax8=Math.floor(buckets[8]*.08);
 return {lines,base,tax10,tax8,total:base+tax10+tax8};
}
function renderItems(){
 $('items').innerHTML=state.items.map((line,index)=>
 '<div class="estimate-line" data-index="'+index+'">'+
 '<div class="line-head"><span>明細 '+(index+1)+'</span><button type="button" class="delete-line" data-remove="'+index+'">削除</button></div>'+
 '<label>品目・作業内容<input data-field="description" maxlength="110" placeholder="例：取付作業工賃" value="'+esc(line.description)+'"></label>'+
 '<div class="line-fields">'+
 '<label>数量<input data-field="quantity" type="number" min="0.01" step="0.01" max="99999" value="'+esc(line.quantity)+'"></label>'+
 '<label>単位<select data-field="unit">'+['式','個','台','件','時間','m','回','セット','日','その他'].map(u=>'<option '+(u===line.unit?'selected':'')+'>'+u+'</option>').join('')+'</select></label>'+
 '<label>単価（税抜・円）<input data-field="unitPrice" type="number" min="0" step="1" max="999999999" inputmode="numeric" placeholder="10000" value="'+esc(line.unitPrice)+'"></label>'+
 '<label>消費税<select data-field="rate">'+[['10','10%'],['8','8%'],['none','非課税']].map(([v,n])=>'<option value="'+v+'" '+(v===(line.rate||'10')?'selected':'')+'>'+n+'</option>').join('')+'</select></label>'+
 '</div><div class="line-sum">金額：'+yen(calcLine(line))+'</div></div>').join('');
 updateTotal();
}
function calcLine(l){const q=Number(l.quantity),p=Number(l.unitPrice);return Number.isFinite(q)&&Number.isFinite(p)&&q>0&&p>=0?Math.round(q*p):0}
function updateTotal(){
 const c=calc();$('liveTotal').textContent=yen(c.total);
 for(const element of $('items').querySelectorAll('.estimate-line')){
  const index=Number(element.dataset.index),sum=element.querySelector('.line-sum');
  sum.textContent='金額：'+yen(calcLine(state.items[index]));
 }
}
for(const id of basic){$(id).addEventListener('input',()=>{readInputs();$('numberField').hidden=!state.showNumber;persist()});$(id).addEventListener('change',()=>{readInputs();persist()})}
$('items').addEventListener('input',event=>{
 const field=event.target.dataset.field;
 if(!field)return;
 const i=Number(event.target.closest('.estimate-line')?.dataset.index);
 if(!Number.isInteger(i)||!state.items[i])return;
 state.items[i][field]=event.target.value;updateTotal();persist();
});
$('items').addEventListener('change',event=>{
 const field=event.target.dataset.field;if(!field)return;
 const i=Number(event.target.closest('.estimate-line')?.dataset.index);
 if(!state.items[i])return;
 state.items[i][field]=event.target.value;updateTotal();persist();
});
$('items').addEventListener('click',event=>{
 const button=event.target.closest('[data-remove]');if(!button)return;
 const index=Number(button.dataset.remove);
 if(state.items.length===1){note('明細は1件以上必要です');return}
 state.items.splice(index,1);renderItems();persist();
});
$('addItem').onclick=()=>{if(state.items.length>=50){note('明細は50件までです');return}state.items.push(newLine());renderItems();persist()};
function issuerDefault(){
 const r=load(RECEIPT_ISSUER,{});
 if(r.issuerText||r.stampData){state.issuerText=r.issuerText||state.issuerText;state.stampData=r.stampData||state.stampData;return true}
 const p=load(PROFILE,{});
 state.issuerText=[p.business,p.address,p.phone].filter(Boolean).join('\n')||state.issuerText;
 return !!state.issuerText;
}
if(!state.issuerText)issuerDefault();
$('useReceiptIssuer').onclick=()=>{if(issuerDefault()){fill();persist();note('領収書の発行元設定を読み込みました')}else note('発行元の保存データがありません')};
$('sealFile').onchange=async e=>{
 const file=e.target.files?.[0];if(!file)return;
 if(!file.type.startsWith('image/')||file.size>10*1024*1024){note('10MB以下の画像を選択してください');return}
 const url=URL.createObjectURL(file),img=new Image();
 img.onload=()=>{
  try{const c=document.createElement('canvas'),ctx=c.getContext('2d');
   c.width=c.height=420;
   const ratio=Math.min(420/img.width,420/img.height);
   ctx.drawImage(img,(420-img.width*ratio)/2,(420-img.height*ratio)/2,img.width*ratio,img.height*ratio);
   state.stampData=c.toDataURL('image/png');fill();persist();note('角印を登録しました')
  }catch(error){note('画像を保存できませんでした')}finally{URL.revokeObjectURL(url)}
 };
 img.onerror=()=>{URL.revokeObjectURL(url);note('画像を読み込めませんでした')};
 img.src=url;e.target.value='';
};
$('removeSeal').onclick=()=>{state.stampData='';fill();persist()};
$('clearDraft').onclick=()=>{if(!confirm('現在の下書きをクリアして新規作成しますか？'))return;state=fresh();issuerDefault();fill();persist();note('新しい見積書を作成します')};
function validate(){
 readInputs();
 if(!state.quoteDate)return '見積日を入力してください';
 if(!state.recipient.trim())return '宛名を入力してください';
 if(!state.issuerText.trim())return '発行元を入力してください';
 if(!state.items.length)return '明細を追加してください';
 for(const [i,line] of state.items.entries()){
  if(!line.description.trim())return '明細 '+(i+1)+' の内容を入力してください';
  const quantity=Number(line.quantity),price=Number(line.unitPrice);
  if(!Number.isFinite(quantity)||quantity<=0||quantity>99999||!Number.isFinite(price)||price<0||!Number.isInteger(price)||price>999999999)return '明細 '+(i+1)+' の数量・単価を確認してください';
 }
 const totals=calc();
 if(totals.total<=0||totals.total>999999999)return '合計金額は1〜999,999,999円で入力してください';
 if(state.validUntil&&state.validUntil<state.quoteDate)return '有効期限は見積日以降を指定してください';
 return '';
}
const mincho='"Hiragino Mincho ProN","Yu Mincho","Noto Serif CJK JP",serif';
const gothic='"Hiragino Sans","Yu Gothic","Noto Sans CJK JP",sans-serif';
function dateJa(s){if(!s)return '';const v=s.split('-');return v.length===3?v[0]+'年'+Number(v[1])+'月'+Number(v[2])+'日':s}
function picture(data){return new Promise(resolve=>{if(!data)return resolve(null);const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>resolve(null);i.src=data})}
async function makePages(data){
 const c=calc(data),pages=[],per=10,all=Math.max(1,Math.ceil(c.lines.length/per));
 const stamp=data.showSeal?await picture(data.stampData):null;
 for(let p=0;p<all;p++){
  const canvas=document.createElement('canvas');canvas.width=1654;canvas.height=2339;
  const ctx=canvas.getContext('2d'),ink='#142333',light='#e6ecf3';
  ctx.fillStyle='#fff';ctx.fillRect(0,0,1654,2339);
  ctx.textBaseline='alphabetic';
  function t(str,x,y,size=28,opts={}){
   ctx.fillStyle=opts.color||ink;ctx.textAlign=opts.align||'left';ctx.font=(opts.bold?'bold ':'')+size+'px '+(opts.font||gothic);
   ctx.fillText(String(str??''),x,y,opts.maxWidth||1200);
  }
  function line(y,x1=95,x2=1559,color=light,width=2){ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x1,y);ctx.lineTo(x2,y);ctx.stroke()}
  t('御 見 積 書',827,158,66,{align:'center',bold:true,font:mincho});line(207,95,1559,'#334256',2);
  if(p===0){
   t(data.recipient+(data.suffix==='なし'?'':'　'+data.suffix),110,298,42,{font:mincho,maxWidth:760});
   t('見積日　'+dateJa(data.quoteDate),1530,297,27,{align:'right'});
   if(data.showNumber&&data.quoteNo)t('見積番号　'+data.quoteNo,1530,342,25,{align:'right'});
   if(data.validUntil)t('有効期限　'+dateJa(data.validUntil),1530,386,25,{align:'right'});
   if(data.subject)t('件名：'+data.subject,112,450,30,{maxWidth:1360});
   t('御見積金額（税込）',108,570,28);
   t(yen(c.total),500,583,68,{bold:true,font:mincho});line(617,100,1550,'#78899c',2);
  }else{
   t(data.recipient+(data.suffix==='なし'?'':'　'+data.suffix),112,298,35,{font:mincho,maxWidth:850});
   t('見積日　'+dateJa(data.quoteDate),1530,297,25,{align:'right'});
   t('明細（続き）',105,577,29,{bold:true});
  }
  const head=665;ctx.fillStyle='#ecf3fa';ctx.fillRect(98,head,1456,63);
  t('品目・作業内容',120,708,25,{bold:true});
  t('数量',825,708,25,{align:'right',bold:true});
  t('単位',980,708,25,{align:'right',bold:true});
  t('単価（税抜）',1250,708,24,{align:'right',bold:true});
  t('金額（税抜）',1530,708,24,{align:'right',bold:true});
  const pageLines=c.lines.slice(p*per,(p+1)*per);
  pageLines.forEach((it,j)=>{
   const y=802+j*82;
   t(it.description,120,y,27,{maxWidth:610});
   t(it.rate==='none'?'非課税':it.rate+'%',120,y+26,19,{color:'#8794a4'});
   t(Number(it.quantity).toLocaleString('ja-JP'),825,y,26,{align:'right'});
   t(it.unit,980,y,25,{align:'right'});
   t(yen(Number(it.unitPrice)),1250,y,25,{align:'right'});
   t(yen(it.amount),1530,y,25,{align:'right'});
   line(y+34,105,1550);
  });
  if(p===all-1){
   const y=1645;line(y-17,100,1550,'#8291a3',2);
   t('小計（税抜）',1010,y+31,28);t(yen(c.base),1530,y+31,29,{align:'right'});
   t('10% 消費税',1010,y+84,25);t(yen(c.tax10),1530,y+84,27,{align:'right'});
   t('8% 消費税',1010,y+137,25);t(yen(c.tax8),1530,y+137,27,{align:'right'});
   line(y+165,995,1545,'#8291a3',2);
   t('合計（税込）',1010,y+225,34,{bold:true});t(yen(c.total),1530,y+225,39,{bold:true,align:'right'});
   if(data.notes){
    t('備考・施工条件',108,1694,27,{bold:true});
    const words=data.notes.replace(/\r/g,'').split('\n').slice(0,8);
    for(let i=0;i<words.length;i++)t(words[i],110,1745+i*38,23,{maxWidth:840});
   }
   line(1945,100,1550);
   t('発行元',110,1995,24,{bold:true});
   data.issuerText.split(/\n/).slice(0,5).forEach((v,i)=>t(v,110,2050+i*41,25,{maxWidth:950}));
   if(stamp)ctx.drawImage(stamp,1363,2021,132,132);
  }else{t('明細は次ページに続きます',1530,2028,26,{align:'right',color:'#768596'})}
  t((p+1)+' / '+all,1518,2290,21,{align:'right',color:'#758497'});
  pages.push(canvas);
 }
 return pages;
}
function pdfDocument(canvases){
 const chunks=[],offsets=[0],encoder=new TextEncoder();let length=0;
 const push=value=>{const a=typeof value==='string'?encoder.encode(value):value;chunks.push(a);length+=a.length};
 const object=(id,body)=>{offsets[id]=length;push(id+' 0 obj\n'+body+'\nendobj\n')};
 const count=canvases.length,total=2+3*count;
 push('%PDF-1.4\n%IMAGE-BASED-ESTIMATE\n');
 object(1,'<< /Type /Catalog /Pages 2 0 R >>');
 object(2,'<< /Type /Pages /Kids ['+canvases.map((_,i)=>(3+i*3)+' 0 R').join(' ')+'] /Count '+count+' >>');
 for(let p=0;p<count;p++){
  const id=3+p*3,canvas=canvases[p];
  object(id,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Img '+(id+1)+' 0 R >> >> /Contents '+(id+2)+' 0 R >>');
  const base64=canvas.toDataURL('image/jpeg',.9).split(',')[1],binary=atob(base64),jpeg=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)jpeg[i]=binary.charCodeAt(i);
  offsets[id+1]=length;
  push((id+1)+' 0 obj\n<< /Type /XObject /Subtype /Image /Width 1654 /Height 2339 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+jpeg.length+' >>\nstream\n');
  push(jpeg);push('\nendstream\nendobj\n');
  const stream='q\n595.28 0 0 841.89 0 0 cm\n/Img Do\nQ\n';
  object(id+2,'<< /Length '+encoder.encode(stream).length+' >>\nstream\n'+stream+'endstream');
 }
 const xref=length;push('xref\n0 '+(total+1)+'\n0000000000 65535 f \n');
 for(let i=1;i<=total;i++)push(String(offsets[i]).padStart(10,'0')+' 00000 n \n');
 push('trailer\n<< /Size '+(total+1)+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF');
 return new Blob(chunks,{type:'application/pdf'});
}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000)}
function fileName(d){return '見積書_'+d.quoteDate.replaceAll('-','')+'_'+d.recipient.replace(/[\/\\:*?"<>|]/g,'_').slice(0,28)+'.pdf'}
function dbOperation(mode,id,value){
 return new Promise((resolve,reject)=>{
  const req=indexedDB.open(DB,1);req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('files'))req.result.createObjectStore('files')};
  req.onerror=()=>reject(req.error);
  req.onsuccess=()=>{
   const db=req.result,tx=db.transaction('files',mode),store=tx.objectStore('files');
   const task=mode==='readonly'?store.get(id):value===undefined?store.delete(id):store.put(value,id);
   task.onsuccess=()=>{if(mode==='readonly'){db.close();resolve(task.result)}};
   tx.oncomplete=()=>{db.close();if(mode!=='readonly')resolve()};
   tx.onerror=()=>{db.close();reject(tx.error)}
  };
 });
}
let pages=[];
async function create(){
 const error=validate();if(error){note(error);return}
 snapshot=structuredClone(state);pages=await makePages(snapshot);
 const container=$('previewPages');container.replaceChildren();
 for(const canvas of pages)container.appendChild(canvas);
 show('preview');
}
$('create').onclick=()=>{create().catch(error=>{console.error(error);note('見積書を作成できませんでした')})};
async function pdfSave(){
 if(busy)return;busy=true;$('downloadPdf').disabled=true;
 try{
  const pdf=pdfDocument(pages),data=snapshot,id='q'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
  download(pdf,fileName(data));
  try{
   await dbOperation('readwrite',id,pdf);
   history.unshift({id,date:data.quoteDate,recipient:data.recipient,subject:data.subject,total:calc(data).total,data,createdAt:new Date().toISOString()});
   for(const old of history.splice(50))await dbOperation('readwrite',old.id);
   save(HISTORY,history);note('PDFを保存しました。履歴にも登録しました');
  }catch(error){console.error(error);note('PDFは保存しましたが、履歴の保存に失敗しました')}
 }catch(error){console.error(error);note('PDFを保存できませんでした')}
 finally{busy=false;$('downloadPdf').disabled=false}
}
$('downloadPdf').onclick=pdfSave;
$('saveTemplate').onclick=()=>{
 readInputs();
 const name=prompt('テンプレート名を入力してください');if(!name||!name.trim())return;
 if(templates.length>=40){note('テンプレートは40件までです');return}
 templates.unshift({id:'t'+Date.now().toString(36),name:name.trim().slice(0,60),data:structuredClone(state)});
 try{save(TEMPLATES,templates);note('テンプレートを保存しました')}catch(error){note('保存できませんでした')}
};
function renderTemplates(){
 $('templateList').innerHTML=templates.length?templates.map(v=>'<div class="item"><div class="meta"><strong>'+esc(v.name)+'</strong><small>'+esc(v.data.subject||'')+'</small></div><button data-template="'+esc(v.id)+'">読み込む</button><button data-remove-template="'+esc(v.id)+'">削除</button></div>').join(''):'<p class="empty">保存したテンプレートはありません。</p>';
}
function renderHistory(){
 $('historyList').innerHTML=history.length?history.map(v=>'<div class="item"><div class="meta"><strong>'+esc(v.recipient)+'　'+yen(v.total)+'</strong><small>'+esc(v.date)+'　'+esc(v.subject||'')+'</small></div><button data-history="'+esc(v.id)+'">PDF</button><button data-reuse="'+esc(v.id)+'">再作成</button><button data-remove-history="'+esc(v.id)+'">削除</button></div>').join(''):'<p class="empty">履歴はまだありません。PDFを保存すると追加されます。</p>';
}
document.addEventListener('click',async event=>{
 const b=event.target.closest('[data-template],[data-remove-template],[data-history],[data-reuse],[data-remove-history]');if(!b)return;
 if(b.dataset.template){const t=templates.find(v=>v.id===b.dataset.template);if(t){state={...fresh(),...structuredClone(t.data),quoteDate:today(),recipient:''};show('edit');persist()}return}
 if(b.dataset.removeTemplate){if(!confirm('テンプレートを削除しますか？'))return;templates=templates.filter(v=>v.id!==b.dataset.removeTemplate);save(TEMPLATES,templates);renderTemplates();return}
 const id=b.dataset.history||b.dataset.reuse||b.dataset.removeHistory,h=history.find(v=>v.id===id);if(!h)return;
 if(b.dataset.reuse){state={...fresh(),...structuredClone(h.data),quoteDate:today()};show('edit');persist();return}
 if(b.dataset.removeHistory){if(!confirm('この履歴を削除しますか？'))return;history=history.filter(v=>v.id!==id);save(HISTORY,history);await dbOperation('readwrite',id);renderHistory();return}
 try{const blob=await dbOperation('readonly',id);if(blob)download(blob,fileName(h.data));else note('PDFファイルが見つかりません。再作成をご利用ください')}catch(error){note('履歴PDFを読み込めませんでした')}
});
fill();window.__toolBeforeLeave=()=>{persist();return Promise.resolve()};
})();