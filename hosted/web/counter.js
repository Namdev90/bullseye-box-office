'use strict';
const byId = id => document.getElementById(id);
const scope = {event_id:'training-event-001',booth_id:'B1',operator:'Preview staff'};
const freshRegister = () => new DemoStore({seed:false,singleEvent:true,eventName:'SharePass'});
let register = null;
let staff, recovery = null;
let receipt, match, pending, view, demoIndex = 0, timer, playing = false, busy = false;
let intakeToken, intakeCounts, intakeView = 0;
let queueToken, queueView=0, queueSignature, suggestion, refreshAttempt;
const passTypes = freshRegister().passTypes;
const draft = window.SharePassDrafts;
const categories = counts=>Object.hasOwn(counts||{},'mip')?[...passTypes,{id:'mip',label:'MIP'}]:passTypes;
const balance = counts => categories(counts).filter(({id})=>counts[id]).map(({id,label})=>counts[id]+' '+label).join(' · ') || 'No passes remaining';
const wizards=Object.fromEntries(['queue-review','intake-review','deposit','collect'].map(id=>{
  const form=byId(id+'-form');
  return [id,sharePassSteps(form,{validate(page){
    byId('error').textContent='';
    if(page.querySelector('#'+id+'-counts')&&!Object.values(readCounts(form)).some(Boolean)){
      byId('error').textContent='Choose at least one pass.';
      return false;
    }
    const packet=page.querySelector('[name=packet]');
    if(packet&&packet.value.trim().toUpperCase()!==match.deposit.packet_id){
      byId('error').textContent='Match the label on the physical packet.';
      return false;
    }
    return true;
  }})];
}));

function show(id){
  if(view==='intake'){
    intakeView++;
  }
  queueView++;
  byId('home').classList.toggle('back-hidden', ['desk','loading','profile'].includes(id));
  byId('menu').hidden = ['loading','profile'].includes(id);
  for(const section of document.querySelectorAll('main>section')) section.hidden = section.id !== id;
  if(view === 'share' && id !== 'share') draft.clear();
  byId('error').textContent = '';
  byId('menu').open = false;
  view = id;
  wizards[id]?.show(0,false);
  if(id === 'desk'){
    renderRecovery().catch(error=>{if(view==='desk')byId('error').textContent=error.message;});
    byId('queue-panel').hidden=Boolean(register);
    if(!register)showDeskQr();
  }
  if(id==='desk'&&staff&&!register)refreshQueue(queueView);
  byId(id).querySelector('h1, button')?.focus();
}

async function renderRecovery(){
  const current = register;
  const list = byId('recovery');
  list.replaceChildren();
  if(!current&&recovery){
    const button = document.createElement('button');
    button.textContent = 'Recover last action';
    button.onclick = () => perform(recover);
    list.append(button);
    return;
  }
  const state = current ? current.state(scope.event_id) : await fetchJson('/api/state');
  if(view!=='desk'||register!==current||recovery&&!current)return;
  const entries = state.deposits.filter(item=>item.pending_collection);
  list.replaceChildren(...entries.map(item=>{
    const button = document.createElement('button');
    button.textContent = 'Resume handover · '+item.location;
    button.onclick = () => showHandover({deposit:item,collection:item.pending_collection});
    return button;
  }));
}

function renderCounts(form,limits){
  byId(form+'-counts').innerHTML = categories(limits).map(({id,label})=>{
    const limit = limits?.[id] ?? 100;
    const available = limits ? '<small>'+limit+' available</small>' : '';
    return '<div class="row"><label for="'+form+'-'+id+'">'+label+available+'</label><div class="step">'+
      '<button type="button" aria-label="Remove one '+label+'" data-step="-1">−</button>'+
      '<input id="'+form+'-'+id+'" name="'+id+'" type="number" min="0" max="'+limit+'" value="0" required inputmode="numeric">'+
      '<button type="button" aria-label="Add one '+label+'" data-step="1">+</button></div></div>';
  }).join('');
}

function setCounts(form,counts){
  for(const {id} of passTypes) byId(form+'-'+id).value = counts[id] ?? 0;
}

function readCounts(form){
  return Object.fromEntries([...form.querySelectorAll('input[type="number"]')].map(input=>[input.name,input.valueAsNumber]));
}

