'use strict';
// Original, quiet synthesized cues. No Navrang audio files, network or microphone.
(()=>{
 let enabled=false,context,last=0;
 const toggle=document.querySelector('#audio-enabled'),label=document.querySelector('#audio-state');
 function cue(kind){
  if(!enabled||document.hidden||performance.now()-last<130)return;
  last=performance.now();
  try{
   const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;
   context=context||new Audio();if(context.state==='suspended')context.resume().catch(()=>{});
   const oscillator=context.createOscillator(),gain=context.createGain(),at=context.currentTime;
   oscillator.type='sine';oscillator.frequency.setValueAtTime(kind==='confirm'?620:kind==='close'?280:420,at);
   oscillator.frequency.exponentialRampToValueAtTime(kind==='confirm'?820:kind==='close'?230:350,at+.055);
   gain.gain.setValueAtTime(.0001,at);gain.gain.exponentialRampToValueAtTime(.025,at+.008);gain.gain.exponentialRampToValueAtTime(.0001,at+.09);
   oscillator.connect(gain);gain.connect(context.destination);oscillator.start(at);oscillator.stop(at+.1);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
  }catch{/* Feedback cannot block a desk action. */}
 }
 toggle.addEventListener('change',()=>{enabled=toggle.checked;label.textContent=enabled?'On':'Muted';if(!enabled)context?.suspend().catch(()=>{});else cue('tap');});
 document.addEventListener('click',event=>{const button=event.target.closest('button');if(!button||button.disabled||button.type==='submit'||button.hasAttribute('data-mutation')||button.id==='audio-enabled')return;cue(button.classList.contains('close-dialog')?'close':'tap');});
 window.sharePassFeedback=cue;
})();
