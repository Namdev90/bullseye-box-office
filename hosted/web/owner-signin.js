'use strict';
const ownerForm=document.getElementById('owner-credentials');
if(ownerForm){
  const status=document.getElementById('owner-credentials-status');
  ownerForm.onsubmit=async event=>{
    event.preventDefault();
    const button=ownerForm.querySelector('button');
    button.disabled=true;
    status.textContent='';
    const passwordSetup=ownerForm.dataset.action==='password';
    const fields=Object.fromEntries(new FormData(ownerForm));
    ownerForm.elements.password.value='';
    try{
      const response=await fetch(passwordSetup?'/api/owner/password':'/api/owner/login',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(fields)
      });
      const result=await response.json();
      if(!response.ok)throw Error(result.error||'Could not finish. Try again.');
      if(passwordSetup)status.textContent='Password saved. You can now use owner sign-in.';
      else location.replace('/account');
    }catch(error){status.textContent=error.message;}
    finally{button.disabled=false;}
  };
}

const ownerLogout=document.getElementById('owner-sign-out');
if(ownerLogout)ownerLogout.onclick=async event=>{
  event.preventDefault();
  try{
    const response=await fetch('/api/owner/logout',{method:'POST'});
    if(!response.ok)throw Error('Sign-out failed');
    location.assign(ownerLogout.href);
  }catch{document.getElementById('owner-sign-out-status').textContent='Could not sign out. Try again.';}
};
