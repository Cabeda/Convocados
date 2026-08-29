import java.util.Properties
import javax.imageio.ImageIO

plugins {
    id("com.android.application")
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.hilt.android)
    alias(libs.plugins.ksp)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.google.services)
    alias(libs.plugins.firebase.crashlytics)
    alias(libs.plugins.play.publisher)
    alias(libs.plugins.baselineprofile)
    alias(libs.plugins.roborazzi)
}

val localProperties = Properties().apply {
    val file = rootProject.file("local.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}

val keystoreProperties = Properties().apply {
    val file = rootProject.file("keystore.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}

android {
    namespace = "dev.convocados"
    compileSdk = 37

    signingConfigs {
        create("release") {
            val storePath = keystoreProperties.getProperty("storeFile", "")
            if (storePath.isNotBlank()) {
                val ksFile = rootProject.file(storePath)
                if (ksFile.exists()) {
                    storeFile = ksFile
                    storePassword = keystoreProperties.getProperty("storePassword", "")
                    keyAlias = keystoreProperties.getProperty("keyAlias", "")
                    keyPassword = keystoreProperties.getProperty("keyPassword", "")
                }
            }
        }
    }

    defaultConfig {
        applicationId = "com.cabeda.Convocados"
        minSdk = 26
        targetSdk = 36
        versionCode = (System.currentTimeMillis() / 1000 / 60).toInt()
        versionName = "1.2.0"
        manifestPlaceholders["appAuthRedirectScheme"] = "convocados"

        buildConfigField(
            "String",
            "GOOGLE_SERVER_CLIENT_ID",
            "\"${localProperties.getProperty("GOOGLE_SERVER_CLIENT_ID", "")}\""
        )
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // Use the production keystore when configured (CI/release); otherwise fall
            // back to debug signing so the baseline-profile variants (nonMinifiedRelease /
            // benchmarkRelease) can still be built and installed locally.
            val hasReleaseKeystore = keystoreProperties.getProperty("storeFile", "").isNotBlank() &&
                rootProject.file(keystoreProperties.getProperty("storeFile", "")).exists()
            signingConfig = if (hasReleaseKeystore) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    testOptions {
        unitTests {
            isIncludeAndroidResources = true
        }
    }
}

play {
    track.set("internal")
    defaultToAppBundles.set(true)
    val credFile = rootProject.file("play-service-account.json")
    if (credFile.exists()) {
        serviceAccountCredentials.set(credFile)
    }
}

// Google Play requires apps to target a recent API level (Android 16 / API 36 as of 2026)
// or they can no longer be updated. Guard against accidental regression.
val googlePlayMinTargetSdk = 36

// Read build values at configuration time and capture them as simple types —
// referencing `android`/script objects inside doLast breaks the
// configuration cache.
val appTargetSdk = android.defaultConfig.targetSdk
tasks.register("validateTargetSdk") {
    val target = appTargetSdk
    val minTargetSdk = googlePlayMinTargetSdk
    doLast {
        if (target == null || target < minTargetSdk) {
            throw GradleException(
                "targetSdk ($target) is below the Google Play minimum ($minTargetSdk). " +
                "Bump targetSdk in build.gradle.kts before publishing."
            )
        }
    }
}

tasks.matching { it.name.contains("Release") && it.name.startsWith("assemble") || it.name.startsWith("bundle") }
    .configureEach { dependsOn("validateTargetSdk") }

val storeListingSource = project.file("src/test/screenshots/store-listing")
val storeListingOutput = rootProject.file("artifacts/store-listing")
val storeListingNames = listOf(
    "event_dark.png",
    "event_light.png",
    "games_dark.png",
    "games_light.png",
    "profile_dark.png",
    "profile_light.png",
    "stats_dark.png",
    "stats_light.png",
)
val storeListingDimensions = mapOf(
    "phone" to (411 to 891),
    "tablet" to (840 to 900),
    "foldable" to (673 to 841),
)

tasks.register("generateStoreListing") {
    notCompatibleWithConfigurationCache("The task validates and copies generated PNGs using JVM image tooling")
    dependsOn("verifyRoborazziDebug")

    doLast {
        if (!storeListingSource.isDirectory) {
            throw GradleException("Store-listing screenshot source directory is missing: $storeListingSource")
        }

        val expectedFiles = storeListingDimensions.keys
            .flatMap { formFactor -> storeListingNames.map { name -> "$formFactor/$name" } }
            .toSet()
        val actualFiles = storeListingSource.walkTopDown()
            .filter { it.isFile && it.extension == "png" }
            .map { it.relativeTo(storeListingSource).invariantSeparatorsPath }
            .toSet()
        if (actualFiles != expectedFiles) {
            throw GradleException(
                "Expected exactly ${expectedFiles.size} store-listing PNGs, " +
                    "but found ${actualFiles.size}: ${actualFiles.sorted()}"
            )
        }

        storeListingDimensions.keys.forEach { formFactor ->
            storeListingOutput.resolve(formFactor).deleteRecursively()
        }
        storeListingOutput.mkdirs()
        storeListingSource.copyRecursively(storeListingOutput, overwrite = true)

        storeListingDimensions.forEach { (formFactor, dimensions) ->
            storeListingNames.forEach { name ->
                val relativePath = "$formFactor/$name"
                val source = storeListingSource.resolve(relativePath)
                val artifact = storeListingOutput.resolve(relativePath)
                listOf(source, artifact).forEach { imageFile ->
                    val image = ImageIO.read(imageFile)
                        ?: throw GradleException("Unable to read store-listing PNG: $imageFile")
                    if (image.width != dimensions.first || image.height != dimensions.second) {
                        throw GradleException(
                            "$imageFile is ${image.width}x${image.height}; " +
                                "expected ${dimensions.first}x${dimensions.second} for $formFactor"
                        )
                    }
                }
            }
        }

        println(
            "Generated ${expectedFiles.size} store-listing screenshots in ${storeListingOutput.absolutePath}"
        )
    }
}


dependencies {
    implementation(project(":design-system"))

    // Compose BOM
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material3.adaptive.navigation.suite)
    implementation(libs.androidx.compose.material3.window.size)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.animation)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material.icons.extended)
    debugImplementation(libs.androidx.compose.ui.tooling)

    // Core
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)

    // Navigation
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.hilt.navigation.compose)

    // Hilt DI
    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)

    // Networking
    implementation(libs.ktor.client.core)
    implementation(libs.ktor.client.okhttp)
    implementation(libs.ktor.client.content.negotiation)
    implementation(libs.ktor.serialization.kotlinx.json)
    implementation(libs.ktor.client.auth)
    implementation(libs.ktor.client.logging)

    // Serialization
    implementation(libs.kotlinx.serialization.json)

    // DataStore (preferences)
    implementation(libs.androidx.datastore.preferences)

    // Security (encrypted shared prefs for tokens)
    implementation(libs.androidx.security.crypto)

    // Browser (Custom Tabs for OAuth — kept as fallback)
    implementation(libs.androidx.browser)
    implementation(libs.androidx.appcompat)

    // Credential Manager (native auth: Google Sign-In, passwords, passkeys)
    implementation(libs.androidx.credentials)
    implementation(libs.androidx.credentials.play)
    implementation(libs.google.id.identity)

    // Splash screen
    implementation(libs.androidx.core.splashscreen)

    // Baseline profile installer — compiles the bundled baseline-prof.txt at install
    // time for faster cold start and smoother first scroll.
    implementation(libs.androidx.profileinstaller)
    // Consumes the generated profile from the :baselineprofile module.
    baselineProfile(project(":baselineprofile"))

    // WorkManager
    implementation(libs.androidx.work.runtime.ktx)
    implementation(libs.androidx.hilt.work)
    ksp(libs.androidx.hilt.compiler)

    // Firebase
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)
    implementation(libs.firebase.crashlytics)

    // Accompanist (Permissions)
    implementation(libs.accompanist.permissions)

    // Image loading (profile avatars)
    implementation(libs.coil.compose)
    // Coil 3 does not fetch HTTP(S) without a network component; without this,
    // every remote avatar fails and falls back to the initial placeholder.
    implementation(libs.coil.network.okhttp)

    // OSM Maps
    implementation(libs.osmdroid)

    // Wearable Data Layer (sync auth tokens to watch)
    implementation(libs.play.services.wearable)

    // Room
    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)

    // Testing
    testImplementation(libs.junit)
    testImplementation(libs.mockk)
    testImplementation(libs.turbine)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.ktor.client.mock)
    // Screenshot testing (JVM, no device) via Roborazzi + Robolectric
    testImplementation(libs.robolectric)
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
    testImplementation(libs.roborazzi.junit.rule)
    testImplementation(libs.androidx.compose.ui.test.junit4)
    testImplementation(libs.coil.test)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
}
