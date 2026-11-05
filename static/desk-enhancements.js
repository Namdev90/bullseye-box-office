// Small keyboard and balance-preview improvements; mutations remain in the custody engine.
'use strict';
document.addEventListener('keydown',event=>{ if(event.key==='/' && !document.querySelector('dialog[open]') && !['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)){ event.preventDefault(); document.querySelector('#search').focus(); }});
document.querySelector('#clear-search').addEventListener('click',()=>{document.querySelector('#search').value='';document.querySelector('[data-filter="ALL"]').click();document.querySelector('#search').focus();});
document.addEventListener('input',event=>{
 const form=event.target.closest('#release-form'); if(!form)return;
 let preview=form.querySelector('.release-preview'); if(!preview){preview=document.createElement('div');preview.className='release-preview';preview.setAttribute('role','status');form.querySelector('.quantity-grid').after(preview);}
 const inputs=[...form.querySelectorAll('input[type="number"]')];
 preview.textContent='After this pickup: '+inputs.map(input=>{const left=Number(input.max)-Number(input.value);return (left>=0?left:'Over limit')+' '+(input.name==='normal'?'Normal':input.name.toUpperCase());}).join(' · ')+' remain';
});
document.addEventListener('click',event=>{if(event.detail>1 && event.target.closest('button')){event.preventDefault();event.stopImmediatePropagation();}},true);
