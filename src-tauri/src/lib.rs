mod backend;
mod engine;
mod failure;
mod library;
mod menu;
mod networks;
mod ogs;

use engine::{Engine, Spec, Status};
use failure::{Failure, Res};
use networks::Entry;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};
#[cfg(desktop)]
use tauri_plugin_updater::{Update, UpdaterExt};

struct App {
    engine: Arc<Engine>,
    http: reqwest::Client,
    catalog: Mutex<Vec<Entry>>,
    downloads: Mutex<HashMap<String, Arc<AtomicBool>>>,
    #[cfg(desktop)]
    update: Mutex<Option<Update>>, // the newer release update_check found, for update_install
    ogs: ogs::Ogs,
    #[cfg(engine_variants)]
    failed_variants: Mutex<Vec<&'static str>>, // engine builds that failed to start in this session
}

/// Models, settings and caches. Local (not roaming) on Windows: %LOCALAPPDATA%\<identifier>; on macOS the same
/// ~/Library/Application Support/<identifier> as app_data_dir.
fn data_dir(app: &AppHandle) -> Res<PathBuf> { app.path().app_local_data_dir().map_err(|e| Failure::with("models_dir", e)) }
fn models_dir(app: &AppHandle) -> Res<PathBuf> { Ok(data_dir(app)?.join("models")) }
fn settings_path(app: &AppHandle) -> Res<PathBuf> { Ok(data_dir(app)?.join("settings.json")) }

fn read_settings(app: &AppHandle) -> Value { parse_settings(&settings_path(app).ok().and_then(|p| std::fs::read(p).ok()).unwrap_or_default()) }

/// Always an object (anything else, even valid JSON, reads as empty), so `settings[key] = value` never panics: it can
/// run with the engine lock held (the engine fallback).
fn parse_settings(bytes: &[u8]) -> Value { serde_json::from_slice(bytes).ok().filter(Value::is_object).unwrap_or(json!({})) }

fn write_setting(app: &AppHandle, key: &str, value: Value) -> Res<()> {
    let path = settings_path(app)?;
    let mut settings = read_settings(app);
    settings[key] = value;
    std::fs::write(&path, serde_json::to_vec_pretty(&settings).unwrap()).map_err(|e| Failure::with("settings_write", e))
}

/// Active analysis net: the saved choice if installed, else the default, else any installed kata1 net.
fn active_network(app: &AppHandle) -> Option<String> {
    let dir = models_dir(app).ok()?;
    let ok = |n: &str| networks::valid_name(n) && n != networks::HUMAN && networks::file(&dir, n).is_file();
    let saved = read_settings(app)["activeNetwork"].as_str().map(String::from);
    saved.filter(|n| ok(n))
        .or_else(|| ok(networks::DEFAULT_NETWORK).then(|| networks::DEFAULT_NETWORK.into()))
        .or_else(|| networks::installed(&dir).into_iter().find(|i| i.complete && ok(&i.name)).map(|i| i.name))
}

/// Dev-only overrides: in a release build the environment never picks the binary, config or model the app runs.
fn env_path(k: &str) -> Option<PathBuf> { if cfg!(debug_assertions) { std::env::var_os(k).map(PathBuf::from) } else { None } }

/// The one place that decides which KataGo binary runs, and its platform-specific overrides: BADUK_KATAGO (dev), else
/// on Apple Silicon the bundled sidecar, which Tauri places next to the app executable; on Windows, Linux and Intel Macs
/// (below) one of several bundled builds.
#[cfg(all(desktop, not(engine_variants)))]
fn engine_bin(_app: &AppHandle) -> Res<(PathBuf, Vec<OsString>)> {
    env_path("BADUK_KATAGO")
        .or_else(|| Some(std::env::current_exe().ok()?.parent()?.join(format!("katago{}", std::env::consts::EXE_SUFFIX))))
        .map(|b| (b, vec![]))
        .ok_or(Failure::new("engine_missing"))
}

/// iPhone: KataGo is not wired in yet.
#[cfg(target_os = "ios")]
fn engine_bin(_app: &AppHandle) -> Res<(PathBuf, Vec<OsString>)> { Err(Failure::new("engine_unavailable")) }

/// Android: one CPU (Eigen) build, shipped as a native lib so the package installer extracts it, executable, into
/// nativeLibraryDir (the only app location Android lets a process exec from). Smaller search batches and caches for a phone.
/// maxTime caps every query that sets no time of its own (bot move, territory, final count): on a phone CPU their
/// 60–300 visits take minutes, while the bot's move itself comes from the human policy.
#[cfg(target_os = "android")]
fn engine_bin(_app: &AppHandle) -> Res<(PathBuf, Vec<OsString>)> {
    let dir = native_library_dir().map_err(|e| Failure::with("engine_missing", e))?;
    let overrides = ["homeDataDir=katago", "numSearchThreadsPerAnalysisThread=4", "nnMaxBatchSize=4", "nnCacheSizePowerOfTwo=16", "nnMutexPoolSizePowerOfTwo=14", "maxTime=3"];
    Ok((dir.join("libkatago.so"), overrides.map(OsString::from).into()))
}

