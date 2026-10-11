#!/usr/bin/env bash
# Build KataGo (Metal backend, Apple Silicon) as a self-contained Tauri sidecar:
# src-tauri/binaries/katago-aarch64-apple-darwin, linking only /usr/lib and /System/Library.
#
# protobuf + abseil (needed by the Metal backend's CoreML converter) are built from pinned
# sources as static libs into vendor/deps, together with a matching protoc.
# Requires: Xcode (AppleClang + Swift >= 5.9), cmake, ninja, pkg-config, curl, git.
# See docs/katago-benchmark.md.
set -euo pipefail

KATAGO_TAG="v1.18.2"
KATAGO_COMMIT="fd0723fdbc0e9d82cf269c9630af8c27c57c07c4" # = KATAGO_TAG; the build fails on any other commit (tags can move)
ABSL_VER="20240722.0"
ABSL_SHA256="f50e5ac311a81382da7fa75b97310e4b9006474f9560ac46f54a9967f07d4ae3"
PROTOBUF_VER="29.3"
PROTOBUF_SHA256="008a11cc56f9b96679b4c285fd05f46d317d685be3ab524b2a310be0fbad987e"
# Lowest target KataGo's Metal/Swift code compiles for (see doc). Override for experiments only.
DEPLOY="${KATAGO_MACOS_DEPLOYMENT_TARGET:-13.0}"
ARCH="arm64"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$ROOT/vendor"
SRC="$VENDOR/KataGo"
BUILD="$SRC/cpp/build-metal"
DL="$VENDOR/dl"
DEPS_BUILD="$VENDOR/deps-build"
DEPS="$VENDOR/deps"
OUT="$ROOT/src-tauri/binaries/katago-aarch64-apple-darwin"

die() { echo "build-katago: $*" >&2; exit 1; }

[ "$(uname -s)" = Darwin ] || die "macOS only"
xcrun --find swiftc >/dev/null 2>&1 || die "Xcode (with Swift) is required: xcode-select --install or install Xcode"
for tool in cmake ninja pkg-config curl git; do
  command -v "$tool" >/dev/null || die "'$tool' not found on PATH (e.g. brew install $tool)"
done

# Pin toolchain: plain /usr/bin/clang++ (AppleClang) and the first pkg-config on PATH, but
# pkg-config only sees vendor/deps (avoids Homebrew/Anaconda/MacPorts protobuf leaking in).
export CC=/usr/bin/clang CXX=/usr/bin/clang++
export PKG_CONFIG_LIBDIR="$DEPS/lib/pkgconfig" PKG_CONFIG_PATH=""
unset CPATH CPLUS_INCLUDE_PATH LIBRARY_PATH MACOSX_DEPLOYMENT_TARGET || true
COMMON_CMAKE=(-G Ninja
  -DCMAKE_BUILD_TYPE=Release
  -DCMAKE_OSX_ARCHITECTURES="$ARCH"
  -DCMAKE_OSX_DEPLOYMENT_TARGET="$DEPLOY"
  -DCMAKE_IGNORE_PREFIX_PATH="/opt/homebrew;/usr/local;/opt/local"
  -DCMAKE_FIND_USE_PACKAGE_REGISTRY=OFF)

fetch() { # url file sha256 -> verified tarball in $DL
  local url="$1" file="$DL/$2" sha="$3"
  mkdir -p "$DL"
  if [ ! -f "$file" ]; then
    curl -fsSL --retry 3 -o "$file.part" "$url" || die "download failed: $url"
    mv "$file.part" "$file"
  fi
  local got; got="$(shasum -a 256 "$file" | cut -d' ' -f1)"
  [ "$got" = "$sha" ] || { rm -f "$file"; die "sha256 mismatch for $2: got $got, expected $sha (file deleted, rerun)"; }
}

