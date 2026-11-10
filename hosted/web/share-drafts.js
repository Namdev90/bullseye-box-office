'use strict';
// Drafts stay on this device. QR generation makes no network request.
(()=>{
 let active=null;
 function normalizePhone(value){
  const digits=sharePassPhone(value);
  if(!digits)throw new Error('Enter a valid WhatsApp number.');
  return digits;
 }
 function composeUrl(address,message){
  return 'https://wa.me/'+normalizePhone(address)+'?text='+encodeURIComponent(message);
 }
 function composeLink(details,label='Open WhatsApp draft'){
  const link=node('a',label,'menu-link');
  link.href=composeUrl(details.address,details.message);
  link.target='_blank';link.rel='noopener noreferrer';
  return link;
 }
 function passCounts(quantities){
  if(!quantities||typeof quantities!=='object'||Array.isArray(quantities)||!Object.keys(quantities).length)throw new Error('Pass counts are required.');
  return Object.entries(quantities).map(([kind,count])=>{
   if(!/^[A-Za-z][A-Za-z0-9 _-]{0,39}$/.test(kind)||!Number.isInteger(count)||count<0||count>10000)throw new Error('Invalid pass counts.');
   const label=kind==='normal'?'Normal':kind==='vip'?'VIP':kind==='vvip'?'VVIP':kind==='mip'?'MIP':kind;
   return count?count+' '+label:'';
  }).filter(Boolean).join(' + ');
 }
 function copyQuantities(value){
  return value&&typeof value==='object'?(Array.isArray(value)?[...value]:{...value}):value;
 }
 function depositDraft(options){
  const {phone,name='',code,reference,eventName,booth,location,quantities,expiresAt}=options;
  const recipient=normalizePhone(phone);
  if(typeof name!=='string'||name.length>80||/[\u0000-\u001f\u007f]/.test(name))throw new Error('Use a name of up to 80 characters.');
  if(typeof code!=='string'||!/^[A-Z0-9]{4}$/.test(code))throw new Error('Verify a current collection code.');
  if(reference!=null&&(typeof reference!=='string'||!/^PKT-[A-F0-9]{8}$/.test(reference)))throw new Error('Verify a current pickup reference.');
  for(const value of [eventName,booth,location])if(value!=null&&(typeof value!=='string'||value.length>100||/[\u0000-\u001f\u007f]/.test(value)))throw new Error('Use valid event and pickup details.');
  if(!booth?.trim())throw new Error('Enter a pickup counter.');
  // The public intake supplies only a person's original plan, not group stock.
  const scope=Object.hasOwn(options,'scope')?options.scope:'planned';
  if(scope!=='planned'&&scope!=='group')throw new Error('Use a valid pass-count scope.');
  const allocated=Object.hasOwn(options,'allocation');
  if(allocated&&scope!=='group')throw new Error('Recipient allocation requires group counts.');
  const counts=passCounts(quantities);
  if(!counts)throw new Error(scope==='group'?'There are no remaining passes to share.':'Review the recipient’s planned share.');
  const planned=allocated?passCounts(options.allocation):'';
  if(allocated&&!planned)throw new Error('Review the recipient’s planned share.');
  const expires=Number.isFinite(expiresAt)?' Code expires '+new Date(expiresAt).toLocaleString([], {dateStyle:'medium',timeStyle:'short'})+'.':'';
  const message='Hi'+(name.trim()?' '+name.trim():'')+'! '+(scope==='planned'?
   'Your planned share: '+counts+' passes.':allocated?
   'Your planned share: '+planned+' passes.\nGroup balance on this receipt: '+counts+' passes.':
   'The receipt lists '+counts+' passes for our group.')+' SharePass by Bullseye Entertainment.\n\n'+
   (eventName?.trim()?'For '+eventName.trim()+', use code ':'Use code ')+code+(reference?' and pickup reference '+reference:'')+' to collect from '+booth.trim()+(location?.trim()?', '+location.trim():'')+'.'+expires+'\n\n'+
   'Shared group code. Staff must confirm availability; pickups are not tracked per person.';
  const url=composeUrl(recipient,message);
  if(url.length>1200)throw new Error('Shorten the pickup details for this QR.');
  return Object.freeze({message,url,recipient,name:name.trim()});
 }
 function node(tag,text,className){
  const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;
 }
 function qrImage(url,label){
  if(!window.SharePassQR)throw new Error('QR renderer unavailable. Copy the prepared message instead.');
  const matrix=window.SharePassQR.matrix(url),size=matrix.length+8,ns='http://www.w3.org/2000/svg';
  const svg=document.createElementNS(ns,'svg');
  for(const [key,value] of Object.entries({viewBox:'0 0 '+size+' '+size,width:'320',height:'320',role:'img','aria-label':label,class:'draft-qr','shape-rendering':'crispEdges'}))svg.setAttribute(key,value);
  const bg=document.createElementNS(ns,'rect');bg.setAttribute('width',size);bg.setAttribute('height',size);bg.setAttribute('fill','#fff');svg.append(bg);
  let path='';matrix.forEach((row,y)=>row.forEach((dark,x)=>{if(dark)path+='M'+(x+4)+' '+(y+4)+'h1v1h-1z';}));
  const ink=document.createElementNS(ns,'path');ink.setAttribute('d',path);ink.setAttribute('fill','#000');svg.append(ink);return svg;
 }
 function clear(){
  if(!active)return;
  const previous=active;active=null;previous.controller.abort();
  if(previous.dialog){previous.dialog.close();previous.dialog.remove();}
  for(const selector of ['input','textarea'])previous.container.querySelectorAll(selector).forEach(e=>{e.value='';e.textContent='';});
  previous.container.replaceChildren();
 }
 function renderDeposit(container,details){
  clear();
  const controller=new AbortController(),signal=controller.signal,entries=[];
  const scan=node('dialog',undefined,'qr-scan');
  scan.setAttribute('aria-label','Private collection QR');
  document.body.append(scan);
  active={container,controller,dialog:scan};
  const cards=node('div',undefined,'draft-cards');
  let selected=0,visibleEntry=0,sequence=0;
  const button=(label,action,style)=>{const b=node('button',label,style);b.type='button';b.addEventListener('click',action,{signal});return b;};
  const closeScan=()=>{if(scan.open)scan.close();scan.replaceChildren();};
  scan.addEventListener('close',()=>{if(!scan.open)scan.replaceChildren();},{signal});

  function drawScan(){
   const ready=entries.filter(entry=>entry.draft);
   const entry=ready[selected];
   if(!entry){closeScan();return;}
   const close=button('×',closeScan,'icon-button');
   close.setAttribute('aria-label','Close QR');
   scan.replaceChildren(close,node('p','WhatsApp · '+entry.label,'scan-recipient'),node('h2',details.code,'scan-code'));
   try{scan.append(qrImage(entry.draft.url,'Private WhatsApp QR for '+entry.label));}
   catch(error){scan.append(node('p',error.message,'error'));}
   if(ready.length>1){
    const nav=node('div',undefined,'scan-controls');
    const move=direction=>{selected=(selected+direction+ready.length)%ready.length;drawScan();};
    nav.append(button('Previous recipient',()=>move(-1)),button('Next recipient',()=>move(1)));
    scan.append(nav);
   }
   if(scan.open)close.focus();
  }

  const entryNav=node('div',undefined,'wizard-nav');
  const previous=button('Previous recipient',()=>showEntry(visibleEntry-1));
  const next=button('Next recipient',()=>showEntry(visibleEntry+1));
  const position=node('span',undefined,'wizard-progress');
  position.setAttribute('aria-live','polite');
  entryNav.append(previous,position,next);
  const add=button('Add recipient',()=>addRecipient({},true));
  function showEntry(index){
   visibleEntry=Math.max(0,Math.min(index,entries.length-1));
   entries.forEach((entry,i)=>entry.card.hidden=i!==visibleEntry);
   previous.hidden=visibleEntry===0;
   next.hidden=visibleEntry>=entries.length-1;
   position.textContent=entries.length>1?'Recipient '+(visibleEntry+1)+' of '+entries.length:'';
   add.disabled=entries.length>=20;
  }

  function addRecipient(initial={},focus=false){
   if(entries.length>=20)return;
   const number=++sequence,card=node('section',undefined,'draft-card');
   const form=node('form'),output=node('div',undefined,'stack'),status=node('p');
   status.setAttribute('role','status');
   function input(title,type,value,maxLength){
    const label=node('label',title,'field'),field=node('input');
    field.type=type;field.autocomplete='off';field.value=value||'';field.maxLength=maxLength;
    label.append(field);form.append(label);return field;
   }
   const name=input('Recipient name (optional)','text',initial.name,80);
   const phone=input('Recipient WhatsApp number','tel',initial.phone,40);
   phone.placeholder='10-digit mobile or international + code';
   // An allocation is the original plan, not a personal remaining balance.
   const allocation=Object.hasOwn(initial,'quantities')?{allocation:copyQuantities(initial.quantities)}:{};
   const savedPerson=(name,phone)=>({name,phone,...(Object.hasOwn(allocation,'allocation')?{quantities:copyQuantities(allocation.allocation)}:{})});
   const entry={card,draft:null,label:'Recipient '+number,
    saved:sharePassPhone(initial.phone)||Object.hasOwn(initial,'quantities')?
     savedPerson(initial.name||'',sharePassPhone(initial.phone)?'+'+sharePassPhone(initial.phone):initial.phone||''):undefined};
   entries.push(entry);cards.append(card);
   const remember=()=>details.saveRecipients?.(entries.map(item=>item.saved).filter(Boolean));
   const remove=button('Remove recipient',()=>{
    closeScan();name.value=phone.value='';
    entries.splice(entries.indexOf(entry),1);card.remove();remember();showEntry(visibleEntry);add.focus();
   });
   const edit=button('Edit recipient',()=>{entry.draft=null;output.hidden=true;form.hidden=false;phone.focus();});
   function generate(focusResult){
    try{
     entry.draft=depositDraft({...details,...allocation,scope:'group',name:name.value,phone:phone.value});
     entry.label=entry.draft.name||'Recipient '+number;
     entry.saved=savedPerson(entry.draft.name,'+'+entry.draft.recipient);
     const tile=button('Show WhatsApp QR',()=>{
      selected=entries.filter(item=>item.draft).indexOf(entry);drawScan();scan.showModal();
     },'scan-tile');
     const link=composeLink({address:entry.draft.recipient,message:entry.draft.message});
     const preview=node('details'),message=node('textarea');
     message.readOnly=true;message.rows=5;message.value=entry.draft.message;
     message.setAttribute('aria-label','Prepared WhatsApp message');
     preview.append(node('summary','Preview message'),message);
     output.replaceChildren(node('h4','WhatsApp · '+entry.label),node('p','+'+entry.draft.recipient),tile,link,edit,preview);
     output.hidden=false;form.hidden=true;status.textContent='';
     if(focusResult){remember();window.sharePassMorph?.(output);tile.focus();}
    }catch(error){status.textContent=error.message;phone.focus();}
   }
   const generateButton=node('button','Prepare WhatsApp','primary');
   generateButton.type='submit';
   form.append(generateButton,status);
   form.onsubmit=event=>{event.preventDefault();generate(true);};
   for(const field of [name,phone])field.addEventListener('input',()=>{
    entry.draft=null;output.hidden=true;status.textContent='';closeScan();
   },{signal});
   sharePassAutoAdvance(phone,sharePassPhoneComplete,()=>generate(true),signal);
   card.append(form,output,remove);
   if(sharePassPhone(initial.phone))generate(false);
   if(focus){showEntry(entries.length-1);name.focus();}
  }
  container.append(node('h3','Share by WhatsApp'),cards,entryNav,add);
  const saved=details.recipients?.length?details.recipients:[{phone:details.phone,name:details.name}];
  const ready=saved.filter(person=>sharePassPhone(person.phone)||Object.hasOwn(person,'quantities'));
  if(ready.length)ready.forEach(person=>addRecipient(person));
  else addRecipient({name:saved[0]?.name});
  showEntry(0);
  const parent=container.closest('dialog');parent?.addEventListener('close',()=>{if(!parent.open)clear();},{signal});
  window.addEventListener('pagehide',clear,{signal});
 }
 window.SharePassDrafts=Object.freeze({renderDeposit,depositDraft,composeLink,normalizePhone,qrImage,clear});
})();
