#!/usr/bin/env bash
#
# Compile and run the native media probe against the Phase 0 spike clip.
#
# Deliberately does not go through Xcode. MediaProbe.swift imports only
# AVFoundation and CoreMedia, so `swiftc` builds it directly — which means this
# check runs today, whereas T024's XCTest target has been blocked for weeks on
# CocoaPods generating a scheme with no testables in it.
#
# The fixture is real footage and is gitignored (*.MP4), so a clean clone skips
# rather than fails. Present-and-wrong is a failure; absent is a skip.

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
clip="$root/spike/media/DJI_20260301165929_0131_D.MP4"

if [ ! -f "$clip" ]; then
  echo "skip: native probe check needs $clip"
  echo "      (real footage, gitignored — see spike/README.md to regenerate)"
  exit 0
fi

if ! command -v swiftc >/dev/null 2>&1; then
  echo "skip: swiftc not found (Xcode command line tools required)"
  exit 0
fi

out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT

swiftc -O \
  "$root/modules/frame-player/ios/MediaProbe.swift" \
  "$root/modules/frame-player/ios/Tests/ProbeCheck.swift" \
  -o "$out/probe-check"

"$out/probe-check" "$clip"
