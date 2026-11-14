const BOOTH_LABEL='SharePass staff';
const QUEUE_LIFETIME_MS=2*60*60*1000;
const QUEUE_RECOVERY_MS=24*60*60*1000;

function messageCounts(counts){return ['normal','vip','vvip','mip'].filter(key=>counts[key]>0).map(key=>counts[key]+' '+(key==='normal'?'Normal':key.toUpperCase())).join(' + ');}
function messageGreeting(name){return 'Hi'+(name?' '+name:'')+'!\nSharePass by Bullseye Entertainment\n\n';}
function receiptProof(result,origin,name,phone,staffName,replacement=false){
  const deposit=result.deposit,code=result.collection_code;
  if(!phone||!/^\d{4}$/.test(code)||!/^PKT-[A-F0-9]{8}$/.test(deposit.packet_id))return null;
  const url=new URL(origin);
  if(url.origin!==origin||url.protocol!=='https:')return null;
  const expiry=Number.isFinite(deposit.code_expires_at)?'Code expires: '+new Date(deposit.code_expires_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true})+' IST (UTC+05:30)\n':'';
  const message=messageGreeting(name)+(replacement?'New collection code: '+code+'\nThe previous code no longer works.\nGroup passes remaining: '+messageCounts(deposit.remaining)+'\n':
    'Deposit confirmed'+(staffName?' by '+staffName:'')+'.\nPasses received: '+messageCounts(deposit.initial||deposit.remaining)+'\nCollection code: '+code+'\n')+
    expiry+'Receipt: '+origin+'/pickup#'+code+'.'+deposit.packet_id+'\n\n'+(replacement?'Share this updated receipt only with your collectors.':'Keep this as your deposit confirmation.');
  return {address:phone,name,message};
}

function boothMissing(){return error('This booth link is unavailable. Ask the booth team for help.',404);}

function contactFields(value){
  const name=typeof value?.name==='string'?value.name.trim():'';
  const phone=typeof value?.phone==='string'?value.phone.trim():'';
  const email=typeof value?.email==='string'?value.email.trim():'';
  if(!value||['name','phone','email'].some(key=>value[key]!==undefined&&typeof value[key]!=='string')
      ||name.length>80||/[\u0000-\u001f\u007f]/.test(name)
      ||phone.length>32||(phone&&!/^\+?[\d ().-]+$/.test(phone))
      ||(phone&&!/^\d{7,15}$/.test(phone.replace(/\D/g,'')))
      ||(email&&!emailAddress(email)))return null;
  return {name,phone,email};
}

function updatePreference(channel,contact){
  if(channel===undefined||channel===''||channel==='none')return null;
  if(!['whatsapp','sms','email'].includes(channel)||!contact)return false;
  const address=channel==='whatsapp'?sharePassPhone(contact.phone):channel==='email'?contact.email:contact.phone.replace(/\D/g,'');
  if(channel==='email'?!emailAddress(address):!/^[1-9][0-9]{7,14}$/.test(address))return false;
  return {channel,address,name:contact.name};
}

function separateCollectorPhones(contact,recipients){
  const depositor=sharePassPhone(contact?.phone);
  return !depositor||!recipients.some(person=>person?.phone&&sharePassPhone(person.phone)===depositor);
}

async function boothPosterDetails(db,staff,origin){
  return {url:origin+'/deposit',booth:BOOTH_LABEL};
}

async function boothPoster(db,staff,origin){
  const details=await boothPosterDetails(db,staff,origin);
  return details?json(details):boothMissing();
}

async function publicDesk(request,env,ctx,origin,ticket,alerts){
  const owner=await env.DB.prepare('SELECT user_id FROM sharepass_staff WHERE email=?').bind(emailAddress(env.SHAREPASS_OWNER_EMAIL)).first();
  if(!owner?.user_id)return error('The staff register is not ready. Please ask staff for help.',503,false);
  return publicBooth(request,env,ctx,null,origin,ticket,alerts,owner.user_id);
}

