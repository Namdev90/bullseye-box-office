'use strict';
(()=>{
 const request=async(path,body=null)=>{
  const response=await fetch(path,{credentials:'same-origin',cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
  const result=await response.json();
  if(!response.ok){const error=new Error(result.error||'The shared desk is unavailable.');error.status=response.status;error.notExecuted=result.notExecuted===true;throw error;}
  if(path.startsWith('/api/state?')){
   const overview=document.querySelector('#hosted-booths');
   if(overview)for(const booth of result.booths){
    const label=overview.querySelector('[data-booth="'+booth.id+'"]');
    const packets=result.deposits.filter(packet=>packet.booth_id===booth.id);
    const count=packets.reduce((sum,packet)=>sum+Object.values(packet.remaining).reduce((n,q)=>n+q,0),0);
    if(label)label.textContent=booth.label+' · '+count+' available';
   }
  }
  return result;
 };
 window.SharePassHost={
  store:{request,addPassType(){throw new Error('This register uses Normal, VIP and VVIP.');}},
  connect:()=>request('/api/context'),
  recordNotice(deposit){
   return deposit.booth_id!==window.sharePassContext?.booth_id?'<p class="error" role="alert">Pickup blocked at this booth. Check the recorded booth and shelf.</p>':'';
  }
 };
 document.addEventListener('DOMContentLoaded',()=>{
  document.querySelector('#mock-google').textContent='Enter shared register';
  document.querySelector('#sign-in-panel .access-note').textContent='Your ChatGPT account opens the same register on your phone and laptop.';
  document.querySelector('.practice-disclosure').textContent='Shared register · signed-in account only · synthetic testing · manual sharing';
  document.querySelector('#try-demo').closest('.practice-tools')?.classList.add('hidden');
  document.querySelector('#mock-admin').hidden=true;
  document.querySelector('#type-form').hidden=true;
  window.sharePassCollectionFields=()=> '';
  document.querySelector('#expire-evidence').closest('details').hidden=true;
  const channels=document.querySelector('.channel-choice');
  if(channels)channels.hidden=true;
  const details=document.querySelectorAll('#connections-dialog dd');
  if(details[0])details[0].textContent='ChatGPT sign-in · this account only.';
  if(details[1])details[1].textContent='Records are saved online and refreshed on each connected device.';
  const stock=document.querySelector('.stock-strip');
  stock.insertAdjacentHTML('beforebegin','<div class="hosted-overview" aria-label="Shared register overview"><div id="hosted-booths" class="hosted-booths"><span data-booth="B1">Booth 1</span><span data-booth="B2">Booth 2</span></div><nav aria-label="Desk views"><button type="button" class="button secondary" id="hosted-pending">Pending handovers</button><button type="button" class="button secondary" id="hosted-history">Activity</button></nav></div>');
  document.querySelector('#hosted-pending').addEventListener('click',()=>document.querySelector('[data-filter="RELEASE_RECORDED"]').click());
  document.querySelector('#hosted-history').addEventListener('click',()=>window.sharePassNavigate('activity'));
  const form=document.querySelector('#deposit-form'),confirm=form.querySelector('[name=custody_confirmed]');
  const check=document.createElement('p');check.className='inline-note';check.setAttribute('aria-live','polite');
  confirm.closest('label').before(check);
  function review(){
   const qty=['normal','vip','vvip'].map((key,index)=>Number(form.elements[key]?.value||0)+' '+['Normal','VIP','VVIP'][index]).join(' · ');
   check.textContent=qty+' | '+(window.sharePassContext?.booth_id||'B1')+' · '+(form.elements.location.value.trim()||'Choose a shelf');
  }
  form.addEventListener('input',review);
  document.querySelector('#new-deposit').addEventListener('click',review);
 });
})();
