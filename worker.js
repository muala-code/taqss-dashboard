const DEFAULT_STATION_API_BASE = 'https://mahatta-api.muala99.workers.dev';
const DEFAULT_STATION_ID = 'IMEDIN86';
const DEFAULT_LAT = 24.234096;
const DEFAULT_LON = 39.551125;
const TZ = 'Asia/Riyadh';
const RAIN_START_YEAR = 2026;
const RAIN_START_MONTH = 7;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'X-Content-Type-Options': 'nosniff'
  };
}
function json(body, status = 200, maxAge = 0) {
  const h = new Headers(corsHeaders());
  h.set('Content-Type', 'application/json; charset=utf-8');
  h.set('Cache-Control', maxAge > 0 ? `public, max-age=${maxAge}` : 'no-store');
  return new Response(JSON.stringify(body), { status, headers: h });
}
function finite(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function firstFinite(...vals) { for (const v of vals) { const n = finite(v); if (n !== null) return n; } return null; }
function stationId(env) { return env.STATION_ID || DEFAULT_STATION_ID; }
function stationBase(env) { return String(env.STATION_API_BASE || DEFAULT_STATION_API_BASE).replace(/\/$/, ''); }
function wuKey(env) { return env.WU_API_KEY || ''; }
function nowParts() {
  const p = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' })
    .formatToParts(new Date()).forEach(x => { if (x.type !== 'literal') p[x.type] = x.value; });
  return { year:+p.year, month:+p.month, day:+p.day, hour:+p.hour, minute:+p.minute };
}
function dateKey(y,m,d){ return `${y}${String(m).padStart(2,'0')}${String(d).padStart(2,'0')}`; }
function isoDay(y,m,d){ return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }
function daysInMonth(y,m){ return new Date(Date.UTC(y,m,0)).getUTCDate(); }
function rainCounts(y,m){ return y > RAIN_START_YEAR || (y === RAIN_START_YEAR && m >= RAIN_START_MONTH); }

async function fetchJson(url, init = {}) {
  const r = await fetch(url, init);
  const text = await r.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch {}
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status:r.status, data });
  return data;
}
async function proxy(path, env) {
  const r = await fetch(`${stationBase(env)}${path}`, { headers:{ Accept:'application/json' } });
  const text = await r.text();
  const h = new Headers(corsHeaders());
  h.set('Content-Type','application/json; charset=utf-8');
  h.set('Cache-Control',r.headers.get('Cache-Control') || 'no-store');
  return new Response(text, { status:r.status, headers:h });
}
function currentUrl(env) {
  return `https://api.weather.com/v2/pws/observations/current?stationId=${encodeURIComponent(stationId(env))}&format=json&units=m&numericPrecision=decimal&apiKey=${encodeURIComponent(wuKey(env))}`;
}
function hourly7Url(env) {
  return `https://api.weather.com/v2/pws/observations/hourly/7day?stationId=${encodeURIComponent(stationId(env))}&format=json&units=m&numericPrecision=decimal&apiKey=${encodeURIComponent(wuKey(env))}`;
}
function dailyRangeUrl(env,start,end) {
  return `https://api.weather.com/v2/pws/history/daily?stationId=${encodeURIComponent(stationId(env))}&format=json&units=m&startDate=${start}&endDate=${end}&numericPrecision=decimal&apiKey=${encodeURIComponent(wuKey(env))}`;
}
function rows(data){ return Array.isArray(data?.observations) ? data.observations : Array.isArray(data?.summaries) ? data.summaries : []; }
function metric(row,...keys){ for(const k of keys){ const n=finite(row?.metric?.[k]); if(n!==null) return n; } return null; }
function temp(row){ return firstFinite(row?.metric?.temp,row?.imperial?.temp); }
function humidity(row){ return firstFinite(row?.humidity,row?.humidityAvg,metric(row,'humidity','humidityAvg')); }
function wind(row){ return firstFinite(row?.metric?.windSpeed,row?.imperial?.windSpeed,metric(row,'windspeedAvg','windSpeedAvg','windSpeed')); }
function gust(row){ return firstFinite(row?.metric?.windGust,row?.imperial?.windGust,metric(row,'windgustHigh','windGustHigh','windGust','windgustAvg')); }
function windDir(row){ return firstFinite(row?.winddir,row?.winddirAvg,row?.windDirection,row?.windDirectionAvg,row?.metric?.winddir,row?.metric?.winddirAvg); }
function pressure(row){ return firstFinite(row?.metric?.pressure,row?.imperial?.pressure,metric(row,'pressureAvg','pressure')); }
function dew(row){ return firstFinite(row?.metric?.dewpt,row?.metric?.dewPoint,metric(row,'dewptAvg','dewPointAvg','dewpt','dewPoint')); }
function rain(row){ return Math.max(0, firstFinite(row?.metric?.precipTotal,row?.precipTotal,metric(row,'precipTotal','precipRate'),0) || 0); }
function solar(row){ return firstFinite(row?.solarRadiation,row?.metric?.solarRadiation,row?.imperial?.solarRadiation); }
function heatIndex(row){ return firstFinite(row?.metric?.heatIndex,row?.metric?.heatindex,row?.heatIndex); }
function windChill(row){ return firstFinite(row?.metric?.windChill,row?.metric?.windchill,row?.windChill); }
function observedStamp(row){ return row?.obsTimeLocal || row?.obsTimeUtc || null; }
function currentDayRows(data, iso){ return rows(data).filter(r => String(observedStamp(r)||'').startsWith(iso)); }
function dailyPoint(row){
  const date=String(observedStamp(row)||'').slice(0,10); if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const high=firstFinite(metric(row,'tempHigh'),metric(row,'tempAvg'));
  const low=firstFinite(metric(row,'tempLow'),metric(row,'tempAvg'));
  const avg=firstFinite(metric(row,'tempAvg','temp'), high!==null&&low!==null?(high+low)/2:null);
  const dewPoint=dew(row);
  return { date, tempHigh:high, tempLow:low, tempAvg:avg, dewPoint, rain:rain(row) };
}

