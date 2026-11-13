'use strict';
const byId = id => document.getElementById(id);
const scope = {event_id:'training-event-001',booth_id:'B1',operator:'Preview staff'};
const freshRegister = () => new DemoStore({seed:false,singleEvent:true,eventName:'SharePass'});
let register = null;
let staff, recovery = null;
let receipt, match, pending, view, demoIndex = 0, timer, playing = false, busy = false;
let intakeToken, intakeCounts, intakeView = 0;
let queueToken, queueView=0, queueSignature, suggestion, refreshSequence=0, viewRevision=0;
let staffMessages=[], openStaffMessage, replying=false;
const seenStaffMessages=new Set(), uncertainStaffReplies=new Map();
let staffMessageCursor;
let deskMode="deposit",boothQrUrl="",queuePollTimer,historyData=[],historyFilter="all",historyCursor,historyLoading=false,historyPending=[];
let previousQueueTokens;
let historyLoaded=false;
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
  viewRevision++;
  if(id!=='desk'&&byId('staff-message').open)byId('staff-message').close();
  if(view==='intake'){
    intakeView++;
  }
  queueView++;
  byId('home').classList.toggle('back-hidden', ['desk','loading','profile'].includes(id));
  byId('menu').hidden = ['loading','profile'].includes(id);
  byId('desk-tabs').hidden=!['desk','history'].includes(id);
  byId('tab-history').ariaPressed=String(id==='history');
  for(const section of document.querySelectorAll('main>section')) section.hidden = section.id !== id;
  if(view === 'share' && id !== 'share') draft.clear();
  byId('error').textContent = '';
  if(id==='saved'&&receipt){
    const uncertain=!register&&recovery?.path==='/api/codes/refresh';
    byId('saved-code').textContent=uncertain?'Refresh pending':receipt.collection_code;
    if(uncertain)byId('error').textContent='Recover the last action before sharing a collection code.';
  }
  byId('menu').open = false;
  view = id;
  wizards[id]?.show(0,false);
  if(id === 'desk'){
    byId('deposit-action').textContent=register?'New deposit':'Open printable booth QR';
    setDeskMode(deskMode);
    byId('staff-message-open').hidden=Boolean(register)||!staffMessages.length;
    renderRecovery().catch(error=>{if(view==='desk')byId('error').textContent=error.message;});
    byId('queue-panel').hidden=Boolean(register)||deskMode!=='deposit';
    if(!register)showDeskQr();
  }
  if(id==='desk'&&staff&&!register)refreshQueue(queueView);
  if(id==='history'){byId('tab-deposit').ariaPressed='false';byId('tab-collect').ariaPressed='false';loadHistory();}
  byId(id).querySelector('h1, button')?.focus();
}

byId('menu').addEventListener('keydown',event=>{
  if(event.key!=='Escape'||!byId('menu').open)return;
  event.preventDefault();
  byId('menu').open=false;
  byId('menu').querySelector('summary').focus();
});

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
    button.textContent = 'Resume handover · '+pickupLocation(item);
    button.onclick = () => showHandover({deposit:item,collection:item.pending_collection});
    return button;
  }));
}

