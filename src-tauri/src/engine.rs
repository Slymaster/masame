// KataGo analysis engine: one child process speaking JSON lines; responses are routed back to callers by id.

use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::ffi::OsString;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot, watch};

use crate::failure::{Failure, Res};

const READY_LINE: &str = "Started, ready to begin handling requests";
const STDERR_KEEP: usize = 40;
const QUERY_TIMEOUT: Duration = Duration::from_secs(120);
const START_TIMEOUT: Duration = Duration::from_secs(180); // until KataGo prints its ready line, or since its last tuning line

/// What to launch; a different spec (e.g. another active net) means a restart. Paths are absolute; those under `cwd`
/// reach KataGo relative to it (see `args`). `overrides` are extra `-override-config key=value` arguments.
#[derive(Clone, PartialEq, Debug)]
pub struct Spec { pub bin: PathBuf, pub config: PathBuf, pub model: PathBuf, pub human: Option<PathBuf>, pub cwd: PathBuf, pub overrides: Vec<OsString> }

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(tag = "state", rename_all = "camelCase")]
/// Tuning: OpenCL measures kernels on its first run on a GPU (seconds to minutes; progress lines keep it alive).
/// Warming: KataGo is up but Metal/CoreML compiles the nets on the first evaluation; a hidden query pays that cost.
pub enum Status { Stopped, Starting, Tuning, Warming, Ready, Error { error: Failure } }

type Emit = Arc<dyn Fn(&str, Value) + Send + Sync>;
/// Given a launch that failed before Ready, the spec to launch instead (another engine build), or the error to report.
pub type Fallback = Box<dyn Fn(&Spec, Failure) -> Res<Spec> + Send + Sync>;
type OnReady = Box<dyn Fn(&Spec) + Send + Sync>;

/// KataGo's command line. Paths under `spec.cwd` (the app data dir, KataGo's working directory) are passed relative
/// to it: KataGo's Windows entry point is the narrow `main`, so any character outside the ANSI code page (a Korean user
/// name on a French Windows) would arrive as '?'. Our relative paths are ASCII (validated net names, fixed file names).
fn args(spec: &Spec) -> Vec<OsString> {
    let rel = |p: &PathBuf| p.strip_prefix(&spec.cwd).unwrap_or(p).as_os_str().to_owned();
    let mut a: Vec<OsString> = vec!["analysis".into(), "-config".into(), rel(&spec.config), "-model".into(), rel(&spec.model)];
    if let Some(h) = &spec.human { a.extend(["-human-model".into(), rel(h)]) }
    // Values are always reported from Black's point of view, whatever the bundled config says.
    a.extend(["-override-config".into(), "reportAnalysisWinratesAs=BLACK".into()]);
    for o in &spec.overrides { a.extend(["-override-config".into(), o.clone()]) }
    a
}

/// OpenCL autotuning output on stderr (opencltuner.cpp): "Performing autotuning", "Testing N different configs",
/// "Tuning i/N …", "Tuning xGemm for convolutions", "Done tuning, saved results to …".
fn is_tuning_line(l: &str) -> bool {
    l.contains("Performing autotuning") || l.contains("Done tuning") || l.starts_with("Tuning ") || l.starts_with("Testing ")
}

struct Proc { child: Child, tx: mpsc::UnboundedSender<String>, spec: Spec }

pub struct Engine {
    proc: Mutex<Option<Proc>>,
    status: watch::Sender<Status>,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<Res<Value>>>>>,
    stderr: Arc<Mutex<VecDeque<String>>>,
    gen: AtomicU64,
    ids: AtomicU64,
    emit: Emit,
    fallback: Option<Fallback>,
    on_ready: Option<OnReady>,
    progress: Mutex<Instant>, // launch time or last tuning line: the start timeout counts from here
    query_timeout: Duration,
    start_timeout: Duration,
}

fn valid_id(s: &str) -> bool { !s.is_empty() && s.len() <= 64 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b)) }

impl Engine {
    /// `emit(event, payload)` forwards status changes ("engine-status") and partial results ("engine-partial").
    pub fn new(emit: impl Fn(&str, Value) + Send + Sync + 'static) -> Arc<Self> {
        Arc::new(Self {
            proc: Mutex::new(None), status: watch::channel(Status::Stopped).0, pending: Default::default(),
            stderr: Default::default(), gen: AtomicU64::new(0), ids: AtomicU64::new(0), emit: Arc::new(emit),
            fallback: None, on_ready: None, progress: Mutex::new(Instant::now()), query_timeout: QUERY_TIMEOUT, start_timeout: START_TIMEOUT,
        })
    }

