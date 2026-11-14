const STAFF_COOKIE='__Host-sharepass-staff';
const SETUP_LIFETIME_MS=5*60*1000;
const DEVICE_LIFETIME_MS=30*24*60*60*1000;
const UUID='[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
const boothIdPattern=new RegExp('^(?:B1|B-'+UUID+')$');

function setupText(value,max){
  return typeof value==='string'&&value.trim()&&value.trim().length<=max&&!/[\u0000-\u001f\u007f]/.test(value)?value.trim():'';
}

function staffCookie(request){
  const header=request.headers.get('Cookie')||'';
  return header.split(';').map(piece=>piece.trim()).find(piece=>piece.startsWith(STAFF_COOKIE+'='))?.slice(STAFF_COOKIE.length+1)||'';
}

function staffCookieHeader(value,maxAge){
  return STAFF_COOKIE+'='+value+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age='+maxAge;
}

async function boothConfiguration(db,workspace,id='B1'){
  if(id==='B1')await db.prepare('INSERT OR IGNORE INTO sharepass_configured_booths(workspace,id,name,location,poster_token) VALUES(?,?,?,?,?)')
    .bind(workspace,id,BOOTH_LABEL,'',crypto.randomUUID()).run();
  return db.prepare('SELECT id,name,location,poster_token,archived FROM sharepass_configured_booths WHERE workspace=? AND id=?').bind(workspace,id).first();
}

async function setupState(db,workspace){
  await boothConfiguration(db,workspace);
  const [booths,staff,devices,release]=await Promise.all([
    db.prepare('SELECT id,name,location,archived FROM sharepass_configured_booths WHERE workspace=? ORDER BY name').bind(workspace).all(),
    db.prepare('SELECT id,name,booth_id FROM sharepass_configured_staff WHERE workspace=? ORDER BY name').bind(workspace).all(),
    db.prepare(`SELECT d.id,d.label,d.staff_id,s.name AS staff_name,s.booth_id,d.designation,d.active,
      (d.digest IS NOT NULL AND d.session_expires>?) AS paired,
      h.first_connected_at,h.last_seen_at,h.app_version,h.app_version_code,h.platform,h.notifications_enabled,
      EXISTS(SELECT 1 FROM sharepass_push_tokens p WHERE p.device_id=d.id) AS push_registered
      FROM sharepass_configured_devices d JOIN sharepass_configured_staff s ON s.id=d.staff_id
      LEFT JOIN sharepass_device_status h ON h.device_id=d.id WHERE d.workspace=? ORDER BY d.label,d.id`)
      .bind(Date.now(),workspace).all(),
    db.prepare('SELECT version_code,version_name,accepted_at FROM sharepass_android_release_state WHERE id=1').bind().first()
  ]);
  return {booths:booths.results,staff:staff.results,latest_android_release:release,devices:devices.results.map(d=>({...d,active:!!d.active,paired:!!d.paired&&!!d.active,
    push_registered:!!d.push_registered,notifications_enabled:d.notifications_enabled===null?null:!!d.notifications_enabled}))};
}

// A device is identified only by its authenticated pairing. Reports cannot
// overwrite another phone, and sign-out retains its non-secret history.
async function recordDeviceSeen(db,staff,details=null,firstConnection=false){
  if(!staff.device_id)return;
  const now=Date.now();
  if(!details){
    await db.prepare(`INSERT INTO sharepass_device_status(device_id,first_connected_at,last_seen_at) VALUES(?,?,?)
      ON CONFLICT(device_id) DO UPDATE SET last_seen_at=excluded.last_seen_at,
        first_connected_at=coalesce(first_connected_at,excluded.first_connected_at)
      WHERE last_seen_at<? OR first_connected_at IS NULL AND excluded.first_connected_at IS NOT NULL`)
      .bind(staff.device_id,firstConnection?now:null,now,now-60000).run();
    return;
  }
  await db.prepare(`INSERT INTO sharepass_device_status
    (device_id,first_connected_at,last_seen_at,app_version,app_version_code,platform,notifications_enabled)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(device_id) DO UPDATE SET
      last_seen_at=excluded.last_seen_at,
      app_version=coalesce(excluded.app_version,app_version),
      app_version_code=coalesce(excluded.app_version_code,app_version_code),
      platform=coalesce(excluded.platform,platform),
      notifications_enabled=coalesce(excluded.notifications_enabled,notifications_enabled)`)
    .bind(staff.device_id,null,now,details.app_version??null,details.app_version_code??null,
      details.platform??null,typeof details.notifications_enabled==='boolean'?Number(details.notifications_enabled):null).run();
}

