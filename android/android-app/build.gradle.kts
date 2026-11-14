import groovy.json.JsonSlurper
import com.android.build.api.dsl.ApplicationBuildType
import java.net.URI
import javax.inject.Inject

plugins { id("com.android.application") }

abstract class PrepareNativeAssets @Inject constructor(private val files: FileSystemOperations) : DefaultTask() {
    @get:InputDirectory abstract val web: DirectoryProperty
    @get:InputFile @get:Optional abstract val artwork: RegularFileProperty
    @get:OutputDirectory abstract val output: DirectoryProperty

    @TaskAction fun prepare() {
        files.sync {
            from(web)
            include("assets/sharepass-approved-logo.jpg", "vendor/sharepass-qr.js", "vendor/QR-LICENSE.txt", "vendor/QR-SOURCES.md")
            into(output)
        }
        if (artwork.isPresent) files.copy {
            from(artwork); into(output.dir("assets")); rename { "sharepass-approved-logo.jpg" }
        }
    }
}

abstract class PrepareBrandResources @Inject constructor(private val files: FileSystemOperations) : DefaultTask() {
    @get:InputFile @get:Optional abstract val artwork: RegularFileProperty
    @get:OutputDirectory abstract val output: DirectoryProperty

    @TaskAction fun prepare() {
        // Rebuilding without a private override must remove previously generated private artwork.
        files.delete { delete(output) }
        output.get().asFile.mkdirs()
        if (artwork.isPresent) files.copy {
            from(artwork); into(output.dir("mipmap-xxxhdpi")); rename { "sharepass_logo.jpg" }
        }
    }
}

val approvedArtwork = providers.gradleProperty("sharepassArtwork").orNull?.let { rootProject.file(it) }
approvedArtwork?.let { require(it.isFile) { "sharepassArtwork must be an existing approved JPEG." } }

val sharepassOrigin = providers.gradleProperty("sharepassOrigin").orElse("https://sharepass.example.test").get()
val parsedOrigin = URI(sharepassOrigin)
require(parsedOrigin.scheme == "https" && parsedOrigin.host?.matches(Regex("[a-z0-9]+(?:[.-][a-z0-9]+)*")) == true
    && sharepassOrigin == "https://${parsedOrigin.host}") { "sharepassOrigin must be an HTTPS origin." }

val firebaseConfig = providers.gradleProperty("sharepassFirebaseConfig").orNull?.let { file ->
    val config = rootProject.file(file)
    require(config.isFile) { "sharepassFirebaseConfig must point to a Firebase Android configuration file." }
    JsonSlurper().parse(config) as Map<*, *>
}

fun ApplicationBuildType.firebaseResources(packageName: String, required: Boolean) {
    val config = firebaseConfig ?: return
    val project = config["project_info"] as? Map<*, *>
    val client = (config["client"] as? List<*>)?.filterIsInstance<Map<*, *>>()?.firstOrNull {
        val info = it["client_info"] as? Map<*, *>
        val android = info?.get("android_client_info") as? Map<*, *>
        android?.get("package_name") == packageName
    }
    require(client != null || !required) { "The Firebase Android configuration must include $packageName." }
    if (client == null) return
    val info = client["client_info"] as? Map<*, *>
    val keys = client["api_key"] as? List<*>
    val apiKey = (keys?.firstOrNull() as? Map<*, *>)?.get("current_key")
    val values = mapOf(
        "google_app_id" to info?.get("mobilesdk_app_id"),
        "gcm_defaultSenderId" to project?.get("project_number"),
        "project_id" to project?.get("project_id"),
        "google_api_key" to apiKey,
    )
    values.forEach { (name, value) ->
        require(value is String && value.matches(Regex("[A-Za-z0-9:_-]+"))) {
            "Firebase Android configuration is missing a valid $name."
        }
        resValue("string", name, value)
    }
}

android {
    namespace = "in.sharepass.foundation"
    compileSdk { version = release(37) { minorApiLevel = 0 } }
    buildToolsVersion = "36.0.0"
    defaultConfig {
        applicationId = "in.sharepass.foundation"
        minSdk = 24
        targetSdk = 37
        versionCode = 28
        versionName = "0.9.18"
        buildConfigField("String", "SHAREPASS_ORIGIN", "\"$sharepassOrigin\"")
        manifestPlaceholders["sharepassAppLinkHost"] = parsedOrigin.host
        manifestPlaceholders["sharepassLauncherIcon"] = if (approvedArtwork == null) "@drawable/ic_foundation" else "@mipmap/sharepass_logo"
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    buildFeatures.resValues = firebaseConfig != null
    buildFeatures.buildConfig = true
    androidResources.ignoreAssetsPatterns.add("sharepass-handoff.png")
    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
            firebaseResources("in.sharepass.foundation", required = true)
        }
        debug { applicationIdSuffix = ".debug" }
    }
    sourceSets.getByName("debug").assets.srcDir(rootProject.file("web"))
    sourceSets.getByName("debug").java.srcDir("src/polling/java")
    sourceSets.getByName("release").java.srcDir(if (firebaseConfig == null) "src/polling/java" else "src/fcm/java")
    if (firebaseConfig != null) {
        sourceSets.getByName("release").manifest.srcFile("src/fcm/AndroidManifest.xml")
    }
}

val prepareNativeAssets = tasks.register<PrepareNativeAssets>("prepareNativeAssets") {
    web.set(rootProject.layout.projectDirectory.dir("web"))
    approvedArtwork?.let { artwork.set(it) }
}
val prepareBrandResources = tasks.register<PrepareBrandResources>("prepareBrandResources") {
    approvedArtwork?.let { artwork.set(it) }
    output.set(layout.buildDirectory.dir("generated/sharepassBrand/res"))
}
androidComponents.onVariants(androidComponents.selector().all()) { variant ->
    variant.sources.res?.addGeneratedSourceDirectory(prepareBrandResources, PrepareBrandResources::output)
}

androidComponents.onVariants(androidComponents.selector().withBuildType("release")) { variant ->
    variant.sources.assets?.addGeneratedSourceDirectory(prepareNativeAssets, PrepareNativeAssets::output)
}

dependencies {
    // Shared Consumer/FileProvider imports must compile without optional Firebase.
    // Match window-java 1.5.1's existing Core runtime dependency.
    implementation("androidx.core:core:1.8.0")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    implementation("androidx.window:window-java:1.5.1")
    if (firebaseConfig != null) {
        add("releaseImplementation", platform("com.google.firebase:firebase-bom:35.1.0"))
        add("releaseImplementation", "com.google.firebase:firebase-messaging")
    }
}