const queueReviewForm=byId('queue-review-form');
function showQueueCode(){
  const {custom_code,valid_minutes}=queueReviewForm.elements;
  const code=custom_code.value.trim().toUpperCase();
  byId('queue-confirm-summary').textContent=(code?'Custom code '+code:suggestion?'Suggested code '+suggestion:'Automatic code')+
    ' · Expires in '+valid_minutes.selectedOptions[0].textContent;
}
queueReviewForm.addEventListener('input',showQueueCode);
queueReviewForm.addEventListener('keydown',event=>{
  if(event.key==='Enter'&&event.target.matches('input,select'))event.preventDefault();
});
queueReviewForm.elements.custom_code.addEventListener('invalid',()=>{byId('queue-code-options').open=true;});
byId('use-auto-code').onclick=()=>{
  suggestion=undefined;
  queueReviewForm.elements.custom_code.value='';
  showQueueCode();
};
for(const choice of document.querySelectorAll('[data-expiry]'))choice.onclick=()=>{
  queueReviewForm.elements.valid_minutes.value=choice.dataset.expiry;
  showQueueCode();
};
byId('suggest-code').onclick=()=>perform(async()=>{
  suggestion=(await fetchJson('/api/codes/suggest?exclude='+encodeURIComponent(suggestion||''))).code;
  queueReviewForm.elements.custom_code.value='';
  showQueueCode();
});
const inlineLookup=byId('desk-code-form');
inlineLookup.onsubmit=event=>{event.preventDefault();perform(()=>findPasses(inlineLookup.elements.code.value));};
sharePassAutoAdvance(inlineLookup.elements.code,value=>view==='desk'&&/^[A-Za-z0-9]{4}$/.test(value),
  ()=>inlineLookup.requestSubmit());
const pickupForm=byId('collect-form');
sharePassAutoAdvance(pickupForm.elements.packet,value=>view==='collect'&&
  value.trim().toUpperCase()===match?.deposit.packet_id,()=>pickupForm.requestSubmit());
const lookupForm=byId('lookup-form');
sharePassAutoAdvance(lookupForm.elements.code,value=>!byId('lookup').hidden&&byId('lookup-reference').hidden&&/^[A-Za-z0-9]{4}$/.test(value),
  ()=>lookupForm.requestSubmit());
byId('select-all-passes').onclick=()=>{
  for(const field of byId('collect-counts').querySelectorAll('input'))field.value=field.max;
};

