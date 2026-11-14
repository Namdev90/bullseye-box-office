package in.sharepass.foundation;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

public final class QueuePushService extends FirebaseMessagingService {
    @Override public void onNewToken(String token) {
        QueuePush.tokenChanged(getApplicationContext(), token);
    }

    @Override public void onMessageReceived(RemoteMessage message) {
        if (UpdateNotifications.TYPE.equals(message.getData().get("type"))) {
            UpdateNotifications.show(this, message.getData().get("version_code"));
            return;
        }
        if (!QueueNotifications.TYPE.equals(message.getData().get("type"))) return;
        if (QueuePush.counterOpen()) QueuePush.received();
        else {
            try{
                HostedRegisterClient client=new HostedRegisterClient(this);
                if(client.token().isEmpty())return;
                org.json.JSONObject queue=client.request("/api/queue",null);
                if(!client.token().equals(new HostedRegisterClient(this).token()))return;
                org.json.JSONArray drafts=queue.getJSONArray("drafts"),messages=queue.optJSONArray("messages");
                String summary=QueueSummary.body(drafts,messages);
                if(!summary.isEmpty())QueueNotifications.show(this,drafts.length(),summary);
            }catch(HostedRegisterClient.Rejected rejected){QueueNotifications.cancel(this);}
            catch(Exception offline){QueueNotifications.show(this,1);}
        }
    }
}
