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
    dependsOn(":app:syncPlayListingGraphics", ":wear:syncWearPlayListingGraphics", "syncPlayListingText")
}

// Store listing *text* is committed (store-listing/<lang>/) and staged into both
// modules' Play listing layout, so the copy that ships is reviewable in a diff
// instead of hand-edited in Play Console. `publishListing` then uploads it with
// the screenshots.
//
// Staging only. The rules about what the text must contain live in
// `scripts/check-play-listing.mjs` (`pnpm check:play-listing`), which is the one
// implementation CI tests; duplicating them here would give two answers.
//
// This task must NOT delete `.../listings/<lang>`: the sibling graphics tasks
// stage PNGs into `.../listings/<lang>/graphics/`, and Gradle guarantees no order
// between them, so wiping the directory would discard screenshots this same build
// just staged — silently, with both tasks printing success.
val playListingModules = listOf("app", "wear")

tasks.register("syncPlayListingText") {
    notCompatibleWithConfigurationCache("The task stages listing text with plain file I/O")
    val modules = playListingModules

    doLast {
        val textSource = project.file("store-listing")
        if (!textSource.isDirectory) {
            throw GradleException("Store-listing text directory is missing: $textSource")
        }
        val languages = textSource.listFiles()
            ?.filter { it.isDirectory }
            ?.map { it.name }
            ?.sorted()
            .orEmpty()
        if (languages.isEmpty()) {
            throw GradleException("No store-listing language directory under $textSource")
        }
        languages.forEach { language ->
            val sourceDir = textSource.resolve(language)
            val files = sourceDir.listFiles()
                ?.filter { it.isFile && it.extension == "txt" }
                ?.map { it.name }
                ?.sorted()
                .orEmpty()
            modules.forEach { module ->
                val targetDir = project.file("$module/src/main/play/listings/$language")
                targetDir.mkdirs()
                files.forEach { name ->
                    targetDir.resolve(name).writeText(sourceDir.resolve(name).readText().trim())
                }
            }
            println("store-listing/$language -> ${modules.joinToString()} (${files.size} text files)")
        }
    }
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