async function apiWeather(env){
  if(!wuKey(env)) return proxy('/api/weather', env);
  const n=nowParts(), iso=isoDay(n.year,n.month,n.day), dk=dateKey(n.year,n.month,n.day);
  const cur=await fetchJson(currentUrl(env)); const o=cur?.observations?.[0];
  if(!o) return json({error:'لم تصل قراءة من WU.'},502);
  let daily=null, hourly=null;
  try { daily=await fetchJson(dailyRangeUrl(env,dk,dk)); } catch {}
  try { hourly=await fetchJson(hourly7Url(env)); } catch {}
  const drow=rows(daily).find(r=>String(observedStamp(r)||'').startsWith(iso)) || rows(daily)[0] || null;
  const hrows=currentDayRows(hourly,iso);
  const temps=hrows.map(r=>firstFinite(metric(r,'tempAvg','temp'),temp(r))).filter(v=>v!==null);
  const low=firstFinite(metric(drow,'tempLow'), temps.length?Math.min(...temps):null, temp(o));
  const high=firstFinite(metric(drow,'tempHigh'), temps.length?Math.max(...temps):null, temp(o));
  return json({
    stationId:stationId(env), stationName:'أبيار الماشي · المدينة المنورة', stationConnected:true,
    observedAt:observedStamp(o), latitude:firstFinite(o.lat,DEFAULT_LAT), longitude:firstFinite(o.lon,DEFAULT_LON),
    temperature:temp(o), humidity:humidity(o), windSpeed:wind(o), windGust:gust(o), windDirection:windDir(o),
    pressure:pressure(o), rain:rain(drow||o),
    solarRadiation:solar(o), uv:firstFinite(o.uv), dewPoint:dew(o), heatIndex:heatIndex(o), windChill:windChill(o),
    dayMin:low, dayMax:high, rawObservation:o, source:'Weather Underground'
  },200,55);
}

