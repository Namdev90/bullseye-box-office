import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../web/counter.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../web/counter.html',import.meta.url),'utf8');
const path='/api/staff-messages/reply';
const context={session_key:'synthetic',staff_label:'Synthetic staff',booth_url:'/booth/11111111-1111-4111-8111-111111111111'};
const messages=['first','second','third'].map(id=>({id,message:id}));
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {resolve,promise};};
// Complete script, real registered handlers; synthetic DOM/transport, not a browser.
async function page({storage=new Map(),send=async()=>Response.json({replied:true})}={}){
  const nodes=new Map(),calls=[],pending=[...messages];
  class Node{
    constructor(id){this.id=id;this.value='';this.hidden=false;this.open=false;this.children=[];this.textContent='';this.dataset={};this.listeners={};this.selectedOptions=[{textContent:'1 day'}];this.classList={add(){},toggle(){}};this.fields=new Map();this.elements=new Proxy({},{get:(_,k)=>{if(!this.fields.has(k))this.fields.set(k,new Node(id+'-'+k));return this.fields.get(k);}});}
    addEventListener(k,fn){this.listeners[k]=fn;} focus(){} append(...x){this.children.push(...x);} replaceChildren(...x){this.children=x;} querySelector(){return new Node('child');} querySelectorAll(s){return this.id==='staff-message'?(s==='[data-staff-reply]'?replies:[...replies,node('staff-message-next'),node('staff-message-later')]):[];} reset(){} showModal(){this.open=true;} close(){this.open=false;this.listeners.close?.();}
  }
  const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
  const node=id=>{assert(ids.has(id),id);if(!nodes.has(id))nodes.set(id,new Node(id));return nodes.get(id);};
  const replies=[...html.matchAll(/data-staff-reply="([^"]+)"/g)].map(m=>{const n=new Node(m[1]);n.dataset.staffReply=m[1];return n;});
  const document={getElementById:node,hidden:false,querySelector:()=>node('staff-message').open?node('staff-message'):null,querySelectorAll:s=>s==='[data-staff-reply]'?replies:[],createElement:t=>new Node(t),addEventListener(){}};
  const sandbox={document,window:{sharePassHold:()=>({cancel(){},setLabel(){}}),SharePassDrafts:{clear(){},qrImage:()=>new Node('qr')},addEventListener(){}},navigator:{},crypto,AbortSignal,URL,location:{origin:'https://synthetic.test'},getComputedStyle:()=>({getPropertyValue:()=>''}),setTimeout:()=>0,clearTimeout(){},sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},DemoStore:class{passTypes=[];},sharePassSteps:()=>({show(){}}),sharePassAutoAdvance(){},fetch:async(p,init={})=>{
    const body=init.body?JSON.parse(init.body):undefined;calls.push({path:p,body});
    if(p==='/api/context')return Response.json(context);
    if(p==='/api/queue')return Response.json({drafts:[],messages:pending});
    if(p==='/api/state')return Response.json({deposits:[]});
    return send(p,body,pending);
  }};
  runInNewContext(source+'\nglobalThis.api={ready,show,request,recover,refresh:()=>refreshQueue(++queueView),state:()=>({recovery,view,replying,staffMessages})};',sandbox);
  const settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};await settle();
  const click=async id=>{await node(id).onclick();await settle();};
  const reply=async value=>{await replies.find(b=>b.dataset.staffReply===value).onclick();await settle();};
  return {node,replies,storage,calls,pending,api:sandbox.api,click,reply,settle};
}
test('Later, Escape, manual reopen and Next reach every deferred message without replying',async()=>{
  const p=await page();assert.equal(p.node('staff-message-text').textContent,'first');
  await p.click('staff-message-later');await p.api.refresh();assert.equal(p.node('staff-message-text').textContent,'second');
  let cancelled=false;p.node('staff-message').listeners.cancel({preventDefault(){cancelled=true;}});assert.equal(cancelled,false);p.node('staff-message').close();
  await p.api.refresh();await p.click('staff-message-later');await p.api.refresh();assert.equal(p.node('staff-message').open,false);
  await p.click('staff-message-open');assert.equal(p.node('staff-message-text').textContent,'first');
  await p.click('staff-message-next');assert.equal(p.node('staff-message-text').textContent,'second');
  await p.click('staff-message-next');assert.equal(p.node('staff-message-text').textContent,'third');
  assert.equal(p.calls.filter(c=>c.path===path).length,0);assert.equal(p.storage.size,0);
});
test('lost reply retains same-choice retry, blocks duplicate clicks, and never writes custody journal',async()=>{
  const waiting=gate();let n=0;
  const p=await page({send:async()=>{if(++n===1){await waiting.promise;throw Error('Lost response');}return Response.json({replied:true});}});
  const first=p.reply('help');await p.reply('done');await p.click('staff-message-later');await p.click('staff-message-next');
  let prevented=false;p.node('staff-message').listeners.cancel({preventDefault(){prevented=true;}});assert(prevented);
  assert.equal(n,1);assert.equal(p.node('staff-message').open,true);waiting.resolve();await first;
  assert.equal(p.storage.size,0);assert.match(p.node('staff-message-status').textContent,/not confirmed/);
  await p.reply('done');assert.equal(n,1);await p.click('staff-message-later');
  for(let i=0;i<3;i++)await p.click(i?'staff-message-next':'staff-message-open');
  assert.equal(p.node('staff-message-text').textContent,'first');await p.reply('help');assert.equal(n,2);
  assert(p.calls.filter(c=>c.path===path).every(c=>c.body.reply==='help'));
});
test('existing custody journal survives successful and failed independent replies',async()=>{
  for(const failed of [false,true]){
    const action={path:'/api/deposits',body:{request_id:'custody'}},raw=JSON.stringify(action),storage=new Map([['sharepass-pending:synthetic',raw]]);
    const p=await page({storage,send:async()=>{if(failed)throw Error('offline');return Response.json({replied:true});}});
    assert.equal(p.node('staff-message').open,false);await p.click('staff-message-open');await p.reply('working');
    assert.equal(storage.get('sharepass-pending:synthetic'),raw);assert.equal(p.api.state().recovery.path,action.path);
    assert.throws(()=>p.api.request('/api/deposits',{}),/Recover/);
  }
});
test('only exact legacy reply journal is discarded, without replay or balance rendering',async()=>{
  const storage=new Map([['sharepass-pending:synthetic',JSON.stringify({path,body:{id:'first',reply:'done'}})],['sharepass-pending:other','untouched']]);
  const p=await page({storage});assert.equal(p.api.state().recovery,null);assert.equal(storage.size,1);assert.equal(storage.get('sharepass-pending:other'),'untouched');
  assert.equal(p.calls.filter(c=>c.path===path).length,0);assert.equal(p.api.state().view,'desk');
  assert.equal(p.replies.find(b=>b.dataset.staffReply==='help').disabled,true);
  await p.reply('help');assert.equal(p.calls.filter(c=>c.path===path).length,0);
});
test('definitive errors allow choosing again; conflict refreshes rather than falsely marking a reply',async()=>{
  let conflict=false;
  const p=await page({send:async()=>Response.json({error:'Rejected',notExecuted:true},{status:conflict?409:400})});
  await p.reply('done');assert.equal(p.node('staff-message-status').textContent,'Rejected');assert(p.replies.every(b=>!b.disabled));
  conflict=true;await p.reply('help');assert.equal(p.storage.size,0);assert.equal(p.api.state().staffMessages.length,3);
});
for(const fail of [false,true])test('late reply '+(fail?'failure':'success')+' cannot overwrite navigation or another staff session',async()=>{
  for(const changeSession of [false,true]){
    const waiting=gate();const p=await page({send:async()=>{await waiting.promise;if(fail)throw Error('offline');return Response.json({replied:true});}});
    const responding=p.reply('done');
    if(changeSession)p.api.ready({...context,session_key:'other'});else p.api.show('guide');
    await p.settle();p.node('staff-message-status').textContent='New view';const queueCalls=p.calls.filter(c=>c.path==='/api/queue').length;
    waiting.resolve();await responding;
    assert.equal(p.api.state().view,changeSession?'desk':'guide');assert.equal(p.node('staff-message-status').textContent,'New view');
    assert.equal(p.calls.filter(c=>c.path==='/api/queue').length,queueCalls);assert.equal(p.storage.size,0);
  }
});
test('committed reply with lost response retries identically without a second write or blocking stock',async()=>{
  let committed,mutations=0,lose=true;
  const p=await page({send:async(endpoint,body,pending)=>{
    if(endpoint!==path)return Response.json({stock:true});
    if(!committed){committed=body.reply;mutations++;pending.splice(pending.findIndex(m=>m.id===body.id),1);}
    if(lose){lose=false;throw Error('Committed response lost');}
    return Response.json({replied:true});
  }});
  await p.reply('done');assert.equal(mutations,1);assert.equal(p.api.state().recovery,null);
  assert.equal((await p.api.request('/api/deposits',{request_id:'synthetic-stock'})).stock,true);
  await p.reply('done');assert.equal(mutations,1);assert.equal(p.storage.size,0);
  assert.deepEqual(p.calls.filter(c=>c.path===path).map(c=>c.body.reply),['done','done']);
});
for(const status of [401,403,500])test('reply error '+status+' preserves stock access and offers safe retry',async()=>{
  const p=await page({send:async()=>Response.json({error:'Unavailable',notExecuted:status!==500},{status})});
  await p.reply('help');assert.equal(p.api.state().recovery,null);assert.equal(p.storage.size,0);
  assert.equal(p.node('staff-message').open,true);assert.equal(p.node('staff-message-later').disabled,false);
  await p.click('staff-message-later');assert.equal(p.node('staff-message').open,false);
});
test('reloading a legacy journal never sends the reply, even if its transport would fail',async()=>{
  for(const status of [200,409,401,'network']){
    const storage=new Map([['sharepass-pending:synthetic',JSON.stringify({path,body:{id:'first',reply:'help'}})]]);
    const p=await page({storage,send:async()=>{if(status==='network')throw Error('Offline');return Response.json(status===200?{replied:true}:{error:'Rejected'},{status});}});
    assert.equal(storage.size,0);assert.equal(p.calls.filter(c=>c.path===path).length,0);assert.equal(p.api.state().view,'desk');
  }
});

test('expired unanswered message is not described as a different reply',async()=>{
  const p=await page({send:async()=>Response.json({error:'This message was answered or expired. Refresh the desk.',notExecuted:true},{status:409})});
  await p.reply('done');assert.match(p.node('error').textContent,/already answered or expired/);
  assert.match(p.node('error').textContent,/no new reply was confirmed/);
  assert.equal(p.api.state().staffMessages.length,3);assert.equal(p.storage.size,0);
});
