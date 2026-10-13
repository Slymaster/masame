# Third-party notices

Masame's own code is under the [MIT licence](LICENSE). This file lists the third-party components it bundles, builds or downloads, with their licences and what each licence asks of us. Licences were checked against each project's LICENSE file or licence page on 11 October 2026.

Legend:
- **Bundled**: shipped inside the app.
- **Built**: compiled from source by our scripts and shipped.
- **Downloaded**: fetched by the app at run time from the official source; never redistributed by us.

---

## 1. Go engine

### KataGo (built, macOS and Linux; bundled, Windows)
- Source: https://github.com/lightvector/KataGo (v1.18.2 on macOS, built by `scripts/build-katago.sh` for Apple Silicon and `scripts/build-katago-macos-x86_64.sh` for Intel; v1.18.2 on Linux, built by `scripts/build-katago-linux.sh`; official v1.18.1 release on Windows)
- Licence: MIT
- Copyright 2025 David J Wu ("lightvector") and/or other authors of the content in the KataGo repository.
- Requirement: include the copyright notice and permission text with every copy. The KataGo LICENSE file also names third-party code under `cpp/external/` with its own licences. The parts that can be compiled into the macOS Metal binary are:

| Component | Licence | Copyright |
|---|---|---|
| katagocoreml-cpp | BSD-3-Clause | (c) 2025 Chin-Chang Yang |
| Apple coremltools (proto definitions, MILBlob, ModelPackage; vendored by katagocoreml) | BSD-3-Clause | (c) 2017-2022 Apple Inc. |
| half 2.2.0 | MIT | (c) 2012-2021 Christian Rau |
| nlohmann/json | MIT | (c) 2013-2019 Niels Lohmann |
| TCLAP 1.2.5 | MIT | (c) 2003 Michael E. Smoot, (c) 2004 Daniel Aarno |
| ghc::filesystem 1.5.8 | MIT | (c) 2018 Steffen Schümann |
| cpp-httplib | MIT | (c) 2017 yhirose |
| Swift CMake modules (`cpp/external/macos`) | Apache-2.0 with Runtime Library Exception | Apple Inc. and the Swift project authors |
| `cpp/core/sha2.cpp` | licence embedded in the file | see file |

The app ships KataGo's `LICENSE`, the licence files of `cpp/external/*` (and katagocoreml's `NOTICE`) and the licences of protobuf, Abseil, the Windows engine's DLLs and Eigen (Linux, Intel Mac) in its `resources/licenses/` folder (macOS: `Masame.app/Contents/Resources/resources/licenses/`; Windows: `resources\licenses\` in the install folder; Linux: `/usr/lib/Masame/resources/licenses/` for the .deb and .rpm). Their copies are kept in [`src-tauri/resources/licenses/`](src-tauri/resources/licenses/).

### protobuf 29.3 (linked into the macOS engine)
- Source: https://github.com/protocolbuffers/protobuf
- Licence: BSD-3-Clause
- Copyright 2008 Google Inc. All rights reserved.
- Requirement: reproduce the copyright notice, conditions and disclaimer in the documentation of binary distributions. Also includes utf8_range (MIT, Google LLC).

### Abseil C++ 20240722.0 (linked into the macOS engine)
- Source: https://github.com/abseil/abseil-cpp
- Licence: Apache-2.0
- Requirement: include a copy of the Apache License 2.0; abseil ships no NOTICE file.

### zlib (system library on macOS)
Linked from `/usr/lib/libz.1.dylib`, part of macOS, not redistributed by us.

---

## 2. Neural networks (downloaded)

The app downloads networks from https://katagotraining.org (`media.katagotraining.org`). Their files are not stored in this repository or in the app bundle.

### kata1 networks: KataGo Neural Network License
- Licence page: https://katagotraining.org/network_license/
- Copyright 2026 David J Wu ("lightvector").
- An MIT-style licence: use, copy, modify and distribute permitted, including commercially, provided the copyright notice and permission notice are included with all copies.
- The app links to this licence from the network manager.

