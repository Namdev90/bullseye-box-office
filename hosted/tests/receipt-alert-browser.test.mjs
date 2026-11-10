import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';

const hour=3600000;
function locks(){
  const tails=new Map();
  return {request(key,fn){
    const pending=(tails.get(key)||Promise.resolve()).catch(()=>{}).then(fn);
    tails.set(key,pending);return pending;
  }};
}
async function browser({locking=true}={}){
  const now=Date.now(),ticket=crypto.randomUUID(),booth=crypto.randomUUID();
  const path='/booth/'+booth+'#receipt='+ticket;
  const scope='https://test.example/receipt-alerts/'+Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(ticket))).toString('hex')+'/';
  let record={path,expiresAt:now-1},status={enabled:true,expires_at:now+48*hour};
  let subscription={endpoint:'https://fcm.googleapis.com/fcm/send/synthetic-browser',unsubscribe:async()=>{subscription=null;}};
  const permission={permission:'granted',requestPermission:async()=>permission.permission};
  const calls=[],notices=[],opened=[],handlers={},messages=[],writes=[];
  const lock=locking?locks():undefined;
  let transport=async()=>Response.json(status),failStop=false;
  const cache={match:async()=>record?Response.json(record):undefined,
    put:async(key,response)=>{assert.equal(key,scope);record=await response.json();writes.push({...record});},
    delete:async key=>{assert.equal(key,scope);record=null;}};
  const registration={scope,pushManager:{getSubscription:async()=>subscription,subscribe:async()=>{throw new Error('Unexpected automatic enable');}},
    unregister:async()=>{},showNotification:async(...args)=>notices.push(args)};
  const fetch=async(url,options)=>{
    const data=JSON.parse(options.body);calls.push({url,...data});
    assert.equal(url,'/api/public/booth/'+booth+'/alerts');
    assert(!url.includes(ticket));assert(!url.includes('fcm.googleapis.com'));
    assert.equal(options.credentials,'same-origin');
    if(data.action==='stop'){if(failStop)throw new Error('synthetic stop transport failure');status={enabled:false};return Response.json({enabled:false});}
    assert.equal(data.action,'status','Background work must not enable consent');
    return transport();
  };
  const common={Response,AbortSignal,Date,Number,TextEncoder,crypto:webcrypto,fetch,caches:{open:async()=>cache}};
  const worker={...common,self:{registration,navigator:{locks:lock},Notification:permission,
    addEventListener:(type,fn)=>{handlers[type]=fn;},
    clients:{matchAll:async()=>[{postMessage:data=>messages.push(data)}],openWindow:async value=>opened.push(value)}}};
  runInNewContext(readFileSync('web/receipt-alert-worker.js','utf8'),worker);
  const source=readFileSync('web/intake.js','utf8');
  const helpers=source.slice(source.indexOf('async function receiptAlertLock('),source.indexOf('async function receiptWorkerAt('));
  const saver=source.slice(source.indexOf('async function saveReceiptAlerts('),source.indexOf('navigator.serviceWorker?.addEventListener'));
  const button={},feedback={};
  const page={...common,navigator:{locks:lock},Notification:permission,
    location:{origin:'https://test.example',pathname:'/booth/'+booth},
    receiptWorkerAt:async()=>registration,activeReceiptWorker:async()=>registration,checkReceipt:async()=>{},
    alertButton:button,alertStatus:feedback,initialTicket:ticket,initialScope:scope};
  runInNewContext(`let requestId=initialTicket,alertRevision=0,alertScope=initialScope,alertsEnabled=true,lastReceipt='confirmed';
    const alertCacheName='sharepass-receipt-alerts',endpoint='/api/public'+location.pathname;
    ${helpers}\n${saver}\n globalThis.prepare=()=>prepareReceiptAlerts(requestId);
    globalThis.enabled=()=>alertsEnabled;
    globalThis.switchTicket=()=>{requestId='another-ticket';};`,page);
  async function event(type){let promise;handlers[type]({notification:{close(){}},waitUntil:value=>{promise=value;}});await promise;}
  return {now,ticket,scope,path,calls,notices,opened,messages,writes,page,button,permission,cache,event,
    get record(){return record;},set record(value){record=value;},
    set status(value){status=value;},set transport(value){transport=value;},set failStop(value){failStop=value;},
    set subscription(value){subscription=value;}};
}

test('page repairs stale expiry from existing server consent for 48h confirmation and extension',async()=>{
  const f=await browser();await f.page.prepare();
  assert.equal(f.record.expiresAt,f.now+48*hour);assert.equal(f.page.enabled(),true);
  f.status={enabled:true,expires_at:f.now+72*hour};await f.page.prepare();
  assert.equal(f.record.expiresAt,f.now+72*hour);
  assert(f.calls.every(call=>call.action==='status'));
  assert.deepEqual(Object.keys(f.record).sort(),['expiresAt','path']);
});

