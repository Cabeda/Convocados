package dev.convocados.wear.security

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Wear equivalent of the :app manifest guard — see
 * dev.convocados.security.ManifestSecurityConfigTest.
 */
class WearManifestSecurityConfigTest {

    private fun read(path: String): String {
        val file = File(path)
        check(file.exists()) { "expected $path to exist (cwd=${File(".").absolutePath})" }
        return file.readText()
    }

    private val manifest: String get() = read("src/main/AndroidManifest.xml")

    @Test
    fun `declares a network security config that forbids cleartext`() {
        assertTrue(
            manifest.contains("android:networkSecurityConfig=\"@xml/network_security_config\""),
        )
        val config = read("src/main/res/xml/network_security_config.xml")
        assertTrue(config.contains("cleartextTrafficPermitted=\"false\""))
    }

    @Test
    fun `declares backup rules and excludes the wear token store`() {
        assertTrue(manifest.contains("android:dataExtractionRules=\"@xml/data_extraction_rules\""))
        assertTrue(manifest.contains("android:fullBackupContent=\"@xml/backup_rules\""))

        val legacy = read("src/main/res/xml/backup_rules.xml")
        assertTrue(legacy.contains("path=\"convocados_wear_tokens.xml\""))

        val modern = read("src/main/res/xml/data_extraction_rules.xml")
        assertTrue(modern.contains("<cloud-backup>"))
        assertTrue(modern.contains("<device-transfer>"))
        assertTrue(modern.contains("path=\"convocados_wear_tokens.xml\""))
    }

    @Test
    fun `keeps auto backup enabled for the credential restore feature`() {
        assertTrue(manifest.contains("android:allowBackup=\"true\""))
        assertTrue(manifest.contains("WearRestoreCredentialBackupAgent"))
    }
}
