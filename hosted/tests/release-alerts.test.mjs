import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPairSync,sign} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

// Synthetic signing keys stay inside this fixture. Production verification is
// pinned to the APK certificate; no private production key is required here.
const keys=generateKeyPairSync('rsa',{modulusLength:2048});
const spki=keys.publicKey.export({type:'spki',format:'der'}).toString('base64');
const signer='0a8b400966fd754c6db2b33b94f78c9898803aff37718fa34c34aef77b642c12';
const repository='https://github.com/Namdev90/bullseye-box-office/releases/';
function release(versionCode=24,versionName='0.9.14',extra={}){
  const manifest={schema:1,packageName:'in.sharepass.foundation',versionCode,versionName,
    apkUrl:repository+'download/android-v'+versionName+'/SharePass-Android-'+versionName+'.apk',
    size:180000,sha256:'a'.repeat(64),signerSha256:signer,...extra};
  const bytes=['sharepass-android-update-v1',manifest.packageName,manifest.versionCode,manifest.versionName,
    manifest.apkUrl,manifest.size,manifest.sha256,manifest.signerSha256,''].join('\n');
  return {...manifest,signature:sign('RSA-SHA256',Buffer.from(bytes),keys.privateKey).toString('base64')};
}
function fixture({published=true,pushStatuses=[],configured=true}={}){
  const sqlite=new DatabaseSync(':memory:');
  for(const file of readdirSync('drizzle').filter(file=>file.endsWith('.sql')).sort())sqlite.exec(readFileSync('drizzle/'+file,'utf8'));
  const DB={prepare(sql){return {bind(...values){
    const stmt=sqlite.prepare(sql),all=()=>({results:stmt.all(...values)}),run=()=>({meta:{changes:stmt.run(...values).changes}});
    return {first:async()=>stmt.get(...values)||null,all,run,execute:()=>stmt.columns().length?all():run()};
  }};},async batch(statements){sqlite.exec('BEGIN');try{const result=statements.map(s=>s.execute());sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  const calls=[],messages=[],clock={now:Date.now()};
  class Clock extends Date{static now(){return clock.now;}}
  let latest=release(),badDigest=false;
  const env={DB,...(configured?{SHAREPASS_FCM_SERVICE_ACCOUNT:JSON.stringify({
    project_id:'fixture-release',client_email:'fixture@fixture-release.iam.gserviceaccount.com',
    private_key:keys.privateKey.export({type:'pkcs8',format:'pem'})})}:{})};
  async function fetchFixture(url,options){
    calls.push(url);
    if(url==='https://api.github.com/repos/Namdev90/bullseye-box-office/releases/latest'){
      assert.equal(options.redirect,'manual','Worker fetch must not follow redirects');
      return Response.json({draft:!published,prerelease:false,tag_name:'android-v'+latest.versionName,
        html_url:repository+'tag/android-v'+latest.versionName,assets:[
          {name:'SharePass-Android-'+latest.versionName+'.apk',state:'uploaded',size:latest.size,
            digest:'sha256:'+(badDigest?'b'.repeat(64):latest.sha256),browser_download_url:latest.apkUrl},
          {name:'sharepass-android-update.json',state:'uploaded',size:1024,
            browser_download_url:repository+'download/android-v'+latest.versionName+'/sharepass-android-update.json'}]});
    }
    if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'fixture-access',expires_in:3600});
    assert.equal(url,'https://fcm.googleapis.com/v1/projects/fixture-release/messages:send');
    const message=JSON.parse(options.body).message;messages.push(message);
    return new Response('{}',{status:pushStatuses.shift()??200,headers:{'Content-Type':'application/json'}});
  }
  const sandbox={Request,Response,Headers,URL,URLSearchParams,TextEncoder,TextDecoder,Uint8Array,Uint32Array,crypto,
    btoa,atob,AbortSignal,Date:Clock,fetch:fetchFixture};
  const source=readFileSync('dist/server/index.js','utf8')
    .replace(/const ANDROID_RELEASE_SPKI='[^']+';/,"const ANDROID_RELEASE_SPKI='"+spki+"';")
    .replace('export default {async fetch','globalThis.worker={async fetch');
  runInNewContext(source,sandbox);
  async function call(manifest=latest){
    const response=await sandbox.worker.fetch(new Request('https://test.example/api/public/android-release',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(manifest)}),env);
    return {status:response.status,body:await response.json()};
  }
  function phone(id,{active=1,expires=clock.now+3600000,version=23,notifications=1,registered=true}={}){
    sqlite.prepare(`INSERT INTO sharepass_configured_devices(workspace,id,staff_id,label,invite,setup_code,invite_expires,digest,session_expires,active)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run('private-workspace',id,'private-operator','Private employee '+id,crypto.randomUUID(),'',0,'digest-'+id,expires,active);
    sqlite.prepare(`INSERT INTO sharepass_device_status(device_id,first_connected_at,last_seen_at,app_version_code,notifications_enabled)
      VALUES(?,?,?,?,?)`).run(id,clock.now,clock.now,version,notifications);
    if(registered)sqlite.prepare('INSERT INTO sharepass_push_tokens(device_id,token) VALUES(?,?)').run(id,'fixture-push-token-'+id);
  }
  return {call,phone,sqlite,calls,messages,clock,setLatest:value=>{latest=value;},badDigest:()=>{badDigest=true;},close:()=>sqlite.close()};
}

test('release broadcasts reject forged, altered, old, draft and mismatched published artifacts',async t=>{
  const f=fixture();t.after(f.close);
  assert.equal((await f.call({...release(),sha256:'b'.repeat(64)})).status,400);
  assert.equal((await f.call(release(23,'0.9.13'))).status,400);
  assert.equal((await f.call(release(24,'0.9.14',{apkUrl:'https://untrusted.example/update.apk'}))).status,400);
  assert.equal((await f.call({...release(),unexpected:'extra'})).status,400);
  assert.equal(f.calls.length,0);
  assert.equal(f.sqlite.prepare('SELECT version_code FROM sharepass_android_release_state').get().version_code,23);
  const draft=fixture({published:false});t.after(draft.close);
  assert.equal((await draft.call()).status,409);assert.equal(draft.messages.length,0);
  f.badDigest();assert.equal((await f.call()).status,409);assert.equal(f.messages.length,0);
});

test('a published signed release notifies only eligible paired phones, privately and idempotently',async t=>{
  const f=fixture();t.after(f.close);
  f.phone('ready');f.phone('revoked',{active:0});f.phone('expired',{expires:f.clock.now-1});
  f.phone('updated',{version:24});f.phone('denied',{notifications:0});f.phone('unregistered',{registered:false});
  const accepted=await f.call();
  assert.equal(accepted.status,200);assert.equal(accepted.body.accepted,true);
  assert.equal(accepted.body.delivered,1);assert.equal(accepted.body.pending,0);assert.equal(accepted.body.failed,0);
  assert.equal(f.messages.length,1);
  const message=f.messages[0];
  assert.equal(message.token,'fixture-push-token-ready');
  assert.deepEqual(message.data,{type:'sharepass_update',version_code:'24',version_name:'0.9.14'});
  assert.equal(message.android.notification.channel_id,'app_updates');
  assert.ok(!JSON.stringify(message).includes('Private employee'));
  assert.ok(!JSON.stringify(message).includes('private-workspace'));
  assert.equal((await f.call()).body.delivered,1);assert.equal(f.messages.length,1);
  assert.equal((await f.call(release(24,'0.9.14',{sha256:'b'.repeat(64)}))).status,409);
});

test('concurrent release hooks claim each phone once and later versions supersede old announcements',async t=>{
  const f=fixture();t.after(f.close);f.phone('ready');
  const concurrent=await Promise.all([f.call(),f.call()]);
  assert.deepEqual(concurrent.map(x=>x.status),[200,200]);assert.equal(f.messages.length,1);
  const newer=release(25,'0.9.15');f.setLatest(newer);
  assert.equal((await f.call(newer)).status,200);assert.equal(f.messages.length,2);
  assert.equal((await f.call(release())).status,409);assert.equal(f.messages.length,2);
});

test('delivery retries are bounded and leased, while missing push configuration is reported honestly',async t=>{
  const f=fixture({pushStatuses:[503,503,503]});t.after(f.close);f.phone('retry');
  assert.equal((await f.call()).body.pending,1);assert.equal(f.messages.length,1);
  assert.equal((await f.call()).body.pending,1);assert.equal(f.messages.length,1);
  f.clock.now+=60001;assert.equal((await f.call()).body.pending,1);assert.equal(f.messages.length,2);
  f.clock.now+=60001;const exhausted=await f.call();
  assert.equal(exhausted.body.pending,0);assert.equal(exhausted.body.failed,1);assert.equal(f.messages.length,3);
  f.clock.now+=60001;await f.call();assert.equal(f.messages.length,3);
  const missing=fixture({configured:false});t.after(missing.close);missing.phone('ready');
  const accepted=await missing.call();assert.equal(accepted.status,200);assert.equal(accepted.body.configured,false);
  assert.equal(missing.messages.length,0);
});
