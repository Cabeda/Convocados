import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.hilt.android)
    alias(libs.plugins.ksp)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.google.services)
    alias(libs.plugins.play.publisher)
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
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
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
}
