(()=>{'use strict';
const DRAFT='receipt_unified_draft_v2',ISSUER='receipt_unified_issuer_v2',TEMPLATES='receipt_unified_templates_v2',HISTORY='receipt_unified_history_v2',OLD='receipt_maker_issuer_templates_v1',DB='receipt_unified_pdf_v2';
const $=id=>document.getElementById(id),today=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
const json=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||'null')??fallback}catch(_){return fallback}};
const save=(key,value)=>localStorage.setItem(key,JSON.stringify(value));
const defaultData=()=>({issueDate:today(),showNumber:false,receiptNo:'',recipient:'',suffix:'様',rate:'10',taxMode:'incl',amount:'',purpose:'',payment:'',issuerText:'',stampData:'',stampSize:30,removeWhite:true,revenueStamp:false,showTaxDetail:true,roundMode:'floor',notes:'',mixed:false,gross10:'',gross8:'',grossNone:'',invoice:false,registration:''});
let state={...defaultData(),...json(DRAFT,{})}, issuer=json(ISSUER,{}),templates=json(TEMPLATES,[]),history=json(HISTORY,[]);
let screen='home',currentHistory=null,previewSource=null,busy=false,toastTimeout=null;
const root=$('receiptRoot');
root.innerHTML=[
'<header class="top"><button class="back" id="back" type="button" hidden>戻る</button><strong id="screenTitle">領収書作成</strong></header>',
'<section id="s-home" class="screen active"><div class="home-wrap">',
'<div class="hero-icon"><svg viewBox="0 0 64 72" aria-hidden="true"><path d="M13 5h28l12 12v49H13zM41 5v13h12M23 33h21M23 43h21M23 53h13"/></svg></div>',
'<p class="hero-title">入力して、PDFで保存。</p><p class="hero-sub">無料・アカウント登録不要</p>',
'<button class="big-btn primary" data-go="edit" type="button">領収書を作成</button>',
'<button class="big-btn" data-go="templates" type="button">テンプレートから作成</button>',
'<button class="big-btn" data-go="history" type="button">履歴から作成</button>',
'<p class="smallnote">発行元・角印・履歴は<br>この端末のブラウザ内に保存されます。</p>',
'<button class="text-link" data-go="settings" type="button">設定・バックアップを見る ›</button></div>',
'<p class="home-footer">無料で使える領収書PDF作成ツール</p></section>',
'<section id="s-edit" class="screen"><div class="container edit">',
'<div class="field"><label for="issueDate">発行日</label><input class="input date" id="issueDate" type="date"></div>',
'<div class="toggle-row"><label for="showNumber">領収書番号を記載する</label><label class="switch"><input id="showNumber" type="checkbox"><span></span></label></div>',
'<div class="field" id="numberField" hidden><label for="receiptNo">領収書番号</label><input class="input" id="receiptNo" placeholder="例：R-0001" maxlength="50"></div>',
'<div class="field"><label for="recipient">宛名</label><div class="inline"><input class="input" id="recipient" maxlength="90" autocomplete="off" placeholder="〇〇株式会社"><select class="suffix" id="suffix" aria-label="敬称"><option value="様">様</option><option value="御中">御中</option><option value="なし">なし</option></select></div></div>',
'<div class="field"><div class="field-title">税率・税区分</div>',
'<div class="segmented" role="radiogroup" aria-label="税率"><label><input type="radio" name="rate" value="8"><span>8%</span></label><label><input type="radio" name="rate" value="10"><span>10%</span></label><label><input type="radio" name="rate" value="none"><span>非課税</span></label></div>',
'<div class="segmented" role="radiogroup" aria-label="内税外税"><label><input type="radio" name="taxMode" value="incl"><span>内税</span></label><label><input type="radio" name="taxMode" value="excl"><span>外税</span></label></div>',
'<p class="helper" id="taxHelp">内税：税込の金額を入力してください。</p></div>',
'<div class="field"><label for="amount">金額</label><input class="input" id="amount" type="text" inputmode="numeric" autocomplete="off" placeholder="10,000"></div>',
'<div class="field"><label for="purpose">但し書き</label><input class="input" id="purpose" maxlength="150" placeholder="〇〇代として"></div>',
'<div class="field"><label for="payment">支払方法</label><select class="select" id="payment"><option value="">記載しない</option><option>クレジットカード</option><option>銀行振込</option><option>現金</option><option>オンラインカード決済</option><option>後払い</option></select></div>',
'<div class="field"><div class="inline between" style="margin-bottom:10px"><label for="issuerText" style="font-size:17px;font-weight:740">発行元</label><button class="action-btn compact" id="saveIssuer" type="button">発行元・角印を保存</button></div>',
'<textarea class="textarea" id="issuerText" placeholder="事業者名&#10;住所&#10;電話番号"></textarea>',
'<p class="helper">発行元は保存ボタン、または領収書の「作成」で次回用に保存します。</p>',
'<p class="helper">入力した改行位置をそのまま使います。長い行は文字を小さく調整します。</p></div>',
'<details class="details" id="stampPanel"><summary><b>角印</b><small id="stampStatus">未設定</small></summary><div class="details-inner">',
'<div class="inline" style="margin-bottom:17px"><img class="thumb" id="stampPreview" alt="角印プレビュー" style="display:none"><div class="thumb thumb-placeholder" id="stampEmpty">角印なし</div>',
'<label class="file-label">画像を選ぶ<input id="stampFile" type="file" accept="image/*"></label><button class="minor" id="removeStamp" type="button">削除</button></div>',
'<p class="helper">画像を選ぶとこの端末に保存します。</p>',
'<div class="toggle-row tight"><label for="removeWhite">白い背景を透過する</label><label class="switch"><input id="removeWhite" type="checkbox"><span></span></label></div>',
'<div class="inline between"><label for="stampSize">印影のサイズ</label><span style="color:#0787f8" id="stampSizeLabel">30 mm</span></div>',
'<input id="stampSize" class="range" type="range" min="15" max="50" value="30">',
'<p class="helper">角印は領収書の発行元の右側に配置します。</p></div></details>',
'<div class="toggle-row"><label for="revenueStamp">収入印紙枠を表示</label><label class="switch"><input id="revenueStamp" type="checkbox"><span></span></label></div>',
'<details class="details" id="otherPanel"><summary><b>その他の設定</b><small>税内訳など</small></summary><div class="details-inner">',
'<div class="toggle-row tight"><label for="showTaxDetail">税抜金額・消費税を表示</label><label class="switch"><input id="showTaxDetail" type="checkbox"><span></span></label></div>',
'<div class="field"><label for="roundMode">消費税の端数処理</label><select class="select" id="roundMode"><option value="floor">切り捨て</option><option value="round">四捨五入</option><option value="ceil">切り上げ</option></select></div>',
'<div class="field"><label for="notes">備考</label><textarea class="textarea" id="notes" maxlength="400" style="min-height:95px" placeholder="必要な場合のみ入力"></textarea></div>',
'<div class="toggle-row tight"><label for="mixed">複数の税率を使う</label><label class="switch"><input id="mixed" type="checkbox"><span></span></label></div>',
'<div id="mixedFields" hidden><p class="helper">税込金額を税率別に入力します。合計が領収金額になります。</p>',
'<div class="field"><label for="gross10">10%対象（税込・円）</label><input class="input" id="gross10" inputmode="numeric" placeholder="0"></div>',
'<div class="field"><label for="gross8">8%対象（税込・円）</label><input class="input" id="gross8" inputmode="numeric" placeholder="0"></div>',
'<div class="field"><label for="grossNone">非課税（円）</label><input class="input" id="grossNone" inputmode="numeric" placeholder="0"></div></div>',
'<div class="toggle-row tight"><label for="invoice">インボイス情報を表示</label><label class="switch"><input id="invoice" type="checkbox"><span></span></label></div>',
'<div id="invoiceField" hidden><div class="field"><label for="registration">登録番号</label><input class="input" id="registration" maxlength="14" placeholder="T＋13桁"></div></div>',
'</div></details>',
'<button class="action-btn primary" id="create" type="button">作成</button>',
'<button class="action-btn" id="saveTemplate" type="button">テンプレートとして保存</button>',
'<p class="smallnote" style="margin:8px 0 0">作成後に完成イメージを確認して、PDFを保存できます。</p>',
'</div></section>',
'<section id="s-preview" class="screen"><div class="container edit"><p class="helper" style="text-align:center">完成イメージ　A4横・PDF</p>',
'<div class="preview-paper"><canvas id="pdfCanvas" width="2339" height="1654" aria-label="領収書プレビュー"></canvas></div>',
'<button class="action-btn primary" id="downloadPdf" type="button">PDFを保存</button>',
'<button class="action-btn" id="sharePdf" type="button">PDFを共有</button>',
'<button class="action-btn outline" data-go="edit" type="button">入力内容を修正</button>',
'<p class="smallnote">PDFの保存・共有時に履歴へ保存します。<br>保存先は端末の操作画面で選べます。</p></div></section>',
'<section id="s-templates" class="screen"><div class="container edit"><p class="helper">保存した内容を読み込み、日付と宛名を変えて作成できます。</p><div id="templateList"></div></div></section>',
'<section id="s-history" class="screen"><div class="container edit"><p class="helper">保存・共有した領収書を、この端末で確認できます。履歴は最大50件です。</p><div id="historyList"></div></div></section>',
'<section id="s-settings" class="screen"><div class="container edit settings"><h2>設定・バックアップ</h2>',
'<p class="helper">発行元・角印・テンプレート・履歴は、この端末のブラウザに保存されます。機種変更時は旧端末から書き出して、新端末で読み込んでください。</p>',
'<button class="action-btn primary" id="exportAll" type="button">保存データを書き出す</button>',
'<label class="file-label" style="margin-top:14px;min-height:58px;width:100%">保存データを読み込む<input id="importAll" type="file" accept="application/json,.json"></label>',
'<p class="helper">バックアップには領収書データや角印が含まれます。安全な場所に保管してください。</p><div class="hr"></div>',
'<h2>使い方を試す</h2><p class="helper">架空の入力例で領収書の作成画面を開きます。保存済みの履歴は変更しません。</p>',
'<button class="action-btn" id="demo" type="button">サンプルを入力</button><div class="hr"></div>',
'<h2>データの取り扱い</h2><p class="app-safe-note">入力内容と角印は外部サーバーへ送信しません。ブラウザのデータ削除で失われる場合があります。共有端末ではほかの利用者が履歴や角印を閲覧できる場合があります。</p>',
'<p class="app-safe-note">PDFは画像形式です。文字検索・文字コピーには対応していません。</p></div></section>',
'<div class="status-toast" id="toast" role="status"></div>'
].join('');
const ids=['issueDate','showNumber','receiptNo','recipient','suffix','amount','purpose','payment','issuerText','stampSize','removeWhite','revenueStamp','showTaxDetail','roundMode','notes','mixed','gross10','gross8','grossNone','invoice','registration'];
const checkboxes=new Set(['showNumber','removeWhite','revenueStamp','showTaxDetail','mixed','invoice']);
function populate(){
 if(state.payment==='オンライン決済')state.payment='オンラインカード決済';
 for(const id of ids){const el=$(id);if(!el)continue;if(checkboxes.has(id))el.checked=!!state[id];else el.value=state[id]??''}
 for(const group of ['rate','taxMode']){const el=document.querySelector('input[name="'+group+'"][value="'+state[group]+'"]');if(el)el.checked=true}
 updateOptions();updateStamp();
}
function gather(){
 for(const id of ids){const el=$(id);state[id]=checkboxes.has(id)?el.checked:el.value}
 for(const group of ['rate','taxMode'])state[group]=document.querySelector('input[name="'+group+'"]:checked')?.value||state[group];
 return state;
}
function persist(){try{save(DRAFT,gather())}catch(error){console.warn('下書きを保存できません',error)}}
function toast(message){const el=$('toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>el.classList.remove('show'),3300)}
function show(name){
 if(screen==='edit')persist();screen=name;
 document.querySelectorAll('.screen').forEach(el=>el.classList.toggle('active',el.id==='s-'+name));
 $('back').hidden=name==='home';
 const titles={home:'領収書作成',edit:'領収書を入力',preview:'完成イメージ',templates:'テンプレートから作成',history:'履歴から作成',settings:'設定・バックアップ'};
 $('screenTitle').textContent=titles[name]||titles.home;
 if(name==='edit')populate();
 if(name==='templates')renderTemplates();
 if(name==='history')renderHistory();
 window.scrollTo(0,0);
}
$('back').onclick=()=>show(screen==='preview'?'edit':'home');
document.addEventListener('click',e=>{const link=e.target.closest('[data-go]');if(link){e.preventDefault();show(link.dataset.go)}});
function updateOptions(){
 $('numberField').hidden=!$('showNumber').checked;
 $('mixedFields').hidden=!$('mixed').checked;
 $('invoiceField').hidden=!$('invoice').checked;
 $('stampSizeLabel').textContent=$('stampSize').value+' mm';
 const rate=document.querySelector('input[name=rate]:checked')?.value||'10';
 $('taxHelp').textContent=rate==='none'?'非課税：消費税は計算しません。':$('mixed').checked?'複数税率：税込金額を下でそれぞれ入力してください。':
 (document.querySelector('input[name=taxMode]:checked')?.value==='excl'?'外税：税抜の金額を入力してください。':'内税：税込の金額を入力してください。');
}
function updateStamp(){
 $('stampStatus').textContent=state.stampData?'設定済み':'未設定';
 $('stampPreview').style.display=state.stampData?'block':'none';
 $('stampEmpty').style.display=state.stampData?'none':'grid';
 if(state.stampData)$('stampPreview').src=state.stampData;
}
for(const id of ids){const el=$(id);el.addEventListener('input',()=>{gather();updateOptions();persist()});el.addEventListener('change',()=>{gather();updateOptions();persist()})}
for(const name of ['rate','taxMode'])document.querySelectorAll('input[name='+name+']').forEach(el=>el.addEventListener('change',()=>{gather();updateOptions();persist()}));
function saveIssuer(){
 gather();issuer={issuerText:state.issuerText,stampData:state.stampData,stampSize:Number(state.stampSize),registration:state.registration,removeWhite:state.removeWhite};
 try{save(ISSUER,issuer);toast('発行元と角印を保存しました。次回から自動で入力します。')}catch(error){toast('保存できません。空き容量をご確認ください。')}
}
$('saveIssuer').onclick=saveIssuer;
function imageFile(file){
 return new Promise((resolve,reject)=>{
 if(!file||!file.type.startsWith('image/'))return reject(Error('画像を選んでください'));
 if(file.size>12*1024*1024)return reject(Error('画像は12MB以下にしてください'));
 const url=URL.createObjectURL(file),img=new Image();
 img.onload=()=>{try{
  const c=document.createElement('canvas'),ctx=c.getContext('2d',{willReadFrequently:true});c.width=c.height=420;
  const ratio=Math.min(385/img.width,385/img.height),w=img.width*ratio,h=img.height*ratio;
  ctx.clearRect(0,0,420,420);ctx.drawImage(img,(420-w)/2,(420-h)/2,w,h);
  if($('removeWhite').checked){const data=ctx.getImageData(0,0,420,420);for(let i=0;i<data.data.length;i+=4){const v=Math.min(data.data[i],data.data[i+1],data.data[i+2]);if(v>210)data.data[i+3]=Math.round(data.data[i+3]*Math.max(0,Math.min(1,(255-v)/43)))}ctx.putImageData(data,0,0)}
  resolve(c.toDataURL('image/png'))
 }catch(error){reject(error)}finally{URL.revokeObjectURL(url)}};
 img.onerror=()=>{URL.revokeObjectURL(url);reject(Error('画像を読み込めません'))};img.src=url;
 });
}
$('stampFile').onchange=async e=>{const f=e.target.files?.[0];try{if(f){state.stampData=await imageFile(f);persist();updateStamp();toast('角印を取り込みました')}}catch(error){toast(error.message)}finally{e.target.value=''}};
$('removeStamp').onclick=()=>{state.stampData='';persist();updateStamp();toast('角印を削除しました')};
function yen(n){return '¥'+Math.round(n).toLocaleString('ja-JP')};
function money(v){return Math.max(0,Math.floor(Number(String(v??'').replace(/[,，\s]/g,''))||0))}
function round(n,mode){return mode==='ceil'?Math.ceil(n):mode==='round'?Math.round(n):Math.floor(n)}
function totals(data){
 const rate=Number(data.rate)||0,amount=money(data.amount),mode=data.roundMode;
 if(data.mixed){
  const ten=money(data.gross10),eight=money(data.gross8),none=money(data.grossNone);
  const tax10=round(ten*10/110,mode),tax8=round(eight*8/108,mode);
  return {total:ten+eight+none,tax:tax10+tax8,base:ten+eight+none-tax10-tax8,lines:['10%対象　'+yen(ten)+'（税額 '+yen(tax10)+'）','8%対象　'+yen(eight)+'（税額 '+yen(tax8)+'）',none?'非課税　'+yen(none):''].filter(Boolean)};
 }
 if(!rate)return {total:amount,tax:0,base:amount,lines:['非課税']};
 const tax=data.taxMode==='excl'?round(amount*rate/100,mode):round(amount*rate/(100+rate),mode);
 return {total:data.taxMode==='excl'?amount+tax:amount,tax,base:data.taxMode==='excl'?amount:amount-tax,lines:[rate+'%対象　税抜 '+yen(data.taxMode==='excl'?amount:amount-tax)+'　消費税 '+yen(tax)]};
}
function validate(data){
 if(!data.issueDate)return '発行日を入力してください。';
 if(!data.recipient.trim())return '宛名を入力してください。';
 if(!data.purpose.trim())return '但し書きを入力してください。';
 if(totals(data).total<1)return '金額を入力してください。';
 if(totals(data).total>999999999)return '金額は999,999,999円以下にしてください。';
 if(!data.issuerText.trim())return '発行元を入力してください。';
 if(data.invoice&&!/^T\d{13}$/i.test(data.registration.trim()))return 'インボイスの登録番号はT＋13桁で入力してください。';
 return '';
}
function loadImage(data){return new Promise(resolve=>{if(!data)return resolve(null);const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>resolve(null);image.src=data})}
function wrap(ctx,str,x,y,maxWidth,lineH,maxLines=3){
 let line='',lines=0;for(const ch of String(str||'')){if(ch==='\n'||ctx.measureText(line+ch).width>maxWidth){if(line){ctx.fillText(line,x,y);lines++;y+=lineH}line=ch==='\n'?'':ch;if(lines>=maxLines)return y}else line+=ch}
 if(line&&lines<maxLines){ctx.fillText(line,x,y);y+=lineH}return y;
}
async function draw(data){
 const canvas=$('pdfCanvas'),ctx=canvas.getContext('2d');
 const w=1654,h=1169,T=totals(data);
 ctx.setTransform(canvas.width/w,0,0,canvas.height/h,0,0);
 const mincho='"Hiragino Mincho ProN","Yu Mincho","Noto Serif CJK JP",serif';
 const gothic='"Hiragino Sans","Yu Gothic","Noto Sans CJK JP",sans-serif';
 const ink='#111111';
 ctx.clearRect(0,0,w,h);
 ctx.fillStyle='#ffffff';ctx.fillRect(0,0,w,h);
 ctx.textBaseline='alphabetic';ctx.fillStyle=ink;ctx.strokeStyle=ink;
 const write=(value,x,y,size,{bold=false,align='left',family=mincho,maxWidth}={})=>{
  ctx.font=(bold?'bold ':'')+size+'px '+family;
  ctx.textAlign=align;ctx.fillStyle=ink;
  if(maxWidth)ctx.fillText(String(value),x,y,maxWidth);else ctx.fillText(String(value),x,y);
 };
 const stroke=(x0,y0,x1,y1,width=1.7)=>{
  ctx.strokeStyle='#191919';ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x0,y0);ctx.lineTo(x1,y1);ctx.stroke();
 };
 // A4 landscape, no surrounding border. Layout follows the supplied finished receipt.
 write('領　収　書',w/2,168,58,{bold:true,align:'center'});
 stroke(115,216,w-115,216,1.8);

 const dateParts=String(data.issueDate||'').split('-');
 const issueDate=dateParts.length===3?'発行日: '+dateParts[0]+'年'+Number(dateParts[1])+'月'+Number(dateParts[2])+'日':'発行日: '+(data.issueDate||'');
 write(issueDate,w-82,300,33,{align:'right'});
 if(data.showNumber&&data.receiptNo)write('No. '+data.receiptNo,w-82,357,28,{align:'right'});

 const recipient=String(data.recipient||'')+(data.suffix==='なし'?'':'　'+(data.suffix||'様'));
 write(recipient,158,308,39,{maxWidth:760});
 ctx.font='39px '+mincho;
 const recipientWidth=Math.min(760,ctx.measureText(recipient).width);
 stroke(156,334,156+Math.max(225,recipientWidth+12),334,1.5);

 // The receipt total is always the amount actually received, including tax.
 const amountText='¥ '+T.total.toLocaleString('ja-JP');
 ctx.font='bold 80px '+mincho;
 const amountWidth=ctx.measureText(amountText).width;
 const amountLeft=(w-amountWidth)/2;
 write(amountText,w/2,515,80,{bold:true,align:'center'});
 write(Number(data.rate)===0&&!data.mixed?'（非課税）':'（税込）',amountLeft+amountWidth+20,504,24,{maxWidth:150});
 stroke(amountLeft-12,543,amountLeft+amountWidth+12,543,2);

 // Description and settlement confirmation: lower-left column.
 const left=434,leftWidth=605;
 write('但し　'+data.purpose,left,670,31,{maxWidth:leftWidth});
 write('上記正に領収いたしました。',left,733,31);
 if(data.showTaxDetail){
  if(data.mixed){
   write('税抜金額',left,808,28);
   write(yen(T.base),730,808,28);
   const taxLines=String(T.lines||'');
   const lines=Array.isArray(T.lines)?T.lines:[];
   lines.slice(0,3).forEach((line,i)=>write(line,left,859+36*i,25,{maxWidth:670}));
  }else if(Number(data.rate)===0){
   write('非課税',left,808,28);
  }else{
   write('税抜金額',left,808,29);
   write(yen(T.base),725,808,29);
   write(data.rate+'% 消費税',left,864,29);
   write(yen(T.tax),725,864,29);
  }
 }
 if(data.payment)write('支払方法: '+(data.payment==='オンライン決済'?'オンラインカード決済':data.payment),left,data.mixed?986:929,24,{maxWidth:670});
 if(data.notes)wrap(ctx,'備考: '+data.notes,left,data.mixed?1080:1011,635,32,2);

 // Issuer and seal sit at the lower right of the document, without a horizontal rule.
 const issuerLines=String(data.issuerText||'').split(/\n/).map(v=>v.trim()).filter(Boolean).slice(0,6);
 const issuerX=1100,issuerY=900;
 const issuerLineHeight=47;
 issuerLines.forEach((line,i)=>{
  const baseY=issuerY+i*issuerLineHeight;
  if(baseY>1118)return;
  let size=31;
  ctx.font=size+'px '+mincho;
  while(size>20&&ctx.measureText(line).width>350){size--;ctx.font=size+'px '+mincho}
  write(line,issuerX,baseY,size,{maxWidth:350});
 });
 if(data.invoice){
  write('登録番号: '+data.registration.toUpperCase(),issuerX,Math.min(1132,issuerY+issuerLines.length*issuerLineHeight+5),20,{maxWidth:425});
 }
 if(data.revenueStamp){
  ctx.strokeStyle='#222';ctx.lineWidth=1.3;
  ctx.strokeRect(1360,570,177,147);
  write('収入印紙',1448,622,25,{align:'center'});
 }
 const stamp=await loadImage(data.stampData);
 if(stamp){
  const size=Math.round((Number(data.stampSize)||30)*3.65);
  // Prefer the space to the right of the issuer, as in the reference receipt.
  const x=Math.min(w-size-97,1443),y=Math.min(h-size-60,924);
  ctx.drawImage(stamp,x,y,size,size);
 }
 return canvas;
}
function pdfBytes(canvas){
 const url=canvas.toDataURL('image/jpeg',.94),b64=url.split(',')[1],binary=atob(b64),jpeg=new Uint8Array(binary.length);
 for(let i=0;i<binary.length;i++)jpeg[i]=binary.charCodeAt(i);
 const enc=new TextEncoder(),chunks=[],offsets=[0];let pos=0;
 const append=v=>{const arr=typeof v==='string'?enc.encode(v):v;chunks.push(arr);pos+=arr.byteLength};
 const obj=(id,text)=>{offsets[id]=pos;append(id+' 0 obj\n'+text+'\nendobj\n')};
 append('%PDF-1.4\n%STATIC-IMAGE-PDF\n');
 obj(1,'<< /Type /Catalog /Pages 2 0 R >>');
 obj(2,'<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
 obj(3,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 841.89 595.28] /Resources << /XObject << /Img 4 0 R >> >> /Contents 5 0 R >>');
 offsets[4]=pos;append('4 0 obj\n<< /Type /XObject /Subtype /Image /Width '+canvas.width+' /Height '+canvas.height+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+jpeg.byteLength+' >>\nstream\n');
 append(jpeg);append('\nendstream\nendobj\n');
 const stream='q\n841.89 0 0 595.28 0 0 cm\n/Img Do\nQ\n';
 obj(5,'<< /Length '+enc.encode(stream).byteLength+' >>\nstream\n'+stream+'endstream');
 const start=pos;append('xref\n0 6\n0000000000 65535 f \n');for(let id=1;id<=5;id++)append(String(offsets[id]).padStart(10,'0')+' 00000 n \n');
 append('trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+start+'\n%%EOF');
 return new Blob(chunks,{type:'application/pdf'});
}
function filename(d){return '領収書_'+d.issueDate.replaceAll('-','')+'_'+d.recipient.replace(/[\\/:*?"<>|]/g,'_').slice(0,30)+'.pdf'}
function download(blob,name){const a=document.createElement('a'),u=URL.createObjectURL(blob);a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),60000)}
function openDB(){return new Promise((resolve,reject)=>{const q=indexedDB.open(DB,1);q.onupgradeneeded=()=>{if(!q.result.objectStoreNames.contains('files'))q.result.createObjectStore('files')};q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error)})}
async function putPdf(id,pdf){const db=await openDB();return new Promise((resolve,reject)=>{const t=db.transaction('files','readwrite');t.objectStore('files').put(pdf,id);t.oncomplete=()=>{db.close();resolve()};t.onerror=()=>{db.close();reject(t.error)}})}
async function getPdf(id){const db=await openDB();return new Promise((resolve,reject)=>{const t=db.transaction('files','readonly'),r=t.objectStore('files').get(id);r.onsuccess=()=>{db.close();resolve(r.result||null)};r.onerror=()=>{db.close();reject(r.error)}})}
async function removePdf(id){try{const db=await openDB();await new Promise((resolve,reject)=>{const t=db.transaction('files','readwrite');t.objectStore('files').delete(id);t.oncomplete=()=>{db.close();resolve()};t.onerror=()=>{db.close();reject(t.error)}})}catch(error){console.warn(error)}}
async function createPreview(){
 gather();const err=validate(state);if(err){toast(err);return}
 try{save(ISSUER,{issuerText:state.issuerText,stampData:state.stampData,stampSize:state.stampSize,registration:state.registration,removeWhite:state.removeWhite})}catch(error){console.warn(error)}
 currentHistory=null;previewSource={...state};await draw(previewSource);show('preview')
}
$('create').onclick=createPreview;
async function storeHistory(blob,data){
 const id='r'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
 const entry={id,createdAt:new Date().toISOString(),recipient:data.recipient,amount:totals(data).total,issueDate:data.issueDate,data:{...data}};
 try{
  await putPdf(id,blob);
  history.unshift(entry);
  const dropped=history.splice(50);save(HISTORY,history);
  for(const item of dropped)await removePdf(item.id);
 }catch(error){toast('PDFは作成しましたが、履歴の保存に失敗しました');console.error(error)}
}
async function produce(share){
 if(busy)return;busy=true;$('downloadPdf').disabled=$('sharePdf').disabled=true;
 try{
  const d=previewSource||{...state},canvas=await draw(d),pdf=pdfBytes(canvas),name=filename(d);
  if(share&&navigator.canShare&&navigator.share){const file=new File([pdf],name,{type:'application/pdf'});if(navigator.canShare({files:[file]})){try{await navigator.share({files:[file],title:'領収書PDF'});await storeHistory(pdf,d);toast('PDFを共有しました');return}catch(error){if(error.name==='AbortError')return}}}
  download(pdf,name);await storeHistory(pdf,d);toast('PDFを作成しました。履歴に保存しました');
 }catch(error){console.error(error);toast('PDFを作成できませんでした')}finally{busy=false;$('downloadPdf').disabled=$('sharePdf').disabled=false}
}
$('downloadPdf').onclick=()=>produce(false);$('sharePdf').onclick=()=>produce(true);
$('saveTemplate').onclick=()=>{
 gather();const name=prompt('テンプレートの名前を入力してください');
 if(!name)return;if(templates.length>=40){toast('テンプレートは40件までです');return}
 templates.unshift({id:'t'+Date.now().toString(36),name:name.trim().slice(0,50),data:{...state},savedAt:new Date().toISOString()});
 try{save(TEMPLATES,templates);toast('テンプレートを保存しました')}catch(error){toast('テンプレートを保存できませんでした')}
};
function escape(s){return String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))}
function renderTemplates(){
 $('templateList').innerHTML=templates.length?templates.map(t=>'<div class="item"><div class="meta"><strong>'+escape(t.name)+'</strong><small>'+escape(t.data?.purpose||'')+'</small></div><button data-load-template="'+escape(t.id)+'">読み込む</button><button data-delete-template="'+escape(t.id)+'">削除</button></div>').join(''):'<p class="empty">保存したテンプレートはありません。<br>入力画面から保存できます。</p>';
}
function renderHistory(){
 $('historyList').innerHTML=history.length?history.map(h=>'<div class="item"><div class="meta"><strong>'+escape(h.recipient)+'　'+yen(h.amount)+'</strong><small>'+escape(h.issueDate)+'　'+new Date(h.createdAt).toLocaleString('ja-JP')+'</small></div><button data-open-history="'+escape(h.id)+'">PDF</button><button data-reuse-history="'+escape(h.id)+'">再作成</button><button data-delete-history="'+escape(h.id)+'">削除</button></div>').join(''):'<p class="empty">保存した履歴はありません。<br>PDFの保存・共有時に履歴へ追加されます。</p>';
}
root.addEventListener('click',async e=>{
 const b=e.target.closest('[data-load-template],[data-delete-template],[data-open-history],[data-reuse-history],[data-delete-history]');if(!b)return;
 const id=b.dataset.loadTemplate||b.dataset.deleteTemplate||b.dataset.openHistory||b.dataset.reuseHistory||b.dataset.deleteHistory;
 if(b.dataset.loadTemplate){const t=templates.find(x=>x.id===id);if(!t)return;state={...defaultData(),...t.data,issueDate:today()};save(DRAFT,state);show('edit');return}
 if(b.dataset.deleteTemplate){if(!confirm('このテンプレートを削除しますか？'))return;templates=templates.filter(x=>x.id!==id);save(TEMPLATES,templates);renderTemplates();return}
 const h=history.find(x=>x.id===id);if(!h)return;
 if(b.dataset.reuseHistory){state={...defaultData(),...h.data,issueDate:today()};save(DRAFT,state);show('edit');return}
 if(b.dataset.deleteHistory){if(!confirm('この履歴を削除しますか？'))return;history=history.filter(x=>x.id!==id);save(HISTORY,history);await removePdf(id);renderHistory();return}
 if(b.dataset.openHistory){
  try{const pdf=await getPdf(id);if(pdf){download(pdf,filename(h.data));toast('保存済みのPDFを開きます')}else{previewSource={...h.data};await draw(previewSource);show('preview');toast('保存済みファイルがないため内容から再作成できます')}}catch(error){toast('保存済みのPDFを読み込めませんでした')}
 }
});
$('demo').onclick=()=>{state={...defaultData(),recipient:'山田 太郎',amount:'17000',purpose:'サービス提供代金として',payment:'オンライン決済',issuerText:'サンプルサービス\n東京都〇〇区1-2-3\n03-0000-0000'};save(DRAFT,state);show('edit');toast('架空の内容を入力しました')};
const b64=blob=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(r.error);r.readAsDataURL(blob)});
$('exportAll').onclick=async()=>{if(busy)return;busy=true;try{
 const pdfs={};for(const h of history){const pdf=await getPdf(h.id);if(pdf)pdfs[h.id]=await b64(pdf)}
 const out={type:'receipt_unified_backup',version:2,at:new Date().toISOString(),issuer,templates,history,draft:state,pdfs};
 const blob=new Blob([JSON.stringify(out)],{type:'application/json'});download(blob,'領収書バックアップ_'+today()+'.json');toast('データを書き出しました');
 }catch(error){toast('バックアップを作成できませんでした')}finally{busy=false}
};
$('importAll').onchange=async e=>{const file=e.target.files?.[0];if(!file)return;
 try{const data=JSON.parse(await file.text());if(data.type!=='receipt_unified_backup'||data.version!==2||!Array.isArray(data.history)||!Array.isArray(data.templates))throw Error('対応しないファイルです');
 if(!confirm('現在の領収書データを上書きして復元しますか？'))return;
 for(const [id,b] of Object.entries(data.pdfs||{})){const bin=atob(b),buf=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)buf[i]=bin.charCodeAt(i);await putPdf(id,new Blob([buf],{type:'application/pdf'}))}
 issuer=data.issuer||{};templates=data.templates.slice(0,40);history=data.history.slice(0,50);state={...defaultData(),...(data.draft||{})};
 save(ISSUER,issuer);save(TEMPLATES,templates);save(HISTORY,history);save(DRAFT,state);toast('バックアップを復元しました');show('home');
 }catch(error){toast('読み込めませんでした：'+error.message)}finally{e.target.value=''}
};
function migrate(){
 // Reuse older integrated inputs and issuer templates only on first launch.
 if(!localStorage.getItem(DRAFT)){
  const prev=json('receipt_worktools_draft_v1',{})?.values||{};
  if(prev.recipient){state={...defaultData(),recipient:prev.recipient,issueDate:prev.issueDate||today(),amount:prev.amount||'',purpose:prev.purpose||'',issuerText:[prev.issuerName,prev.issuerAddress,prev.issuerPhone].filter(Boolean).join('\n'),registration:prev.issuerReg||''};save(DRAFT,state)}
 }
 if(!templates.length){
  const legacy=json(OLD,[]);
  if(Array.isArray(legacy)&&legacy.length){templates=legacy.slice(0,40).map((x,i)=>({id:'legacy'+i,name:x.templateName||'以前の発行元 '+(i+1),data:{...defaultData(),issuerText:[x.issuerName,x.issuerZip,x.issuerAddress,x.issuerPhone].filter(Boolean).join('\n'),stampData:x.stampData||'',stampSize:x.stampSize||30,registration:x.issuerReg||''}}));save(TEMPLATES,templates)}
 }
 if(!state.issuerText&&issuer.issuerText)state.issuerText=issuer.issuerText;
 if(!state.stampData&&issuer.stampData)state.stampData=issuer.stampData;
 if(!state.registration&&issuer.registration)state.registration=issuer.registration;
 if(!state.issuerText){
  const global=json('worktools_profile_v1',{});
  state.issuerText=[global.business,global.address,global.phone].filter(Boolean).join('\n');
  if(!state.registration)state.registration=global.registration||'';
 }
}
migrate();populate();window.__toolBeforeLeave=()=>{persist();return Promise.resolve()};
})();