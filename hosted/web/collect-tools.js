'use strict';
(()=>{
  const version=new URL(document.currentScript.src).search;
  let decoder;
  function loadDecoder(){
    if(window.jsQR)return Promise.resolve(window.jsQR);
    if(!decoder)decoder=new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.src='/vendor/jsQR.js'+version;
      script.onload=()=>window.jsQR?resolve(window.jsQR):reject(Error('Scanner unavailable. Enter the code or paste the receipt link.'));
      script.onerror=()=>{script.remove();decoder=null;reject(Error('Scanner could not load. Enter the code or paste the receipt link.'));};
      document.head.append(script);
    });
    return decoder;
  }
  let closeScanner;
  async function scan(){
    if(closeScanner)return;
    const dialog=document.createElement('dialog');dialog.className='collect-scanner';dialog.setAttribute('aria-label','Scan pickup receipt');
    const title=document.createElement('h2');title.textContent='Scan pickup receipt';
    const video=document.createElement('video');video.autoplay=true;video.muted=true;video.playsInline=true;
    const status=document.createElement('p');status.setAttribute('role','status');status.textContent='Opening camera…';
    const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel scanner';
    dialog.append(title,video,status,cancel);document.body.append(dialog);
    let active=true,stream,frame,last=0;
    const close=()=>{active=false;cancelAnimationFrame(frame);stream?.getTracks().forEach(track=>track.stop());video.srcObject=null;dialog.remove();closeScanner=null;};
    closeScanner=close;cancel.onclick=close;dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.showModal();cancel.focus();
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw Error('Camera scanning needs HTTPS and camera access. Enter the code or paste the receipt link.');
      const read=loadDecoder().then(decode=>({decode}),error=>({error}));
      stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
      if(!active){stream.getTracks().forEach(track=>track.stop());return;}
      video.srcObject=stream;await video.play();const loaded=await read;if(loaded.error)throw loaded.error;const decode=loaded.decode;
      if(!active)return;
      status.textContent='Point at the QR on the current pickup receipt.';
      const canvas=document.createElement('canvas'),context=canvas.getContext('2d',{willReadFrequently:true});
      const tick=at=>{
        if(!active)return;
        if(at-last>180&&video.videoWidth){
          last=at;const scale=Math.min(1,720/video.videoWidth);canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
          context.drawImage(video,0,0,canvas.width,canvas.height);
          const image=context.getImageData(0,0,canvas.width,canvas.height),result=decode(image.data,image.width,image.height);
          if(result){
            let receipt;
            try{receipt=SharePassDrafts.receiptDetails(result.data);}
            catch{status.textContent='This is not a current SharePass pickup receipt. Scan the receipt QR or cancel and enter the code.';}
            if(receipt){close();window.sharePassFeedback?.('scan');perform(async()=>{openLookup(receipt.code);lookupForm.elements.reference.value=receipt.reference;byId('lookup-reference').hidden=false;await findPasses();});return;}
          }
        }
        frame=requestAnimationFrame(tick);
      };
      frame=requestAnimationFrame(tick);
    }catch(error){stream?.getTracks().forEach(track=>track.stop());if(active)status.textContent=error.name==='NotAllowedError'?'Camera access is off. Cancel and enter the code or paste the receipt link.':error.message;}
  }
  document.addEventListener('visibilitychange',()=>{if(document.hidden)closeScanner?.();});
  window.addEventListener('pagehide',()=>closeScanner?.());
  for(const form of document.querySelectorAll('#desk-code-form,#lookup-form')){
    const input=form.elements.code,actions=document.createElement('div');actions.className='collect-methods';
    const scanButton=document.createElement('button');scanButton.type='button';scanButton.textContent='Scan receipt QR';scanButton.onclick=scan;
    const or=document.createElement('span');or.textContent='or';
    const paste=document.createElement('button');paste.type='button';paste.textContent='Paste receipt link';paste.onclick=()=>{openLookup(input.value);byId('lookup-reference').hidden=false;lookupForm.elements.reference.required=true;lookupForm.elements.reference.focus();};
    actions.append(scanButton,or,paste);
    const keys=document.createElement('div');keys.className='collection-keypad';keys.setAttribute('role','group');keys.setAttribute('aria-label','Collection code keypad');
    for(const digit of '1234567890⌫'){
      const button=document.createElement('button');button.type='button';button.textContent=digit;button.setAttribute('aria-label',digit==='⌫'?'Delete last digit':digit);
      button.onclick=()=>{
        if(busy)return;
        input.value=digit==='⌫'?input.value.slice(0,-1):(input.value+digit).slice(0,4);
        if(digit!=='⌫'&&'speechSynthesis' in window){speechSynthesis.cancel();speechSynthesis.speak(new SpeechSynthesisUtterance(digit));}
        input.dispatchEvent(new Event('input',{bubbles:true}));
      };keys.append(button);
    }
    form.insertBefore(actions,form.querySelector('button.primary'));form.insertBefore(keys,form.querySelector('button.primary'));
    let advance;
    input.addEventListener('input',()=>{clearTimeout(advance);if(/^\d{4}$/.test(input.value))advance=setTimeout(()=>{if(!busy&&!form.closest('[hidden]')&&/^\d{4}$/.test(input.value))form.requestSubmit();},350);});
    form.addEventListener('submit',()=>clearTimeout(advance));
  }
})();
