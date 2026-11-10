'use strict';
// Deliberately ephemeral: no localStorage, memoryStorage, cookies or server writes.
const demoMemory = new Map([['staff_name', 'Kenneth']]);
const memoryStorage = {getItem:k=>demoMemory.get(k)||null,setItem:(k,v)=>demoMemory.set(k,String(v)),removeItem:k=>demoMemory.delete(k)};
// Fictional retention fixture only; not an announced event date.
const demoStore = window.SharePassHost?.store || new DemoStore({seed:false,eventName:'SharePass event',singleEvent:true,endAt:Date.UTC(2027,10,3,18)});
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let categories = ['normal','vip','vvip'];
const categoryLabel = k => state.passTypes?.find(t => t.id === k)?.label || (k === 'normal' ? 'Normal' : k.toUpperCase());
const total = q => categories.reduce((n,k) => n + Number(q?.[k] || 0), 0);
const quantities = q => categories.map(k => `${q?.[k] || 0} ${categoryLabel(k)}`).join(' · ');
const formatTime = value => value ? new Date(value).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
let state = {deposits:[],collections:[],events:[],audit:[],counts:{}}, csrf = '', filter = 'ALL', eventId = 'training-event-001';
let online = false, busy = false, operator = memoryStorage.getItem('staff_name') || '';
let sharingRecipient = '';
let selectedDeposit = null, selectedCollection = null, claim = null, displayCode = '', viewMode = 'review';
let refreshSequence = 0, appliedRefreshSequence = 0, toastTimer;
const depositCache = new Map(), collectionCache = new Map();
const statusOf = d => d.pending_collection ? 'RELEASE_RECORDED' : d.custody_status==='IN_TRANSIT' ? 'IN_TRANSIT' : total(d.remaining) ? 'READY' : 'HANDED_OVER';
const statuses = {READY:'Deposited',RELEASE_RECORDED:'Confirm handover',HANDED_OVER:'Completed',IN_TRANSIT:'In transit'};
function statusText(d){
  if(d.offline_assigned)return 'Assigned to field phone';
  const status=statusOf(d);if(status!=='READY')return statuses[status];
  const hasPickup=state.collections.some(c=>c.deposit_id===d.id)||[...collectionCache.values()].some(c=>c.deposit_id===d.id);
  if(hasPickup)return 'Partly collected';
  return categories.some(k=>d.remaining[k]!==d.initial[k])?'Count corrected':'Deposited';
}
const balanceTiles = q => `<div class="balance-tiles">${categories.map(k => `<span class="balance ${k}"><b>${q[k]}</b><small>${esc(categoryLabel(k))}</small></span>`).join('')}</div>`;
function latest(record, cache) { if (!record) return null; const known = cache.get(record.id); if (known && known.version > record.version) return known; cache.set(record.id,record); return record; }
function mergeResult(result) {
  if (result.collection) latest(result.collection, collectionCache);
  const d = latest(result.deposit, depositCache);
  if (d?.pending_collection) d.pending_collection = latest(d.pending_collection, collectionCache);
  return {deposit:d,collection:result.collection ? latest(result.collection,collectionCache) : null};
}
function toast(message) { $('#toast').textContent = message; $('#toast').classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.add('hidden'),6500); }
function updateOperator() { $('#operator-label').textContent = operator ? 'Local staff' : 'Staff access'; $('.avatar').textContent = 'S'; }
function pending() { try { return JSON.parse(memoryStorage.getItem('pending_action')); } catch { return null; } }
function clearSecrets({preserveCodeEntry=false}={}) { window.SharePassDrafts?.clear(); sharingRecipient = ''; const recipientField = document.querySelector('[name=recipient_phone]'); if (recipientField) recipientField.value = ''; displayCode = ''; claim = null; if (!preserveCodeEntry) $('#collection-code').value = ''; }
window.sharePassClearView=()=>{
  clearSecrets();depositCache.clear();collectionCache.clear();selectedDeposit=null;selectedCollection=null;
  state={deposits:[],collections:[],events:state.events,audit:[],outbox:[],counts:{}};render();connection(false);
};
function showPending() {
  let banner = $('#pending-banner');
  if (!pending()) { banner?.remove(); return; }
  if (!banner) { banner = document.createElement('div'); banner.id = 'pending-banner'; banner.className = 'pending-banner'; banner.innerHTML = '<div><strong>An action needs checking.</strong><p>Do not repeat a physical handover. Recover the identical saved request before starting another action.</p></div><button class="button secondary" id="recover-action">Recover saved request</button>'; $('#desk-main').prepend(banner); $('#recover-action').addEventListener('click',recover); }
}
function connection(ok) {
  online = ok;
  document.querySelector('#desk-shell')?.setAttribute('aria-busy',String(busy));
  $('#connection').textContent = busy ? 'Recording…' : ok ? 'Desk ready' : 'Desk unavailable';
  $('#connection').className = `connection ${ok ? 'is-online' : 'is-offline'}`;
  const blocked = !ok || busy || !!pending();
  for (const id of ['new-deposit','collect-code','event-select']) $( '#' + id).disabled = blocked;
  document.querySelectorAll('[data-mutation]').forEach(button => { button.disabled = blocked || button.dataset.originalOnly === 'true' && (selectedCollection?.created_by !== operator || selectedCollection?.booth_id && selectedCollection.booth_id !== window.sharePassContext?.booth_id); });
  $('#operator-button').disabled = busy || !!pending();
  const unsafe = !ok || !!pending();
  const liveWarning=$('#packet-live-warning');
  if(liveWarning)liveWarning.innerHTML=busy?'<strong>Recording this action.</strong><br>Wait for the confirmed result before handing over passes.':'<strong>Stop. Do not hand over passes.</strong><br>The connection is unavailable or the action is uncertain. Recover the identical request and reconcile physical stock first.';
  $('#packet-live-warning')?.classList.toggle('hidden',!unsafe);
  $('#packet-procedure')?.classList.toggle('hidden',unsafe && (viewMode === 'handover' || viewMode === 'release'));
}
async function request(url, options={}) {
  return demoStore.request(url, options.body ? JSON.parse(options.body) : null);
}
async function refresh() {
  const sequence = ++refreshSequence, requestedEvent = eventId;
  try {
    const incoming = await request('/api/state?event_id=' + encodeURIComponent(requestedEvent));
    if (requestedEvent !== eventId || sequence < appliedRefreshSequence) return;
    appliedRefreshSequence = sequence;
    incoming.collections = (incoming.collections || []).map(c => latest(c,collectionCache));
    incoming.deposits = (incoming.deposits || []).map(d => { d = latest(d,depositCache); if (d.pending_collection) d.pending_collection = latest(d.pending_collection,collectionCache); return d; });
    state = incoming; csrf = incoming.csrf;
    $('#event-name').textContent = state.event_name;
    $('#event-select').innerHTML = (state.events || []).filter(e => e.id === 'training-event-001').map(e => `<option value="${esc(e.id)}" ${e.id === eventId ? 'selected' : ''}>${esc(e.name)}</option>`).join('');
    connection(true); render();
    if ($('#packet-dialog').open && selectedDeposit && !busy) {
      const d = state.deposits.find(item => item.id === selectedDeposit.id);
      const c = selectedCollection && collectionCache.get(selectedCollection.id);
      if (!d) { $('#packet-dialog').close(); clearSecrets(); toast('This record is no longer in this event. Verify again before collecting.'); }
      else if (d.version > selectedDeposit.version || c && c.version > selectedCollection.version) {
        claim = null; displayCode = ''; showRecord(d,c?.status === 'HANDED_OVER' ? 'complete' : 'review',c);
        toast('This record changed. The current balance is shown; verify the code again for any new collection.');
      }
    }
  } catch { if (requestedEvent === eventId && sequence >= appliedRefreshSequence) connection(false); }
}
function render() {
  if (state.passTypes?.length) categories = state.passTypes.map(t=>t.id);
  $('#ready-count').textContent = state.deposits.reduce((n,d) => n + total(d.remaining),0);
  $('#pending-count').textContent = state.collections.filter(c => c.status === 'RELEASE_RECORDED').length;
  $('#reserved-count').textContent = state.collections.filter(c => c.status === 'RELEASE_RECORDED').reduce((n,c) => n + total(c.quantities),0);
  $('#done-count').textContent = state.collections.filter(c => c.status === 'HANDED_OVER').length;
  $('#all-count').textContent = state.deposits.length;
  $('#category-totals').innerHTML = balanceTiles(Object.fromEntries(categories.map(k => [k,state.deposits.reduce((n,d) => n+d.remaining[k],0)])));
  const query = $('#search').value.trim().toLocaleLowerCase();
  const rows = state.deposits.filter(d => (filter === 'ALL' || statusOf(d) === filter) && [d.packet_id,d.location,d.created_by,d.depositor_label].some(v => String(v).toLocaleLowerCase().includes(query)));
  $('#packets-body').innerHTML = rows.map(d => `<tr><td data-label="Packet"><strong class="packet-code">${esc(d.depositor_label || d.packet_id)}</strong><small class="cell-sub">${d.depositor_label ? esc(d.packet_id)+' · ' : ''}${esc(d.created_by)} · ${esc(formatTime(d.created_at))}</small></td><td data-label="Remaining">${balanceTiles(d.remaining)}</td><td data-label="Deposited"><span class="cell-sub">${esc(quantities(d.initial))}</span></td><td data-label="Shelf"><span class="shelf">${esc(d.location)}</span></td><td data-label="Status"><span class="status ${statusOf(d).toLowerCase()}"><i></i>${statusText(d)}</span></td><td><button class="row-action" data-open="${esc(d.id)}">Open packet</button></td></tr>`).join('');
  $('#empty').classList.toggle('hidden',rows.length > 0); $('#result-count').textContent = `${rows.length} deposit${rows.length === 1 ? '' : 's'} shown`;
  document.querySelectorAll('[data-open]').forEach(button => button.addEventListener('click',async () => { if (busy) return; await refresh(); const d = state.deposits.find(d => d.id === button.dataset.open); if (d) { clearSecrets(); await presentRecord(d); } }));
  window.sharePassRenderExtras?.();
  $('#activity-list').innerHTML = state.audit.length ? state.audit.map(a => {
    const d=state.deposits.find(d=>d.id===a.deposit_id),c=state.collections.find(c=>c.id===a.collection_id);
    const photo=c?.evidence_status==='attached_sample'?'<span class="sample-photo" aria-label="Synthetic evidence fixture"></span>':c?.evidence_status==='deleted_event_end'?'<span class="sample-photo expired" aria-label="Evidence expired">Expired</span>':`<span class="audit-number">${esc(a.seq)}</span>`;
    const title=({CODE_GENERATED:'Deposit received',RELEASE_RECORDED:'Pickup reserved',HANDOVER_CONFIRMED:'Handover confirmed',PHOTOS_DELETED:'Sample evidence expired'})[a.action]||a.action;
    return `<article class="activity-row">${photo}<div><strong>${esc(title)}</strong><p>${esc(d?.depositor_label||'')} ${esc(d?.packet_id||a.deposit_id)} · ${esc(a.booth_id||a.details.booth_id||'B1')}</p><p>${a.details.quantities?esc(quantities(a.details.quantities)):''}${a.details.collector_label?' · Collector: '+esc(a.details.collector_label):''}</p>${a.details.remaining?`<p class="history-detail">Remaining: ${esc(quantities(a.details.remaining))}</p>`:''}</div><div class="audit-meta">${esc(a.operator)}<small>${esc(formatTime(a.at))}</small></div></article>`;
  }).join('') : '<div class="empty"><h3>No history</h3></div>';
  window.sharePassRenderExtras?.();
}
async function mutate(url,body,recovering=false) {
  if (!online) throw new Error('The desk is unavailable. Check the current record before proceeding.');
  if (pending() && !recovering) throw new Error('Recover the interrupted request first.');
  if ('collection_code' in body || 'phone' in body) throw new Error('Private code and phone must never enter request recovery storage.');
  memoryStorage.setItem('pending_action',JSON.stringify({url,body})); busy = true; connection(online);
  try {
    const result = await request(url,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(body)});
    memoryStorage.removeItem('pending_action'); showPending(); appliedRefreshSequence = ++refreshSequence; mergeResult(result); return result;
  } catch(error) {
    if (error.notExecuted) { memoryStorage.removeItem('pending_action'); if (recovering) claim = null; }
    else { error.message = 'Outcome uncertain. Recover the saved request and reconcile the physical stock before proceeding.'; connection(false); }
    showPending(); throw error;
  } finally { busy = false; connection(online); }
}
async function recover() {
  const action = pending(); if (!action || busy) return;
  try {
    if (action.body.event_id && action.body.event_id !== eventId) { eventId = action.body.event_id; clearSecrets(); }
    await refresh(); const result = await mutate(action.url,action.body,true); await refresh();
    document.querySelectorAll('dialog[open]').forEach(d => { if (d.id !== 'packet-dialog') d.close(); });
    const current = mergeResult(result); clearSecrets();
    if (result.collection_code && (action.url.endsWith('/replace-code') || action.url === '/api/deposits' && current.deposit?.version === 1)) { displayCode = result.collection_code; showRecord(current.deposit,'share-code'); }
    else if(!current.deposit&&window.SharePassHost)window.SharePassHost.recovered(result);
    else showRecord(current.deposit,current.collection?.status === 'HANDED_OVER' ? 'complete' : 'review',current.collection);
    toast('Request recovered. Check the current record and physical stock before acting.');
  } catch(error) { toast(error.message); }
}
function quantityControl(kind, value, maximum, showAvailable=false) {
  const name = esc(categoryLabel(kind));
  return `<div class="quantity-cell"><label>${name}${showAvailable ? ` <small>${maximum} available</small>` : ''}<input name="${esc(kind)}" type="number" min="0" max="${maximum}" value="${value}" required></label><div class="quantity-buttons"><button type="button" class="button secondary" data-quantity-step="-1" aria-label="Remove one ${name}">−</button><button type="button" class="button secondary" data-quantity-step="1" aria-label="Add one ${name}">+</button></div></div>`;
}
function quantityInputs(q) { return `<div class="quantity-grid">${categories.map(k => quantityControl(k, 0, q[k], true)).join('')}</div>`; }
document.addEventListener('click', event => {
  const step = event.target.closest('[data-quantity-step]');
  if (!step || busy || pending()) return;
  const input = step.closest('.quantity-cell').querySelector('input');
  if (Number(step.dataset.quantityStep) > 0) input.stepUp();
  else input.stepDown();
  input.dispatchEvent(new Event('input', {bubbles:true}));
});
function readQuantities(form) { return Object.fromEntries(categories.map(k => [k,Number(form.get(k))])); }
function validateQuantities(q) { if (!categories.every(k => Number.isInteger(q[k]) && q[k] >= 0 && q[k] <= 100) || !total(q)) throw new Error('Choose at least one pass, using whole numbers from 0 to 100.'); }
function showError(id,error) { const target = $(id); if (target) { target.textContent = error.message; target.classList.remove('hidden'); } else toast(error.message); }
async function presentRecord(deposit,mode='review',collection=null) {
  const apply = () => { document.querySelectorAll('dialog[open]').forEach(d => { if (d.id !== 'packet-dialog') d.close(); }); showRecord(deposit,mode,collection); };
  if (window.sharePassMorphUpdate) await window.sharePassMorphUpdate(apply); else apply();
}
function showRecord(deposit,mode='review',collection=null) {
  window.SharePassDrafts?.clear();
  deposit = latest(deposit,depositCache); collection = collection && latest(collection,collectionCache);
  if (!deposit) return;
  if (deposit.pending_collection) { collection = latest(deposit.pending_collection,collectionCache); if (collection.status === 'RELEASE_RECORDED') mode = 'handover'; }
  if (collection?.status === 'HANDED_OVER' && mode === 'handover') mode = 'complete';
  if (mode === 'release' && (!total(deposit.remaining) || !claim || claim.depositId !== deposit.id || claim.version !== deposit.version || claim.expiresAt <= Date.now())) { claim = null; mode = 'review'; }
  selectedDeposit = deposit; selectedCollection = collection; viewMode = mode;
  let content = '';
  if (mode === 'share-code') {
    content = `<div class="success-note"><strong>Deposit saved.</strong><p>Write packet ID <b>${esc(deposit.packet_id)}</b> on the envelope at <b>${esc(deposit.location)}</b>. Do not write the private code on a publicly visible envelope.</p></div><section class="code-display"><span class="eyebrow">PRIVATE COLLECTION CODE</span><strong>${esc(displayCode)}</strong><p>${esc(state.event_name)} · ${esc(deposit.packet_id)}<br>${esc(quantities(deposit.initial))}</p><p>Anyone with this code can collect any remaining passes. Share only with trusted friends. No individual allocations.</p></section><p class="muted">Show the code privately or read it quietly. Ask the depositor to repeat it back before closing. There is no printed receipt. The code is not available from inventory or activity records.</p><button type="button" id="copy-code" class="button secondary">Copy code</button><div class="dialog-actions"><button class="button primary close-dialog">Done</button></div>`;
  } else if (mode === 'release') {
    content = `<form id="release-form"><div class="success-note"><strong>Code verified.</strong><p>Choose the passes for this pickup. The balance stays under this code.</p></div>${quantityInputs(deposit.remaining)}${window.sharePassCollectionFields?.() || ''}<label>Physical packet ID<input name="packet_id" required autocomplete="off" maxlength="40" placeholder="Type or scan the ID on the envelope"></label><p class="inline-note">Match the packet at shelf ${esc(deposit.location)}. Record before handover. Verification expires after two minutes.</p><p class="error hidden" id="release-error" role="alert"></p><div class="dialog-actions"><button class="button secondary close-dialog" type="button">Cancel</button><button class="button primary" data-mutation type="submit">Record selected release</button></div></form>`;
  } else if (mode === 'handover') {
    content = `<div class="recovery-alert"><strong>Release recorded. Handover unconfirmed.</strong><p>Reserved: <b>${esc(quantities(collection.quantities))}</b>. Already subtracted from the available balance.</p><p>${esc(collection.created_by)} · ${esc(formatTime(collection.created_at))}. Match the stock and hand over these reserved passes once. If already handed over, confirm that existing handover. If unsure, stop for supervisor review. Never issue replacements or restore the balance automatically.</p></div><form id="handover-form"><label class="check-row"><input name="handover_confirmed" type="checkbox" required><span>I confirm these exact quantities have been handed over once.</span></label><p class="inline-note">Recorded by ${esc(collection.created_by)}. Return to booth ${esc(collection.booth_id || deposit.booth_id)} with that same staff identity to reconcile. Staff labels alone are not authentication.</p><p class="error hidden" id="handover-error" role="alert"></p><div class="dialog-actions"><button class="button secondary close-dialog" type="button">Close for review</button><button class="button primary" type="submit" data-mutation data-original-only="true">Confirm physical handover</button></div></form>`;
  } else if (mode === 'complete' && collection) {
    content = `<div class="verified-state" role="status" aria-live="polite"><span class="verified-check" aria-hidden="true">✓</span><h3>Handover confirmed</h3><p>Handed over: <b>${esc(quantities(collection.quantities))}</b></p><p>Remaining: <b>${esc(quantities(deposit.remaining))}</b></p><p class="no-repeat">Handover recorded. Do not repeat this release.</p><p>${esc(collection.handed_over_by)} · ${esc(formatTime(collection.handed_over_at))}</p></div><div class="dialog-actions"><button class="button primary close-dialog">Done</button></div>`;
  } else {
    const history = state.collections.filter(c => c.deposit_id === deposit.id);
    content = `<p class="inline-note">For a new pickup, use Collect and verify the shared code.</p><details class="secondary-details"><summary>Collection history (${history.length})</summary>${history.length ? history.map(c => `<div class="collection-history"><strong>${esc(quantities(c.quantities))}</strong><p>${c.evidence_status==='attached_sample'?'<span class="sample-photo" aria-label="Synthetic evidence fixture"></span>':''}${esc(c.collector_label || 'Collector not recorded')} · ${esc(c.booth_id || 'B1')} · ${esc(c.status === 'HANDED_OVER' ? 'Handed over' : 'Handover unconfirmed')}</p><small>${esc(c.created_by)} · ${esc(formatTime(c.created_at))}${c.handed_over_at ? ` · Confirmed by ${esc(c.handed_over_by)} at ${esc(formatTime(c.handed_over_at))}` : ''}</small></div>`).join('') : '<p class="muted">No collections recorded.</p>'}</details>`;
  }
  $('#packet-detail').innerHTML = `<div class="dialog-top"><span class="dialog-wordmark">SharePass</span><button class="icon-button close-dialog" aria-label="Close record">×</button></div><div class="flow-steps" aria-label="Collection progress"><span class="${mode === 'share-code' ? 'active' : ''}">Deposit</span><span class="${mode === 'release' ? 'active' : ''}">Select passes</span><span class="${['handover','complete'].includes(mode) ? 'active' : ''}">Handover</span></div><h2 id="packet-dialog-title" class="record-code">${esc(deposit.packet_id)}</h2><span class="status ${statusOf(deposit).toLowerCase()}"><i></i>${statusText(deposit)}</span><div class="packet-summary"><div><span>REMAINING</span>${balanceTiles(deposit.remaining)}<small>Initial: ${esc(quantities(deposit.initial))}</small></div><div><span>SHELF</span><strong>${esc(deposit.location)}</strong><small>${esc(state.events?.find(e => e.id === deposit.event_id)?.name || deposit.event_id)}</small></div></div><p class="record-origin">${deposit.depositor_label ? esc(deposit.depositor_label)+' · ' : ''}${esc(deposit.created_by)} · ${esc(deposit.booth_id || 'B1')} · ${esc(formatTime(deposit.created_at))}</p><div id="packet-live-warning" class="error hidden" role="alert"><strong>Stop. Do not hand over passes.</strong><br>Connection is lost or an action is uncertain. Recover the request and check current records and physical stock first.</div><div id="packet-procedure">${content}</div>`;
  if(window.SharePassHost)$('#packet-procedure').insertAdjacentHTML('afterbegin',window.SharePassHost.recordNotice(deposit));
  if(mode==='review'&&window.SharePassHost)$('#packet-procedure').insertAdjacentHTML('beforeend',window.SharePassHost.recordTools(deposit));
  window.sharePassWireEvidence?.(); window.SharePassHost?.wireRecord(deposit); wireClose($('#packet-dialog')); if (!$('#packet-dialog').open) $('#packet-dialog').showModal();
  if(mode==='share-code'&&window.SharePassDrafts){const container=document.createElement('div');$('#packet-procedure .dialog-actions').before(container);window.SharePassDrafts.renderDeposit(container,{code:displayCode,eventName:state.event_name,phone:sharingRecipient,booth:deposit.storage_booth_id || deposit.booth_id,location:deposit.storage_location || deposit.location,quantities:deposit.remaining});}
  $('#packet-dialog-title').setAttribute('tabindex','-1'); $('#packet-dialog').scrollTop=0; $('#packet-dialog-title').focus({preventScroll:true});
  $('#copy-code')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(displayCode);toast('Collection code copied. Share it privately.');}catch{toast('Copy is unavailable. Show or read the code privately.');}});
  $('#release-form')?.addEventListener('submit',async event => {
    event.preventDefault(); if (busy) return; const form = new FormData(event.currentTarget);
    try {
      if (!claim || claim.expiresAt <= Date.now() || claim.version !== deposit.version) throw new Error('Verification expired or the balance changed. Close this record and verify the code again.');
      const q = readQuantities(form); validateQuantities(q); if (categories.some(k => q[k] > deposit.remaining[k])) throw new Error('Requested quantities exceed the available balance.');
      const result = await mutate(`/api/deposits/${encodeURIComponent(deposit.id)}/release`,{request_id:crypto.randomUUID(),operator,event_id:eventId,claim_token:claim.token,version:deposit.version,packet_id:form.get('packet_id'),quantities:q,...(window.sharePassCollectionMeta?.(form) || {})});
      clearSecrets(); const current = mergeResult(result); await presentRecord(current.deposit,'handover',current.collection); await refresh();
    } catch(error) { showError('#release-error',error); await refresh(); }
  });
  $('#handover-form')?.addEventListener('submit',async event => {
    event.preventDefault(); if (busy) return;
    try { const result = await mutate(`/api/collections/${encodeURIComponent(collection.id)}/handover`,{request_id:crypto.randomUUID(),operator,event_id:eventId,booth_id:window.sharePassContext?.booth_id || 'B1',version:collection.version,handover_confirmed:new FormData(event.currentTarget).get('handover_confirmed') === 'on'}); const current = mergeResult(result); await presentRecord(current.deposit,'complete',current.collection); await refresh(); }
    catch(error) { showError('#handover-error',error); await refresh(); }
  });
  connection(online);
}
function wireClose(root) { root.querySelectorAll('.close-dialog').forEach(button => button.addEventListener('click',() => { if (!busy) { if (window.sharePassMorphUpdate) window.sharePassMorphUpdate(() => root.close()); else root.close(); } })); }
document.querySelectorAll('dialog').forEach(dialog => { wireClose(dialog); dialog.addEventListener('cancel',event => { if (busy) event.preventDefault(); }); });
$('#packet-dialog').addEventListener('close',() => { const skipFocus=window.sharePassSkipCloseFocus?.($('#packet-dialog')); if ($('#packet-dialog').open) return; clearSecrets({preserveCodeEntry:$('#code-dialog').open}); selectedDeposit = null; selectedCollection = null; $('#packet-detail').innerHTML = ''; if (!skipFocus && !document.querySelector('dialog[open]') && !$('#desk-shell').classList.contains('hidden')) $('#collect-code').classList.contains('hidden') ? $('#desk-mode').focus({preventScroll:true}) : $('#collect-code').focus({preventScroll:true}); });
$('#code-dialog').addEventListener('close',() => { if (!$('#code-dialog').open) $('#collection-code').value = ''; });
$('#operator-dialog').addEventListener('cancel',event => { if (!operator) event.preventDefault(); });
$('#operator-form').addEventListener('submit',event => { event.preventDefault(); operator = new FormData(event.currentTarget).get('operator').trim(); if (!operator) return; memoryStorage.setItem('staff_name',operator); updateOperator(); $('#operator-dialog').close(); connection(online); });
$('#operator-button').addEventListener('click',() => { if (busy || pending()) return; $('#operator-form input').value = operator; $('#operator-dialog').showModal(); });
$('#new-deposit').addEventListener('click',() => { if (!operator) { $('#operator-dialog').showModal(); return; } $('#deposit-form').reset(); window.sharePassDepositFields?.(); $('#deposit-error').classList.add('hidden'); if (window.sharePassMorphUpdate) window.sharePassMorphUpdate(() => $('#deposit-dialog').showModal()); else $('#deposit-dialog').showModal(); });
$('#deposit-form').addEventListener('submit',async event => {
  event.preventDefault(); if (busy) return; const form = new FormData(event.currentTarget);
  try { const phone = String(form.get('recipient_phone') || '').trim(); if(phone) window.SharePassDrafts.normalizePhone(phone); const q = readQuantities(form); validateQuantities(q); const result = await mutate('/api/deposits',{request_id:crypto.randomUUID(),operator,event_id:eventId,location:form.get('location'),quantities:q,depositor_label:form.get('depositor_label') || '',booth_id:window.sharePassContext?.booth_id || 'B1',notification_channels:form.getAll('notification_channels'),custody_confirmed:form.get('custody_confirmed') === 'on'}); displayCode = result.collection_code; sharingRecipient = phone; document.querySelector('[name=recipient_phone]').value=''; await presentRecord(result.deposit,'share-code'); await refresh(); }
  catch(error) { showError('#deposit-error',error); } finally { connection(online); }
});
$('#collect-code').addEventListener('click',() => { if (!operator) { $('#operator-dialog').showModal(); return; } clearSecrets(); $('#code-form').reset(); $('#code-error').classList.add('hidden'); if (window.sharePassMorphUpdate) window.sharePassMorphUpdate(() => $('#code-dialog').showModal()); else $('#code-dialog').showModal(); });
$('#code-form').addEventListener('submit',async event => {
  event.preventDefault(); if (busy || pending() || !online) return; busy = true; connection(online);
  try { const code = $('#collection-code').value.trim(); const result = await request('/api/verify',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({event_id:eventId,booth_id:window.sharePassContext?.booth_id||'B1',collection_code:code})}); $('#collection-code').value = ''; const d = latest(result.deposit,depositCache); if(result.release_allowed===false){claim=null;await presentRecord(d,'review');toast('Pickup blocked. Check the recorded physical booth and shelf before arranging a transfer.');}else{claim = {token:result.claim_token,depositId:d.id,version:result.deposit.version,expiresAt:Date.now() + result.expires_in * 1000}; await presentRecord(d,'release');} }
  catch(error) { if (!error.status) connection(false); showError('#code-error',error); }
  finally { busy = false; connection(online); }
});
$('#event-select').addEventListener('change',async event => { if (busy || pending()) return; clearSecrets(); document.querySelectorAll('dialog[open]').forEach(d => d.close()); eventId = event.target.value; state = {deposits:[],collections:[],events:state.events,audit:[],counts:{}}; $('#search').value = ''; render(); connection(false); await refresh(); });
$('#search').addEventListener('input',render); $('#refresh').addEventListener('click',refresh);
document.querySelectorAll('[data-filter]').forEach(button => {
  button.addEventListener('click',() => { filter = button.dataset.filter; document.querySelectorAll('[data-filter]').forEach(tab => { const active = tab === button; tab.classList.toggle('active',active); tab.setAttribute('aria-selected',String(active)); tab.setAttribute('tabindex',active ? '0' : '-1'); }); render(); });
  button.addEventListener('keydown',event => { if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return; event.preventDefault(); const tabs = Array.from(document.querySelectorAll('[data-filter]')), i = tabs.indexOf(button), next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length-1 : (i + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length; tabs[next].focus(); tabs[next].click(); });
});
['packets','activity','updates','guide'].forEach(name => $(`#nav-${name}`).addEventListener('click',() => { ['packets','activity','updates','guide'].forEach(view => { $(`#${view}-view`).classList.toggle('hidden',view !== name); $(`#nav-${view}`).classList.toggle('active',view === name); $(`#nav-${view}`).setAttribute('aria-current',view === name ? 'page' : 'false'); }); }));
window.addEventListener('focus',refresh); setInterval(() => { if (!busy && !document.hidden) refresh(); },8000);
updateOperator(); showPending(); refresh(); if (!operator) $('#operator-dialog').showModal();

$('#try-demo').addEventListener('click', async () => {
  if (busy || pending()) return;
  if (eventId !== 'training-event-001') { eventId='training-event-001'; clearSecrets(); await refresh(); }
  if (window.sharePassNavigate) await window.sharePassNavigate('packets'); else document.querySelector('#nav-packets').click(); $('#collect-code').click(); $('#collection-code').value='0420';
});
$('#reset-demo').addEventListener('click', () => { if (!busy && window.confirm('Start fresh? All demo deposits and collections in this tab will be cleared. No real data is involved.')) window.location.reload(); });
