import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

test('administrator replies retain uncertain intent, reject changed retries and do not send when journaling fails',async()=>{
  const source=readFileSync('web/admin.js','utf8');
  const start=source.indexOf('async function replyAdminMessage('),end=source.indexOf('messageForm.onsubmit',start);
  assert(start>=0&&end>start);
  const saved=new Map(),sent=[],committed=new Map(),status={textContent:''};let loseReply=true,failStorage=false;
  const context={window:{},adminReplying:new Set(),byId:()=>status,loadStaffMessages:async()=>{},
    sessionStorage:{getItem:key=>saved.get(key)||null,setItem(key,value){if(failStorage)throw new Error('Storage failure');saved.set(key,value);},removeItem:key=>saved.delete(key)},
    request:async(path,body)=>{assert.equal(path,'/api/admin/staff-messages/reply');sent.push({...body});committed.set(body.id,body.reply);if(loseReply){loseReply=false;throw new Error('Synthetic lost reply');}return {replied:true};}};
  const reply=runInNewContext('('+source.slice(start,end).trim()+')',context),message={id:'synthetic-message'};
  await reply(message,'working');assert.equal(saved.size,1);assert.match(status.textContent,/not confirmed/);
  await reply(message,'done');assert.equal(sent.length,1,'An uncertain reply cannot change its original choice');
  await reply(message,'working');assert.equal(saved.size,0);assert.equal(committed.size,1);assert.equal(committed.get(message.id),'working');
  failStorage=true;await reply({id:'second-message'},'done');assert.equal(sent.length,2);assert.equal(committed.has('second-message'),false);
});
