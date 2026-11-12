"""Real NSIS + installed WebView2 tests. Standard library only; all mutations confined to a disposable CI VM.

Production installer smoke first, then two build-time isolated identifiers/versions and an ephemeral updater key.
The loopback server is private to this process and never changes the public latest.json or contacts an AV vendor.
"""
import argparse
import base64
import contextlib
import ctypes
import hashlib
import http.client
import http.server
import json
import ntpath
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import zipfile
from launch_user_token import current_token_elevation

ROOT = Path(__file__).resolve().parents[2]
TEST_ID = "com.sylvainrey.masame.windows-reliability"
VERSION_A, VERSION_B = "0.7.900", "0.7.901"
ELEMENT = "element-6066-11e4-a52e-4f735466cecf"
# Same pinned compact network as networks.rs, fetched from its official host (14 MB, not a large default net).
COMPACT_NAME = "kata1-b10c128-s1141046784-d204142634"
COMPACT_BYTES = 14_466_254
COMPACT_SHA256 = "3d8a24697ba25fe4da39af4c2b6bd405907b0ad8295322f5a550fa2d8fe4a2f4"
COMPACT_URL = f"https://media.katagotraining.org/uploaded/networks/models/kata1/{COMPACT_NAME}.txt.gz"


def run(args, **kwargs):
    # Use the resolved .cmd executable on Windows without constructing a shell command containing user data.
    args = [str(a) for a in args]
    args[0] = shutil.which(args[0]) or args[0]
    return subprocess.run(args, cwd=ROOT, check=True, timeout=1200, **kwargs)


def eventually(action, timeout=45):
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        try:
            result = action()
            if result:
                return result
        except (OSError, ValueError, RuntimeError) as error:
            last = error
        time.sleep(0.25)
    raise AssertionError(f"Timed out after {timeout}s: {last or action}")


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def http_json(method, url, payload=None, timeout=90):
    data = None if payload is None else json.dumps(payload).encode()
    request = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"WebDriver {error.code}: {error.read().decode(errors='replace')}") from error
    value = result.get("value")
    # W3C errors have a string error name. An application IPC reply can legitimately contain an error object
    # with ok=false; return that payload so fault-injection assertions can inspect the application's own code.
    if isinstance(value, dict) and isinstance(value.get("error"), str) and "ok" not in value:
        raise RuntimeError(f"WebDriver: {value}")
    return value


