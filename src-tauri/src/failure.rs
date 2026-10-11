// Errors cross to the webview as a stable code plus optional technical detail; the frontend owns the wording
// (src/strings.ts), so Rust never produces user-facing text.

use serde::Serialize;

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct Failure {
    pub code: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

impl Failure {
    pub fn new(code: &'static str) -> Self { Self { code, detail: None } }
    pub fn with(code: &'static str, detail: impl ToString) -> Self { Self { code, detail: Some(detail.to_string()) } }
}

pub type Res<T> = Result<T, Failure>;