/// Context.getApplicationInfo().nativeLibraryDir, through the JVM context tao registered.
#[cfg(target_os = "android")]
fn native_library_dir() -> Result<PathBuf, jni::errors::Error> {
    use jni::{jni_sig, jni_str, objects::{JObject, JString}};
    let ctx = ndk_context::android_context();
    let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) };
    vm.attach_current_thread(|env| {
        let context = unsafe { JObject::from_raw(env, ctx.context().cast()) };
        let info = env.call_method(&context, jni_str!("getApplicationInfo"), jni_sig!("()Landroid/content/pm/ApplicationInfo;"), &[])?.l()?;
        let dir = env.get_field(&info, jni_str!("nativeLibraryDir"), jni_sig!("Ljava/lang/String;"))?.l()?;
        Ok(PathBuf::from(env.cast_local::<JString>(dir)?.try_to_string(env)?))
    })
}

/// Windows: resources/katago-win/<variant>/katago.exe (next to its DLLs); Linux:
/// resources/katago-linux/<variant>/katago; Intel Macs: the sidecar katago-<variant> next to the app executable (sidecars,
/// not resources, so the app's signing covers them). The variant is chosen by backend.rs.
#[cfg(engine_variants)]
fn engine_bin(app: &AppHandle) -> Res<(PathBuf, Vec<OsString>)> {
    // OpenCL's tuning cache would default to the binary's folder, which is read-only once installed. Relative to
    // KataGo's working directory, the data dir (on Windows an absolute path could hold characters its narrow argv
    // cannot).
    let home = vec![OsString::from("homeDataDir=katago")];
    if let Some(b) = env_path("BADUK_KATAGO") { return Ok((b, home)) }
    let failed = app.state::<App>().failed_variants.lock().unwrap().clone();
    // No candidate: no OpenCL driver and no AVX2.
    let variant = backend::pick(&candidates(app), &failed).ok_or(Failure::with("cpu_unsupported", "no OpenCL.dll"))?;
    #[cfg(target_os = "macos")]
    let bin = std::env::current_exe().map_err(|e| Failure::with("engine_missing", e))?.with_file_name(format!("katago-{variant}"));
    #[cfg(not(target_os = "macos"))]
    let bin = {
        let folder = if cfg!(windows) { "katago-win" } else { "katago-linux" };
        let exe = format!("katago{}", std::env::consts::EXE_SUFFIX);
        app.path().resolve(Path::new("resources").join(folder).join(variant).join(exe), BaseDirectory::Resource)
            .map_err(|e| Failure::with("engine_missing", e))?
    };
    Ok((bin, home))
}

#[cfg(engine_variants)]
fn candidates(app: &AppHandle) -> Vec<&'static str> { backend::candidates(read_settings(app)["engineVariant"].as_str(), opencl_ok(), cpu_ok()) }

/// The OpenCL build imports OpenCL.dll, which only a GPU driver installs (in System32); it is not bundled. Without the
/// system copy, the loader would go on to the current directory and PATH, where anyone could have planted one.
#[cfg(windows)]
fn opencl_ok() -> bool {
    use std::os::windows::ffi::OsStringExt;
    use windows_sys::Win32::System::SystemInformation::GetSystemDirectoryW;
    let mut buf = [0u16; 260];
    // Length without the terminating NUL; 0 on error, or the size needed if the buffer is too small.
    let n = unsafe { GetSystemDirectoryW(buf.as_mut_ptr(), buf.len() as u32) } as usize;
    n > 0 && n < buf.len() && PathBuf::from(OsString::from_wide(&buf[..n])).join("OpenCL.dll").is_file()
}

/// Linux: libOpenCL.so.1 is only looked up in the system library paths (no planting concern); macOS: OpenCL.framework
/// is part of the system. Without a working driver the OpenCL build fails before Ready and engine_fallback moves on to
/// the CPU build. Only a Ready variant is remembered.
#[cfg(all(engine_variants, not(windows)))]
fn opencl_ok() -> bool { true }