async function publicBooth(request,env,ctx,token,origin,ticket,alerts,workspace){
  const db=env.DB;
  const poster=workspace?{workspace,booth_id:'B1',name:BOOTH_LABEL,archived:0}:await db.prepare('SELECT workspace,id AS booth_id,name,archived FROM sharepass_configured_booths WHERE poster_token=?').bind(token).first()
    ||await db.prepare("SELECT p.workspace,'B1' AS booth_id,'Box office' AS name,coalesce(b.archived,0) AS archived FROM sharepass_booth_posters p LEFT JOIN sharepass_configured_booths b ON b.workspace=p.workspace AND b.id='B1' WHERE p.token=?").bind(token).first();
  if(!poster)return boothMissing();
  // Old QR links remain valid; legacy partitions no longer limit the shared desk.
  poster.name=BOOTH_LABEL;poster.archived=0;poster.booth_id='B1';
  const reset=await registerResetState(db,poster.workspace);
  if(ticket&&(reset.tickets||[]).includes(ticket))return json({error:'This register was reset. Start a new deposit.',notExecuted:true,register_reset_at:reset.at},410);
  if(alerts)return guestReceiptSubscription(request,env,poster,origin);
  if(request.method==='GET'){
    if(ticket===null){
      const publicKey=webPushSettings(env)?.publicKey;
      return json({booth:poster.name,archived:!!poster.archived,register_reset_at:reset.at,...(publicKey?{alerts_key:publicKey}:{})});
    }
    if(!intakeTokenPattern.test(ticket))return boothMissing();
    return boothReceipt(db,poster,ticket);
  }
  if(request.method!=='POST')return boothMissing();
  if(request.headers.get('Origin')!==origin)return error('Cross-origin changes are blocked.',403);
  const input=await bodyJson(request);
  if((reset.tickets||[]).includes(input?.request_id))return json({error:'This register was reset. Start a new deposit.',notExecuted:true,register_reset_at:reset.at},410);
  const contact=contactFields(input),quantities=passQuantities(input?.quantities);
  if(!contact?.name||!quantities||!Object.values(quantities).some(Boolean)||
      typeof input.request_id!=='string'||!intakeTokenPattern.test(input.request_id)||
      !Array.isArray(input.recipients)||input.recipients.length>20)return error('Enter your name, valid contact details, and at least one pass.',400);
  const current=input.intake_version===2;
  let recipients=input.recipients.map(contactFields);
  if(recipients.some(item=>!item||!(item.name||item.phone||item.email)))return error('Review the recipient names and contact details.',400);
  if(!separateCollectorPhones(contact,recipients))return error('The collector must have a different WhatsApp number from the depositor.',400);
  if(current){
    recipients=recipients.map((person,i)=>({...person,...(Object.hasOwn(input.recipients[i],'quantities')?{quantities:passQuantities(input.recipients[i].quantities)}:{})}));
    if(!sharePassPhone(contact.phone)||recipients.some(person=>!person.name||!sharePassPhone(person.phone)||
      (Object.hasOwn(person,'quantities')&&(!person.quantities||!Object.values(person.quantities).some(Boolean))))||
      ['normal','vip','vvip','mip'].some(key=>recipients.reduce((sum,person)=>sum+(person.quantities?.[key]||0),0)>(quantities[key]||0))){
      return error('Check WhatsApp numbers. Optional collector plans must fit within the deposited passes by type.',400);
    }
  }
  const update=updatePreference(input.update_channel,contact);
  if(update===false)return error('Enter a valid address for your chosen pickup update channel.',400);
  const payload=JSON.stringify({...contact,quantities,recipients,...(update?{update}:{}),...(current?{intake_version:2}:{})});
  const prior=await db.prepare('SELECT payload FROM sharepass_booth_queue WHERE token=? AND workspace=?')
    .bind(input.request_id,poster.workspace).first();
  if(prior){
    if(prior.payload!==payload)return error('These details have already been sent. Tell staff if anything changed.',409);
    return current?boothReceipt(db,poster,input.request_id):json({status:'submitted',queue_ref:input.request_id.slice(-6).toUpperCase()});
  }
  const now=Date.now(),expires=now+QUEUE_LIFETIME_MS;
  // Confirmed receipts can outlive their intake. Wait for legacy import before pruning them.
  await db.prepare(`DELETE FROM sharepass_booth_queue AS q WHERE q.expires_at<=? AND (q.confirmed=0 OR (
    EXISTS(SELECT 1 FROM sharepass_ledger_ready m WHERE m.owner=q.workspace)
    AND NOT EXISTS(
      SELECT 1 FROM sharepass_ledger_requests r
      JOIN sharepass_ledger_deposits d ON d.owner=r.owner AND d.id=r.deposit_id
      WHERE r.owner=q.workspace AND r.id='booth-'||q.token AND d.booth=q.booth_id AND q.payload->>'intake_version'=2
        AND (EXISTS(SELECT 1 FROM sharepass_ledger_collections c WHERE c.owner=d.owner AND c.deposit_id=d.id AND c.pending=1)
          OR (d.payload->>'code_expires_at'>? AND EXISTS(
            SELECT 1 FROM json_each(d.payload,'$.remaining') amount WHERE amount.type='integer' AND amount.value>0)))
    )))`).bind(now-QUEUE_RECOVERY_MS,now).run();
  const inserted=await db.prepare(`INSERT OR IGNORE INTO sharepass_booth_queue(token,workspace,booth_id,submitted_at,expires_at,payload)
    SELECT ?,?,?,?,?,? WHERE (SELECT count(*) FROM sharepass_booth_queue WHERE workspace=? AND confirmed=0 AND expires_at>?)<120
      AND coalesce((SELECT theme FROM sharepass_code_policy WHERE owner=? AND event=?),'0')=?`)
    .bind(input.request_id,poster.workspace,poster.booth_id,now,expires,payload,poster.workspace,now,poster.workspace,RESET_STATE_EVENT,String(reset.at)).run();
  if(inserted.meta.changes===0){
    const prior=await db.prepare('SELECT payload FROM sharepass_booth_queue WHERE token=? AND workspace=?').bind(input.request_id,poster.workspace).first();
    if(!prior){
      const latest=await registerResetState(db,poster.workspace);
      if(latest.at!==reset.at)return json({error:'This register was reset. Start a new deposit.',notExecuted:true,register_reset_at:latest.at},410);
      return error('The booth queue is full. Let the booth staff know.',429);
    }
    if(prior.payload!==payload)return error('These details have already been sent. Tell staff if anything changed.',409);
  }else await scheduleBoothPush(env,ctx,poster.workspace,poster.booth_id);
  return json({status:'submitted',...(current?{name:contact.name}:{}),queue_ref:input.request_id.slice(-6).toUpperCase()});
}

