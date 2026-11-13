'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const tool=import('../tools/announce-sharepass-release.mjs');
const version=24;
const sensitive='SYNTHETIC_SIGNATURE_DO_NOT_LOG';
// Deliberate whitespace makes byte preservation testable. Cryptographic release
// verification belongs to the existing publication gate, not this mocked sender.
const bytes=Buffer.from('{\n  "schema": 1, "packageName":"in.sharepass.foundation",\n  "versionCode":24,"signature":"'+sensitive+'"\n}\n');
const status=(delivered,pending,failed=0,extra={})=>({accepted:true,version_code:version,configured:true,delivered,pending,failed,...extra});

async function fixture(responses,limits={}){
  const {announceVerifiedRelease,releaseAnnouncementUrl}=await tool;
  let clock=0,index=0;const calls=[],waits=[];
  const result=await announceVerifiedRelease({manifestBytes:bytes,expectedVersionCode:version,limits,
    now:()=>clock,sleep:async ms=>{waits.push(ms);clock+=ms;},
    fetchImpl:async(url,options)=>{
      calls.push({url,options});assert.equal(url,releaseAnnouncementUrl);
      assert.strictEqual(options.body,bytes,'Every retry posts the exact verified buffer');
      assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');
      assert.deepEqual(Object.keys(options.headers).sort(),['Accept','Content-Type']);
      const response=responses[Math.min(index++,responses.length-1)];
      if(response instanceof Error)throw response;
      if(response instanceof Response)return response.clone();
      return Response.json(response);
    }});
  return {result,calls,waits,clock};
}

test('drains multiple twelve-device batches using identical manifest bytes and cumulative totals',async()=>{
  const f=await fixture([status(12,15),status(24,3),status(27,0)]);
  assert.equal(f.result.complete,true);assert.equal(f.result.delivered,27);
  assert.equal(f.calls.length,3);assert.deepEqual(f.waits,[]);
});

test('waits the full sixty-second lease when counts stop progressing',async()=>{
  const f=await fixture([status(12,3),status(12,3),status(15,0)]);
  assert.equal(f.result.complete,true);assert.deepEqual(f.waits,[60000]);
});

test('honors upstream Retry-After and stops when that window exceeds the bounded run',async()=>{
  const response=seconds=>new Response('{}',{status:503,headers:{'Retry-After':String(seconds)}});
  const waited=await fixture([response(120),status(1,0)]);
  assert.equal(waited.result.complete,true);assert.deepEqual(waited.waits,[120000]);
  const bounded=await fixture([response(900),status(1,0)]);
  assert.equal(bounded.result.reason,'transport_budget');assert.equal(bounded.result.retry_after_seconds,900);
  assert.equal(bounded.calls.length,1);assert.deepEqual(bounded.waits,[]);
});

test('an initially leased batch waits before retrying and does not falsely complete',async()=>{
  const f=await fixture([status(0,4),status(4,0)]);
  assert.deepEqual(f.waits,[60000]);assert.equal(f.result.delivered,4);
});

test('pending devices are bounded by both call and elapsed-time budgets',async()=>{
  const calls=await fixture([status(1,50),status(2,49),status(3,48)],{maxCalls:2});
  assert.equal(calls.result.complete,false);assert.equal(calls.result.reason,'pending_budget');
  assert.equal(calls.calls.length,2);assert.equal(calls.result.pending,49);
  const time=await fixture([status(0,1)],{maxElapsedMs:120001});
  assert.equal(time.result.reason,'pending_budget');assert.equal(time.calls.length,3);
  assert.deepEqual(time.waits,[60000,60000]);assert.equal(time.clock,120000);
});

test('missing sender configuration is a warning even when all returned counts are zero',async()=>{
  const f=await fixture([status(0,0,0,{configured:false})]);
  assert.equal(f.result.complete,false);assert.equal(f.result.reason,'not_configured');assert.equal(f.calls.length,1);
});

test('continues healthy pending batches but warns if any devices exhaust attempts',async()=>{
  const f=await fixture([status(12,3,1),status(15,0,1)]);
  assert.equal(f.calls.length,2);assert.equal(f.result.complete,false);
  assert.equal(f.result.reason,'delivery_failed');assert.equal(f.result.delivered,15);assert.equal(f.result.failed,1);
});

test('transport and server failures use bounded identical retries without leaking response bodies',async()=>{
  const f=await fixture([new Error(sensitive),new Response(sensitive,{status:503}),status(2,0)]);
  assert.equal(f.result.complete,true);assert.deepEqual(f.waits,[60000,60000]);
  assert(!JSON.stringify(f.result).includes(sensitive));
  const failed=await fixture([new Error(sensitive)]);
  assert.equal(failed.calls.length,3);assert.equal(failed.result.reason,'transport_failed');
});

