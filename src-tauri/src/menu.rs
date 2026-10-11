// macOS menu bar. The wording comes from the frontend dictionaries (src/i18n), like every user-facing text;
// set_language rebuilds the menu when the language changes. Windows has no menu bar.

use serde::Deserialize;

/// Our items: each emits a "menu" event with its id, which the frontend runs like the matching keyboard shortcut.
pub const ACTIONS: [&str; 4] = ["new", "open", "save", "undo"];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub struct Labels {
    about: String, hide: String, hide_others: String, show_all: String, quit: String,
    file: String, new_game: String, open: String, save: String,
    edit: String, undo_move: String, copy: String, select_all: String,
    window: String, minimize: String, zoom: String, full_screen: String,
}

#[cfg(target_os = "macos")]
pub fn build(app: &tauri::AppHandle, l: &Labels) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem as P, Submenu};
    let item = |id: &str, text: &str, key: &str| MenuItem::with_id(app, id, text, true, Some(key));
    let app_menu = Submenu::with_items(app, "Masame", true, &[
        &P::about(app, Some(&l.about), None)?, &P::separator(app)?,
        &P::hide(app, Some(&l.hide))?, &P::hide_others(app, Some(&l.hide_others))?, &P::show_all(app, Some(&l.show_all))?,
        &P::separator(app)?, &P::quit(app, Some(&l.quit))?,
    ])?;
    let file = Submenu::with_items(app, &l.file, true, &[
        &item("new", &l.new_game, "CmdOrCtrl+N")?, &item("open", &l.open, "CmdOrCtrl+O")?, &item("save", &l.save, "CmdOrCtrl+S")?,
    ])?;
    // ⌘Z is our move undo, not the predefined text Undo; Copy/Select All keep messages copyable.
    let edit = Submenu::with_items(app, &l.edit, true, &[
        &item("undo", &l.undo_move, "CmdOrCtrl+Z")?, &P::separator(app)?, &P::copy(app, Some(&l.copy))?, &P::select_all(app, Some(&l.select_all))?,
    ])?;
    let window = Submenu::with_items(app, &l.window, true, &[
        &P::minimize(app, Some(&l.minimize))?, &P::maximize(app, Some(&l.zoom))?, &P::separator(app)?, &P::fullscreen(app, Some(&l.full_screen))?,
    ])?;
    window.set_as_windows_menu_for_nsapp()?;
    Menu::with_items(app, &[&app_menu, &file, &edit, &window])
}
