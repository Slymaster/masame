// Native command boundary. The portable store is also exercised without the GUI runtime.
#[path = "library_store.rs"]
mod store;
pub use store::Library;
use crate::failure::{Failure, Res};
use serde_json::Value;
use std::path::PathBuf;
use tauri::{AppHandle, State};
fn io(e: impl ToString) -> Failure { Failure::with("library_io", e) }

fn dir(app: &AppHandle) -> Res<PathBuf> { Ok(crate::data_dir(app).map_err(|e| io(e.detail.unwrap_or_default()))?.join("games")) }

// async: off the main thread, since every write syncs to disk.
#[tauri::command]
pub async fn library_list(app: AppHandle, lib: State<'_, Library>) -> Res<Vec<Value>> { lib.list(&dir(&app)?) }
#[tauri::command]
pub async fn library_admit(app: AppHandle, lib: State<'_, Library>, id: String, reimport: bool) -> Res<bool> { lib.admit(&dir(&app)?, &id, reimport) }
#[tauri::command]
pub async fn library_read(app: AppHandle, lib: State<'_, Library>, id: String) -> Res<String> { lib.read(&dir(&app)?, &id) }
#[tauri::command]
pub async fn library_write(app: AppHandle, lib: State<'_, Library>, id: String, sgf: Option<String>, entry: Option<Value>) -> Res<()> {
    lib.write(&dir(&app)?, &id, sgf.as_deref(), entry)
}
#[tauri::command]
pub async fn library_delete(app: AppHandle, lib: State<'_, Library>, id: String) -> Res<()> { lib.delete(&dir(&app)?, &id) }
#[tauri::command]
pub async fn library_sidecar_read(app: AppHandle, lib: State<'_, Library>, id: String, name: String) -> Res<Value> { lib.sidecar_read(&dir(&app)?, &id, &name) }
#[tauri::command]
pub async fn library_sidecar_write(app: AppHandle, lib: State<'_, Library>, id: String, name: String, json: Value) -> Res<()> {
    lib.sidecar_write(&dir(&app)?, &id, &name, &json)
}
#[tauri::command]
pub async fn library_current_read(app: AppHandle, lib: State<'_, Library>) -> Res<Value> { lib.current_read(&dir(&app)?) }
#[tauri::command]
pub async fn library_current_write(app: AppHandle, lib: State<'_, Library>, json: Value) -> Res<()> { lib.current_write(&dir(&app)?, &json) }
