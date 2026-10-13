#!/usr/bin/env bash
# List the system libraries an AppImage bundles (WebKitGTK, GTK, GLib...: many under the LGPL), with the Ubuntu package
# and version each comes from and that package's copyright file, so the matching sources can be obtained.
# Run on the machine that built the AppImage (CI: Ubuntu 22.04), since packages are looked up in its dpkg database.
# Usage: scripts/linux-appimage-libraries.sh <file.AppImage> <output.txt>
set -euo pipefail

die() { echo "linux-appimage-libraries: $*" >&2; exit 1; }
[ $# -eq 2 ] || die "usage: $0 <file.AppImage> <output.txt>"
appimage="$(realpath "$1")"
out="$2"
[ -f "$appimage" ] || die "no such file: $1"
command -v dpkg-query >/dev/null || die "needs a Debian/Ubuntu system (dpkg)"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
(cd "$tmp" && "$appimage" --appimage-extract >/dev/null)
root="$tmp/squashfs-root"
[ -d "$root" ] || die "extraction failed"

# Shared libraries, plus helper executables shipped under usr/lib (WebKit's web and network processes).
declare -A pkg_files=()
unowned=()
while IFS= read -r f; do
  rel="${f#"$root"}"
  base="$(basename "$f")"
  # The owning package: a dpkg path ending in the same file name ("pkg:arch: /path" lines; skip diversions).
  pkg="$(dpkg -S "*/$base" 2>/dev/null | grep -v '^diversion' | awk -v b="/$base" '{ p = $NF; if (substr(p, length(p) - length(b) + 1) == b) { sub(/[:,].*/, "", $1); print $1; exit } }' || true)"
  if [ -n "$pkg" ]; then pkg_files[$pkg]+="  $rel"$'\n'; else unowned+=("$rel"); fi
done < <(find "$root/usr/lib" "$root/usr/lib64" -type f \( -name '*.so' -o -name '*.so.*' -o -perm -u+x \) 2>/dev/null | sort)
[ ${#pkg_files[@]} -gt 0 ] || die "no bundled library maps to an Ubuntu package"

{
  echo "Libraries bundled in $(basename "$appimage")"
  echo
  echo "The AppImage carries these files from Ubuntu $(sed -n 's/^VERSION_ID="\(.*\)"/\1/p' /etc/os-release) packages, unmodified, so that it"
  echo "runs on other distributions. Each package is listed with its version, the files taken from it, and its"
  echo "copyright file (licence terms). Many are under the GNU LGPL; their complete corresponding source code is"
  echo "available from Ubuntu, for example:"
  echo
  echo "  apt-get source <package>=<version>"
  echo "  https://launchpad.net/ubuntu/+source/<source package>"
  echo
  echo "Masame does not modify these libraries. You may replace them: extract the AppImage"
  echo "(--appimage-extract), swap the files in squashfs-root/usr/lib, and run squashfs-root/AppRun."
  echo
  echo "Packages"
  echo "========"
  for pkg in $(printf '%s\n' "${!pkg_files[@]}" | sort); do
    IFS=' ' read -r ver src srcver <<<"$(dpkg-query -W -f='${Version} ${source:Package} ${source:Version}' "$pkg")"
    echo
    echo "$pkg $ver (source package $src $srcver: https://launchpad.net/ubuntu/+source/$src/$srcver)"
    printf '%s' "${pkg_files[$pkg]}"
  done
  if [ ${#unowned[@]} -gt 0 ]; then
    echo
    echo "Not from an Ubuntu package (Masame's own files, see the licences in the app's resources)"
    printf '  %s\n' "${unowned[@]}"
  fi
  for pkg in $(printf '%s\n' "${!pkg_files[@]}" | sort); do
    echo
    echo "================================================================================"
    echo "$pkg: /usr/share/doc/$pkg/copyright"
    echo "================================================================================"
    cat "/usr/share/doc/$pkg/copyright" 2>/dev/null || echo "(no copyright file installed)"
  done
} >"$out"
echo "linux-appimage-libraries: ${#pkg_files[@]} packages, ${#unowned[@]} other files -> $out"
