#!/usr/bin/env bash
set -eu -o pipefail
version=$1
kind=$2
base="https://github.com/Slymaster/masame/releases/download/v$version"
target="$PWD/download/$version"
mkdir -p "$target"
cd "$target"
case "$kind" in
 appimage) asset="Masame_${version}_amd64.AppImage";;
 deb) asset="Masame_${version}_amd64.deb";;
 rpm) asset="Masame-${version}-1.x86_64.rpm";;
 *) exit 2;;
esac
fetch() { curl -fLSs --retry 4 --retry-all-errors "$base/$1" -o "$1"; }
fetch SHA256SUMS.txt
fetch "$asset"
awk -v name="$asset" '$2 == name {print; n++} END {if(n != 1) exit 1}' SHA256SUMS.txt | sha256sum -c -