class Browser:
    def __init__(self, exe, native_driver, evidence, label):
        self.exe, self.native_driver, self.evidence, self.label = exe, native_driver, evidence, label
        self.base = "http://127.0.0.1:4444"
        self.session = None

    def __enter__(self):
        self.log = (self.evidence / f"{self.label}-driver.log").open("w", encoding="utf-8")
        self.driver = subprocess.Popen([shutil.which("tauri-driver"), "--native-driver", str(self.native_driver)],
                                       stdout=self.log, stderr=subprocess.STDOUT)
        try:
            eventually(lambda: http_json("GET", self.base + "/status"), timeout=20)
            # Current Evergreen WebView2 can fail EdgeDriver's launch discovery (DevToolsActivePort).
            # Microsoft's documented attach mode exercises the same installed executable without changing it.
            with socket.socket() as reservation:
                reservation.bind(("127.0.0.1", 0))
                debug_port = reservation.getsockname()[1]
            env = {**os.environ, "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS":
                   f"--remote-debugging-port={debug_port} --remote-debugging-address=127.0.0.1"}
            self.application = subprocess.Popen([str(self.exe)], env=env)
            def debug_ready():
                with urllib.request.urlopen(f"http://127.0.0.1:{debug_port}/json/version", timeout=2) as response:
                    return json.load(response).get("webSocketDebuggerUrl")
            eventually(debug_ready, timeout=45)
            value = http_json("POST", self.base + "/session", {"capabilities": {"alwaysMatch": {
                "browserName": "webview2", "ms:edgeChromium": True,
                "ms:edgeOptions": {"debuggerAddress": f"127.0.0.1:{debug_port}"},
            }}})
            self.session = value["sessionId"]
            self.url = self.base + "/session/" + self.session
            self.command("POST", "/timeouts", {"script": 90000, "pageLoad": 60000, "implicit": 0})
            eventually(lambda: self.js("return !!document.querySelector('#root button') && !!window.__TAURI_INTERNALS__;"))
            return self
        except BaseException:
            self.__exit__(*sys.exc_info())
            raise

    def command(self, method, endpoint, payload=None):
        return http_json(method, self.url + endpoint, payload)

    def js(self, script, *args):
        return self.command("POST", "/execute/sync", {"script": script, "args": list(args)})

    def invoke(self, command, args=None):
        return self.command("POST", "/execute/async", {
            "script": "const done = arguments[arguments.length-1]; window.__TAURI_INTERNALS__.invoke(arguments[0],arguments[1]).then(value=>done({ok:true,value}),error=>done({ok:false,error}));",
            "args": [command, args or {}],
        })

    def click(self, selector):
        element = self.command("POST", "/element", {"using": "css selector", "value": selector})[ELEMENT]
        self.command("POST", f"/element/{element}/click", {})

    def interactive(self, version=None, expected_marker=None):
        # Actual WebDriver click, React state change and a native IPC response, not a PID or page-load assertion.
        selector = "button[aria-pressed][aria-label]"
        before = self.js("const b=document.querySelector(arguments[0]); return b && b.getAttribute('aria-pressed');", selector)
        if before not in ("true", "false"):
            raise AssertionError("No interactive React toggle in the installed WebView")
        self.click(selector)
        eventually(lambda: self.js("return document.querySelector(arguments[0]).getAttribute('aria-pressed')", selector) != before)
        state = self.invoke("engine_status")
        assert state["ok"], state
        if version:
            assert self.invoke("plugin:app|version") == {"ok": True, "value": version}
        if expected_marker is not None:
            assert self.js("return localStorage.getItem('masame-ci-persist')") == expected_marker
        self.screenshot()
        return state

    def screenshot(self):
        encoded = self.command("GET", "/screenshot")
        (self.evidence / f"{self.label}.png").write_bytes(base64.b64decode(encoded))

    def __exit__(self, exc_type, exc, tb):
        close_error = None
        if self.session:
            with contextlib.suppress(Exception):
                self.screenshot()
            # Native close request exercises the app's real flush-on-close path. No additional app permissions.
            try:
                close_installed(self.exe)
            except Exception as error:
                close_error = error

            with contextlib.suppress(Exception):
                self.command("DELETE", "")
        # Terminating a Windows parent alone does not reap its native-driver child. Scope cleanup to the
        # downloaded executable's unique temporary path so the next session can bind its native port.
        stop_installed(self.native_driver)
        self.driver.terminate()
        with contextlib.suppress(subprocess.TimeoutExpired):
            self.driver.wait(timeout=10)
        if self.driver.poll() is None:
            self.driver.kill()
            self.driver.wait()
        self.log.close()
        stop_installed(self.exe)
        if hasattr(self, "application"):
            self.application.wait(timeout=10)
        if close_error is not None and exc_type is None:
            raise close_error


def close_installed(exe):
    script = "$target=$env:MASAME_CI_EXE; Get-Process | Where-Object { $_.Path -eq $target } | ForEach-Object { if (-not $_.CloseMainWindow()) { throw 'No closeable native window' }; if (-not $_.WaitForExit(10000)) { throw 'App did not flush and close' } }"
    run(["powershell", "-NoProfile", "-Command", script], stdout=subprocess.DEVNULL,
        env={**os.environ, "MASAME_CI_EXE": str(exe.resolve())})


def stop_installed(exe):
    # Never kill by process name: scope cleanup to the executable installed by this test only.
    script = "$target=$env:MASAME_CI_EXE; Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $target } | ForEach-Object { $p=Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; if ($p) { $p.Kill(); $p.WaitForExit(10000) | Out-Null } }"
    run(["powershell", "-NoProfile", "-Command", script], stdout=subprocess.DEVNULL,
        env={**os.environ, "MASAME_CI_EXE": str(exe.resolve())})