function pickupLocation(deposit){
  return /^Packet [A-F0-9]{12}$/.test(deposit.location||'')&&deposit.packet_id?deposit.packet_id:deposit.location;
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

async function loadHistory(more=false){
  if(historyLoading||view!=='history')return;
  if(!more&&historyLoaded){renderHistory();return;}
  historyLoading=true;
  const current=staff;
  byId('history-status').textContent='Loading booth history…';
  try{
    const result=register?register.state(scope.event_id):await fetchJson('/api/history?limit=100'+
      (more&&historyCursor?'&cursor='+encodeURIComponent(historyCursor):''));
    if(staff!==current||view!=='history')return;
    const entries=Array.isArray(result.deposits)?result.deposits:[];
    historyData=more?[...new Map([...historyData,...entries].map(item=>[item.id,item])).values()]:entries;
    historyPending=Array.isArray(result.pending_handovers)?result.pending_handovers:historyData.filter(item=>item.pending_collection);
    historyCursor=result.next_cursor||null;
    historyLoaded=true;
    renderHistory();
  }catch(error){
    if(view==='history')byId('history-status').textContent=error.message;
  }finally{historyLoading=false;}
}

function renderHistory(){
  const entries=historyFilter==='pending'?historyPending:historyData;
  byId('history-all').ariaPressed=String(historyFilter==='all');
  byId('history-pending').ariaPressed=String(historyFilter==='pending');
  byId('history-list').replaceChildren(...entries.map(item=>{
    const row=document.createElement('li');row.className='history-entry';
    const name=document.createElement('h2');name.textContent=item.depositor_label||'Pass deposit';
    const badge=document.createElement('span');badge.className='history-badge'+(item.handover_pending||item.pending_collection?' pending':'');
    const available=Object.values(item.remaining||{}).reduce((sum,value)=>sum+Number(value||0),0);
    badge.textContent=item.handover_pending||item.pending_collection?'Handover awaiting confirmation':available?'Available for pickup':'Completed';
    const counts=document.createElement('p');counts.textContent='Remaining · '+balance(item.remaining||{});
    const details=document.createElement('small');
    const created=new Date(item.created_at||item.createdAt||'');
    details.textContent=[/^Packet |^PKT-/.test(pickupLocation(item))?'':pickupLocation(item),Number.isNaN(created.getTime())?'':created.toLocaleString([],{
      dateStyle:'medium',timeStyle:'short'
    })].filter(Boolean).join(' · ');
    row.append(name,badge,counts,details);
    if(item.pending_collection){
      const reserved=document.createElement('p');reserved.textContent='Reserved · '+balance(item.pending_collection.quantities);
      const resume=document.createElement('button');resume.type='button';resume.className='primary';resume.textContent='Resume this handover';
      resume.onclick=()=>showHandover({deposit:item,collection:item.pending_collection});
      row.append(reserved,resume);
    }
    const open=document.createElement('button');open.type='button';open.textContent='Open receipt';
    open.onclick=()=>perform(async()=>{
      const current=await fetchJson('/api/deposits/'+item.id+'/receipt');
      if(current.deposit.handover_pending){
        if(current.deposit.pending_collection)showHandover({deposit:current.deposit,collection:current.deposit.pending_collection});
        else byId('error').textContent='This handover is awaiting confirmation by its operator.';
      }else if(Object.values(current.deposit.remaining).some(Boolean))showReceipt(current,false);
      else showBalance(current);
    });
    row.append(open);
    if(available&&!item.handover_pending&&!item.pending_collection){
      const collect=document.createElement('button');collect.type='button';collect.textContent='Collect passes';
      collect.onclick=()=>perform(async()=>{const current=await fetchJson('/api/deposits/'+item.id+'/receipt');openLookup(current.collection_code);lookupForm.elements.reference.value=current.deposit.packet_id;byId('lookup-reference').hidden=false;await findPasses();});row.append(collect);
    }
    return row;
  }));
  byId('history-status').textContent=entries.length?entries.length+' '+(historyFilter==='pending'?'pending handovers':'deposits')+' shown.':
    historyFilter==='pending'?'No pending handovers at this booth.':'No deposits at this booth yet.';
  byId('history-more').hidden=!historyCursor;
}

byId('history-all').onclick=()=>{historyFilter='all';renderHistory();};
byId('history-pending').onclick=()=>{historyFilter='pending';renderHistory();};
byId('history-refresh').onclick=()=>{historyLoaded=false;loadHistory();};
byId('history-more').onclick=()=>loadHistory(true);

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
sharePassAutoAdvance(inlineLookup.elements.code,value=>view==='desk'&&/^[0-9]{4}$/.test(value),
  ()=>inlineLookup.requestSubmit());
const pickupForm=byId('collect-form');
const lookupForm=byId('lookup-form');
sharePassAutoAdvance(lookupForm.elements.code,value=>!byId('lookup').hidden&&byId('lookup-reference').hidden&&/^[0-9]{4}$/.test(value),
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
    error.refreshResolved=result.refreshResolved===true;
    error.pickupReferenceRequired=result.pickup_reference_required===true;
    throw error;
  }
  return result;
}

