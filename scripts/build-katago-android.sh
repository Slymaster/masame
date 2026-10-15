#!/usr/bin/env bash
# Build KataGo (Eigen CPU backend) for Android arm64-v8a as a PIE executable named libkatago.so:
#   $MASAME_VENDOR/katago-android/arm64-v8a/libkatago.so
# The APK ships it in jniLibs/arm64-v8a so Android extracts it into nativeLibraryDir (legacy packaging),
# the one app directory it may be executed from; the engine code spawns it from there.
# Runs on macOS or Linux. Requires: Android NDK (ANDROID_NDK, default below), cmake, ninja, curl, git.
# See docs/katago-benchmark.md.
set -euo pipefail

KATAGO_TAG="v1.18.2"
KATAGO_COMMIT="fd0723fdbc0e9d82cf269c9630af8c27c57c07c4" # = KATAGO_TAG, same as scripts/build-katago.sh; any other commit fails
EIGEN_VER="3.4.0"
EIGEN_SHA256="8586084f71f9bde545ee7fa6d00288b264a2b7ac3607b974e54d13e7162c1c72" # same as scripts/build-katago-macos-x86_64.sh
NDK_VER="27.2.12479018"
API="24" # = Tauri 2's Android minSdk
ABI="arm64-v8a"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="${MASAME_VENDOR:-$ROOT/vendor}"
SRC="$VENDOR/KataGo"
DL="$VENDOR/dl"
EIGEN="$VENDOR/eigen-$EIGEN_VER"
BUILD="$SRC/cpp/build-android-arm64"
OUT="$VENDOR/katago-android/$ABI/libkatago.so"
NDK="${ANDROID_NDK:-${ANDROID_HOME:-$HOME/Library/Android/sdk}/ndk/$NDK_VER}"

die() { echo "build-katago-android: $*" >&2; exit 1; }

for tool in cmake ninja curl git; do
  command -v "$tool" >/dev/null || die "'$tool' not found on PATH"
done
[ -f "$NDK/build/cmake/android.toolchain.cmake" ] || die "Android NDK $NDK_VER not found at $NDK (set ANDROID_NDK)"
grep -q "Pkg.Revision = $NDK_VER" "$NDK/source.properties" || die "$NDK is not NDK $NDK_VER"
LLVM="$(echo "$NDK"/toolchains/llvm/prebuilt/*/bin)"

# Eigen (header-only) from a pinned, checksummed tarball.
if [ ! -d "$EIGEN/Eigen" ]; then
  mkdir -p "$DL"
  file="$DL/eigen-$EIGEN_VER.tar.gz"
  [ -f "$file" ] || { curl -fsSL --retry 3 -o "$file.part" "https://gitlab.com/libeigen/eigen/-/archive/$EIGEN_VER/eigen-$EIGEN_VER.tar.gz" && mv "$file.part" "$file"; }
  got="$(shasum -a 256 "$file" | cut -d' ' -f1)"
  [ "$got" = "$EIGEN_SHA256" ] || { rm -f "$file"; die "sha256 mismatch for $file: got $got, expected $EIGEN_SHA256 (file deleted, rerun)"; }
  tar -xzf "$file" -C "$VENDOR"
fi

if [ ! -d "$SRC/.git" ]; then
  mkdir -p "$VENDOR"
  git clone --depth 1 --branch "$KATAGO_TAG" https://github.com/lightvector/KataGo.git "$SRC"
fi
actual="$(git -C "$SRC" rev-parse HEAD 2>/dev/null || true)"
[ "$actual" = "$KATAGO_COMMIT" ] || die "$SRC is at '$actual', expected $KATAGO_COMMIT ($KATAGO_TAG)"
git -C "$SRC" diff --quiet HEAD -- || die "$SRC has local changes to tracked files"

# LIBZIP_LIBRARY=OFF: CMake defines NO_LIBZIP (zip is only for selfplay data). zlib is the NDK sysroot's libz.so,
# a system library on every Android. c++_static: no libc++_shared.so to ship next to the executable.
# No USE_AVX2 (x86 only): aarch64 Eigen uses NEON. EIGEN_MPL2_ONLY: compiling any LGPL part of Eigen is an error.
# -include endian.h: core/sha2.cpp needs BYTE_ORDER, which bionic's <sys/types.h> doesn't pull in (glibc's does).
cmake -S "$SRC/cpp" -B "$BUILD" -G Ninja -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_TOOLCHAIN_FILE="$NDK/build/cmake/android.toolchain.cmake" \
  -DANDROID_ABI="$ABI" -DANDROID_PLATFORM="android-$API" -DANDROID_STL=c++_static \
  -DUSE_BACKEND=EIGEN -DEIGEN3_INCLUDE_DIRS="$EIGEN" -DCMAKE_CXX_FLAGS="-DEIGEN_MPL2_ONLY -include endian.h" \
  -DLIBZIP_LIBRARY=OFF
cmake --build "$BUILD" --target katago

mkdir -p "$(dirname "$OUT")"
"$LLVM/llvm-strip" --strip-all -o "$OUT" "$BUILD/katago"

# Checks: aarch64 PIE executable, Android system libraries only. (Outputs go to variables first: grep -q on a
# pipe would SIGPIPE readelf and trip pipefail.)
hdr="$("$LLVM/llvm-readelf" -h "$OUT")"; prog="$("$LLVM/llvm-readelf" -l "$OUT")"; dyn="$("$LLVM/llvm-readelf" -d "$OUT")"
grep -q "Machine: *AArch64" <<<"$hdr" || die "not AArch64"
grep -q "FLAGS_1.*PIE" <<<"$dyn" || die "not a PIE"
grep -q "program interpreter: /system/bin/linker64" <<<"$prog" || die "no /system/bin/linker64 interpreter: not an executable"
needed="$(awk '/NEEDED/{gsub(/[\[\]]/,"",$NF); print $NF}' <<<"$dyn")"
echo "--- NEEDED: $(echo $needed)"
bad="$(echo "$needed" | grep -v -x -E 'lib(c|m|dl|log|z)\.so' || true)"
[ -z "$bad" ] || die "non-system libraries needed: $bad"
echo "--- OK: $OUT $(du -h "$OUT" | cut -f1), aarch64 PIE, android-$API, system libraries only"
