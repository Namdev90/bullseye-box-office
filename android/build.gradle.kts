// Match the already verified Navrang build-tool Kotlin version, without its runtime libraries.
buildscript { configurations.all { resolutionStrategy.force("org.jetbrains.kotlin:kotlin-gradle-plugin:2.4.21") } }
plugins { id("com.android.application") version "9.4.1" apply false }
