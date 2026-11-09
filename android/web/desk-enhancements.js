'use strict';
const welcomeScreen=document.querySelector('#welcome-screen');
const deskShell=document.querySelector('#desk-shell');
let currentMorph, directInteraction=false, mockSignedIn=false, setupSaved=false, onboardingBusy=false, navigationRevision=0, currentRoute='#start';
window.sharePassContext={booth_id:'B1',role:'Box office'};
// Only the focused, top modal owns the connected action surface.
function syncDialogSurface(){
 const dialogs=[...document.querySelectorAll('dialog[open]')];
 const focused=document.activeElement?.closest?.('dialog');
 const top=dialogs.includes(focused)?focused:dialogs.at(-1);
 document.querySelectorAll('dialog').forEach(d=>d.classList.toggle('active-dialog',d===top));
}
document.addEventListener('focusin',syncDialogSurface);
if(typeof MutationObserver!=='undefined')new MutationObserver(syncDialogSurface).observe(document.body,{subtree:true,attributes:true,attributeFilter:['open']});

// A gesture ends visual interpolation only; it never cancels or reverses custody writes.
document.addEventListener('pointerdown',()=>{directInteraction=false;currentMorph?.skipTransition();},true);
document.addEventListener('keydown',()=>{directInteraction=true;currentMorph?.skipTransition();},true);
// Keep native keyboard and assistive activation immediate, including Space keyup
// and asynchronous handlers. The next pointer gesture restores connected morphs.
document.addEventListener('click',event=>{if(event.detail===0){directInteraction=true;currentMorph?.skipTransition();}},true);
window.sharePassMorphUpdate=async change=>{
 currentMorph?.skipTransition(); let applied=false;
 const revision=navigationRevision;
 const once=()=>{if(!applied){applied=true;if(revision===navigationRevision){change();syncDialogSurface();}}};
 if(directInteraction||!document.startViewTransition||matchMedia('(prefers-reduced-motion: reduce)').matches){once();return;}
 try{currentMorph=document.startViewTransition(once);currentMorph.ready.catch(()=>{});currentMorph.finished.catch(()=>{});await currentMorph.updateCallbackDone;}catch{once();}
};
// Disclosure keeps the same physical section while its geometry expands.
const disclosureIntent=new WeakMap();
document.addEventListener('click',event=>{
 const summary=event.target.closest('summary');if(!summary)return;
 const details=summary.parentElement;if(details?.tagName!=='DETAILS')return;
 event.preventDefault();const open=!(disclosureIntent.get(details)?.open??details.open),revision=crypto.randomUUID();
 disclosureIntent.set(details,{open,revision});document.querySelectorAll('.details-morph-source').forEach(n=>n.classList.remove('details-morph-source'));details.classList.add('details-morph-source');
 window.sharePassMorphUpdate(()=>{if(disclosureIntent.get(details)?.revision===revision)details.open=open;});
},true);
const focusHeading=selector=>document.querySelector(selector)?.focus({preventScroll:true});
const closeMenus=()=>{const menu=document.querySelector('#menu-dialog');if(menu.open)menu.close();};
function canNavigate(){
 if(!busy&&!pending())return true;
 if(location.hash!==currentRoute)history.replaceState(null,'',currentRoute);
 toast(busy?'Wait for the current action to finish.':'Recover the saved request before changing screens.');return false;
}
const routeClosedDialogs=new WeakSet();
window.sharePassSkipCloseFocus=dialog=>routeClosedDialogs.delete(dialog);
window.sharePassCloseForNavigation=()=>{
 document.querySelectorAll('dialog[open]').forEach(d=>{routeClosedDialogs.add(d);d.close();});
};
async function navigateScreen(hash,push,change){
 // Keep history intent on this navigation, including while its morph callback is deferred.
 // A newer Back/Forward or click supersedes an older visual callback, never a custody write.
 const navigation=Object.freeze({hash,push:push===true,revision:++navigationRevision});
 await window.sharePassMorphUpdate(()=>{
  if(navigation.revision!==navigationRevision||!canNavigate())return;
  change();
  currentRoute=navigation.hash;
  syncPersistentNavigation();
  if(navigation.push&&location.hash!==navigation.hash)history.pushState(null,'',navigation.hash);
 });
}
function syncPersistentNavigation(){
 const active=mockSignedIn&&setupSaved;
 const body=document.querySelector('body');
 body.setAttribute('data-session',active?'active':'guest');
 body.setAttribute('data-route',currentRoute.slice(1));
 document.querySelector('#return-desk')?.classList.toggle('hidden',!active||currentRoute==='#desk');
 document.querySelector('#menu-home')?.setAttribute('aria-current',currentRoute==='#start'?'page':'false');
 document.querySelector('#menu-home')?.classList.toggle('active',currentRoute==='#start');
 document.querySelector('#menu-setup')?.setAttribute('aria-current',['#event','#role','#signin'].includes(currentRoute)?'page':'false');
 for(const [id,route] of [['nav-packets','#desk'],['nav-activity','#history'],['nav-updates','#updates'],['nav-guide','#guide']]){
  const item=document.querySelector('#'+id),selected=currentRoute===route;
  item.classList.toggle('active',selected);item.setAttribute('aria-current',selected?'page':'false');
 }
}
function syncDeskContext(){
 const c=window.sharePassContext;document.querySelector('#booth-label').textContent=c.booth_id==='B2'?'Booth 2':'Booth 1';
 document.querySelector('#desk-role').textContent=c.booth_id+' · '+(c.role==='Admin'?'Admin'+(window.SharePassHost?'':' · mock'):'Box office');
 document.querySelector('#account-context').textContent=`SharePass event · ${c.booth_id==='B2'?'Booth 2':'Booth 1'} · ${c.role}${c.role==='Admin'?' (mock)':''}`;
}
async function showAccess(step='start',push=true){
 if(!canNavigate())return;
 const stages={start:['start','start-title'],event:['event','event-title'],setup:['role','setup-title'],signin:['signin','sign-in-title']};
 const current=stages[step]||stages.start;
 await navigateScreen('#'+current[0],push,()=>{
  window.sharePassCloseForNavigation();deskShell.classList.add('hidden');welcomeScreen.classList.remove('hidden');
  for(const [key,id] of [['start','start-panel'],['event','event-panel'],['setup','setup-panel'],['signin','sign-in-panel']])document.querySelector('#'+id).classList.toggle('hidden',key!==step);
  focusHeading('#'+current[1]);window.scrollTo(0,0);
 });
}
window.sharePassNavigate=async(view='packets',push=true)=>{
 if(!canNavigate())return;
 // The desk guide is read-only and remains available before simulated sign-in.
 if(view!=='guide'&&!setupSaved)return showAccess('event',push);
 if(view!=='guide'&&!mockSignedIn)return showAccess('signin',push);
 await navigateScreen('#'+({packets:'desk',activity:'history',updates:'updates',guide:'guide'})[view],push,()=>{
  window.sharePassCloseForNavigation();welcomeScreen.classList.add('hidden');deskShell.classList.remove('hidden');
  for(const name of ['packets','activity','updates','guide']){const active=name===view;document.querySelector(`#${name}-view`).classList.toggle('hidden',!active);const key=document.querySelector(`#nav-${name}`);key.classList.toggle('active',active);key.setAttribute('aria-current',active?'page':'false');}
  window.sharePassRenderExtras?.();focusHeading(`#${view}-view h1`);window.scrollTo(0,0);
 });
};
document.querySelector('#mock-google').addEventListener('click',async()=>{
 if(onboardingBusy)return;onboardingBusy=true;document.querySelector('#mock-google').disabled=true;
 try{
  const identity=window.SharePassHost?await window.SharePassHost.connect():{staff_label:'Kenneth'};
  mockSignedIn=true;operator=identity.staff_label;memoryStorage.setItem('staff_name',operator);updateOperator();connection(online);
  await refresh();await window.sharePassNavigate();
 }catch(error){toast(error.message);}
 finally{document.querySelector('#mock-google').disabled=false;onboardingBusy=false;}
});
document.querySelector('#setup-form').addEventListener('submit',async event=>{
 event.preventDefault();if(onboardingBusy)return;onboardingBusy=true;
 window.sharePassContext={booth_id:document.querySelector('#booth-choice').value,role:document.querySelector('#role-choice').value};setupSaved=true;syncDeskContext();if(mockSignedIn)await window.sharePassNavigate();else await showAccess('signin');onboardingBusy=false;
});
document.querySelector('#choose-event').addEventListener('click',()=>showAccess('event'));
document.querySelector('#choose-role').addEventListener('click',()=>showAccess('setup'));
document.querySelector('#event-back').addEventListener('click',()=>showAccess('start'));
document.querySelector('#setup-back').addEventListener('click',()=>showAccess('event'));
document.querySelector('#signin-back').addEventListener('click',()=>showAccess('setup'));
document.querySelector('#mock-admin').addEventListener('click',()=>{document.querySelector('#role-choice').value='Admin';document.querySelector('#role-choice').focus();});
document.querySelector('#home-button').addEventListener('click',()=>showAccess('start'));
document.querySelector('#menu-home')?.addEventListener('click',()=>showAccess('start'));
document.querySelector('#return-desk')?.addEventListener('click',()=>window.sharePassNavigate());
document.querySelector('#welcome-guide')?.addEventListener('click',()=>window.sharePassNavigate('guide'));
document.querySelector('#account-setup').addEventListener('click',()=>showAccess('event'));
document.querySelector('#menu-setup').addEventListener('click',()=>showAccess('event'));
document.querySelector('#menu-signout').addEventListener('click',async()=>{
 if(pending()||state.collections.some(c=>c.status==='RELEASE_RECORDED')){toast('Reconcile the pending handover before signing out.');return;}
 clearSecrets();window.SharePassHost?.disconnect();window.sharePassClearView?.();mockSignedIn=false;setupSaved=false;operator='';memoryStorage.removeItem('staff_name');await showAccess('start');
});
document.querySelector('#menu-toggle').addEventListener('click',()=>window.sharePassMorphUpdate(()=>document.querySelector('#menu-dialog').showModal()));
document.querySelector('#menu-connections').addEventListener('click',()=>window.sharePassMorphUpdate(()=>{closeMenus();document.querySelector('#connections-dialog').showModal();}));
for(const view of ['packets','activity','updates','guide'])document.querySelector(`#nav-${view}`).addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();window.sharePassNavigate(view);},true);
document.querySelector('.skip-link').addEventListener('click',event=>{event.preventDefault();mockSignedIn&&setupSaved?window.sharePassNavigate():showAccess('event');});
window.addEventListener('popstate',()=>{const hash=location.hash.slice(1),view=({desk:'packets',custody:'packets',history:'activity',updates:'updates',guide:'guide'})[hash];return view?window.sharePassNavigate(view,false):showAccess(({start:'start',event:'event',role:'setup',signin:'signin'})[hash]||'start',false);});
document.addEventListener('keydown',event=>{if(event.key==='/'&&mockSignedIn&&setupSaved&&!document.querySelector('dialog[open]')&&!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)){event.preventDefault();window.sharePassNavigate().then(()=>document.querySelector('#search').focus());}});
document.querySelector('#clear-search').addEventListener('click',()=>{document.querySelector('#search').value='';document.querySelector('[data-filter="ALL"]').click();document.querySelector('#search').focus();});
document.addEventListener('click',event=>{
 if(event.detail>1&&event.target.closest('button.close-dialog')&&document.querySelector('.verified-state')){event.preventDefault();event.stopImmediatePropagation();return;}
 const key=event.target.closest('#collect-code,#new-deposit,[data-open]');if(key){document.querySelectorAll('.key-morph-source').forEach(n=>n.classList.remove('key-morph-source'));key.classList.add('key-morph-source');}
},true);

