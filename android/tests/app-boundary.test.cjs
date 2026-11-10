const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('Android launcher opens a native desk with internet and optional notifications',()=>{
 const manifest=read('android-app/src/main/AndroidManifest.xml');
 assert.deepEqual([...manifest.matchAll(/<uses-permission android:name="([^"]+)"/g)].map(match=>match[1]),['android.permission.INTERNET','android.permission.POST_NOTIFICATIONS','android.permission.REQUEST_INSTALL_PACKAGES']);
 assert(manifest.includes('android:autoVerify="true"')&&manifest.includes('android:path="/app-setup"'));
 assert(manifest.includes('android:authorities="${applicationId}.updates" android:exported="false"'));
 assert(manifest.includes('android:allowBackup="false"'));
 assert(manifest.includes('android:usesCleartextTraffic="false"'));
 const host=read('android-app/src/main/java/in/sharepass/foundation/MainActivity.java');
 for(const item of ['request.deny()','handler.cancel()','setAllowFileAccess(false)','setAllowContentAccess(false)','setWebContentsDebuggingEnabled(false)'])assert(host.includes(item),item);
 assert(!host.includes('addJavascriptInterface'));
 assert(host.includes('request.isForMainFrame() && request.hasGesture() && PUBLIC_SHOWCASE.equals'));
 assert(host.includes('HostedDeskActivity.class'));
 const desk=read('android-app/src/main/java/in/sharepass/foundation/HostedDeskActivity.java');
 const viewIntents=[...desk.matchAll(/Intent\.ACTION_VIEW/g)];
 assert.equal(viewIntents.length,2);
 assert(desk.includes('Uri.parse(HostedRegisterClient.ORIGIN + "/owner-signin")'));
 assert(viewIntents[1].index>desk.indexOf('private void compose(String address'));
 assert(!desk.includes('Intent.ACTION_SENDTO'));
 assert(desk.includes('WhatsAppDraft.url(address, message)'));
 assert(!manifest.includes('android.permission.SEND_SMS'));
 assert(desk.includes('client.connectDevice("code", value)'));
 assert(host.includes('HostedRegisterClient.setupInvite(incoming.toString())'));
 assert(host.includes('"/app-setup".equals(incoming.getEncodedPath())'));
 assert(desk.includes('page("Pass desk"'));
 assert(desk.includes('I received the passes'));
 assert(desk.includes('"/api/intakes/" + token + "/confirm"'));
 assert(read('android-app/build.gradle.kts').includes('in.sharepass.foundation'));
});
test('debug cleartext is limited to exact loopback without subdomains',()=>{
 // Android domain rules match exactly unless includeSubdomains is true.
 // Keep false explicit for NetworkSecurityConfig lint, and reject any extra
 // domain, nested config, trust override or app-wide cleartext exception.
 const compact=xml=>xml.replace(/>\s+</g,'><').trim();
 assert.equal(compact(read('android-app/src/debug/res/xml/showcase_network.xml')),
   '<network-security-config><base-config cleartextTrafficPermitted="false"/>'+
   '<domain-config cleartextTrafficPermitted="true"><domain includeSubdomains="false">127.0.0.1</domain>'+
   '</domain-config></network-security-config>');
 const src=path.join(root,'android-app/src');
 const files=fs.readdirSync(src,{recursive:true}).map(file=>file.replaceAll(path.sep,'/'));
 assert.deepEqual(files.filter(file=>file.endsWith('/showcase_network.xml')),['debug/res/xml/showcase_network.xml']);
 for(const file of files.filter(file=>file.endsWith('/AndroidManifest.xml'))){
   const manifest=read('android-app/src/'+file);
   assert(!/android:usesCleartextTraffic="true"/.test(manifest),file);
   if(file==='debug/AndroidManifest.xml'){
     assert.equal(compact(manifest),
       '<manifest xmlns:android="http://schemas.android.com/apk/res/android">'+
       '<uses-permission android:name="android.permission.INTERNET"/>'+
       '<application android:networkSecurityConfig="@xml/showcase_network"/></manifest>');
   }else{
     assert(!manifest.includes('networkSecurityConfig'),file);
   }
 }
 assert(read('android-app/src/main/AndroidManifest.xml').includes('android:usesCleartextTraffic="false"'));
});
test('booth alert can only open staff review and carries no customer details',()=>{
 const desk=read('android-app/src/main/java/in/sharepass/foundation/HostedDeskActivity.java');
 const client=read('android-app/src/main/java/in/sharepass/foundation/HostedRegisterClient.java');
 assert(client.includes('setRequestProperty("X-SharePass-Client", "0.9.0")'));
 assert(desk.includes('client.request("/api/queue", null)'));
 assert(desk.includes('client.stockChange("/api/queue/" + token + "/confirm", body)'));
 const alert=read('android-app/src/main/java/in/sharepass/foundation/QueueNotifications.java');
 assert(alert.includes('putExtra("openBoothQueue", true)'));
 assert(alert.includes('FLAG_IMMUTABLE'));
 assert(alert.includes('Notification.VISIBILITY_PRIVATE'));
 assert(!/token|phone|email|stockChange/i.test(alert));
 assert(desk.includes('handler.removeCallbacks(queuePoll)'));
});
test('Firebase is opt-in, authenticated, permission-aware, and opens only the queue',()=>{
 const gradle=read('android-app/build.gradle.kts');
 assert(gradle.includes('providers.gradleProperty("sharepassFirebaseConfig")'));
 assert(gradle.includes('if (firebaseConfig == null) "src/polling/java" else "src/fcm/java"'));
 const polling=read('android-app/src/polling/java/in/sharepass/foundation/QueuePush.java');
 assert(!polling.includes('com.google.firebase'));
 const manifest=read('android-app/src/fcm/AndroidManifest.xml');
 assert(manifest.includes('android:name=".QueuePushService" android:exported="false"'));
 assert(manifest.includes('android:name="firebase_messaging_auto_init_enabled" android:value="false"'));
 const push=read('android-app/src/fcm/java/in/sharepass/foundation/QueuePush.java');
 const receiver=read('android-app/src/fcm/java/in/sharepass/foundation/QueuePushService.java');
 assert(push.includes('QueueNotifications.allowed(app)'));
 assert(push.includes('HostedRegisterClient.pushRegistration("/api/push/register", session, token)'));
 assert(push.includes('HostedRegisterClient.pushRegistration("/api/push/unregister", session, token)'));
 assert(receiver.includes('QueueNotifications.TYPE.equals(message.getData().get("type"))'));
 assert(!receiver.includes('getNotification()'));
 const host=read('android-app/src/main/java/in/sharepass/foundation/MainActivity.java');
 assert(host.includes('startActivity(QueueNotifications.openQueue(this))'));
});
test('shared AndroidX APIs are compile dependencies even when Firebase is absent',()=>{
 const gradle=read('android-app/build.gradle.kts');
 const dependencies=gradle.slice(gradle.indexOf('\ndependencies {'));
 // Only declarations directly inside dependencies are unconditional. A Core
 // declaration inside the Firebase branch must not satisfy this regression.
 let depth=0;
 const unconditional=[];
 for(const line of dependencies.split('\n')){
   if(depth===1)unconditional.push(line.trim());
   depth+=(line.match(/\{/g)||[]).length-(line.match(/\}/g)||[]).length;
 }
 assert(unconditional.includes('implementation("androidx.core:core:1.8.0")'));
 assert(unconditional.includes('implementation("androidx.window:window-java:1.5.1")'));
 assert(!unconditional.some(line=>/^(?:implementation|api|add)\(/.test(line)&&line.includes('com.google.firebase')));
 assert(dependencies.includes('if (firebaseConfig != null) {\n        add("releaseImplementation", platform("com.google.firebase:firebase-bom:35.1.0"))\n        add("releaseImplementation", "com.google.firebase:firebase-messaging")'));
 for(const [file,api] of [['DeskWindow','util.Consumer'],['AppUpdates','content.FileProvider'],['UpdateFileProvider','content.FileProvider']]){
   assert(read(`android-app/src/main/java/in/sharepass/foundation/${file}.java`).includes(`import androidx.core.${api};`));
 }
 // These real Android compile/lint gates complement this source contract. They
 // must remain independent, with a clean to avoid Firebase build leftovers.
 const ci=read('../.github/workflows/sharepass-ci.yml');
 assert(ci.includes('"-PsharepassFirebaseConfig=$fixture" :android-app:assembleRelease :android-app:lintRelease'));
 assert(ci.includes('bash ./gradlew --no-daemon :android-app:clean :android-app:assembleRelease :android-app:lintRelease :android-app:mergeDebugAssets :android-app:compileDebugJavaWithJavac :android-app:lintDebug'));
});
test('native polling has a separate executor and brief actions do not show loading text',()=>{
 const desk=read('android-app/src/main/java/in/sharepass/foundation/HostedDeskActivity.java');
 const run=desk.slice(desk.indexOf('private void run(Work'),desk.indexOf('private void login'));
 assert(run.includes('handler.postDelayed(slowAction, 350)'));
 assert(!run.includes('note("Connecting'));
 assert(run.includes('worker.execute'));
 assert.equal([...run.matchAll(/handler.removeCallbacks\(slowAction\)/g)].length,2);
 assert([...desk.matchAll(/polling.execute\(/g)].length>=2);
 assert(desk.includes('!session.equals(client.token())'));
});
test('native stock workflows preserve physical verification before confirmation',()=>{
 const desk=read('android-app/src/main/java/in/sharepass/foundation/HostedDeskActivity.java');
 assert(desk.includes('steps.get(index).show(index == 0 ? exit : () -> show(index - 1), () -> show(index + 1))'));
 assert(desk.includes('wizard.text("Shelf or slot"'));
 const prepare=desk.slice(desk.indexOf('private void prepare('),desk.indexOf('private void pendingList('));
 const packet=prepare.indexOf('wizard.text("Match the packet label"');
 const counts=prepare.indexOf('quantitySteps(wizard, selected, available)');
 const release=prepare.indexOf('"/release"');
 assert(packet>=0 && packet<counts && counts<release);
 assert(prepare.includes('value.equalsIgnoreCase(packetId)'));
 assert(desk.includes('button("Select all available"'));
 assert(desk.includes('name.setAutofillHints(View.AUTOFILL_HINT_NAME)'));
 assert(desk.includes('quantitySteps(wizard, selected, available)'));
 const qr=desk.slice(desk.indexOf('private void sharingQr'));
 assert(!qr.includes('button('));
 assert(qr.includes('() -> sharingPerson(receipt, index)'));
});
test('packaged site has restrictive connection policy and isolated app boundary',()=>{
 const html=read('web/index.html'); assert(html.includes("connect-src 'none'"));assert(html.includes('src="/app-shell.js"'));
 assert(!html.includes('http://')); assert(!html.includes('serviceWorker'));
});
function fixture(){
 const listeners={};let dialogs=[],notices=[],back=0,busy=false,uncertain=false;
 const ctx={window:{},Event,document:{addEventListener:(n,f)=>listeners[n]=f,querySelectorAll:()=>dialogs,querySelector:()=>null},location:{hash:'#start'},history:{back:()=>back++},toast:t=>notices.push(t)};
 ctx.pending=()=>uncertain;
 Object.defineProperty(ctx,'busy',{get:()=>busy});vm.runInNewContext(read('web/app-shell.js'),ctx);
 return {ctx,listeners,notices,api:ctx.window.SharePassShell,setDialogs:d=>dialogs=d,setBusy:b=>busy=b,setPending:b=>uncertain=b,backCount:()=>back};
}
test('app capabilities are honest and immutable',()=>{const f=fixture();assert(Object.isFrozen(f.api.capabilities));for(const [key,v] of Object.entries(f.api.capabilities))if(key!=='mode')assert.equal(v,false);});
test('Back closes the top dialog before traversing route history',()=>{const f=fixture();let closed=0;f.setDialogs([{dispatchEvent:()=>true,close:()=>closed++}]);assert(f.api.back());assert.equal(closed,1);assert.equal(f.backCount(),0);});
test('Back respects a canceled dismissal and busy custody mutation',()=>{const f=fixture();let closed=0;f.setDialogs([{dispatchEvent:()=>false,close:()=>closed++}]);assert(f.api.back());assert.equal(closed,0);f.setBusy(true);assert(f.api.back());assert.equal(closed,0);assert.equal(f.notices.length,1);});
test('Back traverses routes and exits only from the first screen',()=>{const f=fixture();assert.equal(f.api.back(),false);f.ctx.location.hash='#history';assert(f.api.back());assert.equal(f.backCount(),1);});
test('external sharing cannot leave local preview',()=>{const f=fixture();let prevented=false;f.listeners.click({target:{closest:()=>({getAttribute:()=> 'https://wa.me/?text=synthetic'})},preventDefault:()=>prevented=true,stopImmediatePropagation(){}});assert(prevented);assert.equal(f.notices.length,1);});

test('uncertain saved action cannot unwind navigation or exit',()=>{const f=fixture();f.setPending(true);for(const hash of ['#desk','#event','#signin']){f.ctx.location.hash=hash;assert(f.api.back());}assert.equal(f.backCount(),0);assert.equal(f.notices.length,3);});