### KataGo Human SL network (`b18c384nbt-humanv0`)
- Downloaded from `media.katagotraining.org/uploaded/networks/models_extra/`.
- Earlier project notes recorded its licence as unconfirmed. As of 11 October 2026, the licence page above states that the KataGo Neural Network License also applies to networks on the "extra networks" page labelled as "KataGo" networks, "such as the KataGo Human SL Network".
- We still download it from the official source rather than redistributing it.

### Networks by other contributors
The licence page lists exceptions. Older `g170` networks are CC0. The "zhizi" networks in the kata1 run (for example `kata1-zhizi-b28c512nbt-muonfd2`) are under an MIT-style licence, Copyright (c) 2026 hzyhhzy & zhizigo.com. The network manager's "strongest" and "newest" entries come from the live kata1 list and could therefore be a zhizi network; its licence then applies.

---

## 3. Application framework and Rust crates (bundled)

### Tauri 2
- https://github.com/tauri-apps/tauri. Licence: MIT OR Apache-2.0 (`tauri`, `tauri-plugin-dialog`, `tauri-plugin-fs`, `tauri-plugin-updater`, `wry`; `tao` is Apache-2.0).

### Rust dependencies
About 300 crates are resolved for the macOS build (`src-tauri/Cargo.lock`). Direct dependencies:

| Crate | Licence |
|---|---|
| tauri, tauri-plugin-dialog, tauri-plugin-fs | Apache-2.0 OR MIT |
| tauri-plugin-updater | Apache-2.0 OR MIT |
| serde, serde_json | MIT OR Apache-2.0 |
| reqwest | MIT OR Apache-2.0 |
| futures-util | MIT OR Apache-2.0 |
| sha2 | MIT OR Apache-2.0 |
| keyring | MIT OR Apache-2.0 |
| tokio | MIT |

Notable transitive dependencies:

| Crate(s) | Licence | Note |
|---|---|---|
| rustls, hyper-rustls | Apache-2.0 OR ISC OR MIT | TLS |
| rustls-webpki, untrusted | ISC | |
| ring | Apache-2.0 AND ISC | crypto (keep its LICENSE text) |
| aws-lc-rs, aws-lc-sys | ISC, Apache-2.0, MIT, BSD-3-Clause (combined) | crypto, if enabled by the TLS backend |
| hyper | MIT | HTTP |
| cssparser, selectors, dtoa-short, option-ext | MPL-2.0 | file-level copyleft: source of these crates is available on crates.io; we do not modify them |
| icu_*, zerovec, yoke, tinystr, litemap, writeable, zerofrom, zerotrie, potential_utf | Unicode-3.0 | |

The rest are MIT, Apache-2.0, BSD-3-Clause, Zlib, Unlicense or 0BSD, mostly dual-licensed. Each release build generates the complete list with its licence texts (`scripts/third-party-licenses.mjs`, from `cargo metadata`) and ships it as `THIRD_PARTY_LICENSES.txt` in the app's `resources/licenses/` folder.

---

## 4. JavaScript dependencies (bundled)

