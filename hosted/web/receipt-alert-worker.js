'use strict';
const cacheName='sharepass-receipt-alerts';
const scope=self.registration.scope;
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('push',event=>{
  event.waitUntil(Promise.all([
    self.registration.showNotification('SharePass receipt updated',{
      body:'Open SharePass to check your receipt.',tag:scope.slice(-65,-1)
    }),
    self.clients.matchAll({type:'window',includeUncontrolled:true}).then(tabs=>{
      for(const tab of tabs)tab.postMessage({type:'sharepass-receipt',scope});
    })
  ]));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const stored=await (await caches.open(cacheName)).match(scope);
    const receipt=await stored?.json();
    if(!receipt||receipt.expiresAt<=Date.now()||
      !/^\/booth\/[a-f0-9-]{36}#receipt=[a-f0-9-]{36}$/.test(receipt.path))return;
    await self.clients.openWindow(receipt.path);
  })());
});
