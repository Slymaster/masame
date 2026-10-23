// Network manager: live catalog from katagotraining.org, pinned presets, resumable sha256-verified downloads.
// Everything coming from the API is untrusted: names, URLs, sizes and hashes are validated before use.

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tokio::io::AsyncWriteExt;

use crate::failure::{Failure, Res};

pub const USER_AGENT: &str = "Masame/0.6"; // Cloudflare rejects some default user agents
const API: &str = "https://katagotraining.org/api/networks/";
const MEDIA_HOST: &str = "media.katagotraining.org";
const PAGES: u32 = 3;
const RATED_GAMES: u64 = 500;
const MAX_BYTES: u64 = 2_000_000_000;
const MAX_JSON: usize = 4_000_000; // an API page is ~30 kB
const JSON_TIMEOUT: Duration = Duration::from_secs(30); // whole request, body included

pub const HUMAN: &str = "b18c384nbt-humanv0";
const BALANCED: &str = "kata1-tf3-b10c512-s3203M-d5937M";
const LIGHT: &str = "kata1-tf2-b10c384-s2941M-d5872M";
/// CNNs measured as the best on phones (docs/katago-benchmark.md §7, §8): the b18 on the iPhone's Neural Engine, the b10
/// on Android's CPU.
const FAST: &str = "kata1-b18c384nbt-s9996604416-d4316597426";
const COMPACT: &str = "kata1-b10c128-s1141046784-d204142634";
/// Single place to change the default analysis net.
pub const DEFAULT_NETWORK: &str = if cfg!(target_os = "ios") { FAST } else if cfg!(target_os = "android") { COMPACT } else { BALANCED };
const MAXIMUM: &str = "kata1-tf3-b11c768-s11003M-d5973M-7gres";
/// Catalog entries each platform lists, in this order. iPhone: light stays as the fallback while the CNN is not there.
const IPHONE: &[&str] = &["human", "fast", "light"];
const ANDROID: &[&str] = &["human", "compact"];
const SHOWN: &[&str] = if cfg!(target_os = "ios") { IPHONE } else if cfg!(target_os = "android") { ANDROID }
    else { &["human", "balanced", "maximum", "light", "strongest", "newest"] };

/// Whether this platform lists a net, so it may be the active one: phones only their pinned presets; desktop any name,
/// as it also lists live nets.
pub fn listed(name: &str) -> bool { listed_in(name, SHOWN) }
fn listed_in(name: &str, shown: &[&str]) -> bool { shown.contains(&"newest") || preset(name).is_some_and(|p| shown.contains(&p.key)) }

struct Preset { key: &'static str, name: &'static str, bytes: u64, sha256: &'static str, created: &'static str, extra: bool }

// Pinned 2026-10-11 from the official rating list; the live API only adds ratings. humanv0 is not in the API:
// its sha256 was computed from our own download (which also matched the bucket's MD5 ETag).
const PRESETS: [Preset; 6] = [
    Preset { key: "human", name: HUMAN, bytes: 99_066_230,
        sha256: "637746e44f0efe00ad1245a50aa9bbf0716efe364c43965ead97bd6835d84ab5", created: "2024-07-01T00:00:00Z" /* KataGo 1.15 release month */, extra: true },
    Preset { key: "balanced", name: BALANCED, bytes: 94_281_753,
        sha256: "c04db4a503721d948bb720324f3cbdac6088cc9eb243632f020e4b6846f58995", created: "2026-08-25T05:48:41Z", extra: false },
    Preset { key: "maximum", name: MAXIMUM, bytes: 262_039_869,
        sha256: "93bdb63a3bfae4a70db0cb5265287495ecfc10b1ba1cc6814feeba1cdf055871", created: "2026-09-25T02:04:37Z", extra: false },
    Preset { key: "light", name: LIGHT, bytes: 38_245_507,
        sha256: "8015d49bdf45854c94e5f9e22b2b70e8738d3e56a6edca730e5b82509998a5b5", created: "2026-08-25T05:47:56Z", extra: false },
    // Pinned 2026-10-15, from downloads that matched the official catalog.
    Preset { key: "fast", name: FAST, bytes: 97_898_094,
        sha256: "9d7a6afed8ff5b74894727e156f04f0cd36060a24824892008fbb6e0cba51f1d", created: "2024-05-26T12:47:48Z", extra: false },
    Preset { key: "compact", name: COMPACT, bytes: 14_466_254,
        sha256: "3d8a24697ba25fe4da39af4c2b6bd405907b0ad8295322f5a550fa2d8fe4a2f4", created: "2020-11-28T20:39:39Z", extra: false },
];

