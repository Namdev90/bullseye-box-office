package in.sharepass.foundation;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

public final class QueuePushService extends FirebaseMessagingService {
    @Override public void onNewToken(String token) {
        QueuePush.tokenChanged(getApplicationContext(), token);
    }

    @Override public void onMessageReceived(RemoteMessage message) {
        if (!QueueNotifications.TYPE.equals(message.getData().get("type"))) return;
        if (QueuePush.counterOpen()) QueuePush.received();
        else QueueNotifications.show(this, 1);
    }
}
