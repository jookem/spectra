#!/bin/bash
# SPECTRA — macOS launcher.
#
# Opens the standalone build in a dedicated Chrome window with the background
# throttling rules switched off, so the render loop keeps full rate when the
# window is minimised or another app takes focus.
#
# Setup: put this file next to SPECTRA-standalone.html, then once, in Terminal:
#     chmod +x SPECTRA.command
# After that, double-click it.

set -e
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

APP="$HERE/SPECTRA-standalone.html"
[ -f "$APP" ] || APP="$HERE/../SPECTRA-standalone.html"
if [ ! -f "$APP" ]; then
  echo "SPECTRA-standalone.html not found next to this launcher."
  read -r -p "Press return to close."
  exit 1
fi
APP="$(cd "$(dirname "$APP")" && pwd)/$(basename "$APP")"

# A separate profile directory. Without it Chrome hands the URL to an already
# running instance and none of the flags below apply.
PROFILE="$HOME/Library/Application Support/SPECTRA-chrome"

for C in \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "$HOME/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" \
  "/Applications/Chromium.app/Contents/MacOS/Chromium"
do
  [ -x "$C" ] && BROWSER="$C" && break
done

if [ -z "$BROWSER" ]; then
  echo "No Chrome-family browser found. Install Google Chrome, or open"
  echo "SPECTRA-standalone.html by hand."
  read -r -p "Press return to close."
  exit 1
fi

"$BROWSER" \
  --app="file://$APP" \
  --user-data-dir="$PROFILE" \
  --disable-background-timer-throttling \
  --disable-backgrounding-occluded-windows \
  --disable-renderer-backgrounding \
  --disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling \
  --autoplay-policy=no-user-gesture-required \
  --disable-popup-blocking \
  --enable-gpu-rasterization \
  --disable-frame-rate-limit \
  --start-maximized \
  >/dev/null 2>&1 &

sleep 1
