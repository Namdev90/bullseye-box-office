'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {runInNewContext}=require('node:vm');
const {join}=require('node:path');

// Execute the production acquisition guard, whose syntax is shared by Java and
// JavaScript. This is a source-driven state regression, not an Android UI test.
const source=readFileSync(join(__dirname,'../android-app/src/main/java/in/sharepass/foundation/AppUpdates.java'),'utf8');
const signature='private void check(boolean manual) {';
const start=source.indexOf(signature)+signature.length;
assert(start>=signature.length,'Missing updater check method');
const end=source.indexOf('checking = true;',start);
assert(end>start,'Missing updater acquisition boundary');
const guard=source.slice(start,end);
const cancelSignature='void cancelDownload() {';
const cancelStart=source.indexOf(cancelSignature)+cancelSignature.length;
const cancelEnd=source.indexOf('\n    }',cancelStart);
const cancel=source.slice(cancelStart,cancelEnd);
function fixture({checking=true,cancelled=false,ready=true}={}){
  const messages=[],token={value:cancelled,get(){return this.value;},set(value){this.value=value;}};
  const context={checking,checkingTransfer:token,downloading:null,ready:()=>ready,message:text=>messages.push(text),started:0};
  runInNewContext(`function check(manual){${guard}started++;}\nfunction cancelDownload(){${cancel}}`,context);
  return {context,messages,token};
}

test('manual Check now answers while a cancelled background worker is still stopping',()=>{
  const f=fixture();f.context.cancelDownload();
  assert.equal(f.context.checking,true,'Cancellation must not permit overlapping workers');
  assert.equal(f.token.get(),true);
  f.context.check(true);
  assert.equal(f.messages.length,1,'A manual request must not silently disappear');
  assert.match(f.messages[0],/stopping.*try again/i);
  assert.equal(f.context.started,0);
  f.context.checking=false;f.context.checkingTransfer=null;
  f.context.check(true);assert.equal(f.context.started,1,'Retry is accepted after the worker finishes');
});

test('manual request distinguishes an active check and never starts a second worker',()=>{
  const f=fixture();f.context.check(true);f.context.check(true);
  assert.equal(f.messages.length,2);assert.match(f.messages[0],/already running/i);
  assert.equal(f.context.started,0);assert.equal(f.token.get(),false);
});

test('background checks remain quiet and readiness remains the first guard',()=>{
  const f=fixture({cancelled:true});f.context.check(false);
  assert.deepEqual(f.messages,[]);assert.equal(f.context.started,0);
  const busy=fixture({ready:false,cancelled:true});busy.context.check(true);
  assert.deepEqual(busy.messages,[]);assert.equal(busy.context.started,0);
  const idle=fixture({checking:false});idle.context.check(true);
  assert.deepEqual(idle.messages,[]);assert.equal(idle.context.started,1);
});
