package dev.convocados.util

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent

/**
 * Opens a public web URL in a Custom Tab, falling back to the default browser
 * when no Custom Tabs provider is installed.
 */
fun Context.openInCustomTab(url: String) {
    val uri = Uri.parse(url)
    val launched = runCatching {
        CustomTabsIntent.Builder().build().launchUrl(this, uri)
    }.isSuccess
    if (!launched) {
        runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
    }
}
