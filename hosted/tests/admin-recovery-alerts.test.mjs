import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync('web/admin.js','utf8');
test('administration offers staff names without booth choices, including when starting empty',()=>{
 const elements=new Map(),select={value:'',options:[],replaceChildren(...options){this.options=options;}};
 const byId=id=>{if(!elements.has(id))elements.set(id,{replaceChildren(){}});return elements.get(id);};
 const sandbox={Map,Option:function(text,value){return {text,value};},setupPeople:[],messageForm:{elements:{recipient_id:select}},byId,
   deviceList:{replaceChildren(){},append(){}},openInvite:{},item:()=>({append(){}}),document:{createElement:()=>({})}};
 const end=source.indexOf('\ninviteForm.elements.staff_name',source.indexOf('function renderSetup('));
 const render=runInNewContext('('+source.slice(source.indexOf('function renderSetup('),end)+')',sandbox);
 render({staff:[{id:'person-one',name:'Asha'}],devices:[],booths:[{id:'old',name:'Legacy partition',archived:1}]});
 assert.deepEqual(select.options.map(option=>option.text),['All staff','Asha']);assert.equal(sandbox.openInvite.disabled,false);
 render({staff:[],devices:[],booths:[]});assert.equal(sandbox.openInvite.disabled,false);
 const html=readFileSync('web/admin.html','utf8');assert(!html.includes('Add booth'));assert(!html.includes('name="booth_id"'));assert(html.includes('name="staff_name"'));
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
