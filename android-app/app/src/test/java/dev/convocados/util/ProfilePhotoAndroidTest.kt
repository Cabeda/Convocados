package dev.convocados.util

import android.graphics.Bitmap
import android.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ProfilePhotoAndroidTest {

    @Test
    fun `crop returns the requested region`() {
        val source = Bitmap.createBitmap(100, 80, Bitmap.Config.ARGB_8888)
        val cropped = ProfilePhoto.crop(source, CropRect(10, 20, 30, 40))
        assertEquals(30, cropped.width)
        assertEquals(40, cropped.height)
    }

    @Test
    fun `encode produces a jpeg data url`() {
        val source = Bitmap.createBitmap(800, 600, Bitmap.Config.ARGB_8888)
        val url = ProfilePhoto.encode(source)
        assertTrue(url.startsWith("data:image/jpeg;base64,"))
        val bytes = Base64.decode(url.substringAfter("base64,"), Base64.DEFAULT)
        assertTrue(bytes.isNotEmpty())
    }
}