def install(installer, destination):
    # NSIS /D= must be the last, unquoted argument, including when the directory has spaces.
    process = subprocess.Popen(f'"{installer}" /S /D={destination}')
    assert process.wait(timeout=180) == 0, "NSIS installation failed"
    exe = destination / "masame.exe"
    assert exe.is_file(), f"NSIS did not install {exe}"
    return exe


def check_resources(destination):
    resources = destination / "resources"
    assert (resources / "katago/analysis.cfg").is_file()
    assert (resources / "licenses/THIRD_PARTY_LICENSES.txt").is_file()
    for variant in ("opencl", "eigenavx2"):
        folder = resources / "katago-win" / variant
        assert (folder / "katago.exe").is_file(), folder
        assert list(folder.glob("*.dll")), f"Bundled runtime DLLs missing: {folder}"


def edge_driver(temp, evidence):
    candidates = []
    for key in ("ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"):
        root = Path(os.environ.get(key, "C:/missing")) / "Microsoft/EdgeWebView/Application"
        candidates.extend(root.glob("*/msedgewebview2.exe"))
    assert candidates, "WebView2 runtime missing after NSIS installation; UI validation not performed"
    runtime = max(candidates, key=lambda p: tuple(int(v) for v in p.parent.name.split(".")))
    version = runtime.parent.name
    try:
        response = urllib.request.urlopen(f"https://msedgedriver.microsoft.com/{version}/edgedriver_win64.zip", timeout=60)
    except urllib.error.HTTPError:
        with urllib.request.urlopen(f"https://msedgedriver.microsoft.com/LATEST_RELEASE_{version.split('.')[0]}_WINDOWS", timeout=30) as reply:
            raw = reply.read()
            match = raw.decode("utf-16" if raw.startswith((b'\xff\xfe', b'\xfe\xff')) else "utf-8-sig").strip()
        assert match.split(".")[:3] == version.split(".")[:3], f"Driver {match} does not match runtime {version}"
        response = urllib.request.urlopen(f"https://msedgedriver.microsoft.com/{match}/edgedriver_win64.zip", timeout=60)
    with response:
        archive = temp / "edgedriver.zip"
        archive.write_bytes(response.read())
    with zipfile.ZipFile(archive) as package:
        driver = temp / "msedgedriver.exe"
        driver.write_bytes(package.read("msedgedriver.exe"))
    (evidence / "platform.json").write_text(json.dumps({
        "runner_image": os.environ.get("ImageOS"), "image_version": os.environ.get("ImageVersion"),
        "webview2": version, "driver": run([str(driver), "--version"], capture_output=True, text=True).stdout.strip(),
        "session_id": run(["powershell", "-NoProfile", "-Command", "(Get-Process -Id $PID).SessionId"], capture_output=True, text=True).stdout.strip(),
        "elevated": bool(ctypes.windll.shell32.IsUserAnAdmin()),
        "token_elevation": current_token_elevation(),
        "automation": "Microsoft WebView2 attach mode through tauri-driver; loopback CDP in test subprocess only",
        "scope": "installed NSIS and WebView2 interaction; no Avira, SmartScreen or real GPU validation",
    }, indent=2), encoding="utf-8")
    return driver


class UpdateServer(http.server.ThreadingHTTPServer):
    daemon_threads = True
    def __init__(self, package, signature):
        self.package, self.signature, self.mode = package, signature, "good"
        self.downloads = []
        super().__init__(("127.0.0.1", 0), UpdateHandler)

    @property
    def base(self):
        return f"http://127.0.0.1:{self.server_port}"


class UpdateHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        server = self.server
        if self.path == "/latest.json":
            body = json.dumps({"version": VERSION_B, "platforms": {"windows-x86_64": {
                "url": server.base + "/package.exe", "signature": server.signature,
            }}}).encode()
        elif self.path == "/package.exe":
            body = server.package.read_bytes()
            server.downloads.append(server.mode)
            if server.mode == "signature":
                body = body[:-1] + bytes([body[-1] ^ 1])
            elif server.mode == "interrupted":
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body[:4096])
                self.wfile.flush()
                self.close_connection = True
                self.connection.shutdown(socket.SHUT_RDWR)
                return
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json" if self.path.endswith("json") else "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def build_fixture(temp, version, public_key, endpoint, env):
    config = temp / f"{version}.json"
    config.write_text(json.dumps({
        "version": version, "identifier": TEST_ID, "productName": "Masame Reliability Test",
        "bundle": {"createUpdaterArtifacts": True, "fileAssociations": []},
        "plugins": {"updater": {"pubkey": public_key, "endpoints": [endpoint],
                                "dangerousInsecureTransportProtocol": True}},
    }), encoding="utf-8")
    run(["pnpm", "tauri", "build", "--ci", "--bundles", "nsis", "--config", str(config)], env=env)
    path = ROOT / "src-tauri/target/release/bundle/nsis"
    installers = [p for p in path.glob("*-setup.exe") if version in p.name]
    assert len(installers) == 1, f"Expected one installer for {version}: {installers}"
    output = temp / installers[0].name
    shutil.copy2(installers[0], output)
    shutil.copy2(Path(str(installers[0]) + ".sig"), Path(str(output) + ".sig"))
    return output


def failure_cases(exe, driver, data, evidence):
    # A stub model lets engine_start reach the executable checks without a large model download.
    models = data / "models"
    models.mkdir(parents=True, exist_ok=True)
    (models / "kata1-ci.bin.gz").write_bytes(b"test fixture, not a neural network")
    binaries = list((exe.parent / "resources/katago-win").glob("*/katago.exe"))
    assert len(binaries) == 2
    for path in binaries:
        path.rename(path.with_suffix(".missing"))
    try:
        with Browser(exe, driver, evidence, "missing-engines") as app:
            app.interactive()
            error = app.invoke("engine_start")
            assert not error["ok"] and error["error"]["code"] in ("engine_missing", "cpu_unsupported"), error
            app.interactive()
    finally:
        for path in binaries:
            path.with_suffix(".missing").rename(path)
    # Quarantine-like missing runtime DLLs: the parent UI must survive the Windows loader/engine failure.
    dlls = list((exe.parent / "resources/katago-win").glob("*/*.dll"))
    assert dlls
    for path in dlls:
        path.rename(path.with_suffix(".dll.missing"))
    try:
        with Browser(exe, driver, evidence, "missing-engine-dlls") as app:
            app.interactive()
            app.invoke("engine_start")  # A loader failure can arrive asynchronously after spawn.
            def failed_engine():
                state = app.invoke("engine_status").get("value", {})
                return state if state.get("state") == "error" else None
            status = eventually(failed_engine)
            assert status["error"]["code"] in ("engine_crashed", "spawn_failed", "cpu_unsupported"), status
            app.interactive()
    finally:
        for path in dlls:
            path.with_suffix(".dll.missing").rename(path)
    # A missing application resource must be diagnostic, while the UI still starts.
    bundled = exe.parent / "resources/katago/analysis.cfg"
    installed = data / "analysis.cfg"
    bundled.rename(bundled.with_suffix(".missing"))
    if installed.exists():
        installed.unlink()
    try:
        with Browser(exe, driver, evidence, "missing-config") as app:
            app.interactive()
            error = app.invoke("engine_start")
            assert not error["ok"] and error["error"]["code"] in ("config_missing", "cpu_unsupported"), error
            app.interactive()
        assert "config unavailable" in (data / "startup.log").read_text(encoding="utf-8")
    finally:
        bundled.with_suffix(".missing").rename(bundled)
    (models / "kata1-ci.bin.gz").unlink()


