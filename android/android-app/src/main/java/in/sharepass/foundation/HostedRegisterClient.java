package in.sharepass.foundation;

import android.content.Context;
import android.util.Base64;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.logging.Logger;
import javax.net.ssl.SSLHandshakeException;
import javax.net.ssl.SSLPeerUnverifiedException;

final class HostedRegisterClient {
    static final String ORIGIN = BuildConfig.SHAREPASS_ORIGIN;
    private final FieldJournal journal;
    private volatile JSONObject saved;

    static final class Rejected extends IOException {
        final int status;
        final boolean notExecuted;
        final boolean pickupReferenceRequired;
        Rejected(int status, JSONObject response) {
            super(response.optString("error", "SharePass could not complete the request."));
            this.status = status;
            this.notExecuted = response.optBoolean("notExecuted", false);
            this.pickupReferenceRequired = response.optBoolean("pickup_reference_required", false);
        }
    }

    HostedRegisterClient(Context context) throws Exception {
        journal = new FieldJournal(context, "hosted-register");
        saved = journal.read();
    }

    String token() { return saved.optString("token"); }
    boolean hasPending() { return saved.has("pending"); }
    JSONObject receipt() { return saved.optJSONObject("receipt"); }
    void rememberUpdateChannel(String channel) throws Exception {
        JSONObject updated=copy();
        JSONObject receipt=updated.optJSONObject("receipt");
        if(receipt==null)return;
        receipt.put("update_channel",channel);
        write(updated);
    }
    void rememberRecipients(String code, org.json.JSONArray people) throws Exception {
        JSONObject updated = copy();
        JSONObject receipt = updated.optJSONObject("receipt");
        if (receipt == null || !code.equals(receipt.optString("collection_code"))) return;
        receipt.put("recipients", people);
        write(updated);
    }
    JSONObject handover() { return saved.optJSONObject("handover"); }
    JSONObject intake() { return saved.optJSONObject("intake"); }

    private void write(JSONObject updated) throws Exception {
        journal.write(updated);
        saved = updated;
    }

    private JSONObject copy() throws Exception { return new JSONObject(saved.toString()); }

    static String setupInvite(String value) {
        try {
            URI url = URI.create(value);
            String query = url.getRawQuery();
            boolean httpsLink = value.startsWith(ORIGIN + "/connect?") && "/connect".equals(url.getRawPath())
                || value.startsWith(ORIGIN + "/app-setup?") && "/app-setup".equals(url.getRawPath());
            boolean appLink = value.startsWith("sharepass://connect?") && "connect".equals(url.getRawAuthority()) && url.getPath().isEmpty();
            if ((!httpsLink && !appLink) || url.getFragment() != null || query == null
                    || !query.matches("invite=[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}")) return "";
            return query.substring("invite=".length());
        } catch (IllegalArgumentException error) { return ""; }
    }

