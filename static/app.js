'use strict';
const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statuses = {READY: 'Ready for collection', RELEASE_RECORDED: 'Handover unconfirmed', HANDED_OVER: 'Handed over'};
let state = {packets: [], audit: [], counts: {}}, csrf = '', filter = 'ALL', online = false, busy = false;
let operator = sessionStorage.getItem('staff_name') || '';
let selectedPacket = null;
let refreshSequence = 0, appliedRefreshSequence = 0;
let toastTimer;
const formatTime = value => value ? new Date(value).toLocaleString([], {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'}) : '—';

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.add('hidden'), 6500);
}

function updateOperator() {
  $('#operator-label').textContent = operator || 'Set staff name';
  $('.avatar').textContent = operator ? operator[0].toUpperCase() : 'S';
}

function pending() {
  try { return JSON.parse(sessionStorage.getItem('pending_action')); } catch { return null; }
}

function showPending() {
  let banner = $('#pending-banner');
  if (!pending()) { if (banner) banner.remove(); return; }
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'pending-banner'; banner.className = 'pending-banner';
    banner.innerHTML = '<div><strong>An action needs checking.</strong><p>A response was interrupted. Do not repeat a physical handover. Retry the identical saved request to recover its outcome safely.</p></div><button class="button secondary" id="recover-action">Recover saved request</button>';
    $('main').prepend(banner);
    $('#recover-action').addEventListener('click', recover);
  }
}

function connection(ok) {
  online = ok;
  $('#connection').textContent = ok ? 'Local desk connected' : 'Desk connection lost';
  $('#connection').className = `connection ${ok ? 'is-online' : 'is-offline'}`;
  $('#new-deposit').disabled = !ok || busy || !!pending();
  document.querySelectorAll('[data-mutation]').forEach(button => { button.disabled = !ok || busy || !!pending(); });
  const warning = $('#packet-live-warning');
  if (warning) {
    const unsafe = !ok || !!pending();
    warning.classList.toggle('hidden', !unsafe);
    $('#packet-procedure')?.classList.toggle('hidden', unsafe && selectedPacket?.status === 'RELEASE_RECORDED');
  }
}

async function request(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(url, {...options, cache: 'no-store', signal: controller.signal});
    const data = await response.json();
    if (!response.ok) { const error = new Error(data.error || 'Request failed.'); error.status = response.status; throw error; }
    return data;
  } finally { clearTimeout(timeout); }
}

async function refresh() {
  const sequence = ++refreshSequence;
  try {
    const incoming = await request('/api/state');
    if (sequence < appliedRefreshSequence) return;
    appliedRefreshSequence = sequence;
    incoming.packets = incoming.packets.map(latestKnownPacket);
    incoming.counts = {READY:0, RELEASE_RECORDED:0, HANDED_OVER:0, PASSES_IN_CUSTODY:0};
    incoming.packets.forEach(packet => { incoming.counts[packet.status]++; if (packet.status === 'READY') incoming.counts.PASSES_IN_CUSTODY += packet.quantity; });
    state = incoming; csrf = state.csrf;
    $('#event-name').textContent = state.event_name;
    connection(true); render();
    if ($('#packet-dialog').open && selectedPacket && !busy) {
      const latest = state.packets.find(packet => packet.id === selectedPacket.id);
      if (latest && latest.version > selectedPacket.version) {
        showPacket(latest);
        toast('This packet changed in another window. The record has been refreshed. Check its current status before acting.');
      }
    }
  } catch { if (sequence >= appliedRefreshSequence) connection(false); }
}

function latestKnownPacket(packet) {
  const candidates = [packet, state.packets.find(item => item.id === packet.id), selectedPacket?.id === packet.id ? selectedPacket : null].filter(Boolean);
  return candidates.reduce((latest, item) => item.version > latest.version ? item : latest);
}

