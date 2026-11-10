package in.sharepass.foundation;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

final class DeskGeometry {
    record Area(int left, int top, int right, int bottom) {
        int width() { return right - left; }
        int height() { return bottom - top; }
        long size() { return (long) width() * height(); }
    }

    record Fold(Area bounds, boolean vertical) {}

    private DeskGeometry() {}

    static Area viewport(int width, int height, Area insets, List<Fold> folds, int maxWidth) {
        int left = Math.min(width, insets.left());
        int top = Math.min(height, insets.top());
        Area safe = new Area(left, top, Math.max(left, width - insets.right()), Math.max(top, height - insets.bottom()));
        List<Area> panes = Collections.singletonList(safe);
        for (Fold fold : folds) {
            Area edge = fold.bounds();
            List<Area> split = new ArrayList<>();
            for (Area pane : panes) {
                if (fold.vertical() && edge.left() < pane.right() && edge.right() > pane.left()
                        && edge.top() < pane.bottom() && edge.bottom() > pane.top()) {
                    if (edge.left() > pane.left()) split.add(new Area(pane.left(), pane.top(), edge.left(), pane.bottom()));
                    if (edge.right() < pane.right()) split.add(new Area(edge.right(), pane.top(), pane.right(), pane.bottom()));
                } else if (!fold.vertical() && edge.top() < pane.bottom() && edge.bottom() > pane.top()
                        && edge.left() < pane.right() && edge.right() > pane.left()) {
                    if (edge.top() > pane.top()) split.add(new Area(pane.left(), pane.top(), pane.right(), edge.top()));
                    if (edge.bottom() < pane.bottom()) split.add(new Area(pane.left(), edge.bottom(), pane.right(), pane.bottom()));
                } else {
                    split.add(pane);
                }
            }
            panes = split;
        }
        Area largest = new Area(left, top, left, top);
        for (Area pane : panes) {
            if (pane.size() > largest.size()) largest = pane;
        }
        int inset = Math.max(0, (largest.width() - maxWidth) / 2);
        return new Area(largest.left() + inset, largest.top(),
            largest.left() + inset + Math.min(largest.width(), maxWidth), largest.bottom());
    }

    static int qrSize(int availableWidth, int availableHeight, int maxSize) {
        return Math.max(0, Math.min(maxSize, Math.min(availableWidth, availableHeight)));
    }

    static int keypadColumns(int width, int targetWidth, int preferredColumns) {
        return Math.max(1, Math.min(preferredColumns, width / targetWidth));
    }

    static int keypadSlot(int keyIndex, int columns) {
        return columns == 3 && keyIndex >= 9 ? keyIndex + 1 : keyIndex;
    }

    static int openingArtHeight(int width, int height, int minArt, int controls) {
        return Math.min(width, Math.max(minArt, height - controls));
    }
}
