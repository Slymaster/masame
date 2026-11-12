"""Lightweight preflight: filtered token, real stdout/stderr pipes and access to the child's own process."""
import argparse
import ctypes
from ctypes import wintypes
import json
from pathlib import Path
import subprocess
import sys

from launch_user_token import current_token_elevation


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence", type=Path, required=True)
    evidence = parser.parse_args().evidence
    assert current_token_elevation() == 0
    reply = subprocess.run([sys.executable, "-c", "import sys; print('pipe-ok'); print('stderr-ok', file=sys.stderr)"],
                           capture_output=True, text=True, check=True)
    assert reply.stdout.strip() == "pipe-ok" and reply.stderr.strip() == "stderr-ok", reply
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.GetCurrentProcessId.restype = wintypes.DWORD
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.OpenProcess(0x1040, False, kernel.GetCurrentProcessId())  # QUERY_LIMITED_INFORMATION | DUP_HANDLE
    if not handle:
        raise ctypes.WinError(ctypes.get_last_error())
    kernel.CloseHandle(handle)
    evidence.parent.mkdir(parents=True, exist_ok=True)
    evidence.write_text(json.dumps({"scope": "token preflight only", "token_elevation": 0,
        "stdout_pipe": True, "stderr_pipe": True, "own_process_reopened": True}, indent=2))


if __name__ == "__main__":
    main()
