package dev.convocados.ui.screen.create

import java.io.File
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Mirrors the web tests in src/test/randomTitles.test.ts and i18n.test.ts:
 * every supported locale has a non-empty pool, results always come from the
 * right pool, unknown locales fall back to English, and the generator actually
 * varies. A dedicated parity test parses the web source of truth
 * (src/lib/randomTitles.ts) so the Android pools can never drift from web.
 */
class RandomTitlesTest {

    @Test
    fun `every supported locale has a non-empty pool`() {
        for ((locale, pool) in RandomTitles.titles) {
            assertTrue("Pool for $locale is empty", pool.isNotEmpty())
            for (title in pool) {
                assertTrue("Blank title in $locale pool", title.isNotBlank())
            }
        }
    }

    @Test
    fun `returned title belongs to requested locale pool`() {
        for ((locale, pool) in RandomTitles.titles) {
            repeat(20) {
                val title = RandomTitles.getRandomTitle(locale)
                assertTrue(
                    "\"$title\" not in $locale pool",
                    title in pool,
                )
            }
        }
    }

    @Test
    fun `non-english pools differ from english`() {
        val en = RandomTitles.titles.getValue("en")
        for ((locale, pool) in RandomTitles.titles) {
            if (locale == "en") continue
            assertNotEquals("Pool $locale identical to en", en, pool)
        }
    }

    @Test
    fun `unknown locale falls back to english`() {
        repeat(20) {
            val title = RandomTitles.getRandomTitle("xx")
            assertTrue(title in RandomTitles.titles.getValue("en"))
        }
    }

    @Test
    fun `generator produces varied titles across calls`() {
        val seen = mutableSetOf<String>()
        repeat(100) { seen.add(RandomTitles.getRandomTitle("en")) }
        assertTrue("Expected variety, got ${seen.size} unique", seen.size > 5)
    }

    @Test
    fun `current locale maps device language to supported locale`() {
        assertEquals("en", RandomTitles.resolveSupportedLocale(Locale.forLanguageTag("zz")))
        assertEquals("pt", RandomTitles.resolveSupportedLocale(Locale.forLanguageTag("pt")))
        assertEquals("en", RandomTitles.resolveSupportedLocale(Locale.forLanguageTag("en")))
    }

    @Test
    fun `pools match the web source of truth`() {
        // Web randomTitles.ts lives two levels above the app module; unit
        // tests run with the module directory as their working directory.
        val webFile = File("../../src/lib/randomTitles.ts")
        check(webFile.isFile) { "Web source of truth not found at ${webFile.absolutePath}" }
        val webPools = parseWebPools(webFile.readText())
        assertEquals(RandomTitles.titles.keys, webPools.keys)
        for ((locale, expected) in webPools) {
            assertEquals(
                "Android $locale pool drifted from web src/lib/randomTitles.ts",
                expected,
                RandomTitles.titles.getValue(locale),
            )
        }
    }

    /** Extracts `xx: [ ... ]` blocks from randomTitles.ts and the quoted strings within. */
    private fun parseWebPools(source: String): Map<String, List<String>> {
        val blockRegex = Regex("""(\w\w):\s*\[(.*?)]""", RegexOption.DOT_MATCHES_ALL)
        val stringRegex = Regex("\"([^\"]*)\"")
        return blockRegex.findAll(source).associate { match ->
            match.groupValues[1] to stringRegex.findAll(match.groupValues[2]).map { it.groupValues[1] }.toList()
        }
    }
}
