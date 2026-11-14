'use strict';
const form=document.getElementById('customer-form');
const statusLine=document.getElementById('intake-instruction');
const errorLine=document.getElementById('customer-error');
const reference=document.getElementById('customer-reference');
const receipt=document.getElementById('customer-receipt');
const receiptState=document.getElementById('receipt-state');
const receiptShare=document.getElementById('receipt-share');
const shared=location.pathname==='/deposit';
const token=shared?'shared':location.pathname.split('/').at(-1);
const booth=shared||location.pathname.startsWith('/booth/');
const endpoint=shared?'/api/public/deposit':'/api/public/'+(booth?'booth/':'intake/')+encodeURIComponent(token);
const passTypes=[['normal','Normal'],['vip','VIP'],['vvip','VVIP'],...(booth?[['mip','MIP']]:[])];
const quantities=Object.fromEntries(passTypes.map(([key])=>[key,0]));
const passStep=document.getElementById('customer-pass-step');
const recipientList=document.getElementById('recipient-list');
const addRecipient=document.getElementById('add-recipient');
const remainingLabel=document.getElementById('allocation-balance');
const ready=document.getElementById('customer-ready');
const guestPhone=form.elements.phone;
const sendButton=document.getElementById('send-customer');
function canContinue(){
  return Boolean(form.elements.name.value.trim())&&Object.values(quantities).some(Boolean)&&Boolean(sharePassPhone(guestPhone.value));
}
const phoneError='Enter a valid WhatsApp number. Include the country code for international numbers.';
let requestId,submission,receiptPeople,boothArchived=false;
let lastReceipt,lastCode;
let receiptPollTimer,receiptChecking=false,receiptFailures=0;
const alertButton=document.getElementById('receipt-alerts');
const alertStatus=document.getElementById('receipt-alert-status');
const alertCacheName='sharepass-receipt-alerts';
let alertKey,alertScope,alertsEnabled=false,alertRevision=0;
let receiptCleanupCursor;
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
};

if(booth){
  document.getElementById('customer-name-label').textContent='Your name';
  document.getElementById('customer-contact').hidden=false;
  guestPhone.disabled=false;
  passStep.hidden=false;
}

function people(){
  return [...recipientList.children].map(row=>{
    const plan=Object.fromEntries([...row.querySelectorAll('[data-allocation]')].map(input=>[input.dataset.allocation,input.valueAsNumber]));
    return {
    name:row.querySelector('[name=recipient_name]').value.trim(),
    phone:sharePassPhone(row.querySelector('[name=recipient_phone]').value),
    ...(Object.values(plan).some(value=>value!==0)?{quantities:plan}:{})
  };});
}
function unassigned(recipients){
  return Object.fromEntries(passTypes.map(([key])=>[key,quantities[key]-recipients.reduce((sum,person)=>sum+(person.quantities?.[key]||0),0)]));
}
function allocationComplete(recipients){
  return recipients.every(person=>!person.quantities||Object.values(person.quantities).every(value=>Number.isInteger(value)&&value>=0))&&
    Object.values(unassigned(recipients)).every(value=>value>=0);
}
function syncRecipients(){
  const rows=[...recipientList.children],multiple=rows.length>1,recipients=people(),left=unassigned(recipients);
  for(const [i,row] of rows.entries()){
    row.querySelector('h3').textContent=multiple?'Collector '+(i+1):'Collector';
    row.querySelector('.allocation-fields').hidden=false;
    row.querySelector('.remove-recipient').hidden=false;
    for(const input of row.querySelectorAll('[data-allocation]')){
      const key=input.dataset.allocation;
      input.max=Math.max(0,left[key]+(input.valueAsNumber||0));
      input.disabled=quantities[key]===0&&!input.valueAsNumber;
    }
  }
  remainingLabel.hidden=!rows.length;
  const difference=passTypes.filter(([key])=>left[key]!==0).map(([key,label])=>label+' '+Math.abs(left[key])+(left[key]<0?' over':' left'));
  remainingLabel.textContent=difference.length?'Unplanned passes may be collected later. '+difference.join(' · '):'All passes planned';
  const depositor=sharePassPhone(guestPhone.value);
  for(const row of rows){
    const phone=row.querySelector('[name=recipient_phone]');
    phone.setCustomValidity(depositor&&sharePassPhone(phone.value)===depositor?'Use a different WhatsApp number from the depositor.':'');
  }
  ready.hidden=!rows.length||!allocationComplete(recipients)||recipients.some(person=>!person.name||!person.phone||person.phone===depositor);
  addRecipient.disabled=rows.length>=20;
}
function addCollector(){
  if(recipientList.children.length>=20)return;
  const row=document.getElementById('recipient-fields').content.firstElementChild.cloneNode(true);
  const [name,phone]=row.querySelectorAll('input');
  const numbers=row.querySelector('.allocation-fields');
  for(const [key,label] of passTypes){
    const field=document.createElement('label'),input=document.createElement('input');
    field.className='field';field.textContent=label+' plan (optional)';
    input.type='number';input.inputMode='numeric';input.min=0;input.step=1;
    input.value=0;input.dataset.allocation=key;
    field.append(input);numbers.append(field);
  }
  row.querySelector('.remove-recipient').onclick=()=>{row.remove();syncRecipients();addRecipient.focus();};
  row.addEventListener('input',syncRecipients);
  row.addEventListener('change',syncRecipients);
  row.addEventListener('keydown',event=>{
    if(event.key==='Enter'&&event.target.matches('input')&&!event.isComposing){
      event.preventDefault();
      if(event.target===name)phone.focus();
      else if(event.target===phone&&!ready.hidden)document.getElementById('send-customer').focus();
    }
  });
  sharePassContactAdvance(name,()=>phone.focus());
  sharePassAutoAdvance(phone,value=>sharePassPhoneComplete(value)&&phone.validity.valid,()=>{
    if(!ready.hidden){window.sharePassMorph(ready);document.getElementById('send-customer').focus();}
  });
  recipientList.append(row);
  syncRecipients();
  return name;
}

