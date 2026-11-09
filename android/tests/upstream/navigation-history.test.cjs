'use strict';

// Execute the actual navigation script with deferred native-transition callbacks.
// A synchronous animation stub would miss the published v5 history regression.
const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname,'../../web/desk-enhancements.js'),'utf8');

function page({reduced=false}={}) {
 const nodes=new Map(), windowListeners=new Map(), documentListeners=new Map(), transitions=[], tasks=[];
 let skips=0,starts=0,savedAction=null;
 const listen=(map,name,listener,options=false)=>{if(!map.has(name))map.set(name,[]);map.get(name).push({listener,capture:options===true||options?.capture===true});};
 function eventFor(name,target,init={}){
  return {type:name,target,currentTarget:null,detail:name==='click'?1:0,defaultPrevented:false,propagationStopped:false,immediateStopped:false,...init,
   preventDefault(){this.defaultPrevented=true;},
   stopPropagation(){this.propagationStopped=true;},
   stopImmediatePropagation(){this.immediateStopped=true;this.propagationStopped=true;}};
 }
 function invoke(map,name,capture,event,currentTarget,pending){
  event.currentTarget=currentTarget;
  for(const entry of map.get(name)||[]){
   if(entry.capture!==capture)continue;
   if(event.immediateStopped)break;
   pending.push(entry.listener(event));
  }
 }
 class Node {
  constructor(selector){
   this.selector=selector;this.listeners=new Map();this.open=false;this.value='';this.textContent='';this.innerHTML='';this.attributes={};this.parentElement=null;
   this.tagName=selector.endsWith('-dialog')?'DIALOG':selector.endsWith(' h1')||selector.endsWith('-title')?'H1':selector==='#search'?'INPUT':'DIV';
   const classes=new Set();this.classList={add:(...v)=>v.forEach(x=>classes.add(x)),remove:(...v)=>v.forEach(x=>classes.delete(x)),contains:x=>classes.has(x),toggle:(x,on)=>{on=on===undefined?!classes.has(x):on;on?classes.add(x):classes.delete(x);return on;}};
  }
  addEventListener(name,listener,options){listen(this.listeners,name,listener,options);}
  dispatch(name,init={}){
   const event=eventFor(name,this,init),pending=[];
   // Native activation reaches document capture before the target handler.
   invoke(documentListeners,name,true,event,document,pending);
   if(!event.propagationStopped){invoke(this.listeners,name,true,event,this,pending);invoke(this.listeners,name,false,event,this,pending);}
   if(!event.propagationStopped)invoke(documentListeners,name,false,event,document,pending);
   event.currentTarget=null;
   return Promise.all(pending).then(()=>event);
  }
  closest(selector){for(let node=this;node;node=node.parentElement){if(selector.split(',').some(s=>s===node.selector||s.toUpperCase()===node.tagName))return node;}return null;}
  click(){return this.dispatch('click',{detail:0});}
  setAttribute(name,value){this.attributes[name]=value;}
  focus(){document.activeElement=this;}
  showModal(){this.open=true;}
  close(){if(!this.open)return;this.open=false;tasks.push(()=>this.dispatch('close'));}
 }
 const get=selector=>{if(!nodes.has(selector))nodes.set(selector,new Node(selector));return nodes.get(selector);};
 const location={hash:'#signin'};
 const entries=['#signin'];let cursor=0,pushes=0;
 const history={
  pushState(_state,_title,hash){pushes++;entries.splice(cursor+1);entries.push(hash);cursor++;location.hash=hash;},
  replaceState(_state,_title,hash){entries[cursor]=hash;location.hash=hash;}
 };
 const window={addEventListener:(name,fn,options)=>listen(windowListeners,name,fn,options),scrollTo(){}};
 const document={
  activeElement:{tagName:'BODY'},querySelector:selector=>selector==='dialog[open]'?[...nodes.values()].find(n=>n.open)||null:get(selector),
  querySelectorAll:selector=>selector==='dialog[open]'?[...nodes.values()].filter(n=>n.open):[],
  addEventListener:(name,fn,options)=>listen(documentListeners,name,fn,options),
  startViewTransition(change){
   starts++;
   let resolve,reject;const done=new Promise((yes,no)=>{resolve=yes;reject=no;});
   transitions.push(()=>{try{change();resolve();}catch(error){reject(error);}});
   return {ready:Promise.resolve(),finished:done,updateCallbackDone:done,skipTransition(){skips++;}};
  }
 };
 get('#desk-shell').classList.add('hidden');get('#setup-panel').classList.add('hidden');
 for(const view of ['activity','updates','guide'])get(`#${view}-view`).classList.add('hidden');
 get('#booth-choice').value='B1';get('#role-choice').value='Box office';
 const state={outbox:[],collections:[{id:'pending-one',status:'RELEASE_RECORDED',quantities:{normal:2,vip:1,vvip:0}}],deposits:[{remaining:{normal:2,vip:1,vvip:0}}]};
 const context=vm.createContext({window,document,history,location,Object,Promise,console,crypto:require('node:crypto'),
  matchMedia:()=>({matches:reduced}),pending:()=>savedAction,toast(){},operator:'Kenneth',
  setTimeout:callback=>{tasks.push(callback);return tasks.length;},clearTimeout(){},
  requestAnimationFrame:callback=>{tasks.push(callback);return tasks.length;},cancelAnimationFrame(){},queueMicrotask,
  memoryStorage:{setItem(){},removeItem(){}},clearSecrets(){},updateOperator(){},async refresh(){},connection(){},online:true,busy:false,state,
  categories:['normal','vip','vvip'],categoryLabel:x=>x,esc:x=>String(x),quantities:x=>JSON.stringify(x),demoStore:{},
 });
 vm.runInContext(source,context,{filename:'desk-enhancements.js'});
 async function flush(reverse=false){
  // Await the callbacks themselves, not just animation completion or arbitrary sleep.
  for(let round=0;round<50;round++){
   await Promise.resolve();
   if(transitions.length)(reverse?transitions.pop():transitions.shift())();
   await Promise.resolve();
   if(!transitions.length&&tasks.length)await tasks.shift()();
   if(!transitions.length&&!tasks.length){await Promise.resolve();if(!transitions.length&&!tasks.length)return;}
  }
  throw new Error('Transition callbacks did not settle');
 }
 async function act(action){const completed=action();await flush();await completed;}
 const traverse=delta=>{
  const target=cursor+delta;if(target<0||target>=entries.length)throw new Error('No history entry');
  cursor=target;location.hash=entries[cursor];
  return Promise.all((windowListeners.get('popstate')||[]).map(entry=>entry.listener()));
 };
 const click=(id,init)=>get(id).dispatch('click',init);
 async function enter(){await act(()=>click('#choose-event'));await act(()=>click('#choose-role'));await act(()=>get('#setup-form').dispatch('submit'));await act(()=>click('#mock-google'));}
 return {window,get,state,location,entries,click,act,flush,traverse,enter,document,
  setBusy:value=>{context.busy=value;},setPending:value=>{savedAction=value;},pending:()=>savedAction,
  documentEvent:(name,init={})=>{const event=eventFor(name,init.target||document.activeElement,init),pending=[];invoke(documentListeners,name,true,event,document,pending);if(!event.propagationStopped)invoke(documentListeners,name,false,event,document,pending);event.currentTarget=null;return event;},
  stats:()=>({cursor,pushes,skips,starts,pending:transitions.length}),
  visible:view=>!get(`#${view}-view`).classList.contains('hidden')
 };
}

