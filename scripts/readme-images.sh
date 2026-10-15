#!/usr/bin/env bash
# Regenerate docs/images (README pictures) from design/screenshots (local, git-ignored PNGs; SRC=dir reads them elsewhere, e.g. from a worktree).
# JPEG q~82-ish, max 1600 px wide (hero: 1800). Optional third column: an ffmpeg crop/pad applied first. Missing sources are reported and skipped.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${SRC:-$ROOT/design/screenshots}"; OUT="$ROOT/docs/images"
FFMPEG="$(command -v ffmpeg || echo /opt/local/bin/ffmpeg)"
mkdir -p "$OUT"
while read -r in out crop; do
  [ -f "$SRC/$in" ] || { echo "missing: $in"; continue; }
  "$FFMPEG" -v error -y -i "$SRC/$in" -vf "${crop:+$crop,}scale='min(${W:-1600},iw)':-2" -q:v 5 "$OUT/$out" </dev/null && echo "ok: $out"
done <<'LIST'
v05-study-en.png study-en.jpg
v05-contemplation-en.png contemplation-en.jpg
v05-joseki-en.png joseki-en.jpg
v05-variations-en.png variations-en.jpg
v05-learn-en.png learn-en.jpg
v05-progress-en.png progress-en.jpg
v05-games-en.png games-en.jpg
v05-tsumego-en.png tsumego-en.jpg
v05-count-en.png count-en.jpg
v05-classics-en.png classics-en.jpg
v05-kifu-en.png kifu-en.jpg
v05-review-en.png review-en.jpg
v05-counting-en.png counting-en.jpg
v05-light-2d-en.png light-2d-en.jpg
v05-ogs-en.png ogs-en.jpg
i18n-reseaux-en.png networks-en.jpg
v05-study-fr.png study-fr.jpg
v05-contemplation-fr.png contemplation-fr.jpg
v05-joseki-fr.png joseki-fr.jpg
v05-variations-fr.png variations-fr.jpg
v05-learn-fr.png learn-fr.jpg
v05-progress-fr.png progress-fr.jpg
v05-games-fr.png games-fr.jpg
v05-tsumego-fr.png tsumego-fr.jpg
v05-count-fr.png count-fr.jpg
v05-classics-fr.png classics-fr.jpg
v05-kifu-fr.png kifu-fr.jpg
v05-review-fr.png review-fr.jpg
v05-counting-fr.png counting-fr.jpg
v05-light-2d-fr.png light-2d-fr.jpg
v05-ogs-fr.png ogs-fr.jpg
i18n-reseaux-fr.png networks-fr.jpg
board3d-ombre-lumiere.png light-and-shadow.jpg pad=2880:1800:250:0:0xECE4D6
LIST
# Hero: the evening Contemplation board, cropped to 16:9 around the board and bowls.
W=1800 "$FFMPEG" -v error -y -i "$SRC/board3d-contemplation-evening.png" -vf "crop=2380:1339:0:250,scale=1800:-2" -q:v 3 "$OUT/hero.jpg" </dev/null && echo "ok: hero.jpg"
