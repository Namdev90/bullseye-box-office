'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const vm=require('node:vm');

function draftTools(globals={}){
 const element=tag=>({tag,attributes:{},children:[],setAttribute(key,value){this.attributes[key]=String(value);},
   append(child){this.children.push(child);}});
 const context=vm.createContext({document:{createElement:element,createElementNS:(_,tag)=>element(tag)},...globals});
 context.window=context;
 for(const file of ['phone.js','vendor/sharepass-qr.js','share-drafts.js']){
  vm.runInContext(readFileSync(join(__dirname,'../web',file),'utf8'),context);
 }
 return {drafts:context.SharePassDrafts,qr:context.SharePassQR};
}

// Minimal synthetic DOM for the real renderDeposit handlers, not browser
// rendering, native focus/keyboard behavior, camera permissions or QR scanning.
function draftPage(){
 const tasks=[],externalCalls=[];
 const document={};
 class Element{
  constructor(tag){this.tag=tag;this.attributes={};this.children=[];this.listeners=new Map();this.hidden=false;this.open=false;}
  setAttribute(key,value){this.attributes[key]=String(value);}
  append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}
  replaceChildren(...children){for(const child of this.children)child.parentElement=null;this.children=[];this.append(...children);}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null;}
  closest(tag){for(let node=this;node;node=node.parentElement)if(node.tag===tag)return node;return null;}
  querySelectorAll(tag){return this.children.flatMap(child=>[...(child.tag===tag?[child]:[]),...child.querySelectorAll(tag)]);}
  addEventListener(type,run,options={}){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push({run,signal:options.signal});}
  dispatch(type){for(const {run,signal} of this.listeners.get(type)||[])if(!signal?.aborted)run({type,target:this});}
  click(){this.dispatch('click');}
  showModal(){this.open=true;}
  close(){if(this.open){this.open=false;tasks.push(()=>this.dispatch('close'));}}
  focus(){document.activeElement=this;}
 }
 document.createElement=tag=>new Element(tag);document.createElementNS=(_,tag)=>new Element(tag);document.body=new Element('body');
 const denied=operation=>()=>{externalCalls.push(operation);throw new Error('Unexpected '+operation+' in offline QR display');};
 const windowEvents=new Element('window');
 const {drafts}=draftTools({document,AbortController,
  addEventListener:windowEvents.addEventListener.bind(windowEvents),
  navigator:{mediaDevices:{getUserMedia:denied('camera')},getUserMedia:denied('legacy camera')},
  fetch:denied('fetch'),XMLHttpRequest:function(){denied('XHR')();},open:denied('external navigation')});
 const container=new Element('div');document.body.append(container);
 const visible=node=>{for(let current=node;current;current=current.parentElement)if(current.hidden)return false;return true;};
 const button=(root,label)=>{
  const matches=root.querySelectorAll('button').filter(node=>visible(node)&&(node.attributes['aria-label']||node.textContent)===label);
  assert.equal(matches.length,1,'Expected one visible button: '+label);return matches[0];
 };
 return {drafts,document,container,button,externalCalls,flush(){while(tasks.length)tasks.shift()();}};
}
const example={name:'Synthetic recipient',phone:'+1 202 555 0101',code:'K7M4',reference:'PKT-1234ABCD',
 eventName:'Concept – Hall & Friends / #2',booth:'Box office',quantities:{normal:1,vip:2}};

