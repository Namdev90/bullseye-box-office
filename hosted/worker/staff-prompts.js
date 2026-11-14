const staffPromptReplies=new Set(['done','working','help']);
const staffPromptId=id=>typeof id==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id);

async function pendingStaffPrompts(db,staff){
  const rows=await db.prepare(`SELECT p.id,p.message,p.created_at,p.expires_at FROM sharepass_staff_prompts p
    LEFT JOIN sharepass_staff_prompt_recipients r ON r.workspace=p.workspace AND r.prompt_id=p.id AND r.recipient=?
    WHERE p.workspace=? AND p.expires_at>? AND
      ((p.per_person=0 AND p.booth_id=? AND p.reply IS NULL) OR (p.per_person=1 AND r.recipient IS NOT NULL AND r.reply IS NULL))
    ORDER BY p.created_at,p.id LIMIT 20`).bind(staff.operator,staff.workspace,Date.now(),staff.booth_id||'B1').all();
  return rows.results;
}

async function adminStaffPrompts(request,env,ctx,staff){
  const db=env.DB;
  if(request.method==='POST'){
    const body=await bodyJson(request);
    const message=typeof body?.message==='string'?body.message.trim():'';
    const personal=body?.per_person===true;
    const recipient=typeof body?.recipient_id==='string'?body.recipient_id:'';
    if(body?.recipient_id!==undefined&&(typeof body.recipient_id!=='string'||recipient.length>256||/[\u0000-\u001f\u007f]/.test(recipient)))return error('Choose a current staff member.',400);
    const booth=recipient?'staff:'+recipient:typeof body?.booth_id==='string'?body.booth_id:personal?'all':'';
    const selection=recipient?'all':booth;
    if(!staffPromptId(body?.id)||!message||message.length>300||/[\u0000-\u001f\u007f]/.test(message)
      ||!(personal&&(booth==='all'||recipient))&&(!boothIdPattern.test(booth)||!await boothConfiguration(db,staff.workspace,booth))){
      return error('Choose staff and enter a message of 1 to 300 characters.',400);
    }
    const now=Date.now();
    if(personal){
      const previous=await db.prepare('SELECT booth_id,message,per_person FROM sharepass_staff_prompts WHERE workspace=? AND id=?').bind(staff.workspace,body.id).first();
      if(previous&&(previous.booth_id!==booth||previous.message!==message||!previous.per_person))return error('This message ID was already used.',409);
      if(!previous){
        const people=await db.prepare(`SELECT s.id AS recipient,s.name,s.booth_id FROM sharepass_configured_staff s
          WHERE s.workspace=? AND (?='all' OR s.booth_id=?) AND (?='' OR s.id=?) AND EXISTS(SELECT 1 FROM sharepass_configured_devices d
            WHERE d.staff_id=s.id AND d.workspace=s.workspace AND d.active=1 AND d.digest IS NOT NULL AND d.session_expires>?)
          UNION SELECT user_id AS recipient,coalesce(display_name,'Staff') AS name,'B1' AS booth_id FROM sharepass_staff
            WHERE user_id IS NOT NULL AND (?='all' OR ?='B1') AND (?='' OR user_id=?)`)
          .bind(staff.workspace,selection,selection,recipient,recipient,now,selection,selection,recipient,recipient).all();
        const recipients=new Map(people.results.map(person=>[person.recipient,person]));
        if(recipient&&!recipients.has(recipient))return error('Choose a connected staff member from this register.',400);
        if(booth==='all')recipients.set(staff.operator,{recipient:staff.operator,name:staff.name||'Administrator',booth_id:staff.booth_id||'B1'});
        const statements=[db.prepare(`INSERT INTO sharepass_staff_prompts(workspace,id,booth_id,message,created_at,expires_at,per_person)
          VALUES(?,?,?,?,?,?,1)`).bind(staff.workspace,body.id,booth,message,now,now+86400000)];
        for(const person of recipients.values())statements.push(db.prepare(`INSERT INTO sharepass_staff_prompt_recipients(workspace,prompt_id,recipient,name,booth_id)
          VALUES(?,?,?,?,?)`).bind(staff.workspace,body.id,person.recipient,person.name||'Staff',person.booth_id));
        try{await db.batch(statements);}
        catch(exception){
          if(!String(exception).includes('UNIQUE constraint failed'))throw exception;
          const saved=await db.prepare('SELECT booth_id,message,per_person FROM sharepass_staff_prompts WHERE workspace=? AND id=?').bind(staff.workspace,body.id).first();
          if(!saved||saved.booth_id!==booth||saved.message!==message||!saved.per_person)return error('This message ID was already used.',409);
          return adminStaffPrompts(new Request(request.url),env,ctx,staff);
        }
        await scheduleBoothPush(env,ctx,staff.workspace,booth,true);
      }
      return adminStaffPrompts(new Request(request.url),env,ctx,staff);
    }
    const inserted=await db.prepare(`INSERT OR IGNORE INTO sharepass_staff_prompts
      (workspace,id,booth_id,message,created_at,expires_at) VALUES(?,?,?,?,?,?)`)
      .bind(staff.workspace,body.id,booth,message,now,now+86400000).run();
    if(inserted.meta.changes===1)await scheduleBoothPush(env,ctx,staff.workspace,booth,true);
    else{
      const previous=await db.prepare('SELECT booth_id,message,per_person FROM sharepass_staff_prompts WHERE workspace=? AND id=?')
        .bind(staff.workspace,body.id).first();
      if(previous?.booth_id!==booth||previous.message!==message||previous.per_person)return error('This message ID was already used.',409);
    }
  }else if(request.method!=='GET')return error('Page not found.',404);
  const rows=await db.prepare(`SELECT id,booth_id,message,created_at,expires_at,reply,replied_by,replied_at,per_person
    FROM sharepass_staff_prompts WHERE workspace=? ORDER BY created_at DESC,id DESC LIMIT 50`).bind(staff.workspace).all();
  const personal=rows.results.filter(message=>message.per_person);
  if(personal.length){
    const people=await db.prepare(`SELECT prompt_id,recipient,name,booth_id,reply,replied_at FROM sharepass_staff_prompt_recipients
      WHERE workspace=? AND prompt_id IN (${personal.map(()=>'?').join(',')}) ORDER BY name,recipient`)
      .bind(staff.workspace,...personal.map(message=>message.id)).all();
    const responses=new Map(personal.map(message=>[message.id,[]]));
    for(const {prompt_id,...person} of people.results)responses.get(prompt_id).push(person);
    for(const message of personal)message.responses=responses.get(message.id);
  }
  return json({messages:rows.results,inbox:await pendingStaffPrompts(db,staff)});
}

