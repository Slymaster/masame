#!/bin/bash
set -euo pipefail
xcodebuild test -scheme PublicRelease -destination platform=macOS -parallel-testing-enabled NO \
  -derivedDataPath "$RUNNER_TEMP/MasameUITests" \
  -resultBundlePath "$RUNNER_TEMP/$1.xcresult" \
  "-only-testing:PublicReleaseTests/PublicReleaseTests/$1"