/// The Windows and Linux CPU builds are compiled for AVX2 + FMA; without them they would die on an illegal instruction.
/// The Intel Mac one needs neither.
#[cfg(engine_variants)]
fn cpu_ok() -> bool {
    #[cfg(target_arch = "x86_64")]
    { cfg!(target_os = "macos") || is_x86_feature_detected!("avx2") && is_x86_feature_detected!("fma") }
    #[cfg(not(target_arch = "x86_64"))]
    { false }
}

/// Windows, Linux, Intel Macs: a bundled build that fails before it is ready (driver crash, hang) is replaced by the next
/// candidate for this session. Nothing is persisted here: a bad model or config crashes every build, so only a build
/// that reaches Ready is remembered (engine_ready). Engine calls this with its process lock held, so it must not touch the engine.
#[cfg(engine_variants)]
fn engine_fallback(app: &AppHandle, spec: &engine::Spec, error: Failure) -> Res<engine::Spec> {
    let Some(variant) = backend::variant_of(&spec.bin).filter(|_| backend::is_backend_failure(error.code) && env_path("BADUK_KATAGO").is_none())
    else { return Err(error) };
    let next = backend::next(&candidates(app), &mut app.state::<App>().failed_variants.lock().unwrap(), variant);
    let Some(next) = next else {
        // Every candidate failed: the last error (likely the model or config), or, when OpenCL failed and the CPU build
        // cannot run here, say so with OpenCL's own error as detail.
        return Err(if cpu_ok() { error } else { Failure { code: "cpu_unsupported", detail: error.detail.or(Some(error.code.into())) } });
    };
    eprintln!("[katago] {variant} failed ({error:?}), falling back to {next}");
    engine_spec(app)
}

/// Windows, Linux, Intel Macs: the bundled build that reached Ready becomes the one the next launch starts with.
#[cfg(engine_variants)]
fn engine_ready(app: &AppHandle, spec: &engine::Spec) {
    if env_path("BADUK_KATAGO").is_some() { return }
    if let Some(v) = backend::to_persist(read_settings(app)["engineVariant"].as_str(), &spec.bin) {
        let _ = write_setting(app, "engineVariant", json!(v));
    }
}

const CONFIG: &str = "analysis.cfg";

/// KataGo reads its config from the data dir, its working directory (see engine::args): the bundled one is copied
/// there when missing or different.
fn install_config(app: &AppHandle) -> Res<()> {
    let src = app.path().resolve(Path::new("resources").join("katago").join(CONFIG), BaseDirectory::Resource)
        .map_err(|e| Failure::with("config_missing", e))?;
    // Through the fs plugin: on Android resources are APK assets, not files.
    let bytes = tauri_plugin_fs::FsExt::fs(app).read(src).map_err(|e| Failure::with("config_missing", e))?;
    let dir = data_dir(app)?;
    if std::fs::read(dir.join(CONFIG)).ok().as_ref() != Some(&bytes) {
        std::fs::create_dir_all(&dir).and_then(|_| std::fs::write(dir.join(CONFIG), &bytes)).map_err(|e| Failure::with("config_missing", e))?;
    }
    Ok(())
}

/// Engine binary + bundled config + active net, with env overrides for development against another KataGo build.
fn engine_spec(app: &AppHandle) -> Res<Spec> {
    let models = models_dir(app)?;
    let (bin, overrides) = engine_bin(app)?;
    let config = match env_path("BADUK_KATAGO_CONFIG") { Some(p) => p, None => data_dir(app)?.join(CONFIG) };
    let model = match env_path("BADUK_KATAGO_MODEL") {
        Some(p) => p,
        None => networks::file(&models, &active_network(app).ok_or(Failure::new("no_analysis_net"))?),
    };
    let human = Some(networks::file(&models, networks::HUMAN)).filter(|p| p.is_file());
    Ok(Spec { bin, config, model, human, cwd: data_dir(app)?, overrides })
}

fn ensure_engine(app: &AppHandle, s: &App) -> Res<()> {
    match engine_spec(app) {
        Ok(spec) => s.engine.ensure(spec),
        Err(e) => { s.engine.stop(); Err(e) } // e.g. the last analysis net was deleted
    }
}

#[tauri::command]
async fn networks_catalog(app: AppHandle, s: State<'_, App>) -> Res<Value> {
    let cache = data_dir(&app)?.join("catalog.json");
    let (nets, error) = match networks::fetch_nets(&s.http).await {
        Ok(nets) => {
            let _ = std::fs::create_dir_all(data_dir(&app)?);
            let _ = std::fs::write(&cache, serde_json::to_vec(&nets).unwrap());
            (nets, None)
        }
        Err(e) => {
            // Offline: last good catalog, re-validated since it is just a file on disk.
            let cached: Vec<networks::ApiNet> = std::fs::read(&cache).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
            (cached.into_iter().filter(networks::validate).collect(), Some(e)) // e.code == "catalog_offline"
        }
    };
    let entries = networks::catalog(&nets);
    *s.catalog.lock().unwrap() = entries.clone();
    Ok(json!({ "entries": entries, "error": error }))
}

