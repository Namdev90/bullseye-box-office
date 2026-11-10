document.addEventListener('DOMContentLoaded',()=>{
  document.querySelector('#new-deposit').insertAdjacentHTML('afterend','<button id="run-showcase-tour" class="button secondary" type="button">Run demo</button>');
  const tourButton=document.querySelector('#run-showcase-tour');
  document.body.insertAdjacentHTML('beforeend',`<dialog id="showcase-tour" aria-labelledby="showcase-tour-title">
   <div class="dialog-top"><span class="eyebrow">Isolated synthetic demo</span><button class="icon-button" type="button" aria-label="Close demo">×</button></div>
   <h2 id="showcase-tour-title">From deposit to handover</h2><div role="status" aria-live="polite"></div>
   <div class="dialog-actions"><button class="button secondary" type="button">Replay</button><button class="button secondary" type="button">Pause</button><button class="button primary" type="button">Next</button></div>
   </dialog>`);
  const tour=document.querySelector('#showcase-tour');
  const [close,replay,toggle,next]=tour.querySelectorAll('button');
  const status=tour.querySelector('[role=status]');
  let scenes=[],step=0,timer;
  function stop(){clearTimeout(timer);timer=undefined;toggle.textContent='Play';}
  function show(){
   status.textContent=scenes[step];
   next.disabled=toggle.disabled=step===scenes.length-1;
  }
  function play(){
   if(next.disabled)return;
   toggle.textContent='Pause';
   timer=setTimeout(()=>{step++;show();stop();play();},3500);
  }
  function start(){
   stop();
   step=0;
   const sample=new DemoStore({seed:false});
   const context={event_id:sample.events[0].id,operator:'Kenneth',booth_id:'B1'};
   const received=sample.create({...context,request_id:'tour-deposit',location:'A-01',quantities:{normal:4,vip:2,vvip:0},custody_confirmed:true},'0420','PKT-TOUR');
   const claim=sample.verify({...context,collection_code:received.collection_code});
   const pickup=sample.release(received.deposit.id,{...context,request_id:'tour-release',claim_token:claim.claim_token,version:claim.deposit.version,packet_id:received.deposit.packet_id,quantities:{normal:2,vip:1,vvip:0}});
   const confirmed=sample.handover(pickup.collection.id,{...context,version:pickup.collection.version,handover_confirmed:true});
   scenes=[
    '1 of 4. Kenneth counts 4 Normal and 2 VIP passes and stores the packet at Booth 1, shelf A-01.',
    '2 of 4. The depositor shares '+received.collection_code+' with a friend. The real desk can prepare a recipient-specific WhatsApp QR for manual sending.',
    '3 of 4. Kenneth matches the physical packet and confirms handover of 2 Normal and 1 VIP.',
    '4 of 4. The register shows '+confirmed.deposit.remaining.normal+' Normal and '+confirmed.deposit.remaining.vip+' VIP still at Booth 1. The confirmed handover stays in activity history.'
   ];
   show();play();
  }
  tourButton.addEventListener('click',()=>{start();tour.showModal();});
  close.addEventListener('click',()=>tour.close());
  tour.addEventListener('close',()=>{if(!tour.open)stop();});
  replay.addEventListener('click',start);
  toggle.addEventListener('click',()=>timer===undefined?play():stop());
  next.addEventListener('click',()=>{stop();step++;show();});
});