function setRecovery(action){
  if(action?.path==='/api/codes/refresh'&&Object.hasOwn(action.body,'collection_code')){
    throw new Error('Collection codes must not enter recovery storage.');
  }
  const key='sharepass-pending:'+staff.session_key;
  if(action) sessionStorage.setItem(key,JSON.stringify(action));
  else sessionStorage.removeItem(key);
  recovery=action;
}

async function submit(action){
  try{
    const result=await fetchJson(action.path,action.body);
    historyLoaded=false;
    setRecovery(null);
    return result;
  }catch(error){
    if(knownFailure(error)) setRecovery(null);
    else throw new Error('The result is uncertain. Return to the desk and recover the last action before handling more passes.');
    throw error;
  }
}

function knownFailure(error){return error.notExecuted&&error.status!==401&&error.status!==403;}

function request(path,body){
  if(register)return register.request(path,{...scope,...body,request_id:crypto.randomUUID()});
  if(path==='/api/verify') return fetchJson(path,body);
  if(recovery)throw new Error('Recover the last action from the desk first.');
  const action={path,body:{...body,request_id:crypto.randomUUID()}};
  setRecovery(action);
  return submit(action);
}

function clearLegacyStaffReply(){
  if(recovery?.path!=='/api/staff-messages/reply')return false;
  const {id,reply}=recovery.body||{};
  setRecovery(null); // Replies never changed custody; do not replay old intent.
  if(typeof id==='string'&&id&&['done','working','help'].includes(reply)){
    uncertainStaffReplies.set(id,reply);
  }
  return true;
}

async function recover(){
  const action=recovery;
  if(clearLegacyStaffReply()){
    return refreshQueue(++queueView);
  }
  if(action.path==='/api/codes/refresh')return recoverRefresh(action);
  if(action.finalize){
    try{return await finishDirectHandover(await fetchJson(action.path,action.body));}
    catch(error){if(knownFailure(error)&&recovery===action)setRecovery(null);throw error;}
  }
  const result=await submit(action);
  if(action.path==='/api/deposits'||action.path.endsWith('/confirm')){
    showReceipt(result,action.path.startsWith('/api/intakes/'));window.sharePassToast?.('Passes received. Collection code ready.');
  }
  else if(action.path.endsWith('/release'))showHandover(result);
  else {showBalance(result);window.sharePassToast?.('Handover confirmed.');}
}

async function refreshQueue(generation,manual=false){
  if(generation!==queueView||register||!staff)return;
  try{
    {
      const result=await fetchJson('/api/queue',null,AbortSignal.timeout(5500));
      if(view==='desk'&&!boothQrUrl)showDeskQr();
      if(generation!==queueView)return;
      const drafts=result.drafts||[];
      staffMessages=result.messages||[];
      const inbox=byId('staff-message-open');
      inbox.hidden=!staffMessages.length;
      inbox.textContent='Staff messages ('+staffMessages.length+')';
      showStaffMessage(false);
      const signature=JSON.stringify(drafts);
      if(queueSignature!==signature){
        queueSignature=signature;
        byId('queue-list').replaceChildren(...drafts.map(item=>{
          const row=document.createElement('li');
          const button=document.createElement('button');
          button.type='button';button.className='primary';button.textContent='Review and receive';
          const text=document.createElement('div');text.className='queue-entry-details';
          const name=document.createElement('strong');
          name.textContent=item.name;
          const counts=document.createElement('small');
          counts.textContent=balance(item.quantities);
          text.append(name,counts);
          const reference=document.createElement('span');
          reference.className='queue-reference';
          reference.textContent=item.collection_code?'Code '+item.collection_code:'Review';
          text.append(reference);
          button.onclick=()=>perform(()=>openQueueDraft(item.token));
          const actions=document.createElement('div');actions.className='queue-actions';actions.append(button);
          row.append(text,actions);
          return row;
        }));
      }
      const tokens=new Set(drafts.map(item=>item.token));
      if(previousQueueTokens&&drafts.some(item=>!previousQueueTokens.has(item.token)))announceQueueArrival(drafts.length);
      previousQueueTokens=tokens;
      byId('queue-count').textContent=String(drafts.length)+' waiting';
      const waiting=drafts.length?drafts.length+(drafts.length===1?' customer waiting':' customers waiting'):'No customer forms waiting.';
      const status=manual?'Connected. '+waiting:waiting;
      if(byId('queue-status').textContent!==status)byId('queue-status').textContent=status;
    }
  }catch(error){
    if(generation!==queueView)return;
    if(manual&&(error.status===401||error.status===403)){
      byId('queue-status').textContent='Staff session needs to reconnect.';
      location.assign('/staff');
    }else byId('queue-status').textContent='Waiting for connection. Retrying automatically…';
  }
}

