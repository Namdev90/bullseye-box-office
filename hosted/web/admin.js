'use strict';
const byId=id=>document.getElementById(id);
const setupStatus=byId('setup-status');
const nav=[...document.querySelectorAll('[data-panel]')];
const boothList=byId('booth-list');
const deviceList=byId('device-list');
const boothForm=byId('booth-form');
const inviteForm=byId('invite-form');
const reissueForm=byId('reissue-form');
const invite=byId('setup-invite');
const inviteCode=byId('invite-code');
const inviteQr=byId('invite-qr');
const toggleInvite=byId('toggle-invite');
const reissueStatus=byId('reissue-status');
const openBooth=byId('open-booth-form');
const openInvite=byId('open-invite-form');
const refreshDevices=byId('refresh-devices');
let busy=false, reissueAttempt;

async function request(path,body){
  const response=await fetch(path,{cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'SharePass could not complete the request.');
  return data;
}

function item(title,detail){
  const row=document.createElement('li');
  const label=document.createElement('span');
  const name=document.createElement('strong');
  const notes=document.createElement('small');
  name.textContent=title;
  notes.textContent=detail;
  label.append(name,notes);
  row.append(label);
  return row;
}

function renderSetup(data){
  const boothNames=new Map(data.booths.map(booth=>[booth.id,booth.name]));
  const staffNames=new Map(data.staff.map(person=>[person.id,person.name]));
  boothList.replaceChildren(...data.booths.map(booth=>item(booth.name,booth.location||'Pickup location not set')));
  deviceList.replaceChildren(...data.devices.map(device=>{
    const status=device.active?(device.paired?'Connected':'Waiting for setup'):'Revoked';
    const row=item(device.label,[staffNames.get(device.staff_id),boothNames.get(device.booth_id),device.designation,status].filter(Boolean).join(' · '));
    if(device.active){
      const revoke=document.createElement('button');
      revoke.type='button';
      revoke.textContent='Revoke';
      revoke.setAttribute('aria-label','Revoke '+device.label);
      revoke.onclick=()=>updateSetup({action:'revoke',device_id:device.id},'Device revoked.');
      row.append(revoke);
    }
    return row;
  }));
  if(!data.booths.length)boothList.append(item('No booths yet','Add the booth that will hold the passes.'));
  if(!data.devices.length)deviceList.append(item('No devices yet','Set up a staff device to connect it to a booth.'));
  for(const select of [inviteForm.elements.booth_id,reissueForm.elements.booth_id]){
    const previous=select.value;
    select.replaceChildren(...data.booths.map(booth=>{
      const option=document.createElement('option');
      option.value=booth.id;
      option.textContent=booth.name;
      return option;
    }));
    if(boothNames.has(previous))select.value=previous;
  }
  openInvite.disabled=!data.booths.length;
}

async function updateSetup(body,message){
  if(busy)return;
  busy=true;
  setupStatus.textContent='';
  try{
    const data=await request('/api/admin/setup',body);
    renderSetup(data);
    setupStatus.textContent=message||'';
    return data;
  }catch(error){setupStatus.textContent=error.message;}
  finally{busy=false;}
}

function panel(id,focus=true){
  for(const button of nav){
    const active=button.dataset.panel===id;
    button.setAttribute('aria-pressed',active);
    byId(button.dataset.panel).hidden=!active;
  }
  if(focus)byId(id+'-heading').focus();
  if(id==='code-policy'&&!catalogue.length)updateCodePolicy();
}
for(const button of nav)button.onclick=()=>panel(button.dataset.panel);

function wizard(form,finish,cancel){
  const steps=[...form.querySelectorAll('[data-step]')];
  const next=form.querySelector('[data-next]');
  const back=form.querySelector('[data-back]');
  const finalLabel=next.textContent;
  let index=0;
  function show(at,focus=true){
    index=at;
    steps.forEach((step,i)=>{step.hidden=i!==at;});
    next.textContent=at===steps.length-1?finalLabel:'Next';
    back.hidden=at===0&&!cancel;
    back.textContent=at===0?'Cancel':'Back';
    if(focus)steps[at].querySelector('input,select').focus();
  }
  function valid(step){
    for(const field of step.querySelectorAll('input,select')){
      if(field.tagName==='INPUT')field.value=field.value.trim();
      if(!field.reportValidity())return false;
    }
    return true;
  }
  back.onclick=()=>index>0?show(index-1):cancel?.();
  form.addEventListener('keydown',event=>{
    if(event.key==='Enter'&&event.target.matches('input,select'))event.preventDefault();
  });
  form.onsubmit=async event=>{
    event.preventDefault();
    if(next.disabled||!valid(steps[index]))return;
    if(index<steps.length-1){show(index+1);return;}
    next.disabled=back.disabled=true;
    try{await finish(Object.fromEntries(new FormData(form)),show);}
    finally{next.disabled=back.disabled=false;}
  };
  show(0,false);
  return show;
}

function showBoothForm(show){
  boothForm.hidden=!show;
  boothList.hidden=openBooth.hidden=show;
  if(!show)openBooth.focus();
}

function showInviteForm(show){
  inviteForm.hidden=!show;
  deviceList.hidden=openInvite.hidden=refreshDevices.hidden=show;
  if(!show)openInvite.focus();
}

const boothStep=wizard(boothForm,async fields=>{
  if(await updateSetup({action:'booth',...fields},'Booth created.')){
    boothForm.reset();
    showBoothForm(false);
  }
},()=>showBoothForm(false));

openBooth.onclick=()=>{showBoothForm(true);boothStep(0);};

function clearInvitation(){
  invite.hidden=true;
  inviteQr.replaceChildren();
  inviteCode.textContent='';
}

function showInvitation(data){
  const url=new URL(data.qr_url,location.origin);
  if(url.origin!==location.origin||url.pathname!=='/connect'||
    !/^[0-9a-f-]{36}$/i.test(url.searchParams.get('invite')||'')||!/^[0-9]{4}$/.test(data.code)){
    throw new Error('The setup details could not be displayed.');
  }
  inviteQr.replaceChildren(SharePassDrafts.qrImage(url.href,'One-use staff setup QR'));
  inviteCode.textContent=data.code;
  const expires=new Date(data.expires_at);
  byId('invite-expiry').textContent=Number.isNaN(expires.getTime())?'Use this invitation once.':'Use this invitation once before '+expires.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})+'.';
  inviteCode.hidden=true;
  inviteQr.hidden=false;
  toggleInvite.textContent='Use setup code instead';
  inviteForm.hidden=true;
  invite.hidden=false;
  byId('invite-heading').focus();
}

