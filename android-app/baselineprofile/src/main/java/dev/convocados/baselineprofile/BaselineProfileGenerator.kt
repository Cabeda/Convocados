package dev.convocados.baselineprofile

import androidx.benchmark.macro.junit4.BaselineProfileRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Until
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Generates a baseline profile by exercising the cold-start critical path and
 * the main games list. Run with:
 *
 *   ./gradlew :app:generateReleaseBaselineProfile
 *
 * on a connected device/emulator. Output replaces app/src/main/baseline-prof.txt.
 */
@RunWith(AndroidJUnit4::class)
class BaselineProfileGenerator {

    @get:Rule
    val rule = BaselineProfileRule()

    @Test
    fun generate() = rule.collect(
        packageName = PACKAGE_NAME,
        includeInStartupProfile = true,
    ) {
        pressHome()
        startActivityAndWait()

        // Let the first screen (login or games list) settle and scroll it so the
        // list item composables and adapters are exercised.
        device.waitForIdle()
        device.findObject(By.scrollable(true))?.let { scrollable ->
            repeat(2) { scrollable.scroll(androidx.test.uiautomator.Direction.DOWN, 0.8f) }
            scrollable.scroll(androidx.test.uiautomator.Direction.UP, 1.0f)
        }
        device.waitForIdle()
    }

    private companion object {
        const val PACKAGE_NAME = "com.cabeda.Convocados"
    }
}
