// Small keyboard and balance-preview improvements; mutations remain in the custody engine.
'use strict';
document.addEventListener('keydown',event=>{ if(event.key==='/' && !document.querySelector('dialog[open]') && !['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)){ event.preventDefault(); document.querySelector('#search').focus(); }});
document.querySelector('#clear-search').addEventListener('click',()=>{document.querySelector('#search').value='';document.querySelector('[data-filter="ALL"]').click();document.querySelector('#search').focus();});
document.addEventListener('input',event=>{
 const form=event.target.closest('#release-form'); if(!form)return;
 let preview=form.querySelector('.release-preview'); if(!preview){preview=document.createElement('div');preview.className='release-preview';preview.setAttribute('role','status');form.querySelector('.quantity-grid').after(preview);}
 const inputs=[...form.querySelectorAll('input[type="number"]')];
 preview.textContent='After this pickup: '+inputs.map(input=>{const left=Number(input.max)-Number(input.value);return (left>=0?left:'Over limit')+' '+(input.name==='normal'?'Normal':input.name.toUpperCase());}).join(' · ')+' remain';
});
document.addEventListener('click',event=>{if(event.detail>1 && event.target.closest('button.close-dialog') && document.querySelector('.verified-state')){event.preventDefault();event.stopImmediatePropagation();}},true);

// Opening and page transitions preserve the same custody store and pending records.
const welcomeScreen = document.querySelector('#welcome-screen');
const deskShell = document.querySelector('#desk-shell');
let navigatingHistory = false;
let currentMorph;
// An arriving gesture ends only the visual interpolation, never the custody action.
document.addEventListener('pointerdown',()=>currentMorph?.skipTransition(),true);
document.addEventListener('keydown',()=>currentMorph?.skipTransition(),true);
window.sharePassMorphUpdate = async change => {
 currentMorph?.skipTransition();
 let applied=false;
 const applyOnce=()=>{if(!applied){applied=true;change();}};
 if(!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches){applyOnce();return;}
 try {
  currentMorph=document.startViewTransition(applyOnce);
  currentMorph.ready.catch(()=>{});
  currentMorph.finished.catch(()=>{});
  await currentMorph.updateCallbackDone;
 } catch { applyOnce(); }
};
function morphDesk(change) {
 window.sharePassMorphUpdate(change);
}
function enterDesk(view='packets') {
 morphDesk(()=>{
  welcomeScreen.classList.add('hidden'); deskShell.classList.remove('hidden');
  document.querySelector(`#nav-${view}`).click();
 });
}
function showOpening() {
 morphDesk(()=>{
  deskShell.classList.add('hidden'); welcomeScreen.classList.remove('hidden');
  if (!navigatingHistory) history.pushState(null,'','#start');
  document.querySelector('#open-desk').focus({preventScroll:true}); window.scrollTo(0,0);
 });
}
document.querySelector('#open-desk').addEventListener('click',()=>enterDesk());
document.querySelector('#welcome-guide').addEventListener('click',()=>enterDesk('guide'));
document.querySelector('#home-button').addEventListener('click',showOpening);
document.querySelector('.skip-link').addEventListener('click',event=>{event.preventDefault();enterDesk();});
for(const view of ['packets','activity','guide']) {
 document.querySelector(`#nav-${view}`).addEventListener('click',()=>{
  if (!navigatingHistory) history.pushState(null,'','#'+({packets:'custody',activity:'history',guide:'guide'})[view]);
  document.querySelector(`#${view}-view h1`).focus({preventScroll:true}); window.scrollTo(0,0);
 });
}
window.addEventListener('popstate',()=>{
 navigatingHistory=true;
 const view=({custody:'packets',history:'activity',guide:'guide'})[location.hash.slice(1)];
 if(view) enterDesk(view); else showOpening();
 navigatingHistory=false;
});
if(typeof demoStore==='undefined') document.querySelector('.practice-tools')?.remove();
document.addEventListener('click',event=>{
 const key=event.target.closest('#collect-code,#new-deposit,[data-open]');
 if(!key)return;
 document.querySelectorAll('.key-morph-source').forEach(node=>node.classList.remove('key-morph-source'));
 key.classList.add('key-morph-source');
},true);