sharePassSteps(form,{validate(page){
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
  }
  const recipients=people();
  if(recipients.some(person=>!person.name||!person.phone)){
    errorLine.textContent='Enter each collector’s name and WhatsApp number.';return false;
  }
  const depositor=sharePassPhone(guestPhone.value);
  if(recipients.some(person=>person.phone===depositor)){
    errorLine.textContent='A collector must use a different WhatsApp number from the depositor.';return false;
  }
  if(!allocationComplete(recipients)){
    errorLine.textContent='Optional plans must fit within the deposit totals for every pass type.';return false;
  }
  return true;
}});
if(booth){
  addRecipient.onclick=()=>addCollector()?.focus();
  guestPhone.addEventListener('input',syncRecipients);
  guestPhone.addEventListener('change',syncRecipients);
  sharePassContactAdvance(form.elements.name,()=>{
    if(Object.values(quantities).some(Boolean))guestPhone.focus();
    else counters.querySelector('[data-delta="1"]').focus();
  });
  const mayAdvance=value=>canContinue()&&sharePassPhoneComplete(value);
  guestPhone.addEventListener('blur',()=>{
    if(guestPhone.value.trim()&&!sharePassPhone(guestPhone.value))errorLine.textContent=phoneError;
  });
  guestPhone.addEventListener('keydown',event=>{
    if(event.key==='Enter'&&!event.isComposing&&canContinue()){
      event.preventDefault();sendButton.focus();
    }
  });
  sharePassAutoAdvance(guestPhone,mayAdvance,()=>{
    sendButton.focus();
  });
}

