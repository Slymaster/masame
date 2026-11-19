#!/bin/bash
set -euo pipefail
version=$1
case "$(uname -m)" in
  arm64) arch=aarch64 ;;
  x86_64) arch=x64 ;;
  *) exit 1 ;;
esac
assets="$RUNNER_TEMP/$version"
mkdir -p "$assets"
cd "$assets"
name="Masame_${version}_${arch}.dmg"
base="https://github.com/Slymaster/masame/releases/download/v$version"
curl --retry 3 -fLsS "$base/$name" -o "$name"
curl --retry 3 -fLsS "$base/SHA256SUMS.txt" -o sums
awk -v f="$name" '$2 == f' sums > expected
test "$(wc -l < expected | tr -d ' ')" = 1
shasum -a 256 -c expected
mount="$assets/mounted"
mkdir -p "$mount"
hdiutil attach -nobrowse -readonly -mountpoint "$mount" "$name"
trap 'hdiutil detach "$mount"' EXIT
test ! -e /Applications/Masame.app
ditto "$mount/Masame.app" /Applications/Masame.app
test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' /Applications/Masame.app/Contents/Info.plist)" = "$version"
codesign --verify --strict --deep /Applications/Masame.app
spctl --assess --type execute -vv /Applications/Masame.app
lipo -archs /Applications/Masame.app/Contents/MacOS/masame
