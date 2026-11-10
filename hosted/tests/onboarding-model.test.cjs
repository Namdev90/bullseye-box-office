'use strict';

// Mock onboarding supplies fictional display labels only; it grants no identity or access.
const assert = require('node:assert/strict');
if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', {value:require('node:crypto').webcrypto});
const {DemoStore} = require('../web/demo-store.js');
const event='training-event-001';
const quantity=(normal,vip,vvip)=>({normal,vip,vvip});
let checks=0;
const pass=label=>{checks++;console.log('PASS',label);};

(async()=>{
 const store=new DemoStore();
 const fixture=store.state(event).deposits[0];
 assert.equal(fixture.created_by,'Kenneth');
 assert.equal(fixture.depositor_label,'Aria');
 assert.deepEqual(fixture.remaining,quantity(6,2,1));
 pass('The first sample packet identifies fictional staff Kenneth and depositor Aria');

 const body={request_id:'no-name',event_id:event,operator:'Kenneth',location:'C-01',quantities:quantity(2,1,0),custody_confirmed:true};
 const unnamed=await store.request('/api/deposits',body);
 assert.equal(unnamed.deposit.depositor_label,'');
 assert(!Object.hasOwn(unnamed.deposit,'collector_name'));
 pass('A new deposit needs no depositor label or named collector');

 const labeled=await store.request('/api/deposits',{...body,request_id:'labeled',location:'C-02',depositor_label:'  Aria  '});
 assert.equal(labeled.deposit.depositor_label,'Aria');
 assert.equal((await store.request('/api/deposits',{...body,request_id:'labeled',location:'C-02',depositor_label:'  Aria  '})).deposit.id,labeled.deposit.id);
 pass('Optional display labels are trimmed and identical deposit replay remains idempotent');

 const before=store.state(event);
 for(const label of [null,42,{},'x'.repeat(81)]){
  await assert.rejects(store.request('/api/deposits',{...body,request_id:crypto.randomUUID(),location:'C-03',depositor_label:label}),/optional depositor label/);
 }
 assert.deepEqual(store.state(event),before);
 pass('Invalid optional labels are rejected before stock or history changes');

 const snapshot=store.state(event);
 snapshot.deposits[0].depositor_label='Changed outside the store';
 assert.equal(store.state(event).deposits[0].depositor_label,'Aria');
 pass('Custody snapshots isolate depositor display metadata from outside changes');

 await assert.rejects(store.request('/api/verify',{event_id:event,collection_code:'Aria'}),/four digits/);
 await assert.rejects(store.request('/api/verify',{event_id:event,collection_code:'Kenneth'}),/four digits/);
 pass('Fictional staff and depositor names cannot authorize pickup');

 const verified=await store.request('/api/verify',{event_id:event,collection_code:'0420'});
 const release=await store.request(`/api/deposits/${fixture.id}/release`,{
  request_id:'release',event_id:event,operator:'Kenneth',claim_token:verified.claim_token,
  version:verified.deposit.version,packet_id:fixture.packet_id,quantities:quantity(2,1,0)
 });
 assert.deepEqual(release.deposit.remaining,quantity(4,1,1));
 assert.equal(release.deposit.depositor_label,'Aria');
 for(let i=0;i<3;i++) store.state(event);
 await assert.rejects(store.request('/api/verify',{event_id:event,collection_code:'0420'}),/unconfirmed/);
 assert.equal(store.state(event).deposits[0].pending_collection.id,release.collection.id);
 pass('Reading and reopening the desk preserves Aria metadata and the unconfirmed handover lock');

 await assert.rejects(store.request(`/api/collections/${release.collection.id}/handover`,{
  request_id:'wrong-staff',event_id:event,operator:'Aria',version:1,handover_confirmed:true
 }),/original staff/);
 const done=await store.request(`/api/collections/${release.collection.id}/handover`,{
  request_id:'confirm',event_id:event,operator:'Kenneth',version:1,handover_confirmed:true
 });
 assert.equal(done.collection.handed_over_by,'Kenneth');
 assert.deepEqual(done.deposit.remaining,quantity(4,1,1));
 pass('Depositor identity never substitutes for original-staff handover confirmation');

 console.log(`${checks} onboarding model checks passed. Mock sign-in is not authentication.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
