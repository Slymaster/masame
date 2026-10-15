// iOS forbids child processes, so KataGo runs on a thread of the app (katago_ios_run, scripts/ios/katago_shim.cpp).
// This is the part of tokio::process that engine.rs uses, with socket pairs for stdin/stdout/stderr: engine.rs speaks
// to it exactly as to a process. Closing stdin ends the run (KataGo is started with -quit-without-waiting).

#![cfg_attr(not(target_os = "ios"), allow(dead_code))] // elsewhere only its test runs it

use std::ffi::{c_char, c_int, CString, OsStr, OsString};
use std::io;
use std::os::fd::{AsRawFd, OwnedFd};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::net::UnixStream as StdStream;
use std::os::unix::process::ExitStatusExt;
use std::path::{Path, PathBuf};
use std::process::{ExitStatus, Stdio};
use std::sync::{Arc, Mutex};
use tokio::net::UnixStream;

#[cfg(target_os = "ios")]
extern "C" {
    fn katago_ios_run(argc: c_int, argv: *const *const c_char, in_fd: c_int, out_fd: c_int, err_fd: c_int) -> c_int;
}
#[cfg(not(target_os = "ios"))]
use tests::fake_run as katago_ios_run;

/// Present while KataGo starts (spawn) until it is ready or stopped: still there at the next launch means the app died
/// while KataGo was starting (e.g. a fatal error or a memory kill), relative to the engine's working directory.
pub const SENTINEL: &str = "engine-starting";

pub struct Command { args: Vec<OsString>, cwd: Option<PathBuf> }

impl Command {
    pub fn new(_program: impl AsRef<OsStr>) -> Self { Self { args: vec![], cwd: None } }
    pub fn args<I: IntoIterator<Item = S>, S: AsRef<OsStr>>(&mut self, a: I) -> &mut Self {
        self.args.extend(a.into_iter().map(|s| s.as_ref().to_owned()));
        self
    }
    pub fn current_dir(&mut self, d: impl AsRef<Path>) -> &mut Self { self.cwd = Some(d.as_ref().into()); self }
    // Always piped, always stopped on drop.
    pub fn stdin(&mut self, _: Stdio) -> &mut Self { self }
    pub fn stdout(&mut self, _: Stdio) -> &mut Self { self }
    pub fn stderr(&mut self, _: Stdio) -> &mut Self { self }
    pub fn kill_on_drop(&mut self, _: bool) -> &mut Self { self }

    pub fn spawn(&mut self) -> io::Result<Child> {
        // The working directory is the process's: engine.rs passes paths relative to it, and nothing else in the app uses it.
        if let Some(d) = &self.cwd {
            std::env::set_current_dir(d)?;
            std::fs::write(d.join(SENTINEL), b"")?;
        }
        let argv: Vec<CString> = std::iter::once(OsStr::new("katago")).chain(self.args.iter().map(OsString::as_os_str))
            .chain([OsStr::new("-quit-without-waiting")])
            .map(|a| CString::new(a.as_bytes()).map_err(|e| io::Error::new(io::ErrorKind::InvalidInput, e)))
            .collect::<io::Result<_>>()?;
        let (stdin, k_in) = StdStream::pair()?;
        let (stdout, k_out) = StdStream::pair()?;
        let (stderr, k_err) = StdStream::pair()?;
        let kill = stdin.try_clone()?;
        let status = Arc::new(Mutex::new(None));
        let st = status.clone();
        std::thread::Builder::new().name("katago".into()).stack_size(8 << 20).spawn(move || {
            let ptrs: Vec<*const c_char> = argv.iter().map(|a| a.as_ptr()).collect();
            let fds: [OwnedFd; 3] = [k_in.into(), k_out.into(), k_err.into()];
            let rc = unsafe { katago_ios_run(ptrs.len() as c_int, ptrs.as_ptr(), fds[0].as_raw_fd(), fds[1].as_raw_fd(), fds[2].as_raw_fd()) };
            *st.lock().unwrap() = Some(ExitStatus::from_raw((rc & 0xff) << 8));
            drop(fds); // after the status: the stdout reader asks for it once it sees EOF
        })?;
        let tokio = |s: StdStream| { s.set_nonblocking(true)?; UnixStream::from_std(s) };
        Ok(Child { stdin: Some(tokio(stdin)?), stdout: Some(tokio(stdout)?), stderr: Some(tokio(stderr)?), kill, status, cwd: self.cwd.clone() })
    }
}

