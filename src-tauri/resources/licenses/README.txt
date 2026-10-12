Third-party licences shipped with Masame

Masame is under the MIT licence (LICENSE). It includes software by other authors; their licence
texts are in this folder:

  katago/          KataGo (the Go engine) and the libraries from its cpp/external/ folder,
                   plus the licence embedded in cpp/core/sha2.cpp
  macos-engine/    protobuf 29.3 (with utf8_range) and Abseil 20240722.0, linked into the
                   macOS engine
  windows-engine/  OpenSSL 3, zlib, libzip, bzip2 and the MPL-2.0 text for cacert.pem, shipped
                   as DLLs/files next to the Windows engine
  linux-engine/    the MPL-2.0 text for Eigen 3.4.0, compiled into the Linux CPU engine
  THIRD_PARTY_LICENSES.txt
                   Rust crates and JavaScript packages (including the fonts) in the app, with
                   their licence texts

The four folders are stored in the source repository. THIRD_PARTY_LICENSES.txt, LICENSE and
THIRD_PARTY_NOTICES.md are generated at build time by scripts/third-party-licenses.mjs.

Overview of every component and what its licence asks:
https://github.com/Slymaster/masame/blob/main/THIRD_PARTY_NOTICES.md