| Package | Licence | Copyright |
|---|---|---|
| react, react-dom (and scheduler) | MIT | (c) Meta Platforms, Inc. and affiliates |
| @sabaki/go-board | MIT | (c) 2019 Yichuan Shen |
| @sabaki/sgf | MIT | (c) 2018-2020 Yichuan Shen |
| @tauri-apps/api, @tauri-apps/plugin-dialog, @tauri-apps/plugin-fs | MIT OR Apache-2.0 | (c) 2019-2025 The Tauri Programme in the Commons Conservancy |
| three | MIT | (c) 2010-2026 three.js authors |
| goban-engine (the OGS client's socket and protocol types) | Apache-2.0 | (c) Online-Go.com (Akita Noek and contributors) |
| eventemitter3 (dependency of goban-engine) | MIT | (c) 2014 Arnout Kazemier |

The `goban-engine` package ships no licence file: `THIRD_PARTY_LICENSES.txt` gives it the canonical Apache-2.0 text. Masame uses no code from the online-go.com site repository (AGPL).

`@sabaki/sgf` depends on `doken` (MIT, bundled). Its optional dependencies `iconv-lite` (MIT) and `jschardet` (LGPL-2.1+) are replaced by an empty module in `vite.config.ts` and are not bundled; keep it that way, or comply with the LGPL if `jschardet` is ever bundled. The same generated `THIRD_PARTY_LICENSES.txt` lists every bundled package with its licence text (from `pnpm licenses list --prod`).

### FSRS-4.5 (algorithm and default weights)
- Source: https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm and https://github.com/open-spaced-repetition/fsrs4anki (the v4.5.0 scheduler)
- Licence: MIT
- Copyright (c) 2022 Open Spaced Repetition
- `src/joseki/fsrs.ts` reimplements the FSRS-4.5 formulas and copies its 17 default weights for the joseki trainer's spaced repetition. No package is bundled.

### Fonts (bundled via Fontsource)
| Font | Licence | Copyright |
|---|---|---|
| Cormorant Garamond (@fontsource/cormorant-garamond) | SIL Open Font License 1.1 | Copyright 2015 The Cormorant Project Authors (github.com/CatharsisFonts/Cormorant) |
| Manrope (@fontsource/manrope) | SIL Open Font License 1.1 | Copyright 2019 The Manrope Project Authors (github.com/sharanda/manrope) |

The OFL requires that the copyright notice and licence travel with the fonts when they are redistributed; the fonts may not be sold on their own. The licence text is in each package's `LICENSE` file.

---

## 5. Textures, lighting and sounds

### Poly Haven (CC0 1.0)
Licence: https://polyhaven.com/license (all assets CC0). Attribution is not required; we give it anyway.
- Studio Country Hall, https://polyhaven.com/a/studio_country_hall (1K HDR, `public/assets/board3d/studio_country_hall_1k.hdr`)

### ambientCG (CC0 1.0)
Licence: https://ambientcg.com/license (all assets CC0).

- Wood095, https://ambientcg.com/view?id=Wood095 (2K and 4K JPG: Color, NormalGL, Roughness; downloaded 2026-10-11 and 2026-10-13). Derived files `public/assets/board3d/kaya_diff.jpg`, `kaya_nor.jpg`, `kaya_rough.jpg` and their 4K versions `kaya_*_4k.jpg`, made by `scripts/kaya-textures.py` (stacked strips of the scan, graded to golden kaya, roughness derived from the fibre detail). The bowls and the table reuse `kaya_diff.jpg`, tinted in the material.

### Freesound (CC0 1.0)
Licence of each sound: CC0 1.0, https://creativecommons.org/publicdomain/zero/1.0/

Downloaded 2026-10-11 (HQ previews). `public/assets/board3d/place.mp3`, `clicks.mp3` and `bowl.mp3` are cut, faded and loudness-matched derivatives (mono 44.1 kHz MP3).
- billhails2, "GoStoneSounds.ogg", https://freesound.org/people/billhails2/sounds/588317/ (used in `place.mp3`)
- Hongsungbock, "baduk2", https://freesound.org/people/Hongsungbock/sounds/840425/ (used in `place.mp3`)
- MPooman, "[ MPooman ] Play Go Sounds 2 (SE485) (High Quality)", https://freesound.org/people/MPooman/sounds/668942/ (used in `clicks.mp3` and `bowl.mp3`)

### Original work
Procedural effects in the 3D renderer (`src/board3d/`) (shell striations, slate micro-roughness, grid ink, contact shadows, the "Light and Shadow" light cookie, the synthesised placement sound) are original code in this repository, under the MIT licence.

---

## 6. Windows build

The Windows version ships KataGo's official Windows engines (v1.18.1, `opencl` and `eigenavx2` builds). Each official zip contains, besides `katago.exe`:

| File(s) | Component | Licence | Requirement |
|---|---|---|---|
| `libcrypto-3-x64.dll`, `libssl-3-x64.dll` | OpenSSL 3 | Apache-2.0 | include the Apache-2.0 licence text |
| `z.dll` | zlib | zlib licence | do not misrepresent origin; keep the notice in source distributions |
| `zip.dll` | libzip | BSD-3-Clause | (c) 1999-2026 Dieter Baron and Thomas Klausner; reproduce notice in documentation |
| `bz2.dll` | bzip2 / libbzip2 | bzip2 licence (BSD-style) | (c) 1996-2010 Julian R Seward; reproduce notice in documentation |
| `msvcp140*.dll`, `vcruntime140*.dll` | Microsoft Visual C++ runtime | Microsoft Visual Studio licence terms, "Distributable Code" | may be redistributed with an application; or use the official VC++ Redistributable installer |
| `cacert.pem` | Mozilla CA certificate bundle (via curl) | MPL-2.0 | keep the file unmodified; source available at https://curl.se/docs/caextract.html |
| `katago.exe` (`eigenavx2` build only) | Eigen (header-only, compiled in) | MPL-2.0 | unmodified; source available at https://gitlab.com/libeigen/eigen |

`OpenCL.dll` (Khronos OpenCL ICD Loader, Apache-2.0, https://github.com/KhronosGroup/OpenCL-ICD-Loader) is not in the official zip and the app does not bundle it. The OpenCL build uses the copy that the GPU driver installs in `System32`; if it is missing, the app falls back to the CPU (Eigen AVX2) build.

Engines downloaded on demand (OpenVINO, DirectML/ONNX Runtime, CUDA/TensorRT builds) bring their own runtime licences; they must be reviewed and listed here before that feature ships.

---

## 7. Linux build

The Linux version (x86_64; AppImage, .deb and .rpm, built on Ubuntu 22.04) ships KataGo v1.18.2 built from source by `scripts/build-katago-linux.sh`, at the same pinned commit as macOS, in two variants: `opencl` (GPU) and `eigenavx2` (CPU, AVX2 + FMA). The app starts the OpenCL build and falls back to the CPU build when it fails.

| File(s) | Component | Licence | Requirement |
|---|---|---|---|
| `katago` (`eigenavx2` build only) | Eigen 3.4.0 (header-only, compiled in, from Ubuntu 22.04's `libeigen3-dev`) | MPL-2.0 | unmodified, compiled with `EIGEN_MPL2_ONLY` so no LGPL part of Eigen is used; source available at https://gitlab.com/libeigen/eigen; licence text in `resources/licenses/linux-engine/` |

glibc, libstdc++, libgcc, zlib and the OpenCL ICD loader (`libOpenCL.so.1`) are system libraries, linked dynamically and not shipped by us. Without an OpenCL driver, the app uses the CPU build.

The AppImage also bundles libraries from Ubuntu 22.04 so that it runs on other distributions (WebKitGTK, GTK, GLib and their dependencies, many under the LGPL), unmodified. Each release publishes `linux-appimage-libraries.txt` next to the AppImage: every bundled file with its Ubuntu package and version, how to get the corresponding source, and each package's copyright file. The .deb and .rpm bundle none of these; they depend on the distribution's packages.

---

## 8. Intel Mac build

The Intel Mac version ships KataGo v1.18.2 built from source by `scripts/build-katago-macos-x86_64.sh`, at the same pinned commit as the other builds, as two sidecars in `Masame.app/Contents/MacOS/`: `katago-opencl` (GPU, through the system's OpenCL.framework) and `katago-eigen` (CPU, without AVX2, so it also runs under Rosetta). The app starts the OpenCL build and falls back to the CPU build when it fails.

| File(s) | Component | Licence | Requirement |
|---|---|---|---|
| `katago-eigen` | Eigen 3.4.0 (header-only, compiled in, from the pinned upstream tarball) | MPL-2.0 | unmodified, compiled with `EIGEN_MPL2_ONLY` so no LGPL part of Eigen is used; source available at https://gitlab.com/libeigen/eigen; licence text in `resources/licenses/linux-engine/` |

Both link only macOS system libraries and frameworks (libc++, libSystem, zlib, OpenCL).
