async function queueNotice(){
  let body='Open the staff desk to review it.';
  const admin=self.registration.scope.endsWith('/admin-alerts/');
  try{
    const response=await fetch(admin?'/api/admin/staff-messages':'/api/queue',{credentials:'include',cache:'no-store',signal:AbortSignal.timeout(4500)});
    if(response.status===401||response.status===403)return;
    if(response.ok){
      const data=await response.json(),drafts=data.drafts||[],messages=admin?data.inbox||[]:data.messages||[];
      const arrivals=drafts.slice(0,3).map(item=>{
        const counts=['normal','vip','vvip','mip'].filter(key=>Number.isInteger(item.quantities?.[key])&&item.quantities[key]>0)
          .map(key=>item.quantities[key]+' '+({normal:'Normal',vip:'VIP',vvip:'VVIP',mip:'MIP'})[key]).join(' + ');
        return String(item.name||'Depositor').slice(0,80)+(counts?' · '+counts:'');
      });
      if(messages.length)arrivals.push('Admin: '+String(messages[0].message||'New staff message').slice(0,160));
      if(arrivals.length)body=arrivals.join('; ')+(drafts.length>3?' · +'+(drafts.length-3)+' more':'');
      else return;
    }
  }catch{/* A generic alert remains useful when the authenticated refresh cannot connect. */}
  return self.registration.showNotification('SharePass staff update',{body,tag:'sharepass-queue',icon:'/assets/sharepass-approved-logo.jpg'});
}
self.addEventListener('push',event=>{
  event.waitUntil(Promise.all([
    queueNotice(),
    self.clients.matchAll({type:'window',includeUncontrolled:true}).then(tabs=>{
      for(const tab of tabs)tab.postMessage({type:'sharepass-queue'});
    })
  ]));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil(clients.openWindow(self.registration.scope.endsWith('/admin-alerts/')?'/admin':'/staff'));
});
