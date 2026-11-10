const staffPromptReplies=new Set(['done','working','help']);
const staffPromptId=id=>typeof id==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id);

async function pendingStaffPrompts(db,staff){
  const rows=await db.prepare(`SELECT id,message,created_at,expires_at FROM sharepass_staff_prompts
    WHERE workspace=? AND booth_id=? AND reply IS NULL AND expires_at>?
    ORDER BY created_at,id LIMIT 20`).bind(staff.workspace,staff.booth_id||'B1',Date.now()).all();
  return rows.results;
}

async function adminStaffPrompts(request,env,ctx,staff){
  const db=env.DB;
  if(request.method==='POST'){
    const body=await bodyJson(request);
    const message=typeof body?.message==='string'?body.message.trim():'';
    const booth=typeof body?.booth_id==='string'?body.booth_id:'';
    if(!staffPromptId(body?.id)||!message||message.length>300||/[\u0000-\u001f\u007f]/.test(message)
      ||!boothIdPattern.test(booth)||!await boothConfiguration(db,staff.workspace,booth)){
      return error('Choose a booth and enter a message of 1 to 300 characters.',400);
    }
    const now=Date.now();
    const inserted=await db.prepare(`INSERT OR IGNORE INTO sharepass_staff_prompts
      (workspace,id,booth_id,message,created_at,expires_at) VALUES(?,?,?,?,?,?)`)
      .bind(staff.workspace,body.id,booth,message,now,now+86400000).run();
    if(inserted.meta.changes===1)await scheduleBoothPush(env,ctx,staff.workspace,booth,true);
    else{
      const previous=await db.prepare('SELECT booth_id,message FROM sharepass_staff_prompts WHERE workspace=? AND id=?')
        .bind(staff.workspace,body.id).first();
      if(previous?.booth_id!==booth||previous.message!==message)return error('This message ID was already used.',409);
    }
  }else if(request.method!=='GET')return error('Page not found.',404);
  const rows=await db.prepare(`SELECT id,booth_id,message,created_at,expires_at,reply,replied_by,replied_at
    FROM sharepass_staff_prompts WHERE workspace=? ORDER BY created_at DESC,id DESC LIMIT 50`).bind(staff.workspace).all();
  return json({messages:rows.results});
}

async function replyToStaffPrompt(request,db,staff){
  const body=await bodyJson(request);
  if(!staffPromptId(body?.id)||!staffPromptReplies.has(body.reply))return error('Choose a reply.',400);
  const scope=[staff.workspace,staff.booth_id||'B1',body.id];
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
