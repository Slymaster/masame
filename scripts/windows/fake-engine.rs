// Test installation only. Compiled with rustc by test-windows-install.ps1's harness; never bundled in a release.
// Implements enough of KataGo's JSON-lines protocol to hold a real Windows executable open during an update.
use std::io::{self, BufRead, Write};
fn main() {
    std::fs::write("fake-engine.pid", std::process::id().to_string()).unwrap();
    eprintln!("Started, ready to begin handling requests");
    for line in io::stdin().lock().lines() {
        let line = line.unwrap();
        if let Some(id) = line.split("\"id\":\"").nth(1).and_then(|s| s.split('"').next()) {
            println!("{{\"id\":\"{id}\",\"moveInfos\":[],\"rootInfo\":{{}}}}");
            io::stdout().flush().unwrap();
        }
    }
}