const inviteStep=wizard(inviteForm,async fields=>{
  const data=await updateSetup({action:'invite',...fields});
  if(!data)return;
  try{showInvitation(data);inviteForm.reset();}
  catch(error){setupStatus.textContent=error.message;}
},()=>showInviteForm(false));

openInvite.onclick=()=>{clearInvitation();showInviteForm(true);inviteStep(0);};
refreshDevices.onclick=()=>updateSetup(null,'Devices refreshed.');
toggleInvite.onclick=()=>{
  inviteCode.hidden=!inviteCode.hidden;
  inviteQr.hidden=!inviteCode.hidden;
  toggleInvite.textContent=inviteCode.hidden?'Use setup code instead':'Show setup QR instead';
};
byId('close-invite').onclick=()=>{clearInvitation();showInviteForm(false);updateSetup();};

wizard(reissueForm,async(fields,show)=>{
  fields.valid_minutes=Number(fields.valid_minutes);
  const signature=JSON.stringify(fields);
  if(reissueAttempt?.signature!==signature)reissueAttempt={signature,request_id:crypto.randomUUID()};
  reissueStatus.textContent='';
  try{
    const data=await request('/api/admin/reissue',{...fields,request_id:reissueAttempt.request_id});
    reissueStatus.textContent='New collection code '+data.collection_code;
    reissueForm.reset();
    reissueAttempt=null;
    show(0);
  }catch(error){reissueStatus.textContent=error.message;}
});

const codeThemeForm=byId('code-theme-form');
const codeOverrideForm=byId('code-override-form');
const codePolicyStatus=byId('code-policy-status');
const refreshCodePolicy=byId('refresh-code-policy');
const codeTheme=codeThemeForm.elements.theme;
const codeSelect=codeOverrideForm.elements.code;
const codeScore=codeOverrideForm.elements.score;
const codeEnabled=codeOverrideForm.elements.enabled;
let catalogue=[];

