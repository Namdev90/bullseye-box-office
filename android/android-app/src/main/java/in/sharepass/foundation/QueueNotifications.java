package in.sharepass.foundation;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

final class QueueNotifications {
    static final String TYPE = "sharepass_queue";
    static final int NOTICE_ID = 221;
    static final String CHANNEL = "booth_queue";

    private QueueNotifications() {}

    static boolean allowed(Context context) {
        return (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
            && context.getSystemService(NotificationManager.class).areNotificationsEnabled();
    }

    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL, "Booth queue", NotificationManager.IMPORTANCE_DEFAULT);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        context.getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    static void cancel(Context context) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        manager.cancel(NOTICE_ID);
        manager.cancel(TYPE, 0);
    }

    static Intent openQueue(Context context) {
        return new Intent(context, HostedDeskActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra("openBoothQueue", true);
    }

    @SuppressWarnings("deprecation")
    static void show(Context context, int count) {
        if (!allowed(context)) return;
        ensureChannel(context);
        PendingIntent target = PendingIntent.getActivity(context, NOTICE_ID, openQueue(context), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder notification = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(context, CHANNEL) : new Notification.Builder(context);
        notification.setSmallIcon(android.R.drawable.stat_notify_more)
            .setContentTitle(count == 1 ? "New booth deposit" : count + " new booth deposits")
            .setContentText("Open the booth queue to review.").setVisibility(Notification.VISIBILITY_PRIVATE)
            .setAutoCancel(true).setContentIntent(target);
        try { context.getSystemService(NotificationManager.class).notify(NOTICE_ID, notification.build()); }
        catch (SecurityException ignored) { /* Android permission changed while posting. */ }
    }
}