async function boothReceipt(db,poster,ticket){
  const row=await db.prepare('SELECT payload,expires_at,confirmed FROM sharepass_booth_queue WHERE workspace=? AND token=?')
    .bind(poster.workspace,ticket).first();
  if(!row)return boothMissing();
  const fields=JSON.parse(row.payload);
  if(fields.intake_version!==2)return boothMissing();
  const queue_ref=ticket.slice(-6).toUpperCase();
  if(!row.confirmed)return json({status:row.expires_at>Date.now()?'submitted':'closed',queue_ref,name:fields.name});
  const committed=await ledgerReceipt(db,poster.workspace,'booth-'+ticket);
  if(!committed)return json({status:row.expires_at>Date.now()?'submitted':'closed',queue_ref});
  const deposit=committed.deposit;
  if(deposit&&committed.pending)return json({status:'checking',queue_ref});
  if(!deposit||deposit.code_expires_at<=Date.now()||!Object.values(deposit.remaining).some(Boolean)){
    return json({status:'closed',queue_ref});
  }
  return json({status:'confirmed',queue_ref,booth:poster.name,collection_code:deposit.active_collection_code||committed.receipt.collection_code,
    name:fields.name,depositor_name:fields.name,staff_name:deposit.received_by_name||'',collection_reference:deposit.packet_id,code_expires_at:deposit.code_expires_at,remaining:deposit.remaining,
    recipients:fields.recipients.map(({name,phone,quantities})=>({name,phone,quantities}))});
}

function queueFields(row,detail=false){
  const fields=JSON.parse(row.payload);
  return {
    token:row.token,queue_ref:row.token.slice(-6).toUpperCase(),name:fields.name,quantities:fields.quantities,
    submitted_at:row.submitted_at,expires_at:row.expires_at,
    ...(detail?{phone:fields.phone,email:fields.email,recipients:fields.recipients,update_channel:fields.update?.channel||'',intake_version:fields.intake_version}:{})
  };
}