/// File extension of a net: KataGo picks the parser from it, and the one pinned net published as text keeps `.txt.gz`.
fn ext(name: &str) -> &'static str { if name == COMPACT { ".txt.gz" } else { ".bin.gz" } }

/// One network record from the API, kept only if it passes `validate`.
#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct ApiNet {
    pub name: String,
    pub created_at: String,
    pub model_file: String,
    pub model_file_bytes: u64,
    pub model_file_sha256: String,
    pub log_gamma: Option<f64>,
    pub log_gamma_game_count: Option<u64>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub key: String, // "human" | "balanced" | "maximum" | "light" | "fast" | "compact" | "strongest" | "newest"; the UI names it
    pub section: &'static str, // "recommended" | "current"
    pub name: String,
    pub url: String,
    pub bytes: u64,
    pub sha256: String,
    pub created_at: String,
    pub elo: Option<f64>,
    pub games: Option<u64>,
    pub evaluating: bool,
}

/// The pinned preset a name refers to, ignoring case: on macOS/Windows a case variant is the same file on disk.
fn preset(name: &str) -> Option<&'static Preset> { PRESETS.iter().find(|p| p.name.eq_ignore_ascii_case(name)) }

/// Preset key ("balanced", …) of a pinned net, so the UI can name the active one.
pub fn preset_key(name: &str) -> Option<&'static str> { preset(name).map(|p| p.key) }

/// Also rejects case variants of a preset name, so no API record, download, delete or setting can reach a pinned
/// file under another spelling.
pub fn valid_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 128 && !name.starts_with('.')
        && name.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
        && preset(name).is_none_or(|p| p.name == name)
}

/// The only download URLs we accept: https://media.katagotraining.org/…/<name>.bin.gz (.txt.gz for the one pinned text net)
pub fn valid_url(url: &str, name: &str) -> bool {
    match reqwest::Url::parse(url) {
        Ok(u) => u.scheme() == "https" && u.host_str() == Some(MEDIA_HOST) && u.port().is_none() && u.username().is_empty() && u.password().is_none()
            && u.query().is_none() && u.path().ends_with(&format!("/{name}{}", ext(name)))
            && !u.path().contains(".."),
        Err(_) => false,
    }
}

fn valid_sha(s: &str) -> bool { s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()) }

pub fn validate(n: &ApiNet) -> bool {
    valid_name(&n.name) && valid_url(&n.model_file, &n.name) && valid_sha(&n.model_file_sha256)
        && n.model_file_bytes > 0 && n.model_file_bytes <= MAX_BYTES
        && n.log_gamma.is_none_or(f64::is_finite)
}

/// Bradley–Terry log-gamma → Elo, as on katagotraining.org.
pub fn elo(log_gamma: f64) -> f64 { log_gamma * 400.0 / std::f64::consts::LN_10 }

/// Keeps the well-formed records of an API page (`{"results":[…]}`) or of a single-network response.
pub fn parse_nets(v: &Value) -> Vec<ApiNet> {
    let items = match v.get("results") { Some(Value::Array(a)) => a.clone(), _ => vec![v.clone()] };
    items.into_iter().filter_map(|i| serde_json::from_value::<ApiNet>(i).ok()).filter(validate).collect()
}

fn human_url() -> String { format!("https://{MEDIA_HOST}/uploaded/networks/models_extra/{HUMAN}.bin.gz") }
fn kata1_url(name: &str) -> String { format!("https://{MEDIA_HOST}/uploaded/networks/models/kata1/{name}{}", ext(name)) }
fn preset_url(p: &Preset) -> String { if p.extra { human_url() } else { kata1_url(p.name) } }

