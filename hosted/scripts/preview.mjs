// Local synthetic QA only. The deployed Worker never imports this file.
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,readdirSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

mkdirSync('.sites-runtime',{recursive:true});
const sqlite=new DatabaseSync('.sites-runtime/synthetic-preview.sqlite');
sqlite.exec('CREATE TABLE IF NOT EXISTS preview_migrations(name TEXT PRIMARY KEY)');
for(const file of readdirSync('drizzle').filter(file=>file.endsWith('.sql')).sort()){
  if(sqlite.prepare('SELECT name FROM preview_migrations WHERE name=?').get(file))continue;
  sqlite.exec('BEGIN');
  try{sqlite.exec(readFileSync('drizzle/'+file,'utf8'));sqlite.prepare('INSERT INTO preview_migrations VALUES(?)').run(file);sqlite.exec('COMMIT');}
  catch(error){sqlite.exec('ROLLBACK');throw error;}
}
sqlite.prepare('INSERT OR IGNORE INTO sharepass_staff(email,user_id,display_name) VALUES(?,?,?)')
  .run('owner@example.test','sharepass-preview-owner','Preview Owner');
const statement=(sql,values=[])=>{
  const stmt=sqlite.prepare(sql);
  return {bind(...next){return statement(sql,next);},
    async first(){return stmt.get(...values)||null;},
    async all(){return {results:stmt.all(...values)};},
    async run(){return {meta:{changes:stmt.run(...values).changes}};},
    exec(){return stmt.columns().length?{results:stmt.all(...values)}:{meta:{changes:stmt.run(...values).changes}};}};
};
const DB={prepare:sql=>statement(sql),async batch(statements){
  sqlite.exec('BEGIN');
  try{const results=statements.map(s=>s.exec());sqlite.exec('COMMIT');return results;}
  catch(error){sqlite.exec('ROLLBACK');throw error;}
}};
const workerFile=resolve('dist/server/index.js');
const env={DB,SHAREPASS_OWNER_EMAIL:'owner@example.test',SHAREPASS_OWNER_HANDLE:'preview-owner',
  SHAREPASS_OWNER_PASSWORD_PEPPER:'synthetic-preview-only-not-a-real-secret',SHAREPASS_ALLOW_CODE_REUSE:'0'};
const ctx={waitUntil:p=>p.catch(error=>console.error('Synthetic background task:',error.message))};
let worker,loadedAt=0;
const cliValue=flag=>{const at=process.argv.indexOf(flag);return at>=0?process.argv[at+1]:undefined;};
const port=Number(cliValue('--port')||process.env.PORT||3000);
const host=cliValue('--host')||'127.0.0.1';
async function currentWorker(){
  const mtime=statSync(workerFile).mtimeMs;
  if(mtime!==loadedAt){worker=(await import(pathToFileURL(workerFile).href+'?mtime='+mtime)).default;loadedAt=mtime;}
  return worker;
}
createServer(async(req,res)=>{
  try{
    const parts=[];for await(const part of req)parts.push(part);
    const host=req.headers['x-forwarded-host']||req.headers.host;
    const proto=req.headers['x-forwarded-proto']||'http';
    const url=new URL(req.url,proto+'://'+host);
    const headers=new Headers();
    for(const [key,value] of Object.entries(req.headers))if(value!==undefined)headers.set(key,Array.isArray(value)?value.join(', '):value);
    // Inject a fixture identity only in this separate localhost QA adapter.
    if(!url.pathname.startsWith('/api/public/')&&!headers.has('X-SharePass-Session')){
      headers.set('oai-authenticated-user-id','sharepass-preview-owner');
      headers.set('oai-authenticated-user-email','owner@example.test');
    }
    const request=new Request(url,{method:req.method,headers,
      ...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(parts)}:{})});
    const response=await(await currentWorker()).fetch(request,env,ctx);
    res.statusCode=response.status;
    for(const [key,value] of response.headers)res.setHeader(key,value);
    res.end(Buffer.from(await response.arrayBuffer()));
  }catch(error){console.error('Synthetic preview error:',error.message);res.writeHead(500,{'Content-Type':'text/plain'});res.end('Synthetic preview error. Check local logs.');}
}).listen(port,host,()=>console.log('SharePass synthetic preview ready'));
