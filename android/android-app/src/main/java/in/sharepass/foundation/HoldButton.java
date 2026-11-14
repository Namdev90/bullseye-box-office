package in.sharepass.foundation;

import android.graphics.drawable.ClipDrawable;
import android.graphics.drawable.ColorDrawable;
import android.os.Handler;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityManager;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.Button;
import java.util.function.Consumer;
import java.util.function.Supplier;

final class HoldButton {
    private final Button button;
    private final Handler handler;
    private final Supplier<String> state;
    private final Runnable confirmed;
    private final Consumer<String> error;
    private final HoldGate gate=new HoldGate();
    private final ClipDrawable progress=new ClipDrawable(new ColorDrawable(0x33ffffff),Gravity.LEFT,ClipDrawable.HORIZONTAL);
    private String snapshot;
    private final Runnable tick=this::tick;

    @android.annotation.SuppressLint("ClickableViewAccessibility")
    HoldButton(Button button,Handler handler,Supplier<String> state,Runnable confirmed,Consumer<String> error){
        this.button=button;this.handler=handler;this.state=state;this.confirmed=confirmed;this.error=error;
        button.setForeground(progress);button.setClipToOutline(true);
        button.setOnClickListener(view->{});
        button.setOnTouchListener((view,event)->{
            int action=event.getActionMasked();
            if(event.getPointerCount()!=1){cancel();return true;}
            if(action==MotionEvent.ACTION_DOWN)start();
            else if(action==MotionEvent.ACTION_MOVE&&!inside(event))cancel();
            else if(action==MotionEvent.ACTION_UP){if(inside(event))finish();cancel();}
            else if(action==MotionEvent.ACTION_CANCEL)cancel();
            return true;
        });
        button.setOnKeyListener((view,key,event)->{
            if(key==KeyEvent.KEYCODE_ESCAPE){cancel();return true;}
            if(key!=KeyEvent.KEYCODE_ENTER&&key!=KeyEvent.KEYCODE_SPACE&&key!=KeyEvent.KEYCODE_DPAD_CENTER)return false;
            if(event.getAction()==KeyEvent.ACTION_DOWN&&event.getRepeatCount()==0)start();
            else if(event.getAction()==KeyEvent.ACTION_UP){finish();cancel();}
            return true;
        });
        button.setOnFocusChangeListener((view,focused)->{if(!focused)cancel();});
        button.setAccessibilityDelegate(new View.AccessibilityDelegate(){
            @Override public void onInitializeAccessibilityNodeInfo(View host,AccessibilityNodeInfo info){
                super.onInitializeAccessibilityNodeInfo(host,info);
                info.addAction(new AccessibilityNodeInfo.AccessibilityAction(AccessibilityNodeInfo.ACTION_CLICK,"Start two-second confirmation; activate again to cancel"));
            }
            @Override public boolean performAccessibilityAction(View host,int action,android.os.Bundle arguments){
                AccessibilityManager access=host.getContext().getSystemService(AccessibilityManager.class);
                if((action==AccessibilityNodeInfo.ACTION_CLICK||action==AccessibilityNodeInfo.ACTION_LONG_CLICK)&&access!=null&&access.isEnabled()){start();return true;}
                return super.performAccessibilityAction(host,action,arguments);
            }
            @Override public void sendAccessibilityEvent(View host,int type){
                if(type==AccessibilityEvent.TYPE_VIEW_ACCESSIBILITY_FOCUS_CLEARED)cancel();
                super.sendAccessibilityEvent(host,type);
            }
        });
    }
    private boolean inside(MotionEvent event){return event.getX()>=0&&event.getX()<=button.getWidth()&&event.getY()>=0&&event.getY()<=button.getHeight();}
    private boolean valid(){return button.isEnabled()&&button.isShown()&&button.hasWindowFocus()&&snapshot.equals(state.get());}
    private void start(){
        if(gate.active()){cancel();return;}
        if(!button.isEnabled()||!button.isShown()||!button.hasWindowFocus())return;
        try{snapshot=state.get();}catch(RuntimeException invalid){error.accept(invalid.getMessage());return;}
        gate.start(SystemClock.elapsedRealtime());button.setPressed(true);progress.setLevel(0);DeskSounds.play(button.getContext(),"tap");
        button.announceForAccessibility("Confirming in two seconds. Release, move away or activate again to cancel.");handler.postDelayed(tick,40);
    }
    private void tick(){
        if(!gate.active())return;
        try{if(!valid()){cancel();return;}}catch(RuntimeException invalid){cancel();return;}
        progress.setLevel(gate.progress(SystemClock.elapsedRealtime())*5);
        if(gate.progress(SystemClock.elapsedRealtime())>=HoldGate.DURATION)finish();else handler.postDelayed(tick,40);
    }
    private void finish(){
        if(!gate.active())return;
        try{if(!valid()){cancel();return;}}catch(RuntimeException invalid){cancel();return;}
        if(!gate.finish(SystemClock.elapsedRealtime()))return;
        handler.removeCallbacks(tick);progress.setLevel(0);button.setPressed(false);confirmed.run();
    }
    void cancel(){gate.cancel();handler.removeCallbacks(tick);progress.setLevel(0);button.setPressed(false);}
}
