// Tauri's mobile IDE bridge forwards TAURI* variables, not arbitrary app variables. Both names refer to the same
// public build setting; aliases carry it into Xcode's second Cargo invocation. They never contain a token or password.
pub fn forwarded_name(name: &str) -> String {
    if name == "CI" { "TAURI_ENV_MASAME_OGS_CI".into() } else { format!("TAURI_ENV_{name}") }
}

pub fn value(read: impl Fn(&str) -> Option<String>, name: &str) -> Option<String> {
    read(name).filter(|v| !v.is_empty()).or_else(|| read(&forwarded_name(name)).filter(|v| !v.is_empty()))
}

pub fn compile_only(read: impl Fn(&str) -> Option<String>) -> Result<bool, &'static str> {
    if value(&read, "MASAME_OGS_COMPILE_ONLY").as_deref() != Some("1") { return Ok(false) }
    if value(&read, "CI").as_deref() != Some("true") { return Err("Compile-only OGS mode requires an explicit CI=true signal") }
    if read("PROFILE").as_deref() != Some("debug") { return Err("Compile-only OGS mode cannot produce release builds") }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn environment<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |name| pairs.iter().find(|(key, _)| *key == name).map(|(_, value)| (*value).into())
    }
    #[test]
    fn xcode_aliases_preserve_explicit_ci_debug_signals() {
        let vars = environment(&[("TAURI_ENV_MASAME_OGS_COMPILE_ONLY", "1"), ("TAURI_ENV_MASAME_OGS_CI", "true"), ("PROFILE", "debug")]);
        assert_eq!(compile_only(vars), Ok(true));
    }
    #[test]
    fn missing_callback_or_ci_does_not_implicitly_enable_the_fixture() {
        assert_eq!(compile_only(environment(&[("PROFILE", "debug")])), Ok(false));
        assert_eq!(compile_only(environment(&[("MASAME_OGS_COMPILE_ONLY", "0"), ("TAURI_ENV_MASAME_OGS_COMPILE_ONLY", "1"), ("TAURI_ENV_MASAME_OGS_CI", "true"), ("PROFILE", "debug")])), Ok(false));
        assert!(compile_only(environment(&[("TAURI_ENV_MASAME_OGS_COMPILE_ONLY", "1"), ("CI", "false"), ("TAURI_ENV_MASAME_OGS_CI", "true"), ("PROFILE", "debug")])).is_err());
        assert!(compile_only(environment(&[("TAURI_ENV_MASAME_OGS_COMPILE_ONLY", "1"), ("PROFILE", "debug")])).is_err());
        assert!(compile_only(environment(&[("MASAME_OGS_COMPILE_ONLY", "1"), ("CI", "false"), ("PROFILE", "debug")])).is_err());
    }
    #[test]
    fn release_profile_never_accepts_compile_only_mode() {
        for profile in ["release", ""] {
            assert!(compile_only(environment(&[("TAURI_ENV_MASAME_OGS_COMPILE_ONLY", "1"), ("TAURI_ENV_MASAME_OGS_CI", "true"), ("PROFILE", profile)])).is_err());
        }
    }
    #[test]
    fn public_callback_and_registration_survive_the_ide_bridge() {
        let vars = environment(&[("TAURI_ENV_MASAME_OGS_CALLBACK_URL", "https://owned.example/oauth/ogs/callback"), ("TAURI_ENV_MASAME_OGS_OAUTH_REGISTERED", "1")]);
        assert_eq!(value(&vars, "MASAME_OGS_CALLBACK_URL").as_deref(), Some("https://owned.example/oauth/ogs/callback"));
        assert_eq!(value(&vars, "MASAME_OGS_OAUTH_REGISTERED").as_deref(), Some("1"));
        assert_eq!(compile_only(vars), Ok(false));
    }
}