async function customerRequest(body,statusId){
  const url=statusId?endpoint+'?ticket='+encodeURIComponent(statusId):endpoint;
  const response=await fetch(url,{cache:'no-store',credentials:'same-origin',...(body?{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)
  }:{})});
  if(!response.headers.get('Content-Type')?.startsWith('application/json'))throw new Error('Could not open the form. Reopen its QR or ask staff for a fresh one.');
  const result=await response.json();
  if(!response.ok)throw Object.assign(new Error(result.error||'Ask staff for a fresh form QR.'),{status:response.status,notExecuted:result.notExecuted===true,registerResetAt:result.register_reset_at||0});
  return result;
}
function showReceipt(result){
  const changed=result.status!==lastReceipt||result.collection_code!==lastCode;
  if(changed)window.sharePassToast?.(result.status==='confirmed'?'Staff confirmed your passes. Your code and collector message are ready.':result.status==='submitted'?'Sent to staff. Waiting for confirmation.':'Receipt updated.');
  window.SharePassDrafts?.clear();
  form.reset();recipientList.replaceChildren();form.hidden=true;receipt.hidden=false;
  reference.hidden=!result.collection_code&&!result.name;
  reference.textContent=result.collection_code?'Collection code · '+result.collection_code:result.name||'';
  document.getElementById('confirmation-wait').hidden=result.status!=='submitted';
  document.getElementById('receipt-people').textContent=[result.depositor_name||result.name?'Depositor · '+(result.depositor_name||result.name):'',result.staff_name?'Received by · '+result.staff_name:''].filter(Boolean).join('\n');
  receiptShare.replaceChildren();
  if(result.status==='confirmed'&&result.collection_code){
    statusLine.textContent='✓ Passes received';
    receiptState.textContent='Your passes are confirmed. Message your collector below, or share the message with its QR image.';
  }else if(result.status==='submitted'){
    statusLine.textContent='✓ Sent to staff';
    receiptState.textContent='Waiting for staff confirmation';
  }else if(result.status==='checking'){
    statusLine.textContent='Pickup in progress';receiptState.textContent='Staff are confirming a handover.';
  }else{statusLine.textContent='This deposit is closed.';receiptState.textContent='Ask staff if you need help.';}
  lastReceipt=result.status;lastCode=result.collection_code;
  document.getElementById('check-receipt').hidden=true;
  document.getElementById('receipt-sync-status').textContent=result.status==='submitted'?'This page updates automatically after staff confirmation.':result.status==='closed'?'Deposit closed.':'Receipt updated automatically.';
  scheduleReceiptPoll();
  if(result.status==='confirmed'&&result.collection_code){
    try{
      receiptPeople??=result.recipients||[];
      SharePassDrafts.renderDeposit(receiptShare,{code:result.collection_code,reference:result.collection_reference,booth:'SharePass staff',
        quantities:result.remaining,expiresAt:result.code_expires_at,recipients:receiptPeople,depositorName:result.depositor_name||result.name,staffName:result.staff_name,
        saveRecipients:people=>{receiptPeople=people;},refresh:async()=>{
          const ticket=requestId,current=await customerRequest(null,ticket);
          if(ticket!==requestId||current.status!=='confirmed'||current.collection_code!==result.collection_code||current.collection_reference!==result.collection_reference)throw new Error('The receipt changed. Wait for its current status before sharing.');
          return {quantities:current.remaining,expiresAt:current.code_expires_at,depositorName:current.depositor_name||current.name,staffName:current.staff_name};
        }});
    }catch{errorLine.textContent='Your deposit is confirmed. The collector message could not be prepared; show your code or ask staff for help.';}
  }
  if(alertKey&&requestId&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window&&'caches' in window)prepareReceiptAlerts(requestId).catch(()=>{});
}
// Best-effort maintenance is independent of the visible receipt. Never wait for
// a busy receipt lock, infer revocation from local expiry, or mutate server consent.
async function cleanupReceiptAlerts(){
  if(!navigator.locks?.request||!navigator.serviceWorker||!('caches' in window))return;
  const cache=await caches.open(alertCacheName),keys=(await cache.keys())
    .filter(key=>key.url.startsWith(location.origin)&&/^\/receipt-alerts\/[a-f0-9]{64}\/$/.test(key.url.slice(location.origin.length)))
    .sort((a,b)=>a.url<b.url?-1:a.url>b.url?1:0);
  // Persist only the last scope, never a ticket, contact, code or push endpoint.
  // Advance even past busy/live/invalid records so subsequent visits make progress.
  let cursor=receiptCleanupCursor;
  try{cursor=localStorage.getItem('sharepass-alert-cleanup-cursor')||cursor;}catch{}
  const next=keys.findIndex(key=>key.url>cursor),start=next<0?0:next;
  for(let i=0;i<Math.min(keys.length,16);i++){
    const scope=keys[(start+i)%keys.length].url;
    receiptCleanupCursor=scope;
    try{localStorage.setItem('sharepass-alert-cleanup-cursor',scope);}catch{}
    if(scope===alertScope)continue;
    try{
      await navigator.locks.request('sharepass-receipt:'+scope,{ifAvailable:true},async lock=>{
        if(!lock||scope===alertScope)return;
        let proof=await (await cache.match(scope))?.text();
        if(!proof)return;
        const stored=JSON.parse(proof),match=typeof stored.path==='string'&&
          /^\/(?:booth\/([a-f0-9-]{36})|deposit)#receipt=([a-f0-9-]{36})$/.exec(stored.path);
        if(!match||match[2]===requestId)return;
        const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(match[2]));
        const expected=location.origin+'/receipt-alerts/'+Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('')+'/';
        if(scope!==expected)return;
        const registration=await receiptWorkerAt(scope);
        const pending=stored.cleanupPending===true&&Number.isFinite(stored.expiresAt)&&
          Object.keys(stored).sort().join(',')==='cleanupPending,expiresAt,path';
        // Locks serialize our tabs and worker. Preserve replaced proof/resources
        // even if an earlier inactive response or teardown marker is still valid.
        const unchanged=async()=>{
          if(scope===alertScope||match[2]===requestId)return false;
          if(await receiptWorkerAt(scope)!==registration)return false;
          return await (await cache.match(scope))?.text()===proof;
        };
        const subscription=await registration?.pushManager.getSubscription();
        if(!subscription&&!pending)return;
        if(subscription){
          const response=await fetch((match[1]?'/api/public/booth/'+match[1]:'/api/public/deposit')+'/alerts',{
            method:'POST',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(5000),
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({action:'status',ticket:match[2],endpoint:subscription.endpoint})
          });
          if(!response.ok)return;
          const result=await response.json();
          if(!await unchanged())return;
          const current=await registration.pushManager.getSubscription();
          if(current?.endpoint!==subscription.endpoint||!await unchanged())return;
          if(result?.enabled===true&&Number.isFinite(result.expires_at)&&result.expires_at>Date.now()){
            if(pending)await cache.put(scope,new Response(JSON.stringify({path:stored.path,expiresAt:result.expires_at})));
            return;
          }
          if(result?.enabled!==false||!Number.isFinite(stored.expiresAt))return;
          // Journal before unsubscribe: a crash or failed unregister must leave a
          // durable, endpoint-free way to finish this already-authorized cleanup.
          const marker=JSON.stringify({path:stored.path,expiresAt:stored.expiresAt,cleanupPending:true});
          await cache.put(scope,new Response(marker));
          proof=marker;
          if(!await unchanged()||(await registration.pushManager.getSubscription())?.endpoint!==subscription.endpoint)return;
          if(!await subscription.unsubscribe())return;
        }
        // Without a subscription, only our valid durable marker permits retry.
        // This also completes a crash after unregister but before cache deletion.
        if(!await unchanged()||await registration?.pushManager.getSubscription())return;
        if(registration&&!await registration.unregister())return;
        if(scope!==alertScope&&match[2]!==requestId&&!await receiptWorkerAt(scope)&&
          await (await cache.match(scope))?.text()===proof)await cache.delete(scope);
      });
    }catch{} // Offline, malformed records, unsupported locks: leave proof alone.
  }
}
async function receiptAlertLock(scope,action){
  if(navigator.locks?.request)return navigator.locks.request('sharepass-receipt:'+scope,()=>action(true));
  // Without cross-context locking, automatic refresh is read-only.
  return action(false);
}
async function prepareReceiptAlerts(ticket){
  const revision=++alertRevision;
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ticket));
  const scope=location.origin+'/receipt-alerts/'+Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('')+'/';
  await receiptAlertLock(scope,async locked=>{
    const cache=await caches.open(alertCacheName);
    const stored=await (await cache.match(scope))?.json();
    if(requestId!==ticket||revision!==alertRevision)return;
    alertScope=scope;
    const registration=await receiptWorkerAt(scope);
    // Refresh existing registrations so saved opt-ins receive the compatible worker.
    if(typeof registration?.update==='function')registration.update().catch(()=>{});
    const subscription=await registration?.pushManager.getSubscription();
    if(stored?.path===location.pathname+'#receipt='+ticket&&subscription&&Notification.permission==='granted'){
      try{
        const result=await saveReceiptAlerts('status',subscription,ticket);
        if(requestId!==ticket||revision!==alertRevision)return;
        const current=await registration.pushManager.getSubscription();
        if(requestId!==ticket||revision!==alertRevision)return;
        alertsEnabled=Notification.permission==='granted'&&current?.endpoint===subscription.endpoint&&
          result.enabled===true&&Number.isFinite(result.expires_at)&&result.expires_at>Date.now();
        if(locked){
          if(alertsEnabled)await cache.put(scope,new Response(JSON.stringify({path:stored.path,expiresAt:result.expires_at})));
          // Keep inactive proof indexed until bounded maintenance can safely
          // unsubscribe and unregister it. A stale expiry alone is not revocation.
        }
      }catch{
        if(requestId!==ticket||revision!==alertRevision)return;
        // Offline is not revocation. Keep the proof so a later check can recover,
        // and retain the Stop control without silently enabling a new subscription.
        alertsEnabled=true;
      }
    }else{
      alertsEnabled=false;
      // Missing permission/subscription is uncertain. Preserve the cleanup index.
    }
    if(requestId!==ticket||revision!==alertRevision)return;
    alertButton.textContent=alertsEnabled?'Stop receipt alerts':'Enable receipt alerts';
    alertButton.hidden=true; // Current receipts use browser permission controls; legacy clients retain scoped Stop support.
  });
}
async function receiptWorkerAt(scope){
  const registration=await navigator.serviceWorker.getRegistration(scope);
  return registration?.scope===scope?registration:null;
}
async function activeReceiptWorker(scope){
  const previous=await receiptWorkerAt(scope);
  const registration=await navigator.serviceWorker.register('/receipt-alert-worker.js',{scope});
  if(registration.scope!==scope)throw new Error('Receipt worker scope changed.');
  if(registration.active?.state==='activated')return {registration,created:!previous};
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
  return {registration,created:!previous};
}
async function saveReceiptAlerts(action,subscription,ticket=requestId){
  const response=await fetch(endpoint+'/alerts',{method:'POST',credentials:'same-origin',cache:'no-store',
    headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(5000),body:JSON.stringify({action,ticket,endpoint:subscription.endpoint})});
  if(!response.ok)throw new Error('Receipt alerts are unavailable.');
  return response.json();
}
alertButton.onclick=async()=>{
  if(alertButton.disabled)return;
  const ticket=requestId,scope=alertScope,stopping=alertsEnabled;
  ++alertRevision;
  alertButton.disabled=true;alertStatus.hidden=false;alertStatus.textContent='';
  try{
    if(!stopping&&!navigator.locks?.request)throw new Error('Safe background synchronization is unavailable.');
    if(!stopping&&await Notification.requestPermission()!=='granted')throw new Error('Permission was not granted.');
    await receiptAlertLock(scope,async()=>{
      if(requestId!==ticket||alertScope!==scope)return;
      const cache=await caches.open(alertCacheName);
      if(stopping){
        // Delete the local proof first, under the same lock used by push/click.
        // A failed network stop must not leave a background notification enabled.
        await cache.delete(scope);
        const registration=await receiptWorkerAt(scope);
        const subscription=await registration?.pushManager.getSubscription();
        if(subscription)await Promise.allSettled([saveReceiptAlerts('stop',subscription,ticket),subscription.unsubscribe()]);
        await registration?.unregister();
        if(requestId===ticket&&alertScope===scope){
          alertsEnabled=false;alertStatus.textContent='Receipt alerts are off.';
        }
      }else{
        const current=()=>requestId===ticket&&alertScope===scope&&Notification.permission==='granted';
        const worker=await activeReceiptWorker(scope),registration=worker.registration;
        let subscription,createdSubscription=false,enableSent=false;
        try{
          if(!current())throw new Error('Receipt changed.');
          const existing=await registration.pushManager.getSubscription();
          if(!current())throw new Error('Receipt changed.');
          const key=Uint8Array.from(atob(alertKey.replace(/-/g,'+').replace(/_/g,'/')),char=>char.charCodeAt(0));
          subscription=existing||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
          createdSubscription=!existing;
          if(!current())throw new Error('Receipt changed.');
          enableSent=true;
          const result=await saveReceiptAlerts('enable',subscription,ticket);
          if(!current())throw new Error('Receipt changed.');
          const latest=await registration.pushManager.getSubscription();
          if(!current()||latest?.endpoint!==subscription.endpoint)throw new Error('Receipt subscription changed.');
          await cache.put(scope,new Response(JSON.stringify({path:location.pathname+'#receipt='+ticket,expiresAt:result.expires_at})));
        }catch(error){
          // Never tear down an existing subscription or a replacement made after
          // this attempt started. Only the captured scope and our own resources
          // can be cleaned up when receipt navigation interrupts the operation.
          const latest=await registration.pushManager.getSubscription().catch(()=>null);
          if(createdSubscription&&latest?.endpoint===subscription?.endpoint){
            if(enableSent)await saveReceiptAlerts('stop',subscription,ticket).catch(()=>{});
            await subscription.unsubscribe().catch(()=>{});
            if(worker.created)await registration.unregister().catch(()=>{});
          }else if(worker.created&&!subscription&&!latest)await registration.unregister().catch(()=>{});
          throw error;
        }
        if(current()){alertsEnabled=true;alertStatus.textContent='Receipt alerts are on for this browser.';}
      }
    });
    if(!stopping&&requestId===ticket&&alertScope===scope)await checkReceipt();
  }catch{if(requestId===ticket&&alertScope===scope)alertStatus.textContent='Could not change receipt alerts. You can still check your receipt here.';}
  finally{
    if(requestId===ticket&&alertScope===scope){
      alertButton.textContent=alertsEnabled?'Stop receipt alerts':'Enable receipt alerts';
      alertButton.hidden=true;
    }
    alertButton.disabled=false;
  }
};
navigator.serviceWorker?.addEventListener('message',event=>{
  if(event.data?.type==='sharepass-receipt'&&event.data.scope===alertScope&&!document.hidden&&!receipt.hidden)checkReceipt();
});
let receiptCheck=0;
function scheduleReceiptPoll(){
  clearTimeout(receiptPollTimer);
  if(!booth||!requestId||receipt.hidden||lastReceipt==='closed'||document.hidden)return;
  const delay=receiptFailures?Math.min(60000,15000*receiptFailures):15000;
  receiptPollTimer=setTimeout(checkReceipt,delay);
}
function forgetMissingReceipt(error){
  const reset=error.status===410&&error.registerResetAt>0;
  if(!reset&&(error.status!==404||submission))return false;
  if(reset)submission=undefined;
  requestId=undefined;receiptPeople=undefined;
  try{sessionStorage.removeItem('sharepass-receipt:'+token);}catch{}
  receipt.hidden=true;form.hidden=boothArchived;
  statusLine.textContent=boothArchived?'This booth is archived. Ask staff about your previous deposit.':'Your previous receipt is unavailable. Ask staff about an existing deposit, or enter a new deposit below.';
  return true;
}
async function checkReceipt(){
  if(receiptChecking||!requestId)return;
  receiptChecking=true;
  const ticket=requestId,check=++receiptCheck;
  try{
    let result;
    try{result=await customerRequest(null,ticket);}
    catch(error){
      if(error.status!==404||!submission||Date.now()-submission.created_at>2*60*60*1000)throw error;
      result=await customerRequest(submission.body);
    }
    if(check!==receiptCheck||ticket!==requestId)return;
    receiptFailures=0;errorLine.textContent='';
    if(submission){submission=null;try{sessionStorage.setItem('sharepass-receipt:'+token,requestId);}catch{}}
    if(result.status!==lastReceipt||result.collection_code!==lastCode)showReceipt(result);
  }catch(error){
    if(check===receiptCheck&&ticket===requestId&&forgetMissingReceipt(error))return;
    receiptFailures++;
    if(check===receiptCheck&&ticket===requestId)document.getElementById('receipt-sync-status').textContent='Waiting for connection. Retrying automatically…';
  }finally{receiptChecking=false;scheduleReceiptPoll();}
}

