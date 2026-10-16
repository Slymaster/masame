#!/usr/bin/env bash
# Build KataGo for iOS as one static library, vendor/katago-ios/<sdk>/libkatago_ios.a, that the app links:
# iOS forbids child processes, so KataGo runs in-process through scripts/ios/katago_shim.cpp, whose
#   extern "C" int katago_ios_run(int argc, const char** argv, int in_fd, int out_fd, int err_fd)
# replaces the sidecar's process boundary. KataGo's main is renamed katago_main.
#
#   scripts/build-katago-ios.sh iphoneos [metal]            device (arm64), Metal + CoreML backend
#   scripts/build-katago-ios.sh iphonesimulator [eigen]     Simulator (arm64), Eigen CPU backend
#
# Same pinned KataGo, abseil and protobuf as scripts/build-katago.sh, and Eigen as
# scripts/build-katago-macos-x86_64.sh. The Metal backend's CoreML converter needs protobuf + abseil, built
# here for the iOS SDK; its .proto files are compiled by the host protoc that build-katago.sh leaves in
# vendor/deps/bin. The app links the library with -lc++ -lz and the Metal, MetalPerformanceShaders,
# MetalPerformanceShadersGraph and CoreML frameworks (Metal), plus the Swift runtime, which Xcode adds.
# MASAME_VENDOR overrides the vendor directory (default: <repo>/vendor).
# Requires: Xcode (iOS SDK, Swift >= 5.9), cmake, ninja, pkg-config, curl, git.
set -euo pipefail

KATAGO_TAG="v1.18.2"
KATAGO_COMMIT="fd0723fdbc0e9d82cf269c9630af8c27c57c07c4" # = KATAGO_TAG; the build fails on any other commit (tags can move)
ABSL_VER="20240722.0"
ABSL_SHA256="f50e5ac311a81382da7fa75b97310e4b9006474f9560ac46f54a9967f07d4ae3"
PROTOBUF_VER="29.3"
PROTOBUF_SHA256="008a11cc56f9b96679b4c285fd05f46d317d685be3ab524b2a310be0fbad987e"
EIGEN_VER="3.4.0"
EIGEN_SHA256="8586084f71f9bde545ee7fa6d00288b264a2b7ac3607b974e54d13e7162c1c72"
DEPLOY="16.4" # = the app's iOS minimum (Vite 8's Safari target)
ARCH="arm64"

SDK="${1:-}"
case "$SDK" in
  iphoneos) BACKEND="${2:-metal}"; SWIFT_TARGET="$ARCH-apple-ios$DEPLOY" ;;
  iphonesimulator) BACKEND="${2:-eigen}"; SWIFT_TARGET="$ARCH-apple-ios$DEPLOY-simulator" ;;
  *) echo "usage: $0 <iphoneos|iphonesimulator> [metal|eigen]" >&2; exit 2 ;;
esac
case "$BACKEND" in metal|eigen) ;; *) echo "backend must be metal or eigen" >&2; exit 2 ;; esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="${MASAME_VENDOR:-$ROOT/vendor}"
SRC="$VENDOR/KataGo"
BUILD="$SRC/cpp/build-ios-$SDK-$BACKEND"
DL="$VENDOR/dl"
EIGEN="$VENDOR/eigen-$EIGEN_VER"
DEPS="$VENDOR/deps-ios/$SDK"
DEPS_BUILD="$VENDOR/deps-ios/build-$SDK"
OUTDIR="$VENDOR/katago-ios/$SDK"
OUT="$OUTDIR/libkatago_ios.a"

die() { echo "build-katago-ios: $*" >&2; exit 1; }

[ "$(uname -s)" = Darwin ] || die "macOS only"
SYSROOT="$(xcrun --sdk "$SDK" --show-sdk-path 2>/dev/null)" || die "the $SDK SDK is missing: install Xcode with iOS support"
for tool in cmake ninja pkg-config curl git; do
  command -v "$tool" >/dev/null || die "'$tool' not found on PATH (e.g. brew install $tool)"
done

