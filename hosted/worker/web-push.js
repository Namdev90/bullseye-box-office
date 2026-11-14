function webPushSettings(env){
  try{
    const key=JSON.parse(env.SHAREPASS_WEB_PUSH_PRIVATE_JWK),publicKey=env.SHAREPASS_WEB_PUSH_PUBLIC_KEY;
    if(key.kty!=='EC'||key.crv!=='P-256'||!key.d||!/^[A-Za-z0-9_-]{87}$/.test(publicKey)||!emailAddress(env.SHAREPASS_OWNER_EMAIL))return null;
    return {key,publicKey,contact:env.SHAREPASS_OWNER_EMAIL};
  }catch{return null;}
}
function validPushEndpoint(value){
  if(typeof value!=='string'||value.length>600)return null;
  try{
    const url=new URL(value);
    return ['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'].includes(url.hostname)&&
      url.protocol==='https:'&&!url.port&&!url.username&&!url.password&&!url.hash&&!url.search&&url.pathname.length>=12?url:null;
  }catch{return null;}
}
async function webPushSubscription(request,env,staff){
  const config=webPushSettings(env);
  if(request.method==='GET')return json({public_key:config?.publicKey||null});
  if(request.method!=='POST')return error('Unsupported notification request.',405);
  if(!config)return error('Browser push is not configured.',503);
  const endpoint=validPushEndpoint((await bodyJson(request))?.endpoint);
  if(!endpoint)return error('Use a supported browser push endpoint.',400);
  const now=Date.now(),db=env.DB,booth=staff.booth_id||'B1',expires=now+90*86400000;
  const existing=await db.prepare('UPDATE sharepass_web_push SET expires_at=?,device_id=? WHERE endpoint=? AND workspace=? AND booth_id=? AND operator=?')
    .bind(expires,staff.device_id||null,endpoint.href,staff.workspace,booth,staff.operator).run();
  if(existing.meta.changes===1)return json({registered:true});
  const inserted=await db.prepare('INSERT OR IGNORE INTO sharepass_web_push(endpoint,workspace,booth_id,operator,device_id,expires_at) '+
    'SELECT ?,?,?,?,?,? WHERE (SELECT count(*) FROM sharepass_web_push WHERE workspace=? AND booth_id=? AND expires_at>?)<24 '+
    'AND NOT EXISTS(SELECT 1 FROM sharepass_receipt_push WHERE endpoint=? AND expires_at>?)')
    .bind(endpoint.href,staff.workspace,booth,staff.operator,staff.device_id||null,expires,staff.workspace,booth,now,endpoint.href,now).run();
  return inserted.meta.changes===1?json({registered:true}):error('This browser subscription is unavailable for this booth.',409);
}
async function deliverWebPush(env,workspace,booth,staffMessage=false){
  const config=webPushSettings(env);
  if(!config)return;
  const rows=await env.DB.prepare('SELECT p.endpoint FROM sharepass_web_push p '+
    'LEFT JOIN sharepass_configured_devices d ON p.device_id=d.id AND d.workspace=p.workspace '+
    'LEFT JOIN sharepass_staff s ON p.operator=s.user_id WHERE p.workspace=? AND p.expires_at>? AND '+
    '((p.device_id IS NOT NULL AND d.active=1 AND d.session_expires>?) OR (p.device_id IS NULL AND s.user_id IS NOT NULL)) '+
    "AND (?=0 OR ?='all' OR (? LIKE 'staff:%' AND p.operator=?) OR p.booth_id=?) LIMIT 24")
    .bind(workspace,Date.now(),Date.now(),Number(staffMessage),booth,booth,booth.startsWith('staff:')?booth.slice(6):'',booth).all();
  await sendWebPush(config,rows.results,'sharepass-queue',endpoint=>
    env.DB.prepare('DELETE FROM sharepass_web_push WHERE endpoint=? AND workspace=?').bind(endpoint,workspace).run());
}
async function sendWebPush(config,rows,topic,remove){
  if(!rows.length)return;
  const signer=await crypto.subtle.importKey('jwk',config.key,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  const encode=new TextEncoder(),tokens=new Map();
  function authorization(origin){
    if(!tokens.has(origin))tokens.set(origin,(async()=>{
      const jwt=pushBase64(encode.encode(JSON.stringify({typ:'JWT',alg:'ES256'})))+'.'+
        pushBase64(encode.encode(JSON.stringify({aud:origin,sub:'mailto:'+config.contact,exp:Math.floor(Date.now()/1000)+3600})));
      const signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},signer,encode.encode(jwt));
      return 'vapid t='+jwt+'.'+pushBase64(new Uint8Array(signature))+', k='+config.publicKey;
    })());
    return tokens.get(origin);
  }
  await pushFanout(rows,async row=>{
    const endpoint=validPushEndpoint(row.endpoint);
    if(!endpoint)return;
    const response=await fetch(endpoint.href,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(5000),
      headers:{Authorization:await authorization(endpoint.origin),TTL:'120',Topic:topic}});
    if(response.status===404||response.status===410)await remove(endpoint.href,row);
  });
}
async function guestReceiptSubscription(request,env,poster,origin){
  if(request.method!=='POST'||request.headers.get('Origin')!==origin)return error('Unsupported receipt alert request.',403);
  const input=await bodyJson(request);
  const endpoint=validPushEndpoint(input?.endpoint);
  const ticket=input?.ticket,action=input?.action;
  if(!endpoint||typeof ticket!=='string'||!intakeTokenPattern.test(ticket)||!['enable','stop','status'].includes(action)){
    return error('Open your receipt to manage its alerts.',400);
  }
  const db=env.DB,workspace=poster.workspace;
  if(action==='stop'){
    await db.prepare('DELETE FROM sharepass_receipt_push WHERE workspace=? AND ticket=? AND endpoint=?')
      .bind(workspace,ticket,endpoint.href).run();
    return json({enabled:false});
  }
  if(!webPushSettings(env))return error('Receipt alerts are unavailable.',503);
  const row=await db.prepare("SELECT expires_at,confirmed,booth_id FROM sharepass_booth_queue WHERE workspace=? AND token=? AND payload->>'intake_version'=2")
    .bind(workspace,ticket).first();
  if(!row)return action==='status'?json({enabled:false}):boothMissing();
  const booth=row.booth_id;
  if(action==='status'){
    // Proof of an existing opt-in only. This action never creates or extends it.
    const saved=await db.prepare('SELECT expires_at FROM sharepass_receipt_push WHERE workspace=? AND booth_id=? AND ticket=? AND endpoint=? AND expires_at>?')
      .bind(workspace,booth,ticket,endpoint.href,Date.now()).first();
    if(!saved)return json({enabled:false});
    let expires=saved.expires_at;
    if(row.confirmed){
      const current=await ledgerReceipt(db,workspace,'booth-'+ticket);
      if(!current?.deposit||current.deposit.booth_id!==booth)return json({enabled:false});
      if(!current.pending)expires=Math.min(expires,current.deposit.code_expires_at);
    }else expires=Math.min(expires,row.expires_at+QUEUE_RECOVERY_MS);
    return expires>Date.now()?json({enabled:true,expires_at:expires}):json({enabled:false});
  }
  const now=Date.now(),consentDeadline=now+QUEUE_LIFETIME_MS+QUEUE_RECOVERY_MS;
  let expires=row.expires_at+QUEUE_RECOVERY_MS;
  if(row.confirmed){
    const current=await ledgerReceipt(db,workspace,'booth-'+ticket);
    const deposit=current?.deposit;
    if(!deposit||deposit.booth_id!==booth)return boothMissing();
    if(!current.pending&&!Object.values(deposit.remaining).some(Boolean))return boothMissing();
    expires=current.pending?Math.max(consentDeadline,deposit.code_expires_at):deposit.code_expires_at;
  }
  if(expires<=now)return boothMissing();
  await db.prepare('DELETE FROM sharepass_receipt_push WHERE expires_at<=?').bind(now).run();
  const saved=await db.prepare(`INSERT INTO sharepass_receipt_push(ticket,workspace,booth_id,endpoint,expires_at)
    SELECT ?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM sharepass_web_push WHERE endpoint=?)
    AND NOT EXISTS(SELECT 1 FROM sharepass_receipt_push WHERE endpoint=? AND ticket<>?)
    ON CONFLICT(ticket) DO UPDATE SET endpoint=excluded.endpoint,expires_at=excluded.expires_at
    WHERE workspace=excluded.workspace AND booth_id=excluded.booth_id`)
    .bind(ticket,workspace,booth,endpoint.href,expires,endpoint.href,endpoint.href,ticket).run();
  return saved.meta.changes===1?json({enabled:true,expires_at:expires}):error('Use a separate receipt alert subscription.',409);
}
async function reconcileGuestReceiptConsent(db,staff,data){
  const now=Date.now();
  // Receipt consent follows its current code, but only while the saved opt-in is
  // still live. Read the ledger here rather than trusting a delayed response.
  // UPDATE cannot recreate stopped, pruned or expired subscriptions.
  await db.prepare(`UPDATE sharepass_receipt_push AS p SET expires_at=max(p.expires_at,(
    SELECT d.payload->>'code_expires_at' FROM sharepass_ledger_deposits d
    WHERE d.owner=p.workspace AND d.id=? AND d.booth=p.booth_id
  )) WHERE p.workspace=? AND p.booth_id=? AND p.expires_at>? AND EXISTS(
    SELECT 1 FROM sharepass_ledger_requests r
    JOIN sharepass_booth_queue q ON q.token=p.ticket AND q.workspace=p.workspace AND q.booth_id=p.booth_id
    JOIN sharepass_ledger_deposits d ON d.owner=r.owner AND d.id=r.deposit_id AND d.booth=p.booth_id
    WHERE r.owner=p.workspace AND r.id='booth-'||p.ticket AND r.deposit_id=?
      AND q.confirmed=1 AND q.payload->>'intake_version'=2
      AND d.payload->>'code_expires_at'>? AND d.payload->>'code_expires_at'>p.expires_at AND (
        EXISTS(SELECT 1 FROM json_each(d.payload,'$.remaining') WHERE value>0)
        OR EXISTS(SELECT 1 FROM sharepass_ledger_collections c WHERE c.owner=d.owner AND c.deposit_id=d.id AND c.pending=1)
      )
  )`).bind(data.deposit.id,staff.workspace,data.deposit.booth_id,now,data.deposit.id,now).run();
}
async function guestReceiptResult(result,env,ctx,staff){
  const config=webPushSettings(env);
  if(!config||!result.ok)return result;
  const data=await result.clone().json();
  if(!data.deposit?.id)return result;
  const db=env.DB;
  const deliver=async()=>{
    const rows=await db.prepare(`SELECT p.ticket,p.endpoint FROM sharepass_ledger_requests r
      JOIN sharepass_receipt_push p ON p.workspace=r.owner AND p.ticket=substr(r.id,7)
      JOIN sharepass_booth_queue q ON q.token=p.ticket AND q.workspace=p.workspace AND q.booth_id=p.booth_id AND q.confirmed=1
      WHERE r.owner=? AND r.deposit_id=? AND substr(r.id,1,6)='booth-' AND p.booth_id=? AND p.expires_at>? LIMIT 1`)
      .bind(staff.workspace,data.deposit.id,data.deposit.booth_id,Date.now()).all();
    await sendWebPush(config,rows.results,'sharepass-receipt',(endpoint,row)=>
      db.prepare('DELETE FROM sharepass_receipt_push WHERE ticket=? AND endpoint=?').bind(row.ticket,endpoint).run());
  };
  // Reconcile separately from delivery, including replay after a prior
  // post-commit failure. Only still-live consent can be repaired.
  await reconcileGuestReceiptConsent(db,staff,data).catch(()=>{});
  if(data.replayed)return result;
  const pending=deliver().catch(()=>{});
  if(typeof ctx?.waitUntil==='function')ctx.waitUntil(pending);
  else await pending;
  return result;
}
