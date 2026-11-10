import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.Signature;
import java.util.Arrays;
import java.util.Base64;

class SignSharePassUpdate {
    public static void main(String[] args) throws Exception {
        if (args.length != 4 || System.console() == null) {
            throw new IllegalArgumentException("Sign in a local terminal with a keystore, alias, message and output path.");
        }
        char[] storePassword = System.console().readPassword("Keystore password: ");
        if (storePassword == null) throw new IllegalArgumentException("No keystore password entered.");
        char[] keyPassword = null;
        try {
            KeyStore store = KeyStore.getInstance(new File(args[0]), storePassword);
            keyPassword = System.console().readPassword("Key password (Enter to reuse the keystore password): ");
            if (keyPassword == null) throw new IllegalArgumentException("No key password entered.");
            if (!(store.getKey(args[1], keyPassword.length == 0 ? storePassword : keyPassword) instanceof PrivateKey key)
                    || !"RSA".equals(key.getAlgorithm())) {
                throw new IllegalArgumentException("The alias does not contain an RSA signing key.");
            }
            Signature signer = Signature.getInstance("SHA256withRSA");
            signer.initSign(key);
            signer.update(Files.readAllBytes(Path.of(args[2])));
            Files.writeString(Path.of(args[3]), Base64.getEncoder().encodeToString(signer.sign()), StandardOpenOption.CREATE_NEW);
        } finally {
            Arrays.fill(storePassword, '\0');
            if (keyPassword != null) Arrays.fill(keyPassword, '\0');
        }
    }
}
