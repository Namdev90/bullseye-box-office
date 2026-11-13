function ledgerStatement(db,sql,...values){return db.prepare(sql).bind(...values);}
const ledgerJson=JSON.stringify;

// The marker and all imported rows commit together. The old snapshot is retained
// for recovery and fenced against writes as soon as the marker commits.
async function ensureLedger(db,owner){
  if(await ledgerStatement(db,'SELECT owner FROM sharepass_ledger_ready WHERE owner=?',owner).first())return;
  const imports=[
    ['deposits','deposits(owner,id,event,booth,location,payload)',"w.owner_id,j.value->>'id',j.value->>'event_id',coalesce(j.value->>'booth_id','B1'),j.value->>'location',j.value"],
    ['codes','codes(owner,event,code,deposit_id)',"w.owner_id,substr(j.value->>0,1,instr(j.value->>0,':')-1),substr(j.value->>0,instr(j.value->>0,':')+1),j.value->>1"],
    ['collections','collections(owner,id,deposit_id,booth,pending,payload)',"w.owner_id,j.value->>'id',j.value->>'deposit_id',coalesce(j.value->>'booth_id','B1'),(j.value->>'status'='RELEASE_RECORDED'),j.value"],
    ['requests','requests(owner,id,deposit_id,payload)',"w.owner_id,j.value->>0,j.value->>'$[1].result.deposit.id',j.value->1"],
    ['claims','claims(owner,token,expires,payload)',"w.owner_id,j.value->>0,j.value->>'$[1].expires',j.value->1","AND j.value->>'$[1].expires'>?"],
    ['failures','failures(owner,failed_at)','w.owner_id,j.value','AND j.value>?'],
    ['audit','audit(owner,payload)','w.owner_id,j.value','ORDER BY j.key DESC']
  ];
  const now=Date.now();
  const statements=imports.map(([key,table,select,tail])=>{
    const args=[owner];
    if(key==='claims')args.push(now);
    if(key==='failures')args.push(now-60000);
    return ledgerStatement(db,'INSERT INTO sharepass_ledger_'+table+' SELECT '+select+
      " FROM sharepass_workspaces w,json_each(w.payload,'$."+key+"') j WHERE w.owner_id=? "+
      'AND NOT EXISTS(SELECT 1 FROM sharepass_ledger_ready WHERE owner=w.owner_id) '+(tail||''),...args);
  });
  statements.push(ledgerStatement(db,'INSERT OR IGNORE INTO sharepass_ledger_ready(owner) VALUES(?)',owner));
  await db.batch(statements);
}

function ledgerModel(){
  const model=new DemoStore({seed:false,eventName:'SharePass shared desk',singleEvent:true});
  model.passTypes.push({id:'mip',label:'MIP'});
  return model;
}

let ledgerCodePolicy;
const reusableCode=alias=>`EXISTS(SELECT 1 FROM sharepass_ledger_deposits d
  WHERE d.owner=${alias}.owner AND d.id=${alias}.deposit_id
  AND (d.payload->>'active_collection_code' IS NULL OR d.payload->>'active_collection_code'=${alias}.code)
  AND json_type(d.payload,'$.remaining')='object'
  AND EXISTS(SELECT 1 FROM json_each(d.payload,'$.remaining'))
  AND NOT EXISTS(SELECT 1 FROM json_each(d.payload,'$.remaining') WHERE type<>'integer' OR value<>0)
  AND EXISTS(SELECT 1 FROM sharepass_ledger_collections c WHERE c.owner=d.owner AND c.deposit_id=d.id
    AND c.pending=0 AND c.payload->>'status'='HANDED_OVER')
  AND NOT EXISTS(SELECT 1 FROM sharepass_ledger_collections c WHERE c.owner=d.owner AND c.deposit_id=d.id AND c.pending=1))`;

