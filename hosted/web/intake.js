'use strict';
const form=document.getElementById('customer-form');
const statusLine=document.getElementById('intake-instruction');
const errorLine=document.getElementById('customer-error');
const reference=document.getElementById('customer-reference');
const receipt=document.getElementById('customer-receipt');
const receiptState=document.getElementById('receipt-state');
const receiptShare=document.getElementById('receipt-share');
const token=location.pathname.split('/').at(-1);
const booth=location.pathname.startsWith('/booth/');
const endpoint='/api/public/'+(booth?'booth/':'intake/')+encodeURIComponent(token);
const passTypes=[['normal','Normal'],['vip','VIP'],['vvip','VVIP'],...(booth?[['mip','MIP']]:[])];
const quantities=Object.fromEntries(passTypes.map(([key])=>[key,0]));
const passStep=document.getElementById('customer-pass-step');
const recipientList=document.getElementById('recipient-list');
const addRecipient=document.getElementById('add-recipient');
const remainingLabel=document.getElementById('allocation-balance');
const ready=document.getElementById('customer-ready');
const guestPhone=form.elements.phone;
const sendButton=document.getElementById('send-customer');
let phoneAdvancing=false;
function canContinue(){
  return Boolean(form.elements.name.value.trim())&&Object.values(quantities).some(Boolean)&&Boolean(sharePassPhone(guestPhone.value));
}
function syncContinue(){
  sendButton.hidden=booth&&passStep.hidden&&(!canContinue()||phoneAdvancing);
}
const phoneError='Enter a valid WhatsApp number. Include the country code for international numbers.';
let requestId;
let lastReceipt,lastCode;
const alertButton=document.getElementById('receipt-alerts');
const alertStatus=document.getElementById('receipt-alert-status');
const alertCacheName='sharepass-receipt-alerts';
let alertKey,alertScope,alertsEnabled=false;
document.getElementById('finish-receipt').onclick=()=>{
  if(booth)try{sessionStorage.removeItem('sharepass-receipt:'+token);}catch{}
};

const counters=document.getElementById('customer-counts');
counters.innerHTML=passTypes.map(([key,label])=>
  '<div class="row intake-count" data-pass="'+key+'"><span>'+label+'</span><div class="step">'+
  '<button type="button" data-delta="-1" aria-label="Remove one '+label+'" disabled>−</button>'+
  '<output aria-label="'+label+' quantity" aria-live="polite">0</output>'+
  '<button type="button" data-delta="1" aria-label="Add one '+label+'">+</button></div></div>').join('');
counters.onclick=event=>{
  const button=event.target.closest('button[data-delta]');
  if(!button)return;
  const row=button.closest('[data-pass]'),key=row.dataset.pass;
  const count=Math.min(100,Math.max(0,quantities[key]+Number(button.dataset.delta)));
  quantities[key]=count;
  row.querySelector('output').value=String(count);
  row.querySelector('[data-delta="-1"]').disabled=count===0;
  row.querySelector('[data-delta="1"]').disabled=count===100;
  syncRecipients();
  syncContinue();
};

if(booth){
  document.getElementById('customer-name-label').textContent='Your name';
  document.getElementById('customer-contact').hidden=false;
  guestPhone.disabled=false;
  passStep.dataset.wizardPage='';
}

