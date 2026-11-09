'use strict';
const form=document.getElementById('connect-form');
const code=document.getElementById('setup-code');
const submit=document.getElementById('connect-submit');
const errorLine=document.getElementById('connect-error');
const invite=new URLSearchParams(location.search).get('invite');
const hasInvite=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(invite||'');
let attempt;

if(hasInvite){
  document.getElementById('setup-code-field').hidden=true;
  code.disabled=true;
  document.getElementById('connect-help').textContent='Use this invitation only if you received it from your booth supervisor.';
  submit.textContent='Connect this browser';
  if(/Android/i.test(navigator.userAgent)){
    const app=document.getElementById('open-sharepass');
    app.href='intent://connect?invite='+invite+'#Intent;scheme=sharepass;package=in.sharepass.foundation;end';
    app.hidden=false;
  }
}else if(invite){
  errorLine.textContent='This setup QR could not be read. Enter the four-digit code instead.';
}

form.onsubmit=async event=>{
  event.preventDefault();
  if(submit.disabled)return;
  const choice=hasInvite?{invite}:{code:code.value};
  const signature=JSON.stringify(choice);
  if(attempt?.signature!==signature){
    const bytes=crypto.getRandomValues(new Uint8Array(32));
    const verifier=btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    attempt={signature,verifier};
  }
  submit.disabled=true;
  errorLine.textContent='';
  try{
    const response=await fetch('/api/device/connect',{
      method:'POST',cache:'no-store',credentials:'same-origin',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({...choice,verifier:attempt.verifier})
    });
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||'The device could not connect.');
    location.replace('/staff');
  }catch(error){errorLine.textContent=error.message;}
  finally{submit.disabled=false;}
};