async function ledgerCode(db,owner,theme,exclude='',preferred='',allowReuse=false){
  const model=ledgerModel();
  const policy=await savedCodePolicy(db,owner,theme);
  if(ledgerCodePolicy?.theme!==policy.theme||ledgerCodePolicy.overrides!==policy.overrides){
    const weights=codeWeights(policy.theme,JSON.parse(policy.overrides));
    ledgerCodePolicy={...policy,weights,total:weights.reduce((sum,[,weight])=>sum+weight,0),eligible:new Set(weights.map(([code])=>code))};
  }
  const {weights,total,eligible}=ledgerCodePolicy;
  const allowed=code=>/^[0-9]{4}$/.test(code)&&(!CODE_CATALOGUE.has(code)||eligible.has(code));
  // Put the requested jokes first, then the complete curated catalogue. A
  // random ordinary number is used only once that catalogue is exhausted.
  // Shuffle each tier by weight without replacement, so unlucky sampling can
  // never skip an available memorable code.
  const ordered=entries=>{
    const remaining=entries.filter(([code])=>code!==exclude),result=[];
    while(remaining.length){
      let pick=model.randomBelow(remaining.reduce((sum,[,weight])=>sum+weight,0));
      const index=remaining.findIndex(([,weight])=>(pick-=weight)<0);
      result.push(remaining.splice(index,1)[0][0]);
    }
    return result;
  };
  const favorites=new Set(NUMERIC_FIRST_CHOICES);
  const candidates=new Set([
    ...(preferred&&preferred!==exclude&&allowed(preferred)?[preferred]:[]),
    ...ordered(weights.filter(([code])=>favorites.has(code))),
    ...ordered(weights.filter(([code])=>!favorites.has(code)))
  ]);
  const firstAvailable=async codes=>(await ledgerStatement(db,"SELECT value AS code FROM json_each(?) j WHERE NOT EXISTS("+
    'SELECT 1 FROM sharepass_ledger_codes held WHERE owner=? AND event=? AND code=j.value'+
    ') ORDER BY j.key LIMIT 1',
    ledgerJson(codes),owner,EVENT).first())?.code;
  const sampled=await firstAvailable([...candidates]);
  if(sampled)return sampled;
  const start=model.randomBelow(10000);
  return firstAvailable(Array.from({length:10000},(_,index)=>String((start+index)%10000).padStart(4,'0'))
    .filter(code=>code!==exclude&&allowed(code)));
}

async function ledgerHistory(db,staff,params){
  const rawLimit=params.get('limit');
  const limit=rawLimit===null?50:Number(rawLimit);
  if(!Number.isSafeInteger(limit)||limit<1||limit>100)return error('Choose a history page size from 1 to 100.',400);
  let cursor=null;
  const encoded=params.get('cursor');
  if(encoded){
    try{
      if(encoded.length>200)throw new Error();
      cursor=JSON.parse(atob(encoded));
      if(!Array.isArray(cursor)||cursor.length!==2||!/^\d{4}-\d\d-\d\dT[0-9:.]+Z$/.test(cursor[0])||!intakeTokenPattern.test(cursor[1]))throw new Error();
    }catch{return error('This history page has expired. Open History again.',400);}
  }
  await ensureLedger(db,staff.workspace);
  const booth=staff.booth_id||'B1';
  const after=cursor?" AND ((d.payload->>'created_at')<? OR ((d.payload->>'created_at')=? AND d.id<?))":'';
  const [records,pending]=await db.batch([
    ledgerStatement(db,`SELECT d.id,d.payload,EXISTS(SELECT 1 FROM sharepass_ledger_collections c
      WHERE c.owner=d.owner AND c.deposit_id=d.id AND c.pending=1) AS handover_pending FROM sharepass_ledger_deposits d
      WHERE d.owner=? AND d.event=? AND d.booth=?${after}
      ORDER BY (d.payload->>'created_at') DESC,d.id DESC LIMIT ?`,
      staff.workspace,EVENT,booth,...(cursor?[cursor[0],cursor[0],cursor[1]]:[]),limit+1),
    ledgerStatement(db,`SELECT d.payload AS deposit,c.payload AS collection FROM sharepass_ledger_collections c
      JOIN sharepass_ledger_deposits d ON d.owner=c.owner AND d.id=c.deposit_id
      WHERE c.owner=? AND d.event=? AND c.booth=? AND d.booth=c.booth AND c.pending=1
        AND (? OR c.payload->>'created_by'=?) ORDER BY c.payload->>'created_at' DESC,c.id DESC`,
      staff.workspace,EVENT,booth,Number(staff.admin),staff.operator)
  ]);
  const model=ledgerModel();
  model.collections=pending.results.map(row=>JSON.parse(row.collection));
  const deposits=records.results.slice(0,limit).map(row=>({...model.publicDeposit(JSON.parse(row.payload)),
    handover_pending:!!row.handover_pending}));
  const last=deposits.at(-1);
  return json({deposits,pending_handovers:pending.results.map(row=>model.publicDeposit(JSON.parse(row.deposit))),
    next_cursor:records.results.length>limit?btoa(ledgerJson([last.created_at,last.id])):null});
}

