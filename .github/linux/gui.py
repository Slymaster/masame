"""Operate the unmodified installed GTK/WebKit application over desktop accessibility."""
import hashlib
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
import pyatspi

mode, program, version, *rest = sys.argv[1:]
program = Path(program).resolve()
env = os.environ.copy()
log = open('masame-ui.log', 'w+')
app = subprocess.Popen([str(program)], stdout=log, stderr=subprocess.STDOUT, env=env, start_new_session=True)
last = []
def accessible():
    global last
    root = pyatspi.Registry.getDesktop(0)
    stack = [root]
    items = []
    while stack and len(items) < 2000:
        obj = stack.pop()
        try:
            name = obj.name or ''
            role = obj.getRoleName()
            txt = ''
            try: txt = obj.queryText().getText(0, -1)
            except Exception: pass
            items.append((name, role, txt, obj))
            stack.extend(reversed(list(obj)))
        except Exception:
            pass
    last = [(n, r, t[:120]) for n, r, t, _ in items if n or t]
    return items

def until(find, label, timeout=60):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            got = find()
            if got: return got
        except Exception: pass
        time.sleep(0.5)
    raise RuntimeError(f'Timed out waiting for {label}. Accessibility: {last[:120]}')

def button(name):
    for text, role, _, obj in accessible():
        if (text == name or text.startswith(name+' (') or text.startswith(name+' ·')) and role in ('push button', 'button', 'link'):
            return obj

def click(name):
    obj = until(lambda: button(name), name)
    action = obj.queryAction()
    assert action.doAction(0), name
    print(f'UI clicked {name!r}', flush=True)

def visible(needle):
    return any(needle in (n+' '+t) for n, r, t, _ in accessible() if r not in ('application', 'frame'))

def digest(path):
    with path.open('rb') as f:
        h=hashlib.sha256()
        for chunk in iter(lambda: f.read(4<<20), b''): h.update(chunk)
        return h.hexdigest()

try:
    print('Running', program, 'pid', app.pid, flush=True)
    click('Settings')
    if mode == 'smoke':
        until(lambda: visible('Masame '+version), f'version {version} in Settings')
        print(f'Interactive settings opened and displayed version {version}', flush=True)
    elif mode == 'update':
        until(lambda: visible('Masame '+version+' is available'), 'published update offered', 110)
        click('Install')
        expected = rest[0]
        until(lambda: digest(program) == expected, 'on-disk AppImage reaching official SHA256', 180)
        print('AppImage replaced at original path; SHA256 =', expected, flush=True)
        until(lambda: button('Settings'), 'restarted Masame window', 90)
        click('Settings')
        until(lambda: visible('Masame '+version), 'updated app reporting its version in Settings')
        print('Updated app relaunched itself, version', version, flush=True)
    else: raise ValueError(mode)
finally:
    try: os.killpg(app.pid, signal.SIGTERM)
    except ProcessLookupError: pass
    log.flush(); log.seek(0)
    print('GTK log:',log.read()[-4000:])
