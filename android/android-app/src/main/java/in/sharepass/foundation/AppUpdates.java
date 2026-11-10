package in.sharepass.foundation;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.Base64;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.security.MessageDigest;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BooleanSupplier;
import org.json.JSONObject;

final class AppUpdates {
    private static final long CHECK_INTERVAL = 10 * 60_000L;
    private static final long MANUAL_INTERVAL = 30_000L;
    private static final long CACHE_LIFETIME = 2 * 24 * 60 * 60_000L;
    private static final ExecutorService WORK = Executors.newSingleThreadExecutor();
    private final Activity activity;
    private final BooleanSupplier idle;
    private final SharedPreferences prefs;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable nextCheck = this::tick;
    private final boolean enabled;
    private boolean foreground, checking;
    private int offeredCode;
    private AtomicBoolean checkingTransfer, downloading;
    private AlertDialog prompt;
    private Runnable installWhenFocused;

    AppUpdates(Activity activity, BooleanSupplier idle) {
        this.activity = activity;
        this.idle = idle;
        prefs = activity.getSharedPreferences("sharepass-updates", Activity.MODE_PRIVATE);
        enabled = UpdatePolicy.PACKAGE.equals(activity.getPackageName())
            && (activity.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) == 0;
    }

    boolean isEnabled() { return enabled; }

    void start() {
        if (!enabled) return;
        foreground = true;
        handler.removeCallbacks(nextCheck);
        handler.post(nextCheck);
    }

    void stop() {
        foreground = false;
        handler.removeCallbacks(nextCheck);
        cancelDownload();
        if (prompt != null) prompt.dismiss();
    }

    void cancelDownload() {
        installWhenFocused = null;
        if (checkingTransfer != null) checkingTransfer.set(true);
        if (downloading != null) downloading.set(true);
    }

    void focusChanged(boolean focused) {
        if (foreground && focused) {
            Runnable install = installWhenFocused;
            installWhenFocused = null;
            if (install != null) install.run();
            handler.removeCallbacks(nextCheck);
            handler.post(nextCheck);
        }
    }

    private boolean ready() {
        return enabled && foreground && !activity.isFinishing() && !activity.isDestroyed()
            && (activity.hasWindowFocus() || prompt != null && prompt.isShowing()) && idle.getAsBoolean();
    }

    private void tick() {
        if (ready()) check(false);
        if (foreground) handler.postDelayed(nextCheck, CHECK_INTERVAL);
    }

    void offerSetup() {
        if (!ready() || prefs.getBoolean("asked", false) || prompt != null) return;
        prefs.edit().putBoolean("asked", true).apply();
        show(new AlertDialog.Builder(activity).setTitle("SharePass app updates")
            .setMessage("SharePass can download verified updates while the desk is idle. Set up Android's install permission now or choose Not now. Android asks before every install.")
            .setNegativeButton("Not now", null)
            .setPositiveButton("Set up updates", (dialog, which) -> enableAutomatic()));
    }

    void options() {
        if (!enabled) return;
        if (!ready()) {
            message("Finish or recover the current action first.");
            return;
        }
        boolean automatic = prefs.getBoolean("automatic", false);
        show(new AlertDialog.Builder(activity).setTitle("App updates")
            .setMessage(automatic && canInstall() ? "Verified downloads are on while SharePass is open and idle."
                : automatic ? "Verified downloads will start after you allow installs in Android settings."
                : "Check for a newer signed SharePass build.")
            .setNegativeButton("Close", null)
            .setNeutralButton(automatic ? "Turn off automatic" : "Set up automatic", (dialog, which) -> {
                if (automatic) {
                    prefs.edit().putBoolean("automatic", false).apply();
                    cancelDownload();
                } else enableAutomatic();
            })
            .setPositiveButton("Check now", (dialog, which) -> check(true)));
    }

    private void enableAutomatic() {
        prefs.edit().putBoolean("automatic", true).apply();
        if (canInstall()) check(true);
        else openInstallSettings();
    }