test('each recipient gets their own encoded draft with the receipt reference and exact stock',()=>{
 const {drafts}=draftTools();
 const first=drafts.depositDraft(example);
 const second=drafts.depositDraft({...example,name:'Second synthetic recipient',phone:'+1 202 555 0102'});
 assert.notEqual(first.url,second.url);
 for(const draft of [first,second]){
  const url=new URL(draft.url);
  assert.equal(url.origin,'https://wa.me');
  assert.equal(url.pathname,'/'+draft.recipient);
  assert.equal(url.searchParams.size,1);
  assert.equal(url.searchParams.get('text'),draft.message);
  assert.equal(url.hash,'');
  assert.match(draft.message,/Concept – Hall & Friends \/ #2/);
  assert.match(draft.message,/1 Normal \+ 2 VIP/);
  assert.match(draft.message,/K7M4 and pickup reference PKT-1234ABCD/);
  assert(!draft.message.includes('202555010'));
 }
});
test('invalid contacts, references, counts and oversized labels cannot create draft URLs',()=>{
 const {drafts}=draftTools();
 for(const patch of [{phone:'https://example.test'},{code:'k7m4'},{reference:'PKT-OLD'},{name:'x'.repeat(81)},
   {booth:''},{eventName:'x'.repeat(101)},{quantities:{normal:0}},{quantities:{normal:-1}}]){
  assert.throws(()=>drafts.depositDraft({...example,...patch}));
 }
});
test('offline QR includes a four-module quiet zone and an accessible label',()=>{
 const {drafts,qr}=draftTools();
 const draft=drafts.depositDraft(example);
 const matrix=qr.matrix(draft.url);
 assert(matrix.length>=21&&matrix.every(row=>row.length===matrix.length));
 const image=drafts.qrImage(draft.url,'Private WhatsApp QR');
 assert.equal(image.attributes['aria-label'],'Private WhatsApp QR');
 assert.equal(image.attributes.viewBox,'0 0 '+(matrix.length+8)+' '+(matrix.length+8));
 assert.equal(image.children[0].attributes.fill,'#fff');
 assert.equal(image.children[1].attributes.fill,'#000');
 assert.match(image.children[1].attributes.d,/^M4 4/);
});

test('Show WhatsApp QR opens the named recipient draft, navigates privately and closes without camera access',()=>{
 const p=draftPage();
 const recipients=[{name:'First synthetic recipient',phone:'+1 202 555 0101'},
  {name:'Second synthetic recipient',phone:'+1 202 555 0102'}];
 p.drafts.renderDeposit(p.container,{...example,recipients});
 const [dialog]=p.document.body.querySelectorAll('dialog');
 assert.equal(dialog.attributes['aria-label'],'Private collection QR');
 assert.equal(dialog.open,false);
 function expectRecipient(index){
  assert.equal(dialog.open,true);
  const images=dialog.querySelectorAll('svg');assert.equal(images.length,1);
  const label='Private WhatsApp QR for '+recipients[index].name;
  assert.equal(images[0].attributes.role,'img');
  assert.equal(images[0].attributes['aria-label'],label);
  const expected=p.drafts.qrImage(p.drafts.depositDraft({...example,...recipients[index]}).url,label);
  assert.equal(images[0].querySelectorAll('path')[0].attributes.d,expected.querySelectorAll('path')[0].attributes.d);
  assert.equal(dialog.querySelectorAll('p')[0].textContent,'WhatsApp · '+recipients[index].name);
 }
 p.button(p.container,'Show WhatsApp QR').click();expectRecipient(0);
 p.button(dialog,'Next recipient').click();expectRecipient(1);
 p.button(dialog,'Next recipient').click();expectRecipient(0);
 p.button(dialog,'Previous recipient').click();expectRecipient(1);
 p.button(dialog,'Previous recipient').click();expectRecipient(0);
 p.button(dialog,'Close QR').click();p.flush();
 assert.equal(dialog.open,false);assert.equal(dialog.children.length,0);

 // Reopen from the second recipient's own card rather than stale dialog state.
 p.button(p.container,'Next recipient').click();
 const secondTile=p.button(p.container,'Show WhatsApp QR');
 secondTile.click();expectRecipient(1);
 dialog.close();p.flush();
 assert.equal(dialog.open,false);assert.equal(dialog.children.length,0);
 p.drafts.clear();p.flush();
 assert.equal(p.document.body.querySelectorAll('dialog').length,0);
 assert.equal(p.container.children.length,0);
 secondTile.click(); // Aborted listeners cannot reopen a retired private QR.
 assert.equal(dialog.open,false);assert.equal(dialog.children.length,0);
 assert.deepEqual(p.externalCalls,[]);
});
