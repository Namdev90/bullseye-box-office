'use strict';
// A disposable browser-memory simulation. This is not a secure ticket service.
// No requests, storage APIs, staff authentication, or cross-device coordination.
class DemoStore {
  constructor({seed=true,now=()=>Date.now(),endAt=Infinity,eventName='Oktoberfest 2027 — Concept Demo',singleEvent=false}={}) {
    if(endAt!==Infinity&&!Number.isFinite(endAt))throw new TypeError('endAt must be a timestamp or Infinity.');
    this.now=now; this.endAt=endAt; this.evidenceRetentionEnded=false; this.deposits=[]; this.collections=[]; this.audit=[]; this.outbox=[];
    this.passTypes=[{id:'normal',label:'Normal'},{id:'vip',label:'VIP'},{id:'vvip',label:'VVIP'}];
    this.booths=[{id:'B1',label:'Booth 1'},{id:'B2',label:'Booth 2'}];
    this.codes=new Map(); this.claims=new Map(); this.requests=new Map(); this.failures=[];
    this.events=[{id:'training-event-001',name:eventName},...(singleEvent?[]:[{id:'training-event-002',name:'Oktoberfest 2027 — Concept Demo · isolation fixture'}])];
    if(seed) this.create({request_id:'sample',event_id:this.events[0].id,operator:'Kenneth',depositor_label:'Aria',location:'A-01',quantities:{normal:6,vip:2,vvip:1},custody_confirmed:true},'0420','PKT-DEMO-001');
  }
  clone(value){return JSON.parse(JSON.stringify(value));}
  error(message,status=400,notExecuted=true){const e=new Error(message);e.status=status;e.notExecuted=notExecuted;throw e;}
  stamp(){return new Date(this.now()).toISOString();}
  id(){return crypto.randomUUID();}
  event(id){if(!this.events.some(e=>e.id===id))this.error('Choose an available demo event.');}
  keys(){return this.passTypes.map(type=>type.id);}
  qty(q){
    const keys=this.keys();
    if(!q||typeof q!=='object'||Array.isArray(q)||Object.keys(q).some(k=>!keys.includes(k))||
      !keys.every(k=>k==='mip'&&q[k]===undefined||Number.isInteger(q[k])&&q[k]>=0&&q[k]<=100)||
      !Object.values(q).some(n=>n>0))this.error('Choose at least one pass, using whole numbers from 0 to 100.');
  }
  addPassType(label){
    if(typeof label!=='string'||!label.trim()||label.trim().length>40||/[\u0000-\u001f\u007f]/.test(label))this.error('Use a pass label of 1 to 40 characters.');
    label=label.trim();
    if(this.passTypes.length>=12)this.error('At most 12 pass types are supported in this practice desk.');
    if(this.passTypes.some(type=>type.label.toLocaleLowerCase()===label.toLocaleLowerCase()))this.error('That pass type already exists.');
    const stem='pass_'+(label.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,30)||'type');
    let id=stem,suffix=2;while(this.passTypes.some(type=>type.id===id))id=stem+'_'+suffix++;
    const type={id,label};this.passTypes.push(type);
    for(const d of this.deposits){d.initial[id]=0;d.remaining[id]=0;}
    for(const c of this.collections)c.quantities[id]=0;
    return this.clone(type);
  }
  booth(value,fallback='B1'){const id=value===undefined?fallback:value;if(!this.booths.some(booth=>booth.id===id))this.error('Choose booth B1 or B2.');return id;}
  optionalLabel(value,kind){if(value===undefined)return '';if(typeof value!=='string'||value.trim().length>80||/[\u0000-\u001f\u007f]/.test(value))this.error(`Use an optional ${kind} label of up to 80 characters.`);return value.trim();}
  channels(value,fallback=[]){
    if(value===undefined)return [...fallback];
    const allowed=['whatsapp','sms','email'];
    if(!Array.isArray(value)||value.length>3||!value.every(channel=>allowed.includes(channel)))this.error('Choose WhatsApp, SMS or email channels only.');
    return allowed.filter(channel=>value.includes(channel));
  }
  evidence(b){
    if(b.evidence_fixture_id===undefined)return null;
    if(!['sample-a','sample-b'].includes(b.evidence_fixture_id))this.error('Choose sample-a or sample-b evidence only. Real photos are not supported.');
    if(b.consent_confirmed!==true)this.error('Confirm consent before attaching sample evidence.');
    if(this.evidenceRetentionEnded||this.now()>=this.endAt)this.error('Evidence retention ended for this event.');
    return {evidence_fixture_id:b.evidence_fixture_id,consent_confirmed:true,evidence_status:'attached_sample',evidence_expires_at:Number.isFinite(this.endAt)?new Date(this.endAt).toISOString():null};
  }
  intent(action,d,actionId,channels,evidence=null){
    for(const channel of channels){
      const id=actionId+':'+channel;
      if(this.outbox.some(intent=>intent.id===id))continue;
      this.outbox.push({id,event_id:d.event_id,event_name:this.events.find(event=>event.id===d.event_id).name,action,action_id:actionId,deposit_id:d.id,packet_id:d.packet_id,booth_id:evidence?.booth_id||d.booth_id,recipient_ref:'sample-depositor',channel,channels:[channel],remaining:{...d.remaining},status:'not_sent_provider_unconfigured',created_at:this.stamp(),...(evidence?.evidence_fixture_id?{evidence_fixture_id:evidence.evidence_fixture_id,evidence_status:'attached_sample'}:{} )});
    }
  }
  purgeEvidence(now=this.now()){
    if(!Number.isFinite(now))this.error('Use a finite retention timestamp.');
    if(now<this.endAt&&!this.evidenceRetentionEnded)return {deleted:0,expired:false};
    this.evidenceRetentionEnded=true;
    let deleted=0;
    for(const d of this.deposits){
      let removed=0;
      for(const record of [d,...this.collections.filter(c=>c.deposit_id===d.id)]){
        if(!record.evidence_fixture_id)continue;
        delete record.evidence_fixture_id;delete record.evidence_expires_at;
        record.evidence_status='deleted_event_end';record.evidence_deleted_at=new Date(now).toISOString();removed++;deleted++;
      }
      if(removed)this.record('PHOTOS_DELETED',d,'Retention policy',{reason:'event_end',sample_references_deleted:removed,booth_id:d.booth_id});
    }
    for(const intent of this.outbox)if(intent.evidence_fixture_id){delete intent.evidence_fixture_id;intent.evidence_status='deleted_event_end';}
    return {deleted,expired:true};
  }
  operator(s){if(typeof s!=='string'||!s.trim()||s.length>80)this.error('Choose a synthetic staff label.');return s.trim();}
  record(action,d,operator,details,collection_id=null){this.audit.unshift({seq:this.audit.length+1,action,deposit_id:d.id,event_id:d.event_id,booth_id:details.booth_id||d.booth_id||'B1',collection_id,operator,details:{...details,remaining:{...d.remaining}},at:this.stamp()});}
  publicDeposit(d){
    const {active_collection_code,update_contact,...visible}=d;
    return {...this.clone(visible),pending_collection:this.clone(this.collections.find(c=>c.deposit_id===d.id&&c.status==='RELEASE_RECORDED')||null)};
  }
  state(event_id){this.event(event_id);this.purgeEvidence();return {event_id,event_name:this.events.find(e=>e.id===event_id).name,events:this.clone(this.events),passTypes:this.clone(this.passTypes),booths:this.clone(this.booths),deposits:this.deposits.filter(d=>d.event_id===event_id).map(d=>this.publicDeposit(d)),collections:this.clone(this.collections.filter(c=>c.event_id===event_id)),audit:this.clone(this.audit.filter(a=>a.event_id===event_id).slice(0,100)),outbox:this.clone(this.outbox.filter(intent=>intent.event_id===event_id)),evidence:{end_at:Number.isFinite(this.endAt)?new Date(this.endAt).toISOString():null,status:this.evidenceRetentionEnded?'expired':Number.isFinite(this.endAt)?'active':'event_end_not_configured'},counts:{},csrf:'browser-demo-only'};}
  normalize(code){return String(code||'').toUpperCase().replace(/[\s-]/g,'');}
  randomBelow(limit){
    const cutoff=Math.floor(0x100000000/limit)*limit;
    const sample=new Uint32Array(1);
    do{crypto.getRandomValues(sample);}while(sample[0]>=cutoff);
    return sample[0]%limit;
  }
  code(){
    return String(this.randomBelow(10000)).padStart(4,'0');
  }
  availableCode(event,exclude=''){
    const available=code=>code!==exclude&&!this.codes.has(event+':'+code);
    const candidates=this.preferredCodes?.filter(([code])=>/^[0-9]{4}$/.test(code)&&available(code));
    if(candidates?.length){
      let pick=this.randomBelow(candidates.reduce((sum,[,weight])=>sum+weight,0));
      for(const [code,weight] of candidates)if((pick-=weight)<0)return code;
    }
    for(let attempt=0;attempt<128;attempt++){
      const code=this.code();
      if(available(code))return code;
    }
    const start=this.randomBelow(10000);
    for(let index=0;index<10000;index++){
      const code=String((start+index)%10000).padStart(4,'0');
      if(available(code))return code;
    }
    this.error('Could not allocate a collection code. Try again.',409);
  }
  create(b,fixedCode=null,fixedPacket=null){
    this.purgeEvidence();this.event(b.event_id);const operator=this.operator(b.operator);this.qty(b.quantities);
    if(b.depositor_label!==undefined&&(typeof b.depositor_label!=='string'||b.depositor_label.trim().length>80))this.error('Use an optional depositor label of up to 80 characters.');
    const depositor_label=this.optionalLabel(b.depositor_label,'depositor');
    const booth_id=this.booth(b.booth_id),notification_channels=this.channels(b.notification_channels),evidence=this.evidence(b);
    const location=String(b.location||'').trim();if(!location||location.length>30)this.error('Enter a synthetic shelf slot, up to 30 characters.');
    if(b.custody_confirmed!==true)this.error('Confirm the simulated custody first.');
    if(this.deposits.some(d=>d.event_id===b.event_id&&d.booth_id===booth_id&&d.location.toUpperCase()===location.toUpperCase()))this.error('Use a fresh shelf slot for this booth.');
    const d={id:this.id(),event_id:b.event_id,packet_id:fixedPacket||'PKT-'+this.id().slice(0,8).toUpperCase(),location,depositor_label,booth_id,notification_channels,evidence_status:'none',...(evidence||{}),created_by:operator,...(this.actorName?{received_by_name:this.actorName}:{}),created_at:this.stamp(),version:1,initial:{...b.quantities},remaining:{...b.quantities}};
    if(b.update_contact)d.update_contact=this.clone(b.update_contact);
    if(b.valid_minutes!==undefined)d.code_expires_at=this.now()+b.valid_minutes*60000;
    const custom=b.custom_code;
    if(custom&&!/^[0-9]{4}$/.test(custom))this.error('Enter four digits.');
    if(custom&&this.codes.has(b.event_id+':'+custom))this.error('That code is already used. Choose another.',409);
    const code=custom||(b.suggested_code&&/^[0-9]{4}$/.test(b.suggested_code)&&!this.codes.has(b.event_id+':'+b.suggested_code)?b.suggested_code:null)||(fixedCode&&!this.codes.has(b.event_id+':'+this.normalize(fixedCode))?fixedCode:this.availableCode(b.event_id));
    this.deposits.push(d);this.codes.set(b.event_id+':'+this.normalize(code),d.id);
    this.record('CODE_GENERATED',d,operator,{quantities:{...b.quantities},location,booth_id});
    this.intent('DEPOSIT_CREATED',d,d.id,notification_channels,evidence);
    return {deposit:this.publicDeposit(d),collection_code:code};
  }
  verify(b){
    this.purgeEvidence();this.event(b.event_id);this.failures=this.failures.filter(t=>t>this.now()-60000);
    if(this.failures.length>=5)this.error('Too many unsuccessful checks. Wait a minute or start a fresh demo.',429);
    const code=typeof b.collection_code==='string'?b.collection_code.trim():'';
    if(!/^[0-9]{4}$/.test(code))this.error('Enter four digits.');
    const id=this.codes.get(b.event_id+':'+code);const d=this.deposits.find(d=>d.id===id);
    if(!d){this.failures.push(this.now());this.error('Collection code not found in this event.',404);}
    if(d.active_collection_code&&d.active_collection_code!==code||d.code_expires_at<=this.now())this.error('This code expired. Ask the booth supervisor to reconcile the packet.',409);
    if(this.collections.some(c=>c.deposit_id===id&&c.status==='RELEASE_RECORDED'))this.error('A handover is unconfirmed. Review the existing record before another collection.',409);
    if(!Object.values(d.remaining).some(n=>n>0))this.error('All passes for this demo code have already been collected.',409);
    if(this.booth(b.booth_id,d.booth_id)!==d.booth_id)return {deposit:this.publicDeposit(d),claim_token:null,expires_in:0,release_allowed:false};
    const token=this.id();this.claims.set(token,{deposit_id:d.id,event_id:d.event_id,version:d.version,expires:this.now()+120000});
    return {deposit:this.publicDeposit(d),claim_token:token,expires_in:120};
  }
  release(id,b){
    this.purgeEvidence();this.event(b.event_id);const operator=this.operator(b.operator);this.qty(b.quantities);
    const d=this.deposits.find(d=>d.id===id&&d.event_id===b.event_id);if(!d)this.error('Deposit not found in this event.',404);
    const booth_id=this.booth(b.booth_id,d.booth_id),collector_label=this.optionalLabel(b.collector_label,'collector'),notification_channels=this.channels(b.notification_channels,d.notification_channels),evidence=this.evidence(b);
    if(booth_id!==d.booth_id)this.error('Wrong physical booth. This packet remains at '+d.booth_id+' / '+d.location+'. Transfers require the local shared service.',409);
    const claim=this.claims.get(b.claim_token);if(!claim||claim.deposit_id!==id||claim.event_id!==b.event_id||claim.expires<=this.now())this.error('Verification expired. Verify the code again.',409);
    if(d.version!==b.version||claim.version!==d.version)this.error('The balance changed. Verify the code again.',409);
    if(String(b.packet_id||'').trim().toUpperCase()!==d.packet_id)this.error('Physical packet ID does not match this deposit. Use the demo packet ID shown above.');
    if(this.collections.some(c=>c.deposit_id===id&&c.status==='RELEASE_RECORDED'))this.error('Finish the existing handover first.',409);
    if(d.code_expires_at<=this.now())this.error('This code expired. Ask the booth supervisor to reconcile the packet.',409);
    if(this.keys().some(k=>(b.quantities[k]??0)>(d.remaining[k]??0)))this.error('Requested quantities exceed the available balance.',409);
    const c={id:this.id(),event_id:d.event_id,deposit_id:id,packet_id:d.packet_id,booth_id,collector_label,notification_channels,evidence_status:'none',...(evidence||{}),version:1,status:'RELEASE_RECORDED',quantities:{...b.quantities},created_by:operator,...(this.actorName?{reserved_by_name:this.actorName}:{}),created_at:this.stamp(),handed_over_by:null,handed_over_at:null};
    for(const k of Object.keys(d.remaining))d.remaining[k]-=b.quantities[k]??0;
    d.version++;this.collections.push(c);
    this.record('RELEASE_RECORDED',d,operator,{quantities:{...b.quantities},booth_id,collector_label},c.id);
    return {deposit:this.publicDeposit(d),collection:this.clone(c)};
  }
  handover(id,b,supervised=false){
    this.purgeEvidence();this.event(b.event_id);const operator=this.operator(b.operator);
    const c=this.collections.find(c=>c.id===id&&c.event_id===b.event_id);if(!c)this.error('Collection not found in this event.',404);
    const d=this.deposits.find(d=>d.id===c.deposit_id);
    if(operator!==c.created_by&&!supervised)this.error('Use the original staff label to confirm this handover.',403);
    if(b.handover_confirmed!==true)this.error('Confirm the simulated handover first.');
    if(c.status!=='RELEASE_RECORDED'||c.version!==b.version)this.error('This collection changed or was already confirmed.',409);
    const booth_id=this.booth(b.booth_id,c.booth_id),notification_channels=this.channels(b.notification_channels,c.notification_channels),evidence=this.evidence(b);
    if(booth_id!==c.booth_id)this.error('Return to the original physical booth to reconcile this handover.',409);
    const collector_label=b.collector_label===undefined?c.collector_label:this.optionalLabel(b.collector_label,'collector');
    c.status='HANDED_OVER';c.version++;c.handed_over_by=operator;if(this.actorName)c.handed_over_by_name=this.actorName;c.handed_over_at=this.stamp();c.booth_id=booth_id;c.collector_label=collector_label;c.notification_channels=notification_channels;if(evidence)Object.assign(c,evidence);d.version++;
    this.record('HANDOVER_CONFIRMED',d,operator,{quantities:{...c.quantities},booth_id,collector_label},c.id);
    this.intent('HANDOVER_CONFIRMED',d,c.id,notification_channels,c);
    return {deposit:this.publicDeposit(d),collection:this.clone(c),...(d.update_contact?{depositor_update:this.pickupUpdate(d,c)}:{})};
  }
  pickupUpdate(d,c){
    const {channel,address}=d.update_contact,name=d.update_contact.name||'';
    const describe=q=>this.passTypes.filter(type=>q[type.id]>0).map(type=>q[type.id]+' '+type.label).join(' + ');
    const remaining=describe(d.remaining);
    return {channel,address,name,collector_name:c.collector_label||'',subject:'SharePass pickup update',message:
      'Hi'+(name?' '+name:'')+'!\nSharePass by Bullseye Entertainment\n\nPickup confirmed\n'+
      (d.depositor_label?'Depositor: '+d.depositor_label+'\n':'')+(c.collector_label?'Collector: '+c.collector_label+'\n':'')+(c.handed_over_by_name?'Handed over by: '+c.handed_over_by_name+'\n':'')+'Handed over: '+describe(c.quantities)+'\n'+
      (remaining?'Group passes remaining: '+remaining:'\nAll passes in this deposit have now been collected.')};
  }
  setUpdates(id,b){
    const d=this.deposits.find(item=>item.id===id&&item.event_id===b.event_id);
    if(!d||d.booth_id!==b.booth_id||d.packet_id!==b.packet_id)this.error('Match the physical packet before setting updates.',404);
    if(b.update_contact)d.update_contact=this.clone(b.update_contact);
    else delete d.update_contact;
    this.record('PICKUP_UPDATES_CHANGED',d,b.operator,{booth_id:d.booth_id,channel:d.update_contact?.channel||'none'});
    return {deposit:this.publicDeposit(d),update_channel:d.update_contact?.channel||''};
  }
  reissue(b,active=false,supervised=false){
    const id=this.codes.get(b.event_id+':'+b.collection_code);
    const d=this.deposits.find(item=>item.id===id);
    if(!d||d.booth_id!==b.booth_id||d.packet_id!==b.packet_id||d.location.toUpperCase()!==b.location.toUpperCase()){
      this.error('The reference, shelf, and physical packet label must match.',404);
    }
    if(active&&b.operator!==d.created_by&&!supervised)this.error('Ask the original staff member or a supervisor to refresh this code.',403);
    if(d.active_collection_code&&d.active_collection_code!==b.collection_code||(!active&&!(d.code_expires_at<=this.now()))){
      this.error('Use the current expired reference for this packet.',409);
    }
    if(!Object.values(d.remaining).some(Boolean)||this.collections.some(c=>c.deposit_id===id&&c.status==='RELEASE_RECORDED')){
      this.error('Check the physical balance and finish any pending handover first.',409);
    }
    if(b.custom_code&&!/^[0-9]{4}$/.test(b.custom_code))this.error('Enter four digits.');
    const code=b.custom_code||this.availableCode(b.event_id,b.collection_code);
    if(b.custom_code&&this.codes.has(b.event_id+':'+code))this.error('That code is already used. Choose another.',409);
    this.codes.set(b.event_id+':'+code,id);
    d.active_collection_code=code;
    d.code_expires_at=this.now()+b.valid_minutes*60000;
    d.version++;
    this.record(active?'CODE_REFRESHED':'CODE_REISSUED',d,b.operator,{location:d.location,booth_id:d.booth_id});
    return {deposit:this.publicDeposit(d),collection_code:code};
  }
  async request(url,body=null,supervised=false){
    this.purgeEvidence();
    if(url.startsWith('/api/state?'))return this.state(new URLSearchParams(url.split('?')[1]).get('event_id'));
    if(url==='/api/verify')return this.verify(body||{});
    const b=body||{};if(!b.request_id)this.error('A demo action ID is required.');
    const fingerprint=JSON.stringify([url,b]);const prev=this.requests.get(b.request_id);
    if(prev){
      if(prev.fingerprint!==fingerprint)this.error('This action ID was used for different values.',409,false);
      const d=this.deposits.find(d=>d.id===prev.result.deposit.id);
      const c=prev.result.collection&&this.collections.find(c=>c.id===prev.result.collection.id);
      if(prev.result.collection_code&&d.active_collection_code&&d.active_collection_code!==prev.result.collection_code)this.error('This receipt’s reference was replaced by a supervisor.',409);
      const replay=this.clone(prev.result);
      if(replay.depositor_update&&(replay.depositor_update.channel!==d.update_contact?.channel||
          replay.depositor_update.address!==d.update_contact?.address))delete replay.depositor_update;
      return {...replay,deposit:this.publicDeposit(d),...(c?{collection:this.clone(c)}:{}),replayed:true};
    }
    let result;const release=url.match(/^\/api\/deposits\/([^/]+)\/release$/),handover=url.match(/^\/api\/collections\/([^/]+)\/handover$/);
    const updates=url.match(/^\/api\/deposits\/([^/]+)\/updates$/);
    if(url==='/api/deposits')result=this.create(b);
    else if(url==='/api/admin/reissue'&&supervised)result=this.reissue(b);
    else if(url==='/api/codes/refresh')result=this.reissue(b,true,supervised);
    else if(release)result=this.release(decodeURIComponent(release[1]),b);
    else if(handover)result=this.handover(decodeURIComponent(handover[1]),b,supervised);
    else if(updates)result=this.setUpdates(decodeURIComponent(updates[1]),b);
    else this.error('Unknown demo action.',404);
    this.requests.set(b.request_id,{fingerprint,result:this.clone(result)});return result;
  }
}
if(typeof module!=='undefined')module.exports={DemoStore};
