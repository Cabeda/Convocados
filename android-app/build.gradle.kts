plugins {
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.hilt.android) apply false
    alias(libs.plugins.ksp) apply false
    alias(libs.plugins.google.services) apply false
    alias(libs.plugins.firebase.crashlytics) apply false
    alias(libs.plugins.play.publisher) apply false
    alias(libs.plugins.android.test) apply false
    alias(libs.plugins.baselineprofile) apply false
    alias(libs.plugins.roborazzi) apply false
}

tasks.register("generateStoreListings") {
    dependsOn(":app:generateStoreListing", ":wear:generateWearStoreListing")
}

// Validates + copies phone and Wear screenshots into the Play listing layout.
// CI runs this on every release before publishListing; never commit the output
// (see .gitignore) — the committed Roborazzi sources are the source of truth.
tasks.register("syncPlayListings") {
    dependsOn(":app:syncPlayListingGraphics", ":wear:syncWearPlayListingGraphics")
}

// Hilt 2.60.1 natively supports Kotlin 2.3.21 metadata.
// Force kotlin-metadata-jvm to match Kotlin version as a safety net.
allprojects {
    configurations.all {
        resolutionStrategy {
            force("org.jetbrains.kotlin:kotlin-metadata-jvm:2.3.21")
        }
    }
}
