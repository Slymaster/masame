// Windows, Linux and Intel Mac engine builds (official KataGo zips under resources/katago-win/<variant>/, source builds
// under resources/katago-linux/<variant>/, sidecars Contents/MacOS/katago-<variant> on Intel Macs): which one to launch, and what to try next when one fails before it is ready.
// Pure functions, so the logic is tested on every platform.
#![cfg_attr(not(engine_variants), allow(dead_code))]

use std::path::Path;

pub const OPENCL: &str = "opencl";
/// The CPU build: AVX2 + FMA on Windows and Linux; plain SSE on Intel Macs, so it also runs under Rosetta.
pub const CPU: &str = if cfg!(target_os = "macos") { "eigen" } else { "eigenavx2" };
const VARIANTS: [&str; 2] = [OPENCL, CPU];

/// Variants worth trying, best first: GPU (OpenCL) before CPU, except that the persisted one (the last that reached
/// Ready) leads. The OpenCL build needs the driver's System32\OpenCL.dll (without it the DLL search would go on to
/// the current directory and PATH), the CPU build AVX2 + FMA; empty when neither can run.
pub fn candidates(saved: Option<&str>, opencl_ok: bool, cpu_ok: bool) -> Vec<&'static str> {
    let mut v: Vec<&'static str> = VARIANTS.into_iter().filter(|&x| if x == CPU { cpu_ok } else { opencl_ok }).collect();
    if let Some(i) = v.iter().position(|&x| Some(x) == saved) { let s = v.remove(i); v.insert(0, s) }
    v
}

/// The variant to launch: the first candidate that has not failed in this session; None if there is no candidate.
pub fn pick(cands: &[&'static str], failed: &[&'static str]) -> Option<&'static str> {
    cands.iter().copied().find(|c| !failed.contains(c)).or(cands.first().copied())
}

/// `variant` failed before it was ready: records it and returns the next one to launch, or None when every candidate
/// has failed (the list is then cleared, so a later explicit retry starts over).
pub fn next(cands: &[&'static str], failed: &mut Vec<&'static str>, variant: &'static str) -> Option<&'static str> {
    if !failed.contains(&variant) { failed.push(variant) }
    let n = cands.iter().copied().find(|c| !failed.contains(c));
    if n.is_none() { failed.clear() }
    n
}

/// Failures that another build may not have (missing/broken exe, OpenCL driver crash, hang); not a missing model.
pub fn is_backend_failure(code: &str) -> bool { matches!(code, "engine_missing" | "spawn_failed" | "engine_crashed" | "engine_timeout") }

/// A build reached Ready: the variant to persist, if it is a bundled one other than the saved choice. Only then, so a
/// crash that is not the build's fault (bad model or config) never replaces a working preference.
pub fn to_persist(saved: Option<&str>, ready_bin: &Path) -> Option<&'static str> { variant_of(ready_bin).filter(|&v| Some(v) != saved) }

/// Which bundled variant a binary is (its folder name, or a macOS sidecar's katago-<variant>), if any.
pub fn variant_of(bin: &Path) -> Option<&'static str> {
    let dir = bin.parent()?.file_name()?;
    let name = bin.file_name()?.to_str()?;
    VARIANTS.into_iter().find(|v| dir == std::ffi::OsStr::new(v) || name.strip_prefix("katago-") == Some(v))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn order_prefers_gpu_then_the_persisted_variant() {
        assert_eq!(candidates(None, true, true), [OPENCL, CPU]);
        assert_eq!(candidates(Some(CPU), true, true), [CPU, OPENCL]);
        assert_eq!(candidates(Some("bogus"), true, true), [OPENCL, CPU]);
        assert_eq!(candidates(None, true, false), [OPENCL], "no AVX2/FMA: no CPU build");
        assert_eq!(candidates(Some(CPU), true, false), [OPENCL]);
    }

    #[test]
    fn no_opencl_driver_means_no_opencl_build() {
        assert_eq!(candidates(None, false, true), [CPU]);
        assert_eq!(candidates(Some(OPENCL), false, true), [CPU], "a saved OpenCL choice does not bring it back");
        assert!(candidates(None, false, false).is_empty());
        assert_eq!(pick(&[], &[]), None);
        assert_eq!(next(&[CPU], &mut vec![], CPU), None);
    }

    #[test]
    fn only_a_ready_bundled_build_is_persisted() {
        let bin = |v: &str| Path::new("res").join(v).join("katago.exe");
        assert_eq!(to_persist(None, &bin(CPU)), Some(CPU));
        assert_eq!(to_persist(Some(OPENCL), &bin(CPU)), Some(CPU));
        assert_eq!(to_persist(Some(CPU), &bin(CPU)), None, "already saved");
        assert_eq!(to_persist(None, &bin(OPENCL)), Some(OPENCL));
        assert_eq!(to_persist(Some(CPU), Path::new("/dev/katago")), None, "a dev override is never persisted");
    }

    #[test]
    fn fallback_walks_the_list_once_then_starts_over() {
        let c = candidates(None, true, true);
        let mut failed = vec![];
        assert_eq!(pick(&c, &failed), Some(OPENCL));
        assert_eq!(next(&c, &mut failed, OPENCL), Some(CPU));
        assert_eq!(pick(&c, &failed), Some(CPU));
        assert_eq!(next(&c, &mut failed, CPU), None);
        assert!(failed.is_empty(), "cleared after a full round");
        assert_eq!(pick(&c, &failed), Some(OPENCL));
        // Without AVX2, an OpenCL failure leaves nothing to try.
        let c = candidates(None, true, false);
        assert_eq!(next(&c, &mut failed, OPENCL), None);
        // The persisted CPU build failing falls back to OpenCL.
        let c = candidates(Some(CPU), true, true);
        assert_eq!(next(&c, &mut vec![], CPU), Some(OPENCL));
    }

    #[test]
    fn only_engine_failures_fall_back() {
        for c in ["engine_missing", "spawn_failed", "engine_crashed", "engine_timeout"] { assert!(is_backend_failure(c)) }
        for c in ["model_missing", "config_missing", "no_analysis_net", "katago_error"] { assert!(!is_backend_failure(c)) }
    }

    #[test]
    fn variant_from_path() {
        let p = Path::new("resources").join("katago-win").join(OPENCL).join("katago.exe");
        assert_eq!(variant_of(&p), Some(OPENCL));
        assert_eq!(variant_of(&Path::new("resources").join("katago-linux").join(OPENCL).join("katago")), Some(OPENCL));
        assert_eq!(variant_of(&Path::new("x").join(CPU).join("katago.exe")), Some(CPU));
        assert_eq!(variant_of(Path::new("/usr/bin/katago")), None);
        assert_eq!(variant_of(Path::new("katago")), None);
        assert_eq!(variant_of(Path::new("Masame.app/Contents/MacOS/katago-opencl")), Some(OPENCL), "Intel Mac sidecar");
        assert_eq!(variant_of(&Path::new("Masame.app/Contents/MacOS").join(format!("katago-{CPU}"))), Some(CPU));
        assert_eq!(variant_of(Path::new("Masame.app/Contents/MacOS/katago-metal")), None);
    }
}
