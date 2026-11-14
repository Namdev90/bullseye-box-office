'use strict';
// A deliberate input gesture; permissions and custody remain server-authoritative.
window.sharePassHold=(button,{ready,signature,confirm,status})=>{
  const label=document.createElement('span'),progress=document.createElement('progress');
  label.textContent=button.textContent;progress.max=2000;progress.value=0;progress.setAttribute('aria-hidden','true');
  button.replaceChildren(label,progress);button.classList.add('hold-confirm');
  let active=false,started=0,snapshot,timer,physical=-Infinity;
  const cancel=()=>{if(!active)return;active=false;clearTimeout(timer);progress.value=0;button.classList.remove('holding');status.textContent='Hold cancelled.';};
  const valid=()=>!button.disabled&&button.isConnected!==false&&!document.hidden&&!button.closest('[hidden]')&&signature()===snapshot;
  function finish(){
    if(!active)return;
    try{
      if(!valid()){cancel();return;}
      if(performance.now()-started<2000)return;
      active=false;clearTimeout(timer);progress.value=0;button.classList.remove('holding');status.textContent='Recording handover…';
      confirm();
    }catch(error){cancel();status.textContent=error.message;}
  }
  function tick(){
    if(!active)return;
    try{if(!valid()){cancel();return;}}catch{cancel();return;}
    progress.value=Math.min(2000,performance.now()-started);
    if(progress.value>=2000)finish();else timer=setTimeout(tick,40);
  }
  function start(){
    if(active){cancel();return;}
    try{if(button.disabled||document.hidden||!ready())return;snapshot=signature();}
    catch(error){status.textContent=error.message;return;}
    active=true;started=performance.now();progress.value=0;button.classList.add('holding');status.textContent='Keep holding for two seconds. Release to cancel.';timer=setTimeout(tick,40);
  }
  const inside=event=>{const r=button.getBoundingClientRect();return event.clientX>=r.left&&event.clientX<=r.right&&event.clientY>=r.top&&event.clientY<=r.bottom;};
  button.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();physical=performance.now();button.focus({preventScroll:true});button.setPointerCapture?.(event.pointerId);start();});
  button.addEventListener('pointermove',event=>{if(active&&!inside(event))cancel();});
  button.addEventListener('pointerup',event=>{physical=performance.now();if(active&&inside(event)&&performance.now()-started>=2000)finish();else cancel();});
  for(const type of ['pointercancel','lostpointercapture','blur'])button.addEventListener(type,cancel);
  button.addEventListener('keydown',event=>{if(![' ','Enter'].includes(event.key))return;event.preventDefault();physical=performance.now();if(!event.repeat)start();});
  button.addEventListener('keyup',event=>{if(![' ','Enter'].includes(event.key))return;event.preventDefault();physical=performance.now();if(active&&performance.now()-started>=2000)finish();else cancel();});
  // Assistive activation has no held-pointer events: provide the same cancellable two-second interval.
  button.addEventListener('click',event=>{event.preventDefault();if(event.detail===0&&performance.now()-physical>300)start();});
  button.addEventListener('contextmenu',event=>event.preventDefault());
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});
  window.addEventListener('blur',cancel);window.addEventListener('pagehide',cancel);
  return {cancel,setLabel:text=>{label.textContent=text;button.setAttribute('aria-label',text);}};
};
