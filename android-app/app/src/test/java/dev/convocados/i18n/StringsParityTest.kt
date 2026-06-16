package dev.convocados.i18n

import org.junit.Assert.assertEquals
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
    )

    @Test
    fun `default locale has all new keys`() {
        val res = javaClass.classLoader!!.getResource("values/strings.xml")
            ?: error("values/strings.xml not found")
        val parsed = parseResources(res.readText())
        for (key in newKeys) {
            assertTrue("Missing key in values/strings.xml: $key", parsed.containsKey(key))
        }
    }

    @Test
    fun `pt locale has all new keys`() {
        val res = javaClass.classLoader!!.getResource("values-pt/strings.xml")
            ?: error("values-pt/strings.xml not found")
        val parsed = parseResources(res.readText())
        for (key in newKeys) {
            assertTrue("Missing key in values-pt/strings.xml: $key", parsed.containsKey(key))
        }
    }

    @Test
    fun `es locale has all new keys`() {
        val res = javaClass.classLoader!!.getResource("values-es/strings.xml")
            ?: error("values-es/strings.xml not found")
        val parsed = parseResources(res.readText())
        for (key in newKeys) {
            assertTrue("Missing key in values-es/strings.xml: $key", parsed.containsKey(key))
        }
    }

    @Test
    fun `fr locale has all new keys`() {
        val res = javaClass.classLoader!!.getResource("values-fr/strings.xml")
            ?: error("values-fr/strings.xml not found")
        val parsed = parseResources(res.readText())
        for (key in newKeys) {
            assertTrue("Missing key in values-fr/strings.xml: $key", parsed.containsKey(key))
        }
    }

    @Test
    fun `de locale has all new keys`() {
        val res = javaClass.classLoader!!.getResource("values-de/strings.xml")
            ?: error("values-de/strings.xml not found")
        val parsed = parseResources(res.readText())
        for (key in newKeys) {
            assertTrue("Missing key in values-de/strings.xml: $key", parsed.containsKey(key))
        }
    }

    @Test
    fun `it locale has all new keys`() {
        val res = javaClass.classLoader!!.getResource("values-it/strings.xml")
            ?: error("values-it/strings.xml not found")
        val parsed = parseResources(res.readText())
        for (key in newKeys) {
            assertTrue("Missing key in values-it/strings.xml: $key", parsed.containsKey(key))
        }
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