function showStaffMessage(manual){
  const cursor=staffMessages.findIndex(item=>item.id===staffMessageCursor);
  const message=manual?staffMessages[(cursor+1)%staffMessages.length]:
    staffMessages.find(item=>!seenStaffMessages.has(item.id));
  if(!message||register)return;
  const dialog=byId('staff-message');
  if(view!=='desk'||busy||replying||dialog.open||(!manual&&
    (recovery||document.hidden||document.querySelector('dialog[open]')||byId('desk-code-form').elements.code.value)))return;
  openStaffMessage=message;
  staffMessageCursor=message.id;
  seenStaffMessages.add(message.id);
  byId('staff-message-text').textContent=message.message;
  renderStaffReplyChoices();
  dialog.showModal();
}
function renderStaffReplyChoices(){
  const retry=uncertainStaffReplies.get(openStaffMessage?.id);
  for(const choice of byId('staff-message').querySelectorAll('[data-staff-reply]')){
    choice.disabled=Boolean(replying)||Boolean(retry&&retry!==choice.dataset.staffReply);
  }
  byId('staff-message-next').disabled=Boolean(replying)||staffMessages.length<2;
  byId('staff-message-later').disabled=Boolean(replying);
  byId('staff-message-status').textContent=retry?
    'Reply not confirmed. Retry the same response to check it safely, or return later.':'';
}
byId('staff-message-open').onclick=()=>showStaffMessage(true);
byId('staff-message-next').onclick=()=>{
  if(replying)return;
  byId('staff-message').close();
  showStaffMessage(true);
};
byId('staff-message-later').onclick=()=>{if(!replying)byId('staff-message').close();};
byId('staff-message').addEventListener('cancel',event=>{if(replying)event.preventDefault();});
for(const button of document.querySelectorAll('[data-staff-reply]'))button.onclick=async()=>{
  const dialog=byId('staff-message'),message=openStaffMessage,reply=button.dataset.staffReply;
  const previous=uncertainStaffReplies.get(message?.id);
  if(!message||replying||register||view!=='desk'||!dialog.open||previous&&previous!==reply)return;
  const attempt={session:staff,generation:viewRevision,message};
  replying=attempt;
  const current=()=>staff===attempt.session&&replying===attempt;
  const visible=()=>current()&&viewRevision===attempt.generation&&view==='desk'&&dialog.open&&openStaffMessage===message&&!register;
  renderStaffReplyChoices();
  let refresh=false,conflict=false;
  try{
    // This endpoint is idempotent by message, response and staff. Never place a
    // reply in the custody journal, even when a custody action is already pending.
    await fetchJson('/api/staff-messages/reply',{id:message.id,reply},AbortSignal.timeout(10000));
    if(!current())return;
    uncertainStaffReplies.delete(message.id);
    staffMessages=staffMessages.filter(item=>item.id!==message.id);
    if(visible()){dialog.close();refresh=true;}
  }catch(error){
    if(!current())return;
    // A later rejection does not prove an earlier uncertain attempt never landed.
    if(!error.notExecuted||previous)uncertainStaffReplies.set(message.id,reply);
    if(visible()){
      renderStaffReplyChoices();
      byId('staff-message-status').textContent=error.status===409?
        'This message was already answered or expired. Refresh the inbox.':
        uncertainStaffReplies.has(message.id)?'Reply not confirmed. Retry the same response to check it safely, or return later.':error.message;
      if(error.status===409){dialog.close();refresh=true;conflict=true;}
    }
  }finally{
    if(current()){
      replying=false;
      // Do not overwrite an error or a newer dialog after an asynchronous result.
      const status=byId('staff-message-status').textContent;
      renderStaffReplyChoices();
      byId('staff-message-status').textContent=status;
      if(refresh)await refreshQueue(++queueView);
      if(conflict&&staff===attempt.session&&viewRevision===attempt.generation&&view==='desk'&&!register){
        byId('error').textContent='The message was already answered or expired. Check the inbox; no new reply was confirmed.';
      }
    }
  }
};