function render() {
  $('#ready-count').textContent = state.counts.READY || 0;
  $('#pending-count').textContent = state.counts.RELEASE_RECORDED || 0;
  $('#done-count').textContent = state.counts.HANDED_OVER || 0;
  $('#all-count').textContent = state.packets.length;
  const query = $('#search').value.trim().toLocaleLowerCase();
  const rows = state.packets.filter(packet => (filter === 'ALL' || packet.status === filter) && ['collector', 'depositor', 'code', 'location'].some(key => packet[key].toLocaleLowerCase().includes(query)));
  $('#packets-body').innerHTML = rows.map(packet => `<tr><td><div class="person-cell"><span class="person-icon">${esc(packet.collector[0].toUpperCase())}</span><div><strong>${esc(packet.collector)}</strong><small>From ${esc(packet.depositor)}</small></div></div></td><td><span class="packet-code">${esc(packet.code)}</span><small class="cell-sub">${esc(formatTime(packet.created_at))}</small></td><td><strong>${packet.quantity}</strong><small class="cell-sub">${esc(packet.category)}</small></td><td><span class="shelf">${esc(packet.location)}</span></td><td><span class="status ${packet.status.toLowerCase()}"><i></i>${statuses[packet.status]}</span></td><td><button class="row-action" data-open="${packet.id}" aria-label="Open packet for ${esc(packet.collector)}">${packet.status === 'READY' ? 'Collect' : 'Review'} <span>↗</span></button></td></tr>`).join('');
  $('#empty').classList.toggle('hidden', rows.length > 0);
  $('#result-count').textContent = `${rows.length} packet${rows.length === 1 ? '' : 's'} shown`;
  document.querySelectorAll('[data-open]').forEach(button => button.addEventListener('click', () => openPacket(button.dataset.open)));
  $('#activity-list').innerHTML = state.audit.length ? state.audit.map(item => {
    const packet = state.packets.find(p => p.id === item.packet_id);
    const action = {DEPOSIT:'Deposit accepted', RELEASE:'Release recorded', HANDOVER:'Physical handover confirmed'}[item.action] || item.action;
    return `<article class="activity-row"><span class="audit-number">${item.seq.toString().padStart(2, '0')}</span><div><strong>${esc(action)}</strong><p>${esc(packet?.code || item.packet_id)} · ${esc(packet?.collector || '')}</p></div><div class="audit-meta">${esc(item.operator)}<small>${esc(formatTime(item.at))}</small></div></article>`;
  }).join('') : '<div class="empty"><h3>No actions recorded</h3><p>Your first deposit will appear here.</p></div>';
}

async function mutate(url, body, recovering = false) {
  if (!online) throw new Error('Reconnect to the local desk before recording an action.');
  if (pending() && !recovering) throw new Error('Recover the interrupted request first. Do not start a second action.');
  const action = {url, body};
  sessionStorage.setItem('pending_action', JSON.stringify(action));
  busy = true; connection(online);
  try {
    const result = await request(url, {method: 'POST', headers: {'Content-Type':'application/json', 'X-CSRF-Token':csrf}, body:JSON.stringify(body)});
    sessionStorage.removeItem('pending_action'); showPending();
    return result;
  } catch(error) {
    if (error.status && error.status < 500 && !recovering) { sessionStorage.removeItem('pending_action'); }
    else { error.message = 'Outcome uncertain. Do not repeat a physical handover. Use “Recover saved request” or check the packet after reconnecting.'; connection(false); }
    showPending(); throw error;
  } finally { busy = false; connection(online); }
}

async function recover() {
  const action = pending(); if (!action || busy) return;
  try {
    await refresh();
    const result = await mutate(action.url, action.body, true);
    await refresh();
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    const latest = latestKnownPacket(result.packet);
    showPacket(latest, action.url === '/api/deposits' && latest.status === 'READY');
    toast('Request recovered. Inspect the current record and physical packet before doing anything else.');
  } catch(error) { toast(error.message); }
}

