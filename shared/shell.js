(()=>{'use strict';
const base=new URL('../',document.currentScript.src);
const defs=[
{path:'',label:'ホーム',name:'home',shape:'<path d="m3 10 9-7 9 7"/><path d="M5 9v12h14V9"/><path d="M9 21v-7h6v7"/>'},
{path:'receipt/',label:'領収書',name:'receipt',shape:'<path d="M4 3h16v18l-4-2-4 2-4-2-4 2z"/><path d="M8 8h8M8 12h8"/>'},
{path:'estimate/',label:'見積書',name:'estimate',shape:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>'},
{path:'merchant-calculator/',label:'計算機',name:'calc',shape:'<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8 7h8M8 12h2M14 12h2M8 16h2M14 16h2"/>'},
{path:'before-after-tsukurukun/',label:'写真報告',name:'photo',shape:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m3 16 5-5 4 4 3-3 6 6"/><circle cx="16" cy="8" r="1"/>'}];
const url=new URL(location.href), rel=url.pathname.startsWith(base.pathname)?url.pathname.slice(base.pathname.length):'';
const current=rel.startsWith('receipt/')?'receipt':rel.startsWith('estimate/')?'estimate':rel.startsWith('merchant-calculator/')?'calc':rel.startsWith('before-after-tsukurukun/')?'photo':'home';
if(!document.querySelector('.tool-nav')){
 const nav=document.createElement('nav');nav.className='tool-nav';nav.setAttribute('aria-label','共通メニュー');
 nav.innerHTML=defs.map(o=>'<a data-tool-link="'+o.name+'" href="'+new URL(o.path,base)+'" '+(current===o.name?'aria-current="page"':'')+'><svg viewBox="0 0 24 24" aria-hidden="true">'+o.shape+'</svg><span>'+o.label+'</span></a>').join('');
 document.body.appendChild(nav);
 nav.addEventListener('click',async event=>{
  const link=event.target.closest('a[data-tool-link]');if(!link||link.href===location.href||!window.__toolBeforeLeave)return;
  event.preventDefault();link.setAttribute('aria-busy','true');
  try{await window.__toolBeforeLeave(); location.assign(link.href)}
  catch(error){let alert=document.querySelector('.tool-save-alert');if(!alert){alert=document.createElement('div');alert.className='tool-save-alert';alert.role='alert';document.body.appendChild(alert)}
    alert.textContent='保存できませんでした。容量や設定をご確認ください。移動すると入力が失われる可能性があります。';
    link.removeAttribute('aria-busy');console.error(error);
  }
 });
}
const style=new URL('shell.css',document.currentScript.src);
if(!document.querySelector('link[data-tool-style]')){const sheet=document.createElement('link');sheet.rel='stylesheet';sheet.href=style.href;sheet.dataset.toolStyle='true';document.head.appendChild(sheet)}
const manifest=new URL('manifest.webmanifest',base);
let link=document.querySelector('link[rel=manifest]');
if(link)link.href=manifest.href;else{link=document.createElement('link');link.rel='manifest';link.href=manifest.href;document.head.appendChild(link)}
if('serviceWorker' in navigator && location.protocol==='https:')navigator.serviceWorker.register(new URL('sw.js',base).href,{scope:base.pathname}).catch(()=>{});
})();