plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.hilt.android)
    alias(libs.plugins.ksp)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "dev.convocados.wear"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.cabeda.convocados.wear"
        minSdk = 30
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("debug")
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

dependencies {
    // Wear Compose
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.wear.compose.foundation)
    implementation(libs.wear.compose.material)
    implementation(libs.wear.compose.material3)
    implementation(libs.wear.compose.navigation)
    implementation(libs.horologist.compose.layout)
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
    implementation(libs.play.services.auth)
    implementation(libs.google.id.identity)
    implementation(libs.androidx.credentials)
    implementation(libs.androidx.credentials.play)

    // Security (encrypted prefs for tokens)
    implementation(libs.androidx.security.crypto)

    // DataStore
    implementation(libs.androidx.datastore.preferences)
}
