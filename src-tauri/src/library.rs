// The library, in <app_local_data_dir>/games/ (the bridge harness mirrors this format):
//   index.json = {"v":1,"entries":[Entry…]}, an Entry being an object whose "id" names the game's files;
//   <id>.sgf = the game, <id>.<name>.json = a sidecar (e.g. <id>.review.json), current.json = the game to resume.
//   Ids match [A-Za-z0-9_-]{1,64} and sidecar names [a-z]{1,24}: no name can leave games/ or meet another game's file.
//   Each file is written whole to a dot-led .tmp beside it, synced, then renamed; an unparsable index becomes index.json.bad.

use crate::failure::{Failure, Res};
use serde_json::{json, Value};
use std::io::{ErrorKind, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use tauri::{AppHandle, State};

const MAX_JSON: u64 = 2 * 1024 * 1024; // an entry, a sidecar or current.json
const INDEX: &str = "index.json";
const CURRENT: &str = "current.json";

/// Held by every write (and by the index repair), so two writes racing never lose each other's entry.
#[derive(Default)]
pub struct Library(Mutex<()>);

fn io(e: impl ToString) -> Failure { Failure::with("library_io", e) }
fn bad() -> Failure { Failure::new("library_bad_id") }
fn valid_id(id: &str) -> bool { (1..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') }
fn valid_name(n: &str) -> bool { (1..=24).contains(&n.len()) && n.bytes().all(|b| b.is_ascii_lowercase()) }
fn check(ok: bool) -> Res<()> { if ok { Ok(()) } else { Err(bad()) } }
fn json_len(v: &Value) -> u64 { serde_json::to_vec(v).map_or(u64::MAX, |b| b.len() as u64) }
fn cap(len: u64, max: u64) -> Res<()> { if len > max { Err(Failure::new("library_too_big")) } else { Ok(()) } }

/// At most `max` bytes of a file; None when absent.
fn get(path: &Path, max: u64) -> Res<Option<Vec<u8>>> {
    let mut bytes = vec![];
    match std::fs::File::open(path).and_then(|f| f.take(max + 1).read_to_end(&mut bytes)) {
        Ok(_) => cap(bytes.len() as u64, max).map(|_| Some(bytes)),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(io(e)),
    }
}

/// A JSON file's value; absent or unparsable reads as null.
fn get_json(path: &Path) -> Res<Value> { Ok(get(path, MAX_JSON)?.and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(Value::Null)) }

static TMP: AtomicU64 = AtomicU64::new(0);

/// The whole file or the old one: a fresh temp file in the same folder (create_new: never through a planted link),
/// synced, then renamed over the target.
fn put(dir: &Path, name: &str, bytes: &[u8]) -> Res<()> {
    std::fs::create_dir_all(dir).map_err(io)?;
    let tmp = dir.join(format!(".{name}.{}-{}.tmp", std::process::id(), TMP.fetch_add(1, Ordering::Relaxed)));
    let r = std::fs::OpenOptions::new().write(true).create_new(true).open(&tmp)
        .and_then(|mut f| { f.write_all(bytes)?; f.sync_all() })
        .and_then(|_| std::fs::rename(&tmp, dir.join(name)));
    if r.is_err() { let _ = std::fs::remove_file(&tmp); }
    r.map_err(io)
}

fn remove(path: &Path) -> Res<()> {
    match std::fs::remove_file(path) { Err(e) if e.kind() != ErrorKind::NotFound => Err(io(e)), _ => Ok(()) }
}

/// The index's entries as stored (junk included, so a write never drops what it does not understand). An unparsable
/// index is set aside as index.json.bad (replacing an older one) and the library starts empty.
fn entries(dir: &Path) -> Res<Vec<Value>> {
    let path = dir.join(INDEX);
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(io(e)),
    };
    match serde_json::from_slice::<Value>(&bytes) {
        Ok(Value::Object(mut o)) if o.get("entries").is_some_and(Value::is_array) => Ok(match o.remove("entries") { Some(Value::Array(a)) => a, _ => vec![] }),
        _ => { std::fs::rename(&path, dir.join("index.json.bad")).map_err(io)?; Ok(vec![]) }
    }
}

fn save(dir: &Path, entries: Vec<Value>) -> Res<()> { put(dir, INDEX, json!({ "v": 1, "entries": entries }).to_string().as_bytes()) }

impl Library {
    // A panic elsewhere must not lock the library for the rest of the session.
    fn lock(&self) -> MutexGuard<'_, ()> { self.0.lock().unwrap_or_else(|p| p.into_inner()) }

    /// Newest first (by "date"); entries that are not objects with a valid id are skipped.
    pub fn list(&self, dir: &Path) -> Res<Vec<Value>> {
        let _g = self.lock();
        let mut xs: Vec<Value> = entries(dir)?.into_iter().filter(|e| e["id"].as_str().is_some_and(valid_id)).collect();
        let date = |e: &Value| e["date"].as_f64().unwrap_or(0.0);
        xs.sort_by(|a, b| date(b).total_cmp(&date(a)));
        Ok(xs)
    }

    pub fn read(&self, dir: &Path, id: &str) -> Res<String> {
        check(valid_id(id))?;
        let bytes = get(&dir.join(format!("{id}.sgf")), crate::MAX_SGF)?.ok_or(Failure::new("library_not_found"))?;
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    }

    /// The SGF and/or the entry (None: unchanged); an entry replaces the one with the same id.
    pub fn write(&self, dir: &Path, id: &str, sgf: Option<&str>, entry: Option<Value>) -> Res<()> {
        check(valid_id(id))?;
        if let Some(e) = &entry { check(e.is_object() && e["id"] == id)?; cap(json_len(e), MAX_JSON)? }
        if let Some(s) = sgf { cap(s.len() as u64, crate::MAX_SGF)? }
        let _g = self.lock();
        if let Some(s) = sgf { put(dir, &format!("{id}.sgf"), s.as_bytes())? }
        if let Some(e) = entry {
            let mut xs = entries(dir)?;
            xs.retain(|x| x["id"] != id);
            xs.push(e);
            save(dir, xs)?;
        }
        Ok(())
    }

    /// The SGF, every sidecar and the entry; nothing to delete is not an error.
    pub fn delete(&self, dir: &Path, id: &str) -> Res<()> {
        check(valid_id(id))?;
        let _g = self.lock();
        remove(&dir.join(format!("{id}.sgf")))?;
        let files = match std::fs::read_dir(dir) {
            Ok(r) => r.filter_map(|f| f.ok()?.file_name().into_string().ok()).collect(),
            Err(e) if e.kind() == ErrorKind::NotFound => vec![],
            Err(e) => return Err(io(e)),
        };
        // Ids hold no '.', so "<id>." is never the start of another game's file.
        for f in files {
            let sidecar = f.strip_prefix(id).and_then(|r| r.strip_prefix('.')).and_then(|r| r.strip_suffix(".json")).is_some_and(valid_name);
            if sidecar { remove(&dir.join(f))? }
        }
        let mut xs = entries(dir)?;
        let n = xs.len();
        xs.retain(|x| x["id"] != id);
        if xs.len() != n { save(dir, xs)? }
        Ok(())
    }

    /// Null when absent (or unreadable as JSON).
    pub fn sidecar_read(&self, dir: &Path, id: &str, name: &str) -> Res<Value> {
        check(valid_id(id) && valid_name(name))?;
        get_json(&dir.join(format!("{id}.{name}.json")))
    }

    pub fn sidecar_write(&self, dir: &Path, id: &str, name: &str, json: &Value) -> Res<()> {
        check(valid_id(id) && valid_name(name))?;
        cap(json_len(json), MAX_JSON)?;
        let _g = self.lock();
        put(dir, &format!("{id}.{name}.json"), json.to_string().as_bytes())
    }

    pub fn current_read(&self, dir: &Path) -> Res<Value> { get_json(&dir.join(CURRENT)) }

    /// Null deletes current.json.
    pub fn current_write(&self, dir: &Path, json: &Value) -> Res<()> {
        cap(json_len(json), MAX_JSON)?;
        let _g = self.lock();
        if json.is_null() { remove(&dir.join(CURRENT)) } else { put(dir, CURRENT, json.to_string().as_bytes()) }
    }
}

fn dir(app: &AppHandle) -> Res<PathBuf> { Ok(crate::data_dir(app).map_err(|e| io(e.detail.unwrap_or_default()))?.join("games")) }

// async: off the main thread, since every write syncs to disk.
#[tauri::command]
pub async fn library_list(app: AppHandle, lib: State<'_, Library>) -> Res<Vec<Value>> { lib.list(&dir(&app)?) }
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("masame-library-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d.join("games") // not created: the library makes it on demand
    }
    fn entry(id: &str, date: u64) -> Value { json!({ "id": id, "date": date, "source": "ai", "result": "B+R" }) }
    fn ids(xs: &[Value]) -> Vec<&str> { xs.iter().map(|e| e["id"].as_str().unwrap()).collect() }
    fn files(d: &Path) -> Vec<String> {
        let mut v: Vec<String> = std::fs::read_dir(d).unwrap().map(|f| f.unwrap().file_name().into_string().unwrap()).collect();
        v.sort();
        v
    }
    fn code<T: std::fmt::Debug>(r: Res<T>) -> &'static str { r.unwrap_err().code }

    #[test]
    fn write_list_read_round_trip() {
        let (d, lib) = (temp("round"), Library::default());
        assert_eq!(lib.list(&d).unwrap(), Vec::<Value>::new());
        lib.write(&d, "ai-1", Some("(;GM[1]SZ[19];B[pd])"), Some(entry("ai-1", 1))).unwrap();
        lib.write(&d, "ogs-2", Some("(;GM[1])"), Some(entry("ogs-2", 3))).unwrap();
        lib.write(&d, "file-x", None, Some(entry("file-x", 2))).unwrap();
        assert_eq!(ids(&lib.list(&d).unwrap()), ["ogs-2", "file-x", "ai-1"]);
        assert_eq!(lib.list(&d).unwrap()[2], entry("ai-1", 1));
        assert_eq!(lib.read(&d, "ai-1").unwrap(), "(;GM[1]SZ[19];B[pd])");
        assert_eq!(code(lib.read(&d, "file-x")), "library_not_found");
        // the SGF alone leaves the index as it was
        lib.write(&d, "ai-1", Some("(;GM[1]SZ[9])"), None).unwrap();
        assert_eq!(lib.read(&d, "ai-1").unwrap(), "(;GM[1]SZ[9])");
        assert_eq!(lib.list(&d).unwrap().len(), 3);
    }

    #[test]
    fn upsert_replaces_the_same_id() {
        let (d, lib) = (temp("upsert"), Library::default());
        lib.write(&d, "g", Some("(;)"), Some(entry("g", 1))).unwrap();
        let mut e = entry("g", 1);
        e["result"] = json!("W+4.5");
        lib.write(&d, "g", None, Some(e.clone())).unwrap();
        assert_eq!(lib.list(&d).unwrap(), vec![e]);
        assert_eq!(lib.read(&d, "g").unwrap(), "(;)");
    }

    #[test]
    fn writes_leave_no_temp_file_and_a_valid_index() {
        let (d, lib) = (temp("atomic"), Library::default());
        lib.write(&d, "a", Some("(;)"), Some(entry("a", 1))).unwrap();
        lib.sidecar_write(&d, "a", "review", &json!({ "leads": [0.5, null], "moments": [] })).unwrap();
        lib.current_write(&d, &json!({ "id": "a", "cursor": 0 })).unwrap();
        assert_eq!(files(&d), ["a.review.json", "a.sgf", "current.json", "index.json"]);
        let index: Value = serde_json::from_slice(&std::fs::read(d.join(INDEX)).unwrap()).unwrap();
        assert_eq!(index, json!({ "v": 1, "entries": [entry("a", 1)] }));
    }

    #[test]
    fn malformed_entries_are_skipped_and_kept() {
        let (d, lib) = (temp("malformed"), Library::default());
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join(INDEX), r#"{"v":1,"entries":[{"id":"ok","date":1},5,{"id":"../x","date":9},{"date":3},"s",null,{"id":7},{"id":"b","date":2},{"id":"nodate"}]}"#).unwrap();
        assert_eq!(ids(&lib.list(&d).unwrap()), ["b", "ok", "nodate"]);
        lib.write(&d, "c", None, Some(entry("c", 5))).unwrap();
        assert_eq!(ids(&lib.list(&d).unwrap()), ["c", "b", "ok", "nodate"]);
        let index: Value = serde_json::from_slice(&std::fs::read(d.join(INDEX)).unwrap()).unwrap();
        assert_eq!(index["entries"].as_array().unwrap().len(), 10); // a write never drops what it does not understand
    }

    #[test]
    fn a_corrupt_index_is_set_aside_and_the_library_goes_on() {
        let (d, lib) = (temp("corrupt"), Library::default());
        std::fs::create_dir_all(&d).unwrap();
        for (i, junk) in ["not json", r#"{"v":1}"#, "[1,2]", r#"{"entries":{}}"#].iter().enumerate() {
            std::fs::write(d.join(INDEX), junk).unwrap();
            assert_eq!(lib.list(&d).unwrap(), Vec::<Value>::new());
            assert_eq!(std::fs::read_to_string(d.join("index.json.bad")).unwrap(), *junk); // one kept: the latest
            assert!(!d.join(INDEX).exists());
            let id = format!("g{i}");
            lib.write(&d, &id, None, Some(entry(&id, 1))).unwrap();
            assert_eq!(ids(&lib.list(&d).unwrap()), [id.as_str()]);
        }
        // a write that meets a corrupt index also sets it aside instead of failing
        std::fs::write(d.join(INDEX), "{").unwrap();
        lib.write(&d, "h", None, Some(entry("h", 1))).unwrap();
        assert_eq!(ids(&lib.list(&d).unwrap()), ["h"]);
        assert_eq!(std::fs::read_to_string(d.join("index.json.bad")).unwrap(), "{");
    }

    #[test]
    fn bad_ids_and_names_are_rejected_everywhere() {
        let (root, lib) = (temp("bad"), Library::default());
        let d = root.join("inner");
        let long = "x".repeat(65);
        let ids = ["../x", "a/b", "", long.as_str(), "a.b", "é", "ｇ", "/etc/passwd", "C:\\x", "a\\b", "..", ".", "a b", "a\0", "index.json"];
        for id in ids {
            assert_eq!(code(lib.read(&d, id)), "library_bad_id", "{id:?}");
            assert_eq!(code(lib.write(&d, id, Some("(;)"), None)), "library_bad_id", "{id:?}");
            assert_eq!(code(lib.write(&d, id, None, Some(entry(id, 1)))), "library_bad_id", "{id:?}");
            assert_eq!(code(lib.delete(&d, id)), "library_bad_id", "{id:?}");
            assert_eq!(code(lib.sidecar_read(&d, id, "review")), "library_bad_id", "{id:?}");
            assert_eq!(code(lib.sidecar_write(&d, id, "review", &json!(1))), "library_bad_id", "{id:?}");
        }
        let long = "x".repeat(25);
        for name in ["", "Review", "a.b", "../x", "a/b", "a\\b", long.as_str(), "é", "review1", "re_view", "..", "a b"] {
            assert_eq!(code(lib.sidecar_read(&d, "g", name)), "library_bad_id", "{name:?}");
            assert_eq!(code(lib.sidecar_write(&d, "g", name, &json!(1))), "library_bad_id", "{name:?}");
        }
        assert!(lib.write(&d, &"x".repeat(64), Some("(;)"), None).is_ok());
        assert!(lib.sidecar_write(&d, "g", &"x".repeat(24), &json!(1)).is_ok());
        // the entry must be an object whose id is the id
        for e in [json!(["g"]), json!("g"), json!({ "id": "h" }), json!({ "date": 1 }), json!(null)] {
            assert_eq!(code(lib.write(&d, "g", Some("(;)"), Some(e.clone()))), "library_bad_id", "{e}");
        }
        assert!(!d.join("g.sgf").exists()); // a rejected write writes nothing, not even its SGF
        assert_eq!(files(&root), ["inner"]); // nothing escaped games/
    }

    #[test]
    fn sidecars_round_trip_and_delete_cascades() {
        let (d, lib) = (temp("cascade"), Library::default());
        assert_eq!(lib.sidecar_read(&d, "g", "review").unwrap(), Value::Null);
        let review = json!({ "leads": [0.5, null, -2.0], "moments": [{ "move": 12 }] });
        for id in ["g", "g-2", "g2"] {
            lib.write(&d, id, Some("(;)"), Some(entry(id, 1))).unwrap();
            lib.sidecar_write(&d, id, "review", &review).unwrap();
        }
        lib.sidecar_write(&d, "g", "memory", &json!({ "recalled": 3 })).unwrap();
        assert_eq!(lib.sidecar_read(&d, "g", "review").unwrap(), review);
        std::fs::write(d.join("g.notes.txt"), "mine").unwrap(); // not a sidecar: left alone
        lib.delete(&d, "g").unwrap();
        assert_eq!(files(&d), ["g-2.review.json", "g-2.sgf", "g.notes.txt", "g2.review.json", "g2.sgf", "index.json"]);
        assert_eq!(ids(&lib.list(&d).unwrap()), ["g-2", "g2"]);
        assert_eq!(code(lib.read(&d, "g")), "library_not_found");
        assert_eq!(lib.sidecar_read(&d, "g", "review").unwrap(), Value::Null);
        lib.delete(&d, "g").unwrap(); // again: nothing left, no error
        lib.delete(&temp("cascade-empty"), "g").unwrap(); // no folder yet
        // an unparsable sidecar reads as absent
        std::fs::write(d.join("g2.review.json"), "{").unwrap();
        assert_eq!(lib.sidecar_read(&d, "g2", "review").unwrap(), Value::Null);
    }

    #[test]
    fn current_writes_reads_and_clears() {
        let (d, lib) = (temp("current"), Library::default());
        assert_eq!(lib.current_read(&d).unwrap(), Value::Null);
        lib.current_write(&d, &Value::Null).unwrap(); // clearing nothing is fine
        let c = json!({ "id": "ai-1", "cursor": 42, "bot": { "sign": -1, "rank": "5k" }, "clock": null, "handicap": 0 });
        lib.current_write(&d, &c).unwrap();
        assert_eq!(lib.current_read(&d).unwrap(), c);
        lib.current_write(&d, &Value::Null).unwrap();
        assert!(!d.join(CURRENT).exists());
        assert_eq!(lib.current_read(&d).unwrap(), Value::Null);
        std::fs::write(d.join(CURRENT), "garbage").unwrap();
        assert_eq!(lib.current_read(&d).unwrap(), Value::Null);
    }

    #[test]
    fn sizes_are_capped() {
        let (d, lib) = (temp("caps"), Library::default());
        let max = crate::MAX_SGF as usize;
        lib.write(&d, "big", Some(&"x".repeat(max)), None).unwrap();
        assert_eq!(lib.read(&d, "big").unwrap().len(), max);
        assert_eq!(code(lib.write(&d, "big", Some(&"x".repeat(max + 1)), None)), "library_too_big");
        std::fs::write(d.join("big.sgf"), vec![b'x'; max + 1]).unwrap(); // grown behind our back
        assert_eq!(code(lib.read(&d, "big")), "library_too_big");
        let huge = json!("x".repeat(MAX_JSON as usize));
        let mut e = entry("e", 1);
        e["note"] = huge.clone();
        assert_eq!(code(lib.write(&d, "e", Some("(;)"), Some(e))), "library_too_big");
        assert!(!d.join("e.sgf").exists());
        assert_eq!(code(lib.sidecar_write(&d, "e", "review", &huge)), "library_too_big");
        assert_eq!(code(lib.current_write(&d, &huge)), "library_too_big");
        let fits = json!("x".repeat(MAX_JSON as usize - 2)); // the quotes count
        lib.sidecar_write(&d, "e", "review", &fits).unwrap();
        assert_eq!(lib.sidecar_read(&d, "e", "review").unwrap(), fits);
    }

    #[test]
    fn concurrent_writes_keep_every_entry() {
        let (d, lib) = (temp("race"), Arc::new(Library::default()));
        let threads: Vec<_> = (0..8).map(|t| {
            let (d, lib) = (d.clone(), lib.clone());
            std::thread::spawn(move || for i in 0..25 {
                let id = format!("t{t}-{i}");
                lib.write(&d, &id, Some("(;)"), Some(entry(&id, i))).unwrap();
            })
        }).collect();
        for t in threads { t.join().unwrap() }
        assert_eq!(lib.list(&d).unwrap().len(), 200);
        assert!(files(&d).iter().all(|f| !f.ends_with(".tmp")));
    }
}
