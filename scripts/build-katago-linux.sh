#!/usr/bin/env bash
# Build KataGo for Linux x86_64 from source, in the two variants the app picks from at run time (src-tauri/src/backend.rs):
#   src-tauri/resources/katago-linux/opencl/katago     OpenCL backend (GPU, through the system's OpenCL loader)
#   src-tauri/resources/katago-linux/eigenavx2/katago  Eigen CPU backend, AVX2 + FMA
# linking only system libraries (glibc, libstdc++, zlib, and the OpenCL loader for the GPU build). The official Linux
# release zips hold AppImages, which cannot serve as a bundled engine. Built on Ubuntu 22.04 in CI (glibc 2.35 baseline).
# Requires: g++, cmake, ninja, git, zlib1g-dev, libeigen3-dev, ocl-icd-opencl-dev, opencl-headers, binutils (readelf).
set -euo pipefail

KATAGO_TAG="v1.18.2"
KATAGO_COMMIT="fd0723fdbc0e9d82cf269c9630af8c27c57c07c4" # = KATAGO_TAG, same as scripts/build-katago.sh; any other commit fails

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$ROOT/vendor"
SRC="$VENDOR/KataGo"
OUT="$ROOT/src-tauri/resources/katago-linux"

die() { echo "build-katago-linux: $*" >&2; exit 1; }

[ "$(uname -s)" = Linux ] || die "Linux only"
[ "$(uname -m)" = x86_64 ] || die "x86_64 only"
for tool in g++ cmake ninja git readelf strip; do
  command -v "$tool" >/dev/null || die "'$tool' not found on PATH"
done

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
  local dir="$SRC/cpp/build-linux-$variant"
  # LIBZIP_LIBRARY=OFF: skip find_library so CMake defines NO_LIBZIP (zip is only for selfplay data).
  cmake -S "$SRC/cpp" -B "$dir" -G Ninja -DCMAKE_BUILD_TYPE=Release -DLIBZIP_LIBRARY=OFF "$@"
  cmake --build "$dir" --target katago
  install -D -m 0755 "$dir/katago" "$OUT/$variant/katago"
  strip "$OUT/$variant/katago"
}

build opencl -DUSE_BACKEND=OPENCL
# EIGEN_MPL2_ONLY: compiling any LGPL-licensed part of Eigen is an error, so the binary only carries MPL-2.0 Eigen code.
build eigenavx2 -DUSE_BACKEND=EIGEN -DUSE_AVX2=1 -DCMAKE_CXX_FLAGS=-DEIGEN_MPL2_ONLY

# Checks: runs, and links nothing beyond the system libraries above (glibc 2.34+ has libpthread/libdl merged into libc).
for variant in opencl eigenavx2; do
  bin="$OUT/$variant/katago"
  "$bin" version
  allowed="libz.so.1 libstdc++.so.6 libm.so.6 libgcc_s.so.1 libc.so.6"
  [ "$variant" = opencl ] && allowed="$allowed libOpenCL.so.1"
  echo "--- $variant linked libraries:"
  needed="$(readelf -d "$bin" | sed -n 's/.*(NEEDED).*\[\(.*\)\]/\1/p')"
  echo "$needed"
  for lib in $needed; do
    case " $allowed " in *" $lib "*) ;; *) die "$variant links an unexpected library: $lib" ;; esac
  done
  if readelf -d "$bin" | grep -qE '\((RPATH|RUNPATH)\)'; then die "$variant has an RPATH/RUNPATH"; fi
  echo "--- OK: $variant $(du -h "$bin" | cut -f1)"
done
