package in.sharepass.foundation;

import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.os.Build;
import android.view.View;
import android.view.animation.DecelerateInterpolator;
import java.io.InputStream;

/** Displays the approved artwork bytes; the opening movement settles to the complete image. */
class BrandArtwork extends View {
    private static Bitmap artwork;
    private final boolean header;
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
    private float progress = 1f;
    private ValueAnimator animation;

    BrandArtwork(Context context, boolean header) {
        super(context);
        this.header = header;
        setContentDescription(header ? "Bullseye Entertainment brings you SharePass" : "SharePass by Bullseye Entertainment");
        if (artwork == null) {
            try (InputStream source = context.getAssets().open("assets/sharepass-approved-logo.jpg")) {
                artwork = BitmapFactory.decodeStream(source);
            } catch (Exception unavailable) { /* The accessible brand name remains available. */ }
        }
    }

    void animateOpening() {
        if (header || Build.VERSION.SDK_INT < 26 || !ValueAnimator.areAnimatorsEnabled()) return;
        animation = ValueAnimator.ofFloat(0f, 1f);
        animation.setDuration(1200);
        animation.setInterpolator(new DecelerateInterpolator());
        animation.addUpdateListener(value -> { progress = (float) value.getAnimatedValue(); invalidate(); });
        animation.start();
    }

    @Override protected void onDraw(Canvas canvas) {
        super.onDraw(canvas);
        if (artwork == null) return;
        if (header) {
            float density=getResources().getDisplayMetrics().density;
            float width=Math.min(154*density,getWidth()*.46f),height=width*42/154;
            // Use the same approved-art crop and wordmark treatment as the web brand rail.
            canvas.drawBitmap(artwork,new Rect(Math.round(artwork.getWidth()*86/326f),Math.round(artwork.getHeight()*4/326f),
                Math.round(artwork.getWidth()*240/326f),Math.round(artwork.getHeight()*46/326f)),
                new RectF(16*density,(getHeight()-height)/2,16*density+width,(getHeight()+height)/2),paint);
            paint.setTypeface(Typeface.create("sans-serif-black",Typeface.BOLD_ITALIC));paint.setTextSize(22*density);
            float x=getWidth()-16*density-paint.measureText("SharePass");
            float y=(getHeight()-paint.ascent()-paint.descent())/2;
            paint.setColor(0xffe0e2e8);canvas.drawText("Share",x,y,paint);
            x+=paint.measureText("Share");paint.setColor(0xfff01840);canvas.drawText("Pass",x,y,paint);
            return;
        }
        float side = Math.min(getWidth(), getHeight());
        float left = (getWidth() - side) / 2f, top = (getHeight() - side) / 2f;
        float[] edges = {0, .195f, .725f, 1};
        for (int part = 0; part < 3; part++) {
            float start = edges[part], end = edges[part + 1];
            int sourceTop = Math.round(artwork.getHeight() * start);
            int sourceBottom = part == 2 ? artwork.getHeight() : Math.round(artwork.getHeight() * end);
            float offset = (1 - progress) * (part == 1 ? -20 : 12) * getResources().getDisplayMetrics().density;
            paint.setAlpha(Math.round(255 * (.35f + .65f * progress)));
            canvas.drawBitmap(artwork, new Rect(0, sourceTop, artwork.getWidth(), sourceBottom),
                new RectF(left + offset, top + side * start, left + side + offset, top + side * end), paint);
        }
        paint.setAlpha(255);
    }

    @Override protected void onDetachedFromWindow() {
        if (animation != null) animation.cancel();
        super.onDetachedFromWindow();
    }
}
