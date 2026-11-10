const NUMERIC_FAVORITES={1337:100,4040:99,4242:98,8008:97,7777:96,'0420':95,1010:94,1234:90,7070:88};
const numericMaster=new Map(CODE_MASTER.filter(([code])=>/^[0-9]{4}$/.test(code)).map(row=>[row[0],row]));
for(const [code,score] of Object.entries(NUMERIC_FAVORITES)){
  const [,kind,rank,,tier,tags,sensitive]=numericMaster.get(code)??[code,'Number',0,0,'Featured','General',false];
  numericMaster.set(code,[code,kind,rank,score,tier,tags,sensitive]);
}
const NUMERIC_CODE_MASTER=[...numericMaster.values()];
const CODE_CATALOGUE=new Set(NUMERIC_CODE_MASTER.map(([code])=>code));
function codeWeights(theme='',overrides={}){
  const words=String(theme).normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const contains=text=>(' '+words+' ').includes(' '+text+' ');
  return NUMERIC_CODE_MASTER.flatMap(([code,,rank,score,tier,tags,sensitive])=>{
    const override=overrides[code];
    if(override?.enabled===false)return [];
    if(sensitive&&!contains('adults only'))return [];
    const matches=contains(code)||tags.split(';').some(tag=>tag.trim().length>3&&tag.trim().toLowerCase()!=='general'&&contains(tag.trim().toLowerCase()));
    return [[code,Math.max(1,override?.score??score??1)*(matches?16:tier==='Featured'?3:1)+(rank?1:0)]];
  });
}

async function savedCodePolicy(db,owner,defaultTheme=''){
  const row=await db.prepare('SELECT theme,overrides FROM sharepass_code_policy WHERE owner=? AND event=?')
    .bind(owner,EVENT).first();
  return {theme:row?.theme??defaultTheme,overrides:row?.overrides??'{}'};
}

async function adminCodePolicy(request,db,owner,defaultTheme){
  if(request.method==='POST'){
    const body=await bodyJson(request);
    if(body?.action==='theme'){
      const theme=body.theme;
      if(theme!==null&&(typeof theme!=='string'||theme.length>160||/[\u0000-\u001f\u007f]/.test(theme)))return error('Enter event keywords up to 160 characters.',400);
      await db.prepare(`INSERT INTO sharepass_code_policy(owner,event,theme) VALUES(?,?,?)
        ON CONFLICT(owner,event) DO UPDATE SET theme=excluded.theme`).bind(owner,EVENT,theme?.trim()??null).run();
    }else if(body?.action==='override'){
      const code=typeof body.code==='string'?body.code.trim().toUpperCase():'';
      const {score,enabled}=body;
      if(!CODE_CATALOGUE.has(code)||!(score===null||Number.isInteger(score)&&score>=1&&score<=100)||typeof enabled!=='boolean'){
        return error('Choose a catalogue code and a score from 1 to 100, or leave it blank.',400);
      }
      const change=enabled&&score===null?null:{score,enabled};
      await db.prepare(`INSERT INTO sharepass_code_policy(owner,event,overrides) VALUES(?,?,json_patch('{}',?))
        ON CONFLICT(owner,event) DO UPDATE SET overrides=json_patch(overrides,?)`)
        .bind(owner,EVENT,JSON.stringify({[code]:change}),JSON.stringify({[code]:change})).run();
    }else return error('Choose a code policy change.',400);
  }else if(request.method!=='GET')return error('Page not found.',404);
  const {theme,overrides}=await savedCodePolicy(db,owner,defaultTheme);
  const rules=JSON.parse(overrides);
  const eligible=new Set(codeWeights(theme,rules).map(([code])=>code));
  await ensureLedger(db,owner);
  const allocated=await db.prepare(`SELECT count(*) AS n FROM sharepass_ledger_codes WHERE owner=? AND event=?
    AND code IN (SELECT value FROM json_each(?))`).bind(owner,EVENT,JSON.stringify([...eligible])).first();
  return json({theme,default_theme:defaultTheme,eligible:eligible.size,registered:allocated.n,
    catalogue:NUMERIC_CODE_MASTER.map(([code,,,score])=>({
      code,default_score:score,score:rules[code]?.score??null,enabled:rules[code]?.enabled??true,eligible:eligible.has(code)
    })).sort((left,right)=>left.code.localeCompare(right.code))});
}
