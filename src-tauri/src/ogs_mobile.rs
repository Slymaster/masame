// Mobile OAuth state machine. No webview, keychain or runtime dependency: exercised headlessly as well as in-app.
use crate::failure::{Failure, Res};
use crate::ogs_oauth::{self as oauth, Tokens};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::Mutex;

const LIFETIME: u64 = 300;
const REFRESH_MARGIN: u64 = 86_400;

// Errors must contain fixed codes only, never credential text or callback URLs.
pub trait SecureStore: Send + Sync {
    fn read(&self) -> Res<Option<String>>;
    fn write(&self, value: &str) -> Res<()>;
    fn delete(&self) -> Res<()>;
}

#[derive(Clone, Serialize, Deserialize)]
struct Pending {
    verifier: String,
    state: String,
    redirect: String,
    expires_at: u64,
}

#[derive(Default, Serialize, Deserialize)]
struct Saved { tokens: Option<Tokens>, pending: Option<Pending> }

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "phase", rename_all = "camelCase")]
pub enum AuthState {
    SignedOut,
    Pending { #[serde(rename = "expiresAt")] expires_at: u64 },
    SignedIn,
    Failed { code: &'static str },
}

#[derive(Default)]
pub struct Auth {
    // Serialize reads, writes and refresh rotation, including cold-start callbacks.
    gate: Mutex<()>,
    // Invalidated before waiting for gate: logout/cancel/new-login beat a late HTTP response.
    epoch: AtomicU64,
    failure: std::sync::Mutex<Option<&'static str>>,
}

pub fn redirect(value: &str) -> Res<reqwest::Url> {
    let u = reqwest::Url::parse(value).map_err(|_| Failure::new("ogs_callback_config"))?;
    if u.scheme() != "https" || u.host_str().is_none() || !u.username().is_empty() || u.password().is_some()
        || u.port().is_some() || u.query().is_some() || u.fragment().is_some() || u.path() == "/"
        || u.host_str().is_some_and(|h| h == "localhost" || !h.contains('.') || h.parse::<std::net::IpAddr>().is_ok()) {
        return Err(Failure::new("ogs_callback_config"));
    }
    Ok(u)
}

enum Callback { Code(String), Denied }
fn callback(url: &str, p: &Pending, now: u64) -> Option<Callback> {
    if now >= p.expires_at || url.len() > 8192 { return None }
    let expected = redirect(&p.redirect).ok()?;
    let u = reqwest::Url::parse(url).ok()?;
    if u.scheme() != "https" || u.host_str() != expected.host_str() || u.port() != expected.port()
        || u.path() != expected.path() || u.fragment().is_some() || !u.username().is_empty() || u.password().is_some() { return None }
    let unique = |key| {
        let mut all = u.query_pairs().filter(|(k, _)| k == key).map(|(_, v)| v.into_owned());
        let first = all.next()?;
        if all.next().is_some() { None } else { Some(first) }
    };
    if !oauth::same(&unique("state")?, &p.state) { return None }
    let code = unique("code");
    let error = unique("error");
    // Reject duplicate sensitive parameters, including error alongside a code.
    for k in ["state", "code", "error"] {
        if u.query_pairs().filter(|(name, _)| name == k).count() > 1 { return None }
    }
    match (code, error) {
        (Some(c), None) if !c.is_empty() => Some(Callback::Code(c)),
        (None, Some(_)) => Some(Callback::Denied),
        _ => None,
    }
}

fn load(store: &dyn SecureStore) -> Res<Saved> {
    store.read()?.map(|s| serde_json::from_str(&s).map_err(|_| Failure::new("ogs_storage_corrupt"))).unwrap_or(Ok(Saved::default()))
}
fn save(store: &dyn SecureStore, saved: &Saved) -> Res<()> {
    if saved.tokens.is_none() && saved.pending.is_none() { store.delete() }
    else { store.write(&serde_json::to_string(saved).map_err(|_| Failure::new("ogs_storage"))?) }
}

impl Auth {
    pub fn invalidate(&self) -> u64 { self.epoch.fetch_add(1, Ordering::SeqCst) + 1 }
    fn current(&self, epoch: u64) -> Res<()> {
        if self.epoch.load(Ordering::SeqCst) == epoch { Ok(()) } else { Err(Failure::new("ogs_cancelled")) }
    }
    fn failed(&self, code: &'static str) { *self.failure.lock().unwrap() = Some(code) }

    pub async fn state(&self, store: &dyn SecureStore) -> Res<AuthState> {
        let _guard = self.gate.lock().await;
        let mut s = load(store)?;
        if s.pending.as_ref().is_some_and(|p| oauth::now() >= p.expires_at) {
            s.pending = None; save(store, &s)?; self.failed("ogs_timeout");
        }
        if let Some(code) = *self.failure.lock().unwrap() { return Ok(AuthState::Failed { code }) }
        Ok(if let Some(p) = s.pending { AuthState::Pending { expires_at: p.expires_at } }
            else if s.tokens.is_some() { AuthState::SignedIn } else { AuthState::SignedOut })
    }

    pub async fn begin(&self, store: &dyn SecureStore, redirect_uri: &str, open: impl FnOnce(&str) -> Res<()>) -> Res<()> {
        redirect(redirect_uri)?;
        let epoch = self.invalidate();
        let _guard = self.gate.lock().await;
        self.current(epoch)?;
        let mut s = load(store)?;
        let p = Pending { verifier: oauth::random(32), state: oauth::random(16), redirect: redirect_uri.into(), expires_at: oauth::now() + LIFETIME };
        let url = oauth::authorize_url(oauth::BASE, &p.redirect, &p.state, &oauth::challenge(&p.verifier));
        s.pending = Some(p); save(store, &s)?;
        *self.failure.lock().unwrap() = None;
        if let Err(e) = open(&url) {
            s.pending = None; save(store, &s)?; self.failed(e.code); return Err(e)
        }
        Ok(())
    }

    // Consume and durably erase a valid transaction BEFORE exchanging its one-use code. A second process/callback
    // cannot resurrect it; a failed network exchange requires a fresh sign-in rather than replaying the callback.
    pub async fn finish(&self, store: &dyn SecureStore, c: &reqwest::Client, base: &str, url: &str) -> Res<bool> {
        let epoch = self.epoch.load(Ordering::SeqCst);
        let _guard = self.gate.lock().await;
        self.current(epoch)?;
        let mut s = load(store)?;
        let Some(p) = s.pending.as_ref() else { return Ok(false) };
        let Some(outcome) = callback(url, p, oauth::now()) else { return Ok(false) };
        let p = s.pending.take().unwrap();
        save(store, &s)?;
        let result = match outcome {
            Callback::Denied => Err(Failure::new("ogs_denied")),
            Callback::Code(code) => oauth::grant(c, base, &[("grant_type", "authorization_code"), ("code", &code),
                ("redirect_uri", &p.redirect), ("client_id", oauth::CLIENT_ID), ("code_verifier", &p.verifier)]).await,
        };
        self.current(epoch)?;
        match result {
            Ok(t) => { s.tokens = Some(t); if let Err(e) = save(store, &s) { self.failed(e.code); return Err(e) }; *self.failure.lock().unwrap() = None; Ok(true) }
            Err(e) => { self.failed(if e.code == "ogs_login_required" { "ogs_denied" } else { e.code }); Err(e) }
        }
    }

    pub async fn cancel(&self, store: &dyn SecureStore) -> Res<()> {
        self.invalidate();
        let _guard = self.gate.lock().await;
        let mut s = load(store)?;
        s.pending = None; save(store, &s)?; *self.failure.lock().unwrap() = None; Ok(())
    }

    pub async fn token(&self, store: &dyn SecureStore, c: &reqwest::Client, base: &str) -> Res<String> {
        let epoch = self.epoch.load(Ordering::SeqCst);
        let _guard = self.gate.lock().await;
        self.current(epoch)?;
        let mut s = load(store)?;
        let Some(t) = s.tokens.as_ref() else { return Err(Failure::new("ogs_login_required")) };
        if t.expires_at > oauth::now().saturating_add(REFRESH_MARGIN) { return Ok(t.access.clone()) }
        match oauth::grant(c, base, &[("grant_type", "refresh_token"), ("refresh_token", &t.refresh), ("client_id", oauth::CLIENT_ID)]).await {
            Ok(t) => { self.current(epoch)?; let a = t.access.clone(); s.tokens = Some(t); save(store, &s)?; Ok(a) }
            Err(e) if e.code == "ogs_login_required" => { self.current(epoch)?; s.tokens = None; save(store, &s)?; Err(e) }
            Err(_) if t.expires_at > oauth::now() => { self.current(epoch)?; Ok(t.access.clone()) }
            Err(e) => Err(e),
        }
    }

    pub async fn logout(&self, store: &dyn SecureStore, c: &reqwest::Client, base: &str) -> Res<()> {
        self.invalidate();
        let old = {
            let _guard = self.gate.lock().await;
            let old = load(store).ok().and_then(|s| s.tokens);
            store.delete()?; *self.failure.lock().unwrap() = None; old
        };
        if let Some(t) = old {
            let _ = c.post(format!("{base}/oauth2/revoke_token/")).header(reqwest::header::CONTENT_TYPE, "application/x-www-form-urlencoded")
                .body(oauth::form(&[("token", &t.refresh), ("client_id", oauth::CLIENT_ID)]))
                .timeout(std::time::Duration::from_secs(10)).send().await;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex as StdMutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    const URI: &str = "https://owned.example/oauth/ogs/callback"; // never compiled into a mobile build
    #[derive(Default)]
    struct Memory { value: StdMutex<Option<String>>, down: bool, corrupt: bool }
    impl SecureStore for Memory {
        fn read(&self) -> Res<Option<String>> {
            if self.down { return Err(Failure::new("ogs_storage")) }
            if self.corrupt { return Err(Failure::new("ogs_storage_invalidated")) }
            Ok(self.value.lock().unwrap().clone())
        }
        fn write(&self, v: &str) -> Res<()> {
            if self.down { return Err(Failure::new("ogs_storage")) }
            *self.value.lock().unwrap() = Some(v.into()); Ok(())
        }
        fn delete(&self) -> Res<()> { if self.down { return Err(Failure::new("ogs_storage")) }; *self.value.lock().unwrap() = None; Ok(()) }
    }
    async fn begin(auth: &Auth, store: &Memory) -> (String, String) {
        let mut browser = String::new();
        auth.begin(store, URI, |url| { browser = url.into(); Ok(()) }).await.unwrap();
        let url = reqwest::Url::parse(&browser).unwrap();
        let q: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(q["redirect_uri"], URI);
        assert_eq!(q["code_challenge_method"], "S256");
        assert!(!q.contains_key("client_secret"));
        assert_eq!(oauth::challenge(&load(store).unwrap().pending.unwrap().verifier), q["code_challenge"]);
        (format!("{URI}?code=one-use&state={}", q["state"]), q["state"].clone())
    }
    async fn endpoint(status: &'static str, body: &'static str, delay: u64) -> (String, tokio::task::JoinHandle<String>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            let (mut wire, _) = listener.accept().await.unwrap();
            let mut bytes = Vec::new();
            loop {
                let mut buf = [0; 4096]; let n = wire.read(&mut buf).await.unwrap();
                if n == 0 { break } bytes.extend_from_slice(&buf[..n]);
                if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                    let head = String::from_utf8_lossy(&bytes[..end]);
                    let len: usize = head.lines().find_map(|l| l.to_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse().unwrap())).unwrap_or(0);
                    if bytes.len() >= end + 4 + len { break }
                }
            }
            tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
            let response = format!("HTTP/1.1 {status}\r\nContent-Length: {}\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{body}", body.len());
            let _ = wire.write_all(response.as_bytes()).await;
            String::from_utf8(bytes).unwrap()
        });
        (url, task)
    }
    const GRANT: &str = r#"{"access_token":"access","refresh_token":"refresh","expires_in":2592000}"#;

    #[test]
    fn callback_is_exact_unique_and_bounded() {
        let p = Pending { verifier: "v".into(), state: "secret".into(), redirect: URI.into(), expires_at: 100 };
        for url in [format!("{URI}?code=x"), format!("{URI}?code=x&state=wrong"), format!("{URI}?code=x&state=secret&state=secret"),
            format!("{URI}?code=x&code=y&state=secret"), format!("{URI}?error=x&error=y&state=secret"),
            format!("{URI}?code=x&error=denied&state=secret"), format!("{URI}?code=x&state=secret#fragment"),
            format!("{URI}/other?code=x&state=secret"), "https://evil.example/oauth/ogs/callback?code=x&state=secret".into(),
            "http://owned.example/oauth/ogs/callback?code=x&state=secret".into(), "https://a@owned.example/oauth/ogs/callback?code=x&state=secret".into()] {
            assert!(callback(&url, &p, 1).is_none());
        }
        assert!(matches!(callback(&format!("{URI}?code=x&state=secret"), &p, 99), Some(Callback::Code(_))));
        assert!(callback(&format!("{URI}?code=x&state=secret"), &p, 100).is_none());
    }
    #[tokio::test]
    async fn cold_start_consumes_once_and_saves_only_after_exchange() {
        let store = Memory::default(); let a = Auth::default();
        let (url, _) = begin(&a, &store).await;
        assert!(matches!(a.state(&store).await.unwrap(), AuthState::Pending { .. }));
        let cold = Auth::default();
        let (base, request) = endpoint("200 OK", GRANT, 0).await;
        assert!(cold.finish(&store, &reqwest::Client::new(), &base, &url).await.unwrap());
        assert_eq!(cold.state(&store).await.unwrap(), AuthState::SignedIn);
        assert_eq!(cold.token(&store, &reqwest::Client::new(), &base).await.unwrap(), "access");
        assert!(!cold.finish(&store, &reqwest::Client::new(), &base, &url).await.unwrap());
        let request = request.await.unwrap();
        assert!(request.starts_with("POST /oauth2/token/ HTTP/1.1"));
        assert!(request.contains("code_verifier=") && !request.contains("client_secret"));
        assert!(load(&store).unwrap().pending.is_none());
    }
    #[tokio::test]
    async fn unrelated_or_forged_callbacks_leave_the_transaction_waiting() {
        let store = Memory::default(); let a = Auth::default(); let (_, state) = begin(&a, &store).await;
        assert!(!a.finish(&store, &reqwest::Client::new(), "", &format!("{URI}?error=access_denied&state=forged")).await.unwrap());
        assert!(matches!(a.state(&store).await.unwrap(), AuthState::Pending { .. }));
        assert_eq!(a.finish(&store, &reqwest::Client::new(), "", &format!("{URI}?error=access_denied&state={state}")).await.unwrap_err().code, "ogs_denied");
        assert!(load(&store).unwrap().pending.is_none());
    }
    #[tokio::test]
    async fn cancellation_and_a_new_login_invalidate_previous_callback() {
        let store = Memory::default(); let a = Auth::default(); let (old, _) = begin(&a, &store).await;
        a.cancel(&store).await.unwrap();
        assert!(!a.finish(&store, &reqwest::Client::new(), "", &old).await.unwrap());
        let (old, _) = begin(&a, &store).await; begin(&a, &store).await;
        assert!(!a.finish(&store, &reqwest::Client::new(), "", &old).await.unwrap());
    }
    #[tokio::test]
    async fn expiry_uses_wall_time_after_a_suspension() {
        let store = Memory::default(); let a = Auth::default(); begin(&a, &store).await;
        let mut s = load(&store).unwrap(); s.pending.as_mut().unwrap().expires_at = oauth::now(); save(&store, &s).unwrap();
        assert_eq!(a.state(&store).await.unwrap(), AuthState::Failed { code: "ogs_timeout" });
        assert!(store.read().unwrap().is_none());
    }
    #[tokio::test]
    async fn storage_failure_never_opens_the_browser_or_becomes_signed_out() {
        let store = Memory { down: true, ..Default::default() }; let a = Auth::default();
        assert_eq!(a.begin(&store, URI, |_| panic!("must not open")).await.unwrap_err().code, "ogs_storage");
        assert_eq!(a.state(&store).await.unwrap_err().code, "ogs_storage");
        assert_eq!(a.token(&store, &reqwest::Client::new(), "").await.unwrap_err().code, "ogs_storage");
    }
    #[tokio::test]
    async fn failed_exchange_does_not_leave_a_replayable_pending_transaction() {
        let store = Memory::default(); let a = Auth::default(); let (url, _) = begin(&a, &store).await;
        let (base, request) = endpoint("400 Bad Request", "{}", 0).await;
        assert!(a.finish(&store, &reqwest::Client::new(), &base, &url).await.is_err()); request.await.unwrap();
        assert!(!a.finish(&store, &reqwest::Client::new(), &base, &url).await.unwrap());
    }
    #[tokio::test]
    async fn logout_wins_a_late_login_response() {
        let store = Arc::new(Memory::default()); let a = Arc::new(Auth::default()); let (url, _) = begin(&a, &store).await;
        let (base, request) = endpoint("200 OK", GRANT, 100).await;
        let (a2, s2, b2) = (a.clone(), store.clone(), base.clone());
        let finish = tokio::spawn(async move { a2.finish(&*s2, &reqwest::Client::new(), &b2, &url).await });
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        a.logout(&*store, &reqwest::Client::new(), &base).await.unwrap();
        assert_eq!(finish.await.unwrap().unwrap_err().code, "ogs_cancelled"); request.await.unwrap();
        assert!(store.read().unwrap().is_none());
    }
    #[tokio::test]
    async fn refresh_rotation_is_serialized_and_durably_saved() {
        let store = Memory::default(); let a = Auth::default();
        save(&store, &Saved { tokens: Some(Tokens { access: "old".into(), refresh: "r1".into(), expires_at: oauth::now() + 1 }), pending: None }).unwrap();
        let (base, request) = endpoint("200 OK", GRANT, 20).await; let c = reqwest::Client::new();
        let (one, two) = tokio::join!(a.token(&store, &c, &base), a.token(&store, &c, &base));
        assert_eq!((one.unwrap(), two.unwrap()), ("access".into(), "access".into()));
        assert_eq!(load(&store).unwrap().tokens.unwrap().refresh, "refresh");
        assert!(request.await.unwrap().contains("refresh_token=r1"));
    }
    #[tokio::test]
    async fn invalid_refresh_forgets_credentials_but_a_network_failure_keeps_them() {
        let c = reqwest::Client::new();
        for (status, expected) in [("400 Bad Request", "ogs_login_required"), ("503 Service Unavailable", "old")] {
            let store = Memory::default(); let a = Auth::default();
            save(&store, &Saved { tokens: Some(Tokens { access: "old".into(), refresh: "r1".into(), expires_at: oauth::now() + 100 }), pending: None }).unwrap();
            let (base, request) = endpoint(status, "{}", 0).await;
            let result = a.token(&store, &c, &base).await;
            if expected == "old" { assert_eq!(result.unwrap(), "old"); assert!(load(&store).unwrap().tokens.is_some()); }
            else { assert_eq!(result.unwrap_err().code, expected); assert!(store.read().unwrap().is_none()); }
            request.await.unwrap();
        }
    }
    #[tokio::test]
    async fn logout_deletes_the_vault_and_revokes_without_a_client_secret() {
        let store = Memory::default(); let a = Auth::default();
        save(&store, &Saved { tokens: Some(Tokens { access: "old".into(), refresh: "r1".into(), expires_at: oauth::now() + 100 }), pending: None }).unwrap();
        let (base, request) = endpoint("200 OK", "{}", 0).await;
        a.logout(&store, &reqwest::Client::new(), &base).await.unwrap();
        assert!(store.read().unwrap().is_none());
        let request = request.await.unwrap();
        assert!(request.starts_with("POST /oauth2/revoke_token/ HTTP/1.1"));
        assert!(request.contains("token=r1") && !request.contains("client_secret"));
    }
    #[tokio::test]
    async fn explicit_logout_can_clear_an_invalidated_store() {
        let store = Memory { corrupt: true, ..Default::default() };
        Auth::default().logout(&store, &reqwest::Client::new(), "").await.unwrap();
    }
}
