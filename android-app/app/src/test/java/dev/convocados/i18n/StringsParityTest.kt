package dev.convocados.i18n

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the add-player confirmation i18n keys exist in all 6 supported
 * locales. Mirrors the web `src/test/i18n.test.ts` parity check.
 */
class StringsParityTest {
    private val newKeys = listOf(
        "add_player_confirm_title",
        "add_player_confirm_desc",
        "add_player_confirm_desc_email",
        "add_player_confirm_desc_bench",
        "add_player_confirm_desc_both",
        "add_player_in_flight",
        "anonymous_player",
    )

    @Test
    fun `default locale has all new keys`() {
        val parsed = parseResources(readStringsFile(""))
        for (key in newKeys) {
            assertTrue("Missing key in values/strings.xml: $key", parsed.containsKey(key))
        }
    }

    @Test
    fun `pt locale has all new keys`() {
        val parsed = parseResources(readStringsFile("-pt"))
        for (key in newKeys) {
            assertTrue("Missing key in values-pt/strings.xml: $key", parsed.containsKey(key))
        }
    }

    @Test
    fun `es locale has all new keys`() {
        val parsed = parseResources(readStringsFile("-es"))
        for (key in newKeys) {
            assertTrue("Missing key in values-es/strings.xml: $key", parsed.containsKey(key))
        }
    }

    @Test
    fun `fr locale has all new keys`() {
        val parsed = parseResources(readStringsFile("-fr"))
        for (key in newKeys) {
            assertTrue("Missing key in values-fr/strings.xml: $key", parsed.containsKey(key))
        }
    }

    @Test
    fun `de locale has all new keys`() {
        val parsed = parseResources(readStringsFile("-de"))
        for (key in newKeys) {
            assertTrue("Missing key in values-de/strings.xml: $key", parsed.containsKey(key))
        }
    }

    @Test
    fun `it locale has all new keys`() {
        val parsed = parseResources(readStringsFile("-it"))
        for (key in newKeys) {
            assertTrue("Missing key in values-it/strings.xml: $key", parsed.containsKey(key))
        }
    }

    /**
     * Loads the raw production strings.xml for the given locale suffix from the
     * module's source tree. Unit tests run with the module directory as their
     * working directory, and AGP merges resources into values.xml at build time,
     * so the raw files can only be read reliably from src/main/res on disk.
     */
    private fun readStringsFile(localeSuffix: String): String {
        val file = File("src/main/res/values$localeSuffix/strings.xml")
        check(file.isFile) { "strings.xml not found at ${file.absolutePath}" }
        return file.readText()
    }

    /**
     * Minimal strings.xml parser: extracts <string name="key">value</string>
     * entries. Sufficient for parity checks; doesn't try to handle escapes
     * beyond the common ones.
     */
    private fun parseResources(xml: String): Map<String, String> {
        val result = mutableMapOf<String, String>()
        val regex = Regex("""<string\s+name="([^"]+)"\s*>([^<]*)</string>""")
        for (match in regex.findAll(xml)) {
            result[match.groupValues[1]] = match.groupValues[2]
        }
        return result
    }
}
