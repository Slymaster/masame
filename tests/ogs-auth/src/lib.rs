#![allow(dead_code)]
// Compile the production state machine and OAuth primitives unchanged, without GTK, WebKit or an OS keychain.
#[path = "../../../src-tauri/src/failure.rs"]
mod failure;
#[path = "../../../src-tauri/src/ogs_oauth.rs"]
mod ogs_oauth;
#[path = "../../../src-tauri/src/ogs_mobile.rs"]
mod ogs_mobile;

#[path = "android_bridge_check.rs"]
mod android_bridge_check;

// The production build gate also runs in Xcode's sanitized environment.
#[path = "../../../src-tauri/ogs_build_env.rs"]
mod ogs_build_env;