async function apiToday(env){
  if(!wuKey(env)) return proxy('/api/history/today',env);
  const n=nowParts(), iso=isoDay(n.year,n.month,n.day);
  const data=await fetchJson(hourly7Url(env));
  const pts=currentDayRows(data,iso).map(r=>({
    observedAt:observedStamp(r), temperature:firstFinite(metric(r,'tempAvg','temp'),temp(r)), humidity:humidity(r),
    windSpeed:wind(r), windGust:gust(r), windDirection:windDir(r), pressure:pressure(r), rain:rain(r), dewPoint:dew(r)
  })).filter(x=>x.observedAt).sort((a,b)=>new Date(a.observedAt).getTime()-new Date(b.observedAt).getTime());
  try{
    const cur=await fetchJson(currentUrl(env)); const o=cur?.observations?.[0]; const stamp=observedStamp(o);
    if(o && String(stamp||'').startsWith(iso)){
      const last=pts[pts.length-1]; if(!last || new Date(stamp)>new Date(last.observedAt)) pts.push({observedAt:stamp,temperature:temp(o),humidity:humidity(o),windSpeed:wind(o),windGust:gust(o),windDirection:windDir(o),pressure:pressure(o),rain:rain(o),dewPoint:dew(o)});
    }
  }catch{}
  return json({enabled:true,date:iso,points:pts,source:'Weather Underground'},200,300);
}

async function apiMonth(env,yearParam,monthParam){
  if(!wuKey(env)) return proxy(`/api/history/month?year=${encodeURIComponent(yearParam||'')}&month=${encodeURIComponent(monthParam||'')}`,env);
  const n=nowParts(), y=Number(yearParam||n.year), m=Number(monthParam||n.month);
  if(!Number.isInteger(y)||!Number.isInteger(m)||m<1||m>12||y<2000||y>n.year||(y===n.year&&m>n.month)) return json({enabled:false,error:'الفترة الشهرية غير صالحة.'},400);
  const end=y===n.year&&m===n.month?n.day:daysInMonth(y,m);
  const data=await fetchJson(dailyRangeUrl(env,dateKey(y,m,1),dateKey(y,m,end)));
  const prefix=`${y}-${String(m).padStart(2,'0')}-`;
  let pts=rows(data).map(dailyPoint).filter(Boolean).filter(p=>p.date.startsWith(prefix)).map(p=>({...p,day:Number(p.date.slice(8,10))}));
  if(!rainCounts(y,m)) pts=pts.map(p=>({...p,rain:0}));
  return json({enabled:true,period:'month',year:y,month:m,points:pts,source:'Weather Underground'},200,900);
}

async function apiYear(env,yearParam){
  if(!wuKey(env)) return proxy(`/api/history/year?year=${encodeURIComponent(yearParam||'')}`,env);
  const n=nowParts(), y=Number(yearParam||n.year); if(!Number.isInteger(y)||y<2000||y>n.year) return json({enabled:false,error:'السنة غير صالحة.'},400);
  const last=y===n.year?n.month:12;
  const jobs=[];
  for(let m=1;m<=last;m++){
    const end=y===n.year&&m===n.month?n.day:daysInMonth(y,m);
    jobs.push((async()=>{
      try{
        const data=await fetchJson(dailyRangeUrl(env,dateKey(y,m,1),dateKey(y,m,end)));
        const pts=rows(data).map(dailyPoint).filter(Boolean); const highs=pts.map(p=>p.tempHigh).filter(v=>v!==null), lows=pts.map(p=>p.tempLow).filter(v=>v!==null);
        return {month:m,tempHigh:highs.length?Math.max(...highs):null,tempLow:lows.length?Math.min(...lows):null,rain:rainCounts(y,m)?pts.reduce((s,p)=>s+Math.max(0,finite(p.rain)||0),0):0};
      }catch{return {month:m,tempHigh:null,tempLow:null,rain:0};}
    })());
  }
  return json({enabled:true,period:'year',year:y,points:await Promise.all(jobs),source:'Weather Underground'},200,3600);
}

