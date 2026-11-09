package in.sharepass.foundation;

import android.content.Context;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

final class QueuePush {
    private static final long REFRESH_MS = 30 * 60 * 1000;
    private static final ExecutorService worker = Executors.newSingleThreadExecutor();
    private static volatile String currentSession = "";
    private static volatile boolean counterOpen;
    private static volatile Runnable listener;
    private static String registeredSession = "", registeredToken = "";
    private static long registeredAt;
    private static boolean fetching;

    private QueuePush() {}

    static void sync(Context context, String session) {
        Context app = context.getApplicationContext();
        if (session.isEmpty()) return;
        if (!QueueNotifications.allowed(app)) {
            unregister(session);
            return;
        }
        QueueNotifications.ensureChannel(app);
        if (FirebaseApp.getApps(app).isEmpty()) return;
        currentSession = session;
        worker.execute(() -> {
            if (!session.equals(currentSession) || fetching
                    || (session.equals(registeredSession) && System.currentTimeMillis() - registeredAt < REFRESH_MS)) return;
            fetching = true;
            FirebaseMessaging.getInstance().getToken().addOnCompleteListener(worker, task -> {
                fetching = false;
                if (task.isSuccessful()) register(app, session, task.getResult());
            });
        });
    }

    static void tokenChanged(Context app, String token) {
        String session = currentSession;
        if (!session.isEmpty()) worker.execute(() -> register(app, session, token));
    }

    private static void register(Context app, String session, String token) {
        if (!session.equals(currentSession) || !QueueNotifications.allowed(app) || token == null || token.isEmpty()) return;
        if (session.equals(registeredSession) && token.equals(registeredToken)
                && System.currentTimeMillis() - registeredAt < REFRESH_MS) return;
        try {
            JSONObject response = HostedRegisterClient.pushRegistration("/api/push/register", session, token);
            if (response.optBoolean("configured") && response.optBoolean("registered")) {
                registeredSession = session;
                registeredToken = token;
                registeredAt = System.currentTimeMillis();
            }
        } catch (Exception ignored) { /* The authenticated counter still polls the queue. */ }
    }

    static void unregister(String session) {
        if (session.isEmpty()) return;
        if (session.equals(currentSession)) currentSession = "";
        worker.execute(() -> {
            if (!session.equals(registeredSession)) return;
            String token = registeredToken;
            registeredSession = "";
            registeredToken = "";
            registeredAt = 0;
            try { HostedRegisterClient.pushRegistration("/api/push/unregister", session, token); }
            catch (Exception ignored) { /* The server also revokes the authenticated session binding. */ }
        });
    }

    static void counterVisible(boolean visible) { counterOpen = visible; }
    static boolean counterOpen() { return counterOpen; }
    static void listen(Runnable callback) { listener=callback; }
    static void received() { Runnable callback=listener; if(callback!=null)callback.run(); }
}
