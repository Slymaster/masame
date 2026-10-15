// macOS menu bar. The wording comes from the frontend dictionaries (src/i18n), like every user-facing text;
// set_language rebuilds the menu when the language changes. Windows and Linux have no menu bar.
// The bar mirrors the card's four doors: each item runs the frontend's command of the same id, and is greyed when the
// frontend says it makes no sense now (set_menu_enabled), or has no command yet.

use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Mutex;

/// Our items: each emits a "menu" event with its id, which the frontend runs like the matching keyboard shortcut.
/// Fixed for the whole v0.5: a new activity only adds its frontend command (src/menu.ts lists the same ids).
#[cfg_attr(mobile, allow(dead_code))] // no menu bar on phones
pub const ACTIONS: [&str; 22] = [
    "new", "position", "open", "save", "postcard", "kifu", "undo", "pass", "resign", "territory", "review", "memory",
    "today", "exercises", "tsumego", "count", "joseki", "fuseki", "classics", "games", "camera", "panel",
];

/// Which items are enabled, as the frontend last said; kept so a rebuilt menu (another language) keeps its greying.
static ENABLED: Mutex<Option<HashMap<String, bool>>> = Mutex::new(None);

/// An item is enabled only once the frontend said so (an id it doesn't know stays greyed).
#[cfg_attr(mobile, allow(dead_code))]
pub fn enabled(id: &str) -> bool {
    ENABLED.lock().unwrap().as_ref().and_then(|m| m.get(id).copied()).unwrap_or(false)
}
pub fn set_enabled(m: HashMap<String, bool>) { *ENABLED.lock().unwrap() = Some(m); }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub struct Labels {
    about: String, hide: String, hide_others: String, show_all: String, quit: String,
    file: String, new_game: String, position: String, open: String, save: String, postcard: String, kifu: String,
    edit: String, undo_move: String, copy: String, select_all: String,
    game: String, pass: String, resign: String, territory: String, review: String, memory: String,
    learn: String, today: String, exercises: String, tsumego: String, count: String, joseki: String, fuseki: String, classics: String, games: String,
    view: String, camera: String, full_screen: String,
    /// "Hide Panel" or "Show Panel", whichever applies: the frontend resends the labels when the panel toggles.
    panel: String,
    window: String, minimize: String, zoom: String,
}

#[cfg(target_os = "macos")]
pub fn build(app: &tauri::AppHandle, l: &Labels) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem as P, Submenu};
    let item = |id: &str, text: &str, key: Option<&str>| MenuItem::with_id(app, id, text, enabled(id), key);
    let app_menu = Submenu::with_items(app, "Masame", true, &[
        &P::about(app, Some(&l.about), None)?, &P::separator(app)?,
        &P::hide(app, Some(&l.hide))?, &P::hide_others(app, Some(&l.hide_others))?, &P::show_all(app, Some(&l.show_all))?,
        &P::separator(app)?, &P::quit(app, Some(&l.quit))?,
    ])?;
    let file = Submenu::with_items(app, &l.file, true, &[
        &item("new", &l.new_game, Some("CmdOrCtrl+N"))?, &item("position", &l.position, None)?, &P::separator(app)?,
        &item("open", &l.open, Some("CmdOrCtrl+O"))?, &item("save", &l.save, Some("CmdOrCtrl+S"))?, &P::separator(app)?,
        &item("postcard", &l.postcard, None)?, &item("kifu", &l.kifu, None)?,
    ])?;
    // ⌘Z is our move undo, not the predefined text Undo; Copy/Select All keep messages copyable.
    let edit = Submenu::with_items(app, &l.edit, true, &[
        &item("undo", &l.undo_move, Some("CmdOrCtrl+Z"))?, &P::separator(app)?, &P::copy(app, Some(&l.copy))?, &P::select_all(app, Some(&l.select_all))?,
    ])?;
    let game = Submenu::with_items(app, &l.game, true, &[
        &item("pass", &l.pass, None)?, &item("resign", &l.resign, None)?, &P::separator(app)?,
        &item("territory", &l.territory, None)?, &item("review", &l.review, None)?, &item("memory", &l.memory, None)?,
    ])?;
    let learn = Submenu::with_items(app, &l.learn, true, &[
        &item("today", &l.today, None)?, &P::separator(app)?,
        &item("exercises", &l.exercises, None)?, &item("tsumego", &l.tsumego, None)?, &item("count", &l.count, None)?,
        &item("joseki", &l.joseki, None)?, &item("fuseki", &l.fuseki, None)?, &item("classics", &l.classics, None)?,
        &P::separator(app)?, &item("games", &l.games, None)?,
    ])?;
    let view = Submenu::with_items(app, &l.view, true, &[
        &item("camera", &l.camera, None)?, &item("panel", &l.panel, Some("CmdOrCtrl+Backslash"))?, &P::separator(app)?,
        &P::fullscreen(app, Some(&l.full_screen))?,
    ])?;
    let window = Submenu::with_items(app, &l.window, true, &[&P::minimize(app, Some(&l.minimize))?, &P::maximize(app, Some(&l.zoom))?])?;
    window.set_as_windows_menu_for_nsapp()?;
    Menu::with_items(app, &[&app_menu, &file, &edit, &game, &learn, &view, &window])
}

/// Greys or enables our items in the current menu bar, after `set_enabled`.
#[cfg(target_os = "macos")]
pub fn apply(menu: &tauri::menu::Menu<tauri::Wry>) -> tauri::Result<()> {
    for top in menu.items()? {
        let Some(sub) = top.as_submenu() else { continue };
        for k in sub.items()? {
            if let Some(m) = k.as_menuitem() {
                let id = m.id().as_ref();
                if ACTIONS.contains(&id) { m.set_enabled(enabled(id))?; }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_unique_and_greyed_until_told() {
        let mut ids = ACTIONS.to_vec();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), ACTIONS.len());
        assert!(!enabled("save"));
        set_enabled(HashMap::from([("save".into(), true), ("kifu".into(), false)]));
        assert!(enabled("save"));
        assert!(!enabled("kifu"));
        assert!(!enabled("tsumego")); // not sent: greyed
    }
}
