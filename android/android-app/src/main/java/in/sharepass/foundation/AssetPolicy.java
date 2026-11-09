package in.sharepass.foundation;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
/** Pure policy shared by the native host and executable JVM regression checks. */
final class AssetPolicy {
 private static final Set<String> ASSETS = new HashSet<>(Arrays.asList("app-shell.js", "app.js", "assets/bullseye-entertainment.jpg", "assets/sharepass-approved-logo.jpg", "assets/sharepass-handoff.png", "brand-palette.css", "demo-store.js", "desk-enhancements.js", "flow.css", "index.html", "interaction-audio.js", "material-theme.css", "share-drafts.js", "style.css", "tactile.css", "vendor/QR-LICENSE.txt", "vendor/QR-SOURCES.md", "vendor/sharepass-qr.js"));
 static String allowedAsset(String url, String method) {
  if (url == null || !"GET".equals(method)) return null;
  try {
   URI u = new URI(url);
   if (!"https".equals(u.getScheme()) || !"appassets.androidplatform.net".equals(u.getHost()) || u.getPort() != -1 || u.getRawUserInfo() != null) return null;
   String path = u.getPath();
   if (path == null || !path.startsWith("/") || !path.equals(u.getRawPath())) return null;
   String asset = path.substring(1);
   return ASSETS.contains(asset) ? asset : null;
  } catch (URISyntaxException invalid) { return null; }
 }
 static boolean isMainDocument(String url) { return "index.html".equals(allowedAsset(url,"GET")); }
}
