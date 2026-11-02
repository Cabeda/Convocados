package dev.convocados.i18n

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the captain add/drop form i18n keys exist in all 6 supported
 * locales, mirroring the web `src/lib/i18n` parity.
 */
class CaptainCrewStringsParityTest {
    private val captainKeys = listOf(
        "captain_tools",
        "captain_tools_for",
        "captain_select_player",
        "captain_add_player",
        "captain_remove_player",
        "captain_change_submitted",
    )

    @Test
    fun `all locales have the captain tools keys`() {
        for (suffix in listOf("", "-pt", "-es", "-fr", "-de", "-it")) {
            val parsed = parseResources(readStringsFile(suffix))
            for (key in captainKeys) {
                assertTrue("Missing key in values$suffix/strings.xml: $key", parsed.containsKey(key))
            }
        }
    }

    private fun readStringsFile(localeSuffix: String): String {
        val file = File("src/main/res/values$localeSuffix/strings.xml")
        check(file.isFile) { "strings.xml not found at ${file.absolutePath}" }
        return file.readText()
    }

    private fun parseResources(xml: String): Map<String, String> {
        val result = mutableMapOf<String, String>()
        val regex = Regex("""<string\s+name="([^"]+)"\s*>([^<]*)</string>""")
        for (match in regex.findAll(xml)) {
            result[match.groupValues[1]] = match.groupValues[2]
        }
        return result
    }
}