    /// Installs the fallback; call right after `new`, before the engine is shared.
    #[cfg_attr(not(windows), allow(dead_code))] // only Windows ships several engine builds
    pub fn with_fallback(mut self: Arc<Self>, f: impl Fn(&Spec, Failure) -> Res<Spec> + Send + Sync + 'static) -> Arc<Self> {
        Arc::get_mut(&mut self).expect("engine not shared yet").fallback = Some(Box::new(f));
        self
    }

    /// Called with the spec of each launch that reaches Ready (outside any engine lock); call right after `new`.
    #[cfg_attr(not(windows), allow(dead_code))]
    pub fn with_on_ready(mut self: Arc<Self>, f: impl Fn(&Spec) + Send + Sync + 'static) -> Arc<Self> {
        Arc::get_mut(&mut self).expect("engine not shared yet").on_ready = Some(Box::new(f));
        self
    }

    /// The process slot. Callbacks run under it, so a panic in one must not leave the engine unusable (or panic at exit).
    fn proc(&self) -> MutexGuard<'_, Option<Proc>> { self.proc.lock().unwrap_or_else(PoisonError::into_inner) }

    fn fall_back(&self, spec: &Spec, error: Failure) -> Res<Spec> {
        match &self.fallback {
            Some(f) => f(spec, error).and_then(|next| if next == *spec { Err(Failure::new("engine_missing")) } else { Ok(next) }),
            None => Err(error),
        }
    }

    fn starting(&self) -> bool { matches!(self.status(), Status::Starting | Status::Tuning | Status::Warming) }

    pub fn status(&self) -> Status { self.status.borrow().clone() }

    fn set_status(&self, s: Status) {
        (self.emit)("engine-status", serde_json::to_value(&s).unwrap());
        self.status.send_replace(s);
    }

    /// Starts KataGo unless it already runs (or is starting) with this exact spec.
    pub fn ensure(self: &Arc<Self>, spec: Spec) -> Res<()> {
        let mut guard = self.proc();
        if guard.as_ref().is_some_and(|p| p.spec == spec) && !matches!(self.status(), Status::Error { .. } | Status::Stopped) {
            return Ok(());
        }
        self.launch(&mut guard, spec)
    }

    /// Replaces the running process with `spec`; a launch that cannot even spawn goes to the fallback.
    fn launch(self: &Arc<Self>, guard: &mut Option<Proc>, mut spec: Spec) -> Res<()> {
        loop {
            let Err(e) = self.spawn(guard, spec.clone()) else { return Ok(()) };
            match self.fall_back(&spec, e) {
                Ok(next) => spec = next,
                Err(e) => return self.fail(e),
            }
        }
    }

