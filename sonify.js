// Sonify: music made from the scene on screen.
//
// Two layers, both cheap (no GPU readback):
//  1. The scene's own dials drive the music. Hue picks the key, Speed the
//     tempo, Zoom opens the filter, Detail sets note density, DOF / Depth /
//     Lights set reverb, delay and pad level, and so on.
//  2. The scene's formula is iterated on the CPU and its orbit becomes the
//     melody: each step's angle is a scale degree, its size the velocity, and
//     an orbit that escapes ends the phrase. Each family uses its own kind of
//     formula (bulb, box fold, sphere inversion, z^2+c, attractor map).
//
// Timing runs off the AudioContext clock with a short look-ahead, so a slow or
// stalled video frame never makes the music stutter; the frame loop only hands
// over the latest dial values with update().
//
// Optional MIDI out: lead on channel 1, bass on 2, pad on 3, and the 15 dials
// as CC 20-34 on channel 1, for driving a DAW or hardware synth.
(function(){
const SCALES = {
  minpent: {tag:'Min pent', iv:[0,3,5,7,10]},
  majpent: {tag:'Maj pent', iv:[0,2,4,7,9]},
  minor:   {tag:'Minor',      iv:[0,2,3,5,7,8,10]},
  dorian:  {tag:'Dorian',     iv:[0,2,3,5,7,9,10]},
  major:   {tag:'Major',      iv:[0,2,4,5,7,9,11]},
  phryg:   {tag:'Phryg',   iv:[0,1,3,5,7,8,10]},
  whole:   {tag:'Whole', iv:[0,2,4,6,8,10]},
};
// Chord roots as scale degrees, one per bar. Cst B picks the progression.
const PROGS = [[0,5,3,4],[0,3,4,3],[0,4,5,3],[0,2,5,4]];
// Styles: the same orbit and dials, played different ways. tempo scales the
// base tempo (Speed or the live bpm) within min..max; chordBars / keyBars are
// how often the chord and the key may move; play is how the orbit becomes the
// lead (see tick).
const STYLES = {
  orbit: {tag:'Orbit', tempo:1,    min:60,  max:200, chordBars:1, keyBars:1, bass:'beats',   drums:'',      lead:'fm',     play:'detail', verb:0,     padAtk:0.8},
  drift: {tag:'Drift', tempo:0.5,  min:40,  max:72,  chordBars:2, keyBars:4, bass:'drone',   drums:'',      lead:'bell',   play:'sparse', verb:0.35,  padAtk:3},
  bells: {tag:'Bells', tempo:0.75, min:60,  max:110, chordBars:2, keyBars:2, bass:'',        drums:'',      lead:'bell',   play:'euclid', verb:0.2,   padAtk:1.5},
  pulse: {tag:'Pulse', tempo:1,    min:118, max:140, chordBars:4, keyBars:8, bass:'eighths', drums:'pulse', lead:'pluck',  play:'detail', verb:0,     padAtk:0.4},
  chip:  {tag:'Chip',  tempo:1.1,  min:100, max:170, chordBars:1, keyBars:2, bass:'eighths', drums:'chip',  lead:'square', play:'arp',    verb:-0.08, padAtk:0.05},
};
const DIALS = ['morph','detail','speed','zoom','react','hue','iter','ca','cb','cc','spinr','lite','dof','dpth','lit'];
const clamp = (x,a,b) => Math.min(b, Math.max(a, x));
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

// ---- Orbit kernels --------------------------------------------------------
// Each returns up to n points as [angle, size, escaped]. Seeds drift with the
// scene clock so the melody evolves the way the picture does.
function orbit2(c, z, n, bail){
  const out = [];
  for(let i=0;i<n;i++){
    const x = z[0]*z[0]-z[1]*z[1]+c[0], y = 2*z[0]*z[1]+c[1];
    z = [x,y];
    const r = Math.hypot(x,y);
    out.push([Math.atan2(y,x), r, r>bail]);
    if(r>bail) break;
  }
  return out;
}
function orbitBulb(p, c, pw, n){
  const out = [];
  for(let i=0;i<n;i++){
    const r = Math.hypot(p[0],p[1],p[2]);
    if(r>2){ out.push([0,r,true]); break; }
    const th = Math.acos(clamp(p[2]/(r||1e-9),-1,1))*pw, ph = Math.atan2(p[1],p[0])*pw, rp = Math.pow(r,pw);
    p = [rp*Math.sin(th)*Math.cos(ph)+c[0], rp*Math.sin(th)*Math.sin(ph)+c[1], rp*Math.cos(th)+c[2]];
    out.push([ph, Math.hypot(p[0],p[1],p[2]), false]);
  }
  return out;
}
function orbitBox(p, sc, n){
  const out = [], c = p.slice();
  for(let i=0;i<n;i++){
    p = p.map(v => v>1 ? 2-v : (v<-1 ? -2-v : v));
    const r2 = p[0]*p[0]+p[1]*p[1]+p[2]*p[2];
    const k = r2<0.25 ? 4 : (r2<1 ? 1/r2 : 1);
    p = p.map((v,j) => v*k*sc + c[j]);
    const r = Math.hypot(p[0],p[1],p[2]);
    out.push([Math.atan2(p[1],p[0]), r/4, r>40]);
    if(r>40) break;
  }
  return out;
}
function orbitSphere(p, k, n){
  const out = [];
  for(let i=0;i<n;i++){
    p = p.map(v => -1 + 2*(((v*0.5+0.5)%1+1)%1));
    const r2 = Math.max(1e-4, p[0]*p[0]+p[1]*p[1]+p[2]*p[2]), s = k/r2;
    p = p.map(v => v*s);
    out.push([Math.atan2(p[1],p[0]), clamp(Math.sqrt(r2),0,2), false]);
  }
  return out;
}
function orbitClifford(x, y, a, b, c, d, n){
  const out = [];
  for(let i=0;i<n;i++){
    const nx = Math.sin(a*y)+c*Math.cos(a*x), ny = Math.sin(b*x)+d*Math.cos(b*y);
    x = nx; y = ny;
    out.push([Math.atan2(y,x), Math.hypot(x,y)/2, false]);
  }
  return out;
}

// The scene's formula family, from its preset group and kind.
function sceneOrbit(pre, e, t, n){
  const m = pre ? pre.mode : -1, grp = pre ? pre.grp : '', kind = pre ? pre.kind : '';
  const g = k => e[k] == null ? 0.5 : e[k];
  // Offset so the seed never starts on an axis, where every step has the same
  // angle and the phrase is one note.
  const w = 1.3 + t * 0.07 * (0.3 + g('speed'));
  if(kind === '2D' && grp === 'FLD'){
    if(m === 7){
      const c = [-0.4+(g('ca')-0.5)*1.1+(g('morph')-0.5)*0.25, 0.6+(g('cb')-0.5)*1.1];
      const r = 0.25 + g('detail')*0.6;
      return orbit2(c, [r*Math.cos(w), r*Math.sin(w)], n, 2);
    }
    // Mandelbrot-like: walk just outside the main cardioid, where orbits are
    // long and varied. Morph pushes the walk in or out.
    const a = w + (g('ca')-0.5)*2, s = 0.94 + (g('morph')-0.5)*0.16;
    const c = [s*(0.5*Math.cos(a) - 0.25*Math.cos(2*a)), s*(0.5*Math.sin(a) - 0.25*Math.sin(2*a))];
    return orbit2(c, [0,0], n, 2);
  }
  if(kind === '3D'){
    const p0 = [0.9*Math.cos(w)*Math.cos(w*0.37), 0.9*Math.sin(w*0.37), 0.9*Math.sin(w)*Math.cos(w*0.37)];
    if(grp === 'BULB'){
      const pw = 3 + g('morph')*8 + (g('ca')-0.5)*4;
      const julia = m === 4 || m === 14;
      const c = julia ? [(g('ca')-0.5)*1.2, (g('cb')-0.5)*1.2, (g('cc')-0.5)*0.8] : p0;
      return orbitBulb(p0, c, pw, n);
    }
    if(grp === 'LATT') return orbitBox(p0.map(v=>v*2), -(1.5 + g('morph')*1.2 + (g('ca')-0.5)*0.6), n);
    return orbitSphere(p0, 0.9 + g('morph')*0.4 + (g('ca')-0.5)*0.3, n);
  }
  if(grp === 'ATTR' || grp === 'FLM'){
    return orbitClifford(Math.cos(w)*0.5, Math.sin(w)*0.5, -1.4+g('ca')*0.8, 1.6+g('cb')*0.4, 1.0+g('cc')*0.6, 0.7+g('morph')*0.6, n);
  }
  return null; // synth, tunnel and scene families: no formula to sonify
}

// ---- Synth ----------------------------------------------------------------
class Sonify {
  constructor(){
    this.on = false; this.ac = null; this.scale = 'minpent'; this.style = 'orbit'; this.eu = []; this.eIdx = 0;
    this.ctx = {e:{}, pre:null, t:0, bpm:0};
    this.step = 0; this.bar = 0; this.phrase = []; this.root = 48; this.chord = [];
    this.midi = null; this.midiOut = null; this.midiNotes = new Set(); this.lastCC = {};
    this.pads = []; this.timer = null; this.lastMode = null;
  }
  async start(){
    if(this.on) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return false;
    if(!this.ac){
      const ac = this.ac = new AC({latencyHint:'playback'});
      this.out = ac.createGain(); this.out.gain.value = 0;
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -18; comp.ratio.value = 4; comp.attack.value = 0.01; comp.release.value = 0.25;
      this.out.connect(comp); comp.connect(ac.destination);
      // Reverb: a generated decaying-noise impulse, no file to load.
      const len = Math.floor(ac.sampleRate*2.6), ir = ac.createBuffer(2, len, ac.sampleRate);
      for(let ch=0;ch<2;ch++){ const d = ir.getChannelData(ch); for(let i=0;i<len;i++) d[i] = (Math.random()*2-1)*Math.pow(1-i/len, 3); }
      this.verb = ac.createConvolver(); this.verb.buffer = ir;
      this.verbIn = ac.createGain(); this.verbIn.gain.value = 0.25;
      this.verbIn.connect(this.verb); this.verb.connect(this.out);
      // Delay on the lead, synced to the beat each bar.
      this.dly = ac.createDelay(2); this.dlyFb = ac.createGain(); this.dlyFb.gain.value = 0.3;
      this.dlyIn = ac.createGain(); this.dlyIn.gain.value = 0.3;
      this.dlyIn.connect(this.dly); this.dly.connect(this.dlyFb); this.dlyFb.connect(this.dly);
      this.dly.connect(this.out); this.dly.connect(this.verbIn);
      // Pad bus: shared lowpass that Zoom opens.
      this.padF = ac.createBiquadFilter(); this.padF.type = 'lowpass'; this.padF.Q.value = 2;
      this.padG = ac.createGain(); this.padG.gain.value = 0.12;
      this.padF.connect(this.padG); this.padG.connect(this.out); this.padG.connect(this.verbIn);
      // Lead bus with a stereo panner that Spin swings.
      this.leadPan = ac.createStereoPanner ? ac.createStereoPanner() : ac.createGain();
      this.leadG = ac.createGain(); this.leadG.gain.value = 0.5;
      this.leadPan.connect(this.leadG); this.leadG.connect(this.out); this.leadG.connect(this.dlyIn); this.leadG.connect(this.verbIn);
    }
    if(this.ac.state === 'suspended') await this.ac.resume();
    this.on = true;
    const now = this.ac.currentTime;
    this.out.gain.cancelScheduledValues(now); this.out.gain.setTargetAtTime(0.8, now, 0.3);
    this.next = now + 0.1; this.step = 0; this.bar = 0;
    this.timer = setInterval(() => this.schedule(), 25);
    return true;
  }
  stop(){
    if(!this.on) return;
    this.on = false; clearInterval(this.timer); this.timer = null;
    const now = this.ac.currentTime;
    this.out.gain.cancelScheduledValues(now); this.out.gain.setTargetAtTime(0, now, 0.15);
    this.pads.forEach(v => this.release(v, now)); this.pads = [];
    this.midiAllOff();
  }
  setScale(k){ if(SCALES[k]) this.scale = k; }
  setStyle(k){ if(STYLES[k]){ this.style = k; this.keyAt = null; this.chordAt = null; } }
  sty(){ return STYLES[this.style] || STYLES.orbit; }
  // Frame loop hands over the latest view of the scene. Cheap: no allocation
  // beyond the object it is given.
  update(ctx){ this.ctx = ctx; if(this.on) this.sendCC(); }

  async midiToggle(){
    if(this.midiOut){ this.midiAllOff(); this.midiOut = null; return null; }
    if(!navigator.requestMIDIAccess) throw new Error('This browser has no Web MIDI');
    if(!this.midi) this.midi = await navigator.requestMIDIAccess();
    const outs = Array.from(this.midi.outputs.values());
    if(!outs.length) throw new Error('No MIDI output found');
    this.midiOut = outs[0];
    return this.midiOut.name || 'MIDI';
  }
  midiSend(bytes, at){
    if(!this.midiOut) return;
    // AudioContext time to performance.now() time for MIDI timestamps.
    const ms = performance.now() + Math.max(0, (at - this.ac.currentTime)*1000);
    try{ this.midiOut.send(bytes, ms); }catch(e){}
  }
  midiNote(ch, note, vel, at, dur){
    if(!this.midiOut) return;
    note = clamp(Math.round(note),0,127);
    this.midiSend([0x90|ch, note, clamp(Math.round(vel*127),1,127)], at);
    this.midiSend([0x80|ch, note, 0], at+dur);
  }
  midiAllOff(){ if(this.midiOut) for(const ch of [0,1,2,9]) try{ this.midiOut.send([0xB0|ch,123,0]); }catch(e){} }
  sendCC(){
    if(!this.midiOut) return;
    const e = this.ctx.e || {};
    DIALS.forEach((k,i) => {
      let v = e[k]; if(v == null) return;
      if(k === 'hue') v = ((v%1)+1)%1;
      v = clamp(Math.round(v*127),0,127);
      if(this.lastCC[k] !== v){ this.lastCC[k] = v; try{ this.midiOut.send([0xB0, 20+i, v]); }catch(err){} }
    });
  }

  g(k, d){ const v = this.ctx.e && this.ctx.e[k]; return v == null ? (d==null?0.5:d) : v; }
  tempo(){
    const b = this.ctx.bpm;
    const S = this.sty(), base = (b > 50 && b < 200) ? b : 72 + clamp(this.g('speed'),0,2)*44;
    return clamp(base*S.tempo, S.min, S.max);
  }
  // Scale degree -> MIDI note, from the current root.
  deg(d, base){
    const iv = SCALES[this.scale].iv, n = iv.length;
    const o = Math.floor(d/n), i = ((d%n)+n)%n;
    return base + iv[i] + 12*o;
  }
  schedule(){
    if(!this.on || !this.ac) return;
    const ahead = this.ac.currentTime + 0.12;
    // A long stall (tab hidden) would replay a burst of missed notes; skip ahead.
    if(this.next < this.ac.currentTime - 0.2) this.next = this.ac.currentTime + 0.05;
    while(this.next < ahead){
      const sixteenth = 60/this.tempo()/4;
      this.tick(this.next, sixteenth);
      this.next += sixteenth; this.step++;
    }
  }
  tick(at, s16){
    const st = this.step % 16, S = this.sty();
    const pre = this.ctx.pre, mode = pre ? pre.mode : null;
    const changed = mode !== this.lastMode;
    if(st === 0 || changed){
      if(st === 0) this.bar++;
      this.lastMode = mode;
      this.newBar(at, s16, changed);
    }
    const ph = this.phrase, len = ph.length;
    const at16 = i => len ? ph[((i%len)+len)%len] : null;
    // Bass
    const root = this.chord.length ? this.chord[0] - 12 : this.root - 12;
    const rv = 0.35 + this.g('react')*0.5;
    if(S.bass === 'beats' && (st === 0 || st === 8)) this.bass(at, s16*6, rv, root, 'triangle', 0.01);
    if(S.bass === 'drone' && st === 0 && this.bar % 2 === 1) this.bass(at, s16*32, 0.3, root, 'sine', 1.2);
    if(S.bass === 'eighths' && st % 2 === 0){
      // The orbit picks the octave: a strong step jumps the bass up.
      const nt = at16(st/2), up = nt && nt.vel > 0.6 ? 12 : 0;
      this.bass(at, s16*1.6, rv*0.8, root + up, S.drums === 'chip' ? 'square' : 'sawtooth', 0.005);
    }
    // Drums: a fixed grid plus ghost hits wherever the orbit is strong.
    if(S.drums === 'pulse'){
      if(st % 4 === 0) this.kick(at);
      if(st % 4 === 2) this.hat(at, 0.12, 0.05);
      if(st === 4 || st === 12) this.snare(at);
      const nt = at16(st);
      if(st % 2 === 1 && nt && nt.vel > 0.7) this.hat(at, 0.05, 0.03);
    } else if(S.drums === 'chip'){
      if(st === 0 || st === 8) this.kick(at);
      if(st % 2 === 0) this.hat(at, 0.06, 0.025);
      if(st === 4 || st === 12) this.snare(at);
    }
    // Lead: the orbit phrase, played the style's way.
    if(!len) return;
    if(S.play === 'detail'){
      // Detail sets density: 8ths at low, 16ths at high.
      const every = this.g('detail') > 0.55 ? 1 : 2;
      if(st % every) return;
      const nt = at16(st/every);
      if(nt) this.lead(at, s16*every*0.9, nt.note, nt.vel);
    } else if(S.play === 'sparse'){
      // Quarter notes, walking on through the orbit from bar to bar, and only
      // its strongest steps sound: a long phrase is heard over several bars.
      if(st % 4) return;
      const nt = at16(st/4 + this.bar*4);
      if(nt && nt.vel > 0.5) this.lead(at, s16*10, nt.note, nt.vel*0.8);
    } else if(S.play === 'euclid'){
      // Hits spread as evenly as possible over the bar (a Euclidean rhythm);
      // Iter sets how many, Morph turns the pattern. Each hit takes the next
      // orbit note.
      if(!this.eu[st]) return;
      const nt = at16(this.eIdx++);
      if(nt) this.lead(at, s16*3, nt.note, nt.vel);
    } else if(S.play === 'arp'){
      const nt = at16(st);
      const m = nt ? nt.note : (this.chord[st % 3] || this.root) + 24;
      this.lead(at, s16*0.7, m, nt ? nt.vel : 0.4);
    }
  }
  newBar(at, s16, changed){
    const e = this.ctx.e || {}, pre = this.ctx.pre, S = this.sty();
    // Key from Hue, chosen only at bar lines (every few bars in the slower
    // styles) so an animated hue sweeps keys musically instead of smearing them.
    if(changed || this.keyAt == null || this.bar - this.keyAt >= S.keyBars){
      const hue = ((this.g('hue')%1)+1)%1;
      this.root = 43 + Math.floor(hue*12); this.keyAt = this.bar;
    }
    const newChord = changed || this.chordAt == null || this.bar - this.chordAt >= S.chordBars;
    if(newChord){
      this.chordAt = this.bar; this.chordN = (this.chordN || 0) + 1;
      const prog = PROGS[clamp(Math.floor(this.g('cb')*PROGS.length),0,PROGS.length-1)];
      const d = prog[this.chordN % prog.length];
      this.chord = [d, d+2, d+4].map(x => this.deg(x, this.root));
    }
    // Mix from the effect dials.
    const now = at;
    this.verbIn.gain.setTargetAtTime(clamp(0.12 + this.g('dof',0)*0.7 + S.verb, 0, 1.2), now, 0.4);
    this.dlyFb.gain.setTargetAtTime(0.15 + this.g('dpth',0)*0.6, now, 0.4);
    this.dly.delayTime.setTargetAtTime(s16*3, now, 0.05);
    this.padG.gain.setTargetAtTime(0.07 + this.g('lit',0)*0.18, now, 0.5);
    this.padF.frequency.setTargetAtTime(250*Math.pow(2, clamp(this.g('zoom'),0,1)*5), now, 0.6);
    this.leadG.gain.setTargetAtTime(0.25 + clamp(this.g('lite'),0,1)*0.45, now, 0.3);
    // Pad: retrigger on each new chord, or at once on a scene change.
    if(newChord){
      const dur = s16*16*S.chordBars;
      this.pads.forEach(v => this.release(v, now));
      this.pads = this.chord.map((m,i) => this.padVoice(now, m - 12 + (i===0?0:12), dur));
      this.chord.forEach(m => this.midiNote(2, m, 0.5, now, dur - s16*0.5));
    }
    // Melody from the scene's orbit.
    const len = 4 + Math.round(this.g('iter')*12);
    const orb = sceneOrbit(pre, e, this.ctx.t || 0, len);
    const lo = this.root + 12 + Math.round((this.g('cc')-0.5)*2)*12;
    const iv = SCALES[this.scale].iv.length;
    if(orb && orb.length){
      this.phrase = orb.map(([ang, r, esc]) => esc ? null : {
        note: this.orbNote(ang, r, lo, iv),
        vel: clamp(0.35 + 0.65*(1 - Math.abs(Math.min(r,2)-1)), 0.2, 1)
      });
      // An orbit that escapes at once leaves a near-empty phrase; pad with rests
      // so short orbits read as sparse phrases rather than one note on repeat.
      while(this.phrase.length < 4) this.phrase.push(null);
    } else {
      // No formula: an arpeggio over the chord, shaped by Morph.
      const pat = this.g('morph') > 0.5 ? [0,1,2,1,3,2,1,2] : [0,2,1,3];
      this.phrase = pat.map((p,i) => ({note: (p===3 ? this.chord[0]+12 : this.chord[p]) + 12, vel: i%2 ? 0.45 : 0.7}));
    }
    // Euclidean pattern for the Bells style: k hits over 16 steps, rotated.
    const k = 3 + Math.round(clamp(this.g('iter'),0,1)*8), rot = Math.floor(clamp(this.g('morph'),0,1)*15);
    this.eu = Array.from({length:16}, (_,i) => { const j = (i + rot) % 16; return Math.floor(j*k/16) !== Math.floor((j-1)*k/16); });
    this.eIdx = 0;
    // Spin swings the lead across the stereo field.
    if(this.leadPan.pan) this.leadPan.pan.setTargetAtTime(Math.sin(this.bar*1.3)*clamp(Math.abs(this.g('spinr')-0.5)*2,0,1)*0.7, now, 0.5);
    if(changed && this.ctx.pre){
      // Scene change: a soft swell so the cut is heard.
      this.swell(now);
    }
  }
  // Orbit step -> note. Angle picks the degree within an octave and size the
  // octave-and-a-bit above it, so orbits that settle into a cycle still move
  // when their radius does. Folded into three octaves above lo.
  orbNote(ang, r, lo, n){
    const a = ((ang/(2*Math.PI))%1 + 1)%1;
    let d = Math.floor(a*n) + Math.floor(clamp(r,0,2)*n*0.75);
    let m = this.deg(d, lo);
    while(m > lo + 36) m -= 12;
    while(m < lo) m += 12;
    return m;
  }
  padVoice(at, m, dur){
    const ac = this.ac, g = ac.createGain(), f = mtof(m), oscs = [];
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(0.33, at + Math.min(this.sty().padAtk, dur*0.5));
    [-7, 0, 7].forEach(dt => { const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = dt; o.connect(g); o.start(at); oscs.push(o); });
    g.connect(this.padF);
    return {g, oscs};
  }
  release(v, at){
    try{
      v.g.gain.cancelScheduledValues(at); v.g.gain.setTargetAtTime(0, at, 0.25);
      v.oscs.forEach(o => o.stop(at + 1.5));
    }catch(e){}
  }
  lead(at, dur, m, vel){
    const ac = this.ac, f = mtof(m), kind = this.sty().lead, g = ac.createGain();
    let end = at + dur + 0.3;
    if(kind === 'fm' || kind === 'bell'){
      // Two-operator FM; Cst C raises the index for a brighter, more metallic
      // tone. The bell uses an inharmonic ratio and a long ring.
      const bell = kind === 'bell';
      const car = ac.createOscillator(), mod = ac.createOscillator(), mg = ac.createGain();
      car.type = 'sine'; mod.type = 'sine';
      car.frequency.value = f; mod.frequency.value = f*(bell ? 3.5 : 2);
      const idx = f*((bell ? 0.8 : 0.4) + this.g('cc')*(bell ? 2 : 2.5));
      const ring = bell ? 1.6 : 0.25;
      mg.gain.setValueAtTime(idx, at); mg.gain.exponentialRampToValueAtTime(Math.max(1, idx*0.15), at + dur + (bell ? 0.4 : 0));
      mod.connect(mg); mg.connect(car.frequency);
      g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime((bell ? 0.18 : 0.22)*vel, at + (bell ? 0.004 : 0.008));
      g.gain.exponentialRampToValueAtTime(0.001, at + dur + ring);
      end = at + dur + ring + 0.05;
      car.connect(g); car.start(at); mod.start(at); car.stop(end); mod.stop(end);
    } else if(kind === 'pluck'){
      const o = ac.createOscillator(), lp = ac.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.value = f; lp.type = 'lowpass'; lp.Q.value = 6;
      lp.frequency.setValueAtTime(800 + this.g('cc')*5000, at); lp.frequency.exponentialRampToValueAtTime(250, at + 0.18);
      g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(0.2*vel, at + 0.004);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.3);
      end = at + 0.35;
      o.connect(lp); lp.connect(g); o.start(at); o.stop(end);
    } else {
      const o = ac.createOscillator();
      o.type = 'square'; o.frequency.value = f;
      g.gain.setValueAtTime(0.07*vel, at); g.gain.setValueAtTime(0.07*vel, at + dur*0.8);
      g.gain.linearRampToValueAtTime(0, at + dur);
      end = at + dur + 0.02;
      o.connect(g); o.start(at); o.stop(end);
    }
    g.connect(this.leadPan);
    this.midiNote(0, m, vel, at, dur);
  }
  bass(at, dur, vel, m, type, atk){
    const ac = this.ac, o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'triangle'; o.frequency.value = mtof(m);
    let dst = this.out;
    if(o.type === 'sawtooth'){ const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500; lp.Q.value = 3; lp.connect(this.out); dst = lp; }
    const peak = (o.type === 'square' ? 0.18 : 0.5)*vel;
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(peak, at + (atk || 0.01));
    g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    o.connect(g); g.connect(dst);
    o.start(at); o.stop(at + dur + 0.05);
    this.midiNote(1, m, vel, at, dur);
  }
  noiseBuf(){
    if(this._nb) return this._nb;
    const ac = this.ac, len = Math.floor(ac.sampleRate*0.4), b = ac.createBuffer(1, len, ac.sampleRate), d = b.getChannelData(0);
    for(let i=0;i<len;i++) d[i] = Math.random()*2-1;
    return (this._nb = b);
  }
  kick(at){
    const ac = this.ac, o = ac.createOscillator(), g = ac.createGain();
    o.frequency.setValueAtTime(150, at); o.frequency.exponentialRampToValueAtTime(45, at + 0.12);
    g.gain.setValueAtTime(0.7, at); g.gain.exponentialRampToValueAtTime(0.001, at + 0.35);
    o.connect(g); g.connect(this.out); o.start(at); o.stop(at + 0.4);
    this.midiNote(9, 36, 0.9, at, 0.1);
  }
  hat(at, vol, len){
    const ac = this.ac, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = this.noiseBuf(); f.type = 'highpass'; f.frequency.value = 7000;
    g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(0.001, at + len);
    s.connect(f); f.connect(g); g.connect(this.out); s.start(at); s.stop(at + len + 0.02);
    this.midiNote(9, 42, vol*5, at, 0.05);
  }
  snare(at){
    const ac = this.ac, s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = this.noiseBuf(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.8;
    g.gain.setValueAtTime(0.3, at); g.gain.exponentialRampToValueAtTime(0.001, at + 0.18);
    s.connect(f); f.connect(g); g.connect(this.out); g.connect(this.verbIn); s.start(at); s.stop(at + 0.2);
    this.midiNote(9, 38, 0.8, at, 0.1);
  }
  swell(at){
    const ac = this.ac, len = Math.floor(ac.sampleRate*1.2), b = ac.createBuffer(1, len, ac.sampleRate), d = b.getChannelData(0);
    for(let i=0;i<len;i++) d[i] = Math.random()*2-1;
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = b; f.type = 'bandpass'; f.Q.value = 1.5;
    f.frequency.setValueAtTime(400, at); f.frequency.exponentialRampToValueAtTime(5000, at + 1.1);
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(0.12, at + 0.9); g.gain.linearRampToValueAtTime(0, at + 1.2);
    s.connect(f); f.connect(g); g.connect(this.verbIn); g.connect(this.out);
    s.start(at); s.stop(at + 1.25);
  }
}
Sonify.SCALES = SCALES;
Sonify.STYLES = STYLES;
Sonify.sceneOrbit = sceneOrbit;
window.Sonify = Sonify;
})();
