// OGS login: OAuth2 authorization code + PKCE in the player's own browser, redirected to a loopback listener.
// The refresh token never leaves this side; the webview only ever gets a short-lived access token.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{oneshot, Mutex};

use crate::failure::{Failure, Res};

const BASE: &str = "https://online-go.com";
const CLIENT_ID: &str = "Zcn8DN7Jg5uCKB184btHYhvUllN6cxnU6enuDdOJ"; // Masame's public OAuth client id on OGS (not a secret)
const PORT: u16 = 0; // 0 = any free port (RFC 8252 §7.3); 47321 if OGS wants the exact registered URI
const FILE: &str = "ogs.json";
const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);
const HEAD_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_HEAD: usize = 8192;
const REFRESH_MARGIN: u64 = 86_400; // access tokens last 30 days; refresh in the last one

#[derive(Serialize, Deserialize, Clone)]
pub struct Tokens { access: String, refresh: String, expires_at: u64 }

#[derive(Default)]
pub struct Ogs {
    tokens: Mutex<Option<Tokens>>, // None until read from the file
    cancel: std::sync::Mutex<Option<oneshot::Sender<()>>>, // dropping it cancels the pending login
    running: Mutex<()>, // a cancelled login releases its port before the next one binds
}

fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs()) }

fn random(bytes: usize) -> String {
    let mut b = vec![0; bytes];
    getrandom::fill(&mut b).expect("OS random generator");
    URL_SAFE_NO_PAD.encode(b)
}

fn challenge(verifier: &str) -> String { URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes())) }

fn authorize_url(base: &str, redirect: &str, state: &str, challenge: &str) -> String {
    let mut u = reqwest::Url::parse(&format!("{base}/oauth2/authorize/")).expect("base URL");
    u.query_pairs_mut().extend_pairs([
        ("response_type", "code"), ("client_id", CLIENT_ID), ("redirect_uri", redirect), ("scope", "read write"),
        ("state", state), ("code_challenge", challenge), ("code_challenge_method", "S256"),
    ]);
    u.into()
}

fn same(a: &str, b: &str) -> bool { a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0, |d, (x, y)| d | (x ^ y)) == 0 }

const PAGE_OK: &str = "Masame est connecté à OGS. Tu peux fermer cet onglet.</p><p lang=\"en\">Masame is connected to OGS. You can close this tab.";
const PAGE_DENIED: &str = "Connexion à OGS annulée. Tu peux fermer cet onglet.</p><p lang=\"en\">OGS sign-in cancelled. You can close this tab.";
const PAGE_FAILED: &str = "La connexion à OGS a échoué. Recommence depuis Masame.</p><p lang=\"en\">Signing in to OGS failed. Try again from Masame.";

/// Static pages only: nothing from the request is ever echoed back.
fn reply(status: &str, text: &str) -> String {
    let body = if text.is_empty() { String::new() } else {
        format!("<!doctype html><html lang=\"fr\"><meta charset=\"utf-8\"><title>Masame</title>\
            <style>body{{font:16px/1.5 system-ui,sans-serif;max-width:30em;margin:20vh auto;padding:0 1em;text-align:center}}</style><p>{text}</p></html>")
    };
    format!("HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}", body.len())
}

/// The reply to one request line from the browser, and the login's outcome when this request settles it.
fn callback(line: &str, state: &str) -> (String, Option<Res<String>>) {
    let not_found = || (reply("404 Not Found", ""), None);
    let mut parts = line.split(' ');
    let (Some("GET"), Some(target)) = (parts.next(), parts.next()) else { return not_found() };
    let Some(u) = target.starts_with('/').then(|| reqwest::Url::parse(&format!("http://127.0.0.1{target}")).ok()).flatten()
    else { return not_found() };
    if u.path() != "/callback" { return not_found() }
    let get = |k: &str| u.query_pairs().find(|(n, _)| n == k).map(|(_, v)| v.into_owned());
    // Anything without our state (another page, a forged callback) leaves the login waiting.
    if !get("state").is_some_and(|s| same(&s, state)) { return (reply("400 Bad Request", PAGE_FAILED), None) }
    if get("error").is_some() { return (reply("200 OK", PAGE_DENIED), Some(Err(Failure::new("ogs_denied")))) }
    match get("code").filter(|c| !c.is_empty()) {
        Some(code) => (reply("200 OK", PAGE_OK), Some(Ok(code))),
        None => (reply("400 Bad Request", PAGE_FAILED), None),
    }
}

