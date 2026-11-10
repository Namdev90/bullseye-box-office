'use strict';
const cacheName='sharepass-receipt-alerts';
const scope=self.registration.scope;
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));

async function withLiveReceipt(action){
  // No unsafe cross-tab fallback: without Web Locks, do not renew cached proof,
  // display a background alert, or open a receipt from a notification.
  if(!self.navigator?.locks?.request)return;
  return self.navigator.locks.request('sharepass-receipt:'+scope,async()=>{
    const cache=await caches.open(cacheName);
    const receipt=await (await cache.match(scope))?.json();
    const path=receipt?.path;
    const match=typeof path==='string'&&path.match(/^\/booth\/([a-f0-9-]{36})#receipt=([a-f0-9-]{36})$/);
    if(!match)return;
    const subscription=await self.registration.pushManager.getSubscription();
    if(!subscription||self.Notification?.permission!=='granted')return;
    let result;
    try{
      const response=await fetch('/api/public/booth/'+match[1]+'/alerts',{
        method:'POST',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(5000),
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action:'status',ticket:match[2],endpoint:subscription.endpoint})
      });
      if(!response.ok)return;
      result=await response.json();
    }catch{return;} // Offline is not revocation; preserve proof for a later retry.
    if(result.enabled!==true||!Number.isFinite(result.expires_at)||result.expires_at<=Date.now()){
      // Preserve the code-free cleanup index. A later page visit can safely
      // remove this registration after rechecking inactive server consent.
      return;
    }
    // Recheck local permission/subscription after the network round trip.
    const current=await self.registration.pushManager.getSubscription();
    if(self.Notification?.permission!=='granted'||current?.endpoint!==subscription.endpoint)return;
    await cache.put(scope,new Response(JSON.stringify({path,expiresAt:result.expires_at})));
    await action(path);
  });
}
self.addEventListener('push',event=>{
  event.waitUntil(withLiveReceipt(async()=>{
    await self.registration.showNotification('SharePass receipt updated',{
      body:'Open SharePass to check your receipt.',tag:scope.slice(-65,-1)
    });
    for(const tab of await self.clients.matchAll({type:'window',includeUncontrolled:true})){
      tab.postMessage({type:'sharepass-receipt',scope});
    }
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil(withLiveReceipt(path=>self.clients.openWindow(path)));
});
