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
// instead of hand-edited in Play Console. Play's Wear App Quality Guidelines
// reject a listing that does not describe the watch features the app ships — the
// quick-game tile shipped in code while the description never mentioned it, and
// Play rejected the release. This task is the gate that stops that recurring: it
// fails the release when a Wear surface the manifest declares is missing from the
// description, and when the text is outside Play's per-field limits.
//
// Both modules share one applicationId (com.cabeda.Convocados), so the phone and
// the Wear listing are the same listing: the same text is staged for both.
val playListingModules = listOf("app", "wear")
val playListingTextLimits = mapOf(
    "title.txt" to 30,
    "short_description.txt" to 80,
    "full_description.txt" to 4000,
)

// Wear surfaces Play expects a listing to mention, each keyed to where the feature
// is declared. Adding a surface means adding a line to the description, and the
// release fails until it does.
val playListingWearSurfaces = mapOf(
    "BIND_TILE_PROVIDER" to "tile",
    "wear.ongoing" to "ongoing",
)

tasks.register("syncPlayListingText") {
    notCompatibleWithConfigurationCache("The task stages and validates listing text with plain file I/O")
    val modules = playListingModules
    val limits = playListingTextLimits
    val surfaces = playListingWearSurfaces

    doLast {
        val textSource = project.file("store-listing")
        val wearManifest = project.file("wear/src/main/AndroidManifest.xml")
        val wearBuildFile = project.file("wear/build.gradle.kts")
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

        val description = mutableMapOf<String, String>()
        languages.forEach { language ->
            val sourceDir = textSource.resolve(language)
            val text = mutableMapOf<String, String>()
            limits.keys.forEach { name ->
                val source = sourceDir.resolve(name)
                // Play replaces the whole listing resource per language, so a
                // missing field is not "unchanged" — it clears the store page.
                if (!source.isFile) {
                    throw GradleException(
                        "Missing $language/$name. Every language must carry all of " +
                            "${limits.keys.joinToString()}: Play's listing update replaces the whole resource."
                    )
                }
                val value = source.readText().trim()
                val limit = limits.getValue(name)
                if (value.isEmpty()) {
                    throw GradleException("$language/$name is empty")
                }
                if (value.length > limit) {
                    throw GradleException("$language/$name is ${value.length} characters; Play allows $limit")
                }
                text[name] = value
            }
            description[language] = text.getValue("full_description.txt").lowercase()

            modules.forEach { module ->
                val targetDir = project.file("$module/src/main/play/listings/$language")
                targetDir.deleteRecursively()
                targetDir.mkdirs()
                text.forEach { (name, value) -> targetDir.resolve(name).writeText(value) }
                println("store-listing/$language -> $module (${text.size} fields)")
            }
        }

        if (!wearManifest.isFile || !wearBuildFile.isFile) {
            throw GradleException("Wear manifest or build file is missing; cannot check the listing against it")
        }
        val declared = (wearManifest.readText() + wearBuildFile.readText()).lowercase()
        surfaces.forEach { (declaration, keyword) ->
            if (declared.contains(declaration.lowercase())) {
                val missing = languages.filterNot { description.getValue(it).contains(keyword) }
                if (missing.isNotEmpty()) {
                    throw GradleException(
                        "The Wear app declares \"$declaration\", so the store listing must mention " +
                            "\"$keyword\" (Play's Wear App Quality Guidelines). Missing in: " +
                            missing.joinToString()
                    )
                }
                println("store listing mentions $keyword (declared by \"$declaration\")")
            }
        }
        println("Synced store-listing text for ${languages.joinToString()} into ${modules.joinToString()}")
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
