'use strict';
// Original, quiet synthesized cues. No Navrang audio files, network or microphone.
(()=>{
 let enabled=true,context,last=0,started=false;
 try{enabled=localStorage.getItem('sharepass-sound')!=='off';}catch{}
 const toggle=document.querySelector('#audio-enabled'),label=document.querySelector('#audio-state');
 function cue(kind){
  if(!enabled||document.hidden||performance.now()-last<130)return;
  last=performance.now();
  try{
   const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;
   context=context||new Audio();if(context.state==='suspended')context.resume().catch(()=>{});
   const oscillator=context.createOscillator(),gain=context.createGain(),at=context.currentTime;
   oscillator.type='sine';oscillator.frequency.setValueAtTime(kind==='confirm'?620:kind==='alert'?740:kind==='open'?520:kind==='close'?280:420,at);
   oscillator.frequency.exponentialRampToValueAtTime(kind==='confirm'?820:kind==='close'?230:350,at+.055);
   gain.gain.setValueAtTime(.0001,at);gain.gain.exponentialRampToValueAtTime(.025,at+.008);gain.gain.exponentialRampToValueAtTime(.0001,at+.09);
   oscillator.connect(gain);gain.connect(context.destination);oscillator.start(at);oscillator.stop(at+.1);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
  }catch{/* Feedback cannot block a desk action. */}
 }
 function preference(value){enabled=value;try{localStorage.setItem('sharepass-sound',enabled?'on':'off');}catch{}if(toggle)toggle.checked=enabled;if(label)label.textContent=enabled?'On':'Muted';if(!enabled)context?.suspend().catch(()=>{});else cue('tap');}
 if(toggle){toggle.checked=enabled;toggle.addEventListener('change',()=>preference(toggle.checked));if(label)label.textContent=enabled?'On':'Muted';}
 const help=document.querySelector('#guide');
 if(help){const sound=document.createElement('button');sound.type='button';sound.textContent=enabled?'Sound: On':'Sound: Muted';sound.setAttribute('aria-pressed',String(enabled));sound.addEventListener('click',()=>{preference(!enabled);sound.textContent=enabled?'Sound: On':'Sound: Muted';sound.setAttribute('aria-pressed',String(enabled));});help.append(sound);}
 document.addEventListener('click',event=>{const button=event.target.closest('button,a');if(!button||button.disabled||button.id==='audio-enabled')return;if(!started){started=true;cue('open');}else cue(button.classList.contains('close-dialog')?'close':'tap');});
 window.sharePassFeedback=cue;
})();
