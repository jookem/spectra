# SPECTRA

Generative fractal VJ instrument. Runs in a browser, driven by live microphone
input, with optional DualShock 4 control over HID.

Everything is a single HTML file with no build step and no dependencies.
`SPECTRA-standalone.html` is the compiled build — download it, open it, done.

## Contents

| Path | What it is |
|---|---|
| `SPECTRA-standalone.html` | Compiled single-file build. This is the one to run. |
| `VJ Fractal.dc.html` | Source: UI, scene host, controller and audio plumbing. |
| `vj-engine.js` | Source: the GLSL — every fractal, shading and post pass. |
| `wave-gl.js`, `wave-mesh.js` | Canvas scene renderers. |
| `csi.js` | Signal helpers. |
| `support.js` | Component runtime. |
| `launch/` | Desktop launchers for macOS, Windows and Linux, plus setup notes. |

## Running it

Open `SPECTRA-standalone.html` in Chrome and allow microphone access. Nothing
is recorded or transmitted; the analyser reads the input stream in-process.

For live use, run the launcher for your platform from `launch/` instead — it
opens the build in a dedicated Chrome window with background throttling
disabled and popups allowed, so the projector output never stalls when the
operator window loses focus. See `launch/README.md`.

## Scenes

Around forty scenes across three renderer classes:

- **3D** raymarched distance estimators — Mandelbulb, Menger, Apollonian,
  Tesseract, CubeKochMosely, quaternion Julia and others.
- **2D** escape-time and orbit-trap fields.
- **Canvas** scenes — Spectrum Mesh, Shorebreak, Disco Robot.

All of them read the same audio bands and the same parameter set, so a cue
carries across a scene change.

## Controls

Number keys select scenes. `O` opens the clean output window for the
projector. `T` toggles the message overlay. `J` opens the diagnostics panel —
frame time, jank count, warm-queue state and render resolution. On a touch
device, long-press the pad chip for the same panel.

The **Res** control is the main performance lever. Frame cost is almost
entirely fragment shading, so it scales with pixel count rather than with
machine power: a phone at 0.4 megapixels outruns a desktop at 4. Drop to Low,
Eco or Min on a struggling machine before changing anything else.

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
