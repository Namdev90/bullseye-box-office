'use strict';
// Deliberately ephemeral: no localStorage, memoryStorage, cookies or server writes.
const demoMemory = new Map([['staff_name', 'Demo Operator']]);
const memoryStorage = {getItem:k=>demoMemory.get(k)||null,setItem:(k,v)=>demoMemory.set(k,String(v)),removeItem:k=>demoMemory.delete(k)};
const demoStore = new DemoStore();
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const categories = ['normal','vip','vvip'];
const total = q => categories.reduce((n,k) => n + Number(q?.[k] || 0), 0);
const quantities = q => `${q?.normal || 0} Normal · ${q?.vip || 0} VIP · ${q?.vvip || 0} VVIP`;
const formatTime = value => value ? new Date(value).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
let state = {deposits:[],collections:[],events:[],audit:[],counts:{}}, csrf = '', filter = 'ALL', eventId = 'training-event-001';
let online = false, busy = false, operator = memoryStorage.getItem('staff_name') || '';
let selectedDeposit = null, selectedCollection = null, claim = null, displayCode = '', viewMode = 'review';
let refreshSequence = 0, appliedRefreshSequence = 0, toastTimer;
const depositCache = new Map(), collectionCache = new Map();
const statusOf = d => d.pending_collection ? 'RELEASE_RECORDED' : total(d.remaining) ? 'READY' : 'HANDED_OVER';
const statuses = {READY:'In custody',RELEASE_RECORDED:'Confirm handover',HANDED_OVER:'Completed'};
const balanceTiles = q => `<div class="balance-tiles">${categories.map(k => `<span class="balance ${k}"><b>${q[k]}</b><small>${k === 'normal' ? 'Normal' : k.toUpperCase()}</small></span>`).join('')}</div>`;
function latest(record, cache) { if (!record) return null; const known = cache.get(record.id); if (known && known.version > record.version) return known; cache.set(record.id,record); return record; }
function mergeResult(result) {
  if (result.collection) latest(result.collection, collectionCache);
  const d = latest(result.deposit, depositCache);
  if (d?.pending_collection) d.pending_collection = latest(d.pending_collection, collectionCache);
  return {deposit:d,collection:result.collection ? latest(result.collection,collectionCache) : null};
}
function toast(message) { $('#toast').textContent = message; $('#toast').classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.add('hidden'),6500); }
function updateOperator() { $('#operator-label').textContent = operator || 'Set staff label'; $('.avatar').textContent = operator ? operator[0].toUpperCase() : 'S'; }
function pending() { try { return JSON.parse(memoryStorage.getItem('pending_action')); } catch { return null; } }
function clearSecrets() { displayCode = ''; claim = null; $('#collection-code').value = ''; }
function showPending() {
  let banner = $('#pending-banner');
  if (!pending()) { banner?.remove(); return; }
  if (!banner) { banner = document.createElement('div'); banner.id = 'pending-banner'; banner.className = 'pending-banner'; banner.innerHTML = '<div><strong>An action needs checking.</strong><p>Do not repeat a physical handover. Recover the identical saved request before starting another action.</p></div><button class="button secondary" id="recover-action">Recover saved request</button>'; $('main').prepend(banner); $('#recover-action').addEventListener('click',recover); }
}
function connection(ok) {
  online = ok;
  $('#connection').textContent = ok ? 'Browser demo ready' : 'Demo unavailable';
  $('#connection').className = `connection ${ok ? 'is-online' : 'is-offline'}`;
  const blocked = !ok || busy || !!pending();
  for (const id of ['new-deposit','collect-code','event-select']) $( '#' + id).disabled = blocked;
  document.querySelectorAll('[data-mutation]').forEach(button => { button.disabled = blocked || button.dataset.originalOnly === 'true' && selectedCollection?.created_by !== operator; });
  $('#operator-button').disabled = busy || !!pending();
  const unsafe = !ok || !!pending();
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
    $('#event-select').innerHTML = (state.events || []).map(e => `<option value="${esc(e.id)}" ${e.id === eventId ? 'selected' : ''}>${esc(e.name)}</option>`).join('');
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
  $('#ready-count').textContent = state.deposits.reduce((n,d) => n + total(d.remaining),0);
  $('#pending-count').textContent = state.collections.filter(c => c.status === 'RELEASE_RECORDED').length;
  $('#done-count').textContent = state.collections.filter(c => c.status === 'HANDED_OVER').length;
  $('#all-count').textContent = state.deposits.length;
  $('#category-totals').innerHTML = balanceTiles(Object.fromEntries(categories.map(k => [k,state.deposits.reduce((n,d) => n+d.remaining[k],0)])));
  const query = $('#search').value.trim().toLocaleLowerCase();
  const rows = state.deposits.filter(d => (filter === 'ALL' || statusOf(d) === filter) && [d.packet_id,d.location,d.created_by].some(v => String(v).toLocaleLowerCase().includes(query)));
  $('#packets-body').innerHTML = rows.map(d => `<tr><td data-label="Packet"><strong class="packet-code">${esc(d.packet_id)}</strong><small class="cell-sub">${esc(d.created_by)} · ${esc(formatTime(d.created_at))}</small></td><td data-label="Remaining">${balanceTiles(d.remaining)}</td><td data-label="Deposited"><span class="cell-sub">${esc(quantities(d.initial))}</span></td><td data-label="Shelf"><span class="shelf">${esc(d.location)}</span></td><td data-label="Status"><span class="status ${statusOf(d).toLowerCase()}"><i></i>${statusOf(d) === 'READY' && total(d.remaining) < total(d.initial) ? 'Partly collected' : statuses[statusOf(d)]}</span></td><td><button class="row-action" data-open="${esc(d.id)}">Open packet</button></td></tr>`).join('');
  $('#empty').classList.toggle('hidden',rows.length > 0); $('#result-count').textContent = `${rows.length} deposit${rows.length === 1 ? '' : 's'} shown`;
  document.querySelectorAll('[data-open]').forEach(button => button.addEventListener('click',async () => { if (busy) return; await refresh(); const d = state.deposits.find(d => d.id === button.dataset.open); if (d) { clearSecrets(); showRecord(d); } }));
  $('#activity-list').innerHTML = state.audit.length ? state.audit.map(a => `<article class="activity-row"><span class="audit-number">${esc(a.seq)}</span><div><strong>${esc(({CODE_GENERATED:'Deposit received',RELEASE_RECORDED:'Passes reserved for pickup',HANDOVER_CONFIRMED:'Handover confirmed'})[a.action] || a.action)}</strong><p>${esc(state.deposits.find(d => d.id === a.deposit_id)?.packet_id || a.deposit_id)} · ${a.details.location ? 'Shelf '+esc(a.details.location) : ''}</p><p>${a.details.quantities ? esc(quantities(a.details.quantities)) : ''}</p></div><div class="audit-meta">${esc(a.operator)}<small>${esc(formatTime(a.at))}</small></div></article>`).join('') : '<div class="empty"><h3>No actions recorded</h3><p>A deposit will appear here once saved.</p></div>';
}
async function mutate(url,body,recovering=false) {
  if (!online) throw new Error('The demo is unavailable. Reload to start a fresh simulation.');
  if (pending() && !recovering) throw new Error('Recover the interrupted request first.');
  if ('collection_code' in body || 'phone' in body) throw new Error('Private code and phone must never enter request recovery storage.');
  memoryStorage.setItem('pending_action',JSON.stringify({url,body})); busy = true; connection(online);
  try {
    const result = await request(url,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(body)});
    memoryStorage.removeItem('pending_action'); showPending(); appliedRefreshSequence = ++refreshSequence; mergeResult(result); return result;
  } catch(error) {
    if (error.notExecuted) { memoryStorage.removeItem('pending_action'); if (recovering) claim = null; }
    else { error.message = 'Demo action could not be completed. Use the saved request to check it, or reload to reset the simulation. Do not use this demo for real handover.'; connection(false); }
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
    if (action.url === '/api/deposits' && current.deposit.version === 1 && result.collection_code) { displayCode = result.collection_code; showRecord(current.deposit,'share-code'); }
    else showRecord(current.deposit,current.collection?.status === 'HANDED_OVER' ? 'complete' : 'review',current.collection);
    toast('Request recovered. Check the current record and physical stock before acting.');
  } catch(error) { toast(error.message); }
}
function quantityInputs(q) { return `<div class="quantity-grid">${categories.map(k => `<label>${k === 'normal' ? 'Normal' : k.toUpperCase()} <small>${q[k]} available</small><input name="${k}" type="number" min="0" max="${q[k]}" value="0" required></label>`).join('')}</div>`; }
function readQuantities(form) { return Object.fromEntries(categories.map(k => [k,Number(form.get(k))])); }
function validateQuantities(q) { if (!categories.every(k => Number.isInteger(q[k]) && q[k] >= 0 && q[k] <= 100) || !total(q)) throw new Error('Choose at least one pass, using whole numbers from 0 to 100.'); }
function showError(id,error) { const target = $(id); if (target) { target.textContent = error.message; target.classList.remove('hidden'); } else toast(error.message); }
function showRecord(deposit,mode='review',collection=null) {
  deposit = latest(deposit,depositCache); collection = collection && latest(collection,collectionCache);
  if (!deposit) return;
  if (deposit.pending_collection) { collection = latest(deposit.pending_collection,collectionCache); if (collection.status === 'RELEASE_RECORDED') mode = 'handover'; }
  if (collection?.status === 'HANDED_OVER' && mode === 'handover') mode = 'complete';
  if (mode === 'release' && (!total(deposit.remaining) || !claim || claim.depositId !== deposit.id || claim.version !== deposit.version || claim.expiresAt <= Date.now())) { claim = null; mode = 'review'; }
  selectedDeposit = deposit; selectedCollection = collection; viewMode = mode;
  let content = '';
  if (mode === 'share-code') {
    content = `<div class="success-note"><strong>Deposit saved.</strong><p>Write packet ID <b>${esc(deposit.packet_id)}</b> on the envelope at <b>${esc(deposit.location)}</b>. Do not write the private code on a publicly visible envelope.</p></div><section class="code-display"><span class="eyebrow">PRIVATE COLLECTION CODE · DEMO</span><strong>${esc(displayCode)}</strong><p>${esc(state.event_name)} · ${esc(deposit.packet_id)}<br>${esc(quantities(deposit.initial))}</p><p>Anyone with this code can collect any remaining passes. Share only with trusted friends. No individual allocations.</p></section><p class="muted">Show the code privately or read it quietly in three groups. Ask the depositor to repeat it back before closing. There is no printed receipt. The code is not available from inventory or activity records.</p><details class="share-options"><summary>Preview a sharing message</summary><p class="muted">Local text preview only. No phone numbers, external links or sent messages.</p><form id="share-form"><button class="button secondary" type="submit">Preview message locally</button></form><div id="share-preview" class="hidden" aria-live="polite"></div></details><div class="dialog-actions"><button class="button primary close-dialog">Done</button></div>`;
  } else if (mode === 'release') {
    content = `<form id="release-form"><div class="success-note"><strong>Code verified.</strong><p>Select only the passes being collected now. The remaining balance stays available under the same code.</p></div>${quantityInputs(deposit.remaining)}<label>Physical packet ID<input name="packet_id" required autocomplete="off" maxlength="40" placeholder="Type or scan the ID on the envelope"></label><p class="inline-note">Take the packet from shelf ${esc(deposit.location)} and match its label. Record this release before handing over passes. Verification expires after two minutes.</p><p class="error hidden" id="release-error" role="alert"></p><div class="dialog-actions"><button class="button secondary close-dialog" type="button">Cancel</button><button class="button primary" data-mutation type="submit">Record selected release</button></div></form>`;
  } else if (mode === 'handover') {
    content = `<div class="recovery-alert"><strong>Release recorded. Handover unconfirmed.</strong><p>Reserved: <b>${esc(quantities(collection.quantities))}</b>. These quantities are already subtracted from the available balance.</p><p>Recorded by ${esc(collection.created_by)} at ${esc(formatTime(collection.created_at))}. Check the physical stock. Hand over these reserved passes exactly once, then confirm below. If already handed over, confirm that existing handover. If unsure, stop and ask the supervisor. Never issue replacement passes or return the balance automatically.</p></div><form id="handover-form"><label class="check-row"><input name="handover_confirmed" type="checkbox" required><span>For this demo, I confirm the simulated handover of these exact quantities once.</span></label><p class="inline-note">Only the original staff label (${esc(collection.created_by)}) can confirm. This is a procedural check, not authentication.</p><p class="error hidden" id="handover-error" role="alert"></p><div class="dialog-actions"><button class="button secondary close-dialog" type="button">Close for review</button><button class="button primary" type="submit" data-mutation data-original-only="true">Confirm physical handover</button></div></form>`;
  } else if (mode === 'complete' && collection) {
    content = `<div class="verified-state" role="status" aria-live="polite"><span class="verified-check" aria-hidden="true">✓</span><h3>Handover confirmed</h3><p>Simulated handover: <b>${esc(quantities(collection.quantities))}</b></p><p>Remaining: <b>${esc(quantities(deposit.remaining))}</b></p><p class="no-repeat">Demo collection complete. No real passes were issued.</p><p>${esc(collection.handed_over_by)} · ${esc(formatTime(collection.handed_over_at))}</p></div><div class="dialog-actions"><button class="button primary close-dialog">Done</button></div>`;
  } else {
    const history = state.collections.filter(c => c.deposit_id === deposit.id);
    content = `<div class="inline-note">This is an administrative custody record. A packet ID, shelf or staff label does not authorize a new release. Use “Collect by code” and verify the shared code for every new collection.</div><h3>${total(deposit.remaining) ? 'Collections' : 'All passes collected'}</h3>${history.length ? history.map(c => `<div class="collection-history"><strong>${esc(quantities(c.quantities))}</strong><p>${esc(c.status === 'HANDED_OVER' ? 'Handed over' : 'Handover unconfirmed')} · ${esc(c.created_by)} · ${esc(formatTime(c.created_at))}</p><small>Collection ${esc(c.id)}${c.handed_over_at ? ` · Confirmed ${esc(formatTime(c.handed_over_at))} by ${esc(c.handed_over_by)}` : ''}</small></div>`).join('') : '<p class="muted">No collections recorded.</p>'}<div class="dialog-actions"><button class="button primary close-dialog">Close record</button></div>`;
  }
  $('#packet-detail').innerHTML = `<div class="dialog-top"><span class="eyebrow">${mode === 'share-code' ? 'PRIVATE CODE' : 'CUSTODY RECORD'} · DEMO</span><button class="icon-button close-dialog" aria-label="Close record">×</button></div><h2 id="packet-dialog-title" class="record-code">${esc(deposit.packet_id)}</h2><span class="status ${statusOf(deposit).toLowerCase()}"><i></i>${statusOf(deposit) === 'READY' && total(deposit.remaining) < total(deposit.initial) ? 'Partly collected' : statuses[statusOf(deposit)]}</span><div class="packet-summary"><div><span>REMAINING</span>${balanceTiles(deposit.remaining)}<small>Initial: ${esc(quantities(deposit.initial))}</small></div><div><span>SHELF</span><strong>${esc(deposit.location)}</strong><small>${esc(state.events?.find(e => e.id === deposit.event_id)?.name || deposit.event_id)}</small></div></div><p class="record-origin">Created by ${esc(deposit.created_by)} · ${esc(formatTime(deposit.created_at))}</p><div id="packet-live-warning" class="error hidden" role="alert"><strong>Stop. Do not hand over passes.</strong><br>Connection is lost or an action is uncertain. Recover the request and check current records and physical stock first.</div><div id="packet-procedure">${content}</div>`;
  wireClose($('#packet-dialog')); if (!$('#packet-dialog').open) $('#packet-dialog').showModal();
  $('#share-form')?.addEventListener('submit', event => {
    event.preventDefault();
    const message = `DEMO ONLY · ${state.event_name}\nCollection code: ${displayCode}\nDeposited: ${quantities(deposit.initial)}\nThis synthetic code works only in this browser tab. It is not an admission ticket. In a real workflow, share the code only with trusted friends.`;
    const preview = $('#share-preview'); preview.classList.remove('hidden');
    preview.innerHTML = `<p class="message-preview">${esc(message)}</p><p class="inline-note">Preview only. Nothing is sent or shared with another service.</p>`;
  });
  $('#release-form')?.addEventListener('submit',async event => {
    event.preventDefault(); if (busy) return; const form = new FormData(event.currentTarget);
    try {
      if (!claim || claim.expiresAt <= Date.now() || claim.version !== deposit.version) throw new Error('Verification expired or the balance changed. Close this record and verify the code again.');
      const q = readQuantities(form); validateQuantities(q); if (categories.some(k => q[k] > deposit.remaining[k])) throw new Error('Requested quantities exceed the available balance.');
      const result = await mutate(`/api/deposits/${encodeURIComponent(deposit.id)}/release`,{request_id:crypto.randomUUID(),operator,event_id:eventId,claim_token:claim.token,version:deposit.version,packet_id:form.get('packet_id'),quantities:q});
      clearSecrets(); const current = mergeResult(result); showRecord(current.deposit,'handover',current.collection); await refresh();
    } catch(error) { showError('#release-error',error); await refresh(); }
  });
  $('#handover-form')?.addEventListener('submit',async event => {
    event.preventDefault(); if (busy) return;
    try { const result = await mutate(`/api/collections/${encodeURIComponent(collection.id)}/handover`,{request_id:crypto.randomUUID(),operator,event_id:eventId,version:collection.version,handover_confirmed:new FormData(event.currentTarget).get('handover_confirmed') === 'on'}); const current = mergeResult(result); showRecord(current.deposit,'complete',current.collection); await refresh(); }
    catch(error) { showError('#handover-error',error); await refresh(); }
  });
  connection(online);
}
function wireClose(root) { root.querySelectorAll('.close-dialog').forEach(button => button.addEventListener('click',() => { if (!busy) root.close(); })); }
document.querySelectorAll('dialog').forEach(dialog => { wireClose(dialog); dialog.addEventListener('cancel',event => { if (busy) event.preventDefault(); }); });
$('#packet-dialog').addEventListener('close',() => { clearSecrets(); selectedDeposit = null; selectedCollection = null; $('#packet-detail').innerHTML = ''; });
$('#code-dialog').addEventListener('close',() => { $('#collection-code').value = ''; });
$('#operator-dialog').addEventListener('cancel',event => { if (!operator) event.preventDefault(); });
$('#operator-form').addEventListener('submit',event => { event.preventDefault(); operator = new FormData(event.currentTarget).get('operator').trim(); if (!operator) return; memoryStorage.setItem('staff_name',operator); updateOperator(); $('#operator-dialog').close(); connection(online); });
$('#operator-button').addEventListener('click',() => { if (busy || pending()) return; $('#operator-form input').value = operator; $('#operator-dialog').showModal(); });
$('#new-deposit').addEventListener('click',() => { if (!operator) { $('#operator-dialog').showModal(); return; } $('#deposit-form').reset(); $('#deposit-error').classList.add('hidden'); $('#deposit-dialog').showModal(); });
$('#deposit-form').addEventListener('submit',async event => {
  event.preventDefault(); if (busy) return; const form = new FormData(event.currentTarget);
  try { const q = readQuantities(form); validateQuantities(q); const result = await mutate('/api/deposits',{request_id:crypto.randomUUID(),operator,event_id:eventId,location:form.get('location'),quantities:q,custody_confirmed:form.get('custody_confirmed') === 'on'}); $('#deposit-dialog').close(); displayCode = result.collection_code; showRecord(result.deposit,'share-code'); await refresh(); }
  catch(error) { showError('#deposit-error',error); } finally { connection(online); }
});
$('#collect-code').addEventListener('click',() => { if (!operator) { $('#operator-dialog').showModal(); return; } clearSecrets(); $('#code-form').reset(); $('#code-error').classList.add('hidden'); $('#code-dialog').showModal(); });
$('#code-form').addEventListener('submit',async event => {
  event.preventDefault(); if (busy || pending() || !online) return; busy = true; connection(online);
  try { const code = $('#collection-code').value.trim(); const result = await request('/api/verify',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify({event_id:eventId,collection_code:code})}); $('#collection-code').value = ''; $('#code-dialog').close(); const d = latest(result.deposit,depositCache); claim = {token:result.claim_token,depositId:d.id,version:result.deposit.version,expiresAt:Date.now() + result.expires_in * 1000}; showRecord(d,'release'); }
  catch(error) { if (!error.status) connection(false); showError('#code-error',error); }
  finally { busy = false; connection(online); }
});
$('#event-select').addEventListener('change',async event => { if (busy || pending()) return; clearSecrets(); document.querySelectorAll('dialog[open]').forEach(d => d.close()); eventId = event.target.value; state = {deposits:[],collections:[],events:state.events,audit:[],counts:{}}; $('#search').value = ''; render(); connection(false); await refresh(); });
$('#search').addEventListener('input',render); $('#refresh').addEventListener('click',refresh);
document.querySelectorAll('[data-filter]').forEach(button => {
  button.addEventListener('click',() => { filter = button.dataset.filter; document.querySelectorAll('[data-filter]').forEach(tab => { const active = tab === button; tab.classList.toggle('active',active); tab.setAttribute('aria-selected',String(active)); tab.setAttribute('tabindex',active ? '0' : '-1'); }); render(); });
  button.addEventListener('keydown',event => { if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return; event.preventDefault(); const tabs = Array.from(document.querySelectorAll('[data-filter]')), i = tabs.indexOf(button), next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length-1 : (i + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length; tabs[next].focus(); tabs[next].click(); });
});
['packets','activity','guide'].forEach(name => $(`#nav-${name}`).addEventListener('click',() => { ['packets','activity','guide'].forEach(view => { $(`#${view}-view`).classList.toggle('hidden',view !== name); $(`#nav-${view}`).classList.toggle('active',view === name); $(`#nav-${view}`).setAttribute('aria-current',view === name ? 'page' : 'false'); }); }));
window.addEventListener('focus',refresh); setInterval(() => { if (!busy && !document.hidden) refresh(); },8000);
updateOperator(); showPending(); refresh(); if (!operator) $('#operator-dialog').showModal();

$('#try-demo').addEventListener('click', async () => {
  if (busy || pending()) return;
  if (eventId !== 'training-event-001') { eventId='training-event-001'; clearSecrets(); await refresh(); }
  $('#collect-code').click(); $('#collection-code').value='DEMO-PASS-2026';
});
$('#reset-demo').addEventListener('click', () => { if (!busy && window.confirm('Start fresh? All demo deposits and collections in this tab will be cleared. No real data is involved.')) window.location.reload(); });