async function fetchJson(path,body,signal){
  const response=await fetch(path,{cache:'no-store',signal,...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
  const result=await response.json();
  if(!response.ok){
    const error=new Error(result.error||'The shared register is unavailable.');
    error.notExecuted=result.notExecuted===true;
    error.status=response.status;
    error.pickupReferenceRequired=result.pickup_reference_required===true;
    throw error;
  }
  return result;
}

function setRecovery(action){
  const key='sharepass-pending:'+staff.session_key;
  if(action) sessionStorage.setItem(key,JSON.stringify(action));
  else sessionStorage.removeItem(key);
  recovery=action;
}

async function submit(action){
  try{
    const result=await fetchJson(action.path,action.body);
    setRecovery(null);
    return result;
  }catch(error){
    if(error.notExecuted) setRecovery(null);
    else throw new Error('The result is uncertain. Return to the desk and recover the last action before handling more passes.');
    throw error;
  }
}

function request(path,body){
  if(register)return register.request(path,{...scope,...body,request_id:crypto.randomUUID()});
  if(path==='/api/verify') return fetchJson(path,body);
  if(recovery)throw new Error('Recover the last action from the desk first.');
  const action={path,body:{...body,request_id:crypto.randomUUID()}};
  setRecovery(action);
  return submit(action);
}

async function recover(){
  const action=recovery;
  const result=await submit(action);
  if(action.path==='/api/deposits'||action.path.endsWith('/confirm'))showReceipt(result,action.path.startsWith('/api/intakes/'));
  else if(action.path.endsWith('/release'))showHandover(result);
  else showBalance(result);
}

async function refreshQueue(generation,manual=false){
  if(generation!==queueView||register||!staff)return;
  try{
    {
      const result=await fetchJson('/api/queue',null,AbortSignal.timeout(5500));
      if(generation!==queueView)return;
      const drafts=result.drafts||[];
      const signature=JSON.stringify(drafts);
      if(queueSignature!==signature){
        queueSignature=signature;
        byId('queue-list').replaceChildren(...drafts.map(item=>{
          const row=document.createElement('li');
          const button=document.createElement('button');
          button.type='button';
          button.className='queue-entry';
          const text=document.createElement('span');
          const name=document.createElement('strong');
          name.textContent=item.name;
          const counts=document.createElement('small');
          counts.textContent=balance(item.quantities);
          text.append(name,counts);
          const reference=document.createElement('span');
          reference.className='queue-reference';
          reference.textContent=item.queue_ref||'Review';
          button.append(text,reference);
          button.onclick=()=>perform(()=>openQueueDraft(item.token));
          row.append(button);
          return row;
        }));
      }
      const waiting=drafts.length?drafts.length+(drafts.length===1?' customer waiting':' customers waiting'):'No customer forms waiting.';
      const status=manual?'Connected. '+waiting:waiting;
      if(byId('queue-status').textContent!==status)byId('queue-status').textContent=status;
    }
  }catch(error){
    if(generation!==queueView)return;
    if(manual&&(error.status===401||error.status===403)){
      byId('queue-status').textContent='Staff session needs to reconnect.';
      location.assign('/staff');
    }else byId('queue-status').textContent='Queue offline. Try Refresh / reconnect again.';
  }
}

function refreshStaffQueue(){
  if(!register&&staff&&!['loading','profile'].includes(view))refreshQueue(++queueView);
}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshStaffQueue();});
window.addEventListener('online',refreshStaffQueue);
navigator.serviceWorker?.addEventListener('message',event=>{if(event.data?.type==='sharepass-queue')refreshStaffQueue();});
byId('refresh-queue').onclick=async()=>{
  const button=byId('refresh-queue');
  button.disabled=true;
  byId('queue-status').textContent='Connecting…';
  try{await refreshQueue(++queueView,true);}
  finally{button.disabled=false;}
};
byId('queue-alerts').onclick=async()=>{
  const status=byId('queue-alert-status');
  if(!('Notification' in window)||!('serviceWorker' in navigator)||!('PushManager' in window)){
    status.textContent='Use Refresh / reconnect here. System push alerts are unavailable in this browser.';return;
  }
  try{
    const permission=await Notification.requestPermission();
    if(permission!=='granted'){status.textContent='Allow SharePass notifications in browser settings, then try again.';return;}
    const {public_key}=await fetchJson('/api/web-push');
    if(!public_key){status.textContent='Browser push is awaiting setup. Use Refresh / reconnect in the meantime.';return;}
    await navigator.serviceWorker.register('/queue-alert-worker.js');
    const registration=await navigator.serviceWorker.ready;
    const key=Uint8Array.from(atob(public_key.replace(/-/g,'+').replace(/_/g,'/')+'='),char=>char.charCodeAt(0));
    let subscription=await registration.pushManager.getSubscription();
    const previousKey=subscription?.options?.applicationServerKey;
    if(previousKey&&new Uint8Array(previousKey).join()!==key.join()){
      await subscription.unsubscribe();
      subscription=null;
    }
    subscription||=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
    await fetchJson('/api/web-push',{endpoint:subscription.endpoint});
    await registration.showNotification('SharePass test alert',{body:'Use device sound settings to set the alert volume.',tag:'sharepass-test'});
    status.textContent='Server alerts are on. Use device sound settings to adjust volume.';
  }catch{status.textContent='Browser alerts could not be enabled. Use Refresh / reconnect.';}
};

let deskQrLoading=false;
async function showDeskQr(){
  const tile=byId('desk-deposit-qr');
  if(view!=='desk'||!staff||register||deskQrLoading||tile.firstChild||
      getComputedStyle(tile).getPropertyValue('--desk-qr').trim()!=='block')return;
  deskQrLoading=true;
  try{
    const poster=await fetchJson('/api/booth');
    if(view!=='desk'||register)return;
    const url=new URL(poster.url,location.origin);
    if(url.origin!==location.origin||!/^\/booth\/[a-f0-9-]{36}$/.test(url.pathname))return;
    tile.replaceChildren(draft.qrImage(url.href,'QR for the customer deposit form'));
    tile.hidden=false;
  }catch{/* Open deposit remains available for retry. */}
  finally{deskQrLoading=false;}
}
if('ResizeObserver' in window)new ResizeObserver(showDeskQr).observe(byId('desk'));
else window.addEventListener('resize',showDeskQr);