    fn spawn(self: &Arc<Self>, guard: &mut Option<Proc>, spec: Spec) -> Res<()> {
        // New generation first: the old process's reader must not report its own exit, even if this launch fails.
        let gen = self.gen.fetch_add(1, Ordering::SeqCst) + 1;
        if let Some(mut old) = guard.take() { let _ = old.child.start_kill(); }
        self.fail_pending(Failure::new("engine_stopped"));
        for (p, code) in [(&spec.bin, "engine_missing"), (&spec.config, "config_missing"), (&spec.model, "model_missing")] {
            if !p.is_file() { return Err(Failure::with(code, p.display())); }
        }
        let mut cmd = Command::new(&spec.bin);
        cmd.args(args(&spec))
            .current_dir(&spec.cwd) // the relative paths in args, and homeDataDir on Windows, resolve against app data
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
        #[cfg(windows)]
        let child = win::spawn(&mut cmd);
        #[cfg(not(windows))]
        let child = cmd.spawn();
        let mut child = child.map_err(|e| Failure::with("spawn_failed", e))?;
        let (mut stdin, stdout, stderr) = (child.stdin.take().unwrap(), child.stdout.take().unwrap(), child.stderr.take().unwrap());
        let (tx, mut rx) = mpsc::unbounded_channel::<String>();
        tokio::spawn(async move {
            while let Some(line) = rx.recv().await {
                if stdin.write_all(line.as_bytes()).await.is_err() || stdin.flush().await.is_err() { break }
            }
        });
        self.stderr.lock().unwrap().clear();
        *self.progress.lock().unwrap() = Instant::now();
        let me = self.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(l)) = lines.next_line().await {
                if cfg!(debug_assertions) { eprintln!("[katago] {l}") }
                if me.gen.load(Ordering::SeqCst) == gen {
                    if l.contains(READY_LINE) { me.warm_up(gen) } else if is_tuning_line(&l) { me.tuning() }
                }
                let mut buf = me.stderr.lock().unwrap();
                if buf.len() == STDERR_KEEP { buf.pop_front(); }
                buf.push_back(l);
            }
        });
        let me = self.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(l)) = lines.next_line().await { me.route(&l) }
            // stdout closed: the process exited. Only report it if nobody asked for it.
            let last = me.stderr.lock().unwrap().iter().rev().find(|l| !l.trim().is_empty()).cloned().unwrap_or_default();
            me.report(gen, Failure::with("engine_crashed", last), false);
        });
        *guard = Some(Proc { child, tx, spec });
        self.set_status(Status::Starting);
        let (me, wait) = (self.clone(), self.start_timeout);
        tokio::spawn(async move {
            // Sleeps until the deadline, which each tuning line pushes back.
            loop {
                let due = *me.progress.lock().unwrap() + wait;
                tokio::time::sleep_until(due.into()).await;
                if me.gen.load(Ordering::SeqCst) != gen || !matches!(me.status(), Status::Starting | Status::Tuning) { return }
                if Instant::now() >= *me.progress.lock().unwrap() + wait { break }
            }
            me.report(gen, Failure::with("engine_timeout", "start"), true);
        });
        Ok(())
    }

    /// A tuning line: Starting becomes Tuning, and the start deadline moves back.
    fn tuning(&self) {
        *self.progress.lock().unwrap() = Instant::now();
        if self.status.send_if_modified(|s| if *s == Status::Starting { *s = Status::Tuning; true } else { false }) {
            (self.emit)("engine-status", serde_json::to_value(Status::Tuning).unwrap());
        }
    }

    /// Generation `gen` failed. Before Ready, the fallback may relaunch another build; otherwise the error is reported
    /// (and with `kill`, the hung process is stopped first).
    fn report(self: &Arc<Self>, gen: u64, error: Failure, kill: bool) {
        let mut guard = self.proc();
        if self.gen.load(Ordering::SeqCst) != gen { return }
        let error = match guard.as_ref().filter(|_| self.starting()).map(|p| p.spec.clone()) {
            Some(spec) => match self.fall_back(&spec, error) {
                Ok(next) => { let _ = self.launch(&mut guard, next); return }
                Err(e) => e,
            },
            None => error,
        };
        if kill {
            self.gen.fetch_add(1, Ordering::SeqCst); // the killed process's reader must stay silent
            if let Some(mut p) = guard.take() { let _ = p.child.start_kill(); }
        }
        drop(guard);
        self.set_status(Status::Error { error: error.clone() }); // status first: a query arriving now sees the error
        self.fail_pending(error);
    }

    fn fail(&self, error: Failure) -> Res<()> {
        self.set_status(Status::Error { error: error.clone() });
        Err(error)
    }

    fn fail_pending(&self, error: Failure) {
        for (_, tx) in self.pending.lock().unwrap().drain() { let _ = tx.send(Err(error.clone())); }
    }

    /// Hidden first query on an empty 19×19 board, through the human net too when it is loaded; Ready once answered.
    /// KataGo 1.18 Metal (MPSGraph) compiles the graph once per batch size (~4.5 s each, 1..nnMaxBatchSize). 64 visits
    /// pays the bulk of it (the first query otherwise takes ~13 s); a rarer batch size can still cost one ~5 s query
    /// later. Smaller boards share the 19×19 graphs, so no per-size warm-up.
    fn warm_up(self: &Arc<Self>, gen: u64) {
        self.set_status(Status::Warming);
        let human = self.proc().as_ref().is_some_and(|p| p.spec.human.is_some());
        let mut q = json!({"rules": "japanese", "komi": 6.5, "boardXSize": 19, "boardYSize": 19, "moves": [], "maxVisits": 64});
        if human { q["includePolicy"] = json!(true); q["overrideSettings"] = json!({"humanSLProfile": "rank_10k"}); }
        let me = self.clone();
        tokio::spawn(async move {
            let r = me.request(format!("warmup{gen}"), q).await;
            if me.gen.load(Ordering::SeqCst) != gen { return }
            match r {
                Ok(_) => me.ready(gen),
                // A refused warm-up (e.g. an old KataGo) is not fatal: real queries will report their own errors.
                Err(e) if e.code == "katago_error" => { eprintln!("[katago] warm-up refused: {e:?}"); me.ready(gen) }
                Err(e) if e.code == "engine_timeout" => me.report(gen, e, false),
                Err(_) => {} // the process died: its reader reports engine_crashed
            }
        });
    }

    fn ready(&self, gen: u64) {
        self.set_status(Status::Ready);
        // Same lock as spawn's generation bump: the spec is generation `gen`'s, not a later launch's.
        let spec = self.proc().as_ref().filter(|_| self.gen.load(Ordering::SeqCst) == gen).map(|p| p.spec.clone());
        if let (Some(f), Some(spec)) = (&self.on_ready, spec) { f(&spec) }
    }

    /// Engine output is untrusted text: anything that is not a JSON object with a known id is only logged.
    fn route(&self, line: &str) {
        let Ok(v) = serde_json::from_str::<Value>(line) else { return eprintln!("[katago] unreadable line: {line}") };
        let Some(id) = v.get("id").and_then(Value::as_str) else { return eprintln!("[katago] {v}") };
        if v.get("isDuringSearch") == Some(&Value::Bool(true)) {
            return (self.emit)("engine-partial", v);
        }
        if v.get("warning").is_some() { return eprintln!("[katago] {v}") }
        if let Some(tx) = self.pending.lock().unwrap().remove(id) { let _ = tx.send(Ok(v)); }
    }

    /// Sends one analysis query and waits for its final response (isDuringSearch: false).
    pub async fn analyze(&self, mut query: Value) -> Res<Value> {
        let stopped = || Failure::new("engine_stopped");
        let obj = query.as_object_mut().ok_or(Failure::new("bad_query"))?;
        if obj.contains_key("action") { return Err(Failure::new("bad_query")) }
        let id = match obj.get("id").and_then(Value::as_str) {
            Some(s) if valid_id(s) => s.to_string(),
            _ => format!("q{}", self.ids.fetch_add(1, Ordering::Relaxed)),
        };
        obj.insert("id".into(), json!(id));
        let mut st = self.status.subscribe();
        loop {
            match &*st.borrow_and_update() {
                Status::Ready => break,
                Status::Starting | Status::Tuning | Status::Warming => {}
                Status::Stopped => return Err(stopped()),
                Status::Error { error } => return Err(error.clone()),
            }
            st.changed().await.map_err(|_| stopped())?;
        }
        self.request(id, query).await
    }

    /// Writes one query to the running process and waits for the response routed back by id.
    async fn request(&self, id: String, mut query: Value) -> Res<Value> {
        let stopped = || Failure::new("engine_stopped");
        query["id"] = json!(id);
        let (tx, rx) = oneshot::channel();
        {
            let mut pending = self.pending.lock().unwrap();
            if pending.contains_key(&id) { return Err(Failure::new("query_pending")) }
            pending.insert(id.clone(), tx);
        }
        let sent = self.proc().as_ref().is_some_and(|p| p.tx.send(format!("{query}\n")).is_ok());
        if !sent { self.pending.lock().unwrap().remove(&id); return Err(stopped()) }
        let v = match tokio::time::timeout(self.query_timeout, rx).await {
            Ok(r) => r.map_err(|_| stopped())??,
            Err(_) => { self.pending.lock().unwrap().remove(&id); return Err(Failure::with("engine_timeout", "query")) }
        };
        match v.get("error").and_then(Value::as_str) {
            Some(e) => Err(Failure::with("katago_error", e)),
            None => Ok(v),
        }
    }

    pub fn stop(&self) {
        self.gen.fetch_add(1, Ordering::SeqCst);
        if let Some(mut p) = self.proc().take() { let _ = p.child.start_kill(); }
        self.fail_pending(Failure::new("engine_stopped"));
        self.set_status(Status::Stopped);
    }

    /// Synchronous kill for app exit.
    pub fn kill(&self) {
        self.gen.fetch_add(1, Ordering::SeqCst);
        if let Some(mut p) = self.proc().take() { let _ = p.child.start_kill(); }
    }

    pub fn running_spec(&self) -> Option<Spec> { self.proc().as_ref().map(|p| p.spec.clone()) }
}

