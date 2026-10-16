#!/bin/sh
# The iPhone app icon (every PNG of AppIcon.appiconset, at its current size) from src-tauri/icons/icon.svg: the desktop
# tile scaled to fill the square, since iOS cuts its own corners, and opaque, since the App Store refuses transparency.
# Needs rsvg-convert (librsvg) and ImageMagick. Run from anywhere: sh scripts/ios-icon.sh
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
set_dir=$root/src-tauri/gen/apple/Assets.xcassets/AppIcon.appiconset
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
# the tile (x, y 100–924 in icon.svg) as the whole view, its corners square (iOS rounds them itself)
tile='<rect x="100" y="100" width="824" height="824" rx="185" fill="url(#k)"/>'
grep -qF "$tile" "$root/src-tauri/icons/icon.svg" || { echo "icon.svg: the tile is not where this script expects it" >&2; exit 1; }
sed -e 's/viewBox="0 0 1024 1024"/viewBox="100 100 824 824"/' -e 's/ rx="185"//' "$root/src-tauri/icons/icon.svg" > "$tmp/full.svg"
for f in "$set_dir"/*.png; do
  w=$(magick identify -format %w "$f")
  rsvg-convert -w "$w" -h "$w" "$tmp/full.svg" -o "$tmp/i.png"
  magick "$tmp/i.png" -background '#C99A52' -alpha remove -alpha off -strip "PNG24:$f"
done
