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
// instead of hand-edited in Play Console. `publishListing` uploads it alongside
// the screenshots.
//
// The store-listing *icon* (store-listing/<lang>/icon.png) is committed and staged
// the same way. Play fills the listing's icon once, from the first bundle it sees,
// and never derives it again — so an icon that exists only in Play Console is stale
// for good. That is what left the pre-whistle "C" glyph on the store page after the
// launcher icon changed: the bundle moved, the listing's copy of it did not.
//
// Staging only. The rules about what the text must contain live in
// `scripts/check-play-listing.mjs` (`pnpm check:play-listing`): one
// implementation, tested, run by both gates. Duplicating them here would give two
// answers.
//
// This task must NOT delete `.../listings/<lang>`: the sibling graphics tasks
// stage PNGs into `.../listings/<lang>/graphics/`, and Gradle guarantees no order
// between them, so wiping the directory would discard screenshots this same build
// just staged — silently, with both tasks reporting success.
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
                // Clear stale text — a field removed from the source must not linger
                // in the layout, or publishListing uploads it. Only *.txt, and
                // never the directory: the graphics tasks stage into
                // .../listings/en-US/graphics/ and hardcode that language, so
                // deleting a language directory here could delete screenshots.
                targetDir.listFiles()
                    ?.filter { it.isFile && it.extension == "txt" }
                    ?.filter { it.name !in files }
                    ?.forEach { stale ->
                        stale.delete()
                        println("removed stale listing text $module/$language/${stale.name}")
                    }
                files.forEach { name ->
                    targetDir.resolve(name).writeText(sourceDir.resolve(name).readText().trim())
                }
            }
            println("store-listing/$language -> ${modules.joinToString()} (${files.size} text files)")

            // GPP 4.x reads images from listings/<lang>/graphics/<slot>/ (ConstantsKt
            // GRAPHICS_PATH), so an icon dropped straight into listings/<lang>/ would
            // be uploaded as nothing — the silent no-op this staging exists to avoid.
            val icon = sourceDir.resolve("icon.png")
            if (!icon.isFile) {
                throw GradleException("Missing store-listing icon: $icon")
            }
            modules.forEach { module ->
                val iconDir = project.file("$module/src/main/play/listings/$language/graphics/icon")
                iconDir.mkdirs()
                icon.copyTo(iconDir.resolve("icon.png"), overwrite = true)
            }
        }

        // A language dropped from the source is never visited above. Clear its
        // text the same way — per file, never the directory — so a removed locale
        // stops being uploaded without touching a sibling task's screenshots.
        modules.forEach { module ->
            val listingsRoot = project.file("$module/src/main/play/listings")
            listingsRoot.listFiles()
                ?.filter { it.isDirectory && it.name !in languages }
                ?.forEach { staleLanguage ->
                    staleLanguage.listFiles()
                        ?.filter { it.isFile && it.extension == "txt" }
                        ?.forEach { stale ->
                            stale.delete()
                            println("removed stale listing text $module/${staleLanguage.name}/${stale.name}")
                        }
                    // The icon this task staged for that locale would keep the
                    // directory alive and keep uploading for a language that no
                    // longer exists. Only graphics/icon/ — never the whole graphics
                    // tree, which a sibling task owns.
                    staleLanguage.resolve("graphics/icon").deleteRecursively()
                    // Remove the directory only if it is now empty. A directory
                    // that still holds graphics/ is not empty, so this can never
                    // take a sibling task's screenshots with it.
                    if (staleLanguage.listFiles().isNullOrEmpty()) {
                        staleLanguage.delete()
                        println("removed empty listing directory $module/${staleLanguage.name}")
                    }
                }
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
