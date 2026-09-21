(() => {
  "use strict";
  const cfg = window.TAQSS_CONFIG || {};
  const LAT = Number(cfg.latitude || 24.234096);
  const LON = Number(cfg.longitude || 39.551125);
  const REFRESH_MS = 10 * 60 * 1000;
  const FRAME_MS = 1200;
  let map=null, radarLayer=null, host="", frames=[], index=-1, timer=null, loadedAt=0, loading=null;
  const $=s=>document.querySelector(s);

  function message(text){ const el=$("#radarMapMessage"); if(!el)return; el.textContent=text||""; el.hidden=!text; }
  function ensureMap(){
    if(map) return true;
    if(!window.L){ message("تعذر تحميل مكتبة الخريطة."); return false; }
    const root=$("#weatherLeafletMap"); if(!root) return false;
    map=L.map(root,{center:[LAT,LON],zoom:7,minZoom:3,maxZoom:18,zoomControl:true,attributionControl:true,scrollWheelZoom:false});
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:18,attribution:"© OpenStreetMap"}).addTo(map);
    L.marker([LAT,LON],{icon:L.divIcon({className:"",html:'<span class="station-map-marker" aria-hidden="true"></span>',iconSize:[12,12],iconAnchor:[6,6]}),title:"موقع المحطة",keyboard:false,zIndexOffset:1000}).addTo(map);
    return true;
  }
  function frameClock(t){
    if(!Number.isFinite(Number(t))) return "—";
    return new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn",{timeZone:cfg.timeZone||"Asia/Riyadh",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(Number(t)*1000));
  }
  function updateControls(){
    const c=$("#radarPlaybackControls"); if(!c)return; c.hidden=!frames.length;
    const play=c.querySelector('[data-radar-action="play"]'); if(play) play.textContent=timer?"⏸":"▶";
    const time=$("#radarControlTime"); if(time) time.textContent=frames.length&&index>=0?`${frameClock(frames[index]?.time)}  ${index+1}/${frames.length}`:"—";
  }
  function tileUrl(f){ return host&&f?.path?`${host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`:""; }
  function render(i){
    if(!map||!frames.length)return;
    index=Math.max(0,Math.min(frames.length-1,i)); const url=tileUrl(frames[index]); if(!url)return;
    if(!radarLayer) radarLayer=L.tileLayer(url,{tileSize:256,opacity:.74,maxNativeZoom:7,maxZoom:18,keepBuffer:1,updateWhenIdle:true,updateWhenZooming:false,attribution:"Radar © RainViewer"}).addTo(map);
    else radarLayer.setUrl(url,false);
    updateControls();
  }
  function stop(){ if(timer){clearInterval(timer);timer=null;} updateControls(); }
  function toggle(){
    if(timer){stop();return;} if(frames.length<2)return;
    timer=setInterval(()=>render(index>=frames.length-1?0:index+1),FRAME_MS); updateControls();
  }
  async function load(){
    if(!ensureMap()) return;
    const fresh=frames.length&&(Date.now()-loadedAt<REFRESH_MS); if(fresh){ requestAnimationFrame(()=>map.invalidateSize(false)); return; }
    if(loading) return loading;
    message("جارٍ تحميل الرادار…");
    loading=(async()=>{
      try{
        const r=await fetch("https://api.rainviewer.com/public/weather-maps.json",{cache:"no-store"}); if(!r.ok) throw new Error(`HTTP ${r.status}`);
        const d=await r.json(); host=d.host||"https://tilecache.rainviewer.com"; frames=Array.isArray(d?.radar?.past)?d.radar.past.slice(-7):[]; loadedAt=Date.now();
        if(!frames.length) throw new Error("لا توجد إطارات"); render(frames.length-1); message("");
      }catch(e){ frames=[]; index=-1; message("تعذر تحميل رادار المطر حاليًا."); console.warn(e); }
      finally{ loading=null; updateControls(); requestAnimationFrame(()=>map.invalidateSize(false)); }
    })();
    return loading;
  }
  function pseudo(shell,on){ shell.classList.toggle("is-pseudo-fullscreen",on); document.body.classList.toggle("radar-pseudo-fullscreen",on); updateFullscreen(); setTimeout(()=>map?.invalidateSize(false),80); }
  function fullEl(){ return document.fullscreenElement||document.webkitFullscreenElement||null; }
  function updateFullscreen(){ const b=$("#radarFullscreenButton"), shell=$("#weatherMap"); if(!b||!shell)return; const active=fullEl()===shell||shell.classList.contains("is-pseudo-fullscreen"); b.textContent=active?"×":"⛶"; b.title=active?"الخروج من ملء الشاشة":"ملء الشاشة"; }
  async function toggleFullscreen(){
    const shell=$("#weatherMap"); if(!shell)return;
    if(shell.classList.contains("is-pseudo-fullscreen")){pseudo(shell,false);return;}
    try{
      if(fullEl()){ const exit=document.exitFullscreen||document.webkitExitFullscreen; if(exit) await exit.call(document); return; }
      const req=shell.requestFullscreen||shell.webkitRequestFullscreen; if(req) await req.call(shell); else pseudo(shell,true);
    }catch{pseudo(shell,true);}
  }
  document.addEventListener("click",e=>{
    const a=e.target.closest?.("[data-radar-action]");
    if(a){ const act=a.dataset.radarAction; if(act==="center")map?.setView([LAT,LON],7); if(act==="prev"){stop();render(index-1);} if(act==="next"){stop();render(index+1);} if(act==="play")toggle(); }
    if(e.target.closest?.("#radarFullscreenButton")) toggleFullscreen();
  });
  document.addEventListener("taqss:radar-open",()=>load());
  document.addEventListener("taqss:radar-close",()=>stop());
  document.addEventListener("fullscreenchange",()=>{updateFullscreen();setTimeout(()=>map?.invalidateSize(false),80);});
  document.addEventListener("webkitfullscreenchange",()=>{updateFullscreen();setTimeout(()=>map?.invalidateSize(false),80);});
  document.addEventListener("keydown",e=>{if(e.key==="Escape"){const s=$("#weatherMap");if(s?.classList.contains("is-pseudo-fullscreen"))pseudo(s,false);}});
  window.addEventListener("resize",()=>requestAnimationFrame(()=>map?.invalidateSize(false)),{passive:true});
  updateFullscreen();
})();
