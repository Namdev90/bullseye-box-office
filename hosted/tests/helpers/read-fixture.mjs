import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import assert from 'node:assert/strict';

export async function messageReadFixture(worker,personal=50){
  const db=new DatabaseSync(':memory:');
  for(const file of readdirSync('drizzle').filter(file=>file.endsWith('.sql')).sort())db.exec(readFileSync('drizzle/'+file,'utf8'));
  db.prepare('INSERT INTO sharepass_staff VALUES(?,?,?)').run('perf-owner@example.test','perf-owner','Synthetic Owner');
  let statements=[],rowsRead=0;
  const DB={prepare(sql){return {bind(...values){
    const stmt=db.prepare(sql),record=()=>statements.push({sql,values});
    const first=()=>{record();const row=stmt.get(...values);rowsRead+=Number(!!row);return row||null;};
    const all=()=>{record();const rows=stmt.all(...values);rowsRead+=rows.length;return {results:rows};};
    const run=()=>{record();return {meta:{changes:stmt.run(...values).changes}};};
    return {first:async()=>first(),all:async()=>all(),run:async()=>run(),exec:()=>stmt.columns().length?all():run()};
  }};},async batch(items){db.exec('BEGIN');try{const result=items.map(item=>item.exec());db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}};
  async function call(path='/api/admin/staff-messages',identity='perf-owner'){
    const response=await worker.fetch(new Request('https://performance.example.test'+path,{headers:{
      'oai-authenticated-user-id':identity,'oai-authenticated-user-email':identity+'@example.test'}}),
      {DB,SHAREPASS_OWNER_EMAIL:'perf-owner@example.test'});
    return {status:response.status,text:await response.text()};
  }
  assert.equal((await call('/api/admin/setup')).status,200);
  const workspace=db.prepare('SELECT workspace FROM sharepass_configured_booths WHERE id=?').get('B1').workspace;
  const prompt=db.prepare('INSERT INTO sharepass_staff_prompts(workspace,id,booth_id,message,created_at,expires_at,per_person) VALUES(?,?,?,?,?,?,?)');
  const recipient=db.prepare('INSERT INTO sharepass_staff_prompt_recipients(workspace,prompt_id,recipient,name,booth_id) VALUES(?,?,?,?,?)');
  db.exec('BEGIN');
  for(let i=0;i<1000+personal;i++){
    const current=i>=1000,id='00000000-0000-4000-8000-'+String(i).padStart(12,'0');
    prompt.run(workspace,id,current?'all':'B1','Synthetic message '+i,1790000000000+i,current?2000000000000:1,Number(current||i===0));
    if(current||i===0)for(let j=0;j<12;j++)recipient.run(workspace,id,j?'person-'+j:'perf-owner',j?'Synthetic Person '+j:'Synthetic Owner','B1');
    // Matching IDs in another workspace must never contribute recipients.
    prompt.run('unrelated-workspace',id,'all','PRIVATE_OTHER_WORKSPACE',1790000000000+i,2000000000000,1);
    recipient.run('unrelated-workspace',id,'other-owner','PRIVATE_OTHER_PERSON','OTHER');
  }
  db.exec('COMMIT; ANALYZE;');
  return {db,call,workspace,close:()=>db.close(),reset(){statements=[];rowsRead=0;},
    metrics(){return {queries:statements.length,rowsReturned:rowsRead,recipientQueries:statements.filter(s=>/FROM sharepass_staff_prompt_recipients/.test(s.sql)).length};},
    plans(){return [...new Map(statements.filter(s=>s.sql.startsWith('SELECT')&&s.sql.includes('sharepass_staff_prompt')).map(s=>[s.sql,s])).values()]
      .map(s=>({sql:s.sql,plan:db.prepare('EXPLAIN QUERY PLAN '+s.sql).all(...s.values).map(row=>row.detail)}));}};
}
