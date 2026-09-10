package dev.convocados.util

import android.graphics.Bitmap
import android.util.Base64
import java.io.ByteArrayOutputStream
import kotlin.math.max
import kotlin.math.roundToInt

/** Source rectangle, in image pixels, selected by the cropper. */
data class CropRect(val left: Int, val top: Int, val width: Int, val height: Int)

/**
 * Profile photo geometry + encoding, mirroring the web uploader.
 *
 * The cropper shows the image covering a square viewport; the user can zoom
 * and pan. [cropRect] maps that view back to source-image pixels, and [encode]
 * re-encodes the result to a 512×512 JPEG data URL (stripping EXIF).
 */
object ProfilePhoto {
    const val DIMENSION = 512
    const val QUALITY = 85
    const val MIN_ZOOM = 1f
    const val MAX_ZOOM = 4f

    /** Scale that makes an image exactly cover a square viewport. */
    fun coverScale(imageWidth: Int, imageHeight: Int, viewport: Int): Float {
        if (imageWidth <= 0 || imageHeight <= 0 || viewport <= 0) return 1f
        return max(viewport.toFloat() / imageWidth, viewport.toFloat() / imageHeight)
    }

    /** Clamp a pan offset so the image never reveals empty space in the viewport. */
    fun clampOffset(offset: Float, displayedSize: Float, viewport: Int): Float {
        val limit = ((displayedSize - viewport) / 2f).coerceAtLeast(0f)
        return offset.coerceIn(-limit, limit)
    }

    /**
     * Map the visible square (given user [zoom] and pan [offsetX]/[offsetY] in
     * viewport pixels) back to a source rectangle, clamped to the image bounds.
     */
    fun cropRect(
        imageWidth: Int,
        imageHeight: Int,
        viewport: Int,
        zoom: Float,
        offsetX: Float,
        offsetY: Float,
    ): CropRect {
        val effective = coverScale(imageWidth, imageHeight, viewport) * zoom
        val cropWidth = (viewport / effective).roundToInt().coerceIn(1, imageWidth)
        val cropHeight = (viewport / effective).roundToInt().coerceIn(1, imageHeight)
        val left = ((imageWidth - cropWidth) / 2f - offsetX / effective)
            .roundToInt().coerceIn(0, imageWidth - cropWidth)
        val top = ((imageHeight - cropHeight) / 2f - offsetY / effective)
            .roundToInt().coerceIn(0, imageHeight - cropHeight)
        return CropRect(left, top, cropWidth, cropHeight)
    }

    /** Crop a source bitmap to [rect]. */
    fun crop(source: Bitmap, rect: CropRect): Bitmap =
        Bitmap.createBitmap(source, rect.left, rect.top, rect.width, rect.height)

    /** Re-encode a bitmap to a square JPEG data URL accepted by `POST /api/me/photo`. */
    fun encode(bitmap: Bitmap, dimension: Int = DIMENSION, quality: Int = QUALITY): String {
        val scaled = Bitmap.createScaledBitmap(bitmap, dimension, dimension, true)
        val out = ByteArrayOutputStream()
        scaled.compress(Bitmap.CompressFormat.JPEG, quality, out)
        if (scaled !== bitmap) scaled.recycle()
        return "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }
}
