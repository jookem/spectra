# SPECTRA RF — ESP32 CSI bridge

Streams WiFi channel state information into the VJ engine as a modulation
source. The engine reduces it to three signals — RF (motion), RFP (presence),
RFF (flow) — assignable to any parameter.

## Hardware

ESP32, ESP32-S3 or ESP32-C3. **Not ESP32-S2** — no CSI support in the radio.
Any dev board is fine; a board with an external antenna connector will give
noticeably cleaner data than a PCB trace antenna.

## Build

Arduino IDE or arduino-cli. Install via Library Manager:

- `ESPAsyncWebServer`
- `AsyncTCP`
- `ESP32Ping`

Set `SSID` and `PASSWORD` at the top of the sketch, flash, open the serial
monitor at 115200. It prints its IP and the CSI frame rate every two seconds.

## Connect

Right-click the **RF** chip in the VJ app and it connects to the URL in
`rfUrl` (default `ws://localhost:8787`). Change that to the ESP32's address —
`ws://192.168.1.42/` — since the sketch serves the websocket on port 80.

Browsers block insecure websockets from an HTTPS page. Either serve the app
over plain HTTP, or run a local `wss` terminator. Opening the app from
`file://` works too.

## Placement

The measurement is of everything between the ESP32 and the access point.
Put them 3–5m apart with the space you care about in between — a doorway, a
dance floor, the middle of a room. Two boards on the same desk will read
almost nothing.

Movement perpendicular to the ESP32↔AP line shows up strongest. Movement
directly along that line is close to invisible, which is a property of the
physics, not a bug.

## Reading the waterfall

The strip under the audio meters shows subcarrier index down each column,
deviation from baseline as brightness, scrolling right to left.

- **Diagonal streaks** — someone moving through the path. This is the signal.
- **Flat noise, no structure** — antenna placement problem, or the AP is too
  close. Move them apart before touching the math.
- **Whole column flickering in unison** — usually automatic gain control, not
  motion. Set `manu_scale` and a fixed `shift` in the CSI config if it's bad.
- **Nothing at all** — check the serial monitor reports a nonzero CSI rate. If
  it's zero, the ping isn't reaching the gateway.

The first ~90 frames calibrate the baseline. Keep the area still during that,
and re-arm the source to re-baseline.

## Frame format

One binary websocket message per CSI capture: N uint8 subcarrier amplitudes,
0–255. Default N is 52 (the modulated subcarriers of the 64-point LLTF, guard
bands dropped). `csi.js` infers N from the first frame, so changing the
subcarrier range in the sketch needs no client change.

## Rate

`PING_HZ` sets how much downlink traffic is generated, which sets the CSI
frame rate. 50Hz is a good default. Higher gets you finer temporal resolution
on fast motion at the cost of airtime on your network — be a good neighbour
about it, and don't run this on a network you don't own.