function refreshStaffQueue(){
  historyLoaded=false;
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
    status.textContent='Booth notifications are on.';
    reportBrowserStatus();
  }catch{status.textContent='Browser alerts could not be enabled. Use Refresh / reconnect.';}
};

function setDeskMode(mode){
  deskMode=mode;
  byId('desk-code-form').hidden=mode!=='collect';
  byId('deposit-panel').hidden=mode!=='deposit';
  byId('queue-panel').hidden=Boolean(register)||mode!=='deposit';
  byId('tab-deposit').ariaPressed=String(mode==='deposit'&&view!=='history');
  byId('tab-collect').ariaPressed=String(mode==='collect'&&view!=='history');
}
for(const mode of ['deposit','collect'])byId('tab-'+mode).onclick=()=>{
  deskMode=mode;show('desk');
  if(mode==='collect')inlineLookup.elements.code.focus();
};
byId('tab-history').onclick=()=>show('history');
byId('settings-open').onclick=()=>show('settings');
  byId('desk-refresh').onclick=()=>perform(async()=>{historyLoaded=false;historyData=[];if(view==='history')await loadHistory();else ready(await fetchJson('/api/context'));});
byId('copy-deposit-link').onclick=()=>{if(boothQrUrl)window.sharePassCopyText(boothQrUrl,byId('desk-link-status'));};
function reportBrowserStatus(){
  if(!staff?.internal)return;
  fetchJson('/api/device/status',{platform:'web',...('Notification' in window?{notifications_enabled:Notification.permission==='granted'}:{})}).catch(()=>{});
}
function scheduleQueuePoll(){
  clearTimeout(queuePollTimer);
  queuePollTimer=setTimeout(async()=>{
    if(staff&&!register&&!document.hidden)await refreshQueue(++queueView);
    scheduleQueuePoll();
  },60000);
}
function announceQueueArrival(count){
  if(!('Notification' in window)||Notification.permission!=='granted')return;
  navigator.serviceWorker?.getRegistration('/').then(registration=>registration?.showNotification('New SharePass deposit',{
    body:count+' customer '+(count===1?'form is':'forms are')+' waiting at your booth.',tag:'sharepass-queue',icon:'/assets/sharepass-approved-logo.jpg',data:{url:'/staff'}
  })).catch(()=>{});
}
let deskQrLoading=false;
async function showDeskQr(){
  const tile=byId('desk-deposit-qr');
  if(view!=='desk'||!staff||register||deskQrLoading||tile.firstChild)return;
  deskQrLoading=true;
  try{
    const poster=staff.booth_url?{url:staff.booth_url}:await fetchJson('/api/booth');
    if(view!=='desk'||register)return;
    const url=new URL(poster.url,location.origin);
    if(url.origin!==location.origin||!/^\/booth\/[a-f0-9-]{36}$/.test(url.pathname))return;
    boothQrUrl=url.href;
    tile.replaceChildren(draft.qrImage(url.href,'QR for the customer deposit form'));
    tile.hidden=false;
    byId('copy-deposit-link').disabled=false;
    const share=byId('share-deposit-link');
    share.href='https://wa.me/?text='+encodeURIComponent('Leave your passes with SharePass by Bullseye Entertainment. Fill in your details here, then hand the passes to staff: '+boothQrUrl);
    share.hidden=false;byId('desk-link-status').textContent='This booth QR stays the same for every customer.';
  }catch{byId('desk-link-status').textContent='Connecting to your booth… Open Settings to retry if needed.';}
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
  byId('queue-code-options').hidden=result.intake_version===2;
  showQueueCode();
  if(result.intake_version===2)byId('queue-confirm-summary').textContent='The pickup code is generated after you confirm receipt of the passes.';
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
  window.sharePassToast?.('Passes received. Collection code ready.');
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
  window.sharePassToast?.('Passes received. Collection code ready.');
}

