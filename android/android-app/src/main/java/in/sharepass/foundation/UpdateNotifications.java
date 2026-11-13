package in.sharepass.foundation;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/** Release hints never authorize an APK or supply a download address. */
final class UpdateNotifications {
    static final String TYPE = "sharepass_update";
    static final String CHANNEL = "app_updates";
    private static final int NOTICE_ID = 224;

    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT >= 26) context.getSystemService(NotificationManager.class)
            .createNotificationChannel(new NotificationChannel(CHANNEL, "App updates", NotificationManager.IMPORTANCE_DEFAULT));
    }

    @SuppressWarnings("deprecation")
    static void show(Context context, String versionCode) {
        try { if (Integer.parseInt(versionCode) <= BuildConfig.VERSION_CODE) return; }
        catch (Exception invalid) { return; }
        if (!QueueNotifications.allowed(context)) return;
        ensureChannel(context);
        Intent intent = new Intent(context, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra("checkSharePassUpdate", true);
        PendingIntent open = PendingIntent.getActivity(context, NOTICE_ID, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder notice = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(context, CHANNEL) : new Notification.Builder(context);
        notice.setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle("SharePass update available")
            .setContentText("Open SharePass to verify the update and install when ready.")
            .setContentIntent(open).setAutoCancel(true).setVisibility(Notification.VISIBILITY_PRIVATE);
        try { context.getSystemService(NotificationManager.class).notify(TYPE, NOTICE_ID, notice.build()); }
        catch (SecurityException denied) { /* Android notification permission remains authoritative. */ }
    }
}