async function deviceStatus(request,db,staff){
  const details=await bodyJson(request);
  if(!details||
    (details.app_version!==undefined&&(typeof details.app_version!=='string'||!/^[-+.A-Za-z0-9]{1,40}$/.test(details.app_version)))||
    (details.app_version_code!==undefined&&(!Number.isSafeInteger(details.app_version_code)||details.app_version_code<1||details.app_version_code>2147483647))||
    (details.platform!==undefined&&!['android','web'].includes(details.platform))||
    (details.notifications_enabled!==undefined&&typeof details.notifications_enabled!=='boolean')){
    return error('Invalid device status.',400);
  }
  await recordDeviceSeen(db,staff,details);
  return json({recorded:true});
}

const DEPOSIT_STORAGE_LIMIT=9000000000;

const RESET_STATE_EVENT='sharepass-register-reset';
async function registerResetState(db,owner){
  const row=await db.prepare('SELECT theme,overrides FROM sharepass_code_policy WHERE owner=? AND event=?').bind(owner,RESET_STATE_EVENT).first();
  return row?{at:Number(row.theme)||0,...JSON.parse(row.overrides)}:{at:0,codes:[],requests:[],tickets:[]};
}
async function staffReconnectionRequired(env,verifier){
  const digest=await verifierDigest(verifier);
  const retained=digest?await env.DB.prepare(`SELECT workspace FROM sharepass_configured_devices WHERE digest=?
    UNION ALL SELECT m.user_id AS workspace FROM sharepass_mobile_sessions m WHERE digest=? AND (
      EXISTS(SELECT 1 FROM sharepass_ledger_ready WHERE owner=m.user_id) OR
      EXISTS(SELECT 1 FROM sharepass_workspaces WHERE owner_id=m.user_id) OR
      EXISTS(SELECT 1 FROM sharepass_owner_passwords WHERE owner_id=m.user_id)) LIMIT 1`).bind(digest,digest).first():null;
  const owner=await env.DB.prepare('SELECT user_id FROM sharepass_staff WHERE email=?').bind(emailAddress(env.SHAREPASS_OWNER_EMAIL)).first();
  const reset=retained?await registerResetState(env.DB,retained.workspace):owner?.user_id?await registerResetState(env.DB,owner.user_id):{at:0};
  const resetAt=retained||(reset.device_digests||[]).includes(digest)?reset.at:0;
  const response=json({error:'Ask the administrator for a new staff setup code.',notExecuted:true,register_reset_at:resetAt},401);
  response.headers.set('Set-Cookie',staffCookieHeader('',0));return response;
}
async function registerBackup(db){
  const names=(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'sharepass_%' ORDER BY name").bind().all()).results.map(row=>row.name);
  if(names.some(name=>!/^sharepass_[a-z_]+$/.test(name)))return error('The backup schema could not be validated.',503,false);
  const values=await db.batch(names.flatMap(name=>[db.prepare('PRAGMA table_info("'+name+'")').bind(),db.prepare('SELECT * FROM "'+name+'" LIMIT 10001').bind()]));
  if(values.some((result,index)=>index%2===1&&result.results.length>10000))return error('This register requires a larger administrative export before reset.',413);
  const data={schema:1,product:'SharePass',exported_at:new Date().toISOString(),tables:names.map((name,index)=>({name,columns:values[index*2].results.map(column=>column.name),rows:values[index*2+1].results,short:0}))};
  const body=JSON.stringify(data);if(new TextEncoder().encode(body).length>16*1024*1024)return error('This register requires a larger administrative export before reset.',413);
  return new Response(body,{headers:{...security,'Content-Type':'application/json','Content-Disposition':'attachment; filename="SharePass-register-backup.json"'}});
}
async function resetRegister(request,db,staff){
  const body=await bodyJson(request);
  if(body?.confirmation!=='RESET SHAREPASS'||body?.delete_staff!==true||!staffPromptId(body?.request_id))return error('Confirm the full register and staff reset.',400);
  const before=await registerResetState(db,staff.workspace);
  if(before.request_id===body.request_id)return json({reset:true,reset_at:before.at,replayed:true});
  const foreignIdentities=`SELECT owner AS id FROM sharepass_ledger_ready WHERE owner<>?
    UNION SELECT owner_id FROM sharepass_workspaces WHERE owner_id<>?
    UNION SELECT owner_id FROM sharepass_owner_passwords WHERE owner_id<>?
    UNION SELECT id FROM sharepass_configured_staff WHERE workspace<>?`;
  const [codes,requests,tickets,memberships,deviceDigests]=await db.batch([
    db.prepare('SELECT code FROM sharepass_ledger_codes WHERE owner=?').bind(staff.workspace),
    db.prepare('SELECT id FROM sharepass_ledger_requests WHERE owner=?').bind(staff.workspace),
    db.prepare('SELECT token FROM sharepass_booth_queue WHERE workspace=?').bind(staff.workspace),
    db.prepare('SELECT user_id FROM sharepass_staff WHERE user_id IS NOT NULL AND user_id<>?').bind(staff.workspace),
    db.prepare('SELECT digest FROM sharepass_configured_devices WHERE workspace=? AND digest IS NOT NULL UNION SELECT digest FROM sharepass_mobile_sessions WHERE user_id IN (SELECT user_id FROM sharepass_staff WHERE user_id NOT IN ('+foreignIdentities+'))').bind(staff.workspace,staff.workspace,staff.workspace,staff.workspace,staff.workspace)
  ]);
  const at=Math.max(Date.now(),before.at+1),guard={request_id:body.request_id,
    codes:[...new Set([...(before.codes||[]),...codes.results.map(row=>row.code)])],
    requests:[...new Set([...(before.requests||[]),...requests.results.map(row=>row.id)])],
    tickets:[...new Set([...(before.tickets||[]),...tickets.results.map(row=>row.token)])],
    memberships:[...new Set([...(before.memberships||[]),...memberships.results.map(row=>row.user_id)])],
    device_digests:[...new Set([...(before.device_digests||[]),...deviceDigests.results.map(row=>row.digest)])]};
  const statements=[db.prepare(`INSERT INTO sharepass_ledger_guard(ok) VALUES(coalesce((SELECT theme FROM sharepass_code_policy WHERE owner=? AND event=?),'0')=?)`).bind(staff.workspace,RESET_STATE_EVENT,String(before.at))];
  // Only non-identifying replay/code guards survive; deleted customer records cannot be resurrected.
  statements.push(db.prepare('INSERT INTO sharepass_code_policy(owner,event,theme,overrides) VALUES(?,?,?,?) ON CONFLICT(owner,event) DO UPDATE SET theme=excluded.theme,overrides=excluded.overrides').bind(staff.workspace,RESET_STATE_EVENT,String(at),JSON.stringify(guard)));
  for(const table of ['sharepass_push_tokens','sharepass_device_status','sharepass_android_release_deliveries'])statements.push(db.prepare('DELETE FROM '+table+' WHERE device_id IN (SELECT id FROM sharepass_configured_devices WHERE workspace=?)').bind(staff.workspace));
  for(const [table,column] of [
    ...['deposits','codes','collections','requests','claims','failures','audit'].map(name=>['sharepass_ledger_'+name,'owner']),
    ['sharepass_workspaces','owner_id'],...['intakes','booth_queue','receipt_push','staff_prompt_recipients','staff_prompts','web_push','configured_devices','configured_staff','configured_booths','booth_posters'].map(name=>['sharepass_'+name,'workspace'])
  ])statements.push(db.prepare('DELETE FROM '+table+' WHERE '+column+'=?').bind(staff.workspace));
  statements.push(db.prepare('DELETE FROM sharepass_mobile_sessions WHERE user_id IN (SELECT user_id FROM sharepass_staff WHERE user_id NOT IN ('+foreignIdentities+'))').bind(staff.workspace,staff.workspace,staff.workspace,staff.workspace));
  statements.push(db.prepare('DELETE FROM sharepass_staff WHERE user_id IS NULL OR (user_id<>? AND user_id NOT IN ('+foreignIdentities+'))').bind(staff.workspace,staff.workspace,staff.workspace,staff.workspace,staff.workspace));
  statements.push(db.prepare('INSERT OR IGNORE INTO sharepass_ledger_ready(owner) VALUES(?)').bind(staff.workspace));
  statements.push(db.prepare('DELETE FROM sharepass_ledger_guard WHERE ok=1').bind());
  try{await db.batch(statements);}catch{
    const current=await registerResetState(db,staff.workspace);
    if(current.request_id===body.request_id)return json({reset:true,reset_at:current.at,replayed:true});
    return error('The register changed while resetting. Review its current state before trying again.',409,false);
  }
  return json({reset:true,reset_at:at,staff_removed:true,devices_removed:true});
}

function storageStatus(meta){
  const size=Number.isSafeInteger(meta?.size_after)&&meta.size_after>0?meta.size_after:null;
  return {used_bytes:size,limit_bytes:DEPOSIT_STORAGE_LIMIT,at_limit:size!==null&&size>=DEPOSIT_STORAGE_LIMIT};
}

async function adminReport(db,workspace){
  await ensureLedger(db,workspace);
  const sum=(alias,column)=>['normal','vip','vvip','mip'].map(key=>"coalesce("+alias+"payload->>'$."+column+"."+key+"',0)").join('+');
  const [people,deposits,pending]=await db.batch([
    db.prepare("SELECT id,name FROM sharepass_configured_staff WHERE workspace=? UNION SELECT user_id AS id,coalesce(display_name,'Administrator') AS name FROM sharepass_staff WHERE user_id=?").bind(workspace,workspace),
    db.prepare("SELECT payload->>'created_by' AS id,max(payload->>'received_by_name') AS name,count(*) AS deposits,sum("+sum('','initial')+") AS received,sum("+sum('','remaining')+") AS available FROM sharepass_ledger_deposits WHERE owner=? GROUP BY payload->>'created_by'").bind(workspace),
    db.prepare("SELECT d.payload->>'created_by' AS id,sum("+sum('c.','quantities')+") AS pending FROM sharepass_ledger_collections c JOIN sharepass_ledger_deposits d ON d.owner=c.owner AND d.id=c.deposit_id WHERE c.owner=? AND c.pending=1 GROUP BY d.payload->>'created_by'").bind(workspace)
  ]);
  const names=new Map(people.results.map(p=>[p.id,p.name])),rows=new Map();
  for(const record of deposits.results)rows.set(record.id,{...record,name:names.get(record.id)||record.name||'Staff member',pending:0});
  for(const record of pending.results)if(rows.has(record.id))rows.get(record.id).pending=record.pending;
  for(const row of rows.values())row.handed_over=row.received-row.available-row.pending;
  const staff=[...rows.values()],totals={name:'SharePass',deposits:0,received:0,available:0,pending:0,handed_over:0};
  for(const row of staff)for(const key of ['deposits','received','available','pending','handed_over'])totals[key]+=row[key];
  return json({staff,totals,booths:[{id:'B1',...totals}],storage:storageStatus(pending.meta)});
}

async function adminSetup(request,db,workspace,origin){
  if(request.method==='GET')return json(await setupState(db,workspace));
  if(request.method!=='POST')return error('Page not found.',404);
  await boothConfiguration(db,workspace);
  const body=await bodyJson(request);
  if(body?.action==='archive-booth'){
    if(body.confirmed!==true||!boothIdPattern.test(body.booth_id||''))return error('Confirm the booth to archive.',400);
    const changed=await db.prepare('UPDATE sharepass_configured_booths SET archived=1 WHERE workspace=? AND id=?').bind(workspace,body.booth_id).run();
    if(changed.meta.changes!==1)return error('Booth not found.',404);
    return json(await setupState(db,workspace));
  }
  if(body?.action==='booth'){
    const name=setupText(body.name,80),location=setupText(body.location,100);
    if(!name||!location)return error('Enter the booth name and pickup location.',400);
    await db.prepare('INSERT INTO sharepass_configured_booths(workspace,id,name,location,poster_token) VALUES(?,?,?,?,?)')
      .bind(workspace,'B-'+crypto.randomUUID(),name,location,crypto.randomUUID()).run();
    return json(await setupState(db,workspace));
  }
  if(body?.action==='revoke'){
    const changed=await db.prepare("UPDATE sharepass_configured_devices SET active=0,setup_code='' WHERE workspace=? AND id=?").bind(workspace,body.device_id||'').run();
    if(changed.meta.changes!==1)return error('Device not found.',404);
    await db.prepare('DELETE FROM sharepass_push_tokens WHERE device_id=?').bind(body.device_id).run();
    return json(await setupState(db,workspace));
  }
  const name=setupText(body?.staff_name,80),booth=body?.booth_id||'B1';
  const label=setupText(body?.device_label,80)||(name?(name+"'s phone").slice(0,80):'');
  const designation=body?.designation??'Counter staff';
  if(body?.action!=='invite'||!name||!label||
     (body.device_label!==undefined&&body.device_label!==''&&!setupText(body.device_label,80))||
     !['Counter staff','Deposit desk','Collection desk'].includes(designation)||
     !boothIdPattern.test(booth||'')||!(await boothConfiguration(db,workspace,booth))){
    return error('Enter the staff name.',400);
  }
  const now=Date.now(),expires_at=now+SETUP_LIFETIME_MS;
  await db.prepare("UPDATE sharepass_configured_devices SET setup_code='' WHERE setup_code<>'' AND invite_expires<=?").bind(now).run();
  const selected=body.staff_id?await db.prepare('SELECT id FROM sharepass_configured_staff WHERE workspace=? AND id=? AND name=?').bind(workspace,body.staff_id,name).first():null;
  if(body.staff_id&&!selected)return error('Choose a current staff name.',400);
  // One SQLite statement serializes concurrent first invitations for this person.
  if(!selected)await db.prepare(`INSERT INTO sharepass_configured_staff(workspace,id,booth_id,name)
    SELECT ?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM sharepass_configured_staff WHERE workspace=? AND booth_id=? AND name=?)`)
    .bind(workspace,crypto.randomUUID(),booth,name,workspace,booth,name).run();
  const staff=selected||await db.prepare('SELECT id FROM sharepass_configured_staff WHERE workspace=? AND booth_id=? AND name=? ORDER BY id LIMIT 1')
    .bind(workspace,booth,name).first();
  const staffId=staff.id;
  const id=crypto.randomUUID(),invite=crypto.randomUUID();
  for(let attempt=0;attempt<12;attempt++){
    const code=String(crypto.getRandomValues(new Uint32Array(1))[0]%10000).padStart(4,'0');
    const result=await db.prepare('INSERT OR IGNORE INTO sharepass_configured_devices(workspace,id,staff_id,label,invite,setup_code,invite_expires,designation) VALUES(?,?,?,?,?,?,?,?)')
      .bind(workspace,id,staffId,label,invite,code,expires_at,designation).run();
    if(result.meta.changes===1)return json({...await setupState(db,workspace),code,expires_at,qr_url:origin+'/app-setup?invite='+invite});
  }
  return error('Could not issue a setup code. Try again.',409);
}

async function setupAttempt(db,scope,minute,limit){
  const result=await db.prepare(`INSERT INTO sharepass_setup_limits(scope,minute,attempts) VALUES(?,?,1)
    ON CONFLICT(scope,minute) DO UPDATE SET attempts=attempts+1 WHERE attempts<?`).bind(scope,minute,limit).run();
  return result.meta.changes===1;
}

async function configuredAccess(db,verifier){
  const digest=await verifierDigest(verifier);
  if(!digest)return null;
  const row=await db.prepare(`SELECT d.id AS device_id,d.workspace,d.session_expires,s.id AS operator,s.name,s.booth_id,d.designation,b.name AS booth_label,b.location AS pickup_location,b.archived,coalesce(reset.theme,'0') AS register_reset_at
    FROM sharepass_configured_devices d JOIN sharepass_configured_staff s ON d.staff_id=s.id
    JOIN sharepass_configured_booths b ON b.workspace=d.workspace AND b.id=s.booth_id
    LEFT JOIN sharepass_code_policy reset ON reset.owner=d.workspace AND reset.event='sharepass-register-reset'
    WHERE d.digest=? AND d.active=1 AND d.session_expires>?`).bind(digest,Date.now()).first();
  return row?{...row,digest,admin:false}:null;
}

function staffContext(staff,env){
  return {ticket_receipts:true,push_first:true,staff_label:staff.name,admin:staff.admin,session_key:staff.operator,booth_id:staff.booth_id||'B1',
    register_reset_at:Number(staff.register_reset_at)||0,
    shared_desk:true,booth_label:BOOTH_LABEL,booth_archived:false,designation:staff.designation||null,pickup_location:env.SHAREPASS_PICKUP_LOCATION||''};
}

async function connectDevice(request,env){
  const db=env.DB,body=await bodyJson(request),verifier=body?.verifier;
  const digest=await verifierDigest(verifier);
  const code=typeof body?.code==='string'?body.code:'',invite=typeof body?.invite==='string'?body.invite:'';
  if(!digest||(!!code===!!invite)||(code&&!/^\d{4}$/.test(code))||(invite&&!intakeTokenPattern.test(invite))){
    return error('Enter the four-digit setup code or scan its QR.',400);
  }
  const now=Date.now(),expires=now+DEVICE_LIFETIME_MS;
  let staff=await configuredAccess(db,verifier);
  const firstConnection=!staff;
  if(!staff){
    if(code){
      const minute=Math.floor(now/60000),address=request.headers.get('CF-Connecting-IP')||'unknown';
      const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(address));
      const scope=Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
      if(!(await setupAttempt(db,scope,minute,5))||!(await setupAttempt(db,'global',minute,20)))return error('Too many setup attempts. Wait one minute or use the setup QR.',429);
      await db.prepare('DELETE FROM sharepass_setup_limits WHERE minute<?').bind(minute-10).run();
    }
    const column=code?'setup_code':'invite';
    await db.prepare(`UPDATE sharepass_configured_devices SET digest=?,session_expires=?
      WHERE ${column}=? AND active=1 AND digest IS NULL AND invite_expires>?
        AND EXISTS(SELECT 1 FROM sharepass_configured_staff s
          WHERE s.id=sharepass_configured_devices.staff_id AND s.workspace=sharepass_configured_devices.workspace)`).bind(digest,expires,code||invite,now).run();
    staff=await configuredAccess(db,verifier);
  }
  if(!staff)return error('This setup has expired or was already used. Ask the desktop administrator for a new code.',403);
  await recordDeviceSeen(db,staff,null,firstConnection);
  const poster=await boothPosterDetails(db,staff,new URL(request.url).origin);
  const result=json({...staffContext(staff,env),...(poster?{booth_url:poster.url}:{}),token:verifier,expires_at:staff.session_expires});
  if(request.headers.get('Origin'))result.headers.set('Set-Cookie',staffCookieHeader(verifier,Math.ceil((staff.session_expires-now)/1000)));
  return result;
}
