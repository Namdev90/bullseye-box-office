package in.sharepass.foundation;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.security.Signature;
import java.security.cert.X509Certificate;
import java.util.Locale;
import java.util.regex.Pattern;

final class UpdatePolicy {
    static final String PACKAGE = "in.sharepass.foundation";
    static final String SIGNER = "0a8b400966fd754c6db2b33b94f78c9898803aff37718fa34c34aef77b642c12";
    static final String REPOSITORY = "https://github.com/Namdev90/bullseye-box-office/releases/";
    static final String MANIFEST = REPOSITORY + "latest/download/sharepass-android-update.json";
    static final int MAX_MANIFEST = 16 * 1024;
    static final int MAX_APK = 25 * 1024 * 1024;
    private static final String VERSION = "(?:0|[1-9][0-9]{0,3})\\.(?:0|[1-9][0-9]{0,3})\\.(?:0|[1-9][0-9]{0,3})";
    private static final Pattern MANIFEST_RELEASE = Pattern.compile("/Namdev90/bullseye-box-office/releases/download/android-v"
        + VERSION + "/sharepass-android-update\\.json");

    record Release(int code, String name, String url, int size, String sha256) {}

    private UpdatePolicy() {}

    static Release release(int schema, String packageName, int code, String name, String url, int size, String hash, String signer) {
        if (schema != 1 || !PACKAGE.equals(packageName) || code < 1 || !name.matches(VERSION)
                || !apkUrl(name).equals(url) || size < 100_000 || size > MAX_APK
                || !hash.matches("[a-f0-9]{64}") || !SIGNER.equals(signer)) {
            throw new IllegalArgumentException("Invalid SharePass update metadata.");
        }
        return new Release(code, name, url, size, hash);
    }

    static String apkUrl(String version) {
        return REPOSITORY + "download/android-v" + version + "/SharePass-Android-" + version + ".apk";
    }

    static byte[] manifestBytes(Release release) {
        return ("sharepass-android-update-v1\n" + PACKAGE + "\n" + release.code() + "\n"
            + release.name() + "\n" + release.url() + "\n" + release.size() + "\n"
            + release.sha256() + "\n" + SIGNER + "\n").getBytes(StandardCharsets.UTF_8);
    }

    static boolean verifies(Release release, byte[] signature, X509Certificate certificate) throws Exception {
        if (signature.length < 128 || signature.length > 1024 || !SIGNER.equals(digest(certificate.getEncoded()))) return false;
        return validSignature(release, signature, certificate.getPublicKey());
    }

    static boolean validSignature(Release release, byte[] signature, PublicKey key) throws Exception {
        Signature verifier = Signature.getInstance("SHA256withRSA");
        verifier.initVerify(key);
        verifier.update(manifestBytes(release));
        return verifier.verify(signature);
    }

    static URI redirect(URI current, String location, boolean metadata) {
        if (location == null || location.isEmpty()) throw new IllegalArgumentException("Unsafe update redirect.");
        URI next = current.resolve(location);
        if (!"https".equals(next.getScheme()) || next.getHost() == null || next.getUserInfo() != null || next.getFragment() != null
                || next.getPort() != -1 && next.getPort() != 443) throw new IllegalArgumentException("Unsafe update redirect.");
        String host = next.getHost().toLowerCase(Locale.ROOT);
        if ("github.com".equals(current.getHost()) && "github.com".equals(host)
                && metadata && next.getRawQuery() == null && MANIFEST_RELEASE.matcher(next.getRawPath()).matches()) return next;
        if (("github.com".equals(current.getHost()) || "release-assets.githubusercontent.com".equals(current.getHost()))
                && "release-assets.githubusercontent.com".equals(host)
                && next.getRawPath().matches("/github-production-release-asset(?:-[a-f0-9]+)?/.+")) return next;
        throw new IllegalArgumentException("Unsafe update redirect.");
    }

    static String digest(byte[] bytes) throws Exception {
        return hex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }

    static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) result.append(Character.forDigit((value & 255) >>> 4, 16)).append(Character.forDigit(value & 15, 16));
        return result.toString();
    }
}
