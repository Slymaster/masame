fn main() {
    let mut attributes = tauri_build::Attributes::new();
    // tauri-build embeds its comctl32 v6 manifest (rfd's TaskDialogIndirect needs it) into bins only, so the test
    // harness failed to load on Windows: link the same manifest into every target instead.
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        let manifest = std::env::current_dir().unwrap().join("windows-app-manifest.xml");
        println!("cargo:rerun-if-changed=windows-app-manifest.xml");
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
        attributes = attributes.windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
    }
    // engine_variants: the platforms that bundle several KataGo builds and pick one at run time (src/backend.rs).
    println!("cargo:rustc-check-cfg=cfg(engine_variants)");
    let target = |k: &str| std::env::var(k).unwrap_or_default();
    let (os, arch) = (target("CARGO_CFG_TARGET_OS"), target("CARGO_CFG_TARGET_ARCH"));
    if os == "windows" || os == "linux" || os == "macos" && arch == "x86_64" { println!("cargo:rustc-cfg=engine_variants") }
    if os == "ios" { link_katago_ios() }
    tauri_build::try_build(attributes).expect("tauri-build")
}

/// iOS runs KataGo in-process (src/inproc.rs): the static library scripts/build-katago-ios.sh builds, for the device or
/// the Simulator. Frameworks: also listed in tauri.ios.conf.json and gen/apple/project.yml for the app's final link.
fn link_katago_ios() {
    let sdk = if std::env::var("TARGET").unwrap_or_default().ends_with("-sim") { "iphonesimulator" } else { "iphoneos" };
    println!("cargo:rerun-if-env-changed=MASAME_VENDOR");
    let vendor = std::env::var_os("MASAME_VENDOR").map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../vendor"));
    let dir = vendor.join("katago-ios").join(sdk);
    let lib = dir.join("libkatago_ios.a");
    if !lib.is_file() { panic!("{} is missing: run scripts/build-katago-ios.sh {sdk} (MASAME_VENDOR picks another vendor directory)", lib.display()) }
    println!("cargo:rerun-if-changed={}", lib.display());
    println!("cargo:rustc-link-search=native={}", dir.display());
    println!("cargo:rustc-link-lib=static=katago_ios");
    for l in ["c++", "z"] { println!("cargo:rustc-link-lib={l}") }
    for f in ["Metal", "MetalPerformanceShaders", "MetalPerformanceShadersGraph", "CoreML"] { println!("cargo:rustc-link-lib=framework={f}") }
}