function people(){
  const multiple=recipientList.children.length>1;
  return [...recipientList.children].map(row=>({
    name:row.querySelector('[name=recipient_name]').value.trim(),
    phone:sharePassPhone(row.querySelector('[name=recipient_phone]').value),
    quantities:multiple?Object.fromEntries([...row.querySelectorAll('[data-allocation]')].map(input=>[input.dataset.allocation,input.valueAsNumber])):{...quantities}
  }));
}
function unassigned(recipients){
  return Object.fromEntries(passTypes.map(([key])=>[key,quantities[key]-recipients.reduce((sum,person)=>sum+(person.quantities[key]||0),0)]));
}
function allocationComplete(recipients){
  return recipients.every(person=>Object.values(person.quantities).every(value=>Number.isInteger(value)&&value>=0)&&
    Object.values(person.quantities).some(Boolean))&&Object.values(unassigned(recipients)).every(value=>value===0);
}
function syncRecipients(){
  const rows=[...recipientList.children],multiple=rows.length>1,recipients=people(),left=unassigned(recipients);
  for(const [i,row] of rows.entries()){
    row.querySelector('h3').textContent=multiple?'Collector '+(i+1):'Collector';
    row.querySelector('.allocation-fields').hidden=!multiple;
    row.querySelector('.remove-recipient').hidden=!multiple;
    for(const input of row.querySelectorAll('[data-allocation]')){
      const key=input.dataset.allocation;
      input.max=Math.max(0,left[key]+(input.valueAsNumber||0));
      input.disabled=!multiple||(quantities[key]===0&&!input.valueAsNumber);
    }
  }
  remainingLabel.hidden=!multiple;
  const difference=passTypes.filter(([key])=>left[key]!==0).map(([key,label])=>label+' '+Math.abs(left[key])+(left[key]<0?' over':' left'));
  remainingLabel.textContent=difference.length?difference.join(' · '):'All passes allocated';
  ready.hidden=!rows.length||!allocationComplete(recipients)||recipients.some(person=>!person.name||!person.phone);
  addRecipient.disabled=rows.length>=20;
}
function addCollector(){
  if(recipientList.children.length>=20)return;
  const row=document.getElementById('recipient-fields').content.firstElementChild.cloneNode(true);
  const [name,phone]=row.querySelectorAll('input');
  const numbers=row.querySelector('.allocation-fields');
  for(const [key,label] of passTypes){
    const field=document.createElement('label'),input=document.createElement('input');
    field.className='field';field.textContent=label+' passes';
    input.type='number';input.inputMode='numeric';input.min=0;input.step=1;
    input.value=recipientList.children.length?0:quantities[key];input.dataset.allocation=key;
    field.append(input);numbers.append(field);
  }
  row.querySelector('.remove-recipient').onclick=()=>{row.remove();syncRecipients();addRecipient.focus();};
  row.addEventListener('input',syncRecipients);
  row.addEventListener('keydown',event=>{
    if(event.key==='Enter'&&event.target.matches('input')&&!event.isComposing){
      event.preventDefault();
      if(event.target===name)phone.focus();
      else if(event.target===phone&&!ready.hidden)document.getElementById('send-customer').focus();
    }
  });
  sharePassAutoAdvance(phone,sharePassPhoneComplete,()=>{
    if(!ready.hidden){window.sharePassMorph(ready);document.getElementById('send-customer').focus();}
  });
  recipientList.append(row);
  syncRecipients();
  return name;
}

sharePassSteps(form,{onShow:syncContinue,validate(page){
  errorLine.textContent='';
  if(page.id==='customer-details'){
    if(booth&&!form.elements.name.value.trim()){
      errorLine.textContent='Enter your name.';form.elements.name.focus();return false;
    }
    if(!Object.values(quantities).some(Boolean)){
      errorLine.textContent='Add at least one pass.';counters.querySelector('[data-delta="1"]').focus();return false;
    }
    if(booth&&!sharePassPhone(guestPhone.value)){
      errorLine.textContent=phoneError;guestPhone.focus();return false;
    }
    return true;
  }
  const recipients=people();
  if(recipients.some(person=>!person.name||!person.phone)){
    errorLine.textContent='Enter each collector’s name and WhatsApp number.';return false;
  }
  if(!allocationComplete(recipients)){
    errorLine.textContent='Give each collector at least one pass and match the deposit totals for every pass type.';return false;
  }
  return true;
}});
if(booth){
  addCollector();
  addRecipient.onclick=()=>{
    if(recipientList.children.length===1){
      for(const input of recipientList.querySelectorAll('[data-allocation]'))input.value=quantities[input.dataset.allocation];
    }
    addCollector()?.focus();
  };
  form.addEventListener('input',syncContinue);
  form.addEventListener('change',syncContinue);
  form.addEventListener('focusin',syncContinue);
  const mayAdvance=value=>passStep.hidden&&canContinue()&&sharePassPhoneComplete(value);
  const pendingAdvance=()=>{
    phoneAdvancing=mayAdvance(guestPhone.value);
    syncContinue();
  };
  guestPhone.addEventListener('input',event=>{if(!event.isComposing)pendingAdvance();});
  guestPhone.addEventListener('compositionend',pendingAdvance);
  guestPhone.addEventListener('blur',()=>{
    phoneAdvancing=false;
    if(passStep.hidden&&guestPhone.value.trim()&&!sharePassPhone(guestPhone.value))errorLine.textContent=phoneError;
    syncContinue();
  });
  guestPhone.addEventListener('keydown',event=>{
    if(event.key==='Enter'&&!event.isComposing&&canContinue()&&passStep.hidden){
      event.preventDefault();form.requestSubmit();
    }
  });
  sharePassAutoAdvance(guestPhone,mayAdvance,()=>{
    phoneAdvancing=false;
    form.requestSubmit();
    if(!passStep.hidden)recipientList.querySelector('[name=recipient_name]').focus();
  });
}

