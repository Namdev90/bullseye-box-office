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
