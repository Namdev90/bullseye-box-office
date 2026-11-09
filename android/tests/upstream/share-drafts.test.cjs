const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function fixture(){
 const window={};const context=vm.createContext({window});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../../web/vendor/sharepass-qr.js'),'utf8'),context);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../../web/share-drafts.js'),'utf8'),context);
 return window;
}
const data={code:'K7M4',eventName:'Evening event',booth:'B1',location:'Main entrance',quantities:{normal:4,vip:2,vvip:0},phone:'12025550101'};
test('personal messages address the friend and preserve a shared balance',()=>{
 const {SharePassDrafts:a}=fixture();
 const d=a.depositDraft({...data,name:'Riya'});
 assert(d.message.startsWith('Hi Riya!'));
 assert(d.message.includes('4 Normal + 2 VIP'));
 assert(!d.message.includes('0 VVIP'));
 assert(d.message.includes('our group'));
 assert(d.message.includes('code K7M4'));
 assert(d.message.includes('Bullseye Entertainment'));
 assert(!d.message.includes('TEST'));
});
test('each recipient and channel is encoded independently with no additional recipients',()=>{
 const {SharePassDrafts:a}=fixture();
 for(const [phone,name] of [['12025550101','Riya'],['12025550102','Rhea']]){
  for(const channel of ['whatsapp','sms','email']){
   const d=a.depositDraft({...data,phone,name,channel,email:name.toLowerCase()+'@example.com'});
   const u=new URL(d.url);
   assert.equal(u.searchParams.get(channel==='whatsapp'?'text':'body'),d.message);
   assert(!u.searchParams.has('cc'));assert(!u.searchParams.has('bcc'));
  }
 }
});
test('invalid names, counts, recipients and expired-form codes are rejected',()=>{
 const a=fixture().SharePassDrafts;
 for(const patch of [{name:'Bad\nName'},{phone:'https://example.com'},{code:'123456'},{quantities:{normal:0}},{quantities:{normal:-1}},{quantities:{normal:1.1}}])
  assert.throws(()=>a.depositDraft({...data,...patch}));
});
test('offline QR encoder produces bounded square matrices for message URIs',()=>{
 const w=fixture(),matrix=w.SharePassQR.matrix(w.SharePassDrafts.depositDraft(data).url);
 assert(matrix.length>=21&&matrix.length<=177);assert.equal((matrix.length-21)%4,0);
 assert(matrix.every(row=>row.length===matrix.length&&row.every(c=>typeof c==='boolean')));
 for(const bad of ['','é','x'.repeat(1201)])assert.throws(()=>w.SharePassQR.matrix(bad));
});
