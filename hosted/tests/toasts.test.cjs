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
