'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const vm=require('node:vm');

// Executed production handlers in a bounded synthetic DOM, not browser acceptance.
function page(){
 const tasks=[],timers=new Map(),externalCalls=[],document={};let timer=0;
 class Element{
  constructor(tag){this.tag=tag;this.attributes={};this.children=[];this.listeners=[];this.hidden=false;this.open=false;this.classList={add(){}};}
  setAttribute(key,value){this.attributes[key]=String(value);}
  append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}
  replaceChildren(...children){this.children.forEach(child=>child.parentElement=null);this.children=[];this.append(...children);}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null;}
  closest(tag){for(let current=this;current;current=current.parentElement)if(current.tag===tag)return current;return null;}
  querySelectorAll(tag){return this.children.flatMap(child=>[...(child.tag===tag?[child]:[]),...child.querySelectorAll(tag)]);}
  addEventListener(type,run,options={}){this.listeners.push({type,run,signal:options.signal});}
  dispatch(type){for(const listener of this.listeners)if(listener.type===type&&!listener.signal?.aborted)listener.run({type,target:this});}
  click(){this.dispatch('click');}
  showModal(){this.open=true;}
  close(){if(this.open){this.open=false;tasks.push(()=>this.dispatch('close'));}}
  focus(){document.activeElement=this;}
 }
 document.createElement=tag=>new Element(tag);document.createElementNS=(_,tag)=>new Element(tag);document.body=new Element('body');
 const denied=operation=>()=>{externalCalls.push(operation);throw Error('Unexpected external call: '+operation);};
 const windowEvents=new Element('window');
 const context=vm.createContext({document,AbortController,
  setTimeout:run=>{timers.set(++timer,run);return timer;},clearTimeout:id=>timers.delete(id),
  addEventListener:windowEvents.addEventListener.bind(windowEvents),fetch:denied('fetch'),open:denied('navigation'),
  XMLHttpRequest:function(){denied('XHR')();},navigator:{mediaDevices:{getUserMedia:denied('camera')}}});
 context.window=context;
 for(const file of ['phone.js','vendor/sharepass-qr.js','share-drafts.js'])vm.runInContext(readFileSync(join(__dirname,'../web',file),'utf8'),context);
 const drafts=context.SharePassDrafts,container=new Element('div');document.body.append(container);
 const visible=element=>{for(let node=element;node;node=node.parentElement)if(node.hidden)return false;return true;};
 const all=tag=>container.querySelectorAll(tag).filter(visible);
 const button=label=>{const found=all('button').filter(b=>b.textContent===label);assert.equal(found.length,1,label);return found[0];};
 return {drafts,container,document,externalCalls,all,button,context,
  flush(){while(tasks.length)tasks.shift()();},
  input(type,value){const field=all('input').find(input=>input.type===type);assert(field);field.value=value;field.dispatch('input');},
  submit(){const [form]=all('form');assert(form);form.onsubmit({preventDefault(){}});},
  message(){const [text]=all('textarea');assert(text);return text.value;},
  flushTimers(){const pending=[...timers.values()];timers.clear();pending.forEach(run=>run());}};
}
const base={phone:'+12025550101',name:'Fixture',code:'K7M4',reference:'PKT-1234ABCD',booth:'Box office',quantities:{normal:4,vip:2,vvip:0,mip:1}};
const people=[{name:'First fixture',phone:'+12025550101',quantities:{normal:1,vip:2,vvip:0,mip:0}},
 {name:'Second fixture',phone:'+12025550102',quantities:{normal:3,vip:0,vvip:0,mip:1}}];
const json=value=>JSON.parse(JSON.stringify(value));

test('allocated drafts distinguish exact original plans from the shared receipt balance',()=>{
 const p=page();p.drafts.renderDeposit(p.container,{...base,recipients:people});
 assert.match(p.message(),/Your planned share: 1 Normal \+ 2 VIP passes\./);
 assert.match(p.message(),/Group balance on this receipt: 4 Normal \+ 2 VIP \+ 1 MIP/);
 p.button('Next recipient').click();
 assert.match(p.message(),/Your planned share: 3 Normal \+ 1 MIP passes\./);
 assert.match(p.message(),/Shared group code\. Staff must confirm availability; pickups are not tracked per person\./);
 for(const card of p.container.querySelectorAll('section')){
  const link=card.querySelectorAll('a')[0],message=card.querySelectorAll('textarea')[0].value;
  assert.equal(new URL(link.href).searchParams.get('text'),message);
  assert.equal(link.target,'_blank');assert.equal(link.rel,'noopener noreferrer');
 }
 p.button('Show WhatsApp QR').click();assert.equal(p.document.body.querySelectorAll('dialog')[0].open,true);
 assert.deepEqual(p.externalCalls,[]);
});

