package in.linecart.suite;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Hardware-backed session token persistence on Android.
 *
 * Encrypts the active session token using an AES-256-GCM key stored in AndroidKeyStore
 * and persists only the ciphertext + random IV inside MODE_PRIVATE SharedPreferences
 * (excluded from Android backup via allowBackup=false). Tokens never touch WebView
 * localStorage or IndexedDB on native Android.
 */
@CapacitorPlugin(name = "SessionStorage")
public class SessionStoragePlugin extends Plugin {

    private static final String KEYSTORE_PROVIDER = "AndroidKeyStore";
    private static final String KEY_ALIAS = "linecart_session_aes_key";
    private static final String PREFS_NAME = "linecart_secure_session";
    private static final String PREF_KEY_TOKEN = "enc_session_token";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int GCM_IV_BYTES = 12;
    private static final int GCM_TAG_BITS = 128;

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore ks = KeyStore.getInstance(KEYSTORE_PROVIDER);
        ks.load(null);
        if (ks.containsAlias(KEY_ALIAS)) {
            KeyStore.Entry entry = ks.getEntry(KEY_ALIAS, null);
            if (entry instanceof KeyStore.SecretKeyEntry) {
                return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
            }
        }
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE_PROVIDER);
        kg.init(
            new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        );
        return kg.generateKey();
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    @PluginMethod
    public void saveToken(PluginCall call) {
        String token = call.getString("token");
        if (token == null || token.isEmpty()) {
            prefs().edit().remove(PREF_KEY_TOKEN).apply();
            call.resolve(new JSObject().put("ok", true));
            return;
        }
        try {
            SecretKey key = getOrCreateKey();
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, key);
            byte[] iv = cipher.getIV();
            byte[] encrypted = cipher.doFinal(token.getBytes(StandardCharsets.UTF_8));
            byte[] combined = new byte[iv.length + encrypted.length];
            System.arraycopy(iv, 0, combined, 0, iv.length);
            System.arraycopy(encrypted, 0, combined, iv.length, encrypted.length);
            String encoded = Base64.encodeToString(combined, Base64.NO_WRAP);
            prefs().edit().putString(PREF_KEY_TOKEN, encoded).apply();
            call.resolve(new JSObject().put("ok", true));
        } catch (Exception e) {
            call.reject("Failed to encrypt session token", e);
        }
    }

    @PluginMethod
    public void getToken(PluginCall call) {
        String encoded = prefs().getString(PREF_KEY_TOKEN, null);
        if (encoded == null || encoded.isEmpty()) {
            call.resolve(new JSObject().put("token", (String) null));
            return;
        }
        try {
            byte[] combined = Base64.decode(encoded, Base64.NO_WRAP);
            if (combined.length <= GCM_IV_BYTES) {
                prefs().edit().remove(PREF_KEY_TOKEN).apply();
                call.resolve(new JSObject().put("token", (String) null));
                return;
            }
            byte[] iv = new byte[GCM_IV_BYTES];
            byte[] ciphertext = new byte[combined.length - GCM_IV_BYTES];
            System.arraycopy(combined, 0, iv, 0, GCM_IV_BYTES);
            System.arraycopy(combined, GCM_IV_BYTES, ciphertext, 0, ciphertext.length);

            SecretKey key = getOrCreateKey();
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_BITS, iv));
            String token = new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);
            call.resolve(new JSObject().put("token", token));
        } catch (Exception e) {
            // Key invalidated (e.g. reinstall/keystore reset) or corrupted payload: wipe and require clean login
            prefs().edit().remove(PREF_KEY_TOKEN).apply();
            call.resolve(new JSObject().put("token", (String) null));
        }
    }

    @PluginMethod
    public void clearToken(PluginCall call) {
        prefs().edit().remove(PREF_KEY_TOKEN).apply();
        call.resolve(new JSObject().put("ok", true));
    }
}