#[tauri::command]
fn networks_state(app: AppHandle, s: State<'_, App>) -> Res<Value> {
    let downloading: Vec<String> = s.downloads.lock().unwrap().keys().cloned().collect();
    let active = active_network(&app);
    Ok(json!({
        "installed": networks::installed(&models_dir(&app)?),
        "active": active,
        "activeKey": active.as_deref().and_then(networks::preset_key),
        "downloading": downloading,
        "human": networks::HUMAN,
    }))
}

#[tauri::command]
fn network_download(app: AppHandle, s: State<'_, App>, name: String) -> Res<()> {
    // Only names from our own catalog: the webview never supplies a URL.
    let entry = {
        let mut cat = s.catalog.lock().unwrap();
        if cat.is_empty() { *cat = networks::catalog(&[]) }
        cat.iter().find(|e| e.name == name).cloned().ok_or(Failure::new("unknown_network"))?
    };
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut d = s.downloads.lock().unwrap();
        if d.contains_key(&name) { return Ok(()) }
        d.insert(name.clone(), cancel.clone());
    }
    let (http, dir) = (s.http.clone(), models_dir(&app)?);
    tauri::async_runtime::spawn(async move {
        let send = |state: &str, got: u64, error: Option<Failure>| {
            let _ = app.emit("network-progress", json!({ "name": entry.name, "state": state, "received": got, "total": entry.bytes, "error": error }));
        };
        let mut last = Instant::now();
        let r = networks::download(&http, &entry, &dir, &cancel, |got, total| {
            if got == total || last.elapsed().as_millis() >= 120 { last = Instant::now(); send("downloading", got, None) }
        }).await;
        let r = match r {
            Ok(true) => {
                send("verifying", entry.bytes, None);
                let (d, e) = (dir.clone(), entry.clone());
                tauri::async_runtime::spawn_blocking(move || networks::finish(&d, &e.name, e.bytes, &e.sha256)).await
                    .unwrap_or_else(|e| Err(Failure::with("install_failed", e))).map(|_| true)
            }
            other => other,
        };
        app.state::<App>().downloads.lock().unwrap().remove(&entry.name);
        match r {
            Ok(true) => send("done", entry.bytes, None),
            Ok(false) => send("cancelled", 0, None),
            Err(m) => send("error", 0, Some(m)),
        }
    });
    Ok(())
}

#[tauri::command]
fn network_cancel(s: State<'_, App>, name: String) {
    if let Some(c) = s.downloads.lock().unwrap().get(&name) { c.store(true, Ordering::Relaxed) }
}

#[tauri::command]
fn network_delete(app: AppHandle, s: State<'_, App>, name: String) -> Res<()> {
    if s.downloads.lock().unwrap().contains_key(&name) { return Err(Failure::new("download_running")) }
    let file = networks::file(&models_dir(&app)?, &name);
    if s.engine.running_spec().is_some_and(|sp| sp.model == file || sp.human.as_ref() == Some(&file)) { s.engine.stop() }
    networks::remove(&models_dir(&app)?, &name)
}

#[tauri::command]
async fn network_set_active(app: AppHandle, s: State<'_, App>, name: String) -> Res<()> {
    if !networks::valid_name(&name) || !networks::file(&models_dir(&app)?, &name).is_file() { return Err(Failure::new("not_installed")) }
    write_setting(&app, "activeNetwork", json!(name))?;
    if s.engine.running_spec().is_some() { ensure_engine(&app, &s)? } // restart on the new net
    Ok(())
}

