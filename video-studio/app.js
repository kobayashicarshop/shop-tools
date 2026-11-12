/* KOBATECH LAB 動画スタジオ - ローカルファーストMVP
   外部APIへの素材アップロードはしません。動画はMediaRecorderで実時間エンコードします。 */
'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const FPS = 30;
  const MAX_BYTES = 200 * 1024 * 1024;
  const ROLES = {before: '施工前', work: '作業中', after: '施工後', other: 'その他'};
  const ROLE_ORDER = {before: 0, work: 1, after: 2, other: 3};
  const makeId = () => (globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const deepCopy = (value) => JSON.parse(JSON.stringify(value));
  const clamp = (n, min, max) => Math.min(max, Math.max(min, Number(n) || 0));
  const seconds = (v) => `${Math.floor(v / 60)}:${String(Math.floor(v % 60)).padStart(2, '0')}`;
  const createProject = () => ({id: makeId(), version: 1, template:'installation', target: 15, vehicle:'', product:'', summary:'', endCard:true, clips:[], musicId:null, musicVolume:.5, updatedAt:Date.now()});
  let project = createProject();
  const assets = new Map(); // id -> {id,name,type,size,duration,file}
  const urls = new Map();
  const renderMedia = new Map();
  let db = null;
  let selected = -1;
  let undoStack = [];
  let redoStack = [];
  let playhead = 0;
  let playing = false;
  let startAt = 0;
  let previewAnimation = null;
  let saveTimer = null;
  let busy = false;
  let activeVideoId = null;
  let lastRenderURL = null;
  let lastOutput = null;
  let currentRecorder = null;
  let cancelRequested = false;
  let exportFrame = null;
  let musicElement = null;
  let toastTimer = null;
  let saveErrorShown = false;

  function notify(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 4300);
  }
  function urlFor(id) {
    if (!urls.has(id) && assets.has(id)) urls.set(id, URL.createObjectURL(assets.get(id).file));
    return urls.get(id);
  }
  function releaseAsset(id) {
    const url = urls.get(id);
    if (url) URL.revokeObjectURL(url);
    urls.delete(id);
    const media = renderMedia.get(id);
    if (media?.tagName === 'VIDEO') { media.pause(); media.removeAttribute('src'); media.load(); }
    renderMedia.delete(id);
  }
  function initDB() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {reject(new Error('IndexedDBなし'));return;}
      const req = indexedDB.open('kobatech-video-studio', 1);
      req.onupgradeneeded = () => {
        const store = req.result;
        if (!store.objectStoreNames.contains('assets')) store.createObjectStore('assets', {keyPath:'id'});
        if (!store.objectStoreNames.contains('projects')) store.createObjectStore('projects', {keyPath:'id'});
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function dbWrite(store, method, data) {
    if (!db) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store)[method](data);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  function dbGetAll(store) {
    if (!db) return Promise.resolve([]);
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readonly').objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function restore() {
    try {
      db = await initDB();
      const [savedProjects, savedAssets] = await Promise.all([dbGetAll('projects'), dbGetAll('assets')]);
      const latest = savedProjects.sort((a,b)=>b.updatedAt-a.updatedAt)[0];
      if (latest && latest.version === 1) project = latest;
      for (const asset of savedAssets) if (asset?.file instanceof Blob) assets.set(asset.id, asset);
      project.clips = project.clips.filter(c => assets.has(c.assetId));
      if (project.musicId && !assets.has(project.musicId)) project.musicId = null;
      if (project.clips.length) selected = 0;
      $('storageState').textContent = '編集内容・素材をこのブラウザ内に自動保存します';
    } catch (error) {
      console.warn('Storage unavailable', error);
      $('storageState').textContent = '端末への保存が利用できません。再読込でデータが消えます。';
      notify('保存機能が使えません。端末の空き容量やプライベートブラウズを確認してください。');
    }
    renderAll();
  }
  async function saveProject() {
    if (!db) return;
    try {
      project.updatedAt = Date.now();
      await dbWrite('projects','put',deepCopy(project));
      $('storageState').textContent = '端末内に保存済み';
      saveErrorShown = false;
    } catch (error) {
      console.warn('Save failure', error);
      $('storageState').textContent = '保存失敗：端末の空き容量を確認してください';
      if (!saveErrorShown) notify('自動保存に失敗しました。容量を確認してください。');
      saveErrorShown = true;
    }
  }
  function scheduleSave() {
    $('storageState').textContent = '保存中…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void saveProject(), 400);
  }
  function modify(change, {select = selected} = {}) {
    if (busy) return;
    undoStack.push(deepCopy(project));
    if (undoStack.length > 15) undoStack.shift();
    redoStack.length = 0;
    change();
    selected = project.clips.length ? clamp(select,0,project.clips.length-1) : -1;
    playhead = Math.min(playhead, totalDuration());
    stopPlayback();
    scheduleSave();
    renderAll();
  }
  function undo() {
    if (busy || !undoStack.length) return;
    redoStack.push(deepCopy(project));
    project = undoStack.pop();
    selected = project.clips.length ? clamp(selected,0,project.clips.length-1) : -1;
    stopPlayback(); scheduleSave(); renderAll();
  }
  function redo() {
    if (busy || !redoStack.length) return;
    undoStack.push(deepCopy(project));
    project = redoStack.pop();
    selected = project.clips.length ? clamp(selected,0,project.clips.length-1) : -1;
    stopPlayback(); scheduleSave(); renderAll();
  }
  async function mediaDuration(file) {
    return new Promise((resolve, reject) => {
      const tmp = document.createElement('video');
      const url = URL.createObjectURL(file);
      const timer = setTimeout(() => finish(new Error('動画の読み込みがタイムアウトしました')), 10000);
      let finished = false;
      function finish(err, duration) {
        if (finished) return;
        finished = true;
        clearTimeout(timer); tmp.removeAttribute('src'); tmp.load(); URL.revokeObjectURL(url);
        err ? reject(err) : resolve(duration);
      }
      tmp.preload = 'metadata'; tmp.muted = true; tmp.playsInline = true;
      tmp.onloadedmetadata = () => finish(null, Number.isFinite(tmp.duration) ? tmp.duration : 15);
      tmp.onerror = () => finish(new Error('動画を読み込めませんでした'));
      tmp.src = url;
    });
  }
  async function imageCheck(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {URL.revokeObjectURL(url); resolve();};
      img.onerror = () => {URL.revokeObjectURL(url); reject(new Error('画像形式に対応していません'));};
      img.src = url;
    });
  }
  function kindOf(file) {
    if (file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) return 'image';
    if (file.type.startsWith('video/') || /\.(mp4|mov|m4v)$/i.test(file.name)) return 'video';
    if (file.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac)$/i.test(file.name)) return 'audio';
    return 'unknown';
  }
  async function importMedia(files) {
    if (busy || !files.length) return;
    const existing = [...assets.values()].filter(a=>a.type!=='audio');
    const incoming = [...files];
    let images = existing.filter(a=>a.type==='image').length;
    let videos = existing.filter(a=>a.type==='video').length;
    let bytes = [...assets.values()].reduce((sum,a)=>sum+a.size,0);
    let added = 0;
    for (const file of incoming) {
      const kind = kindOf(file);
      if (!['image','video'].includes(kind)) {notify(`非対応の素材をスキップ：${file.name}`);continue;}
      if ((kind==='image'&&images>=10) || (kind==='video'&&videos>=3) || bytes+file.size>MAX_BYTES) {
        notify('写真10枚・動画3本、合計200MBの上限を超えています。'); break;
      }
      if (file.size <= 0) {notify(`空のファイルをスキップ：${file.name}`);continue;}
      try {
        let duration = 0;
        if (kind==='video') duration = await mediaDuration(file);
        else await imageCheck(file);
        const asset = {id:makeId(), name:file.name, type:kind, size:file.size, duration, file};
        await dbWrite('assets', 'put', asset);
        assets.set(asset.id,asset);
        modify(() => project.clips.push({id:makeId(), assetId:asset.id, role:'other', duration:kind==='image'?2.5:clamp(duration,1,4), trimStart:0, caption:'', zoom:1, panX:0, panY:0, animate:kind==='image'}), {select:project.clips.length});
        if (kind==='image') images++; else videos++;
        bytes += file.size; added++;
      } catch (err) {notify(`${file.name}：${err.message || '読み込み失敗'}`);}
    }
    if (added) {notify(`${added}件の素材を取り込みました。自動構成を押してください。`);renderAll();}
  }
  async function importMusic(file) {
    if (!file || busy) return;
    if (kindOf(file)!=='audio') {notify('BGMは音声ファイルを選択してください。');return;}
    if (file.size > 25*1024*1024) {notify('BGMは25MB以内にしてください。');return;}
    try {
      const asset={id:makeId(),name:file.name,type:'audio',size:file.size,duration:0,file};
      await dbWrite('assets','put',asset);
      assets.set(asset.id,asset);
      modify(()=>{project.musicId=asset.id;project.musicVolume=.5;});
      notify('BGMを設定しました。音量は編集できます。');
    } catch(e) {notify('BGMの保存に失敗しました。');}
  }
  function autoCut() {
    if (!project.clips.length) return notify('先に写真や動画を追加してください。');
    if (project.clips.some(c => c.caption) && !confirm('現在の並び順と表示時間を自動構成に置き換えますか？（入力したクリップの文字は保持します）')) return;
    modify(() => {
      // 未分類の素材は読み込み順を尊重し、役割を指定した素材を前→中→後へ。
      project.clips.sort((a,b)=>ROLE_ORDER[a.role]-ROLE_ORDER[b.role]);
      const end = project.endCard ? 2.5 : 0;
      const available = project.target-end;
      const secondsPer = Math.round(clamp(available/project.clips.length, 1, 5)*10)/10;
      project.clips.forEach((c,i)=>{
        const asset=assets.get(c.assetId);
        c.trimStart = 0;
        c.duration=asset.type==='video' ? clamp(Math.min(secondsPer,asset.duration||secondsPer),1,5) : secondsPer;
        c.zoom=1;c.panX=0;c.panY=0;c.animate=asset.type==='image';
        if (!c.caption) {
          if (project.template==='beforeAfter') c.caption= c.role==='before'?'BEFORE':c.role==='after'?'AFTER':'';
          else if (project.template==='report') c.caption= c.role==='work'?'見えない部分まで丁寧に':(ROLES[c.role]==='その他'?'':ROLES[c.role]);
          else c.caption = i===0 ? [project.vehicle,project.product].filter(Boolean).join(' / ') : (c.role==='other'?'':ROLES[c.role]);
        }
      });
    }, {select:0});
    notify('自動構成が完了しました。各クリップをタップすると編集できます。');
  }
  function totalDuration() {return project.clips.reduce((n,c)=>n+c.duration,0)+(project.endCard && project.clips.length?2.5:0);}
  function selectedClip() {return project.clips[selected];}
  function mediaFor(assetId) {
    if (renderMedia.has(assetId)) return renderMedia.get(assetId);
    const asset=assets.get(assetId);
    if (!asset) return null;
    const el= document.createElement(asset.type==='video'?'video':'img');
    el.src=urlFor(assetId);
    if (asset.type==='video') {
      el.preload='auto'; el.playsInline=true;el.muted=true;el.loop=false;
      el.addEventListener('loadeddata',()=> {if(!playing && !busy) drawAt(playhead,$('preview'),false);});
      el.addEventListener('seeked',()=> {if(!playing && !busy) drawAt(playhead,$('preview'),false);});
    } else el.addEventListener('load',()=>{if(!playing && !busy) drawAt(playhead,$('preview'),false);});
    renderMedia.set(assetId,el);
    return el;
  }
  function pauseVideos() {for(const m of renderMedia.values()) if(m.tagName==='VIDEO') m.pause();activeVideoId=null;}
  function stopMusic() {if(musicElement){musicElement.pause();musicElement.currentTime=0;}}
  function prepareMusic() {
    if (!project.musicId || !assets.has(project.musicId)) return null;
    const url=urlFor(project.musicId);
    if(!musicElement || musicElement.src!==url) {
      if(musicElement) musicElement.pause();
      musicElement=new Audio(url);musicElement.preload='auto';musicElement.loop=true;
    }
    musicElement.volume=clamp(project.musicVolume,0,1);
    return musicElement;
  }
  function stopPlayback() {
    playing=false;
    if(previewAnimation) cancelAnimationFrame(previewAnimation);
    previewAnimation=null;
    pauseVideos();stopMusic();
    $('play').textContent='▶';
  }
  function seek(time) {
    stopPlayback();
    playhead=clamp(time,0,totalDuration());
    drawAt(playhead,$('preview'),false);
    drawTransport();
  }
  function playPreview() {
    if(!project.clips.length || busy) return;
    if(playing){stopPlayback();drawTransport();return;}
    if(playhead>=totalDuration()) playhead=0;
    playing=true;startAt=performance.now()-playhead*1000;$('play').textContent='❚❚';
    const music=prepareMusic();
    if(music){music.currentTime=playhead%Math.max(1,Number.isFinite(music.duration)?music.duration:100000);void music.play().catch(()=>notify('BGMを再生できませんでした。'));}
    const tick=(ts)=>{
      if(!playing) return;
      playhead=Math.min(totalDuration(),(ts-startAt)/1000);
      drawAt(playhead,$('preview'),true);drawTransport();
      if(playhead>=totalDuration()){stopPlayback();drawTransport();return;}
      previewAnimation=requestAnimationFrame(tick);
    };
    previewAnimation=requestAnimationFrame(tick);
  }
  function locate(time, state=project) {
    let start=0;
    for(const clip of state.clips){
      if(time < start+clip.duration-0.0001) return {clip,local:time-start,index:state.clips.indexOf(clip)};
      start+=clip.duration;
    }
    return {clip:null,local:time-start,index:-1};
  }
  function coverImage(ctx, m, target, clip, progress) {
    const w=m.videoWidth||m.naturalWidth||0;
    const h=m.videoHeight||m.naturalHeight||0;
    if(!w||!h)return false;
    const ratio=Math.max(target.width/w,target.height/h);
    const zoom=clip.zoom*(clip.animate?(1+Math.min(1,progress)*.07):1);
    const ww=w*ratio*zoom, hh=h*ratio*zoom;
    const extraX=Math.max(0,ww-target.width)/2,extraY=Math.max(0,hh-target.height)/2;
    const left=(target.width-ww)/2+extraX*clip.panX/100;
    const top=(target.height-hh)/2+extraY*clip.panY/100;
    try{ctx.drawImage(m,left,top,ww,hh);return true;}catch(_){return false;}
  }
  function drawLabel(ctx,text,canvas,where='bottom') {
    if(!text)return;
    const max=canvas.width*.82, base=canvas.width;
    const font=Math.round(base*.050);
    ctx.save();ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`700 ${font}px -apple-system, "Hiragino Sans", Meiryo, sans-serif`;
    const rows=[];let line='';
    for(const ch of text){if(ctx.measureText(line+ch).width>max && line){rows.push(line);line=ch;}else line+=ch;}
    if(line)rows.push(line);
    const maxRows=rows.slice(0,3);const height=maxRows.length*font*1.48+font*.7;
    const y=where==='middle'?canvas.height*.48:(where==='top'?canvas.height*.18:canvas.height*.77);
    const ry=y-height/2;
    ctx.fillStyle='rgba(14,27,42,.76)';roundedRect(ctx,base*.07,ry,base*.86,height,Math.max(8,base*.02));ctx.fill();
    ctx.fillStyle='#fff';maxRows.forEach((row,i)=>ctx.fillText(row,base/2,ry+font*.73+i*font*1.48, max));ctx.restore();
  }
  function roundedRect(ctx,x,y,w,h,r) {ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.quadraticCurveTo(x+w,y,x+w,y+r);ctx.lineTo(x+w,y+h-r);ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);ctx.lineTo(x+r,y+h);ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();}
  function drawBrand(ctx,canvas) {
    const {width:w,height:h}=canvas;
    const font=Math.round(w*.067);
    ctx.fillStyle='#111e30';ctx.fillRect(0,0,w,h);
    ctx.fillStyle='#c3d6ee';ctx.textAlign='center';ctx.font=`800 ${font}px -apple-system, sans-serif`;ctx.fillText('KOBATECH LAB',w/2,h*.47);
    ctx.font=`500 ${Math.round(font*.5)}px -apple-system, sans-serif`;ctx.fillStyle='#aabed4';ctx.fillText('出張カー電装サービス',w/2,h*.51);
    ctx.fillStyle='#386bbc';ctx.fillRect(w*.3,h*.55,w*.4,Math.max(3,w*.005));
  }
  function drawAt(time,canvas, shouldPlay, state=project) {
    const ctx=canvas.getContext('2d',{alpha:false});
    if(!ctx)return;
    ctx.fillStyle='#142135';ctx.fillRect(0,0,canvas.width,canvas.height);
    const result=locate(time,state);
    if(!result.clip) {
      if (state.endCard && state.clips.length) drawBrand(ctx,canvas);
      else if(!state.clips.length){ctx.textAlign='center';ctx.fillStyle='#8da1b9';ctx.font=`${canvas.width*.035}px sans-serif`;ctx.fillText('素材を追加してください',canvas.width/2,canvas.height/2);}
      pauseVideos();return;
    }
    const clip=result.clip, asset=assets.get(clip.assetId), media=mediaFor(clip.assetId);
    if(!asset||!media)return;
    if(asset.type==='video') {
      if(activeVideoId!==clip.assetId){pauseVideos();activeVideoId=clip.assetId;}
      const desired=clamp(clip.trimStart+result.local,0,Math.max(0,(asset.duration||99999)-.03));
      if(Math.abs((media.currentTime||0)-desired) > (shouldPlay?.4:.08) && !media.seeking) {
        try{media.currentTime=desired;}catch(_){}
      }
      if(shouldPlay && media.paused) void media.play().catch(()=>{if(busy) notify('動画素材の再生を開始できません。動画形式をご確認ください。');});
      if(!shouldPlay && !media.paused) media.pause();
    } else if(activeVideoId){pauseVideos();}
    const ready=asset.type==='image'?media.complete&&media.naturalWidth>0:media.readyState>=2;
    if(ready) coverImage(ctx,media,canvas,clip,result.local/Math.max(.1,clip.duration));
    else {ctx.textAlign='center';ctx.fillStyle='#bed0e2';ctx.font=`${canvas.width*.04}px sans-serif`;ctx.fillText('読み込み中…',canvas.width/2,canvas.height/2);}
    const edge=Math.min(.2,clip.duration/5);const alpha=Math.min(1,result.index===0?1:result.local/edge,(clip.duration-result.local)/edge);
    ctx.fillStyle=`rgba(12,22,35,${(1-clamp(alpha,0,1))*.92})`;ctx.fillRect(0,0,canvas.width,canvas.height);
    if(clip.caption) drawLabel(ctx,clip.caption,canvas,project.template==='report'?'bottom':'bottom');
    if(state.endCard && result.index===0 && !clip.caption && (state.vehicle||state.product)) drawLabel(ctx,[state.vehicle,state.product].filter(Boolean).join(' / '),canvas);
  }
  function drawTransport(){
    const total=totalDuration();
    $('scrubber').max=total||1;
    $('scrubber').value=clamp(playhead,0,total);
    $('playTime').textContent=`${seconds(playhead)} / ${seconds(total)}`;
  }
  function renderAssets() {
    const list=$('assetList');list.replaceChildren();
    const entries=[...assets.values()].filter(a=>a.type!=='audio');
    $('mediaCounter').textContent=`${entries.length}件`;
    $('assetsEmpty').hidden=!!entries.length;
    for(const item of entries){
      const row=document.createElement('div');row.className='asset-item';
      if(item.type==='image'){
        const img=document.createElement('img');img.className='asset-thumb';img.src=urlFor(item.id);img.alt='素材写真';row.append(img);
      }else{const thumb=document.createElement('div');thumb.className='asset-thumb';thumb.style.display='grid';thumb.style.placeItems='center';thumb.textContent='▶';row.append(thumb);}
      const text=document.createElement('div');text.className='asset-label';
      const strong=document.createElement('strong');strong.textContent=item.name;
      const small=document.createElement('small');small.textContent=`${item.type==='video'?'動画':'写真'} · ${(item.size/1024/1024).toFixed(1)}MB${item.type==='video'?` · ${item.duration.toFixed(1)}秒`:''}`;
      text.append(strong,small);row.append(text);
      const btn=document.createElement('button');btn.type='button';btn.textContent='削除';btn.setAttribute('aria-label',`${item.name}を取り除く`);
      btn.addEventListener('click',()=>void removeAsset(item.id));row.append(btn);list.append(row);
    }
  }
  async function removeAsset(id){
    if(busy)return;
    const item=assets.get(id);if(!item)return;
    if(!confirm(`${item.name}をこの編集から削除しますか？（端末の元写真・元動画は削除しません）`))return;
    modify(()=>{project.clips=project.clips.filter(c=>c.assetId!==id);});
    assets.delete(id);releaseAsset(id);
    try{await dbWrite('assets','delete',id);}catch(e){notify('保存データの削除に失敗しました。');}
    renderAll();
  }
  function renderSettings(){
    $('template').value=project.template;$('targetLength').value=String(project.target);
    $('vehicle').value=project.vehicle;$('product').value=project.product;$('summary').value=project.summary;
    $('endCard').checked=project.endCard;
    $('durationLabel').textContent=`${totalDuration().toFixed(1)}秒`;
    const music=project.musicId&&assets.get(project.musicId);
    $('musicSettings').hidden=!music;
    if(music){$('musicName').textContent=`♪ ${music.name}`;$('musicVolume').value=String(project.musicVolume);}
  }
  function renderTimeline() {
    const box=$('timeline');box.replaceChildren();
    project.clips.forEach((clip,i)=>{
      const asset=assets.get(clip.assetId);
      if(!asset)return;
      const btn=document.createElement('button');btn.type='button';btn.className='timeline-item';btn.setAttribute('role','listitem');btn.setAttribute('aria-selected',String(selected===i));
      if(asset.type==='image'){const img=document.createElement('img');img.src=urlFor(asset.id);img.alt='';btn.append(img);}
      else{const thumb=document.createElement('div');thumb.style.cssText='height:63px;display:grid;place-items:center;background:#25374c;color:white;border-radius:6px';thumb.textContent='▶ 動画';btn.append(thumb);}
      const title=document.createElement('strong');title.textContent=clip.caption||ROLES[clip.role];
      const meta=document.createElement('small');meta.textContent=`${clip.duration.toFixed(1)}秒 · ${i+1}`;
      btn.append(title,meta);btn.addEventListener('click',()=>{if(busy)return;selected=i;seek(project.clips.slice(0,i).reduce((sum,c)=>sum+c.duration,0));renderTimeline();renderClipControls();});box.append(btn);
    });
    if(project.endCard&&project.clips.length){const end=document.createElement('div');end.className='timeline-end';end.textContent='KOBATECH LAB · 2.5秒';box.append(end);}
  }
  function renderClipControls() {
    const clip=selectedClip(),asset=clip&&assets.get(clip.assetId);
    $('clipControls').hidden=!clip||!asset;
    if(!clip||!asset)return;
    $('clipCaption').value=clip.caption;
    $('clipRole').value=clip.role;
    $('clipDuration').value=clip.duration.toFixed(1);
    $('clipZoom').value=String(clip.zoom);
    $('zoomValue').textContent=`${Math.round(clip.zoom*100)}%`;
    $('clipPanX').value=String(clip.panX);
    $('clipPanY').value=String(clip.panY);
    $('clipTrim').value=String(clip.trimStart);
    $('clipTrim').disabled=asset.type!=='video';
    $('clipTrim').max=String(Math.max(0,(asset.duration||0)-1));
    $('clipAnimate').checked=!!clip.animate;
    $('clipAnimate').disabled=asset.type!=='image';
    $('moveLeft').disabled=selected<=0;
    $('moveRight').disabled=selected>=project.clips.length-1;
    $('undo').disabled=!undoStack.length;$('redo').disabled=!redoStack.length;
  }
  function renderSupport() {
    const el=$('formatStatus');
    const result=supportedFormat();
    el.className='support '+(result.ext==='mp4'?'good':'warn');
    el.textContent=result.ext==='mp4'?'MP4（H.264）に対応':result.ext==='webm'?'WebMのみ対応（MP4非対応）':'このブラウザは動画出力非対応';
    $('export').disabled=busy||!project.clips.length||!result.ext;
  }
  function renderAll(){renderAssets();renderSettings();renderTimeline();renderClipControls();renderSupport();$('previewOverlay').hidden=!!project.clips.length;drawAt(playhead,$('preview'),false);drawTransport();}
  function supportedFormat() {
    if(!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return {ext:null,mime:null};
    const bgm=!!(project.musicId && project.musicVolume>0);
    if(bgm){
      for(const mime of ['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4;codecs=avc1,mp4a.40.2']) if(MediaRecorder.isTypeSupported(mime))return {ext:'mp4',mime};
    } else {
      for(const mime of ['video/mp4;codecs=avc1.42E01E','video/mp4;codecs=avc1','video/mp4']) if(MediaRecorder.isTypeSupported(mime))return {ext:'mp4',mime};
    }
    for(const mime of ['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm']) if(MediaRecorder.isTypeSupported(mime))return {ext:'webm',mime};
    return {ext:null,mime:null};
  }
  function updateClip(prop,val){
    if(selected<0)return;
    const asset=assets.get(selectedClip().assetId);
    modify(()=>{
      const c=project.clips[selected];
      if(prop==='duration'){c.duration=clamp(val,1,8);if(asset.type==='video') c.duration=Math.min(c.duration, Math.max(1,asset.duration-c.trimStart));}
      else if(prop==='trimStart'){c.trimStart=clamp(val,0,Math.max(0,asset.duration-1));c.duration=Math.min(c.duration,Math.max(1,asset.duration-c.trimStart));}
      else c[prop]=val;
    });
    if(totalDuration()>30)notify('Instagram用の最大30秒を超えました。表示時間を短くしてください。');
  }
  function makeAudioTrack() {
    const music=prepareMusic();
    if(!music || !project.musicVolume)return Promise.resolve({track:null,clean:()=>{}});
    const AudioCtx=window.AudioContext||window.webkitAudioContext;
    if(!AudioCtx)return Promise.reject(new Error('このブラウザはBGMの合成に対応していません。BGMを外してください。'));
    const context=new AudioCtx();
    const source=context.createMediaElementSource(music);
    const gain=context.createGain();gain.gain.value=project.musicVolume;
    const dest=context.createMediaStreamDestination();source.connect(gain);gain.connect(dest);
    music.currentTime=0;music.loop=true;
    return context.resume().then(()=>({track:dest.stream.getAudioTracks()[0],start:()=>music.play(),clean:()=>{music.pause();source.disconnect();gain.disconnect();void context.close();}})).catch(e=>{void context.close();throw e;});
  }
  async function exportVideo() {
    if(busy)return;
    const format=supportedFormat();
    if(!format.ext)return notify('動画書き出し非対応のブラウザです。Safariまたは最新版Chromeでお試しください。');
    if(!project.clips.length)return notify('素材を追加してください。');
    if(totalDuration()>30.001)return notify('30秒以内になるようにクリップの長さを調整してください。');
    if(!$('safetyCheck').checked)return notify('公開前の確認にチェックを入れてください。');
    busy=true; cancelRequested=false;stopPlayback();renderSupport();
    $('exportProgress').hidden=false;$('exportResult').hidden=true;$('progressBar').style.width='0%';$('exportStatus').textContent='書き出しの準備中…';
    let stream, audioGraph, recorder, renderCanvas;
    try {
      const size=Number($('resolution').value);
      renderCanvas=document.createElement('canvas');renderCanvas.width=size;renderCanvas.height=Math.round(size*16/9);
      drawAt(0,renderCanvas,false);
      stream=renderCanvas.captureStream(FPS);
      audioGraph=await makeAudioTrack();
      if(audioGraph.track)stream.addTrack(audioGraph.track);
      recorder=new MediaRecorder(stream,{mimeType:format.mime,videoBitsPerSecond:size===1080?9000000:4500000});
      currentRecorder=recorder;
      const chunks=[];
      let settled=false;
      const finished = new Promise((resolve,reject)=>{
        recorder.ondataavailable=(e)=>{if(e.data&&e.data.size)chunks.push(e.data);};
        recorder.onerror=(e)=>{if(!settled){settled=true;reject(e.error||new Error('録画エラー'));}};
        recorder.onstop=()=>{if(settled)return;settled=true;resolve(chunks);};
      });
      const duration=totalDuration();
      // ビデオ素材の再生開始に必要なユーザー操作は、書き出しボタンから始まる。
      const first=locate(0);
      if(first.clip) mediaFor(first.clip.assetId);
      let begin=0;let raf;
      recorder.start(700);
      if(audioGraph.start) await audioGraph.start();
      const step=(ts)=>{
        if(cancelRequested || recorder.state==='inactive')return;
        if(!begin)begin=ts;
        const elapsed=clamp((ts-begin)/1000,0,duration);
        drawAt(elapsed,renderCanvas,true);
        $('progressBar').style.width=`${Math.round(elapsed/duration*100)}%`;
        $('exportStatus').textContent=`書き出し中 ${Math.round(elapsed/duration*100)}% — 画面を閉じずにお待ちください`;
        if(elapsed>=duration){stopRecorder();return;}
        raf=requestAnimationFrame(step);exportFrame=raf;
      };
      exportFrame=requestAnimationFrame(step);
      const outputChunks=await finished;
      if(cancelRequested){notify('書き出しを中止しました。');return;}
      const finalType=(recorder.mimeType||format.mime).split(';')[0];
      const blob=new Blob(outputChunks,{type:finalType});
      if(blob.size<1024)throw new Error('書き出した動画が空でした。解像度を下げて再試行してください。');
      if(lastRenderURL)URL.revokeObjectURL(lastRenderURL);
      lastRenderURL=URL.createObjectURL(blob);
      lastOutput=new File([blob],`KOBATECH-LAB-${new Date().toISOString().slice(0,10)}.${format.ext}`,{type:finalType});
      $('resultVideo').src=lastRenderURL;
      $('download').href=lastRenderURL;
      $('download').download=lastOutput.name;
      $('exportResult').hidden=false;
      $('exportStatus').textContent=`完成：${(blob.size/1024/1024).toFixed(1)}MB（${format.ext.toUpperCase()}）`;
      $('progressBar').style.width='100%';
      notify('動画を書き出しました。再生して仕上がりをご確認ください。');
      function stopRecorder(){if(recorder.state!=='inactive')recorder.stop();}
    } catch(err){console.error('Export error',err);notify(`書き出し失敗：${err.message||'ブラウザが対応していません'}`);$('exportStatus').textContent='書き出し失敗。720pでの再試行もお試しください。';}
    finally {
      if(exportFrame)cancelAnimationFrame(exportFrame);exportFrame=null;
      if(recorder?.state!=='inactive')try{recorder.stop();}catch(_){}
      currentRecorder=null;
      if(stream)stream.getTracks().forEach(t=>t.stop());
      if(audioGraph)audioGraph.clean();
      pauseVideos();stopMusic();busy=false;renderSupport();drawAt(playhead,$('preview'),false);
      if(!lastOutput||cancelRequested) $('exportProgress').hidden=true;
    }
  }
  function cancelExport() {if(!busy)return;cancelRequested=true;if(exportFrame)cancelAnimationFrame(exportFrame);exportFrame=null;if(currentRecorder?.state!=='inactive')currentRecorder.stop();}
  async function shareVideo(){
    if(!lastOutput)return;
    try{
      if(navigator.canShare?.({files:[lastOutput]})&&navigator.share)await navigator.share({files:[lastOutput],title:'KOBATECH LAB 施工動画'});
      else notify('共有できない端末です。「ファイルを保存」から保存してください。');
    }catch(error){if(error.name!=='AbortError')notify('共有できませんでした。ファイル保存をご利用ください。');}
  }
  async function newProject(){
    if(busy)return;
    if(!confirm('現在の下書きと読み込んだ素材を削除し、新規作成しますか？端末の写真ライブラリにある元ファイルは削除しません。'))return;
    stopPlayback();
    for(const id of assets.keys())releaseAsset(id);
    assets.clear();
    try{
      if(db){for(const store of ['projects','assets'])await new Promise((resolve,reject)=>{const tx=db.transaction(store,'readwrite');tx.objectStore(store).clear();tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
    }catch(e){notify('一部の保存データを削除できませんでした。');}
    project=createProject();undoStack=[];redoStack=[];selected=-1;playhead=0;
    if(lastRenderURL)URL.revokeObjectURL(lastRenderURL);lastRenderURL=null;lastOutput=null;
    $('exportResult').hidden=true;$('exportProgress').hidden=true;$('safetyCheck').checked=false;
    scheduleSave();renderAll();
  }
  function bindUI(){
    $('mediaInput').addEventListener('change',async e=>{await importMedia(e.target.files);e.target.value='';});
    $('musicInput').addEventListener('change',async e=>{await importMusic(e.target.files[0]);e.target.value='';});
    $('autoCut').addEventListener('click',autoCut);
    for(const [id,key] of [['template','template'],['targetLength','target'],['vehicle','vehicle'],['product','product'],['summary','summary']]){
      $(id).addEventListener('change',e=>modify(()=>{project[key]=key==='target'?Number(e.target.value):e.target.value;}));
    }
    $('endCard').addEventListener('change',e=>modify(()=>{project.endCard=e.target.checked;}));
    $('clipCaption').addEventListener('change',e=>updateClip('caption',e.target.value));
    $('clipRole').addEventListener('change',e=>updateClip('role',e.target.value));
    $('clipDuration').addEventListener('change',e=>updateClip('duration',e.target.value));
    $('clipTrim').addEventListener('change',e=>updateClip('trimStart',e.target.value));
    $('clipZoom').addEventListener('change',e=>updateClip('zoom',Number(e.target.value)));
    $('clipPanX').addEventListener('change',e=>updateClip('panX',Number(e.target.value)));
    $('clipPanY').addEventListener('change',e=>updateClip('panY',Number(e.target.value)));
    $('clipAnimate').addEventListener('change',e=>updateClip('animate',e.target.checked));
    $('removeClip').addEventListener('click',()=>{if(selected<0)return;modify(()=>{project.clips.splice(selected,1)});});
    $('moveLeft').addEventListener('click',()=>{if(selected<=0)return;const s=selected;modify(()=>{[project.clips[s-1],project.clips[s]]=[project.clips[s],project.clips[s-1]];},{select:s-1});});
    $('moveRight').addEventListener('click',()=>{if(selected>=project.clips.length-1)return;const s=selected;modify(()=>{[project.clips[s+1],project.clips[s]]=[project.clips[s],project.clips[s+1]];},{select:s+1});});
    $('undo').addEventListener('click',undo);$('redo').addEventListener('click',redo);
    $('play').addEventListener('click',playPreview);
    $('skipBack').addEventListener('click',()=>seek(0));
    $('skipForward').addEventListener('click',()=>seek(totalDuration()));
    $('scrubber').addEventListener('input',e=>seek(Number(e.target.value)));
    $('musicVolume').addEventListener('change',e=>modify(()=>{project.musicVolume=Number(e.target.value);}));
    $('removeMusic').addEventListener('click',()=>modify(()=>{project.musicId=null;}));
    $('export').addEventListener('click',()=>void exportVideo());
    $('cancelExport').addEventListener('click',cancelExport);
    $('share').addEventListener('click',()=>void shareVideo());
    $('newProject').addEventListener('click',()=>void newProject());
    document.addEventListener('visibilitychange',()=>{if(document.hidden){if(busy){cancelExport();notify('画面が非表示になったため、書き出しを中止しました。');}else if(playing)stopPlayback();}});
    window.addEventListener('pagehide',()=>{for(const id of urls.keys())releaseAsset(id);if(lastRenderURL)URL.revokeObjectURL(lastRenderURL);});
  }
  bindUI();void restore();
})();