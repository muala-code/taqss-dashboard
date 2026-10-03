(() => {
  const $=s=>document.querySelector(s); let session=null, timer=null, busy=false, ending=false, attemptSettings=null;
  const base=(window.TAQSS_CONFIG.enrichmentApiBase || window.TAQSS_CONFIG.quizApiBase || window.TAQSS_CONFIG.dashboardApiBase).replace(/\/$/,'');
  async function request(path,body){const r=await fetch(base+'/api/quiz/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error||'تعذر الاتصال');return d;}
  function seen(){try{return JSON.parse(localStorage.getItem('taqss-quiz-seen')||'[]').slice(-500);}catch{return [];}}
  function remember(ids){try{localStorage.setItem('taqss-quiz-seen',JSON.stringify([...new Set([...seen(),...ids])].slice(-500)));}catch{}}
  function button(text,fn){const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=fn;return b;}
  function showSetup(){ $('#quizSetup').hidden=false; $('#quizOptions').hidden=false; $('#quizOptions').open=false; $('#quizStart').hidden=false; updateCounts(false); }
  function finish(d,technical=false){clearInterval(timer);session=null;busy=false;$('#quizPlay').hidden=true;showSetup();const root=$('#quizResult');root.hidden=false;root.replaceChildren();
    if(technical){const p=document.createElement('p');p.textContent='انتهت المسابقة بخطأ فني بسبب مغادرة الشاشة.';root.append(p);return;}
    const score=document.createElement('div');score.className='quiz-score';const pct=Math.round(100*d.correct/d.total);score.style.setProperty('--score',pct+'%');score.textContent=pct+'%';score.setAttribute('aria-label','الدرجة '+pct+' بالمئة');root.append(score);
    const summary=document.createElement('p');summary.textContent=`${d.correct} صحيحة · ${d.wrong} خاطئة · ${d.timeout} انتهى وقتها — من ${d.total}`;root.append(summary);
    for(const a of d.review){const item=document.createElement('details'),title=document.createElement('summary'),p=document.createElement('p');title.textContent=(a.ok?'✓ ':a.timeout?'⌛ ':'✗ ')+a.question;p.textContent='الإجابة الصحيحة: '+a.answer+(a.explanation?' — '+a.explanation:'');item.append(title,p);root.append(item);}
  }
  function render(d){session=d;remember([d.question.id]);const root=$('#quizPlay');root.hidden=false;root.replaceChildren();$('#quizResult').hidden=true;
    const head=document.createElement('div');head.className='quiz-info';
    const counter=document.createElement('span');counter.className='quiz-counter';counter.textContent=`${d.index+1} / ${d.total}`;counter.setAttribute('aria-label',`السؤال ${d.index+1} من ${d.total}`);
    const level=document.createElement('span');level.textContent='المستوى: '+attemptSettings.difficultyLabel;
    const category=document.createElement('span');category.textContent='المجال: '+attemptSettings.categoryLabel;
    const time=document.createElement('span');time.className='quiz-time';
    const timeLabel=document.createElement('span');timeLabel.textContent='زمن الإجابة';
    const clock=document.createElement('span');clock.className='quiz-time-track';clock.setAttribute('role','progressbar');clock.setAttribute('aria-label','الوقت المتبقي للإجابة');clock.setAttribute('aria-valuemin','0');clock.setAttribute('aria-valuemax','30');
    const fill=document.createElement('span');fill.className='quiz-time-fill';clock.append(fill);time.append(timeLabel,clock);head.append(counter,level,category,time);root.append(head);
    const question=document.createElement('div');question.className='quiz-question';const text=document.createElement('h3');text.textContent=d.question.text;question.append(text);
    if(d.question.image){const img=document.createElement('img');img.src=d.question.image;img.alt=d.question.imageAlt||'صورة السؤال';img.onerror=()=>{$('#quizStatus').textContent='تعذر عرض الصورة. أعد المحاولة عند توفر الاتصال.';session=null;clearInterval(timer);showSetup();root.hidden=true;};question.append(img);}root.append(question);
    const cards=document.createElement('div');cards.className='quiz-answers';d.question.options.forEach((v,i)=>cards.append(button(v,()=>answer(i))));root.append(cards);
    clearInterval(timer);const end=performance.now()+d.remainingMs;
    const tick=()=>{const ms=Math.max(0,end-performance.now()),left=Math.ceil(ms/1000);fill.style.transform=`scaleX(${Math.min(1,ms/30000)})`;clock.setAttribute('aria-valuenow',String(left));clock.setAttribute('aria-valuetext',left+' ثانية متبقية');time.classList.toggle('quiz-urgent',left<=5);if(ms===0)answer(null);};
    tick();timer=setInterval(tick,100);

  }
  async function answer(choice){if(!session||busy||ending)return;const currentToken=session.token;busy=true;clearInterval(timer);$('#quizPlay').querySelectorAll('button').forEach(b=>b.disabled=true);try{const d=await request('answer',{token:session.token,choice});if(session?.token!==currentToken)return;busy=false;if(d.done)finish(d);else render(d);}catch(e){if(session?.token!==currentToken)return;session=null;busy=false;$('#quizPlay').hidden=true;showSetup();$('#quizStatus').textContent='انتهت المحاولة لتعذر الاتصال: '+e.message;}}
  function abort(){if(!session)return;ending=true;finish({},true);ending=false;}
  document.addEventListener('visibilitychange',()=>{if(document.hidden)abort();});window.addEventListener('blur',abort);window.addEventListener('pagehide',abort);
  document.addEventListener('taqss:tab-change',e=>{if(e.detail!=='quiz')abort();});
  let counts=null,optionsLoading=false;
  function updateCounts(announce=true){if(!counts)return;const available=counts[$('#quizCategory').value+':'+$('#quizDifficulty').value]||0;const select=$('#quizCount');Array.from(select.options).forEach(o=>o.disabled=Number(o.value)>available);if(select.selectedOptions[0].disabled){const allowed=Array.from(select.options).find(o=>!o.disabled);if(allowed)select.value=allowed.value;}$('#quizStart').disabled=available<5;if(announce)$('#quizStatus').textContent=available<5?'لا تتوفر أسئلة كافية لهذا الاختيار حاليًا. اختر مجالًا آخر.':`المتاح لهذا الاختيار: ${available} سؤالًا.`;}
  async function loadOptions(){if(counts||optionsLoading)return;optionsLoading=true;try{const r=await fetch(base+'/api/quiz/options');if(r.ok){counts=(await r.json()).counts;updateCounts();}}catch{}finally{optionsLoading=false;}}
  $('#quizCategory').addEventListener('change',updateCounts);$('#quizDifficulty').addEventListener('change',updateCounts);
  document.addEventListener('taqss:tab-change',e=>{if(e.detail==='quiz')loadOptions();});if($('#panel-quiz').classList.contains('active'))loadOptions();
  $('#quizSetup').addEventListener('submit',async e=>{e.preventDefault();if(busy)return;busy=true;$('#quizStatus').textContent='جارٍ تجهيز أسئلة عشوائية…';$('#quizStart').disabled=true;
    const difficulty=$('#quizDifficulty'),category=$('#quizCategory');
    attemptSettings={difficulty:difficulty.value,category:category.value,difficultyLabel:difficulty.selectedOptions[0].textContent,categoryLabel:category.selectedOptions[0].textContent};
    try{const d=await request('start',{count:Number($('#quizCount').value),difficulty:attemptSettings.difficulty,category:attemptSettings.category,seen:seen()});if(document.hidden||!$('#panel-quiz').classList.contains('active'))return;$('#quizOptions').open=false;$('#quizOptions').hidden=true;$('#quizStart').hidden=true;$('#quizStatus').textContent=d.notice||'';render(d);}catch(e){$('#quizStatus').textContent=e.message;}finally{busy=false;$('#quizStart').disabled=false;updateCounts(false);}
  });
})();
