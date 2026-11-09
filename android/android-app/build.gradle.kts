import groovy.json.JsonSlurper
import com.android.build.api.dsl.ApplicationBuildType
import java.net.URI

plugins { id("com.android.application") }

val sharepassOrigin = providers.gradleProperty("sharepassOrigin").orElse("https://sharepass.example.test").get()
val parsedOrigin = URI(sharepassOrigin)
require(sharepassOrigin.matches(Regex("https://[a-zA-Z0-9.-]+(?::[0-9]{1,5})?"))
        && parsedOrigin.host != null && (parsedOrigin.port == -1 || parsedOrigin.port in 1..65535)) {
    "sharepassOrigin must be an HTTPS origin without a path, query or credentials."
}

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
        versionCode = 16
        versionName = "0.9.6"
        buildConfigField("String", "SHAREPASS_ORIGIN", "\"$sharepassOrigin\"")
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    buildFeatures.resValues = firebaseConfig != null
    buildFeatures.buildConfig = true
    buildTypes {
        release {
            isMinifyEnabled = false // Intentionally unsigned. No production key.
            firebaseResources("in.sharepass.foundation", required = true)
        }
        debug { applicationIdSuffix = ".debug" }
    }
    sourceSets.getByName("main").assets.srcDir(rootProject.file("web"))
    sourceSets.getByName("debug").java.srcDir("src/polling/java")
    sourceSets.getByName("release").java.srcDir(if (firebaseConfig == null) "src/polling/java" else "src/fcm/java")
    if (firebaseConfig != null) {
        sourceSets.getByName("release").manifest.srcFile("src/fcm/AndroidManifest.xml")
    }
}

if (firebaseConfig != null) {
    dependencies {
        add("releaseImplementation", platform("com.google.firebase:firebase-bom:35.1.0"))
        add("releaseImplementation", "com.google.firebase:firebase-messaging")
    }
}
