package in.sharepass.foundation;
public final class AssetPolicyTest {
 static int checks;
 static void check(boolean result,String message) { checks++; if(!result)throw new AssertionError(message); }
 public static void main(String[] args) {
  String base="https://appassets.androidplatform.net";
  for(String path:new String[]{"app-shell.js","app.js","assets/bullseye-entertainment.jpg","assets/sharepass-approved-logo.jpg","assets/sharepass-handoff.png","brand-palette.css","demo-store.js","desk-enhancements.js","flow.css","index.html","interaction-audio.js","material-theme.css","share-drafts.js","style.css","tactile.css","vendor/QR-LICENSE.txt","vendor/QR-SOURCES.md","vendor/sharepass-qr.js"})check(path.equals(AssetPolicy.allowedAsset(base+"/"+path+"?v=1","GET")),path);
  for(String url:new String[]{"http://appassets.androidplatform.net/index.html","https://appassets.androidplatform.net.evil.test/index.html","https://user@appassets.androidplatform.net/index.html",base+":443/index.html",base+"/../index.html",base+"/%69ndex.html",base+"//index.html",base+"/unknown.js","file:///android_asset/index.html","data:text/html,hello","javascript:alert(1)","https://wa.me/?text=demo","not a URL",null})check(AssetPolicy.allowedAsset(url,"GET")==null,"blocked "+url);
  check(AssetPolicy.allowedAsset(base+"/index.html","POST")==null,"POST blocked");
  check(AssetPolicy.isMainDocument(base+"/index.html#desk"),"hash navigation works");
  check(!AssetPolicy.isMainDocument(base+"/app.js"),"asset cannot become main document");
  System.out.println(checks+" native asset-policy checks passed");
 }
}