function validSymbol(s){ return /^[A-Z0-9.^=\-]{1,24}$/i.test(s); }
async function yahooOne(symbol){
  const bases=['https://query1.finance.yahoo.com','https://query2.finance.yahoo.com'];
  let lastErr=null;
  for(const base of bases){
    try{
      const url=`${base}/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d&includePrePost=false`;
      const d=await fetchJson(url,{headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json'}});
      const r=d?.chart?.result?.[0]; const m=r?.meta||{};
      const price=finite(m.regularMarketPrice);
      if(price===null) throw new Error('No price');

      // لا نعتمد على meta.previousClose وحده؛ قد يعيد Yahoo قيمة أقدم لبعض رموز تداول.
      // نستخرج إغلاق جلسة التداول السابقة من السلسلة اليومية نفسها.
      const ts=Array.isArray(r?.timestamp)?r.timestamp:[];
      const closes=Array.isArray(r?.indicators?.quote?.[0]?.close)?r.indicators.quote[0].close:[];
      const daily=ts.map((t,i)=>({ts:Number(t),close:finite(closes[i])})).filter(x=>Number.isFinite(x.ts)&&x.close!==null);
      let prev=firstFinite(m.previousClose,m.chartPreviousClose);
      if(daily.length){
        const last=daily[daily.length-1], prior=daily[daily.length-2];
        const marketTs=Number(m.regularMarketTime);
        const offset=Number(m.gmtoffset)||0;
        const marketDay=Number.isFinite(marketTs)?Math.floor((marketTs+offset)/86400):null;
        const lastDay=Math.floor((last.ts+offset)/86400);
        if(prior && marketDay!==null && lastDay===marketDay) prev=prior.close;
        else prev=last.close;
      }
      const change=prev===null?null:price-prev; const pct=prev&&change!==null?(change/prev)*100:null;
      return {symbol,price,previousClose:prev,change,changePercent:pct,currency:m.currency||null,marketTime:m.regularMarketTime?new Date(m.regularMarketTime*1000).toISOString():null,delayed:true};
    }catch(e){lastErr=e;}
  }
  return {symbol,error:lastErr?.message||'unavailable',price:null,previousClose:null,change:null,changePercent:null,currency:null,delayed:true};
}
async function apiMarkets(url){
  const raw=String(url.searchParams.get('symbols')||'').split(',').map(s=>s.trim()).filter(Boolean);
  const symbols=[...new Set(raw.filter(validSymbol))].slice(0,30);
  if(!symbols.length) return json({error:'لم تُرسل رموز أسعار.'},400);
  const items=await Promise.all(symbols.map(yahooOne));
  return json({updatedAt:new Date().toISOString(),source:'Yahoo Finance (public chart endpoint)',items},200,60);
}

async function cached(request,ctx,ttl,producer){
  const cache=caches.default; const key=new Request(request.url,{method:'GET'}); const hit=await cache.match(key); if(hit) return hit;
  const response=await producer(); if(response.ok&&ttl>0){ const clone=response.clone(); clone.headers.set('Cache-Control',`public, max-age=${ttl}`); ctx.waitUntil(cache.put(key,clone)); }
  return response;
}

export default {
  async fetch(request,env,ctx){
    if(request.method==='OPTIONS') return new Response(null,{status:204,headers:corsHeaders()});
    if(!['GET','HEAD'].includes(request.method)) return json({error:'Method not allowed'},405);
    const url=new URL(request.url);
    try{
      if(url.pathname==='/api/weather') return cached(request,ctx,55,()=>apiWeather(env));
      if(url.pathname==='/api/history/today'||url.pathname==='/api/history') return cached(request,ctx,300,()=>apiToday(env));
      if(url.pathname==='/api/history/month') return cached(request,ctx,900,()=>apiMonth(env,url.searchParams.get('year'),url.searchParams.get('month')));
      if(url.pathname==='/api/history/year') return cached(request,ctx,3600,()=>apiYear(env,url.searchParams.get('year')));
      if(url.pathname==='/api/prayer') return proxy('/api/prayer',env);
      if(url.pathname==='/api/markets') return cached(request,ctx,60,()=>apiMarkets(url));
      if(url.pathname==='/'||url.pathname==='/api/health') return json({ok:true,service:'Taqss Dashboard API',stationId:stationId(env),hasWUKey:Boolean(wuKey(env)),stationApiBase:stationBase(env)});
      return json({error:'Not found'},404);
    }catch(e){ console.error(e); return json({error:'تعذر تنفيذ الطلب.',detail:e?.message||String(e)},502); }
  }
};
