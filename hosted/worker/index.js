const EVENT='training-event-001';
const security={
  'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff',
  'X-SharePass-Version':'37',
  'Referrer-Policy':'no-referrer',
};
function json(value,status=200){return Response.json(value,{status,headers:security});}
function error(message,status,notExecuted=true){return json({error:message,notExecuted},status);}
function decodeAsset(path){
  const [type,base64]=assets[path]||[];
  if(!type)return null;
  const bytes=Uint8Array.from(atob(base64),value=>value.charCodeAt(0));
  return {type,bytes};
}
function page(path,booth=''){
  let html=new TextDecoder().decode(decodeAsset(path).bytes).replace(/((?:src|href)="\/[^"?]+\.(?:js|css|jpg|png))"/g,'$1?v='+security['X-SharePass-Version']+'-'+ASSET_VERSION+'"');
  if(booth){
    const safe=String(booth).replace(/[&<>"']/g,value=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[value]));
    html=html.replace('</head>','<meta property="og:title" content="SharePass · '+safe+'"><meta property="og:description" content="Leave physical passes at '+safe+' and receive a pickup receipt."></head>');
  }
  return new Response(html,{headers:{...security,'Content-Type':'text/html; charset=utf-8',
    'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"}});
}
async function bodyJson(request){
  if(!/^application\/json(?:;.*)?$/i.test(request.headers.get('content-type')||''))return null;
  const reader=request.body?.getReader();
  if(!reader)return null;
  let size=0,text='';
  const decoder=new TextDecoder('utf-8',{fatal:true});
  try{
    for(;;){
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;
      if(size>12288){await reader.cancel();return null;}
      text+=decoder.decode(value,{stream:true});
    }
    const body=JSON.parse(text+decoder.decode());
    return body&&typeof body==='object'&&!Array.isArray(body)?body:null;
  }catch{return null;}
}
function passQuantities(q){
  const required=['normal','vip','vvip'];
  if(!q||typeof q!=='object'||Array.isArray(q)||
      Object.keys(q).some(key=>!required.includes(key)&&key!=='mip')||
      !required.every(k=>Number.isInteger(q[k])&&q[k]>=0&&q[k]<=100)||
      ('mip' in q&&(!Number.isInteger(q.mip)||q.mip<0||q.mip>100)))return null;
  return {normal:q.normal,vip:q.vip,vvip:q.vvip,...(q.mip?{mip:q.mip}:{})};
}
function codeOptions(body){
  const custom=typeof body.custom_code==='string'?body.custom_code.trim().toUpperCase():'';
  const valid=body.valid_minutes;
  const suggested=body.suggested_code;
  if(suggested!==undefined&&(typeof suggested!=='string'||!/^[A-Z0-9]{4}$/.test(suggested)))return null;
  if((body.custom_code!==undefined&&typeof body.custom_code!=='string')||(custom&&!/^[A-Z0-9]{4}$/.test(custom))||
     (valid!==undefined&&(!Number.isInteger(valid)||valid<5||valid>2880)))return null;
  return {...(custom?{custom_code:custom}:suggested?{suggested_code:suggested}:{}),...(valid!==undefined?{valid_minutes:valid}:{})};
}
function validate(body,path,operator,booth='B1'){
  if(!body)return null;
  const scope={event_id:EVENT,booth_id:booth};
  if(path==='/api/verify'){
    const code=typeof body.collection_code==='string'?body.collection_code.trim().toUpperCase():'';
    const reference=typeof body.collection_reference==='string'?body.collection_reference.trim().toUpperCase():'';
    if(!/^[0-9]{4}$/.test(code)||(body.collection_reference!==undefined&&!/^PKT-[A-F0-9]{8}$/.test(reference)))return null;
    return {...scope,collection_code:code,...(reference?{collection_reference:reference}:{})};
  }
  if(typeof body.request_id!=='string'||!/^[a-zA-Z0-9-]{8,100}$/.test(body.request_id))return null;
  const common={...scope,operator,request_id:body.request_id};
  if(path.endsWith('/updates')){
    const packet=setupText(body.packet_id,40).toUpperCase();
    if(!/^PKT-[A-F0-9]{8}$/.test(packet)||!['none','whatsapp','sms','email'].includes(body.channel))return null;
    const update=updatePreference(body.channel,contactFields(body));
    return update===false?null:{...common,packet_id:packet,update_contact:update};
  }
  if(path.endsWith('/handover'))return body.handover_confirmed===true&&Number.isSafeInteger(body.version)?{...common,handover_confirmed:true,version:body.version}:null;
  const quantities=passQuantities(body.quantities);
  if(!quantities)return null;
  if(path==='/api/deposits'){
    if(body.custody_confirmed!==true||typeof body.location!=='string'||!body.location.trim()||body.location.length>30||/[\u0000-\u001f\u007f]/.test(body.location))return null;
    const depositor=body.depositor||{phone:body.depositor_phone||body.phone};
    const recipients=Array.isArray(body.recipients)?body.recipients:
      body.collector?[body.collector]:body.recipient_phone?[{phone:body.recipient_phone}]:[];
    if(!separateCollectorPhones(depositor,recipients))return null;
    const options=codeOptions(body);
    return options?{...common,location:body.location.trim(),custody_confirmed:true,quantities,...options}:null;
  }
  if(typeof body.claim_token!=='string'||!/^[-a-f0-9]{36}$/.test(body.claim_token)||typeof body.packet_id!=='string'||body.packet_id.length>40||!Number.isSafeInteger(body.version))return null;
  return {...common,claim_token:body.claim_token,packet_id:body.packet_id,version:body.version,quantities};
}
function emailAddress(value){
  const email=typeof value==='string'?value.trim().toLowerCase():'';
  return email.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:'';
}
async function access(value,env,id){
  const email=emailAddress(value);
  const ownerEmail=emailAddress(env.SHAREPASS_OWNER_EMAIL);
  if(!email||!ownerEmail)return null;
  const admin=email===ownerEmail;
  if(admin){
    await env.DB.prepare('INSERT OR IGNORE INTO sharepass_staff(email,user_id) VALUES(?,?)').bind(email,id).run();
  }
  const membership=await env.DB.prepare('SELECT user_id,display_name FROM sharepass_staff WHERE email=?').bind(email).first();
  if(!membership||(membership.user_id&&membership.user_id!==id))return null;
  const owner=admin?membership:await env.DB.prepare('SELECT user_id FROM sharepass_staff WHERE email=?').bind(ownerEmail).first();
  return owner?.user_id?{email,admin,workspace:owner.user_id,name:membership.display_name,operator:id}:null;
}
export default {async fetch(request,env,ctx){
  const url=new URL(request.url),path=url.pathname;
  let owner=request.headers.get('oai-authenticated-user-id');
  let email=request.headers.get('oai-authenticated-user-email');
  const verifiedOwner=owner,verifiedEmail=email;
  let passwordOwner=false;
  try{
    if(path==='/owner-signin'&&request.method==='GET'){
      if(env.DB&&(verifiedOwner?(await access(verifiedEmail,env,verifiedOwner))?.admin:await ownerSession(request,env))){
        return new Response(null,{status:302,headers:{...security,Location:'/account'}});
      }
      return page('/owner-signin.html');
    }
    if(path==='/owner-password'&&request.method==='GET'){
      if(!verifiedOwner)return new Response(null,{status:302,headers:{...security,Location:'/signin-with-chatgpt?return_to=%2Fowner-password'}});
      return env.DB&&(await access(verifiedEmail,env,verifiedOwner))?.admin?page('/owner-password.html'):error('Page not found.',404);
    }
    if(path.startsWith('/api/owner/')){
      if(request.method!=='POST')return error('Page not found.',404);
      if(request.headers.get('Origin')!==url.origin||request.headers.get('Sec-Fetch-Site')==='cross-site')return error('Cross-origin changes are blocked.',403);
      if(!env.DB)return error('The shared database is unavailable.',503,false);
      if(path==='/api/owner/login'){
        if(verifiedOwner&&emailAddress(verifiedEmail)!==emailAddress(env.SHAREPASS_OWNER_EMAIL))return error('Sign out of the current staff account before signing in as owner.',403);
        return await signInOwner(request,env);
      }
      if(path==='/api/owner/password'){
        if(!verifiedOwner||request.headers.has('X-SharePass-Session')||!(await access(verifiedEmail,env,verifiedOwner))?.admin)return error('Page not found.',404);
        return await setOwnerPassword(request,env,verifiedOwner);
      }
      if(path==='/api/owner/logout'){
        const digest=await verifierDigest(ownerSessionToken(request));
        if(digest)await env.DB.prepare('DELETE FROM sharepass_owner_sessions WHERE digest=?').bind(digest).run();
        const response=json({signed_out:true});
        response.headers.set('Set-Cookie',ownerSessionCookie('',0));
        return response;
      }
      return error('Page not found.',404);
    }
    if(!owner&&env.DB&&!request.headers.has('X-SharePass-Session')&&
      (['/staff','/account','/admin'].includes(path)||(path.startsWith('/api/')&&!path.startsWith('/api/public/')))){
      const session=await ownerSession(request,env);
      if(session){owner=session.id;email=session.email;passwordOwner=true;}
    }
    if(request.method==='GET'&&(path==='/'||path==='/index.html'))return page('/opening.html');
    if(request.method==='GET'&&path==='/pickup')return page('/pickup.html');
    if(path==='/.well-known/assetlinks.json'&&request.method==='GET'){
      return json([{
        relation:['delegate_permission/common.handle_all_urls'],
        target:{namespace:'android_app',package_name:'in.sharepass.foundation',
          sha256_cert_fingerprints:['0A:8B:40:09:66:FD:75:4C:6D:B2:B3:3B:94:F7:8C:98:98:80:3A:FF:37:71:8F:A3:4C:34:AE:F7:7B:64:2C:12']}
      }]);
    }
    if((path==='/connect'||path==='/app-setup')&&request.method==='GET')return page('/connect.html');
    if(path==='/disconnect'&&request.method==='GET'){
      return new Response(null,{status:302,headers:{...security,Location:'/connect','Set-Cookie':staffCookieHeader('',0)}});
    }
    if(path==='/pair'&&request.method==='GET'){
      const challenge=url.searchParams.get('challenge');
      if(!challengePattern.test(challenge||''))return error('Open the pairing link from the SharePass app.',400);
      if(!owner)return new Response(null,{status:302,headers:{...security,Location:'/signin-with-chatgpt?return_to='+encodeURIComponent('/pair?challenge='+challenge)}});
      if(!env.DB||!(await access(email,env,owner)))return error('Ask the SharePass owner to grant access to your signed-in account.',403);
      return page('/pair.html');
    }
    if((path.startsWith('/intake/')||path.startsWith('/booth/'))&&request.method==='GET'){
      const token=path.split('/')[2];
      if(!intakeTokenPattern.test(token||'')||path.split('/').length!==3)return intakeUnavailable();
      const booth=env.DB&&path.startsWith('/booth/')?await env.DB.prepare('SELECT name FROM sharepass_configured_booths WHERE poster_token=?').bind(token).first():null;
      return page('/intake.html',booth?.name||'Box office');
    }
    if(request.method==='GET'&&path==='/staff'){
      if(!owner){
        const cookie=staffCookie(request);
        if(!cookie||!env.DB||!(await configuredAccess(env.DB,cookie))){
          return new Response(null,{status:302,headers:{...security,Location:'/connect',...(cookie?{'Set-Cookie':staffCookieHeader('',0)}:{})}});
        }
      }
      return page('/counter.html');
    }
    if((path==='/admin'||path==='/account')&&request.method==='GET'){
      if(!owner||!env.DB||!(await access(email,env,owner))?.admin)return error('Page not found.',404);
      if(path==='/admin')return new Response(null,{status:302,headers:{...security,Location:'/account#administration'}});
      return page('/admin.html');
    }
    if(path.startsWith('/api/')){
      if(request.headers.get('Sec-Fetch-Site')==='cross-site')return error('Cross-site access is blocked.',403);
      if(path==='/api/public/android-release')return await androidReleaseWebhook(request,env);
      if(path==='/api/device/connect'&&request.method==='POST'){
        const origin=request.headers.get('Origin');
        if(origin&&origin!==url.origin)return error('Cross-origin changes are blocked.',403);
        return env.DB?await connectDevice(request,env):error('The shared database is unavailable.',503,false);
      }
      if(path.startsWith('/api/public/intake/')){
        const token=path.slice('/api/public/intake/'.length);
        if(!intakeTokenPattern.test(token))return intakeUnavailable();
        return env.DB?await publicIntake(request,env.DB,token,url.origin):error('The shared database is unavailable.',503,false);
      }
      if(path.startsWith('/api/public/booth/')){
        const [token,action,...extra]=path.slice('/api/public/booth/'.length).split('/');
        if(!intakeTokenPattern.test(token)||extra.length||(action!==undefined&&action!=='alerts'))return boothMissing();
        return env.DB?await publicBooth(request,env,ctx,token,url.origin,url.searchParams.get('ticket'),action==='alerts'):error('The shared database is unavailable.',503,false);
      }
      if(path==='/api/mobile/session'&&request.method==='POST'){
        const origin=request.headers.get('Origin');
        if(origin&&origin!==url.origin)return error('Cross-origin changes are blocked.',403);
        if(!env.DB)return error('The shared database is unavailable.',503,false);
        const verifier=(await bodyJson(request))?.verifier;
        if(typeof verifier!=='string'||!verifierPattern.test(verifier))return error('Invalid pairing request.',400);
        const paired=await mobileSession(env.DB,verifier);
        return paired&&(await access(paired.email,env,paired.user_id))
          ?json({token:verifier,expires_at:paired.expires_at}):json({pending:true},202);
      }
      const deviceToken=request.headers.get('X-SharePass-Session');
      const browserToken=path.startsWith('/api/admin')?'':staffCookie(request);
      let configured=null;
      if(deviceToken||browserToken){
        if(!env.DB)return error('The shared database is unavailable.',503,false);
        configured=await configuredAccess(env.DB,deviceToken||browserToken);
        if(configured&&path==='/api/mobile/logout'&&request.method==='POST'){
          if(!deviceToken&&request.headers.get('Origin')!==url.origin)return error('Cross-origin changes are blocked.',403);
          await env.DB.prepare('UPDATE sharepass_configured_devices SET active=0 WHERE id=?').bind(configured.device_id).run();
          await env.DB.prepare('DELETE FROM sharepass_push_tokens WHERE device_id=?').bind(configured.device_id).run();
          const result=json({signed_out:true});
          if(browserToken)result.headers.set('Set-Cookie',staffCookieHeader('',0));
          return result;
        }
        if(deviceToken&&!configured){
          const paired=await mobileSession(env.DB,deviceToken);
          if(!paired)return error('Ask the desktop administrator for a new setup code.',401);
          if(path==='/api/mobile/logout'&&request.method==='POST'){
            await env.DB.prepare('UPDATE sharepass_mobile_sessions SET revoked=1 WHERE digest=?').bind(paired.digest).run();
            return json({signed_out:true});
          }
          owner=paired.user_id;
          email=paired.email;
        }
        if(browserToken&&!configured&&!owner)return error('Enter a new staff setup code.',401);
      }
      if(path==='/api/push/register'||path==='/api/push/unregister'){
        if(!deviceToken||!configured)return error('Use a paired SharePass device.',401);
        if(request.method!=='POST')return error('Page not found.',404);
        if(request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin)return error('Cross-origin changes are blocked.',403);
        return await pushRegistration(request,env,configured,path.endsWith('/register'));
      }
      if(!configured&&(!owner||owner.length>256))return error('Enter your SharePass setup code to use the register.',401);
      if(!env.DB)return error('The shared database is unavailable.',503,false);
      const staff=configured||await access(email,env,owner);
      if(!staff)return error('Ask the SharePass owner to grant access to your signed-in account.',403);
      const context={...staffContext(staff,env),internal:!!configured,owner_password_session:passwordOwner&&!configured};
      // A short code is never silently reassigned under the default desk flow.
      // Explicit legacy reuse retains the current-receipt reference safeguard.
      const allowCodeReuse=env.SHAREPASS_ALLOW_CODE_REUSE==='1';
      if(request.method==='GET'&&path==='/api/context'){
        if(configured)await recordDeviceSeen(env.DB,configured);
        const poster=await boothPosterDetails(env.DB,staff,url.origin);
        const booth=await boothConfiguration(env.DB,staff.workspace,staff.booth_id||'B1');
        const enriched={...context,booth_archived:!!booth?.archived,...(poster?{booth_url:poster.url}:{})};
        return json(staff.admin?{...enriched,pickup_code_reuse_enabled:allowCodeReuse}:enriched);
      }
      if(request.method==='POST'&&!deviceToken&&request.headers.get('Origin')!==url.origin)return error('Cross-origin changes are blocked.',403);
      if(path==='/api/device/status'){
        if(!configured||request.method!=='POST')return error('Use a paired SharePass device.',401);
        return await deviceStatus(request,env.DB,configured);
      }
      if(path==='/api/mobile/authorize'&&request.method==='POST'){
        if(deviceToken||configured||passwordOwner)return error('Use verified ChatGPT sign-in to approve this pairing link.',403);
        return await authorizeMobile(env.DB,staff,(await bodyJson(request))?.challenge);
      }
      if(path==='/api/admin/setup'){
        if(!staff.admin||deviceToken)return error('Page not found.',404);
        return await adminSetup(request,env.DB,staff.workspace,url.origin);
      }
      if(path==='/api/admin/report'){
        if(request.method!=='GET'||!staff.admin||deviceToken)return error('Page not found.',404);
        return await adminReport(env.DB,staff.workspace);
      }
      if(path==='/api/admin/staff-messages'){
        if(!staff.admin||deviceToken)return error('Page not found.',404);
        return await adminStaffPrompts(request,env,ctx,staff);
      }
      if(path==='/api/admin/staff-messages/reply'&&request.method==='POST'){
        if(!staff.admin||deviceToken)return error('Page not found.',404);
        return await replyToStaffPrompt(request,env.DB,staff);
      }
      if(path==='/api/admin/web-push'){
        if(!staff.admin||deviceToken)return error('Page not found.',404);
        return await webPushSubscription(request,env,staff);
      }
      if(path==='/api/admin/code-policy'){
        if(!staff.admin||deviceToken)return error('Page not found.',404);
        return await adminCodePolicy(request,env.DB,staff.workspace,env.SHAREPASS_CODE_THEME||'');
      }
      if(path==='/api/admin/reissue'&&request.method==='POST'){
        if(!staff.admin||deviceToken)return error('Page not found.',404);
        const input=await bodyJson(request);
        const options=input&&codeOptions(input);
        const code=typeof input?.collection_code==='string'?input.collection_code.trim().toUpperCase():'';
        const packet=typeof input?.packet_id==='string'?input.packet_id.trim().toUpperCase():'';
        const location=typeof input?.location==='string'?input.location.trim():'';
        if(!options?.valid_minutes||!/^[0-9]{4}$/.test(code)||!/^PKT-[A-F0-9]{8}$/.test(packet)||
           !location||location.length>30||/[\u0000-\u001f\u007f]/.test(location)||
           !intakeTokenPattern.test(input.request_id||''))return error('Enter the expired reference, shelf, and packet label.',400);
        const booth=input.booth_id||'B1';
        if(!boothIdPattern.test(booth))return error('Choose the packet’s booth.',400);
        return await guestReceiptResult(await mutate(env.DB,staff.workspace,path,{
          event_id:EVENT,booth_id:booth,operator:staff.operator,request_id:input.request_id,collection_code:code,packet_id:packet,location,...options
        },true,false,false,env.SHAREPASS_CODE_THEME||'',null,allowCodeReuse),env,ctx,staff);
      }
      if(request.method==='POST'&&path==='/api/profile'){
        if(configured)return error('Ask the desktop administrator to update your profile.',403);
        const name=(await bodyJson(request))?.name;
        if(typeof name!=='string'||!name.trim()||name.trim().length>80||/[\u0000-\u001f\u007f]/.test(name))return error('Enter a name of 1 to 80 characters.',400);
        const changed=await env.DB.prepare('UPDATE sharepass_staff SET user_id=?,display_name=? WHERE email=? AND (user_id IS NULL OR user_id=?)').bind(owner,name.trim(),staff.email,owner).run();
        return changed.meta.changes===1?json({...context,staff_label:name.trim()}):error('Your staff access changed.',403);
      }
      if(path==='/api/admin'){
        if(!staff.admin||deviceToken)return error('Page not found.',404);
        if(request.method==='POST'){
          const input=await bodyJson(request);
          const email=emailAddress(input?.email);
          if(!email||email===staff.email||!['grant','revoke'].includes(input.action))return error('Enter a staff email and choose an action.',400);
          if(input.action==='grant')await env.DB.prepare('INSERT OR IGNORE INTO sharepass_staff(email) VALUES(?)').bind(email).run();
          else{
            await env.DB.prepare('DELETE FROM sharepass_staff WHERE email=?').bind(email).run();
            await env.DB.prepare('UPDATE sharepass_mobile_sessions SET revoked=1 WHERE email=?').bind(email).run();
          }
        }else if(request.method!=='GET')return error('Page not found.',404);
        const roster=await env.DB.prepare('SELECT email,display_name FROM sharepass_staff WHERE email<>? ORDER BY email').bind(staff.email).all();
        return json({staff:roster.results});
      }
      if(!staff.name)return error('Register your staff profile first.',403);
      if(path==='/api/staff-messages/reply'&&request.method==='POST')return await replyToStaffPrompt(request,env.DB,staff);
      const receiptPath=/^\/api\/deposits\/([a-f0-9-]{36})\/receipt$/.exec(path);
      if(receiptPath&&request.method==='GET')return await currentDepositReceipt(env.DB,staff,receiptPath[1]);
      if(path==='/api/web-push')return await webPushSubscription(request,env,staff);
      if(path==='/api/booth'&&request.method==='GET')return await boothPoster(env.DB,staff,url.origin);
      if(path==='/api/queue'&&request.method==='GET')return await queueList(env.DB,staff);
      if(path==='/api/history'&&request.method==='GET')return await ledgerHistory(env.DB,staff,url.searchParams);
      if(path.startsWith('/api/queue/')){
        const [token,action,...extra]=path.slice('/api/queue/'.length).split('/');
        if(!intakeTokenPattern.test(token)||extra.length||(action!==undefined&&action!=='confirm'))return boothMissing();
        const result=await queueItem(request,env.DB,staff,token,action==='confirm',env.SHAREPASS_CODE_THEME||'',allowCodeReuse);
        return action==='confirm'?await guestReceiptResult(result,env,ctx,staff):result;
      }
      if(path==='/api/codes/suggest'&&request.method==='GET'){
        await ensureLedger(env.DB,staff.workspace);
        const code=await ledgerCode(env.DB,staff.workspace,env.SHAREPASS_CODE_THEME||'',url.searchParams.get('exclude')||'','',allowCodeReuse);
        return code?json({code}):error('Could not allocate a collection code. Try again.',409);
      }
      if(path==='/api/codes/refresh/recover'&&request.method==='POST'){
        const input=await bodyJson(request);
        const packet=setupText(input?.packet_id,40).toUpperCase();
        if(!/^PKT-[A-F0-9]{8}$/.test(packet)||!intakeTokenPattern.test(input?.request_id||'')){
          return error('Recover the saved refresh from this staff session.',400,false);
        }
        return await recoverCodeRefresh(env.DB,staff,input.request_id,packet);
      }
      if(path==='/api/codes/refresh'&&request.method==='POST'){
        const input=await bodyJson(request);
        const packet=setupText(input?.packet_id,40).toUpperCase();
        const code=setupText(input?.collection_code,4).toUpperCase();
        if(!/^PKT-[A-F0-9]{8}$/.test(packet)||!/^[0-9]{4}$/.test(code)||
          !intakeTokenPattern.test(input?.request_id||''))return error('Enter the current code and match the physical packet.',400);
        await ensureLedger(env.DB,staff.workspace);
        const row=await ledgerDepositByCode(env.DB,staff.workspace,code);
        const candidate=row&&JSON.parse(row.payload);
        const deposit=candidate?.booth_id===(staff.booth_id||'B1')&&candidate.packet_id===packet?candidate:null;
        if(!deposit)return error('The collection code and physical packet label must match.',404);
        const refreshed=await mutate(env.DB,staff.workspace,path,{event_id:EVENT,booth_id:staff.booth_id||'B1',operator:staff.operator,
          request_id:input.request_id,collection_code:code,packet_id:packet,location:deposit.location,valid_minutes:1440},
          staff.admin,false,false,env.SHAREPASS_CODE_THEME||'',null,allowCodeReuse);
        return await guestReceiptResult(await refreshedReceiptContacts(env.DB,staff,refreshed),env,ctx,staff);
      }
      if(path==='/api/intakes'&&request.method==='POST')return await startIntake(env.DB,staff,url.origin);
      if(path.startsWith('/api/intakes/')){
        const [token,action,...extra]=path.slice('/api/intakes/'.length).split('/');
        if(!intakeTokenPattern.test(token)||extra.length||(action!==undefined&&action!=='confirm'))return intakeUnavailable();
        return await staffIntake(request,env.DB,staff,token,action==='confirm',env.SHAREPASS_CODE_THEME||'',allowCodeReuse);
      }
      if(request.method==='GET'&&path==='/api/state'){
        await ensureLedger(env.DB,staff.workspace);
        const pending=await ledgerStatement(env.DB,"SELECT d.payload AS deposit,c.payload AS collection FROM sharepass_ledger_collections c JOIN sharepass_ledger_deposits d ON d.owner=c.owner AND d.id=c.deposit_id WHERE c.owner=? AND c.booth=? AND c.pending=1 AND (? OR c.payload->>'created_by'=? )",
          staff.workspace,staff.booth_id||'B1',Number(staff.admin),staff.operator).all();
        const model=ledgerModel();
        return json({deposits:pending.results.map(row=>{
          model.collections=[JSON.parse(row.collection)];
          return model.publicDeposit(JSON.parse(row.deposit));
        })});
      }
      if(request.method!=='POST'||url.search||!(/^\/api\/(deposits|verify|deposits\/[a-f0-9-]{36}\/(release|updates)|collections\/[a-f0-9-]{36}\/handover)$/.test(path)))return error('Unknown shared register action.',404);
      const body=validate(await bodyJson(request),path,staff.operator,staff.booth_id||'B1');
      if(!body||/^(?:booth|intake)-/i.test(body.request_id||''))return error('Review the required packet details and quantities.',400);
      const legacy=!!deviceToken&&!request.headers.has('X-SharePass-Client');
      const result=await mutate(env.DB,staff.workspace,path,body,staff.admin,false,legacy,env.SHAREPASS_CODE_THEME||'',null,allowCodeReuse,!!deviceToken);
      return /\/(release|handover)$/.test(path)?await guestReceiptResult(result,env,ctx,staff):result;
    }
    const asset=request.method==='GET'&&!path.endsWith('.html')&&decodeAsset(path);
    if(!asset)return error('Page not found.',404);
    const etag='"sharepass-'+security['X-SharePass-Version']+'-'+ASSET_VERSION+'-'+encodeURIComponent(path)+'"';
    const headers={...security,'Content-Type':asset.type,ETag:etag,
      'Cache-Control':url.search==='?v='+security['X-SharePass-Version']+'-'+ASSET_VERSION?'public, max-age=86400, immutable':'no-cache'};
    return new Response(request.headers.get('If-None-Match')===etag?null:asset.bytes,
      {status:request.headers.get('If-None-Match')===etag?304:200,headers});
  }catch{return error('The shared register is unavailable. Recover the same action before another handover.',503,false);}
}};
