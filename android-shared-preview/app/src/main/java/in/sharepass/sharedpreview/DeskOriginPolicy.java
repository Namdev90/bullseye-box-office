package in.sharepass.sharedpreview;
import java.net.URI;
import java.net.URISyntaxException;

/** Exact emulator loopback alias. No LAN, remote URLs, query-redirects, or web browsing. */
final class DeskOriginPolicy {
    static final String BASE = "http://10.0.2.2:8765/";
    static boolean allowedOrigin(String url) {
        if (url == null) return false;
        try {
            URI u = new URI(url);
            return "http".equals(u.getScheme()) && "10.0.2.2".equals(u.getHost())
                && u.getPort() == 8765 && u.getRawUserInfo() == null && !u.isOpaque()
                && u.getRawPath() != null && !u.getRawPath().contains("\\")
                && !u.getRawPath().contains("%") && u.getPath().startsWith("/");
        } catch (URISyntaxException invalid) { return false; }
    }
    static boolean allowedRequest(String url, String method) {
        // WebView intercepts fetch POSTs too. Preserve the exact origin boundary.
        return allowedOrigin(url) && ("GET".equals(method) || "POST".equals(method));
    }
    static boolean allowedNavigation(String url) {
        if (!allowedOrigin(url)) return false;
        try { return "/".equals(new URI(url).getPath()); }
        catch (URISyntaxException invalid) { return false; }
    }
}
