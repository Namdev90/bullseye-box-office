package in.sharepass.foundation;

final class HoldGate {
    static final long DURATION=2000;
    private long began;
    private boolean active;
    void start(long now){began=now;active=true;}
    void cancel(){active=false;}
    boolean active(){return active;}
    int progress(long now){return active?(int)Math.max(0,Math.min(DURATION,now-began)):0;}
    boolean finish(long now){if(!active||now-began<DURATION)return false;active=false;return true;}
}
