const ANDROID_RELEASE_PACKAGE='in.sharepass.foundation';
const ANDROID_RELEASE_SIGNER='0a8b400966fd754c6db2b33b94f78c9898803aff37718fa34c34aef77b642c12';
const ANDROID_RELEASE_REPOSITORY='https://github.com/Namdev90/bullseye-box-office/releases/';
const ANDROID_RELEASE_LATEST='https://api.github.com/repos/Namdev90/bullseye-box-office/releases/latest';
const ANDROID_RELEASE_BASELINE=23;
let androidReleaseVerificationKey;

function androidReleaseBytes(manifest){
  return new TextEncoder().encode(['sharepass-android-update-v1',manifest.packageName,manifest.versionCode,
    manifest.versionName,manifest.apkUrl,manifest.size,manifest.sha256,manifest.signerSha256,''].join('\n'));
}

async function verifiedAndroidRelease(manifest){
  const fields=['schema','packageName','versionCode','versionName','apkUrl','size','sha256','signerSha256','signature'];
  if(!manifest||Object.keys(manifest).length!==fields.length||fields.some(key=>!Object.hasOwn(manifest,key))||
    manifest.schema!==1||manifest.packageName!==ANDROID_RELEASE_PACKAGE||
    !Number.isSafeInteger(manifest.versionCode)||manifest.versionCode<=ANDROID_RELEASE_BASELINE||manifest.versionCode>2147483647||
    typeof manifest.versionName!=='string'||!/^(?:0|[1-9][0-9]{0,3})\.(?:0|[1-9][0-9]{0,3})\.(?:0|[1-9][0-9]{0,3})$/.test(manifest.versionName)||
    manifest.apkUrl!==ANDROID_RELEASE_REPOSITORY+'download/android-v'+manifest.versionName+'/SharePass-Android-'+manifest.versionName+'.apk'||
    !Number.isSafeInteger(manifest.size)||manifest.size<100000||manifest.size>25*1024*1024||
    typeof manifest.sha256!=='string'||!/^[a-f0-9]{64}$/.test(manifest.sha256)||manifest.signerSha256!==ANDROID_RELEASE_SIGNER||
    typeof manifest.signature!=='string'||manifest.signature.length<172||manifest.signature.length>1368||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(manifest.signature))return false;
  try{
    const signature=Uint8Array.from(atob(manifest.signature),c=>c.charCodeAt(0));
    if(signature.length<128||signature.length>1024||btoa(String.fromCharCode(...signature))!==manifest.signature)return false;
    androidReleaseVerificationKey??=crypto.subtle.importKey('spki',Uint8Array.from(atob(ANDROID_RELEASE_SPKI),c=>c.charCodeAt(0)),
      {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5',await androidReleaseVerificationKey,signature,androidReleaseBytes(manifest));
  }catch{return false;}
}

async function publishedAndroidRelease(manifest){
  const response=await fetch(ANDROID_RELEASE_LATEST,{redirect:'error',signal:AbortSignal.timeout(5000),
    headers:{Accept:'application/vnd.github+json','User-Agent':'SharePass-release-notifier','X-GitHub-Api-Version':'2022-11-28'}});
  if(!response.ok)return false;
  const reader=response.body?.getReader();
  if(!reader)return false;
  let raw='',size=0;
  const decoder=new TextDecoder();
  for(;;){
    const {done,value}=await reader.read();if(done)break;
    size+=value.byteLength;
    if(size>256*1024){await reader.cancel();return false;}
    raw+=decoder.decode(value,{stream:true});
  }
  const release=JSON.parse(raw+decoder.decode());
  const tag='android-v'+manifest.versionName;
  if(release.draft!==false||release.prerelease!==false||release.tag_name!==tag||
    release.html_url!==ANDROID_RELEASE_REPOSITORY+'tag/'+tag||!Array.isArray(release.assets))return false;
  const apk=release.assets.filter(asset=>asset.name==='SharePass-Android-'+manifest.versionName+'.apk');
  const metadata=release.assets.filter(asset=>asset.name==='sharepass-android-update.json');
  return apk.length===1&&metadata.length===1&&apk[0].state==='uploaded'&&apk[0].browser_download_url===manifest.apkUrl&&
    apk[0].size===manifest.size&&apk[0].digest==='sha256:'+manifest.sha256&&
    metadata[0].state==='uploaded'&&metadata[0].size>0&&metadata[0].size<=16384&&
    metadata[0].browser_download_url===ANDROID_RELEASE_REPOSITORY+'download/'+tag+'/sharepass-android-update.json';
}

async function deliverAndroidRelease(env,manifest){
  const db=env.DB,config=await pushConfiguration(env),now=Date.now();
  if(!config)return {configured:false,delivered:0,pending:0,failed:0};
  // Tokens are used only inside the server. Revoked, expired, denied and already
  // updated devices are not enrolled, including on a replay of this webhook.
  await db.prepare(`INSERT OR IGNORE INTO sharepass_android_release_deliveries(version_code,device_id)
    SELECT ?,d.id FROM sharepass_configured_devices d JOIN sharepass_push_tokens p ON p.device_id=d.id
    LEFT JOIN sharepass_device_status h ON h.device_id=d.id
    WHERE d.active=1 AND d.digest IS NOT NULL AND d.session_expires>?
      AND coalesce(h.notifications_enabled,1)=1 AND coalesce(h.app_version_code,0)<?
      AND EXISTS(SELECT 1 FROM sharepass_android_release_state WHERE id=1 AND version_code=?)`)
    .bind(manifest.versionCode,now,manifest.versionCode,manifest.versionCode).run();
  const targets=await db.prepare(`SELECT r.device_id,p.token FROM sharepass_android_release_deliveries r
    JOIN sharepass_configured_devices d ON d.id=r.device_id JOIN sharepass_push_tokens p ON p.device_id=d.id
    LEFT JOIN sharepass_device_status h ON h.device_id=d.id
    WHERE r.version_code=? AND r.delivered_at IS NULL AND r.attempts<3 AND r.lease_until<=?
      AND d.active=1 AND d.digest IS NOT NULL AND d.session_expires>?
      AND coalesce(h.notifications_enabled,1)=1 AND coalesce(h.app_version_code,0)<?
    ORDER BY r.device_id LIMIT 12`).bind(manifest.versionCode,now,now,manifest.versionCode).all();
  const access=targets.results.length?await fcmAccess(config):null;
  await pushFanout(targets.results,async ({device_id,token})=>{
    const started=Date.now(),lease=started+60000;
    const claim=await db.prepare(`UPDATE sharepass_android_release_deliveries SET attempts=attempts+1,lease_until=?
      WHERE version_code=? AND device_id=? AND delivered_at IS NULL AND attempts<3 AND lease_until<=?
        AND EXISTS(SELECT 1 FROM sharepass_android_release_state WHERE id=1 AND version_code=?)
        AND EXISTS(SELECT 1 FROM sharepass_configured_devices d JOIN sharepass_push_tokens p ON p.device_id=d.id
          LEFT JOIN sharepass_device_status h ON h.device_id=d.id
          WHERE d.id=? AND d.active=1 AND d.session_expires>? AND p.token=?
            AND coalesce(h.notifications_enabled,1)=1 AND coalesce(h.app_version_code,0)<?)`)
      .bind(lease,manifest.versionCode,device_id,started,manifest.versionCode,device_id,started,token,manifest.versionCode).run();
    if(claim.meta.changes!==1)return;
    let status=0,delivered=null,retired=false;
    try{
      const response=await fetch('https://fcm.googleapis.com/v1/projects/'+config.project+'/messages:send',{
        method:'POST',redirect:'manual',signal:AbortSignal.timeout(5000),
        headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},
        body:JSON.stringify({message:{token,notification:{title:'SharePass update',body:'A new app update is ready. Tap to review and install.'},
          data:{type:'sharepass_update',version_code:String(manifest.versionCode),version_name:manifest.versionName},
          android:{priority:'HIGH',ttl:'86400s',collapse_key:'sharepass_update',
            notification:{channel_id:'app_updates',tag:'sharepass_update',visibility:'PRIVATE'}}}})
      });
      status=response.status;
      if(response.ok)delivered=Date.now();
      if(status===401&&pushAccessCache?.token===access)pushAccessCache=null;
      if(status===404){
        const details=(await response.json()).error?.details;
        retired=Array.isArray(details)&&details.some(detail=>detail.errorCode==='UNREGISTERED');
        if(retired)await db.prepare('DELETE FROM sharepass_push_tokens WHERE device_id=? AND token=?').bind(device_id,token).run();
      }
    }catch{/* Keep the bounded lease for safe later retry. */}
    await db.prepare(`UPDATE sharepass_android_release_deliveries SET delivered_at=?,last_status=?,
      attempts=CASE WHEN ? THEN 3 ELSE attempts END WHERE version_code=? AND device_id=? AND lease_until=?`)
      .bind(delivered,status,Number(retired),manifest.versionCode,device_id,lease).run();
  });
  const counts=await db.prepare(`SELECT
    count(CASE WHEN r.delivered_at IS NOT NULL THEN 1 END) AS delivered,
    count(CASE WHEN r.delivered_at IS NULL AND r.attempts>=3 THEN 1 END) AS failed,
    count(CASE WHEN r.delivered_at IS NULL AND r.attempts<3 AND d.active=1 AND d.session_expires>?
      AND p.token IS NOT NULL AND coalesce(h.notifications_enabled,1)=1 AND coalesce(h.app_version_code,0)<? THEN 1 END) AS pending
    FROM sharepass_android_release_deliveries r LEFT JOIN sharepass_configured_devices d ON d.id=r.device_id
    LEFT JOIN sharepass_push_tokens p ON p.device_id=d.id LEFT JOIN sharepass_device_status h ON h.device_id=d.id
    WHERE r.version_code=?`).bind(Date.now(),manifest.versionCode,manifest.versionCode).first();
  return {configured:true,...counts};
}

async function androidReleaseWebhook(request,env){
  if(request.method!=='POST')return error('Page not found.',404);
  const manifest=await bodyJson(request);
  if(!await verifiedAndroidRelease(manifest))return error('A current signed SharePass release manifest is required.',400);
  const db=env.DB;
  if(!db)return error('The update notification registry is unavailable.',503,false);
  let current=await db.prepare('SELECT version_code,manifest FROM sharepass_android_release_state WHERE id=1').bind().first();
  if(current.version_code>manifest.versionCode)return error('A newer SharePass release has already been announced.',409);
  const encoded=JSON.stringify(manifest);
  if(current.version_code===manifest.versionCode){
    const saved=JSON.parse(current.manifest);
    if(saved.signature!==manifest.signature||new TextDecoder().decode(androidReleaseBytes(saved))!==new TextDecoder().decode(androidReleaseBytes(manifest))){
      return error('This version was already announced with different release metadata.',409);
    }
  }else{
    if(!await publishedAndroidRelease(manifest))return error('The signed release is not the current published GitHub update.',409);
    await db.prepare(`UPDATE sharepass_android_release_state SET version_code=?,version_name=?,manifest=?,accepted_at=?
      WHERE id=1 AND version_code<?`).bind(manifest.versionCode,manifest.versionName,encoded,Date.now(),manifest.versionCode).run();
    current=await db.prepare('SELECT version_code,manifest FROM sharepass_android_release_state WHERE id=1').bind().first();
    if(current.version_code!==manifest.versionCode||JSON.parse(current.manifest).signature!==manifest.signature){
      return error('A different release announcement won the update race.',409);
    }
  }
  return json({accepted:true,version_code:manifest.versionCode,...await deliverAndroidRelease(env,manifest)});
}
