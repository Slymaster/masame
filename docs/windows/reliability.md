# Windows reliability and bug reports

The Windows installer and application currently have no Authenticode signature. Updater packages use a separate,
mandatory minisign signature. Neither that signature nor a passing installation test proves that an antivirus will
accept the files. Keep antivirus protection enabled.

## Diagnosing a failure to open

The application writes `%LOCALAPPDATA%\com.sylvainrey.masame\startup.log` before constructing the Tauri application.
Its previous portion is `startup.log.1`. Each file is limited to 256 KiB, individual messages are truncated, and no
arguments, settings, tokens or panic payloads are logged. The log records the app version, architecture, process ID,
startup stages, resource errors and updater handoff. Error details may contain local paths: inspect before sharing.
If `LOCALAPPDATA` is absent, the log is under the temporary directory and the same identifier.

A Tauri construction error shows a native error dialog with the log location. A panic records its source location.
An error in the Windows loader before Rust's `main` cannot create a log. In that case, collect the relevant Windows
Event Viewer > Windows Logs > Application event (faulting application/module, exception code and time).

For an antivirus quarantine, collect the detection name, exact file path, file SHA256, antivirus/product version,
Windows version, and whether installation was fresh or an in-app update (with the previous Masame version). Do not
clear the app data or restore quarantined code merely to obtain a log. `engine.log` in the same folder records engine
lifecycle and stderr when the app gets that far. An existing engine log alone does not explain a pre-interface crash.
No file is sent automatically to an antivirus vendor.

## Automated Windows checks

The **Windows reliability** workflow runs on a disposable GitHub-hosted `windows-latest` VM with no release secrets.
It installs a production-configured NSIS package in a temporary directory and drives the installed executable through
`tauri-driver` 2.0.6 and an Edge WebDriver matching the WebView2 runtime. The harness uses Python's standard library.
It launches the unchanged installed executable with a test-process-only loopback debugging port, then uses
Microsoft's documented WebView2 **attach** mode through tauri-driver. This avoids the current Evergreen
DevToolsActivePort launch-discovery problem without downgrading WebView2 or modifying the production app.
The workflow runs the complete harness with a true filtered token from `CreateRestrictedToken(LUA_TOKEN)` and
explicit Medium integrity. WebView2 150+ deliberately ignores debugging overrides from elevated hosts. On the
recorded hosted runner, gsudo's restricted token had `IsUserAnAdmin=false` but `TokenElevation=1`, causing the
updater's NSIS plugin to take its elevated path and fail even for `cmd.exe /c exit 0`. An autonomous probe on the
same VM established that a true LUA token reports `TokenElevation=0` and the same plugin launch succeeds.
The launcher verifies both TokenElevation and the Medium integrity RID before launching the harness. The harness
checks its own token again. The new token's default DACL grants access to the current user SID and LocalSystem,
so new pipes and process handles remain usable after the administrator group is filtered. This changes only that
private token's defaults, not existing object permissions. The existing account, session and desktop are retained,
with no UAC policy or desktop ACL changes. Workspace access is granted only to that same account. Browser policies and antivirus settings are unchanged.
Before running the app, a lightweight preflight verifies real stdout/stderr pipes, reopening the child's own process
with query/duplicate-handle access, and exact propagation of a failing child exit code.
It fails if WebView2, the debugging endpoint, the driver or the usable WebDriver session is unavailable. A PID or a page load is insufficient:
an actual WebDriver click must change a React control and native IPC must respond.

It checks same-version reinstallation, browser storage and model data retention, missing engine executables, missing runtime DLLs and a
missing bundled config. The original resources are restored after fault injection. It then builds two test versions
(`0.7.900` and `0.7.901`) with a separate identifier (`com.sylvainrey.masame.windows-reliability`), product name, a
loopback-only updater endpoint and an ephemeral signing key. That key is never printed or uploaded and is deleted
before installation. HTTP transport is enabled only by those temporary build configurations. The production config,
production key and public `latest.json` are never changed.

