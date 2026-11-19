"""Check public downloads against GitHub digests, the release checksums and the 0.8.0 key."""
import base64
import concurrent.futures
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import time

repo = "Slymaster/masame"
version = "0.8.1"
tag = "v" + version
base = f"https://github.com/{repo}/releases/download/{tag}/"
platforms = {
    "darwin-aarch64": "Masame_aarch64.app.tar.gz",
    "darwin-x86_64": "Masame_x64.app.tar.gz",
    "linux-x86_64": f"Masame_{version}_amd64.AppImage",
    "windows-x86_64": f"Masame_{version}_x64-setup.exe",
}
expected = {
    "latest.json", "linux-appimage-libraries.txt", "SHA256SUMS.txt",
    f"Masame_{version}_aarch64.dmg", f"Masame_{version}_x64.dmg",
    f"Masame_{version}_amd64.deb", f"Masame-{version}-1.x86_64.rpm",
    *platforms.values(), *(f"{name}.sig" for name in platforms.values()),
}
def get(url, path):
    subprocess.run(["curl", "-fsSL", "--proto", "=https", "--proto-redir", "=https",
                    "--retry", "4", "--connect-timeout", "15", "--max-time", "200",
                    url, "-o", str(path)], check=True)

release = json.loads(subprocess.check_output(["gh", "api", f"repos/{repo}/releases/latest"]))
assert release["tag_name"] == tag and not release["draft"] and not release["prerelease"]
assets = {a["name"]: a for a in release["assets"]}
assert set(assets) == expected
with tempfile.TemporaryDirectory() as tmp:
    work = Path(tmp)
    def download(name):
        asset = assets[name]
        assert asset["state"] == "uploaded" and asset["browser_download_url"] == base + name
        dest = work / name
        get(base + name, dest)
        digest = hashlib.sha256(dest.read_bytes()).hexdigest()
        assert dest.stat().st_size == asset["size"] and asset["digest"] == "sha256:" + digest, name
        return name, digest
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        hashes = dict(pool.map(download, sorted(expected)))
    sums = dict((name, digest) for digest, name in (row.split() for row in (work / "SHA256SUMS.txt").read_text().splitlines()))
    assert sums == {name: digest for name, digest in hashes.items() if name != "SHA256SUMS.txt"}
    print(f"{len(hashes)} public downloads match GitHub digests; all {len(sums)} listed checksums match", flush=True)
    get(f"https://raw.githubusercontent.com/{repo}/v0.8.0/src-tauri/tauri.conf.json", work / "old-conf.json")
    config = json.loads((work / "old-conf.json").read_text())
    assert config["version"] == "0.8.0"
    updater = config["plugins"]["updater"]
    assert updater["requireSignedVersion"] and len(updater["endpoints"]) == 1
    for attempt in range(5):
        get(updater["endpoints"][0], work / "active.json")
        if (work / "active.json").read_bytes() == (work / "latest.json").read_bytes():
            break
        time.sleep(10)
    else:
        raise ValueError("The 0.8.0 update endpoint does not serve the published manifest")
    manifest = json.loads((work / "active.json").read_text())
    assert manifest["version"] == version and set(manifest["platforms"]) == set(platforms)
    (work / "old-key").write_bytes(base64.b64decode(updater["pubkey"], validate=True))
    for target, name in platforms.items():
        entry = manifest["platforms"][target]
        assert entry["url"] == base + name
        assert entry["signature"] == (work / (name + ".sig")).read_text().strip()
        (work / "minisig").write_bytes(base64.b64decode(entry["signature"], validate=True))
        comment = subprocess.check_output(["minisign", "-V", "-Q", "-p", str(work / "old-key"),
                                           "-m", str(work / name), "-x", str(work / "minisig")], text=True)
        assert f"version:{version}" in comment.strip().split("\t"), (name, comment)
        print(target, "verified by the public key embedded in Masame 0.8.0, signed version", version)