async function replyToStaffPrompt(request,db,staff){
  const body=await bodyJson(request);
  if(!staffPromptId(body?.id)||!staffPromptReplies.has(body.reply))return error('Choose a reply.',400);
  const scope=[staff.workspace,staff.booth_id||'B1',body.id];
  const message=await db.prepare('SELECT per_person,expires_at FROM sharepass_staff_prompts WHERE workspace=? AND id=?').bind(staff.workspace,body.id).first();
  if(message?.per_person){
    const recipient=await db.prepare('SELECT reply FROM sharepass_staff_prompt_recipients WHERE workspace=? AND prompt_id=? AND recipient=?')
      .bind(staff.workspace,body.id,staff.operator).first();
    if(!recipient)return error('Message not found.',404);
    if(recipient.reply===body.reply)return json({replied:true});
    if(message.expires_at<=Date.now()||recipient.reply)return error('This message was answered or expired. Refresh the desk.',409);
    const result=await db.prepare(`UPDATE sharepass_staff_prompt_recipients SET reply=?,replied_at=?
      WHERE workspace=? AND prompt_id=? AND recipient=? AND reply IS NULL AND EXISTS(
        SELECT 1 FROM sharepass_staff_prompts p WHERE p.workspace=? AND p.id=? AND p.expires_at>?)`)
      .bind(body.reply,Date.now(),staff.workspace,body.id,staff.operator,staff.workspace,body.id,Date.now()).run();
    if(result.meta.changes===1)return json({replied:true});
    const current=await db.prepare('SELECT reply FROM sharepass_staff_prompt_recipients WHERE workspace=? AND prompt_id=? AND recipient=?')
      .bind(staff.workspace,body.id,staff.operator).first();
    return current?.reply===body.reply?json({replied:true}):error('This message was answered or expired. Refresh the desk.',409);
  }
  const result=await db.prepare(`UPDATE sharepass_staff_prompts SET reply=?,replied_by=?,responder=?,replied_at=?
    WHERE workspace=? AND booth_id=? AND id=? AND reply IS NULL AND expires_at>?`)
    .bind(body.reply,staff.name,staff.operator,Date.now(),...scope,Date.now()).run();
  if(result.meta.changes===1)return json({replied:true});
  const previous=await db.prepare(`SELECT reply,responder FROM sharepass_staff_prompts
    WHERE workspace=? AND booth_id=? AND id=?`).bind(...scope).first();
  if(!previous)return error('Message not found.',404);
  return previous.reply===body.reply&&previous.responder===staff.operator?json({replied:true}):
    error('This message was answered or expired. Refresh the desk.',409);
}
