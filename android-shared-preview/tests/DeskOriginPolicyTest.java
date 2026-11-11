package in.sharepass.sharedpreview;
public final class DeskOriginPolicyTest {
    static void yes(String s) { if(!DeskOriginPolicy.allowedOrigin(s))throw new AssertionError("should accept: "+s); }
    static void no(String s) { if(DeskOriginPolicy.allowedOrigin(s))throw new AssertionError("should reject: "+s); }
    public static void main(String[] args) {
        yes("http://10.0.2.2:8765/"); yes("http://10.0.2.2:8765/api/state?event_id=training-event-001");
        no("http://10.0.2.2:8766/");no("http://10.0.2.3:8765/");no("http://127.0.0.1:8765/");
        no("https://10.0.2.2:8765/");no("http://10.0.2.2:8765.evil.test/");no("http://admin@10.0.2.2:8765/");
        no("http://10.0.2.2:8765/%2f%2fevil");no("http://10.0.2.2:8765/..%2fprivate");
        no("https://example.com/");no("javascript:alert(1)");no("file:///etc/passwd");
        if(!DeskOriginPolicy.allowedNavigation("http://10.0.2.2:8765/"))throw new AssertionError("main document");
        if(DeskOriginPolicy.allowedNavigation("http://10.0.2.2:8765/api/state"))throw new AssertionError("blocked navigation");
        for (String path : new String[]{"/api/verify", "/api/deposits", "/api/deposits/d/release", "/api/collections/c/handover"}) {
            if (!DeskOriginPolicy.allowedRequest(DeskOriginPolicy.BASE.substring(0, DeskOriginPolicy.BASE.length()-1) + path, "POST"))
                throw new AssertionError("required POST blocked: " + path);
        }
        for (String method : new String[]{"GET", "POST"}) {
            if (DeskOriginPolicy.allowedRequest("https://example.com/api/deposits", method))
                throw new AssertionError("external request");
        }
        for (String method : new String[]{"PUT", "DELETE", "PATCH", "OPTIONS", "", null}) {
            if (DeskOriginPolicy.allowedRequest(DeskOriginPolicy.BASE, method))
                throw new AssertionError("unsupported method");
        }
        System.out.println("PASS: exact emulator origin + navigation allowlist");
    }
}
