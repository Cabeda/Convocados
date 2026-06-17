import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.hilt.android)
    alias(libs.plugins.ksp)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.google.services)
    alias(libs.plugins.play.publisher)
    alias(libs.plugins.baselineprofile)
    alias(libs.plugins.roborazzi)
}

val keystoreProperties = Properties().apply {
    val file = rootProject.file("keystore.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}

android {
    namespace = "dev.convocados"
    compileSdk = 35

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
        targetSdk = 35
        versionCode = (System.currentTimeMillis() / 1000 / 60).toInt()
        versionName = "1.2.0"
        manifestPlaceholders["appAuthRedirectScheme"] = "convocados"
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
    }
    testOptions {
        unitTests {
            isIncludeAndroidResources = true
        }
    }
    // #457 — Kotlin 2.0+ compilerOptions DSL (AGP 9 built-in Kotlin).
    kotlin {
        compilerOptions {
            jvmTarget.set(JvmTarget.JVM_17)
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

dependencies {
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

    // Browser (Custom Tabs for OAuth)
    implementation(libs.androidx.browser)
    implementation(libs.androidx.appcompat)

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
    implementation(libs.firebase.messaging.ktx)

    // Accompanist (Permissions)
    implementation(libs.accompanist.permissions)

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
    // Screenshot testing (JVM, no device) via Roborazzi + Robolectric
    testImplementation(libs.robolectric)
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
    testImplementation(libs.roborazzi.junit.rule)
    testImplementation(libs.androidx.compose.ui.test.junit4)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
}
