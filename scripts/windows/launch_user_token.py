"""Launch CI commands with a real filtered same-user token, without changing system policy or desktop ACLs."""
import argparse
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


class StartupInfo(ctypes.Structure):
    _fields_ = [("cb", wintypes.DWORD), ("lpReserved", wintypes.LPWSTR), ("lpDesktop", wintypes.LPWSTR),
                ("lpTitle", wintypes.LPWSTR), ("dwX", wintypes.DWORD), ("dwY", wintypes.DWORD),
                ("dwXSize", wintypes.DWORD), ("dwYSize", wintypes.DWORD), ("dwXCountChars", wintypes.DWORD),
                ("dwYCountChars", wintypes.DWORD), ("dwFillAttribute", wintypes.DWORD),
                ("dwFlags", wintypes.DWORD), ("wShowWindow", wintypes.WORD), ("cbReserved2", wintypes.WORD),
                ("lpReserved2", ctypes.POINTER(ctypes.c_byte)), ("hStdInput", wintypes.HANDLE),
                ("hStdOutput", wintypes.HANDLE), ("hStdError", wintypes.HANDLE)]


class ProcessInfo(ctypes.Structure):
    _fields_ = [("process", wintypes.HANDLE), ("thread", wintypes.HANDLE),
                ("pid", wintypes.DWORD), ("tid", wintypes.DWORD)]


class SidAndAttributes(ctypes.Structure):
    _fields_ = [("sid", wintypes.LPVOID), ("attributes", wintypes.DWORD)]


class TokenDefaultDacl(ctypes.Structure):
    _fields_ = [("acl", wintypes.LPVOID)]


def current_token_elevation():
    """Check the actual Windows token, rather than inferring elevation from administrator membership."""
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    security = ctypes.WinDLL("advapi32", use_last_error=True)
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    security.OpenProcessToken.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE)]
    security.GetTokenInformation.argtypes = [wintypes.HANDLE, ctypes.c_int, wintypes.LPVOID,
        wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)]
    handle, value, size = wintypes.HANDLE(), wintypes.DWORD(), wintypes.DWORD()
    if not security.OpenProcessToken(kernel.GetCurrentProcess(), 8, ctypes.byref(handle)):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        if not security.GetTokenInformation(handle, 20, ctypes.byref(value), ctypes.sizeof(value), ctypes.byref(size)):
            raise ctypes.WinError(ctypes.get_last_error())
        assert size.value == 4
        return value.value
    finally:
        kernel.CloseHandle(handle)


