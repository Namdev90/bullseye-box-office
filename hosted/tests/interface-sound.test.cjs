'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {runInNewContext}=require('node:vm');
test('interface sound waits for interaction, honors mute and background state, and cannot block an action',()=>{
  let starts=0,clock=1000;const events={};
  const button={disabled:false,id:'tab-collect',classList:{contains:()=>false}};
  class Audio{
    state='running';currentTime=0;destination={};
    createOscillator(){return {frequency:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},start(){starts++;},stop(){},disconnect(){}};}
    createGain(){return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}
  }
  const document={hidden:false,querySelector:()=>null,addEventListener:(type,action)=>events[type]=action};
  const window={AudioContext:Audio};runInNewContext(readFileSync('web/interaction-audio.js','utf8'),{window,document,performance:{now:()=>clock},localStorage:{getItem:()=>null}});
  assert.equal(starts,0);events.click({target:{closest:()=>button}});assert.equal(starts,1);
  document.hidden=true;clock+=200;window.sharePassFeedback('confirm');assert.equal(starts,1);
  document.hidden=false;clock+=200;window.sharePassFeedback('confirm');assert.equal(starts,2);
  runInNewContext(readFileSync('web/interaction-audio.js','utf8'),{window,document,performance:{now:()=>clock},localStorage:{getItem:()=> 'off'}});
  window.sharePassFeedback('open');assert.equal(starts,2);
});