/// Windows process details: no console, no system error dialogs, and a job object that kills KataGo when the app's
/// last handle closes, i.e. when the app exits or crashes (kill_on_drop only covers a clean exit).
#[cfg(windows)]
mod win {
    use std::sync::OnceLock;
    use tokio::process::{Child, Command};
    use windows_sys::Win32::System::Diagnostics::Debug::{SetErrorMode, SEM_FAILCRITICALERRORS, SEM_NOGPFAULTERRORBOX};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    /// One job for the app's lifetime (0 if it could not be set up); its handle is deliberately never closed.
    fn job() -> usize {
        static JOB: OnceLock<usize> = OnceLock::new();
        *JOB.get_or_init(|| unsafe {
            let h = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if h as usize == 0 { return 0 }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let ok = SetInformationJobObject(h, JobObjectExtendedLimitInformation, &info as *const _ as *const _, std::mem::size_of_val(&info) as u32);
            if ok == 0 { 0 } else { h as usize }
        })
    }

    pub fn spawn(cmd: &mut Command) -> std::io::Result<Child> {
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        // The child inherits the error mode: a GPU build without OpenCL.dll, or crashing in a driver, must fail quietly
        // (and fall back) instead of showing "OpenCL.dll was not found" or "katago.exe has stopped working".
        let old = unsafe { SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX) };
        let child = cmd.spawn();
        unsafe { SetErrorMode(old) };
        let child = child?;
        let (job, Some(process)) = (job(), child.raw_handle()) else { return Ok(child) };
        if job != 0 && unsafe { AssignProcessToJobObject(job as _, process as _) } == 0 {
            eprintln!("[katago] could not tie the engine to the app: {}", std::io::Error::last_os_error());
        }
        Ok(child)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn models() -> PathBuf { PathBuf::from(std::env::var("HOME").unwrap_or_default()).join("Library/Application Support/com.sylvainrey.masame/models") } // macOS dev box

