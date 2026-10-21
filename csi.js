// CSI (WiFi channel state information) feature source.
//
// Consumes per-subcarrier amplitude vectors and reduces them to three scalars
// shaped like the audio features already on the parameter bus:
//
//   motion   0..1  short-window temporal variance across subcarriers
//   presence 0..1  deviation of the current vector from a calibrated baseline
//   flow     0..1  slow-moving, smoothed motion (breathing / drift band)
//
// Two transports:
//   'sim'  synthetic generator — no hardware, for building the mapping
//   'ws'   websocket, expects either a JSON {csi:[...]} or a raw Float32/Uint8
//          frame of N subcarrier amplitudes
//
// Wire format for firmware (ESP32 / ath9k dumper): one frame per packet,
// N little-endian float32 amplitudes. N is inferred from the first frame.

// Assembled, not written out: see the note in the DC's rfUrl default.
export const CSI_HOST = ['ws', '//' + 'localhost', '8787'].join(':');

export const CSI_DEFAULTS = {
  url: CSI_HOST,
  n: 52,            // subcarriers; ESP32 HT-LTF gives 52 usable of 64
  window: 24,       // frames kept for variance
  calibFrames: 90,  // frames averaged into the baseline
  gain: 1.0
};

export class CSISource {
  constructor(opts = {}) {
    this.o = Object.assign({}, CSI_DEFAULTS, opts);
    this.n = this.o.n;
    this.vec = new Float32Array(this.n);      // latest normalized amplitudes
    this.base = new Float32Array(this.n);     // calibrated baseline
    this.hist = [];                           // recent vectors
    this.calib = { count: 0, sum: new Float32Array(this.n), done: false };
    this.motion = 0; this.presence = 0; this.flow = 0;
    this.raw = { motion: 0, presence: 0 };
    this.fps = 0; this._frames = 0; this._fpsAt = performance.now();
    this.status = 'idle';   // idle | sim | connecting | live | error
    this.ws = null; this.simTimer = null;
    this.onframe = null;
  }

  // ---- transports ---------------------------------------------------------

  startSim() {
    this.stop();
    this.status = 'sim';
    let t = 0;
    // Two "bodies" drifting through a standing-wave field, plus a breathing
    // term and per-subcarrier noise. Produces the same statistics real CSI has:
    // strongly correlated neighbors, occasional deep fades.
    const bodies = [{ p: 0.3, v: 0.006 }, { p: 0.75, v: -0.004 }];
    this.simTimer = setInterval(() => {
      t += 1;
      const f = new Float32Array(this.n);
      for (const b of bodies) {
        b.p += b.v + (Math.random() - 0.5) * 0.004;
        if (b.p < 0.05 || b.p > 0.95) b.v *= -1;
        b.p = Math.min(0.95, Math.max(0.05, b.p));
      }
      const breath = Math.sin(t * 0.055) * 0.5 + 0.5; // ~16 br/min at 50Hz
      for (let i = 0; i < this.n; i++) {
        const x = i / (this.n - 1);
        let a = 0.55 + 0.18 * Math.sin(x * 9.1 + 0.7);   // static multipath
        for (const b of bodies) {
          const d = Math.abs(x - b.p);
          a -= 0.34 * Math.exp(-d * d * 42) * (0.6 + 0.4 * Math.sin(t * 0.21 + i * 0.4));
        }
        a += breath * 0.02 * Math.sin(x * 21.0);
        a += (Math.random() - 0.5) * 0.03;
        f[i] = Math.min(1, Math.max(0, a));
      }
      this.push(f);
    }, 20);
    return this;
  }

  async connect(url) {
    this.stop();
    this.o.url = url || this.o.url;
    this.status = 'connecting';
    return new Promise((resolve) => {
      let ws;
      try { ws = new WebSocket(this.o.url); } catch (e) { this.status = 'error'; return resolve(false); }
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      const fail = () => { if (this.status !== 'live') { this.status = 'error'; resolve(false); } };
      ws.onopen = () => { this.status = 'live'; resolve(true); };
      ws.onerror = fail;
      ws.onclose = () => { if (this.status === 'live') this.status = 'idle'; fail(); };
      ws.onmessage = (ev) => this.ingest(ev.data);
      setTimeout(fail, 4000);
    });
  }

