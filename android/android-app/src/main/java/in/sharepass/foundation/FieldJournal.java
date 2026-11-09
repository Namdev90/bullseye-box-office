package in.sharepass.foundation;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Atomic encrypted device journal. A failed read never silently resets stock. */
final class FieldJournal {
    private final AtomicFile file;
    private final SecretKey key;
    FieldJournal(Context context) throws Exception {
        this(context, "field-journal");
    }
    FieldJournal(Context context, String name) throws Exception {
        file = new AtomicFile(new File(context.getFilesDir(), name + ".bin"));
        KeyStore keys = KeyStore.getInstance("AndroidKeyStore");
        keys.load(null);
        String alias = "sharepass-" + name + "-v1";
        if (!keys.containsAlias(alias)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        key = (SecretKey) keys.getKey(alias, null);
    }
    JSONObject read() throws Exception {
        if (!file.getBaseFile().exists() && !new File(file.getBaseFile()+".bak").exists()) return new JSONObject();
        byte[] bytes = file.readFully();
        if (bytes.length < 29 || bytes.length > 262144) throw new IllegalStateException("Journal size invalid");
        ByteBuffer buffer = ByteBuffer.wrap(bytes);
        byte[] iv = new byte[12]; buffer.get(iv);
        byte[] payload = new byte[buffer.remaining()]; buffer.get(payload);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, iv));
        return new JSONObject(new String(cipher.doFinal(payload), StandardCharsets.UTF_8));
    }
    void write(JSONObject value) throws Exception {
        byte[] bytes = value.toString().getBytes(StandardCharsets.UTF_8);
        if (bytes.length > 200000) throw new IllegalStateException("Journal full; synchronize before continuing");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key);
        byte[] encrypted = cipher.doFinal(bytes);
        FileOutputStream output = null;
        try {
            output = file.startWrite();
            output.write(cipher.getIV()); output.write(encrypted);
            file.finishWrite(output);
        } catch (Exception error) {
            if (output != null) file.failWrite(output);
            throw error;
        }
    }
}
