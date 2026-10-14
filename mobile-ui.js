/* In-page option pickers and mobile page gesture policy. */
(() => {
  'use strict';
  let open=null;
  function closePicker(focus=false){if(!open)return;const {menu,button}=open;open=null;menu.remove();button.setAttribute('aria-expanded','false');if(focus)button.focus({preventScroll:true});}
  function enhanceSelect(select){
    if(!select)return;
    const button=document.createElement('button');button.type='button';button.className='nawafidh-picker-button';button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');
    const text=document.createElement('span'),arrow=document.createElement('span');arrow.textContent='▾';arrow.setAttribute('aria-hidden','true');button.append(text,arrow);
    const label=select.closest('label');
    const name=select.getAttribute('aria-label')||Array.from(label?.childNodes||[]).filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim()||'اختيار';
    select.classList.add('nawafidh-native-select');select.tabIndex=-1;select.setAttribute('aria-hidden','true');select.after(button);
    function sync(){text.textContent=select.selectedOptions[0]?.textContent||'اختيار';button.disabled=select.disabled;button.setAttribute('aria-label',`${name}: ${text.textContent}`);}
    function show(){
      if(open?.button===button){closePicker();return;}closePicker();sync();if(button.disabled)return;
      const menu=document.createElement('div');menu.className='nawafidh-picker-menu';menu.setAttribute('role','listbox');menu.setAttribute('aria-label',name);menu.id=`${select.id}-menu`;button.setAttribute('aria-controls',menu.id);
      for(const option of select.options){const choice=document.createElement('button');choice.type='button';choice.textContent=option.textContent;choice.disabled=option.disabled;choice.setAttribute('role','option');choice.setAttribute('aria-selected',String(option.selected));choice.addEventListener('click',()=>{if(choice.disabled)return;select.value=option.value;select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));sync();closePicker(true);});menu.append(choice);}
      menu.addEventListener('keydown',event=>{const choices=[...menu.querySelectorAll('button:not(:disabled)')],index=choices.indexOf(document.activeElement);let next;if(event.key==='ArrowDown')next=choices[(index+1)%choices.length];if(event.key==='ArrowUp')next=choices[(index-1+choices.length)%choices.length];if(event.key==='Home')next=choices[0];if(event.key==='End')next=choices.at(-1);if(next){event.preventDefault();next.focus();}});
      document.body.append(menu);open={button,menu};button.setAttribute('aria-expanded','true');
      const r=button.getBoundingClientRect();menu.style.width=Math.min(Math.max(r.width,180),innerWidth-16)+'px';const m=menu.getBoundingClientRect();
      menu.style.left=Math.max(8,Math.min(r.right-m.width,innerWidth-m.width-8))+'px';menu.style.top=Math.max(8,Math.min(r.bottom+m.height+4<=innerHeight?r.bottom+4:r.top-m.height-4,innerHeight-m.height-8))+'px';
      (menu.querySelector('[aria-selected=true]:not(:disabled)')||menu.querySelector('button:not(:disabled)'))?.focus({preventScroll:true});
    }
    button.addEventListener('click',event=>{event.preventDefault();show();});select.addEventListener('change',sync);
    new MutationObserver(()=>{sync();if(open?.button===button)closePicker();}).observe(select,{attributes:true,childList:true,subtree:true});sync();
  }
  for(const id of ['quizCategory','quizDifficulty','quizCount','satelliteChannel'])enhanceSelect(document.getElementById(id));
  document.addEventListener('click',event=>{if(open&&!open.menu.contains(event.target)&&!open.button.contains(event.target))closePicker();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&open){event.preventDefault();closePicker(true);}else if(event.key==='Tab')closePicker();});
  window.addEventListener('resize',()=>closePicker());
  document.addEventListener('taqss:tab-change',()=>closePicker());
  document.addEventListener('scroll',event=>{if(open&&!open.menu.contains(event.target)&&!event.target?.closest?.('.index-ticker'))closePicker();},true);
  // The viewport hint is insufficient on several mobile browsers. Block only
  // browser-level multi-touch page scaling; internal image/map handlers remain active.
  let multiTouch=false;
  const internalZoom=target=>!!target?.closest?.('#weatherLeafletMap,.satellite-picture:fullscreen,.satellite-picture.satellite-full');
  document.addEventListener('touchstart',event=>{if(event.touches.length>1){multiTouch=true;if(!internalZoom(event.target)&&event.cancelable)event.preventDefault();}},{passive:false});
  document.addEventListener('touchmove',event=>{if((multiTouch||event.touches.length>1)&&!internalZoom(event.target)&&event.cancelable)event.preventDefault();},{passive:false});
  document.addEventListener('touchend',event=>{if(!event.touches.length)multiTouch=false;},{passive:true});
  document.addEventListener('touchcancel',()=>{multiTouch=false;},{passive:true});
  for(const type of ['gesturestart','gesturechange'])document.addEventListener(type,event=>{if(!internalZoom(event.target)&&event.cancelable)event.preventDefault();},{passive:false});
})();
