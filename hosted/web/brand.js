'use strict';
// One approved brand source, reused without changing the artwork file.
(()=>{
  const rail=document.createElement('div');
  rail.className='brand-rail';
  const home=document.createElement('a');
  home.className='brand-home';home.href='/';home.setAttribute('aria-label','SharePass by Bullseye Entertainment · opening');
  const mark=document.createElement('span');mark.className='bullseye-mark';mark.setAttribute('aria-hidden','true');
  const wordmark=document.createElement('span');wordmark.className='sharepass-wordmark';wordmark.append('Share');
  const accent=document.createElement('span');accent.textContent='Pass';wordmark.append(accent);
  home.append(mark,wordmark);rail.append(home);document.body.prepend(rail);
  document.body.classList.add('sharepass-brand');
  for(const title of document.querySelectorAll('.shell>header>strong')){
    if(title.textContent.trim()==='SharePass')title.remove();
  }
  const art=document.querySelector('.opening .brand');
  if(art){
    art.classList.add('brand-illustration');
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    if(!reduced){
      for(const part of ['signature','handoff','receiving','title']){
        const layer=document.createElement('span');layer.className='logo-slice logo-'+part;
        layer.setAttribute('aria-hidden','true');art.append(layer);
      }
      art.classList.add('brand-motion');
    }
  }
  const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Attribute changes cover page and wizard transitions; buttons stay operable
  // throughout the animation and OS reduced-motion preference is respected.
  const observer=new MutationObserver(changes=>{
    if(reduced())return;
    for(const {target} of changes){
      if(target.hidden||!target.matches('main>section,[data-wizard-page],.admin-card'))continue;
      target.animate?.([{opacity:.3,transform:'translateY(6px)'},{opacity:1,transform:'none'}],
        {duration:180,easing:'cubic-bezier(.2,.7,.2,1)'});
    }
  });
  observer.observe(document.body,{subtree:true,attributes:true,attributeFilter:['hidden']});
})();

window.sharePassCopyText=async(text,status)=>{
  try{
    if(navigator.clipboard?.writeText)await navigator.clipboard.writeText(text);
    else{
      const field=document.createElement('textarea');field.value=text;field.readOnly=true;
      field.className='copy-buffer';document.body.append(field);field.select();
      const copied=document.execCommand('copy');field.remove();
      if(!copied)throw new Error('Copy unavailable');
    }
    if(status)status.textContent='Copied';
    return true;
  }catch{
    if(status)status.textContent='Select the code or link to copy it.';
    return false;
  }
};
