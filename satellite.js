(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const endpoint = 'https://view.eumetsat.int/geoserver/wms';
  const interval = 10 * 60 * 1000;
  const layers = {visible:'mtg_fd:vis06_hrfi',infrared:'mtg_fd:ir105_hrfi',rain:'mtg_fd:h40b',lightning:'mtg_fd:li_afa'};
  let metadata = {}, metadataAt = 0, attemptAt = 0, timer = null, busy = false, focused = true, generation = 0;
  const times = {};
  const active = () => focused && document.visibilityState === 'visible' && !$('panel-weather').hidden && !$('weatherSatelliteView').hidden;
  const clock = iso => new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {timeZone:'Asia/Riyadh',day:'numeric',month:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(iso));
  function channel() {
    const choice = $('satelliteChannel').value;
    if (choice !== 'auto') return choice;
    // Solar elevation approximation for the station; visible channel only in daylight.
    const now = new Date(), start = Date.UTC(now.getUTCFullYear(),0,0);
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
      }
    }
    if (!next[layers[channel()]]) throw new Error('missing layer');
    metadata=next; metadataAt=Date.now();
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
    $('satelliteRefresh').disabled=true;
    $('satelliteStatus').textContent='جارٍ جلب أحدث صورة متاحة…';
    const requested=[['base',layers[channel()],'satelliteBase']];
    if($('satelliteRain').checked) requested.push(['rain',layers.rain,'satelliteRainImage']);
    if($('satelliteLightning').checked) requested.push(['lightning',layers.lightning,'satelliteLightningImage']);
    const failures=[];
    try {
      await capabilities();
      // A few single-image requests, sequentially, rather than many map tiles.
      for(const [key,layer,id] of requested) {
        if(token!==generation||!active()) break;
        try {
          const time=metadata[layer]; if(!time) throw new Error('unavailable');
          const src=await imageReady(url(layer,time));
          if(token!==generation||!active()) break;
          $(id).src=src; $(id).hidden=false; times[key]=time;
        } catch { $(id).hidden=true; delete times[key]; failures.push(key==='base'?'الصورة':key==='rain'?'الهطول':'البرق'); }
      }
      if(token===generation && active()) $('satelliteStatus').textContent=failures.length?`تعذر تحميل: ${failures.join('، ')}. أعد المحاولة.`:'';
    } catch {
      if(token===generation) $('satelliteStatus').textContent='تعذر الاتصال بمصدر الصور. أعد المحاولة لاحقًا.';
    } finally {
      busy=false; $('satelliteRefresh').disabled=false; describe();
      // A changed selection while loading invalidates the result and starts its own request.
      if(token!==generation && active()) load(true);
    }
  }
  function sync() {
    clearInterval(timer); timer=null;
    if(active()) { load(); timer=setInterval(()=>load(),interval); }
    else { generation++; if (busy) attemptAt=0; }
  }
  function selectionChanged() {
    generation++;
    $('satelliteRainImage').hidden=true; $('satelliteLightningImage').hidden=true;
    $('satelliteRainLegend').hidden=!$('satelliteRain').checked;
    if($('satelliteRain').checked && !$('satelliteRainLegend').getAttribute('src')) $('satelliteRainLegend').src=endpoint+'?service=WMS&version=1.3.0&request=GetLegendGraphic&format=image/png&layer=mtg_fd:h40b';
    describe(); load(true);
  }
  $('satelliteCopyright').textContent='© EUMETSAT '+new Date().getFullYear();
  for(const id of ['satelliteChannel','satelliteRain','satelliteLightning']) $(id).addEventListener('change',selectionChanged);
  $('satelliteRefresh').addEventListener('click',()=>{ if(Date.now()-attemptAt>=30000) { metadataAt=0;load(true); } else $('satelliteStatus').textContent='انتظر قليلًا قبل إعادة التحديث.'; });
  document.addEventListener('taqss:weather-view',sync);
  document.addEventListener('taqss:tab-change',()=>setTimeout(sync,0));
  document.addEventListener('visibilitychange',sync);
  window.addEventListener('focus',()=>{focused=true;sync();});
  window.addEventListener('blur',()=>{focused=false;sync();});
})();
