import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import worker from '../dist/server/index.js';
import {loadCodeCatalogue} from '../scripts/code-catalogue.mjs';

const rows=loadCodeCatalogue();
const dateCode=rows.find(([,kind,,score,,,sensitive])=>kind==='Number'&&score<100&&!sensitive)[0];

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
  assert.ok(initial.catalogue.every(row=>/^[0-9]{4}$/.test(row.code)));
  assert.equal(initial.theme,'SinQ');
  assert.ok(entry(initial,'1337').eligible);
  assert.equal(entry(initial,'SORO'),undefined);
  assert.equal((await call(api,{action:'theme',theme:'Soro '+dateCode})).status,200);
  assert.equal((await call(api,{action:'override',code:'SORO',score:96,enabled:false})).status,400);
  assert.equal((await call(api,{action:'override',code:dateCode,score:100,enabled:true})).status,200);
  assert.equal(entry((await call(api)).body,dateCode).score,100);

  const deposit={custody_confirmed:true,location:'A-01',request_id:'policy-0001',quantities:{normal:1,vip:0,vvip:0}};
  assert.equal((await call('/api/deposits',{...deposit,suggested_code:'SORO'})).status,400);
  assert.equal((await call('/api/deposits',{...deposit,custom_code:'SORO'})).status,400);
  assert.equal((await call('/api/verify',{collection_code:'SORO'})).status,400);
  const created=await call('/api/deposits',{...deposit,suggested_code:'1337'});
  assert.equal(created.status,200);
  assert.equal(created.body.collection_code,'1337');
  assert.ok((await call(api)).body.registered>=1);
  const defaultPolicy=(await call(api,{action:'theme',theme:null})).body;
  assert.equal(defaultPolicy.theme,'SinQ');
  assert.equal(entry(defaultPolicy,dateCode).score,100);
});
