const challengePattern=/^[a-f0-9]{64}$/;
const verifierPattern=/^[A-Za-z0-9_-]{43}$/;
const MOBILE_SESSION_MS=24*60*60*1000;

async function verifierDigest(verifier){
  if(typeof verifier!=='string'||!verifierPattern.test(verifier))return '';
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));
  return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
}

async function mobileSession(db,verifier){
  const digest=await verifierDigest(verifier);
  return digest?db.prepare('SELECT digest,user_id,email,expires_at FROM sharepass_mobile_sessions WHERE digest=? AND revoked=0 AND expires_at>?')
    .bind(digest,Date.now()).first():null;
}

async function authorizeMobile(db,staff,challenge){
  if(typeof challenge!=='string'||!challengePattern.test(challenge))return error('Open the pairing link from the SharePass app.',400);
  const now=Date.now();
  await db.prepare('DELETE FROM sharepass_mobile_sessions WHERE expires_at<=?').bind(now-7*MOBILE_SESSION_MS).run();
  const existing=await db.prepare('SELECT user_id,email,expires_at,revoked FROM sharepass_mobile_sessions WHERE digest=?').bind(challenge).first();
  if(existing)return existing.user_id===staff.operator&&existing.email===staff.email&&!existing.revoked&&existing.expires_at>now
    ?json({authorized:true}):error('This pairing link cannot be reused. Start again from SharePass.',409);
  const created=await db.prepare(`INSERT OR IGNORE INTO sharepass_mobile_sessions(digest,user_id,email,expires_at)
    SELECT ?,?,?,? WHERE (SELECT count(*) FROM sharepass_mobile_sessions WHERE email=? AND revoked=0 AND expires_at>?)<16`)
    .bind(challenge,staff.operator,staff.email,now+MOBILE_SESSION_MS,staff.email,now).run();
  return created.meta.changes===1?json({authorized:true}):error('Could not pair this device. Try again from the app.',409);
}