test('edit, save, navigation, re-render and auto-advance preserve allocation snapshots',()=>{
 const p=page(),input=json(people);let saved,calls=0;
 const details={...base,recipients:input,saveRecipients:result=>{saved=json(result);calls++;}};
 p.drafts.renderDeposit(p.container,details);
 assert.equal(calls,0,'Rendering must not save contacts');
 input[0].quantities.normal=999; // Caller changes cannot rewrite the captured plan.
 p.button('Edit recipient').click();p.input('text','Updated fixture');p.input('tel','+12025550103');p.flushTimers();
 assert.equal(calls,1);assert.equal(saved[0].name,'Updated fixture');assert.equal(saved[0].phone,'+12025550103');
 assert.deepEqual(saved[0].quantities,people[0].quantities);assert.deepEqual(saved[1].quantities,people[1].quantities);
 p.drafts.clear();p.flush();p.drafts.renderDeposit(p.container,{...details,recipients:saved});
 assert.match(p.message(),/Hi Updated fixture! Your planned share: 1 Normal \+ 2 VIP/);
 p.button('Next recipient').click();assert.match(p.message(),/Your planned share: 3 Normal \+ 1 MIP/);
 assert.deepEqual(p.externalCalls,[]);
});

test('legacy and added contacts stay group-level; removing a recipient never redistributes',()=>{
 const p=page();let saved;
 p.drafts.renderDeposit(p.container,{...base,recipients:people,saveRecipients:result=>saved=json(result)});
 p.button('Add recipient').click();p.input('text','Unallocated fixture');p.input('tel','+12025550104');p.submit();
 assert.doesNotMatch(p.message(),/Your planned share/);assert.match(p.message(),/4 Normal \+ 2 VIP \+ 1 MIP passes for our group/);
 assert(!Object.hasOwn(saved[2],'quantities'));assert.deepEqual(saved.slice(0,2),people);
 p.button('Previous recipient').click();p.button('Remove recipient').click();
 assert.deepEqual(saved,[people[0],{name:'Unallocated fixture',phone:'+12025550104'}]);
 p.drafts.renderDeposit(p.container,{...base,recipients:saved});
 assert.match(p.message(),/Your planned share: 1 Normal \+ 2 VIP/);
 p.button('Next recipient').click();assert.doesNotMatch(p.message(),/Your planned share/);
 const legacy=p.drafts.depositDraft({...base,scope:'group'});assert.doesNotMatch(legacy.message,/Your planned share/);assert.match(legacy.message,/for our group/);
});

test('partial pickups never clamp or guess which recipient has collected',()=>{
 const p=page(),remaining={normal:1,vip:0,vvip:0,mip:0};
 for(const person of people){
  const draft=p.drafts.depositDraft({...base,scope:'group',quantities:remaining,allocation:person.quantities});
  assert.match(draft.message,/Group balance on this receipt: 1 Normal passes\./);
  assert.match(draft.message,/pickups are not tracked per person/);
  assert.match(draft.message,person===people[0]?/planned share: 1 Normal \+ 2 VIP/:/planned share: 3 Normal \+ 1 MIP/);
 }
 assert.deepEqual(remaining,{normal:1,vip:0,vvip:0,mip:0});
 assert.throws(()=>p.drafts.depositDraft({...base,scope:'group',quantities:{normal:0},allocation:people[0].quantities}),/no remaining passes/);
});

test('malformed explicit allocations never become group drafts or disappear when another contact saves',()=>{
 for(const allocation of [null,[],{}, {normal:0},{normal:-1},{normal:1.5},{normal:'2'},{normal:10001}]){
  const p=page();let saved;
  const invalid={...people[0],quantities:allocation};
  assert.throws(()=>p.drafts.depositDraft({...base,scope:'group',allocation}));
  p.drafts.renderDeposit(p.container,{...base,recipients:[invalid,people[1]],saveRecipients:result=>saved=json(result)});
  assert.equal(p.all('textarea').length,0);assert.equal(p.all('a').length,0);
  p.button('Next recipient').click();p.button('Edit recipient').click();p.input('text','Changed');p.submit();
  assert.deepEqual(saved[0],invalid);assert.deepEqual(saved[1].quantities,people[1].quantities);
 }
});

test('invalid edits and closing discard drafts without losing previously saved plans',()=>{
 const p=page();let saved=json(people),calls=0;
 p.drafts.renderDeposit(p.container,{...base,recipients:saved,saveRecipients:result=>{saved=json(result);calls++;}});
 p.button('Edit recipient').click();p.input('tel','bad contact');p.submit();
 assert.equal(calls,0);assert.equal(p.all('a').length,0);assert.equal(p.all('textarea').length,0);
 const [input]=p.all('input');p.drafts.clear();p.flush();assert.equal(input.value,'');
 p.flushTimers();assert.equal(calls,0);
 p.drafts.renderDeposit(p.container,{...base,code:'X9Y2',recipients:saved});
 assert.match(p.message(),/planned share: 1 Normal \+ 2 VIP/);assert.match(p.message(),/X9Y2/);assert.doesNotMatch(p.message(),/K7M4/);
 assert.deepEqual(p.externalCalls,[]);
});