async function ledgerDepositByCode(db,owner,code){
  return ledgerStatement(db,'SELECT d.*, c.reused FROM sharepass_ledger_codes c JOIN sharepass_ledger_deposits d ON d.owner=c.owner AND d.id=c.deposit_id WHERE c.owner=? AND c.event=? AND c.code=?',owner,EVENT,code).first();
}

async function ledgerReceipt(db,owner,requestId){
  await ensureLedger(db,owner);
  const row=await ledgerStatement(db,'SELECT d.payload,r.payload AS receipt, EXISTS(SELECT 1 FROM sharepass_ledger_collections c WHERE c.owner=d.owner AND c.deposit_id=d.id AND c.pending=1) AS pending FROM sharepass_ledger_requests r JOIN sharepass_ledger_deposits d ON d.owner=r.owner AND d.id=r.deposit_id WHERE r.owner=? AND r.id=?',owner,requestId).first();
  return row?{deposit:JSON.parse(row.payload),receipt:JSON.parse(row.receipt).result,pending:!!row.pending}:null;
}

async function currentDepositReceipt(db,staff,id){
  const row=await ledgerStatement(db,'SELECT payload FROM sharepass_ledger_deposits WHERE owner=? AND id=? AND booth=?',staff.workspace,id,staff.booth_id||'B1').first();
  if(!row)return error('Deposit not found at this booth.',404);
  const deposit=JSON.parse(row.payload),model=ledgerModel();
  const pending=await ledgerStatement(db,'SELECT payload FROM sharepass_ledger_collections WHERE owner=? AND deposit_id=? AND pending=1',staff.workspace,id).first();
  const collection=pending?JSON.parse(pending.payload):null;
  if(collection&&(staff.admin||collection.created_by===staff.operator))model.collections=[collection];
  const queue=await ledgerStatement(db,`SELECT q.payload FROM sharepass_booth_queue q JOIN sharepass_ledger_requests r
    ON r.owner=q.workspace AND r.id='booth-'||q.token WHERE r.owner=? AND r.deposit_id=? AND q.confirmed=1 LIMIT 1`,staff.workspace,id).first();
  const contact=queue?JSON.parse(queue.payload):{};
  const currentCode=await ledgerStatement(db,'SELECT code FROM sharepass_ledger_codes WHERE owner=? AND event=? AND deposit_id=? ORDER BY code LIMIT 1',staff.workspace,EVENT,id).first();
  const update=deposit.update_contact;
  const updatePhone=update?.channel==='whatsapp'?sharePassPhone(update.address):'';
  const phone=sharePassPhone(contact.phone)||'',remaining=model.passTypes.filter(type=>deposit.remaining[type.id]>0)
    .map(type=>deposit.remaining[type.id]+' '+type.label).join(' + ');
  return json({deposit:{...model.publicDeposit(deposit),handover_pending:!!collection},collection_code:deposit.active_collection_code||currentCode?.code||'',
    recipients:contact.recipients||[],depositor_name:contact.name||deposit.depositor_label||'',depositor_phone:phone,
    ...(updatePhone&&!collection?{depositor_update:{channel:'whatsapp',address:updatePhone,message:'Hi'+((update.name||contact.name)?' '+(update.name||contact.name):'')+'! SharePass deposit update. '+
      (remaining?'Still available: '+remaining+'.':'All passes in this deposit have been collected.')}}:{})});
}