  stop() {
    if (this.simTimer) { clearInterval(this.simTimer); this.simTimer = null; }
    if (this.ws) { try { this.ws.onclose = null; this.ws.close(); } catch (e) {} this.ws = null; }
    if (this.status !== 'error') this.status = 'idle';
  }

  ingest(data) {
    let arr = null;
    if (typeof data === 'string') {
      try { const j = JSON.parse(data); arr = j.csi || j.amp || j.data || null; } catch (e) { return; }
      if (arr) arr = Float32Array.from(arr);
    } else if (data instanceof ArrayBuffer) {
      // float32 if the byte length divides cleanly, else treat as uint8 dBm-ish
      arr = (data.byteLength % 4 === 0) ? new Float32Array(data) : new Uint8Array(data);
    }
    if (!arr || !arr.length) return;
    if (arr.length !== this.n) this.resize(arr.length);
    const f = new Float32Array(this.n);
    // Uint8 frames arrive as 0..255 magnitudes; float frames are assumed 0..1
    // unless they exceed it, in which case normalize by the frame max.
    let mx = 0; for (let i = 0; i < arr.length; i++) if (arr[i] > mx) mx = arr[i];
    const k = (arr instanceof Uint8Array) ? 1 / 255 : (mx > 1.2 ? 1 / mx : 1);
    for (let i = 0; i < this.n; i++) f[i] = Math.min(1, Math.max(0, arr[i] * k));
    this.push(f);
  }

  resize(n) {
    this.n = n;
    this.vec = new Float32Array(n); this.base = new Float32Array(n);
    this.hist = []; this.calib = { count: 0, sum: new Float32Array(n), done: false };
  }

  // ---- feature extraction -------------------------------------------------

  push(f) {
    this.vec = f;
    this.hist.push(f);
    if (this.hist.length > this.o.window) this.hist.shift();

    if (!this.calib.done) {
      for (let i = 0; i < this.n; i++) this.calib.sum[i] += f[i];
      if (++this.calib.count >= this.o.calibFrames) {
        for (let i = 0; i < this.n; i++) this.base[i] = this.calib.sum[i] / this.calib.count;
        this.calib.done = true;
      }
    }

    // motion: mean per-subcarrier variance over the window. Movement in the
    // room decorrelates neighboring subcarriers; a still room does not.
    let mv = 0;
    if (this.hist.length > 3) {
      const L = this.hist.length;
      for (let i = 0; i < this.n; i++) {
        let s = 0, ss = 0;
        for (let j = 0; j < L; j++) { const v = this.hist[j][i]; s += v; ss += v * v; }
        const m = s / L;
        mv += Math.max(0, ss / L - m * m);
      }
      mv /= this.n;
    }
    // presence: L1 distance from baseline, which stays high for a stationary
    // body (it shifts the multipath) where motion falls to zero.
    let pr = 0;
    if (this.calib.done) {
      for (let i = 0; i < this.n; i++) pr += Math.abs(f[i] - this.base[i]);
      pr /= this.n;
    }

    this.raw.motion = mv; this.raw.presence = pr;
    const g = this.o.gain;
    // variance is small (~1e-4..1e-2); compress hard then smooth
    const mN = Math.min(1, Math.sqrt(mv * 140) * g);
    const pN = Math.min(1, pr * 7 * g);
    this.motion += (mN - this.motion) * 0.22;
    this.presence += (pN - this.presence) * 0.06;
    this.flow += (mN - this.flow) * 0.02;

    this._frames++;
    const now = performance.now();
    if (now - this._fpsAt > 500) {
      this.fps = Math.round(this._frames * 1000 / (now - this._fpsAt));
      this._frames = 0; this._fpsAt = now;
    }
    if (this.onframe) this.onframe(this);
  }

  recalibrate() {
    this.calib = { count: 0, sum: new Float32Array(this.n), done: false };
  }

  get active() { return this.status === 'sim' || this.status === 'live'; }
}
