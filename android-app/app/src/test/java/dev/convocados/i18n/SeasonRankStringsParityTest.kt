package dev.convocados.i18n

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Verifies the Season Rank reveal / explainer i18n keys exist in all 6
 * supported locales, mirroring the web `src/test/i18n.test.ts` parity check.
 */
class SeasonRankStringsParityTest {
    private val rankKeys = listOf(
        "post_game_rank_standing_title",
        "post_game_rank_updated_title",
        "post_game_rank_delta",
        "post_game_rank_unlock",
        "post_game_rank_tier_up",
        "post_game_rank_to_next",
        "post_game_rank_why",
        "post_game_rank_why_aria",
        "post_game_rank_dismiss",
        "post_game_rank_cue",
        "post_game_rank_view_season",
        "post_game_rank_view_season_aria",
        "post_game_rank_crew_label",
        "post_game_rank_crew_place",
        "post_game_rank_crew_points",
        "post_game_rank_crew_points_delta",
        "post_game_result_eyebrow",
        "post_game_show_tasks",
        "post_game_no_score_yet",
        "season_rank_top_tier",
        "season_rank_how_it_works",
        "rank_explainer_link_desc",
    )

    @Test
    fun `all locales have the Season Rank keys`() {
        for (suffix in listOf("", "-pt", "-es", "-fr", "-de", "-it")) {
            val parsed = parseResources(readStringsFile(suffix))
            for (key in rankKeys) {
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