async function ledgerVerify(db,owner,body,legacy,model){
  const now=Date.now();
  const failure=()=>error('Too many unsuccessful checks. Wait a minute or start a fresh demo.',429);
  const count=await ledgerStatement(db,'SELECT count(*) AS n FROM sharepass_ledger_failures WHERE owner=? AND failed_at>?',owner,now-60000).first();
  if(count.n>=5)return failure();
  const row=await ledgerDepositByCode(db,owner,body.collection_code);
  const deposit=row&&JSON.parse(row.payload);
  if(!row||(body.collection_reference&&body.collection_reference!==deposit.packet_id)){
    const results=await db.batch([
      ledgerStatement(db,'DELETE FROM sharepass_ledger_failures WHERE owner=? AND failed_at<=?',owner,now-60000),
      ledgerStatement(db,'INSERT INTO sharepass_ledger_failures(owner,failed_at) SELECT ?,? WHERE (SELECT count(*) FROM sharepass_ledger_failures WHERE owner=?)<5',owner,now,owner)
    ]);
    return results[1].meta.changes===1?error('Collection code not found in this event.',404):failure();
  }
  if(row.reused&&!body.collection_reference)return json({
    error:'Enter the pickup reference from the collector’s current receipt. If this device has no reference field, use the web desk.',
    notExecuted:true,pickup_reference_required:true
  },409);
  model.deposits.push(deposit);
  model.codes.set(EVENT+':'+body.collection_code,row.id);
  const pending=await ledgerStatement(db,'SELECT payload FROM sharepass_ledger_collections WHERE owner=? AND deposit_id=? AND pending=1',owner,row.id).first();
  if(pending)model.collections.push(JSON.parse(pending.payload));
  let result;
  try{result=model.verify(body);}
  catch(exception){if(!exception.status)throw exception;return error(exception.message,exception.status);}
  if(result.release_allowed===false)return error('Use the booth shown on the collection instructions.',409);
  if(legacy&&result.deposit.remaining.mip)return error('Update SharePass to review this packet with MIP passes.',409);
  const claim=model.claims.get(result.claim_token);
  const writes=await db.batch([
    ledgerStatement(db,'DELETE FROM sharepass_ledger_claims WHERE owner=? AND expires<=?',owner,now),
    ledgerStatement(db,'INSERT INTO sharepass_ledger_claims(owner,token,expires,payload) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM sharepass_ledger_deposits WHERE owner=? AND id=? AND revision=?)',
      owner,result.claim_token,claim.expires,ledgerJson(claim),owner,row.id,row.revision)
  ]);
  return writes[1].meta.changes===1?json(result):error('The balance changed. Verify the code again.',409);
}