async function saveDeposit(){
  const form = byId('deposit-form');
  const details={location:form.elements.location.value,quantities:readCounts(form),custody_confirmed:form.elements.confirmed.checked};
  const privateIntake=!register&&intakeToken;
  const result=privateIntake
    ?await request('/api/intakes/'+intakeToken+'/confirm',{...details,manual:true})
    :await request('/api/deposits',details);
  showReceipt(result,privateIntake);
  window.sharePassToast?.('Passes received. Collection code ready.');
}

function showReceipt(result,privateIntake=false){
  if(privateIntake)rememberIntake(null);
  receipt=result;
  byId('saved-code').textContent = receipt.collection_code;
  byId('saved-packet').textContent = receipt.depositor_name||receipt.deposit.depositor_label||'';
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
  if(!receipt){show('desk');return;}
  if(!register&&recovery?.path==='/api/codes/refresh')return perform(()=>recoverRefresh(recovery));
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
  const generation=viewRevision,session=staff;
  let reference=view==='lookup'&&!byId('lookup-reference').hidden?lookupForm.elements.reference.value.trim():'';
  if(reference.startsWith('https://')){
    const receipt=draft.receiptDetails(reference);
    if(receipt.code!==code)throw new Error('The receipt link has a different collection code.');
    reference=receipt.reference;
  }
  match=undefined;
  try{
    const result=await request('/api/verify',{collection_code:code,...(reference?{collection_reference:reference}:{})});
    if(generation!==viewRevision||session!==staff)return;
    match=result;
  }catch(error){
    if(generation!==viewRevision||session!==staff)return;
    if(!error.pickupReferenceRequired)throw error;
    openLookup(code);
    byId('lookup-reference').hidden=false;
    lookupForm.elements.reference.required=true;
    lookupForm.elements.reference.focus();
    return;
  }
  if(!match.claim_token) throw new Error('This packet is stored at another counter.');
  byId('collect-form').reset();
  byId('pickup-location').hidden=false;
  byId('slot').textContent = /^Packet |^PKT-/.test(pickupLocation(match.deposit))?'':pickupLocation(match.deposit);
  byId('pickup-customer').textContent=match.deposit.depositor_label||'Group pickup';
  byId('collect-form').elements.packet.value=match.deposit.packet_id;
  renderCounts('collect',match.deposit.remaining);
  show('collect');
}

async function reserve(){
  const form = byId('collect-form');
  if(!form.elements.name_confirmed.checked)throw new Error('Confirm the depositor’s name and physical handover.');
  const path='/api/deposits/'+match.deposit.id+'/release',body={
    packet_id:match.deposit.packet_id,claim_token:match.claim_token,version:match.deposit.version,quantities:readCounts(form)
  };
  if(register)return finishDirectHandover(await request(path,body));
  if(recovery)throw new Error('Recover the last action first.');
  const action={path,body:{...body,request_id:crypto.randomUUID()},finalize:true};
  setRecovery(action);
  const controls=[...form.querySelectorAll('button,input')];controls.forEach(control=>control.disabled=true);
  // Keep physical-handover intent until the confirmation request is journaled.
  try{await finishDirectHandover(await fetchJson(action.path,action.body));}
  catch(error){
    if(knownFailure(error)&&recovery===action)setRecovery(null);
    if(error.notExecuted)throw error;
    throw new Error('Recover the saved handover from the desk before handing over any more passes.');
  }
  finally{controls.forEach(control=>control.disabled=false);}
}

async function finishDirectHandover(result){
  const collection=result.collection;
  if(register){pending=collection;return confirm();}
  const action={path:'/api/collections/'+collection.id+'/handover',body:{version:collection.version,handover_confirmed:true,request_id:crypto.randomUUID()}};
  setRecovery(action);showBalance(await submit(action));
  window.sharePassToast?.('Handover confirmed.');
}

