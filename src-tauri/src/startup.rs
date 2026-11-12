//! Windows startup diagnostics. Synchronous, small writes survive an early startup error. No arguments, URLs,
//! settings, environment dumps or credentials are recorded. Keep two bounded files, including across launches.
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

const LIMIT: u64 = 256 * 1024;
const LINE_LIMIT: usize = 4096;
static LOG: OnceLock<Mutex<Log>> = OnceLock::new();

struct Log { path: PathBuf }

impl Log {
    fn append(&self, message: &str) -> io::Result<()> {
        if let Some(parent) = self.path.parent() { fs::create_dir_all(parent)?; }
        let message: String = message.chars().take(LINE_LIMIT / 4).map(|c| if c.is_control() { ' ' } else { c }).collect();
        let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
        let line = format!("{}.{:03}Z {message}\n", timestamp.as_secs(), timestamp.subsec_millis());
        if fs::metadata(&self.path).map_or(0, |m| m.len()) + line.len() as u64 > LIMIT {
            let old = self.path.with_extension("log.1");
            // Windows rename does not replace an existing destination. If removal/rotation fails, fail closed:
            // do not append indefinitely to the full file, and do not prevent the app itself from opening.
            if old.exists() { fs::remove_file(&old)?; }
            fs::rename(&self.path, old)?;
        }
        let mut file = OpenOptions::new().create(true).append(true).open(&self.path)?;
        file.write_all(line.as_bytes())?;
        file.flush()
    }
}

pub fn record(message: &str) {
    if let Some(log) = LOG.get() {
        let _ = log.lock().unwrap_or_else(std::sync::PoisonError::into_inner).append(message);
    }
}

/// Uses Tauri's effective identifier, including an isolated test build's identifier. Falls back to TEMP when the
/// local data environment is unavailable. Errors opening the log never prevent startup.
pub fn init(identifier: &str, version: &str) {
    let root = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    let _ = LOG.set(Mutex::new(Log { path: root.join(identifier).join("startup.log") }));
    record(&format!("launch Masame {version}; {} {}; pid {}", std::env::consts::OS, std::env::consts::ARCH, std::process::id()));
    std::panic::set_hook(Box::new(|info| {
        // Panic payloads can contain user data. Record the source location only, not the payload or a backtrace.
        record(&format!("panic at {}", info.location().map(|p| p.to_string()).unwrap_or_default()));
    }));
}

pub fn fatal(error: &str) {
    record(&format!("startup failed: {error}"));
    let path = LOG.get().map(|l| l.lock().unwrap_or_else(std::sync::PoisonError::into_inner).path.clone());
    let text = format!("Masame could not start.\n\n{error}\n\nStartup log: {}\nInclude this log and Windows Event Viewer details in a bug report.\nDo not disable your antivirus.", path.as_deref().unwrap_or(Path::new("startup.log")).display());
    #[cfg(windows)]
    unsafe {
        use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};
        let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
        MessageBoxW(std::ptr::null_mut(), wide(&text).as_ptr(), wide("Masame").as_ptr(), MB_OK | MB_ICONERROR);
    }
    #[cfg(not(windows))]
    eprintln!("{text}");
}

#[cfg(test)]
mod tests {
    use super::*;
    static ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    fn path() -> PathBuf {
        std::env::temp_dir().join(format!("masame-startup-{}-{}", std::process::id(), ID.fetch_add(1, std::sync::atomic::Ordering::SeqCst))).join("startup.log")
    }
    #[test]
    fn rotates_and_bounds_both_files_even_with_long_unicode_messages() {
        let path = path();
        let log = Log { path: path.clone() };
        for i in 0..300 { log.append(&format!("{i} {}\ncontrol", "界".repeat(10000))).unwrap(); }
        for p in [&path, &path.with_extension("log.1")] {
            let text = fs::read_to_string(p).unwrap();
            assert!(text.len() as u64 <= LIMIT);
            assert!(text.lines().all(|l| l.len() <= LINE_LIMIT + 64));
            assert!(!text.contains('\0'));
        }
        assert!(fs::read_to_string(&path).unwrap().contains("299 "));
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
    #[test]
    fn unavailable_directory_is_an_error_without_panicking() {
        let path = path();
        fs::write(path.parent().unwrap(), b"not a directory").unwrap();
        assert!(Log { path: path.clone() }.append("launch").is_err());
        fs::remove_file(path.parent().unwrap()).unwrap();
    }
}
