'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const vm=require('node:vm');

function draftTools(){
 const element=tag=>({tag,attributes:{},children:[],setAttribute(key,value){this.attributes[key]=String(value);},
   append(child){this.children.push(child);}});
 const context=vm.createContext({document:{createElement:element,createElementNS:(_,tag)=>element(tag)}});
 context.window=context;
 for(const file of ['phone.js','vendor/sharepass-qr.js','share-drafts.js']){
  vm.runInContext(readFileSync(join(__dirname,'../web',file),'utf8'),context);
 }
 return {drafts:context.SharePassDrafts,qr:context.SharePassQR};
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
