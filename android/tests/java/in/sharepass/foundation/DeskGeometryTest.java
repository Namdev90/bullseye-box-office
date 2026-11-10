package in.sharepass.foundation;

import java.util.List;

public final class DeskGeometryTest {
    private static final DeskGeometry.Area EMPTY = new DeskGeometry.Area(0, 0, 0, 0);

    private static DeskGeometry.Area area(int left, int top, int right, int bottom) {
        return new DeskGeometry.Area(left, top, right, bottom);
    }

    private static void require(Object actual, Object expected) {
        if (!actual.equals(expected)) throw new AssertionError("Expected " + expected + " but got " + actual);
    }

    public static void main(String[] args) {
        require(DeskGeometry.viewport(320, 580, area(18, 36, 24, 28), List.of(), 680), area(18, 36, 296, 552));
        require(DeskGeometry.viewport(940, 310, area(50, 10, 26, 25), List.of(), 680), area(142, 10, 822, 285));
        require(DeskGeometry.viewport(320, 465, area(14, 26, 14, 270), List.of(), 680), area(14, 26, 306, 195));

        var book = new DeskGeometry.Fold(area(590, 0, 630, 900), true);
        require(DeskGeometry.viewport(1200, 900, area(64, 20, 0, 26), List.of(book), 680), area(630, 20, 1200, 874));
        var tabletop = new DeskGeometry.Fold(area(0, 410, 780, 432), false);
        require(DeskGeometry.viewport(780, 850, area(20, 28, 20, 320), List.of(tabletop), 680), area(50, 28, 730, 410));
        var crease = new DeskGeometry.Fold(area(420, 0, 420, 780), true);
        var second = new DeskGeometry.Fold(area(800, 0, 828, 780), true);
        require(DeskGeometry.viewport(1280, 780, EMPTY, List.of(crease, second), 680), area(828, 0, 1280, 780));
        var outside = new DeskGeometry.Fold(area(900, 0, 940, 780), true);
        require(DeskGeometry.viewport(480, 780, EMPTY, List.of(outside), 680), area(0, 0, 480, 780));

        require(DeskGeometry.keypadColumns(207, 48, 5), 4);
        require(DeskGeometry.keypadColumns(120, 48, 3), 2);
        require(DeskGeometry.keypadColumns(330, 48, 5), 5);
        require(DeskGeometry.keypadSlot(8, 3), 8);
        require(DeskGeometry.keypadSlot(9, 3), 10);
        require(DeskGeometry.keypadSlot(10, 3), 11);
        require(DeskGeometry.keypadSlot(9, 2), 9);
        require(DeskGeometry.qrSize(218, 530, 350), 218);
        require(DeskGeometry.qrSize(580, 135, 350), 135);
        require(DeskGeometry.qrSize(72, 86, 350), 72);
        require(DeskGeometry.openingArtHeight(380, 720, 96, 200), 380);
        require(DeskGeometry.openingArtHeight(520, 270, 96, 200), 96);
        System.out.println("PASS window geometry for cutout, split screen, keyboard, wide desk, folds, QR and touch grid");
    }
}