/// One browser connection: reads the request head (capped, short timeout), answers, and maybe settles the login.
async fn serve(mut s: TcpStream, state: String) -> Option<Res<String>> {
    let mut head = Vec::new();
    let mut buf = [0; MAX_HEAD];
    let read = async {
        while head.len() < MAX_HEAD && !head.windows(4).any(|w| w == b"\r\n\r\n") {
            let n = s.read(&mut buf[..MAX_HEAD - head.len()]).await?;
            if n == 0 { break }
            head.extend_from_slice(&buf[..n]);
        }
        Ok::<_, std::io::Error>(())
    };
    if !matches!(tokio::time::timeout(HEAD_TIMEOUT, read).await, Ok(Ok(()))) { return None }
    let line = String::from_utf8_lossy(head.split(|&b| b == b'\r' || b == b'\n').next().unwrap_or_default()).into_owned();
    let (response, outcome) = callback(&line, &state);
    let _ = s.write_all(response.as_bytes()).await;
    let _ = s.shutdown().await;
    outcome
}

/// Serves connections concurrently (a browser may hold an idle preconnect open) until one settles the login.
async fn wait_for_code(l: TcpListener, state: String) -> Res<String> {
    let mut conns = tokio::task::JoinSet::new();
    loop {
        tokio::select! {
            a = l.accept() => if let Ok((s, _)) = a { conns.spawn(serve(s, state.clone())); },
            Some(r) = conns.join_next() => if let Ok(Some(r)) = r { return r },
        }
    }
}

/// Form body, application/x-www-form-urlencoded (reqwest's `form` feature is not enabled).
fn form(pairs: &[(&str, &str)]) -> String {
    let mut u = reqwest::Url::parse("http://x/").unwrap();
    u.query_pairs_mut().extend_pairs(pairs);
    u.query().unwrap_or_default().into()
}

#[derive(Deserialize)]
struct Grant { access_token: String, refresh_token: String, expires_in: u64 }

/// POST to the token endpoint. A 400/401 (invalid_grant, …) is `ogs_login_required`; anything else `ogs_network`.
async fn grant(c: &reqwest::Client, base: &str, pairs: &[(&str, &str)]) -> Res<Tokens> {
    let net = |e: &dyn ToString| Failure::with("ogs_network", e.to_string());
    // Trailing slash: without it OGS redirects, and the POST would come back as a GET.
    let r = c.post(format!("{base}/oauth2/token/")).header(reqwest::header::CONTENT_TYPE, "application/x-www-form-urlencoded")
        .body(form(pairs)).send().await.map_err(|e| net(&e))?;
    let status = r.status();
    if status == 400 || status == 401 { return Err(Failure::with("ogs_login_required", status)) }
    if !status.is_success() { return Err(net(&status)) }
    let g: Grant = serde_json::from_slice(&r.bytes().await.map_err(|e| net(&e))?).map_err(|_| net(&"bad token response"))?;
    if g.access_token.is_empty() || g.refresh_token.is_empty() { return Err(net(&"bad token response")) }
    Ok(Tokens { access: g.access_token, refresh: g.refresh_token, expires_at: now().saturating_add(g.expires_in) })
}

fn load(dir: &Path) -> Option<Tokens> { serde_json::from_slice(&std::fs::read(dir.join(FILE)).ok()?).ok() }

