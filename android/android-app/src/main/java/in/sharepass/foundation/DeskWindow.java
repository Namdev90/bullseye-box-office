package in.sharepass.foundation;

import android.app.Activity;
import android.graphics.Insets;
import android.graphics.Rect;
import android.os.Build;
import android.view.DisplayCutout;
import android.view.RoundedCorner;
import android.view.View;
import android.view.WindowInsets;
import android.widget.FrameLayout;
import androidx.core.util.Consumer;
import androidx.window.java.layout.WindowInfoTrackerCallbackAdapter;
import androidx.window.layout.DisplayFeature;
import androidx.window.layout.FoldingFeature;
import androidx.window.layout.WindowInfoTracker;
import androidx.window.layout.WindowLayoutInfo;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

final class DeskWindow extends FrameLayout {
    private final Activity activity;
    private final WindowInfoTrackerCallbackAdapter tracker;
    private final Consumer<WindowLayoutInfo> layoutListener = this::updateFolds;
    private final int[] location = new int[2];
    private List<FoldingFeature> folds = Collections.emptyList();
    private WindowInsets windowInsets;
    private int maxWidth = Integer.MAX_VALUE;
    private int paneHeight;

    DeskWindow(Activity activity) {
        super(activity);
        this.activity = activity;
        tracker = new WindowInfoTrackerCallbackAdapter(WindowInfoTracker.getOrCreate(activity));
        setBackground(DeskSurface.backdrop(activity));
        setOnApplyWindowInsetsListener((view, insets) -> {
            windowInsets = insets;
            requestLayout();
            return Build.VERSION.SDK_INT >= 30 ? WindowInsets.CONSUMED : consumeLegacyInsets(insets);
        });
    }

    void show(View page, int maxWidthDp) {
        maxWidth = maxWidthDp == 0 ? Integer.MAX_VALUE : DeskSurface.dp(activity, maxWidthDp);
        removeAllViews();
        addView(page, new FrameLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT));
    }

    int paneHeight() { return paneHeight; }

    boolean contains(float x, float y) {
        int left = getPaddingLeft(), right = getPaddingRight();
        if (Build.VERSION.SDK_INT >= 30 && windowInsets != null) {
            Insets gestures = windowInsets.getInsets(WindowInsets.Type.systemGestures());
            left = Math.max(left, gestures.left);
            right = Math.max(right, gestures.right);
        }
        return x >= location[0] + left && x < location[0] + getWidth() - right
            && y >= location[1] + getPaddingTop() && y < location[1] + getHeight() - getPaddingBottom();
    }

    @Override protected void onAttachedToWindow() {
        super.onAttachedToWindow();
        requestApplyInsets();
        tracker.addWindowLayoutInfoListener(activity, activity::runOnUiThread, layoutListener);
    }

    @Override protected void onDetachedFromWindow() {
        tracker.removeWindowLayoutInfoListener(layoutListener);
        folds = Collections.emptyList();
        super.onDetachedFromWindow();
    }

    private void updateFolds(WindowLayoutInfo info) {
        if (!isAttachedToWindow()) return;
        List<FoldingFeature> separating = new ArrayList<>();
        for (DisplayFeature feature : info.getDisplayFeatures()) {
            if (feature instanceof FoldingFeature fold
                    && (fold.isSeparating() || fold.getOcclusionType() == FoldingFeature.OcclusionType.FULL)) {
                separating.add(fold);
            }
        }
        if (!folds.equals(separating)) {
            folds = separating;
            requestLayout();
        }
    }

    @Override protected void onMeasure(int widthSpec, int heightSpec) {
        int width = MeasureSpec.getSize(widthSpec);
        int height = MeasureSpec.getSize(heightSpec);
        List<DeskGeometry.Fold> localFolds = new ArrayList<>();
        for (FoldingFeature fold : folds) {
            Rect bounds = fold.getBounds();
            localFolds.add(new DeskGeometry.Fold(new DeskGeometry.Area(bounds.left - location[0], bounds.top - location[1],
                bounds.right - location[0], bounds.bottom - location[1]), fold.getOrientation() == FoldingFeature.Orientation.VERTICAL));
        }
        DeskGeometry.Area pane = DeskGeometry.viewport(width, height, insets(height), localFolds, maxWidth);
        paneHeight = pane.height();
        int right = width - pane.right();
        int bottom = height - pane.bottom();
        if (getPaddingLeft() != pane.left() || getPaddingTop() != pane.top()
                || getPaddingRight() != right || getPaddingBottom() != bottom) {
            setPadding(pane.left(), pane.top(), right, bottom);
        }
        super.onMeasure(widthSpec, heightSpec);
    }

    @Override protected void onLayout(boolean changed, int left, int top, int right, int bottom) {
        super.onLayout(changed, left, top, right, bottom);
        int lastX = location[0], lastY = location[1];
        getLocationInWindow(location);
        if (location[0] != lastX || location[1] != lastY) {
            if (!folds.isEmpty() || Build.VERSION.SDK_INT >= 31) requestLayout();
        }
    }

    @SuppressWarnings("deprecation")
    private static WindowInsets consumeLegacyInsets(WindowInsets insets) {
        return insets.consumeSystemWindowInsets();
    }

    @SuppressWarnings("deprecation")
    private DeskGeometry.Area insets(int height) {
        WindowInsets current = windowInsets;
        if (current == null) return new DeskGeometry.Area(0, 0, 0, 0);
        int left = current.getSystemWindowInsetLeft(), top = current.getSystemWindowInsetTop();
        int right = current.getSystemWindowInsetRight(), bottom = current.getSystemWindowInsetBottom();
        if (Build.VERSION.SDK_INT >= 28) {
            DisplayCutout cutout = current.getDisplayCutout();
            if (cutout != null) {
                left = Math.max(left, cutout.getSafeInsetLeft());
                top = Math.max(top, cutout.getSafeInsetTop());
                right = Math.max(right, cutout.getSafeInsetRight());
                bottom = Math.max(bottom, cutout.getSafeInsetBottom());
                if (Build.VERSION.SDK_INT >= 30) {
                    Insets curved = cutout.getWaterfallInsets();
                    left = Math.max(left, curved.left);
                    top = Math.max(top, curved.top);
                    right = Math.max(right, curved.right);
                    bottom = Math.max(bottom, curved.bottom);
                }
            }
        }
        if (Build.VERSION.SDK_INT >= 30) {
            Insets safe = current.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
            left = Math.max(left, safe.left);
            top = Math.max(top, safe.top);
            right = Math.max(right, safe.right);
            bottom = Math.max(bottom, safe.bottom);
        }
        if (Build.VERSION.SDK_INT >= 31) {
            for (int position : new int[]{RoundedCorner.POSITION_TOP_LEFT, RoundedCorner.POSITION_TOP_RIGHT}) {
                RoundedCorner corner = current.getRoundedCorner(position);
                if (corner != null) top = Math.max(top, corner.getCenter().y - location[1]);
            }
            for (int position : new int[]{RoundedCorner.POSITION_BOTTOM_LEFT, RoundedCorner.POSITION_BOTTOM_RIGHT}) {
                RoundedCorner corner = current.getRoundedCorner(position);
                if (corner != null) bottom = Math.max(bottom, height + location[1] - corner.getCenter().y);
            }
        }
        return new DeskGeometry.Area(left, top, right, bottom);
    }
}
