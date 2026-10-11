#!/usr/bin/env bash
# Regenerate docs/images (README pictures) from design/screenshots (local, git-ignored PNGs).
# JPEG q~82-ish, max 1600 px wide (hero: 1800). Optional third column: an ffmpeg crop/pad applied first. Missing sources are reported and skipped.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/design/screenshots"; OUT="$ROOT/docs/images"
FFMPEG="$(command -v ffmpeg || echo /opt/local/bin/ffmpeg)"
mkdir -p "$OUT"
while read -r in out crop; do
  [ -f "$SRC/$in" ] || { echo "missing: $in"; continue; }
  "$FFMPEG" -v error -y -i "$SRC/$in" -vf "${crop:+$crop,}scale='min(${W:-1600},iw)':-2" -q:v 5 "$OUT/$out" </dev/null && echo "ok: $out"
done <<'LIST'
app3d-study-en.png study-en.jpg
app3d-contemplation-en.png contemplation-en.jpg
app3d-territory-en.png territory-en.jpg
app3d-counting-en.png counting-en.jpg
app3d-light2d-en.png light-2d-en.jpg
i18n-reseaux-en.png networks-en.jpg
app3d-study-fr.png study-fr.jpg
app3d-contemplation-fr.png contemplation-fr.jpg
app3d-counting-fr.png counting-fr.jpg
app3d-light2d-fr.png light-2d-fr.jpg
i18n-reseaux-fr.png networks-fr.jpg
board3d-ombre-lumiere.png light-and-shadow.jpg pad=2880:1800:250:0:0xECE4D6
LIST
# Hero: the evening Contemplation board, cropped to 16:9 around the board and bowls.
W=1800 "$FFMPEG" -v error -y -i "$SRC/board3d-contemplation-evening.png" -vf "crop=2380:1339:0:250,scale=1800:-2" -q:v 3 "$OUT/hero.jpg" </dev/null && echo "ok: hero.jpg"
