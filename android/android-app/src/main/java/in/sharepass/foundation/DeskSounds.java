package in.sharepass.foundation;

import android.app.NotificationManager;
import android.content.Context;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.widget.Button;

final class DeskSounds {
    private static ToneGenerator tones;
    private static long last;
    static boolean enabled(Context context) { return context.getSharedPreferences("feedback",Context.MODE_PRIVATE).getBoolean("sound",true); }
    static void toggle(Context context) { context.getSharedPreferences("feedback",Context.MODE_PRIVATE).edit().putBoolean("sound",!enabled(context)).apply(); }
    static void play(Context context,String kind) {
        if(!enabled(context)||SystemClock.elapsedRealtime()-last<100)return;
        AudioManager audio=context.getSystemService(AudioManager.class);
        NotificationManager notices=context.getSystemService(NotificationManager.class);
        if(audio==null||audio.getRingerMode()!=AudioManager.RINGER_MODE_NORMAL||notices.getCurrentInterruptionFilter()!=NotificationManager.INTERRUPTION_FILTER_ALL)return;
        try{
            if(tones==null)tones=new ToneGenerator(AudioManager.STREAM_MUSIC,25);
            last=SystemClock.elapsedRealtime();
            tones.startTone("confirm".equals(kind)?ToneGenerator.TONE_PROP_ACK:"alert".equals(kind)?ToneGenerator.TONE_PROP_BEEP2:ToneGenerator.TONE_PROP_BEEP,"open".equals(kind)?110:55);
        }catch(RuntimeException unavailable){/* Sound never blocks a desk action. */}
    }
    static void stop(){if(tones!=null)tones.stopTone();}
    static void attach(Button button){
        button.setSoundEffectsEnabled(false);
        button.setOnTouchListener((view,event)->{if(event.getAction()==MotionEvent.ACTION_UP&&view.isPressed()&&view.isEnabled())play(view.getContext(),"tap");return false;});
        button.setOnKeyListener((view,key,event)->{if(event.getAction()==KeyEvent.ACTION_UP&&(key==KeyEvent.KEYCODE_ENTER||key==KeyEvent.KEYCODE_DPAD_CENTER)&&view.isEnabled())play(view.getContext(),"tap");return false;});
    }
}
