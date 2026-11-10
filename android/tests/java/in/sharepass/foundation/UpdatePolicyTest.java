package in.sharepass.foundation;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.KeyPairGenerator;
import java.security.Signature;

public final class UpdatePolicyTest {
    private static void reject(Runnable action) {
        try { action.run(); } catch (IllegalArgumentException expected) { return; }
        throw new AssertionError("An invalid update input was accepted");
    }

    public static void main(String[] args) throws Exception {
        String name = "0.9.8", url = UpdatePolicy.apkUrl(name), sha = "a".repeat(64);
        var release = UpdatePolicy.release(1, UpdatePolicy.PACKAGE, 18, name, url, 5_600_000, sha, UpdatePolicy.SIGNER);
        String canonical = "sharepass-android-update-v1\nin.sharepass.foundation\n18\n0.9.8\n"
            + url + "\n5600000\n" + sha + "\n" + UpdatePolicy.SIGNER + "\n";
        if (!canonical.equals(new String(UpdatePolicy.manifestBytes(release), StandardCharsets.UTF_8))) throw new AssertionError();

        var key = KeyPairGenerator.getInstance("RSA").generateKeyPair();
        Signature signing = Signature.getInstance("SHA256withRSA");
        signing.initSign(key.getPrivate());
        signing.update(UpdatePolicy.manifestBytes(release));
        byte[] signature = signing.sign();
        if (!UpdatePolicy.validSignature(release, signature, key.getPublic())) throw new AssertionError();
        var altered = UpdatePolicy.release(1, UpdatePolicy.PACKAGE, 19, name, url, 5_600_000, sha, UpdatePolicy.SIGNER);
        if (UpdatePolicy.validSignature(altered, signature, key.getPublic())) throw new AssertionError("Altered version verified");

        URI github = URI.create(UpdatePolicy.MANIFEST);
        URI tag = UpdatePolicy.redirect(github, "/Namdev90/bullseye-box-office/releases/download/android-v0.9.8/sharepass-android-update.json", true);
        String cdn = "https://release-assets.githubusercontent.com/github-production-release-asset/123?token=fixture";
        if (!cdn.equals(UpdatePolicy.redirect(tag, cdn, true).toString())) throw new AssertionError();
        reject(() -> UpdatePolicy.redirect(github, "http://release-assets.githubusercontent.com/github-production-release-asset-2e65be/123", true));
        reject(() -> UpdatePolicy.redirect(github, "https://release-assets.githubusercontent.com.evil.test/github-production-release-asset-2e65be/123", true));
        reject(() -> UpdatePolicy.redirect(github, "https://attacker@release-assets.githubusercontent.com/github-production-release-asset-2e65be/123", true));
        reject(() -> UpdatePolicy.redirect(github, "/Different/repo/releases/download/android-v0.9.8/sharepass-android-update.json", true));
        reject(() -> UpdatePolicy.redirect(github, "/Namdev90/bullseye-box-office/releases/download/android-v0.9.8/sharepass-android-update.json?x=1", true));
        reject(() -> UpdatePolicy.release(1, UpdatePolicy.PACKAGE, 18, name, url + "?different", 5_600_000, sha, UpdatePolicy.SIGNER));
        reject(() -> UpdatePolicy.release(1, "different.package", 18, name, url, 5_600_000, sha, UpdatePolicy.SIGNER));
        reject(() -> UpdatePolicy.release(1, UpdatePolicy.PACKAGE, 18, name, url, UpdatePolicy.MAX_APK + 1, sha, UpdatePolicy.SIGNER));
        reject(() -> UpdatePolicy.release(1, UpdatePolicy.PACKAGE, 18, name, url, 5_600_000, sha, sha));
        System.out.println("PASS signed manifest, canonical release URL, allowed redirects and package limits");
    }
}
