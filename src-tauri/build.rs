mod ogs_build_env;

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
    if os == "android" || os == "ios" { mobile_ogs() }
    if os == "ios" { link_katago_ios() }
    // NDK 27 aligns LOAD segments to 4 KB, which 16 KB-page devices (and Google Play) refuse.
    if os == "android" {
        for a in ["max-page-size=16384", "common-page-size=16384"] { println!("cargo:rustc-cdylib-link-arg=-Wl,-z,{a}") }
    }
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

/// A phone build may never silently ship a loopback, placeholder, or unassociated callback.
fn mobile_ogs() {
    for key in ["MASAME_OGS_CALLBACK_URL", "MASAME_OGS_OAUTH_REGISTERED", "MASAME_OGS_COMPILE_ONLY", "CI", "TAURI_CONFIG"] {
        println!("cargo:rerun-if-env-changed={key}");
        println!("cargo:rerun-if-env-changed={}", ogs_build_env::forwarded_name(key));
    }
    let read = |name: &str| std::env::var(name).ok();
    // Native CI must typecheck the real Android/iOS code even before a domain is available. This mode has no
    // callback, cannot access the credential store, is debug-only, and its packages must never be published.
    if ogs_build_env::compile_only(read).expect("Invalid compile-only OGS build settings") {
        println!("cargo:rustc-env=MASAME_OGS_CALLBACK_URL=");
        return;
    }
    let value = ogs_build_env::value(read, "MASAME_OGS_CALLBACK_URL").expect("Set MASAME_OGS_CALLBACK_URL and run node scripts/mobile-ogs.mjs prepare; see docs/ogs-mobile.md");
    let u = url::Url::parse(&value).expect("OGS callback URL");
    let host = u.host_str().expect("OGS callback host");
    assert!(value == u.as_str() && host.split('.').all(|label| !label.is_empty() && !label.starts_with('-') && !label.ends_with('-')
        && label.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')) && u.scheme() == "https" && !host.is_empty() && host.contains('.') && host != "localhost"
        && !["example.com", "example.org", "example.net"].iter().any(|s| host == *s || host.ends_with(&format!(".{s}")))
        && ![".invalid", ".test", ".example", ".localhost", ".local"].iter().any(|s| host.ends_with(s))
        && host.parse::<std::net::IpAddr>().is_err() && u.port().is_none() && u.username().is_empty() && u.password().is_none()
        && u.query().is_none() && u.fragment().is_none() && u.path().len() > 1 && !u.path().ends_with('/')
        && u.path().bytes().all(|b| b.is_ascii_alphanumeric() || b"/_-".contains(&b)), "OGS callback must be an exact real HTTPS host/path");
    assert_eq!(ogs_build_env::value(read, "MASAME_OGS_OAUTH_REGISTERED").as_deref(), Some("1"), "Confirm the exact callback is registered with OGS before a mobile build");
    let conf: serde_json::Value = serde_json::from_str(&std::env::var("TAURI_CONFIG").unwrap_or_default())
        .expect("Pass --config src-tauri/ogs-mobile.generated/tauri.conf.json to Tauri");
    let domains = conf["plugins"]["deep-link"]["mobile"].as_array().expect("mobile deep-link config missing");
    assert_eq!(domains.len(), 1, "Only the exact OGS mobile callback may be registered");
    let d = &domains[0];
    assert!(d["scheme"] == serde_json::json!(["https"]) && d["host"] == host && d["path"] == serde_json::json!([u.path()])
        && d["appLink"] == true && d.get("pathPrefix").is_none() && d.get("pathPattern").is_none(), "OGS callback and native associations differ");
    println!("cargo:rustc-env=MASAME_OGS_CALLBACK_URL={u}");
}
