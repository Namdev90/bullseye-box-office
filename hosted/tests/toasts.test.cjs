'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {runInNewContext}=require('node:vm');

test('action toast replaces its text and timer, hides in background and keeps messages as text',()=>{
  const source=readFileSync('web/brand.js','utf8').split('let feedbackToast,feedbackTimer;')[1].split('window.sharePassCopyText=')[0];
  const nodes=[],timers=new Map(),events={};let next=0;
  const document={hidden:false,body:{append:node=>nodes.push(node)},
    createElement:()=>({setAttribute(key,value){this[key]=value;}}),addEventListener:(name,callback)=>events[name]=callback};
  const window={};runInNewContext('let feedbackToast,feedbackTimer;'+source,{window,document,
    setTimeout:callback=>{timers.set(++next,callback);return next;},clearTimeout:id=>timers.delete(id)});
  window.sharePassToast('<script>example</script>');
  assert.equal(nodes.length,1);assert.equal(nodes[0].textContent,'<script>example</script>');
  assert.equal(nodes[0]['aria-hidden'],'true');
  window.sharePassToast('Confirmed');assert.equal(nodes.length,1);assert.equal(timers.size,1);
  assert.equal(nodes[0].textContent,'Confirmed');[...timers.values()][0]();assert.equal(nodes[0].hidden,true);
  window.sharePassToast('Copied');document.hidden=true;events.visibilitychange();assert.equal(nodes[0].hidden,true);
  window.sharePassToast('Background');assert.equal(nodes[0].textContent,'Copied');assert.equal(timers.size,0);
});

test('viewing current or completed history receipts does not announce a new custody action',()=>{
  const source=readFileSync('web/counter.js','utf8');
  const receipt=source.slice(source.indexOf('function showReceipt('),source.indexOf('\nfunction openShare('));
  const balance=source.slice(source.indexOf('function showBalance('),source.indexOf('\nconst updatesForm='));
  const toasts=[],elements=new Map(),input={collection_code:'0007',deposit:{remaining:{normal:0}},depositor_name:'Synthetic'};
  const byId=id=>{if(!elements.has(id))elements.set(id,{replaceChildren(){},append(){}});return elements.get(id);};
  runInNewContext(receipt+'\n'+balance+'\nshowReceipt(input);showBalance(input);',{
    window:{sharePassToast:message=>toasts.push(message)},byId,input,register:false,show(){},balance:()=>'',sharePassPhone:()=>false});
  assert.deepEqual(toasts,[]);assert.equal(byId('saved-code').textContent,'0007');
});

test('current receipt offers the authenticated named WhatsApp update directly without announcing a new deposit',()=>{
  const source=readFileSync('web/counter.js','utf8');
  const render=source.slice(source.indexOf('function showReceipt('),source.indexOf('\nfunction openShare('));
  const elements=new Map(),links=[],toasts=[];
  const byId=id=>{if(!elements.has(id))elements.set(id,{replaceChildren(){},append(link){links.push(link);}});return elements.get(id);};
  const input={collection_code:'0007',depositor_name:'Taylor Example',deposit:{depositor_label:'Taylor Example'},depositor_update:{channel:'whatsapp',address:'12025550123',name:'Riya',message:'Group passes remaining: 4 Normal'}};
  runInNewContext(render+'\nshowReceipt(input);',{byId,input,register:false,show(){},sharePassPhone:()=>false,
    window:{sharePassToast:text=>toasts.push(text)},draft:{composeLink:(details,label)=>({details,label,classList:{add(){}}})}});
  assert.equal(links.length,1);assert.equal(links[0].details.name,'Riya');assert.equal(links[0].details.address,'12025550123');assert.equal(links[0].label,'Depositor update');assert.equal(toasts.length,0);
  delete input.depositor_name;links.length=0;
  runInNewContext(render+'\nshowReceipt(input);',{byId,input,register:false,show(){},sharePassPhone:()=>false,window:{},draft:{composeLink:(details,label)=>({details,label,classList:{add(){}}})}});
  assert.equal(links[0].details.name,'Riya');
});

test('confirmed handover shows both roles and names the depositor message button',()=>{
  const source=readFileSync('web/counter.js','utf8'),render=source.slice(source.indexOf('function showBalance('),source.indexOf('\nconst updatesForm='));
  const nodes=new Map(),links=[];const byId=id=>{if(!nodes.has(id))nodes.set(id,{replaceChildren(){},append(value){links.push(value);}});return nodes.get(id);};
  const result={deposit:{depositor_label:'Taylor Example',remaining:{normal:1}},collection:{collector_label:'Riya'},depositor_update:{channel:'whatsapp',address:'12025550110',name:'Taylor Example',message:'Hi Taylor Example! We handed over 2 Normal to Riya.'}};
  runInNewContext(render+'\nshowBalance(result);',{byId,result,balance:()=> '1 Normal',show(){},sharePassPhone:()=>true,draft:{composeLink:details=>details}});
  assert.match(nodes.get('handover-people').textContent,/Depositor: Taylor Example · Collector: Riya/);
  assert.equal(links[0].name,'Taylor Example');assert.match(links[0].message,/to Riya/);
  delete result.collection;result.last_collection={collector_label:'Omar'};
  runInNewContext(render+'\nshowBalance(result);',{byId,result,balance:()=> 'No passes remaining',show(){},sharePassPhone:()=>true,draft:{composeLink:details=>details}});
  assert.match(nodes.get('handover-people').textContent,/Last collector: Omar/);
});
