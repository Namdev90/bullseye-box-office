package in.sharepass.foundation;
public final class HoldGateTest{
    public static void main(String[] args){
        HoldGate gate=new HoldGate();gate.start(0);
        if(gate.finish(1999)||gate.progress(1999)!=1999)throw new AssertionError("Short hold accepted");
        if(!gate.finish(2000)||gate.finish(2001))throw new AssertionError("Hold must complete exactly once");
        gate.start(3000);gate.cancel();if(gate.finish(9000)||gate.active())throw new AssertionError("Cancelled hold accepted");
        gate.start(10000);if(gate.finish(9000)||gate.progress(9000)!=0)throw new AssertionError("Stale clock accepted");
        if(!gate.finish(12000))throw new AssertionError("New hold did not complete");
        System.out.println("PASS two-second hold boundary, cancellation, restart and duplicate completion guards");
    }
}
