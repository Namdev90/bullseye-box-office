package in.sharepass.foundation;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.*;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.Button;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Map;
import java.util.HashMap;
import java.util.Collections;
import java.util.regex.Pattern;
import java.util.regex.Matcher;

/** Local-interface hosting pattern adapted from Navrang Gate, MIT (see LICENSES).
 * No Navrang credentials, database, signing identity, runtime or artwork is included.
 */
public final class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START = "https://" + HOST + "/index.html";
    private static final String SHOWCASE = "http://127.0.0.1:8896/";
    private static final String PUBLIC_SHOWCASE = "https://sharepass.example.test/staff";
    private boolean connectedShowcase;
    private WebView web;
    private DeskWindow viewport;
    private AppUpdates updates;
    private final BackRequestGate backGate = new BackRequestGate();
    private AlertDialog exitDialog;

    @Override public void onCreate(Bundle savedState) {
        super.onCreate(savedState);
        if (openQueueFromPush(getIntent())) return;
        if (openSetup(getIntent())) return;
        if ((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0
                && getIntent().getBooleanExtra("nativeDesk", false)) {
            startActivity(new android.content.Intent(this, NativeDeskActivity.class));
            finish();
            return;
        }
        connectedShowcase = (getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0
            && getIntent().getBooleanExtra("connectedShowcase", false);
        boolean debug = (getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        if (!debug || (!connectedShowcase && !getIntent().getBooleanExtra("webPreview", false))) {
            showOpening();
            return;
        }
        try { web = new WebView(this); }
        catch (RuntimeException failure) { showUnavailable(); return; }
        Matcher version = Pattern.compile("Chrome/(\\d+)").matcher(web.getSettings().getUserAgentString());
        if (!version.find() || Integer.parseInt(version.group(1)) < 109) { web.destroy(); web = null; showUnavailable(); return; }
        showSurface(web, 0);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        web.setSaveEnabled(false); web.clearCache(true); web.clearFormData();
        WebView.setWebContentsDebuggingEnabled(false);
        CookieManager.getInstance().setAcceptCookie(false);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (connectedShowcase) return isShowcaseOrigin(request.getUrl()) ? null : blocked();
                return asset(request.getUrl(), request.getMethod());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (request.isForMainFrame() && request.hasGesture() && PUBLIC_SHOWCASE.equals(request.getUrl().toString())) {
                    try { startActivity(new android.content.Intent(android.content.Intent.ACTION_VIEW, Uri.parse(HostedRegisterClient.ORIGIN + "/staff"))); }
                    catch (android.content.ActivityNotFoundException error) {
                        Toast.makeText(MainActivity.this, "A browser is required to open the shared register.", Toast.LENGTH_LONG).show();
                    }
                    return true;
                }
                return blockNavigation(request.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return blockNavigation(Uri.parse(url));
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, android.net.http.SslError error) {
                handler.cancel();
            }
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                web = null; if (view.getParent() instanceof android.view.ViewGroup) ((android.view.ViewGroup)view.getParent()).removeView(view); view.destroy(); backGate.release(); showUnavailable(); return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) { request.deny(); }
            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                callback.invoke(origin, false, false);
            }
            @Override public boolean onShowFileChooser(WebView view, android.webkit.ValueCallback<Uri[]> callback, FileChooserParams params) {
                callback.onReceiveValue(null); return true;
            }
            @Override public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setTitle("Restart practice?")
                    .setMessage("This clears this app's synthetic deposits and collections. It does not affect any real event.")
                    .setPositiveButton("Restart", (dialog, which) -> result.confirm())
                    .setNegativeButton("Keep practicing", (dialog, which) -> result.cancel())
                    .setOnCancelListener(dialog -> result.cancel()).show(); return true;
            }
        });
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }
        web.loadUrl(connectedShowcase ? SHOWCASE : START);
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (!openQueueFromPush(intent)) openSetup(intent);
    }

    private boolean openSetup(Intent intent) {
        Uri incoming = intent.getData();
        if (incoming == null || ("https".equals(incoming.getScheme()) && !"/app-setup".equals(incoming.getEncodedPath()))) return false;
        String invite = HostedRegisterClient.setupInvite(incoming.toString());
        if (invite.isEmpty()) return false;
        startActivity(new Intent(this, HostedDeskActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra("setupInvite", invite));
        finish();
        return true;
    }

    private boolean openQueueFromPush(Intent intent) {
        if (intent.getData() != null || !QueueNotifications.TYPE.equals(intent.getStringExtra("type"))) return false;
        startActivity(QueueNotifications.openQueue(this));
        finish();
        return true;
    }

    private void showOpening() {
        int pad = DeskSurface.dp(this, 16);
        LinearLayout stage = new LinearLayout(this);
        stage.setOrientation(LinearLayout.VERTICAL);
        stage.setGravity(android.view.Gravity.CENTER);
        stage.setPadding(pad, pad, pad, pad);
        TextView masthead = new TextView(this);
        masthead.setText("BULLSEYE ENTERTAINMENT");
        masthead.setTextColor(DeskSurface.BRASS);
        masthead.setTextSize(11);
        masthead.setLetterSpacing(.12f);
        masthead.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        masthead.setGravity(android.view.Gravity.CENTER);
        masthead.setPadding(0, 0, 0, DeskSurface.dp(this, 10));
        stage.addView(masthead, new LinearLayout.LayoutParams(-1, -2));
        ImageView artwork = new ImageView(this) {
            @Override protected void onMeasure(int widthSpec, int heightSpec) {
                int height = DeskGeometry.openingArtHeight(MeasureSpec.getSize(widthSpec), viewport.paneHeight(),
                    DeskSurface.dp(MainActivity.this, 96), DeskSurface.dp(MainActivity.this, 240));
                super.onMeasure(widthSpec, MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY));
            }
        };
        artwork.setContentDescription("SharePass by Bullseye Entertainment");
        artwork.setScaleType(ImageView.ScaleType.FIT_CENTER);
        try (java.io.InputStream image = getAssets().open("assets/sharepass-approved-logo.jpg")) {
            artwork.setImageBitmap(BitmapFactory.decodeStream(image));
        } catch (IOException error) {
            artwork.setContentDescription("SharePass");
        }
        LinearLayout.LayoutParams art = new LinearLayout.LayoutParams(-1, -2);
        stage.addView(artwork, art);
        LinearLayout pass = new LinearLayout(this);
        pass.setOrientation(LinearLayout.VERTICAL);
        pass.setBackground(DeskSurface.panel(this));
        pass.setPadding(DeskSurface.dp(this, 14), DeskSurface.dp(this, 10), DeskSurface.dp(this, 14), DeskSurface.dp(this, 14));
        TextView caption = new TextView(this);
        caption.setText("Staff pass desk");
        caption.setTextColor(DeskSurface.INK);
        caption.setTextSize(19);
        caption.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        caption.setGravity(android.view.Gravity.CENTER_VERTICAL);
        caption.setCompoundDrawablesWithIntrinsicBounds(R.drawable.ic_ticket_layers, 0, 0, 0);
        caption.setCompoundDrawablePadding(DeskSurface.dp(this, 10));
        pass.addView(caption);
        pass.addView(DeskSurface.perforation(this), new LinearLayout.LayoutParams(-1, DeskSurface.dp(this, 12)));
        Button open = new Button(this);
        open.setText("Open register");
        DeskSurface.button(open, true);
        open.setOnClickListener(view -> startActivity(new android.content.Intent(this, HostedDeskActivity.class)));
        LinearLayout.LayoutParams action = new LinearLayout.LayoutParams(-1, -2);
        action.topMargin = DeskSurface.dp(this, 8);
        pass.addView(open, action);
        updates = new AppUpdates(this, () -> true);
        if (updates.isEnabled()) {
            Button updatesButton = new Button(this);
            updatesButton.setText("App updates");
            DeskSurface.button(updatesButton, false);
            updatesButton.setOnClickListener(view -> updates.options());
            pass.addView(updatesButton, new LinearLayout.LayoutParams(-1, -2));
        }
        LinearLayout.LayoutParams passLayout = new LinearLayout.LayoutParams(-1, -2);
        passLayout.topMargin = DeskSurface.dp(this, 12);
        stage.addView(pass, passLayout);
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.addView(stage);
        showSurface(scroll, 560);
        if (Build.VERSION.SDK_INT >= 26 && android.animation.ValueAnimator.areAnimatorsEnabled()) {
            artwork.setAlpha(0f);
            artwork.animate().alpha(1f).setDuration(380).start();
            pass.setTranslationY(DeskSurface.dp(this, 10));
            pass.animate().translationY(0).setDuration(280).start();
        }
    }

    private void showSurface(View content, int maxWidthDp) {
        if (viewport == null) {
            viewport = new DeskWindow(this);
            setContentView(viewport);
        }
        viewport.show(content, maxWidthDp);
    }

    private static boolean isShowcaseOrigin(Uri uri) {
        return "http".equals(uri.getScheme()) && "127.0.0.1:8896".equals(uri.getEncodedAuthority());
    }
    private boolean blockNavigation(Uri uri) {
        if (connectedShowcase) return !isShowcaseOrigin(uri) || !"/".equals(uri.getPath()) || uri.getQuery() != null;
        if (AssetPolicy.isMainDocument(uri.toString())) return false;
        Toast.makeText(this, "External links are disabled in this app foundation.", Toast.LENGTH_SHORT).show();
        return true;
    }
    private WebResourceResponse asset(Uri uri, String method) {
        String relative = AssetPolicy.allowedAsset(uri.toString(), method);
        if (relative == null) return blocked();
        String mime = relative.endsWith(".html") ? "text/html" : relative.endsWith(".css") ? "text/css" :
            relative.endsWith(".js") ? "text/javascript" : relative.endsWith(".png") ? "image/png" : relative.endsWith(".jpg") ? "image/jpeg" : "text/plain";
        try {
            return new WebResourceResponse(mime, "UTF-8", 200, "OK",
                responseHeaders(), getAssets().open(relative));
        } catch (IOException missing) { return blocked(); }
    }
    private Map<String, String> responseHeaders() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store"); headers.put("X-Content-Type-Options", "nosniff");
        return headers;
    }
    private WebResourceResponse blocked() {
        return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
    }
    private void handleBack() {
        if (web == null) { finish(); return; }
        if (!backGate.acquire()) return;
        String back = connectedShowcase
            ? "(() => { if (busy || pending()) { toast('Finish or recover the current action first.'); return true; } const dialog = Array.from(document.querySelectorAll('dialog[open]')).pop(); if (dialog) { if (dialog.dispatchEvent(new Event('cancel', {cancelable:true}))) dialog.close(); return true; } if (location.hash && location.hash !== '#start') { history.back(); return true; } return false; })()"
            : "Boolean(window.SharePassShell && window.SharePassShell.back())";
        web.evaluateJavascript(back, handled -> {
            if (!"true".equals(handled) && !isFinishing() && !isDestroyed()) {
                exitDialog = new AlertDialog.Builder(this).setTitle("Leave practice?")
                    .setMessage(connectedShowcase ? "Synthetic showcase records remain saved on the laptop." :
                        "Closing resets this synthetic session, including any unconfirmed practice handover. No real stock is managed here.")
                    .setPositiveButton("Close practice", (dialog, which) -> finish())
                    .setNegativeButton("Stay", null)
                    .setOnDismissListener(dialog -> { exitDialog = null; backGate.release(); }).show();
            } else { backGate.release(); }
        });
    }
    // API 33+ uses the registered OnBackInvokedCallback above; this override is only the legacy path.
    @android.annotation.SuppressLint("GestureBackNavigation")
    @Override public void onBackPressed() { handleBack(); }
    @Override protected void onPause() {
        if (updates != null) updates.stop();
        if (web != null) web.onPause();
        super.onPause();
    }
    @Override protected void onResume() {
        super.onResume();
        if (updates != null) updates.start();
        if (web != null) web.onResume();
    }
    @Override public void onWindowFocusChanged(boolean focused) {
        super.onWindowFocusChanged(focused);
        if (updates != null) updates.focusChanged(focused);
    }
    @Override public boolean dispatchTouchEvent(android.view.MotionEvent event) {
        if (updates != null && event.getActionMasked() == android.view.MotionEvent.ACTION_DOWN) updates.cancelDownload();
        return super.dispatchTouchEvent(event);
    }
    @Override protected void onDestroy() { if (exitDialog != null) exitDialog.dismiss(); backGate.release(); if (web != null) { web.destroy(); web = null; } super.onDestroy(); }
    private void showUnavailable() {
        TextView notice = new TextView(this); notice.setTextColor(Color.WHITE); notice.setBackgroundColor(Color.rgb(37,37,32));
        notice.setPadding(36,80,36,36); notice.setText("SharePass Foundation could not open.\n\nUpdate Android System WebView / Chrome to version 109 or newer and reopen. This prototype resets its synthetic practice session after a process restart.");
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.addView(notice);
        showSurface(scroll, 560);
    }
}