async function openPacket(id) {
  if (busy) return;
  try {
    const {packet} = await request(`/api/packets/${id}`);
    showPacket(packet);
  } catch(error) { if (!error.status) connection(false); toast(error.message || 'Could not load packet. Reconnect before acting.'); }
}

function showPacket(packet, justDeposited = false) {
  packet = latestKnownPacket(packet);
  selectedPacket = packet;
  const summary = `<div class="packet-summary"><div><span>COLLECTOR</span><strong>${esc(packet.collector)}</strong><small>Left by ${esc(packet.depositor)}</small></div><div><span>PASSES</span><strong>${packet.quantity}</strong><small>${esc(packet.category)}</small></div><div><span>SHELF</span><strong>${esc(packet.location)}</strong><small>One sealed packet</small></div></div>`;
  let content = '';
  if (packet.status === 'READY' && justDeposited) {
    content = `<div class="success-note"><strong>Deposit saved.</strong><p>Write <b>${esc(packet.code)}</b> on the sealed envelope in slot <b>${esc(packet.location)}</b>. Keep the shelf label visible. You may print a receipt below.</p></div><div class="dialog-actions"><button class="button secondary" id="print-receipt">Print receipt / label</button><button class="button primary close-dialog">Done</button></div>`;
  } else if (packet.status === 'READY') {
    content = `<form id="release-form"><label>Match the label on the physical packet<input name="packet_code" required autocomplete="off" placeholder="Type or scan ${esc(packet.code)}" maxlength="30"></label><label class="check-row"><input name="identity_verified" type="checkbox" required><span>I visually checked an accepted photo ID and matched it to <strong>${esc(packet.collector)}</strong>. I have not saved ID details.</span></label><div class="inline-note">No matching ID? Pause collection and contact the supervisor. This prototype has no exception override. Record release before handing over.</div><p class="error hidden" id="release-error" role="alert"></p><div class="dialog-actions"><button type="button" class="button secondary close-dialog">Cancel</button><button class="button primary" type="submit" data-mutation>Record release</button></div></form>`;
  } else if (packet.status === 'RELEASE_RECORDED') {
    content = `<div class="recovery-alert"><strong>Release recorded. Physical handover is not confirmed.</strong><p>Recorded by ${esc(packet.released_by)} at ${esc(formatTime(packet.released_at))}. Check whether the original packet is still at the desk. Hand over that packet only once. If it was already handed over, confirm the existing handover below. If uncertain, stop and call the supervisor.</p></div><form id="handover-form"><label class="check-row"><input name="handover_confirmed" type="checkbox" required><span>I am the original operator and confirm this physical packet has been handed over exactly once.</span></label><p class="error hidden" id="handover-error" role="alert"></p><div class="dialog-actions"><button type="button" class="button secondary close-dialog">Close for review</button><button class="button primary" type="submit" data-mutation>Confirm handover</button></div></form>`;
  } else {
    content = `<div class="success-note"><strong>Collection complete. Do not release again.</strong><p>Handed over by ${esc(packet.handed_over_by)} at ${esc(formatTime(packet.handed_over_at))}.</p></div><div class="dialog-actions"><button class="button secondary" id="print-receipt">Print record</button><button class="button primary close-dialog">Done</button></div>`;
  }
  $('#packet-detail').innerHTML = `<div class="dialog-top"><span class="eyebrow">${justDeposited ? 'DEPOSIT RECEIPT' : 'PACKET RECORD'}</span><button class="icon-button close-dialog" aria-label="Close packet">×</button></div><h2 class="record-code">${esc(packet.code)}</h2><span class="status ${packet.status.toLowerCase()}"><i></i>${statuses[packet.status]}</span>${summary}<div id="packet-live-warning" class="error hidden" role="alert"><strong>Stop: this screen is not safe to act on.</strong><br>The desk connection is lost or an action has an uncertain outcome. Do not hand over a packet. Reconnect, recover any saved request, and inspect the current record and physical custody first.</div><div id="packet-procedure">${content}</div><div class="receipt-only">TRAINING RECORD · NOT AN ADMISSION TICKET<br>Saved ${esc(formatTime(packet.created_at))} by ${esc(packet.created_by)}. This receipt does not replace identity verification.</div>`;
  wireClose($('#packet-dialog'));
  if (!$('#packet-dialog').open) $('#packet-dialog').showModal();
  $('#print-receipt')?.addEventListener('click', () => window.print());
  $('#release-form')?.addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return;
    const data = new FormData(event.currentTarget);
    try {
      const result = await mutate(`/api/packets/${packet.id}/release`, {request_id:crypto.randomUUID(), operator, version:packet.version, packet_code:data.get('packet_code'), identity_verified:data.get('identity_verified') === 'on'});
      showPacket(result.packet); await refresh();
    } catch(error) { $('#release-error').textContent = error.message; $('#release-error').classList.remove('hidden'); await refresh(); }
  });
  $('#handover-form')?.addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return;
    const data = new FormData(event.currentTarget);
    try {
      const result = await mutate(`/api/packets/${packet.id}/handover`, {request_id:crypto.randomUUID(), operator, version:packet.version, handover_confirmed:data.get('handover_confirmed') === 'on'});
      showPacket(result.packet); await refresh(); toast('Handover recorded. This packet cannot be released again.');
    } catch(error) { $('#handover-error').textContent = error.message; $('#handover-error').classList.remove('hidden'); await refresh(); }
  });
  connection(online);
}