function showHandover(result){
  pending = result.collection;
  byId('handover-summary').textContent = balance(pending.quantities)+' · '+pickupLocation(result.deposit);
  show('handover');
}

async function confirm(){
  showBalance(await request('/api/collections/'+pending.id+'/handover',{version:pending.version,handover_confirmed:true}));
  window.sharePassToast?.('Handover confirmed.');
}

function showBalance(result){
  byId('balance').textContent = balance(result.deposit.remaining);
  const compose=byId('pickup-update-draft');
  compose.replaceChildren();
  if(result.depositor_update?.channel==='whatsapp'&&sharePassPhone(result.depositor_update.address)){
    compose.append(draft.composeLink(result.depositor_update,Object.values(result.deposit.remaining).some(Boolean)?'Depositor update':'Final depositor update'));
  }
  show('done');
}

const updatesForm=byId('pickup-updates-form');
byId('back-from-update').onclick=()=>show('saved');
byId('pickup-updates-open').onclick=()=>perform(async()=>{
  const current=await fetchJson('/api/deposits/'+receipt.deposit.id+'/receipt');
  const target=byId('prepared-depositor-update');target.replaceChildren();
  if(current.depositor_update)target.append(draft.composeLink(current.depositor_update,'Open depositor WhatsApp draft'));
  else target.textContent='No depositor WhatsApp contact was provided.';
  show('pickup-updates');
});
function saveUpdates(channel){
  perform(async()=>{
    const phone=channel==='whatsapp'?draft.normalizePhone(updatesForm.elements.phone.value):'';
    const result=await fetchJson('/api/deposits/'+receipt.deposit.id+'/updates',{
      request_id:crypto.randomUUID(),packet_id:receipt.deposit.packet_id,channel,
      name:receipt.deposit.depositor_label||'',...(phone?{phone:'+'+phone}:{})
    });
    updatesForm.reset();
    receipt.update_channel=result.update_channel;
    receipt.depositor_phone=phone?'+'+phone:receipt.depositor_phone;
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
  ()=>wizards.collect.show(0),
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
byId('help-alerts').onclick=async()=>{
  const button=byId('help-alerts');button.disabled=true;
  try{await byId('queue-alerts').onclick();byId('help-alert-status').textContent=byId('queue-alert-status').textContent;}
  finally{button.disabled=false;}
};
byId('deposit-action').onclick = demoAction(()=>{
  if(register)return openDeposit();
  if(recovery)return perform(recover);
  return perform(openBoothPoster);
});
byId('one-time-intake').onclick=()=>perform(openIntake);
byId('share-action').onclick = demoAction(openShare);
byId('share-back').onclick=()=>show('saved');
const refreshForm=byId('refresh-code-form');
function openRefresh(action=null){
  refreshForm.reset();
  const needsCode=Boolean(action)&&receipt?.deposit.packet_id!==action.body.packet_id;
  byId('refresh-original-code').hidden=!needsCode;
  refreshForm.elements.code.required=needsCode;
  refreshForm.elements.packet.readOnly=Boolean(action);
  if(action)refreshForm.elements.packet.value=action.body.packet_id;
  show('refresh-code');
}

// Only packet/request identifiers enter the existing per-staff, per-tab journal.
// The original collection code stays in memory, never in recovery storage.
async function recoverRefresh(action){
  return runRefresh(action,()=>fetchJson('/api/codes/refresh/recover',action.body),true);
}

async function runRefresh(action,send,recovering=false){
  const generation=viewRevision,session=staff,sequence=++refreshSequence,original=receipt;
  const current=()=>recovery===action&&staff===session&&sequence===refreshSequence;
  const visible=()=>current()&&generation===viewRevision&&receipt===original&&!register;
  try{
    const result=await send();
    if(!visible())return; // Keep the journal so a later recovery can display the result.
    if(result.refresh_pending){
      openRefresh(action);
      byId('error').textContent='No completed refresh was found yet. Retry the same packet with its original code.';
      return;
    }
    setRecovery(null);
    const samePacket=original?.deposit.packet_id===action.body.packet_id;
    showReceipt({...((samePacket)?original:{}),...result,
      ...(samePacket&&Object.hasOwn(original,'recipients')?{recipients:original.recipients}:{})});
    byId('error').textContent='Code refreshed. Share the replacement with the collectors.';
    window.sharePassToast?.('Collection code updated.');
  }catch(error){
    // A failed lookup/auth check cannot prove the original request did not commit.
    // Only the initial response or a confirmed terminal replay can release the journal.
    const resolved=error.notExecuted&&(!recovering||error.refreshResolved);
    const display=visible();
    if(current()&&resolved){
      setRecovery(null);
      if(view==='saved'&&receipt)byId('saved-code').textContent=receipt.collection_code;
      if(error.refreshResolved&&receipt===original){
        const stale=receipt?.deposit.packet_id===action.body.packet_id;
        if(stale){
          receipt=undefined;
          byId('saved-code').textContent='';
          byId('depositor-receipt').replaceChildren();
          draft.clear();
          refreshForm.reset();
        }
        if(display||stale&&['saved','share','refresh-code','pickup-updates'].includes(view)){
          show('desk');
          byId('error').textContent=error.message;
          return;
        }
      }
    }
    if(display)throw resolved?error:new Error('The refresh result is uncertain. Recover the last action from the desk before handling more passes.');
  }
}

byId('refresh-saved-code').onclick=()=>perform(async()=>{
  if(recovery)return recover();
  if(!receipt?.deposit?.packet_id||!/^[0-9]{4}$/.test(receipt.collection_code||''))throw new Error('Open a current deposit receipt first.');
  const code=receipt.collection_code;
  const action={path:'/api/codes/refresh',body:{request_id:crypto.randomUUID(),packet_id:receipt.deposit.packet_id}};
  setRecovery(action);
  byId('saved-code').textContent='••••';
  await runRefresh(action,()=>fetchJson(action.path,{...action.body,collection_code:code}));
});
byId('cancel-refresh').onclick=()=>show(receipt?'saved':'desk');
refreshForm.onsubmit=event=>{
  event.preventDefault();
  return perform(async()=>{
    const packet=refreshForm.elements.packet.value.trim().toUpperCase();
    const action=recovery;
    if(action&&(action.path!=='/api/codes/refresh'||action.body.packet_id!==packet)){
      throw new Error('Recover the last action from the desk first.');
    }
    if(!action&&packet!==receipt?.deposit.packet_id)throw new Error('Match the label on the physical packet.');
    const code=byId('refresh-original-code').hidden?receipt?.collection_code:refreshForm.elements.code.value.trim().toUpperCase();
    if(!/^[0-9]{4}$/.test(code||''))throw new Error('Enter the original four-digit collection code.');
    const attempt=action||{path:'/api/codes/refresh',body:{request_id:crypto.randomUUID(),packet_id:packet}};
    if(!action)setRecovery(attempt); // Persist before sending. A storage failure prevents the mutation.
    await runRefresh(attempt,async()=>{
      if(action){
        const result=await fetchJson('/api/codes/refresh/recover',action.body);
        if(!result.refresh_pending)return result;
      }
      return fetchJson(attempt.path,{...attempt.body,collection_code:code});
    },Boolean(action));
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
  historyLoaded=false;
  if(byId('staff-message').open)byId('staff-message').close();
  staffMessages=[];
  openStaffMessage=undefined;
  staffMessageCursor=undefined;
  replying=false;
  seenStaffMessages.clear();
  uncertainStaffReplies.clear();
  staff=context;
  previousQueueTokens=undefined;queueSignature=undefined;
  historyData=[];historyPending=[];historyCursor=null;byId('history-list').replaceChildren();byId('queue-list').replaceChildren();
  boothQrUrl='';byId('desk-deposit-qr').replaceChildren();
  byId('copy-deposit-link').disabled=true;byId('share-deposit-link').hidden=true;
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
  clearLegacyStaffReply();
  intakeToken=sessionStorage.getItem('sharepass-intake:'+staff.session_key);
  show('desk');
  scheduleQueuePoll();
  if(staff.internal)reportBrowserStatus();
  if('Notification' in window&&Notification.permission==='granted')byId('queue-alerts').onclick();
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