def smoke(installer, temp, evidence):
    identifier = json.loads((ROOT / "src-tauri/tauri.conf.json").read_text())["identifier"]
    data = Path(os.environ["LOCALAPPDATA"]) / identifier
    assert not data.exists(), "Refusing to use an existing production profile"
    destination = temp / "Installed Masame"
    exe = install(installer, destination)
    check_resources(destination)
    driver = edge_driver(temp, evidence)
    try:
        with Browser(exe, driver, evidence, "production") as app:
            app.interactive(json.loads((ROOT / "src-tauri/tauri.conf.json").read_text())["version"])
            app.js("localStorage.setItem('masame-ci-persist','survives-reinstall')")
        sentinel = data / "models/retention.bin"
        sentinel.parent.mkdir(parents=True, exist_ok=True)
        sentinel.write_bytes(b"retain downloaded data")
        exe = install(installer, destination)
        with Browser(exe, driver, evidence, "reinstall") as app:
            app.interactive(expected_marker="survives-reinstall")
        assert sentinel.read_bytes() == b"retain downloaded data"
        failure_cases(exe, driver, data, evidence)
    finally:
        stop_installed(exe)
        copy_logs(data, evidence, "production")
    return driver


def copy_logs(data, evidence, prefix):
    for name in ("startup.log", "startup.log.1", "engine.log", "engine.log.1", "installer-ci.log"):
        path = data / name
        if path.exists():
            shutil.copy2(path, evidence / f"{prefix}-{name}")


def download_compact(destination):
    request = urllib.request.Request(COMPACT_URL, headers={"User-Agent": "Masame/0.7"})
    with urllib.request.urlopen(request, timeout=90) as response:
        # Bound the read even if the upstream server accidentally returns a different/larger payload.
        model = response.read(COMPACT_BYTES + 1)
    assert len(model) == COMPACT_BYTES, "Compact model size differs from its production pin"
    assert hashlib.sha256(model).hexdigest() == COMPACT_SHA256, "Compact model SHA256 differs from its production pin"
    destination.write_bytes(model)


def canonical_windows_path(path):
    # Win32_Process and QueryFullProcessImageName return long names, while the de-elevated runner can inherit
    # TMP=C:\Users\RUNNER~1\... . Resolve 8.3 names before comparing, then normalize extended Win32 prefixes.
    value = os.path.realpath(path) if sys.platform == "win32" else str(path)
    if value.startswith("\\\\?\\UNC\\"):
        value = "\\\\" + value[8:]
    elif value.startswith("\\\\?\\"):
        value = value[4:]
    return ntpath.normcase(ntpath.normpath(value))


def query_process_path(pid):
    # WMI may omit ExecutablePath when SeDebugPrivilege is unavailable. Querying our own Medium-integrity child
    # with PROCESS_QUERY_LIMITED_INFORMATION still allows an exact path check; never accept a name-only match.
    from ctypes import wintypes
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD,
                                                 wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
    handle = kernel.OpenProcess(0x1000, False, pid)
    if not handle:
        return None
    try:
        buffer, size = ctypes.create_unicode_buffer(32768), wintypes.DWORD(32768)
        return buffer.value if kernel.QueryFullProcessImageNameW(handle, 0, buffer, ctypes.byref(size)) else None
    finally:
        kernel.CloseHandle(handle)


def engine_pid(engine_path):
    # Enumerating a name is not the selection criterion: only the exact canonical installed CPU path is accepted.
    script = "@(Get-CimInstance Win32_Process -Filter \"Name = 'katago.exe'\" | Select-Object ProcessId,ExecutablePath) | ConvertTo-Json -Compress"
    result = run(["powershell", "-NoProfile", "-Command", script], capture_output=True, text=True).stdout.strip()
    candidates = json.loads(result) if result else []
    candidates = [p for p in (candidates if isinstance(candidates, list) else [candidates]) if isinstance(p, dict)]
    for process in candidates:
        if not process.get("ExecutablePath"):
            process["ExecutablePath"] = query_process_path(process["ProcessId"])
    matches = [p for p in candidates if p.get("ExecutablePath") and
               canonical_windows_path(p["ExecutablePath"]) == canonical_windows_path(engine_path)]
    assert len(matches) == 1, f"Expected one active CPU KataGo at {engine_path}: {candidates}"
    return matches[0]["ProcessId"]


