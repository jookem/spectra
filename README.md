# SPECTRA

Generative fractal VJ instrument. Runs in a browser, driven by live microphone
or system audio, with optional DualShock 4 control over HID.

**Live:** https://jookem.github.io/spectra/ — installable as an app (PWA) and
works offline after the first load.

## Contents

| Path | What it is |
|---|---|
| `VJ Fractal.dc.html` | Source: UI, scene host, controller and audio plumbing. |
| `vj-engine.js` | Source: the GLSL — every fractal, shading and post pass. |
| `cam-fly.js` | Fly-through and Surface camera views for the 3D scenes. |
| `deep-zoom.js` | Perturbation deep zoom for the Mandelbrot field (to ~1e-30). |
| `wave-gl.js`, `wave-mesh.js` | Shorebreak wave scene: renderer and mesh data. |
| `csi.js` | WiFi CSI feature source (motion, presence, flow); not wired in yet. |
| `support.js` | Component runtime (generated; do not edit). |
| `index.html`, `manifest.webmanifest`, `sw.js`, `icon-*.png` | PWA shell. |
| `SPECTRA-standalone.html` | Single-file build of all of the above. |
| `tools/build-standalone.js` | Rebuilds the single-file build from the sources. |
| `launch/` | Desktop launchers for macOS, Windows and Linux, plus setup notes. |
| `firmware/esp32-csi/` | ESP32 sketch that streams CSI to the app. |
| `wave*.glb`, `wave.obj` | Source geometry for the wave scene. |

## Running it

**In the browser:** open https://jookem.github.io/spectra/ in Chrome and allow
microphone access. Nothing is recorded or transmitted; the analyzer reads the
input stream in-process.

**Installed:** Chrome / Edge (desktop, Android): the install icon in the
address bar, or menu > Install app. iPhone / iPad (Safari): Share > Add to
Home Screen. After the first load it opens offline; microphone and camera
still ask for permission the first time.

**Offline, single file:** download `SPECTRA-standalone.html` and open it.

**For live sets:** run the launcher for your platform from `launch/` — it
opens the standalone build in a dedicated Chrome window with background
throttling disabled and popups allowed, so the projector output never stalls
when the operator window loses focus. See `launch/README.md`.

## Hosting your own copy

Any HTTPS static host works (GitHub Pages, Netlify, Vercel, Cloudflare Pages).
Service workers only run on `https://` or `http://localhost`, so opening the
files straight from disk will not install. Local test:

```
npx serve .        # or: python -m http.server
```

then open `http://localhost:<port>/`.

## Releasing a change

1. Edit the sources.
2. Bump `B` in `sw.js` and the `?v=` on every `<script>` in
   `VJ Fractal.dc.html` to the same new value, so installed copies pick up
   the new files instead of serving cached ones. Update the "Build N · date"
   label in `VJ Fractal.dc.html` too (it appears twice).
3. Rebuild the single-file build: `node tools/build-standalone.js`
4. Commit and push; GitHub Pages redeploys from `main`.

## Scenes

Around forty scenes across three renderer classes:

- **3D** raymarched distance estimators — Mandelbulb, Menger, Apollonian,
  Tesseract, HexKochMosely, quaternion Julia and others.
- **2D** escape-time and orbit-trap fields.
- **Canvas** scenes — Spectrum Mesh, Shorebreak, Disco Robot.

All of them read the same audio bands and the same parameter set, so a cue
carries across a scene change.

The 3D scenes have three camera views: **Orbit**, **Fly** (steers through
the open space between forms) and **Surface** (skims low over the surface;
tap a point to travel there, tap a piece to circle it). Both flying views
steer from the scene's own distance estimator.

## Controls

Number keys select scenes. `O` opens the clean output window for the
projector. `T` toggles the message overlay. `F` toggles fullscreen. `J` opens
the diagnostics panel — frame time, jank count, warm-queue state and render
resolution. On a touch device, long-press the pad chip for the same panel.

The **Res** control is the main performance lever. Frame cost is almost
entirely fragment shading, so it scales with pixel count rather than with
machine power: a phone at 0.4 megapixels outruns a desktop at 4. Drop to Low,
Eco or Min on a struggling machine before changing anything else.

## RF input (not active)

`firmware/esp32-csi/` streams WiFi channel state information from an ESP32
over a websocket, and `csi.js` reduces it to motion, presence and flow.
**Currently not wired in:** the RF modulation sources were removed and the
Spectrum Mesh scene reads audio only (`meshSource()` in `VJ Fractal.dc.html`).
The firmware and `csi.js` are kept for when the module is built.

## Performance notes

Shader compilation is synchronous on most drivers whatever
`KHR_parallel_shader_compile` advertises. The app therefore compiles only the
scene on screen at boot, then builds the rest one program per idle slice —
never within 1.5s of an input, and never while frames are running late. On a
backend slow enough that no idle gap can hold a compile, background warming is
abandoned and scenes are built on demand instead, so a stall at least
corresponds to something the operator asked for.

## Requirements

Chromium-based browser with WebGL2. HID controller support is Chromium-only;
everything else works anywhere.

## License

MIT, see [LICENSE](LICENSE).