document.getElementById('check-receipt').onclick=checkReceipt;
document.addEventListener('visibilitychange',()=>{
  if(!document.hidden&&booth&&requestId&&!receipt.hidden&&lastReceipt!=='closed')checkReceipt();
  else clearTimeout(receiptPollTimer);
});
window.addEventListener('online',()=>{if(booth&&requestId&&!receipt.hidden)checkReceipt();});
form.onsubmit=async event=>{
  event.preventDefault();
  const submit=document.getElementById('send-customer');
  if(submit.disabled)return;
  submit.disabled=true;
  errorLine.textContent='';
  // Request permission while Send still has browser user activation. Polling and
  // the deposit request continue even when notifications are declined.
  let notificationPermission;
  if(booth&&alertKey&&'Notification' in window&&'PushManager' in window&&'serviceWorker' in navigator){
    notificationPermission=Notification.permission==='default'?
      Notification.requestPermission().catch(()=>Notification.permission):Promise.resolve(Notification.permission);
  }
  try{
    let body={name:form.elements.name.value.trim(),quantities};
    if(booth)Object.assign(body,{request_id:requestId||=crypto.randomUUID(),phone:'+'+sharePassPhone(guestPhone.value),
      recipients:people().map(person=>({...person,phone:'+'+person.phone})),intake_version:2});
    if(booth){
      if(submission&&Date.now()-submission.created_at>2*60*60*1000)throw new Error('The original submission needs staff review. Ask the booth before submitting again.');
      if(!submission)submission={ticket:requestId,body:JSON.parse(JSON.stringify(body)),created_at:Date.now()};
      body=submission.body;
      // Save the immutable intent before the first request; storage failure sends nothing.
      sessionStorage.setItem('sharepass-receipt:'+token,JSON.stringify(submission));
    }
    const result=await customerRequest(body);
    if(booth){submission=null;try{sessionStorage.setItem('sharepass-receipt:'+token,requestId);}catch{}}
    showReceipt(result);
    if(notificationPermission)notificationPermission.then(async permission=>{
      if(permission!=='granted'||!requestId||lastReceipt==='closed')return;
      await prepareReceiptAlerts(requestId);
      if(!alertsEnabled&&alertScope&&!alertButton.disabled)await alertButton.onclick();
    }).catch(()=>{});
  }catch(error){
    if(forgetMissingReceipt(error))return;
    if(booth&&error.status===400&&error.notExecuted){
      // Validation rejected this payload before a queue entry could be created.
      submission=null;requestId=undefined;
      try{sessionStorage.removeItem('sharepass-receipt:'+token);}catch{}
    }
    errorLine.textContent=error.message;
  }
  finally{submit.disabled=false;}
};

