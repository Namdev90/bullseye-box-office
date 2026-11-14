package in.sharepass.foundation;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import org.json.JSONArray;
import org.json.JSONObject;

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
        else showQueueAlert();
    }
    private void showQueueAlert(){
            try{
                HostedRegisterClient client=new HostedRegisterClient(this);
                if(client.token().isEmpty())return;
                JSONObject queue=client.request("/api/queue",null);
                if(!client.token().equals(new HostedRegisterClient(this).token()))return;
                JSONArray drafts=queue.getJSONArray("drafts"),messages=queue.optJSONArray("messages");
                String summary=QueueSummary.body(drafts,messages);
                if(!summary.isEmpty())QueueNotifications.show(this,drafts.length(),summary);
            }catch(HostedRegisterClient.Rejected rejected){
                if(rejected.status==401||rejected.status==403)QueueNotifications.cancel(this);
                else QueueNotifications.show(this,1);
            }
            catch(Exception offline){QueueNotifications.show(this,1);}
    }
}
