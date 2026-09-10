package dev.convocados.ui.screen.profile

import android.graphics.Bitmap
import android.net.Uri
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import dev.convocados.ui.theme.ConvocadosTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import java.io.FileOutputStream

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w411dp-h891dp")
class ProfilePhotoCropScreenTest {

    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun `shows the cropper actions for a picked image`() {
        val context = RuntimeEnvironment.getApplication()
        val file = File(context.cacheDir, "picked.png")
        FileOutputStream(file).use { out ->
            Bitmap.createBitmap(120, 80, Bitmap.Config.ARGB_8888)
                .compress(Bitmap.CompressFormat.PNG, 100, out)
        }

        composeRule.setContent {
            ConvocadosTheme {
                ProfilePhotoCropScreen(
                    imageUri = Uri.fromFile(file),
                    onCancel = {},
                    onConfirm = {},
                )
            }
        }

        composeRule.onNodeWithText("Profile photo").assertIsDisplayed()
        composeRule.onNodeWithText("Save photo").assertIsDisplayed()
        composeRule.onNodeWithText("Cancel").assertIsDisplayed()
    }
}
