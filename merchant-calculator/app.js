(()=>{'use strict';
const KEY='merchant_calcs_v1';const $=id=>document.getElementById(id);const now=new Date();const ym=()=>`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
const fresh=()=>({rating:[0,0,0,0,0],months:{},goals:{cancel:5,review:80},feeRate:20,minimum:2000,feeMode:'deduct',taxEnabled:false,taxReservePct:10,taxSettingsVersion:2,paymentType:'none',cardRateMode:'estimate',customCardRate:3.2,atoRate:4.5,stripeConnectFee:0,cardPayoutFee:275,atoPayoutFee:550,includePayout:false,page:'home',year:now.getFullYear(),month:ym()});
let s,previous={};try{previous=JSON.parse(localStorage.getItem(KEY)||'{}')||{};s=Object.assign(fresh(),previous)}catch{s=fresh()}
s.rating=Array.isArray(s.rating)&&s.rating.length===5?s.rating:fresh().rating;
s.months=s.months&&typeof s.months==='object'?s.months:{};
s.goals=Object.assign(fresh().goals,s.goals||{});
if(previous.taxSettingsVersion!==2){s.taxEnabled=false;if(Number(s.taxReservePct)===100)s.taxReservePct=10;s.taxSettingsVersion=2}
const RESUME_MSEC=30*60*1000;
if(!Number(s.lastUsedAt)||Date.now()-Number(s.lastUsedAt)>=RESUME_MSEC)s.page='home';
s.lastUsedAt=Date.now();
// 請求額や希望額は保存しない・初期状態では空欄
let amount='';
const safeInt=n=>Math.max(0,Math.floor(Number(n)||0));const yen=n=>Math.round(n).toLocaleString('ja-JP')+'円';const pct=n=>n.toFixed(2)+'%';const trunc2=n=>Math.floor((n+1e-10)*100)/100;const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(s))}catch{toast('保存できません。容量や設定をご確認ください')}};const toast=msg=>{let t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),2200)};
const escapeHtml=t=>String(t).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));const card=(title,content)=>`<section class="card"><h2>${title}</h2>${content}</section>`;const field=(id,label,value,opts='')=>`<label class="field"><span>${label}</span><input id="${id}" type="number" inputmode="decimal" value="${escapeHtml(value)}" ${opts}></label>`;
const go=p=>{s.page=p;save();render();window.scrollTo(0,0)};const titles={home:['出店者の計算機','数字を入れるだけ。登録不要・端末内保存'],fee:['手取り計算機','手数料の差引・請求金額の逆算'],cancel:['キャンセル率','月ごとの実績を管理'],review:['口コミ率','月ごとの実績を管理'],rating:['星評価','星別件数を記録して次の評価を予測'],settings:['設定・バックアップ','端末内データの保存と復元']};
const selectField=(id,label,selected,options)=>`<label class="field"><span>${label}</span><select id="${id}">${options.map(([value,name])=>`<option value="${value}" ${value===selected?'selected':''}>${name}</option>`).join('')}</select></label>`;
const rateValue=(v,defaultValue=0,max=100)=>{const n=Number(v);return Number.isFinite(n)?Math.max(0,Math.min(max,n)):defaultValue};
function paymentRate(){if(s.paymentType==='card')return s.cardRateMode==='confirmed278'?2.78:s.cardRateMode==='confirmed320'?3.2:s.cardRateMode==='custom'?rateValue(s.customCardRate,3.2,100):3.2;if(s.paymentType==='ato')return rateValue(s.atoRate,4.5,100);return 0}
function feeDetails(gross){
 const a=safeInt(gross),r=rateValue(s.feeRate,20,90),min=safeInt(s.minimum);
 const platform=Math.floor(Math.max(a*r/100,min)*1.1+1e-9);
 const taxReserve=s.taxEnabled?Math.floor(a*rateValue(s.taxReservePct,10,100)/100+1e-9):0;
 let cardOrAto=0;
 if(s.paymentType==='ato')cardOrAto=Math.floor(a*rateValue(s.atoRate,4.5,100)/100+1e-9);
 else if(s.paymentType==='card'){
  const low=s.cardRateMode==='confirmed278';
  const rate=low?2.78:s.cardRateMode==='custom'?rateValue(s.customCardRate,3.2,100):3.2;
  cardOrAto=Math.floor(a*rate/100*(low?1:1.1)+1e-9);
 }
 const stripe=s.paymentType==='card'?Math.floor(Math.max(0,a-platform-cardOrAto)*0.002*1.1+1e-9):0;
 const payoutFee=s.paymentType==='card'?safeInt(s.cardPayoutFee):s.paymentType==='ato'?safeInt(s.atoPayoutFee):0;
 const afterFees=a-platform-cardOrAto-stripe;
 const net=afterFees-taxReserve;
 return{gross:a,platform,taxReserve,cardOrAto,stripe,payoutFee,afterFees,net};
}
function minInvoice(target){
 const wish=safeInt(target);let lo=0,hi=Math.max(1000,wish+1);
 while(feeDetails(hi).net<wish&&hi<1e12)hi=Math.min(1e12,hi*2);
 if(feeDetails(hi).net<wish)return null;
 while(lo<hi){const mid=Math.floor((lo+hi)/2);if(feeDetails(mid).net>=wish)hi=mid;else lo=mid+1}
 return lo;
}
function feeResultsHtml(){
 if(amount.trim()==='')return '';
 const desired=safeInt(amount),invoice=s.feeMode==='reverse'?minInvoice(desired):desired;
 if(invoice===null)return '<div class="result"><small>計算結果</small><strong>計算不可</strong></div><p class="hint">現在の設定では希望する手取り額に到達できません。</p>';
 const d=feeDetails(invoice);
 const stat=(label,value,minus=false,extra='')=>`<div class="statline ${extra}"><span>${label}</span><b>${minus?'− ':''}${yen(value)}</b></div>`;
 return `<div class="result"><small>${s.feeMode==='deduct'?'差引後の手取り目安':'必要な請求金額（税込・概算）'}</small><strong>${yen(s.feeMode==='deduct'?d.net:invoice)}</strong></div>
 ${stat('請求金額',invoice)}
 ${stat('くらま手数料（税込・概算）',d.platform,true)}
 ${s.paymentType==='card'?stat('カード決済手数料（税込・概算）',d.cardOrAto,true):''}
 ${s.paymentType==='ato'?stat('ATO決済手数料（概算）',d.cardOrAto,true):''}
 ${s.paymentType==='card'?stat('Stripe Connect費用（税込・概算）',d.stripe,true):''}
 ${stat('各種手数料差引後',d.afterFees)}
 ${s.taxEnabled?stat('消費税納税分として確保（概算）',d.taxReserve,true):''}
 ${stat('最終的な手取り目安',d.net,false,'total')}
 ${d.payoutFee?'<p class="hint">振込手数料は入金ごとに発生するため含めていません。決済手数料の端数処理などで実際の入金明細とは差が生じる場合があります。</p>':'<p class="hint">端数処理などで実際の入金明細とは差が生じる場合があります。</p>'}
 ${s.feeMode==='reverse'?`<p class="hint">希望手取り${yen(desired)}以上になる請求金額を逆算しています。</p>`:''}`;
}
const bind=(id,event,fn)=>$(id)?.addEventListener(event,fn);const monthData=()=>{const m=s.months[s.month];return m&&typeof m==='object'?m:{work:0,cancel:0,review:0}};const setMonthValue=(key,value)=>{const d={...monthData(),[key]:safeInt(value)};if(d.review>d.work){toast('口コミ件数は作業件数以下にしてください');return} s.months[s.month]=d;save();render()};
function render(){const [title,sub]=titles[s.page]||titles.home;$('heading').textContent=title;$('subhead').textContent=sub;$('home').hidden=s.page==='home';$('settingsBtn').hidden=s.page==='settings';$('home').onclick=()=>go('home');$('settingsBtn').onclick=()=>go('settings');let html='';
if(s.page==='home'){html=`<div class="grid">${[['fee','💴','手取り計算機','手数料を引く・価格を逆算'],['cancel','📅','キャンセル率','作業・キャンセル件数を管理'],['review','⭐','口コミ率','作業・口コミ件数を管理'],['rating','🌟','星評価','次の0.01まであと何件？']].map(([id,icon,name,desc])=>`<button class="tile" data-page="${id}"><span class="emoji">${icon}</span><strong>${name}</strong><small>${desc}</small></button>`).join('')}</div><p class="hint">数字はこの端末に保存。売上金額は計算だけで履歴に残しません。</p>`}
if(s.page==='fee'){
 const cardPayment=s.paymentType==='card',atoPayment=s.paymentType==='ato';
 const paymentNote=cardPayment?'カード手数料は未確定の場合、高い方の3.2％（税抜）で自動計算します。Stripe Connect費用0.2％（税抜）も概算に含みます。':atoPayment?'ATO後払いの決済手数料4.5％で概算。振込手数料は税抜500円／振込で、1件ごとの計算には含めていません。':'通常のくらま手数料のみ計算します。';
 html=card('手取り計算',`<div class="switch" role="group" aria-label="計算方法"><button data-mode="deduct" class="${s.feeMode==='deduct'?'active':''}">手数料を引く</button><button data-mode="reverse" class="${s.feeMode==='reverse'?'active':''}">希望手取りから逆算</button></div>
 ${field('amount',s.feeMode==='deduct'?'請求金額（税込・円）':'希望する手取り額（円）',amount,'min="0" step="1" placeholder="金額を入力"')}
 ${selectField('paymentType','支払い方法',s.paymentType,[['none','通常手数料のみ'],['card','オンラインカード決済'],['ato','後払い（ATO）']])}
 <p class="hint payment-explanation">${paymentNote}</p>
 ${cardPayment?`${selectField('cardRateMode','カード決済の料率',s.cardRateMode,[['estimate','3.2％（税抜・高い方で概算）'],['confirmed278','2.78％（税込・明細確認後）'],['confirmed320','3.2％（税抜・確定）'],['custom','任意の料率（税抜）']])}${s.cardRateMode==='custom'?field('customCardRate','カード手数料率（税抜・％）',s.customCardRate,'min="0" max="100" step="0.01"'):''}`:''}
 <div class="twocol">${field('rate','くらま手数料率（％）',s.feeRate,'min="0" max="90" step="0.1"')}${field('minimum','最低手数料（税抜・円）',s.minimum,'min="0" step="1"')}</div>
 <p class="hint">くらま手数料の初期値は20％、最低2,000円（税抜）。手数料に消費税10％を加算します。</p>
 <div class="tax-block"><h3>消費税の納税分（概算）</h3>
 <div class="switch tax-toggle" role="group" aria-label="消費税納税分を考慮するか"><button data-tax="no" class="${!s.taxEnabled?'active':''}">考慮しない</button><button data-tax="yes" class="${s.taxEnabled?'active':''}">考慮する</button></div>
 ${s.taxEnabled?field('taxReservePct','請求金額から確保する割合（％）',s.taxReservePct,'min="0" max="100" step="0.1"'):''}
 <p class="hint">納税用の確保額は請求金額に設定割合を掛けた概算です（初期値10％）。実際の納税額を算定するものではありません。</p></div>`);
 html+=`<section class="card result-card" id="feeResultCard" ${amount.trim()?'':'hidden'}><h2>計算結果</h2><div id="feeResults">${feeResultsHtml()}</div></section>`;
}
if(s.page==='rating'){const arr=s.rating.map(safeInt),n=arr.reduce((a,b)=>a+b,0),sum=arr.reduce((a,b,i)=>a+b*(i+1),0),avg=n?sum/n:0,shown=n?trunc2(avg):0,next=n?Math.min(5,Math.round((shown+.01)*100)/100):0;let needed=null;if(n&&shown<5){if(next===5)needed=sum===5*n?0:null;else needed=Math.max(0,Math.ceil((next*n-sum)/(5-next)-1e-9))}html=card('口コミの星別件数',`<p class="hint">初回は件数を直接入力。以降は「＋」「−」で更新し、自動保存します。</p>${[5,4,3,2,1].map(star=>`<div class="row"><span class="left">★${star}</span><div class="stepper"><button class="minus" data-star="${star}" data-delta="-1" aria-label="星${star}を1件減らす">−</button><strong>${arr[star-1]}件</strong><button data-star="${star}" data-delta="1" aria-label="星${star}を1件増やす">＋</button></div></div>`).join('')}<button class="btn alt full spaced" id="editStars">星別件数をまとめて入力・修正</button>`)+card('現在の評価',`<div class="result"><small>平均評価（小数第3位以下切り捨て）</small><strong>${n?shown.toFixed(2):'—'}</strong><p>口コミ合計 ${n.toLocaleString()}件</p></div><div class="statline"><span>実際の平均</span><b>${n?avg.toFixed(5):'—'}</b></div><div class="statline"><span>次の評価</span><b>${n&&shown<5?next.toFixed(2):'—'}</b></div><div class="result"><small>次の0.01アップまで</small><strong>${n===0?'件数を入力':shown>=5?'最高評価':needed===null?'到達不可':'★5 あと'+needed.toLocaleString()+'件'}</strong></div><p class="hint">全口コミを同じ重みで単純平均する計算です。サービス側の独自集計とは異なる場合があります。</p>`)}
if(s.page==='cancel'||s.page==='review'){const isCancel=s.page==='cancel',d=monthData(),total=d.work+d.cancel,rate=isCancel?(total?d.cancel/total*100:0):(d.work?d.review/d.work*100:0),goal=Number(s.goals[isCancel?'cancel':'review']);let needed=null;if(goal>0&&goal<=100){if(isCancel)needed=Math.max(0,Math.ceil(d.cancel*100/goal-total-1e-9));else if(goal<100)needed=Math.max(0,Math.ceil((goal*d.work-100*d.review)/(100-goal)-1e-9));else needed=d.review===d.work?0:null}const name=isCancel?'キャンセル':'口コミ';html=card('対象年月',`<div class="twocol"><label class="field"><span>年</span><select id="year">${Array.from({length:11},(_,i)=>now.getFullYear()-5+i).map(y=>`<option value="${y}" ${Number(s.year)===y?'selected':''}>${y}年</option>`).join('')}</select></label><label class="field"><span>月</span><select id="month">${Array.from({length:12},(_,i)=>`<option value="${i+1}" ${Number(s.month.slice(5))===i+1?'selected':''}>${i+1}月</option>`).join('')}</select></label></div><p class="hint">過去の月も選択して修正できます。履歴は12か月を超えても保持します。</p>`)+card(`${Number(s.month.slice(5))}月の件数`,`${[['work','作業件数'],[isCancel?'cancel':'review',name+'件数']].map(([k,label])=>`<div class="row"><span class="left">${label}</span><div class="stepper"><button class="minus" data-key="${k}" data-delta="-1" aria-label="${label}を減らす">−</button><strong>${d[k]||0}件</strong><button data-key="${k}" data-delta="1" aria-label="${label}を増やす">＋</button></div></div>`).join('')}<button id="editCounts" class="btn alt full spaced">件数を直接入力・修正</button><div class="result"><small>今月の${name}率</small><strong>${pct(rate)}</strong></div>${field('goal','目標'+name+'率（％）',s.goals[isCancel?'cancel':'review'],'min="0.01" max="100" step="0.01"')}<div class="result"><small>目標までに必要な${isCancel?'キャンセルなし作業':'口コミ付き作業'}</small><strong>${needed===null?'到達不可':needed.toLocaleString()+'件'}</strong></div><p class="hint">${isCancel?'キャンセル率＝キャンセル件数÷（作業件数＋キャンセル件数）':'口コミ率＝口コミ件数÷作業件数'}。目標達成の試算は、今後${isCancel?'キャンセルが発生しない':'すべての追加作業に口コミが付く'}場合です。</p>`)+annualCard(isCancel)}
if(s.page==='settings'){html=card('バックアップ',`<p class="hint">端末のデータ消去や機種変更に備え、JSONファイルを保存してください。</p><button id="export" class="btn full">JSONバックアップを保存</button><label class="field spaced"><span>JSONファイルから復元</span><input id="import" type="file" accept="application/json,.json"></label><p class="note">復元すると現在の保存内容を上書きします。先にバックアップを取ってください。</p>`)+card('データの取り扱い',`<p class="hint">すべて端末内のlocalStorageに保存します。外部送信・会員登録・広告・AI機能はありません。</p><button id="reset" class="btn danger full">全データを初期化</button>`)}
$('view').classList.toggle('fee-screen',s.page==='fee');$('view').innerHTML=html;attach()}
function annualCard(isCancel){const y=Number(s.year);let w=0,c=0,r=0;const lines=Array.from({length:12},(_,i)=>{const key=`${y}-${String(i+1).padStart(2,'0')}`,d=s.months[key]||{};w+=safeInt(d.work);c+=safeInt(d.cancel);r+=safeInt(d.review);const val=isCancel?(safeInt(d.work)+safeInt(d.cancel)?safeInt(d.cancel)/(safeInt(d.work)+safeInt(d.cancel))*100:0):(safeInt(d.work)?safeInt(d.review)/safeInt(d.work)*100:0);return `<div class="statline"><span>${i+1}月</span><b>${pct(val)}</b></div>`}).join('');const annual=isCancel?(w+c?c/(w+c)*100:0):(w?r/w*100:0);return card(`${y}年の集計`,`<div class="result"><small>年間${isCancel?'キャンセル':'口コミ'}率</small><strong>${pct(annual)}</strong></div><div class="statline"><span>作業件数</span><b>${w}件</b></div><div class="statline"><span>${isCancel?'キャンセル':'口コミ'}件数</span><b>${isCancel?c:r}件</b></div><h3 class="section-title">月別一覧</h3>${lines}`)}
function attach(){document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>go(b.dataset.page));document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{s.feeMode=b.dataset.mode;save();render()});if(s.page==='fee'){
 bind('amount','input',e=>{amount=e.target.value;const el=$('feeResults'),panel=$('feeResultCard');if(el)el.innerHTML=feeResultsHtml();if(panel)panel.hidden=amount.trim()===''});
 const setRate=(id,key,defaultValue,max=100)=>bind(id,'change',e=>{s[key]=rateValue(e.target.value,defaultValue,max);save();render()});
 const setYen=(id,key)=>bind(id,'change',e=>{s[key]=safeInt(e.target.value);save();render()});
 setRate('rate','feeRate',20,90);setYen('minimum','minimum');setRate('taxReservePct','taxReservePct',10);document.querySelectorAll('[data-tax]').forEach(b=>b.onclick=()=>{s.taxEnabled=b.dataset.tax==='yes';save();render()});
 bind('paymentType','change',e=>{s.paymentType=e.target.value;s.includePayout=false;save();render()});
 bind('cardRateMode','change',e=>{s.cardRateMode=e.target.value;save();render()});
 setRate('customCardRate','customCardRate',3.2);
 setRate('atoRate','atoRate',4.5);
 setYen('stripeConnectFee','stripeConnectFee');
 bind('payoutFee','change',e=>{s[s.paymentType==='card'?'cardPayoutFee':'atoPayoutFee']=safeInt(e.target.value);save();render()});
 bind('includePayout','change',e=>{s.includePayout=e.target.checked;save();render()});
 }
if(s.page==='rating'){document.querySelectorAll('[data-star]').forEach(b=>b.onclick=()=>{const i=Number(b.dataset.star)-1;s.rating[i]=safeInt(s.rating[i]+Number(b.dataset.delta));save();render()});bind('editStars','click',()=>{const input=prompt('★5,★4,★3,★2,★1 の件数をカンマ区切りで入力', [...s.rating].reverse().join(','));if(input===null)return;const a=input.split(/[,，、\s]+/).map(x=>Number(x));if(a.length!==5||a.some(x=>!Number.isInteger(x)||x<0)){toast('0以上の整数を5つ入力してください');return}s.rating=a.reverse();save();render()})}
if(s.page==='cancel'||s.page==='review'){bind('year','change',e=>{s.year=Number(e.target.value);s.month=`${s.year}-${s.month.slice(5)}`;save();render()});bind('month','change',e=>{s.month=`${s.year}-${String(e.target.value).padStart(2,'0')}`;save();render()});document.querySelectorAll('[data-key]').forEach(b=>b.onclick=()=>{const k=b.dataset.key,d=monthData(),v=safeInt((d[k]||0)+Number(b.dataset.delta));setMonthValue(k,v)});bind('editCounts','click',()=>{const d=monthData(),w=prompt('この月の作業件数',String(d.work));if(w===null)return;const k=s.page==='cancel'?'cancel':'review',v=prompt('この月の'+(k==='cancel'?'キャンセル':'口コミ')+'件数',String(d[k]));if(v===null)return;if(!/^\d+$/.test(w)||!/^\d+$/.test(v)||k==='review'&&Number(v)>Number(w)){toast('件数を正しく入力してください');return}const updated={...d,work:safeInt(w),[k]:safeInt(v)};if(updated.review>updated.work){toast('作業件数が口コミ件数を下回ります');return}s.months[s.month]=updated;save();render()});bind('goal','change',e=>{const v=Number(e.target.value);if(v<=0||v>100){toast('目標は0より大きく100以下で入力');render();return}s.goals[s.page]=v;save();render()})}
if(s.page==='settings'){bind('export','click',()=>{const blob=new Blob([JSON.stringify({app:'merchant-calculators',version:1,data:s},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`出店者の計算機_${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)});bind('import','change',async e=>{const f=e.target.files?.[0];if(!f)return;try{const parsed=JSON.parse(await f.text());if(parsed.app!=='merchant-calculators'||parsed.version!==1||!parsed.data||!Array.isArray(parsed.data.rating)||parsed.data.rating.length!==5)throw Error();if(!confirm('現在のデータを上書きして復元しますか？'))return;s=Object.assign(fresh(),parsed.data);save();go('home');toast('復元しました')}catch{toast('対応していないJSONファイルです')}});bind('reset','click',()=>{if(confirm('すべての記録を削除しますか？この操作は取り消せません。')){s=fresh();save();go('home');toast('初期化しました')}})}}
function activity(){s.lastUsedAt=Date.now();save()}
document.addEventListener('pointerdown',activity,{passive:true});
document.addEventListener('input',activity);
document.addEventListener('keydown',activity);
document.addEventListener('visibilitychange',()=>{
 if(document.visibilityState==='visible'){
  if(Date.now()-Number(s.lastUsedAt||0)>=RESUME_MSEC){s.page='home';amount=''}
  s.lastUsedAt=Date.now();save();render();
 }
});
activity();render();
})();