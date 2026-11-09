'use strict';
// Drafts stay on this device. QR generation makes no network request.
(()=>{
 let active=null;
 const channels={whatsapp:'WhatsApp',sms:'SMS',email:'Email'};
 function normalizePhone(value){
  if(typeof value!=='string'||value.length>40||!/^\+?[0-9 ()-]+$/.test(value))throw new Error('Enter a phone number with country code.');
  const digits=value.replace(/[+ ()-]/g,'');
  if(!/^[1-9][0-9]{7,14}$/.test(digits))throw new Error('Use 8–15 digits including country code.');
  return digits;
 }
 function normalizeEmail(value){
  if(typeof value!=='string'||value.length>254||! /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/.test(value)||value.includes('..'))throw new Error('Enter a valid email address.');
  return value;
 }
 function depositDraft({phone,email,name='',channel='whatsapp',code,eventName,booth,location,quantities}){
  if(!Object.hasOwn(channels,channel))throw new Error('Choose WhatsApp, Messages or Email.');
  const recipient=channel==='email'?normalizeEmail(email):normalizePhone(phone);
  if(typeof name!=='string'||name.length>80||/[\u0000-\u001f\u007f]/.test(name))throw new Error('Use a name of up to 80 characters.');
  if(typeof code!=='string'||!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/.test(code))throw new Error('Verify a current collection code.');
  for(const value of [eventName,booth,location])if(typeof value!=='string'||!value.trim()||value.length>100||/[\u0000-\u001f\u007f]/.test(value))throw new Error('Use valid event and pickup details.');
  if(!quantities||typeof quantities!=='object'||Array.isArray(quantities)||!Object.keys(quantities).length)throw new Error('Pass counts are required.');
  const counts=Object.entries(quantities).map(([kind,count])=>{
   if(!/^[A-Za-z][A-Za-z0-9 _-]{0,39}$/.test(kind)||!Number.isInteger(count)||count<0||count>10000)throw new Error('Invalid pass counts.');
   const label=kind==='normal'?'Normal':kind==='vip'?'VIP':kind==='vvip'?'VVIP':kind;
   return count?count+' '+label:'';
  }).filter(Boolean).join(' + ');
  if(!counts)throw new Error('There are no remaining passes to share.');
  const message='Hi'+(name.trim()?' '+name.trim():'')+'! I’ve left '+counts+' passes for our group with SharePass by Bullseye Entertainment.\n\n'+
   'For '+eventName.trim()+', use code '+code+' to collect from '+booth.trim()+', '+location.trim()+'.\n\n'+
   'You can pick up some or all of the passes still available for our group.';
  const url=channel==='whatsapp'?'https://wa.me/'+recipient+'?text='+encodeURIComponent(message):
   channel==='sms'?'sms:+'+recipient+'?body='+encodeURIComponent(message):
   'mailto:'+encodeURIComponent(recipient).replace('%40','@')+'?subject='+encodeURIComponent('Your SharePass collection code '+code)+'&body='+encodeURIComponent(message);
  if(url.length>1200)throw new Error('Shorten the pickup details for this QR.');
  return Object.freeze({message,url,recipient,channel,name:name.trim()});
 }
 function node(tag,text,className){
  const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;
 }
 function qrImage(url,label){
  if(!window.SharePassQR)throw new Error('QR renderer unavailable. Copy the prepared message instead.');
  const matrix=window.SharePassQR.matrix(url),size=matrix.length+8,ns='http://www.w3.org/2000/svg';
  const svg=document.createElementNS(ns,'svg');
  for(const [key,value] of Object.entries({viewBox:'0 0 '+size+' '+size,width:'320',height:'320',role:'img','aria-label':'Private message QR for '+label,class:'draft-qr','shape-rendering':'crispEdges'}))svg.setAttribute(key,value);
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
  const scan=node('dialog',undefined,'qr-scan');scan.setAttribute('aria-label','Private collection QR');document.body.append(scan);
  active={container,controller,dialog:scan};
  let selected=0,selectedChannel='whatsapp',start=null,sequence=0;
  const closeScan=()=>{if(scan.open)scan.close();scan.replaceChildren();};
  scan.addEventListener('close',()=>{if(!scan.open)scan.replaceChildren();},{signal});
  const button=(label,action,className='button secondary')=>{const b=node('button',label,className);b.type='button';b.addEventListener('click',action,{signal});return b;};
  function drawScan(){
   scan.replaceChildren();
   const entry=entries[selected];if(!entry){closeScan();return;}
   const read=entry.read();
   const close=button('×',closeScan,'icon-button');close.setAttribute('aria-label','Close QR');
   const title=button(channels[selectedChannel]+' · '+(read.name||read.email&&selectedChannel==='email'&&read.email||read.phone||'Recipient '+entry.number),()=>{selectedChannel='whatsapp';drawScan();},'text-button scan-recipient');
   title.setAttribute('aria-label',title.textContent+'. Switch to WhatsApp');
   scan.append(close,title,node('h2',details.code,'scan-code'));
   try{const draft=depositDraft({...details,...read,channel:selectedChannel});scan.append(qrImage(draft.url,draft.recipient));}
   catch(error){
    scan.append(node('p',error.message,'error'),button('Edit recipient',()=>{closeScan();entry.settings.open=true;entry.focus(selectedChannel);}));
   }
   const nav=node('div',undefined,'scan-controls');
   const previous=button('‹',()=>move('previous'),'icon-button');previous.setAttribute('aria-label','Previous recipient');
   const next=button('›',()=>move('next'),'icon-button');next.setAttribute('aria-label','Next recipient');
   nav.append(previous,button('SMS',()=>move('sms'),'text-button'),button('Email',()=>move('email'),'text-button'),next);scan.append(nav);
  }
  function move(action){
   if(action==='next')selected=(selected+1)%entries.length;
   else if(action==='previous')selected=(selected+entries.length-1)%entries.length;
   else selectedChannel=action;
   drawScan();
  }
  scan.addEventListener('pointerdown',e=>{start={x:e.clientX,y:e.clientY,id:e.pointerId};},{signal});
  scan.addEventListener('pointerup',e=>{
   if(!start||start.id!==e.pointerId)return;
   const dx=e.clientX-start.x,dy=e.clientY-start.y;start=null;
   if(Math.max(Math.abs(dx),Math.abs(dy))<45)return;
   move(Math.abs(dy)>Math.abs(dx)?(dy<0?'next':'previous'):(dx<0?'sms':'email'));
  },{signal});
  scan.addEventListener('pointercancel',()=>{start=null;},{signal});
  scan.addEventListener('keydown',e=>{
   const action={ArrowUp:'next',ArrowDown:'previous',ArrowLeft:'sms',ArrowRight:'email',w:'whatsapp'}[e.key];
   if(action){e.preventDefault();move(action);}
  },{signal});
  const cards=node('div',undefined,'draft-cards');
  const add=button('Add recipient',()=>addRecipient());
  function addRecipient(initial={}){
   if(entries.length>=10)return;
   const number=++sequence,card=node('section',undefined,'draft-card');
   const settings=node('details'),summary=node('summary','Recipient '+number);settings.open=true;settings.append(summary);
   function input(title,type,value){
    const label=node('label',title),field=node('input');field.type=type;field.autocomplete='off';field.value=value||'';field.setAttribute('aria-label',title);label.append(field);settings.append(label);return field;
   }
   const name=input('Recipient name','text',initial.name);
   const phone=input('Recipient phone number','tel',initial.phone);
   const email=input('Recipient email','email',initial.email);
   const channel=node('select');channel.setAttribute('aria-label','QR channel');
   for(const [value,title] of Object.entries(channels)){const option=node('option',title);option.value=value;channel.append(option);}settings.append(channel);
   const output=node('div'),status=node('p');status.setAttribute('role','status');
   const entry={number,settings,read:()=>({name:name.value,phone:phone.value,email:email.value}),focus:kind=>(kind==='email'?email:phone).focus()};
   entries.push(entry);add.disabled=entries.length>=10;
   const erase=()=>{closeScan();output.querySelectorAll('textarea').forEach(t=>{t.value='';});output.replaceChildren();status.textContent='';};
   for(const field of [name,phone,email])field.addEventListener('input',erase,{signal});
   channel.addEventListener('change',erase,{signal});
   const generate=button('Show QR',()=>{
    erase();
    try{
     const draft=depositDraft({...details,...entry.read(),channel:channel.value});
     summary.textContent=channels[draft.channel]+' · '+(draft.name||draft.recipient);
     const tile=button('',()=>{selected=entries.indexOf(entry);selectedChannel=channel.value;drawScan();scan.showModal();},'scan-tile');
     tile.setAttribute('aria-label','Show full-screen QR for '+draft.recipient);tile.append(node('strong',details.code,'scan-code'),qrImage(draft.url,draft.recipient));output.append(tile);
     const fallback=node('details');fallback.append(node('summary','Message & compatibility'));
     const preview=node('textarea');preview.readOnly=true;preview.rows=6;preview.value=draft.message;preview.setAttribute('aria-label','Prepared message');
     fallback.append(preview,node('p','Review and tap Send in the messaging app. SMS/RCS depends on the phone and carrier; SMS text prefilling varies by scanner.','inline-note'));output.append(fallback);settings.open=false;
    }catch(error){status.textContent=error.message;}
   },'button primary');
   const remove=button('Remove recipient',()=>{erase();for(const field of [name,phone,email])field.value='';entries.splice(entries.indexOf(entry),1);card.remove();add.disabled=false;},'text-button');
   settings.append(generate,status,remove);card.append(settings,output);cards.append(card);
   if(initial.phone)generate.click();
  }
  container.append(node('h3','Share collection details'),cards,add);
  addRecipient({phone:details.phone,email:details.email,name:details.name});
  const parent=container.closest('dialog');parent?.addEventListener('close',()=>{if(!parent.open)clear();},{signal});
  window.addEventListener('pagehide',clear,{signal});
 }
 window.SharePassDrafts=Object.freeze({renderDeposit,depositDraft,normalizePhone,normalizeEmail,clear});
})();
