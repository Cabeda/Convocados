-keepattributes *Annotation*
-keep class kotlinx.serialization.** { *; }
-keepclassmembers class dev.convocados.data.api.** { *; }
-dontwarn org.slf4j.**

# Tink / security-crypto missing annotations
-dontwarn com.google.errorprone.annotations.**
-dontwarn javax.annotation.**
-dontwarn com.google.auto.value.AutoValue
-dontwarn com.google.auto.value.AutoValue$Builder
