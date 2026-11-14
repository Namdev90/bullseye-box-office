'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {runInNewContext}=require('node:vm');
test('collector input belongs to pickup, never to code recovery, with one hold action and no checkbox',()=>{
  const html=readFileSync('web/counter.html','utf8'),form=id=>new RegExp('<form id="'+id+'">([\\s\\S]*?)<\\/form>').exec(html)[1];
  assert.match(form('collect-form'),/name="collector_label"[^>]*required/);assert(!form('collect-form').includes('name_confirmed'));
  assert.equal((form('collect-form').match(/id="hold-handover"/g)||[]).length,1);assert(!form('refresh-code-form').includes('collector_label'));
});
function fixture(){
  let now=0,next=0,confirmed=0,state='Riya:2',ready=true;const tasks=new Map(),events={},pageEvents={};
  const button={textContent:'Hold 2 seconds to confirm',disabled:false,isConnected:true,listeners:{},classList:{add(){},remove(){}},
    replaceChildren(...children){this.children=children;},addEventListener(type,fn){this.listeners[type]=fn;},setAttribute(){},closest(){return this.hidden?{}:null;},focus(){},setPointerCapture(){},getBoundingClientRect:()=>({left:0,top:0,right:100,bottom:50})};
  const document={hidden:false,createElement:()=>({setAttribute(){}}),addEventListener:(type,fn)=>events[type]=fn};
  const window={addEventListener:(type,fn)=>pageEvents[type]=fn};
  runInNewContext(readFileSync('web/hold-confirm.js','utf8'),{window,document,performance:{now:()=>now},setTimeout:fn=>{tasks.set(++next,{at:now+40,fn});return next;},clearTimeout:id=>tasks.delete(id)});
  const status={};const hold=window.sharePassHold(button,{ready:()=>ready,signature:()=>state,confirm:()=>confirmed++,status});
  const fire=(type,data={})=>button.listeners[type]({button:0,pointerId:1,clientX:20,clientY:20,preventDefault(){},...data});
  function advance(time){const target=now+time;for(;;){const found=[...tasks].filter(([,t])=>t.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!found)break;tasks.delete(found[0]);now=found[1].at;found[1].fn();}now=target;}
  return {button,status,document,events,pageEvents,hold,fire,advance,get count(){return confirmed;},set state(value){state=value;},set ready(value){ready=value;}};
}
test('pointer must remain held for two seconds and can complete only once',()=>{
  const p=fixture();p.fire('pointerdown');p.advance(1999);assert.equal(p.count,0);p.fire('pointerup');p.advance(4000);assert.equal(p.count,0);
  p.fire('pointerdown');p.advance(2000);assert.equal(p.count,1);p.fire('pointerup');p.advance(4000);assert.equal(p.count,1);
});
test('leaving target, cancellation, hidden page, lost focus and changed intent cancel the hold',()=>{
  for(const cancel of [p=>p.fire('pointermove',{clientX:101}),p=>p.fire('pointercancel'),p=>p.fire('lostpointercapture'),p=>p.fire('blur'),p=>{p.document.hidden=true;p.events.visibilitychange();},p=>p.pageEvents.blur(),p=>p.state='Omar:1',p=>p.button.disabled=true]){
    const p=fixture();p.fire('pointerdown');p.advance(1900);cancel(p);p.advance(200);assert.equal(p.count,0);p.advance(4000);assert.equal(p.count,0);
  }
});
test('keyboard hold ignores repeat and short taps; ordinary clicks never confirm',()=>{
  const p=fixture();p.fire('click',{detail:1});p.advance(4000);assert.equal(p.count,0);
  p.fire('keydown',{key:' ',repeat:false});p.advance(1200);p.fire('keydown',{key:' ',repeat:true});p.advance(799);p.fire('keyup',{key:' '});assert.equal(p.count,0);
  p.fire('keydown',{key:'Enter',repeat:false});p.advance(2000);assert.equal(p.count,1);p.fire('keyup',{key:'Enter'});p.fire('click',{detail:0});p.advance(3000);assert.equal(p.count,1);
});
test('assistive activation gets a cancellable two-second equivalent and invalid input starts nothing',()=>{
  const p=fixture();p.ready=false;p.fire('click',{detail:0});p.advance(3000);assert.equal(p.count,0);
  p.ready=true;p.fire('click',{detail:0});p.advance(1000);p.fire('click',{detail:0});p.advance(3000);assert.equal(p.count,0);
  p.fire('click',{detail:0});p.advance(1999);assert.equal(p.count,0);p.advance(1);assert.equal(p.count,1);
});