async function customerRequest(body,statusId){
  const url=statusId?endpoint+'?ticket='+encodeURIComponent(statusId):endpoint;
  const response=await fetch(url,{cache:'no-store',credentials:'same-origin',...(body?{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)
  }:{})});
  if(!response.headers.get('Content-Type')?.startsWith('application/json'))throw new Error('Could not open the form. Reopen its QR or ask staff for a fresh one.');
  const result=await response.json();
  if(!response.ok)throw new Error(result.error||'Ask staff for a fresh form QR.');
  return result;
}
function showReceipt(result){
  form.hidden=false;
  form.reset();recipientList.replaceChildren();form.hidden=true;
  receipt.hidden=false;
  reference.hidden=!result.queue_ref;
  reference.textContent=result.queue_ref?'Queue reference '+result.queue_ref:'';
  receiptShare.replaceChildren();
  if(result.status==='confirmed'&&result.collection_code){
    statusLine.textContent='✓ Passes received';
    receiptState.textContent='Your passes are confirmed. Open WhatsApp to share the collection code.';
    for(const person of result.recipients){
      const draft=SharePassDrafts.depositDraft({phone:person.phone,name:Array.from(person.name).slice(0,40).join(''),code:result.collection_code,
        reference:result.collection_reference,booth:result.booth,quantities:person.quantities,expiresAt:result.code_expires_at});
      const link=SharePassDrafts.composeLink({address:draft.recipient,message:draft.message},'Send code to '+person.name);
      link.classList.add('whatsapp-action');receiptShare.append(link);
    }
  }else if(result.status==='submitted'){
    statusLine.textContent='✓ Sent to staff';
    receiptState.textContent='Show this screen at the counter. Keep it open while staff count and receive your passes.';

  }else if(result.status==='checking'){
    statusLine.textContent='Pickup in progress';
    receiptState.textContent='The counter is confirming a handover.';
  }else{
    statusLine.textContent=result.status==='closed'?'This deposit is closed.':'Passes received';
    receiptState.textContent='Show the queue reference to staff if you need help.';
  }
  lastReceipt=result.status;lastCode=result.collection_code;
  document.getElementById('check-receipt').hidden=!booth||result.status==='closed';
  if(alertKey&&requestId&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window&&'caches' in window){
    prepareReceiptAlerts(requestId).catch(()=>{});
  }
}
async function prepareReceiptAlerts(ticket){
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ticket));
  const scope=location.origin+'/receipt-alerts/'+Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('')+'/';
  const cache=await caches.open(alertCacheName);
  const stored=await (await cache.match(scope))?.json();
  if(requestId!==ticket)return;
  alertScope=scope;
  alertsEnabled=stored?.expiresAt>Date.now();
  alertButton.textContent=alertsEnabled?'Stop receipt alerts':'Enable receipt alerts';
  alertButton.hidden=lastReceipt==='closed'&&!alertsEnabled;
  for(const key of await cache.keys()){
    const local=await (await cache.match(key))?.json();
    if(local?.expiresAt<=Date.now()){
      await (await receiptWorkerAt(key.url))?.unregister();
      await cache.delete(key);
    }
  }
}
async function receiptWorkerAt(scope){
  const registration=await navigator.serviceWorker.getRegistration(scope);
  return registration?.scope===scope?registration:null;
}
async function activeReceiptWorker(){
  const registration=await navigator.serviceWorker.register('/receipt-alert-worker.js',{scope:alertScope});
  if(registration.active?.state==='activated')return registration;
  const installing=registration.installing||registration.waiting||registration.active;
  if(!installing)throw new Error('The receipt alert worker is unavailable.');
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>finish(false),5000);
    function finish(ok){
      clearTimeout(timer);installing.removeEventListener('statechange',changed);
      if(ok)resolve();else reject(new Error('The receipt alert worker did not start.'));
    }
    function changed(){
      if(installing.state==='activated')finish(true);
      if(installing.state==='redundant')finish(false);
    }
    installing.addEventListener('statechange',changed);changed();
  });
  return registration;
}
async function saveReceiptAlerts(action,subscription){
  const response=await fetch(endpoint+'/alerts',{method:'POST',credentials:'same-origin',cache:'no-store',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({action,ticket:requestId,endpoint:subscription.endpoint})});
  if(!response.ok)throw new Error('Receipt alerts are unavailable.');
  return response.json();
}
alertButton.onclick=async()=>{
  if(alertButton.disabled)return;
  alertButton.disabled=true;alertStatus.hidden=false;alertStatus.textContent='';
  try{
    if(!alertsEnabled&&await Notification.requestPermission()!=='granted')throw new Error('Permission was not granted.');
    const cache=await caches.open(alertCacheName);
    if(alertsEnabled){
      const registration=await receiptWorkerAt(alertScope);
      const subscription=await registration?.pushManager.getSubscription();
      if(subscription)await Promise.allSettled([saveReceiptAlerts('stop',subscription),subscription.unsubscribe()]);
      await registration?.unregister();
      await cache.delete(alertScope);
      alertsEnabled=false;alertStatus.textContent='Receipt alerts are off.';
    }else{
      const registration=await activeReceiptWorker();
      const existing=await registration.pushManager.getSubscription();
      const key=Uint8Array.from(atob(alertKey.replace(/-/g,'+').replace(/_/g,'/')),char=>char.charCodeAt(0));
      const subscription=existing||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
      try{
        const result=await saveReceiptAlerts('enable',subscription);
        await cache.put(alertScope,new Response(JSON.stringify({path:location.pathname+'#receipt='+requestId,expiresAt:result.expires_at})));
      }catch(error){
        await subscription.unsubscribe().catch(()=>{});
        await registration.unregister().catch(()=>{});
        throw error;
      }
      alertsEnabled=true;alertStatus.textContent='Receipt alerts are on for this browser.';
      await checkReceipt();
    }
  }catch{alertStatus.textContent='Could not change receipt alerts. You can still check your receipt here.';}
  finally{
    alertButton.textContent=alertsEnabled?'Stop receipt alerts':'Enable receipt alerts';
    alertButton.hidden=lastReceipt==='closed'&&!alertsEnabled;
    alertButton.disabled=false;
  }
};
navigator.serviceWorker?.addEventListener('message',event=>{
  if(event.data?.type==='sharepass-receipt'&&event.data.scope===alertScope&&!document.hidden&&!receipt.hidden)checkReceipt();
});
let receiptCheck=0;
async function checkReceipt(){
  const ticket=requestId,check=++receiptCheck;
  try{
    const result=await customerRequest(null,ticket);
    if(check!==receiptCheck||ticket!==requestId)return;
    errorLine.textContent='';
    if(result.status!==lastReceipt||result.collection_code!==lastCode)showReceipt(result);
  }catch{
    if(check===receiptCheck&&ticket===requestId)errorLine.textContent='Could not check your receipt. Try again when connected.';
  }
}