    /// Old Homebrew KataGo 1.15.3 + g170e net + humanv0 (BADUK_KATAGO / BADUK_KATAGO_CONFIG / BADUK_KATAGO_MODEL override).
    fn spec() -> Spec {
        let env = |k: &str, d: &str| PathBuf::from(std::env::var(k).unwrap_or_else(|_| d.into()));
        Spec {
            bin: env("BADUK_KATAGO", "/opt/homebrew/bin/katago"),
            config: env("BADUK_KATAGO_CONFIG", "/opt/homebrew/share/katago/configs/analysis_example.cfg"),
            model: env("BADUK_KATAGO_MODEL", "/opt/homebrew/share/katago/g170e-b20c256x2-s5303129600-d1228401921.bin.gz"),
            human: Some(models().join("b18c384nbt-humanv0.bin.gz")),
            cwd: std::env::temp_dir(),
            overrides: vec![],
        }
    }

    #[tokio::test]
    async fn missing_binary_is_a_coded_error() {
        let e = Engine::new(|_, _| {});
        let mut s = spec();
        s.bin = "/nonexistent/katago".into();
        assert_eq!(e.ensure(s).unwrap_err().code, "engine_missing");
        assert!(matches!(e.status(), Status::Error { .. }));
        assert!(e.analyze(json!({})).await.is_err());
    }

