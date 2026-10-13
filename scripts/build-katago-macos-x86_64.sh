#!/usr/bin/env bash
# Build KataGo for Intel Macs (x86_64) as two Tauri sidecars, in the variants the app picks from at run time
# (src-tauri/src/backend.rs):
#   src-tauri/binaries/katago-opencl-x86_64-apple-darwin  OpenCL backend (GPU, through the system's OpenCL.framework)
#   src-tauri/binaries/katago-eigen-x86_64-apple-darwin   Eigen CPU backend, no AVX2/FMA, so it also runs under Rosetta
# linking only /usr/lib and /System/Library. Runs on an Intel Mac or cross-compiles on Apple Silicon. The x86_64 app
# bundles them with: pnpm tauri build --target x86_64-apple-darwin --config src-tauri/tauri.macos-x86_64.conf.json
# Requires: Xcode command line tools (AppleClang), cmake, ninja, curl, git.
set -euo pipefail

KATAGO_TAG="v1.18.2"
KATAGO_COMMIT="fd0723fdbc0e9d82cf269c9630af8c27c57c07c4" # = KATAGO_TAG, same as scripts/build-katago.sh; any other commit fails
EIGEN_VER="3.4.0"
EIGEN_SHA256="8586084f71f9bde545ee7fa6d00288b264a2b7ac3607b974e54d13e7162c1c72"
DEPLOY="13.0" # = bundle.macOS.minimumSystemVersion
ARCH="x86_64"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$ROOT/vendor"
SRC="$VENDOR/KataGo"
DL="$VENDOR/dl"
EIGEN="$VENDOR/eigen-$EIGEN_VER"
OUT="$ROOT/src-tauri/binaries"

die() { echo "build-katago-macos-x86_64: $*" >&2; exit 1; }

[ "$(uname -s)" = Darwin ] || die "macOS only"
for tool in cmake ninja curl git; do
  command -v "$tool" >/dev/null || die "'$tool' not found on PATH (e.g. brew install $tool)"
done

export CC=/usr/bin/clang CXX=/usr/bin/clang++
unset CPATH CPLUS_INCLUDE_PATH LIBRARY_PATH MACOSX_DEPLOYMENT_TARGET || true

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
[ "$actual" = "$KATAGO_COMMIT" ] || die "vendor/KataGo is at '$actual', expected $KATAGO_COMMIT ($KATAGO_TAG)"
git -C "$SRC" diff --quiet HEAD -- || die "vendor/KataGo has local changes to tracked files"

# variant  extra cmake args...
build() {
  local variant="$1"; shift
  local dir="$SRC/cpp/build-macos-$ARCH-$variant" bin="$OUT/katago-$variant-$ARCH-apple-darwin"
  # LIBZIP_LIBRARY=OFF: skip find_library so CMake defines NO_LIBZIP (zip is only for selfplay data).
  cmake -S "$SRC/cpp" -B "$dir" -G Ninja -DCMAKE_BUILD_TYPE=Release -DLIBZIP_LIBRARY=OFF \
    -DCMAKE_OSX_ARCHITECTURES="$ARCH" -DCMAKE_OSX_DEPLOYMENT_TARGET="$DEPLOY" \
    -DCMAKE_IGNORE_PREFIX_PATH="/opt/homebrew;/usr/local;/opt/local" -DCMAKE_FIND_USE_PACKAGE_REGISTRY=OFF "$@"
  cmake --build "$dir" --target katago
  mkdir -p "$OUT"
  cp "$dir/katago" "$bin"
  /usr/bin/strip -x "$bin"
  otool -l "$bin" | awk '/LC_RPATH/{f=1} f&&/ path /{print $2; f=0}' | while read -r rp; do
    install_name_tool -delete_rpath "$rp" "$bin" 2>/dev/null
  done
  codesign --force --sign - "$bin"
}

build opencl -DUSE_BACKEND=OPENCL
# No USE_AVX2: plain x86_64 (SSE) code for every Intel Mac and for Rosetta. EIGEN_MPL2_ONLY: compiling any
# LGPL-licensed part of Eigen is an error, so the binary only carries MPL-2.0 Eigen code.
build eigen -DUSE_BACKEND=EIGEN -DEIGEN3_INCLUDE_DIRS="$EIGEN" -DCMAKE_CXX_FLAGS=-DEIGEN_MPL2_ONLY

# Checks: runs (under Rosetta on Apple Silicon), x86_64 only, system libraries only, expected minos.
for variant in opencl eigen; do
  bin="$OUT/katago-$variant-$ARCH-apple-darwin"
  "$bin" version
  [ "$(lipo -archs "$bin")" = "$ARCH" ] || die "$variant is not $ARCH only: $(lipo -archs "$bin")"
  echo "--- $variant linked libraries:"
  otool -L "$bin"
  bad="$(otool -L "$bin" | tail -n +2 | awk '{print $1}' | grep -v -E '^(/usr/lib/|/System/Library/)' || true)"
  [ -z "$bad" ] || die "$variant links non-system libraries: $bad"
  minos="$(otool -l "$bin" | awk '/LC_BUILD_VERSION/{f=1} f&&/minos/{print $2; exit}')"
  [ "$minos" = "$DEPLOY" ] || die "$variant minos is $minos, expected $DEPLOY"
  echo "--- OK: $variant $(du -h "$bin" | cut -f1) $ARCH, minos $minos, system libraries only"
done
