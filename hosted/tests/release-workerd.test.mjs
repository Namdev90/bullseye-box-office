import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';

// The local Worker harness is optional; application builds need no runtime dependency.
test('Workerd validates a published release and rejects redirects without following them',{
  skip:!process.env.SHAREPASS_MINIFLARE_MODULE
},async()=>{
  const {Miniflare}=createRequire(import.meta.url)(process.env.SHAREPASS_MINIFLARE_MODULE);
  const repository='https://github.com/Namdev90/bullseye-box-office/releases/';
  const manifest={versionCode:25,versionName:'0.9.15',size:180000,sha256:'a'.repeat(64),
    apkUrl:repository+'download/android-v0.9.15/SharePass-Android-0.9.15.apk'};
  const release={draft:false,prerelease:false,tag_name:'android-v0.9.15',html_url:repository+'tag/android-v0.9.15',assets:[
    {name:'SharePass-Android-0.9.15.apk',state:'uploaded',size:manifest.size,digest:'sha256:'+manifest.sha256,browser_download_url:manifest.apkUrl},
    {name:'sharepass-android-update.json',state:'uploaded',size:1000,browser_download_url:repository+'download/android-v0.9.15/sharepass-android-update.json'}]};
  const calls=[];
  const outboundService=request=>{
    calls.push(request.url);
    assert.equal(request.url,'https://api.github.com/repos/Namdev90/bullseye-box-office/releases/latest');
    if(request.headers.has('Authorization')){
      assert.equal(request.headers.get('Authorization'),'Bearer synthetic_read_token');
      return Response.json(release);
    }
    if(calls.length===1)return Response.json(release);
    if(calls.length===2)return new Response(null,{status:302,headers:{Location:'https://untrusted.example/release'}});
    return new Response(null,{status:403,headers:{'X-RateLimit-Remaining':'0'}});
  };
  const script=readFileSync('worker/release.js','utf8')+
    '\nexport default {async fetch(request){return Response.json({published:await publishedAndroidRelease('+JSON.stringify(manifest)+',request.headers.get("Authorization"))});}};';
  const runtime=new Miniflare({cf:false,modules:true,script,compatibilityDate:'2026-01-01',outboundService});
  try{
    assert.deepEqual(await (await runtime.dispatchFetch('http://localhost/')).json(),{published:true});
    assert.deepEqual(await (await runtime.dispatchFetch('http://localhost/')).json(),{published:false});
    assert((await (await runtime.dispatchFetch('http://localhost/')).json()).published.retryAfter>=60);
    assert.equal(calls.length,3,'A redirect must never contact its destination');
    assert((await (await runtime.dispatchFetch('http://localhost/')).json()).published.retryAfter>0);
    assert.equal(calls.length,3,'Anonymous requests respect the quota backoff');
    assert.deepEqual(await (await runtime.dispatchFetch('http://localhost/',{headers:{Authorization:'Bearer synthetic_read_token'}})).json(),{published:true});
    assert.equal(calls.length,4,'Read-only authenticated verification has its own quota');
  }finally{await runtime.dispose();}
});