async function openBoothPoster(){
  const link=byId('poster-link');
  const print=byId('poster-print');
  const download=byId('poster-download');
  const qr=byId('poster-qr');
  link.hidden=qr.hidden=print.disabled=download.disabled=true;
  show('booth-poster');
  const result=await fetchJson('/api/booth');
  if(view!=='booth-poster')return;
  const url=new URL(result.url,location.origin);
  if(url.origin!==location.origin||!/^\/booth\/[A-Za-z0-9_-]+$/.test(url.pathname))throw new Error('The booth link could not be opened.');
  byId('poster-booth').textContent=result.booth;
  qr.replaceChildren(draft.qrImage(url.href,'QR for this booth’s customer form'));
  link.href=url.href;
  link.hidden=qr.hidden=print.disabled=download.disabled=false;
}

function downloadPosterQr(){
  const svg=byId('poster-qr').querySelector('svg');
  if(!svg)return;
  const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml'}));
  const anchor=document.createElement('a');
  anchor.href=url;
  anchor.download='SharePass-booth-QR.svg';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

async function openQueueDraft(token){
  const result=await fetchJson('/api/queue/'+encodeURIComponent(token));
  if(view!=='desk')return;
  queueToken=token;
  queueReviewForm.reset();
  suggestion=undefined;
  byId('queue-code-options').open=false;
  showQueueCode();
  byId('queue-name').textContent=result.name;
  byId('queue-counts').textContent=balance(result.quantities);
  const contact=byId('queue-contact');
  contact.textContent=result.phone?'WhatsApp · '+result.phone:'';
  contact.hidden=!contact.textContent;
  const recipients=(result.recipients||[]).filter(person=>sharePassPhone(person.phone));
  byId('queue-recipient-details').hidden=!recipients.length;
  byId('queue-recipient-summary').textContent=recipients.length===1?'Collector':'Collectors';
  byId('queue-recipient-list').replaceChildren(...recipients.map(person=>{
    const row=document.createElement('li');
    row.textContent=[person.name,person.phone,person.quantities&&balance(person.quantities)].filter(Boolean).join(' · ');
    return row;
  }));
  show('queue-review');
  byId('confirm-queue').textContent='Confirm received · '+balance(result.quantities);
}

async function confirmQueueDraft(){
  const fields=byId('queue-review-form').elements;
  const custom=fields.custom_code.value.trim().toUpperCase();
  const result=await request('/api/queue/'+encodeURIComponent(queueToken)+'/confirm',{
    custody_confirmed:true,...(suggestion&&!custom?{suggested_code:suggestion}:{}),
    valid_minutes:Number(fields.valid_minutes.value),...(custom?{custom_code:custom}:{})
  });
  showReceipt(result);
}

async function perform(action){
  if(busy) return;
  busy = true;
  byId('error').textContent = '';
  try{await action();}
  catch(error){stopDemo();byId('error').textContent = error.message;}
  finally{busy = false;}
}

function openDeposit(){
  byId('deposit-form').reset();
  renderCounts('deposit');
  show('deposit');
}

function rememberIntake(token){
  const key='sharepass-intake:'+staff.session_key;
  if(token)sessionStorage.setItem(key,token);
  else sessionStorage.removeItem(key);
  intakeToken=token;
}

function reviewIntake(result){
  intakeCounts=result.quantities;
  byId('intake-review-form').reset();
  byId('intake-name').textContent=result.name||'No name entered';
  byId('intake-counts').textContent=balance(intakeCounts);
  show('intake-review');
}

function renderIntakeLink(link){
  const url=new URL(link,location.origin);
  if(url.origin!==location.origin||url.pathname!=='/intake/'+intakeToken)throw new Error('The customer link could not be opened.');
  const anchor=byId('intake-link');
  const qr=byId('intake-qr');
  anchor.href=url.href;
  anchor.hidden=false;
  qr.replaceChildren(draft.qrImage(url.href,'QR for the customer deposit form'));
  qr.hidden=false;
}

async function pollIntake(generation){
  if(intakeView!==generation)return;
  try{
    const result=await fetchJson('/api/intakes/'+intakeToken);
    if(intakeView!==generation)return;
    if(result.status==='submitted'){
      reviewIntake(result);
      return;
    }
    if(result.status==='confirmed'){
      await openIntake();
      return;
    }
    byId('intake-status').textContent='Ask the customer to scan and fill in their pass counts.';
  }catch(error){
    if(intakeView!==generation)return;
    if(error.status===404){
      await openIntake();
      return;
    }
    byId('intake-status').textContent='Connection unavailable. Check the form again when connected.';
  }
}

async function openIntake(){
  byId('intake-status').textContent='Opening the customer form…';
  byId('intake-link').hidden=true;
  byId('intake-qr').hidden=true;
  show('intake');
  const generation=intakeView;
  try{
    if(intakeToken){
      try{
        const result=await fetchJson('/api/intakes/'+intakeToken);
        if(intakeView!==generation)return;
        if(result.status==='submitted'){
          reviewIntake(result);
          return;
        }
        if(result.status==='confirmed')rememberIntake(null);
      }catch(error){
        if(intakeView!==generation)return;
        if(error.status!==404)throw error;
        rememberIntake(null);
      }
    }
    let link='/intake/'+intakeToken;
    if(!intakeToken){
      const result=await fetchJson('/api/intakes',{});
      if(intakeView!==generation)return;
      rememberIntake(result.token);
      link=result.url;
    }
    renderIntakeLink(link);
    byId('intake-status').textContent='Ask the customer to scan and fill in their pass counts.';
  }catch(error){
    if(intakeView!==generation)return;
    byId('intake-status').textContent='The customer form couldn’t be opened. Go back to try again, or enter the details manually.';
    byId('error').textContent=error.message;
  }
}

function manualIntake(counts){
  openDeposit();
  if(counts)setCounts('deposit',counts);
}

async function confirmIntake(){
  const location=byId('intake-review-form').elements.location.value;
  showReceipt(await request('/api/intakes/'+intakeToken+'/confirm',{location,custody_confirmed:true}),true);
}

async function saveDeposit(){
  const form = byId('deposit-form');
  const details={location:form.elements.location.value,quantities:readCounts(form),custody_confirmed:form.elements.confirmed.checked};
  const privateIntake=!register&&intakeToken;
  const result=privateIntake
    ?await request('/api/intakes/'+intakeToken+'/confirm',{...details,manual:true})
    :await request('/api/deposits',details);
  showReceipt(result,privateIntake);
}

function showReceipt(result,privateIntake=false){
  if(privateIntake)rememberIntake(null);
  receipt=result;
  byId('saved-code').textContent = receipt.collection_code;
  byId('saved-packet').textContent = 'Label the packet '+receipt.deposit.packet_id;
  const expiry=byId('saved-expiry');
  const expiresAt=receipt.deposit.code_expires_at;
  expiry.hidden=!Number.isFinite(expiresAt);
  expiry.textContent=expiry.hidden?'':'Expires '+new Date(expiresAt).toLocaleString([], {dateStyle:'medium',timeStyle:'short'});
  byId('pickup-updates-open').hidden=Boolean(register);
  byId('refresh-saved-code').hidden=Boolean(register);
  byId('depositor-receipt').replaceChildren();
  if(receipt.depositor_receipt){
    const link=draft.composeLink(receipt.depositor_receipt,'Send receipt to depositor');
    link.classList.add('whatsapp-action');
    byId('depositor-receipt').append(link);
  }
  show('saved');
}

function openShare(){
  show('share');
  const {deposit,collection_code:code} = receipt;
  draft.renderDeposit(byId('share-content'),{code,reference:register?undefined:deposit.packet_id,booth:register?'Box office':staff.booth_label||'Box office',location:register?'Main entrance':staff.pickup_location,quantities:deposit.remaining,recipients:receipt.recipients,expiresAt:deposit.code_expires_at,saveRecipients:people=>{receipt.recipients=people;}});
}

function openLookup(code=''){
  lookupForm.reset();
  lookupForm.elements.code.value=code;
  lookupForm.elements.reference.required=false;
  byId('lookup-reference').hidden=true;
  show('lookup');
  lookupForm.elements.code.focus();
}

async function findPasses(code=lookupForm.elements.code.value){
  const reference=view==='lookup'&&!byId('lookup-reference').hidden?lookupForm.elements.reference.value.trim():'';
  match=undefined;
  try{
    match=await request('/api/verify',{collection_code:code,...(reference?{collection_reference:reference}:{})});
  }catch(error){
    if(!error.pickupReferenceRequired)throw error;
    openLookup(code);
    byId('lookup-reference').hidden=false;
    lookupForm.elements.reference.required=true;
    lookupForm.elements.reference.focus();
    return;
  }
  if(!match.claim_token) throw new Error('This packet is stored at another counter.');
  byId('collect-form').reset();
  byId('pickup-location').hidden=match.deposit.location.startsWith('Packet ');
  byId('slot').textContent = match.deposit.location;
  renderCounts('collect',match.deposit.remaining);
  show('collect');
}

async function reserve(){
  const form = byId('collect-form');
  showHandover(await request('/api/deposits/'+match.deposit.id+'/release',{
    packet_id:form.elements.packet.value,claim_token:match.claim_token,version:match.deposit.version,quantities:readCounts(form)
  }));
}

function showHandover(result){
  pending = result.collection;
  byId('handover-summary').textContent = balance(pending.quantities)+' · '+result.deposit.location;
  show('handover');
}

async function confirm(){
  showBalance(await request('/api/collections/'+pending.id+'/handover',{version:pending.version,handover_confirmed:true}));
}

function showBalance(result){
  byId('balance').textContent = balance(result.deposit.remaining);
  const compose=byId('pickup-update-draft');
  compose.replaceChildren();
  if(result.depositor_update?.channel==='whatsapp'&&sharePassPhone(result.depositor_update.address)){
    compose.append(draft.composeLink(result.depositor_update,'Open depositor WhatsApp draft'));
  }
  show('done');
}

const updatesForm=byId('pickup-updates-form');
byId('pickup-updates-open').onclick=()=>{
  updatesForm.reset();
  byId('pickup-updates-off').hidden=!receipt.update_channel;
  show('pickup-updates');
};
function saveUpdates(channel){
  perform(async()=>{
    const phone=channel==='whatsapp'?draft.normalizePhone(updatesForm.elements.phone.value):'';
    const result=await fetchJson('/api/deposits/'+receipt.deposit.id+'/updates',{
      request_id:crypto.randomUUID(),packet_id:receipt.deposit.packet_id,channel,
      name:receipt.deposit.depositor_label||'',...(phone?{phone:'+'+phone}:{})
    });
    updatesForm.reset();
    receipt.update_channel=result.update_channel;
    show('saved');
  });
}
updatesForm.onsubmit=event=>{event.preventDefault();saveUpdates('whatsapp');};
byId('pickup-updates-off').onclick=()=>saveUpdates('none');

function stopDemo(){
  clearTimeout(timer);
  playing = false;
  byId('pause').textContent = demoIndex >= steps.length ? 'Finished' : 'Play';
  byId('pause').disabled = demoIndex >= steps.length;
}

function demoAction(next){
  return async()=>{
    if(register && demoIndex < steps.length){
      demoIndex = steps.length;
      stopDemo();
    }
    await next();
  };
}

const steps = [
  openDeposit,
  ()=>setCounts('deposit',{normal:4,vip:2}),
  ()=>wizards.deposit.show(1),
  ()=>{byId('deposit-form').elements.location.value='A-12';},
  ()=>wizards.deposit.show(2),
  ()=>{byId('deposit-form').elements.confirmed.checked=true;},
  saveDeposit,
  ()=>{receipt.recipients=[{name:'Riya',phone:'+12025550123'}];openShare();byId('share-content').querySelector('.scan-tile').click();},
  ()=>{document.querySelector('.qr-scan')?.close();openLookup();byId('lookup-form').elements.code.value = receipt.collection_code;},
  findPasses,
  ()=>{byId('collect-form').elements.packet.value=receipt.deposit.packet_id;},
  ()=>wizards.collect.show(1),
  ()=>setCounts('collect',{normal:2,vip:1}),
  reserve,
  confirm
];

function schedule(){
  timer = setTimeout(async()=>{
    await perform(steps[demoIndex++]);
    if(!playing || demoIndex >= steps.length) stopDemo();
    else schedule();
  },demoIndex===8 ? 2400 : 800);
}

function startDemo(){
  stopDemo();
  register = freshRegister();
  demoIndex = 0;
  show('desk');
  byId('demo-bar').hidden = false;
  playing = true;
  byId('pause').disabled = false;
  byId('pause').textContent = 'Pause';
  schedule();
}

function leaveDemo(){
  stopDemo();
  register = null;
  show('desk');
  byId('demo-bar').hidden = true;
}

byId('pause').onclick = () => {
  if(playing){stopDemo();return;}
  playing = true;
  byId('pause').textContent = 'Pause';
  schedule();
};
byId('demo').onclick = byId('replay').onclick = startDemo;
byId('leave').onclick = leaveDemo;

byId('home').onclick = byId('saved-done').onclick = byId('done-action').onclick = demoAction(()=>show('desk'));
byId('help').onclick = demoAction(()=>show('guide'));
byId('deposit-action').onclick = demoAction(()=>{
  if(register)return openDeposit();
  if(recovery)return perform(recover);
  return perform(openBoothPoster);
});
byId('one-time-intake').onclick=()=>perform(openIntake);
byId('share-action').onclick = demoAction(openShare);
byId('share-back').onclick=()=>show('saved');
const refreshForm=byId('refresh-code-form');
byId('refresh-saved-code').onclick=()=>{refreshForm.reset();refreshAttempt=undefined;show('refresh-code');};
byId('cancel-refresh').onclick=()=>show('saved');
refreshForm.onsubmit=event=>{
  event.preventDefault();
  perform(async()=>{
    const packet=refreshForm.elements.packet.value.trim().toUpperCase();
    if(refreshAttempt?.packet!==packet)refreshAttempt={packet,id:crypto.randomUUID()};
    const result=await fetchJson('/api/codes/refresh',{request_id:refreshAttempt.id,
      packet_id:packet,collection_code:receipt.collection_code});
    showReceipt({...receipt,...result});
    byId('error').textContent='Code refreshed. Share the replacement with the collectors.';
  });
};
byId('poster-open').onclick = ()=>perform(openBoothPoster);
byId('poster-print').onclick = ()=>window.print();
byId('poster-download').onclick = downloadPosterQr;
byId('queue-review-form').onsubmit = event=>{event.preventDefault();perform(confirmQueueDraft);};
byId('confirm').onclick = () => perform(demoAction(confirm));
byId('check-intake').onclick=()=>{if(intakeToken)perform(()=>pollIntake(intakeView));};
byId('intake-manual').onclick = () => manualIntake();
byId('intake-correct').onclick = () => manualIntake(intakeCounts);
byId('intake-review-form').onsubmit = event => {event.preventDefault();perform(confirmIntake);};
for(const [id,action] of [['deposit-form',saveDeposit],['lookup-form',findPasses],['collect-form',reserve]]){
  const form = byId(id);
  form.onsubmit = event => {event.preventDefault();perform(demoAction(action));};
  form.addEventListener('click',event=>{
    const step = event.target.dataset.step;
    if(!step) return;
    const input = event.target.parentElement.querySelector('input');
    input.value = Math.max(0,Math.min(Number(input.max),Number(input.value)+Number(step)));
  });
}
function ready(context){
  staff=context;
  byId('admin-link').hidden=!staff.admin;
  if(staff.booth_label)byId('desk').querySelector('.eyebrow').textContent='SharePass · '+staff.booth_label;
  if(staff.internal)byId('signout-link').href='/disconnect';
  else if(staff.owner_password_session)byId('signout-link').onclick=event=>{
    event.preventDefault();
    perform(async()=>{
      const response=await fetch('/api/owner/logout',{method:'POST'});
      if(!response.ok)throw Error('Could not sign out. Try again.');
      location.assign('/connect');
    });
  };
  if(!staff.staff_label){show('profile');return;}
  recovery=JSON.parse(sessionStorage.getItem('sharepass-pending:'+staff.session_key)||'null');
  intakeToken=sessionStorage.getItem('sharepass-intake:'+staff.session_key);
  show('desk');
}

byId('profile-form').onsubmit=event=>{
  event.preventDefault();
  perform(async()=>ready(await fetchJson('/api/profile',{name:event.currentTarget.elements.name.value})));
};
show('loading');
fetchJson('/api/context').then(context=>{
  ready(context);
}).catch(error=>{
  byId('access-note').textContent=error.message;
  byId('return-home').hidden=false;
});