fn from_api(key: &str, n: &ApiNet) -> Entry {
    let games = n.log_gamma_game_count.unwrap_or(0);
    Entry {
        key: key.into(), section: "current", name: n.name.clone(), url: n.model_file.clone(),
        bytes: n.model_file_bytes, sha256: n.model_file_sha256.to_lowercase(), created_at: n.created_at.clone(),
        elo: n.log_gamma.map(elo), games: Some(games), evaluating: games < RATED_GAMES,
    }
}

/// Presets (pinned files, live ratings when known) + "strongest right now" and "newest" from the recent pages, as this
/// platform lists them.
pub fn catalog(nets: &[ApiNet]) -> Vec<Entry> { catalog_for(nets, SHOWN) }

fn catalog_for(nets: &[ApiNet], shown: &[&str]) -> Vec<Entry> {
    let mut out: Vec<Entry> = PRESETS.iter().map(|p| {
        let live = nets.iter().find(|n| n.name == p.name);
        Entry {
            key: p.key.into(), section: "recommended", name: p.name.into(),
            url: preset_url(p), bytes: p.bytes, sha256: p.sha256.into(),
            created_at: live.map_or(p.created, |n| &n.created_at).into(),
            elo: live.and_then(|n| n.log_gamma).map(elo), games: live.and_then(|n| n.log_gamma_game_count),
            evaluating: false,
        }
    }).collect();
    let kata1 = || nets.iter().filter(|n| n.name.starts_with("kata1-"));
    let strongest = kata1()
        .filter(|n| n.log_gamma_game_count.unwrap_or(0) >= RATED_GAMES && n.log_gamma.is_some())
        .max_by(|a, b| a.log_gamma.partial_cmp(&b.log_gamma).unwrap());
    let newest = kata1().max_by(|a, b| a.created_at.cmp(&b.created_at)); // ISO 8601 UTC sorts lexically
    if let Some(s) = strongest.filter(|s| preset(&s.name).is_none()) { out.push(from_api("strongest", s)) }
    if let Some(n) = newest.filter(|n| preset(&n.name).is_none() && strongest.is_none_or(|s| s.name != n.name)) {
        out.push(from_api("newest", n))
    }
    out.retain(|e| shown.contains(&e.key.as_str()));
    out.sort_by_key(|e| shown.iter().position(|k| *k == e.key));
    out
}

/// Everything but `https_only`, so tests can talk to a local plain-HTTP server with the same policies.
pub(crate) fn builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        // Every endpoint answers 200/206 directly; following a redirect would escape the host allowlist.
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(30))
}

pub fn client() -> reqwest::Client { builder().https_only(true).build().expect("HTTP client") }

async fn get_json(c: &reqwest::Client, url: &str) -> Res<Value> {
    let off = |e: &dyn ToString| Failure::with("catalog_offline", e.to_string());
    let r = c.get(url).timeout(JSON_TIMEOUT).send().await.map_err(|e| off(&e))?;
    if !r.status().is_success() { return Err(off(&r.status())) }
    let body = capped(r, MAX_JSON).await.map_err(|e| off(&e))?.ok_or_else(|| off(&"response too large"))?;
    serde_json::from_slice(&body).map_err(|e| off(&e))
}

/// The whole body, or `None` once it would exceed `max` bytes.
pub(crate) async fn capped(mut r: reqwest::Response, max: usize) -> reqwest::Result<Option<Vec<u8>>> {
    if r.content_length().is_some_and(|n| n > max as u64) { return Ok(None) }
    let mut body = Vec::new();
    while let Some(chunk) = r.chunk().await? {
        if body.len() + chunk.len() > max { return Ok(None) }
        body.extend_from_slice(&chunk);
    }
    Ok(Some(body))
}