# --- 1. Static abseil + protobuf (+ utf8_range, protoc) in vendor/deps, cached by stamp ---
STAMP="absl-$ABSL_VER protobuf-$PROTOBUF_VER macos-$DEPLOY $ARCH"
if [ "$(cat "$DEPS/.stamp" 2>/dev/null)" != "$STAMP" ]; then
  echo "--- building static deps: $STAMP"
  fetch "https://github.com/abseil/abseil-cpp/archive/refs/tags/$ABSL_VER.tar.gz" "abseil-cpp-$ABSL_VER.tar.gz" "$ABSL_SHA256"
  fetch "https://github.com/protocolbuffers/protobuf/archive/refs/tags/v$PROTOBUF_VER.tar.gz" "protobuf-$PROTOBUF_VER.tar.gz" "$PROTOBUF_SHA256"
  rm -rf "$DEPS" "$DEPS_BUILD"
  mkdir -p "$DEPS_BUILD/src"
  tar -xzf "$DL/abseil-cpp-$ABSL_VER.tar.gz" -C "$DEPS_BUILD/src"
  tar -xzf "$DL/protobuf-$PROTOBUF_VER.tar.gz" -C "$DEPS_BUILD/src"

  cmake -S "$DEPS_BUILD/src/abseil-cpp-$ABSL_VER" -B "$DEPS_BUILD/absl" "${COMMON_CMAKE[@]}" \
    -DCMAKE_INSTALL_PREFIX="$DEPS" -DBUILD_SHARED_LIBS=OFF -DBUILD_TESTING=OFF \
    -DCMAKE_CXX_STANDARD=17 -DABSL_PROPAGATE_CXX_STD=ON -DABSL_BUILD_TESTING=OFF
  cmake --build "$DEPS_BUILD/absl" --target install

  cmake -S "$DEPS_BUILD/src/protobuf-$PROTOBUF_VER" -B "$DEPS_BUILD/protobuf" "${COMMON_CMAKE[@]}" \
    -DCMAKE_INSTALL_PREFIX="$DEPS" -DCMAKE_PREFIX_PATH="$DEPS" -DBUILD_SHARED_LIBS=OFF \
    -DCMAKE_CXX_STANDARD=17 -Dprotobuf_ABSL_PROVIDER=package -Dprotobuf_BUILD_TESTS=OFF \
    -Dprotobuf_BUILD_LIBUPB=OFF -Dprotobuf_WITH_ZLIB=OFF -Dprotobuf_BUILD_PROTOC_BINARIES=ON
  cmake --build "$DEPS_BUILD/protobuf" --target install

  ls "$DEPS"/lib/*.dylib >/dev/null 2>&1 && die "unexpected dylibs in $DEPS/lib"
  echo "$STAMP" > "$DEPS/.stamp"
  rm -rf "$DEPS_BUILD"
fi
PROTOC="$DEPS/bin/protoc"
"$PROTOC" --version | grep -q "${PROTOBUF_VER}" || die "$PROTOC is not protobuf $PROTOBUF_VER"

# --- 2. KataGo ---
if [ ! -d "$SRC/.git" ]; then
  mkdir -p "$VENDOR"
  git clone --depth 1 --branch "$KATAGO_TAG" https://github.com/lightvector/KataGo.git "$SRC"
fi
actual="$(git -C "$SRC" rev-parse HEAD 2>/dev/null || true)"
[ "$actual" = "$KATAGO_COMMIT" ] || die "vendor/KataGo is at '$actual', expected $KATAGO_COMMIT ($KATAGO_TAG)"
git -C "$SRC" diff --quiet HEAD -- || die "vendor/KataGo has local changes to tracked files"

# Reconfigure from scratch when the deps or target change (CMake caches find results).
if [ "$(cat "$BUILD/.stamp" 2>/dev/null)" != "$STAMP" ]; then rm -rf "$BUILD"; fi
# LIBZIP_LIBRARY=OFF: skip find_library so CMake defines NO_LIBZIP (zip is only for selfplay data).
# Swift needs an explicit -target: CMake doesn't pass the deployment target to swiftc, which is
# also the linker here, so without it the binary's minos is the SDK version.
cmake -S "$SRC/cpp" -B "$BUILD" "${COMMON_CMAKE[@]}" \
  -DUSE_BACKEND=METAL \
  -DLIBZIP_LIBRARY=OFF \
  -DCMAKE_Swift_FLAGS="-target $ARCH-apple-macosx$DEPLOY" \
  -DCMAKE_PREFIX_PATH="$DEPS" \
  -DProtobuf_ROOT="$DEPS" \
  -DProtobuf_USE_STATIC_LIBS=ON \
  -DProtobuf_PROTOC_EXECUTABLE="$PROTOC" \
  -DPKG_CONFIG_EXECUTABLE="$(command -v pkg-config)"
echo "$STAMP" > "$BUILD/.stamp"
cmake --build "$BUILD" --target katago

mkdir -p "$(dirname "$OUT")"
cp "$BUILD/katago" "$OUT"
/usr/bin/strip -x "$OUT"
# Drop build-machine LC_RPATHs (/usr/local/lib, Xcode paths): nothing loads via @rpath.
otool -l "$OUT" | awk '/LC_RPATH/{f=1} f&&/ path /{print $2; f=0}' | while read -r rp; do
  install_name_tool -delete_rpath "$rp" "$OUT" 2>/dev/null
done
codesign --force --sign - "$OUT"

# --- 3. Checks: self-contained, expected minos ---
"$OUT" version
echo "--- linked libraries:"
otool -L "$OUT"
bad="$(otool -L "$OUT" | tail -n +2 | awk '{print $1}' | grep -v -E '^(/usr/lib/|/System/Library/)' || true)"
[ -z "$bad" ] || die "non-system libraries linked: $bad"
minos="$(otool -l "$OUT" | awk '/LC_BUILD_VERSION/{f=1} f&&/minos/{print $2; exit}')"
[ "$minos" = "$DEPLOY" ] || die "minos is $minos, expected $DEPLOY"
echo "--- OK: $(du -h "$OUT" | cut -f1) arm64, minos $minos, system libraries only"
