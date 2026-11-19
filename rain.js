/* Intraday rainfall: millimetres per observed interval, with explicit gaps. */
(() => {
  'use strict';
  const cfg=window.TAQSS_CONFIG||{},$=s=>document.querySelector(s);
  const apiBase=String(cfg.dashboardApiBase||'').replace(/\/$/,'');
  const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const dateText=date=>new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn',{day:'numeric',month:'long',year:'numeric',timeZone:'Asia/Riyadh'}).format(new Date(date+'T12:00:00Z'));
  const timeText=ms=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Riyadh',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(Number(ms)));
  const number=value=>Number(value).toLocaleString('ar-SA-u-nu-latn',{maximumFractionDigits:2});
  const state={followToday:true,date:today(),year:Number(today().slice(0,4)),active:false,reload:null,indexVersion:0};
  const cache=new Map();
  async function read(path,ttl){const found=cache.get(path);if(found&&Date.now()-found.at<ttl)return found.promise;const record={at:Date.now(),promise:(async()=>{const r=await fetch(apiBase+path,{cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.error||'تعذر جلب سجل المطر.');return d;})()};cache.set(path,record);try{const d=await record.promise;if(d.partial)cache.delete(path);return d;}catch(e){if(cache.get(path)===record)cache.delete(path);throw e;}}
  function closeMenu(){ $('#rainDayMenu').hidden=true;$('#rainDayButton').setAttribute('aria-expanded','false'); }
  function setVisible(active,reload){state.active=active;state.reload=reload;$('#rainControls').hidden=!active;if(!active){closeMenu();state.indexVersion++;}}
  function selectDate(date){state.followToday=date===today();state.date=date;state.year=Number(date.slice(0,4));closeMenu();if(state.reload)state.reload();}
  async function populateDays(){
    const version=++state.indexVersion,year=state.year;
    const options=$('#rainDayOptions'),message=$('#rainDayStatus');options.replaceChildren();message.textContent='جارٍ جلب الأيام الممطرة…';
    $('#rainYearLabel').textContent=String(year);$('#rainYearPrev').disabled=year<=2026;$('#rainYearNext').disabled=year>=Number(today().slice(0,4));
    try{const data=await read(`/api/rain/days?year=${year}`,15*60000);if(version!==state.indexVersion||!state.active)return;
      for(const day of data.days||[]){const b=document.createElement('button');b.type='button';b.setAttribute('role','option');b.setAttribute('aria-selected',String(day.date===state.date));b.dataset.rainDate=day.date;b.textContent=`${dateText(day.date)} · ${number(day.total)} مم`;b.addEventListener('click',()=>selectDate(day.date));options.append(b);}
      message.textContent=data.partial?'القائمة جزئية؛ تعذر جلب بعض الأيام.':data.days?.length?'':'لا توجد أيام مسجلة بمطر في هذه السنة.';
    }catch(e){if(version===state.indexVersion)message.textContent=e.message;}
  }
  $('#rainDayButton').addEventListener('click',()=>{const open=$('#rainDayMenu').hidden;$('#rainDayMenu').hidden=!open;$('#rainDayButton').setAttribute('aria-expanded',String(open));if(open)populateDays();});
  $('#rainTodayButton').addEventListener('click',()=>selectDate(today()));
  $('#rainYearPrev').addEventListener('click',()=>{if(state.year>2026){state.year--;populateDays();}});
  $('#rainYearNext').addEventListener('click',()=>{if(state.year<Number(today().slice(0,4))){state.year++;populateDays();}});
  document.addEventListener('click',e=>{if(!$('#rainDayPicker').contains(e.target))closeMenu();});
  $('#rainDayPicker').addEventListener('keydown',e=>{
    if(e.key==='Escape'){closeMenu();$('#rainDayButton').focus();return;}
    const items=[...$('#rainDayOptions').querySelectorAll('[role="option"]')];if(!items.length||$('#rainDayMenu').hidden)return;
    let index=items.indexOf(document.activeElement);
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();index=index<0?(e.key==='ArrowDown'?0:items.length-1):(index+(e.key==='ArrowDown'?1:-1)+items.length)%items.length;items[index].focus();}
    if(e.key==='Home'||e.key==='End'){e.preventDefault();items[e.key==='Home'?0:items.length-1].focus();}
  });
  const gapPlugin={id:'rainObservationGaps',beforeDatasetsDraw(chart,args,options){
    const {ctx,chartArea,scales}=chart;if(!chartArea||!scales.x)return;
    ctx.save();ctx.beginPath();ctx.rect(chartArea.left,chartArea.top,chartArea.right-chartArea.left,chartArea.bottom-chartArea.top);ctx.clip();
    for(const gap of options.gaps||[]){const left=scales.x.getPixelForValue(gap.from),right=scales.x.getPixelForValue(gap.to);ctx.fillStyle='rgba(196,138,39,.10)';ctx.fillRect(left,chartArea.top,right-left,chartArea.bottom-chartArea.top);ctx.strokeStyle='rgba(163,116,33,.5)';ctx.setLineDash([3,4]);for(const x of [left,right]){ctx.beginPath();ctx.moveTo(x,chartArea.top);ctx.lineTo(x,chartArea.bottom);ctx.stroke();}}
    ctx.restore();
  }};
  async function load({isCurrent}){
    if(state.followToday){state.date=today();state.year=Number(state.date.slice(0,4));}
    const date=state.date;
    $('#rainDayButtonText').textContent=date===today()?'الأيام الممطرة':dateText(date);
    $('#rainDateLabel').textContent=dateText(date);$('#rainTotal').textContent='—';$('#rainGapNote').textContent='';
    const data=await read(`/api/rain/day?date=${date}`,date===today()?5*60000:86400000);
    if(!isCurrent())return null;
    $('#rainTotal').textContent=data.total===null?'—':number(data.total)+' مم';
    const notes=[];
    if(data.gaps?.length)notes.push('التظليل يوضح فترات انقطاع الرصد.');
    if(data.periods?.some(p=>p.uncertain))notes.push('العمود الكهرماني كمية خلال فترة الانقطاع؛ توقيتها داخل الفترة غير محدد.');
    if(data.resets?.length)notes.push('رُصد تراجع في عدّاد المطر؛ توزيع الكمية غير مكتمل.');
    if(data.unallocated>.05)notes.push(`${number(data.unallocated)} مم ضمن الإجمالي لا تتوفر لها قراءات تفصيلية.`);
    if(!data.consistent&&data.sampleCount&&!data.resets?.length&&!(data.unallocated>.05))notes.push('توجد مغايرة بين إجمالي اليوم والقراءات التفصيلية.');
    $('#rainGapNote').textContent=notes.join(' ');
    const intervals=(data.periods||[]).map(p=>({...p,x:p.uncertain?(p.from+p.to)/2:p.to,y:p.amount}));
    const last=data.lastObservedAt?Date.parse(data.lastObservedAt):data.midnight;
    // Numeric time axis: missing observations retain their actual width.
    const max=Math.max(data.midnight+60000,last),min=data.midnight;
    const spec={type:'bar',plugins:[gapPlugin],data:{datasets:[{label:'مطر الفترة',data:intervals,
      backgroundColor:ctx=>ctx.raw?.uncertain?'#c48a27':'#759bb1',borderColor:ctx=>ctx.raw?.uncertain?'#946013':'#638ba1',borderWidth:1,borderRadius:2,maxBarThickness:26}]},options:{responsive:true,maintainAspectRatio:false,animation:false,locale:'ar-SA-u-nu-latn',
      interaction:{mode:'nearest',intersect:false},plugins:{legend:{display:false},rainObservationGaps:{gaps:data.gaps||[]},
        tooltip:{rtl:true,textDirection:'rtl',displayColors:false,callbacks:{title:items=>{const p=items[0]?.raw;return p?(p.uncertain?`${timeText(p.from)} — ${timeText(p.to)} (انقطاع الرصد)`:timeText(p.to)):'';},label:ctx=>`${number(ctx.raw.amount)} مم`,afterLabel:ctx=>ctx.raw.uncertain?'كمية الفترة، وليست كمية عند توقيت محدد.':`الفترة: ${timeText(ctx.raw.from)} — ${timeText(ctx.raw.to)}`}}},
      scales:{x:{type:'linear',min,max,offset:false,grid:{display:false},ticks:{maxTicksLimit:6,maxRotation:0,callback:value=>timeText(value)}},y:{beginAtZero:true,title:{display:true,text:'مم'},ticks:{maxTicksLimit:6}}}}};
    return {spec,status:!data.sampleCount?'لا تتوفر قراءات تفصيلية لهذا اليوم.':data.total===0?'لم يُسجَّل مطر لهذا اليوم.':`آخر قراءة ${timeText(last)} · الكمية لكل فترة رصد`};
  }
  window.NawafidhRain={setVisible,load};
})();