def real_analysis(app, evidence, label):
    assert app.invoke("engine_start")["ok"]
    eventually(lambda: app.invoke("engine_status").get("value", {}).get("state") == "ready", timeout=180)
    result = app.invoke("engine_analyze", {"query": {"rules": "japanese", "komi": 6.5,
        "boardXSize": 9, "boardYSize": 9, "moves": [], "maxVisits": 8}})
    assert result["ok"], result
    analysis = result["value"]
    assert analysis["rootInfo"]["visits"] >= 1 and analysis["moveInfos"], analysis
    (evidence / f"{label}.json").write_text(json.dumps(analysis, indent=2), encoding="utf-8")


def check_install_handoff(reply):
    # EdgeDriver can return JSON null as the app exits, instead of reporting a disconnected session. This is
    # only a handoff, never success: the caller still verifies OS exit, installed bytes, restart and real analysis.
    if reply is not None:
        assert isinstance(reply, dict) and reply.get("ok") is True, reply


class ProcessExitProbe:
    """Wait on the exact real KataGo process while the blocking installer IPC is in progress."""
    def __init__(self, pid, engine_path, app_exe, original_hash, data, evidence):
        from ctypes import wintypes
        self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        self.kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        self.kernel.OpenProcess.restype = wintypes.HANDLE
        self.kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        self.kernel.WaitForSingleObject.restype = wintypes.DWORD
        self.kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        self.kernel.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD,
                                                          wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
        self.handle = self.kernel.OpenProcess(0x00101000, False, pid)  # SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION
        assert self.handle, f"Cannot observe real KataGo PID {pid}: {ctypes.get_last_error()}"
        buffer, size = ctypes.create_unicode_buffer(32768), wintypes.DWORD(32768)
        queried = self.kernel.QueryFullProcessImageNameW(self.handle, 0, buffer, ctypes.byref(size))
        if not queried or canonical_windows_path(buffer.value) != canonical_windows_path(engine_path):
            self.kernel.CloseHandle(self.handle)
            raise AssertionError("Observed process is not the installed CPU KataGo")
        self.result = {"pid": pid, "engine": "official eigenavx2 KataGo", "exited": False}
        self.error = None
        def observe():
            try:
                assert self.kernel.WaitForSingleObject(self.handle, 180000) == 0, "KataGo did not exit before installation"
                self.result.update(exited=True, observed_unix_seconds=time.time(),
                    old_application_still_installed=digest(app_exe) == original_hash,
                    new_version_not_started=f"launch Masame {VERSION_B}" not in (data / "startup.log").read_text())
            except BaseException as error:
                self.error = error
            finally:
                self.kernel.CloseHandle(self.handle)
                if self.error:
                    self.result["observer_error"] = str(self.error)
                try:
                    (evidence / "updater-engine-exit.json").write_text(json.dumps(self.result, indent=2), encoding="utf-8")
                except OSError as error:
                    self.error = self.error or error
        self.thread = threading.Thread(target=observe, daemon=True)
        self.thread.start()

    def verify(self, evidence):
        self.thread.join(timeout=185)
        assert not self.thread.is_alive(), "KataGo exit observer did not finish"
        if self.error:
            raise self.error
        (evidence / "updater-engine-exit.json").write_text(json.dumps(self.result, indent=2), encoding="utf-8")
        assert self.result["exited"] and self.result["old_application_still_installed"] and self.result["new_version_not_started"], self.result


