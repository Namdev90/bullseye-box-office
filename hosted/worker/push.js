const FCM_OAUTH_URL='https://oauth2.googleapis.com/token';
const FCM_SCOPE='https://www.googleapis.com/auth/firebase.messaging';
const FCM_RSA={name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'};
let pushKeyCache,pushAccessCache,pushAccessRequest;

function pushConfiguration(env){
  const secret=env.SHAREPASS_FCM_SERVICE_ACCOUNT;
  if(typeof secret!=='string'||!secret||secret.length>16384)return null;
  if(pushKeyCache?.secret===secret)return pushKeyCache.configuration;
  const configuration=readPushKey(secret).catch(()=>null);
  pushKeyCache={secret,configuration};
  return configuration;
}

async function readPushKey(secret){
  const {project_id,client_email,private_key}=JSON.parse(secret);
  if(!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project_id||'')||
      !/^[A-Za-z0-9_.-]+@[A-Za-z0-9.-]+\.gserviceaccount\.com$/.test(client_email||'')||
      typeof private_key!=='string')return null;
  const pem=private_key.trim().match(/^-----BEGIN PRIVATE KEY-----\s+([A-Za-z0-9+/=\s]+)\s+-----END PRIVATE KEY-----$/);
  if(!pem)return null;
  const der=Uint8Array.from(atob(pem[1].replace(/\s/g,'')),value=>value.charCodeAt(0));
  const key=await crypto.subtle.importKey('pkcs8',der,FCM_RSA,false,['sign']);
  return {project:project_id,email:client_email,key};
}

function pushBase64(bytes){
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

async function fcmAccess(config){
  if(pushAccessCache?.key===config.key&&pushAccessCache.expires>Date.now())return pushAccessCache.token;
  if(pushAccessRequest?.key===config.key)return pushAccessRequest.result;
  const request={key:config.key,result:requestFcmAccess(config)};
  pushAccessRequest=request;
  try{return await request.result;}
  finally{if(pushAccessRequest===request)pushAccessRequest=null;}
}
async function requestFcmAccess(config){
  const encode=new TextEncoder(),iat=Math.floor(Date.now()/1000);
  const header=pushBase64(encode.encode(JSON.stringify({alg:'RS256',typ:'JWT'})));
  const claims=pushBase64(encode.encode(JSON.stringify({
    iss:config.email,scope:FCM_SCOPE,aud:FCM_OAUTH_URL,iat,exp:iat+300
  })));
  const payload=header+'.'+claims;
  const signature=await crypto.subtle.sign(FCM_RSA,config.key,encode.encode(payload));
  const response=await fetch(FCM_OAUTH_URL,{
    method:'POST',redirect:'manual',signal:AbortSignal.timeout(5000),
    body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:payload+'.'+pushBase64(new Uint8Array(signature))})
  });
  if(!response.ok)throw new Error('Push credentials could not be used.');
  const {access_token,expires_in}=await response.json();
  if(typeof access_token!=='string'||!access_token||!Number.isFinite(expires_in)||expires_in<=0){
    throw new Error('Push authorization could not be read.');
  }
  pushAccessCache={key:config.key,token:access_token,expires:Date.now()+Math.max(0,Math.min(expires_in,3600)-60)*1000};
  return access_token;
}

async function pushRegistration(request,env,staff,register){
  const token=(await bodyJson(request))?.token;
  if(typeof token!=='string'||!/^[!-~]{16,4096}$/.test(token))return error('Invalid push token.',400);
  const configured=!!(await pushConfiguration(env)),db=env.DB;
  if(!register){
    await db.prepare('DELETE FROM sharepass_push_tokens WHERE device_id=? AND token=?').bind(staff.device_id,token).run();
    return json({configured,registered:false});
  }
  if(!configured)return json({configured:false,registered:false});
  const now=Date.now();
  await db.prepare(`DELETE FROM sharepass_push_tokens WHERE token=? AND device_id IN (
    SELECT id FROM sharepass_configured_devices WHERE active=0 OR session_expires<=?)`).bind(token,now).run();
  const result=await db.prepare(`INSERT INTO sharepass_push_tokens(device_id,token)
    SELECT ?,? WHERE EXISTS (SELECT 1 FROM sharepass_configured_devices WHERE id=? AND active=1 AND session_expires>?)
    AND NOT EXISTS (SELECT 1 FROM sharepass_push_tokens WHERE token=? AND device_id<>?)
    ON CONFLICT(device_id) DO UPDATE SET token=excluded.token`)
    .bind(staff.device_id,token,staff.device_id,now,token,staff.device_id).run();
  return result.meta.changes===1?json({configured:true,registered:true}):error('This push token belongs to a different setup.',409);
}

async function deliverBoothPush(env,workspace,booth){
  const config=await pushConfiguration(env);
  if(!config)return;
  const db=env.DB;
  const targets=await db.prepare(`SELECT p.device_id,p.token FROM sharepass_push_tokens p
    JOIN sharepass_configured_devices d ON d.id=p.device_id
    JOIN sharepass_configured_staff s ON s.id=d.staff_id
    WHERE d.workspace=? AND s.booth_id=? AND d.active=1 AND d.session_expires>?
    ORDER BY p.device_id LIMIT 40`).bind(workspace,booth,Date.now()).all();
  if(!targets.results.length)return;
  const access=await fcmAccess(config);
  const url='https://fcm.googleapis.com/v1/projects/'+config.project+'/messages:send';
  await pushFanout(targets.results,async ({device_id,token})=>{
    const response=await fetch(url,{
      method:'POST',redirect:'manual',signal:AbortSignal.timeout(5000),
      headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},
      body:JSON.stringify({message:{
        token,notification:{title:'SharePass',body:'A pass deposit is ready for review.'},
        data:{type:'sharepass_queue'},
        android:{priority:'HIGH',ttl:'120s',collapse_key:'sharepass_queue',
          notification:{channel_id:'booth_queue',tag:'sharepass_queue',visibility:'PRIVATE'}}
      }})
    });
    if(response.status===401&&pushAccessCache?.token===access)pushAccessCache=null;
    if(response.status===404){
      const details=(await response.json()).error?.details;
      if(Array.isArray(details)&&details.some(detail=>detail.errorCode==='UNREGISTERED')){
        await db.prepare('DELETE FROM sharepass_push_tokens WHERE device_id=? AND token=?').bind(device_id,token).run();
      }
    }
  });
}

async function pushFanout(targets,send){
  for(let start=0;start<targets.length;start+=3)await Promise.allSettled(targets.slice(start,start+3).map(send));
}

async function scheduleBoothPush(env,ctx,workspace,booth){
  if(!env.SHAREPASS_FCM_SERVICE_ACCOUNT&&!env.SHAREPASS_WEB_PUSH_PRIVATE_JWK)return;
  const delivery=Promise.allSettled([deliverBoothPush(env,workspace,booth),deliverWebPush(env,workspace,booth)]);
  if(typeof ctx?.waitUntil==='function')ctx.waitUntil(delivery);
  else await delivery;
}
