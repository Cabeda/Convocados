import java.util.Properties
import javax.imageio.ImageIO

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.hilt.android)
    alias(libs.plugins.ksp)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.play.publisher)
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

val wearEnv = Properties().apply {
    // Read from .env.wear.local (gitignored, personal creds) or .env.wear (template)
    val localEnv = rootProject.file(".env.wear.local")
    val templateEnv = rootProject.file(".env.wear")
    val envFile = if (localEnv.exists()) localEnv else templateEnv
    if (envFile.exists()) envFile.inputStream().use { load(it) }
}

android {
    namespace = "dev.convocados.wear"
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
        minSdk = 30
        targetSdk = 36
        versionCode = (System.currentTimeMillis() / 1000 / 60).toInt()
        versionName = "1.0.2"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        buildConfigField(
            "String",
            "GOOGLE_SERVER_CLIENT_ID",
            "\"${localProperties.getProperty("GOOGLE_SERVER_CLIENT_ID", "")}\""
        )
        buildConfigField(
            "String",
            "WEAR_DEV_EMAIL",
            "\"${wearEnv.getProperty("WEAR_DEV_EMAIL", "")}\""
        )
        buildConfigField(
            "String",
            "WEAR_DEV_PASSWORD",
            "\"${wearEnv.getProperty("WEAR_DEV_PASSWORD", "")}\""
        )
    }

    testOptions {
        unitTests.isIncludeAndroidResources = true
        unitTests.isReturnDefaultValues = true
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("release")
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
    composeCompiler {
        stabilityConfigurationFiles.add(
            rootProject.layout.projectDirectory.file("wear/stability-config.txt"),
        )
    }
}

play {
    track.set("wear:internal")
    defaultToAppBundles.set(true)
    val credFile = rootProject.file("play-service-account.json")
    if (credFile.exists()) {
        serviceAccountCredentials.set(credFile)
    }
}

// Read build values at configuration time and capture them as simple types —
// referencing script objects (`localProperties`, `android`) inside doLast
// breaks the configuration cache.
val wearGoogleClientId = localProperties.getProperty("GOOGLE_SERVER_CLIENT_ID", "")
tasks.register("validateGoogleClientId") {
    val clientId = wearGoogleClientId
    doLast {
        if (clientId.isBlank()) {
            throw GradleException(
                "GOOGLE_SERVER_CLIENT_ID is not set in local.properties. " +
                "Google Sign-In will fail at runtime. Add:\n" +
                "GOOGLE_SERVER_CLIENT_ID=<your-web-client-id>.apps.googleusercontent.com"
            )
        }
    }
}

// Google Play requires apps to target a recent API level (Android 16 / API 36 as of 2026)
// or they can no longer be updated. Guard against accidental regression.
val googlePlayMinTargetSdk = 36

val wearTargetSdk = android.defaultConfig.targetSdk
tasks.register("validateTargetSdk") {
    val target = wearTargetSdk
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
    .configureEach { dependsOn("validateGoogleClientId", "validateTargetSdk") }

val wearStoreListingSource = project.file("src/test/screenshots/store-listing")
val wearStoreListingOutput = rootProject.file("artifacts/store-listing/wear")
val wearStoreListingNames = listOf("games.png", "live_score.png", "quick_game.png", "history.png")
val wearStoreListingDimensions = 390 to 390

tasks.register("generateWearStoreListing") {
    notCompatibleWithConfigurationCache("The task validates and copies generated PNGs using JVM image tooling")
    dependsOn("verifyRoborazziDebug")

    doLast {
        if (!wearStoreListingSource.isDirectory) {
            throw GradleException("Wear store-listing screenshot source directory is missing: $wearStoreListingSource")
        }

        val actualFiles = wearStoreListingSource.listFiles()
            ?.filter { it.isFile && it.extension == "png" }
            ?.map { it.name }
            ?.toSet()
            .orEmpty()
        val expectedFiles = wearStoreListingNames.toSet()
        if (actualFiles != expectedFiles) {
            throw GradleException(
                "Expected Wear store-listing files $expectedFiles, but found ${actualFiles.sorted()}"
            )
        }

        wearStoreListingOutput.deleteRecursively()
        wearStoreListingSource.copyRecursively(wearStoreListingOutput, overwrite = true)
        wearStoreListingNames.forEach { name ->
            val imageFile = wearStoreListingOutput.resolve(name)
            val image = ImageIO.read(imageFile)
                ?: throw GradleException("Unable to read Wear store-listing PNG: $imageFile")
            if (image.width != wearStoreListingDimensions.first || image.height != wearStoreListingDimensions.second) {
                throw GradleException(
                    "$imageFile is ${image.width}x${image.height}; " +
                        "expected ${wearStoreListingDimensions.first}x${wearStoreListingDimensions.second}"
                )
            }
        }
        println("Generated ${expectedFiles.size} Wear store-listing screenshots in ${wearStoreListingOutput.absolutePath}")
    }
}


dependencies {
    implementation(project(":design-system"))

    // Wear Compose
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.wear.compose.foundation)
    implementation(libs.wear.compose.material)
    implementation(libs.wear.compose.material3)
    implementation(libs.wear.compose.navigation)
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.wear.compose.ui.tooling)
    debugImplementation(libs.androidx.compose.ui.tooling)

    // Core
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.wear)
    implementation("androidx.wear:wear-input:1.2.0")

    // Hilt DI
    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    implementation(libs.androidx.hilt.navigation.compose)
    implementation(libs.androidx.hilt.work)
    ksp(libs.androidx.hilt.compiler)

    // Networking (Ktor)
    implementation(libs.ktor.client.core)
    implementation(libs.ktor.client.okhttp)
    implementation(libs.ktor.client.content.negotiation)
    implementation(libs.ktor.serialization.kotlinx.json)
    implementation(libs.ktor.client.auth)

    // Serialization
    implementation(libs.kotlinx.serialization.json)

    // Room (offline DB)
    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)

    // WorkManager (sync queue)
    implementation(libs.androidx.work.runtime.ktx)

    // Wearable Data Layer (auth sync from phone)
    implementation(libs.play.services.wearable)

    // Google Sign-In (direct login on watch)
    // WearGoogleSignIn uses the legacy client, which was removed from auth 22.0.0.
    implementation(libs.play.services.auth.legacy)
    implementation(libs.google.id.identity)
    implementation(libs.androidx.credentials)
    implementation(libs.androidx.credentials.play)

    // Security (encrypted prefs for tokens)
    implementation(libs.androidx.security.crypto)


    // DataStore
    implementation(libs.androidx.datastore.preferences)

    // Testing
    testImplementation(libs.junit)
    testImplementation(libs.mockk)
    testImplementation(libs.turbine)
    testImplementation(libs.kotlinx.coroutines.test)
    // Deterministic JVM Compose screenshots for round-form-factor fixtures.
    testImplementation(libs.robolectric)
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
    testImplementation(libs.roborazzi.junit.rule)
    testImplementation(libs.androidx.compose.ui.test.junit4)
    debugImplementation(libs.androidx.compose.ui.test.manifest)

    // Instrumented tests (Room DAOs, TokenStore, ApiClient)
    androidTestImplementation(libs.junit)
    androidTestImplementation(libs.kotlinx.coroutines.test)
    androidTestImplementation(libs.turbine)
    androidTestImplementation("androidx.test:core:1.7.0")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test:rules:1.7.0")
    androidTestImplementation("androidx.room:room-testing:${libs.versions.room.get()}")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test.uiautomator:uiautomator:2.4.0")
}