def restart_diagnostics(exe, data, evidence):
    script = "@(Get-CimInstance Win32_Process -Filter \"Name = 'masame.exe' OR Name = 'explorer.exe' OR Name LIKE 'Masame%installer%.exe'\" | Select-Object Name,ProcessId,ParentProcessId,SessionId,ExecutablePath,CommandLine) | ConvertTo-Json -Compress"
    raw = run(["powershell", "-NoProfile", "-Command", script], capture_output=True, text=True).stdout.strip()
    processes = json.loads(raw) if raw else []
    processes = [p for p in (processes if isinstance(processes, list) else [processes]) if isinstance(p, dict)]
    # Capture only text belonging to the relevant installer/application processes on this disposable VM.
    from ctypes import wintypes
    user = ctypes.WinDLL("user32", use_last_error=True)
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user.EnumWindows.argtypes = [callback_type, wintypes.LPARAM]
    user.EnumChildWindows.argtypes = [wintypes.HWND, callback_type, wintypes.LPARAM]
    user.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    pids = {p["ProcessId"] for p in processes if p["Name"].lower() != "explorer.exe"}
    windows = []
    def collect(hwnd, _):
        pid = wintypes.DWORD()
        user.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value in pids:
            texts = []
            def text(child, _):
                buffer = ctypes.create_unicode_buffer(4096)
                if user.GetWindowTextW(child, buffer, len(buffer)):
                    texts.append(buffer.value)
                return True
            text(hwnd, 0)
            user.EnumChildWindows(hwnd, callback_type(text), 0)
            windows.append({"pid": pid.value, "texts": texts})
        return True
    user.EnumWindows(callback_type(collect), 0)
    report = {"processes": processes, "windows": windows, "installed_executable_sha256": digest(exe)}
    (evidence / "restart-diagnostics.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    copy_logs(data, evidence, "restart-diagnostic")


def updater_cases(temp, driver, evidence):
    data = Path(os.environ["LOCALAPPDATA"]) / TEST_ID
    assert not data.exists(), "Refusing to use an existing updater test profile"
    # Reserve a loopback server before building either version; the URL is compiled into test fixtures only.
    with UpdateServer(temp / "not-built.exe", "") as server:
        threading.Thread(target=server.serve_forever, daemon=True).start()
        key = temp / "ephemeral-updater.key"
        try:
            # signer generate prints the private key to stdout. Never forward its output or upload the temporary dir.
            run(["pnpm", "tauri", "signer", "generate", "--ci", "-p", "", "-w", str(key)],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            public = Path(str(key) + ".pub").read_text().strip()
            env = {k: v for k, v in os.environ.items() if not k.startswith(("TAURI_SIGNING_", "APPLE_"))}
            env.update(TAURI_SIGNING_PRIVATE_KEY=str(key), TAURI_SIGNING_PRIVATE_KEY_PASSWORD="")
            first = build_fixture(temp, VERSION_A, public, server.base + "/latest.json", env)
            second = build_fixture(temp, VERSION_B, public, server.base + "/latest.json", env)
        finally:
            key.unlink(missing_ok=True)
            Path(str(key) + ".pub").unlink(missing_ok=True)
        server.package, server.signature = second, Path(str(second) + ".sig").read_text().strip()
        exe = install(first, temp / "Installed Update Test")
        models = data / "models"
        models.mkdir(parents=True, exist_ok=True)
        model = models / f"{COMPACT_NAME}.txt.gz"
        download_compact(model)
        (data / "settings.json").write_text(json.dumps({"engineVariant": "eigenavx2", "activeNetwork": COMPACT_NAME}))
        engine_path = exe.parent / "resources/katago-win/eigenavx2/katago.exe"
        original = digest(exe)
        restart_error = None
        try:
            with Browser(exe, driver, evidence, "update-failures") as app:
                app.interactive(VERSION_A)
                app.js("localStorage.setItem('masame-ci-persist','survives-update')")
                real_analysis(app, evidence, "updater-analysis-before")
                pid = engine_pid(engine_path)
                rejections = []
                for mode in ("signature", "interrupted"):
                    server.mode = mode
                    assert app.invoke("update_check")["value"]["version"] == VERSION_B
                    failed = app.invoke("update_install")
                    assert not failed["ok"] and failed["error"]["code"] == "update_failed", failed
                    if mode == "signature":
                        assert "signature" in failed["error"].get("detail", "").lower(), failed
                    assert digest(exe) == original
                    assert app.invoke("engine_status")["value"]["state"] == "ready", "Failed download stopped the engine"
                    app.interactive(VERSION_A)
                    rejections.append({"mode": mode, "error": failed["error"],
                                       "installed_executable_unchanged": True, "real_engine_still_ready": True})
                    (evidence / "updater-rejections.json").write_text(json.dumps(rejections, indent=2), encoding="utf-8")
                server.mode = "good"
                assert app.invoke("update_check")["value"]["version"] == VERSION_B
                probe = ProcessExitProbe(pid, engine_path, exe, original, data, evidence)
                # Windows updater exits the app after spawning NSIS, so this IPC connection normally disappears.
                try:
                    installed = app.invoke("update_install")
                    check_install_handoff(installed)
                except (RuntimeError, OSError, http.client.HTTPException):
                    pass  # The original process exits while Windows hands control to NSIS.
                probe.verify(evidence)
                eventually(lambda: digest(exe) != original, timeout=180)
                def restarted():
                    text = (data / "startup.log").read_text()
                    marker = f"launch Masame {VERSION_B}"
                    return marker in text and "event loop ready" in text.rsplit(marker, 1)[1]
                try:
                    eventually(restarted, timeout=90)
                except AssertionError as error:
                    restart_error = error
                    restart_diagnostics(exe, data, evidence)
            # Manual relaunch validates the installed bytes even on a diagnostic failed-restart run. It must never
            # turn a missing automatic restart into a pass; the original failure is raised after the remaining checks.
            with Browser(exe, driver, evidence, "updated") as app:
                app.interactive(VERSION_B, expected_marker="survives-update")
                real_analysis(app, evidence, "updater-analysis-after")
            assert model.stat().st_size == COMPACT_BYTES and digest(model) == COMPACT_SHA256
            assert server.downloads == ["signature", "interrupted", "good"], server.downloads
            (evidence / "updater.json").write_text(json.dumps({"from": VERSION_A, "to": VERSION_B,
                "invalid_signature_rejected": True, "interruption_rejected": True, "automatic_restart": restart_error is None,
                "old_engine_exited_before_installation": True, "real_cpu_analysis_before_and_after": True,
                "model_sha256": COMPACT_SHA256, "model_bytes": COMPACT_BYTES,
                "data_preserved": True, "endpoint": "loopback only"}, indent=2))
            if restart_error:
                raise AssertionError("Automatic restart was not observed; manual version B launch and real inference passed. See restart-diagnostics.json and the startup log.") from restart_error
        finally:
            stop_installed(exe)
            copy_logs(data, evidence, "updater")
            server.shutdown()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence", type=Path, default=Path("windows-evidence"))
    args = parser.parse_args()
    if sys.platform != "win32" or os.environ.get("RUNNER_ENVIRONMENT") != "github-hosted":
        parser.error("Use only a disposable GitHub-hosted Windows VM, never a developer's existing profile")
    if ctypes.windll.shell32.IsUserAnAdmin():
        parser.error("Run this harness at Medium integrity; current WebView2 ignores debugging overrides in an elevated host")
    if current_token_elevation() != 0:
        parser.error("A true filtered token is required: IsUserAnAdmin=false alone does not select the updater's unelevated path")
    evidence = args.evidence.resolve()
    evidence.mkdir(parents=True, exist_ok=True)
    results = {"complete": False, "avira_validated": False}
    try:
        installers = list((ROOT / "src-tauri/target/release/bundle/nsis").glob("*-setup.exe"))
        assert len(installers) == 1, installers
        # On a failing updater run NSIS may still own files while error diagnostics unwind. Preserve the original
        # exception; a successful run must nevertheless prove its entire temporary installation was removed.
        with tempfile.TemporaryDirectory(prefix="masame-windows-", ignore_cleanup_errors=True) as directory:
            temp = Path(directory).resolve()  # expand inherited 8.3 TMP names before NSIS records its install path
            driver = smoke(installers[0], temp, evidence)
            updater_cases(temp, driver, evidence)
        assert not temp.exists(), "Temporary installation still locked after the successful test flow"
        results["complete"] = True
    finally:
        (evidence / "result.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    print("Windows NSIS, installed WebView2, reinstall, resource failures and isolated updater checks passed.")


if __name__ == "__main__":
    main()
