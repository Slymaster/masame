#![cfg(test)]
#![allow(dead_code)]
// No copies of production logic: compile the same modules and their original tests.
#[path = "../../../src-tauri/src/backend.rs"]
mod backend;
#[path = "../../../src-tauri/src/failure.rs"]
mod failure;
#[path = "../../../src-tauri/src/engine.rs"]
mod engine;
#[path = "../../../src-tauri/src/startup.rs"]
mod startup;