function showCodeOverride(){
  const entry=catalogue.find(row=>row.code===codeSelect.value);
  if(!entry)return;
  codeScore.value=entry.score??'';
  codeEnabled.checked=entry.enabled;
  byId('code-override-detail').textContent='Catalogue score '+entry.default_score+
    (entry.eligible?'. Eligible for this event.':entry.enabled?'. Ineligible under the current event rules.':'. Automatic suggestions are disabled.');
}
async function updateCodePolicy(body){
  if(refreshCodePolicy.disabled)return;
  refreshCodePolicy.disabled=true;
  for(const form of [codeThemeForm,codeOverrideForm])form.querySelector('fieldset').disabled=true;
  codePolicyStatus.textContent=body?'Saving code policy…':'Loading code catalogue…';
  try{
    const data=await request('/api/admin/code-policy',body);
    const selected=codeSelect.value;
    if(!catalogue.length){
      for(const {code} of data.catalogue)codeSelect.add(new Option(code,code));
    }
    catalogue=data.catalogue;
    if(selected)codeSelect.value=selected;
    codeTheme.value=data.theme;
    showCodeOverride();
    byId('code-policy-summary').textContent=data.eligible+' eligible catalogue codes for this event. '+
      data.registered+' already registered among them.';
    codePolicyStatus.textContent=body?'Code policy saved.':'Code catalogue loaded.';
  }catch(error){codePolicyStatus.textContent=error.message;}
  finally{
    refreshCodePolicy.disabled=false;
    for(const form of [codeThemeForm,codeOverrideForm])form.querySelector('fieldset').disabled=!catalogue.length;
  }
}
refreshCodePolicy.onclick=()=>updateCodePolicy();
codeSelect.onchange=showCodeOverride;
codeThemeForm.onsubmit=event=>{
  event.preventDefault();
  updateCodePolicy({action:'theme',theme:codeTheme.value});
};
byId('reset-code-theme').onclick=()=>updateCodePolicy({action:'theme',theme:null});
codeOverrideForm.onsubmit=event=>{
  event.preventDefault();
  updateCodePolicy({action:'override',code:codeSelect.value,score:codeScore.value===''?null:codeScore.valueAsNumber,enabled:codeEnabled.checked});
};

const accountTabs=[...document.querySelectorAll('[data-account]')];
const reportStatus=byId('report-status');
const reportRows=byId('report-rows');
const reportStorage=byId('report-storage');
let loadedSetup=false,reportBusy=false;

async function loadReport(){
  if(reportBusy)return;
  reportBusy=true;
  reportStatus.textContent='';
  try{
    const data=await request('/api/admin/report');
    const storage=data.storage;
    if(Number.isSafeInteger(storage?.used_bytes)){
      const used=new Intl.NumberFormat(undefined,{maximumFractionDigits:2}).format(storage.used_bytes/1000000);
      reportStorage.textContent='Database storage: '+used+' MB used of the '+storage.limit_bytes/1000000000+' GB deposit limit.'
        +(storage.at_limit?' New deposits are paused. Existing pickups can continue.':'');
    }else reportStorage.textContent='Database storage measurement is unavailable.';
    reportRows.replaceChildren(...data.booths.map(booth=>{
      const row=document.createElement('tr');
      const name=document.createElement('th');
      name.scope='row';
      name.textContent=booth.name;
      row.append(name);
      for(const key of ['deposits','received','available','pending','handed_over']){
        const cell=document.createElement('td');
        cell.textContent=booth[key];
        row.append(cell);
      }
      return row;
    }));
    if(!data.booths.length)reportStatus.textContent='No booth totals yet.';
  }catch(error){reportStatus.textContent=error.message;}
  finally{reportBusy=false;}
}

function accountPanel(focus=false){
  const hash=location.hash.slice(1);
  const section=['administration','reports'].includes(hash)?hash:'overview';
  for(const button of accountTabs){
    const active=button.dataset.account===section;
    button.setAttribute('aria-pressed',active);
    byId('account-'+button.dataset.account).hidden=!active;
  }
  if(section==='administration'&&!loadedSetup){
    loadedSetup=true;
    updateSetup().then(data=>{if(!data)loadedSetup=false;});
  }
  if(section==='reports')loadReport();
  if(focus)byId('account-'+section).querySelector('h2').focus();
}
for(const button of accountTabs)button.onclick=()=>{location.hash=button.dataset.account;};
addEventListener('hashchange',()=>accountPanel(true));
byId('refresh-report').onclick=loadReport;
accountPanel();
