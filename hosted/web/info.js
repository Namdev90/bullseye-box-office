'use strict';
(()=>{
  const dialog=document.createElement('dialog');
  dialog.className='info-dialog';
  dialog.setAttribute('aria-label','Information');
  const copy=document.createElement('p');
  const form=document.createElement('form');
  form.method='dialog';
  const close=document.createElement('button');
  close.textContent='Close';
  form.append(close);
  dialog.append(copy,form);
  document.body.append(dialog);
  let openedBy;
  document.addEventListener('click',event=>{
    const trigger=event.target.closest('button[data-info]');
    if(!trigger)return;
    openedBy=trigger;
    copy.textContent=trigger.dataset.info;
    dialog.showModal();
  });
  dialog.addEventListener('close',()=>openedBy?.focus());
})();