test('closed-tab push and notification click revalidate stale cache and store no code or endpoint',async()=>{
  const f=await browser();await f.event('push');await f.event('notificationclick');
  assert.equal(f.notices.length,1);assert.deepEqual(f.opened,[f.path]);
  assert.equal(f.record.expiresAt,f.now+48*hour);
  assert(!JSON.stringify([f.notices,f.messages]).includes(f.ticket));
  assert(!JSON.stringify(f.record).includes('fcm.googleapis.com'));
});

test('expired, stopped or replaced server consent never gets renewed or notified',async t=>{
  for(const reason of ['expired','stopped','replaced'])await t.test(reason,async()=>{
    const f=await browser();f.status={enabled:false};await f.event('push');await f.event('notificationclick');
    assert.equal(f.notices.length,0);assert.equal(f.opened.length,0);assert.equal(f.record,null);
    await f.page.prepare();assert.equal(f.page.enabled(),false);
    assert.equal(f.writes.length,0);
  });
});

test('offline status failure preserves proof without alerts and later online recovery succeeds',async()=>{
  const f=await browser();const before={...f.record};
  f.transport=async()=>{throw new Error('synthetic offline');};
  await f.event('push');await f.event('notificationclick');await f.page.prepare();
  assert.deepEqual(f.record,before);assert.equal(f.notices.length,0);assert.equal(f.opened.length,0);
  assert.equal(f.page.enabled(),true,'Keep Stop available during offline uncertainty');
  f.transport=async()=>Response.json({enabled:true,expires_at:f.now+48*hour});
  await f.event('notificationclick');assert.deepEqual(f.opened,[f.path]);
});

test('missing Web Locks cannot renew cache, notify or open a background receipt',async()=>{
  const f=await browser({locking:false});const before={...f.record};
  await f.page.prepare();await f.event('push');await f.event('notificationclick');
  assert.deepEqual(f.record,before);assert.equal(f.writes.length,0);
  assert.equal(f.notices.length,0);assert.equal(f.opened.length,0);
});

test('permission revoked or browser subscription missing prevents background activity',async t=>{
  for(const mode of ['denied','missing'])await t.test(mode,async()=>{
    const f=await browser();if(mode==='denied')f.permission.permission='denied';else f.subscription=null;
    await f.event('push');await f.event('notificationclick');await f.page.prepare();
    assert.equal(f.calls.length,0);assert.equal(f.notices.length,0);assert.equal(f.opened.length,0);assert.equal(f.record,null);
  });
});

test('status response arriving after Stop begins cannot recreate cached proof',async()=>{
  const f=await browser();let release,started;
  const waiting=new Promise(resolve=>{started=resolve;});
  f.transport=()=>{started();return new Promise(resolve=>{release=resolve;});};
  const refresh=f.page.prepare();await waiting;
  // The page invalidates its old response before Stop waits for the shared lock.
  const stop=f.button.onclick();release(Response.json({enabled:true,expires_at:f.now+48*hour}));
  await Promise.all([refresh,stop]);
  assert.equal(f.record,null);assert.equal(f.writes.length,0);assert.equal(f.page.enabled(),false);
  await f.event('push');assert.equal(f.notices.length,0);
});

test('permission/subscription changed during network response prevents push and cache renewal',async t=>{
  for(const mode of ['permission','endpoint'])await t.test(mode,async()=>{
    const f=await browser();f.transport=async()=>{
      if(mode==='permission')f.permission.permission='denied';else f.subscription={endpoint:'https://fcm.googleapis.com/fcm/send/replacement'};
      return Response.json({enabled:true,expires_at:f.now+48*hour});
    };
    await f.event('push');assert.equal(f.notices.length,0);assert.equal(f.writes.length,0);
  });
});

test('changed page receipt rejects stale status response',async()=>{
  const f=await browser();f.transport=async()=>{f.page.switchTicket();return Response.json({enabled:true,expires_at:f.now+48*hour});};
  await f.page.prepare();assert.equal(f.writes.length,0);
});

test('page rechecks permission and subscription after status round trip',async t=>{
  for(const mode of ['permission','endpoint'])await t.test(mode,async()=>{
    const f=await browser();f.transport=async()=>{
      if(mode==='permission')f.permission.permission='denied';else f.subscription={endpoint:'https://fcm.googleapis.com/fcm/send/replaced'};
      return Response.json({enabled:true,expires_at:f.now+48*hour});
    };
    await f.page.prepare();assert.equal(f.page.enabled(),false);assert.equal(f.writes.length,0);
  });
});

test('failed remote Stop still clears local proof and prevents background activity',async()=>{
  const f=await browser();f.failStop=true;
  await f.button.onclick();assert.equal(f.record,null);assert.equal(f.page.enabled(),false);
  await f.event('push');await f.event('notificationclick');
  assert.equal(f.notices.length,0);assert.equal(f.opened.length,0);
});

