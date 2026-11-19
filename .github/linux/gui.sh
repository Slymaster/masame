#!/usr/bin/env bash
set -eu -o pipefail
export LANG=C.UTF-8 LC_ALL=C.UTF-8 NO_AT_BRIDGE=0 GTK_MODULES=gail:atk-bridge
export LIBGL_ALWAYS_SOFTWARE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 GDK_BACKEND=x11
case "${CONTAINER_FEDORA:-0}" in 1) export WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1;; esac
export XDG_CONFIG_HOME="$(mktemp -d)" XDG_DATA_HOME="$(mktemp -d)" XDG_CACHE_HOME="$(mktemp -d)" XDG_RUNTIME_DIR="$(mktemp -d)"
dbus-run-session -- xvfb-run -a -s '-screen 0 1600x1000x24' sh -ec '
  gsettings set org.gnome.desktop.interface toolkit-accessibility true
  exec /usr/bin/python3 "$@"
' sh .github/linux/gui.py "$@"