    JSONObject connectDevice(String kind, String value) throws Exception {
        JSONObject updated = copy();
        String previousSession = token();
        String intent = kind + ":" + value;
        String verifier = updated.optString("setup_verifier");
        if (verifier.isEmpty() || !intent.equals(updated.optString("setup_intent"))) {
            byte[] random = new byte[32];
            new SecureRandom().nextBytes(random);
            verifier = Base64.encodeToString(random, Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
            updated.put("setup_verifier", verifier).put("setup_intent", intent);
            write(updated);
        }
        JSONObject result = request("/api/device/connect", new JSONObject().put(kind, value).put("verifier", verifier), "");
        if (!verifier.equals(result.optString("token")) || result.optLong("expires_at") <= System.currentTimeMillis()) {
            throw new IOException("The setup response was invalid. Try again.");
        }
        updated = copy();
        updated.remove("verifier");
        updated.remove("pairing_started");
        updated.remove("setup_verifier");
        updated.remove("setup_intent");
        updated.put("token", verifier).put("expires_at", result.getLong("expires_at"));
        saveContext(result, updated, true);
        if (!previousSession.equals(verifier)) QueuePush.unregister(previousSession);
        result.remove("token");
        return result;
    }

    JSONObject context() throws Exception {
        JSONObject context = request("/api/context", null);
        saveContext(context, copy(), false);
        return context;
    }

    private void saveContext(JSONObject context, JSONObject updated, boolean newSession) throws Exception {
        String account = context.getString("session_key");
        String previous = updated.optString("account");
        if (!previous.isEmpty() && !previous.equals(account)) {
            if (hasPending() || handover() != null) {
                updated.remove("token");
                updated.remove("expires_at");
                write(updated);
                throw new IOException("Reconnect with the original staff setup to recover this phone’s saved action.");
            }
            updated.remove("receipt");
            updated.remove("intake");
        }
        if (newSession || !previous.equals(account)) write(updated.put("account", account));
    }

    void forgetExpiredSession() throws Exception {
        QueuePush.unregister(token());
        JSONObject updated = copy();
        updated.remove("token");
        updated.remove("expires_at");
        write(updated);
    }

    void logout() throws Exception {
        if (hasPending() || handover() != null) throw new IOException("Finish or recover the saved action before signing out.");
        QueuePush.unregister(token());
        request("/api/mobile/logout", new JSONObject());
        write(new JSONObject());
    }

    JSONObject request(String path, JSONObject body) throws Exception {
        return request(path, body, token());
    }

    static JSONObject pushRegistration(String path, String session, String registration) throws Exception {
        return request(path, new JSONObject().put("token", registration), session);
    }

    JSONObject stockChange(String path, JSONObject body) throws Exception {
        if (hasPending()) throw new IOException("Recover the previous action before changing stock.");
        body.put("request_id", UUID.randomUUID().toString());
        JSONObject action = new JSONObject().put("path", path).put("body", body);
        write(copy().put("pending", action));
        return recover();
    }

    JSONObject recover() throws Exception {
        JSONObject action = saved.getJSONObject("pending");
        String path = action.getString("path");
        JSONObject body = action.getJSONObject("body");
        return retryPickup(path, () -> finishStockChange(path, body));
    }

    static <T> T retryPickup(String path, Callable<T> action) throws Exception {
        try {
            return action.call();
        } catch (IOException failure) {
            boolean pickup = path.endsWith("/release") || path.endsWith("/handover");
            if (!pickup || failure instanceof SSLHandshakeException || failure instanceof SSLPeerUnverifiedException
                    || (failure instanceof Rejected response && (response.notExecuted || response.status < 500))) {
                throw failure;
            }
            // The pending journal still holds the same request ID if the reply was lost.
            Logger.getLogger("SharePassPickup").info("Retrying saved pickup after " + failure.getClass().getSimpleName());
            try {
                Thread.sleep(250);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                throw failure;
            }
            return action.call();
        }
    }

    private JSONObject finishStockChange(String path, JSONObject body) throws Exception {
        JSONObject response;
        try {
            response = request(path, body);
        } catch (Rejected error) {
            if (error.notExecuted && error.status != 401 && (error.status != 403 || path.equals("/api/codes/refresh"))) {
                JSONObject updated = copy();
                updated.remove("pending");
                write(updated);
            }
            throw error;
        }
        JSONObject updated = copy();
        if (path.equals("/api/deposits") || path.endsWith("/confirm")) {
            response.getString("collection_code");
            updated.put("receipt", response);
            if (!path.startsWith("/api/queue/")) updated.remove("intake");
        } else if (path.equals("/api/codes/refresh")) {
            JSONObject previous = updated.optJSONObject("receipt");
            if (previous != null && previous.getJSONObject("deposit").getString("id")
                    .equals(response.getJSONObject("deposit").getString("id"))) {
                for (String key : new String[]{"recipients", "depositor_receipt", "update_channel"}) {
                    if (previous.has(key)) response.put(key, previous.get(key));
                }
            }
            updated.put("receipt", response);
        } else if (path.endsWith("/release")) {
            updated.put("handover", response);
        } else if (path.endsWith("/handover")) {
            updated.remove("handover");
        }
        updated.remove("pending");
        write(updated);
        return response.put("action_path", path);
    }

    void resumeHandover(JSONObject deposit, JSONObject collection) throws Exception {
        write(copy().put("handover", new JSONObject().put("deposit", deposit).put("collection", collection)));
    }

    JSONObject startIntake() throws Exception {
        JSONObject response = request("/api/intakes", new JSONObject());
        write(copy().put("intake", response));
        return response;
    }

    private static JSONObject request(String path, JSONObject body, String token) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(ORIGIN + path).openConnection();
        boolean quietRequest = "/api/queue".equals(path) || path.startsWith("/api/push/");
        connection.setConnectTimeout(quietRequest ? 3500 : 8000);
        connection.setReadTimeout(quietRequest ? 3500 : 12000);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("X-SharePass-Client", "0.9.0");
        if (!token.isEmpty()) connection.setRequestProperty("X-SharePass-Session", token);
        try {
            if (body != null) {
                byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
                connection.setRequestMethod("POST");
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream out = connection.getOutputStream()) { out.write(bytes); }
            }
            int status = connection.getResponseCode();
            if (status >= 300 && status < 400) throw new IOException("SharePass could not reach the live register.");
            InputStream stream = status < 400 ? connection.getInputStream() : connection.getErrorStream();
            if (stream == null) throw new IOException("SharePass could not reach the live register.");
            try (InputStream in = stream) {
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                byte[] chunk = new byte[4096];
                for (int count; (count = in.read(chunk)) != -1; ) {
                    output.write(chunk, 0, count);
                    if (output.size() > 1048576) throw new IOException("The register response is too large.");
                }
                JSONObject result;
                try {
                    result = new JSONObject(output.toString("UTF-8"));
                } catch (JSONException invalid) {
                    throw new IOException("The register reply was incomplete or unreadable.", invalid);
                }
                if (status >= 400) throw new Rejected(status, result);
                return result;
            }
        } finally {
            connection.disconnect();
        }
    }
}