function wireClose(root) {
  root.querySelectorAll('.close-dialog').forEach(button => button.addEventListener('click', () => { if (!busy) root.close(); }));
}
document.querySelectorAll('dialog').forEach(dialog => { wireClose(dialog); dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); }); });
$('#operator-dialog').addEventListener('cancel', event => { if (!operator) event.preventDefault(); });
$('#operator-form').addEventListener('submit', event => {
  event.preventDefault(); operator = new FormData(event.currentTarget).get('operator').trim();
  if (!operator) return;
  sessionStorage.setItem('staff_name', operator); updateOperator(); $('#operator-dialog').close();
});
$('#operator-button').addEventListener('click', () => { if (busy) return; $('#operator-form input').value = operator; $('#operator-dialog').showModal(); });
$('#new-deposit').addEventListener('click', () => {
  if (!operator) { $('#operator-dialog').showModal(); return; }
  $('#deposit-form').reset(); $('#deposit-error').classList.add('hidden'); $('#deposit-dialog').showModal();
});
$('#deposit-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  const form = new FormData(event.currentTarget);
  $('#save-deposit').disabled = true;
  try {
    const result = await mutate('/api/deposits', {request_id:crypto.randomUUID(), operator, depositor:form.get('depositor'), collector:form.get('collector'), category:form.get('category'), quantity:Number(form.get('quantity')), location:form.get('location'), custody_confirmed:form.get('custody_confirmed') === 'on'});
    $('#deposit-dialog').close(); showPacket(result.packet, true); await refresh();
  } catch(error) { $('#deposit-error').textContent = error.message; $('#deposit-error').classList.remove('hidden'); }
  finally { connection(online); }
});
$('#search').addEventListener('input', render);
$('#refresh').addEventListener('click', refresh);
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
  filter = button.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach(tab => { const active = tab === button; tab.classList.toggle('active', active); tab.setAttribute('aria-selected', String(active)); }); render();
}));
['packets', 'activity', 'guide'].forEach(name => $(`#nav-${name}`).addEventListener('click', () => {
  ['packets', 'activity', 'guide'].forEach(view => { $(`#${view}-view`).classList.toggle('hidden', view !== name); $(`#nav-${view}`).classList.toggle('active', view === name); });
}));
window.addEventListener('focus', refresh);
setInterval(() => { if (!busy && !document.hidden) refresh(); }, 8000);
updateOperator(); showPending(); refresh();
if (!operator) $('#operator-dialog').showModal();