/// Recent pages (newest first) + details of the pinned kata1 presets, which may be older than those pages.
pub async fn fetch_nets(c: &reqwest::Client) -> Res<Vec<ApiNet>> {
    let mut nets = Vec::new();
    for page in 1..=PAGES {
        nets.extend(parse_nets(&get_json(c, &format!("{API}?format=json&page={page}")).await?));
    }
    let missing: Vec<_> = PRESETS.iter().filter(|p| !p.extra && SHOWN.contains(&p.key) && !nets.iter().any(|n| n.name == p.name)).collect();
    for p in missing {
        if let Ok(v) = get_json(c, &format!("{API}{}/?format=json", p.name)).await { nets.extend(parse_nets(&v)) }
    }
    Ok(nets)
}

pub fn file(dir: &Path, name: &str) -> PathBuf { dir.join(format!("{name}{}", ext(name))) }
fn part(dir: &Path, name: &str) -> PathBuf { dir.join(format!("{name}{}.part", ext(name))) }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Installed { pub name: String, pub bytes: u64, pub complete: bool }

/// Installed nets and partial downloads (`complete: false`) in the models directory.
pub fn installed(dir: &Path) -> Vec<Installed> {
    let Ok(rd) = std::fs::read_dir(dir) else { return vec![] };
    let mut out: Vec<Installed> = rd.flatten().filter_map(|e| {
        let f = e.file_name().into_string().ok()?;
        let (f, complete) = match f.strip_suffix(".part") { Some(n) => (n, false), None => (f.as_str(), true) };
        let name = f.strip_suffix(".bin.gz").or_else(|| f.strip_suffix(".txt.gz"))?;
        (valid_name(name) && f.ends_with(ext(name))).then(|| Installed { name: name.into(), bytes: e.metadata().map_or(0, |m| m.len()), complete })
    }).collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

pub fn remove(dir: &Path, name: &str) -> Res<()> {
    if !valid_name(name) { return Err(Failure::new("invalid_name")) }
    for p in [file(dir, name), part(dir, name)] {
        match std::fs::remove_file(&p) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(Failure::with("delete_failed", e)),
            _ => {}
        }
    }
    Ok(())
}

/// Streams `e` into `<name>.bin.gz.part` (or `.txt.gz.part`), resuming with an HTTP Range request when a partial file exists.
/// Returns Ok(false) when cancelled (the partial file is kept for a later resume).
pub async fn download(c: &reqwest::Client, e: &Entry, dir: &Path, cancel: &AtomicBool, mut progress: impl FnMut(u64, u64)) -> Res<bool> {
    let unpinned = preset(&e.name).is_some_and(|p| (p.bytes, p.sha256, preset_url(p)) != (e.bytes, e.sha256.as_str(), e.url.clone()));
    if !valid_name(&e.name) || !valid_url(&e.url, &e.name) || !valid_sha(&e.sha256) || unpinned { return Err(Failure::new("url_rejected")) }
    let net_err = |err: reqwest::Error| Failure::with("download_interrupted", err);
    let write_err = |err: std::io::Error| Failure::with("write_failed", err);
    std::fs::create_dir_all(dir).map_err(|err| Failure::with("models_dir", err))?;
    let path = part(dir, &e.name);
    let mut have = std::fs::metadata(&path).map_or(0, |m| m.len());
    if have > e.bytes { have = 0 }
    if have < e.bytes {
        let mut req = c.get(&e.url);
        if have > 0 { req = req.header(reqwest::header::RANGE, format!("bytes={have}-")) }
        let r = req.send().await.map_err(net_err)?;
        let resumed = r.status() == reqwest::StatusCode::PARTIAL_CONTENT;
        if !resumed && !r.status().is_success() { return Err(Failure::with("http_status", r.status())) }
        if !resumed { have = 0 }
        let mut f = tokio::fs::OpenOptions::new().create(true).write(true).append(resumed).truncate(!resumed).open(&path).await
            .map_err(write_err)?;
        progress(have, e.bytes);
        let mut stream = r.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(net_err)?;
            have += chunk.len() as u64;
            if have > e.bytes { drop(f); let _ = std::fs::remove_file(&path); return Err(Failure::new("too_large")) }
            f.write_all(&chunk).await.map_err(write_err)?;
            progress(have, e.bytes);
            if cancel.load(Ordering::Relaxed) { f.flush().await.ok(); return Ok(false) }
        }
        f.flush().await.map_err(write_err)?;
    }
    Ok(true)
}