async function mutate(db,owner,path,body,admin,replayOnly=false,legacy=false,theme='',intake=null,allowReuse=false,reconcileHandover=false){
  // Rotation retires its old code permanently for this event. Even legacy
  // reuse configuration must not turn an old receipt into a different pickup.
  if(path==='/api/codes/refresh'||path==='/api/admin/reissue')allowReuse=false;
  await ensureLedger(db,owner);
  const model=ledgerModel();
  if(!model.booths.some(booth=>booth.id===body.booth_id)){
    const booth=await boothConfiguration(db,owner,body.booth_id);
    if(!booth)return error('Your booth is unavailable.',403);
    model.booths.push({id:booth.id,label:booth.name});
  }
  if(path==='/api/verify')return ledgerVerify(db,owner,body,legacy,model);
  const read=(sql,...args)=>ledgerStatement(db,sql,owner,...args).first();
  const isCreate=path==='/api/deposits',isReissue=path==='/api/admin/reissue'||path==='/api/codes/refresh';
  const needsActiveBooth=isCreate&&!(intake?.booth||intake?.submitted);
  for(let attempt=0;attempt<8;attempt++){
    const previous=await read('SELECT deposit_id,payload FROM sharepass_ledger_requests WHERE owner=? AND id=?',body.request_id);
    if(replayOnly&&!previous)return intakeUnavailable();
    const stored=previous&&JSON.parse(previous.payload);
    if(!previous&&needsActiveBooth&&(await boothConfiguration(db,owner,body.booth_id))?.archived){
      return error('This booth is archived. Existing pickups can still be completed.',409);
    }
    const parts=path.split('/');
    const collectionId=stored?.result.collection?.id||(parts[2]==='collections'?parts[3]:null);
    const link=!previous&&collectionId?await read('SELECT deposit_id FROM sharepass_ledger_collections WHERE owner=? AND id=?',collectionId):null;
    const id=previous?.deposit_id||link?.deposit_id||(parts[2]==='deposits'&&!isCreate?parts[3]:null);
    // Read the revision before mutable children. The batch guard rejects a
    // concurrent handover or update observed between these reads.
    const row=id?await read('SELECT * FROM sharepass_ledger_deposits WHERE owner=? AND id=?',id):
      isReissue?await ledgerDepositByCode(db,owner,body.collection_code):null;
    const collection=collectionId?await read('SELECT payload FROM sharepass_ledger_collections WHERE owner=? AND id=?',collectionId):null;
    const pending=row?await read('SELECT id,payload FROM sharepass_ledger_collections WHERE owner=? AND deposit_id=? AND pending=1',row.id):null;
    model.deposits=row?[JSON.parse(row.payload)]:[];
    model.collections=[...(collection?[JSON.parse(collection.payload)]:[]),...(pending&&pending.id!==collectionId?[JSON.parse(pending.payload)]:[])];
    model.requests=new Map(previous?[[body.request_id,stored]]:[]);
    model.codes=new Map(isReissue&&row?[[EVENT+':'+body.collection_code,row.id]]:[]);
    model.claims=new Map();
    model.audit=[];
    model.outbox=[];
    if(!previous){
      if(body.claim_token){
        const claim=await read('SELECT payload FROM sharepass_ledger_claims WHERE owner=? AND token=?',body.claim_token);
        if(claim)model.claims.set(body.claim_token,JSON.parse(claim.payload));
      }
      if(isCreate||isReissue){
        if([body.custom_code,body.suggested_code].some(code=>code!==undefined&&!/^[0-9]{4}$/.test(code))){
          return error('Enter four digits.',400);
        }
        if(body.custom_code){
          const reserved=await read('SELECT deposit_id FROM sharepass_ledger_codes held WHERE owner=? AND event=? AND code=?'+
            (allowReuse?' AND NOT '+reusableCode('held'):''),EVENT,body.custom_code);
          if(reserved)model.codes.set(EVENT+':'+body.custom_code,reserved.deposit_id);
        }else{
          const code=await ledgerCode(db,owner,theme,body.collection_code,body.suggested_code,allowReuse);
          if(!code)return error('Could not allocate a collection code. Try again.',409);
          model.availableCode=()=>code;
          // Only the candidate checked by D1 may be used as a suggestion.
          if(body.suggested_code&&body.suggested_code!==code)model.codes.set(EVENT+':'+body.suggested_code,'reserved');
        }
      }
      if(isCreate){
        const slot=await ledgerStatement(db,'SELECT id FROM sharepass_ledger_deposits WHERE owner=? AND event=? AND booth=? AND location=?',owner,EVENT,body.booth_id,body.location).all();
        const capacity=storageStatus(slot.meta);
        if(slot.results.length||capacity.at_limit){
          // Preserve replay if the same request committed after the first idempotency read.
          if(await read('SELECT id FROM sharepass_ledger_requests WHERE owner=? AND id=?',body.request_id))continue;
          if(capacity.at_limit)return error('New deposits are paused at the storage limit. Existing pickups can still be completed.',507);
          return error('Use a fresh shelf slot for this booth.',400);
        }
      }
    }
    let result;
    try{result=await model.request(path,body,admin);}
    catch(exception){
      if(!exception.status)throw exception;
      if(!previous&&await read('SELECT id FROM sharepass_ledger_requests WHERE owner=? AND id=?',body.request_id))continue;
      if(reconcileHandover&&!previous&&exception.status===409&&path.endsWith('/handover')){
        // Read a single committed snapshot before clearing an old device's saved handover.
        const completed=await ledgerStatement(db,`SELECT d.payload AS deposit,c.payload AS collection,
          (SELECT payload FROM sharepass_ledger_collections WHERE owner=d.owner AND deposit_id=d.id AND pending=1) AS pending,
          EXISTS(SELECT 1 FROM sharepass_ledger_requests WHERE owner=d.owner AND id=?) AS request_exists
          FROM sharepass_ledger_collections c JOIN sharepass_ledger_deposits d ON d.owner=c.owner AND d.id=c.deposit_id
          WHERE c.owner=? AND c.id=? AND c.booth=? AND d.booth=c.booth AND c.pending=0 AND d.event=?
            AND c.payload->>'event_id'=d.event AND c.payload->>'status'='HANDED_OVER'
            AND c.payload->>'version'=? AND (c.payload->>'created_by'=? OR ?)`,
          body.request_id,owner,collectionId,body.booth_id,body.event_id,body.version+1,body.operator,Number(admin)).first();
        if(completed?.request_exists)continue;
        if(completed){
          const handedOver=JSON.parse(completed.collection);
          model.collections=completed.pending?[JSON.parse(completed.pending)]:[];
          return json({deposit:model.publicDeposit(JSON.parse(completed.deposit)),collection:handedOver,replayed:true});
        }
      }
      if(exception.status===409&&body.request_id.startsWith('booth-')&&previous)return error('This deposit was already confirmed. Refresh the booth queue.',409);
      return error(exception.message,exception.status,exception.notExecuted!==false);
    }
    if(result.replayed){
      if(path.endsWith('/release')&&result.collection?.status==='HANDED_OVER'){
        return error('This handover was already confirmed. Do not hand over the passes again.',409);
      }
      return json(result);
    }
    const d=model.deposits.find(item=>item.id===result.deposit.id);
    const statements=[];
    if(needsActiveBooth)statements.push(ledgerStatement(db,'INSERT INTO sharepass_ledger_guard(ok) VALUES(NOT EXISTS(SELECT 1 FROM sharepass_configured_booths WHERE workspace=? AND id=? AND archived=1))',owner,body.booth_id));
    if(row){
      statements.push(ledgerStatement(db,'INSERT INTO sharepass_ledger_guard(ok) VALUES(EXISTS(SELECT 1 FROM sharepass_ledger_deposits WHERE owner=? AND id=? AND revision=?))',owner,row.id,row.revision));
      statements.push(ledgerStatement(db,'UPDATE sharepass_ledger_deposits SET revision=revision+1,payload=? WHERE owner=? AND id=?',ledgerJson(d),owner,d.id));
    }else statements.push(ledgerStatement(db,'INSERT INTO sharepass_ledger_deposits(owner,id,event,booth,location,payload) VALUES(?,?,?,?,?,?)',owner,d.id,EVENT,d.booth_id,d.location,ledgerJson(d)));
    if(result.collection){
      const c=result.collection;
      statements.push(ledgerStatement(db,'INSERT INTO sharepass_ledger_collections(owner,id,deposit_id,booth,pending,payload) VALUES(?,?,?,?,?,?) ON CONFLICT(owner,id) DO UPDATE SET pending=excluded.pending,payload=excluded.payload',
        owner,c.id,d.id,c.booth_id,Number(c.status==='RELEASE_RECORDED'),ledgerJson(c)));
    }
    if(result.collection_code){
      const assign='INSERT INTO sharepass_ledger_codes(owner,event,code,deposit_id) VALUES(?,?,?,?)';
      statements.push(ledgerStatement(db,assign+(allowReuse
        ?' ON CONFLICT(owner,event,code) DO UPDATE SET deposit_id=excluded.deposit_id,reused=1 WHERE '+reusableCode('sharepass_ledger_codes')
        :''),owner,EVENT,result.collection_code,d.id));
      if(allowReuse)statements.push(ledgerStatement(db,'INSERT INTO sharepass_ledger_guard(ok) VALUES(changes()=1)'));
    }
    statements.push(ledgerStatement(db,'INSERT INTO sharepass_ledger_requests VALUES(?,?,?,?)',owner,body.request_id,d.id,ledgerJson(model.requests.get(body.request_id))));
    for(const entry of model.audit)statements.push(ledgerStatement(db,'INSERT INTO sharepass_ledger_audit(owner,payload) VALUES(?,?)',owner,ledgerJson(entry)));
    if(intake)statements.push(ledgerStatement(db,'UPDATE '+(intake.booth?'sharepass_booth_queue':'sharepass_intakes')+
      ' SET confirmed=1 WHERE workspace=? AND token=?',owner,intake.token));
    if(row||needsActiveBooth||allowReuse&&result.collection_code)statements.push(ledgerStatement(db,'DELETE FROM sharepass_ledger_guard WHERE ok=1'));
    try{await db.batch(statements);return json(result);}
    catch(exception){
      if(!/CHECK constraint failed: ok|UNIQUE constraint failed: (?:sharepass_ledger_(?:codes|requests|deposits)\.|index 'sharepass_ledger_packet_id')/i.test(String(exception)+' '+String(exception.cause||'')))throw exception;
    }
  }
  return error('The register changed. Recover the same action before trying another handover.',409,false);
}