#[tauri::command]
fn engine_status(s: State<'_, App>) -> Status { s.engine.status() }

#[tauri::command]
async fn engine_start(app: AppHandle, s: State<'_, App>) -> Res<()> { ensure_engine(&app, &s) } // async: spawning needs the tokio runtime

const ENGINE_LOG: &str = "engine.log";

/// Diagnostics for a bug report: app version, platform, engine build and state, and the end of the engine log.
#[tauri::command]
fn engine_log_tail(app: AppHandle, s: State<'_, App>) -> Res<String> {
    let build = s.engine.running_spec().map_or("none", |sp| backend::variant_of(&sp.bin).unwrap_or("katago"));
    Ok(format!("Masame {} · {} {} · engine {build} · {:?}\n\n{}", app.package_info().version, std::env::consts::OS, std::env::consts::ARCH,
        s.engine.status(), engine::log_tail(&data_dir(&app)?.join(ENGINE_LOG), 200)))
}

#[tauri::command]
fn engine_stop(s: State<'_, App>) { s.engine.stop() }

/// One analysis query (positions are built by the frontend); starts or restarts the engine as needed.
#[tauri::command]
async fn engine_analyze(app: AppHandle, s: State<'_, App>, query: Value) -> Res<Value> {
    ensure_engine(&app, &s)?;
    s.engine.analyze(query).await
}

/// Opens one of a few fixed pages (credits) in the default browser; the webview never passes a URL.
#[tauri::command]
fn open_link(app: AppHandle, which: String) -> Res<()> {
    let url = match which.as_str() {
        "katago" => "https://github.com/lightvector/KataGo",
        "license" => "https://katagotraining.org/network_license/",
        "releases" => "https://github.com/Slymaster/masame/releases/latest",
        _ => return Err(Failure::new("unknown_link")),
    };
    open_url(&app, url)
}

/// Whether this build can replace itself: everywhere but Linux, where only the AppImage can (a .deb or .rpm belongs to
/// the package manager). The bundle type is the marker Tauri's bundler patches into the binary, not the environment.
#[cfg(desktop)]
fn installable() -> bool {
    !cfg!(target_os = "linux") || matches!(tauri::utils::platform::bundle_type(), Some(tauri::utils::config::BundleType::AppImage))
}

/// The updater for the fixed endpoint in tauri.conf.json.
#[cfg(desktop)]
fn updater<R: tauri::Runtime>(app: &AppHandle<R>) -> tauri_plugin_updater::Result<tauri_plugin_updater::Updater> {
    // Only the local end-to-end test build allows plain http (an override config, never committed).
    let https = app.config().plugins.0.get("updater").and_then(|u| u.get("dangerousInsecureTransportProtocol")).and_then(Value::as_bool) != Some(true);
    app.updater_builder()
        .timeout(Duration::from_secs(30)) // the check only; the Update gets no overall timeout
        // Copied into the Update, so it also covers the download: a stalled transfer fails instead of hanging, and an
        // https -> http redirect (GitHub sends the files from its download hosts) is refused rather than followed.
        .configure_client(move |c| c.read_timeout(Duration::from_secs(30)).https_only(https))
        .build()
}

/// Asks the fixed endpoint whether a newer release exists, and keeps it for update_install.
#[cfg(desktop)]
#[tauri::command]
async fn update_check(app: AppHandle, s: State<'_, App>) -> Res<Option<Value>> {
    let fail = |e: tauri_plugin_updater::Error| Failure::with("update_check", e);
    let update = updater(&app).map_err(fail)?.check().await.map_err(fail)?;
    let reply = update.as_ref().map(|u| json!({ "version": u.version, "install": installable() }));
    *s.update.lock().unwrap() = update;
    Ok(reply)
}

/// Downloads the checked update (verified against the public key in tauri.conf.json), stops KataGo (on Windows the
/// installer replaces katago.exe and its DLLs), installs and restarts. On Windows `install` exits the app itself.
#[cfg(desktop)]
#[tauri::command]
async fn update_install(app: AppHandle, s: State<'_, App>) -> Res<()> {
    if !installable() { return Err(Failure::with("update_failed", "not installable")) }
    // Taken out while it runs, so a second click finds nothing; put back if it fails, for another try.
    let update = s.update.lock().unwrap().take().ok_or(Failure::with("update_failed", "no update checked"))?;
    let r: Result<(), String> = async {
        let (mut got, mut last) = (0u64, Instant::now());
        let bytes = update.download(|n, total| {
            got += n as u64;
            if Some(got) == total || last.elapsed().as_millis() >= 120 {
                last = Instant::now();
                let _ = app.emit("update-progress", json!({ "received": got, "total": total }));
            }
        }, || {}).await.map_err(|e| e.to_string())?;
        let _ = app.emit("update-installing", ()); // downloaded and verified (also when the size was unknown)
        s.engine.stop();
        let u = update.clone();
        tauri::async_runtime::spawn_blocking(move || u.install(bytes)).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())
    }.await;
    match r {
        Ok(()) => { app.request_restart(); Ok(()) }
        Err(e) => { *s.update.lock().unwrap() = Some(update); Err(Failure::with("update_failed", e)) }
    }
}

#[cfg(target_os = "macos")]
fn open_url<R: tauri::Runtime>(_app: &AppHandle<R>, url: &str) -> Res<()> {
    // Absolute path: never resolved through PATH.
    std::process::Command::new("/usr/bin/open").arg(url).spawn().map(|_| ()).map_err(|e| Failure::with("open_failed", e))
}

#[cfg(windows)]
fn open_url<R: tauri::Runtime>(_app: &AppHandle<R>, url: &str) -> Res<()> {
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
    let (verb, file) = (wide("open"), wide(url));
    // The default browser via the shell's URL association: no command line, no PATH lookup.
    let r = unsafe { ShellExecuteW(0 as _, verb.as_ptr(), file.as_ptr(), std::ptr::null(), std::ptr::null(), SW_SHOWNORMAL) };
    if r as usize > 32 { Ok(()) } else { Err(Failure::with("open_failed", r as usize)) }
}

#[cfg(all(desktop, not(any(target_os = "macos", windows))))]
fn open_url<R: tauri::Runtime>(_app: &AppHandle<R>, url: &str) -> Res<()> {
    // Absolute path: never resolved through PATH.
    std::process::Command::new("/usr/bin/xdg-open").arg(url).spawn().map(|_| ()).map_err(|e| Failure::with("open_failed", e))
}

#[cfg(mobile)]
fn open_url<R: tauri::Runtime>(app: &AppHandle<R>, url: &str) -> Res<()> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_url(url, None::<&str>).map_err(|e| Failure::with("open_failed", e))
}

/// Android: rustls checks certificates with the OS trust store, through the JVM context tao registered. Without it every
/// HTTPS call fails closed, so the cause goes to logcat (tag "masame"): stderr goes nowhere on Android.
#[cfg(target_os = "android")]
fn init_tls() {
    let ctx = ndk_context::android_context();
    let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) };
    let Err(e) = vm.attach_current_thread(|env| {
        let context = unsafe { jni::objects::JObject::from_raw(env, ctx.context().cast()) };
        rustls_platform_verifier::android::init_with_env(env, context)
    }) else { return };
    use std::ffi::{c_char, c_int, CString};
    #[link(name = "log")]
    extern "C" { fn __android_log_write(prio: c_int, tag: *const c_char, text: *const c_char) -> c_int; }
    let text = CString::new(format!("TLS verifier not initialised, every HTTPS call will fail: {e}").replace('\0', "")).unwrap_or_default();
    unsafe { __android_log_write(6 /* ANDROID_LOG_ERROR */, c"masame".as_ptr(), text.as_ptr()) };
}

