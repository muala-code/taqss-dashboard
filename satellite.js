(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const endpoint = 'https://view.eumetsat.int/geoserver/wms';
  const interval = 10 * 60 * 1000;
  const layers = {visible:'mtg_fd:vis06_hrfi',infrared:'mtg_fd:ir105_hrfi',rain:'mtg_fd:h40b',lightning:'mtg_fd:li_afa'};
  let metadata = {}, metadataAt = 0, attemptAt = 0, timer = null, busy = false, focused = true, generation = 0;
  const times = {}, ranges = {}, saved = {};
  let archiveTime = null;
  const picture = document.querySelector('.satellite-picture');
  const fullscreen = document.createElement('button');
  fullscreen.type='button'; fullscreen.textContent='⛶'; fullscreen.title='ملء الشاشة'; fullscreen.setAttribute('aria-label','ملء الشاشة');
  Object.assign(fullscreen.style,{position:'absolute',left:'.6rem',bottom:'.6rem',zIndex:5,fontSize:'1.4rem',cursor:'pointer'});
  const stage=document.createElement('div'); stage.className='satellite-stage'; while(picture.firstChild)stage.append(picture.firstChild); picture.append(stage,fullscreen);
  const towns=[
    ['خيبر',25.713438,39.280308],
    ['الحناكية',24.879722,40.515278],
    ['بدر',23.782918,38.790468],
    ['المهد',23.499655,40.884084],
    ['وادي الفرع',23.5,39.5]
  ];
  for(const [name,latitude,longitude] of towns){
    const x=(longitude-38)/3*100, y=(26-latitude)/3*100;
    if(x<0||x>100||y<0||y>100)continue;
    const marker=document.createElement('span');marker.className='satellite-town';
    Object.assign(marker.style,{position:'absolute',left:x+'%',top:y+'%',zIndex:2,color:'#fff',fontSize:'clamp(10px,2.5vw,14px)',whiteSpace:'nowrap',textShadow:'0 1px 3px #000,1px 0 3px #000',pointerEvents:'none'});
    const dot=document.createElement('span');dot.textContent='•';Object.assign(dot.style,{position:'absolute',transform:'translate(-50%,-50%)'});
    const label=document.createElement('span');label.textContent=name;label.dir='rtl';
    Object.assign(label.style,{position:'absolute',top:'0',transform:'translateY(-50%)',...(x>80?{right:'7px'}:{left:'7px'})});
    marker.append(dot,label);stage.append(marker);
  }

  const style=document.createElement('style');
  style.textContent='.satellite-stage{position:absolute;inset:0}.satellite-picture:fullscreen .satellite-stage,.satellite-picture.satellite-full .satellite-stage{inset:auto;left:50%;top:50%;width:min(100vw,100dvh);height:min(100vw,100dvh);transform:translate(-50%,-50%)}.satellite-picture:fullscreen,.satellite-picture.satellite-full{position:fixed;inset:0;z-index:99999;width:100%;height:100dvh;aspect-ratio:auto;border-radius:0;background:#18232e}.satellite-picture:fullscreen img,.satellite-picture.satellite-full img{object-fit:fill}body.satellite-full-open{overflow:hidden}.satellite-archive{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin:.5rem 0}.satellite-archive input,.satellite-archive button{font:inherit;padding:.4rem;border:1px solid #b8c4cd;border-radius:.4rem;background:Canvas;color:CanvasText}';
  document.head.append(style);
  const controls=document.createElement('div'); controls.className='satellite-archive';
  controls.innerHTML='<label>التاريخ <input id="satelliteDate" type="date"></label><label>الوقت <input id="satelliteTime" type="time" value="12:00"></label><button type="button" id="satelliteFetch">جلب</button><button type="button" id="satelliteLatest">الأحدث</button><span style="font-size:.8rem">بتوقيت السعودية</span>';
  document.querySelector('.satellite-controls').after(controls);
  const archiveRange=document.createElement('p');archiveRange.className='satellite-caption';controls.after(archiveRange);
  $('satelliteDate').value=new Date(Date.now()+10800000).toISOString().slice(0,10);
  const toggleFull=async()=>{
    if(document.fullscreenElement===picture){await document.exitFullscreen();return;}
    if(picture.classList.contains('satellite-full')){picture.classList.remove('satellite-full');document.body.classList.remove('satellite-full-open');fullscreen.textContent='⛶';return;}
    try{if(!picture.requestFullscreen) throw new Error();await picture.requestFullscreen();}catch{picture.classList.add('satellite-full');document.body.classList.add('satellite-full-open');fullscreen.textContent='✕';}
  };
  fullscreen.addEventListener('click',toggleFull);
  document.addEventListener('fullscreenchange',()=>{fullscreen.textContent=document.fullscreenElement===picture?'✕':'⛶';});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&picture.classList.contains('satellite-full'))toggleFull();});
  function database(){return new Promise((resolve,reject)=>{const r=indexedDB.open('taqss-satellite',1);r.onupgradeneeded=()=>r.result.createObjectStore('images');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
  async function persist(layer,blob,time){try{const db=await database();await new Promise((ok,no)=>{const tx=db.transaction('images','readwrite');tx.objectStore('images').put({blob,time},layer);tx.oncomplete=ok;tx.onerror=no;});db.close();}catch{}}
  async function restore(){const initialGeneration=generation;try{const db=await database();for(const layer of Object.values(layers)){const item=await new Promise((ok,no)=>{const r=db.transaction('images').objectStore('images').get(layer);r.onsuccess=()=>ok(r.result);r.onerror=no;});if(item&&!saved[layer])saved[layer]={src:URL.createObjectURL(item.blob),time:item.time};}db.close();if(initialGeneration===generation&&!archiveTime)showSaved();}catch{}}
  function showSaved(){for(const [key,layer,id] of requestedLayers()){const item=saved[layer];if(item){$(id).src=item.src;$(id).hidden=false;times[key]=item.time;}}describe();}
  function requestedLayers(){const r=[['base',layers[channel()],'satelliteBase']];if($('satelliteRain').checked)r.push(['rain',layers.rain,'satelliteRainImage']);if($('satelliteLightning').checked)r.push(['lightning',layers.lightning,'satelliteLightningImage']);return r;}
  function selectedTime(layer){if(!archiveTime)return metadata[layer];const range=ranges[layer];if(!range)throw new Error('range');const target=Date.parse(archiveTime);if(target<range.start||target>range.end)throw new Error('outside');return new Date(Math.min(range.end,Math.max(range.start,range.start+Math.round((target-range.start)/range.step)*range.step))).toISOString();}
  $('satelliteFetch').addEventListener('click',()=>{const v=$('satelliteDate').value+'T'+$('satelliteTime').value+':00+03:00';if(!Number.isFinite(Date.parse(v))){$('satelliteStatus').textContent='اختر تاريخًا ووقتًا صالحين.';return;}archiveTime=new Date(v).toISOString();generation++;load(true);});
  $('satelliteLatest').addEventListener('click',()=>{archiveTime=null;generation++;metadataAt=0;load(true);});
  const active = () => focused && document.visibilityState === 'visible' && !$('panel-weather').hidden && !$('weatherSatelliteView').hidden;
  const clock = iso => new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {timeZone:'Asia/Riyadh',year:'numeric',day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(iso));
  function channel() {
    const choice = $('satelliteChannel').value;
    if (choice !== 'auto') return choice;
    // Solar elevation approximation for the station; visible channel only in daylight.
    const now = new Date(archiveTime || Date.now()), start = Date.UTC(now.getUTCFullYear(),0,0);
    const day = (now-start)/86400000, rad = Math.PI/180;
    const decl = 23.44 * Math.sin(2*Math.PI*(day-81)/365.25)*rad;
    const b = 2*Math.PI*(day-81)/364;
    const eq = 9.87*Math.sin(2*b)-7.53*Math.cos(b)-1.5*Math.sin(b);
    const minutes = now.getUTCHours()*60+now.getUTCMinutes()+4*39.551125+eq;
    const hourAngle = (minutes/4-180)*rad, latitude=24.234096*rad;
    const elevation=Math.asin(Math.sin(latitude)*Math.sin(decl)+Math.cos(latitude)*Math.cos(decl)*Math.cos(hourAngle))/rad;
    return elevation > 3 ? 'visible' : 'infrared';
  }
  function url(layer, time) {
    return endpoint+'?'+new URLSearchParams({service:'WMS',version:'1.1.1',request:'GetMap',layers:layer,styles:'',srs:'EPSG:4326',bbox:'38,23,41,26',width:'800',height:'800',format:'image/png',transparent:'true',time});
  }
  async function capabilities() {
    if (Date.now()-metadataAt < interval && Object.keys(metadata).length) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let response;
    try { response = await fetch(endpoint+'?service=WMS&version=1.3.0&request=GetCapabilities',{signal:controller.signal}); }
    finally { clearTimeout(timeout); }
    if (!response.ok) throw new Error('metadata');
    const xml = new DOMParser().parseFromString(await response.text(),'application/xml');
    const next={};
    for (const layer of xml.getElementsByTagNameNS('*','Layer')) {
      const children=Array.from(layer.children);
      const name=children.find(n=>n.localName==='Name')?.textContent;
      const dimension=children.find(n=>n.localName==='Dimension' && n.getAttribute('name')==='time');
      if (Object.values(layers).includes(name) && dimension) {
        const time=dimension.getAttribute('default');
        if (Number.isFinite(Date.parse(time))) next[name]=time;
        const parts=dimension.textContent.trim().split('/');
        const duration=parts[2]?.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
        if(parts.length===3&&duration){const step=(+(duration[1]||0)*3600+ +(duration[2]||0)*60+ +(duration[3]||0))*1000;if(step>0)ranges[name]={start:Date.parse(parts[0]),end:Date.parse(parts[1]),step};}
      }
    }
    if (!next[layers[channel()]]) throw new Error('missing layer');
    metadata=next; metadataAt=Date.now(); const range=ranges[layers[channel()]]; if(range)archiveRange.textContent='أرشيف الصورة المتاح: '+clock(new Date(range.start).toISOString())+' إلى '+clock(new Date(range.end).toISOString())+' — قد تختلف مدة أرشيف الهطول والبرق.';
  }
  function imageReady(src) {
    return new Promise((resolve,reject)=>{
      const img=new Image(); const timeout=setTimeout(()=>{img.onload=img.onerror=null; reject(new Error('timeout'));},35000);
      img.onload=()=>{clearTimeout(timeout);resolve(src);};
      img.onerror=()=>{clearTimeout(timeout);reject(new Error('image'));}; img.src=src;
    });
  }
  function describe() {
    const labels={base:'الصورة',rain:'الهطول',lightning:'البرق'};
    $('satelliteTimes').textContent=Object.entries(times).filter(([key])=>key==='base'||$(key==='rain'?'satelliteRain':'satelliteLightning').checked).map(([key,time])=>`${labels[key]}: ${clock(time)} (قبل ${Math.max(0,Math.round((Date.now()-Date.parse(time))/60000))} دقيقة)`).join(' · ');
  }
  async function load(force=false) {
    if (!active() || busy || (!force && Date.now()-attemptAt<interval)) return;
    busy=true; attemptAt=Date.now(); const token=++generation;
    $('satelliteRefresh').disabled=true; $('satelliteFetch').disabled=true; $('satelliteLatest').disabled=true;
    $('satelliteStatus').textContent=archiveTime?'جارٍ جلب أقرب لقطات متاحة للوقت المختار…':'جارٍ جلب أحدث صورة متاحة…';
    const requested=requestedLayers();
    const failures=[];
    try {
      await capabilities();
      // A few single-image requests, sequentially, rather than many map tiles.
      for(const [key,layer,id] of requested) {
        if(token!==generation||!active()) break;
        try {
          const time=selectedTime(layer); if(!time) throw new Error('unavailable');
          let src;
          const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),35000);
          try{const response=await fetch(url(layer,time),{signal:controller.signal});if(!response.ok)throw new Error();const blob=await response.blob();if(!blob.type.startsWith('image/'))throw new Error();src=URL.createObjectURL(blob);try{await imageReady(src);}catch(e){URL.revokeObjectURL(src);throw e;}if(token===generation&&!archiveTime){const previous=saved[layer];saved[layer]={src,time};await persist(layer,blob,time);if(previous?.src?.startsWith('blob:'))URL.revokeObjectURL(previous.src);}}
          catch{src=await imageReady(url(layer,time));if(token===generation&&!archiveTime)saved[layer]={src,time};}
          finally{clearTimeout(timeout);}
          if(token!==generation||!active()) break;
          $(id).src=src; $(id).hidden=false; times[key]=time;
        } catch { if(!archiveTime&&saved[layer]){$(id).src=saved[layer].src;$(id).hidden=false;times[key]=saved[layer].time;} failures.push(key==='base'?'الصورة':key==='rain'?'الهطول':'البرق'); }
      }
      if(token===generation && active()) $('satelliteStatus').textContent=failures.length?`تعذر تحميل: ${failures.join('، ')}. تُعرض آخر لقطة ناجحة إن توفرت؛ قد يكون الوقت خارج أرشيف بعض الطبقات.`:(archiveTime?'عرض أرشيفي — الأوقات الفعلية لكل طبقة أدناه.':'');
    } catch {
      if(token===generation) $('satelliteStatus').textContent='تعذر الاتصال بالمصدر. تُعرض آخر لقطة ناجحة إن توفرت.';
    } finally {
      busy=false; $('satelliteRefresh').disabled=false; $('satelliteFetch').disabled=false; $('satelliteLatest').disabled=false; describe();
      // A changed selection while loading invalidates the result and starts its own request.
      if(token!==generation && active()) load(true);
    }
  }
  function sync() {
    clearInterval(timer); timer=null;
    if(active()) { if(!archiveTime)load(); timer=setInterval(()=>{if(!archiveTime)load();},interval); }
    else { generation++; if (busy) attemptAt=0; }
  }
  function selectionChanged() {
    generation++;
    $('satelliteRainImage').hidden=true; $('satelliteLightningImage').hidden=true;
    $('satelliteRainLegend').hidden=!$('satelliteRain').checked;
    if($('satelliteRain').checked && !$('satelliteRainLegend').getAttribute('src')) $('satelliteRainLegend').src=endpoint+'?service=WMS&version=1.3.0&request=GetLegendGraphic&format=image/png&layer=mtg_fd:h40b';
    showSaved(); describe(); load(true);
  }
  restore();
  $('satelliteCopyright').textContent='© EUMETSAT '+new Date().getFullYear();
  for(const id of ['satelliteChannel','satelliteRain','satelliteLightning']) $(id).addEventListener('change',selectionChanged);
  $('satelliteRefresh').addEventListener('click',()=>{ if(Date.now()-attemptAt>=30000) { archiveTime=null; metadataAt=0;load(true); } else $('satelliteStatus').textContent='انتظر قليلًا قبل إعادة التحديث.'; });
  document.addEventListener('taqss:weather-view',sync);
  document.addEventListener('taqss:tab-change',()=>setTimeout(sync,0));
  document.addEventListener('visibilitychange',sync);
  window.addEventListener('focus',()=>{focused=true;sync();});
  window.addEventListener('blur',()=>{focused=false;sync();});
})();
