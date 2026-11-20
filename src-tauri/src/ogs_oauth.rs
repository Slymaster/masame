// OAuth primitives shared by desktop loopback and mobile verified HTTPS callbacks.
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};
use crate::failure::{Failure, Res};
pub const BASE: &str = "https://online-go.com";
pub const CLIENT_ID: &str = "Zcn8DN7Jg5uCKB184btHYhvUllN6cxnU6enuDdOJ";
#[derive(Serialize, Deserialize, Clone)]
pub struct Tokens { pub access: String, pub refresh: String, pub expires_at: u64 }
pub fn now() -> u64 { SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs()) }
pub fn random(bytes: usize) -> String {
    let mut b = vec![0; bytes];
    getrandom::fill(&mut b).expect("OS random generator");
    URL_SAFE_NO_PAD.encode(b)
}

pub fn challenge(verifier: &str) -> String { URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes())) }

pub fn authorize_url(base: &str, redirect: &str, state: &str, challenge: &str) -> String {
    let mut u = reqwest::Url::parse(&format!("{base}/oauth2/authorize/")).expect("base URL");
    u.query_pairs_mut().extend_pairs([
        ("response_type", "code"), ("client_id", CLIENT_ID), ("redirect_uri", redirect), ("scope", "read write"),
        ("state", state), ("code_challenge", challenge), ("code_challenge_method", "S256"),
    ]);
    u.into()
}

pub fn same(a: &str, b: &str) -> bool { a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0, |d, (x, y)| d | (x ^ y)) == 0 }

/// Form body, application/x-www-form-urlencoded (reqwest's `form` feature is not enabled).
pub fn form(pairs: &[(&str, &str)]) -> String {
    let mut u = reqwest::Url::parse("http://x/").unwrap();
    u.query_pairs_mut().extend_pairs(pairs);
    u.query().unwrap_or_default().into()
}

#[derive(Deserialize)]
struct Grant { access_token: String, refresh_token: String, expires_in: u64 }

/// POST to the token endpoint. A 400/401 (invalid_grant, …) is `ogs_login_required`; anything else `ogs_network`.
pub async fn grant(c: &reqwest::Client, base: &str, pairs: &[(&str, &str)]) -> Res<Tokens> {
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


#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pkce_matches_rfc7636_and_the_client_is_public() {
        assert_eq!(challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
        let u = reqwest::Url::parse(&authorize_url(BASE, "https://owned.example/oauth/ogs/callback", "s+t/=", "challenge")).unwrap();
        let query: std::collections::HashMap<_, _> = u.query_pairs().into_owned().collect();
        assert_eq!(query["scope"], "read write");
        assert_eq!(query["state"], "s+t/=");
        assert_eq!(query["client_id"], CLIENT_ID);
        assert_eq!(query["code_challenge_method"], "S256");
        assert!(!query.contains_key("client_secret"));
        assert_eq!(random(32).len(), 43);
    }
}