window.sharePassDepositFields=(values={})=>{document.querySelector('#deposit-quantities').innerHTML=categories.map(k=>quantityControl(k,Number(values[k]||0),100)).join('');};
function showTypes(){
 closeMenus();document.querySelector('#types-list').innerHTML=(state.passTypes||[]).map(t=>`<span class="type-chip">${esc(t.label)}</span>`).join('');document.querySelector('#type-error').classList.add('hidden');document.querySelector('#types-dialog').showModal();
}
document.querySelector('#menu-types').addEventListener('click',showTypes);document.querySelector('#deposit-types').addEventListener('click',showTypes);
document.querySelector('#type-form').addEventListener('submit',async event=>{
 event.preventDefault();const formNode=event.currentTarget;const values=Object.fromEntries(categories.map(k=>[k,Number(document.querySelector(`#deposit-quantities [name="${k}"]`)?.value||0)]));
 try{demoStore.addPassType(new FormData(formNode).get('pass_type'));await refresh();window.sharePassDepositFields(values);formNode.reset();showTypes();}catch(error){const p=document.querySelector('#type-error');p.textContent=error.message;p.classList.remove('hidden');}
});
window.sharePassCollectionFields=()=>`<details class="collection-options"><summary>Collector & evidence</summary><label>Collector<select name="collector_label"><option value="">Not recorded</option><option>Sample friend A</option><option>Sample friend B</option></select></label><div class="evidence-picks" aria-label="Synthetic photo evidence"><button type="button" class="evidence-pick" data-evidence="sample-a" aria-pressed="false"><span class="sample-photo">A</span>Sample A</button><button type="button" class="evidence-pick" data-evidence="sample-b" aria-pressed="false"><span class="sample-photo">B</span>Sample B</button></div><input type="hidden" name="evidence_fixture_id" value=""><label class="check-row evidence-consent hidden"><input type="checkbox" name="consent_confirmed"><span>Use this synthetic evidence for verification and selected update previews.</span></label><small class="muted">Sample evidence only; no camera or real photo upload.</small></details>`;
window.sharePassCollectionMeta=form=>({booth_id:window.sharePassContext.booth_id,collector_label:form.get('collector_label')||'',...(form.get('evidence_fixture_id')?{evidence_fixture_id:form.get('evidence_fixture_id'),consent_confirmed:form.get('consent_confirmed')==='on'}:{})});
window.sharePassWireEvidence=()=>document.querySelectorAll('[data-evidence]').forEach(button=>button.addEventListener('click',()=>{
 const form=button.closest('form'),input=form.querySelector('[name="evidence_fixture_id"]');const next=input.value===button.dataset.evidence?'':button.dataset.evidence;input.value=next;
 form.querySelectorAll('[data-evidence]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.evidence===next)));const row=form.querySelector('.evidence-consent');row.classList.toggle('hidden',!next);row.querySelector('input').required=!!next;
}));
document.addEventListener('input',event=>{
 const form=event.target.closest('#release-form');if(!form)return;let preview=form.querySelector('.release-preview');if(!preview){preview=document.createElement('div');preview.className='release-preview';preview.setAttribute('role','status');form.querySelector('.quantity-grid').after(preview);}
 const inputs=[...form.querySelectorAll('.quantity-grid input')];preview.textContent='Remaining: '+inputs.map(input=>`${Math.max(0,Number(input.max)-Number(input.value))} ${categoryLabel(input.name)}`).join(' · ');
});
window.sharePassRenderExtras=()=>{
 const outbox=state.outbox||[];document.querySelector('#updates-list').innerHTML=outbox.length?outbox.map(n=>`<article class="update-row"><span class="channel-tag">${esc(({whatsapp:'WhatsApp',sms:'SMS',email:'Email'})[n.channel]||'Update')}</span><div><strong>${esc(({DEPOSIT_CREATED:'Deposit received',HANDOVER_CONFIRMED:'Collection confirmed'})[n.action]||'Custody update')}</strong><p>${n.remaining?esc(quantities(n.remaining)):''}</p><small>Sample depositor · not sent — provider not connected</small></div></article>`).join(''):'<div class="empty"><h3>No update previews</h3><p>Choose channels when creating a deposit.</p></div>';
};
document.querySelector('#expire-evidence').addEventListener('click',async()=>{
 if(busy||pending()){toast('Finish or recover the current action first.');return;}
 demoStore.endAt=Date.now();const result=demoStore.purgeEvidence();await refresh();
 document.querySelector('#retention-result').textContent=`${result.deleted} synthetic references expired. Pass balances unchanged.`;
});
document.querySelector('#packet-dialog').addEventListener('close',()=>{if(state.collections.some(c=>c.status==='RELEASE_RECORDED'))toast('Handover pending. Reopen the packet before another pickup.');});
for(const id of ['types-dialog','connections-dialog'])document.querySelector('#'+id).addEventListener('close',event=>{if(window.sharePassSkipCloseFocus(event.target))return;if(!document.querySelector('dialog[open]')&&!deskShell.classList.contains('hidden'))document.querySelector('#menu-toggle').focus({preventScroll:true});});
syncDeskContext();syncPersistentNavigation();history.replaceState(null,'','#start');window.sharePassRenderExtras();

const deskMode=document.querySelector('#desk-mode');
deskMode.addEventListener('change',()=>{
 document.querySelector('#new-deposit').classList.toggle('hidden',deskMode.value==='collector');
 document.querySelector('#collect-code').classList.toggle('hidden',deskMode.value==='depositor');
});