test('web allocated message matches the native fixture text exactly',()=>{
 const p=page();
 assert.equal(p.drafts.depositDraft({...base,scope:'group',name:'Fixture',quantities:{normal:1,vip:0},allocation:{normal:3,vip:2}}).message,
  'Hi Fixture! Your planned share: 3 Normal + 2 VIP passes.\nGroup balance on this receipt: 1 Normal passes. SharePass by Bullseye Entertainment.\n\n'+
  'Use code K7M4 and pickup reference PKT-1234ABCD to collect from Box office.\n\n'+
  'Shared group code. Staff must confirm availability; pickups are not tracked per person.');
});


test('an allocated contact with a missing or invalid phone is retained for repair',()=>{
 for(const phone of ['', 'bad contact']){
  const p=page();let saved;
  const incomplete={...people[0],phone};
  p.drafts.renderDeposit(p.container,{...base,recipients:[incomplete,people[1]],saveRecipients:result=>saved=json(result)});
  assert.equal(p.all('textarea').length,0);
  p.button('Next recipient').click();p.button('Edit recipient').click();p.input('text','Changed');p.submit();
  assert.deepEqual(saved[0],incomplete);
  p.button('Previous recipient').click();p.input('tel','+12025550106');p.submit();
  assert.match(p.message(),/planned share: 1 Normal \+ 2 VIP/);
  assert.deepEqual(saved[0].quantities,people[0].quantities);assert.equal(saved[0].phone,'+12025550106');
 }
});


test('the actual public intake receipt prepares unequal personal plans without a group-balance claim',()=>{
 const p=page(),context=p.context,element=tag=>p.document.createElement(tag);
 Object.assign(context,{
  form:{reset(){},hidden:false},recipientList:element('div'),receipt:element('section'),reference:element('p'),
  receiptShare:element('div'),statusLine:element('p'),receiptState:element('p'),
  booth:true,alertKey:'',requestId:null,lastReceipt:'',lastCode:'',receiptPolls:0,
  scheduleReceiptPoll:()=>context.receiptPolls++,
  result:{status:'confirmed',queue_ref:'FIX123',collection_code:base.code,collection_reference:base.reference,
   booth:base.booth,recipients:json(people)}
 });
 const check=element('button'),sync=element('p');p.document.getElementById=id=>{
  assert(['check-receipt','receipt-sync-status'].includes(id));return id==='check-receipt'?check:sync;
 };
 const source=readFileSync(join(__dirname,'../web/intake.js'),'utf8');
 const start=source.indexOf('function showReceipt(result){'),end=source.indexOf('async function prepareReceiptAlerts(',start);
 assert(start>=0&&end>start,'Execute the production showReceipt function, not a reimplemented call');
 vm.runInContext(source.slice(start,end)+'\nshowReceipt(result);',context);
 let links=context.receiptShare.querySelectorAll('a');assert.equal(links.length,2);
 const messages=links.map(link=>new URL(link.href).searchParams.get('text'));
 assert.match(messages[0],/Hi First fixture! Your planned share: 1 Normal \+ 2 VIP passes\./);
 assert.match(messages[1],/Hi Second fixture! Your planned share: 3 Normal \+ 1 MIP passes\./);
 for(const message of messages){
  assert.doesNotMatch(message,/Group balance|passes for our group|4 Normal/);
  assert.match(message,/Shared group code\. Staff must confirm availability; pickups are not tracked per person\./);
 }
 assert.equal(new URL(links[0].href).pathname,'/12025550101');assert.equal(new URL(links[1].href).pathname,'/12025550102');
 // Rechecking returns original plans again. The public response has no group remaining field.
 vm.runInContext('showReceipt(result);',context);
 links=context.receiptShare.querySelectorAll('a');assert.equal(links.length,2);
 assert.deepEqual(links.map(link=>new URL(link.href).searchParams.get('text')),messages);
 assert.equal(context.receiptPolls,2,'Each visible receipt schedules the automatic status check');
 assert.deepEqual(p.externalCalls,[]);
});

test('default planned-only and explicit group modes are distinct, and unknown scopes fail closed',()=>{
 const p=page(),planned=p.drafts.depositDraft(base).message,group=p.drafts.depositDraft({...base,scope:'group'}).message;
 assert.match(planned,/Your planned share: 4 Normal \+ 2 VIP \+ 1 MIP/);
 assert.doesNotMatch(planned,/Group balance|passes for our group/);
 assert.match(group,/The receipt lists 4 Normal \+ 2 VIP \+ 1 MIP passes for our group\./);
 assert.doesNotMatch(group,/Your planned share/);
 assert.equal(p.drafts.depositDraft({...base,scope:'planned'}).message,planned);
 for(const scope of ['unknown','GROUP','',null,undefined,0,false,{}])assert.throws(()=>p.drafts.depositDraft({...base,scope}),/scope/);
 for(const allocation of [people[0].quantities,null,{},[]])assert.throws(()=>p.drafts.depositDraft({...base,allocation}),/requires group counts/);
});