test('deferred Back restores desk without pushing or deleting Forward history',async()=>{
 const p=page();await p.enter();await p.act(()=>p.click('#nav-activity'));
 const before=p.stats().pushes;
 await p.act(()=>p.traverse(-1));
 assert.equal(p.location.hash,'#desk');assert(p.visible('packets'));assert.equal(p.stats().pushes,before);
 await p.act(()=>p.traverse(1));
 assert.equal(p.location.hash,'#history');assert(p.visible('activity'));assert.equal(p.stats().pushes,before);
 assert.deepEqual(p.entries,['#start','#event','#role','#signin','#desk','#history']);
});

test('repeated Back reaches event and sign-in, then Forward restores the entire route',async()=>{
 const p=page();await p.enter();await p.act(()=>p.click('#nav-activity'));
 const custody=JSON.stringify(p.state);
 for(const hash of ['#desk','#signin','#role','#event','#start']){await p.act(()=>p.traverse(-1));assert.equal(p.location.hash,hash);}
 for(const hash of ['#event','#role','#signin','#desk','#history']){await p.act(()=>p.traverse(1));assert.equal(p.location.hash,hash);}
 assert.equal(JSON.stringify(p.state),custody,'navigation cannot mutate a pending physical handover');
 assert.equal(p.entries.length,6);
});

