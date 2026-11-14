'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {runInNewContext}=require('node:vm');
const decode=require('../web/vendor/jsQR.js');

test('vendored scanner decodes the existing receipt QR including leading zeroes',()=>{
  const window={};runInNewContext(readFileSync('web/vendor/sharepass-qr.js','utf8'),{window});
  const link='https://sharepass.example.test/pickup#0007.PKT-A1B2C3D4',matrix=window.SharePassQR.matrix(link),scale=6,size=(matrix.length+8)*scale;
  const pixels=new Uint8ClampedArray(size*size*4).fill(255);
  matrix.forEach((row,y)=>row.forEach((dark,x)=>{if(dark)for(let dy=0;dy<scale;dy++)for(let dx=0;dx<scale;dx++){const at=(((y+4)*scale+dy)*size+(x+4)*scale+dx)*4;pixels[at]=pixels[at+1]=pixels[at+2]=0;}}));
  assert.equal(decode(pixels,size,size).data,link);
});

function page({getUserMedia=async stream=>stream,decode=()=>null,muted=false}={}){
  const timers=new Map(),frames=new Map(),events={},nodes=[];let next=0,stops=0,requests=0,camera=0;
  const stream={getTracks:()=>[{stop(){stops++;}}]};
  class Node{
    constructor(tag){this.tag=tag;this.children=[];this.listeners={};this.value='';this.videoWidth=640;this.videoHeight=480;}
    setAttribute(key,value){this[key]=value;}
    append(...children){this.children.push(...children);}
    insertBefore(child){this.children.push(child);}
    addEventListener(type,action){this.listeners[type]=action;}
    dispatchEvent(event){this.listeners[event.type]?.(event);}
    querySelector(){return {};}
    closest(){return this.hidden?{}:null;}
    requestSubmit(){requests++;this.listeners.submit?.();}
    focus(){document.activeElement=this;}showModal(){this.open=true;}remove(){this.removed=true;}
    contains(target){return target===this||Object.values(this.elements||{}).includes(target)||this.children.some(child=>child.contains?.(target));}
    play(){return Promise.resolve();}
    getContext(){return {drawImage(){},getImageData(){return {data:new Uint8ClampedArray(4),width:1,height:1};}};}
  }
  const forms=[new Node('form'),new Node('form')];for(const form of forms)form.elements={code:new Node('input'),reference:new Node('input')};
  const document={currentScript:{src:'https://sharepass.example.test/collect-tools.js?v=37'},hidden:false,
    createElement:tag=>{const node=new Node(tag);nodes.push(node);return node;},head:new Node('head'),body:new Node('body'),querySelectorAll:()=>forms,addEventListener:(type,action)=>events[type]=action};
  let spoken=0;
  const window={jsQR:decode,sharePassSoundEnabled:()=>!muted,speechSynthesis:{cancel(){},speak(){spoken++;}},addEventListener:(type,action)=>events[type]=action};
  const byId=()=>new Node('div');
  runInNewContext(readFileSync('web/collect-tools.js','utf8'),{window,document,URL,navigator:{mediaDevices:{getUserMedia:()=>{camera++;return getUserMedia===undefined?Promise.resolve(stream):getUserMedia(stream);}}},
    SharePassDrafts:{scanReceipt:value=>{if(value!=='valid')throw Error('Invalid receipt');return {code:'0007',reference:'PKT-A1B2C3D4'};}},
    Event:class{constructor(type){this.type=type;}},SpeechSynthesisUtterance:class{},speechSynthesis:window.speechSynthesis,performance:{now:()=>1000},busy:false,perform:async action=>action(),openLookup:code=>{forms[1].elements.code.value=code;},lookupForm:forms[1],byId,
    findPasses:async()=>{requests++;},setTimeout:action=>{timers.set(++next,action);return next;},clearTimeout:id=>timers.delete(id),requestAnimationFrame:action=>{frames.set(++next,action);return next;},cancelAnimationFrame:id=>frames.delete(id)});
  return {forms,nodes,events,timers,frames,document,get spoken(){return spoken;},get camera(){return camera;},get stops(){return stops;},get requests(){return requests;},scan:()=>forms[0].children[0].children[0].onclick()};
}

test('keypad retains zeroes, automatically verifies four digits once and ignores hidden views',()=>{
  const p=page(),keys=p.forms[0].children[1].children;
  for(const digit of '0007')keys.find(key=>key.textContent===digit).onclick();
  assert.equal(p.forms[0].elements.code.value,'0007');assert.equal(p.timers.size,1);
  [...p.timers.values()][0]();assert.equal(p.requests,1);
  keys.find(key=>key.textContent==='⌫').onclick();assert.equal(p.forms[0].elements.code.value,'000');assert.equal(p.timers.size,0);
  keys.find(key=>key.textContent==='7').onclick();p.forms[0].hidden=true;[...p.timers.values()][0]();assert.equal(p.requests,1);assert.equal(p.camera,0);
});

test('one lookup timer owns both code fields; muted keypad never speaks',()=>{
  const wiring=readFileSync('web/counter.js','utf8').split("const inlineLookup=byId('desk-code-form');")[1].split("byId('select-all-passes')")[0];
  assert(!wiring.includes('sharePassAutoAdvance'),'An additional debounce consumes the failed-code allowance twice');
  const p=page({muted:true}),keys=p.forms[0].children[1].children;
  for(const digit of '9999')keys.find(key=>key.textContent===digit).onclick();
  assert.equal(p.spoken,0);for(const action of [...p.timers.values()])action();assert.equal(p.requests,1);assert.equal(p.timers.size,0);
  const audible=page();audible.forms[0].children[1].children[0].onclick();assert.equal(audible.spoken,1);
});

test('camera is explicit, stops after decode/background/cancel, and only verifies a valid receipt',async()=>{
  const p=page({getUserMedia:async stream=>stream,decode:()=>({data:'valid'})});assert.equal(p.camera,0);
  await p.scan();assert.equal(p.camera,1);await [...p.frames.values()][0](200);
  assert.equal(p.requests,1);assert.equal(p.forms[1].elements.code.value,'0007');assert.equal(p.stops,1);
  const q=page({getUserMedia:async stream=>stream});await q.scan();q.document.hidden=true;q.events.visibilitychange();assert.equal(q.stops,1);
});

test('permission denial and a late camera grant never verify or leave the camera running',async()=>{
  const denied=page({getUserMedia:async()=>{const error=Error('Denied');error.name='NotAllowedError';throw error;}});await denied.scan();
  assert.equal(denied.requests,0);assert(denied.nodes.some(node=>node.textContent?.includes('Camera access is off')));
  let grant;const late=page({getUserMedia:stream=>new Promise(resolve=>{grant=()=>resolve(stream);})});const waiting=late.scan();
  late.nodes.find(node=>node.textContent==='Cancel scanner').onclick();grant();await waiting;assert.equal(late.stops,1);assert.equal(late.requests,0);
});
