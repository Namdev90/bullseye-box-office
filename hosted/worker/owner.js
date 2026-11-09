const ownerHandle=env=>/^[a-z0-9._-]{3,32}$/.test(env.SHAREPASS_OWNER_HANDLE||'')?env.SHAREPASS_OWNER_HANDLE:'';
const OWNER_COOKIE='__Host-sharepass-owner';
const OWNER_SESSION_MS=8*60*60*1000;

function ownerSessionCookie(token,age){
  return OWNER_COOKIE+'='+token+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age='+age;
}

function ownerSessionToken(request){
  return (request.headers.get('Cookie')||'').split(';').map(part=>part.trim())
    .find(part=>part.startsWith(OWNER_COOKIE+'='))?.slice(OWNER_COOKIE.length+1)||'';
}

async function ownerSession(request,env){
  if(!ownerHandle(env)||!verifierPattern.test(env.SHAREPASS_OWNER_PASSWORD_PEPPER||''))return null;
  const digest=await verifierDigest(ownerSessionToken(request));
  if(!digest)return null;
  const email=emailAddress(env.SHAREPASS_OWNER_EMAIL);
  if(!email)return null;
  const row=await env.DB.prepare('SELECT s.owner_id FROM sharepass_owner_sessions s JOIN sharepass_staff m ON m.user_id=s.owner_id AND m.email=? WHERE s.digest=? AND s.expires>?')
    .bind(email,digest,Date.now()).first();
  return row?{id:row.owner_id,email}:null;
}

function ownerPassword(value){
  return typeof value==='string'&&value.length>=15&&value.length<=128?value:'';
}

async function ownerPasswordHash(password,salt,pepper){
  const encoder=new TextEncoder();
  const hmac=await crypto.subtle.importKey('raw',encoder.encode(pepper),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const secret=await crypto.subtle.sign('HMAC',hmac,encoder.encode(password));
  const key=await crypto.subtle.importKey('raw',secret,'PBKDF2',false,['deriveBits']);
  const saltBytes=Uint8Array.from(salt.match(/../g),pair=>parseInt(pair,16));
  // Hosted Workers cap native PBKDF2 at 100,000. The separate secret protects database-only leaks.
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:saltBytes,iterations:100000},key,256);
  return Array.from(new Uint8Array(bits),byte=>byte.toString(16).padStart(2,'0')).join('');
}

function ownerHashMatches(actual,expected){
  let different=actual.length^expected.length;
  for(let i=0;i<actual.length;i++)different|=actual.charCodeAt(i)^expected.charCodeAt(i);
  return different===0;
}

async function setOwnerPassword(request,env,owner){
  const db=env.DB,pepper=env.SHAREPASS_OWNER_PASSWORD_PEPPER;
  if(!ownerHandle(env)||!verifierPattern.test(pepper||''))return error('Use verified ChatGPT sign-in until owner password setup is enabled.',503);
  const password=ownerPassword((await bodyJson(request))?.password);
  if(!password)return error('Use a new password of 15 to 128 characters.',400);
  const salt=Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('');
  const hash=await ownerPasswordHash(password,salt,pepper);
  await db.batch([
    db.prepare('INSERT INTO sharepass_owner_passwords(owner_id,salt,hash) VALUES(?,?,?) ON CONFLICT(owner_id) DO UPDATE SET salt=excluded.salt,hash=excluded.hash')
      .bind(owner,salt,hash),
    db.prepare('DELETE FROM sharepass_owner_sessions WHERE owner_id=?').bind(owner)
  ]);
  const response=json({saved:true});
  response.headers.set('Set-Cookie',ownerSessionCookie('',0));
  return response;
}

async function signInOwner(request,env){
  const db=env.DB,now=Date.now(),minute=Math.floor(now/60000);
  const pepper=env.SHAREPASS_OWNER_PASSWORD_PEPPER,handle=ownerHandle(env);
  if(!handle||!verifierPattern.test(pepper||''))return error('Use verified ChatGPT sign-in until owner password setup is enabled.',503);
  const body=await bodyJson(request),password=ownerPassword(body?.password);
  const failed=()=>error('The owner ID or password is incorrect.',401);
  if(typeof body?.username!=='string'||body.username.trim().toLowerCase()!==handle||!password)return failed();
  const address=request.headers.get('CF-Connecting-IP')||'unknown';
  const addressHash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(address));
  const scope='owner:'+Array.from(new Uint8Array(addressHash),byte=>byte.toString(16).padStart(2,'0')).join('');
  if(!(await setupAttempt(db,scope,minute,5))||!(await setupAttempt(db,'owner:global',minute,25))){
    return error('Too many sign-in attempts. Wait a minute and try again.',429);
  }
  await db.prepare('DELETE FROM sharepass_setup_limits WHERE minute<?').bind(minute-10).run();
  const email=emailAddress(env.SHAREPASS_OWNER_EMAIL);
  const row=await db.prepare('SELECT p.owner_id,p.salt,p.hash FROM sharepass_owner_passwords p JOIN sharepass_staff s ON s.user_id=p.owner_id WHERE s.email=?')
    .bind(email).first();
  if(!row||!ownerHashMatches(await ownerPasswordHash(password,row.salt,pepper),row.hash))return failed();
  const token=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const digest=await verifierDigest(token);
  const writes=await db.batch([
    db.prepare('DELETE FROM sharepass_owner_sessions WHERE expires<=?').bind(now),
    db.prepare('INSERT INTO sharepass_owner_sessions(digest,owner_id,expires) SELECT ?,owner_id,? FROM sharepass_owner_passwords WHERE owner_id=? AND salt=?')
      .bind(digest,now+OWNER_SESSION_MS,row.owner_id,row.salt)
  ]);
  if(writes[1].meta.changes!==1)return failed();
  const response=json({signed_in:true});
  response.headers.set('Set-Cookie',ownerSessionCookie(token,OWNER_SESSION_MS/1000));
  return response;
}