test('choosing the current screen does not add a duplicate history entry',async()=>{
 const p=page();await p.enter();const before=p.stats().pushes;
 await p.act(()=>p.click('#nav-packets'));await p.act(()=>p.click('#nav-packets'));
 assert.equal(p.stats().pushes,before);assert.equal(p.entries.length,5);
});

test('a superseded morph callback cannot overwrite the newer screen or history',async()=>{
 const p=page();await p.enter();
 const older=p.window.sharePassNavigate('activity'),newer=p.window.sharePassNavigate('guide');
 await p.flush(true);await Promise.all([older,newer]);
 assert.equal(p.location.hash,'#guide');assert(p.visible('guide'));assert(!p.visible('activity'));
 assert.deepEqual(p.entries,['#start','#event','#role','#signin','#desk','#guide']);
});

test('Back supersedes a queued click without truncating the existing Forward branch',async()=>{
 const p=page();await p.enter();await p.act(()=>p.click('#nav-activity'));
 const older=p.window.sharePassNavigate('guide'),restored=p.traverse(-1);
 await p.flush();await Promise.all([older,restored]);
 assert.equal(p.location.hash,'#desk');assert(p.visible('packets'));
 await p.act(()=>p.traverse(1));assert.equal(p.location.hash,'#history');assert(p.visible('activity'));
 assert.deepEqual(p.entries,['#start','#event','#role','#signin','#desk','#history']);
});

test('reduced-motion navigation has the same Back and Forward semantics',async()=>{
 const p=page({reduced:true});await p.enter();await p.act(()=>p.click('#nav-updates'));
 await p.act(()=>p.traverse(-1));assert.equal(p.location.hash,'#desk');
 await p.act(()=>p.traverse(1));assert.equal(p.location.hash,'#updates');assert(p.visible('updates'));
 assert.equal(p.stats().pending,0);assert.equal(p.stats().skips,0);
});

test('interrupting interpolation cannot apply navigation twice',async()=>{
 const p=page();await p.enter();const before=p.stats().pushes;
 const navigation=p.window.sharePassNavigate('activity');p.documentEvent('pointerdown');p.documentEvent('keydown');
 await p.flush();await navigation;
 assert.equal(p.stats().pushes,before+1);assert.equal(p.entries.length,6);assert(p.stats().skips>=2);
});

test('Enter activation changes the route and heading focus without starting another transition',async()=>{
 const p=page(),before=p.stats(),custody=JSON.stringify(p.state);
 const key=p.documentEvent('keydown',{key:'Enter',target:p.get('#choose-event')});
 assert.equal(key.defaultPrevented,false,'native button activation remains available');
 assert.equal(p.location.hash,'#start','keydown alone cannot synthesize an extra click');
 const activated=p.click('#choose-event',{detail:0});
 assert.equal(p.location.hash,'#event');assert.equal(p.document.activeElement,p.get('#event-title'));
 assert.equal(p.stats().starts,before.starts);assert.equal(p.stats().pending,0);
 await p.act(()=>activated);
 assert.equal(p.stats().pushes,before.pushes+1);assert.equal(JSON.stringify(p.state),custody);
});

test('Space keyup activation stays immediate after repeated keydowns without an extra activation',async()=>{
 const p=page(),target=p.get('#choose-event'),before=p.stats();
 for(const repeat of [false,true,true]){
  const key=p.documentEvent('keydown',{key:' ',target,repeat});
  assert.equal(key.defaultPrevented,false);assert.equal(p.location.hash,'#start');
 }
 const keyup=p.documentEvent('keyup',{key:' ',target});
 assert.equal(keyup.defaultPrevented,false);assert.equal(p.stats().pushes,before.pushes);
 const activated=p.click('#choose-event',{detail:0});
 assert.equal(p.location.hash,'#event');assert.equal(p.stats().starts,before.starts);
 await p.act(()=>activated);assert.equal(p.stats().pushes,before.pushes+1);
});

