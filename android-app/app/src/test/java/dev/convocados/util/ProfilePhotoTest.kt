package dev.convocados.util

import org.junit.Assert.assertEquals
import org.junit.Test

class ProfilePhotoTest {

    @Test
    fun `coverScale uses the larger ratio so the image covers the viewport`() {
        // Landscape 800x600 in a 400px square: height is the limiting axis.
        assertEquals(400f / 600f, ProfilePhoto.coverScale(800, 600, 400), 0.0001f)
        // Portrait 600x800: width is the limiting axis.
        assertEquals(400f / 600f, ProfilePhoto.coverScale(600, 800, 400), 0.0001f)
    }

    @Test
    fun `coverScale falls back to 1 for degenerate sizes`() {
        assertEquals(1f, ProfilePhoto.coverScale(0, 100, 400), 0.0001f)
        assertEquals(1f, ProfilePhoto.coverScale(100, 100, 0), 0.0001f)
    }

    @Test
    fun `clampOffset keeps the image inside the viewport`() {
        // displayed 800, viewport 400 -> 200px of slack each side.
        assertEquals(200f, ProfilePhoto.clampOffset(500f, 800f, 400), 0.0001f)
        assertEquals(-200f, ProfilePhoto.clampOffset(-500f, 800f, 400), 0.0001f)
        assertEquals(50f, ProfilePhoto.clampOffset(50f, 800f, 400), 0.0001f)
    }

    @Test
    fun `clampOffset is zero when the image does not exceed the viewport`() {
        assertEquals(0f, ProfilePhoto.clampOffset(120f, 300f, 400), 0.0001f)
    }

    @Test
    fun `cropRect center-crops a landscape image`() {
        val rect = ProfilePhoto.cropRect(800, 600, 400, 1f, 0f, 0f)
        assertEquals(600, rect.width)
        assertEquals(600, rect.height)
        assertEquals(100, rect.left)
        assertEquals(0, rect.top)
    }

    @Test
    fun `cropRect zoom shrinks the source rectangle around the center`() {
        val rect = ProfilePhoto.cropRect(800, 600, 400, 2f, 0f, 0f)
        assertEquals(300, rect.width)
        assertEquals(300, rect.height)
        assertEquals(250, rect.left)
        assertEquals(150, rect.top)
    }

    @Test
    fun `cropRect pan moves the window across the image`() {
        // Positive x offset pans the image right, revealing pixels further left.
        val rect = ProfilePhoto.cropRect(800, 600, 400, 1f, 100f, 0f)
        assertEquals(600, rect.width)
        assertEquals(0, rect.left)
    }

    @Test
    fun `cropRect clamps to the image bounds`() {
        val rect = ProfilePhoto.cropRect(800, 600, 400, 1f, 10_000f, 10_000f)
        assertEquals(0, rect.left)
        assertEquals(0, rect.top)
        assertEquals(600, rect.width)
    }
}