document.getElementById('check-receipt').onclick=checkReceipt;
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden&&booth&&requestId&&!receipt.hidden&&lastReceipt!=='closed')checkReceipt();
});
form.onsubmit=async event=>{
  event.preventDefault();
  const submit=document.getElementById('send-customer');
  if(submit.disabled)return;
  submit.disabled=true;
  try{
    const body={name:form.elements.name.value.trim(),quantities};
    if(booth)Object.assign(body,{request_id:requestId||=crypto.randomUUID(),phone:'+'+sharePassPhone(guestPhone.value),
      recipients:people().map(person=>({...person,phone:'+'+person.phone})),intake_version:2});
    const result=await customerRequest(body);
    if(booth)try{sessionStorage.setItem('sharepass-receipt:'+token,requestId);}catch{}
    showReceipt(result);
  }catch(error){errorLine.textContent=error.message;}
  finally{submit.disabled=false;}
};

(async()=>{
  try{
    const reopened=booth&&/^#receipt=([a-f0-9-]{36})$/.exec(location.hash)?.[1];
    if(reopened)history.replaceState(history.state,'',location.pathname+location.search);
    const result=await customerRequest();
    alertKey=result.alerts_key;
    if(result.booth)document.getElementById('customer-booth').textContent=result.booth;
    if(booth)try{requestId=sessionStorage.getItem('sharepass-receipt:'+token)||undefined;}catch{}
    if(reopened)requestId=reopened;
    if(requestId){
      try{
        showReceipt(await customerRequest(null,requestId));
        if(reopened)try{sessionStorage.setItem('sharepass-receipt:'+token,requestId);}catch{}
        return;
      }catch{requestId=undefined;}
    }
    if(result.status&&result.status!=='waiting')return showReceipt(result);
    form.hidden=false;
    statusLine.textContent='Add your details and pass counts. Then show staff your passes.';
  }catch(error){statusLine.textContent='This form couldn’t be opened.';errorLine.textContent=error.message;}
})();
