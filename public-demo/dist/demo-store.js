'use strict';
// A disposable browser-memory simulation. This is not a secure ticket service.
// No requests, storage APIs, staff authentication, or cross-device coordination.
class DemoStore {
  constructor({seed=true,now=()=>Date.now()}={}) {
    this.now=now; this.deposits=[]; this.collections=[]; this.audit=[];
    this.codes=new Map(); this.claims=new Map(); this.requests=new Map(); this.failures=[];
    this.events=[{id:'training-event-001',name:'Oktoberfest 2027'},{id:'training-event-002',name:'Oktoberfest 2027 · isolation fixture'}];
    if(seed) this.create({request_id:'sample',event_id:this.events[0].id,operator:'Desk operator',location:'A-01',quantities:{normal:6,vip:2,vvip:1},custody_confirmed:true},'K7M4','PKT-DEMO-001');
  }
  clone(value){return JSON.parse(JSON.stringify(value));}
  error(message,status=400){const e=new Error(message);e.status=status;e.notExecuted=true;throw e;}
  stamp(){return new Date(this.now()).toISOString();}
  id(){return crypto.randomUUID();}
  event(id){if(!this.events.some(e=>e.id===id))this.error('Choose an available demo event.');}
  qty(q){if(!q || Object.keys(q).sort().join()!=='normal,vip,vvip' || !['normal','vip','vvip'].every(k=>Number.isInteger(q[k])&&q[k]>=0&&q[k]<=100) || !Object.values(q).some(n=>n>0))this.error('Choose at least one pass, using whole numbers from 0 to 100.');}
  operator(s){if(typeof s!=='string'||!s.trim()||s.length>80)this.error('Choose a synthetic staff label.');return s.trim();}
  record(action,d,operator,details,collection_id=null){this.audit.unshift({seq:this.audit.length+1,action,deposit_id:d.id,event_id:d.event_id,collection_id,operator,details,at:this.stamp()});}
  publicDeposit(d){return {...this.clone(d),pending_collection:this.clone(this.collections.find(c=>c.deposit_id===d.id&&c.status==='RELEASE_RECORDED')||null)};}
  state(event_id){this.event(event_id);return {event_id,event_name:this.events.find(e=>e.id===event_id).name,events:this.clone(this.events),deposits:this.deposits.filter(d=>d.event_id===event_id).map(d=>this.publicDeposit(d)),collections:this.clone(this.collections.filter(c=>c.event_id===event_id)),audit:this.clone(this.audit.filter(a=>a.event_id===event_id).slice(0,100)),counts:{},csrf:'browser-demo-only'};}
  normalize(code){return String(code||'').toUpperCase().replace(/[\s-]/g,'');}
  code(){const alphabet='23456789ABCDEFGHJKLMNPQRSTUVWXYZ';const bytes=crypto.getRandomValues(new Uint8Array(4));const s=Array.from(bytes,b=>alphabet[b%alphabet.length]).join('');return s;}
  create(b,fixedCode=null,fixedPacket=null){
    this.event(b.event_id);const operator=this.operator(b.operator);this.qty(b.quantities);
    const location=String(b.location||'').trim();if(!location||location.length>30)this.error('Enter a synthetic shelf slot, up to 30 characters.');
    if(b.custody_confirmed!==true)this.error('Confirm the simulated custody first.');
    if(this.deposits.some(d=>d.event_id===b.event_id&&d.location.toUpperCase()===location.toUpperCase()))this.error('Use a fresh shelf slot for this event.');
    const d={id:this.id(),event_id:b.event_id,packet_id:fixedPacket||'PKT-'+this.id().slice(0,8).toUpperCase(),location,created_by:operator,created_at:this.stamp(),version:1,initial:{...b.quantities},remaining:{...b.quantities}};
    let code=fixedCode||this.code();while(this.codes.has(b.event_id+':'+this.normalize(code)))code=this.code();
    this.deposits.push(d);this.codes.set(b.event_id+':'+this.normalize(code),d.id);
    this.record('CODE_GENERATED',d,operator,{quantities:{...b.quantities},location});
    return {deposit:this.publicDeposit(d),collection_code:code};
  }
  verify(b){
    this.event(b.event_id);this.failures=this.failures.filter(t=>t>this.now()-60000);
    if(this.failures.length>=5)this.error('Too many unsuccessful checks. Wait a minute or start a fresh demo.',429);
    const id=this.codes.get(b.event_id+':'+this.normalize(b.collection_code));const d=this.deposits.find(d=>d.id===id);
    if(!d){this.failures.push(this.now());this.error('Collection code not found in this event.',404);}
    if(this.collections.some(c=>c.deposit_id===id&&c.status==='RELEASE_RECORDED'))this.error('A handover is unconfirmed. Review the existing record before another collection.',409);
    if(!Object.values(d.remaining).some(n=>n>0))this.error('All passes for this demo code have already been collected.',409);
    const token=this.id();this.claims.set(token,{deposit_id:d.id,event_id:d.event_id,version:d.version,expires:this.now()+120000});
    return {deposit:this.publicDeposit(d),claim_token:token,expires_in:120};
  }
  release(id,b){
    this.event(b.event_id);const operator=this.operator(b.operator);this.qty(b.quantities);
    const d=this.deposits.find(d=>d.id===id&&d.event_id===b.event_id);if(!d)this.error('Deposit not found in this event.',404);
    const claim=this.claims.get(b.claim_token);if(!claim||claim.deposit_id!==id||claim.event_id!==b.event_id||claim.expires<=this.now())this.error('Verification expired. Verify the code again.',409);
    if(d.version!==b.version||claim.version!==d.version)this.error('The balance changed. Verify the code again.',409);
    if(String(b.packet_id||'').trim().toUpperCase()!==d.packet_id)this.error('Physical packet ID does not match this deposit. Use the demo packet ID shown above.');
    if(this.collections.some(c=>c.deposit_id===id&&c.status==='RELEASE_RECORDED'))this.error('Finish the existing handover first.',409);
    if(['normal','vip','vvip'].some(k=>b.quantities[k]>d.remaining[k]))this.error('Requested quantities exceed the available balance.',409);
    const c={id:this.id(),event_id:d.event_id,deposit_id:id,packet_id:d.packet_id,version:1,status:'RELEASE_RECORDED',quantities:{...b.quantities},created_by:operator,created_at:this.stamp(),handed_over_by:null,handed_over_at:null};
    for(const k of ['normal','vip','vvip'])d.remaining[k]-=b.quantities[k];d.version++;this.collections.push(c);
    this.record('RELEASE_RECORDED',d,operator,{quantities:{...b.quantities}},c.id);
    return {deposit:this.publicDeposit(d),collection:this.clone(c)};
  }
  handover(id,b){
    this.event(b.event_id);const operator=this.operator(b.operator);
    const c=this.collections.find(c=>c.id===id&&c.event_id===b.event_id);if(!c)this.error('Collection not found in this event.',404);
    const d=this.deposits.find(d=>d.id===c.deposit_id);
    if(operator!==c.created_by)this.error('Use the original staff label to confirm this handover.',403);
    if(b.handover_confirmed!==true)this.error('Confirm the simulated handover first.');
    if(c.status!=='RELEASE_RECORDED'||c.version!==b.version)this.error('This collection changed or was already confirmed.',409);
    c.status='HANDED_OVER';c.version++;c.handed_over_by=operator;c.handed_over_at=this.stamp();d.version++;
    this.record('HANDOVER_CONFIRMED',d,operator,{quantities:{...c.quantities}},c.id);
    return {deposit:this.publicDeposit(d),collection:this.clone(c)};
  }
  async request(url,body=null){
    if(url.startsWith('/api/state?'))return this.state(new URLSearchParams(url.split('?')[1]).get('event_id'));
    if(url==='/api/verify')return this.verify(body||{});
    const b=body||{};if(!b.request_id)this.error('A demo action ID is required.');
    const fingerprint=JSON.stringify([url,b]);const prev=this.requests.get(b.request_id);
    if(prev){if(prev.fingerprint!==fingerprint)this.error('This action ID was used for different values.',409);const d=this.deposits.find(d=>d.id===prev.result.deposit.id),c=prev.result.collection&&this.collections.find(c=>c.id===prev.result.collection.id);return {...this.clone(prev.result),deposit:this.publicDeposit(d),...(c?{collection:this.clone(c)}:{}),replayed:true};}
    let result;const release=url.match(/^\/api\/deposits\/([^/]+)\/release$/),handover=url.match(/^\/api\/collections\/([^/]+)\/handover$/);
    if(url==='/api/deposits')result=this.create(b);
    else if(release)result=this.release(decodeURIComponent(release[1]),b);
    else if(handover)result=this.handover(decodeURIComponent(handover[1]),b);
    else this.error('Unknown demo action.',404);
    this.requests.set(b.request_id,{fingerprint,result:this.clone(result)});return result;
  }
}
if(typeof module!=='undefined')module.exports={DemoStore};
