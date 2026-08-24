-keepattributes *Annotation*
-keep class kotlinx.serialization.** { *; }
-keepclassmembers class dev.convocados.data.api.** { *; }
-dontwarn org.slf4j.**

# Firebase: keep ComponentRegistrar implementations and their constructors.
# R8 fullMode (AGP 9.x) strips the reflective no-arg constructors that
# Firebase's ComponentDiscovery loads via Class.forName(...).newInstance().
# Without this, release builds log:
#   "Could not instantiate com.google.firebase.crashlytics.CrashlyticsRegistrar"
#   + "FirebaseCrashlytics component is not present" and crash on launch.
# See mapping.txt: CrashlyticsRegistrar and Ktx registrars lose <init>().
-keep class com.google.firebase.components.ComponentRegistrar { *; }
-keep class * implements com.google.firebase.components.ComponentRegistrar {
    <init>();
    java.util.List getComponents();
}

# Tink / security-crypto missing annotations
-dontwarn com.google.errorprone.annotations.**
-dontwarn javax.annotation.**
-dontwarn com.google.auto.value.AutoValue
-dontwarn com.google.auto.value.AutoValue$Builder
