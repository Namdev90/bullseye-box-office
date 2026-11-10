import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {loadCodeCatalogue} from '../scripts/code-catalogue.mjs';

const source=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8');
const rows=loadCodeCatalogue();
const dateCode=rows.find(([,kind,,score,,,sensitive])=>kind==='Number'&&score<100&&!sensitive)[0];
const restrictedCode=rows.find(([,kind,,,,,sensitive])=>kind==='Word'&&sensitive)[0];
const sandbox={crypto};
vm.runInNewContext('const CODE_MASTER='+JSON.stringify(rows)+';\n'+source('worker/code-policy.js')+'\n'+source('web/demo-store.js')+
  '\nglobalThis.testPolicy={DemoStore,codeWeights};',sandbox);
const {DemoStore,codeWeights}=sandbox.testPolicy;

test('the loaded catalogue has unique four-character strings and consecutive numeric ranks',()=>{
  assert.equal(new Set(rows.map(([code])=>code)).size,rows.length);
  assert.ok(rows.every(([code])=>/^[A-Z0-9]{4}$/.test(code)));
  assert.deepEqual(rows.filter(([,kind,rank])=>kind==='Number'&&rank>=1&&rank<=8).map(row=>row[2]).sort((a,b)=>a-b),
    [1,2,3,4,5,6,7,8]);
});
test('only numeric codes are ranked and matching dates get higher weight',()=>{
  const general=new Map(codeWeights('Festival'));
  assert.ok(!general.has('SINQ')&&!general.has('BULZ')&&!general.has('SATI')&&!general.has(restrictedCode));
  const event=new Map(codeWeights('SinQ Soho Soro Saké Bullseye Satiwa Baby '+dateCode));
  assert.ok([...event.keys()].every(code=>/^[0-9]{4}$/.test(code)));
  assert.ok(event.get('1337')>general.get(dateCode));
  assert.ok(event.get(dateCode)>general.get(dateCode));
});
test('owner overrides weight and eligibility without bypassing event safeguards',()=>{
  const event='Soro '+dateCode;
  const base=new Map(codeWeights(event));
  const edited=new Map(codeWeights(event,{
    SORO:{enabled:false},[dateCode]:{score:100},SINQ:{enabled:true,score:100},[restrictedCode]:{enabled:true,score:100}
  }));
  assert.ok(!edited.has('SORO')&&!edited.has('SINQ')&&!edited.has(restrictedCode));
  assert.ok(edited.get(dateCode)>base.get(dateCode));
  assert.equal(new Map(codeWeights(event,{[dateCode]:{score:null}})).get(dateCode),base.get(dateCode));
});
test('a reserved or excluded candidate falls back to a fresh secure code',()=>{
  const model=new DemoStore({seed:false});
  model.preferredCodes=[['0420',4],['1337',8]];
  const event='training-event-001';
  model.codes.set(event+':0420','already-issued');
  for(let i=0;i<32;i++)assert.equal(model.availableCode(event),'1337');
  for(let i=0;i<32;i++){
    const code=model.availableCode(event,'1337');
    assert.match(code,/^[0-9]{4}$/);
    assert.notEqual(code,'0420');
    assert.notEqual(code,'1337');
  }
});
