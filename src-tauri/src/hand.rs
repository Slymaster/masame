// The opponent's hand (a Workshop option, off by default): a small glTF model fetched once from the project's GitHub
// repository when the option is turned on, never bundled. Size and SHA-256 are pinned here; the webview never supplies a
// URL, and reads the bytes back only through `hand_bytes`, which verifies them again.

use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};
use tokio::io::AsyncWriteExt;

use crate::failure::{Failure, Res};

// Released apps pin this file: it is never modified. A new hand ships as hand-v2.glb with its own pins.
const HAND_URL: &str = "https://raw.githubusercontent.com/Slymaster/masame/main/downloads/hand/hand-v1.glb";
const HAND_SIZE: u64 = 529_740;
const HAND_SHA256: &str = "07b0e19ca7b264bcfa504131b38ff82ef1cd05a7984cf0157784604ce705de96";
const FILE: &str = "hand-v1.glb";
const PART: &str = "hand-v1.glb.part";

/// One download at a time: a second click waits, then finds the file installed.
static ONE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn dir(app: &AppHandle) -> Res<PathBuf> { Ok(crate::data_dir(app).map_err(|e| Failure::with("hand_dir", e.detail.unwrap_or_default()))?.join("hand")) }

/// The pinned URL. Debug builds only: `MASAME_HAND_URL` may point at a test copy (size and hash stay pinned). Release
/// builds compile the override out.
fn source() -> String {
    #[cfg(debug_assertions)]
    if let Ok(u) = std::env::var("MASAME_HAND_URL") { return u }
    HAND_URL.into()
}

/// The https-only app client; plain http only to this machine, and only in debug builds (the override).
fn client_for(url: &str, https: &reqwest::Client) -> Res<reqwest::Client> {
    let u = reqwest::Url::parse(url).map_err(|_| Failure::new("url_rejected"))?;
    match u.scheme() {
        "https" => Ok(https.clone()),
        "http" if cfg!(debug_assertions) && matches!(u.host_str(), Some("localhost" | "127.0.0.1" | "[::1]")) =>
            crate::networks::builder().build().map_err(|e| Failure::with("hand_network", e)),
        _ => Err(Failure::new("url_rejected")),
    }
}

fn hex(h: Sha256) -> String { h.finalize().iter().map(|b| format!("{b:02x}")).collect() }

fn present(dir: &Path, size: u64) -> bool { std::fs::metadata(dir.join(FILE)).is_ok_and(|m| m.is_file() && m.len() == size) }

/// The installed file if its size and SHA-256 match the pin; otherwise it is deleted (a later install fetches it again).
fn read(dir: &Path, size: u64, sha256: &str) -> Res<Vec<u8>> {
    let path = dir.join(FILE);
    let len = std::fs::metadata(&path).map_err(|e| Failure::with("hand_missing", e))?.len();
    let bad = |code| { let _ = std::fs::remove_file(&path); Err(Failure::new(code)) };
    if len != size { return bad("size_mismatch") } // checked before reading, so a swapped-in huge file is never loaded
    let bytes = std::fs::read(&path).map_err(|e| Failure::with("hand_missing", e))?;
    if bytes.len() as u64 != size { return bad("size_mismatch") }
    if !hex(Sha256::new_with_prefix(&bytes)).eq_ignore_ascii_case(sha256) { return bad("hash_mismatch") }
    Ok(bytes)
}

