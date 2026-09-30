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
    const ratio=String(e?.splitRatio||'').match(/([\d.]+)\s\*:\s\*([\d.]+)/);
    if(ratio){ const a=positiveFinite(ratio[1]), b=positiveFinite(ratio[2]); if(a&&b){ factor*=b/a; found=true; } }
  }
  return found?factor:null;
}
const COMMODITY_SYMBOLS = new Set(['GC=F', 'SI=F', 'BZ=F', 'CL=F']);
// Fallback only when an intervening Mon–Fri daily candle is absent.
// Market holidays can also trigger this check; a matching hourly reference
// must be present or the change is withheld rather than guessed.
function missingBusinessSession(priorTs,currentTs,offset=0,symbol=''){
  if(!Number.isFinite(priorTs)||!Number.isFinite(currentTs)||currentTs<=priorTs) return false;
  const first=Math.floor((priorTs+offset)/86400), last=Math.floor((currentTs+offset)/86400);
  const saudi=String(symbol).toUpperCase().endsWith('.SR');
  for(let day=first+1;day<last;day++){
    const wd=new Date(day*86400000).getUTCDay();
    if(saudi ? wd!==5 && wd!==6 : wd!==0 && wd!==6) return true;
  }
  return false;
}
// The hourly META previousClose is useful here; the hourly bar's last close
// is NOT necessarily an exchange settlement and must not be substituted.
// Do not issue an hourly request on normal daily-chart updates.
async function missingSessionReference(symbol, expectedName, effectiveTs, offset){
  if(!expectedName) return null;
  for(const base of ['https://query1.finance.yahoo.com','https://query2.finance.yahoo.com']){
    try{
      const u=`${base}/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1h&includePrePost=false`;
      const d=await fetchJson(u,{headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json'}});
      const r=d?.chart?.result?.[0], m=r?.meta||{};
      if(!r || !m.shortName || m.shortName!==expectedName) continue;
      const hourlyTime=positiveFinite(m.regularMarketTime);
      const previous=positiveFinite(m.previousClose);
      if(previous!==null && hourlyTime!==null &&
         sameMarketDay(hourlyTime,effectiveTs,offset) &&
         Math.abs(hourlyTime-effectiveTs)<2*86400){
        return {previous,source:'yahooHourlyMetaPreviousClose',hourlyShortName:m.shortName};
      }
    }catch{}
  }
  return null;
}
// Exceptional check ONLY for suspicious commodity reference differences.
// Cross-check two Yahoo chart intervals for the same ticker, named instrument
// and market timestamp. This does not independently prove contract identity.
async function commodityHourlyCrosscheck(symbol, expectedName, effectiveTs, offset, quotePrice){
  if(!expectedName || !Number.isFinite(effectiveTs)) return null;
  for(const base of ['https://query1.finance.yahoo.com','https://query2.finance.yahoo.com']){
    try{
      const url=`${base}/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1h&includePrePost=false`;
      const data=await fetchJson(url,{headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json'},cf:{cacheEverything:true,cacheTtl:900}});
      const meta=data?.chart?.result?.[0]?.meta||{};
      const ht=positiveFinite(meta.regularMarketTime);
      const hp=positiveFinite(meta.regularMarketPrice);
      const hpClose=positiveFinite(meta.previousClose);
      if(meta.shortName!==expectedName || !ht || !hp || !hpClose) continue;
      if(!sameMarketDay(ht,effectiveTs,offset) || Math.abs(ht-effectiveTs)>3*3600) continue;
      if(Math.abs(hp-quotePrice)/quotePrice>0.0075) continue;
      return {previousClose:hpClose,price:hp,source:'yahooHourlySameInstrument'};
    }catch{} // Show only the price when verification cannot be completed.
  }
  return null;
}
// Request intraday bars ONLY when the daily chart does not contain the
// session of the Saudi price. Never borrow OHLC from an earlier session.
async function saudiIntradayDetails(symbol, effectiveTs, quotePrice){
  if(!Number.isFinite(effectiveTs) || !positiveFinite(quotePrice)) return null;
  for(const base of ['https://query1.finance.yahoo.com','https://query2.finance.yahoo.com']){
    try{
      const url=`${base}/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=15m&includePrePost=false`;
      const data=await fetchJson(url,{headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json'},cf:{cacheEverything:true,cacheTtl:300}});
      const chart=data?.chart?.result?.[0], q=chart?.indicators?.quote?.[0]||{};
      const ts=Array.isArray(chart?.timestamp)?chart.timestamp:[];
      // Saudi stocks are traded on the Riyadh exchange (UTC+3 year round).
      const bars=ts.map((t,i)=>({ts:Number(t),open:positiveFinite(q.open?.[i]),
        high:positiveFinite(q.high?.[i]),low:positiveFinite(q.low?.[i]),
        close:positiveFinite(q.close?.[i]),volume:finite(q.volume?.[i])})).filter(b=>
          Number.isFinite(b.ts)&&sameMarketDay(b.ts,effectiveTs,3*3600)&&
          b.open!==null&&b.high!==null&&b.low!==null&&b.close!==null&&
          b.high>=b.low&&b.high>=b.open&&b.low<=b.open);
      bars.sort((a,b)=>a.ts-b.ts);
      if(!bars.length) continue;
      // The first bar must begin near the 10:00 Riyadh opening, not noon.
      const day=Math.floor((effectiveTs+3*3600)/86400);
      const expectedOpen=day*86400-3*3600+10*3600;
      if(bars[0].ts<expectedOpen-900 || bars[0].ts>expectedOpen+1800) continue;
      const eligible=bars.filter(b=>b.ts<=effectiveTs+900);
      if(!eligible.length || effectiveTs-eligible.at(-1).ts>3600) continue;
      const high=Math.max(...eligible.map(b=>b.high));
      const low=Math.min(...eligible.map(b=>b.low));
      // A mismatch means this chart is not verified against the quoted session.
      const epsilon=Math.max(.02, quotePrice*.002);
      if(quotePrice>high+epsilon||quotePrice<low-epsilon||
         Math.abs(eligible.at(-1).close-quotePrice)>Math.max(.08,quotePrice*.0075)) continue;
      const vols=eligible.map(b=>b.volume);
      const volume=vols.every(x=>x!==null&&x>=0)?vols.reduce((a,b)=>a+b,0):null;
      return {open:eligible[0].open,high,low,volume,source:'yahoo15mSameSession'};
    }catch{} // A missing chart must not replace the last verified daily reference.
  }
  return null;
}
async function yahooOne(symbol){
  const bases=['https://query1.finance.yahoo.com','https://query2.finance.yahoo.com'];
  let lastErr=null;
  for(const base of bases){
    try{
      const url=`${base}/v8/finance/chart/${encodeURIComponent(symbol)}?range=10d&interval=1d&includePrePost=false&events=div%2Csplits%2CcapitalGains`;
      const d=await fetchJson(url,{headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json'}});
      const r=d?.chart?.result?.[0], m=r?.meta||{};
      const ts=Array.isArray(r?.timestamp)?r.timestamp:[];
      const quote=r?.indicators?.quote?.[0]||{};
      const daily=ts.map((t,i)=>({
        ts:Number(t),open:positiveFinite(quote.open?.[i]),high:positiveFinite(quote.high?.[i]),
        low:positiveFinite(quote.low?.[i]),close:positiveFinite(quote.close?.[i]),volume:finite(quote.volume?.[i])
      })).filter(x=>Number.isFinite(x.ts)&&x.close!==null).sort((a,b)=>a.ts-b.ts);
      if(!daily.length) throw new Error('No daily price');
      const offset=Number(m.gmtoffset)||0;
      const marketTs=positiveFinite(m.regularMarketTime);
      const last=daily[daily.length-1];
      const match=marketTs===null?-1:daily.findLastIndex(x=>sameMarketDay(x.ts,marketTs,offset));
// If daily quotes contain a session later than meta time, don't mix the two sessions.
      const laterDaily=marketTs!==null && last.ts>marketTs && !sameMarketDay(last.ts,marketTs,offset);
      const sessionIndex=laterDaily ? daily.length-1 : match>=0 ? match : daily.length-1;
      const session=daily[sessionIndex];
      const prior=sessionIndex>0?daily[sessionIndex-1]:null;
      const metaPrice=positiveFinite(m.regularMarketPrice);
      const price=laterDaily?session.close:(metaPrice??session.close);
      const effectiveTs=laterDaily?session.ts:(marketTs??session.ts);
      const metaPreviousClose=positiveFinite(m.previousClose);
      const chartPreviousClose=positiveFinite(m.chartPreviousClose);
      const metaPrev=firstFinite(metaPreviousClose,chartPreviousClose);
      const dailyAligned=laterDaily || match>=0;
      const commodity=COMMODITY_SYMBOLS.has(symbol.toUpperCase());
      const saudi=String(symbol).toUpperCase().endsWith('.SR');
      const quoteNewerThanDaily=saudi && !laterDaily && match<0 &&
        marketTs!==null && last.ts<marketTs && !sameMarketDay(last.ts,marketTs,offset);
      let prev;
      let referenceSource;
      const missingDailySession=Boolean(prior && dailyAligned && !laterDaily &&
        missingBusinessSession(prior.ts,session.ts,offset,symbol));
      const quoteHasMissingSession=quoteNewerThanDaily &&
        missingBusinessSession(last.ts,marketTs,offset,symbol);
      const gapHasSplit=missingDailySession &&
        splitFactorBetween(r?.events,prior.ts,session.ts)!==null;
      const newerQuoteSplit=quoteNewerThanDaily &&
        splitFactorBetween(r?.events,last.ts,marketTs)!==null;
      const fallback=missingDailySession && !gapHasSplit ?
        await missingSessionReference(symbol,m.shortName,effectiveTs,offset) : null;
      const metaSameSession=marketTs!==null && sameMarketDay(effectiveTs,marketTs,offset);
      // For Saudi quotes newer than the latest available daily bar, that bar
      // is the PREVIOUS session, not the session whose price we are quoting.
      // Never substitute stale Yahoo chartPreviousClose for this daily close.
      if(quoteNewerThanDaily){
        if(quoteHasMissingSession){prev=null;referenceSource='saudiMissingSessionsUnverified';}
        else if(newerQuoteSplit){prev=null;referenceSource='saudiCorporateActionUnverified';}
        else {prev=last.close;referenceSource='saudiLatestDailyPreviousClose';}
      }
      else if(missingDailySession){
        if(fallback){prev=fallback.previous;referenceSource=fallback.source;}
        else {prev=null;referenceSource=gapHasSplit?'missingSessionCorporateActionUnverified':'missingDailySessionUnverified';}
      }
      else if(commodity && metaPreviousClose!==null && metaSameSession && !laterDaily){
        prev=metaPreviousClose;referenceSource='yahooCommodityPreviousClose';
      }
      else if(prior && dailyAligned){prev=prior.close;referenceSource='dailyPrior';}
      else if(saudi){prev=null;referenceSource='saudiNoVerifiedDailyReference';}
      else if(metaPrev!==null){prev=metaPrev;referenceSource='yahooMeta';}
      else if(prior){prev=prior.close;referenceSource='dailyPriorUnverified';}
      else {prev=null;referenceSource='unavailable';}
      // A large price change alone is NOT evidence of a rollover. Only
      // suppress the percent if two Yahoo intervals disagree strongly about
      // the previous close while reporting the SAME current quote/instrument.
      let commodityReferenceConflict=false;
      let commodityHourlyPreviousClose=null;
      if(commodity && prev!==null && price!==null &&
         Math.abs(price-prev)/prev>=0.04){
        const cross=await commodityHourlyCrosscheck(symbol,m.shortName,effectiveTs,offset,price);
        commodityHourlyPreviousClose=cross?.previousClose??null;
        if(cross && Math.abs(cross.previousClose-prev)/Math.max(cross.previousClose,prev)>0.025){
          commodityReferenceConflict=true;
          prev=null;
          referenceSource='commodityReferenceConflictWithheld';
        }
      }
      let corporateAction=false;
      if(prior && referenceSource==='dailyPrior'){
        const factor=splitFactorBetween(r?.events,prior.ts,session.ts);
        if(factor!==null&&Math.abs(factor-1)>0.000001){prev=prior.close*factor;corporateAction=true;}
      }
      if(prev!==null&&prev<=0) prev=null;
      const change=prev===null?null:price-prev;
      const changePercent=prev!==null&&change!==null?(change/prev)*100:null;
// Diagnostic only: a mismatch may reflect sessions, a stale quote, or an action.
      const referenceMismatch=metaPrev!==null && (quoteNewerThanDaily || dailyAligned) &&
        Math.abs((quoteNewerThanDaily ? last.close : (prior?.close??metaPrev))-metaPrev)/metaPrev>0.0025;
      const potentialContractRollover=commodity && referenceMismatch;
      const metaSessionDetails = quoteNewerThanDaily &&
        marketTs!==null && metaPrice!==null && sameMarketDay(marketTs,effectiveTs,offset);
      const validMetaDetails = metaSessionDetails &&
        positiveFinite(m.regularMarketDayHigh)!==null && positiveFinite(m.regularMarketDayLow)!==null &&
        positiveFinite(m.regularMarketDayHigh)>=price-0.0001 &&
        positiveFinite(m.regularMarketDayLow)<=price+0.0001;
      const dailyDetailsInconsistent=saudi && metaPrice!==null && !laterDaily &&
        (session.high===null || session.low===null ||
         price>session.high+0.0001 || price<session.low-0.0001);
      const suppressStaleDetails=quoteNewerThanDaily || dailyDetailsInconsistent;
      // Fetch a matching intraday chart only for Saudi sessions with stale
      // daily details. Reuse verified metadata if the intraday chart fails.
      const intraday=suppressStaleDetails&&saudi ?
        await saudiIntradayDetails(symbol,effectiveTs,price) : null;
      const sessionOpen=suppressStaleDetails ? (intraday?.open??(validMetaDetails?positiveFinite(m.regularMarketOpen):null)) : session.open;
      const sessionHigh=suppressStaleDetails ? (intraday?.high??(validMetaDetails?positiveFinite(m.regularMarketDayHigh):null)) : session.high;
      const sessionLow=suppressStaleDetails ? (intraday?.low??(validMetaDetails?positiveFinite(m.regularMarketDayLow):null)) : session.low;
      const metaVolume=validMetaDetails?finite(m.regularMarketVolume):null;
      const sessionVolume=suppressStaleDetails ?
        (metaVolume!==null&&intraday?.volume!==null?Math.max(metaVolume,intraday.volume):intraday?.volume??metaVolume) : session.volume;
      return {
        symbol,price,previousClose:prev,change,changePercent,currency:m.currency||null,
        open:sessionOpen,high:sessionHigh,low:sessionLow,volume:sessionVolume,
        corporateAction,marketTime:new Date(effectiveTs*1000).toISOString(),delayed:true,
        referenceSource,referenceMismatch,
        priceSource:laterDaily?'dailyNewerSession':metaPrice!==null?'yahooRegularMarketPrice':'dailyFallback',
        potentialContractRollover:potentialContractRollover||commodityReferenceConflict,
        commodityReferenceConflict,
        missingDailySession,
        hourlyReferenceVerified:Boolean(fallback),
        missingSessionCorporateAction:Boolean(gapHasSplit),
        diagnostic:{yahooPreviousClose:metaPreviousClose,chartPreviousClose,
          commodityHourlyPreviousClose,
          dailyPriorClose:prior?.close??null,latestDailyClose:last.close,
          dailyQuoteAligned:dailyAligned,quoteNewerThanDaily,quoteHasMissingSession,
          sessionDetailsSource:suppressStaleDetails?(intraday?.source??(validMetaDetails?'yahooMetaSameSession':'withheldUnverified')):'dailyBar',
          yahooMarketTime:marketTs===null?null:new Date(marketTs*1000).toISOString(),
          dailySessionTime:new Date(session.ts*1000).toISOString()}
      };
    }catch(e){lastErr=e;}
  }
  return {symbol,error:lastErr?.message||'unavailable',price:null,previousClose:null,
    change:null,changePercent:null,currency:null,open:null,high:null,low:null,volume:null,
    corporateAction:false,delayed:true};
}
// On-demand commodity investigation. Not called by the dashboard.
// Includes daily bars and hourly bars; hourly bars are NOT official settlement prices.
async function diagnoseCommodity(url){
  const symbol=String(url.searchParams.get('symbol')||'GC=F').toUpperCase();
  if(!COMMODITY_SYMBOLS.has(symbol)) return json({error:'Unsupported commodity'},400);
  const bases=['https://query1.finance.yahoo.com','https://query2.finance.yahoo.com'];
  async function chart(range,interval){
    let err=null;
    for(const base of bases){
      try{
        const u=`${base}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false&events=div%2Csplits`;
        const d=await fetchJson(u,{headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json'}});
        const r=d?.chart?.result?.[0];
        if(!r) throw new Error('Yahoo returned no chart');
        const m=r.meta||{}, ts=Array.isArray(r.timestamp)?r.timestamp:[], q=r.indicators?.quote?.[0]||{};
        const tz=m.exchangeTimezoneName||'UTC';
        const bars=ts.map((t,i)=>{
          const utc=new Date(t*1000).toISOString();
          let exchangeDate=null;
          try{exchangeDate=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t*1000));}catch{}
          return {utc,exchangeDate,open:finite(q.open?.[i]),high:finite(q.high?.[i]),low:finite(q.low?.[i]),close:finite(q.close?.[i]),volume:finite(q.volume?.[i])};
        }).filter(b=>b.close!==null);
        return {ok:true,interval,exchangeTimezoneName:tz,shortName:m.shortName||null,longName:m.longName||null,
          regularMarketPrice:finite(m.regularMarketPrice),previousClose:finite(m.previousClose),
          chartPreviousClose:finite(m.chartPreviousClose),regularMarketTime:m.regularMarketTime?new Date(m.regularMarketTime*1000).toISOString():null,
          bars:interval==='1h'?bars.slice(-65):bars};
      }catch(e){err=e;}
    }
    return {ok:false,interval,error:err?.message||'unavailable'};
  }
  const [daily,hourly]=await Promise.all([chart('10d','1d'),chart('5d','1h')]);
  return json({symbol,generatedAt:new Date().toISOString(),notice:'Diagnostic only: hourly last bar is not necessarily the official prior settlement; contract identity must be independently checked.',daily,hourly},200,0);
}
async function apiMarkets(url){
  const raw=String(url.searchParams.get('symbols')||'').split(',').map(s=>s.trim()).filter(Boolean);
  const symbols=[...new Set(raw.filter(validSymbol))].slice(0,40);
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
    const url=new URL(request.url);
    if(!['GET','HEAD'].includes(request.method)) return json({error:'Method not allowed'},405);
    try{
      if(url.pathname==='/api/weather') return cached(request,ctx,55,()=>apiWeather(env));
      if(url.pathname==='/api/history/today'||url.pathname==='/api/history') return cached(request,ctx,300,()=>apiToday(env));
      if(url.pathname==='/api/history/month') return cached(request,ctx,900,()=>apiMonth(env,url.searchParams.get('year'),url.searchParams.get('month')));
      if(url.pathname==='/api/history/year') return cached(request,ctx,3600,()=>apiYear(env,url.searchParams.get('year')));
      if(url.pathname==='/api/prayer') return proxy('/api/prayer',env);
      if(url.pathname==='/api/markets/diagnose') return diagnoseCommodity(url);
      if(url.pathname==='/api/markets') return cached(request,ctx,60,()=>apiMarkets(url));
      if(url.pathname==='/'||url.pathname==='/api/health') return json({ok:true,service:'Taqss Dashboard API',stationId:stationId(env),hasWUKey:Boolean(wuKey(env)),stationApiBase:stationBase(env)});
      return json({error:'Not found'},404);
    }catch(e){ console.error(e); return json({error:'تعذر تنفيذ الطلب.',detail:e?.message||String(e)},502); }
  }
};