The updater tests reject a tampered package and interrupted response without replacing the executable or stopping
the engine. The updater tests use the official bundled CPU KataGo and the production-pinned Compact network
(14,466,254 bytes), downloaded from its official host and verified by SHA256 and size. KataGo must reach Ready and
return a real analysis through native IPC before updating, and do so again in the new version. A Win32 process
handle observer proves the exact installed CPU engine exits while the old application is still installed and before
the new version launches. The installer must automatically restart the app, native IPC and React must work, and the
verified model and browser storage must survive. Small protocol fixtures remain only in the core process tests.
This covers CPU inference and process/resource lifecycle, not GPU compatibility or Avira.

The isolated test installers use the same unmodified default NSIS template as the production installer. No hook or
diagnostic replacement performs a launch.
If that restart is absent, the harness collects the relevant installer/application processes and window texts, then
manually launches the installed version to check its version, retained data and real CPU inference. That diagnostic
manual launch cannot pass the suite: missing automatic restart is still raised as a failure and `complete` stays false.

Commands on a disposable GitHub-hosted Windows runner, after the normal pnpm/Rust setup:

```powershell
pnpm install --frozen-lockfile
cargo test --locked --manifest-path scripts/engine-tests/Cargo.toml
python -m unittest discover -s scripts/windows -p test_*.py -v
./scripts/fetch-windows-engine.ps1
cargo install tauri-driver --version 2.0.6 --locked
pnpm tauri build --ci --bundles nsis
# Use the same-account workspace ACL preparation from the workflow, then launch with its filtered-token wrapper:
python scripts/windows/launch_user_token.py --evidence windows-evidence/token.json -- pwsh -NoProfile -File ./scripts/test-windows-install.ps1
```

The installation harness deliberately refuses other machines and existing production/test profiles. It changes user
registry installation entries and file associations on the disposable VM. Never run it against a developer's account.
The CI retains screenshots, driver logs, startup/engine logs and JSON results for seven days, excluding packages,
profiles and signing material. `result.json.complete` is true only after the entire suite succeeds.

Core engine and logger tests also run on Linux without GTK/WebKit:

```sh
cargo test --locked --manifest-path scripts/engine-tests/Cargo.toml
python3 -m unittest discover -s scripts/windows -p 'test_*.py' -v
```

## What a passing job establishes

A passing job establishes installation, WebView2 interaction, failure handling and updater behavior on the exact
runner image recorded in `platform.json`. It does not reproduce Avira, SmartScreen reputation, consumer Windows
10/11, real OpenCL drivers or accessibility/native dialogs. Tests involving physical input, native desktop UI, UAC or
SmartScreen require a suitable logged-in interactive session. A Windows service in session 0 is not that session.
The harness does not disable protection, grant desktop access to a service or treat a missing UI test as a pass.

An Avira-specific fix requires the original detection or a real reproduction. Until then, report the limited result:
"NSIS installation and application interaction passed on the recorded Windows CI image. Avira not validated."

References checked 2026-11-12:

- [Tauri WebDriver CI on Windows](https://v2.tauri.app/develop/tests/webdriver/ci/)
- [Microsoft WebView2 WebDriver](https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/webdriver)
- [Tauri's unelevated Windows E2E workflow](https://github.com/tauri-apps/tauri/blob/dev/.github/workflows/test-api-e2e.yml)
- [Microsoft's explanation of elevated-host debug hardening](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5645)
- [Token/plugin probe on the same hosted VM](https://github.com/Slymaster/masame/actions/runs/43179169252)
- [Token pipe/process access probe](https://github.com/Slymaster/masame/actions/runs/43181166958)
- [Microsoft CreateRestrictedToken](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-createrestrictedtoken)
- [Windows services and interactive sessions](https://learn.microsoft.com/en-us/windows/desktop/Services/interactive-services)
- [Windows signing preparation](signpath-preparation.md)
