package in.sharepass.foundation;

import android.content.Context;

final class QueuePush {
    private QueuePush() {}
    static void sync(Context context, String session) {}
    static void unregister(String session) {}
    static void counterVisible(boolean visible) {}
    static void listen(Runnable listener) {}
}
