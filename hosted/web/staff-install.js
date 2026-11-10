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
navigator.serviceWorker?.register('/queue-alert-worker.js').catch(()=>{});