test('a detail-zero assistive activation opens the native menu without a preceding keydown',async()=>{
 const p=page();await p.enter();const before=p.stats();
 const activated=p.click('#menu-toggle',{detail:0});
 assert.equal(p.get('#menu-dialog').open,true);assert.equal(p.stats().starts,before.starts);
 await p.act(()=>activated);assert.equal(p.location.hash,'#desk');
});

test('keyboard intent survives asynchronous sign-in and the pointer restores connected morphs',async()=>{
 const p=page();await p.act(()=>p.click('#choose-event'));await p.act(()=>p.click('#choose-role'));
 await p.act(()=>p.get('#setup-form').dispatch('submit'));const before=p.stats();
 p.documentEvent('keydown',{key:'Enter',target:p.get('#mock-google')});
 await p.act(()=>p.click('#mock-google',{detail:0}));
 assert.equal(p.location.hash,'#desk');assert.equal(p.stats().starts,before.starts,'awaited sign-in retains the keyboard modality');
 const pointer=p.documentEvent('pointerdown',{target:p.get('#nav-activity'),pointerType:'mouse'});
 assert.equal(pointer.defaultPrevented,false);
 const activated=p.click('#nav-activity',{detail:1});
 assert.equal(p.location.hash,'#desk','pointer navigation still uses its deferred connected morph');
 assert.equal(p.stats().starts,before.starts+1);assert.equal(p.stats().pending,1);
 await p.act(()=>activated);assert.equal(p.location.hash,'#history');assert(p.visible('activity'));
});

test('keyboard navigation supersedes a queued pointer morph without stale focus or history',async()=>{
 const p=page();await p.enter();const before=p.stats(),custody=JSON.stringify(p.state);
 p.documentEvent('pointerdown',{target:p.get('#nav-activity'),pointerType:'touch'});
 const older=p.click('#nav-activity',{detail:1});assert.equal(p.stats().pending,1);
 p.documentEvent('keydown',{key:'Enter',target:p.get('#nav-guide')});
 const newer=p.click('#nav-guide',{detail:0});
 assert.equal(p.location.hash,'#guide');assert.equal(p.document.activeElement,p.get('#guide-view h1'));
 assert.equal(p.stats().starts,before.starts+1,'keyboard does not enqueue a replacement animation');
 await p.flush(true);await Promise.all([older,newer]);
 assert.equal(p.location.hash,'#guide');assert(p.visible('guide'));assert(!p.visible('activity'));
 assert.equal(p.document.activeElement,p.get('#guide-view h1'));assert.equal(p.stats().pushes,before.pushes+1);
 assert.equal(JSON.stringify(p.state),custody);
});

test('reduced motion remains immediate for keyboard, assistive and subsequent pointer activation',async()=>{
 const p=page({reduced:true});await p.enter();
 p.documentEvent('keydown',{key:' ',target:p.get('#menu-toggle')});
 await p.act(()=>p.click('#menu-toggle',{detail:0}));assert.equal(p.get('#menu-dialog').open,true);
 p.documentEvent('pointerdown',{target:p.get('#nav-guide'),pointerType:'mouse'});
 const activated=p.click('#nav-guide',{detail:1});
 assert.equal(p.location.hash,'#guide');assert.equal(p.stats().starts,0);assert.equal(p.stats().pending,0);
 await p.act(()=>activated);assert.equal(p.get('#menu-dialog').open,false);
});

test('assistive disclosure activation toggles once immediately and pointer disclosure still morphs',async()=>{
 const p=page(),details=p.get('details'),summary=p.get('summary');
 details.tagName='DETAILS';summary.tagName='SUMMARY';summary.parentElement=details;
 const opened=p.click('summary',{detail:0});
 assert.equal(details.open,true);assert.equal(p.stats().starts,0);
 assert.equal((await opened).defaultPrevented,true,'the existing disclosure handler owns its single toggle');
 p.documentEvent('pointerdown',{target:summary,pointerType:'touch'});
 const closed=p.click('summary',{detail:1});
 assert.equal(details.open,true);assert.equal(p.stats().starts,1);
 await p.act(()=>closed);assert.equal(details.open,false);
});