// shortcut: a user-only file, not the keychain (ad-hoc macOS signing would re-prompt keychain access after every update); move to the keychain once the app is notarized
fn save(dir: &Path, t: &Tokens) -> std::io::Result<()> {
    use std::io::Write;
    std::fs::create_dir_all(dir)?;
    let tmp = dir.join(format!("{FILE}.tmp"));
    let _ = std::fs::remove_file(&tmp); // create_new below: a leftover never keeps looser permissions
    let mut o = std::fs::OpenOptions::new();
    o.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut o, 0o600);
    let mut f = o.open(&tmp)?;
    f.write_all(&serde_json::to_vec(t).unwrap())?;
    f.sync_all()?;
    std::fs::rename(&tmp, dir.join(FILE))
}

fn keep(dir: &Path, cache: &mut Option<Tokens>, t: Tokens) {
    if let Err(e) = save(dir, &t) { eprintln!("[ogs] tokens not saved: {e}") } // still usable for this session
    *cache = Some(t);
}

fn forget(dir: &Path, cache: &mut Option<Tokens>) {
    let _ = std::fs::remove_file(dir.join(FILE));
    *cache = None;
}

/// A valid access token, refreshed first when less than a day remains.
async fn token(c: &reqwest::Client, base: &str, dir: &Path, cache: &Mutex<Option<Tokens>>) -> Res<String> {
    // Held across the refresh: the refresh token rotates, so a second concurrent refresh would be rejected.
    let mut t = cache.lock().await;
    if t.is_none() { *t = load(dir) }
    let Some(cur) = t.clone() else { return Err(Failure::new("ogs_login_required")) };
    if cur.expires_at > now().saturating_add(REFRESH_MARGIN) { return Ok(cur.access) }
    match grant(c, base, &[("grant_type", "refresh_token"), ("refresh_token", &cur.refresh), ("client_id", CLIENT_ID)]).await {
        Ok(new) => { let a = new.access.clone(); keep(dir, &mut t, new); Ok(a) }
        Err(e) if e.code == "ogs_login_required" => { forget(dir, &mut t); Err(e) }
        Err(_) if cur.expires_at > now() => Ok(cur.access), // offline: the old token still works until it expires
        Err(e) => Err(e),
    }
}

async fn login(c: &reqwest::Client, base: &str, dir: &Path, cache: &Mutex<Option<Tokens>>, open: impl FnOnce(&str) -> Res<()>) -> Res<()> {
    let (verifier, state) = (random(32), random(16));
    let l = TcpListener::bind(("127.0.0.1", PORT)).await.map_err(|e| Failure::with("ogs_port_busy", e))?;
    let port = l.local_addr().map_err(|e| Failure::with("ogs_port_busy", e))?.port();
    let redirect = format!("http://127.0.0.1:{port}/callback");
    open(&authorize_url(base, &redirect, &state, &challenge(&verifier)))?;
    let code = tokio::time::timeout(LOGIN_TIMEOUT, wait_for_code(l, state)).await.map_err(|_| Failure::new("ogs_timeout"))??;
    let pairs = [("grant_type", "authorization_code"), ("code", &code), ("redirect_uri", &redirect), ("client_id", CLIENT_ID), ("code_verifier", &verifier)];
    // OGS refusing the code (expired, already used) means the sign-in did not go through.
    let t = grant(c, base, &pairs).await.map_err(|e| if e.code == "ogs_login_required" { Failure { code: "ogs_denied", ..e } } else { e })?;
    keep(dir, &mut *cache.lock().await, t);
    Ok(())
}

async fn logout(c: &reqwest::Client, base: &str, dir: &Path, cache: &Mutex<Option<Tokens>>) {
    let t = {
        let mut t = cache.lock().await;
        let old = t.take().or_else(|| load(dir));
        forget(dir, &mut t);
        old
    };
    // Revoking the refresh token also revokes its access token. Best effort: logged out locally either way.
    if let Some(t) = t {
        let _ = c.post(format!("{base}/oauth2/revoke_token/")).header(reqwest::header::CONTENT_TYPE, "application/x-www-form-urlencoded")
            .body(form(&[("token", &t.refresh), ("client_id", CLIENT_ID)])).timeout(Duration::from_secs(10)).send().await;
    }
}

