package in.sharepass.foundation;

import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Canvas;
import android.graphics.DashPathEffect;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.LayerDrawable;
import android.graphics.drawable.RippleDrawable;
import android.graphics.drawable.StateListDrawable;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;

final class DeskSurface {
    static final int INK = 0xfff6f6f7;
    static final int MUTED = 0xffbbbcc3;
    static final int BRASS = 0xffff4458;
    private static final int PAPER = 0xffffffff;
    private static final int ACCENT = 0xffe41638;

    private DeskSurface() {}

    static int dp(Context context, int value) {
        return Math.round(value * context.getResources().getDisplayMetrics().density);
    }

    private static GradientDrawable plate(Context context, int[] colors, int radius, int border) {
        GradientDrawable drawable = new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, colors);
        drawable.setCornerRadius(dp(context, radius));
        if (border != 0) drawable.setStroke(dp(context, 1), border);
        return drawable;
    }

    static Drawable backdrop(Context context) {
        return plate(context, new int[]{0xff030304, 0xff08090b, 0xff101114}, 0, 0);
    }

    static Drawable panel(Context context) {
        return plate(context, new int[]{0xff202126, 0xff141519}, 18, 0xff51535c);
    }

    static Drawable input(Context context) {
        StateListDrawable state = new StateListDrawable();
        int[] inset = {0xff101115, 0xff17181d};
        state.addState(new int[]{android.R.attr.state_focused}, plate(context, inset, 12, ACCENT));
        state.addState(new int[0], plate(context, inset, 12, 0xff565862));
        return state;
    }

    private static Drawable buttonFace(Context context, boolean primary, int edge, boolean pressed) {
        if (!primary) {
            int face = pressed ? 0xffb6bac3 : 0xffe3e5ea;
            return plate(context, new int[]{face, face}, 12, edge);
        }
        int[] colors = pressed ? new int[]{0xffb30929, 0xff83061d} : new int[]{0xfff12647, 0xffbd0c2a};
        LayerDrawable material = new LayerDrawable(new Drawable[]{
            plate(context, new int[]{0xff77031c, 0xff4e0715}, 15, 0),
            plate(context, colors, 14, edge)
        });
        material.setLayerInset(1, 0, dp(context, pressed ? 2 : 0), 0, dp(context, pressed ? 1 : 4));
        return material;
    }

    static void button(Button button, boolean primary) {
        Context context = button.getContext();
        int edge = primary ? 0xff8a0921 : 0xff8d929c;
        StateListDrawable states = new StateListDrawable();
        states.addState(new int[]{android.R.attr.state_pressed}, buttonFace(context, primary, edge, true));
        states.addState(new int[]{android.R.attr.state_focused}, buttonFace(context, primary, ACCENT, false));
        if (!primary) states.addState(new int[]{android.R.attr.state_selected},
            plate(context, new int[]{0xfffafbfc, 0xffc8cbd3}, 12, ACCENT));
        states.addState(new int[0], buttonFace(context, primary, edge, false));
        button.setBackgroundTintList(null);
        button.setBackground(new RippleDrawable(ColorStateList.valueOf(primary ? 0x33fff0d9 : 0x1f871e35), states, null));
        button.setAllCaps(false);
        button.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        button.setTextColor(primary ? PAPER : 0xff17181c);
        button.setTextSize(16);
        button.setGravity(Gravity.CENTER);
        button.setMinHeight(dp(context, primary ? 54 : 48));
        button.setPadding(dp(context, 12), dp(context, primary ? 10 : 8), dp(context, 12), dp(context, primary ? 13 : 8));
    }

    static void roundButton(Button button) {
        Context context = button.getContext();
        StateListDrawable states = new StateListDrawable();
        int[] face = {0xffe9ebf0, 0xffbec3cd};
        states.addState(new int[]{android.R.attr.state_focused}, plate(context, face, 24, ACCENT));
        states.addState(new int[0], plate(context, face, 24, 0xff8d929c));
        button.setBackgroundTintList(null);
        button.setBackground(new RippleDrawable(ColorStateList.valueOf(0x1f871e35), states, null));
        button.setTextColor(0xff17181c);
        button.setTextSize(18);
        button.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        button.setGravity(Gravity.CENTER);
        button.setMinWidth(0);
        button.setMinHeight(0);
        button.setPadding(0, 0, 0, 0);
    }

    static View perforation(Context context) {
        View divider = new View(context) {
            final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
            {
                paint.setColor(0xff484b55);
                paint.setStrokeWidth(dp(context, 1));
                paint.setPathEffect(new DashPathEffect(new float[]{dp(context, 3), dp(context, 5)}, 0));
            }
            @Override protected void onDraw(Canvas canvas) {
                canvas.drawLine(0, getHeight() * .5f, getWidth(), getHeight() * .5f, paint);
            }
        };
        divider.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        return divider;
    }
}