/// Rebuilds the macOS menu bar in the UI language; `labels` come from the frontend dictionary. No-op elsewhere.
#[tauri::command]
fn set_language(app: AppHandle, labels: menu::Labels) -> Res<()> {
    #[cfg(target_os = "macos")]
    app.set_menu(menu::build(&app, &labels).map_err(|e| Failure::with("menu_failed", e))?).map_err(|e| Failure::with("menu_failed", e))?;
    #[cfg(not(target_os = "macos"))]
    let _ = (app, labels);
    Ok(())
}

/// Greys the macOS menu items that make no sense now (`enabled`: id → on, from the frontend); kept for later rebuilds.
#[tauri::command]
fn set_menu_enabled(app: AppHandle, enabled: HashMap<String, bool>) -> Res<()> {
    menu::set_enabled(enabled);
    #[cfg(target_os = "macos")]
    if let Some(m) = app.menu() { menu::apply(&m).map_err(|e| Failure::with("menu_failed", e))?; }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
    Ok(())
}

/// The SGF size cap, in bytes; the webview caps the text it opens at the same figure (MAX_SGF in src/sgf.ts), and so
/// does the library (library.rs).
const MAX_SGF: u64 = 5 * 1024 * 1024;

/// The existing files among a launch's arguments (how Windows and Linux pass an associated file), relative ones
/// resolved against the launch's directory.
fn arg_files(args: impl IntoIterator<Item = impl Into<PathBuf>>, cwd: &Path) -> Vec<PathBuf> {
    args.into_iter().skip(1).map(|a| cwd.join(a.into())).filter(|p| p.is_file()).collect()
}

/// macOS hands opened documents over as URLs: only file ones are ours.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn url_file(u: &tauri::Url) -> Option<PathBuf> { if u.scheme() == "file" { u.to_file_path().ok() } else { None } }

fn read_sgf(path: &Path) -> Res<String> {
    use std::io::Read;
    let mut bytes = vec![];
    std::fs::File::open(path).and_then(|f| f.take(MAX_SGF + 1).read_to_end(&mut bytes)).map_err(|e| Failure::with("open_unreadable", e))?;
    if bytes.len() as u64 > MAX_SGF { return Err(Failure::new("open_too_big")) }
    Ok(String::from_utf8_lossy(&bytes).into_owned()) // lossy like the dialog's readTextFile
}

/// Files the OS asked us to open (Finder, Explorer, a launch's arguments), until take_opened. Not in App: macOS hands
/// over a double-clicked document before `setup` runs, so this is managed on the Builder.
struct OpenedFiles(Mutex<Vec<PathBuf>>);

