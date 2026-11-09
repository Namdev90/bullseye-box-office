'use strict';
const challenge = new URLSearchParams(location.search).get('challenge');
const submit = document.getElementById('pair-submit');
const statusLine = document.getElementById('pair-status');
const errorLine = document.getElementById('pair-error');
const check = document.getElementById('pair-code');

if(/^[0-9a-f]{64}$/.test(challenge || '')){
  check.textContent=challenge.slice(0,8).toUpperCase();
  check.hidden=false;
  submit.hidden=false;
  submit.onclick = async()=>{
    submit.disabled = true;
    errorLine.textContent = '';
    try{
      const response = await fetch('/api/mobile/authorize',{
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({challenge})
      });
      const result = await response.json();
      if(!response.ok)throw new Error(result.error || 'The phone could not be connected.');
      statusLine.textContent = 'Phone connected. Return to the SharePass app to continue.';
      check.hidden = true;
      submit.hidden = true;
    }catch(error){
      errorLine.textContent = error.message;
      submit.disabled = false;
    }
  };
}else{
  statusLine.textContent = 'Open SharePass on your phone and start the connection again.';
}
