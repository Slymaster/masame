#!/bin/sh
# The Android launcher icon from src-tauri/icons/icon.svg, matching the iPhone one (kaya to the edges, the two stones):
# the adaptive foreground is the kaya and its grid over the whole layer, the stones drawn small enough to stay whole
# inside the 66 dp safe circle every launcher mask keeps; the legacy icons (Android 7) are the same, cut round or square.
# Needs rsvg-convert (librsvg) and ImageMagick. Run from anywhere: sh scripts/android-icon.sh
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
res=$root/src-tauri/gen/android/app/src/main/res
svg=$root/src-tauri/icons/icon.svg
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
for s in '<rect x="100" y="100" width="824" height="824" rx="185" fill="url(#k)"/>' '<path d="M300 100V924M512 100V924M724 100V924M100 300H924M100 512H924M100 724H924"/>'; do
  grep -qF "$s" "$svg" || { echo "icon.svg: $s is not where this script expects it" >&2; exit 1; }
done
# the 824-unit tile becomes 60 of the layer's 108 dp, so the white stone (453 units from the centre) ends inside 33 dp;
# the layer's 1483 units around the centre, the grid continued at its 212-unit pitch
grid=$(for v in -124 88 300 512 724 936 1148; do printf 'M%s -230V1254M-230 %sH1254' "$v" "$v"; done)
sed -e 's/viewBox="0 0 1024 1024"/viewBox="-229.6 -229.6 1483.2 1483.2"/' \
    -e "s|<rect x=\"100\" y=\"100\" width=\"824\" height=\"824\" rx=\"185\" fill=\"url(#k)\"/>|<rect x=\"-230\" y=\"-230\" width=\"1484\" height=\"1484\" fill=\"url(#k)\"/>|" \
    -e "s|<path d=\"M300 100V924M512 100V924M724 100V924M100 300H924M100 512H924M100 724H924\"/>|<path d=\"$grid\"/>|" "$svg" > "$tmp/layer.svg"
for d in mdpi:1 hdpi:1.5 xhdpi:2 xxhdpi:3 xxxhdpi:4; do
  dir=$res/mipmap-${d%%:*} m=${d#*:}
  fg=$(awk "BEGIN { print int(108 * $m) }") legacy=$(awk "BEGIN { print int(48 * $m) }")
  rsvg-convert -w "$fg" -h "$fg" "$tmp/layer.svg" -o "$tmp/fg.png"
  magick "$tmp/fg.png" -strip "PNG32:$dir/ic_launcher_foreground.png"
  # legacy: the visible 72 of the 108 dp, cut to a circle and to a rounded square
  magick "$tmp/fg.png" -gravity center -crop "$((fg * 2 / 3))x$((fg * 2 / 3))+0+0" +repage -resize "${legacy}x${legacy}" "$tmp/l.png"
  magick "$tmp/l.png" \( -size "${legacy}x${legacy}" xc:none -fill white -draw "circle $((legacy / 2)),$((legacy / 2)) $((legacy / 2)),1" \) -compose CopyOpacity -composite -strip "PNG32:$dir/ic_launcher_round.png"
  magick "$tmp/l.png" \( -size "${legacy}x${legacy}" xc:none -fill white -draw "roundrectangle 0,0,$((legacy - 1)),$((legacy - 1)),$((legacy / 5)),$((legacy / 5))" \) -compose CopyOpacity -composite -strip "PNG32:$dir/ic_launcher.png"
done