def launch(command, evidence):
    assert sys.platform == "win32" and os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted"
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    security = ctypes.WinDLL("advapi32", use_last_error=True)
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.LocalFree.argtypes = [wintypes.LPVOID]
    kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
    security.OpenProcessToken.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE)]
    security.CreateRestrictedToken.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.DWORD,
        wintypes.LPVOID, wintypes.DWORD, wintypes.LPVOID, wintypes.DWORD, wintypes.LPVOID,
        ctypes.POINTER(wintypes.HANDLE)]
    security.GetTokenInformation.argtypes = [wintypes.HANDLE, ctypes.c_int, wintypes.LPVOID,
        wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)]
    security.ConvertStringSidToSidW.argtypes = [wintypes.LPCWSTR, ctypes.POINTER(wintypes.LPVOID)]
    security.GetLengthSid.argtypes = [wintypes.LPVOID]
    security.ConvertSidToStringSidW.argtypes = [wintypes.LPVOID, ctypes.POINTER(wintypes.LPWSTR)]
    security.ConvertStringSecurityDescriptorToSecurityDescriptorW.argtypes = [wintypes.LPCWSTR,
        wintypes.DWORD, ctypes.POINTER(wintypes.LPVOID), ctypes.POINTER(wintypes.DWORD)]
    security.GetSecurityDescriptorDacl.argtypes = [wintypes.LPVOID, ctypes.POINTER(wintypes.BOOL),
        ctypes.POINTER(wintypes.LPVOID), ctypes.POINTER(wintypes.BOOL)]
    security.SetTokenInformation.argtypes = [wintypes.HANDLE, ctypes.c_int, wintypes.LPVOID, wintypes.DWORD]
    security.GetSidSubAuthorityCount.argtypes = [wintypes.LPVOID]
    security.GetSidSubAuthorityCount.restype = ctypes.POINTER(ctypes.c_ubyte)
    security.GetSidSubAuthority.argtypes = [wintypes.LPVOID, wintypes.DWORD]
    security.GetSidSubAuthority.restype = ctypes.POINTER(wintypes.DWORD)
    security.CreateProcessAsUserW.argtypes = [wintypes.HANDLE, wintypes.LPCWSTR, wintypes.LPWSTR,
        wintypes.LPVOID, wintypes.LPVOID, wintypes.BOOL, wintypes.DWORD, wintypes.LPVOID, wintypes.LPCWSTR,
        ctypes.POINTER(StartupInfo), ctypes.POINTER(ProcessInfo)]

    def check(ok):
        if not ok:
            raise ctypes.WinError(ctypes.get_last_error())

    def elevated(token):
        value, size = wintypes.DWORD(), wintypes.DWORD()
        check(security.GetTokenInformation(token, 20, ctypes.byref(value), ctypes.sizeof(value), ctypes.byref(size)))
        assert size.value == 4
        return value.value

    original, filtered, sid = wintypes.HANDLE(), wintypes.HANDLE(), wintypes.LPVOID()
    user_sid_string, descriptor = wintypes.LPWSTR(), wintypes.LPVOID()
    process = ProcessInfo()
    report = {"method": "CreateRestrictedToken(LUA_TOKEN), same account/session, Medium integrity",
              "system_policy_changed": False, "desktop_acl_changed": False}
    try:
        check(security.OpenProcessToken(kernel.GetCurrentProcess(), 0xF01FF, ctypes.byref(original)))
        report["original_token_elevation"] = elevated(original)
        check(security.CreateRestrictedToken(original, 0x4, 0, None, 0, None, 0, None, ctypes.byref(filtered)))
        report["filtered_token_elevation"] = elevated(filtered)
        assert report["filtered_token_elevation"] == 0, "LUA token is still elevated; refusing to claim a standard-user test"
        # A restricted admin token can retain an admin-only default DACL. Its new pipes/process objects then
        # cannot be reopened by its own user. Set this new token's default only, without changing any object ACL.
        user_size = wintypes.DWORD()
        security.GetTokenInformation(filtered, 1, None, 0, ctypes.byref(user_size))  # TokenUser
        assert user_size.value >= ctypes.sizeof(SidAndAttributes)
        user_buffer = ctypes.create_string_buffer(user_size.value)
        check(security.GetTokenInformation(filtered, 1, user_buffer, user_size, ctypes.byref(user_size)))
        user_sid = ctypes.cast(user_buffer, ctypes.POINTER(SidAndAttributes)).contents.sid
        check(security.ConvertSidToStringSidW(user_sid, ctypes.byref(user_sid_string)))
        sddl = f"D:P(A;;GA;;;SY)(A;;GA;;;{user_sid_string.value})"
        check(security.ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, 1, ctypes.byref(descriptor), None))
        present, defaulted, acl = wintypes.BOOL(), wintypes.BOOL(), wintypes.LPVOID()
        check(security.GetSecurityDescriptorDacl(descriptor, ctypes.byref(present), ctypes.byref(acl), ctypes.byref(defaulted)))
        assert present.value and acl, "Refusing a missing or NULL default DACL"
        dacl = TokenDefaultDacl(acl)
        check(security.SetTokenInformation(filtered, 6, ctypes.byref(dacl), ctypes.sizeof(dacl)))
        report["new_token_default_dacl"] = "current user SID and LocalSystem only"
        check(security.ConvertStringSidToSidW("S-1-16-8192", ctypes.byref(sid)))
        label = SidAndAttributes(sid, 0x20)  # TOKEN_MANDATORY_LABEL contains one SID_AND_ATTRIBUTES.
        check(security.SetTokenInformation(filtered, 25, ctypes.byref(label),
              ctypes.sizeof(label) + security.GetLengthSid(sid)))
        size = wintypes.DWORD()
        security.GetTokenInformation(filtered, 25, None, 0, ctypes.byref(size))
        assert size.value >= ctypes.sizeof(SidAndAttributes), "Missing token integrity information"
        buffer = ctypes.create_string_buffer(size.value)
        check(security.GetTokenInformation(filtered, 25, buffer, size, ctypes.byref(size)))
        actual_sid = ctypes.cast(buffer, ctypes.POINTER(SidAndAttributes)).contents.sid
        count = security.GetSidSubAuthorityCount(actual_sid).contents.value
        assert count > 0
        report["filtered_token_integrity_rid"] = security.GetSidSubAuthority(actual_sid, count - 1).contents.value
        assert report["filtered_token_integrity_rid"] == 8192, "Filtered token is not Medium integrity"
        assert elevated(filtered) == 0, "Setting integrity did not preserve the filtered token"
        command[0] = shutil.which(command[0]) or command[0]
        executable = str(Path(command[0]).resolve())
        startup = StartupInfo()
        startup.cb = ctypes.sizeof(startup)
        startup.lpDesktop = "winsta0\\default"  # Existing same-user interactive desktop. Do not grant new access.
        check(security.CreateProcessAsUserW(filtered, executable,
            ctypes.create_unicode_buffer(subprocess.list2cmdline([executable, *command[1:]])),
            None, None, False, 0, None, str(Path.cwd()), ctypes.byref(startup), ctypes.byref(process)))
        report["child_pid"] = process.pid
        assert kernel.WaitForSingleObject(process.process, 2700000) == 0, "Filtered child did not complete within 45 minutes"
        code = wintypes.DWORD()
        check(kernel.GetExitCodeProcess(process.process, ctypes.byref(code)))
        report["child_exit_code"] = code.value
        return code.value
    except BaseException as error:
        report["error"] = str(error)
        raise
    finally:
        # Evidence I/O can fail (for example a full disk). Native resources must still be released.
        for handle in (process.thread, process.process, filtered, original):
            if handle:
                kernel.CloseHandle(handle)
        if sid:
            kernel.LocalFree(sid)
        if user_sid_string:
            kernel.LocalFree(ctypes.cast(user_sid_string, wintypes.LPVOID))
        if descriptor:
            kernel.LocalFree(descriptor)
        evidence.parent.mkdir(parents=True, exist_ok=True)
        evidence.write_text(json.dumps(report, indent=2), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence", type=Path, required=True)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    options = parser.parse_args()
    command = options.command[1:] if options.command[:1] == ["--"] else options.command
    assert command, "A command is required"
    sys.exit(launch(command, options.evidence))
