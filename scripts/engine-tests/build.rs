fn main() {
    println!("cargo:rustc-check-cfg=cfg(desktop)");
    println!("cargo:rustc-check-cfg=cfg(engine_variants)");
    println!("cargo:rustc-cfg=desktop");
    println!("cargo:rustc-cfg=engine_variants");
}