export CC=/usr/bin/clang CXX=/usr/bin/clang++
export PKG_CONFIG_LIBDIR="$DEPS/lib/pkgconfig" PKG_CONFIG_PATH=""
unset CPATH CPLUS_INCLUDE_PATH LIBRARY_PATH MACOSX_DEPLOYMENT_TARGET IPHONEOS_DEPLOYMENT_TARGET || true
COMMON_CMAKE=(-G Ninja
  -DCMAKE_BUILD_TYPE=Release
  -DCMAKE_SYSTEM_NAME=iOS
  -DCMAKE_OSX_SYSROOT="$SDK"
  -DCMAKE_SYSTEM_PROCESSOR="$ARCH" # not inferred when cross-compiling; KataGo picks its ARM flags from it
  -DCMAKE_OSX_ARCHITECTURES="$ARCH"
  -DCMAKE_OSX_DEPLOYMENT_TARGET="$DEPLOY"
  -DCMAKE_IGNORE_PREFIX_PATH="/opt/homebrew;/usr/local;/opt/local"
  -DCMAKE_FIND_USE_PACKAGE_REGISTRY=OFF
  # CMake re-roots find_* under the iOS SDK; also search the given prefixes as they are (vendor/deps-ios)
  -DCMAKE_FIND_ROOT_PATH_MODE_PACKAGE=BOTH -DCMAKE_FIND_ROOT_PATH_MODE_LIBRARY=BOTH -DCMAKE_FIND_ROOT_PATH_MODE_INCLUDE=BOTH)

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

STAMP="katago-$KATAGO_COMMIT absl-$ABSL_VER protobuf-$PROTOBUF_VER eigen-$EIGEN_VER $SDK-$DEPLOY $ARCH $BACKEND"
if [ "$BACKEND" = metal ]; then
  # --- 1. Static abseil + protobuf for the iOS SDK in vendor/deps-ios/<sdk>, cached by stamp ---
  PROTOC="$VENDOR/deps/bin/protoc"
  [ -x "$PROTOC" ] || die "host protoc missing: run scripts/build-katago.sh first (it builds $PROTOC)"
  "$PROTOC" --version | grep -q "${PROTOBUF_VER}" || die "$PROTOC is not protobuf $PROTOBUF_VER"
  DEPS_STAMP="absl-$ABSL_VER protobuf-$PROTOBUF_VER $SDK-$DEPLOY $ARCH"
  if [ "$(cat "$DEPS/.stamp" 2>/dev/null)" != "$DEPS_STAMP" ]; then
    echo "--- building static deps: $DEPS_STAMP"
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
      -Dprotobuf_BUILD_LIBUPB=OFF -Dprotobuf_WITH_ZLIB=OFF -Dprotobuf_BUILD_PROTOC_BINARIES=OFF
    cmake --build "$DEPS_BUILD/protobuf" --target install

    echo "$DEPS_STAMP" > "$DEPS/.stamp"
    rm -rf "$DEPS_BUILD"
  fi
  BACKEND_CMAKE=(-DUSE_BACKEND=METAL
    -DCMAKE_Swift_COMPILER="$BUILD/swiftc"
    -DCMAKE_PREFIX_PATH="$DEPS"
    -DProtobuf_ROOT="$DEPS"
    -DProtobuf_USE_STATIC_LIBS=ON
    -DProtobuf_PROTOC_EXECUTABLE="$PROTOC"
    -DPKG_CONFIG_EXECUTABLE="$(command -v pkg-config)")
  CXX_FLAGS=""
else
  # Eigen (header-only) from a pinned, checksummed tarball.
  if [ ! -d "$EIGEN/Eigen" ]; then
    fetch "https://gitlab.com/libeigen/eigen/-/archive/$EIGEN_VER/eigen-$EIGEN_VER.tar.gz" "eigen-$EIGEN_VER.tar.gz" "$EIGEN_SHA256"
    tar -xzf "$DL/eigen-$EIGEN_VER.tar.gz" -C "$VENDOR"
  fi
  # EIGEN_MPL2_ONLY: compiling any LGPL-licensed part of Eigen is an error.
  BACKEND_CMAKE=(-DUSE_BACKEND=EIGEN -DEIGEN3_INCLUDE_DIRS="$EIGEN")
  CXX_FLAGS="-DEIGEN_MPL2_ONLY"
fi

# --- 2. KataGo ---
if [ ! -d "$SRC/.git" ]; then
  mkdir -p "$VENDOR"
  git clone --depth 1 --branch "$KATAGO_TAG" https://github.com/lightvector/KataGo.git "$SRC"
fi
actual="$(git -C "$SRC" rev-parse HEAD 2>/dev/null || true)"
[ "$actual" = "$KATAGO_COMMIT" ] || die "$SRC is at '$actual', expected $KATAGO_COMMIT ($KATAGO_TAG)"
git -C "$SRC" diff --quiet HEAD -- || die "$SRC has local changes to tracked files"

