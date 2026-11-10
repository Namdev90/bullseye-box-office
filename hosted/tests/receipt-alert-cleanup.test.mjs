import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
const source=readFileSync('web/intake.js','utf8');
const cleanup=source.slice(source.indexOf('async function cleanupReceiptAlerts('),source.indexOf('async function receiptAlertLock('));
async function fixture(count=1){
  const records=new Map(),registrations=new Map(),items=[],calls=[],effects=[],busy=new Set(),storage=new Map();
  for(let i=0;i<count;i++){
    const ticket=crypto.randomUUID(),booth=crypto.randomUUID();
    const scope='https://test.example/receipt-alerts/'+Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(ticket))).toString('hex')+'/';
    const item={ticket,booth,scope,status:{enabled:false},proof:JSON.stringify({path:'/booth/'+booth+'#receipt='+ticket,expiresAt:1})};
    item.subscription={endpoint:'https://push.example/synthetic/'+i,unsubscribe:async()=>{effects.push(['unsubscribe',scope]);item.current=null;await item.afterUnsubscribe?.();return true;}};
    item.current=item.subscription;
    item.registration={scope,pushManager:{getSubscription:async()=>item.current},unregister:async()=>{effects.push(['unregister',scope]);registrations.delete(scope);await item.afterUnregister?.();return true;}};
    registrations.set(scope,item.registration);records.set(scope,item.proof);items.push(item);
  }
  const cache={keys:async()=>[...records.keys()].map(url=>({url})),match:async scope=>records.has(scope)?new Response(records.get(scope)):undefined,
    delete:async scope=>{await items.find(item=>item.scope===scope)?.beforeDelete?.();effects.push(['delete',scope]);return records.delete(scope);},put:async(scope,response)=>{const item=items.find(item=>item.scope===scope);await item.beforePut?.();records.set(scope,await response.text());await item.afterPut?.();}};
  const context={Response,AbortSignal,TextEncoder,Uint8Array,crypto:webcrypto,Math,JSON,
    navigator:{serviceWorker:{},locks:{request:async(name,options,fn)=>{assert.deepEqual({...options},{ifAvailable:true});return fn(busy.has(name)?null:{});}}},
    window:{caches:{}},location:{origin:'https://test.example'},caches:{open:async()=>cache},
    localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},
    receiptWorkerAt:async scope=>registrations.get(scope)||null,
    fetch:async(url,options)=>{
      const body=JSON.parse(options.body);calls.push(body);
      const item=items.find(item=>item.ticket===body.ticket);
      assert.equal(url,'/api/public/booth/'+item.booth+'/alerts');assert.equal(body.action,'status');
      assert.equal(body.endpoint,item.expectedEndpoint||item.subscription.endpoint);assert.equal(options.cache,'no-store');assert.equal(options.credentials,'same-origin');
      await item.onStatus?.();return item.response||Response.json(item.status);
    }};
  runInNewContext(`let alertScope,requestId,receiptCleanupCursor;const alertCacheName='sharepass-receipt-alerts';${cleanup}
    globalThis.cleanup=cleanupReceiptAlerts;globalThis.reload=()=>{receiptCleanupCursor=undefined;};globalThis.select=item=>{alertScope=item.scope;requestId=item.ticket;};`,context);
  return {context,items,records,registrations,calls,effects,busy,storage};
}
test('inactive unattended receipt is cleaned using its own booth, not the visible booth',async()=>{
  const f=await fixture(2);f.context.select(f.items[1]);await f.context.cleanup();
  assert.deepEqual(f.effects.map(e=>e[0]),['unsubscribe','unregister','delete']);
  assert(!f.records.has(f.items[0].scope));assert(f.records.has(f.items[1].scope));assert.equal(f.calls.length,1);
});
test('extended live consent survives stale local expiry without automatic enable or proof data',async()=>{
  const f=await fixture();f.items[0].status={enabled:true,expires_at:Date.now()+172800000};await f.context.cleanup();
  assert.equal(f.effects.length,0);assert.equal(f.records.get(f.items[0].scope),f.items[0].proof);
});
test('offline, HTTP error and malformed or ambiguous status preserve all resources',async t=>{
  for(const mode of ['offline','http','json','null','missing','expired-true'])await t.test(mode,async()=>{
    const f=await fixture(),item=f.items[0];
    if(mode==='offline')item.onStatus=()=>{throw Error('offline');};
    if(mode==='http')item.response=new Response('',{status:503});
    if(mode==='json')item.response=new Response('not json');
    if(mode==='null')item.status=null;
    if(mode==='missing')item.status={};
    if(mode==='expired-true')item.status={enabled:true,expires_at:1};
    await f.context.cleanup();assert.equal(f.effects.length,0);assert(f.records.has(item.scope));
  });
});
test('missing locks and busy Stop/enable/push locks are nondestructive and never wait',async()=>{
  const f=await fixture();f.busy.add('sharepass-receipt:'+f.items[0].scope);await f.context.cleanup();
  assert.equal(f.calls.length,0);delete f.context.navigator.locks;await f.context.cleanup();assert.equal(f.effects.length,0);
});
test('invalid cache identity never triggers network or browser cleanup',async t=>{
  for(const mode of ['json','null','wrong-ticket','other-origin','extra-path','query','wrong-booth','missing-registration','missing-subscription'])await t.test(mode,async()=>{
    const f=await fixture(),item=f.items[0];
    if(mode==='json')f.records.set(item.scope,'bad');
    if(mode==='null')f.records.set(item.scope,'null');
    if(mode==='wrong-ticket')f.records.set(item.scope,JSON.stringify({path:'/booth/'+item.booth+'#receipt='+crypto.randomUUID()}));
    if(mode==='wrong-booth')f.records.set(item.scope,JSON.stringify({path:'/intake/'+item.booth+'#receipt='+item.ticket}));
    if(['other-origin','extra-path','query'].includes(mode)){
      f.records.delete(item.scope);f.records.set(mode==='other-origin'?item.scope.replace('test.example','elsewhere.example'):mode==='query'?item.scope+'?x':item.scope.replace('/receipt-alerts/','/receipt-alerts/extra/'),item.proof);
    }
    if(mode==='missing-registration')f.registrations.clear();
    if(mode==='missing-subscription')item.current=null;
    await f.context.cleanup();assert.equal(f.calls.length,0);assert.equal(f.effects.length,0);
  });
});
test('Stop, enable, navigation and browser replacement during status cannot destroy newer proof/resources',async t=>{
  for(const mode of ['stop','renew','replacement-subscription','replacement-worker','navigation'])await t.test(mode,async()=>{
    const f=await fixture(),item=f.items[0];item.onStatus=()=>{
      if(mode==='stop')f.records.delete(item.scope);
      if(mode==='renew')f.records.set(item.scope,JSON.stringify({path:JSON.parse(item.proof).path,expiresAt:Date.now()+172800000}));
      if(mode==='replacement-subscription')item.current={endpoint:'https://push.example/replacement'};
      if(mode==='replacement-worker')f.registrations.set(item.scope,{scope:item.scope});
      if(mode==='navigation')f.context.select(item);
    };
    await f.context.cleanup();assert.equal(f.effects.length,0);
  });
});
test('replacement after unsubscribe or unregister survives, and failed unsubscribe preserves proof',async t=>{
  for(const mode of ['unsubscribe-replacement','unsubscribe-renew','unregister-replacement','unsubscribe-false'])await t.test(mode,async()=>{
    const f=await fixture(),item=f.items[0];
    if(mode==='unsubscribe-replacement')item.afterUnsubscribe=()=>{item.current={endpoint:'https://push.example/replacement'};};
    if(mode==='unsubscribe-renew')item.afterUnsubscribe=()=>{f.records.set(item.scope,'new-proof');};
    if(mode==='unregister-replacement')item.afterUnregister=()=>{f.registrations.set(item.scope,{scope:item.scope});};
    if(mode==='unsubscribe-false')item.subscription.unsubscribe=async()=>false;
    await f.context.cleanup();assert(f.records.has(item.scope));assert(!f.effects.some(e=>e[0]==='delete'));
    if(mode!=='unregister-replacement')assert(!f.effects.some(e=>e[0]==='unregister'));
  });
});
test('sixteen-record work bound makes persistent progress past live or busy records',async()=>{
  const f=await fixture(40);for(const item of f.items)item.status={enabled:true,expires_at:Date.now()+100000};
  await f.context.cleanup();assert.equal(f.calls.length,16);
  f.context.reload();await f.context.cleanup();assert.equal(f.calls.length,32);
  f.context.reload();await f.context.cleanup();assert.equal(f.calls.length,48);
  assert.equal(new Set(f.calls.map(c=>c.ticket)).size,40);assert.equal(f.effects.length,0);
  assert(![...f.storage.values()].some(value=>value.includes('push.example')));
});
test('maintenance is fire-and-forget and never changes visible receipt controls',async()=>{
  assert.match(source,/setTimeout\(\(\)=>\{cleanupReceiptAlerts\(\)\.catch\(\(\)=>\{\}\);\},0\)/);
  assert(!/alertButton|alertStatus|alertsEnabled|prepareReceiptAlerts|register\(/.test(cleanup.replace('unregister(','')));
  const f=await fixture();let release;f.items[0].onStatus=()=>new Promise(resolve=>{release=resolve;});
  const pending=f.context.cleanup();while(!release)await new Promise(resolve=>setImmediate(resolve));
  f.context.select(f.items[0]);release();await pending;assert.equal(f.effects.length,0);
});

test('busy and malformed first batch advances past it on reload',async()=>{
  const f=await fixture(20),ordered=[...f.items].sort((a,b)=>a.scope<b.scope?-1:1);
  for(const [i,item] of ordered.slice(0,16).entries()){
    if(i%2)f.records.set(item.scope,'invalid');else f.busy.add('sharepass-receipt:'+item.scope);
  }
  await f.context.cleanup();assert.equal(f.calls.length,0);
  f.context.reload();await f.context.cleanup();assert.equal(f.calls.length,4);
  for(const item of ordered.slice(0,16))assert(f.records.has(item.scope));
});
test('unsubscribe or unregister failure preserves recovery proof and later records progress',async t=>{
  for(const mode of ['unsubscribe','unregister','unregister-false'])await t.test(mode,async()=>{
    const f=await fixture(2),item=f.items[0];
    if(mode==='unsubscribe')item.subscription.unsubscribe=async()=>{throw Error('uncertain');};
    else item.registration.unregister=async()=>{if(mode==='unregister')throw Error('uncertain');return false;};
    await f.context.cleanup();assert(f.records.has(item.scope));assert(!f.records.has(f.items[1].scope));
  });
});

test('inactive worker and current page retain the index until unattended cleanup completes',async()=>{
  const f=await fixture(),item=f.items[0],handlers={};
  const worker={...f.context,self:{registration:item.registration,navigator:{locks:{request:async(name,action)=>action()}},Notification:{permission:'granted'},
    addEventListener:(type,fn)=>{handlers[type]=fn;},clients:{matchAll:()=>{throw Error('No inactive message');},openWindow:()=>{throw Error('No inactive navigation');}}}};
  item.registration.showNotification=()=>{throw Error('No inactive notification');};
  runInNewContext(readFileSync('web/receipt-alert-worker.js','utf8'),worker);
  let pending;handlers.push({waitUntil:promise=>{pending=promise;}});await pending;
  assert.equal(f.records.get(item.scope),item.proof);
  f.context.Notification={permission:'granted'};f.context.alertButton={};f.context.initialTicket=item.ticket;
  f.context.location.pathname='/booth/'+item.booth;
  f.context.saveReceiptAlerts=(action,subscription,ticket)=>f.context.fetch('/api/public/booth/'+item.booth+'/alerts',{
    cache:'no-store',credentials:'same-origin',body:JSON.stringify({action,ticket,endpoint:subscription.endpoint})}).then(response=>response.json());
  const prepare=source.slice(source.indexOf('async function prepareReceiptAlerts('),source.indexOf('async function receiptWorkerAt('));
  runInNewContext(`let alertRevision=0,alertsEnabled=true,lastReceipt='confirmed';requestId=initialTicket;
    async function receiptAlertLock(scope,action){return action(true);}${prepare}
    globalThis.prepare=()=>prepareReceiptAlerts(requestId);`,f.context);
  await f.context.prepare();assert.equal(f.context.alertButton.textContent,'Enable receipt alerts');
  assert.equal(f.records.get(item.scope),item.proof);
  f.context.select({});await f.context.cleanup();
  assert.equal(f.records.has(item.scope),false);assert.equal(f.registrations.has(item.scope),false);
  assert.deepEqual(f.effects.map(e=>e[0]),['unsubscribe','unregister','delete']);
});

test('durable marker retries failed unregister across reload without another subscription/status',async t=>{
  for(const mode of ['false','throw'])await t.test(mode,async()=>{
    const f=await fixture(),item=f.items[0],unregister=item.registration.unregister;let attempts=0;
    item.registration.unregister=async()=>{attempts++;if(mode==='throw')throw Error('interrupted');return false;};
    await f.context.cleanup();assert.equal(item.current,null);
    const marker=JSON.parse(f.records.get(item.scope));assert.equal(marker.cleanupPending,true);
    assert.deepEqual(Object.keys(marker).sort(),['cleanupPending','expiresAt','path']);
    assert(!JSON.stringify(marker).includes('push.example'));
    f.context.reload();await f.context.cleanup();assert.equal(attempts,2);assert.equal(f.calls.length,1);
    item.registration.unregister=unregister;f.context.reload();await f.context.cleanup();
    assert(!f.records.has(item.scope));assert(!f.registrations.has(item.scope));assert.equal(f.calls.length,1);
    assert.equal(f.effects.filter(e=>e[0]==='unsubscribe').length,1);
  });
});
test('failed marker write cannot unsubscribe or unregister',async()=>{
  const f=await fixture(),item=f.items[0];item.beforePut=()=>{throw Error('storage unavailable');};
  await f.context.cleanup();assert.equal(f.records.get(item.scope),item.proof);assert.equal(f.effects.length,0);
});
test('crashes after marker, unsubscribe and unregister recover on later visit',async t=>{
  for(const stage of ['marker','unsubscribe','unregister'])await t.test(stage,async()=>{
    const f=await fixture(),item=f.items[0],fail=()=>{throw Error('page terminated');};
    if(stage==='marker')item.afterPut=fail;
    if(stage==='unsubscribe')item.afterUnsubscribe=fail;
    if(stage==='unregister')item.beforeDelete=fail;
    await f.context.cleanup();assert.equal(JSON.parse(f.records.get(item.scope)).cleanupPending,true);
    delete item.afterPut;delete item.afterUnsubscribe;delete item.beforeDelete;
    f.context.reload();await f.context.cleanup();
    assert(!f.records.has(item.scope));assert(!f.registrations.has(item.scope));
    assert.equal(f.calls.length,stage==='marker'?2:1);
  });
});
test('replacement after marker write prevents teardown; later live status clears marker',async t=>{
  for(const replacement of ['proof','subscription','worker','navigation'])await t.test(replacement,async()=>{
    const f=await fixture(),item=f.items[0];item.afterPut=()=>{
      if(replacement==='proof')f.records.set(item.scope,JSON.stringify({path:JSON.parse(item.proof).path,expiresAt:Date.now()+86400000}));
      if(replacement==='subscription')item.current={endpoint:'https://push.example/new-subscription'};
      if(replacement==='worker')f.registrations.set(item.scope,{scope:item.scope});
      if(replacement==='navigation')f.context.select(item);
    };
    await f.context.cleanup();assert.equal(f.effects.length,0);assert(f.records.has(item.scope));
  });
  const f=await fixture(),item=f.items[0];item.afterPut=()=>{throw Error('crash before unsubscribe');};
  await f.context.cleanup();delete item.afterPut;item.status={enabled:true,expires_at:Date.now()+86400000};
  f.context.reload();await f.context.cleanup();
  assert.deepEqual(Object.keys(JSON.parse(f.records.get(item.scope))).sort(),['expiresAt','path']);
  assert.equal(f.effects.length,0);
  item.current=null;f.context.reload();await f.context.cleanup();assert.equal(f.effects.length,0);
});
test('renewed proof and replacement subscription block missing-subscription retry shortcut',async t=>{
  for(const mode of ['renewed-proof','live-subscription','offline-subscription'])await t.test(mode,async()=>{
    const f=await fixture(),item=f.items[0];item.registration.unregister=async()=>false;
    await f.context.cleanup();const before=f.effects.length;
    if(mode==='renewed-proof')f.records.set(item.scope,JSON.stringify({path:JSON.parse(item.proof).path,expiresAt:Date.now()+86400000}));
    else{
      item.expectedEndpoint='https://push.example/replacement';item.current={endpoint:item.expectedEndpoint};
      if(mode==='live-subscription')item.status={enabled:true,expires_at:Date.now()+86400000};
      else item.onStatus=()=>{throw Error('offline');};
    }
    f.context.reload();await f.context.cleanup();assert.equal(f.effects.length,before);assert(f.records.has(item.scope));
    assert.equal(JSON.parse(f.records.get(item.scope)).cleanupPending,mode==='offline-subscription'?true:undefined);
  });
});
test('unmarked and malformed teardown markers cannot authorize missing-resource removal',async t=>{
  for(const marker of [undefined,false,'true',true])await t.test(String(marker),async()=>{
    const f=await fixture(),item=f.items[0];item.current=null;
    f.records.set(item.scope,JSON.stringify({...JSON.parse(item.proof),cleanupPending:marker,...(marker===true?{unexpected:'field'}:{})}));
    await f.context.cleanup();assert.equal(f.effects.length,0);assert(f.records.has(item.scope));
  });
});
