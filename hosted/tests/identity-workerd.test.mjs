import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createRequire} from 'node:module';

test('Workerd D1 concurrent invitations create one person and preserve historical identity rows',{skip:!process.env.SHAREPASS_MINIFLARE_MODULE},async()=>{
 const {Miniflare}=createRequire(import.meta.url)(process.env.SHAREPASS_MINIFLARE_MODULE);
 const runtime=new Miniflare({cf:false,modules:true,script:readFileSync('dist/server/index.js','utf8'),compatibilityDate:'2026-01-01',d1Databases:['DB'],bindings:{SHAREPASS_OWNER_EMAIL:'owner@example.test'}});
 try{
  const db=await runtime.getD1Database('DB');
  for(const file of readdirSync('drizzle').filter(file=>file.endsWith('.sql')).sort())for(const sql of readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint'))if(sql.trim())await db.prepare(sql.trim()).run();
  await db.prepare('INSERT INTO sharepass_staff VALUES(?,?,?)').bind('owner@example.test','owner','Owner').run();
  const invite=label=>runtime.dispatchFetch('https://test.example/api/admin/setup',{method:'POST',headers:{Origin:'https://test.example','Content-Type':'application/json','oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.test'},body:JSON.stringify({action:'invite',booth_id:'B1',staff_name:'Synthetic same person',device_label:label})});
  const responses=await Promise.all([invite('Synthetic phone A'),invite('Synthetic phone B')]);
  for(const response of responses)assert.equal(response.status,200,await response.text());
  const rows=await db.prepare("SELECT staff_id FROM sharepass_configured_devices WHERE label LIKE 'Synthetic phone %'").all();
  assert.equal(rows.results.length,2);assert.equal(new Set(rows.results.map(row=>row.staff_id)).size,1);
  await db.prepare('INSERT INTO sharepass_configured_staff(workspace,id,booth_id,name) VALUES(?,?,?,?)').bind('owner','historical-distinct-person','B1','Synthetic same person').run();
  const third=await invite('Synthetic phone C');assert.equal(third.status,200);
  const retained=await db.prepare("SELECT id FROM sharepass_configured_staff WHERE workspace='owner' AND name='Synthetic same person'").all();
  assert.equal(retained.results.length,2);assert(retained.results.some(row=>row.id==='historical-distinct-person'));
 }finally{await runtime.dispose();}
});