pub struct Child {
    pub stdin: Option<UnixStream>,
    pub stdout: Option<UnixStream>,
    pub stderr: Option<UnixStream>,
    kill: StdStream, // a second handle on stdin's socket, so it can be closed while the writer task holds the first
    status: Arc<Mutex<Option<ExitStatus>>>,
    cwd: Option<PathBuf>,
}

impl Child {
    /// Ends the run: KataGo sees EOF on stdin and returns within a few hundredths of a second.
    pub fn start_kill(&mut self) -> io::Result<()> {
        if let Some(d) = &self.cwd { let _ = std::fs::remove_file(d.join(SENTINEL)); } // a stop is not a crash
        match self.kill.shutdown(std::net::Shutdown::Write) {
            Err(e) if e.kind() == io::ErrorKind::NotConnected => Ok(()), // already ended
            r => r,
        }
    }

    pub fn try_wait(&mut self) -> io::Result<Option<ExitStatus>> { Ok(*self.status.lock().unwrap()) }
}

impl Drop for Child {
    fn drop(&mut self) { let _ = self.start_kill(); }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Write};
    use std::os::fd::BorrowedFd;

    /// Stand-in for KataGo: checks its argv, says ready on stderr, echoes each stdin line to stdout until EOF; exits 3.
    pub unsafe extern "C" fn fake_run(argc: c_int, argv: *const *const c_char, i: c_int, o: c_int, e: c_int) -> c_int {
        let args: Vec<String> = (0..argc as usize).map(|k| std::ffi::CStr::from_ptr(*argv.add(k)).to_string_lossy().into()).collect();
        assert_eq!((args[0].as_str(), args[args.len() - 1].as_str()), ("katago", "-quit-without-waiting"));
        // Copies: the caller owns the descriptors and closes them.
        let file = |fd| std::fs::File::from(BorrowedFd::borrow_raw(fd).try_clone_to_owned().unwrap());
        let (input, mut out, mut err) = (file(i), file(o), file(e));
        writeln!(err, "Started, ready to begin handling requests").unwrap();
        for l in BufReader::new(input).lines() { writeln!(out, "{}", l.unwrap()).unwrap() }
        3
    }

    #[tokio::test]
    async fn runs_like_a_process_and_ends_on_kill() {
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt};
        let dir = std::env::temp_dir(); // spawn makes it the process's working directory: one that outlives every test
        let mut c = Command::new("katago");
        c.args(["analysis", "-config", "x.cfg"]).current_dir(&dir);
        let mut child = c.spawn().unwrap();
        assert!(dir.join(SENTINEL).is_file());
        let (mut stdin, stdout, stderr) = (child.stdin.take().unwrap(), child.stdout.take().unwrap(), child.stderr.take().unwrap());
        let mut err = tokio::io::BufReader::new(stderr).lines();
        assert_eq!(err.next_line().await.unwrap().unwrap(), "Started, ready to begin handling requests");
        stdin.write_all(b"{\"id\":\"a\"}\n").await.unwrap();
        let mut out = tokio::io::BufReader::new(stdout).lines();
        assert_eq!(out.next_line().await.unwrap().unwrap(), "{\"id\":\"a\"}");
        assert_eq!(child.try_wait().unwrap(), None);
        child.start_kill().unwrap(); // the writer still holds stdin: the kill must end the run anyway
        assert_eq!(out.next_line().await.unwrap(), None);
        assert_eq!(child.try_wait().unwrap().unwrap().code(), Some(3));
        assert!(!dir.join(SENTINEL).exists());
        drop(stdin);
    }
}
