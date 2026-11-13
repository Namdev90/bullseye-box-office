import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync('web/admin.js','utf8');
test('archived booths remain selectable for recovery but never for a new invitation',()=>{
  const select=()=>({value:'old',options:[],replaceChildren(...options){this.options=options;this.value=options[0]?.value||'';}});
  const invite=select(),reissue=select(),message=select();
  const form={elements:{booth_id:reissue}};
  const sandbox={Map,Option:function(text,value){return {text,value};},
    messageForm:{elements:{booth_id:message}},inviteForm:{elements:{booth_id:invite}},reissueForm:form,
    boothList:{replaceChildren(){},append(){}},deviceList:{replaceChildren(){},append(){}},openInvite:{},
    item:()=>({append(){}}),document:{createElement:()=>({})},updateSetup(){}};
  const render=runInNewContext('('+source.slice(source.indexOf('function renderSetup('),source.indexOf('\nasync function updateSetup('))+')',sandbox);
  const data={booths:[{id:'new',name:'Active'},{id:'old',name:'Archived',archived:1}],staff:[],devices:[]};
  render(data);
  assert.deepEqual(invite.options.map(option=>option.value),['new']);assert.equal(invite.value,'new');
  assert.deepEqual(reissue.options.map(option=>option.value),['new','old']);assert.equal(reissue.value,'old');
  assert.equal(sandbox.openInvite.disabled,false);
  render({...data,booths:[data.booths[1]]});
  assert.equal(invite.options.length,0);assert.equal(sandbox.openInvite.disabled,true);
  assert.equal(reissue.options[0].value,'old');
});

test('administrator browser alerts use an owner endpoint and an independent worker scope',async()=>{
  const calls=[],subscription={endpoint:'https://fcm.googleapis.com/fcm/send/synthetic-owner'};
  const registration={active:{state:'activated'},pushManager:{async getSubscription(){return subscription;}}};
  const navigator={serviceWorker:{async register(script,options){calls.push({script,options});return registration;}}};
  const timers=new Set();
  const sandbox={window:{Notification:{},PushManager:{}},Notification:{permission:'granted'},navigator,
    setTimeout:callback=>{timers.add(callback);return callback;},clearTimeout:callback=>timers.delete(callback),
    Uint8Array,atob,request:async(path,body)=>{calls.push({path,body});return {public_key:'A'.repeat(87)};}};
  const enable=runInNewContext('('+source.slice(source.indexOf('async function enableAdminAlerts('),source.indexOf("\nnavigator.serviceWorker?.addEventListener",source.indexOf('async function enableAdminAlerts(')))+')',sandbox);
  await enable();
  assert.equal(calls[0].path,'/api/admin/web-push');assert.equal(calls[1].script,'/queue-alert-worker.js');
  assert.equal(calls[1].options.scope,'/admin-alerts/');assert.equal(calls[2].path,'/api/admin/web-push');
  assert.equal(calls[2].body.endpoint,subscription.endpoint);
  calls.length=0;sandbox.Notification.permission='denied';await enable();assert.equal(calls.length,0);
  sandbox.Notification.permission='granted';registration.active=null;
  registration.installing={state:'installing',addEventListener(name,callback){this.state='activated';callback();},removeEventListener(){}};
  await enable();assert.equal(calls.at(-1).body.endpoint,subscription.endpoint);assert.equal(timers.size,0);
  registration.installing.state='redundant';registration.installing.addEventListener=()=>{};
  await assert.rejects(enable(),/could not start/);assert.equal(timers.size,0);
});

test('administrator notification clicks open Administration while staff notifications keep the staff desk',()=>{
  for(const [scope,target] of [['https://test.example/admin-alerts/','/admin'],['https://test.example/','/staff']]){
    const events={},opened=[];
    runInNewContext(readFileSync('web/queue-alert-worker.js','utf8'),{
      self:{registration:{scope},addEventListener:(name,callback)=>events[name]=callback},
      clients:{openWindow:path=>opened.push(path)}});
    events.notificationclick({notification:{close(){}},waitUntil(){}});assert.deepEqual(opened,[target]);
  }
});
