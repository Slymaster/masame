"""Operate the unmodified installed GTK/WebKit application over desktop accessibility."""
import hashlib
import os
from pathlib import Path
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

def actual_version():
    marker = 'Masame '+version
    for n, r, t, _ in accessible():
        if r in ('application', 'frame'): continue
        for text in (n.strip(), t.strip()):
            if text == marker or text.startswith(marker+' ·') or text == marker+' is up to date':
                return text

def restarted_version():
    evidence=actual_version()
    if evidence: return evidence
    if any(r=='dialog' for _,r,_,_ in accessible()): return
    settings=button('Settings')
    if settings: settings.queryAction().doAction(0)

def digest(path):
    with path.open('rb') as f:
        h=hashlib.sha256()
        for chunk in iter(lambda: f.read(4<<20), b''): h.update(chunk)
        return h.hexdigest()

try:
    print('Running', program, 'pid', app.pid, flush=True)
    click('Settings')
    if mode == 'smoke':
        title=until(actual_version, f'installed version {version} in Settings')
        print(f'Interactive settings opened and displayed {title!r}', flush=True)
    elif mode == 'update':
        until(lambda: visible('Masame '+version+' is available'), 'published update offered', 110)
        click('Install')
        expected = rest[0]
        until(lambda: digest(program) == expected, 'on-disk AppImage reaching official SHA256', 180)
        print('AppImage replaced at original path; SHA256 =', expected, flush=True)
        title=until(restarted_version, 'restarted app reporting installed version in Settings', 90)
        print('Updated app relaunched itself, version evidence:', repr(title), flush=True)
    else: raise ValueError(mode)
finally:
    try: os.killpg(app.pid, signal.SIGTERM)
    except ProcessLookupError: pass
    log.flush(); log.seek(0)
    print('GTK log:',log.read()[-4000:])
