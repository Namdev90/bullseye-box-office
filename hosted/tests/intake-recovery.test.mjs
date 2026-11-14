import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync('web/intake.js','utf8');
function page(storage=new Map()){
 const nodes=new Map(),seen=[];
 const document={getElementById(id){if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);}};
 const context={document,booth:true,token:'synthetic-booth',requestId:undefined,submission:undefined,alertKey:'',navigator:{},window:{},crypto,
  form:{elements:{name:{value:'Taylor'},phone:{value:'+12025550101'}}},guestPhone:{value:'+12025550101'},quantities:{normal:2,vip:0,vvip:0,mip:1},
  people:()=>[],sharePassPhone:()=> '12025550101',errorLine:{},sessionStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},
  showReceipt:value=>seen.push(value),setTimeout:()=>0,location:{hash:'',pathname:'/booth/synthetic-booth',search:''}};
 return {context,storage,seen};
}
function submitHandler(context){runInNewContext(source.slice(source.indexOf('form.onsubmit=async event=>{'),source.indexOf('(async()=>{',source.indexOf('form.onsubmit=async event=>{'))),context);return ()=>context.form.onsubmit({preventDefault(){}});}

test('public intake saves immutable intent before sending and retries a lost reply with the same ID and details',async()=>{
 const p=page(),sent=[];let lose=true;
 p.context.customerRequest=async body=>{
  const saved=JSON.parse(p.storage.get('sharepass-receipt:synthetic-booth'));assert.equal(saved.ticket,body.request_id);assert.deepEqual(saved.body,JSON.parse(JSON.stringify(body)));
  sent.push(JSON.stringify(body));if(lose){lose=false;throw Error('Lost accepted reply');}return {status:'submitted'};
 };
 const submit=submitHandler(p.context);await submit();assert.equal(p.seen.length,0);
 p.context.form.elements.name.value='Edited after loss';p.context.quantities.normal=9;
 await submit();assert.equal(sent.length,2);assert.equal(sent[0],sent[1]);assert.equal(p.seen[0].status,'submitted');
 assert.equal(p.storage.get('sharepass-receipt:synthetic-booth'),JSON.parse(sent[0]).request_id);
});

test('storage failure sends nothing and transient startup lookup preserves the original submission',async()=>{
 const p=page();let posts=0;p.context.customerRequest=async()=>{posts++;return {status:'submitted'};};
 p.context.sessionStorage.setItem=()=>{throw Error('Storage unavailable');};await submitHandler(p.context)();assert.equal(posts,0);
 const ticket=crypto.randomUUID(),body={request_id:ticket,name:'Taylor',quantities:{normal:2},recipients:[],intake_version:2};
 p.storage.set('sharepass-receipt:synthetic-booth',JSON.stringify({ticket,body,created_at:Date.now()}));
 p.context.sessionStorage.setItem=(key,value)=>p.storage.set(key,value);
 p.context.customerRequest=async(_,id)=>{if(id)throw Error('Offline lookup');return {booth:'Synthetic booth'};};
 await runInNewContext(source.slice(source.lastIndexOf('(async()=>{')),p.context);
 assert.equal(p.context.requestId,ticket);assert.equal(p.context.submission.body.request_id,ticket);assert.equal(p.seen.at(-1).status,'submitted');
 assert(p.storage.get('sharepass-receipt:synthetic-booth').includes(ticket));
});

test('missing unexpired submission retries the saved payload, but old intent cannot create another waiting deposit',async()=>{
 for(const expired of [false,true]){
  const p=page(),ticket=crypto.randomUUID();let posts=0;
  Object.assign(p.context,{requestId:ticket,submission:{ticket,body:{request_id:ticket,name:'Original'},created_at:Date.now()-(expired?7200001:0)},receiptChecking:false,receiptCheck:0,receiptFailures:0,lastReceipt:'submitted',lastCode:undefined,scheduleReceiptPoll(){}});
  p.context.customerRequest=async body=>{if(!body)throw Object.assign(Error('Not found'),{status:404});posts++;assert.equal(body.request_id,ticket);return {status:'submitted'};};
  const start=source.indexOf('async function checkReceipt(){'),end=source.indexOf("document.getElementById('check-receipt').onclick",start);
  await runInNewContext(source.slice(start,end)+'\ncheckReceipt();',p.context);
  assert.equal(posts,expired?0:1);assert.equal(p.context.requestId,ticket);
  assert.equal(p.context.submission===null,!expired);
 }
});