(async()=>{
  try{
    const reopened=booth&&/^#receipt=([a-f0-9-]{36})$/.exec(location.hash)?.[1];
    if(reopened)history.replaceState(history.state,'',location.pathname+location.search);
    const result=await customerRequest();
    alertKey=result.alerts_key;
    boothArchived=Boolean(result.archived);
    if(result.booth)document.getElementById('customer-booth').textContent=result.booth;
    if(booth)try{
      const saved=sessionStorage.getItem('sharepass-receipt:'+token);
      if(saved?.startsWith('{')){submission=JSON.parse(saved);requestId=submission.ticket;}
      else requestId=saved||undefined;
    }catch{}
    if(reopened){if(requestId!==reopened)submission=undefined;requestId=reopened;}
    if(requestId){
      try{
        showReceipt(await customerRequest(null,requestId));
        if(reopened)try{sessionStorage.setItem('sharepass-receipt:'+token,requestId);}catch{}
        return;
      }catch(error){
        if(forgetMissingReceipt(error))return;
        showReceipt({status:'submitted'});
        document.getElementById('receipt-sync-status').textContent='Recovering your original submission. Please wait or ask staff; do not submit again.';
        return;
      }
    }
    if(result.status&&result.status!=='waiting')return showReceipt(result);
    if(result.archived)throw new Error('This booth is archived and is not accepting new deposits.');
    form.hidden=false;
    statusLine.textContent='Add your details and pass counts. Then show staff your passes.';
  }catch(error){statusLine.textContent='This form couldn’t be opened.';errorLine.textContent=error.message;}
  finally{
    // Start only after the current ticket is known. Never await maintenance.
    setTimeout(()=>{cleanupReceiptAlerts().catch(()=>{});},0);
  }
})();
