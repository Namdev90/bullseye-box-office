import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';

// The local Worker harness is optional; application builds need no runtime dependency.
test('Workerd validates a published release and rejects redirects without following them',{
  skip:!process.env.SHAREPASS_MINIFLARE_MODULE
},async()=>{
  const {Miniflare,createFetchMock}=createRequire(import.meta.url)(process.env.SHAREPASS_MINIFLARE_MODULE);
  const repository='https://github.com/Namdev90/bullseye-box-office/releases/';
  const manifest={versionCode:25,versionName:'0.9.15',size:180000,sha256:'a'.repeat(64),
    apkUrl:repository+'download/android-v0.9.15/SharePass-Android-0.9.15.apk'};
  const release={draft:false,prerelease:false,tag_name:'android-v0.9.15',html_url:repository+'tag/android-v0.9.15',assets:[
    {name:'SharePass-Android-0.9.15.apk',state:'uploaded',size:manifest.size,digest:'sha256:'+manifest.sha256,browser_download_url:manifest.apkUrl},
    {name:'sharepass-android-update.json',state:'uploaded',size:1000,browser_download_url:repository+'download/android-v0.9.15/sharepass-android-update.json'}]};
  const fetchMock=createFetchMock();fetchMock.disableNetConnect();
  const github=fetchMock.get('https://api.github.com');
  github.intercept({path:'/repos/Namdev90/bullseye-box-office/releases/latest'}).reply(200,JSON.stringify(release));
  github.intercept({path:'/repos/Namdev90/bullseye-box-office/releases/latest'}).reply(302,'',{headers:{Location:'https://untrusted.example/release'}});
  const script=readFileSync('worker/release.js','utf8')+
    '\nexport default {async fetch(){return Response.json({published:await publishedAndroidRelease('+JSON.stringify(manifest)+')});}};';
  const runtime=new Miniflare({modules:true,script,compatibilityDate:'2026-01-01',fetchMock});
  try{
    assert.deepEqual(await (await runtime.dispatchFetch('http://localhost/')).json(),{published:true});
    assert.deepEqual(await (await runtime.dispatchFetch('http://localhost/')).json(),{published:false});
    fetchMock.assertNoPendingInterceptors();
  }finally{await runtime.dispose();await fetchMock.close();}
});
