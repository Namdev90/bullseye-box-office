'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const source=readFileSync(join(__dirname,'../android-app/src/main/java/in/sharepass/foundation/HostedDeskActivity.java'),'utf8');
const section=(from,to)=>source.slice(source.indexOf(from),source.indexOf(to,source.indexOf(from)+from.length));
// Wiring contracts complement the executed JVM formatter tests. No Activity/device claim.
test('native allocation load/save preserves explicit quantities including malformed values',()=>{
 assert.match(source,/Object quantities;/);
 const load=section('private void sharing(JSONObject receipt)','private void sharingPerson(');
 assert.match(load,/recipient\.quantities = saved\.opt\("quantities"\)/);
 const save=section('private void rememberRecipients(','private String depositMessage(');
 assert.match(save,/if \(recipient\.quantities != null\) person\.put\("quantities", recipient\.quantities\)/);
 assert.match(save,/client\.rememberRecipients\(receipt\.getString\("collection_code"\), people\)/);
 const edit=section('private void editRecipient(','private void rememberRecipients(');
 assert(!edit.includes('quantities ='),'Editing contact details cannot reallocate passes');
 assert.match(edit,/!recipient\.phone\.isEmpty\(\) \|\| recipient\.quantities != null/);
 assert.match(save,/!recipient\.phone\.isEmpty\(\) \|\| recipient\.quantities != null/);
 assert.match(load,/if \(recipient\.quantities != null\) \{\s+recipient\.phone = saved\.optString\("phone"\);\s+recipients\.add\(recipient\)/);
});
test('native sharing cache is bound to both the code and physical packet',()=>{
 const load=section('private void sharing(JSONObject receipt)','private void sharingPerson(');
 assert.match(load,/String packet = receipt\.optJSONObject\("deposit"\)\.optString\("packet_id"\)/);
 assert.match(load,/!code\.equals\(sharingCode\) \|\| !packet\.equals\(sharingPacket\)/);
 assert.match(load,/sharingPacket = packet/);
});
test('native formatter receives separate uncoerced original allocations and receipt remaining counts',()=>{
 const message=section('private String depositMessage(','private void compose(');
 assert.match(message,/getJSONObject\("remaining"\)/);
 assert.match(message,/if \(!\(recipient\.quantities instanceof JSONObject\)\) throw/);
 assert.match(message,/allocation = draftCounts\(\(JSONObject\) recipient\.quantities\)/);
 assert.match(message,/optString\("packet_id"\), allocation,HostedRegisterClient\.ORIGIN\)/);
 assert.match(message,/counts\.put\(key, quantities\.opt\(key\)\)/);
 assert(!message.includes('optInt('),'Invalid counts must not be coerced or truncated');
 assert(!message.includes('Math.min'),'A group debit cannot be assigned to a person');
 const share=section('private void sharingPerson(','private void editRecipient(');
 assert.match(share,/button\("Open WhatsApp draft", \(\) ->/);
 assert.match(share,/compose\(recipient\.phone, depositMessage\(receipt, recipient\)\)/);
});
