// Exercise the production store and its tests without requiring a WebView, engine binaries or signing credentials.
#![allow(dead_code)]
#[path = "../../../src-tauri/src/failure.rs"]
mod failure;
const MAX_SGF: u64 = 5 * 1024 * 1024;
#[path = "../../../src-tauri/src/library_store.rs"]
mod library;
