const intakeTokenPattern=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const INTAKE_LIFETIME_MS=15*60*1000;
const INTAKE_RETRY_MS=24*60*60*1000;

function intakeUnavailable(){return error('This deposit QR has expired. Ask staff for a new one.',404);}

function intakeFields(body){
  const name=typeof body?.name==='string'?body.name.trim():'';
  if((body?.name!==undefined&&typeof body.name!=='string')||name.length>80||/[\u0000-\u001f\u007f]/.test(name))return null;
  const quantities=passQuantities(body?.quantities);
  return quantities&&Object.values(quantities).some(Boolean)?{name,quantities}:null;
}

async function startIntake(db,staff,origin){
  const booth=staff.booth_id||'B1';
  if((await boothConfiguration(db,staff.workspace,booth))?.archived)return error('This booth is archived and is not accepting new deposits.',409);
  const now=Date.now(),token=crypto.randomUUID(),expires_at=now+INTAKE_LIFETIME_MS;
  await db.prepare('DELETE FROM sharepass_intakes WHERE expires_at<=?').bind(now-INTAKE_RETRY_MS).run();
  const created=await db.prepare(`INSERT INTO sharepass_intakes(token,workspace,operator,expires_at)
    SELECT ?,?,?,? WHERE (SELECT count(*) FROM sharepass_intakes WHERE workspace=? AND operator=? AND confirmed=0 AND expires_at>?)<12
      AND NOT EXISTS(SELECT 1 FROM sharepass_configured_booths WHERE workspace=? AND id=? AND archived=1)`)
    .bind(token,staff.workspace,staff.operator,expires_at,staff.workspace,staff.operator,now,staff.workspace,booth).run();
  if(created.meta.changes!==1&&(await boothConfiguration(db,staff.workspace,booth))?.archived)return error('This booth is archived and is not accepting new deposits.',409);
  return created.meta.changes===1?json({token,url:origin+'/intake/'+token,expires_at})
    :error('Too many deposit QR codes are waiting. Finish an open deposit or wait for its QR to expire.',429);
}

async function publicIntake(request,db,token,origin){
  if(request.method==='POST'&&request.headers.get('Origin')!==origin)return error('Cross-origin changes are blocked.',403);
  const now=Date.now();
  const lookup=`SELECT i.payload,i.expires_at,i.confirmed,i.workspace,coalesce(s.booth_id,'B1') AS booth_id,coalesce(b.archived,0) AS archived
    FROM sharepass_intakes i LEFT JOIN sharepass_configured_staff s ON s.workspace=i.workspace AND s.id=i.operator
    LEFT JOIN sharepass_configured_booths b ON b.workspace=i.workspace AND b.id=coalesce(s.booth_id,'B1') WHERE i.token=? AND i.expires_at>?`;
  const row=await db.prepare(lookup).bind(token,now).first();
  if(!row)return intakeUnavailable();
  const expires_at=row.expires_at;
  if(request.method==='GET')return json({status:row.confirmed?'confirmed':row.payload?'submitted':row.archived?'closed':'waiting',expires_at});
  if(request.method!=='POST')return error('Page not found.',404);
  const fields=intakeFields(await bodyJson(request));
  if(!fields)return error('Check your name and enter at least one pass.',400);
  const payload=JSON.stringify(fields);
  const saved=await db.prepare(`UPDATE sharepass_intakes SET payload=? WHERE token=? AND expires_at>? AND payload IS NULL AND confirmed=0
    AND NOT EXISTS(SELECT 1 FROM sharepass_configured_booths WHERE workspace=? AND id=? AND archived=1)`)
    .bind(payload,token,now,row.workspace,row.booth_id).run();
  if(saved.meta.changes===1)return json({status:'submitted',expires_at});
  const latest=await db.prepare(lookup).bind(token,Date.now()).first();
  if(!latest)return intakeUnavailable();
  if(latest.confirmed)return json({status:'confirmed',expires_at});
  if(latest.archived&&!latest.payload)return error('This booth is archived and is not accepting new deposits.',409);
  return latest.payload===payload?json({status:'submitted',expires_at}):error('This form has already been submitted. Ask staff if you need to make a change.',409);
}

async function staffIntake(request,db,staff,token,confirm,theme,allowCodeReuse){
  const row=await db.prepare('SELECT payload,expires_at,confirmed FROM sharepass_intakes WHERE token=? AND workspace=? AND operator=?')
    .bind(token,staff.workspace,staff.operator).first();
  if(!row)return intakeUnavailable();
  const expired=row.expires_at<=Date.now();
  const fields=row.payload&&JSON.parse(row.payload);
  if(!confirm){
    if(request.method!=='GET')return error('Page not found.',404);
    if(expired)return intakeUnavailable();
    return json({status:row.confirmed?'confirmed':fields?'submitted':'waiting',...fields,expires_at:row.expires_at});
  }
  if(request.method!=='POST')return error('Page not found.',404);
  const input=await bodyJson(request);
  const manual=input?.manual===true;
  if(!fields&&!manual)return expired?intakeUnavailable():error('Wait for the customer to submit the form.',409);
  const body=validate({...input,request_id:'intake-'+token,quantities:manual?input.quantities:fields.quantities},'/api/deposits',staff.operator,staff.booth_id||'B1');
  if(!body)return error('Enter the shelf and confirm that you physically received the passes.',400);
  body.depositor_label=manual?'':fields.name;
  // The register’s idempotency key is fixed per intake, so concurrent confirmation creates one deposit.
  const result=await mutate(db,staff.workspace,'/api/deposits',body,staff.admin,expired,false,theme,{token,submitted:!!fields},allowCodeReuse);
  if(result.ok&&(await result.clone().json()).replayed){
    try{await db.prepare('UPDATE sharepass_intakes SET confirmed=1 WHERE token=?').bind(token).run();}
    catch{/* The deposit receipt is already committed. */}
  }
  return result;
}
