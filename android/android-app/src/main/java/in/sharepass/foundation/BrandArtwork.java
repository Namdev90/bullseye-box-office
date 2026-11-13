package in.sharepass.foundation;

import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.RectF;
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
            int bottom = Math.round(artwork.getHeight() * .195f);
            float width = Math.min(getWidth() * .60f, getHeight() * artwork.getWidth() / (float) bottom);
            float left = 0;
            canvas.drawBitmap(artwork, new Rect(0, 0, artwork.getWidth(), bottom),
                new RectF(left, 0, left + width, getHeight()), paint);
            canvas.drawBitmap(artwork,new Rect(0,Math.round(artwork.getHeight()*.73f),artwork.getWidth(),Math.round(artwork.getHeight()*.96f)),
                new RectF(getWidth()*.64f,getHeight()*.18f,getWidth(),getHeight()*.82f),paint);
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
