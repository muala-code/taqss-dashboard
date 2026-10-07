/* Taqss Mushaf v0.23.6 — surah-bounded screen segments + selectable reader font, official KFGQPC Hafs v3.0.
   Verse text is copied unchanged from the official source. Visual chunks never change it. */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const STORAGE_KEY = 'taqss.mushaf.v0214.settings';
  const PLACE_KEY = 'taqss.mushaf.v0214.place';
  const state = {
    rows: [], names: [], surahs: new Map(), mode: 'read', showFrame: true, audioLoading: false,
    cursor: {surah: 1, ayah: 1, token: 0}, selected: null, history: [],
    nextCursor: null, lastSave: null, ready: false, layoutScheduled: false,
    modalOpen: false, touch: null, rendering: false, fontSize: 'medium', font: 'majma', audioAyah: 1, audioSurah: 1, audioToken: 0, reciter: "husary", repeat: 0, repeatPlayed: 0, audioKind: "verse", audioTrack: null, lastGood: null, audioFallbacks: new Set(), audioFailures: 0, audioSelectionPending: false, continuousBuilt: false, pendingScroll: false, scrollTimer: null, programmaticScrollUntil: 0
  };
  const clone = v => ({surah: v.surah, ayah: v.ayah, token: v.token || 0});
  const eq = (a,b) => !!a && !!b && a.surah===b.surah && a.ayah===b.ayah && (a.token||0)===(b.token||0);
  const fmt = number => Number(number).toLocaleString('ar-SA');
  function setStatus(message) {const el=$('#mushafLoadStatus'); el.textContent=message; el.hidden=!message;}
  function saved(key, fallback){try{return JSON.parse(localStorage.getItem(key)) ?? fallback;}catch{return fallback;}}
  function saveSettings(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify({mode:state.mode,showFrame:state.showFrame,fontSize:state.fontSize,font:state.font,surah:state.cursor.surah,ayah:state.cursor.ayah,token:state.cursor.token||0,reciter:state.reciter,repeat:state.repeat}));}catch{}}
  function verseAt(c){return state.surahs.get(c.surah)?.[c.ayah-1] || null;}
  function validCursor(c){
    const s=Number(c?.surah), a=Number(c?.ayah), token=Number(c?.token||0);
    if(!Number.isInteger(s)||!Number.isInteger(a)||!Number.isInteger(token)||token<0)return null;
    const verse=state.surahs.get(s)?.[a-1];
    if(!verse || token>=words(verse).length)return null;
    return {surah:s,ayah:a,token};
  }
  function prepare(data){
    if(!Array.isArray(data)||data.length!==6236)throw Error('بيانات النص الرسمي ليست مكتملة.');
    const seen=new Set(),names=new Map();
    for(const x of data){
      if(!Number.isInteger(x.sura_no)||x.sura_no<1||x.sura_no>114||!Number.isInteger(x.aya_no)||x.aya_no<1||
         !Number.isInteger(x.page)||x.page<1||x.page>604||!Number.isInteger(x.jozz)||x.jozz<1||x.jozz>30||
         typeof x.aya_text_unicode!=='string'||!x.aya_text_unicode.trim()||typeof x.sura_name_ar!=='string'||!x.sura_name_ar.trim())
        throw Error('توجد حقول غير صالحة في بيانات المصحف.');
      const key=`${x.sura_no}:${x.aya_no}`;
      if(seen.has(key))throw Error('ترقيم آية مكرر في بيانات المصدر.');
      seen.add(key);
      if(names.has(x.sura_no)&&names.get(x.sura_no)!==x.sura_name_ar)throw Error('اسم سورة غير متسق في البيانات.');
      names.set(x.sura_no,x.sura_name_ar);
      if(!state.surahs.has(x.sura_no))state.surahs.set(x.sura_no,[]);
      state.surahs.get(x.sura_no).push({surah:x.sura_no,ayah:x.aya_no,text:x.aya_text_unicode,page:x.page,juz:x.jozz,words:null});
    }
    if(names.size!==114)throw Error('عدد السور غير مكتمل.');
    for(let s=1;s<=114;s++){
      const group=state.surahs.get(s);
      group?.sort((a,b)=>a.ayah-b.ayah);
      if(!group?.length||group.some((verse,i)=>verse.ayah!==i+1))throw Error(`تسلسل غير مكتمل للسورة ${s}.`);
    }
    state.names=Array.from({length:114},(_,i)=>names.get(i+1));
  }
  function words(verse){
    if(verse.words)return verse.words;
    // The official source stores the verse-end symbol as a separate whitespace token.
    // Pagination MUST treat the last word and its verse number as ONE atomic unit.
    // Joining tokens does not alter the underlying official verse string.
    const tokens=verse.text.match(/\S+\s*/gu)||[verse.text];
    if(tokens.length>=2 && /^۝[٠-٩]+\s*$/u.test(tokens[tokens.length-1])){
      tokens.splice(tokens.length-2,2,tokens[tokens.length-2]+tokens[tokens.length-1]);
    }
    return verse.words=tokens;
  }
  function nextVerse(c){
    const group=state.surahs.get(c.surah);
    if(c.ayah<group.length)return {surah:c.surah,ayah:c.ayah+1,token:0};
    return c.surah<114?{surah:c.surah+1,ayah:1,token:0}:null;
  }
  function prevVerse(c){
    if(c.ayah>1)return {surah:c.surah,ayah:c.ayah-1,token:0};
    if(c.surah===1)return null;
    return {surah:c.surah-1,ayah:state.surahs.get(c.surah-1).length,token:0};
  }
  function options(){
    const select=$('#mushafSurah');
    for(let s=1;s<=114;s++){
      const option=document.createElement('option');option.value=String(s);option.textContent=`${s}. ${state.names[s-1]}`;select.add(option);
    }
    refreshAyahOptions(1,1);
  }
  function refreshAyahOptions(surah,ayah=1){
    const select=$('#mushafAyah');select.replaceChildren();
    const verses=state.surahs.get(Number(surah))||[];
    for(let a=1;a<=verses.length;a++){
      const option=document.createElement('option');option.value=String(a);option.textContent=String(a);select.add(option);
    }
    select.value=String(Math.min(Math.max(1,ayah),verses.length||1));
  }
  function chooseVerse(verse){
    state.selected={surah:verse.surah,ayah:verse.ayah,token:0};
    if(state.mode==='listen')state.audioSelectionPending=true;
    document.querySelectorAll('#mushafVerses .mushaf-verse.is-selected').forEach(el=>el.classList.remove('is-selected'));
    const selected=$(`#mushafVerses .mushaf-verse[data-verse="${verse.surah}:${verse.ayah}"]`);
    selected?.classList.add('is-selected');
    $('#mushafPosition').textContent=`سورة ${state.names[verse.surah-1]} · الآية ${fmt(verse.ayah)}`;
  }
  function appendVerse(container,verse,content){
    const el=document.createElement('span');el.className='mushaf-verse';
    if(verse.surah===1&&verse.ayah===1)el.classList.add('mushaf-fatiha-basmala');
    el.dataset.verse=`${verse.surah}:${verse.ayah}`;
    el.textContent=content;
    el.tabIndex=0;el.setAttribute('role','button');
    el.setAttribute('aria-label',`سورة ${state.names[verse.surah-1]}، الآية ${fmt(verse.ayah)}، اختيار موضع الحفظ`);
    el.addEventListener('click',()=>chooseVerse(verse));
    el.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();chooseVerse(verse);}});
    if(state.mode==='listen' && verse.surah===state.audioSurah && verse.ayah===state.audioAyah)el.classList.add('is-playing');
    container.append(el);
    return el;
  }
  function fits(root){return root.scrollHeight<=root.clientHeight+2;}
  function addOpening(root,verse){
    if(verse.ayah!==1)return;
    if(verse.surah!==1&&verse.surah!==9){
      const basmala=document.createElement('div');basmala.className='mushaf-basmala';
      // The source basmala is kept unchanged in the dataset; the standalone heading omits its number visually.
      basmala.textContent=state.surahs.get(1)[0].text.replace(/\s*۝[٠-٩]+\s*$/u,'');
      root.append(basmala);
    }
  }
  function sliceForDisplay(verse,tokens,from,to){
    const text=tokens.slice(from,to).join('');
    // Preserve the user's previously approved centered, unnumbered Fatiha basmala presentation.
    return verse.surah===1&&verse.ayah===1?text.replace(/\s*۝[٠-٩]+\s*$/u,''):text;
  }
  function writeSlice(node,verse,tokens,from,to){
    node.dataset.from=String(from);node.dataset.to=String(to);
    node.replaceChildren();
    for(let i=from;i<to;i++){
      const word=document.createElement('span');word.className='mushaf-word';word.dataset.word=String(i);
      word.textContent=sliceForDisplay(verse,tokens,i,i+1);
      if(/۝/u.test(word.textContent))word.classList.add('mushaf-verse-ending');
      node.append(word);
    }
  }
  // Identical measured layout is used forwards and backwards; backwards never
  // jumps to the preceding verse alone, which orphaned short-surah endings.
  function layoutSegment(root, start) {
    root.style.paddingTop='';root.classList.remove('mushaf-short-surah');root.replaceChildren();
    let cursor=clone(start),steps=0,textWritten=false;
    while(cursor&&steps++<900){
      const verse=verseAt(cursor);if(!verse)break;
      const tokens=words(verse);
      const atSurahStart=cursor.ayah===1&&cursor.token===0;
      // A screen is never shared by two surahs. This keeps the header's surah
      // identity unambiguous and avoids a crowded transition at the bottom.
      if(textWritten && atSurahStart) break;
      let openingNodes=[];
      if(atSurahStart){
        const before=[...root.children];
        addSurahOpening(root,verse.surah);
        openingNodes=[...root.children].filter(node=>!before.includes(node));
        if(!fits(root)){
          openingNodes.forEach(node=>node.remove());
          // If the previous surah already occupies this screen, start the new
          // surah on the next swipe instead of squeezing in an orphan basmala.
          if(textWritten)break;
          // On a very short screen keep the basmala when applicable and let the
          // measurement below place at least the first token when possible.
          addSurahOpening(root,verse.surah);
        }
      }
      let node=appendVerse(root,verse,'');
      const remaining=tokens.length-cursor.token;
      writeSlice(node,verse,tokens,cursor.token,tokens.length);
      if(!fits(root)){
        if(textWritten && cursor.token===0){
          const probe=root.cloneNode(false);probe.removeAttribute('id');probe.setAttribute('aria-hidden','true');
          probe.style.cssText='position:absolute!important;visibility:hidden!important;pointer-events:none!important;flex:none!important;';
          probe.style.width=root.getBoundingClientRect().width+'px';probe.style.height=root.getBoundingClientRect().height+'px';
          root.parentElement.append(probe);
          const single=appendVerse(probe,verse,'');writeSlice(single,verse,tokens,0,tokens.length);
          const fitsAlone=fits(probe);probe.remove();
          if(fitsAlone){node.remove();break;}
        }
        let low=0,high=remaining;
        while(low<high){
          const mid=Math.ceil((low+high)/2);
          writeSlice(node,verse,tokens,cursor.token,cursor.token+mid);
          if(fits(root))low=mid;else high=mid-1;
        }
        if(!low){
          node.remove();
          // If this is a new surah reached after text from the previous one,
          // remove its basmala too so the whole opening moves together.
          if(textWritten&&atSurahStart){
            openingNodes.forEach(el=>el.remove());
          }else if(!textWritten){
            node=appendVerse(root,verse,'');
            writeSlice(node,verse,tokens,cursor.token,cursor.token+1);
            cursor={...cursor,token:cursor.token+1};
            if(cursor.token>=tokens.length)cursor=nextVerse(cursor);
            textWritten=true;
          }
          break;
        }
        writeSlice(node,verse,tokens,cursor.token,cursor.token+low);
        textWritten=true;
        if(low<remaining){cursor={...cursor,token:cursor.token+low};break;}
      }
      textWritten=true;
      cursor=nextVerse(cursor);
    }
    // Center a genuinely short complete surah; the following surah starts on the next swipe.
    const complete=cursor===null||cursor.surah!==start.surah;
    if(complete&&start.ayah===1&&start.token===0&&root.scrollHeight<root.clientHeight*.74){
      root.classList.add('mushaf-short-surah');
      const available=root.clientHeight-root.scrollHeight;
      if(available>0)root.style.paddingTop=`${Math.floor(available*.42)+5}px`;
    }
    return cursor;
  }
  function compareCursor(a,b){
    if(!a)return 1;if(!b)return -1;
    return a.surah-b.surah||a.ayah-b.ayah||a.token-b.token;
  }
  let measurementRoot=null;
  function getMeasurementRoot(visible){
    if(!measurementRoot){
      measurementRoot=document.createElement('div');measurementRoot.className='mushaf-verses';
      measurementRoot.setAttribute('aria-hidden','true');
      measurementRoot.style.cssText='position:absolute!important;visibility:hidden!important;pointer-events:none!important;overflow:hidden!important;flex:none!important;';
      $('#mushafReading').append(measurementRoot);
    }
    const bounds=visible.getBoundingClientRect();
    measurementRoot.style.width=`${bounds.width}px`;
    measurementRoot.style.height=`${bounds.height}px`;
    return measurementRoot;
  }
  function priorScreen(current){
    // Reproduce forward screen boundaries from the relevant surah's beginning.
    // This is only needed after a direct jump or at the start of another surah;
    // normal swiping continues to use the fast exact history stack.
    const surah=current.ayah===1&&current.token===0?current.surah-1:current.surah;
    if(surah<1)return null;
    const root=getMeasurementRoot($('#mushafVerses'));
    let cursor={surah,ayah:1,token:0},previous=null;
    for(let steps=0;steps<800;steps++){
      if(compareCursor(cursor,current)>=0||cursor.surah!==surah)break;
      const next=layoutSegment(root,cursor);
      if(!next||compareCursor(next,cursor)<=0)break;
      previous=clone(cursor);
      if(compareCursor(next,current)>=0)break;
      cursor=clone(next);
    }
    return previous;
  }
  function addSurahOpening(root, surah){
    if(surah!==1&&surah!==9){
      const basmala=document.createElement('div');basmala.className='mushaf-basmala';
      basmala.dataset.surah=String(surah);
      basmala.textContent=state.surahs.get(1)[0].text.replace(/\s*۝[٠-٩]+\s*$/u,'');root.append(basmala);
    }
  }
  function buildContinuous(root){
    root.replaceChildren();
    for(let surah=1;surah<=114;surah++){
      addSurahOpening(root,surah);
      for(const verse of state.surahs.get(surah)||[]){
        const node=appendVerse(root,verse,'');
        writeSlice(node,verse,words(verse),0,words(verse).length);
      }
    }
    state.continuousBuilt=true;
  }
  function verseNode(c){return c?$(`#mushafVerses .mushaf-verse[data-verse="${c.surah}:${c.ayah}"]`):null;}
  function firstVisibleCursor(){
    const root=$('#mushafVerses');if(!root)return null;
    const box=root.getBoundingClientRect();
    for(const el of root.querySelectorAll('.mushaf-verse')){
      const r=el.getBoundingClientRect();
      if(r.bottom>box.top+8&&r.top<box.bottom-8){const [surah,ayah]=el.dataset.verse.split(':').map(Number);return {surah,ayah,token:0};}
    }
    return null;
  }
  function scrollCursorIntoView(c, behavior='auto', block='start'){
    const root=$('#mushafVerses'),node=verseNode(c);if(!root||!node)return;
    state.programmaticScrollUntil=Date.now()+450;
    node.scrollIntoView({behavior,block,inline:'nearest'});
  }
  function rememberVisiblePosition(){
    if(Date.now()<state.programmaticScrollUntil)return;
    const c=firstVisibleCursor();if(!c)return;
    state.cursor=c;saveSettings();
  }
  function updatePageInfo(cursor){
    const info=$('#mushafPageInfo'),juz=$('#mushafHeaderJuz'),surah=$('#mushafHeaderSurah');
    const verse=verseAt(cursor);
    if(!verse){if(info)info.textContent='';if(juz)juz.textContent='الجزء —';if(surah)surah.textContent='سورة —';return;}
    const surahName=`سورة ${state.names[verse.surah-1]}`;
    if(info)info.textContent=`الجزء ${fmt(verse.juz)} · ${surahName}`;
    if(juz)juz.textContent=`الجزء ${fmt(verse.juz)}`;
    if(surah)surah.textContent=surahName;
  }
  function render(){
    if(!state.ready||state.rendering)return;
    const panel=$('#panel-mushaf'),root=$('#mushafVerses');
    if(panel.hidden||root.clientHeight<80||root.clientWidth<120)return;
    state.rendering=true;
    try{
      const start=validCursor(state.cursor)||{surah:1,ayah:1,token:0};
      state.cursor=start;
      // Auto sizing depends only on viewport geometry, so page history remains reproducible.
      if(state.fontSize==='auto'){
        const area=root.clientWidth*root.clientHeight;
        panel.style.setProperty('--mushaf-size-factor',String(Math.max(.92,Math.min(1.08,Math.sqrt(area/260000)))));
      }else panel.style.removeProperty('--mushaf-size-factor');
      state.nextCursor=layoutSegment(root,start);
      $('#mushafReadingTitle').textContent='';
      root.setAttribute('aria-label','مقطع من المصحف؛ اسحب يمينًا للتقدم ويسارًا للرجوع');
      updatePageInfo(start);
      syncAudioHighlight();saveSettings();
    }finally{state.rendering=false;}
  }
  function scheduleRender(){
    if(state.layoutScheduled)return;state.layoutScheduled=true;
    requestAnimationFrame(()=>{state.layoutScheduled=false;render();});
  }
  function move(direction){
    if(!state.ready||state.modalOpen)return;
    if(direction==='next'){
      const next=validCursor(state.nextCursor);if(!next)return;
      state.history.push(clone(state.cursor));
      if(state.history.length>300)state.history.shift();
      state.cursor=next;
    }else{
      const prev=state.history.length?state.history.pop():priorScreen(state.cursor);
      if(!prev)return;
      state.cursor=prev;
    }
    state.selected=null;
    render();
  }
  function goTo(surah,ayah,token=0){
    const cursor=validCursor({surah,ayah,token});
    if(!cursor){setStatus('الآية المختارة غير متاحة.');return;}
    state.cursor=cursor;state.history=[];state.pendingScroll=true;
    state.audioSurah=cursor.surah;state.audioAyah=cursor.ayah;
    syncAudioUI();setStatus('');render();
  }
  // Native selects retain the data model; visible buttons avoid device pickers.
  const pickers=[];
  function setupMushafPickers(){
    document.querySelectorAll('#panel-mushaf select').forEach(select=>{
      const wrap=document.createElement('div');wrap.className='mushaf-picker';
      select.before(wrap);wrap.append(select);select.hidden=true;
      const button=document.createElement('button');button.type='button';button.className='mushaf-picker-button';
      button.id=select.id+'Button';
      document.querySelectorAll('label[for="'+select.id+'"]').forEach(label=>label.htmlFor=button.id);
      button.setAttribute('aria-label',select.getAttribute('aria-label')||'اختيار');
      button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');
      const menu=document.createElement('div');menu.id=select.id+'Menu';menu.className='mushaf-picker-menu';
      menu.setAttribute('role','listbox');menu.setAttribute('aria-label',button.getAttribute('aria-label'));menu.hidden=true;
      button.setAttribute('aria-controls',menu.id);wrap.append(button,menu);
      const close=()=>{menu.hidden=true;button.setAttribute('aria-expanded','false');};
      const sync=()=>{button.disabled=select.disabled;button.textContent=(select.selectedOptions[0]?.textContent||'—')+' ▾';};
      const open=()=>{
        if(select.disabled)return;
        pickers.forEach(p=>p.close());menu.replaceChildren();
        Array.from(select.options).forEach(option=>{
          const item=document.createElement('button');item.type='button';item.textContent=option.textContent;
          item.setAttribute('role','option');item.setAttribute('aria-selected',String(option.selected));item.disabled=option.disabled;
          item.addEventListener('click',()=>{select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));sync();close();button.focus();});menu.append(item);
        });
        menu.hidden=false;button.setAttribute('aria-expanded','true');
        (menu.querySelector('[aria-selected="true"]')||menu.firstElementChild)?.focus();
      };
      button.addEventListener('click',()=>menu.hidden?open():close());
      wrap.addEventListener('keydown',event=>{
        if(event.key==='Escape'&&!menu.hidden){event.preventDefault();event.stopPropagation();close();button.focus();}
        if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
          event.preventDefault();event.stopPropagation();
          if(menu.hidden){open();return;}
          const items=Array.from(menu.querySelectorAll('button:not([disabled])'));let at=items.indexOf(document.activeElement);
          at=event.key==='Home'?0:event.key==='End'?items.length-1:(at+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;
          items[at]?.focus();
        }
      });
      document.addEventListener('click',event=>{if(!wrap.contains(event.target))close();});
      select.addEventListener('change',sync);new MutationObserver(sync).observe(select,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled']});
      pickers.push({sync,close});sync();
    });
  }
  function syncPickers(){pickers.forEach(p=>{p.close();p.sync();});}
  function openIndex(){
    const overlay=$('#mushafIndexOverlay');if(!state.ready)return;
    const focusFrom=document.activeElement;state.returnFocus=focusFrom;
    $('#mushafSurah').value=String(state.cursor.surah);
    refreshAyahOptions(state.cursor.surah,state.cursor.ayah);
    $('#mushafFontChoice').value=state.font;
    syncPickers();
    $('#mushafActionStatus').hidden=true;
    overlay.hidden=false;state.modalOpen=true;
    $('#mushafIndexButton').setAttribute('aria-expanded','true');
    $('#mushafIndexDialog').focus();
  }
  function closeIndex(){
    syncPickers();
    $('#mushafIndexOverlay').hidden=true;state.modalOpen=false;
    $('#mushafIndexButton').setAttribute('aria-expanded','false');
    (state.returnFocus||$('#mushafIndexButton')).focus();
  }
  function setMode(mode){
    const nextMode=mode==='listen'?'listen':'read';
    if(state.mode===nextMode&&state.modeInitialized)return;
    state.modeInitialized=true;state.mode=nextMode;
    const listen=state.mode==='listen';
    $('#mushafReadButton').setAttribute('aria-pressed',String(!listen));
    $('#mushafListenButton').setAttribute('aria-pressed',String(listen));
    $('#mushafListening').hidden=!listen;
    $('#mushafReading').classList.toggle('mushaf-listening-mode',listen);
    $('#mushafReading').classList.toggle('mushaf-text-mode',listen);
    $('#mushafReading').classList.toggle('mushaf-page-mode',!listen);
    if(!listen)stopAudio();
    else {state.audioSurah=state.cursor.surah;state.audioAyah=state.cursor.ayah;}
    syncAudioUI();saveSettings();scheduleRender();
  }
  // EveryAyah: individual verse files. MP3Quran: surah recordings only when
  // that exact read+surah has official timing rows. No inferred timestamps.
  const RECITERS = [
    {wordTimed:true,id:'husary',name:'محمود خليل الحصري',folder:'Husary_64kbps'},
    {wordTimed:true,id:'basit',name:'عبدالباسط عبدالصمد (مرتل)',folder:'Abdul_Basit_Murattal_64kbps'},
    {wordTimed:true,id:'minshawi',name:'محمد صديق المنشاوي (مرتل)',folder:'Minshawy_Murattal_128kbps'},
    {wordTimed:true,id:'sudais',name:'عبدالرحمن السديس',folder:'Abdurrahmaan_As-Sudais_192kbps'},
    {id:'ayyub',name:'محمد أيوب',folder:'Muhammad_Ayyoub_128kbps'},
    {id:'maher',name:'ماهر المعيقلي',folder:'Maher_AlMuaiqly_64kbps'},
    {id:'ali',name:'علي جابر',timed:true,readId:76},
    {id:'hudhaify',name:'علي الحذيفي',folder:'Hudhaify_128kbps'},
    {id:'akhdar',name:'إبراهيم الأخضر',folder:'Ibrahim_Akhdar_64kbps'},
    {id:'khayyat',name:'عبدالله خياط',timed:true,readId:61},
    {id:'juhany',name:'عبدالله الجهني',folder:'Abdullaah_3awwaad_Al-Juhaynee_128kbps'},
    {id:'ghamdi',name:'سعد الغامدي',folder:'Ghamadi_40kbps'},
    {id:'ajmi',name:'أحمد العجمي',folder:'ahmed_ibn_ali_al_ajamy_128kbps'}
  ];
  const byId=id=>RECITERS.find(r=>r.id===id)||RECITERS[0];
  const verseURL=(r,s,a)=>`https://everyayah.com/data/${r.folder}/${String(s).padStart(3,'0')}${String(a).padStart(3,'0')}.mp3`;
  const clock=seconds=>Number.isFinite(seconds)?`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`:'--:--';
  const audio=()=>$('#mushafAudio');
  const timingCache=new Map(), preloaded=new Map();
  let timedCatalogPromise=null;
  async function getTimedCatalog(){
    if(!timedCatalogPromise)timedCatalogPromise=fetch('https://mp3quran.net/api/v3/ayat_timing/reads')
      .then(r=>{if(!r.ok)throw Error('timed reads unavailable');return r.json();})
      .then(reads=>({reads:Array.isArray(reads)?reads:reads.reads||[]})).catch(()=>{timedCatalogPromise=null;return {reads:[]};});
    return timedCatalogPromise;
  }
  async function timedTrack(reciter,surah){
    const key=`${reciter.id}:${surah}`;
    if(timingCache.has(key))return timingCache.get(key);
    const task=(async()=>{
      const data=await getTimedCatalog();
      const match=data.reads.find(r=>Number(r.id)===reciter.readId&&/حفص/.test(r.rewaya||''));
      if(!match)return null;
      const server=match.folder_url;
      if(!server?.startsWith('https://')&&!server?.startsWith('http://'))return null;
      const rows=await fetch(`https://mp3quran.net/api/v3/ayat_timing?surah=${surah}&read=${match.id}`)
        .then(r=>{if(!r.ok)throw Error('timings unavailable');return r.json();});
      const count=state.surahs.get(surah)?.length||0;
      if(!Array.isArray(rows)||!count)return null;
      const times=rows.filter(t=>t.ayah>0&&Number.isFinite(Number(t.start_time))&&Number.isFinite(Number(t.end_time)))
        .sort((a,b)=>a.ayah-b.ayah);
      if(times.length!==count||times.some((t,i)=>Number(t.ayah)!==i+1||Number(t.start_time)<0||Number(t.end_time)<=Number(t.start_time)||(i>0&&Number(t.start_time)<Number(times[i-1].end_time))))return null;
      return {type:'timed',url:`${server.replace(/\/$/,'')}/${String(surah).padStart(3,'0')}.mp3`,
        times:times.map(t=>({start:Number(t.start_time)/1000,end:Number(t.end_time)/1000}))};
    })().catch(()=>null);
    timingCache.set(key,task);
    task.then(track=>{if(!track)timingCache.delete(key);});return task;
  }
  // Non-blocking transient notice. A terminal failure stays visible, but
  // successful reader fallback disappears after three seconds.
  let audioNoticeTimer=null;
  function audioNotice(message){
    const label=$('#mushafAudioMessage');
    if(audioNoticeTimer!==null){clearTimeout(audioNoticeTimer);audioNoticeTimer=null;}
    const terminal=/تعذرت التلاوة بجميع/.test(message);
    const important=terminal||/تعذر|تعذرت|الانتقال|اكتملت/.test(message);
    label.textContent=important?message:'';label.hidden=!important;
    if(important&&!terminal){
      audioNoticeTimer=setTimeout(()=>{label.textContent='';label.hidden=true;audioNoticeTimer=null;},3000);
    }
  }
  const repeatChoices=[0,2,3,5];
  function repeatUI(){
    const repeat=$('#mushafRepeatAyah'), n=state.repeat;
    repeat.textContent=n?`↻${n}`:'↻';
    repeat.setAttribute('aria-pressed',String(n>0));
    repeat.setAttribute('aria-label',n?`تكرار الآية ${n} مرات؛ اضغط لتغيير العدد`:'تفعيل تكرار الآية مرتين');
    repeat.title=n?`تكرار الآية ×${n}؛ اضغط لاختيار عدد آخر`:'تكرار الآية متوقف؛ اضغط للتفعيل مرتين';
  }
  const wordTimingCache=new Map();
  let currentWordTimings=null,wordTimingToken=0;
  async function loadWordTimings(r,surah,ayah){
    const token=++wordTimingToken;currentWordTimings=null;
    $('#mushafVerses').classList.remove('has-word-timing');
    if(!r.wordTimed)return;
    const cacheKey=r.folder+':'+surah;
    if(!wordTimingCache.has(cacheKey))wordTimingCache.set(cacheKey,fetch(`mushaf-timings/${r.folder}/${surah}.json`).then(r=>r.ok?r.json():null).catch(()=>null));
    const rows=await wordTimingCache.get(cacheKey);if(token!==wordTimingToken)return;
    const row=rows?.[String(ayah)],count=words(verseAt({surah,ayah})).length;
    if(!Array.isArray(row)||!row.length||row.some(x=>x.length!==4||!x.every(Number.isFinite)||x[0]<0||x[1]>count||x[1]<=x[0]||x[3]<=x[2]))return;
    if(Math.max(...row.map(x=>x[1]))!==count)return;
    currentWordTimings=row;$('#mushafVerses').classList.add('has-word-timing');followAudioWords();
  }
  function followAudioWords(){
    const root=$('#mushafVerses');root.querySelectorAll('.is-speaking').forEach(n=>n.classList.remove('is-speaking'));
    if(state.mode!=='listen'||!currentWordTimings||state.audioKind!=='verse')return;
    const ms=audio().currentTime*1000,segment=currentWordTimings.find(x=>ms>=x[2]&&ms<x[3]);if(!segment)return;
    const [from,to]=segment,verseKey=`${state.audioSurah}:${state.audioAyah}`;
    let node=root.querySelector(`.mushaf-verse[data-verse="${verseKey}"]`);
    if(!node||from<Number(node.dataset.from)||from>=Number(node.dataset.to)){
      state.history.push(clone(state.cursor));if(state.history.length>300)state.history.shift();
      state.cursor={surah:state.audioSurah,ayah:state.audioAyah,token:from};render();
      node=root.querySelector(`.mushaf-verse[data-verse="${verseKey}"]`);
    }
    node?.querySelectorAll('.mushaf-word').forEach(w=>w.classList.toggle('is-speaking',Number(w.dataset.word)>=from&&Number(w.dataset.word)<to));
  }
  function syncAudioHighlight(){
    document.querySelectorAll('#mushafVerses .mushaf-verse').forEach(node=>{
      node.classList.toggle('is-playing',state.mode==='listen'&&state.audioKind!=='basmala'&&node.dataset.verse===`${state.audioSurah}:${state.audioAyah}`);
    });
    document.querySelectorAll('#mushafVerses .mushaf-basmala').forEach(node=>node.classList.toggle('is-playing',state.mode==='listen'&&state.audioKind==='basmala'));
  }
  function syncAudioUI(){
    const playing=!audio().paused;
    $('#mushafReciter').disabled=playing||state.audioLoading;
    const picker=$('#mushafReciterButton');
    if(picker)picker.disabled=playing||state.audioLoading;
    const count=state.surahs.get(state.audioSurah)?.length||0;
    $('#mushafAudioPrev').disabled=!state.ready||(state.audioSurah===1&&state.audioAyah===1);
    $('#mushafAudioNext').disabled=!state.ready||(state.audioSurah===114&&state.audioAyah===count);
    $('#mushafAudioPlay').disabled=!state.ready;
    $('#mushafAudioPlay').setAttribute('aria-pressed',String(playing));
    $('#mushafAudioPlay').textContent=playing?'❚❚':'▶';
    $('#mushafAudioPlay').setAttribute('aria-label',playing?'إيقاف التلاوة':'تشغيل التلاوة');
    $('#mushafAudioPlay').title=playing?'إيقاف مؤقت':'تشغيل';
    repeatUI();
    syncAudioHighlight();
  }
  function stopAudio(){
    ++wordTimingToken;currentWordTimings=null;$('#mushafVerses').classList.remove('has-word-timing');
    $('#mushafVerses').querySelectorAll('.is-speaking').forEach(n=>n.classList.remove('is-speaking'));
    ++state.audioToken;state.audioLoading=false;const a=audio();a.pause();a.removeAttribute('src');a.load();
    state.audioTrack=null;state.audioFailures=0;state.audioFallbacks.clear();state.repeatPlayed=0;syncAudioUI();
  }
  function showAudioVerse(surah,ayah){
    state.audioSurah=surah;state.audioAyah=ayah;
    let node=$(`#mushafVerses .mushaf-verse[data-verse="${surah}:${ayah}"]`);
    if(!node){
      state.history.push(clone(state.cursor));
      if(state.history.length>300)state.history.shift();
      state.cursor={surah,ayah,token:0};
      render();
      node=$(`#mushafVerses .mushaf-verse[data-verse="${surah}:${ayah}"]`);
    }
    saveSettings();syncAudioUI();
    if('mediaSession' in navigator){
      try{navigator.mediaSession.metadata=new MediaMetadata({title:`سورة ${state.names[surah-1]} · الآية ${ayah}`,artist:byId(state.reciter).name,album:'القرآن الكريم'});}catch{}
    }
  }
  function nextAudioVerse(surah,ayah){return nextVerse({surah,ayah,token:0});}
  // For <= 2 physical Medina pages, request every verse proactively, at most
  // 4 simultaneous media loads. For longer surahs, only the next 2 verses.
  function preloadVerses(r,s,from){
    if(!r.folder||state.mode!=='listen')return;
    const group=state.surahs.get(s);if(!group)return;
    const short=group[group.length-1].page-group[0].page<=1;
    const last=short?group.length:Math.min(group.length,from+2);
    const wanted=[];
    for(let i=short?1:from+1;i<=last;i++){
      const url=verseURL(r,s,i);
      if(!preloaded.has(url)){wanted.push(url);preloaded.set(url,null);}
    }
    // Per-session bounded cache. The browser decides how much audio to buffer.
    for(const url of wanted){
      const node=new Audio();node.preload='auto';node.src=url;
      preloaded.set(url,node);
    }
    while(preloaded.size>100){const old=preloaded.keys().next().value;preloaded.get(old)?.removeAttribute('src');preloaded.delete(old);}
  }
  function fallbackOrder(){
    // Favor the selected voice; prioritize the known successful Husary stream
    // if a selected source is missing. Each candidate attempted at most once.
    return [state.reciter,'husary','ayyub','minshawi','basit','sudais','maher'].filter((r,i,a)=>a.indexOf(r)===i);
  }
  async function failAndFallback(surah,ayah,token){
    if(token!==state.audioToken||state.mode!=='listen')return;
    const alternative=fallbackOrder().find(id=>!state.audioFallbacks.has(id));
    if(!alternative){audioNotice('تعذرت التلاوة بجميع القراء المتاحين. جرّب لاحقًا أو تابع القراءة.');syncAudioUI();return;}
    state.reciter=alternative;$('#mushafReciter').value=alternative;saveSettings();
    audioNotice(`تعذر الصوت؛ محاولة الاستمرار مع ${byId(alternative).name} من الآية نفسها…`);
    await playVerse(surah,ayah,true);
  }
  async function playVerse(surah,ayah,isFallback=false,preserveRepeat=false,skipBasmala=false){
    state.audioSelectionPending=false;
    if(state.mode!=='listen'||!state.ready||!state.surahs.get(surah)?.[ayah-1])return;
    const token=++state.audioToken;state.audioLoading=true;
    if(!preserveRepeat)state.repeatPlayed=0;
    ++wordTimingToken;currentWordTimings=null;$('#mushafVerses').classList.remove('has-word-timing');
    $('#mushafVerses').querySelectorAll('.is-speaking').forEach(n=>n.classList.remove('is-speaking'));
    const a=audio();a.pause();state.audioTrack=null;showAudioVerse(surah,ayah);
    const r=byId(state.reciter);state.audioFallbacks.add(r.id);
    if(!isFallback)state.audioFallbacks=new Set([r.id]);
    audioNotice(`جارٍ تجهيز صوت ${r.name}…`);
    try{
      if(r.folder){
        // EveryAyah's numbered ayah streams are kept intact. The separate
        // Fatiha basmala has its own media clock, so word timings stay unchanged.
        const intro=ayah===1&&surah!==1&&surah!==9&&!preserveRepeat&&!skipBasmala;
        state.audioKind=intro?'basmala':'verse';a.src=intro?verseURL(r,1,1):verseURL(r,surah,ayah);
        if(!intro)loadWordTimings(r,surah,ayah);
        syncAudioHighlight();
        preloadVerses(r,surah,ayah);
        await a.play();
      }else{
        const track=await timedTrack(r,surah);
        if(token!==state.audioToken)return;
        if(!track)throw Error('No verified timings for this read/surah');
        state.audioKind='timed';state.audioTrack=track;
        a.src=track.url;
        await new Promise((resolve,reject)=>{
          if(a.readyState>=1)return resolve();
          const timer=setTimeout(()=>{cleanup();reject(Error('Metadata timeout'));},9000);
          const cleanup=()=>{clearTimeout(timer);a.removeEventListener('loadedmetadata',ok);a.removeEventListener('error',bad);};
          const ok=()=>{cleanup();resolve();},bad=()=>{cleanup();reject(Error('Audio unavailable'));};
          a.addEventListener('loadedmetadata',ok,{once:true});a.addEventListener('error',bad,{once:true});a.load();
        });
        if(token!==state.audioToken)return;
        if(!Number.isFinite(a.duration)||track.times[track.times.length-1].end>a.duration+.5)throw Error('Audio and timing duration mismatch');
        a.currentTime=ayah===1&&surah!==9?0:track.times[ayah-1].start;
        await a.play();
      }
      if(token!==state.audioToken)return;
      state.audioLoading=false;
      audioNotice(isFallback?`تم الانتقال إلى ${r.name} لاستمرار التلاوة.`:`القارئ: ${r.name}`);
      syncAudioUI();
    }catch(e){
      if(token!==state.audioToken)return;
      state.audioLoading=false;a.pause();await failAndFallback(surah,ayah,token);
    }
  }
  function advanceAudio(){
    state.repeatPlayed++;
    if(state.repeat>0 && state.repeatPlayed<state.repeat){playVerse(state.audioSurah,state.audioAyah,false,true);return;}
    state.repeatPlayed=0;
    const next=nextAudioVerse(state.audioSurah,state.audioAyah);
    state.audioFallbacks.clear();
    if(next)playVerse(next.surah,next.ayah);
    else{audio().pause();audioNotice('اكتملت تلاوة المصحف.');syncAudioUI();}
  }
  function setupAudio(){
    const a=audio();const choice=$('#mushafReciter');
    for(const r of RECITERS){const option=document.createElement('option');option.value=r.id;option.textContent=r.name+(r.timed?' · تجريبي':'');choice.append(option);}
    choice.addEventListener('change',()=>{
      if(!a.paused||state.audioLoading){choice.value=state.reciter;syncPickers();return;}
      const nextReciter=choice.value;
      const position={surah:state.audioSurah,ayah:state.audioAyah};
      stopAudio();state.reciter=nextReciter;state.selected=position;state.audioSelectionPending=true;saveSettings();
      audioNotice('اختر تشغيل للاستماع إلى القارئ الجديد.');
    });
    $('#mushafRepeatAyah').addEventListener('click',()=>{
      const at=repeatChoices.indexOf(state.repeat);
      state.repeat=repeatChoices[(at+1)%repeatChoices.length];
      state.repeatPlayed=0;saveSettings();syncAudioUI();
    });
    $('#mushafAudioPlay').addEventListener('click',()=>{
      if(!a.paused){a.pause();syncAudioUI();return;}
      if(!state.audioSelectionPending&&a.getAttribute('src')&&a.currentTime>0){
        a.play().then(syncAudioUI).catch(()=>playVerse(state.audioSurah,state.audioAyah));return;
      }
      const start=state.selected||firstVisibleCursor()||state.cursor;
      state.audioSurah=start.surah;state.audioAyah=start.ayah;
      playVerse(start.surah,start.ayah);
    });
    $('#mushafAudioPrev').addEventListener('click',()=>{
      const prev=prevVerse({surah:state.audioSurah,ayah:state.audioAyah,token:0});
      if(prev)playVerse(prev.surah,prev.ayah);
    });
    $('#mushafAudioNext').addEventListener('click',()=>{
      const next=nextAudioVerse(state.audioSurah,state.audioAyah);
      if(next)playVerse(next.surah,next.ayah);
    });
    a.addEventListener('ended',()=>{
      if(state.mode!=='listen')return;
      if(state.audioKind==='basmala'){
        playVerse(state.audioSurah,state.audioAyah,false,true,true);return;
      }
      // A timed surah that ends before expected time is not silently skipped.
      if(state.audioKind==='timed'&&state.audioAyah<(state.surahs.get(state.audioSurah)?.length||0)){
        audioNotice('انتهى الملف قبل اكتمال التوقيتات؛ يُجرَّب قارئ بديل.');
        failAndFallback(state.audioSurah,state.audioAyah,state.audioToken);return;
      }
      advanceAudio();
    });
    let timedTransition=false;
    a.addEventListener('timeupdate',()=>{
      if(!a.paused)followAudioWords();
      const track=state.audioTrack;
      if(state.mode!=='listen'||state.audioKind!=='timed'||!track||timedTransition||a.paused)return;
      const end=track.times[state.audioAyah-1]?.end;
      if(Number.isFinite(end)&&a.currentTime>=end){
        timedTransition=true;
        const nxt=nextAudioVerse(state.audioSurah,state.audioAyah);
        // With a single timed surah file, repeat by seeking to the current ayah.
        state.repeatPlayed++;
        if(state.repeat>0&&state.repeatPlayed<state.repeat){
          a.currentTime=track.times[state.audioAyah-1].start;
        }else if(nxt&&nxt.surah===state.audioSurah){
          state.repeatPlayed=0;showAudioVerse(nxt.surah,nxt.ayah);
        }else{
          // advanceAudio counts a completed playback; avoid double-counting.
          state.repeatPlayed=state.repeat?state.repeat-1:0;
          a.pause();advanceAudio();
        }
        timedTransition=false;
      }
    });
    let followFrame=null,lastFollow=0;
    const stopFollow=()=>{if(followFrame!==null)cancelAnimationFrame(followFrame);followFrame=null;};
    const frame=now=>{
      if(a.paused||state.mode!=='listen'){stopFollow();return;}
      if(!document.hidden&&now-lastFollow>=80){lastFollow=now;followAudioWords();}
      followFrame=requestAnimationFrame(frame);
    };
    a.addEventListener('play',()=>{syncAudioUI();stopFollow();followFrame=requestAnimationFrame(frame);});
    a.addEventListener('pause',()=>{stopFollow();syncAudioUI();});
    if('mediaSession' in navigator){
      try{
        navigator.mediaSession.setActionHandler('play',()=>$('#mushafAudioPlay').click());
        navigator.mediaSession.setActionHandler('pause',()=>{if(!a.paused){a.pause();syncAudioUI();}});
        navigator.mediaSession.setActionHandler('previoustrack',()=>$('#mushafAudioPrev').click());
        navigator.mediaSession.setActionHandler('nexttrack',()=>$('#mushafAudioNext').click());
      }catch{}
    }
    // Fetch timing metadata before a user gesture when connectivity permits.
    getTimedCatalog();
  }
  function applyFont(value, persist=true){
    const allowed=new Set(['majma','uthmani','arabic']);
    state.font=allowed.has(value)?value:'majma';
    const panel=$('#panel-mushaf');
    if(panel) panel.dataset.mushafFont=state.font;
    const select=$('#mushafFontChoice');
    if(select && select.value!==state.font) select.value=state.font;
    if(persist) saveSettings();
    scheduleRender();
  }

  function setupFullscreen(){
    const reading=$('#mushafReading'),button=$('#mushafFullscreenButton');
    const active=()=>document.fullscreenElement===reading||reading.classList.contains('is-mushaf-fullscreen');
    let screenLock=null,lockPending=false,pageSuspended=false;
    const mobile=navigator.userAgentData?.mobile===true||(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)&&navigator.maxTouchPoints>0);
    const wantsScreen=()=>mobile&&!pageSuspended&&active()&&!$('#panel-mushaf').hidden&&document.visibilityState==='visible';
    async function syncScreenLock(){
      if(!navigator.wakeLock)return;
      if(!wantsScreen()){
        const held=screenLock;screenLock=null;
        if(held)try{await held.release();}catch{}
        return;
      }
      if(screenLock&&!screenLock.released||lockPending)return;
      lockPending=true;
      try{
        const held=await navigator.wakeLock.request('screen');
        if(!wantsScreen()){await held.release();return;}
        screenLock=held;
        held.addEventListener('release',()=>{if(screenLock===held)screenLock=null;},{once:true});
      }catch{}finally{lockPending=false;}
    }
    document.addEventListener('visibilitychange',syncScreenLock);
    document.addEventListener('taqss:tab-change',syncScreenLock);
    window.addEventListener('pagehide',()=>{pageSuspended=true;syncScreenLock();});
    window.addEventListener('pageshow',()=>{pageSuspended=false;syncScreenLock();});
    function sync(){const full=active();syncScreenLock();button.setAttribute('aria-pressed',String(full));button.title=full?'الخروج من ملء الشاشة':'ملء الشاشة';button.firstChild.textContent=full?'⤢ ':'⛶ ';button.querySelector('span').textContent=full?'تصغير':'ملء الشاشة';scheduleRender();}
    button.addEventListener('click',async()=>{
      if(active()){
        if(document.fullscreenElement===reading&&document.exitFullscreen)try{await document.exitFullscreen();}catch{}
        reading.classList.remove('is-mushaf-fullscreen');document.body.classList.remove('mushaf-fullscreen-fallback');
      }else{
        if(reading.requestFullscreen)try{await reading.requestFullscreen();sync();return;}catch{}
        reading.classList.add('is-mushaf-fullscreen');document.body.classList.add('mushaf-fullscreen-fallback');
      }
      sync();
    });
    document.addEventListener('fullscreenchange',sync);
    document.addEventListener('keydown',event=>{
      if(event.key==='Escape'&&reading.classList.contains('is-mushaf-fullscreen')&&!state.modalOpen){
        reading.classList.remove('is-mushaf-fullscreen');document.body.classList.remove('mushaf-fullscreen-fallback');sync();
      }
    });
  }
  function setupSwipe(){
    const root=$('#mushafVerses');
    root.addEventListener('touchstart',event=>{
      if(event.touches.length!==1||state.modalOpen){state.touch=null;return;}
      const t=event.touches[0];state.touch={x:t.clientX,y:t.clientY};
    },{passive:true});
    root.addEventListener('touchend',event=>{
      if(!state.touch||event.changedTouches.length!==1)return;
      const t=event.changedTouches[0],dx=t.clientX-state.touch.x,dy=t.clientY-state.touch.y;
      state.touch=null;
      if(Math.abs(dx)>=55&&Math.abs(dx)>Math.abs(dy)*1.4){
        state.suppressClickUntil=Date.now()+350;
        move(dx>0?'next':'prev'); // Arabic book direction: right = next, left = previous.
      }
    },{passive:true});
    root.addEventListener('click',event=>{if(Date.now()<(state.suppressClickUntil||0)){event.stopPropagation();event.preventDefault();}},true);
    root.addEventListener('keydown',event=>{
      if(state.modalOpen)return;
      if(event.key==='ArrowRight'||event.key==='ArrowLeft'){
        event.preventDefault();move(event.key==='ArrowRight'?'next':'prev');
      }
    });
  }
  async function boot(){
    const settings=saved(STORAGE_KEY,{}),last=saved(PLACE_KEY,null);
    state.lastSave=last;
    // Hide side arrows on phones/tablets, including in landscape. On hybrids,
    // the first genuine touch also hides them; desktops/TVs retain buttons.
    // A capability flag alone can misidentify a TV: hide only after real touch.
    document.addEventListener('touchstart', () => {
      document.documentElement.classList.add('mushaf-has-touch');
    }, {once:true, passive:true});
    state.fontSize=['auto','small','medium','large'].includes(settings.fontSize)?settings.fontSize:'medium';
    const applySize=()=>{ $('#panel-mushaf').dataset.mushafSize=state.fontSize; document.querySelectorAll('[name="mushafSize"]').forEach(el=>el.checked=el.value===state.fontSize); scheduleRender(); };
    applySize();
    document.querySelectorAll('[name="mushafSize"]').forEach(el=>el.addEventListener('change',()=>{state.fontSize=el.value;state.history=[];applySize();saveSettings();}));
    setupFullscreen();setupSwipe();setupAudio();setupMushafPickers();
    $('#mushafNavPrev').addEventListener('click',()=>move('prev'));
    $('#mushafNavNext').addEventListener('click',()=>move('next'));
    document.addEventListener('keydown',event=>{
      if(event.defaultPrevented||state.modalOpen||$('#panel-mushaf').hidden)return;
      if(event.key!=='ArrowRight'&&event.key!=='ArrowLeft')return;
      const element=event.target;
      if(element?.matches?.('select,input,textarea,[contenteditable="true"]'))return;
      event.preventDefault();move(event.key==='ArrowRight'?'next':'prev');
    });
    // Index choices are drafts until the form is submitted.
    $('#mushafIndexButton').addEventListener('click',openIndex);
    $('#mushafReadButton').addEventListener('click',()=>setMode('read'));
    $('#mushafListenButton').addEventListener('click',()=>setMode('listen'));
    state.showFrame=settings.showFrame!==false;
    const applyFrame=()=>{
      $('#mushafShowFrame').checked=state.showFrame;
      $('#panel-mushaf').classList.toggle('mushaf-no-frame',!state.showFrame);
      state.history=[];scheduleRender();
    };
    applyFrame();
    $('#mushafShowFrame').addEventListener('change',event=>{state.showFrame=event.target.checked;applyFrame();saveSettings();});
    $('#mushafIndexClose').addEventListener('click',closeIndex);
    $('#mushafIndexCancel').addEventListener('click',closeIndex);
    $('#mushafIndexOverlay').addEventListener('click',event=>{if(event.target.id==='mushafIndexOverlay')closeIndex();});
    $('#mushafIndexOverlay').addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeIndex();}
      if(event.key==='Tab'){
        const items=Array.from($('#mushafIndexDialog').querySelectorAll('button:not([disabled]),select:not([disabled]),input:not([disabled]),summary')).filter(el=>el.getClientRects().length);
        if(!items.length)return;
        const first=items[0],last=items[items.length-1];
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
        if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
      }
    });
    $('#mushafSurah').addEventListener('change',event=>refreshAyahOptions(Number(event.target.value),1));
    $('#mushafJumpForm').addEventListener('submit',event=>{
      event.preventDefault();
      const s=Number($('#mushafSurah').value),a=Number($('#mushafAyah').value);
      if(!state.surahs.get(s)?.[a-1])return;
      const font=$('#mushafFontChoice').value;
      stopAudio();applyFont(font);
      closeIndex();goTo(s,a);saveSettings();
    });
    $('#mushafSavePlace').addEventListener('click',()=>{
      const place=state.selected||state.cursor;
      const notice=$('#mushafActionStatus');notice.hidden=false;
      try{localStorage.setItem(PLACE_KEY,JSON.stringify(clone(place)));state.lastSave=clone(place);notice.textContent=`حُفظ الموضع: ${state.names[place.surah-1]}، الآية ${fmt(place.ayah)}.`;}catch{notice.textContent='تعذّر حفظ الموضع.';}
    });
    $('#mushafResume').addEventListener('click',()=>{
      const cursor=validCursor(saved(PLACE_KEY,state.lastSave));
      if(!cursor){const notice=$('#mushafActionStatus');notice.hidden=false;notice.textContent='لا يوجد موضع قراءة محفوظ بعد.';return;}
      closeIndex();goTo(cursor.surah,cursor.ayah,cursor.token);
    });
    state.reciter=byId(settings.reciter).id;$('#mushafReciter').value=state.reciter;
    state.repeat=([0,2,3,5].includes(Number(settings.repeat))?Number(settings.repeat):(settings.repeat?2:0));state.repeatPlayed=0;
    applyFont(settings.font || 'majma', false);
    setMode(settings.mode);syncPickers();
    // The tab initially loads hidden. Observe its visibility and size before measuring line layout.
    const panel=$('#panel-mushaf');
    new MutationObserver(()=>{if(!panel.hidden)scheduleRender();}).observe(panel,{attributes:true,attributeFilter:['hidden']});
    if(typeof ResizeObserver==='function'){
      let lastW=0,lastH=0;
      new ResizeObserver(entries=>{
        const box=entries[0]?.contentRect;if(!box||!state.ready)return;
        const w=Math.round(box.width),h=Math.round(box.height);
        if(Math.abs(w-lastW)>2||Math.abs(h-lastH)>2){lastW=w;lastH=h;state.history=[];scheduleRender();}
      }).observe($('#mushafVerses'));
    }else window.addEventListener('resize',()=>{state.history=[];scheduleRender();}, {passive:true});
    try{
      const response=await fetch('mushaf-data/kfgqpc_hafs_v30.json',{cache:'no-store'});
      if(!response.ok)throw Error(`HTTP ${response.status}`);
      prepare(await response.json());options();
      state.ready=true;
      $('#mushafSavePlace').disabled=false;$('#mushafResume').disabled=false;
      const start=Number.isInteger(settings.surah)&&settings.surah>=1&&settings.surah<=114?settings.surah:1;
      const startAyah=Number.isInteger(settings.ayah)&&state.surahs.get(start)?.[settings.ayah-1]?settings.ayah:1;
      state.cursor={surah:start,ayah:startAyah,token:0};state.pendingScroll=false;
      state.audioSurah=start;state.audioAyah=startAyah;
      syncAudioUI();setStatus('');scheduleRender();
      document.fonts?.ready.then(scheduleRender).catch(()=>{});
    }catch(error){setStatus(`تعذّر تحميل بيانات المصحف: ${error.message}. تأكد من تشغيل الخادم ووجود الملف الرسمي.`);console.error('Mushaf official data:',error);}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