test('HTTP error is uncertainty, never permission to renew or notify',async()=>{
  const f=await browser();const before={...f.record};f.transport=async()=>new Response(null,{status:503});
  await f.page.prepare();await f.event('push');await f.event('notificationclick');
  assert.deepEqual(f.record,before);assert.equal(f.writes.length,0);assert.equal(f.notices.length,0);
});

async function interruptedEnable({stage,existing=false,replacement=false}){
  const ticket=crypto.randomUUID(),scope='https://test.example/receipt-alerts/'+'a'.repeat(64)+'/',newScope='https://test.example/receipt-alerts/'+'b'.repeat(64)+'/';
  const endpoints={old:'https://fcm.googleapis.com/fcm/send/old-fixture',new:'https://fcm.googleapis.com/fcm/send/new-fixture'};
  const calls=[],registered=[],writes=[],unsubscribed=[];let unregistered=0,lookupCount=0;
  const old={endpoint:endpoints.old,unsubscribe:async()=>{unsubscribed.push(endpoints.old);current=null;}};
  const newer={endpoint:endpoints.new,unsubscribe:async()=>{unsubscribed.push(endpoints.new);}};
  let current=existing?old:null;
  const context={Response,AbortSignal,Uint8Array,atob,setTimeout,clearTimeout,Notification:{permission:'granted',requestPermission:async()=>'granted'},
    location:{pathname:'/booth/'+crypto.randomUUID()},alertButton:{},alertStatus:{},checkReceipt:async()=>{},
    initialTicket:ticket,initialScope:scope};
  const switchReceipt=()=>context.changeReceipt();
  const registration={scope,active:{state:'activated'},unregister:async()=>{unregistered++;},pushManager:{
    getSubscription:async()=>{lookupCount++;if(stage==='subscription'&&lookupCount===1)switchReceipt();return current;},
    subscribe:async()=>{current=old;if(stage==='subscribe')switchReceipt();return old;}
  }};
  context.navigator={locks:locks(),serviceWorker:{
    getRegistration:async requested=>{assert.equal(requested,scope);if(stage==='lookup')switchReceipt();return existing?registration:undefined;},
    register:async(script,options)=>{registered.push(options.scope);if(stage==='registration')switchReceipt();return registration;}
  }};
  context.caches={open:async()=>({put:async(key,response)=>writes.push({key,record:await response.json()}),delete:async()=>{}})};
  context.fetch=async(url,options)=>{
    const body=JSON.parse(options.body);calls.push(body);
    assert.equal(body.ticket,ticket);assert.equal(body.endpoint,endpoints.old);
    if(body.action==='enable'&&stage==='response'){
      switchReceipt();if(replacement)current=newer;
    }
    return Response.json({enabled:body.action==='enable',expires_at:Date.now()+48*hour});
  };
  const source=readFileSync('web/intake.js','utf8');
  const lockFunction=source.slice(source.indexOf('async function receiptAlertLock('),source.indexOf('async function prepareReceiptAlerts('));
  const enableCode=source.slice(source.indexOf('async function receiptWorkerAt('),source.indexOf('navigator.serviceWorker?.addEventListener'));
  runInNewContext(`let requestId=initialTicket,alertScope=initialScope,alertRevision=0,alertsEnabled=false,lastReceipt='confirmed';
    const alertCacheName='sharepass-receipt-alerts',endpoint='/api/public'+location.pathname,alertKey='AAAA';
    ${lockFunction}\n${enableCode}
    globalThis.changeReceipt=()=>{requestId='different-ticket';alertScope='${newScope}';};`,context);
  await context.alertButton.onclick();
  assert.deepEqual(registered,[scope],'Registration must use captured scope despite navigation');
  assert.equal(writes.length,0);assert(!unsubscribed.includes(endpoints.new),'Replacement subscription must survive');
  if(existing||replacement){assert.equal(unsubscribed.length,0);assert.equal(unregistered,0);}
  else if(stage==='subscribe'||stage==='response'){assert.deepEqual(unsubscribed,[endpoints.old]);assert.equal(unregistered,1);}
  else assert.equal(unsubscribed.length,0);
  assert.equal(calls.filter(call=>call.action==='enable').length,stage==='response'?1:0);
  if(stage==='response'&&!existing&&!replacement)assert.equal(calls.filter(call=>call.action==='stop').length,1);
}

test('enable captures scope and cleans up only owned resources after receipt navigation',async t=>{
  for(const stage of ['lookup','registration','subscription','subscribe','response']){
    await t.test(stage,()=>interruptedEnable({stage}));
  }
  for(const stage of ['lookup','registration','subscription','response']){
    await t.test('existing '+stage,()=>interruptedEnable({stage,existing:true}));
  }
  await t.test('replacement during enable response',()=>interruptedEnable({stage:'response',replacement:true}));
});
