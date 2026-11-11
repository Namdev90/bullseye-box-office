plugins { id("com.android.application") }
android {
    namespace = "in.sharepass.sharedpreview"
    compileSdk = 36
    buildToolsVersion = "36.0.0"
    defaultConfig {
        applicationId = "in.sharepass.sharedpreview"
        minSdk = 24
        targetSdk = 36
        versionCode = 3
        versionName = "0.3.0-local-integration"
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    buildTypes {
        debug { applicationIdSuffix = ".debug" }
        release { isMinifyEnabled = false } // unsigned; do not publish
    }
}
