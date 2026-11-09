const BOOTH_LABEL='Box office';
const QUEUE_LIFETIME_MS=2*60*60*1000;
const QUEUE_RECOVERY_MS=24*60*60*1000;

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

async function boothPoster(db,staff,origin){
  const workspace=staff.workspace,booth=staff.booth_id||'B1';
  if(booth!=='B1'){
    const row=await boothConfiguration(db,workspace,booth);
    return row?json({url:origin+'/booth/'+row.poster_token,booth:row.name}):boothMissing();
  }
  await db.prepare('INSERT OR IGNORE INTO sharepass_booth_posters(workspace,token) VALUES(?,?)').bind(workspace,crypto.randomUUID()).run();
  const row=await db.prepare('SELECT token FROM sharepass_booth_posters WHERE workspace=?').bind(workspace).first();
  return json({url:origin+'/booth/'+row.token,booth:BOOTH_LABEL});
}

async function publicBooth(request,env,ctx,token,origin,ticket,alerts){
  const db=env.DB;
  const poster=await db.prepare('SELECT workspace,id AS booth_id,name FROM sharepass_configured_booths WHERE poster_token=?').bind(token).first()
    ||await db.prepare("SELECT workspace,'B1' AS booth_id,'Box office' AS name FROM sharepass_booth_posters WHERE token=?").bind(token).first();
  if(!poster)return boothMissing();
  if(alerts)return guestReceiptSubscription(request,env,poster,origin);
  if(request.method==='GET'){
    if(ticket===null){
      const publicKey=webPushSettings(env)?.publicKey;
      return json({booth:poster.name,...(publicKey?{alerts_key:publicKey}:{})});
    }
    if(!intakeTokenPattern.test(ticket))return boothMissing();
    return boothReceipt(db,poster,ticket);
  }
  if(request.method!=='POST')return boothMissing();
  if(request.headers.get('Origin')!==origin)return error('Cross-origin changes are blocked.',403);
  const input=await bodyJson(request);
  const contact=contactFields(input),quantities=passQuantities(input?.quantities);
  if(!contact?.name||!quantities||!Object.values(quantities).some(Boolean)||
      typeof input.request_id!=='string'||!intakeTokenPattern.test(input.request_id)||
      !Array.isArray(input.recipients)||input.recipients.length>20)return error('Enter your name, valid contact details, and at least one pass.',400);
  const current=input.intake_version===2;
  let recipients=input.recipients.map(contactFields);
  if(recipients.some(item=>!item||!(item.name||item.phone||item.email)))return error('Review the recipient names and contact details.',400);
  if(current){
    recipients=recipients.map((person,i)=>({...person,quantities:passQuantities(input.recipients[i].quantities)}));
    if(!sharePassPhone(contact.phone)||!recipients.length||recipients.some(person=>!person.name||!sharePassPhone(person.phone)||
      !person.quantities||!Object.values(person.quantities).some(Boolean))||
      ['normal','vip','vvip','mip'].some(key=>recipients.reduce((sum,person)=>sum+(person.quantities[key]||0),0)!==(quantities[key]||0))){
      return error('Check WhatsApp numbers and allocate exactly the deposited passes by type.',400);
    }
  }
  const update=updatePreference(input.update_channel,contact);
  if(update===false)return error('Enter a valid address for your chosen pickup update channel.',400);
  const payload=JSON.stringify({...contact,quantities,recipients,...(update?{update}:{}),...(current?{intake_version:2}:{})});
  const now=Date.now(),expires=now+QUEUE_LIFETIME_MS;
  await db.prepare('DELETE FROM sharepass_booth_queue WHERE expires_at<=?').bind(now-QUEUE_RECOVERY_MS).run();
  const inserted=await db.prepare(`INSERT OR IGNORE INTO sharepass_booth_queue(token,workspace,booth_id,submitted_at,expires_at,payload)
    SELECT ?,?,?,?,?,? WHERE (SELECT count(*) FROM sharepass_booth_queue WHERE workspace=? AND booth_id=? AND confirmed=0 AND expires_at>?)<120`)
    .bind(input.request_id,poster.workspace,poster.booth_id,now,expires,payload,poster.workspace,poster.booth_id,now).run();
  if(inserted.meta.changes===0){
    const prior=await db.prepare('SELECT payload FROM sharepass_booth_queue WHERE token=? AND workspace=? AND booth_id=?').bind(input.request_id,poster.workspace,poster.booth_id).first();
    if(!prior)return error('The booth queue is full. Let the booth staff know.',429);
    if(prior.payload!==payload)return error('These details have already been sent. Tell staff if anything changed.',409);
  }else await scheduleBoothPush(env,ctx,poster.workspace,poster.booth_id);
  return json({status:'submitted',queue_ref:input.request_id.slice(-6).toUpperCase()});
}

