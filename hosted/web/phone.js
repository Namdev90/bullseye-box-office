// Unprefixed ten-digit numbers use the Indian mobile dial plan.
function sharePassPhone(value){
  const raw=typeof value==='string'?value.trim():'';
  if(!raw||raw.length>40||!/^(?:\+|00)?[0-9 ().-]+$/.test(raw))return '';
  let digits=raw.replace(/\D/g,'');
  const explicit=raw.startsWith('+')||raw.startsWith('00');
  if(raw.startsWith('00'))digits=digits.slice(2);
  if(!explicit&&/^0?[6-9]\d{9}$/.test(digits))digits='91'+digits.slice(-10);
  else if(!explicit&&digits.length<=10)return '';
  if(!/^[1-9]\d{7,14}$/.test(digits))return '';
  if(digits.startsWith('91')&&!/^91[6-9]\d{9}$/.test(digits))return '';
  if(digits.startsWith('1')&&!/^1[2-9]\d{9}$/.test(digits))return '';
  return digits;
}

function sharePassAutoAdvance(field,ready,advance,signal){
  let timer;
  const schedule=event=>{
    clearTimeout(timer);
    if(event.isComposing||!ready(field.value))return;
    const value=field.value;
    timer=setTimeout(()=>{
      if(!signal?.aborted&&document.activeElement===field&&field.value===value&&ready(value))advance();
    },420);
  };
  field.addEventListener('input',schedule,{signal});
  field.addEventListener('change',schedule,{signal});
  // Some autofill and paste providers update the value after the event fires.
  field.addEventListener('paste',()=>setTimeout(()=>schedule({isComposing:false}),0),{signal});
  field.addEventListener('compositionend',schedule,{signal});
  field.addEventListener('blur',()=>clearTimeout(timer),{signal});
}

function sharePassContactAdvance(field,advance,signal){
  let timer;
  const schedule=()=>{
    clearTimeout(timer);
    timer=setTimeout(()=>{
      if(signal?.aborted||document.activeElement!==field||!field.value.trim()||!field.validity.valid)return;
      advance();
    },420);
  };
  field.addEventListener('paste',()=>setTimeout(schedule,0),{signal});
  field.addEventListener('input',event=>{
    if(!event.isComposing&&event.inputType==='insertReplacementText')schedule();
  },{signal});
  field.addEventListener('change',schedule,{signal});
  field.addEventListener('blur',()=>clearTimeout(timer),{signal});
}

function sharePassPhoneComplete(value){
  const digits=sharePassPhone(value);
  // Other calling plans vary in length, so Next confirms those entries.
  return digits.startsWith('91')||digits.startsWith('1');
}