/// Streams `url` into the `.part` file, at most `size` bytes, hashing as it goes.
async fn fetch(c: &reqwest::Client, url: &str, part: &Path, size: u64, sha256: &str) -> Res<()> {
    let net = |e: reqwest::Error| Failure::with("hand_network", e.without_url()); // the UI shows the detail; the URL is noise
    let write = |e: std::io::Error| Failure::with("write_failed", e);
    let mut r = c.get(url).send().await.map_err(net)?;
    // 200 only: the shared client follows no redirect, so a 3xx (or a 206) lands here.
    if r.status() != reqwest::StatusCode::OK { return Err(Failure::with("hand_http", r.status())) }
    if r.content_length().is_some_and(|n| n > size) { return Err(Failure::new("too_large")) }
    // A stale `.part` (file or symlink) is unlinked, never followed; create_new (O_CREAT|O_EXCL) then refuses anything
    // planted since, a symlink included, so the bytes only ever go into a fresh file of our own.
    let _ = tokio::fs::remove_file(part).await;
    let mut f = tokio::fs::OpenOptions::new().write(true).create_new(true).open(part).await.map_err(write)?;
    let (mut h, mut have) = (Sha256::new(), 0u64);
    while let Some(chunk) = r.chunk().await.map_err(net)? {
        have += chunk.len() as u64;
        if have > size { return Err(Failure::new("too_large")) }
        h.update(&chunk);
        f.write_all(&chunk).await.map_err(write)?;
    }
    f.sync_all().await.map_err(write)?;
    if have != size { return Err(Failure::new("size_mismatch")) }
    if !hex(h).eq_ignore_ascii_case(sha256) { return Err(Failure::new("hash_mismatch")) }
    Ok(())
}

/// Downloads and installs the model unless a verified copy is already there. Any failure leaves no `.part` behind.
async fn install(c: &reqwest::Client, url: &str, dir: &Path, size: u64, sha256: &str) -> Res<()> {
    let _one = ONE.lock().await;
    if read(dir, size, sha256).is_ok() { return Ok(()) }
    std::fs::create_dir_all(dir).map_err(|e| Failure::with("hand_dir", e))?;
    let part = dir.join(PART);
    let r = match fetch(c, url, &part, size, sha256).await {
        // Same folder: atomic. A symlink at the destination is replaced itself, never written through.
        Ok(()) => std::fs::rename(&part, dir.join(FILE)).map_err(|e| Failure::with("write_failed", e)),
        Err(e) => Err(e),
    };
    if r.is_err() { let _ = std::fs::remove_file(&part); }
    r
}

#[tauri::command]
pub async fn hand_install(app: AppHandle, s: State<'_, crate::App>) -> Res<()> {
    let url = source();
    install(&client_for(&url, &s.http)?, &url, &dir(&app)?, HAND_SIZE, HAND_SHA256).await
}

#[tauri::command]
pub fn hand_state(app: AppHandle) -> Res<bool> { Ok(present(&dir(&app)?, HAND_SIZE)) }

