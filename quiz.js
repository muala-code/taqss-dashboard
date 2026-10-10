/* Pure quiz logic, bundled into quiz.js at packaging. */
function createQuizEngine(){
 const shuffle=a=>{a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
 function validate(payload){if(payload?.schemaVersion!==1||typeof payload.version!=='string'||!Array.isArray(payload.questions)||payload.questions.length<30||payload.questions.length>10000)throw Error('نسخة بنك الأسئلة غير صالحة.');const ids=new Set();for(const q of payload.questions){if(!q||typeof q.id!=='string'||ids.has(q.id)||typeof q.text!=='string'||!q.text.trim()||!Array.isArray(q.options)||q.options.length!==4||q.options.some(o=>typeof o!=='string'||!o.trim())||new Set(q.options).size!==4||!Number.isInteger(q.correct)||q.correct<0||q.correct>3||!['easy','medium','hard'].includes(q.difficulty)||!['general','sports','islam','science','geography','history','language','riddle'].includes(q.category))throw Error('توجد أسئلة غير صالحة في النسخة الجديدة.');ids.add(q.id);}return payload;}
 function pick(bank,settings,seen){const available=bank.filter(q=>q.difficulty===settings.difficulty&&(settings.category==='mixed'||q.category===settings.category));if(available.length<settings.count)throw Error('لا تتوفر أسئلة كافية لهذا الاختيار.');const visited=new Set(seen),fresh=available.filter(q=>!visited.has(q.id)),out=[];
  function deal(rows){const byCategory=new Map();for(const q of shuffle(rows)){if(!byCategory.has(q.category))byCategory.set(q.category,new Map());const topics=byCategory.get(q.category),topic=q.topic||q.id;if(!topics.has(topic))topics.set(topic,[]);topics.get(topic).push(q);}const categories=shuffle([...byCategory.values()]).map(topics=>shuffle([...topics.values()]));const indices=categories.map(()=>0);while(out.length<settings.count&&categories.some(topics=>topics.some(t=>t.length))){for(let c=0;c<categories.length&&out.length<settings.count;c++){const topics=categories[c];let searched=0;while(searched<topics.length&&!topics[indices[c]%topics.length].length){indices[c]++;searched++;}if(searched<topics.length)out.push(topics[indices[c]++%topics.length].pop());}}}
  deal(fresh);if(out.length<settings.count)deal(available.filter(q=>visited.has(q.id)));return {reused:fresh.length<settings.count,questions:out.map(q=>{const options=shuffle(q.options);return {...q,options,correct:options.indexOf(q.options[q.correct])};})};}
 function grade(question,choice,deadline,now){const timeout=choice===null||now>=deadline;return {question:question.text,answer:question.options[question.correct],explanation:question.explanation,source:question.source,sourceUrl:question.sourceUrl,ok:!timeout&&choice===question.correct,timeout};}
 return {validate,pick,grade};
}

(() => {
  const engine=createQuizEngine();
  let localBank=null, localAttempt=null, bankLoading=null, refreshing=false;
  const $=s=>document.querySelector(s); let session=null, timer=null, busy=false, ending=false, attemptSettings=null;
  async function fetchJson(url){const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),25000);try{const r=await fetch(url,{signal:controller.signal,cache:'no-store'});const d=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(Error(d.error||'تعذر الاتصال'),{status:r.status});return d;}finally{clearTimeout(timeout);}}
  const bankKey='taqss-quiz-bank-v1',week=7*86400000;
  function stored(){try{return JSON.parse(localStorage.getItem(bankKey)||'null');}catch{return null;}}
  function setCounts(){counts={};for(const q of localBank.questions){for(const category of [q.category,'mixed']){const k=category+':'+q.difficulty;counts[k]=(counts[k]||0)+1;}}updateCounts(false);}
  function saveBank(payload,updatedAt){const item={payload,updatedAt};try{localStorage.setItem(bankKey,JSON.stringify(item));}catch{}localBank=payload;setCounts();updateBankLabel(updatedAt);}
  function updateBankLabel(updatedAt){const next=updatedAt?updatedAt+week:0;refreshButton.disabled=refreshing||(next>Date.now());bankLabel.textContent=localBank?`البنك المحلي: ${localBank.questions.length} سؤالًا`+(next>Date.now()?` · التحديث التالي ${new Date(next).toLocaleDateString('ar-SA-u-ca-gregory')}`:''):'';}
  async function ensureBank(){if(localBank)return localBank;if(bankLoading)return bankLoading;bankLoading=(async()=>{const item=stored();if(item?.payload){try{localBank=engine.validate(item.payload);setCounts();updateBankLabel(item.updatedAt);return localBank;}catch{}}
    const payload=engine.validate(await fetchJson(new URL('quiz-bank.json',document.baseURI)));saveBank(payload,0);return payload;})();try{return await bankLoading;}finally{bankLoading=null;}}
  async function refreshBank(){if(refreshing||session)return;const item=stored();if(item?.updatedAt&&Date.now()-item.updatedAt<week){updateBankLabel(item.updatedAt);return;}refreshing=true;refreshButton.disabled=true;$('#quizStatus').textContent='جارٍ التحقق من أحدث نسخة للبنك…';try{const payload=engine.validate(await fetchJson(new URL('quiz-bank.json',document.baseURI)));if(session)return;const oldVersion=localBank?.version;saveBank(payload,Date.now());$('#quizStatus').textContent=oldVersion===payload.version?'البنك محدث بالفعل؛ لا توجد نسخة جديدة.':'تم تحديث بنك الأسئلة وحفظه على هذا الجهاز.';}catch(e){$('#quizStatus').textContent='تعذر تحديث البنك؛ بقيت النسخة السابقة متاحة. '+e.message;}finally{refreshing=false;updateBankLabel(stored()?.updatedAt||0);}}
  const refreshButton=button('تحديث البنك',refreshBank),bankLabel=document.createElement('p');bankLabel.className='quiz-bank-label';$('#quizOptions').append(refreshButton,bankLabel);
  const credit=document.createElement('p');credit.className='quiz-bank-credit';credit.innerHTML='أسئلة منتقاة من <a href="https://github.com/mbzuai-nlp/ArabicMMLU" target="_blank" rel="noopener">ArabicMMLU</a> مع بنك الموقع السابق · <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener">CC BY-NC-SA 4.0</a> · جرى الانتقاء وتعديل بعض الصياغات وتقدير الصعوبة.';$('#quizOptions').append(credit);
  const uiStyle=document.createElement('style');uiStyle.textContent='.quiz-progress{display:flex;align-items:center;gap:.55rem;margin:.4rem 0 .6rem;font-size:.8rem}.quiz-progress-track{height:6px;flex:1;background:#8398a333;border-radius:9px;overflow:hidden}.quiz-progress-fill{display:block;height:100%;background:#258b70;transition:width .2s}.quiz-bank-label,.quiz-bank-credit{font-size:.75rem;line-height:1.5;margin:.4rem 0}.quiz-bank-credit a{color:inherit}.quiz-review-source{font-size:.75rem;opacity:.8}';document.head.append(uiStyle);
  async function request(path,body){
    if(path==='start'){await ensureBank();const picked=engine.pick(localBank.questions,body,body.seen||[]);localAttempt={questions:picked.questions,index:0,answers:[],deadline:Date.now()+30000,id:crypto.randomUUID()};return localView(picked.reused?'شاهدت معظم أسئلة هذا الاختيار؛ استُخدمت أسئلة جديدة أولًا وقد يتكرر الباقي.':'');}
    if(path==='answer'){if(!localAttempt||body.token!==localAttempt.id+':'+localAttempt.index)throw Error('المحاولة غير صالحة.');const a=localAttempt;const q=a.questions[a.index];a.answers.push(engine.grade(q,body.choice,a.deadline,Date.now()));a.index++;if(a.index===a.questions.length){const correct=a.answers.filter(x=>x.ok).length,timeout=a.answers.filter(x=>x.timeout).length;const result={done:true,total:a.questions.length,correct,timeout,wrong:a.questions.length-correct-timeout,review:a.answers};localAttempt=null;return result;}a.deadline=Date.now()+30000;return localView();}
    throw Error('طلب غير صالح.');
  }
  function localView(notice=''){const a=localAttempt,q=a.questions[a.index];return {token:a.id+':'+a.index,index:a.index,total:a.questions.length,remainingMs:Math.max(0,a.deadline-Date.now()),notice,question:q};}
  function seen(){try{return JSON.parse(localStorage.getItem('taqss-quiz-seen')||'[]').slice(-500);}catch{return [];}}
  function remember(ids){try{localStorage.setItem('taqss-quiz-seen',JSON.stringify([...new Set([...seen(),...ids])].slice(-500)));}catch{}}
  function button(text,fn){const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=fn;return b;}
  function showSetup(){ $('#quizSetup').hidden=false; $('#quizOptions').hidden=false; $('#quizOptions').open=false; $('#quizStart').hidden=false;refreshButton.disabled=refreshing;updateBankLabel(stored()?.updatedAt||0);updateCounts(false); }
  function finish(d,technical=false){clearInterval(timer);session=null;localAttempt=null;busy=false;$('#quizPlay').hidden=true;showSetup();const root=$('#quizResult');root.hidden=false;root.replaceChildren();
    if(technical){const p=document.createElement('p');p.textContent='انتهت المسابقة بخطأ فني بسبب مغادرة الشاشة.';root.append(p);return;}
    const score=document.createElement('div');score.className='quiz-score';const pct=Math.round(100*d.correct/d.total);score.style.setProperty('--score',pct+'%');score.textContent=pct+'%';score.setAttribute('aria-label','الدرجة '+pct+' بالمئة');root.append(score);
    const done=document.createElement('p');done.className='quiz-progress';done.textContent=`أُنجز ${d.total} من ${d.total}`;root.append(done);
    const row=document.createElement('div');row.className='quiz-result-summary';
    const summary=document.createElement('p');summary.textContent=`${d.correct} صحيحة · ${d.wrong} خاطئة · ${d.timeout} انتهى وقتها — من ${d.total}`;
    const review=document.createElement('div');review.id='quizReview';review.hidden=true;
    const toggle=button('عرض الإجابات',()=>{review.hidden=!review.hidden;toggle.textContent=review.hidden?'عرض الإجابات':'إخفاء الإجابات';toggle.setAttribute('aria-expanded',String(!review.hidden));});
    toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-controls',review.id);row.append(summary,toggle);root.append(row,review);
    for(const a of d.review){
      const item=document.createElement('details'),title=document.createElement('summary'),mark=document.createElement('span'),text=document.createElement('span'),p=document.createElement('p');
      mark.className=a.ok?'quiz-review-correct':'quiz-review-wrong';mark.textContent=a.ok?'✓':'✗';mark.setAttribute('aria-label',a.ok?'إجابة صحيحة':a.timeout?'انتهى الوقت':'إجابة خاطئة');
      text.textContent=a.question+(a.timeout?' — انتهى الوقت':'');title.append(mark,text);
      p.textContent='الإجابة الصحيحة: '+a.answer+(a.explanation?' — '+a.explanation:'');item.append(title,p);if(a.source){const source=document.createElement('p');source.className='quiz-review-source';source.textContent='المصدر: '+a.source;item.append(source);}review.append(item);
    }
  }
  function render(d){session=d;remember([d.question.id]);const root=$('#quizPlay');root.hidden=false;root.replaceChildren();$('#quizResult').hidden=true;
    const head=document.createElement('div');head.className='quiz-info';
    const counter=document.createElement('span');counter.className='quiz-counter';counter.textContent=`${d.index+1} / ${d.total}`;counter.setAttribute('aria-label',`السؤال ${d.index+1} من ${d.total}`);
    const time=document.createElement('span');time.className='quiz-time';
    const timeLabel=document.createElement('span');timeLabel.textContent='زمن الإجابة';
    const clock=document.createElement('span');clock.className='quiz-time-track';clock.setAttribute('role','progressbar');clock.setAttribute('aria-label','الوقت المتبقي للإجابة');clock.setAttribute('aria-valuemin','0');clock.setAttribute('aria-valuemax','30');
    const fill=document.createElement('span');fill.className='quiz-time-fill';clock.append(fill);time.append(timeLabel,clock);head.append(counter,time);root.append(head);
    const progress=document.createElement('div');progress.className='quiz-progress';
    const progressLabel=document.createElement('span');progressLabel.textContent=`أُنجز ${d.index} من ${d.total}`;
    const progressTrack=document.createElement('div');progressTrack.className='quiz-progress-track';progressTrack.setAttribute('role','progressbar');progressTrack.setAttribute('aria-label','تقدم المسابقة');progressTrack.setAttribute('aria-valuemin','0');progressTrack.setAttribute('aria-valuemax',String(d.total));progressTrack.setAttribute('aria-valuenow',String(d.index));
    const progressFill=document.createElement('span');progressFill.className='quiz-progress-fill';progressFill.style.width=(100*d.index/d.total)+'%';progressTrack.append(progressFill);progress.append(progressLabel,progressTrack);root.append(progress);
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
  async function loadOptions(){if(localBank||optionsLoading)return;optionsLoading=true;try{await ensureBank();updateCounts();}catch(e){$('#quizStatus').textContent='تعذر تحميل بنك الأسئلة المحلي: '+e.message;}finally{optionsLoading=false;}}
  $('#quizCategory').addEventListener('change',updateCounts);$('#quizDifficulty').addEventListener('change',updateCounts);
  document.addEventListener('taqss:tab-change',e=>{if(e.detail==='quiz')loadOptions();});if($('#panel-quiz').classList.contains('active'))loadOptions();
  $('#quizSetup').addEventListener('submit',async e=>{e.preventDefault();if(busy||refreshing)return;busy=true;$('#quizStatus').textContent='جارٍ تجهيز أسئلة عشوائية…';$('#quizStart').disabled=true;
    const difficulty=$('#quizDifficulty'),category=$('#quizCategory');
    attemptSettings={difficulty:difficulty.value,category:category.value,difficultyLabel:difficulty.selectedOptions[0].textContent,categoryLabel:category.selectedOptions[0].textContent};
    try{const d=await request('start',{count:Number($('#quizCount').value),difficulty:attemptSettings.difficulty,category:attemptSettings.category,seen:seen()});if(document.hidden||!$('#panel-quiz').classList.contains('active')){localAttempt=null;return;}$('#quizOptions').open=false;$('#quizOptions').hidden=true;$('#quizStart').hidden=true;refreshButton.disabled=true;$('#quizStatus').textContent=d.notice||'';render(d);}catch(e){$('#quizStatus').textContent=e.message;}finally{busy=false;$('#quizStart').disabled=false;updateCounts(false);}
  });
})();
