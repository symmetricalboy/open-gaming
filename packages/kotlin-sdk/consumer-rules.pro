# Keep kotlinx.serialization generated serializers for Open Gaming ATProto models under R8 / ProGuard
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt

-keepclassmembers class games.opengaming.sdk.** {
    *** Companion;
}
-keepclasseswithmembers class games.opengaming.sdk.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class games.opengaming.sdk.**$$serializer { *; }
