import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import worker from '../dist/server/index.js';
import {loadCodeCatalogue} from '../scripts/code-catalogue.mjs';

const rows=loadCodeCatalogue();
const dateCode=rows.find(([,kind,,score,,,sensitive])=>kind==='Number'&&score<100&&!sensitive)[0];
const soroScore=rows.find(([code])=>code==='SORO')[3];

test('owner policy is durable, rejects unsafe edits, and applies to future suggestions',async t=>{
  const sqlite=new DatabaseSync(':memory:');
  t.after(()=>sqlite.close());
  for(const file of readdirSync('drizzle').filter(file=>file.endsWith('.sql')).sort())sqlite.exec(readFileSync('drizzle/'+file,'utf8'));
  sqlite.prepare('INSERT INTO sharepass_staff VALUES(?,?,?)').run('owner@example.test','owner','Owner');
  sqlite.prepare('INSERT INTO sharepass_staff VALUES(?,?,?)').run('staff@example.test','staff','Staff');
  const DB={prepare(sql){return {bind(...values){
    const statement=sqlite.prepare(sql);
    const all=()=>({results:statement.all(...values)});
    const run=()=>({meta:{changes:statement.run(...values).changes}});
    return {first:async()=>statement.get(...values)||null,all,run,execute:()=>statement.columns().length?all():run()};
  }};},async batch(statements){
    sqlite.exec('BEGIN');
    try{
      const results=statements.map(statement=>statement.execute());
      sqlite.exec('COMMIT');
      return results;
    }catch(failure){sqlite.exec('ROLLBACK');throw failure;}
  }};
  const env={DB,SHAREPASS_OWNER_EMAIL:'owner@example.test',SHAREPASS_CODE_THEME:'SinQ'};
  async function call(path,body,user='owner',origin='https://test.example'){
    const headers=user?{'oai-authenticated-user-id':user,'oai-authenticated-user-email':user+'@example.test'}:{};
    if(body)Object.assign(headers,{'Content-Type':'application/json',Origin:origin});
    const response=await worker.fetch(new Request('https://test.example'+path,{headers,...(body?{method:'POST',body:JSON.stringify(body)}:{})}),env);
    return {status:response.status,body:await response.json()};
  }
  const api='/api/admin/code-policy';
  const entry=(data,code)=>data.catalogue.find(row=>row.code===code);
  assert.equal((await call(api,undefined,'')).status,401);
  assert.equal((await call(api,undefined,'staff')).status,404);
  assert.equal((await call(api,{action:'theme',theme:'Soro'},'owner','https://untrusted.example')).status,403);
  assert.equal((await call(api,{action:'override',code:'FFFF',score:101,enabled:true})).status,400);
  assert.equal((await call(api,{action:'theme',theme:'Soro\nSinQ'})).status,400);

  const initial=(await call(api)).body;
  assert.equal(initial.catalogue.length,rows.length);
  assert.equal(initial.theme,'SinQ');
  assert.equal(entry(initial,'SINQ').eligible,true);
  assert.equal(entry(initial,'SORO').eligible,false);
  const edited=(await call(api,{action:'theme',theme:'Soro '+dateCode})).body;
  assert.equal(entry(edited,'SORO').eligible,true);
  assert.equal(entry(edited,'SINQ').eligible,false);
  assert.equal((await call(api,{action:'override',code:'SORO',score:96,enabled:false})).status,200);
  assert.equal((await call(api,{action:'override',code:dateCode,score:100,enabled:true})).status,200);
  const persisted=(await call(api)).body;
  assert.deepEqual(entry(persisted,'SORO'),{code:'SORO',default_score:soroScore,score:96,enabled:false,eligible:false});
  assert.equal(entry(persisted,dateCode).score,100);

  const deposit={custody_confirmed:true,location:'A-01',request_id:'policy-0001',quantities:{normal:1,vip:0,vvip:0}};
  const created=await call('/api/deposits',{...deposit,suggested_code:'SORO'});
  assert.equal(created.status,200);
  assert.notEqual(created.body.collection_code,'SORO');
  const reserved=await call('/api/deposits',{...deposit,request_id:'policy-0002',location:'A-02',custom_code:'SORO'});
  assert.equal(reserved.status,200);
  assert.equal(reserved.body.collection_code,'SORO');
  const restored=(await call(api,{action:'override',code:'SORO',score:null,enabled:true})).body;
  assert.equal(entry(restored,'SORO').score,null);
  assert.equal(entry(restored,'SORO').eligible,true);
  assert.ok(restored.registered>=1);
  const next=await call('/api/deposits',{...deposit,request_id:'policy-0003',location:'A-03',suggested_code:'SORO'});
  assert.equal(next.status,200);
  assert.notEqual(next.body.collection_code,'SORO');
  const defaultPolicy=(await call(api,{action:'theme',theme:null})).body;
  assert.equal(defaultPolicy.theme,'SinQ');
  assert.equal(entry(defaultPolicy,dateCode).score,100);
});