#[cfg_attr(not(any(windows, target_os = "macos")), allow(dead_code))] // Linux: no single instance, no Opened event
fn queue_opened(app: &AppHandle, files: Vec<PathBuf>) {
    if files.is_empty() { return }
    app.state::<OpenedFiles>().0.lock().unwrap().extend(files);
    let _ = app.emit("files-opened", ()); // before the page listens it is lost, but take_opened at mount gets the file
}

#[derive(serde::Serialize)]
struct Opened { name: String, text: String }

/// Partager › Kifu: the system print dialog for the page (WKWebView ignores window.print(); wry prints the webview on
/// every desktop OS), where "Save as PDF" makes the PDF.
#[cfg(desktop)]
#[tauri::command]
fn print_page(webview: tauri::Webview) -> Res<()> {
    webview.print().map_err(|e| Failure::with("print_failed", e))
}

/// The last file the OS asked us to open (earlier ones are dropped: one game at a time), read here so the webview never
/// names a path.
#[tauri::command]
fn take_opened(opened: State<'_, OpenedFiles>) -> Res<Option<Opened>> {
    let Some(path) = std::mem::take(&mut *opened.0.lock().unwrap()).pop() else { return Ok(None) };
    Ok(Some(Opened { name: path.file_name().unwrap_or_default().to_string_lossy().into_owned(), text: read_sgf(&path)? }))
}