/// The verified model as raw bytes (an ArrayBuffer in the webview), not a JSON array.
#[tauri::command]
pub async fn hand_bytes(app: AppHandle) -> Res<tauri::ipc::Response> {
    read(&dir(&app)?, HAND_SIZE, HAND_SHA256).map(tauri::ipc::Response::new)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::networks::tests::{reply, serve};

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("masame-hand-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }
    fn sha(b: &[u8]) -> String { hex(Sha256::new_with_prefix(b)) }
    fn local() -> reqwest::Client { crate::networks::builder().build().unwrap() } // same policies as the app client, minus https_only
    const BODY: &[u8] = b"glTF stand-in";

    #[test]
    fn pinned_file_matches_the_repository_copy() {
        let b = std::fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("../downloads/hand").join(FILE)).unwrap();
        assert_eq!((b.len() as u64, sha(&b).as_str()), (HAND_SIZE, HAND_SHA256), "re-pin HAND_SIZE and HAND_SHA256");
        assert!(HAND_URL.starts_with("https://raw.githubusercontent.com/Slymaster/masame/main/") && HAND_URL.ends_with(FILE));
    }

    #[tokio::test]
    async fn a_good_file_is_installed_once() {
        let d = tmp("good");
        let url = serve(reply(&format!("200 OK\r\nContent-Length: {}", BODY.len()), BODY));
        install(&local(), &url, &d, BODY.len() as u64, &sha(BODY)).await.unwrap();
        assert!(present(&d, BODY.len() as u64) && !d.join(PART).exists());
        assert_eq!(read(&d, BODY.len() as u64, &sha(BODY)).unwrap(), BODY);
        // Already there: no request at all (port 1 is closed).
        install(&local(), "http://127.0.0.1:1/", &d, BODY.len() as u64, &sha(BODY)).await.unwrap();
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[tokio::test]
    async fn two_clicks_do_not_race() {
        let d = tmp("race");
        let url = serve(reply(&format!("200 OK\r\nContent-Length: {}", BODY.len()), BODY));
        let (c, n, h) = (local(), BODY.len() as u64, sha(BODY));
        let (a, b) = tokio::join!(install(&c, &url, &d, n, &h), install(&c, &url, &d, n, &h));
        assert!(a.is_ok() && b.is_ok() && present(&d, n) && !d.join(PART).exists());
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[tokio::test]
    async fn a_wrong_hash_is_rejected_and_cleaned_up() {
        let d = tmp("hash");
        let url = serve(reply(&format!("200 OK\r\nContent-Length: {}", BODY.len()), BODY));
        let e = install(&local(), &url, &d, BODY.len() as u64, &"0".repeat(64)).await.unwrap_err();
        assert_eq!(e.code, "hash_mismatch");
        assert!(!d.join(PART).exists() && !d.join(FILE).exists());
        let e = install(&local(), &url, &d, BODY.len() as u64 + 1, &sha(BODY)).await.unwrap_err();
        assert_eq!(e.code, "size_mismatch", "a short body");
        assert!(!d.join(PART).exists() && !d.join(FILE).exists());
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[tokio::test]
    async fn an_oversize_body_aborts() {
        let d = tmp("big");
        let big = vec![b'x'; 64 * 1024];
        let declared = serve(reply(&format!("200 OK\r\nContent-Length: {}", big.len()), &big));
        let streamed = serve(reply("200 OK", &big)); // no Content-Length: the cap is enforced while streaming
        for url in [declared, streamed] {
            let e = install(&local(), &url, &d, 1000, &sha(&big[..1000])).await.unwrap_err();
            assert_eq!(e.code, "too_large", "{url}");
            assert!(!d.join(PART).exists() && !d.join(FILE).exists());
        }
        let _ = std::fs::remove_dir_all(&d);
    }

    #[tokio::test]
    async fn redirects_and_errors_are_refused() {
        let d = tmp("redirect");
        let target = serve(reply(&format!("200 OK\r\nContent-Length: {}", BODY.len()), BODY));
        let hop = serve(reply(&format!("302 Found\r\nLocation: {target}\r\nContent-Length: 0"), b""));
        let e = install(&local(), &hop, &d, BODY.len() as u64, &sha(BODY)).await.unwrap_err();
        assert_eq!((e.code, e.detail.as_deref()), ("hand_http", Some("302 Found")));
        let gone = serve(reply("404 Not Found\r\nContent-Length: 0", b""));
        assert_eq!(install(&local(), &gone, &d, BODY.len() as u64, &sha(BODY)).await.unwrap_err().code, "hand_http");
        assert!(!d.join(PART).exists() && !d.join(FILE).exists());
        let _ = std::fs::remove_dir_all(&d);
    }

    /// Two outside targets: an existing file that must stay untouched, and a missing path that must not appear.
    #[cfg(unix)]
    fn outside(name: &str) -> (PathBuf, PathBuf) {
        let o = tmp(&format!("{name}-outside"));
        std::fs::create_dir_all(&o).unwrap();
        std::fs::write(o.join("victim"), "keep me").unwrap();
        (o.join("victim"), o.join("absent"))
    }

    #[cfg(unix)]
    fn installed_cleanly(d: &Path, victim: &Path, absent: &Path) {
        let m = std::fs::symlink_metadata(d.join(FILE)).unwrap();
        assert!(m.file_type().is_file(), "a regular file, not a link");
        assert_eq!(read(d, BODY.len() as u64, &sha(BODY)).unwrap(), BODY);
        assert!(!d.join(PART).exists() && std::fs::symlink_metadata(d.join(PART)).is_err());
        assert_eq!(std::fs::read(victim).unwrap(), b"keep me");
        assert!(std::fs::symlink_metadata(absent).is_err());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_symlink_at_the_part_path_is_not_followed() {
        let (victim, absent) = outside("part");
        for target in [&victim, &absent] {
            let d = tmp("partlink");
            std::fs::create_dir_all(&d).unwrap();
            std::os::unix::fs::symlink(target, d.join(PART)).unwrap();
            let url = serve(reply(&format!("200 OK\r\nContent-Length: {}", BODY.len()), BODY));
            install(&local(), &url, &d, BODY.len() as u64, &sha(BODY)).await.unwrap();
            installed_cleanly(&d, &victim, &absent);
            std::fs::remove_dir_all(&d).unwrap();
        }
        std::fs::remove_dir_all(victim.parent().unwrap()).unwrap();
    }

    /// The link itself is replaced by the verified file; its target is never written. A dangling link survives `read`
    /// (no metadata), so it reaches the rename itself.
    #[cfg(unix)]
    #[tokio::test]
    async fn a_symlink_at_the_final_path_is_replaced_not_followed() {
        let (victim, absent) = outside("final");
        for target in [&victim, &absent] {
            let d = tmp("finallink");
            std::fs::create_dir_all(&d).unwrap();
            std::os::unix::fs::symlink(target, d.join(FILE)).unwrap();
            let url = serve(reply(&format!("200 OK\r\nContent-Length: {}", BODY.len()), BODY));
            install(&local(), &url, &d, BODY.len() as u64, &sha(BODY)).await.unwrap();
            installed_cleanly(&d, &victim, &absent);
            std::fs::remove_dir_all(&d).unwrap();
        }
        std::fs::remove_dir_all(victim.parent().unwrap()).unwrap();
    }

    #[test]
    fn state_needs_the_pinned_size() {
        let d = tmp("state");
        assert!(!present(&d, 3), "no folder");
        std::fs::create_dir_all(&d).unwrap();
        assert!(!present(&d, 3), "no file");
        std::fs::write(d.join(FILE), "abcd").unwrap();
        assert!(!present(&d, 3), "wrong size");
        std::fs::write(d.join(FILE), "abc").unwrap();
        assert!(present(&d, 3));
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn bytes_are_verified_again() {
        let d = tmp("bytes");
        assert_eq!(read(&d, 3, &sha(b"abc")).unwrap_err().code, "hand_missing");
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join(FILE), "abc").unwrap();
        assert_eq!(read(&d, 3, &sha(b"abc")).unwrap(), b"abc");
        std::fs::write(d.join(FILE), "abd").unwrap(); // same size, tampered
        assert_eq!(read(&d, 3, &sha(b"abc")).unwrap_err().code, "hash_mismatch");
        assert!(!d.join(FILE).exists(), "a bad file is deleted");
        std::fs::write(d.join(FILE), "abcd").unwrap();
        assert_eq!(read(&d, 3, &sha(b"abc")).unwrap_err().code, "size_mismatch");
        assert!(!d.join(FILE).exists());
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn only_https_or_a_local_debug_override() {
        let https = crate::networks::client();
        assert!(client_for(HAND_URL, &https).is_ok());
        for bad in ["http://evil.example/hand.glb", "http://127.0.0.1.evil.example/", "file:///etc/passwd", "ftp://x/y", "not a url"] {
            assert_eq!(client_for(bad, &https).unwrap_err().code, "url_rejected", "{bad}");
        }
        // Plain http to this machine: debug builds only (the override); refused in release.
        assert_eq!(client_for("http://127.0.0.1:8000/hand-v1.glb", &https).is_ok(), cfg!(debug_assertions));
        assert_eq!(client_for("http://localhost:8000/hand-v1.glb", &https).is_ok(), cfg!(debug_assertions));
    }

    /// The only test touching MASAME_HAND_URL. `cargo test --release hand::` checks the release side.
    #[test]
    fn the_override_is_debug_only() {
        std::env::set_var("MASAME_HAND_URL", "http://127.0.0.1:9/x.glb");
        let s = source();
        std::env::remove_var("MASAME_HAND_URL");
        assert_eq!(s, if cfg!(debug_assertions) { "http://127.0.0.1:9/x.glb" } else { HAND_URL });
        assert_eq!(source(), HAND_URL);
    }
}
