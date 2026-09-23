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
    'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
    'X-Content-Type-Options': 'nosniff'
  };
}
function json(body, status = 200, maxAge = 0) {
  const h = new Headers(corsHeaders());
  h.set('Content-Type', 'application/json; charset=utf-8');
  h.set('Cache-Control', maxAge > 0 ? `public, max-age=${maxAge}` : 'no-store');
  return new Response(JSON.stringify(body), { status, headers: h });
}
function finite(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
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
function positiveFinite(v){ const n=finite(v); return n!==null&&n>0?n:null; }
function sameMarketDay(a,b,offset=0){
  return Number.isFinite(a)&&Number.isFinite(b)&&Math.floor((a+offset)/86400)===Math.floor((b+offset)/86400);
}
function splitFactorBetween(events, startTs, endTs){
  const splits=events?.splits&&typeof events.splits==='object'?Object.values(events.splits):[];
  let factor=1, found=false;
  for(const e of splits){
    const ts=Number(e?.date||e?.timestamp); if(!Number.isFinite(ts)||ts<=startTs||ts>endTs+86400) continue;
    const numerator=positiveFinite(e?.numerator); const denominator=positiveFinite(e?.denominator);
    if(numerator&&denominator){ factor*=denominator/numerator; found=true; continue; }
    const ratio=String(e?.splitRatio||'').match(/([\d.]+)\s*:\s*([\d.]+)/);
    if(ratio){ const a=positiveFinite(ratio[1]), b=positiveFinite(ratio[2]); if(a&&b){ factor*=b/a; found=true; } }
  }
  return found?factor:null;
}
async function yahooOne(symbol){
  const bases=['https://query1.finance.yahoo.com','https://query2.finance.yahoo.com'];
  let lastErr=null;
  for(const base of bases){
    try{
      const url=`${base}/v8/finance/chart/${encodeURIComponent(symbol)}?range=10d&interval=1d&includePrePost=false&events=div%2Csplits%2CcapitalGains`;
      const d=await fetchJson(url,{headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json'}});
      const r=d?.chart?.result?.[0]; const m=r?.meta||{};
      const ts=Array.isArray(r?.timestamp)?r.timestamp:[];
      const quote=r?.indicators?.quote?.[0]||{};
      const opens=Array.isArray(quote.open)?quote.open:[], highs=Array.isArray(quote.high)?quote.high:[], lows=Array.isArray(quote.low)?quote.low:[];
      const closes=Array.isArray(quote.close)?quote.close:[], volumes=Array.isArray(quote.volume)?quote.volume:[];
      const daily=ts.map((t,i)=>({
        ts:Number(t), open:positiveFinite(opens[i]), high:positiveFinite(highs[i]), low:positiveFinite(lows[i]),
        close:positiveFinite(closes[i]), volume:finite(volumes[i])
      })).filter(x=>Number.isFinite(x.ts)&&x.close!==null).sort((a,b)=>a.ts-b.ts);
      if(!daily.length) throw new Error('No daily price');

      const last=daily[daily.length-1], prior=daily[daily.length-2]||null;
      const metaPrice=positiveFinite(m.regularMarketPrice);
      // قيم الصفر في ما قبل الافتتاح ليست سعرًا حقيقيًا. نرجع دائمًا لآخر إغلاق صالح بدل تفسير الصفر كهبوط.
      const price=metaPrice ?? last.close;
      if(price===null) throw new Error('No price');
      const marketTs=Number(m.regularMarketTime);
      const effectiveTs=Number.isFinite(marketTs)?marketTs:last.ts;
      const offset=Number(m.gmtoffset)||0;

      let prev=prior?.close ?? firstFinite(m.previousClose,m.chartPreviousClose);
      let corporateAction=false;
      if(prior){
        const factor=splitFactorBetween(r?.events,prior.ts,last.ts);
        if(factor!==null&&Math.abs(factor-1)>0.000001){ prev=prior.close*factor; corporateAction=true; }
      }
      if(prev!==null&&prev<=0) prev=null;
      const change=prev===null?null:price-prev;
      const pct=prev&&change!==null?(change/prev)*100:null;

      // OHLC لآخر جلسة فعلية. إذا أعاد Yahoo أصفارًا في الافتتاح/النطاق نخفيها بدل عرضها كبيانات صحيحة.
      const session=sameMarketDay(last.ts,effectiveTs,offset)?last:last;
      return {
        symbol,price,previousClose:prev,change,changePercent:pct,currency:m.currency||null,
        open:session?.open??null,high:session?.high??null,low:session?.low??null,volume:session?.volume??null,
        corporateAction,marketTime:new Date(effectiveTs*1000).toISOString(),delayed:true
      };
    }catch(e){lastErr=e;}
  }
  return {symbol,error:lastErr?.message||'unavailable',price:null,previousClose:null,change:null,changePercent:null,currency:null,open:null,high:null,low:null,volume:null,corporateAction:false,delayed:true};
}
async function apiMarkets(url){
  const raw=String(url.searchParams.get('symbols')||'').split(',').map(s=>s.trim()).filter(Boolean);
  const symbols=[...new Set(raw.filter(validSymbol))].slice(0,40);
  if(!symbols.length) return json({error:'لم تُرسل رموز أسعار.'},400);
  const items=await Promise.all(symbols.map(yahooOne));
  return json({updatedAt:new Date().toISOString(),source:'Yahoo Finance (public chart endpoint)',items},200,60);
}
function normalizeMarketItems(items){
  if(!Array.isArray(items)) return null;
  const allowed=new Set(['index','commodity','stock']); const seen=new Set(); const out=[];
  for(const x of items){
    const symbol=String(x?.symbol||'').trim().toUpperCase(); const name=String(x?.name||'').trim(); const category=String(x?.category||'').trim();
    if(!validSymbol(symbol)||!name||name.length>80||!allowed.has(category)||seen.has(symbol)) continue;
    seen.add(symbol); out.push({symbol,name,category,enabled:x?.enabled!==false});
  }
  return out.length?out:null;
}
function marketsConfigSource(items){
  const intro='// القائمة الأساسية للأسعار.\n// الأسهم يمكن إضافتها أو تعطيلها من شاشة «الأسعار»؛ العامل يحدّث هذا الملف في GitHub عند تفعيل إدارة القائمة.\nwindow.TAQSS_MARKETS = [\n';
  const order=['index','commodity','stock']; const lines=[];
  for(const category of order){
    const group=items.filter(x=>x.category===category);
    for(const x of group) lines.push(`  { symbol: ${JSON.stringify(x.symbol)}, name: ${JSON.stringify(x.name)}, category: ${JSON.stringify(x.category)}, enabled: ${x.enabled!==false} },`);
    if(group.length) lines.push('');
  }
  if(lines[lines.length-1]==='') lines.pop();
  return `${intro}${lines.join('\n')}\n];\n`;
}
function utf8Base64(value){
  const bytes=new TextEncoder().encode(value); let binary=''; const size=0x8000;
  for(let i=0;i<bytes.length;i+=size) binary+=String.fromCharCode(...bytes.subarray(i,i+size));
  return btoa(binary);
}
async function apiUpdateMarketsConfig(request,env){
  if(!env.GITHUB_TOKEN||!env.MARKETS_ADMIN_KEY) return json({error:'إدارة قائمة الأسهم غير مفعلة في العامل.'},503);
  const supplied=String(request.headers.get('X-Admin-Key')||'');
  if(!supplied||supplied!==String(env.MARKETS_ADMIN_KEY)) return json({error:'رمز الإدارة غير صحيح.'},401);
  let body=null; try{body=await request.json();}catch{return json({error:'بيانات الطلب غير صالحة.'},400);}
  const items=normalizeMarketItems(body?.items); if(!items) return json({error:'قائمة الأسعار غير صالحة.'},400);
  const owner=env.GITHUB_OWNER||'muala-code'; const repo=env.GITHUB_REPO||'taqss-dashboard'; const branch=env.GITHUB_BRANCH||'main'; const path=env.GITHUB_MARKETS_PATH||'markets-config.js';
  const api=`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`;
  const headers={'Authorization':`Bearer ${env.GITHUB_TOKEN}`,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'taqss-dashboard-worker'};
  const current=await fetchJson(api,{headers}); const sha=current?.sha; if(!sha) return json({error:'تعذر قراءة ملف قائمة الأسعار من GitHub.'},502);
  const putUrl=api.replace(/\?ref=.*$/,'');
  const payload={message:'Update market items from Taqss Dashboard',content:utf8Base64(marketsConfigSource(items)),sha,branch};
  const updated=await fetchJson(putUrl,{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(payload)});
  return json({ok:true,items,commit:updated?.commit?.sha||null},200,0);
}

async function cached(request,ctx,ttl,producer){
  const cache=caches.default; const key=new Request(request.url,{method:'GET'}); const hit=await cache.match(key); if(hit) return hit;
  const response=await producer(); if(response.ok&&ttl>0){ const clone=response.clone(); clone.headers.set('Cache-Control',`public, max-age=${ttl}`); ctx.waitUntil(cache.put(key,clone)); }
  return response;
}

export default {
  async fetch(request,env,ctx){
    if(request.method==='OPTIONS') return new Response(null,{status:204,headers:corsHeaders()});
    const url=new URL(request.url);
    if(request.method==='POST'&&url.pathname==='/api/markets/config') {
      try { return await apiUpdateMarketsConfig(request,env); } catch(e) { console.error(e); return json({error:'تعذر حفظ قائمة الأسهم.',detail:e?.message||String(e)},502); }
    }
    if(!['GET','HEAD'].includes(request.method)) return json({error:'Method not allowed'},405);
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