    private void showPermission() {
        if (Build.VERSION.SDK_INT < 26 || !ready()) return;
        show(new AlertDialog.Builder(activity).setTitle("Allow updates from SharePass")
            .setMessage("In Android settings, allow installs from SharePass if you want to install its verified APKs.")
            .setNegativeButton("Not now", null)
            .setPositiveButton("Open Android settings", (dialog, which) -> openInstallSettings()));
    }

    private void openInstallSettings() {
        if (Build.VERSION.SDK_INT < 26 || !ready()) return;
        try {
            activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + activity.getPackageName())));
        } catch (ActivityNotFoundException unavailable) {
            message("Android install settings could not open.");
        }
    }

    private boolean canInstall() {
        return Build.VERSION.SDK_INT < 26 || activity.getPackageManager().canRequestPackageInstalls();
    }

    private void check(boolean manual) {
        if (!ready()) return;
        if (checking) {
            if (manual) message(checkingTransfer != null && checkingTransfer.get()
                ? "The previous update check is still stopping. Try again in a moment."
                : "An update check is already running. Try again in a moment.");
            return;
        }
        checking = true;
        AtomicBoolean cancelled = new AtomicBoolean();
        checkingTransfer = cancelled;
        WORK.execute(() -> {
            UpdatePolicy.Release release = null;
            boolean unavailable = false;
            try {
                int installed = installedVersion();
                cleanup(installed);
                long now = System.currentTimeMillis(), attempted = prefs.getLong("checked", 0);
                String manifest = prefs.getString("manifest", "");
                if (now < attempted || now - attempted >= (manual ? MANUAL_INTERVAL : CHECK_INTERVAL)) {
                    prefs.edit().putLong("checked", now).apply();
                    try {
                        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                        transfer(UpdatePolicy.MANIFEST, true, UpdatePolicy.MAX_MANIFEST, bytes, cancelled);
                        manifest = bytes.toString("UTF-8");
                        release = parse(manifest);
                        prefs.edit().putString("manifest", manifest).apply();
                    } catch (IOException failure) {
                        if (manifest.isEmpty()) throw failure;
                        release = parse(manifest);
                    }
                } else if (!manifest.isEmpty()) {
                    release = parse(manifest);
                } else {
                    unavailable = true;
                }
                if (release != null && release.code() <= installed) release = null;
            } catch (Exception failure) {
                unavailable = true;
            }
            UpdatePolicy.Release candidate = release;
            boolean failed = unavailable;
            handler.post(() -> {
                checking = false;
                checkingTransfer = null;
                if (!ready() || cancelled.get()) return;
                if (candidate == null) {
                    if (manual) message(failed ? "Could not verify the SharePass update channel." : "No newer SharePass release.");
                    return;
                }
                if (manual || prefs.getBoolean("automatic", false) && canInstall() && offeredCode != candidate.code()) {
                    if (canInstall()) download(candidate, manual);
                    else showPermission();
                }
            });
        });
    }

    private void download(UpdatePolicy.Release release, boolean manual) {
        if (downloading != null || !ready()) return;
        AtomicBoolean cancelled = new AtomicBoolean();
        downloading = cancelled;
        if (manual) message("Checking the signed SharePass download…");
        WORK.execute(() -> {
            File apk = null;
            try {
                if (release.code() > installedVersion() && safeJournal() && !cancelled.get()) apk = verifiedApk(release, cancelled);
            } catch (Exception ignored) {
                // The installer must never see a partially downloaded or unverified file.
            }
            File readyFile = apk;
            handler.post(() -> {
                downloading = null;
                if (!ready() || cancelled.get()) return;
                if (readyFile == null) {
                    if (manual) message("The update could not be prepared. Finish any pending work and try again.");
                    return;
                }
                offeredCode = release.code();
                show(new AlertDialog.Builder(activity).setTitle("SharePass " + release.name() + " is ready")
                    .setMessage("Install between transactions. Android will ask you to confirm.")
                    .setNegativeButton("Later", null)
                    .setPositiveButton("Install update", (dialog, which) -> install(release, readyFile)));
            });
        });
    }

    private void install(UpdatePolicy.Release release, File file) {
        if (!ready() || !canInstall() || downloading != null) return;
        AtomicBoolean cancelled = new AtomicBoolean();
        downloading = cancelled;
        WORK.execute(() -> {
            boolean verified;
            try {
                verified = safeJournal() && release.code() > installedVersion() && verifiesApk(file, release);
            } catch (Exception failure) { verified = false; }
            boolean valid = verified;
            handler.post(() -> {
                downloading = null;
                if (!foreground || cancelled.get()) return;
                Runnable finish = () -> {
                    if (!ready()) return;
                    if (valid && canInstall()) openInstaller(file);
                    else message("The update is no longer ready. Check for it again when the desk is idle.");
                };
                // The confirmation dialog can close before Android returns focus to the activity.
                if (activity.hasWindowFocus()) finish.run();
                else installWhenFocused = finish;
            });
        });
    }

    @SuppressWarnings("deprecation")
    private void openInstaller(File file) {
        try {
            Uri apk = FileProvider.getUriForFile(activity, activity.getPackageName() + ".updates", file);
            Intent intent = new Intent(Intent.ACTION_INSTALL_PACKAGE).setData(apk)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            for (ResolveInfo handler : activity.getPackageManager().queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)) {
                if (handler.activityInfo == null || (handler.activityInfo.applicationInfo.flags
                        & (ApplicationInfo.FLAG_SYSTEM | ApplicationInfo.FLAG_UPDATED_SYSTEM_APP)) == 0) continue;
                intent.setClassName(handler.activityInfo.packageName, handler.activityInfo.name);
                activity.startActivity(intent);
                return;
            }
            throw new IOException();
        } catch (Exception failure) {
            message("Android could not open the installer. Check for the update again.");
        }
    }

    private boolean safeJournal() throws Exception {
        HostedRegisterClient client = new HostedRegisterClient(activity);
        JSONObject intake = client.intake();
        return !client.hasPending() && client.handover() == null
            && (intake == null || intake.optLong("expires_at") <= System.currentTimeMillis());
    }

    private File verifiedApk(UpdatePolicy.Release release, AtomicBoolean cancelled) throws Exception {
        File root = updateCache();
        File verified = new File(root, "verified");
        if (!verified.isDirectory() && !verified.mkdirs()) throw new IOException();
        File target = new File(verified, release.code() + "-" + release.sha256() + ".apk");
        if (target.isFile()) {
            if (verifiesApk(target, release)) return target;
            if (!target.delete()) throw new IOException();
        }
        File temporary = File.createTempFile("sharepass-", ".partial.apk", root);
        try {
            try (FileOutputStream out = new FileOutputStream(temporary)) {
                transfer(release.url(), false, release.size(), out, cancelled);
                out.getFD().sync();
            }
            if (cancelled.get() || !verifiesApk(temporary, release)) throw new IOException();
            if (!temporary.renameTo(target)) throw new IOException();
            return target;
        } finally {
            if (temporary.exists()) temporary.delete();
        }
    }

    private File updateCache() {
        return new File(activity.getCacheDir(), "sharepass-updates");
    }

    private void cleanup(int installed) {
        File root = updateCache(), verified = new File(root, "verified");
        for (File directory : new File[]{root, verified}) {
            File[] files = directory.listFiles();
            if (files == null) continue;
            for (File file : files) {
                if (!file.isFile()) continue;
                String name = file.getName();
                if (name.endsWith(".partial.apk") || name.matches("[0-9]{1,10}-[a-f0-9]{64}\\.apk")
                        && (Long.parseLong(name.substring(0, name.indexOf('-'))) <= installed
                        || System.currentTimeMillis() - file.lastModified() > CACHE_LIFETIME)) file.delete();
            }
        }
    }

    private boolean verifiesApk(File file, UpdatePolicy.Release release) throws Exception {
        if (file.length() != release.size()) return false;
        MessageDigest sha = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(file)) {
            byte[] buffer = new byte[16_384];
            for (int count; (count = in.read(buffer)) != -1;) sha.update(buffer, 0, count);
        }
        if (!release.sha256().equals(UpdatePolicy.hex(sha.digest()))) return false;
        PackageInfo archive = activity.getPackageManager().getPackageArchiveInfo(file.getPath(), signatureFlags());
        return archive != null && UpdatePolicy.PACKAGE.equals(archive.packageName) && release.code() == versionCode(archive)
            && release.name().equals(archive.versionName) && UpdatePolicy.SIGNER.equals(UpdatePolicy.digest(signer(archive).getEncoded()));
    }

    private UpdatePolicy.Release parse(String text) throws Exception {
        JSONObject fields = new JSONObject(text);
        UpdatePolicy.Release release = UpdatePolicy.release(integer(fields, "schema"), string(fields, "packageName"),
            integer(fields, "versionCode"), string(fields, "versionName"), string(fields, "apkUrl"),
            integer(fields, "size"), string(fields, "sha256"), string(fields, "signerSha256"));
        String signature = string(fields, "signature");
        if (signature.length() > 1400 || !signature.matches("[A-Za-z0-9+/]+={0,2}")
                || !UpdatePolicy.verifies(release, Base64.decode(signature, Base64.NO_WRAP), signer(installedInfo()))) throw new IOException();
        return release;
    }

    private static int integer(JSONObject value, String name) throws Exception {
        Object field = value.get(name);
        if (!(field instanceof Integer number)) throw new IOException();
        return number;
    }

    private static String string(JSONObject value, String name) throws Exception {
        Object field = value.get(name);
        if (!(field instanceof String text)) throw new IOException();
        return text;
    }

    private PackageInfo installedInfo() throws Exception {
        return activity.getPackageManager().getPackageInfo(UpdatePolicy.PACKAGE, signatureFlags());
    }

    private int installedVersion() throws Exception {
        PackageInfo info = installedInfo();
        if (!UpdatePolicy.SIGNER.equals(UpdatePolicy.digest(signer(info).getEncoded()))) throw new IOException();
        return Math.toIntExact(versionCode(info));
    }

    @SuppressWarnings("deprecation")
    private static long versionCode(PackageInfo info) {
        return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
    }

    @SuppressWarnings("deprecation")
    private static int signatureFlags() {
        return Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
    }

    @SuppressWarnings("deprecation")
    private static X509Certificate signer(PackageInfo info) throws Exception {
        Signature[] signatures = Build.VERSION.SDK_INT >= 28
            ? info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners()
            : info.signatures;
        if (signatures == null || signatures.length != 1) throw new IOException();
        return (X509Certificate) CertificateFactory.getInstance("X.509")
            .generateCertificate(new ByteArrayInputStream(signatures[0].toByteArray()));
    }

    private static void transfer(String url, boolean metadata, int maximum, OutputStream out, AtomicBoolean cancelled) throws Exception {
        URI target = URI.create(url);
        long deadline = SystemClock.elapsedRealtime() + (metadata ? 20_000 : 180_000);
        for (int redirect = 0; redirect <= 3; redirect++) {
            if (cancelled.get() || SystemClock.elapsedRealtime() >= deadline) throw new IOException();
            HttpURLConnection connection = (HttpURLConnection) target.toURL().openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(7000);
            connection.setReadTimeout(10000);
            try {
                int status = connection.getResponseCode();
                if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
                    target = UpdatePolicy.redirect(target, connection.getHeaderField("Location"), metadata);
                    continue;
                }
                if (status != 200 || connection.getContentLength() > maximum) throw new IOException();
                try (InputStream in = connection.getInputStream()) {
                    byte[] buffer = new byte[16_384];
                    int size = 0;
                    for (int count; (count = in.read(buffer)) != -1;) {
                        size += count;
                        if (size > maximum || cancelled.get() || SystemClock.elapsedRealtime() >= deadline) throw new IOException();
                        out.write(buffer, 0, count);
                    }
                }
                return;
            } finally {
                connection.disconnect();
            }
        }
        throw new IOException();
    }

    private void message(String text) {
        Toast.makeText(activity, text, Toast.LENGTH_SHORT).show();
    }

    private void show(AlertDialog.Builder builder) {
        if (prompt != null) prompt.dismiss();
        prompt = builder.create();
        prompt.setOnDismissListener(dialog -> { if (prompt == dialog) prompt = null; });
        prompt.show();
    }
}
