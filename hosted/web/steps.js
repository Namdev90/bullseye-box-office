'use strict';

window.sharePassMorph=element=>{
  if(!matchMedia('(prefers-reduced-motion: reduce)').matches){
    element.animate([{opacity:.7,transform:'translateY(7px) scale(.99)'},{opacity:1,transform:'none'}],
      {duration:170,easing:'ease-out'});
  }
};

window.sharePassSteps=(form,{validate=()=>true,onShow=()=>{}}={})=>{
  const pages=()=>[...form.querySelectorAll('[data-wizard-page]')];
  const next=form.querySelector('[data-wizard-next]');
  const finishLabel=next.textContent;
  const nav=next.parentElement;
  const back=document.createElement('button');
  back.type='button';
  back.textContent='Back';
  const progress=document.createElement('span');
  progress.className='wizard-progress';
  progress.setAttribute('aria-live','polite');
  nav.prepend(back,progress);
  form.noValidate=true;
  let current=0;

  function show(page=0,focus=true){
    const list=pages();
    const previous=list[current];
    current=typeof page==='number'?Math.max(0,Math.min(page,list.length-1)):Math.max(0,list.indexOf(page));
    list.forEach((entry,index)=>entry.hidden=index!==current);
    back.hidden=current===0;
    progress.textContent='Step '+(current+1)+' of '+list.length;
    next.textContent=current===list.length-1?finishLabel:list[current].dataset.nextLabel||'Next';
    onShow(list[current]);
    if(focus&&previous!==list[current])window.sharePassMorph(list[current]);
    if(focus){
      const target=list[current].querySelector('legend, h2, h3')||list[current];
      target.tabIndex=-1;
      target.focus();
    }
  }

  function valid(page){
    const invalid=[...page.querySelectorAll('input, select, textarea')].find(field=>!field.validity.valid);
    if(invalid){show(page,false);invalid.reportValidity();return false;}
    if(validate(page))return true;
    show(page,false);
    return false;
  }

  back.onclick=()=>show(current-1);
  form.addEventListener('submit',event=>{
    const list=pages();
    const passed=valid(list[current]);
    if(!passed||current<list.length-1){
      event.preventDefault();
      event.stopImmediatePropagation();
      if(passed)show(current+1);
      return;
    }
    for(const page of list.slice(0,-1)){
      if(!valid(page)){event.preventDefault();event.stopImmediatePropagation();return;}
    }
  },true);
  show(0,false);
  return {show};
};
