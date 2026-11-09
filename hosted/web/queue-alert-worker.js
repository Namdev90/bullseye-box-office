self.addEventListener('push',event=>{
  event.waitUntil(Promise.all([
    self.registration.showNotification('New SharePass deposit',{body:'Open the staff queue to review it.',tag:'sharepass-queue'}),
    self.clients.matchAll({type:'window',includeUncontrolled:true}).then(tabs=>{
      for(const tab of tabs)tab.postMessage({type:'sharepass-queue'});
    })
  ]));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil(clients.openWindow('/staff'));
});