static FLUSHED: AtomicBool = AtomicBool::new(false); // the close's library flush was asked (once)
const FLUSH_WAIT: Duration = Duration::from_millis(300);
/// Quitting (⌘Q, or the last window gone): the page writes its pending library change first, then the app exits.
fn quit(app: &tauri::AppHandle) {
    if FLUSHED.swap(true, Ordering::SeqCst) { return app.exit(0) }
    let _ = app.emit("library-flush", ());
    let app = app.clone();
    std::thread::spawn(move || { std::thread::sleep(FLUSH_WAIT); app.exit(0) });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(OpenedFiles(Mutex::new(arg_files(std::env::args_os(), &std::env::current_dir().unwrap_or_default()))));
    // Linux has no single instance (the plugin needs zbus, see keyring in Cargo.toml): a second launch opens its own window.
    #[cfg(windows)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
        queue_opened(app, arg_files(argv, Path::new(&cwd)));
        if let Some(w) = app.get_webview_window("main") { let _ = w.unminimize(); let _ = w.set_focus(); }
    }));
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_opener::init());
    let builder = builder
        .manage(library::Library::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            #[cfg(target_os = "android")]
            init_tls();
            let h = app.handle().clone();
            let mut engine = Engine::new(move |ev, payload| { let _ = h.emit(ev, payload); });
            if let Ok(d) = data_dir(app.handle()) { engine = engine.with_log(d.join(ENGINE_LOG)) }
            #[cfg(engine_variants)]
            let engine = {
                let (h, h2) = (app.handle().clone(), app.handle().clone());
                engine.with_fallback(move |spec, e| engine_fallback(&h, spec, e)).with_on_ready(move |spec| engine_ready(&h2, spec))
            };
            if let Err(e) = install_config(app.handle()) { eprintln!("[katago] config not installed: {e:?}") }
            app.manage(App {
                engine, http: networks::client(), catalog: Default::default(), downloads: Default::default(), ogs: Default::default(),
                #[cfg(desktop)]
                update: Default::default(),
                #[cfg(engine_variants)]
                failed_variants: Default::default(),
            });
            Ok(())
        });
    // Our menu items (macOS) go to the frontend, which runs them exactly like their keyboard shortcuts.
    #[cfg(desktop)]
    let builder = builder.on_menu_event(|app, e| {
        if e.id().as_ref() == "quit" { return quit(app) }
        if let Some(id) = menu::ACTIONS.iter().find(|a| e.id().as_ref() == **a) { let _ = app.emit("menu", id); }
    });
    builder
        .invoke_handler(tauri::generate_handler![
            networks_catalog, networks_state, network_download, network_cancel, network_delete, network_set_active,
            engine_status, engine_start, engine_stop, engine_analyze, engine_log_tail, open_link, set_language, set_menu_enabled, take_opened,
            #[cfg(desktop)] update_check, #[cfg(desktop)] update_install, #[cfg(desktop)] print_page,
            ogs::ogs_login, ogs::ogs_login_cancel, ogs::ogs_token, ogs::ogs_logout, ogs::ogs_rating_history,
            library::library_list, library::library_read, library::library_write, library::library_delete,
            library::library_sidecar_read, library::library_sidecar_write, library::library_current_read, library::library_current_write
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, ev| match ev {
            // Closing the window or quitting: the page writes its pending library change first (the shown game's last
            // move, its clock), then we close. shortcut: a fixed wait, not an answer from the page; fine for two small files.
            RunEvent::WindowEvent { label, event: tauri::WindowEvent::CloseRequested { api, .. }, .. } if !FLUSHED.swap(true, Ordering::SeqCst) => {
                api.prevent_close();
                let _ = app.emit("library-flush", ());
                let app = app.clone();
                std::thread::spawn(move || { std::thread::sleep(FLUSH_WAIT); if let Some(w) = app.get_webview_window(&label) { let _ = w.destroy(); } });
            }
            RunEvent::ExitRequested { code: None, api, .. } if !FLUSHED.load(Ordering::SeqCst) => { api.prevent_exit(); quit(app) }
            RunEvent::Exit => app.state::<App>().engine.kill(),
            #[cfg(target_os = "macos")]
            RunEvent::Opened { urls } => queue_opened(app, urls.iter().filter_map(url_file).collect()),
            _ => {}
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_are_always_an_object() {
        assert_eq!(parse_settings(br#"{"engineVariant":"opencl"}"#)["engineVariant"], "opencl");
        for b in [&b""[..], b"not json", b"[1,2]", b"null", b"42", b"\"x\""] {
            let mut v = parse_settings(b);
            v["activeNetwork"] = json!("n"); // would panic on an array, number or string
            assert_eq!(v, json!({"activeNetwork": "n"}));
        }
    }

    #[test]
    fn launch_arguments_keep_existing_files() {
        let dir = std::env::temp_dir().join(format!("masame-args-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.sgf"), "(;)").unwrap();
        let abs = dir.join("a.sgf");
        // the executable itself, a missing file and a directory are skipped; relative paths resolve against the launch's directory
        assert_eq!(arg_files([PathBuf::from("masame"), abs.clone(), "missing.sgf".into(), dir.clone(), "a.sgf".into()], &dir), vec![abs.clone(), abs.clone()]);
        assert_eq!(arg_files([abs], &dir), Vec::<PathBuf>::new());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    #[cfg(target_os = "macos")] // url_file serves macOS only; a drive-less file URL is no path on Windows
    fn only_file_urls_are_files() {
        assert_eq!(url_file(&"file:///tmp/a%20b.sgf".parse().unwrap()), Some(PathBuf::from("/tmp/a b.sgf")));
        assert_eq!(url_file(&"https://example.com/a.sgf".parse().unwrap()), None);
    }

    #[test]
    fn sgf_reads_are_capped() {
        let p = std::env::temp_dir().join(format!("masame-cap-{}.sgf", std::process::id()));
        std::fs::write(&p, vec![b'x'; MAX_SGF as usize]).unwrap();
        assert_eq!(read_sgf(&p).unwrap().len() as u64, MAX_SGF);
        std::fs::write(&p, vec![b'x'; MAX_SGF as usize + 1]).unwrap();
        assert_eq!(read_sgf(&p).unwrap_err().code, "open_too_big");
        std::fs::remove_file(&p).unwrap();
        assert_eq!(read_sgf(&p).unwrap_err().code, "open_unreadable");
    }

    /// Our catalogue client and the updater plugin's own reqwest clients in one process: both must complete a TLS
    /// handshake. Network: `cargo test -- --ignored tls_`.
    #[test]
    #[ignore = "network: katagotraining.org and github.com"]
    fn tls_catalog_and_updater_in_one_process() {
        let mut ctx = tauri::test::mock_context(tauri::test::noop_assets());
        let conf: Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        ctx.config_mut().plugins.0.insert("updater".into(), conf["plugins"]["updater"].clone());
        let app = tauri::test::mock_builder().plugin(tauri_plugin_updater::Builder::new().build()).build(ctx).unwrap();
        tauri::async_runtime::block_on(async {
            assert!(!networks::fetch_nets(&networks::client()).await.expect("catalogue over TLS").is_empty());
            // Until a release carries latest.json, GitHub redirects to a 404: ReleaseNotFound means TLS worked.
            let r = updater(app.handle()).unwrap().check().await; // the same client settings as update_check
            eprintln!("updater check: {:?}", r.as_ref().map(|u| u.as_ref().map(|u| u.version.clone())));
            match r {
                Ok(_) | Err(tauri_plugin_updater::Error::ReleaseNotFound) => {}
                Err(e) => panic!("updater check: {e:?}"),
            }
            assert!(!networks::fetch_nets(&networks::client()).await.expect("catalogue after the updater ran").is_empty());
        });
    }
}
