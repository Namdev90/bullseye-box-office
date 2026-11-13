import {readFile,appendFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';

export const releaseAnnouncementUrl='https://bullseye-pass-desk-demo.namubhai.chatgpt.site/api/public/android-release';
export const announcementLimits=Object.freeze({maxCalls:40,maxElapsedMs:360000,requestTimeoutMs:15000,leaseWaitMs:60000,maxTransportFailures:3});

function validVersion(value){
  return Number.isSafeInteger(value)&&value>0&&value<=2100000000;
}

function manifestVersion(bytes,expected){
  if(!(bytes instanceof Uint8Array)||bytes.byteLength===0||bytes.byteLength>8192||!validVersion(expected))return null;
  try{
    const manifest=JSON.parse(Buffer.from(bytes).toString('utf8'));
    if(!manifest||Array.isArray(manifest)||manifest.schema!==1||manifest.packageName!=='in.sharepass.foundation'||
      manifest.versionCode!==expected||typeof manifest.signature!=='string'||!manifest.signature)return null;
    return manifest.versionCode;
  }catch{return null;}
}

function checkedStatus(value,versionCode){
  if(!value||Array.isArray(value)||value.accepted!==true)return {error:'rejected'};
  if(value.version_code!==versionCode||typeof value.configured!=='boolean')return {error:'malformed_response'};
  for(const key of ['delivered','pending','failed']){
    if(!Number.isSafeInteger(value[key])||value[key]<0)return {error:'malformed_response'};
  }
  if(!Number.isSafeInteger(value.delivered+value.pending+value.failed))return {error:'malformed_response'};
  return {status:{accepted:true,version_code:versionCode,configured:value.configured,
    delivered:value.delivered,pending:value.pending,failed:value.failed}};
}

// This is deliberately not a signing tool. The preceding release step verifies
// APK bytes, signer and manifest signature. Reuse those exact bounded bytes,
// without rewriting JSON or allowing a caller-selected notification endpoint.
export async function announceVerifiedRelease({manifestBytes,expectedVersionCode,fetchImpl=globalThis.fetch,
  sleep=delay,now=()=>performance.now(),limits={}}){
  const bounds={...announcementLimits,...limits};
  for(const key of Object.keys(announcementLimits)){
    if(!Number.isSafeInteger(bounds[key])||bounds[key]<=0||bounds[key]>announcementLimits[key]){
      return {complete:false,reason:'invalid_limits',calls:0,version_code:expectedVersionCode};
    }
  }
  const versionCode=manifestVersion(manifestBytes,expectedVersionCode);
  if(!versionCode)return {complete:false,reason:'invalid_manifest',calls:0,version_code:validVersion(expectedVersionCode)?expectedVersionCode:null};
  const started=now();
  let calls=0,last,transportFailures=0;
  const remaining=()=>bounds.maxElapsedMs-(now()-started);
  const report=(reason,complete=false,extra={})=>({complete,reason,calls,version_code:versionCode,
    elapsed_ms:Math.max(0,Math.floor(now()-started)),...(last||{}),...extra});
  async function waitForLease(waitMs=bounds.leaseWaitMs){
    if(calls>=bounds.maxCalls||remaining()<=waitMs)return false;
    await sleep(waitMs);
    return remaining()>0;
  }
  while(calls<bounds.maxCalls&&remaining()>0){
    calls++;
    let response;
    try{
      response=await fetchImpl(releaseAnnouncementUrl,{
        method:'POST',redirect:'error',credentials:'omit',
        headers:{'Content-Type':'application/json',Accept:'application/json'},
        body:manifestBytes,
        signal:AbortSignal.timeout(Math.max(1,Math.min(bounds.requestTimeoutMs,Math.floor(remaining()))))
      });
    }catch{
      if(++transportFailures>=bounds.maxTransportFailures)return report('transport_failed');
      if(!await waitForLease())return report('transport_budget');
      continue;
    }
    if(!response||typeof response.ok!=='boolean'||!Number.isInteger(response.status))return report('malformed_response');
    if(!response.ok){
      // Retrying the identical signed operation is safe after a transient failure.
      // Rejected signatures/versions and other client errors require a review.
      if(response.status===429||response.status>=500&&response.status<=599){
        if(++transportFailures>=bounds.maxTransportFailures)return report('transport_failed',false,{http_status:response.status});
        const seconds=Number(response.headers?.get?.('Retry-After'));
        const waitMs=Number.isSafeInteger(seconds)&&seconds>0&&Number.isSafeInteger(seconds*1000)?Math.max(bounds.leaseWaitMs,seconds*1000):bounds.leaseWaitMs;
        if(!await waitForLease(waitMs))return report('transport_budget',false,{http_status:response.status,...(seconds>0?{retry_after_seconds:seconds}:{})});
        continue;
      }
      return report('rejected',false,{http_status:response.status});
    }
    let raw;
    try{raw=await response.json();}catch{return report('malformed_response');}
    const parsed=checkedStatus(raw,versionCode);
    if(parsed.error)return report(parsed.error);
    const current=parsed.status;
    transportFailures=0;
    if(!current.configured){
      // A missing sender reports zeroes, which do not erase earlier confirmed
      // delivery counts from this invocation.
      last={...current,...(last?{delivered:last.delivered,pending:last.pending,failed:last.failed}:{})};
      return report('not_configured');
    }
    if(last&&(current.delivered<last.delivered||current.failed<last.failed))return report('non_cumulative_response');
    const progressed=last?current.delivered>last.delivered||current.failed>last.failed||current.pending<last.pending:
      current.delivered>0||current.failed>0;
    last=current;
    if(current.pending===0)return report(current.failed?'delivery_failed':'complete',current.failed===0);
    if(calls>=bounds.maxCalls||remaining()<=0)return report('pending_budget');
    // A request delivers at most twelve targets. Drain progressing batches
    // immediately, but give a stalled or retrying batch its full 60-second lease.
    if(!progressed&&!await waitForLease())return report('pending_budget');
  }
  return report('pending_budget');
}

const reasons={
  invalid_limits:'The announcement retry limits were invalid.',
  invalid_manifest:'The verified manifest input was missing, malformed, oversized, or did not match the approved version.',
  rejected:'The release announcement was rejected. Review the published latest release and signed manifest before retrying.',
  malformed_response:'The notification endpoint returned malformed status or counts; completion was not verified.',
  non_cumulative_response:'The notification endpoint returned decreasing cumulative counts; completion was not verified.',
  not_configured:'The notification sender is not configured; notification completion was not verified.',
  transport_failed:'The notification endpoint could not be reached successfully within the transport retry limit.',
  transport_budget:'The notification retry budget ended during a transport failure.',
  pending_budget:'The notification retry budget ended with eligible devices still pending.',
  delivery_failed:'One or more eligible devices exhausted notification delivery attempts.',
  input_unavailable:'The verified manifest file could not be read.',
  unexpected_failure:'The notification step could not verify completion.'
};

export function announcementSummary(result){
  const version=validVersion(result.version_code)?result.version_code:'unknown';
  const known=Number.isSafeInteger(result.delivered)&&Number.isSafeInteger(result.pending)&&Number.isSafeInteger(result.failed);
  const lines=['### SharePass Android update notification',
    '',`Published Android version code: **${version}**.`,
    '',result.complete?'The push service accepted the eligible notification batches.':
      '**Warning: notification completion was not verified.** '+(reasons[result.reason]||reasons.unexpected_failure),
    '',`Announcement requests: ${Number.isSafeInteger(result.calls)?result.calls:0}.`];
  if(known)lines.push('', '| Last acknowledged cumulative status | Devices |',
    '| --- | ---: |',`| Accepted by the push service | ${result.delivered} |`,
    `| Still pending | ${result.pending} |`,`| Delivery attempts exhausted | ${result.failed} |`);
  else lines.push('','No valid cumulative delivery counts were acknowledged.');
  lines.push('', 'Push-service acceptance does not confirm handset receipt or installation. The verified APK publication is independent of this notification result.');
  if(!result.complete)lines.push('', 'After addressing the warning, retry with the same exact published signed manifest. Previously acknowledged deliveries are not sent again.');
  return lines.join('\n')+'\n';
}

export async function runAnnouncementCli(args,{readFileImpl=readFile,announce=announceVerifiedRelease,
  appendFileImpl=appendFile,summaryPath=process.env.GITHUB_STEP_SUMMARY,log=line=>console.log(line)}={}){
  let result;
  const [manifestPath,versionString,...extra]=args;
  if(!manifestPath||extra.length||!/^[1-9][0-9]{0,9}$/.test(versionString||'')||!validVersion(Number(versionString))){
    result={complete:false,reason:'invalid_manifest',version_code:null,calls:0};
  }else{
    let bytes;
    try{bytes=await readFileImpl(manifestPath);}catch{result={complete:false,reason:'input_unavailable',version_code:Number(versionString),calls:0};}
    if(bytes){
      try{result=await announce({manifestBytes:bytes,expectedVersionCode:Number(versionString)});}
      catch{result={complete:false,reason:'unexpected_failure',version_code:Number(versionString),calls:0};}
    }
  }
  if(!result.complete){
    const counts=Number.isSafeInteger(result.pending)?` Last acknowledged pending: ${result.pending}; failed: ${result.failed}.`:'';
    log('::warning title=SharePass update notifications::'+(reasons[result.reason]||reasons.unexpected_failure)+counts+' The APK was already published.');
  }else{
    log(`Push service accepted ${result.delivered} update notifications; no pending or failed devices were reported.`);
  }
  const summary=announcementSummary(result);
  if(summaryPath){
    try{await appendFileImpl(summaryPath,summary,'utf8');}
    catch{log('::warning title=SharePass notification summary::Could not write the notification summary. The APK publication is unchanged.');}
  }else log(summary);
  return result.complete?0:1;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  process.exitCode=await runAnnouncementCli(process.argv.slice(2));
}