if [ "$(cat "$BUILD/.stamp" 2>/dev/null)" != "$STAMP" ]; then rm -rf "$BUILD"; fi
# -Dmain=katago_main: the shim calls KataGo's main. The katago executable is still linked, with
# katago_main as its entry point (compiler checks build static libs, which have none), which proves
# every symbol the library needs resolves.
ENTRY="-Xlinker -e -Xlinker __Z11katago_mainiPKPKc"
# swiftc defaults to a macOS target, and KataGo's Swift-to-C++ header step passes neither CMAKE_Swift_FLAGS
# nor a target, so every Swift call goes through a wrapper that names the iOS target. CMake also leaves
# CMAKE_EXE_LINKER_FLAGS off the Swift link of katago, so the wrapper adds the entry point there.
mkdir -p "$BUILD"
printf '#!/bin/sh\ncase " $* " in *" -emit-executable "*) set -- "$@" %s ;; esac\nexec %s -target %s "$@"\n' \
  "$ENTRY" "$(xcrun --find swiftc)" "$SWIFT_TARGET" > "$BUILD/swiftc"
chmod +x "$BUILD/swiftc"
# LIBZIP_LIBRARY=OFF: CMake then defines NO_LIBZIP (zip is only for selfplay data).
cmake -S "$SRC/cpp" -B "$BUILD" "${COMMON_CMAKE[@]}" "${BACKEND_CMAKE[@]}" \
  -DLIBZIP_LIBRARY=OFF \
  -DCMAKE_TRY_COMPILE_TARGET_TYPE=STATIC_LIBRARY \
  -DCMAKE_CXX_FLAGS="-Dmain=katago_main $CXX_FLAGS" \
  -DCMAKE_EXE_LINKER_FLAGS="$ENTRY"
echo "$STAMP" > "$BUILD/.stamp"
cmake --build "$BUILD" --target katago

# --- 3. One static library: KataGo's objects, its Swift + CoreML libs, the iOS deps, the shim ---
mkdir -p "$OUTDIR"
xcrun --sdk "$SDK" clang++ -std=c++17 -O2 -target "$SWIFT_TARGET" -c "$ROOT/scripts/ios/katago_shim.cpp" -o "$BUILD/katago_shim.o"
inputs=("$BUILD/katago_shim.o")
while IFS= read -r o; do inputs+=("$o"); done < <(find "$BUILD/CMakeFiles/katago.dir" -name '*.o' | sort)
if [ "$BACKEND" = metal ]; then
  inputs+=("$BUILD/libKataGoSwift.a" "$BUILD/external/katagocoreml/libkatagocoreml.a")
  # protobuf-lite duplicates libprotobuf; protoc's libs are host-only.
  while IFS= read -r a; do inputs+=("$a"); done < <(find "$DEPS/lib" -name '*.a' ! -name 'libprotobuf-lite.a' ! -name 'libprotoc.a' | sort)
fi
rm -f "$OUT"
xcrun libtool -static -no_warning_for_no_symbols -o "$OUT" "${inputs[@]}" 2> >(grep -v 'same member name' >&2)

# --- 4. Checks: arm64 only, for this SDK, exports the shim and KataGo's main ---
# (KataGo's Metal block pins its own C++ objects to deployment target 13.0: older than ours, so harmless.)
[ "$(lipo -archs "$OUT")" = "$ARCH" ] || die "$OUT is not $ARCH only: $(lipo -archs "$OUT")"
syms="$(nm -g "$OUT" 2>/dev/null)"
grep -q ' T _katago_ios_run$' <<<"$syms" || die "_katago_ios_run missing from $OUT"
grep -q ' T __Z11katago_mainiPKPKc$' <<<"$syms" || die "katago_main missing from $OUT"
platform="$(otool -l "$BUILD/katago.app/katago" | awk '/LC_BUILD_VERSION/{f=1} f&&/platform/{print $2; exit}')"
case "$SDK:$platform" in iphoneos:2|iphoneos:IOS|iphonesimulator:7|iphonesimulator:IOSSIMULATOR) ;; *) die "linked katago has platform $platform, not $SDK" ;; esac
echo "--- OK: $OUT ($(du -h "$OUT" | cut -f1), $BACKEND, $SDK $DEPLOY $ARCH)"
