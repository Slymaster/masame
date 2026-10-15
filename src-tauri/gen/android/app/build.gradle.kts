import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

// ${MASAME_VENDOR}/katago-android, by default the repo's vendor/ (gitignored, filled by the build scripts).
val katagoLibs = file(providers.environmentVariable("MASAME_VENDOR").getOrElse(rootDir.resolve("../../../vendor").path)).resolve("katago-android").canonicalFile

android {
    compileSdk = 37
    namespace = "com.sylvainrey.masame"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "com.sylvainrey.masame"
        minSdk = 24
        targetSdk = 37
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {
                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            optimization {
               enable = true
            }
            proguardFiles(
                *fileTree(".") {
                  include("**/*.pro")
                  exclude("build/**")
                }.files.toTypedArray()
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    buildFeatures {
        buildConfig = true
    }
    // KataGo runs as its own process, and Android only lets an app exec files from nativeLibraryDir: shipped as a native
    // lib, with legacy packaging so the installer extracts it there with exec permission.
    sourceSets["main"].jniLibs.srcDir(katagoLibs)
    packaging {
        jniLibs.useLegacyPackaging = true
    }
}

tasks.named("preBuild") {
    val katago = katagoLibs.resolve("arm64-v8a/libkatago.so")
    doFirst {
        if (!katago.isFile) throw GradleException("KataGo for Android is missing: $katago (build it with scripts/build-katago-android.sh, or point MASAME_VENDOR at a vendor/ folder holding katago-android/arm64-v8a/libkatago.so)")
    }
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_1_8
    }
}

rust {
    rootDirRel = "../../../"
}

// rustls checks certificates through Android's trust store with a small Kotlin library, whose version must match the
// rustls-platform-verifier-android crate in Cargo.lock.
val rustlsVerifier = rootDir.resolve("../../Cargo.lock").readText()
    .substringAfter("name = \"rustls-platform-verifier-android\"\nversion = \"").substringBefore('"')
repositories {
    maven { url = uri("https://github.com/rustls/rustls-platform-verifier/raw/maven-archive/android-release-support/maven/") }
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    implementation("org.rustls:rustls-platform-verifier:$rustlsVerifier")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = file("tauri.build.gradle.kts"))