pub fn sha256_file(path: &Path) -> std::io::Result<String> {
    let mut h = Sha256::new();
    std::io::copy(&mut std::fs::File::open(path)?, &mut h)?;
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// Checks size and sha256 of the finished partial file, then atomically renames it into place.
/// On mismatch the partial file is deleted, so the next attempt starts over.
pub fn finish(dir: &Path, name: &str, bytes: u64, sha256: &str) -> Res<()> {
    let p = part(dir, name);
    let len = std::fs::metadata(&p).map_err(|err| Failure::with("file_missing", err))?.len();
    let ok = len == bytes && sha256_file(&p).map_err(|err| Failure::with("file_missing", err))?.eq_ignore_ascii_case(sha256);
    if !ok {
        let _ = std::fs::remove_file(&p);
        return Err(Failure::new(if len != bytes { "size_mismatch" } else { "hash_mismatch" }));
    }
    std::fs::rename(&p, file(dir, name)).map_err(|err| Failure::with("install_failed", err))
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = r#"{"count":4,"next":"https://evil.example/?page=2","results":[
      {"name":"kata1-tf3-b11c768-s12501M-d6467M","created_at":"2026-10-11T07:24:51Z","model_file":"https://media.katagotraining.org/uploaded/networks/models/kata1/kata1-tf3-b11c768-s12501M-d6467M.bin.gz","model_file_bytes":262025786,"model_file_sha256":"e851f11f33558712075589cfd1efbacdb566a73de6d6efd95c944776ccb5f80a","log_gamma":83.84,"log_gamma_game_count":0},
      {"name":"kata1-tf3-b11c768-s12252M-d6398M","created_at":"2026-10-02T00:00:00Z","model_file":"https://media.katagotraining.org/uploaded/networks/models/kata1/kata1-tf3-b11c768-s12252M-d6398M.bin.gz","model_file_bytes":262014270,"model_file_sha256":"aa51f11f33558712075589cfd1efbacdb566a73de6d6efd95c944776ccb5f80a","log_gamma":84.2,"log_gamma_game_count":4254},
      {"name":"kata1-tf3-b11c768-s11003M-d5973M-7gres","created_at":"2026-09-25T02:04:37Z","model_file":"https://media.katagotraining.org/uploaded/networks/models/kata1/kata1-tf3-b11c768-s11003M-d5973M-7gres.bin.gz","model_file_bytes":262039869,"model_file_sha256":"93bdb63a3bfae4a70db0cb5265287495ecfc10b1ba1cc6814feeba1cdf055871","log_gamma":84.03842812797583,"log_gamma_game_count":4533},
      {"name":"kata1-evil","created_at":"2026-10-12T00:00:00Z","model_file":"https://evil.example/kata1-evil.bin.gz","model_file_bytes":10,"model_file_sha256":"e851f11f33558712075589cfd1efbacdb566a73de6d6efd95c944776ccb5f80a","log_gamma":99,"log_gamma_game_count":9999},
      {"name":"random","created_at":"2020-01-01T00:00:00Z","model_file":"","model_file_bytes":0,"model_file_sha256":"","log_gamma":null,"log_gamma_game_count":null},
      {"oops":true}
    ]}"#;

    #[test]
    fn names() {
        assert!(valid_name("kata1-tf3-b11c768-s11003M-d5973M-7gres"));
        assert!(valid_name(HUMAN));
        for bad in ["", "../x", "a/b", "a\\b", ".hidden", "a b", "é", "x%2F"] { assert!(!valid_name(bad), "{bad}") }
    }

    #[test]
    fn urls() {
        let n = "kata1-x";
        assert!(valid_url("https://media.katagotraining.org/uploaded/networks/models/kata1/kata1-x.bin.gz", n));
        for bad in [
            "http://media.katagotraining.org/uploaded/kata1-x.bin.gz",
            "https://evil.example/kata1-x.bin.gz",
            "https://media.katagotraining.org.evil.example/kata1-x.bin.gz",
            "https://media.katagotraining.org:8443/kata1-x.bin.gz",
            "https://media.katagotraining.org/uploaded/other.bin.gz",
            "https://media.katagotraining.org/uploaded/kata1-x.bin.gz?x=1",
            "https://user@media.katagotraining.org/a/../kata1-x.bin.gz",
            "not a url",
        ] { assert!(!valid_url(bad, n), "{bad}") }
    }

    #[test]
    fn elo_conversion() {
        assert!((elo(81.53364002664127) - 14163.9).abs() < 0.5);
        assert!((elo(84.03842812797583) - 14598.9).abs() < 0.5);
    }

    #[test]
    fn parses_and_builds_catalog() {
        let nets = parse_nets(&serde_json::from_str(FIXTURE).unwrap());
        assert_eq!(nets.len(), 3, "evil host, random net and malformed entry dropped");
        let c = catalog(&nets);
        let keys: Vec<_> = c.iter().map(|e| e.key.as_str()).collect();
        assert_eq!(keys, ["human", "balanced", "maximum", "light", "strongest", "newest"]);
        let max = &c[2];
        assert_eq!(max.games, Some(4533));
        assert!((max.elo.unwrap() - 14598.9).abs() < 0.5);
        assert_eq!(c[1].elo, None, "no live record → no rating, pinned data kept");
        assert_eq!(c[4].name, "kata1-tf3-b11c768-s12252M-d6398M");
        assert!(!c[4].evaluating);
        assert_eq!(c[5].name, "kata1-tf3-b11c768-s12501M-d6467M");
        assert!(c[5].evaluating);
        assert!(c.iter().all(|e| valid_url(&e.url, &e.name) && valid_sha(&e.sha256)));
    }

    #[test]
    fn strongest_hidden_when_it_is_maximum() {
        let mut nets = parse_nets(&serde_json::from_str(FIXTURE).unwrap());
        nets.retain(|n| n.name != "kata1-tf3-b11c768-s12252M-d6398M");
        let keys: Vec<_> = catalog(&nets).into_iter().map(|e| e.key).collect();
        assert_eq!(keys, ["human", "balanced", "maximum", "light", "newest"]);
    }

    #[test]
    fn phones_list_only_their_nets() {
        let nets = parse_nets(&serde_json::from_str(FIXTURE).unwrap());
        let keys = |shown| catalog_for(&nets, shown).into_iter().map(|e| (e.key, e.name)).collect::<Vec<_>>();
        let k = |key: &str, name: &str| (key.to_string(), name.to_string());
        assert_eq!(keys(IPHONE), [k("human", HUMAN), k("fast", FAST), k("light", LIGHT)]);
        assert_eq!(keys(ANDROID), [k("human", HUMAN), k("compact", COMPACT)]);
        assert!(catalog(&[]).iter().all(|e| e.name != FAST && e.name != COMPACT), "desktop unchanged");
    }

    #[test]
    fn phones_only_activate_listed_nets() {
        // A Balanced net left on an iPhone is passed over, so the default (then Light) takes over.
        assert!(!listed_in(BALANCED, IPHONE) && listed_in(FAST, IPHONE) && listed_in(LIGHT, IPHONE));
        assert!(listed_in(COMPACT, ANDROID) && !listed_in(LIGHT, ANDROID) && !listed_in("kata1-x", ANDROID));
        assert!(listed(BALANCED) && listed("kata1-x"), "desktop unchanged");
    }

    #[test]
    fn only_the_pinned_text_net_is_txt_gz() {
        let dir = std::env::temp_dir().join(format!("baduk-txt-{}", std::process::id()));
        assert_eq!(file(&dir, COMPACT), dir.join(format!("{COMPACT}.txt.gz")));
        assert_eq!(part(&dir, COMPACT), dir.join(format!("{COMPACT}.txt.gz.part")));
        assert_eq!(file(&dir, FAST), dir.join(format!("{FAST}.bin.gz")));
        let url = |n: &str, e: &str| format!("https://media.katagotraining.org/uploaded/networks/models/kata1/{n}{e}");
        assert!(valid_url(&url(COMPACT, ".txt.gz"), COMPACT) && !valid_url(&url(COMPACT, ".bin.gz"), COMPACT));
        assert!(!valid_url(&url("kata1-x", ".txt.gz"), "kata1-x"));
        let compact = catalog_for(&[], ANDROID).pop().unwrap();
        assert_eq!(compact.url, url(COMPACT, ".txt.gz"));
        std::fs::create_dir_all(&dir).unwrap();
        for f in [format!("{COMPACT}.txt.gz"), format!("{FAST}.bin.gz.part"), "kata1-x.txt.gz".into(), format!("{COMPACT}.bin.gz")] {
            std::fs::write(dir.join(f), "x").unwrap();
        }
        let inst: Vec<_> = installed(&dir).into_iter().map(|i| (i.name, i.complete)).collect();
        assert_eq!(inst, [(COMPACT.to_string(), true), (FAST.to_string(), false)], "a .txt.gz under another name, or the text net as .bin.gz, is ignored");
        remove(&dir, COMPACT).unwrap();
        assert!(!file(&dir, COMPACT).exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn verifies_sha256_then_installs() {
        let dir = std::env::temp_dir().join(format!("baduk-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let abc = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
        std::fs::write(part(&dir, "n"), "abc").unwrap();
        assert_eq!(finish(&dir, "n", 3, &"0".repeat(64)).unwrap_err().code, "hash_mismatch");
        assert!(!part(&dir, "n").exists(), "corrupt file deleted");
        std::fs::write(part(&dir, "n"), "abc").unwrap();
        assert_eq!(finish(&dir, "n", 4, abc).unwrap_err().code, "size_mismatch");
        std::fs::write(part(&dir, "n"), "abc").unwrap();
        finish(&dir, "n", 3, abc).unwrap();
        assert!(file(&dir, "n").exists() && !part(&dir, "n").exists());
        let inst = installed(&dir);
        assert_eq!((inst.len(), inst[0].complete, inst[0].bytes), (1, true, 3));
        remove(&dir, "n").unwrap();
        assert!(installed(&dir).is_empty());
        assert!(remove(&dir, "../n").is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn case_variants_of_presets_stay_pinned() {
        let upper = DEFAULT_NETWORK.to_uppercase();
        for n in [upper.as_str(), "B18C384NBT-HUMANV0", "Kata1-tf3-b11c768-s11003M-d5973M-7gres"] {
            assert!(!valid_name(n), "{n}");
            assert_eq!(remove(Path::new("/nonexistent"), n).unwrap_err().code, "invalid_name");
        }
        // A rated, newer API record spelled like a preset is never offered with its own (unpinned) hash.
        let evil = ApiNet {
            name: upper.clone(), created_at: "2030-01-01T00:00:00Z".into(), model_file: kata1_url(&upper),
            model_file_bytes: 10, model_file_sha256: "0".repeat(64), log_gamma: Some(999.0), log_gamma_game_count: Some(9999),
        };
        assert!(!validate(&evil));
        let c = catalog(std::slice::from_ref(&evil));
        assert!(c.iter().all(|e| e.section == "recommended"), "only the pinned presets");
        let pinned = c.iter().find(|e| e.name.eq_ignore_ascii_case(&upper)).unwrap();
        assert_eq!((pinned.name.as_str(), pinned.sha256.as_str()), (DEFAULT_NETWORK, PRESETS[1].sha256));
        // download() refuses any entry for a preset name whose hash, size or URL differs from the pin.
        let mut e = pinned.clone();
        e.sha256 = "0".repeat(64);
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let r = rt.block_on(download(&client(), &e, Path::new("/nonexistent"), &AtomicBool::new(false), |_, _| {}));
        assert_eq!(r.unwrap_err().code, "url_rejected");
    }

    /// Local plain-HTTP server answering every connection with `response`; returns its base URL.
    fn serve(response: Vec<u8>) -> String {
        use std::io::{Read, Write};
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/", l.local_addr().unwrap());
        std::thread::spawn(move || for mut s in l.incoming().flatten() {
            let _ = s.read(&mut [0; 4096]);
            let _ = s.write_all(&response); // the client may hang up early on an oversized body
        });
        url
    }

    fn reply(head: &str, body: &[u8]) -> Vec<u8> { [format!("HTTP/1.1 {head}\r\nConnection: close\r\n\r\n").as_bytes(), body].concat() }

    #[tokio::test]
    async fn redirects_are_not_followed() {
        let c = builder().build().unwrap(); // same policies as client(), minus https_only
        let target = serve(reply("200 OK\r\nContent-Length: 2", b"{}"));
        assert_eq!(get_json(&c, &target).await.unwrap(), serde_json::json!({}));
        let hop = serve(reply(&format!("302 Found\r\nLocation: {target}\r\nContent-Length: 0"), b""));
        let err = get_json(&c, &hop).await.unwrap_err();
        assert_eq!(err.code, "catalog_offline");
        assert!(err.detail.unwrap().contains("302"));
    }

    #[tokio::test]
    async fn catalog_responses_are_size_capped() {
        let c = builder().build().unwrap();
        let big = [b"\"".as_slice(), &vec![b'a'; MAX_JSON], b"\""].concat(); // valid JSON, over the cap
        let declared = serve(reply(&format!("200 OK\r\nContent-Length: {}", big.len()), &big));
        let streamed = serve(reply("200 OK", &big)); // no Content-Length: body runs until close
        for url in [declared, streamed] {
            assert_eq!(get_json(&c, &url).await.unwrap_err().detail.as_deref(), Some("response too large"), "{url}");
        }
    }

    fn models_dir() -> PathBuf {
        std::env::var_os("BADUK_MODELS_DIR").map(PathBuf::from).unwrap_or_else(|| {
            PathBuf::from(std::env::var_os("HOME").unwrap()).join("Library/Application Support/com.sylvainrey.masame/models")
        })
    }

    /// Real download of the human net, interrupted once to exercise the Range resume, then verified.
    /// cargo test --lib -- --ignored --nocapture download_humanv0
    #[tokio::test]
    #[ignore]
    async fn download_humanv0() {
        let dir = models_dir();
        let e = catalog(&[]).into_iter().find(|e| e.name == HUMAN).unwrap();
        let c = client();
        if !file(&dir, HUMAN).exists() {
            if std::fs::metadata(part(&dir, HUMAN)).map_or(0, |m| m.len()) < e.bytes {
                let cancel = AtomicBool::new(false);
                let start = std::fs::metadata(part(&dir, HUMAN)).map_or(0, |m| m.len());
                let done = download(&c, &e, &dir, &cancel, |got, _| if got > start + 20_000_000 { cancel.store(true, Ordering::Relaxed) }).await.unwrap();
                assert!(!done, "first pass is interrupted");
                let cut = std::fs::metadata(part(&dir, HUMAN)).unwrap().len();
                println!("interrupted at {cut} bytes");
                let mut first = None;
                let done = download(&c, &e, &dir, &AtomicBool::new(false), |got, _| { first.get_or_insert(got); }).await.unwrap();
                assert!(done);
                assert_eq!(first, Some(cut), "second pass resumed from the partial file");
            }
            let sha = sha256_file(&part(&dir, HUMAN)).unwrap();
            println!("sha256 {sha}");
            assert_eq!(sha, e.sha256, "pin this sha256 (partial file kept)");
            finish(&dir, HUMAN, e.bytes, &e.sha256).unwrap();
        }
        assert_eq!(sha256_file(&file(&dir, HUMAN)).unwrap(), e.sha256);
    }

    /// Prints the live catalog (used for UI fixtures). cargo test --lib -- --ignored --nocapture live_catalog
    #[tokio::test]
    #[ignore]
    async fn live_catalog() {
        let nets = fetch_nets(&client()).await.unwrap();
        assert!(nets.len() >= 40);
        println!("{}", serde_json::to_string(&catalog(&nets)).unwrap());
    }
}
