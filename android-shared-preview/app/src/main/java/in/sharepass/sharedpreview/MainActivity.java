package in.sharepass.sharedpreview;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Build;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;
import android.webkit.CookieManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.SslErrorHandler;
import android.webkit.RenderProcessGoneDetail;
import android.widget.TextView;
import android.widget.FrameLayout;
import android.widget.Toast;
import java.io.ByteArrayInputStream;
import java.util.Collections;

/** Debug-only view of the existing Python/SQLite custody desk.
  * Android emulator 10.0.2.2:8765 shares the same local database as desktop 127.0.0.1:8765.
  * This is NOT usable on a physical phone or public network, and is not staff authentication.
  */
public final class MainActivity extends Activity {
    private WebView web;
    private boolean backPending;
    private OnBackInvokedCallback backCallback;
    private boolean errorShown;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        FrameLayout frame = new FrameLayout(this);
        frame.addView(web, new FrameLayout.LayoutParams(-1,-1));
        frame.setOnApplyWindowInsetsListener((v,insets)-> {
            v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        setContentView(frame); frame.requestApplyInsets();
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true); // Original-tab interrupted mutations need sessionStorage.
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setSupportMultipleWindows(false);
        web.setSaveEnabled(false);
        WebView.setWebContentsDebuggingEnabled(false);
        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true); // Python issues a same-site HttpOnly local custody session cookie.
        cm.setAcceptThirdPartyCookies(web,false);
        if (Build.VERSION.SDK_INT >= 26) s.setSafeBrowsingEnabled(true);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r) {
                return restrictNavigation(r.getUrl().toString());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView v,String url) {
                return restrictNavigation(url);
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest r) {
                if (DeskOriginPolicy.allowedRequest(r.getUrl().toString(), r.getMethod())) return null;
                // Other origins and methods remain blocked; server CSRF/session checks still apply.
                return new WebResourceResponse("text/plain","UTF-8",403,"Blocked",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));
            }
            @Override public void onReceivedSslError(WebView v,SslErrorHandler h,android.net.http.SslError e) { h.cancel(); }
            @Override public boolean onRenderProcessGone(WebView v,RenderProcessGoneDetail d) {
                web=null;v.destroy(); showUnavailable("Android WebView stopped unexpectedly. Inspect the last pending handover on the Python desk.");return true;
            }
            @Override public void onReceivedError(WebView v,WebResourceRequest r,android.webkit.WebResourceError e) {
                if (r.isForMainFrame() && !errorShown) {
                    errorShown=true;
                    new AlertDialog.Builder(MainActivity.this).setTitle("Python desk unavailable")
                        .setMessage("Start the Python server on your laptop with --android-emulator, then retry. This Android preview works ONLY in an Android emulator. Never release stock while disconnected.")
                        .setPositiveButton("Retry",(dialog,which)-> { errorShown=false; if(web!=null)web.loadUrl(DeskOriginPolicy.BASE); })
                        .setNegativeButton("Close",(dialog,which)->finish()).show();
                }
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(android.webkit.PermissionRequest request) { request.deny(); }
            @Override public void onGeolocationPermissionsShowPrompt(String origin, android.webkit.GeolocationPermissions.Callback callback) { callback.invoke(origin,false,false); }
            @Override public boolean onShowFileChooser(WebView v, android.webkit.ValueCallback<android.net.Uri[]> callback,FileChooserParams params) { callback.onReceiveValue(null);return true; }
        });
        if (Build.VERSION.SDK_INT >= 33) {
            backCallback = this::handleBack;
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                OnBackInvokedDispatcher.PRIORITY_DEFAULT, backCallback);
        }
        web.loadUrl(DeskOriginPolicy.BASE);
    }
    private boolean restrictNavigation(String url) {
        if (DeskOriginPolicy.allowedNavigation(url)) return false;
        Toast.makeText(this,"Only your local SharePass desk is accessible.",Toast.LENGTH_SHORT).show();return true;
    }
    private void handleBack() {
        if (web==null) {finish();return;}
        if (backPending) return;
        backPending=true;
        web.evaluateJavascript("Boolean(window.SharePassLocalBridge && window.SharePassLocalBridge.back())",result->{
            backPending=false;
            if(!"true".equals(result)&&!isFinishing()) new AlertDialog.Builder(this)
                .setTitle("Close SharePass desk?")
                .setMessage("The shared demo database remains on your laptop. Pending physical handovers must be reconciled by the original operator.")
                .setPositiveButton("Close",(d,w)->finish()).setNegativeButton("Stay",null).show();
        });
    }
    @Override public void onBackPressed(){handleBack();}
    @Override protected void onPause(){if(web!=null)web.onPause();super.onPause();}
    @Override protected void onResume(){super.onResume();if(web!=null)web.onResume();}
    @Override protected void onDestroy(){
        if (Build.VERSION.SDK_INT >= 33 && backCallback != null) {
            getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(backCallback);
            backCallback = null;
        }
        if(web!=null){web.destroy();web=null;}
        super.onDestroy();
    }
    private void showUnavailable(String message){TextView text=new TextView(this);text.setTextColor(Color.WHITE);text.setBackgroundColor(Color.rgb(18,9,14));text.setPadding(30,65,30,30);text.setText(message);setContentView(text);}
}
