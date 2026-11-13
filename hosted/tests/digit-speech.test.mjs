import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('code speech requires activation, retains leading zeroes and supports Enter and Space',()=>{
  const source=readFileSync('web/brand.js','utf8'),start=source.indexOf("document.addEventListener('click',event=>{");
  assert(start>=0);
  const listeners={},spoken=[];
  const context={document:{addEventListener:(type,action)=>listeners[type]=action},
    speechSynthesis:{cancel(){},speak:utterance=>spoken.push(utterance.text)},
    SpeechSynthesisUtterance:class{constructor(text){this.text=text;}}};
  context.window=context;runInNewContext(source.slice(start),context);
  const code={textContent:'0042',closest(){return this;},matches(){return true;},click(){listeners.click({target:this});}};
  assert.deepEqual(spoken,[]);
  for(const key of ['Enter',' '])listeners.keydown({key,target:code,preventDefault(){}});
  assert.deepEqual(spoken,['0 0 4 2','0 0 4 2']);
  code.textContent='Not a code';code.click();assert.equal(spoken.length,2);
});
