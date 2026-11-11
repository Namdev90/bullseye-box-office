// Node-only state regressions. These are not a substitute for real browser QA.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {webcrypto} = require('node:crypto');
const path = require('node:path');
async function setup() {
  const nodes = new Map(), timers = [], windowListeners = {};
  class Element {
    constructor() { this.value = ''; this.disabled = false; this.open = false; this.textContent = ''; this.dataset = {}; this.classes = new Set(); this.listeners = {}; this.classList = {contains:x=>this.classes.has(x),add:x=>this.classes.add(x),remove:x=>this.classes.delete(x),toggle:(x,force)=>{const add=force??!this.classes.has(x);add?this.classes.add(x):this.classes.delete(x);}}; }
    set innerHTML(value) { this.html = value; for (const match of value.matchAll(/id="([^"]+)"/g)) nodes.set('#'+match[1],new Element()); }
    get innerHTML() { return this.html || ''; }
    addEventListener(name,fn) { this.listeners[name] = fn; } querySelectorAll() { return []; } setAttribute() {} showModal() {this.open=true;} close() {this.open=false;} reset() {}
    prepend(node) {nodes.set('#'+node.id,node);} remove() {for(const [key,node] of nodes) if(node===this) nodes.delete(key);}
  }
  const html=fs.readFileSync(path.join(__dirname,'../static/index.html'),'utf8');
  for(const match of html.matchAll(/id="([^"]+)"/g)) nodes.set('#'+match[1],new Element());
  for(const key of ['.avatar','main','#operator-form input']) nodes.set(key,new Element());
  const storage=new Map([['staff_name','Demo Operator']]);
  const currentState={event_id:'training-event-001',event_name:'Training',events:[{id:'training-event-001',name:'Training'}],deposits:[],collections:[],audit:[],counts:{},csrf:'csrf-test'};
  const document={hidden:false,visibilityState:'visible',querySelector:key=>nodes.get(key)||null,querySelectorAll:key=>key==='[data-mutation]'?[nodes.get('#save-deposit')]:key==='dialog[open]'?[...nodes.entries()].filter(([key,node])=>key.endsWith('-dialog')&&node.open).map(([,node])=>node):[],createElement:()=>new Element()};
  const context=vm.createContext({document,sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},window:{addEventListener(name,fn){(windowListeners[name]??=[]).push(fn);}},console,crypto:webcrypto,AbortController,setTimeout,clearTimeout,setInterval:(fn,ms)=>timers.push({fn,ms}),fetch:async()=>({ok:true,status:200,json:async()=>currentState})});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../static/app.js'),'utf8'),context);
  await new Promise(resolve=>setImmediate(resolve));
  return {context,timers,windowListeners,nodes,storage,currentState,Element,run:code=>vm.runInContext(code,context)};
}
const deposit=(version=1,pending_collection=null)=>({id:'d',event_id:'training-event-001',packet_id:'PKT-DEMO',location:'A1',created_by:'Demo Operator',created_at:'2026-11-05T00:00:00Z',version,initial:{normal:10,vip:2,vvip:1},remaining:{normal:version>1?8:10,vip:2,vvip:1},pending_collection});
const collection=(version=1,status='RELEASE_RECORDED')=>({id:'c',deposit_id:'d',event_id:'training-event-001',packet_id:'PKT-DEMO',version,status,quantities:{normal:2,vip:0,vvip:0},created_by:'Demo Operator',created_at:'2026-11-05T00:00:00Z',handed_over_by:status==='HANDED_OVER'?'Demo Operator':null});
(async()=>{
  let passed=0;
  async function test(name,action){const s=await setup();await action(s);passed++;console.log('PASS:',name);}
  await test('HTML escaping keeps user inputs inert',({run})=>assert.equal(run(`esc('<img src=x onerror="bad()">')`),'&lt;img src=x onerror=&quot;bad()&quot;&gt;'));
  await test('Lost response retains exact request and blocks new actions',async({context,run,storage,nodes})=>{context.fetch=async()=>{throw Error('lost');};await assert.rejects(run(`mutate('/api/deposits',{request_id:'original',operator:'Demo Operator'})`),/Outcome uncertain/);assert.equal(JSON.parse(storage.get('pending_action')).body.request_id,'original');assert.equal(nodes.get('#new-deposit').disabled,true);assert.equal(nodes.get('#collect-code').disabled,true);});
  await test('Auth failure preserves interrupted request despite HTTP 403',async({context,run,storage})=>{context.fetch=async()=>({ok:false,status:403,json:async()=>({error:'Session changed',not_applied:false})});await assert.rejects(run(`mutate('/api/deposits',{request_id:'original'},true)`),/Outcome uncertain/);assert.equal(JSON.parse(storage.get('pending_action')).body.request_id,'original');});
  await test('Expired uncommitted claim clears saved request for re-verification',async({context,run,storage})=>{context.fetch=async()=>({ok:false,status:409,json:async()=>({error:'Verify code again',not_applied:true})});await assert.rejects(run(`mutate('/api/deposits/d/release',{request_id:'original',claim_token:'expired'},true)`),/Verify code again/);assert.equal(storage.has('pending_action'),false);});
  await test('Fingerprint conflict does not clear uncertain action',async({context,run,storage})=>{context.fetch=async()=>({ok:false,status:409,json:async()=>({error:'Conflict',not_applied:false})});await assert.rejects(run(`mutate('/api/deposits/d/release',{request_id:'original'},true)`));assert.equal(storage.has('pending_action'),true);});
  await test('Recovery storage refuses raw collection code or phone',async({run,storage})=>{await assert.rejects(run(`mutate('/api/verify',{collection_code:'SECRET-CODE'})`),/never enter/);await assert.rejects(run(`mutate('/api/deposits',{phone:'1234567890'})`),/never enter/);assert.equal(storage.has('pending_action'),false);});
  await test('Quantity validation rejects zero, fractional and negative totals',({run})=>{for(const q of [{normal:0,vip:0,vvip:0},{normal:-1,vip:2,vvip:0},{normal:0.5,vip:0,vvip:0},{normal:101,vip:0,vvip:0}])assert.throws(()=>run(`validateQuantities(${JSON.stringify(q)})`));run(`validateQuantities({normal:2,vip:1,vvip:0})`);});
  await test('Disconnected handover replaces physical instructions with a warning',({run,nodes,Element})=>{nodes.set('#packet-live-warning',new Element());nodes.set('#packet-procedure',new Element());run(`viewMode='handover';connection(false)`);assert.equal(nodes.get('#packet-live-warning').classes.has('hidden'),false);assert.equal(nodes.get('#packet-procedure').classes.has('hidden'),true);});
  await test('Pending action also hides physical handover instructions',({run,nodes,Element,storage})=>{nodes.set('#packet-live-warning',new Element());nodes.set('#packet-procedure',new Element());storage.set('pending_action','{"url":"x","body":{}}');run(`viewMode='handover';connection(true)`);assert.equal(nodes.get('#packet-procedure').classes.has('hidden'),true);});
  await test('Newer confirmed collection invalidates open unconfirmed screen',async({run,currentState,nodes})=>{const c=collection(),d=deposit(2,c);run(`showRecord(${JSON.stringify(d)},'handover',${JSON.stringify(c)})`);currentState.deposits=[deposit(3)];currentState.collections=[collection(2,'HANDED_OVER')];await run('refresh()');assert.equal(run('viewMode'),'complete');assert.match(nodes.get('#packet-detail').innerHTML,/Handover confirmed/);assert.doesNotMatch(nodes.get('#packet-detail').innerHTML,/id="handover-form"/);});
  await test('Old refresh cannot downgrade confirmed collection or deposit',async({run,currentState})=>{run(`mergeResult({deposit:${JSON.stringify(deposit(3))},collection:${JSON.stringify(collection(2,'HANDED_OVER'))}})`);currentState.deposits=[deposit(2,collection())];currentState.collections=[collection()];await run('refresh()');assert.equal(run('state.deposits[0].version'),3);assert.equal(run('state.collections[0].status'),'HANDED_OVER');});
  await test('Recovery prefers newer state over earlier release replay',async({context,run,storage,currentState})=>{storage.set('pending_action',JSON.stringify({url:'/api/deposits/d/release',body:{request_id:'original',event_id:'training-event-001'}}));context.fetch=async url=>({ok:true,status:200,json:async()=>url.startsWith('/api/state')?{...currentState,deposits:[deposit(3)],collections:[collection(2,'HANDED_OVER')]}:{deposit:deposit(2,collection()),collection:collection(),replayed:true}});await run('recover()');assert.equal(run('selectedDeposit.version'),3);assert.equal(run('viewMode'),'complete');assert.equal(storage.has('pending_action'),false);});
  await test('Changed deposit revokes verified release form',async({run,currentState,nodes})=>{run(`claim={depositId:'d',version:1,token:'token',expiresAt:Date.now()+120000};showRecord(${JSON.stringify(deposit())},'release')`);assert.equal(run('viewMode'),'release');currentState.deposits=[deposit(2)];await run('refresh()');assert.equal(run('claim'),null);assert.equal(run('viewMode'),'review');assert.doesNotMatch(nodes.get('#packet-detail').innerHTML,/id="release-form"/);});
  await test('Packet inventory review cannot create release form',({run,nodes})=>{run(`showRecord(${JSON.stringify(deposit())})`);assert.equal(run('viewMode'),'review');assert.doesNotMatch(nodes.get('#packet-detail').innerHTML,/id="release-form"/);});
  await test('Code display keeps code out of state and persistent recovery',({run,nodes,storage})=>{run(`displayCode='ABCD-EFGH-JKLM';showRecord(${JSON.stringify(deposit())},'share-code')`);assert.match(nodes.get('#packet-detail').innerHTML,/ABCD-EFGH-JKLM/);assert.doesNotMatch(run('JSON.stringify(state)'),/ABCD-EFGH-JKLM/);assert.equal([...storage.values()].some(v=>v.includes('ABCD-EFGH-JKLM')),false);});
  await test('Closing code display erases bearer code and recipient DOM',({run,nodes})=>{run(`displayCode='ABCD-EFGH-JKLM';showRecord(${JSON.stringify(deposit())},'share-code')`);nodes.get('#packet-dialog').listeners.close();assert.equal(run('displayCode'),'');assert.equal(nodes.get('#packet-detail').innerHTML,'');});
  await test('Code-sharing screen uses private display or speech with no print action',({run,nodes})=>{run(`displayCode='ABCD-EFGH-JKLM';showRecord(${JSON.stringify(deposit())},'share-code')`);const html=nodes.get('#packet-detail').innerHTML;assert.match(html,/Show the code privately or read it quietly/);assert.match(html,/repeat it back/);assert.doesNotMatch(html,/print-receipt|Print private code slip/);});
  await test('Hardware, permission and print APIs remain unused',()=>{const js=['app.js','desk-enhancements.js'].map(name=>fs.readFileSync(path.join(__dirname,'../static',name),'utf8')).join('\n');assert.doesNotMatch(js,/new\s+NDEFReader|getUserMedia\s*\(|navigator\.permissions|window\.print\s*\(/);});
  await test('Insecure emulator origin uses cryptographic UUID v4 fallback',({context,run})=>{
    context.crypto={getRandomValues:array=>{array.fill(255);return array;}};
    assert.equal(run('newRequestId()'),'ffffffff-ffff-4fff-bfff-ffffffffffff');
    context.crypto={getRandomValues:array=>webcrypto.getRandomValues(array)};
    const ids=new Set(Array.from({length:100},()=>run('newRequestId()')));
    assert.equal(ids.size,100);
    for(const id of ids) assert.match(id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  await test('Secure contexts retain native UUID and missing randomness fails closed',({context,run,storage})=>{
    context.crypto={randomUUID:()=> 'native-id'};
    assert.equal(run('newRequestId()'),'native-id');
    context.crypto={};assert.throws(()=>run('newRequestId()'),/No action was sent/);
    context.crypto=undefined;assert.throws(()=>run('newRequestId()'),/No action was sent/);
    assert.equal(storage.has('pending_action'),false);
  });
  await test('All three mutation handlers use the shared request ID helper',()=>{
    const js=fs.readFileSync(path.join(__dirname,'../static/app.js'),'utf8');
    assert.equal((js.match(/request_id:newRequestId\(\)/g)||[]).length,3);
  });
  await test('Only one refresh timer and focus handler; both respect safety and welcome guards',async({context,run,nodes,timers,windowListeners,storage})=>{
    assert.equal(timers.length,1);assert.equal(timers[0].ms,4500);
    assert.equal(windowListeners.focus.length,1);
    let reads=0;context.fetch=async()=>{reads++;return {ok:true,json:async()=>({deposits:[],collections:[],events:[],audit:[],counts:{}})};};
    for(const fn of [timers[0].fn,windowListeners.focus[0]]) {
      reads=0;await fn();assert.equal(reads,1);
      for(const [block,unblock] of [
        [()=>run('busy=true'),()=>run('busy=false')],
        [()=>storage.set('pending_action','{"url":"x","body":{}}'),()=>storage.delete('pending_action')],
        [()=>context.document.visibilityState='hidden',()=>context.document.visibilityState='visible'],
        [()=>nodes.get('#desk-shell').classes.add('hidden'),()=>nodes.get('#desk-shell').classes.delete('hidden')]
      ]) {reads=0;block();await fn();assert.equal(reads,0);unblock();}
    }
  });
  await test('Android Back preserves busy and uncertain requests, then closes dialogs before leaving',({context,run,nodes,storage})=>{
    const back=context.window.SharePassLocalBridge.back;
    const dialog=nodes.get('#packet-dialog');dialog.open=true;
    run('busy=true');assert.equal(back(),true);assert.equal(dialog.open,true);run('busy=false');
    storage.set('pending_action','{"url":"x","body":{}}');assert.equal(back(),true);assert.equal(dialog.open,true);
    storage.delete('pending_action');assert.equal(back(),true);assert.equal(dialog.open,false);
    nodes.get('#desk-shell').classes.add('hidden');assert.equal(back(),false);
  });
  console.log(`${passed} state-machine checks passed. Real-browser layout and behavior remain separate checks.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
