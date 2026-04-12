# Ktor
-keep class io.ktor.** { *; }
-dontwarn io.ktor.**

# Kotlinx Serialization
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt
-keepclassmembers class kotlinx.serialization.json.** { *** Companion; }
-keepclasseswithmembers class kotlinx.serialization.json.** { kotlinx.serialization.KSerializer serializer(...); }
-keep,includedescriptorclasses class dev.convocados.wear.**$$serializer { *; }
-keepclassmembers class dev.convocados.wear.** { *** Companion; }
-keepclasseswithmembers class dev.convocados.wear.** { kotlinx.serialization.KSerializer serializer(...); }
