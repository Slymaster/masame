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
    tauri_build::try_build(attributes).expect("tauri-build")
}