async function queueList(db,staff){
  const rows=await db.prepare(`SELECT token,payload,submitted_at,expires_at FROM sharepass_booth_queue
    WHERE workspace=? AND confirmed=0 AND expires_at>? ORDER BY submitted_at,token LIMIT 120`)
    .bind(staff.workspace,Date.now()).all();
  const messages=await pendingStaffPrompts(db,staff);
  return json({drafts:rows.results.map(row=>queueFields(row)),...(messages.length?{messages}:{})});
}

async function queueItem(request,db,staff,token,confirm,theme,allowCodeReuse){
  const row=await db.prepare('SELECT token,payload,booth_id,submitted_at,expires_at,confirmed FROM sharepass_booth_queue WHERE workspace=? AND token=?')
    .bind(staff.workspace,token).first();
  if(!row)return boothMissing();
  const booth=row.booth_id;
  const expired=row.expires_at<=Date.now(),fields=queueFields(row,true);
  if(!confirm){
    if(request.method!=='GET'||expired||row.confirmed)return boothMissing();
    return json(fields);
  }
  if(request.method!=='POST')return boothMissing();
  const input=await bodyJson(request);
  const location=input?.location??'Packet '+token.slice(-12).toUpperCase();
  const body=validate({...input,location,valid_minutes:input?.valid_minutes??(fields.intake_version===2?1440:undefined),request_id:'booth-'+token,quantities:fields.quantities},'/api/deposits',staff.operator,booth);
  if(!body)return error('Check the shelf, code, expiry, and physical receipt.',400);
  body.depositor_label=fields.name;
  await ensureLedger(db,staff.workspace);
  const preference=JSON.parse(row.payload).update;
  const previous=await db.prepare('SELECT payload FROM sharepass_ledger_requests WHERE owner=? AND id=?').bind(staff.workspace,'booth-'+token).first();
  if(previous){
    const recorded=JSON.parse(JSON.parse(previous.payload).fingerprint)[1];
    if(Object.hasOwn(recorded,'update_contact'))body.update_contact=recorded.update_contact;
  }else if(preference)body.update_contact=preference;
  else if(fields.intake_version===2&&sharePassPhone(fields.phone))body.update_contact={channel:'whatsapp',address:sharePassPhone(fields.phone),name:fields.name};
  const result=await mutate(db,staff.workspace,'/api/deposits',body,staff.admin,expired,false,theme,{booth:true,token},allowCodeReuse,false,staff.name,staff);
  if(!result.ok)return result;
  if((await result.clone().json()).replayed)await db.prepare('UPDATE sharepass_booth_queue SET confirmed=1 WHERE workspace=? AND token=?').bind(staff.workspace,token).run();
  const recipients=fields.recipients.length?fields.recipients:
    [{name:fields.name,phone:fields.phone,email:fields.email}].filter(item=>item.phone||item.email);
  const depositorPhone=sharePassPhone(fields.phone);
  const received=await result.clone().json();
  const proof=receiptProof(received,new URL(request.url).origin,fields.name,depositorPhone,staff.name);
  return json({...await result.json(),recipients,update_channel:preference?.channel||'',
    depositor_phone:depositorPhone||'',depositor_name:fields.name,depositor_receipt:proof});
}

async function refreshedReceiptContacts(db,staff,response,origin){
  if(!response.ok)return response;
  const result=await response.json();
  const row=await db.prepare(`SELECT q.payload,d.payload->'$.update_contact' AS update_contact FROM sharepass_booth_queue q
    JOIN sharepass_ledger_requests r ON r.owner=q.workspace AND r.id='booth-'||q.token
    JOIN sharepass_ledger_deposits d ON d.owner=r.owner AND d.id=r.deposit_id
    WHERE q.workspace=? AND r.deposit_id=? AND q.confirmed=1 LIMIT 1`)
    .bind(staff.workspace,result.deposit.id).first();
  if(!row)return json(result);
  const fields=JSON.parse(row.payload),phone=sharePassPhone(fields.phone),preference=row.update_contact?JSON.parse(row.update_contact):null;
  return json({...result,receipt_purpose:'replacement',depositor_phone:phone||'',depositor_name:fields.name,
    recipients:fields.recipients,update_channel:preference?.channel||'',
    update_address:preference?.channel==='whatsapp'?preference.address:'',
    depositor_receipt:receiptProof(result,origin,fields.name,phone,'',true)});
}
