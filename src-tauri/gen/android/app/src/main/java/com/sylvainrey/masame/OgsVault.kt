package com.sylvainrey.masame

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Called by Rust only. The JSON envelope includes refresh tokens and an expiring PKCE transaction.
 * The AES key is nonexportable, ciphertext is atomic and never backed up. No plaintext fallback or biometric gate.
 * Keep this class/method name in proguard-rules.pro: JNI resolves it through the app's classloader. */
object OgsVault {
    private fun alias(context: Context) = "${context.packageName}.ogs.mobile.v1"
    private const val MAX_BYTES = 32768

    private fun key(context: Context, create: Boolean): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val existing = store.getKey(alias(context), null) as? SecretKey
        if (existing != null) return existing
        if (!create) throw KeyPermanentlyInvalidatedException()
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(KeyGenParameterSpec.Builder(alias(context), KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true).build())
            generateKey()
        }
    }

    @JvmStatic @Synchronized
    fun access(context: Context, operation: String, value: String): String {
        val file = AtomicFile(File(context.noBackupFilesDir, "ogs.mobile.v1.enc"))
        return try {
            val answer = JSONObject()
            when (operation) {
                "read" -> if (file.baseFile.exists()) {
                    val bytes = file.openRead().use { input ->
                        val bytes = ByteArray(MAX_BYTES + 1)
                        var total = 0
                        while (total < bytes.size) {
                            val read = input.read(bytes, total, bytes.size - total)
                            if (read < 0) break
                            total += read
                        }
                        bytes.copyOf(total)
                    }
                    if (bytes.size !in 30..MAX_BYTES || bytes[0] != 1.toByte()) throw AEADBadTagException()
                    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                    cipher.init(Cipher.DECRYPT_MODE, key(context, false), GCMParameterSpec(128, bytes.copyOfRange(1, 13)))
                    cipher.updateAAD(context.packageName.toByteArray(Charsets.UTF_8))
                    answer.put("value", String(cipher.doFinal(bytes.copyOfRange(13, bytes.size)), Charsets.UTF_8))
                }
                "write" -> {
                    require(value.toByteArray(Charsets.UTF_8).size < MAX_BYTES - 29)
                    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
                    cipher.init(Cipher.ENCRYPT_MODE, key(context, true)) // AndroidKeyStore generates a fresh random IV
                    cipher.updateAAD(context.packageName.toByteArray(Charsets.UTF_8))
                    check(cipher.iv.size == 12)
                    val bytes = byteArrayOf(1) + cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
                    val stream = file.startWrite()
                    try { stream.write(bytes); file.finishWrite(stream) }
                    catch (e: Exception) { file.failWrite(stream); throw e }
                }
                "delete" -> {
                    file.delete()
                    check(!file.baseFile.exists())
                    KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(alias(context)) }
                }
                else -> error("operation")
            }
            answer.toString()
        } catch (_: KeyPermanentlyInvalidatedException) {
            JSONObject().put("error", "invalidated").toString()
        } catch (_: AEADBadTagException) {
            JSONObject().put("error", "invalidated").toString()
        } catch (_: Exception) {
            // No exception message, values or credential bytes ever cross JNI or reach logs.
            JSONObject().put("error", "unavailable").toString()
        }
    }
}
