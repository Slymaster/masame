package com.sylvainrey.masame

import android.content.Context
import android.content.ContextWrapper
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File

/** A separate package alias and directory: never touches the owner's actual OGS credentials. */
class OgsVaultTest {
    private val context = object : ContextWrapper(InstrumentationRegistry.getInstrumentation().targetContext) {
        override fun getPackageName() = super.getPackageName() + ".ogs_vault_test"
        override fun getNoBackupFilesDir(): File = File(super.getNoBackupFilesDir(), "ogs-vault-test").apply { mkdirs() }
    }
    private fun access(op: String, value: String = "") = JSONObject(OgsVault.access(context, op, value))

    @Test fun ciphertextRoundTripRotationTamperAndDelete() {
        try {
            assertFalse(access("delete").has("error"))
            assertFalse(access("read").has("value"))
            val secret = "{\"refresh\":\"fixture-never-a-real-token\"}"
            assertFalse(access("write", secret).has("error"))
            assertEquals(secret, access("read").getString("value"))
            val file = File(context.noBackupFilesDir, "ogs.mobile.v1.enc")
            val first = file.readBytes()
            assertFalse(String(first, Charsets.ISO_8859_1).contains("fixture-never-a-real-token"))
            assertFalse(access("write", secret).has("error"))
            assertFalse(first.copyOfRange(1, 13).contentEquals(file.readBytes().copyOfRange(1, 13)))
            val altered = file.readBytes(); altered[altered.lastIndex] = (altered.last().toInt() xor 1).toByte(); file.writeBytes(altered)
            assertEquals("invalidated", access("read").getString("error"))
            assertFalse(access("delete").has("error"))
            assertFalse(access("read").has("value"))
        } finally { access("delete") }
    }
}