// Read/replay only: request identifiers cannot start a refresh without its code.
// Scope every lookup to the current workspace, booth and original operator.
async function recoverCodeRefresh(db,staff,requestId,packet){
  const previous=await ledgerStatement(db,`SELECT r.payload AS request,d.payload AS deposit,
    (SELECT c.payload FROM sharepass_ledger_collections c WHERE c.owner=r.owner AND c.deposit_id=r.deposit_id AND c.pending=1) AS pending
    FROM sharepass_ledger_requests r JOIN sharepass_ledger_deposits d ON d.owner=r.owner AND d.id=r.deposit_id
    WHERE r.owner=? AND r.id=?`,staff.workspace,requestId).first();
  // Absence is not proof of failure: the original request may still be in flight.
  if(!previous)return json({refresh_pending:true});
  const stored=JSON.parse(previous.request),deposit=JSON.parse(previous.deposit);
  const [path,body]=JSON.parse(stored.fingerprint);
  if(path!=='/api/codes/refresh'||body.request_id!==requestId||body.packet_id!==packet||
    body.event_id!==EVENT||body.booth_id!==(staff.booth_id||'B1')||body.operator!==staff.operator||
    deposit.id!==stored.result.deposit.id||deposit.packet_id!==packet||deposit.event_id!==body.event_id||deposit.booth_id!==body.booth_id){
    return error('Recover the saved refresh from its original staff session and booth.',404,false);
  }
  const model=ledgerModel();
  model.deposits=[deposit];
  model.collections=previous.pending?[JSON.parse(previous.pending)]:[];
  model.requests=new Map([[requestId,stored]]);
  try{return json(await model.request(path,body,staff.admin));}
  catch(exception){
    if(!exception.status)throw exception;
    return json({error:exception.message,notExecuted:exception.notExecuted!==false,
      refreshResolved:exception.notExecuted!==false},exception.status);
  }
}