test('immediate keyboard navigation preserves busy and uncertain custody guards',async()=>{
 const p=page();await p.enter();p.get('#packet-dialog').showModal();
 const before=p.stats(),custody=JSON.stringify(p.state);
 p.setBusy(true);p.documentEvent('keydown',{key:'Enter',target:p.get('#nav-guide')});
 await p.act(()=>p.click('#nav-guide',{detail:0}));
 assert.equal(p.location.hash,'#desk');assert.equal(p.get('#packet-dialog').open,true);
 p.setBusy(false);
 const action={url:'/api/deposits/packet-1/release',body:{request_id:'same-action',quantities:{normal:2,vip:1,vvip:0}}};
 p.setPending(action);await p.act(()=>p.click('#home-button',{detail:0}));
 assert.equal(p.location.hash,'#desk');assert.equal(p.get('#packet-dialog').open,true);
 assert.equal(p.pending(),action);assert.equal(p.stats().starts,before.starts);assert.equal(p.stats().pushes,before.pushes);
 assert.equal(JSON.stringify(p.state),custody);
});

test('Back dismisses nested packet and service dialogs before changing the desk route',async()=>{
 const p=page();await p.enter();await p.act(()=>p.click('#nav-activity'));await p.act(()=>p.click('#nav-packets'));
 const custody=JSON.stringify(p.state),before=p.stats().pushes;
 p.get('#packet-dialog').showModal();p.get('#service-dialog').showModal();
 await p.act(()=>p.traverse(-1));
 assert.equal(p.location.hash,'#history');assert(p.visible('activity'));
 assert.equal(p.get('#packet-dialog').open,false);assert.equal(p.get('#service-dialog').open,false);
 assert.equal(p.stats().pushes,before);assert.equal(JSON.stringify(p.state),custody);
 await p.act(()=>p.traverse(1));assert.equal(p.location.hash,'#desk');assert(p.visible('packets'));
 assert.equal(p.get('#packet-dialog').open,false);assert.equal(p.get('#service-dialog').open,false);
});

test('busy clicks and browser Back keep the current route and active custody dialog',async()=>{
 const p=page();await p.enter();p.get('#packet-dialog').showModal();p.setBusy(true);
 const custody=JSON.stringify(p.state),before=p.stats().pushes;
 await p.act(()=>p.click('#nav-activity'));
 assert.equal(p.location.hash,'#desk');assert(p.visible('packets'));assert(!p.visible('activity'));
 await p.act(()=>p.traverse(-1));
 assert.equal(p.location.hash,'#desk','a refused Back must restore the address to the screen still shown');
 assert.equal(p.get('#desk-shell').classList.contains('hidden'),false);
 assert.equal(p.get('#packet-dialog').open,true);assert.equal(p.stats().pushes,before);
 assert.equal(JSON.stringify(p.state),custody,'route attempts never cancel or reverse a custody write');
 p.setBusy(false);await p.act(()=>p.click('#nav-activity'));
 assert.equal(p.location.hash,'#history');assert.equal(p.get('#packet-dialog').open,false);
});

test('uncertain request blocks route departure without hiding the desk or changing the saved action',async()=>{
 const p=page();await p.enter();
 const action={url:'/api/deposits/packet-1/release',body:{request_id:'same-action',event_id:'training-event-001',booth_id:'B1',quantities:{normal:2,vip:1,vvip:0}}};
 p.setPending(action);const saved=JSON.stringify(action),before=p.stats().pushes;
 await p.act(()=>p.click('#home-button'));
 await p.act(()=>p.click('#nav-guide'));
 await p.act(()=>p.traverse(-1));
 assert.equal(p.location.hash,'#desk');assert(p.visible('packets'));
 assert.equal(p.get('#desk-shell').classList.contains('hidden'),false,'the recovery banner remains in the visible desk');
 assert.equal(p.get('#welcome-screen').classList.contains('hidden'),true);
 assert.equal(p.stats().pushes,before);assert.equal(p.pending(),action);assert.equal(JSON.stringify(p.pending()),saved);
 p.setPending(null);await p.act(()=>p.click('#nav-guide'));assert.equal(p.location.hash,'#guide');
});