    /// A stand-in engine: a shell script (it is also passed as config and model, which only need to exist).
    #[cfg(unix)]
    fn fake(name: &str, body: &str) -> Spec {
        use std::os::unix::fs::PermissionsExt;
        let p = std::env::temp_dir().join(format!("baduk-fake-{name}-{}.sh", std::process::id()));
        std::fs::write(&p, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
        Spec { bin: p.clone(), config: p.clone(), model: p, human: None, cwd: std::env::temp_dir(), overrides: vec![] }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn silent_startup_and_silent_query_time_out() {
        let ms = Duration::from_millis;
        let quiet = |mut e: Arc<Engine>, start| { let m = Arc::get_mut(&mut e).unwrap(); m.query_timeout = ms(200); m.start_timeout = ms(start); e };
        // Never prints the ready line.
        let e = quiet(Engine::new(|_, _| {}), 200);
        e.ensure(fake("mute", "exec cat >/dev/null")).unwrap();
        assert_eq!(e.analyze(json!({"moves": []})).await.unwrap_err(), Failure::with("engine_timeout", "start"));
        assert!(matches!(e.status(), Status::Error { error } if error.code == "engine_timeout"));
        // Ready and warm, then never answers.
        let e = quiet(Engine::new(|_, _| {}), 5000);
        e.ensure(fake("deaf", r#"echo "Started, ready to begin handling requests" >&2
read l; id=$(echo "$l" | sed 's/.*"id":"\([^"]*\)".*/\1/'); echo "{\"id\":\"$id\"}"
exec sleep 5"#)).unwrap();
        assert_eq!(e.analyze(json!({"moves": []})).await.unwrap_err(), Failure::with("engine_timeout", "query"));
        assert!(e.pending.lock().unwrap().is_empty());
    }

    #[cfg(unix)]
    async fn settle() { tokio::time::sleep(std::time::Duration::from_millis(300)).await }

    #[cfg(unix)]
    #[tokio::test]
    async fn failed_relaunch_is_not_overwritten_by_the_old_exit() {
        let e = Engine::new(|_, _| {});
        let s = fake("idle", "exec cat >/dev/null");
        e.ensure(s.clone()).unwrap();
        settle().await;
        let mut bad = s;
        bad.model = "/nonexistent/model.bin.gz".into();
        assert_eq!(e.ensure(bad).unwrap_err().code, "model_missing");
        settle().await; // the killed process's reader has seen EOF by now
        assert!(matches!(e.status(), Status::Error { error } if error.code == "model_missing"));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn crash_reaches_pending_queries_and_warm_up_gates_ready() {
        let statuses = Arc::new(Mutex::new(vec![]));
        let st = statuses.clone();
        let e = Engine::new(move |ev, v| if ev == "engine-status" { st.lock().unwrap().push(v["state"].as_str().unwrap().to_string()) });
        // Ready line, answers the warm-up by id, then dies on the next query.
        e.ensure(fake("crash", r#"echo "Started, ready to begin handling requests" >&2
read l; id=$(echo "$l" | sed 's/.*"id":"\([^"]*\)".*/\1/'); echo "{\"id\":\"$id\"}"
read l; echo "boom" >&2; exit 1"#)).unwrap();
        let err = e.analyze(json!({"moves": []})).await.unwrap_err();
        assert_eq!(err, Failure::with("engine_crashed", "boom"));
        assert_eq!(*statuses.lock().unwrap(), ["starting", "warming", "ready", "error"]);
    }

    /// Ready, then answers every query by id: the shared tail of the scripts below.
    #[cfg(unix)]
    const SERVE: &str = r#"echo "Started, ready to begin handling requests" >&2
while read l; do id=$(echo "$l" | sed 's/.*"id":"\([^"]*\)".*/\1/'); echo "{\"id\":\"$id\"}"; done"#;

    #[test]
    fn tuning_lines() {
        for l in ["Tuning 3/63 Calls/sec 2.2e+04 ErrorProp 0 XGemmDirect", "Tuning xGemm for convolutions", "Testing 63 different configs",
                  "2026-10-11 12:00:00+0200: Performing autotuning", "2026-10-11 12:01:00+0200: Done tuning, saved results to x"] {
            assert!(is_tuning_line(l), "{l}")
        }
        for l in ["Started, ready to begin handling requests", "2026-10-11: Loaded model", "Model tuning info"] { assert!(!is_tuning_line(l), "{l}") }
    }

    /// OpenCL tuning outlasts the start timeout, but each progress line moves the deadline back.
    #[cfg(unix)]
    #[tokio::test]
    async fn tuning_progress_keeps_the_startup_alive() {
        let statuses = Arc::new(Mutex::new(vec![]));
        let st = statuses.clone();
        let mut e = Engine::new(move |ev, v| if ev == "engine-status" { st.lock().unwrap().push(v["state"].as_str().unwrap().to_string()) });
        // 2 s leaves room for the first exec of a fresh script (~0.5 s on macOS, more under load); tuning lasts 3.6 s.
        Arc::get_mut(&mut e).unwrap().start_timeout = Duration::from_secs(2);
        let tune = "echo 'Performing autotuning' >&2; for i in $(seq 12); do sleep 0.3; echo \"Tuning $i/12\" >&2; done";
        e.ensure(fake("tune", &format!("{tune}\n{SERVE}"))).unwrap();
        e.analyze(json!({"moves": []})).await.unwrap();
        assert_eq!(*statuses.lock().unwrap(), ["starting", "tuning", "warming", "ready"]);
        // Tuning that goes quiet still times out.
        let mut e = Engine::new(|_, _| {});
        Arc::get_mut(&mut e).unwrap().start_timeout = Duration::from_millis(300);
        e.ensure(fake("stall", "echo 'Tuning 1/5' >&2; exec cat >/dev/null")).unwrap();
        assert_eq!(e.analyze(json!({"moves": []})).await.unwrap_err(), Failure::with("engine_timeout", "start"));
    }

    /// A build that crashes before Ready is replaced by the fallback's; after Ready a crash is reported as such.
    #[cfg(unix)]
    #[tokio::test]
    async fn early_failures_go_to_the_fallback() {
        let statuses = Arc::new(Mutex::new(vec![]));
        let st = statuses.clone();
        let good = fake("good", SERVE);
        let (bad, g2) = (fake("bad", "echo 'OpenCL error' >&2; exit 1"), good.clone());
        let (calls, readies) = (Arc::new(Mutex::new(vec![])), Arc::new(Mutex::new(vec![])));
        let (c2, r2) = (calls.clone(), readies.clone());
        let e = Engine::new(move |ev, v| if ev == "engine-status" { st.lock().unwrap().push(v["state"].as_str().unwrap().to_string()) })
            .with_fallback(move |s, f| { c2.lock().unwrap().push(f.code); if s.bin == g2.bin { Err(f) } else { Ok(g2.clone()) } })
            .with_on_ready(move |s| r2.lock().unwrap().push(s.bin.clone()));
        e.ensure(bad.clone()).unwrap();
        e.analyze(json!({"moves": []})).await.unwrap();
        assert_eq!(e.running_spec().unwrap().bin, good.bin);
        assert_eq!(*calls.lock().unwrap(), ["engine_crashed"]);
        assert_eq!(*readies.lock().unwrap(), [good.bin.clone()], "only the build that reached Ready is reported");
        assert_eq!(*statuses.lock().unwrap(), ["starting", "starting", "warming", "ready"], "no error shown in between");
        // A missing binary falls back synchronously.
        let mut gone = bad;
        gone.bin = "/nonexistent/katago".into();
        e.ensure(gone).unwrap();
        assert_eq!(e.running_spec().unwrap().bin, good.bin);
        assert_eq!(calls.lock().unwrap().last(), Some(&"engine_missing"));
        // The fallback's own refusal is what gets reported.
        e.stop();
        let mut e2 = fake("bad2", "exit 3");
        e2.model = good.model.clone();
        let r2 = readies.clone();
        let e = Engine::new(|_, _| {}).with_fallback(|_, f| Err(Failure::with("cpu_unsupported", f.code)))
            .with_on_ready(move |s| r2.lock().unwrap().push(s.bin.clone()));
        e.ensure(e2).unwrap();
        assert_eq!(e.analyze(json!({})).await.unwrap_err(), Failure::with("cpu_unsupported", "engine_crashed"));
        assert_eq!(readies.lock().unwrap().len(), 1, "a failed fallback reports no Ready (so nothing is persisted)");
    }

    #[test]
    fn paths_under_the_data_dir_are_passed_relative() {
        let d = PathBuf::from("/Users/김민준/data");
        let models = std::path::Path::new("models");
        let s = Spec {
            bin: d.join("katago"), config: d.join("analysis.cfg"), model: d.join("models").join("kata1-x.bin.gz"),
            human: Some(d.join("models").join("b18c384nbt-humanv0.bin.gz")), cwd: d.clone(), overrides: vec!["homeDataDir=katago".into()],
        };
        let strs = |s: &Spec| args(s).into_iter().map(|a| a.into_string().unwrap()).collect::<Vec<_>>();
        let (m, h) = (models.join("kata1-x.bin.gz"), models.join("b18c384nbt-humanv0.bin.gz"));
        assert_eq!(strs(&s), ["analysis", "-config", "analysis.cfg", "-model", m.to_str().unwrap(), "-human-model", h.to_str().unwrap(),
            "-override-config", "reportAnalysisWinratesAs=BLACK", "-override-config", "homeDataDir=katago"]);
        assert!(strs(&s).iter().all(|a| a.is_ascii()));
        // Dev overrides outside the data dir stay absolute.
        let s = Spec { config: "/opt/katago/analysis.cfg".into(), human: None, overrides: vec![], ..s };
        assert_eq!(strs(&s), ["analysis", "-config", "/opt/katago/analysis.cfg", "-model", m.to_str().unwrap(),
            "-override-config", "reportAnalysisWinratesAs=BLACK"]);
    }

    /// End-to-end protocol check against a real KataGo; writes a midgame position + ownership for UI screenshots.
    /// cargo test --lib -- --ignored --nocapture engine_end_to_end
    #[tokio::test]
    #[ignore]
    async fn engine_end_to_end() {
        let partials = Arc::new(AtomicU64::new(0));
        let statuses = Arc::new(Mutex::new(vec![]));
        let (p2, st) = (partials.clone(), statuses.clone());
        let e = Engine::new(move |ev, v| match ev {
            "engine-partial" => { p2.fetch_add(1, Ordering::Relaxed); }
            _ => st.lock().unwrap().push(v["state"].as_str().unwrap_or_default().to_string()),
        });
        e.ensure(spec()).unwrap();
        assert_eq!(e.status(), Status::Starting);
        e.ensure(spec()).unwrap(); // same spec: no restart
        let t = std::time::Instant::now();

        // Unknown field + invalid query: errors come back by id.
        let err = e.analyze(json!({"rules": "japanese", "boardXSize": 19, "boardYSize": 19})).await.unwrap_err();
        println!("ready after {:?}; error routed: {err:?}", t.elapsed());
        assert_eq!(err.code, "katago_error");
        assert_eq!(*statuses.lock().unwrap(), ["starting", "warming", "ready"]);

        // Warm: the first real queries should not pay the Metal compile (one move, so the warm-up's NN cache cannot answer).
        for n in [19, 9] {
            let t1 = std::time::Instant::now();
            e.analyze(json!({"moves": [["B", "D4"]], "rules": "japanese", "komi": 6.5, "boardXSize": n, "boardYSize": n, "maxVisits": 60,
                "includePolicy": true, "overrideSettings": {"humanSLProfile": "rank_10k"}})).await.unwrap();
            println!("first {n}×{n} query after warm-up: {:?}", t1.elapsed());
        }

        // Self-play 80 moves with the human policy at 8k, then read ownership.
        let mut moves: Vec<[String; 2]> = vec![];
        let cols = "ABCDEFGHJKLMNOPQRST".as_bytes();
        for n in 0..80 {
            let r = e.analyze(json!({
                "moves": moves, "rules": "japanese", "komi": 6.5, "boardXSize": 19, "boardYSize": 19,
                "maxVisits": 40, "includePolicy": true,
                "overrideSettings": {"humanSLProfile": "rank_8k", "ignorePreRootHistory": false},
            })).await.unwrap();
            let hp: Vec<f64> = r["humanPolicy"].as_array().expect("humanPolicy").iter().map(|v| v.as_f64().unwrap()).collect();
            assert_eq!(hp.len(), 362);
            let best = (0..361).max_by(|&a, &b| hp[a].partial_cmp(&hp[b]).unwrap()).unwrap();
            let (x, y) = (best % 19, best / 19);
            moves.push([if n % 2 == 0 { "B" } else { "W" }.into(), format!("{}{}", cols[x] as char, 19 - y)]);
        }
        let r = e.analyze(json!({
            "id": "own", "moves": moves, "rules": "japanese", "komi": 6.5, "boardXSize": 19, "boardYSize": 19,
            "maxVisits": 150, "includeOwnership": true, "reportDuringSearchEvery": 0.05,
        })).await.unwrap();
        assert_eq!(r["id"], "own");
        let own = r["ownership"].as_array().unwrap();
        assert_eq!(own.len(), 361);
        assert!(r["rootInfo"]["scoreLead"].is_f64());
        println!("80 moves in {:?}; scoreLead {}; partial reports {}", t.elapsed(), r["rootInfo"]["scoreLead"], partials.load(Ordering::Relaxed));
        assert_eq!(statuses.lock().unwrap().iter().filter(|s| *s == "starting").count(), 1, "the process stays up between analyses");
        std::fs::write(std::env::temp_dir().join("baduk-midgame.json"), json!({"moves": moves, "ownership": own, "scoreLead": r["rootInfo"]["scoreLead"]}).to_string()).unwrap();

        // Restart on spec change, then stop.
        let mut s = spec();
        s.human = None;
        e.ensure(s).unwrap();
        assert_eq!(e.status(), Status::Starting);
        e.stop();
        assert_eq!(e.status(), Status::Stopped);
        assert!(e.analyze(json!({})).await.is_err());
    }
}
