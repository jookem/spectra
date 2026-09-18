# Running SPECTRA as an app

Put the launcher for your platform in the same folder as
`SPECTRA-standalone.html` and run it.

| Platform | File | First-time setup |
|---|---|---|
| macOS | `SPECTRA.command` | `chmod +x SPECTRA.command` in Terminal, then double-click |
| Windows | `SPECTRA.bat` | double-click |
| Linux | `SPECTRA.sh` | `chmod +x SPECTRA.sh`, then `./SPECTRA.sh` |

The launcher opens the build in its own Chrome window with no tab strip, no
address bar and no other tabs sharing the compositor.

## What the flags do

**Throttling.** `--disable-background-timer-throttling`,
`--disable-backgrounding-occluded-windows`, `--disable-renderer-backgrounding`
and `--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling`
between them stop Chrome from slowing the page when the window is minimised,
occluded or unfocused. The app has its own worker-clock fallback for this, but
with these flags the normal render path keeps running and the projector never
sees a handover at all.

**Popups.** `--disable-popup-blocking` means the clean output window (`O`) opens
without a permission prompt.

**Audio.** `--autoplay-policy=no-user-gesture-required` lets the analyser start
without a click first.

**GPU.** `--enable-gpu-rasterization` and `--disable-frame-rate-limit` — the
second uncaps the frame rate above the display refresh, which is useful for
measuring headroom in the diagnostics panel. Drop it if you would rather stay
locked to vsync.

**Profile.** `--user-data-dir` points at a private profile. This is not
cosmetic: without it Chrome hands the file to an already-running instance and
none of the other flags apply. It also keeps saved slots and cues separate from
your normal browsing profile, so clearing site data in day-to-day Chrome cannot
wipe a set.

## Putting it on the projector

1. Run the launcher.
2. Press `O` for the clean output window.
3. Drag that window to the projector, click it once for fullscreen. The click
   also registers the gamepad with that window, so the controller keeps working
   while the operator window is behind it.
4. Operator window stays on the laptop. Keys work from either window.

To place the operator window on a specific display automatically, add
`--window-position=X,Y` to the launcher — `0,0` is the top-left of the primary
display, so a 1920-wide primary makes `--window-position=1920,0` the second
screen.

## Performance

The frame cost is almost entirely fragment shading, so it scales with pixel
count. If a venue's machine struggles, the render-scale control in the
diagnostics panel is the lever that matters — more than anything in this file.