test('a rejected version is not retried and cannot be reported as accepted delivery',async()=>{
  const f=await fixture([new Response(JSON.stringify({error:sensitive}),{status:409})]);
  assert.equal(f.result.complete,false);assert.equal(f.result.reason,'rejected');assert.equal(f.calls.length,1);
  assert(!JSON.stringify(f.result).includes(sensitive));
  const acceptedFalse=await fixture([status(1,0,0,{accepted:false})]);
  assert.equal(acceptedFalse.result.reason,'rejected');
});

test('malformed, mismatched, fractional and decreasing cumulative counts fail closed',async t=>{
  for(const patch of [{version_code:25},{delivered:-1},{pending:'0'},{failed:.5},{configured:'true'},
    {delivered:Number.MAX_SAFE_INTEGER,pending:1},{pending:undefined}])await t.test(JSON.stringify(patch),async()=>{
      const f=await fixture([status(1,0,0,patch)]);
      assert.equal(f.result.reason,'malformed_response');assert.equal(f.result.complete,false);
    });
  const malformed=await fixture([new Response('not JSON',{status:200})]);
  assert.equal(malformed.result.reason,'malformed_response');
  const decreasing=await fixture([status(12,5),status(11,4)]);
  assert.equal(decreasing.result.reason,'non_cumulative_response');assert.equal(decreasing.result.delivered,12);
});

test('invalid manifests and version mismatch make no HTTP requests',async()=>{
  const {announceVerifiedRelease}=await tool;let calls=0;
  for(const manifestBytes of [Buffer.from('bad '+sensitive),Buffer.alloc(8193),bytes]){
    const result=await announceVerifiedRelease({manifestBytes,expectedVersionCode:25,fetchImpl:async()=>{calls++;throw Error('Must not fetch');}});
    assert.equal(result.reason,'invalid_manifest');
  }
  assert.equal(calls,0);
});

test('CLI writes explicit GitHub warnings and summaries without manifest, signature or raw errors',async()=>{
  const {runAnnouncementCli}=await tool;
  for(const reason of ['not_configured','delivery_failed','pending_budget','malformed_response','transport_failed','rejected']){
    const logs=[],summaries=[];
    const code=await runAnnouncementCli(['verified.json','24'],{
      readFileImpl:async()=>bytes,announce:async input=>{
        assert.strictEqual(input.manifestBytes,bytes);return {complete:false,reason,version_code:24,calls:2,delivered:12,pending:3,failed:1};
      },summaryPath:'synthetic-summary',appendFileImpl:async(path,text)=>{assert.equal(path,'synthetic-summary');summaries.push(text);},log:text=>logs.push(text)
    });
    assert.equal(code,1);assert(logs.some(line=>line.startsWith('::warning ')));
    assert.match(summaries.join(''),/notification completion was not verified/);
    assert.match(summaries.join(''),/Still pending \| 3/);
    assert(![...logs,...summaries].join('').includes(sensitive));
  }
  const logs=[];
  await runAnnouncementCli(['verified.json','24'],{readFileImpl:async()=>{throw Error(sensitive);},summaryPath:null,log:line=>logs.push(line)});
  assert(!logs.join('').includes(sensitive));assert.match(logs.join(''),/could not be read/);
});

test('success summary distinguishes push-service acceptance from handset installation',async()=>{
  const {runAnnouncementCli}=await tool;const logs=[];
  const code=await runAnnouncementCli(['verified.json','24'],{readFileImpl:async()=>bytes,
    announce:async()=>({complete:true,version_code:24,calls:3,delivered:27,pending:0,failed:0}),
    summaryPath:null,log:line=>logs.push(line)});
  assert.equal(code,0);assert(!logs.some(line=>line.startsWith('::warning ')));
  assert.match(logs.join(''),/does not confirm handset receipt or installation/);
});

test('workflow only announces a verified published latest release in a separate nonblocking step',()=>{
  const source=readFileSync(new URL('../../.github/workflows/sharepass-android-release.yml','file://'+__filename),'utf8');
  const publish=source.indexOf('id: publish_release'),announcement=source.indexOf('name: Announce the verified latest Android update');
  assert(publish>=0&&announcement>publish);
  const step=source.slice(announcement);
  assert.match(step,/inputs\.promote_latest/);assert.match(step,/steps\.publish_release\.outcome == 'success'/);
  assert.match(step,/continue-on-error: true/);assert.match(step,/steps\.publish_release\.outputs\.manifest_path/);
  assert(source.indexOf('"$(snapshot "$dir/published.json")"')<source.indexOf('manifest_path=%s'));
});
