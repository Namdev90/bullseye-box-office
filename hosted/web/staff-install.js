'use strict';
const installButton=document.getElementById('install-staff-desk');
let staffInstallPrompt;
window.addEventListener('beforeinstallprompt',event=>{
  event.preventDefault();
  staffInstallPrompt=event;
  installButton.hidden=false;
});
window.addEventListener('appinstalled',()=>{
  staffInstallPrompt=null;
  installButton.hidden=true;
});
installButton.addEventListener('click',async()=>{
  const prompt=staffInstallPrompt;
  staffInstallPrompt=null;
  installButton.hidden=true;
  try{await prompt?.prompt();}catch{/* The browser's install menu remains available. */}
});
// Reuse the notification worker. Registration alone neither subscribes nor caches register data.
let staffWorker,lastWorkerCheck=0;
function checkStaffWorker(){
  if(!staffWorker||document.hidden||Date.now()-lastWorkerCheck<30*60*1000)return;
  lastWorkerCheck=Date.now();staffWorker.update().catch(()=>{});
}
navigator.serviceWorker?.register('/queue-alert-worker.js').then(registration=>{
  staffWorker=registration;lastWorkerCheck=Date.now();
}).catch(()=>{});
document.addEventListener('visibilitychange',checkStaffWorker);
setInterval(checkStaffWorker,30*60*1000);