/// Signs in through the default browser; a new call or ogs_login_cancel rejects a pending one with ogs_cancelled.
#[tauri::command]
pub async fn ogs_login(app: AppHandle, s: State<'_, crate::App>) -> Res<()> {
    let (tx, rx) = oneshot::channel::<()>();
    drop(s.ogs.cancel.lock().unwrap().replace(tx));
    let dir = crate::data_dir(&app)?;
    tokio::select! {
        r = async { let _port = s.ogs.running.lock().await; login(&s.http, BASE, &dir, &s.ogs.tokens, crate::open_url).await } => r,
        _ = rx => Err(Failure::new("ogs_cancelled")),
    }
}

#[tauri::command]
pub fn ogs_login_cancel(s: State<'_, crate::App>) { drop(s.ogs.cancel.lock().unwrap().take()) }

#[tauri::command]
pub async fn ogs_token(app: AppHandle, s: State<'_, crate::App>) -> Res<String> { token(&s.http, BASE, &crate::data_dir(&app)?, &s.ogs.tokens).await }

#[tauri::command]
pub async fn ogs_logout(app: AppHandle, s: State<'_, crate::App>) -> Res<()> {
    logout(&s.http, BASE, &crate::data_dir(&app)?, &s.ogs.tokens).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::io::{Read, Write};
    use std::path::PathBuf;
    use std::sync::Arc;

    fn http() -> reqwest::Client { crate::networks::builder().build().unwrap() } // client() minus https_only

    fn dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("masame-ogs-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    /// Local token endpoint: answers each request with the next reply (the last one repeats) and records the requests.
    fn endpoint(replies: Vec<(&'static str, &'static str)>) -> (String, Arc<std::sync::Mutex<Vec<String>>>) {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", l.local_addr().unwrap());
        let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
        let log = seen.clone();
        std::thread::spawn(move || for (i, mut s) in l.incoming().flatten().enumerate() {
            let (mut req, mut buf) = (Vec::new(), [0; 4096]);
            loop {
                let n = s.read(&mut buf).unwrap_or(0);
                if n == 0 { break }
                req.extend_from_slice(&buf[..n]);
                let text = String::from_utf8_lossy(&req).into_owned();
                let Some(end) = text.find("\r\n\r\n") else { continue };
                let len = text[..end].lines().find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse().unwrap())).unwrap_or(0);
                if req.len() >= end + 4 + len { break }
            }
            log.lock().unwrap().push(String::from_utf8_lossy(&req).into_owned());
            std::thread::sleep(Duration::from_millis(100)); // a slow server, so concurrent callers overlap
            let (status, body) = replies[i.min(replies.len() - 1)];
            let _ = s.write_all(format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes());
        });
        (base, seen)
    }

    const GRANT: &str = r#"{"access_token":"a2","refresh_token":"r2","expires_in":2592000,"token_type":"Bearer","scope":"read write"}"#;

    fn stored(d: &Path, expires_in: i64) -> Mutex<Option<Tokens>> {
        save(d, &Tokens { access: "a1".into(), refresh: "r1".into(), expires_at: (now() as i64 + expires_in) as u64 }).unwrap();
        Mutex::new(None)
    }

    fn body(req: &str) -> HashMap<String, String> {
        reqwest::Url::parse(&format!("http://x/?{}", req.split("\r\n\r\n").nth(1).unwrap())).unwrap().query_pairs().into_owned().collect()
    }

    #[test]
    fn pkce_rfc7636_appendix_b() {
        assert_eq!(challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
        let v = random(32);
        assert_eq!(v.len(), 43);
        assert!(v.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'));
        assert_ne!(v, random(32));
        assert_eq!(random(16).len(), 22);
    }

    #[test]
    fn authorize_url_params() {
        let url = authorize_url(BASE, "http://127.0.0.1:1234/callback", "s+t/=", "ch");
        assert!(url.starts_with("https://online-go.com/oauth2/authorize/?"));
        assert!(url.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A1234%2Fcallback") && url.contains("scope=read+write") && url.contains("state=s%2Bt%2F%3D"));
        let q: HashMap<String, String> = reqwest::Url::parse(&url).unwrap().query_pairs().into_owned().collect();
        let want = [("response_type", "code"), ("client_id", CLIENT_ID), ("redirect_uri", "http://127.0.0.1:1234/callback"), ("scope", "read write"),
            ("state", "s+t/="), ("code_challenge", "ch"), ("code_challenge_method", "S256")];
        assert_eq!(q, want.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect());
    }

    #[test]
    fn request_lines() {
        let out = |line: &str| callback(line, "st").1;
        for ignored in ["GET /favicon.ico HTTP/1.1", "GET /callbackx?state=st&code=c HTTP/1.1", "POST /callback?state=st&code=c HTTP/1.1",
            "GET http://evil/callback?state=st&code=c HTTP/1.1", "GET //evil/callback?state=st&code=c HTTP/1.1", "", "garbage",
            "GET /callback?state=wrong&code=c HTTP/1.1", "GET /callback?code=c HTTP/1.1", "GET /callback?state=s&code=c HTTP/1.1",
            "GET /callback?state=wrong&error=access_denied HTTP/1.1", "GET /callback?state=st HTTP/1.1", "GET /callback?state=st&code= HTTP/1.1"] {
            assert_eq!(out(ignored), None, "{ignored}");
        }
        assert!(callback("GET /x HTTP/1.1", "st").0.starts_with("HTTP/1.1 404"));
        assert!(callback("GET /callback?state=wrong&code=c HTTP/1.1", "st").0.starts_with("HTTP/1.1 400"));
        assert_eq!(out("GET /callback?state=st&error=access_denied HTTP/1.1"), Some(Err(Failure::new("ogs_denied"))));
        assert_eq!(out("GET /callback?error=server_error&state=st&code=c HTTP/1.1"), Some(Err(Failure::new("ogs_denied"))));
        let (page, code) = callback("GET /callback?state=st&code=a%2Fb%3Cscript%3E HTTP/1.1", "st");
        assert_eq!(code, Some(Ok("a/b<script>".into())));
        assert!(page.starts_with("HTTP/1.1 200") && page.contains("Cache-Control: no-store\r\n") && page.contains("Connection: close\r\n"));
        assert!(page.contains("Tu peux fermer cet onglet") && !page.contains("script>") && !page.contains("a/b"), "nothing echoed");
    }

    /// The whole login: a thread plays the browser against the loopback listener, then the code goes to a fake token endpoint.
    #[tokio::test]
    async fn login_end_to_end() {
        let (base, seen) = endpoint(vec![("200 OK", GRANT)]);
        let d = dir("login");
        let cache = Mutex::new(None);
        let browser = std::sync::Mutex::new(None);
        login(&http(), &base, &d, &cache, |url| {
            let q: HashMap<String, String> = reqwest::Url::parse(url).unwrap().query_pairs().into_owned().collect();
            let addr = format!("127.0.0.1:{}", reqwest::Url::parse(&q["redirect_uri"]).unwrap().port().unwrap());
            let (state, ch) = (q["state"].clone(), q["code_challenge"].clone());
            *browser.lock().unwrap() = Some((ch, std::thread::spawn(move || {
                let get = |target: &str| {
                    let mut s = std::net::TcpStream::connect(&addr).unwrap();
                    s.write_all(format!("GET {target} HTTP/1.1\r\nHost: {addr}\r\n\r\n").as_bytes()).unwrap();
                    let mut r = String::new();
                    s.read_to_string(&mut r).unwrap();
                    r
                };
                let _idle = std::net::TcpStream::connect(&addr).unwrap(); // a preconnect that never sends a request
                assert!(get("/favicon.ico").starts_with("HTTP/1.1 404"));
                assert!(get("/callback?state=forged&code=evil").starts_with("HTTP/1.1 400"));
                assert!(get("/callback?state=forged&error=access_denied").starts_with("HTTP/1.1 400"));
                let ok = get(&format!("/callback?state={state}&code=the-code"));
                assert!(ok.starts_with("HTTP/1.1 200") && ok.contains("Cache-Control: no-store") && !ok.contains("the-code"));
            })));
            Ok(())
        }).await.unwrap();
        let (ch, thread) = browser.lock().unwrap().take().unwrap();
        thread.join().unwrap();
        let reqs = seen.lock().unwrap().clone();
        assert_eq!(reqs.len(), 1);
        assert!(reqs[0].starts_with("POST /oauth2/token/ HTTP/1.1"));
        assert!(!reqs[0].contains("client_secret"));
        let b = body(&reqs[0]);
        assert_eq!((b["grant_type"].as_str(), b["code"].as_str(), b["client_id"].as_str()), ("authorization_code", "the-code", CLIENT_ID));
        assert!(b["redirect_uri"].starts_with("http://127.0.0.1:") && b["redirect_uri"].ends_with("/callback"));
        assert_eq!(challenge(&b["code_verifier"]), ch, "the verifier matches the challenge sent to the browser");
        let t = load(&d).unwrap();
        assert_eq!((t.access.as_str(), t.refresh.as_str()), ("a2", "r2"));
        assert_eq!(token(&http(), &base, &d, &cache).await.unwrap(), "a2");
        assert_eq!(seen.lock().unwrap().len(), 1, "a fresh token is not refreshed");
    }

    #[tokio::test]
    async fn rejected_code_is_denied() {
        let (base, _) = endpoint(vec![("400 Bad Request", r#"{"error":"invalid_grant"}"#)]);
        let r = login(&http(), &base, &dir("rejected"), &Mutex::new(None), |url| {
            let q: HashMap<String, String> = reqwest::Url::parse(url).unwrap().query_pairs().into_owned().collect();
            let mut s = std::net::TcpStream::connect(reqwest::Url::parse(&q["redirect_uri"]).unwrap().socket_addrs(|| None).unwrap()[0]).unwrap();
            s.write_all(format!("GET /callback?code=c&state={} HTTP/1.1\r\n\r\n", q["state"]).as_bytes()).unwrap();
            Ok(())
        }).await;
        assert_eq!(r.unwrap_err().code, "ogs_denied");
    }

    #[cfg(unix)]
    #[test]
    fn token_file_is_private_and_atomic() {
        use std::os::unix::fs::PermissionsExt;
        let d = dir("file");
        std::fs::write(d.join("ogs.json.tmp"), "stale").unwrap();
        std::fs::set_permissions(d.join("ogs.json.tmp"), std::fs::Permissions::from_mode(0o644)).unwrap();
        save(&d, &Tokens { access: "a".into(), refresh: "r".into(), expires_at: 1 }).unwrap();
        assert_eq!(std::fs::metadata(d.join(FILE)).unwrap().permissions().mode() & 0o777, 0o600);
        assert!(!d.join("ogs.json.tmp").exists());
        save(&d, &Tokens { access: "b".into(), refresh: "s".into(), expires_at: 2 }).unwrap();
        let t = load(&d).unwrap();
        assert_eq!((t.access.as_str(), t.refresh.as_str(), t.expires_at), ("b", "s", 2));
        let names: Vec<_> = std::fs::read_dir(&d).unwrap().flatten().map(|e| e.file_name()).collect();
        assert_eq!(names, [FILE]);
    }

    #[tokio::test]
    async fn refresh_rotates_and_saves() {
        let (base, seen) = endpoint(vec![("200 OK", GRANT)]);
        let d = dir("rotate");
        let cache = stored(&d, 3600);
        assert_eq!(token(&http(), &base, &d, &cache).await.unwrap(), "a2");
        let req = seen.lock().unwrap()[0].clone();
        assert!(req.starts_with("POST /oauth2/token/ HTTP/1.1") && !req.contains("client_secret"));
        let b = body(&req);
        assert_eq!((b["grant_type"].as_str(), b["refresh_token"].as_str(), b["client_id"].as_str(), b.len()), ("refresh_token", "r1", CLIENT_ID, 3));
        let t = load(&d).unwrap();
        assert_eq!((t.access.as_str(), t.refresh.as_str()), ("a2", "r2"));
        assert!(t.expires_at >= now() + 2592000 - 60);
    }

    #[tokio::test]
    async fn invalid_grant_logs_out() {
        let (base, _) = endpoint(vec![("400 Bad Request", r#"{"error":"invalid_grant"}"#)]);
        let d = dir("invalid");
        let cache = stored(&d, 3600);
        assert_eq!(token(&http(), &base, &d, &cache).await.unwrap_err().code, "ogs_login_required");
        assert!(!d.join(FILE).exists() && cache.lock().await.is_none());
        assert_eq!(token(&http(), &base, &d, &cache).await.unwrap_err().code, "ogs_login_required");
    }

    #[tokio::test]
    async fn network_failure_keeps_tokens() {
        let closed = { let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap(); format!("http://{}", l.local_addr().unwrap()) };
        let (down, _) = endpoint(vec![("503 Service Unavailable", "")]);
        for base in [closed, down] {
            let d = dir("offline");
            let cache = stored(&d, -10);
            assert_eq!(token(&http(), &base, &d, &cache).await.unwrap_err().code, "ogs_network", "{base}");
            assert_eq!(load(&d).unwrap().refresh, "r1");
            let cache = stored(&d, 3600);
            assert_eq!(token(&http(), &base, &d, &cache).await.unwrap(), "a1", "not expired yet: the old token");
            assert_eq!(load(&d).unwrap().refresh, "r1");
        }
    }

    #[tokio::test]
    async fn concurrent_calls_refresh_once() {
        let (base, seen) = endpoint(vec![("200 OK", GRANT), ("400 Bad Request", r#"{"error":"invalid_grant"}"#)]);
        let d = dir("concurrent");
        let cache = stored(&d, 3600);
        let c = http();
        let (a, b) = tokio::join!(token(&c, &base, &d, &cache), token(&c, &base, &d, &cache));
        assert_eq!((a.unwrap().as_str(), b.unwrap().as_str()), ("a2", "a2"));
        assert_eq!(seen.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn logout_revokes_and_forgets() {
        let (base, seen) = endpoint(vec![("200 OK", "")]);
        let d = dir("logout");
        let cache = stored(&d, 3600);
        logout(&http(), &base, &d, &cache).await;
        assert!(!d.join(FILE).exists());
        let req = seen.lock().unwrap()[0].clone();
        assert!(req.starts_with("POST /oauth2/revoke_token/ HTTP/1.1"));
        assert_eq!(body(&req), HashMap::from([("token".into(), "r1".into()), ("client_id".into(), CLIENT_ID.into())]));
        assert_eq!(token(&http(), &base, &d, &cache).await.unwrap_err().code, "ogs_login_required");
    }

    /// Real sign-in in the default browser, by hand: OGS_DIR=<dir> cargo test live_login -- --ignored --nocapture
    #[tokio::test]
    #[ignore]
    async fn live_login() {
        let d = PathBuf::from(std::env::var("OGS_DIR").expect("OGS_DIR"));
        let (c, cache) = (crate::networks::client(), Mutex::new(None));
        login(&c, BASE, &d, &cache, crate::open_url).await.unwrap();
        let a = token(&c, BASE, &d, &cache).await.unwrap();
        let v: serde_json::Value = c.get(format!("{BASE}/api/v1/ui/config")).bearer_auth(a).send().await.unwrap().json().await.unwrap();
        println!("user: {} · jwt: {}", v["user"]["username"], v["user_jwt"].as_str().is_some_and(|j| !j.is_empty()));
    }
}