test('asynchronous nested dialog close callbacks cannot steal the destination heading focus',async()=>{
 const p=page();await p.enter();
 p.get('#connections-dialog').showModal();p.get('#types-dialog').showModal();
 await p.act(()=>p.window.sharePassNavigate('activity'));
 assert.equal(p.get('#connections-dialog').open,false);assert.equal(p.get('#types-dialog').open,false);
 assert.equal(p.document.activeElement,p.get('#activity-view h1'));
 p.get('#connections-dialog').showModal();await p.act(()=>p.click('#home-button'));
 assert.equal(p.location.hash,'#start');assert.equal(p.get('#connections-dialog').open,false);
 assert.equal(p.document.activeElement,p.get('#start-title'));
});

test('persistent home and return controls preserve the signed-in desk and balances',async()=>{
 const p=page();await p.enter();const snapshot=JSON.stringify(p.state);
 await p.act(()=>p.click('#home-button'));
 assert.equal(p.location.hash,'#start');assert.equal(p.get('body').attributes['data-session'],'active');
 assert.equal(p.get('#return-desk').classList.contains('hidden'),false);
 assert.equal(p.get('#menu-home').attributes['aria-current'],'page');
 assert.equal(p.get('#nav-packets').attributes['aria-current'],'false');
 assert.equal(p.get('#menu-home').classList.contains('active'),true);
 await p.act(()=>p.click('#return-desk'));
 assert.equal(p.location.hash,'#desk');assert(p.visible('packets'));
 assert.equal(p.get('#return-desk').classList.contains('hidden'),true);
 assert.equal(p.get('#menu-home').attributes['aria-current'],'false');
 assert.equal(p.get('#nav-packets').attributes['aria-current'],'page');
 await p.act(()=>p.traverse(-1));assert.equal(p.location.hash,'#start');
 await p.act(()=>p.traverse(1));assert.equal(p.location.hash,'#desk');
 assert.equal(JSON.stringify(p.state),snapshot);
});

test('the restored opening guide is readable without granting desk access',async()=>{
 const p=page();assert.equal(p.get('body').attributes['data-session'],'guest');
 await p.act(()=>p.click('#welcome-guide'));
 assert.equal(p.location.hash,'#guide');assert(p.visible('guide'));
 assert.equal(p.get('body').attributes['data-session'],'guest');
 assert.equal(p.get('#return-desk').classList.contains('hidden'),true);
 await p.act(()=>p.traverse(-1));assert.equal(p.location.hash,'#start');
 await p.act(()=>p.window.sharePassNavigate('packets'));
 assert.equal(p.location.hash,'#event');
});

test('persistent welcome and return controls respect uncertain custody actions',async()=>{
 const p=page();await p.enter();const action={request_id:'same-saved-action'};p.setPending(action);
 const pushes=p.stats().pushes;
 await p.act(()=>p.click('#menu-home'));await p.act(()=>p.click('#home-button'));
 assert.equal(p.location.hash,'#desk');assert.equal(p.stats().pushes,pushes);assert.equal(p.pending(),action);
 p.setPending(null);await p.act(()=>p.click('#menu-home'));assert.equal(p.location.hash,'#start');
 p.setPending(action);await p.act(()=>p.click('#return-desk'));
 assert.equal(p.location.hash,'#start');assert.equal(p.pending(),action);
});

test('a delayed Settings morph cannot reopen a dialog after a newer route navigation',async()=>{
 const p=page();await p.enter();p.get('#menu-dialog').showModal();
 const opening=p.click('#menu-connections'),navigation=p.window.sharePassNavigate('guide');
 await p.flush(true);await Promise.all([opening,navigation]);
 assert.equal(p.location.hash,'#guide');assert(p.visible('guide'));
 assert.equal(p.get('#menu-dialog').open,false);assert.equal(p.get('#connections-dialog').open,false);
 assert.equal(p.document.activeElement,p.get('#guide-view h1'));
});

test('a custody action starting before a deferred navigation callback keeps that route unchanged',async()=>{
 const p=page();await p.enter();p.get('#packet-dialog').showModal();
 const before=p.stats().pushes,navigation=p.window.sharePassNavigate('activity');
 p.setBusy(true);await p.flush();await navigation;
 assert.equal(p.location.hash,'#desk');assert(p.visible('packets'));assert(!p.visible('activity'));
 assert.equal(p.get('#packet-dialog').open,true);assert.equal(p.stats().pushes,before);
});