async function boothReceipt(db,poster,ticket){
  const row=await db.prepare('SELECT payload,expires_at,confirmed FROM sharepass_booth_queue WHERE workspace=? AND booth_id=? AND token=?')
    .bind(poster.workspace,poster.booth_id,ticket).first();
  if(!row)return boothMissing();
  const fields=JSON.parse(row.payload);
  if(fields.intake_version!==2)return boothMissing();
  const queue_ref=ticket.slice(-6).toUpperCase();
  if(!row.confirmed)return json({status:row.expires_at>Date.now()?'submitted':'closed',queue_ref});
  const committed=await ledgerReceipt(db,poster.workspace,'booth-'+ticket);
  if(!committed)return json({status:row.expires_at>Date.now()?'submitted':'closed',queue_ref});
  const deposit=committed.deposit.booth_id===poster.booth_id?committed.deposit:null;
  if(deposit&&committed.pending)return json({status:'checking',queue_ref});
  if(!deposit||deposit.code_expires_at<=Date.now()||!Object.values(deposit.remaining).some(Boolean)){
    return json({status:'closed',queue_ref});
  }
  return json({status:'confirmed',queue_ref,booth:poster.name,collection_code:deposit.active_collection_code||committed.receipt.collection_code,
    collection_reference:deposit.packet_id,code_expires_at:deposit.code_expires_at,
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
    WHERE workspace=? AND booth_id=? AND confirmed=0 AND expires_at>? ORDER BY submitted_at,token LIMIT 120`)
    .bind(staff.workspace,staff.booth_id||'B1',Date.now()).all();
  return json({drafts:rows.results.map(row=>queueFields(row))});
}

async function queueItem(request,db,staff,token,confirm,theme,allowCodeReuse){
  const booth=staff.booth_id||'B1';
  const row=await db.prepare('SELECT token,payload,submitted_at,expires_at,confirmed FROM sharepass_booth_queue WHERE workspace=? AND booth_id=? AND token=?')
    .bind(staff.workspace,booth,token).first();
  if(!row)return boothMissing();
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
  const preference=JSON.parse(row.payload).update;
  if(preference)body.update_contact=preference;
  const result=await mutate(db,staff.workspace,'/api/deposits',body,staff.admin,expired,false,theme,{booth:true,token},allowCodeReuse);
  if(!result.ok)return result;
  if((await result.clone().json()).replayed)await db.prepare('UPDATE sharepass_booth_queue SET confirmed=1 WHERE workspace=? AND token=?').bind(staff.workspace,token).run();
  const recipients=fields.recipients.length?fields.recipients:
    [{name:fields.name,phone:fields.phone,email:fields.email}].filter(item=>item.phone||item.email);
  const depositorPhone=sharePassPhone(fields.phone);
  const counts=Object.entries(fields.quantities).filter(([,count])=>count).map(([key,count])=>count+' '+key.toUpperCase()).join(' + ');
  const proof=depositorPhone?{address:depositorPhone,message:'Hi '+fields.name+'! SharePass staff received '+counts+
    ' passes at your booth. Receipt reference '+fields.queue_ref+'. Keep this confirmation as proof of deposit.'}:null;
  return json({...await result.json(),recipients,update_channel:preference?.channel||'',depositor_receipt:proof});
}
