package in.sharepass.foundation;

import android.content.Context;
import android.graphics.Color;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.function.IntSupplier;

final class QrPreview {
    // Packaged bytes stay immutable until an app update restarts the process.
    private static String cachedEncoder;
    private static String encoderSource(Context context) throws Exception {
        if(cachedEncoder!=null)return cachedEncoder;
        try(InputStream in=context.getAssets().open("vendor/sharepass-qr.js")){
            ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buffer=new byte[4096];
            for(int n;(n=in.read(buffer))!=-1;)out.write(buffer,0,n);
            cachedEncoder=out.toString("UTF-8");return cachedEncoder;
        }
    }
    static WebView create(Context context, String value, String label) throws Exception {
        return create(context, value, label, null);
    }

    static WebView create(Context context, String value, String label, IntSupplier viewportHeight) throws Exception {
        String encoder=encoderSource(context);
        WebView qr = viewportHeight == null ? new WebView(context) : new WebView(context) {
            @Override protected void onMeasure(int widthSpec, int heightSpec) {
                int maxSize = DeskSurface.dp(context, 350);
                int width = MeasureSpec.getMode(widthSpec) == MeasureSpec.UNSPECIFIED ? maxSize : MeasureSpec.getSize(widthSpec);
                int side = DeskGeometry.qrSize(width, viewportHeight.getAsInt(), maxSize);
                int square = MeasureSpec.makeMeasureSpec(side, MeasureSpec.EXACTLY);
                super.onMeasure(square, square);
            }
        };
        qr.setContentDescription(label);
        qr.setBackgroundColor(Color.WHITE);
        android.graphics.drawable.GradientDrawable frame=new android.graphics.drawable.GradientDrawable();frame.setColor(Color.WHITE);frame.setCornerRadius(DeskSurface.dp(context,14));qr.setBackground(frame);qr.setClipToOutline(true);
        qr.getSettings().setJavaScriptEnabled(true);
        qr.getSettings().setAllowFileAccess(false);
        qr.getSettings().setAllowContentAccess(false);
        qr.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream(new byte[0]));
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return true;
            }
        });
        String valueJs = JSONObject.quote(value).replace("<", "\\u003c");
        String html = "<html><head><meta name='viewport' content='width=device-width,initial-scale=1'>" +
            "<meta http-equiv='Content-Security-Policy' content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'\"></head>" +
            "<body style='margin:0;background:white'><div id='qr'></div><script>" + encoder +
            ";const m=SharePassQR.matrix(" + valueJs + ");const n=m.length+8;let p='';" +
            "m.forEach((r,y)=>r.forEach((v,x)=>{if(v)p+='M'+(x+4)+' '+(y+4)+'h1v1h-1z'}));" +
            "document.getElementById('qr').innerHTML='<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 '+n+' '+n+'\" shape-rendering=\"crispEdges\">" +
            "<rect width=\"100%\" height=\"100%\" fill=\"white\"/><path d=\"'+p+'\" fill=\"black\"/></svg>';</script></body></html>";
        qr.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
        return qr;
    }
}
