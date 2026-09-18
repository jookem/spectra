(function(){
const VERT = `#version 300 es
in vec2 a;void main(){gl_Position=vec4(a,0.0,1.0);}`;

const POST = `#version 300 es
precision highp float;
out vec4 o;
uniform sampler2D uScene;
uniform vec2 uRes;
uniform float uTime,uFx,uLoud,uBeat,uBass;
// Defocus strength. Set by the host and only ever non-zero on the 2D families,
// so the 3D scenes — which already carry real depth — are untouched.
uniform float uBokeh;
float h2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  vec2 cc=uv-0.5;
  float ab=uFx*(0.004+uBeat*0.005)*length(cc)*2.0;
  vec3 col;
  col.r=texture(uScene,uv+cc*ab).r;
  col.g=texture(uScene,uv).g;
  col.b=texture(uScene,uv-cc*ab).b;
  // Shallow focal plane. A macro lens on something this small holds only a
  // narrow band sharp, and that limit is most of why a fractal photograph reads
  // as an object in space rather than a plot. There is no depth buffer here, so
  // focus falls off with distance from frame centre — which is where the scenes
  // keep their subject anyway. Six taps on a golden-angle spiral rather than a
  // ring: a ring at this few samples shows as a visible halo, the spiral just
  // reads as blur. Weighting the taps by their own brightness is what makes the
  // highlights bloom into discs instead of averaging away, which is the part
  // the eye reads as bokeh.
  if(uBokeh>0.004){
    float coc=uBokeh*smoothstep(0.12,0.62,length(cc))*(1.0+uBass*0.5);
    if(coc>0.001){
      vec3 acc=col; float wsum=1.0;
      for(int i=0;i<6;i++){
        float fi2=float(i)+0.5;
        float ang=fi2*2.39996323;
        float rad=sqrt(fi2/6.0)*coc*0.035;
        vec3 s=texture(uScene,uv+vec2(cos(ang),sin(ang))*rad*vec2(1.0,uRes.x/uRes.y)).rgb;
        float w=1.0+dot(s,vec3(0.2126,0.7152,0.0722))*2.2;
        acc+=s*w; wsum+=w;
      }
      col=mix(col,acc/wsum,clamp(coc,0.0,1.0));
    }
  }
  if(uFx>0.01){
    vec3 bl=vec3(0.0);
    float r=(2.0+uBass*4.0);
    for(int i=0;i<8;i++){
      float a=float(i)*0.7854;
      bl+=texture(uScene,uv+vec2(cos(a),sin(a))*r*2.2/uRes).rgb;
    }
    bl*=0.125;
    col+=max(bl-0.5,0.0)*uFx*(0.9+uLoud*1.1);
    col*=1.0-uFx*0.10*(0.5+0.5*sin(gl_FragCoord.y*3.14159));
    col+=(h2(gl_FragCoord.xy+fract(uTime))-0.5)*0.045*uFx;
  }
  o=vec4(col,1.0);
}`;

const PAL_NAMES = ['Triad','Ember','Infra','Mono','Riso','Neon','Ramp','Bloom','Payne','Verdigris','Nocturne','Sienna','Kanagawa','Valley','Meadow'];

const FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uRes;
uniform float uTime,uBass,uMid,uHigh,uLoud,uBeat,uJump,uHue,uMorph,uDetail,uZoom,uReact,uSpeed;
// Auto-centring offset, in screen widths of the CURRENT frame. The app measures
// where the fractal's mass actually sits and feeds the error back here; the
// shader applies it along the camera's own right/up axes, which is the one place
// those axes exist exactly.
uniform vec2 uCtr3;
uniform int uMode;
uniform sampler2D uTex;
uniform sampler2D uPrev;
uniform float uVidMix,uHasTex,uVidFlip,uFeed,uDrift,uCamYaw,uCamPitch,uCamAuto,uCamRoll;
// Ambient rotation multiplier: -1 counter-clockwise, 0 frozen, +1 clockwise.
// Every self-driven spin in the file routes through it so one control stops them all.
uniform float uSpin;
// Noise-reduction master (Smth). Widens sub-pixel filters and relaxes the
// raymarch hit test; 0 = the old razor-thin, fizzy behaviour.
uniform float uSmooth;
uniform vec2 uPan;
// Endless-zoom master. 1 = the zoom slider is the phase of the scale-matched
// layer loop rather than an absolute depth (V on the host). 0 = the old
// absolute slider.
uniform float uZLoop;
// The endless-zoom triple, solved on the HOST and passed in rather than derived
// per family in here. Every family that loops needs the same three numbers — a
// point the set is linearly self-similar about, the log2 of the multiplier
// there, and its argument — and computing them in the shader meant a branch
// chain per family in the largest program in the set. As uniforms there is one
// code path, and adding a family costs no shader text at all.
//   uZAnc  anchor, in the same plane the family's p lives in
//   uZRat  octaves per sweep = log2|lambda|, times an integer (see the host)
//   uZRot  radians per sweep = arg(lambda), times the same integer
uniform vec2 uZAnc;
uniform float uZRat;
uniform float uZRot;
// Depth the sweep STARTS at, in octaves. Was a hard 9.0 everywhere, which is
// the right opening magnification for a cascade point but far too deep for a
// dendritic Julia: the branch network there is a few filaments wide at 2^-9
// and the rest of the frame is empty exterior. The sweep still spans exactly
// uZRat octaves whatever this is, so moving the start does not touch the wrap.
uniform float uZBase;
// Translucency on the raymarched families. Detail was the slider here and it
// barely moved the picture: on a distance-estimated surface the iteration count
// stops changing the silhouette after about eight, and the march step count
// only cleans up an edge. So Detail's geometry role is pinned to a fixed value
// for these scenes on the host, and the slider drives this instead — a real
// optical property with a visible range from opaque stone to lit wax.
uniform float uIOR;
// Iteration scale across a sweep, evaluated on the host because it depends only
// on the phase. A LINEARISABLE anchor -- every repelling cycle, so Julia, Sine
// Lambda, the Misiurewicz points -- adds a fixed handful of iterations per
// period, so its budget is flat and this stays 1. A period-doubling cascade
// anchor does not: the structure's period doubles every sweep, so resolving the
// same picture costs twice as many iterations at the bottom of the sweep as at
// the top. Held flat, the deep end starves and its interior blooms a few per
// cent wider, which is what the wrap was showing as a small change of size.
// Ramped by the family's own factor it reads the same at both ends, and since
// the ramp ends at 1.0 the peak is still the plain clamped budget.
uniform float uZIter;
// Probe channel. When set, every fragment traces the CENTRE ray instead of its
// own and the shader writes out the world position that ray landed on, packed
// into bytes, so the host can read back the point the viewer is looking AT and
// orbit that instead of the world origin.
uniform float uDepthOut;
vec3 gPiv=vec3(0.0); float gHit=0.0;
uniform float uTravel;
// Strobe gain, 0..1, ramped host-side. The frame pulse rides on it so the beat
// zoom is part of the strobe rather than a permanent property of the scene.
uniform float uStrobe;
uniform float uCA,uCB,uCC,uIter,uXfade;
uniform float uXfMode;
uniform vec2 uCtr;
uniform vec3 uOrbit;
uniform int uPalSel;
uniform float uSat,uGam,uSpan,uWarm;
// How strongly the interior is engraved. The attracting region has no escape
// count to colour it, so it plots as one dead shape; this is the amount of
// pattern laid into it instead.
uniform float uFill;
// Scene text. The message is baked to a signed distance field on the CPU (R =
// distance, G = letter index) so the shader can treat it as real geometry
// instead of a sprite: extruded in 3D it unions into the raymarch and occludes
// properly, and in 2D its gradient is what bends the pattern around the type.
uniform sampler2D uTxt;
uniform float uTxtOn,uTxtDepth,uTxtScale,uTxtY,uTxtHue,uTxtWeight,uTxtWarp,uTxtInk,uTxtLit,uTxtJit,uTxtAsp;
// Text placement. The message is translated in text space and turned about its
// own centre, so the transform is the same one at every sampling site — the 3D
// SDF, the ghost plane, the per-letter lookup and the 2D field all apply
// translate-then-rotate and therefore agree on where a given letter is.
uniform float uTxtX,uTxtRot,uTxtZ;
// Harmony inputs. uChroma is the 12-bin pitch class profile (which notes are
// sounding, octave-folded); uTonal is that profile projected onto the circle of
// fifths, so its angle is the key centre and its length is tonal clarity.
uniform float uChroma[12];
uniform float uNote,uNoteConf,uChordChg;
// Bar-relative beat position: 0..4 counting up, fractional part is the phase
// within the current beat. Tempo-locked structure (swells, shocks, camera
// drift) reads this instead of the uBeat transient, which only says "now".
uniform float uBeatPh;
uniform vec2 uTonal;
// Iteration budget. Iter is the coarse control; Detail is a second multiplier
// on top, so the Detail slider changes actual fractal depth everywhere rather
// than only shading sharpness. Both feed every DE loop and escape loop.
float fi(){return mix(0.30,1.8,uIter)*mix(0.45,2.0,uDetail);}
vec2 cmul(vec2 a,vec2 b){return vec2(a.x*b.x-a.y*b.y,a.x*b.y+a.y*b.x);}
vec2 cdiv(vec2 a,vec2 b){float d=dot(b,b);return vec2(a.x*b.x+a.y*b.y,a.y*b.x-a.x*b.y)/max(d,1e-12);}
vec2 cpow_d(vec2 z,float e){float r=pow(max(length(z),1e-9),e),a=atan(z.y,z.x)*e;return r*vec2(cos(a),sin(a));}
uniform int uVidMode;
uniform sampler2D uSpec;
float specAt(float x){ return texture(uSpec, vec2(clamp(x,0.0,1.0),0.25)).r; }
// The video block is appended after the geometry blocks, but surface projection
// has to sample the frame from inside the raymarch shading — hence prototypes.
vec3 sampleVid(vec2 t);
vec3 surfVid(vec3 p, vec3 n);
bool vidSurfOn(){ return uHasTex>0.5 && uVidMix>0.001 && uVidMode>=11; }
vec2 wvLR(float x){ return texture(uSpec, vec2(clamp(x,0.0,1.0),0.75)).rg*2.0-1.0; }
float wvL(float x){ return wvLR(x).x; }

mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
// Principal complex square root. Only the endless zoom needs it, to solve for
// the repelling fixed point a Julia set is self-similar about.
vec2 csqrt(vec2 w){
  float r=length(w);
  return vec2(sqrt(max(r+w.x,0.0)*0.5), sign(w.y+1e-9)*sqrt(max(r-w.x,0.0)*0.5));
}
// Multi-stop gradient ramp. Unlike the cosine palettes, which sweep hue at a
// constant rate, a stop list can hold a colour across several shells and then
// turn hard — that uneven pacing is what makes deep zooms read as gold cores
// cooling out through plum into teal, instead of an even rainbow.
vec3 ramp(float x, vec3 a, vec3 b, vec3 c, vec3 d, vec3 e, vec3 f){
  x=fract(x)*6.0;
  float i=floor(x), u=smoothstep(0.0,1.0,fract(x));
  if(i<1.0) return mix(a,b,u);
  if(i<2.0) return mix(b,c,u);
  if(i<3.0) return mix(c,d,u);
  if(i<4.0) return mix(d,e,u);
  if(i<5.0) return mix(e,f,u);
  return mix(f,a,u);
}
vec3 rampM(float x, vec3 a, vec3 b, vec3 c, vec3 d, vec3 e){
  float t=abs(fract(x*0.5)*2.0-1.0)*4.0;
  float i=floor(t), u=smoothstep(0.0,1.0,fract(t));
  if(i<1.0) return mix(a,b,u);
  if(i<2.0) return mix(b,c,u);
  if(i<3.0) return mix(c,d,u);
  return mix(d,e,u);
}
vec3 pal(float t){
  float tt=t*uSpan+uHue;
  vec3 base;
  if(uPalSel==1){ float x=0.5+0.5*sin(tt*6.28318); base=mix(vec3(0.03,0.04,0.09),vec3(0.95,0.42,0.12),x); }
  else if(uPalSel==2){ float x=fract(tt); base=mix(mix(vec3(0.0),vec3(0.85,0.09,0.04),smoothstep(0.0,0.5,x)),vec3(1.0,0.93,0.55),smoothstep(0.5,1.0,x)); }
  else if(uPalSel==3){ base=0.5+0.5*cos(6.28318*(vec3(0.0,0.07,0.14)+tt)); }
  else if(uPalSel==4){ float x=0.5+0.5*sin(tt*6.28318); base=mix(vec3(0.07,0.28,0.92),vec3(0.98,0.2,0.55),x); }
  else if(uPalSel==5){ base=0.5+0.5*cos(6.28318*(vec3(0.0,0.52,0.78)+tt*1.35)); }
  else if(uPalSel==6){ base=ramp(tt, vec3(0.99,0.86,0.44), vec3(0.94,0.49,0.22), vec3(0.55,0.13,0.30),
                                     vec3(0.25,0.13,0.48), vec3(0.13,0.62,0.60), vec3(0.55,0.93,0.87)); }
  else if(uPalSel==7){ base=ramp(tt, vec3(0.06,0.10,0.22), vec3(0.35,0.72,0.72), vec3(0.86,0.94,0.82),
                                     vec3(0.95,0.55,0.34), vec3(0.72,0.20,0.42), vec3(0.32,0.14,0.40)); }
  else if(uPalSel==8){ base=rampM(tt, vec3(0.04,0.05,0.10), vec3(0.17,0.24,0.42), vec3(0.42,0.50,0.60),
                                      vec3(0.80,0.78,0.72), vec3(0.78,0.47,0.22)); }
  else if(uPalSel==9){ base=rampM(tt, vec3(0.05,0.06,0.06), vec3(0.08,0.22,0.24), vec3(0.16,0.48,0.42),
                                      vec3(0.51,0.76,0.63), vec3(0.90,0.88,0.78)); }
  else if(uPalSel==10){ base=rampM(tt, vec3(0.03,0.04,0.09), vec3(0.20,0.13,0.33), vec3(0.52,0.28,0.40),
                                       vec3(0.82,0.50,0.38), vec3(0.98,0.80,0.45)); }
  else if(uPalSel==11){ base=rampM(tt, vec3(0.07,0.06,0.06), vec3(0.28,0.14,0.09), vec3(0.60,0.30,0.15),
                                       vec3(0.83,0.60,0.30), vec3(0.95,0.90,0.78)); }
  else if(uPalSel==12){ base=rampM(tt, vec3(0.024,0.075,0.145), vec3(0.055,0.195,0.335), vec3(0.165,0.375,0.545),
                                       vec3(0.560,0.715,0.790), vec3(0.945,0.915,0.845)); }
  else if(uPalSel==13){ base=ramp(tt, vec3(0.039,0.055,0.149), vec3(0.071,0.337,0.408), vec3(0.337,0.769,0.698),
                                       vec3(0.969,0.910,0.745), vec3(0.769,0.376,0.227), vec3(0.216,0.110,0.278)); }
  else if(uPalSel==14){ base=ramp(tt, vec3(0.945,0.960,0.855), vec3(0.720,0.855,0.545), vec3(0.435,0.635,0.345),
                                       vec3(0.360,0.455,0.780), vec3(0.910,0.450,0.300), vec3(0.820,0.880,0.960)); }
  else { base=0.5+0.5*cos(6.28318*(vec3(0.0,0.33,0.67)+tt)); }
  vec3 duo=0.5+0.5*cos(6.28318*(vec3(0.0,0.12,0.24)+tt*0.7));
  vec3 c=mix(base,duo,clamp(uCC,0.0,1.0)*(uPalSel==0?1.0:0.0));
  // Global color trim, applied to every palette. Saturation pivots on Rec.709
  // luma so 0 is a true greyscale and >1 pushes past the palette's own range;
  // warmth is a complementary R/B tilt; gamma shapes the ramp's midtones.
  float lum=dot(c,vec3(0.2126,0.7152,0.0722));
  c=mix(vec3(lum),c,uSat);
  c*=vec3(1.0+uWarm*0.34,1.0+abs(uWarm)*-0.05,1.0-uWarm*0.34);
  c=pow(max(c,0.0),vec3(uGam));
  return c;
}
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  float a=hash(i),b=hash(i+vec2(1,0)),c=hash(i+vec2(0,1)),d=hash(i+vec2(1,1));
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}
float fbm(vec2 p){float v=0.0,a=0.5;for(int i=0;i<6;i++){if(a<0.02)break;v+=a*noise(p);p=p*2.03*rot(0.5);a*=0.47;}return mix(v,smoothstep(0.12,0.88,v),uSmooth*0.85);}
// Orbit trap geometry, per family. One shared trap across every 2D scene was
// most of why they read alike — the trap is what textures the inside of the
// bands, so giving each family its own makes them distinguishable at a glance.
// Trap selection resolved ONCE per pixel, not once per iteration. The first
// version ran a six-way uniform compare inside the escape loop — up to 900
// iterations per pixel — which is what made the 2D scenes crawl. Here the
// family picks a set of term weights up front and the loop evaluates a single
// branchless expression.
// Three terms, no transcendentals: a ring at r0 plus the two axis rails. The
// earlier version added a sin() spoke term and a second length() to the escape
// loop, which on a 920-iteration unrolled shader cost enough compile time that
// the boot queue looked stalled. Families stay distinguishable through the
// ring radius and which rails are enabled, backed by the per-family stripe
// rate — the sin is not needed to tell them apart.
// w = (ring, |re| rail, |im| rail); r0 = ring radius.
void trapCfg(out vec3 w, out float r0){
  w=vec3(0.0,0.0,0.0); r0=1.0;
  if(uMode==7)       { w.x=1.0; }                       // Julia: unit shell
  else if(uMode==8)  { w.z=1.0; }                       // Sine Lambda: rulings
  else if(uMode==17) { w.x=1.0; w.y=1.0; r0=0.35; }     // Multibrot: tight ring + rail
  else if(uMode==18) { w.y=1.0; }                       // Phoenix: vertical rails
  else if(uMode==20) { w.x=1.0; w.z=1.0; r0=0.5; }      // Ship: waterline + ring
  else if(uMode==21) { w.x=1.0; r0=0.8; }               // Celtic: wide ring
  else               { w.y=1.0; w.z=1.0; }              // Mandelbrot: cross
}
float trapD(vec2 z, float lz, vec3 w, float r0){
  const float OFF=1e6;
  float d=min(mix(OFF,abs(lz-r0),w.x), mix(OFF,abs(z.x),w.y));
  return min(d, mix(OFF,abs(z.y),w.z));
}
// Stripe rate per family, so the banding frequency is not shared either.
float sfScale(){
  if(uMode==7)  return 0.55;
  if(uMode==8)  return 1.85;
  if(uMode==18) return 1.35;
  if(uMode==20) return 0.80;
  if(uMode==21) return 0.70;
  return 1.0;
}
// Orbit length. On the families whose Morph used to be a fold (Mandelbrot,
// Sine Lambda, Ship Julia) it now sets how much of the orbit history colours
// the pixel: near 0 only the last few points count, so the texture is crisp
// and local; at 1 the whole orbit averages, so the bands run long and smooth.
float orbitKeep(){
  if(uMode==6||uMode==8||uMode==20) return mix(0.24,1.0,clamp(uMorph,0.0,1.0));
  return 1.0;
}

// Shared shading for the 2D escape-time families. Beyond smooth iteration
// count this uses the orbit derivative (analytic distance estimate + a fake
// surface normal for relief lighting), a stripe-average term, and an orbit
// trap — the three things that give 2D fractals the depth the 3D ones get
// from raymarched normals.
vec3 esc_shade(float i,float maxi,float m,vec2 z,vec2 dz,float st,float sn,float tr){
  float sm=i-log2(max(log2(max(m,2.0)),1.0))+4.0;
  float tt=sm/maxi;
  float lz=sqrt(max(m,1.0001));
  float de=lz*log(lz)/max(length(dz),1e-8);

  // Relief. The analytic normal (cdiv(z,dz)) only describes the boundary's own
  // slope; treating the smooth iteration count as a height field and taking its
  // screen-space gradient instead lights the whole exterior, so every shell and
  // filament is sculpted rather than a flat colour band. This is what separates
  // the reference's embossed ropes from a plain escape-time plot.
  float hgt=log(max(de,1e-7));
  vec2 gr=vec2(dFdx(hgt),dFdy(hgt));
  // Where the height field is stepping by a lot per pixel the gradient is a
  // difference of unrelated samples, not a slope — lighting it produces the
  // salt-and-pepper grain. Flatten the relief exactly as fast as it stops
  // meaning anything, and the shading goes smooth without losing the shells
  // that are still resolved.
  float grr=1.0/(1.0+length(gr)*mix(0.35,1.6,uSmooth));
  // Steeper normals than before: at 0.6-2.6 the relief was a suggestion, and
  // on the flat plate regions the surface read as paper. The reference gets its
  // rope-like boundary from a normal that actually turns through most of a
  // hemisphere, so the gradient gain runs to 4.4 and the z term drops to 0.75,
  // which is the same slope expressed as a shallower surface.
  vec3 n3=normalize(vec3(-gr*mix(1.1,4.4,uDetail)*grr, 0.75));
  vec2 nn=normalize(cdiv(z,dz)+vec2(1e-9));
  n3=normalize(mix(n3, normalize(vec3(nn,0.62)), 0.3));

  vec3 L=normalize(vec3(0.62,0.74,0.80));
  float dif=clamp(dot(n3,L),0.0,1.0);
  float bak=clamp(dot(n3,normalize(vec3(-0.7,-0.5,0.4))),0.0,1.0);
  float spec=pow(clamp(dot(reflect(-L,n3),vec3(0.0,0.0,1.0)),0.0,1.0),34.0);
  float rim=pow(1.0-clamp(n3.z,0.0,1.0),2.4);
  float ao=clamp(0.35+0.65*smoothstep(0.0,2.2,hgt+7.0),0.0,1.0);

  float stripe = sn>0.5 ? st/sn : 0.0;
  // Sub-pixel filtering. At depth the stripe average, the palette band edge and
  // the 34-power specular all cycle faster than one pixel, which is what makes
  // the boundary crawl and fizz as the frame drifts. Fading each toward its own
  // mean once fwidth says it is unresolvable is proper analytic AA: the coarse
  // structure is untouched, only the aliasing goes.
  float hfw = fwidth(hgt);
  float fadeHF = 1.0/(1.0+hfw*mix(1.2,7.0,uSmooth));
  stripe = mix(stripe, 0.5, clamp(fwidth(stripe)*mix(0.8,4.5,uSmooth),0.0,1.0));
  spec *= fadeHF;
  // Depth ramp. The shell index alone cycles the palette at a constant rate; the
  // second term is a slow non-linear drift with depth, so near-boundary shells
  // land on a different part of the ramp than the open field. That is what gives
  // a hot core cooling outward, rather than the same band repeating forever.
  float dpx = 1.0/max(hfw,1e-4);
  float ldp = log2(max(dpx,1.0));
  float prox = 1.0-smoothstep(0.0, mix(5.0,9.0,uDetail), ldp);
  float fil  = exp(-ldp*mix(1.6,1.0,uDetail));

  float phRate=mix(1.0,0.62,uSmooth);
  // Julia renders as a continuous-POTENTIAL FILL rather than a lit relief in a
  // dark field. The shading chain below is built for a boundary read: the open
  // exterior is pushed to a fourteenth of its value by the prox term, hazed, and
  // desaturated, which is correct when the subject is the filigree but leaves
  // most of the frame black. The classic escape-time plot does the opposite —
  // every pixel outside the set carries a saturated band, the bands crowd toward
  // the boundary and open out into broad sweeps in the far field, and there is
  // no black anywhere. Mode 7 takes that reading; every other family is
  // untouched, so this stays one flag threaded through the existing terms
  // instead of a second shading function.
  float fillw = uMode==7 ? 1.0 : 0.0;
  float ph=(pow(tt,0.42)*3.2+pow(tt,1.7)*1.15*mix(0.3,1.7,uCA))*phRate;
  // Flatter leading exponent, stronger tail: bands stay tight where the escape
  // count is climbing fast near the set and stretch into wide plates out in the
  // open field, which is the band rhythm the plot is recognised by.
  ph=mix(ph,(pow(tt,0.26)*1.75+pow(tt,1.30)*1.65*mix(0.3,1.7,uCA))*phRate,fillw);
  // The speckle left after the earlier AA pass was never the stripe or the
  // specular — it is the palette phase itself. Deep in the shell stack ph moves
  // by more than a whole cycle between neighbouring pixels, so pal() returns an
  // essentially random point on the ramp per pixel and the field reads as
  // dithered noise. No amount of softening a band EDGE fixes that; the cycle is
  // simply not resolvable. pfw is how many ramp cycles one pixel spans, and
  // where that passes 1 the only correct colour is the ramp's own average.
  float pfw=fwidth(ph);
  float res=1.0/(1.0+pfw*mix(1.6,5.0,uSmooth));
  float bw=clamp(pfw*mix(0.5,1.8,uSmooth),0.0,0.30);
  float stAmt=uCC*mix(1.0,0.38,uSmooth)*res;
  float band=fract(ph+stripe*stAmt*0.55);
  // The mean is taken from the two ramp taps this function already needed — a
  // dedicated four-tap average cost 4 extra pal() calls per pixel, and pal() is
  // a long branch chain over every palette, which is what made the shader too
  // heavy to link in reasonable time. Two antipodal taps are a good enough
  // average for a cyclic ramp and here they are free.
  vec3 pA=pal(ph+uHigh*0.3+stripe*stAmt*1.1);
  vec3 pB=pal(ph+0.5+uHigh*0.3);
  vec3 col=mix((pA+pB)*0.5, pA, res);
  col=mix(col, pB, smoothstep(0.42-bw,0.58+bw,band)*0.35*stAmt);

  // Harmony scene: each escape shell is assigned one of the twelve pitch
  // classes, so a ring lights only while its note is actually sounding. The
  // shells already march outward in order, which makes the reading legible
  // rather than a wash — Morph sets how many notes fit across the frame.
  if(uMode==39){
    float pc=mod(floor(sm*mix(0.25,1.4,uMorph)),12.0);
    float en=clamp(uChroma[int(pc)],0.0,1.0);
    col=mix(col,pal(pc/12.0*1.2),0.45)*(0.34+1.70*en);
    col+=pal(pc/12.0*1.2+0.5)*pow(en,2.5)*0.50;
  }

  // Golden Wave: a woodblock print has one carved block per colour, so the ramp
  // is quantised to a handful of flat plates rather than a continuous gradient.
  // Quantising the palette coordinate (not the final RGB) keeps every plate on
  // palette, and the fwidth term keeps each plate edge one pixel soft so the
  // quantisation does not reintroduce the aliasing the AA pass just removed.
  // Relief is damped at the same time: the print reads as flat inked areas with
  // gradation only where the block was wiped, not as a lit surface.
  if(uMode==40){
    float plates=floor(mix(3.0,7.0,uDetail)+0.5);
    float q=ph*plates;
    float qe=clamp(fwidth(q)*0.9,0.002,0.5);
    col=pal((floor(q)+smoothstep(0.5-qe,0.5+qe,fract(q)))/plates);
    dif=mix(dif,0.80,0.62); ao=mix(ao,1.0,0.55);
  }

  vec3 shTint=vec3(0.72,0.86,1.12), liTint=vec3(1.10,1.00,0.86);
  // Wider light-to-shadow throw. 0.16 ambient with a 1.05 diffuse term is a
  // nearly flat surface once ao has lifted the darks; pulling ambient down and
  // diffuse up is what turns the shells into a lit relief rather than a tinted
  // plot, and the ao exponent deepens the crevices between them.
  // Lit-relief exposure vs. fill exposure. The fill keeps a shallow amount of
  // the same light so the bands still have some roll across them, but it never
  // multiplies down to black, and ao is nearly lifted out so the crevices do
  // not punch holes in the field.
  col*=mix(shTint,liTint,dif)*mix(0.07+1.45*dif, 0.62+0.30*dif, fillw)
      *pow(ao,mix(1.35,0.40,fillw));
  col+=pal(0.62)*bak*0.18*ao;
  // The additive boundary terms were tuned against the lit-relief exposure,
  // where the field under them sits near 0.1 and they read as highlights. On the
  // fill the field is already near 1.0, so the same terms push the bands past
  // the tone map's knee and the crowded boundary clips to flat white — losing
  // exactly the yellow-into-red sweep the fill exists for. Damped here, not
  // removed: a trace keeps the boundary from going dead.
  float addf=mix(1.0,0.22,fillw);
  col+=spec*0.55*(0.4+uHigh)*addf;
  col+=pal(0.08+uMid*0.25)*rim*0.32*(0.5+uCB)*addf;
  // This is the term that made the far field black: prox goes to zero as soon
  // as the shells stop being resolvable, leaving a 0.14 multiplier over most of
  // the frame. The fill holds it near one.
  col*=mix(0.14+1.25*prox, 0.94+0.16*prox, fillw);
  col+=pal(0.55+uBass*0.3)*fil*2.1*fadeHF*res*addf;   // boundary filament
  col+=pal(0.18+uMid*0.3)*exp(-tr*16.0)*0.75*fadeHF*res*addf;          // orbit-trap filigree
  // Depth haze. Aerial perspective is what tells the eye that one part of an
  // image is further away than another, and an escape-time plot has a perfect
  // depth channel sitting unused: the smooth iteration count. Shells the orbit
  // took a long time to leave are the far field, so they wash toward a cool
  // tint and lose contrast, while the boundary filaments stay full strength in
  // front of them. prox keeps the near structure out of the fog.
  float fogd=clamp(pow(tt,0.70),0.0,1.0)*(1.0-prox*0.55);
  vec3 fogc=pal(0.60+uCB*0.12)*0.30;
  col=mix(col,fogc,fogd*mix(0.20,0.58,uSpan)*mix(1.0,0.14,fillw));
  float lm=dot(col,vec3(0.2126,0.7152,0.0722));
  // Aerial desaturation is a depth cue for the relief read. A fill plot is flat
  // by intention and wants full chroma edge to edge, so the fill skips it and
  // instead pushes chroma slightly PAST the palette to get the saturated
  // yellow-into-red sweeps rather than a pastel wash.
  col=mix(vec3(lm)*vec3(0.86,0.92,1.06),col,mix(0.55+0.45*prox,1.0,fillw));
  // Saturate BEFORE the tone map has anything to clip: pulling the luma down as
  // chroma goes up keeps the band inside the knee, so a hot band turns redder
  // instead of turning white.
  col=mix(col,clamp(lm*0.90,0.0,1.0)+(col-lm)*1.26,fillw);
  col+=uBeat*0.12;
  return col*(1.0+col*0.22)/(1.0+col*0.62);
}

// Interior points get trap structure instead of flat black.
vec3 esc_in(float tr,float st,float sn,vec2 dz,float maxi){
  float stripe = sn>0.5 ? st/sn : 0.0;
  if(uMode==8){
    // Rulings, not a void. Stripe (Cst C) sweeps from a smooth wash at 0 to hard
    // banding at 1, and the level floor keeps the interior legible either way.
    float k = 0.5+0.5*sin(stripe*6.2832 + uTime*0.05*uSpeed);
    float band = mix(k, smoothstep(0.35,0.65,k), clamp(uCC*1.4,0.0,1.0));
    float lum = 0.16 + band*(0.30+uCC*0.62) + exp(-tr*2.2)*0.22;
    vec3 rc = pal(0.62 + stripe*0.30 + tr*0.18)*lum
         + pal(0.40)*pow(band,6.0)*(0.10+uCC*0.30) + uBass*0.03;
    return rc;
  }
  // A 0.035 floor left the set as a hole punched in the frame — on a wall the
  // interior was simply a black shape. The orbit trap and the stripe average are
  // both defined in there and both carry structure, so the inside gets its own
  // banding, its own hue walk and a lit floor. Still darker than the exterior,
  // so the boundary still reads as the boundary.
  float k = 0.5+0.5*sin(stripe*6.2832 + tr*2.6 + uTime*0.04*uSpeed);
  float band = mix(k, smoothstep(0.28,0.72,k), clamp(uCC*1.2,0.0,1.0));
  // Interior depth. The orbit trap is a distance, so it doubles as a height:
  // points whose orbits pass close to the trap sit at the rim, points that
  // never do sit at the bottom. Shading against it turns the interior from a
  // flat plate into a basin that falls away from the boundary, and taking the
  // trap's screen gradient lights that basin from the same direction as the
  // exterior relief so the two read as one surface.
  float deep = smoothstep(0.0, 1.1, tr);
  // The trap basin above describes the interior only while the trap still
  // varies. Inside a large attracting lobe it does not: every orbit in there
  // ends on the same cycle, so tr saturates, its gradient is zero and the
  // region lights as one flat plate however steeply it is shaded. That plate is
  // most of what reads as the dead part of these scenes.
  //
  // The cycle's MULTIPLIER is the missing channel. The orbit derivative decays
  // like |lambda|^n toward an attracting cycle, so log|dz| divided by the
  // iteration count recovers log|lambda| -- zero on the lobe's own boundary,
  // most negative at its centre. It is a smooth dome over exactly the ground
  // the trap cannot describe, and it costs nothing: dz is already accumulated
  // by every escape loop in the set and was simply thrown away on interior hits.
  float mlt  = log(max(length(dz),1e-30))/max(maxi,1.0);
  float dome = clamp(-mlt*mix(1.2,4.5,uDetail),0.0,1.0);
  vec2 dg = vec2(dFdx(dome),dFdy(dome));
  vec3 dn = normalize(vec3(-dg*170.0/(1.0+length(dg)*60.0), 1.0));
  float ddif = clamp(dot(dn, normalize(vec3(0.62,0.74,0.80))),0.0,1.0);
  // Lit from the same direction as the exterior relief, so a lobe reads as a
  // swelling of the same surface rather than a separate flat shape pasted in.
  float drim = pow(1.0-dome,3.0);
  vec2 tg = vec2(dFdx(tr),dFdy(tr));
  vec3 tn = normalize(vec3(-tg*90.0/(1.0+length(tg)*40.0), 1.0));
  float tdif = clamp(dot(tn, normalize(vec3(0.62,0.74,0.80))),0.0,1.0);
  float lum = 0.10 + band*(0.16+uCC*0.26) + exp(-tr*3.0)*0.34;
  lum *= (1.0-0.42*deep)*(0.55+0.75*tdif);
  // Net gain under one. The dome is there to give the lobe form, not to make
  // it the brightest thing in the frame — lit any harder it out-competes the
  // filigree it sits behind, which is the opposite of the depth cue wanted.
  lum *= (0.52+0.46*ddif)*(0.70+0.28*(1.0-dome));
  vec3 ic = pal(0.70+tr*0.5+stripe*uCC*0.5)*lum
       + pal(0.28+band*0.30)*pow(band,5.0)*0.15
       + pal(0.44)*exp(-tr*11.0)*0.20 + uBass*0.03;
  // A lobe edge catches the light the way a shoulder does. This is the one
  // place the interior is allowed to be brighter than the field around it.
  ic += pal(0.10+uMid*0.25)*drim*0.10*(0.45+uCB);
  // Same aerial perspective the exterior gets, so the basin recedes instead of
  // sitting forward of the boundary that encloses it. The dome adds light the
  // flat plate never had, so the whole interior is held back a further notch:
  // form, but still behind the boundary in the reading order.
  ic *= 0.86;
  ic = mix(ic, pal(0.60+uCB*0.12)*0.24, deep*mix(0.18,0.50,uSpan));
  // Engraving. Brightening the interior only ever made it a paler dead shape —
  // what it lacks is not light but incident. Both fields that describe the
  // inside are continuous scalars, so slicing them at regular intervals draws
  // contour lines, exactly as a map contours a hill: the dome gives the lobe's
  // own level curves, the trap gives the orbit's. Dividing by the screen-space
  // derivative keeps every line one pixel wide however deep it is zoomed, so
  // the pattern neither aliases at the centre of a lobe nor smears at its rim.
  if(uFill>0.001){
    float dk=mix(14.0,46.0,uCC), tk=mix(9.0,26.0,uCC);
    float dl=1.0-smoothstep(0.0,1.0,abs(fract(dome*dk-0.5)-0.5)/max(fwidth(dome)*dk,1e-5));
    float tl=1.0-smoothstep(0.0,1.0,abs(fract(tr*tk-0.5)-0.5)/max(fwidth(tr)*tk,1e-5));
    // Hatching runs across the contours rather than along them, which is what
    // keeps the two line sets from collapsing into one moire. It is laid out
    // perpendicular to the dome's own gradient, so the strokes wrap the form
    // the way shading does on an etching.
    vec2 hd=normalize(dg+vec2(1e-6));
    float hl=(0.5+0.5*sin(dot(gl_FragCoord.xy,vec2(hd.y,-hd.x))*0.85))*smoothstep(0.12,0.70,dome);
    // The lines carry the palette, so the fill is the picture's own colour
    // rather than a grey screen over it, and they are densest where the basin
    // is deepest — precisely where the flat plate used to be.
    float amt=uFill*(0.35+0.65*deep);
    ic += pal(0.16+dome*0.42+uCB*0.10)*(dl*0.30+tl*0.20+hl*0.14)*amt;
    ic *= 1.0-0.22*amt*(1.0-dl)*(1.0-tl);
  }
  return ic;
}

// Endless travel by TILING. The fractal coordinate is wrapped into one cell of
// a lattice, so the plane repeats in every direction and travel can run forever
// without leaving the set. A MIRRORED fold was tried first and is what made
// panning bounce: at a fold line the image reflects, so the frame reverses and
// retraces ground it just crossed. A plain wrap always moves the same way — the
// copies scroll past continuously and travel never turns around. The cell is
// several frame widths, so the view at rest sits well inside one tile and the
// scenes look exactly as they did until you travel. Nothing extra is drawn:
// each pixel resolves to exactly one tile, so only on-screen copies are ever
// evaluated.

// Signed distance to the message in text space: y spans [-1,1], x spans
// [-uTxtAsp,uTxtAsp]. Outside the baked rectangle the field continues as the
// distance to the rectangle itself, so it stays a usable SDF everywhere rather
// than a flat plateau the raymarch would tunnel straight through.
float txtSD(vec2 q){
  vec2 h=vec2(uTxtAsp,1.0);
  vec2 dd=abs(q)-h;
  float outside=length(max(dd,0.0))+min(max(dd.x,dd.y),0.0);
  vec2 tc=clamp(q/(2.0*h)+0.5,vec2(0.002),vec2(0.998));
  float s=(texture(uTxt,tc).r-0.5)*1.6-uTxtWeight;
  return max(s,outside);
}
float txtLetter(vec2 q){
  vec2 h=vec2(uTxtAsp,1.0);
  vec2 tc=clamp(q/(2.0*h)+0.5,vec2(0.002),vec2(0.998));
  return texture(uTxt,tc).g*48.0;
}
// The letters as a solid: the 2D field extruded along z. Billboarded to the
// camera's own yaw so the message stays readable while the camera orbits, but
// still a genuine solid in the scene — the march finds it, so the fractal can
// pass in front and hide it, and it takes the same light.
// Apparent-size normaliser for the 3D message. The scenes are framed at wildly
// different camera distances — a fifth of a unit on the Mandelbulb, several
// units on Spudsville and Mandelbox, since a bigger fractal simply sits further
// back — and type measured in world units therefore changed size by a factor of
// ten from one scene to the next. Scaling the letters by the camera distance
// makes Size a SCREEN size: the same setting reads the same on every scene, at
// any zoom depth. Set once per pixel in render3, before the first map() call.
float gTxtK=1.0;
float sdText3(vec3 p){
  // The tesseract draws its message through the flat 2D path instead: it is the
  // one scene the camera flies into, so an extruded solid in the middle of it
  // was a second copy of the type sitting inside the cube.
  if(uTxtOn<0.5) return 1e9;
  float ay=uTime*uSpeed*0.16*uCamAuto*uSpin+uJump+uCamYaw;
  vec3 q=p;
  q.xz*=rot(-ay);
  q.y-=uTxtY*gTxtK; q.x-=uTxtX*gTxtK;
  // Depth. The letters used to sit on the plane through the origin, which is
  // exactly where the fractal is, so the type was always half-buried in it.
  // uTxtZ slides them along the billboard normal — out in front of the object,
  // or back behind it — and because the offset is applied after the yaw
  // rotation it stays "toward the camera" as the scene turns.
  q.z-=uTxtZ*gTxtK;
  float sc=max(uTxtScale,0.02)*gTxtK;
  q/=sc;
  q.xy*=rot(uTxtRot);
  float s=txtSD(q.xy);
  float dz=abs(q.z)-max(uTxtDepth,0.01);
  // Rounded union of face and side wall: a hard max() gives the letters a razor
  // edge that aliases badly against fractal detail.
  float k=0.06;
  float d=length(max(vec2(s,dz)+k,0.0))-k;
  return d*sc;
}

float sdBox(vec3 p,vec3 b){vec3 d=abs(p)-b;return min(max(d.x,max(d.y,d.z)),0.0)+length(max(d,0.0));}

float bulb(vec3 p,float power,out float trap){
  vec3 z=p;float dr=1.0,r=0.0;trap=1.0;
  int iters=int(clamp((9.0+uZoom*9.0)*fi(),6.0,46.0));
  for(int i=0;i<48;i++){
    if(i>=iters) break;
    r=length(z); if(r>2.2) break;
    float th=acos(clamp(z.z/max(r,1e-6),-1.0,1.0)), ph=atan(z.y,z.x);
    dr=pow(r,power-1.0)*power*dr+1.0;
    float zr=pow(r,power); th*=power; ph*=power;
    z=zr*vec3(sin(th)*cos(ph),sin(th)*sin(ph),cos(th))+p;
    trap=min(trap,r);
  }
  return 0.5*log(max(r,1e-6))*r/dr;
}
float menger(vec3 p){
  float d=sdBox(p,vec3(1.0)); float s=1.0;
  int mi=int(clamp((4.0+uZoom*3.0)*fi(),3.0,12.0));
  for(int m=0;m<12;m++){
    if(m>=mi) break;
    vec3 a=mod(p*s,2.0)-1.0; s*=3.0;
    vec3 r=abs(1.0-3.0*abs(a));
    float da=max(r.x,r.y),db=max(r.y,r.z),dc=max(r.z,r.x);
    d=max(d,(min(da,min(db,dc))-1.0)/s);
  }
  return d;
}
float ifs(vec3 z,float ang,float scale){
  vec3 off=vec3(1.0,0.92,1.08); mat2 R=rot(ang);
  int ii=int(clamp((10.0+uZoom*5.0)*fi(),7.0,24.0));
  float sum=0.0;
  for(int i=0;i<24;i++){
    if(i>=ii) break;
    z=abs(z);
    if(z.x<z.y) z.xy=z.yx;
    if(z.x<z.z) z.xz=z.zx;
    if(z.y<z.z) z.yz=z.zy;
    z.xz*=R;
    z=z*scale-off*(scale-1.0);
    sum+=1.0;
    if(dot(z,z)>4096.0) break;
  }
  return length(z)*pow(scale,-sum);
}
float apollonian(vec3 p,out float trap){
  float scale=1.0;
  float kk=1.05+uMorph*0.5;
  int N=int(clamp(fi()*5.0,3.0,12.0));
  for(int i=0;i<12;i++){
    if(i>=N) break;
    p=-1.0+2.0*fract(0.5*p+0.5);
    float r2=dot(p,p);
    float k=kk/max(r2,0.0001);
    p*=k; scale*=k;
  }
  trap=clamp(log(max(scale,1.0001))*0.09,0.0,1.0);
  return 0.25*abs(p.y)/scale;
}
float qjulia(vec3 pos,out float trap){
  vec4 z=vec4(pos,0.0);
  vec4 c=vec4(-0.65+uMorph*0.4+sin(uTime*0.13*uSpeed)*0.18,
              0.55+cos(uTime*0.11*uSpeed)*0.16, 0.2, 0.12);
  float md2=1.0, mz2=dot(z,z);
  trap=1.0;
  int N=int(clamp(fi()*8.0,4.0,16.0));
  for(int i=0;i<16;i++){
    if(i>=N) break;
    md2*=4.0*mz2;
    z=vec4(z.x*z.x-dot(z.yzw,z.yzw), 2.0*z.x*z.yzw)+c;
    mz2=dot(z,z);
    trap=min(trap,mz2);
    if(mz2>4.0) break;
  }
  return 0.25*sqrt(mz2/max(md2,1e-8))*log(max(mz2,1.0001));
}
float sierp(vec3 z,float ang){
  vec3 a1=vec3(1.0,1.0,1.0),a2=vec3(-1.0,-1.0,1.0),a3=vec3(1.0,-1.0,-1.0),a4=vec3(-1.0,1.0,-1.0);
  float scale=2.0;
  int mi=int(clamp(12.0*fi(),8.0,26.0));
  float sum=0.0;
  for(int i=0;i<26;i++){
    if(i>=mi) break;
    z.xz*=rot(ang*0.12);
    vec3 c=a1; float dist=length(z-a1);
    float d=length(z-a2); if(d<dist){c=a2;dist=d;}
    d=length(z-a3); if(d<dist){c=a3;dist=d;}
    d=length(z-a4); if(d<dist){c=a4;dist=d;}
    z=scale*z-c*(scale-1.0);
    sum+=1.0;
    if(dot(z,z)>4096.0) break;
  }
  return length(z)*pow(scale,-sum);
}
float mandelbox(vec3 p,out float trap){
  float s=2.0+(uCA-0.5)*1.5;
  vec3 off=p, z=p; float dr=1.0; trap=1.0;
  float mr=0.25+uCB*0.35;
  float fold=0.85+uCC*0.5;
  int mi=int(clamp(16.0*fi(),8.0,28.0));
  for(int i=0;i<30;i++){
    if(i>=mi) break;
    z=clamp(z,-fold,fold)*2.0-z;
    float r2=dot(z,z);
    trap=min(trap,r2);
    if(r2<mr){ z*=1.0/mr; dr/=mr; }
    else if(r2<1.0){ z/=r2; dr/=r2; }
    z=z*s+off; dr=dr*abs(s)+1.0;
  }
  return length(z)/abs(dr);
}
float kleinian(vec3 p,out float trap){
  vec3 cs=vec3(0.9+(uCA-0.5)*0.3, 0.9+(uCB-0.5)*0.3, 1.15+(uCC-0.5)*0.4);
  float scale=1.0; trap=1.0;
  int mi=int(clamp(9.0*fi(),6.0,22.0));
  for(int i=0;i<22;i++){
    if(i>=mi) break;
    p=2.0*clamp(p,-cs,cs)-p;
    float r2=dot(p,p);
    trap=min(trap,r2);
    float k=max(0.72/max(r2,1e-6),1.0);
    p*=k; scale*=k;
  }
  float l=length(p.xy);
  return 0.7*max(l-3.6,-(l*p.z)/4.0)/scale;
}
float juliabulb(vec3 p,out float trap){
  vec3 z=p; float dr=1.0,r=0.0; trap=1.0;
  float power=8.0+uMid*uReact*2.0;
  vec3 c=vec3((uCA-0.5)*1.4,(uCB-0.5)*1.4,(uCC-0.5)*1.0);
  int iters=int(clamp((9.0+uZoom*7.0)*fi(),6.0,38.0));
  for(int i=0;i<40;i++){
    if(i>=iters) break;
    r=length(z); if(r>2.2) break;
    float th=acos(clamp(z.z/max(r,1e-6),-1.0,1.0)), ph=atan(z.y,z.x);
    dr=pow(r,power-1.0)*power*dr+1.0;
    float zr=pow(r,power); th*=power; ph*=power;
    z=zr*vec3(sin(th)*cos(ph),sin(th)*sin(ph),cos(th))+c;
    trap=min(trap,r);
  }
  return 0.5*log(max(r,1e-6))*r/dr;
}
float octa(vec3 z,float ang){
  float scale=1.9+(uCA-0.5)*0.5;
  vec3 off=vec3(1.0,0.0,0.0);
  mat2 R=rot(ang+uCB*2.0+(uCC-0.5)*1.6);
  int mi=int(clamp(11.0*fi(),7.0,24.0));
  float sum=0.0;
  for(int i=0;i<24;i++){
    if(i>=mi) break;
    z=abs(z);
    if(z.x<z.y) z.xy=z.yx;
    if(z.x<z.z) z.xz=z.zx;
    z.yz*=R;
    z=z*scale-off*(scale-1.0);
    sum+=1.0;
    if(dot(z,z)>4096.0) break;
  }
  return length(z)*pow(scale,-sum);
}
float hybrid(vec3 p,out float trap){
  float s=-1.7-(uCA-0.5)*0.9;
  vec3 z=p; float dr=1.0; trap=1.0;
  float mr=0.35+uCB*0.5;
  int mi=int(clamp(11.0*fi(),6.0,22.0));
  for(int i=0;i<22;i++){
    if(i>=mi) break;
    z.xz*=rot(0.35);
    z=clamp(z,-1.0,1.0)*2.0-z;
    float r2=dot(z,z);
    trap=min(trap,r2);
    if(r2<mr){ float k=1.0/mr; z*=k; dr*=k; }
    else if(r2<1.0){ float k=1.0/r2; z*=k; dr*=k; }
    z=z*s+p;
    dr=dr*abs(s)+1.0;
  }
  return length(z)/abs(dr);
}

// Tesseract Glass (41). A hypercube FRAME — outer cube, the inner cube its 4D
// rotation projects to, and the eight struts joining their corners — recursed
// into its own corners, so every corner of every cube holds a smaller cube.
// The inner scale is driven by the projection: as the tesseract turns through
// the fourth axis the inner cell swells toward the outer one and shrinks back,
// which is the only honest way to read a 4D rotation on a 3D screen.
float bframe(vec3 p,float b,float e){
  p=abs(p)-b;
  vec3 q=abs(p+e)-e;
  return min(min(
    length(max(vec3(p.x,q.y,q.z),0.0))+min(max(p.x,max(q.y,q.z)),0.0),
    length(max(vec3(q.x,p.y,q.z),0.0))+min(max(q.x,max(p.y,q.z)),0.0)),
    length(max(vec3(q.x,q.y,p.z),0.0))+min(max(q.x,max(q.y,p.z)),0.0));
}
float strut(vec3 p,vec3 a,vec3 b,float r){
  vec3 pa=p-a, ba=b-a;
  float h=clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0);
  return length(pa-ba*h)-r;
}
// One cell. The struts are drawn once in the positive octant and the abs()
// fold gives the other seven, so eight capsules cost one.
float tessCell(vec3 p,float s,float e){
  float d=bframe(p,1.0,e);
  d=min(d,bframe(p/s,1.0,e/s)*s);
  d=min(d,strut(abs(p),vec3(1.0),vec3(s),e*0.8));
  return d;
}
// Face panes. Three of the six faces per cell only — a closed glass box shows
// nothing but its own reflections, and the open faces are what let the eye into
// the lattice while the glazed ones catch the room.
float sdb(vec3 p,vec3 b){vec3 q=abs(p)-b;return length(max(q,0.0))+min(max(q.x,max(q.y,q.z)),0.0);}
float pane(vec3 p,float t){
  float d=sdb(p-vec3(1.0,0.0,0.0),vec3(t,1.0,1.0));
  d=min(d,sdb(p-vec3(0.0,1.0,0.0),vec3(1.0,t,1.0)));
  d=min(d,sdb(p-vec3(0.0,0.0,1.0),vec3(1.0,1.0,t)));
  return d;
}
float tessFrac(vec3 p,out float trap){
  float ph=uTime*0.11*uSpeed*uSpin+(uCA-0.5)*6.28318;
  float e=0.012+uCC*0.05;
  // Inner cube and corner cubes are ONE size, not two. The 4D phase drives the
  // inner cube's half-extent, and the corner children are then defined as that
  // same extent — k is derived from s rather than set beside it. So the struts
  // leaving the outer cube's vertices land exactly on the corner cubes'
  // vertices, which land exactly on the inner cube's, and the whole lattice
  // breathes as one object when 4D phase is turned. Previously k was fixed and
  // only the inner cube moved, so the joints drifted apart mid-sweep.
  // Bounds: below ~0.23 the eight children stop touching and the frame reads as
  // loose debris; above ~0.46 they overlap each other and the cell fills in.
  // Morph biases the fit inside that window instead of setting it outright.
  float s=clamp(mix(0.245,0.45,0.5+0.5*sin(ph))*(0.88+uMorph*0.26)+uMid*uReact*0.02,0.23,0.46);
  float k=1.0/s;
  // Glaze (Cst B). How much of the lattice is glazed, from a bare frame at 0 to
  // panes carried several levels down at 1. It replaced a finish dial that ran
  // to mirror: mirrored panes turned the outer cell into a box and hid every
  // cube inside it, which is the one thing this scene exists to show.
  float gz=clamp(uCB,0.0,1.0);
  int lvl=int(clamp(2.6*fi()+clamp(uZoom,0.0,1.0)*1.6,2.0,6.0));
  float d=1e9, sc=1.0, tr=1.0;
  vec3 z=p;
  for(int i=0;i<6;i++){
    if(i>=lvl) break;
    d=min(d,tessCell(z,s,e)/sc);
    if(gz>0.02 && i>=1 && float(i)<1.0+gz*(2.0+clamp(uZoom,0.0,1.0)*3.0)) d=min(d,pane(z,e*0.30*(0.55+gz*0.45))/sc);
    z=abs(z);
    if(z.x<z.y) z.xy=z.yx;
    if(z.x<z.z) z.xz=z.zx;
    if(z.y<z.z) z.yz=z.zy;
    z=z*k-vec3(k-1.0);
    sc*=k;
    tr=min(tr,length(z)*0.22);
    if(dot(z,z)>2500.0) break;
  }
  trap=clamp(0.30+0.55*tr,0.0,1.0);
  return d;
}

// CubeKochMosely (42). A Menger cube lattice coloured by the march itself. At
// every subdivision the cell the point falls in is recorded, and the trap is
// that CELL CENTRE projected onto a sweep axis — not the hit point. So every
// face of a given cube receives one single trap value and the gradient lands on
// the lattice a cube at a time, in steps, instead of smearing continuously
// across each surface. Animating a phase against it then wipes the gradient
// through the whole structure, cube by cube.
float cubeKM(vec3 p,out float trap){
  float d=sdBox(p,vec3(1.0));
  float s=1.0;
  vec3 cen=vec3(0.0);
  // Cross thickness. Held at or above the canonical 1.0: a thinner cross
  // subtracts less than the estimate assumes and the march starts stepping
  // through faces, which on this lattice reads as holes punched in the cubes.
  float hole=clamp(1.0+uMorph*1.0+(uCA-0.5)*0.6,1.0,2.2);
  int lvl=int(clamp(3.0*fi()+clamp(uZoom,0.0,1.0)*1.8,2.0,6.0));
  for(int i=0;i<6;i++){
    if(i>=lvl) break;
    vec3 a=mod(p*s,2.0)-1.0;
    cen=(floor(p*s*0.5)+0.5)*2.0/s;
    s*=3.0;
    vec3 r=abs(1.0-3.0*abs(a));
    float da=max(r.x,r.y), db=max(r.y,r.z), dc=max(r.z,r.x);
    d=max(d,(min(da,min(db,dc))-hole)/s);
  }
  vec3 ax=normalize(vec3(cos(uCC*6.28318),0.55,sin(uCC*6.28318)));
  trap=clamp(0.5+0.5*dot(cen,ax),0.0,1.0);
  return d;
}

float map(vec3 p,out float trap){
  trap=0.0;
  if(uMode==0){
    return bulb(p, mix(3.0,11.0,uMorph)+(uCA-0.5)*4.0+uMid*uReact*2.4, trap);
  } else if(uMode==12){
    p.xz*=rot(uTime*0.05*uSpeed*uSpin);
    return mandelbox(p,trap);
  } else if(uMode==13){
    p.xy*=rot(uTime*0.04*uSpeed*uSpin);
    return kleinian(p,trap);
  } else if(uMode==14){
    p.xz*=rot(uTime*0.08*uSpeed*uSpin);
    return juliabulb(p,trap);
  } else if(uMode==15){
    trap=clamp(length(p)*0.4,0.0,1.0);
    return octa(p, uTime*0.07*uSpeed*uSpin+uMid*uReact*0.5);
  } else if(uMode==16){
    p.yz*=rot(uTime*0.06*uSpeed*uSpin);
    return hybrid(p,trap);
  } else if(uMode==30){
    p.xz*=rot(uTime*0.04*uSpeed*uSpin);
    vec3 cs=vec3(0.92,0.92,1.1)+(uCA-0.5)*vec3(0.12,0.12,0.24);
    float kk=0.24+(uCB-0.5)*0.2, df=1.0, r2=1.0;
    int N=int(clamp(7.0*fi(),5.0,16.0));
    for(int i=0;i<16;i++){
      if(i>=N) break;
      p=2.0*clamp(p,-cs,cs)-p;
      r2=dot(p,p);
      float s=max(kk/max(r2,1e-4),1.0);
      p*=s; df*=s;
    }
    float rxy=length(p.xy);
    trap=clamp(r2*0.22,0.0,1.0);
    return max(rxy-0.92, abs(rxy*p.z)/max(length(p),1e-4))/df;
  } else if(uMode==31){
    // Amazing Surf, wrapped onto a SPHERE instead of an infinite plane.
    //
    // The fractal is a slab: structure spreads through its xy plane and has
    // finite thickness in z. So the domain is remapped before folding — the two
    // plane axes become the sphere's angles and the thickness axis becomes
    // radius, which lays the same surf around a ball as a shell.
    //
    //   model x = azimuth * k,   model y = (polar - PI/2) * k,   model z = r - R0
    //
    // k is chosen so a full turn of azimuth spans a whole number of the fold's
    // own period (the xy fold at +-fo repeats every 4*fo), which is what makes
    // the wrap close on itself instead of showing a seam at the back.
    //
    // The remap stretches space, so the model-space estimate is not a world
    // distance: one world unit along the azimuth covers k/(r*sin(polar)) of
    // model space. Dividing by the LARGEST local stretch keeps the estimate
    // conservative; sin() is floored so the poles, where the mapping is
    // singular, do not stall the march at zero.
    p.xz*=rot(uTime*0.03*uSpeed*uSpin);
    float sc=1.5+uMorph*0.6+(uCA-0.5)*0.4;
    float fo=1.0+(uCB-0.5)*0.5;
    float mr=0.5+(uCC-0.5)*0.4;
    float R0=1.15;
    float kk=3.0*(4.0*fo)/6.2831853;
    float rr=max(length(p),1e-4);
    float th=atan(p.z,p.x);
    float sph=clamp(p.y/rr,-1.0,1.0);
    float phi=acos(sph);
    vec3 q=vec3(th*kk, (phi-1.5707963)*kk, rr-R0);
    float dr=1.0;
    int N=int(clamp(9.0*fi(),6.0,22.0));
    for(int i=0;i<22;i++){
      if(i>=N) break;
      q.xy=2.0*clamp(q.xy,-fo,fo)-q.xy;          // plane fold on xy only
      float r2=dot(q,q);
      if(r2<mr){ float s=1.0/mr; q*=s; dr*=s; }   // conditional sphere fold
      else if(r2<1.0){ float s=1.0/r2; q*=s; dr*=s; }
      q=q*sc+vec3(0.0,0.0,(uCC-0.5)*0.3); dr=dr*sc+1.0;
    }
    trap=clamp(length(q)*0.1,0.0,1.0);
    float dm=length(q)/abs(dr);
    float stretch=max(1.0, kk/(rr*max(sin(phi),0.30)));
    return dm/stretch*0.8;
  } else if(uMode==32){
    float sc=1.85+(uCA-0.5)*0.35;
    float a=uTime*0.05*uSpeed+(uCB-0.5)*3.0+uMid*uReact*0.8;
    float r=1.0; int it=0;
    int N=int(clamp(10.0*fi(),7.0,24.0));
    for(int i=0;i<24;i++){
      if(i>=N) break;
      p.xz*=rot(a*0.12);
      if(p.x+p.y<0.0) p.xy=-p.yx;
      if(p.x+p.z<0.0) p.xz=-p.zx;
      if(p.y+p.z<0.0) p.zy=-p.yz;
      p=p*sc-vec3(sc-1.0);
      r*=sc; it=i;
    }
    trap=clamp(float(it)/16.0,0.0,1.0);
    return (length(p)-1.1)/r;
  } else if(uMode==33){
    float a=uTime*0.05*uSpeed+(uCB-0.5)*2.5;
    float sz=(1.25+(uCC-0.5)*0.3)*(1.0+clamp(uZoom,0.0,1.0)*1.6);   // outer cube grows with zoom, so its face is never the frame edge
    float d=max(abs(p.x),max(abs(p.y),abs(p.z)))-sz;
    float s=1.0, sc=3.0+(uCA-0.5)*0.5;
    int N=int(clamp(4.5*fi(),3.0,10.0));
    for(int i=0;i<10;i++){
      if(i>=N) break;
      p.xz*=rot(a*0.17); p.xy*=rot(a*0.11);
      vec3 q=mod(p*s,2.0)-1.0;
      s*=sc;
      vec3 rr=abs(1.0-3.0*abs(q));
      float c=(min(min(max(rr.x,rr.y),max(rr.y,rr.z)),max(rr.z,rr.x))-1.0)/s;
      d=max(d,c);
    }
    trap=clamp(length(p)*0.3,0.0,1.0);
    return d;
  } else if(uMode==34){
    p.xz*=rot(uTime*0.06*uSpeed*uSpin);
    p.yz*=rot(uTime*0.04*uSpeed*uSpin);
    // Gyroid: sin x cos y + sin y cos z + sin z cos x = t. A minimal surface,
    // infinitely periodic, hollowed into a shell of finite thickness and
    // clipped to a ball so the raymarcher has something bounded to hit.
    float sf=1.7+uCA*2.6;
    vec3 q=p*sf;
    float g=sin(q.x)*cos(q.y)+sin(q.y)*cos(q.z)+sin(q.z)*cos(q.x);
    float t=(uMorph-0.5)*1.5+uBass*uReact*0.35;
    float thick=0.10+uCB*0.45;
    float shell=(abs(g-t)-thick)/(sf*1.9);
    trap=clamp(0.5+0.5*g,0.0,1.0);
    // Ball grows with zoom. Fixed, it was the silhouette you saw rather than the
    // surface: a black-edged disc cutting the frame the moment the framing was
    // wide enough to contain it. Scaled by zoom the bound stays outside the
    // view at every depth.
    return max(shell, length(p)-(1.5+uCC*1.4)*(1.0+clamp(uZoom,0.0,1.0)*2.2));
  } else if(uMode==35){
    p.xz*=rot(uTime*0.045*uSpeed*uSpin);
    float sc=2.0+uMorph*0.7+(uCA-0.5)*0.5;
    float dr=1.0; trap=1.0;
    int N=int(clamp(8.0*fi(),5.0,18.0));
    for(int i=0;i<18;i++){
      if(i>=N) break;
      p=clamp(p,-1.0,1.0)*2.0-p;
      float r2=max(dot(p,p),1e-6);
      float k=clamp((1.1+(uCB-0.5)*0.4)/r2, 0.55, 1.7);
      p*=k; dr*=k;
      p=p*sc+vec3(0.6,0.35,0.4)*(uCC-0.3);
      dr=dr*abs(sc)+1.0;
      trap=min(trap,r2);
    }
    return (length(p)-2.0)/abs(dr);
  } else if(uMode==36){
    p.xy*=rot(uTime*0.05*uSpeed*uSpin);
    vec4 z=vec4(0.0), qc=vec4(p,(uCA-0.5)*0.7);
    float dr=1.0, r=0.0; trap=1.0;
    int N=int(clamp((10.0+uZoom*6.0)*fi(),7.0,34.0));
    for(int i=0;i<36;i++){
      if(i>=N) break;
      r=length(z); if(r>3.2) break;
      dr=2.0*r*dr+1.0;
      z=vec4(z.x*z.x-dot(z.yzw,z.yzw), 2.0*z.x*z.yzw)+qc;
      trap=min(trap,r);
    }
    return 0.5*log(max(r,1e-6))*r/max(dr,1e-6);
  } else if(uMode==1){
    p.xz*=rot(uTime*0.12*uSpeed*uSpin); p.yz*=rot(uTime*0.07*uSpeed*uSpin);
    trap=clamp(length(p)*0.42,0.0,1.0);
    float sc=0.85+uMorph*0.35+(uCA-0.5)*0.3;
    return menger(p/sc)*sc;
  } else if(uMode==2){
    trap=clamp(length(p)*0.5,0.0,1.0);
    return ifs(p+vec3(1.0,0.92,1.08), 0.2+sin(uTime*0.09*uSpeed*uSpin)*0.18+(uCA-0.5)*0.3, 1.6+uMorph*0.45+(uCC-0.5)*0.3);
  } else if(uMode==3){
    p.xz*=rot(uTime*0.05*uSpeed*uSpin);
    return apollonian(p,trap);
  } else if(uMode==4){
    p.xy*=rot(uTime*0.07*uSpeed*uSpin);
    float d=qjulia(p,trap);
    trap=clamp(sqrt(trap)*0.9,0.0,1.0);
    return d;
  } else if(uMode==41){
    p.xz*=rot(uTime*0.03*uSpeed*uSpin);
    p.yz*=rot(uTime*0.02*uSpeed*uSpin);
    return tessFrac(p,trap);
  } else if(uMode==42){
    p.xz*=rot(uTime*0.035*uSpeed*uSpin);
    p.yz*=rot(uTime*0.022*uSpeed*uSpin);
    return cubeKM(p,trap);
  } else {
    trap=clamp(length(p)*0.36,0.0,1.0);
    return sierp(p, uTime*uSpeed+uMid*uReact*3.0+(uCA-0.5)*8.0);
  }
}
vec3 nrm(vec3 p){float t;vec2 e=vec2(max(0.0012*exp2(-clamp(uZoom,0.0,1.0)*6.0), 2.5e-5),0.0);
  return normalize(vec3(map(p+e.xyy,t)-map(p-e.xyy,t),map(p+e.yxy,t)-map(p-e.yxy,t),map(p+e.yyx,t)-map(p-e.yyx,t)));}

// Studio environment for the glass material: a dark room with two soft light
// bars and a floor bounce, sampled by reflected and refracted rays. Nothing
// reads as mirror without something to mirror, and a lattice reflecting only
// itself goes black — so the room is what the surfaces actually show.
vec3 envCol(vec3 d){
  float up=clamp(d.y*0.5+0.5,0.0,1.0);
  vec3 c=mix(vec3(0.014,0.017,0.028), vec3(0.062,0.080,0.120), up);
  c+=pal(0.10+uHigh*0.18)*pow(clamp(dot(d,normalize(vec3(0.6,0.75,-0.5))),0.0,1.0),22.0)*2.4;
  c+=pal(0.62+uBass*0.12)*pow(clamp(dot(d,normalize(vec3(-0.7,0.35,0.6))),0.0,1.0),11.0)*1.2;
  c+=pal(0.48)*pow(clamp(-d.y,0.0,1.0),6.0)*0.22;
  return c;
}
// Secondary ray for the glass pass. Same estimator, short budget, fixed eps:
// the frames seen through and reflected in the outer frames are a real second
// hit on the same lattice, which is what gives the depth a fake cannot.
vec3 rayCol(vec3 ro,vec3 rd,float far,int budget){
  float d=0.02, tr=0.0; bool h=false; vec3 p=ro;
  for(int i=0;i<30;i++){
    if(i>=budget) break;
    p=ro+rd*d;
    float hh=map(p,tr);
    // Inside the glass. The refracted ray starts under the surface it just
    // crossed, so it has to be walked out of the solid before anything counts
    // as a hit — without this every pane returned its own back face and read as
    // an opaque sheet.
    if(hh<0.0){ d+=max(-hh,0.006)+0.004; continue; }
    if(hh<0.0018){ h=true; break; }
    d+=hh*0.8;
    if(d>far) break;
  }
  if(!h) return envCol(rd);
  vec3 n2=nrm(p);
  vec3 l=normalize(vec3(0.7,0.9,-0.6));
  float df=clamp(dot(n2,l),0.0,1.0);
  float fr2=pow(1.0-clamp(dot(n2,-rd),0.0,1.0),3.0);
  vec3 b2=pal(tr*2.6+d*0.14+uHigh*0.2);
  return (b2*(0.10+0.85*df)+fr2*pal(0.42)*0.8)*exp(-d*0.28);
}

vec3 render3(vec2 uv){
  float t=uTime*uSpeed;
  float ex=clamp(uZoom,0.0,1.0)*9.0;
  // Framing. Every scene used to carry its own near AND far distance, tuned by
  // eye, and the RATIO between them ran from 2.9 to 9 — so the same move of the
  // zoom slider filled the frame in one scene and barely changed another, and
  // no two scenes occupied the same share of the screen at the same setting.
  //
  // Now each scene declares one number only: dFar, the framing distance for its
  // own size (a bigger fractal simply sits further back). The near end is that
  // distance divided by ONE shared zoom range, so screen coverage tracks the
  // slider identically everywhere and the scenes are directly comparable.
  //
  // These numbers are measured, not judged by eye. Each scene was rendered at
  // ITS OWN shipped defaults — its own zoom, morph, detail and c-parameters,
  // with audio and camera drift zeroed — and the share of the frame carrying
  // the object rather than the backdrop was counted off the rendered pixels.
  // That share ran from 0.08 to 0.77, a factor of nine, which is why some
  // scenes arrived as a speck and others overflowed the frame.
  //
  // Apparent area falls off as the square of distance, so each distance is
  // scaled by sqrt(measured / target) to bring every scene to the same share
  // (0.43, the median of what the set was already doing — so the correction
  // moves the outliers rather than the whole set). Two guards on that: no
  // scene moves closer than 0.55x its old distance, because the sparse ones
  // (Pseudo-Klein, Gyroid) would need the eye so close it ends up inside the
  // geometry, and none moves further than 1.6x.
  //
  // Mandelbulb and Menger had no entry at all and were sharing the fallback,
  // which is most of why those two never matched anything.
  float dfar;
  if(uMode==0){dfar=4.85;}        // 0.48 -> 0.43
  else if(uMode==1){dfar=4.05;}   // 0.33
  else if(uMode==2){dfar=6.81;}   // 0.52
  else if(uMode==3){dfar=3.21;}   // 0.49
  else if(uMode==4){dfar=2.34;}   // 0.13, was far too distant
  else if(uMode==5){dfar=7.49;}   // 0.77, the largest in the set
  else if(uMode==12){dfar=4.79;}  // 0.31
  else if(uMode==13){dfar=3.35;}  // 0.24
  else if(uMode==14){dfar=2.55;}  // 0.14
  else if(uMode==15){dfar=6.11;}  // 0.64
  else if(uMode==16){dfar=8.00;}  // 0.43, already on target
  else if(uMode==30){dfar=2.75;}  // 0.08, floored at 0.55x
  else if(uMode==31){dfar=5.69;}  // 0.56
  else if(uMode==32){dfar=6.56;}  // 0.63
  else if(uMode==33){dfar=4.41;}  // 0.33
  else if(uMode==34){dfar=2.42;}  // 0.12, floored at 0.55x
  else if(uMode==35){dfar=5.33;}  // 0.53
  else if(uMode==36){dfar=3.15;}  // 0.20
  else if(uMode==41){dfar=6.34;}  // 0.69
  else if(uMode==42){dfar=4.90;}  // 0.42
  else {dfar=4.6;}
  const float ZRANGE=10.0;                // far distance / near distance
  // No low-end term on the camera distance. Pulling the eye in on every kick
  // and letting it fall back out is the "everything pulsates" the whole set had
  // Camera breath on the low end, gated on the strobe: with strobe on the frame
  // pumps with the kick, with strobe killed the geometry sits still and the beat
  // reads only through colour and bloom.
  // The tesseract is the one scene you can fly INTO: the shared range stops at
  // a fifth of the framing distance, which parks the eye just outside the outer
  // cube. A much longer range lets the zoom carry the camera through the panes
  // and down into the corner cells, which is where the nesting reads.
  float zr = (uMode==41)?52.0:ZRANGE;
  float dist=dfar*(1.0/zr+(1.0-1.0/zr)*exp2(-ex))-uBass*uReact*uStrobe*0.06;
  // The Mandelbulb's framing distance at its default zoom, so Size keeps the
  // value it always had there and every other scene is brought to match it.
  // Tracks that scene's dfar: it moved from 4.6 to 4.85 in the size audit, and
  // leaving the divisor behind would have shifted every scene's text by 5%.
  gTxtK=max(dist,0.05)/0.80;
  vec3 ro=vec3(0.0,0.0,-dist);
  float ay=t*0.16*uCamAuto*uSpin+uJump+uCamYaw, ax=sin(t*0.11)*0.55*uCamAuto*abs(uSpin)+uCamPitch;
  // Viewer-relative orbit. Pitch is applied FIRST, about the camera's own right
  // axis, and yaw second — and the up vector is carried through both rotations
  // instead of being pinned to world +y. Pinning it had two consequences the
  // pad made obvious: yawing after a pitch rotated the eye in the world y-z
  // plane, so once the view had turned a quarter of the way round the up/down
  // stick rolled the image instead of tipping it; and at the poles
  // cross(worldUp,f) collapsed, taking the frame's basis and the subject with
  // it. Carrying the up vector keeps the basis well conditioned through the
  // pole, so a vertical spin passes over the top and comes back the far side.
  vec3 cup=vec3(0.0,1.0,0.0);
  ro.yz*=rot(ax); cup.yz*=rot(ax);
  ro.xz*=rot(ay); cup.xz*=rot(ay);
  // Roll: the third axis. Yaw and pitch alone can only tumble the object about
  // axes that lie in the screen plane's horizontal and vertical; spinning the up
  // vector about the view direction adds the missing one, and combined with a
  // little pitch or yaw it puts the tumble axis on either diagonal.
  if(abs(uCamRoll)>1e-5){
    vec3 fw=normalize(-ro);
    vec3 rt=normalize(cross(cup,fw));
    cup=normalize(cup*cos(uCamRoll)+rt*sin(uCamRoll));
  }
  vec3 f=normalize(-ro), r=normalize(cross(cup,f)), u=cross(f,r);
  ro+=uOrbit;
  // Camera pan. Translating the eye along its own right/up axes without
  // touching the look direction is a true dolly across the subject, so the 3D
  // families get the same travel the 2D and canvas scenes have.
  ro+=(r*uPan.x+u*uPan.y)*1.6;
  // Auto-centring. A distance estimator has no notion of its own centre, and
  // almost none of these fractals are symmetric about the world origin — the
  // Mandelbulb's mass sits off-axis, the box folds drift with their constants.
  // Orbiting the origin therefore swung the subject out of frame, which is what
  // made stick rotation feel like it "stopped": the framing guard was hauling
  // the camera back as fast as the thumb pushed it. Scaled by dist so the
  // correction is the same angular amount at any zoom depth.
  ro+=(r*uCtr3.x+u*uCtr3.y)*dist;
  vec3 rd=normalize(uv.x*r+uv.y*u+1.7*f);
  float trap0=0.0;
  float h0=map(ro,trap0);
  if(h0<0.001) ro-=rd*(abs(h0)+0.6);
  float d=0.0,trap=0.0,glow=0.0; bool hit=false; vec3 p=ro;
  int steps=int(clamp(mix(64.0,236.0,uDetail)+ex*13.0, 56.0, (uMode==41)?110.0:252.0));
  // The spherical wrap's estimate is a bounded approximation, not exact, so it
  // marches with the same caution as the Apollonian.
  float relax = (uMode==3||uMode==31)?0.62:((uMode==41)?0.78:0.9);
  // Hit threshold from the pixel footprint, not an exponential shrink. The old
  // 0.0009*exp2(-ex*0.85) reached ~5e-6 at deep zoom, far below what a float
  // distance estimate can resolve, so rays randomly overshot and the surface
  // fizzed. Cone-tracing keeps eps at roughly one pixel at any depth.
  float pxw = 2.0/max(uRes.y,1.0)/1.7;
  float epsK = mix(0.16,0.95,uSmooth);
  float minr = 1e9, mind = 0.0;
  // The first surface the ray meets is the one that gets shaded — refraction
  // bends at that interface and samples the environment, so the march has no
  // reason to continue into the body the way the old thickness walk did.
  vec3 hp = ro; float htrap = 0.0, hd = 0.0;
  for(int i=0;i<256;i++){
    if(i>=steps) break;
    p=ro+rd*d;
    float h=map(p,trap);
    // Glow is an OUTSIDE-the-surface measure — proximity to the boundary along
    // the approach. Once the march continues through the body h sits at zero,
    // so leaving this unguarded added a twelfth of a unit per interior step and
    // the object went to white. It only accumulates before the first hit.
    if(!hit) glow+=exp(-h*22.0)*0.012;
    float eps = max(pxw*d*epsK, 2.0e-5);
    float rt = h/eps;
    if(rt<minr){ minr=rt; mind=d; }
    if(h<eps){ hit=true; hp=p; htrap=trap; hd=d; break; }
    d+=h*relax;
    if(d>dist+7.0) break;
  }
  // Shade the FIRST surface the ray met, not wherever the walk ended up.
  if(hit){ p=hp; trap=htrap; d=hd; }
  // Silhouette coverage: a ray that passed within a few pixel widths shades at
  // partial alpha instead of snapping to background, so edges stop crawling.
  float cov=1.0;
  float covR = mix(1.6,4.0,uSmooth);
  if(!hit && minr<covR){
    hit=true; d=mind; p=ro+rd*mind;
    float tq=0.0; map(p,tq); trap=tq;
    cov=1.0-smoothstep(1.0,covR,minr);
  }
  // Publish where this ray ended, for the pivot probe.
  gPiv=p; gHit=hit?1.0:0.0;
  // X-ray pass, computed BEFORE shading so it can be blended over whatever the
  // march found. The text is a billboarded slab through the origin, so instead
  // of tracking it through the march (two texture fetches per step) the ray is
  // intersected with its plane analytically: one solve, one fetch, exact
  // footprint. Where the fractal wins the depth test the letters would vanish
  // entirely, which makes a message unusable on a dense scene — so they come
  // back as a translucent ghost instead, readable but clearly behind.
  float txtGhost=0.0;
  float txtLetterId=0.0;
  if(uTxtOn>0.5){
    float ayx=uTime*uSpeed*0.16*uCamAuto*uSpin+uJump+uCamYaw;
    mat2 rx=rot(-ayx);
    vec3 rot0=vec3(ro.x,ro.y,ro.z); rot0.xz*=rx; rot0.y-=uTxtY*gTxtK; rot0.x-=uTxtX*gTxtK; rot0.z-=uTxtZ*gTxtK;
    vec3 rdt=rd; rdt.xz*=rx;
    if(abs(rdt.z)>1e-4){
      float tp=-rot0.z/rdt.z;
      if(tp>0.05){
        vec2 qp=(rot0.xy+rdt.xy*tp)/(max(uTxtScale,0.02)*gTxtK); qp*=rot(uTxtRot);
        float sp=txtSD(qp);
        float aap=0.03/max(uTxtScale,0.02);
        txtGhost=smoothstep(aap,-aap,sp);
        txtLetterId=txtLetter(qp);
      }
    }
  }
  vec3 col=vec3(0.0);
  if(hit){
    vec3 n=nrm(p);
    vec3 l=normalize(vec3(0.7,0.9,-0.6));
    float dif=clamp(dot(n,l),0.0,1.0);
    float fre=pow(1.0-clamp(dot(n,-rd),0.0,1.0),3.0);
    float ao=clamp(1.0-d*0.16/max(dist,1.0),0.15,1.0);
    vec3 base=pal(trap*2.6+d*0.14+uHigh*0.25);
    vec3 emis=vec3(0.0);
    // trap = -1 is the flag map() sets when the text solid was the nearest
    // surface. It gets its own material rather than a walk along the fractal
    // palette: a flat bright face so the letters stay legible against any
    // scene, plus a per-letter lift so the message can light one letter at a
    // time on the beat.
    if(trap<-0.5){
      float ay2=uTime*uSpeed*0.16*uCamAuto*uSpin+uJump+uCamYaw;
      vec3 q2=p; q2.xz*=rot(-ay2); q2.y-=uTxtY*gTxtK; q2.x-=uTxtX*gTxtK; q2.z-=uTxtZ*gTxtK; q2/=(max(uTxtScale,0.02)*gTxtK); q2.xy*=rot(uTxtRot);
      float li=txtLetter(q2.xy);
      float onLit=1.0-smoothstep(0.0,0.9,abs(li-uTxtLit));
      base=pal(uTxtHue)*(1.25+onLit*1.5);
      emis=pal(uTxtHue+0.12)*onLit*0.5;
      dif=mix(dif,1.0,0.45);
      txtGhost=0.0;   // solid face won the depth test; no ghost needed
    }
    if(vidSurfOn()){
      vec3 sv=surfVid(p,n);
      if(uVidMode==11){
        base=mix(base, sv*1.2, uVidMix);
      } else {
        // Emissive: the frame's own luma lights the surface, so bright areas of
        // the image read as glowing through the geometry rather than painted on.
        float sl=dot(sv,vec3(0.299,0.587,0.114));
        emis=sv*sl*uVidMix*2.4;
        base=mix(base, base*0.5, uVidMix*0.7);
      }
    }
    if(uMode==42 && trap>-0.5){
      // Self-illumination rather than a light. The trap arrives quantised per
      // cube, so it is used directly as the coordinate along a gradient, and a
      // phase subtracted from it sweeps that gradient through the lattice: at
      // any instant a band of cubes is lit and the rest sit nearly black, and
      // the band travels. The stripe has a hard leading edge and a long tail so
      // the wipe carries a direction the eye can follow instead of blinking.
      float bands=0.6+uCB*2.6;
      float ph=uTime*0.11*uSpeed*(0.4+uCA*1.2);
      float g=fract(trap*bands-ph);
      float stripe=smoothstep(0.0,0.30,g)*smoothstep(1.0,0.34,g);
      vec3 grad=pal(0.04+g*0.62+uHigh*0.12);
      base=mix(vec3(0.026,0.029,0.034), grad*0.30, 0.55);
      emis+=grad*stripe*(1.35+uLoud*1.5);
      dif=mix(dif,1.0,0.25);
    }
    if(uMode==41 && trap>-0.5){
      // One material for the whole lattice: clear glass, reflective only at
      // grazing angles the way real glass is. Transmission is never traded
      // away, so every surface keeps showing what is behind it and the nested
      // cubes stay visible from any angle. Glaze (Cst B) controls how much
      // glass there is; it no longer controls how opaque the glass is.
      vec3 l2=normalize(vec3(0.7,0.9,-0.6));
      // Narrower palette walk than the solid scenes use. Glass is nearly
      // colourless in the hand — the hue belongs in the glints and the edges,
      // not in the body, or the whole lattice reads as tinted plastic.
      vec3 gbase=pal(trap*0.9+0.12+uHigh*0.18);
      vec3 rfl=reflect(rd,n);
      vec3 rfr=refract(rd,n,1.0/1.47);
      // Cost guards. Three marches per pixel is what this scene costs at full
      // tilt, and on a shared GPU that is enough to starve the main thread — the
      // app stops answering the VJ while still painting. So each secondary ray
      // has to earn itself:
      //   • reflection only where fresnel is strong enough to actually read
      //     (face-on glass is a window, and a window's reflection is noise),
      //   • transmission only on surfaces near enough to see through — far cells
      //     are fog-bound, where envCol is the same answer for a tenth of the
      //     cost,
      //   • both budgets ride the Detail slider, so Detail is a real performance
      //     lever here and not just a step count on the primary march.
      // Every skipped ray falls back to envCol, never to a solid: the glass
      // keeps transmitting whatever the budget.
      float fogW=1.0-smoothstep(2.6,5.5,d);
      int sbR=int(mix(5.0,11.0,uDetail));
      int sbT=int(mix(7.0,15.0,uDetail));
      vec3 mir=(fre>0.22)?rayCol(p+n*0.004,rfl,3.0,sbR):envCol(rfl);
      vec3 thru=(fogW>0.08 && dot(rfr,rfr)>1e-5)?rayCol(p-n*0.004,rfr,3.0,sbT):envCol(rfr);
      vec3 tint=mix(vec3(1.0),gbase*1.5,0.20);
      // Fresnel alone decides reflection against transmission: face-on the
      // surface is a window, edge-on it catches the room. That is what makes a
      // pane read as glass without ever closing the view through it.
      vec3 glass=mix(thru,mir,0.14+0.62*fre)*tint;
      float spec=pow(clamp(dot(n,normalize(l2-rd)),0.0,1.0),80.0);
      col=(glass
          +spec*pal(0.30+uHigh*0.3)*1.8
          +fre*pal(0.55+uHigh*0.25)*0.85
          +emis)*cov;
      // Depth falls off to black. A lattice this repetitive has no scale cue of
      // its own; the fog is what separates the cell you are in from the ones
      // behind it, and it is most of the reason the picture reads as deep.
      col*=exp(-max(d-1.0,0.0)*0.24);
    } else {
      vec3 solid=(base*(0.14+0.9*dif)*ao+fre*pal(0.4+uHigh*0.4)*0.9+emis)*cov;
      // Index of refraction. Translucency here was wrapped light plus
      // absorption, which needed the ray to keep walking through the body to
      // measure how much solid it crossed — expensive, and it only ever read as
      // wax going milky. Refraction is the cheaper and more legible property:
      // bend the view ray as it enters the surface and look along the bent ray
      // instead of the straight one. No second march and no interior walk, and
      // the background visibly displaces behind the body, which is the thing
      // the eye actually reads as glass.
      float ig=clamp(uIOR,0.0,1.0);
      // Text keeps its solid face whatever the slider says — a refracted
      // message is an unreadable one.
      if(ig>0.003 && trap>-0.5){
        // 1 is air and nothing happens; 2.2 is past sapphire, where the bend is
        // strong enough to invert what is behind a lobe.
        float ior=mix(1.0,2.2,ig);
        // Fresnel from the same index rather than an independent dial, so the
        // two always agree: a face-on surface is a window, a grazing one is a
        // mirror, and where it crosses over is what names the material.
        float f0=pow((ior-1.0)/(ior+1.0),2.0);
        float fr=f0+(1.0-f0)*pow(1.0-clamp(dot(-rd,n),0.0,1.0),5.0);
        // Dispersion. Glass has a different index per wavelength, so the three
        // channels bend separately and fringe apart where the bend is steepest
        // — the rim of the body, exactly where a real prism splits. Three env
        // fetches, no march.
        float ee=1.0/ior;
        vec3 rr=refract(rd,n,ee*0.985), rg=refract(rd,n,ee), rb=refract(rd,n,ee*1.015);
        vec3 thru=vec3(
          (dot(rr,rr)>1e-5?envCol(rr):envCol(rd)).r,
          (dot(rg,rg)>1e-5?envCol(rg):envCol(rd)).g,
          (dot(rb,rb)>1e-5?envCol(rb):envCol(rd)).b);
        vec3 mir=envCol(reflect(rd,n));
        // The body keeps its own colour, or every family comes out the same
        // colourless crystal.
        vec3 tint=mix(vec3(1.0),base*1.7,0.38);
        vec3 lg=normalize(vec3(0.7,0.9,-0.6));
        float spec=pow(clamp(dot(n,normalize(lg-rd)),0.0,1.0),90.0);
        vec3 glass=(mix(thru*tint,mir,fr)
                   +spec*pal(0.30+uHigh*0.3)*1.7
                   +fre*pal(0.55+uHigh*0.2)*0.5
                   +emis)*cov;
        col=mix(solid,glass,smoothstep(0.0,0.35,ig));
      } else {
        col=solid;
      }
    }
  }
  col+=glow*pal(0.15+uBass*0.3)*(0.7+uLoud*1.6)*((uMode==41)?0.3:1.0);
  col+=uBeat*0.16*pal(0.6);
  // Ghost composite. Only fires where the letters lost the depth test, so the
  // message never disappears into a dense fractal: it reads as glass in front of
  // the scene rather than a solid face, which keeps the occlusion cue while
  // still guaranteeing legibility.
  if(txtGhost>0.001){
    float onLitG=1.0-smoothstep(0.0,0.9,abs(txtLetterId-uTxtLit));
    vec3 gcol=pal(uTxtHue)*(0.9+onLitG*1.2);
    float amt=txtGhost*(0.30+onLitG*0.22);
    col=mix(col, mix(col*0.30, gcol, 0.72), amt);
  }
  return col;
}

#ifdef P_E2A
vec3 esc2at(vec2 uv,int kind,float ex,vec2 ctrIn,float rotAdd,float bud,float iex){
  // Bass breathing on the scale is what made deep zooms impossible to follow —
  // a 22% pulse per beat outruns any hand movement. 6% reads as breath, not lurch.
  float sc=2.6*exp2(-ex)*(1.0-0.06*uBass*uReact*uStrobe);
  vec2 jc=vec2(-0.4+(uCA-0.5)*1.1+(uMorph-0.5)*0.25, 0.6+(uCB-0.5)*1.1);
  vec2 ctr = ctrIn;  vec2 p=uv*sc;
  // uCamYaw is the manual rotation on the 2D families (drag / right stick).
  // Applied before the centre offset, so it turns the image about the middle of
  // the frame and the subject never leaves the screen — which is why these
  // scenes rotate instead of panning.
  p=p*rot((kind!=2?uTime*0.03*uSpeed*uSpin:0.0)+uCamYaw+uCamRoll+rotAdd);
  // uPan is pre-rotated on the host into fractal space, so a push left is
  // screen-left at any orientation without costing this program a matrix.
  // The SWEEP rotation is the exception and has to be applied to it here: the
  // endless zoom scales and turns the plane about the anchor, so a frame parked
  // off the anchor only lands back on itself if its offset turns with it. It
  // did not, so the loop was exact at the anchor and drifted everywhere else --
  // panning away from the origin broke the wrap.
  // The plane is no longer folded into a repeating cell here. The fold made
  // travel periodic: push far enough one way and the view you had just left
  // came back in from the opposite edge, which read as the image sliding
  // sideways under itself rather than as arriving anywhere new.
  p+=ctr+(uPan*rot(rotAdd))*sc*2.0;
    vec2 c,z;
  if(kind==1){ c=jc; z=p; }
  // Sine Lambda's |c| has to exceed 1 or the origin is attracting and the whole
  // plane converges — the scene was blank until c re was at maximum. Centred on
  // 1.5 now, so mid-slider is the strongest banding and the travel stays inside
  // the range where structure exists.
  else if(kind==2){ c=vec2(1.5+(uCA-0.5)*1.3, (uCB-0.5)*1.1); z=p*2.4; }
  else { c=p+vec2((uCA-0.5),(uCB-0.5))*0.55; z=vec2(0.0); }
  float fold=clamp(uMorph,0.0,1.0);
  float odk=orbitKeep();
  // The escape loop is the whole cost of this program. The ceiling was 900,
  // which the driver could not schedule alongside the trap, the stripe
  // accumulator and the Sine-Lambda transcendental branch in one body — a 2D
  // scene hung the GPU before it ever drew. 400 is the cap; past that the extra
  // iterations only refine boundary filaments finer than a pixel.
  // bud is 1/taps for the endless-zoom stack, floored so the layer carrying the
  // frame keeps its detail rather than all three going coarse.
  // iex, not ex: the iteration budget is frozen across a loop sweep. Deriving
  // it from the live depth meant the count stepped back by a whole sweep's
  // worth at every wrap, and since the count sets how far the escape bands
  // resolve, the picture visibly coarsened for a frame -- the stutter between
  // levels. Self-similar zoom holds the same amount of detail on screen the
  // whole way round, so one budget for the sweep is also the honest one.
  int maxi=int(max((60.0+iex*54.0)*fi()*max(bud,0.55)*uZIter, 32.0));
  maxi=int(min(float(maxi), mix(400.0,260.0,uSmooth)));
  float i=0.0,m=0.0;
  vec2 dz=vec2(1.0,0.0);
  float sf=(4.0+uCC*10.0)*sfScale(), st=0.0, sn=0.0, tr=1e9;
  vec3 tw; float tr0; trapCfg(tw,tr0);
  for(int k=0;k<maxi;k++){
    if(kind==2){
      // Sine Lambda: z <- c * sin(z). Transcendental, so it escapes through
      // bands rather than a cardioid boundary -- nothing like the Mandelbrot.
      vec2 sz=vec2(sin(z.x)*cosh(z.y), cos(z.x)*sinh(z.y));
      vec2 dsz=vec2(cos(z.x)*cosh(z.y), -sin(z.x)*sinh(z.y));
      dz=cmul(c,cmul(dsz,dz));
      z=cmul(c,sz);
    } else {
      if(kind==3) z=mix(z,abs(z),fold);
      if(kind==3) z.y=-z.y;
      dz=2.0*cmul(z,dz)+(kind==0?vec2(1.0,0.0):vec2(0.0));
      z=vec2(z.x*z.x-z.y*z.y,2.0*z.x*z.y)+c;
    }
    m=dot(z,z);
    float ang=atan(z.y,z.x), lz=sqrt(m);
    st=st*odk+0.5+0.5*sin(sf*ang); sn=sn*odk+1.0;
    tr=min(tr+(1.0-odk)*0.25, trapD(z,lz,tw,tr0));
    if(m>256.0) break;
    i+=1.0;
  }
  if(i>=float(maxi)-0.5) return esc_in(tr,st,sn,dz,float(maxi));
  return esc_shade(i,float(maxi),m,z,dz,st,sn,tr);
}

// Endless zoom by SELF-SIMILAR RE-CENTRING. The stacked-layer version is gone.
// Crossfading octaves could only ever hide the wrap, and hiding it cost a tap
// per layer on the most expensive program in the set — the third layer is what
// hung the app. This does not hide the wrap, it removes it: park the camera on
// a point the fractal is genuinely self-similar about, and zoom by exactly the
// ratio that maps the neighbourhood onto itself. One sweep later the frame
// holds the same picture it started with, so there is no seam to cover and one
// tap is enough.
//
// Two anchors, because the two kinds of set repeat for different reasons:
//
// Mandelbrot — the Feigenbaum point, c = -1.4011551890920506, the limit of the
// period-doubling cascade. The set is asymptotically self-similar there with
// ratio delta = 4.669201609, real and positive, so the zoom needs no rotation.
// Asymptotically means the match improves with depth, which is why the sweep
// starts at 2^-9 rather than at the top.
//
// Julia — the repelling fixed point z* = (1+sqrt(1-4c))/2, where the multiplier
// is L = 2z*. Koenigs says the map is linearly conjugate to multiplication by L
// near there, so the set really is self-similar about z* with ratio |L| and a
// rotation of arg(L). Rotating as well as scaling is what keeps the spiral arms
// registered through the wrap; scaling alone would twist them one turn per
// sweep. The ratio floor is for c near the boundary, where |L| approaches 1 and
// a full period would otherwise take an unusable amount of zoom.
vec3 escape2(vec2 uv,int kind){
  bool lp=uZLoop>=0.5;
  float zt=lp ? uZoom-floor(uZoom) : clamp(uZoom,0.0,1.0);
  // ONE call site, always. esc2at carries the escape loop, so every textual
  // call to it is another inlined copy of up to 400 iterations for the
  // compiler to unroll — two returns here took the mode-6 compile from tens of
  // milliseconds to over ten seconds and hung the app at boot. Both paths
  // resolve their framing into locals and fall through to a single return.
  // One path. The Feigenbaum point and its delta, a Julia repelling fixed point
  // and its multiplier, and Sine Lambda's lambda at the origin all arrive as
  // the same three numbers now — see zLoopParams on the host.
  vec2 anchor=uCtr; float ex=2.1+zt*6.4; float rt=0.0; float iex=ex;
  if(lp){ anchor=uZAnc; ex=uZBase+zt*uZRat; rt=-zt*uZRot; iex=uZBase+0.5*uZRat; }
  return esc2at(uv,kind,ex,anchor,rt,1.0,iex);
}

#endif
#ifdef P_E2B
vec3 escape2b(vec2 uv,int kind){
  // Same endless-zoom framing as escape2: the host hands over an anchor the
  // family is linearly self-similar about plus the log2-ratio and rotation of
  // its multiplier, and the sweep walks exactly one period of that similarity.
  // Multibrot and Celtic are parameter-plane, so their anchor is a measured
  // period-doubling cascade limit; Phoenix, Newton and Ship Julia are drawn in
  // the dynamical plane, so theirs is a repelling cycle. Either way it arrives
  // as the same three numbers and costs this program no extra tap.
  bool lp=uZLoop>=0.5;
  float zt=lp ? uZoom-floor(uZoom) : clamp(uZoom,0.0,1.0);
  float ex=lp ? uZBase+zt*uZRat : 2.1+zt*6.4;
  float iex=lp ? uZBase+0.5*uZRat : ex;
  float sc=2.8*exp2(-ex)*(1.0-0.06*uBass*uReact*uStrobe);
  float pw0=2.0+uMorph*4.0+(uCA-0.5)*1.2+uMid*uReact*0.6;
  vec2 ctr2 = lp ? uZAnc : uCtr;
  float rt2 = lp ? -zt*uZRot : 0.0;
  vec2 p=uv*sc*rot(uTime*0.02*uSpeed*uSpin+uCamYaw+rt2)+ctr2+(uPan*rot(rt2))*sc*2.0;
    float ca=(uCA-0.5)*1.5, cb=(uCB-0.5)*1.5;
  if(kind==2){
    vec2 z=p*2.2+vec2(1e-4);
    float i=0.0;
    int mi=int(clamp(40.0*fi(),20.0,80.0));
    for(int k=0;k<mi;k++){
      vec2 z2=cmul(z,z);
      vec2 dz=cdiv(cmul(z2,z)-vec2(1.0,0.0), 3.0*z2);
      z-=dz*(0.75+uCA*0.5);
      if(dot(dz,dz)<1e-7) break;
      i+=1.0;
    }
    float ang=atan(z.y,z.x)/6.28318;
    float sh=1.0-clamp(i/(40.0*fi())*1.2,0.0,0.92);
    return pal(ang+uCB*0.5+uHigh*0.3)*sh*1.15+uBeat*0.12;
  }
  vec2 z,c,zp=vec2(0.0);
  float pw=pw0;
  if(kind==0){ c=p; z=vec2(0.0); }
  else if(kind==1){ c=vec2(0.5667+ca*0.35, -0.5+cb*0.35); z=p; }
  else if(kind==3){ c=vec2(-1.05+ca*0.3, 0.035+cb*0.26); z=p; }
  else { c=p; z=vec2(0.0); }
  int maxi=int(min(max((56.0+iex*50.0)*fi()*uZIter, 32.0), mix(400.0,260.0,uSmooth)));
  float i=0.0,m=0.0;
  vec2 dz=vec2(1.0,0.0);
  float sf=(4.0+uCC*10.0)*sfScale(), st=0.0, sn=0.0, tr=1e9;
  float odk=orbitKeep();
  vec3 tw; float tr0; trapCfg(tw,tr0);
  for(int k=0;k<maxi;k++){
    // derivative of the local power map — good enough for shading on the
    // non-analytic (abs) variants too
    dz=pw*cmul(cpow_d(z,pw-1.0),dz)+(kind==0?vec2(1.0,0.0):vec2(0.0));
    if(kind==0){
      float r=length(z),a=atan(z.y,z.x)*pw;
      z=pow(max(r,1e-9),pw)*vec2(cos(a),sin(a))+c;
    } else if(kind==1){
      // Morph is the memory weight: 0 collapses Phoenix to a plain Julia.
      vec2 nz=cmul(z,z)+vec2(c.x,0.0)+c.y*zp*mix(0.15,1.7,uMorph);
      zp=z; z=nz;
    } else if(kind==3){
      // Always the full Burning Ship abs — the half-folded states in between
      // were neither one thing nor the other, and Morph is orbit length now.
      z=abs(z); z=cmul(z,z)+c;
    } else {
      vec2 z2=cmul(z,z);
      // Morph folds between Mandelbrot and the Celtic abs on the real part.
      z=vec2(mix(z2.x,abs(z2.x),clamp(uMorph,0.0,1.0)),z2.y)+c;
    }
    m=dot(z,z);
    float ang=atan(z.y,z.x), lz=sqrt(m);
    st=st*odk+0.5+0.5*sin(sf*ang); sn=sn*odk+1.0;
    tr=min(tr+(1.0-odk)*0.25, trapD(z,lz,tw,tr0));
    if(m>256.0) break;
    i+=1.0;
  }
  if(i>=float(maxi)-0.5) return esc_in(tr,st,sn,dz,float(maxi));
  return esc_shade(i,float(maxi),m,z,dz,st,sn,tr);
}

#endif
#ifdef P_TUN
vec3 tunnel(vec2 uv){
  uv+=uPan*0.6;
  float t=uTime*uSpeed;
  float a=atan(uv.y,uv.x), r=length(uv);
  float seg=floor(mix(4.0,14.0,uMorph)+uCA*8.0);
  a=abs(mod(a*seg/6.28318,1.0)-0.5)*2.0;
  // Depth down the barrel: monotonic travel plus the 1/r wall projection. The
  // bass term that used to sit here has moved into uTravel's rate, so the beat
  // accelerates the flight rather than sliding the whole tunnel back and forth.
  float z=uTravel*0.55+1.0/max(r,0.06)*0.55+uJump;
  float f=fbm(vec2(a*3.4,z*1.2));
  float band=sin((z+f*1.4)*mix(2.5,14.0,uDetail))*0.5+0.5;   // Detail: ring count
  // Hue keyed to depth, so each ring carries its own colour past the camera
  // instead of the whole barrel changing colour at once.
  vec3 col=pal(f*1.6+z*0.26+uHigh*0.3)*pow(band,mix(0.5,4.0,uCC));   // Cst C: band edge
  col*=0.75+0.55*band*(0.4+uBass*uReact);
  col*=smoothstep(0.0,0.35,r)*(1.6-r*0.7);
  col+=pal(0.5)*uLoud*0.28*exp(-r*2.2)*(0.3+uCB*2.2);        // Cst B: core bloom
  return col+uBeat*0.14;
}

#endif
#ifdef P_FLW
vec3 flow(vec2 uv){
  uv+=uPan*0.8;
  float t=uTime*0.22*uSpeed;
  vec2 p=uv*mix(1.4,0.45,uZoom);
  float warp=1.1+uMorph*2.4+uCA*1.8+uMid*uReact*1.2;
  float oct=fi();                                              // Iter: fbm octaves
  vec2 q=vec2(fbm(p*oct+vec2(t,0.0)),fbm(p*1.3*oct-vec2(0.0,t*1.3)));
  vec2 s=vec2(fbm(p*oct+q*warp+vec2(1.7,9.2)+t*0.5),fbm(p*oct+q*warp+vec2(8.3,2.8)-t*0.4));
  float v=fbm(p*oct+s*warp*1.2);
  float d=length(uv);
  float fil=mix(1.0,7.0,uDetail);                              // Detail: filament count
  vec3 col=pal(v*1.9*fil*0.32+d*0.2+uHigh*0.35);
  col*=pow(clamp(v*1.5,0.0,1.5),mix(0.6,3.4,uCC));            // Cst C: contrast
  col+=pal(0.3+uBass*0.4)*uLoud*0.3*exp(-d*1.4)*(0.3+uCB*2.2); // Cst B: core bloom
  return col+uBeat*0.13;
}


// Two more 2D families. Lyapunov (kind 0) is not escape-time at all: it runs
// the logistic map with two growth rates alternating on a fixed sequence and
// integrates log|f'|, so negative exponent = stable = solid, positive = chaos.
// Spider (kind 1) is escape-time with c drifting along the orbit.
#endif
#ifdef P_E2C
vec3 escape2c(vec2 uv,int kind){
  bool lp=uZLoop>=0.5;
  float zt=lp ? uZoom-floor(uZoom) : clamp(uZoom,0.0,1.0);
  // Harmony's bounded range opens a full octave wider than the others. Its
  // subject is the whole figure, which spans about 1.2 either side of the
  // origin, and the common 2.1-octave start frames a patch a fifth that size.
  float exB = uMode==39 ? 1.0 : 2.1;
  float ex=lp ? uZBase+zt*uZRat : exB+zt*6.4;
  float iex=lp ? uZBase+0.5*uZRat : ex;
  float sc=2.8*exp2(-ex)*(1.0-0.06*uBass*uReact*uStrobe);
  float rt3 = lp ? -zt*uZRot : 0.0;
  // Harmony's constant has to be known BEFORE the sampling point, because the
  // frame has to undo the tilt the constant causes. For z^4+c with c = R e^(i0)
  // the substitution z = e^(i0/3) w conjugates the map to the same family at
  // argument zero, so the set is the resting set turned by exactly a third of
  // the key angle. Subtracting that here keeps the figure upright while the
  // key still moves it -- a modulation tilts it a little instead of rolling it.
  float hth=atan(uTonal.y,uTonal.x)+1.5707963+(uCB-0.5)*2.0;
  float hclar=clamp(length(uTonal)*2.2,0.0,1.0);
  // Near the connectedness boundary of the quartic the set is a symmetric body
  // with a cleft at the top and feathered arms; measured, it disconnects just
  // above 0.478, so clarity walks a narrow band under that. A clear triad sits
  // closest to the boundary and has the thinnest, most intricate arms, which is
  // the same reading the quadratic version had, on a family whose symmetry is
  // four-fold rather than two.
  float hrad=mix(0.455,0.476,hclar)+(uCA-0.5)*0.02+uChordChg*0.006;
  // Upright: the time spin is dropped for this scene. A figure whose whole
  // point is its symmetry cannot be rolling.
  float hspin = uMode==39 ? -hth/3.0 : uTime*0.02*uSpeed*uSpin;
  vec2 p=uv*sc*rot(hspin+uCamYaw+rt3)+(lp?uZAnc:uCtr)+(uPan*rot(rt3))*sc*2.0;
    if(kind==0){
    vec2 ab=p*0.55+vec2(3.1,3.1)+vec2((uCA-0.5),(uCB-0.5))*0.5;
    float x=0.5, sum=0.0;
    int N=int(clamp(70.0*fi(),30.0,160.0));
    for(int k=0;k<N;k++){
      float r = (mod(float(k),3.0)<1.0) ? ab.x : ab.y;
      x=clamp(r*x*(1.0-x),1e-5,1.0-1e-5);
      sum+=log(abs(r*(1.0-2.0*x)));
    }
    float lam=sum/float(N);
    float tv=clamp(lam*mix(0.8,2.2,uDetail),-1.0,1.0);
    vec3 col = lam<0.0 ? pal(0.62-tv*0.5+uHigh*0.3+uCC*0.4)*(0.14+0.86*(-tv))
                       : pal(0.06+tv*0.55+uMid*0.25)*(0.18+1.1*tv);
    return col*(0.8+0.5*uLoud)+uBeat*0.1;
  }
  if(kind==2){
    // Circle of fifths mapped onto the c = r*e^(i0) Julia family. Every point on
    // that circle gives a connected, structured Julia set, and neighbouring
    // angles look like neighbours — so a IV-V-I is a short continuous walk
    // through shape space rather than a cut. The tonal centroid is already an
    // angle on the fifths circle, so the mapping is direct, not arbitrary.
    // Quarter turn on the mapping. The angle is the key centre, and with no
    // signal it reads zero, which put c on the POSITIVE REAL axis at radius
    // 0.7 -- outside the cardioid, where the Julia set is dust. That is what
    // the scene opened on. Offset by a quarter turn and silence lands on the
    // imaginary axis instead, the one line where a quadratic Julia is mirror
    // symmetric about the vertical, so the resting shape is a symmetric one.
    float th=hth;
    float clar=hclar;
    // Radius decides how filamentary the set is: 0.7885 sits on the boundary
    // where the arms are thinnest and most detailed, and pulling inward gives a
    // rounder, calmer shape. Driving it from tonal clarity means a clear triad
    // renders as intricate structure and an ambiguous or noisy passage collapses
    // toward a blob, so consonance reads as form and not only as colour.
    // 0.63 on the imaginary axis is just inside the connected region: the set
    // still has interior, so it reads as a filled body with feathered arms
    // rather than a scatter of filaments. Measured, the interior vanishes
    // above about 0.66i, so this is close to the boundary without crossing it,
    // and clarity still carries the set out to 0.7885 where the arms thin to a
    // dendrite. Consonance reads as intricacy exactly as before; it now starts
    // from a shape with mass.
    float rad=hrad;
    vec2 c2=rad*vec2(cos(th),sin(th));
    vec2 zz=p*(1.0-uChordChg*0.05);
    int mi2=int(min(max((56.0+iex*46.0)*fi()*uZIter, 32.0), mix(400.0,260.0,uSmooth)));
    float i2=0.0,m2=0.0;
    vec2 d2=vec2(1.0,0.0);
    float sf2=4.0+uCC*10.0, s2=0.0, sn2=0.0, tr2=1e9;
    for(int k=0;k<mi2;k++){
      // z <- z^4 + c. The quartic is what gives the figure its shape: a
      // quadratic Julia is invariant under a half turn only, so it can be
      // symmetric about one axis but never carries a cleft and an apex at the
      // same time. z^4+c is invariant under every quarter turn, so with c on
      // the axis the arms fall two above and two below, the pair above opening
      // a notch between them. Derivative is 4z^3 by the chain rule, which the
      // relief shading needs as much as the escape test does.
      vec2 zq=cmul(zz,zz);
      d2=4.0*cmul(cmul(zz,zq),d2);
      zz=cmul(zq,zq)+c2;
      m2=dot(zz,zz);
      s2+=0.5+0.5*sin(sf2*atan(zz.y,zz.x)); sn2+=1.0;
      tr2=min(tr2,min(length(zz-vec2(0.0,1.0)),min(abs(zz.x),abs(zz.y))));
      if(m2>256.0) break;
      i2+=1.0;
    }
    if(i2>=float(mi2)-0.5) return esc_in(tr2,s2,sn2,d2,float(mi2));
    return esc_shade(i2,float(mi2),m2,zz,d2,s2,sn2,tr2);
  }
  if(kind==3){
    // Golden Wave. The Fibonacci ratio enters twice, both times structurally.
    //
    // (1) The parameter. c(t) = e^(2pi i t)/2 - e^(4pi i t)/4 traces the boundary
    // of the main cardioid, where t is the rotation number of the fixed point at
    // the origin. At t = 1/phi — the limit of consecutive Fibonacci ratios, and
    // the hardest number to approximate by rationals — the Julia set carries a
    // Siegel disk and its arms spiral without ever closing. A rational t would
    // give a closed flower with p-fold symmetry instead; it is specifically the
    // golden mean that produces an endlessly curling, self-similar arm.
    float PHI=1.6180339887;
    float t=1.0/PHI + (uCB-0.5)*0.004 + uMid*uReact*0.0012;
    float a1=6.2831853*t;
    vec2 cw=0.5*vec2(cos(a1),sin(a1))-0.25*vec2(cos(2.0*a1),sin(2.0*a1));

    // Framing is its own: the other Julia scenes start several octaves in to
    // land on filigree, but this one has to read as a whole composition, so the
    // floor sits back far enough to hold the entire set at low Zoom.
    float exw=-0.55+clamp(uZoom,0.0,1.0)*8.0;
    float scw=2.6*exp2(-exw);
    vec2 pw=uv*scw*rot(uTime*0.02*uSpeed*uSpin+uCamYaw)+uCtr+uPan*scw*2.0;
    
    // (2) The frame. A golden spiral grows by phi every quarter turn: r = e^(b*th)
    // with b = ln(phi)/(pi/2). Rotating the plane by ln(r)/b therefore maps rays
    // onto exactly that spiral, so the set's radial arms curl into the breaking
    // crest — and because the winding rate goes as log r, the curl tightens
    // without limit toward the centre, which is the eye of the wave. Bass drives
    // the curl: the wave pitches over on the beat instead of merely brightening.
    float b=log(PHI)/1.5707963;
    float curl=uMorph*1.35+uBass*uReact*0.30;
    vec2 zw=pw*rot(log(max(length(pw),1e-7))/b*curl);

    // Stripe count from the Fibonacci numbers rather than a continuous knob:
    // the angular stripe term is what draws the foam claws, and 8 / 13 / 21 of
    // them keeps the count inside the same sequence as the rest of the scene.
    float sfw = uCC<0.34 ? 8.0 : (uCC<0.67 ? 13.0 : 21.0);
    int miw=int(clamp((72.0+max(exw,0.0)*48.0)*fi(), 60.0, mix(400.0,260.0,uSmooth)));
    float iw=0.0,mw=0.0,sw=0.0,snw=0.0,trw=1e9;
    vec2 dw=vec2(1.0,0.0);
    for(int k=0;k<miw;k++){
      dw=2.0*cmul(zw,dw);
      zw=cmul(zw,zw)+cw;
      mw=dot(zw,zw);
      sw+=0.5+0.5*sin(sfw*atan(zw.y,zw.x)); snw+=1.0;
      trw=min(trw,min(length(zw-vec2(0.0,1.0)),min(abs(zw.x),abs(zw.y))));
      if(mw>256.0) break;
      iw+=1.0;
    }
    if(iw>=float(miw)-0.5) return esc_in(trw,sw,snw,dw,float(miw));
    return esc_shade(iw,float(miw),mw,zw,dw,sw,snw,trw);
  }
  vec2 z=p, c=p+vec2((uCA-0.5),(uCB-0.5))*0.4;
  int maxi=int(min(max((56.0+iex*46.0)*fi()*uZIter, 32.0), mix(400.0,260.0,uSmooth)));
  float i=0.0,m=0.0;
  vec2 dz=vec2(1.0,0.0);
  float sf=4.0+uCC*10.0, st=0.0, sn=0.0, tr=1e9;
  for(int k=0;k<maxi;k++){
    dz=2.0*cmul(z,dz)+vec2(1.0,0.0);
    z=cmul(z,z)+c;
    c=c*0.5+z;
    m=dot(z,z);
    st+=0.5+0.5*sin(sf*atan(z.y,z.x)); sn+=1.0;
    tr=min(tr,min(length(z-vec2(0.0,1.0)),min(abs(z.x),abs(z.y))));
    if(m>256.0) break;
    i+=1.0;
  }
  if(i>=float(maxi)-0.5) return esc_in(tr,st,sn,dz,float(maxi));
  return esc_shade(i,float(maxi),m,z,dz,st,sn,tr);
}

#endif
// Endless zoom, as real functions in the 2D-ONLY block. These were macros in
// the shared header, which is what stopped the 2D scenes building at all:
// expanding zoomLoop2D pasted the five-way dispatch chain in twice, so the
// compiler saw ten inlined copies of the escape-time loops in what is already
// the largest program in the set (eighteen scenes through one shader) and the
// link failed. One function called three times compiles the chain once.
//
// The scale multiplier is exponential and only ever spans ONE octave: over a
// cycle layer A shrinks the frame to half its span (a 2x zoom in) while layer B,
// offset exactly one octave out, grows into the state A started from. Cross-fade
// A to B across the cycle and at the wrap B *is* the new A, so the phase resets
// with nothing on screen changing — no snap to hide, and no accumulating scale
// to lose float precision to. Idle (phase at a whole octave) costs one
// evaluation; only a cycle in progress pays for the second layer.

// Kaleido fold shared by the main pass, the parallax echo and the floor
// reflection, so all three layers of a synth scene agree on symmetry.
vec2 kfold(vec2 p,float sym){
  if(sym<0.5) return p;
  float a=atan(p.y,p.x), r=length(p);
  float seg=6.2831853/sym;
  a=abs(mod(a+seg*0.5,seg)-seg*0.5);
  return r*vec2(cos(a),sin(a));
}

// Polynomial smooth minimum. Two surfaces that approach bulge into each other
// instead of intersecting, which is what makes the Atom orbs squish off one
// another and off the frame walls.
float smin3(float a,float b,float k){ float h=clamp(0.5+0.5*(b-a)/k,0.0,1.0); return mix(b,a,h)-k*h*(1.0-h); }

// The shape field of every synth scene, factored out of the shading so it can
// be evaluated more than once per pixel: once for the subject, once for the
// depth echo behind it, once for the reflection in the floor.
void synF(vec2 p,int k,float dens,float amp,float t,out float v,out float hue,out float glo){
  v=0.0; hue=0.0; glo=0.0;

  if(k==0){
    // The row spans the whole frame, not the unit square. p.x reaches past 2
    // on a wide canvas at mid zoom, so a +-1 mapping clamped the outer thirds
    // of the frame to the first and last bin and the analyser stopped short of
    // both edges. Wider mapping, and more bins across it.
    float x=clamp(p.x*0.26+0.5,0.0,1.0);
    float bars=floor(mix(40.0,168.0,dens));
    float bx=floor(x*bars)/bars;
    float sp=specAt(pow(bx,0.72));
    float h=0.03+sp*amp;
    float ay=abs(p.y);
    float body=smoothstep(h,h-0.012,ay);
    float gap=smoothstep(0.0,0.12,abs(fract(x*bars)-0.5)*2.0-0.12);
    v=body*gap;
    glo=smoothstep(0.03,0.0,abs(ay-h))*gap*1.4;
    hue=bx*0.55+sp*0.35;
  } else if(k==1){
    // Triangle emitter. For a regular polygon the boundary is r·cos(â) = const,
    // with â the bearing folded into one sector — so reading that value through
    // a logarithm gives nested equilateral triangles, each the same shape at a
    // larger scale. Scrolling the log phase throws them outward forever: an
    // emitter rather than a pulse that runs out of room.
    float a=atan(p.y,p.x)+t*0.16*uSpin;
    float r=length(p);
    const float SEC=2.0943951;                    // 2π/3
    float aa=mod(a+SEC*0.5, SEC)-SEC*0.5;
    float tri=r*cos(aa)*2.0;                      // 1.0 on the inscribed triangle
    float rings=mix(1.1,3.0,dens);
    float lg=log(max(tri,1e-3))*rings;
    float z=fract(lg - t*0.55);
    // Each shell is an outline whose edge softens as it grows, so the newest
    // triangles read as hard and the old ones as spent.
    float band=smoothstep(0.62,0.04,abs(z-0.5)*2.0);
    v=band*smoothstep(0.0,0.16,tri);
    // Vertices catch more light than the flats — that is what makes the shape
    // read as a triangle and not a ring.
    float corner=smoothstep(0.62,1.0,abs(aa)/(SEC*0.5));
    v*=0.70+0.60*corner*(0.45+amp*0.55);
    // Emission on the hit: one shell leaves the centre per beat.
    float born=exp(-fract(max(uBeatPh,0.0))*3.2)*uReact;
    v+=band*exp(-tri*2.2)*born*0.55;
    glo=pow(band,3.0)*(0.45+uBass*uReact)+exp(-tri*3.0)*born*0.5;
    hue=z*0.42+floor(lg)*0.06+t*0.01;
  } else if(k==2){
    vec2 q=p+vec2(t*0.06,sin(t*0.13)*0.2);
    vec2 g=q*mix(5.0,16.0,dens);
    vec2 id=floor(g), f=fract(g)-0.5;
    float h1=hash(id), h2b=hash(id+37.13);
    vec2 off=(vec2(h1,h2b)-0.5)*0.72;
    float band=specAt(h1*0.9+0.03);
    float rad=0.05+band*0.4*amp;
    float d=length(f-off);
    v=smoothstep(rad,rad*0.15,d);
    glo=smoothstep(rad*2.6,0.0,d)*band*0.7;
    hue=h1*0.7+band*0.25;
  } else if(k==3){
    // Atoms. Three of them drift around the frame, bounce off the walls and off
    // each other, and every particle is a soft radial blob so the shared
    // material pass lights it as a sphere. The whole scene is one distance
    // field joined by smooth minimum, so bodies that approach bulge into each
    // other instead of overlapping — the squish is the field, not an effect.
    // Element count per atom comes off the detected note and its own spectrum
    // band, so the shells fill and empty with the music: 2, then up to 8.
    float wx=1.58, wy=0.96;
    float d=1e3;
    vec2 cs[3];
    for(int m=0;m<3;m++){
      float fm=float(m);
      // Triangle-wave drift bounces exactly off the walls with no state to keep.
      vec2 tw=vec2(abs(fract(t*(0.13+fm*0.05)+fm*0.37)*2.0-1.0)*2.0-1.0,
                   abs(fract(t*(0.11+fm*0.06)+fm*0.61)*2.0-1.0)*2.0-1.0);
      float band=specAt(0.06+fm*0.30);
      float Z=clamp(3.0+floor(uNote*8.0)+fm*2.0+floor(band*4.0),2.0,10.0);
      float sc=(0.62+dens*0.5)*(0.8+band*0.4);
      vec2 c=vec2(tw.x*(wx-0.55*sc), tw.y*(wy-0.50*sc));
      cs[m]=c;
      // Wall squash: the atom flattens along the axis it is pressing into.
      vec2 sq=vec2(1.0-0.30*smoothstep(wx-0.78*sc,wx-0.52*sc,abs(c.x)),
                   1.0-0.30*smoothstep(wy-0.72*sc,wy-0.46*sc,abs(c.y)));
      vec2 pl=(p-c)/sq;
      float nr=(0.13+uBass*uReact*0.07)*sc*(0.9+amp*0.3);
      float bt=1.0+uBeat*uReact*0.18;
      d=smin3(d, length(vec2(pl.x/bt, pl.y*bt))-nr, 0.10);
      float rem=Z;
      for(int s=0;s<2;s++){
        float n=min(s==0?2.0:8.0, rem);
        if(n<=0.0) break;
        rem-=n;
        float rr=(0.34+float(s)*0.30)*sc*(1.0+band*amp*0.4);
        float spd=(s==0?1.0:-0.66)*(1.0+band*0.7)*uSpin;
        float er=(0.078+band*0.05*amp)*sc;
        for(int i=0;i<8;i++){
          if(float(i)>=n) break;
          float a=t*spd*1.6+float(i)*6.2831853/n+fm*1.7;
          d=smin3(d, length(pl-vec2(cos(a),sin(a))*rr)-er, 0.09);
        }
        // Shell trace, so the arrangement reads as orbits and not loose dots.
        d=min(d, abs(length(pl)-rr)+0.045*sc);
      }
    }
    // Bonds: nuclei that come close are joined by a capsule, so the atoms read
    // as reacting with each other rather than passing through.
    for(int b=0;b<3;b++){
      vec2 A=cs[b], B2=cs[b==2?0:b+1];
      vec2 ab=B2-A;
      float L2=max(dot(ab,ab),1e-4);
      float h2=clamp(dot(p-A,ab)/L2,0.0,1.0);
      float th=0.034*smoothstep(1.20,0.42,sqrt(L2));
      d=smin3(d, length(p-A-ab*h2)-th, 0.06);
    }
    float w=0.030+0.045*(1.0-dens);
    v=smoothstep(w,-w*0.8,d);
    glo=smoothstep(w*6.0,0.0,d)*0.6;
    hue=0.42+clamp(-d,0.0,0.6)*0.9+t*0.01;
  } else if(k==4){
    // Grid Pulse: the cells sit on a plane and extrude toward the viewer, so a
    // lit cell is a column rising out of the grid straight at the camera. With
    // the vanishing point at the centre, a point raised by y projects outward
    // by 1/(1-y*e), so the inverse map for a screen point is q = p*(1-y*e).
    // Marching y downward from the tallest possible column and taking the
    // first cell whose height covers that level is a cheap depth test: the
    // first hit is the nearest surface.
    float gs=mix(3.5,11.0,dens);
    float e2=0.55;
    float hitY=-1.0, hband=0.0, cellf=0.0, hid=0.0;
    // Four march steps, not eight: each step is a hash plus a spectrum texture
    // fetch, and the branch lives in the one SYN program, so its cost lands on
    // every synth scene whether or not it is the one on screen.
    for(int s=0;s<4;s++){
      float y=(1.0-float(s)/3.0)*0.85;
      vec2 q=p*(1.0-y*e2);
      vec2 id=floor(q*gs);
      float bi=hash(id);
      float sp=specAt(bi);
      if(y<=sp*amp*0.8){
        vec2 f2=abs(fract(q*gs)-0.5)*2.0;
        float m=smoothstep(0.94,0.68,max(f2.x,f2.y));
        if(m>0.001){ hitY=y; hband=sp; cellf=m; hid=bi; break; }
      }
    }
    if(hitY>=0.0){
      // Top faces catch the light; walls fall off down the column.
      float top=smoothstep(0.0,0.14,hitY);
      v=cellf*(0.35+hband*0.9)*(0.45+0.55*top);
      glo=cellf*hband*0.7*top;
      hue=hid*0.5+hband*0.3;
    }
    // Base grid so the floor plane stays legible under the columns.
    vec2 fb=abs(fract(p*gs)-0.5)*2.0;
    v+=smoothstep(0.88,1.0,max(fb.x,fb.y))*0.15;
  } else if(k==5){
    int N=int(mix(5.0,11.0,dens));
    for(int i=0;i<11;i++){
      if(i>=N) break;
      float fi2=(float(i)+0.5)/float(N);
      float band=specAt(fi2*0.85+0.04);
      float y0=(fi2-0.5)*1.7;
      float w0=wvL(fract(p.x*0.22+fi2*0.31+t*0.04))*0.22*amp;
      float ry=y0+w0+sin(p.x*1.9+t*0.45+fi2*6.1)*0.11;
      float th=0.008+band*0.07*amp;
      float m=smoothstep(th,0.0,abs(p.y-ry));
      v+=m*(0.35+band);
      glo+=smoothstep(th*4.0,0.0,abs(p.y-ry))*band*0.3;
      hue+=m*(fi2*0.7);
    }
  } else {
    float f=0.0;
    for(int i=0;i<7;i++){
      float fi2=(float(i)+0.5)/7.0;
      float band=specAt(fi2*0.8+0.05);
      vec2 c0=vec2(sin(t*(0.27+fi2*0.43)+fi2*9.2),cos(t*(0.21+fi2*0.37)+fi2*5.4))*0.62;
      float rr=0.11+band*0.32*amp;
      vec2 dd=p-c0;
      f+=rr*rr/max(dot(dd,dd),2e-4);
    }
    float thr=mix(1.9,0.65,dens);
    v=smoothstep(thr*0.7,thr,f);
    glo=(smoothstep(thr*0.95,thr*1.02,f)-smoothstep(thr*1.3,thr*1.8,f))*0.9;
    hue=f*0.22+t*0.01;
  }
}

vec3 synth(vec2 uv,int k){
  float t=uTime*uSpeed;
  float zs=mix(2.2,0.22,clamp(uZoom,0.0,1.0));
  // Audio camera. The frame pulls in on the low end, snaps on each beat and
  // rotates slowly across the bar, so the view is part of the performance
  // rather than a fixed window onto it.
  float bp=fract(max(uBeatPh,0.0));
  float kick=exp(-bp*5.0)*uReact;
  // Frame breathing runs off the smoothed low end and the strobe-gated beat, so
  // killing the strobe also stops the per-hit zoom snap rather than leaving the
  // frame pumping with the flashing switched off.
  float cz=1.0/(1.0+(uBass*0.09*uStrobe+uBeat*0.05)*uReact);
  float cang=(sin(uBeatPh*1.5707963)*0.045+uTonal.x*0.06)*uSpin*uReact;
  vec2 cs=vec2(cos(cang),sin(cang));
  uv=vec2(uv.x*cs.x-uv.y*cs.y, uv.x*cs.y+uv.y*cs.x)*cz;
  // Look controls shared by every synth scene, using the uniforms the
  // fractal families spend on geometry:
  //   uMorph -> mirror symmetry (0 = off, up to 8-fold kaleido)
  //   uCB    -> bloom weight
  //   uCC    -> edge contrast (soft wash vs hard line)
  float sym=floor(clamp(uMorph,0.0,1.0)*8.0);
  vec2 p=kfold(uv*zs+uPan*zs*1.6, sym);
  float dens=clamp(uDetail,0.0,1.0);
  float amp=(0.45+uCA*1.3)*(1.0+kick*0.22);   // shapes swell on the hit
  float v,hue,glo;
  synF(p,k,dens,amp,t,v,hue,glo);

  // Edge contrast: low uCC is a soft wash, high is a hard clipped line.
  float ctr=mix(1.9,0.34,clamp(uCC,0.0,1.0));
  v=pow(clamp(v,0.0,1.6),ctr)*(1.0+uBeat*0.35*uReact);
  float bl=0.25+clamp(uCB,0.0,1.0)*2.1;      // bloom weight

  // Screen-space contour: the derivative of the shape mask gives every synth
  // form a bright anti-aliased rim, which is what reads as "lit" rather than
  // flat fill. Cheap — no extra sampling.
  float edge=length(vec2(dFdx(v),dFdy(v)))/max(fwidth(length(p))*1.6,1e-4);
  edge=clamp(edge,0.0,1.0);

  // Depth field: a slow fbm haze behind the shapes so the background is a
  // volume instead of pure black, and a floor bounce driven by the low bins.
  float haze=fbm(p*1.25+vec2(t*0.05,-t*0.07));
  vec3 bg=pal(0.62+haze*0.3+uHue*0.0)*haze*haze*(0.045+uBass*uReact*0.11);
  bg+=pal(0.08)*exp(-abs(uv.y+0.72)*3.4)*(0.03+uLoud*0.09);

  // Harmony tint: the key centre rotates the palette read and a chord change
  // nudges it, so a modulation in the music lands as a colour shift.
  float hs=hue*0.85+uTonal.x*0.10+uChordChg*0.08;

  // Thickness without a second field evaluation. The directional derivative of
  // the mask against the light offset gives a one-sided band on the shadowed
  // side of every shape, which is what a side wall looks like. Sampling synF a
  // second time at p+offset was the honest version of this and cost 2-3x the
  // frame across the whole family, Grid Pulse worst of all.
  vec2 exo=normalize(vec2(0.030,-0.034));
  float gx=dFdx(v), gy=dFdy(v);
  float wall=clamp(-(gx*exo.x+gy*exo.y)*(9.0+uBass*uReact*6.0),0.0,1.0);

  // Two-light material. The normal comes from the mask gradient; a key from the
  // upper left plus a complementary fill from below is what breaks the
  // single-hue flatness — lit faces run to the palette's key colour, shadowed
  // ones toward its opposite.
  vec3 n=normalize(vec3(-gx*3.0,-gy*3.0,0.62));
  vec3 L=normalize(vec3(-0.52,0.60,0.72));
  float lam=max(dot(n,L),0.0);
  float spec=pow(max(dot(n,normalize(L+vec3(0.0,0.0,1.0))),0.0), mix(16.0,88.0,clamp(uCB,0.0,1.0)));

  vec3 key=pal(hs);
  vec3 mat=mix(pal(hs+0.44)*0.66, key*1.06, 0.28+0.72*lam);
  vec3 c=bg+mat*v;
  c+=pal(hs+0.05)*wall*(0.14+uMid*uReact*0.14);

  // Dispersed bloom: the three channels bloom at slightly separated hues, so
  // hot cores fringe warm/cool at their edges the way real optics do.
  float disp=0.05+uHigh*uReact*0.09;
  vec3 gcol=vec3(pal(hs+0.28-disp).r, pal(hs+0.28).g, pal(hs+0.28+disp).b);
  c+=gcol*glo*bl*(0.4+uHigh*uReact*0.6);

  // Rim, then a tight specular that pumps on the hit: the light is the thing
  // that arrives, so a beat reads as the surface catching a flash.
  c+=pal(hs+0.5)*edge*v*(0.45+uCB*0.7);
  c+=vec3(1.0,0.97,0.92)*spec*v*(0.30+uHigh*uReact*0.55+kick*0.5);
  c+=vec3(1.0,0.98,0.94)*pow(edge,3.0)*v*(0.14+uBeat*0.3*uReact);

  // Stage floor: the field mirrored under a horizon, hard-compressed and
  // rippled on the bass, so each scene sits on a wet surface instead of
  // floating in black. The second field evaluation is deliberately confined to
  // the band below the horizon — running it over the whole frame (the parallax
  // echo this replaces) doubled the cost of every synth scene for a layer
  // worth a few percent of brightness, and made the family slow to compile.
  float hz=-0.58;
  // Bounded to the band where exp(-dd*9) is still visible: below that the
  // second field evaluation is paying full price for nothing.
  if(uv.y<hz && uv.y>hz-0.40){
    float dd=hz-uv.y;
    vec2 ruv=vec2(uv.x+sin(dd*19.0-t*1.05)*0.018*(0.45+uBass*uReact), hz+dd*0.34);
    float rv,rh,rg;
    synF(kfold(ruv*zs+uPan*zs*1.6, sym), k, dens, amp, t, rv,rh,rg);
    rv=pow(clamp(rv,0.0,1.6),ctr);
    // Ease the reflection in from the horizon instead of starting it at full
    // strength: a hard onset at hz is what read as a line across the frame.
    float fade=exp(-dd*9.0)*(0.15+uLoud*0.07)*smoothstep(0.0,0.05,dd);
    c+=(pal(rh*0.85)*rv + pal(rh*0.85+0.28)*rg*bl*0.14)*fade;
  }

  // Beat ring: a thin shock expanding from the centre once per beat, so there
  // is something that arrives and resolves instead of only drifting.
  float rr=length(uv);
  // Squared by multiplication, not pow(): pow() with a negative base is
  // undefined in GLSL and this radius term is negative over most of the frame.
  float rw=(rr-bp*1.25)*9.0;
  float ring=exp(-rw*rw)*(1.0-bp)*uReact;
  c+=pal(hs+0.18)*ring*(0.10+uLoud*0.22);

  c*=1.0-0.22*smoothstep(0.7,1.7,length(uv));
  return c;
}

vec3 sampleVid(vec2 t){
  t.x = mix(t.x, 1.0-t.x, uVidFlip);
  t = clamp(t, 0.0, 1.0);
  return texture(uTex, vec2(t.x, 1.0-t.y)).rgb;
}
float vidLuma(vec2 t){ return dot(sampleVid(t), vec3(0.299,0.587,0.114)); }
vec3 surfVid(vec3 p, vec3 n){
  // Triplanar projection: sample the frame down all three axes and blend by the
  // normal, so it wraps the surface without seams or edge-on stretching. The
  // coords are object-space, which is what locks the image to the geometry as
  // the camera orbits instead of sliding across the screen.
  vec3 w=pow(abs(n),vec3(4.0));
  w/=max(w.x+w.y+w.z,1e-4);
  float s=0.34;
  return sampleVid(p.zy*s+0.5)*w.x + sampleVid(p.xz*s+0.5)*w.y + sampleVid(p.xy*s+0.5)*w.z;
}
float sobel(vec2 t, vec2 px){
  float l00=vidLuma(t+vec2(-px.x,-px.y)), l10=vidLuma(t+vec2(0.0,-px.y)), l20=vidLuma(t+vec2(px.x,-px.y));
  float l01=vidLuma(t+vec2(-px.x,0.0)),   l21=vidLuma(t+vec2(px.x,0.0));
  float l02=vidLuma(t+vec2(-px.x,px.y)),  l12=vidLuma(t+vec2(0.0,px.y)), l22=vidLuma(t+vec2(px.x,px.y));
  float gx=-l00-2.0*l01-l02+l20+2.0*l21+l22;
  float gy=-l00-2.0*l10-l20+l02+2.0*l12+l22;
  return length(vec2(gx,gy));
}
vec3 roto(vec2 t, vec2 px, bool inkOnly){
  vec3 c=sampleVid(t);
  float bands=floor(mix(2.0,7.0,uDetail));
  vec3 q=floor(c*bands+0.5)/bands;
  float l=dot(q,vec3(0.299,0.587,0.114));
  vec3 tint=pal(floor(l*bands)/bands*1.3+uHue*0.0);
  q=mix(q, tint*(0.35+l*0.9), 0.55+uMorph*0.35);
  float e=sobel(t, px*(1.0+uBass*2.5));
  float ink=smoothstep(0.16, 0.46, e*(0.7+uHigh*1.4));
  if(inkOnly) return pal(l*1.4+uHigh*0.3)*ink*1.5;
  return q*(1.0-ink);
}
// ASCII art. Letters and punctuation drawn as 5x7 bitmaps inside a 6x9 cell,
// so every glyph carries half a column of side bearing and a row of leading —
// that gutter is what stops the characters fusing into blocks. Ordered by ink
// coverage, lightest first; row-major 5-bit masks (bit 0 = leftmost column).
// The table itself lives in a 50x7 R8 texture built by the host (VJE.GLYPHS),
// not in a const int[350]. A constant array read at a computed index is not a
// memory read to a shader compiler: ANGLE expands it into a selection chain one
// branch per element, so 350 entries became 350 branches inside every program
// that includes this block — which is all of them. On the 2D families, already
// the largest programs in the set, that chain was what stalled the link long
// enough to freeze the whole app at boot. A texelFetch is one instruction and
// compiles in constant time no matter how many glyphs the ramp grows to.
uniform sampler2D uGly;
float glyphPix(int g, vec2 f){
  // 5x7 glyph centred in a 6x9 box: half a blank column each side, one blank
  // row above and below.
  ivec2 p = ivec2(floor(vec2(f.x*6.0-0.5, (1.0-f.y)*9.0-1.0)));
  if(p.x<0 || p.x>4 || p.y<0 || p.y>6) return 0.0;
  int mask = int(texelFetch(uGly, ivec2(g, p.y), 0).r*255.0 + 0.5);
  return float((mask >> p.x) & 1);

}
vec3 asciiArt(vec2 suv, vec3 col){
  // Cell width drives everything; height follows the 5:7 glyph box so the
  // characters stay square-ish and the grid reads as text, not as blocks.
  float cols = floor(mix(46.0, 168.0, uDetail));
  float cw = max(uRes.x/cols, 2.0);
  float rows = max(floor(uRes.y/(cw*1.5)), 3.0);
  vec2 n = vec2(cols, rows);
  vec2 idx = floor(suv*n), f = fract(suv*n);
  vec3 vv = sampleVid((idx+0.5)/n);
  float l = dot(vv, vec3(0.299,0.587,0.114));
  // Bass lifts the whole ramp, so the character set thickens on the beat.
  l = pow(clamp(l*(1.0+uBass*0.5), 0.0, 1.0), 1.1);
  int g = int(clamp(l*50.0, 0.0, 49.0));
  float m = glyphPix(g, f);
  // Video's own colour by default, palette-mapped by luma as Morph goes up.
  vec3 tint = mix(vv/max(max(vv.r,max(vv.g,vv.b)),0.08)*(0.35+l*0.95),
                  pal(l*1.25+uHigh*0.25)*(0.4+l*0.9), uMorph);
  vec3 bg = mix(vv*0.07, col*0.16, 0.5);
  return bg + tint*m*(1.15+uLoud*0.35);
}
// Wireframe. The frame's luma is read as relief — bright is near, dark is far —
// and a quad mesh is laid over it in the surface's own coordinates rather than
// on the screen. Raising a region pushes its cells outward under perspective, so
// the lines bulge over a face and crowd together where the form turns away; that
// crowding is what a wireframe render's silhouette actually is. No geometry is
// built: the mesh is the warped grid, so any input becomes an approximated solid.
vec3 wireMesh(vec2 uv, vec2 suv, vec3 col){
  float gn  = floor(mix(24.0, 76.0, uDetail));
  float amp = 0.55 + uBass*0.45;
  vec3 neon = mix(vec3(0.30,1.0,0.55), pal(0.32+uHigh*0.2), uMorph);
  // Wide 5-tap so the relief follows the subject's form and not sensor noise.
  vec2 e = 2.2/uRes;
  float hx1=vidLuma(suv+vec2(e.x,0.0)), hx0=vidLuma(suv-vec2(e.x,0.0));
  float hy1=vidLuma(suv+vec2(0.0,e.y)), hy0=vidLuma(suv-vec2(0.0,e.y));
  float h = (vidLuma(suv)*2.0 + hx1+hx0+hy1+hy0)/6.0;
  h = smoothstep(0.04, 0.92, h);
  vec2 grad = vec2(hx1-hx0, hy1-hy0)/(2.0*max(e.x,1e-5));
  // Surface normal from the relief. facing goes to 0 at a silhouette, which is
  // where a real wireframe's lines pile up.
  vec3 n = normalize(vec3(-grad*amp*0.06, 1.0));
  float facing = clamp(n.z, 0.02, 1.0);
  // Perspective on the raised surface: a cell nearer the eye covers more screen.
  float z = h*amp*0.42;
  vec2 p = (suv - 0.5)*(1.0 + z*0.85) + vec2(z*0.09, -z*0.14);
  vec2 g = p*gn;
  vec2 fw = max(fwidth(g), 1e-4);
  vec2 df = abs(fract(g) - 0.5)/fw;
  float d = min(df.x, df.y);
  float line = 1.0 - smoothstep(0.35, 1.25, d);
  float glow = exp(-d*0.55);
  // Silhouette rim: steep relief reads as an edge turning away from the eye.
  float rim = smoothstep(0.6, 3.2, length(grad)*0.02);
  // The mesh only clads what the frame actually shows — flat dark ground keeps
  // its own faint grid so the subject sits in a world instead of floating.
  float solid = smoothstep(0.05, 0.30, h);
  float lit = (0.30 + facing*0.55 + h*0.55)*mix(0.35, 1.0, solid);
  vec3 c = neon*(line*1.45*lit + glow*0.30*lit + rim*0.75);
  c += neon*0.045*solid;                      // faint interior fill
  return c*(1.0 + uLoud*0.25) + col*0.05;
}
vec3 videoLayer(vec2 uv, vec2 suv, vec3 col){
  if(uHasTex<0.5 || uVidMix<=0.001) return col;
  if(uVidMode>=11 && uVidMode<=12){
#ifdef SURF3D
    return col;   // already projected onto the surface during shading
#else
    // No surface to project onto in 2D/synth, so map the frame along the
    // field's own iso-lines: the image follows the fractal's banding and
    // shears where the escape gradient is steep.
    float l=dot(col,vec3(0.299,0.587,0.114));
    vec2 g=vec2(dFdx(l),dFdy(l));
    vec2 t=suv+(length(g)>1e-6?normalize(g):vec2(0.0))*l*0.35;
    vec3 vv=sampleVid(t);
    if(uVidMode==11) return mix(col, vv*(0.4+l*1.6), uVidMix);
    float vl=dot(vv,vec3(0.299,0.587,0.114));
    return mix(col, col*0.4+vv*vl*2.2, uVidMix);
#endif
  }
  vec2 px = 1.0/vec2(textureSize(uTex,0));
  vec3 v;
  if(uVidMode==4){
    return mix(col, roto(suv, px, false), uVidMix);
  } else if(uVidMode==5){
    vec3 ink = roto(suv, px, true);
    return col*(1.0-uVidMix*0.35) + ink*uVidMix*1.2;
  } else if(uVidMode==6){
    float l=dot(col,vec3(0.299,0.587,0.114));
    float matte=smoothstep(0.03,0.32,l);
    vec3 vv=sampleVid(suv);
    return mix(col, mix(col*0.12, vv*(0.75+l*0.8), matte), uVidMix);
  } else if(uVidMode==7){
    float rows=floor(mix(8.0,44.0,uDetail));
    float row=floor(suv.y*rows);
    float seed=hash(vec2(row, floor(uTime*(1.5+uBass*9.0))));
    float amp=0.05+uBass*0.4;
    vec3 vv=sampleVid(suv+vec2((seed-0.5)*amp,0.0));
    float keep=step(0.22,seed);
    return mix(col, mix(col,vv,keep), uVidMix);
  } else if(uVidMode==8){
    float l=dot(col,vec3(0.33));
    vec2 g=vec2(l-0.5, dot(col,vec3(0.2,0.6,0.2))-0.5);
    float amt=0.02+uBass*0.07+uHigh*0.035;
    vec3 sp=vec3(sampleVid(suv+g*amt).r, sampleVid(suv).g, sampleVid(suv-g*amt).b);
    return mix(col, sp, uVidMix);
  } else if(uVidMode==9){
    float l=dot(col,vec3(0.33));
    float cells=mix(18.0,130.0,uDetail)*(0.45+l*1.2);
    vec2 t=floor(suv*cells)/cells + 0.5/cells;
    vec3 vv=sampleVid(t)*(0.55+pal(l*1.5)*0.85);
    return mix(col, vv, uVidMix);
  } else if(uVidMode==10){
    vec3 vv=sampleVid(suv);
    return mix(col, abs(vv-col)*1.45, uVidMix);
  } else if(uVidMode==13){
    return mix(col, asciiArt(suv, col), uVidMix);
  } else if(uVidMode==14){
    return mix(col, wireMesh(uv, suv, col), uVidMix);
  }
  if(uVidMode==0){
    v = sampleVid(suv);
  } else if(uVidMode==1){
    float a=atan(uv.y,uv.x), r=length(uv);
    float seg=floor(mix(4.0,12.0,uMorph));
    a=abs(mod(a*seg/6.28318,1.0)-0.5)*2.0;
    v = sampleVid(vec2(a, fract(r*0.8+uTime*0.02)));
  } else if(uVidMode==2){
    float l=dot(col,vec3(0.33));
    vec2 d=vec2(l-0.5, dot(col,vec3(0.2,0.5,0.3))-0.5)*0.4*(0.35+uBass);
    v = sampleVid(suv+d);
  } else {
    v = sampleVid(suv);
    float l=dot(v,vec3(0.299,0.587,0.114));
    return col*mix(1.0, l*2.3, uVidMix) + pal(l*1.6+uHigh*0.3)*l*uVidMix*0.4;
  }
  return mix(col, 1.0-(1.0-col)*(1.0-v), uVidMix);
}

void main(){
  vec2 uv=(gl_FragCoord.xy*2.0-uRes)/uRes.y;
  vec2 suv=gl_FragCoord.xy/uRes;
  // Declared ahead of the "vec3 col;" line: everything from there to the
  // videoLayer call is the per-family dispatch, which each program swaps out for
  // its own single call — anything declared inside it is gone from the others.
  bool is3 = (uMode<=5) || (uMode>=12 && uMode<=16) || (uMode>=30 && uMode<=36) || (uMode==41) || (uMode==42);
  // Text in the flat families is not drawn on top of the picture — it deforms
  // it. Pushing the sampling point along the field's gradient makes every
  // stripe, rib and filament bend around the letterforms, so the type is
  // legible as a shape in the pattern while the pattern itself stays continuous.
  vec2 tq=vec2(0.0);
  float tS=1e9;
  if(uTxtOn>0.5 && !is3){
    tq=(uv-vec2(uTxtX,uTxtY))/max(uTxtScale,0.02); tq*=rot(uTxtRot);
    tS=txtSD(tq);
    if(uTxtWarp>0.001){
      float hh=0.012;
      vec2 g=vec2(txtSD(tq+vec2(hh,0.0))-tS, txtSD(tq+vec2(0.0,hh))-tS);
      float gl2=length(g);
      // Falls off with distance from the letter edge, so the deformation is a
      // local bulge around the type and the rest of the frame is untouched.
      if(gl2>1e-6) uv += (g/gl2)*exp(-abs(tS)*5.0)*uTxtWarp*0.4*max(uTxtScale,0.02);
    }
    if(uTxtJit>0.001){
      float lj=txtLetter(tq);
      uv += (vec2(hash(vec2(lj,floor(uTime*22.0))),hash(vec2(lj+7.0,floor(uTime*22.0))))-0.5)*uTxtJit*0.05;
    }
  }
  if(uDepthOut>0.5) uv=vec2(0.0);
  vec3 col;
  if(is3) col=render3(uv);
  else if(uMode>=22 && uMode<30) col=synth(uv,uMode-22);
  else col=sc2(uv);
  col=videoLayer(uv,suv,col);
  if(uDepthOut>0.5){
    // 16 bits per axis over a +/-32 world box: high bytes in the first column
    // of the probe, low bytes in the second.
    vec3 q=clamp(gPiv/32.0*0.5+0.5,0.0,1.0)*255.0;
    fragColor=vec4(gl_FragCoord.x<1.0?floor(q)/255.0:fract(q), gHit);
    return;
  }
  // Ink pass: the letterforms take the scene's own colour down and lift a rim,
  // so the type reads as cut out of the material rather than laid over it.
  if(uTxtOn>0.5 && !is3 && tS<0.5){
    // Ink has a floor while the message is on. At a low Ink setting the flat
    // families showed nothing at all — the type is a deformation of the pattern
    // there, not a layer over it — so scenes looked like they had lost the text
    // while the 3D and canvas sets still showed it.
    float inkA=max(uTxtInk,0.28);
    float aa=0.02/max(uTxtScale,0.02);
    float m=smoothstep(aa,-aa,tS);
    float rim=smoothstep(aa*3.0,0.0,abs(tS));
    float li=txtLetter(tq);
    float onLit=1.0-smoothstep(0.0,0.9,abs(li-uTxtLit));
    vec3 ink=mix(col*0.18, pal(uTxtHue)*(0.7+onLit*1.2), 0.55);
    col=mix(col, ink, m*inkA);
    col+=pal(uTxtHue+0.1)*rim*inkA*(0.35+onLit*0.6);
  }
  col*=1.0+uLoud*0.5*uReact;
  col*=1.0-0.28*dot(uv,uv)*0.42;
  col=col/(1.0+col*0.7);
  col=pow(max(col,0.0),vec3(0.85));
  if(uFeed>0.002){
    vec2 cc=suv-0.5;
    float z=1.0+uDrift*(0.004+uBass*0.014);
    float a=uDrift*(0.0015+uHigh*0.005)*sin(uTime*0.13);
    vec2 t=(rot(a)*cc)/z+0.5;
    vec3 prev=texture(uPrev,t).rgb;
    col=max(col, prev*uFeed);
  }
  // Scene transitions. The outgoing image is the previous COMPOSITED frame, so
  // whatever warp is applied here is re-applied to its own output next frame —
  // a tiny per-frame conformal step iterated over the fade becomes a large,
  // perfectly smooth motion, and the recursion is itself self-similar. That is
  // why every mode below is a small step rather than a big displacement.
  if(uXfade>0.002){
    float xf=clamp(uXfade,0.0,0.92);
    float age=xf/0.92;              // 1 at the cut, 0 when the fade has run out
    float ar=uRes.x/uRes.y;
    vec2 q=(suv-0.5)*vec2(ar,1.0);
    int xm=int(uXfMode+0.5);
    float bl=xf;
    if(xm==1){
      // Möbius: z -> (z+t)/(1+tz). Conformal, so the outgoing set is carried off
      // the frame with its angles intact — it reads as the same fractal moving,
      // not as one picture sliding over another.
      vec2 t=vec2(0.078,0.045)*age;
      vec2 nu=q+t;
      vec2 de=vec2(1.0+(t.x*q.x-t.y*q.y), t.x*q.y+t.y*q.x);
      q=vec2(nu.x*de.x+nu.y*de.y, nu.y*de.x-nu.x*de.y)/max(dot(de,de),1e-6);
    } else if(xm==2){
      // z -> z^p. Multiplying the argument is exactly what one step of z²+c does
      // to the angle, so the outgoing frame folds onto itself the way the set it
      // depicts does.
      float r=length(q), th=atan(q.y,q.x);
      float p=1.0+0.068*age;
      r=pow(max(r,1e-5),p); th*=p;
      q=vec2(cos(th),sin(th))*r;
    } else if(xm==3){
      // No warp: the old frame erodes along its own escape-time banding, so the
      // dissolve follows the level sets of the fractal instead of a noise field.
      vec3 pc=texture(uPrev,suv).rgb;
      float lp=dot(pc,vec3(0.299,0.587,0.114));
      float band=fract(lp*7.0)*0.45+lp*0.55;
      bl=xf*smoothstep(0.94-age, 1.10-age, band+0.08);
    } else if(xm==4){
      // Droste: log-spiral zoom with rotation. Self-similar, so the outgoing set
      // appears to fall into itself while the new one arrives.
      float r=length(q), th=atan(q.y,q.x);
      float k=0.052*age;
      r*=1.0-k; th+=k*2.2;
      q=vec2(cos(th),sin(th))*r;
    } else if(xm==5){
      // A fractional step of the quadratic map itself, seeded by the scene's own
      // constants, so the old frame is pulled through the map it was drawn from.
      vec2 c=vec2(uCA*0.62-0.5, uCB*0.62-0.31);
      vec2 z2=vec2(q.x*q.x-q.y*q.y, 2.0*q.x*q.y)+c*0.25;
      q=mix(q, z2, 0.082*age);
    } else if(xm==6){
      // Wipe whose edge is bent by the outgoing frame's own brightness, so the
      // new scene arrives through the dark parts of the old one first. A straight
      // line crossing the frame reads as two pictures; this reads as one
      // dissolving into the next along its own structure.
      vec3 pc=texture(uPrev,suv).rgb;
      float lp=dot(pc,vec3(0.299,0.587,0.114));
      float x=suv.x*0.72+lp*0.28;
      bl=xf*smoothstep(1.05-age-0.24, 1.05-age+0.24, x);
    } else if(xm==7){
      // Slice: horizontal bands shear by their own amount and reseed a few times
      // a second, so the outgoing frame comes apart in strips. Band count rides
      // Detail, which keeps the transition in the same register as the scene.
      float rows=mix(8.0,34.0,uDetail);
      float bi=floor(suv.y*rows);
      float j=hash(vec2(bi,floor(uTime*9.0)))-0.5;
      q.x+=j*0.55*age;
    } else if(xm==8){
      // Zoom-through: the outgoing frame accelerates toward the viewer and
      // smears radially as it goes. Four taps along the ray are enough to read
      // as motion blur without a real blur pass.
      q*=1.0-0.16*age;
      vec3 acc=vec3(0.0);
      for(int si=0;si<4;si++){
        vec2 pv2=(q*(1.0+float(si)*0.024*age))/vec2(ar,1.0)+0.5;
        acc+=texture(uPrev,pv2).rgb;
      }
      col=mix(col, acc*0.25, clamp(xf,0.0,0.92));
      bl=0.0;
    }
    vec2 pv=q/vec2(ar,1.0)+0.5;
    col=mix(col, texture(uPrev,pv).rgb, clamp(bl,0.0,0.92));
  }
  col+=(hash(gl_FragCoord.xy+fract(uTime))-0.5)*0.016;
  fragColor=vec4(col,1.0);
}`;

const PRESETS = [
  // 3D raymarched distance estimators
  {name:'Mandelbulb',   grp:'BULB', kind:'3D', mode:0,  p:{morph:0.45,detail:0.55,speed:0.9,zoom:0.42,hue:0.08,cc:0.25}},
  {name:'Menger',       grp:'LATT', kind:'3D', mode:1,  p:{morph:0.30,detail:0.60,speed:0.8,zoom:0.50,hue:0.55,cc:0.4}},
  {name:'Kaleido IFS',  grp:'SPHR', kind:'3D', mode:2,  p:{morph:0.40,detail:0.65,speed:1.0,zoom:0.55,hue:0.72,cc:0.35}},
  {name:'Apollonian',   grp:'SPHR', kind:'3D', mode:3,  p:{morph:0.35,detail:0.70,speed:0.7,zoom:0.35,hue:0.30,cc:0.3}},
  {name:'Quat Julia',   grp:'BULB', kind:'3D', mode:4,  p:{morph:0.50,detail:0.60,speed:0.8,zoom:0.45,hue:0.86,cc:0.45}},
  {name:'Sierpinski',   grp:'LATT', kind:'3D', mode:5,  p:{morph:0.40,detail:0.60,speed:0.6,zoom:0.50,hue:0.48,cc:0.3}},
  {name:'Mandelbox',    grp:'LATT', kind:'3D', mode:12, p:{morph:0.4,detail:0.72,speed:0.7,zoom:0.4,hue:0.15,ca:0.5,cb:0.4,cc:0.35,iter:0.62}},
  {name:'Kleinian',     grp:'SPHR', kind:'3D', mode:13, p:{morph:0.4,detail:0.65,speed:0.6,zoom:0.45,hue:0.6,ca:0.5,cb:0.5,cc:0.5}},
  {name:'Juliabulb',    grp:'BULB', kind:'3D', mode:14, p:{morph:0.5,detail:0.6,speed:0.8,zoom:0.4,hue:0.8,ca:0.42,cb:0.58,cc:0.5}},
  {name:'Octa Flake',   grp:'LATT', kind:'3D', mode:15, p:{morph:0.4,detail:0.6,speed:0.7,zoom:0.5,hue:0.35,ca:0.5,cb:0.3,cc:0.3}},
  {name:'Hybrid Box',   grp:'LATT', kind:'3D', mode:16, p:{morph:0.4,detail:0.6,speed:0.6,zoom:0.42,hue:0.5,ca:0.5,cb:0.5,cc:0.4}},
  {name:'Pseudo-Klein', grp:'SPHR', kind:'3D', mode:30, p:{morph:0.4,detail:0.62,speed:0.6,zoom:0.4,hue:0.66,ca:0.5,cb:0.5,cc:0.4,iter:0.5}},
  {name:'Amazing Surf', grp:'BULB', kind:'3D', mode:31, p:{morph:0.45,detail:0.6,speed:0.5,zoom:0.42,hue:0.12,ca:0.5,cb:0.5,cc:0.5,iter:0.55}},
  {name:'Tetra Fold',   grp:'LATT', kind:'3D', mode:32, p:{morph:0.4,detail:0.6,speed:0.7,zoom:0.45,hue:0.4,ca:0.5,cb:0.5,cc:0.35,iter:0.55}},
  {name:'Menger Rot',   grp:'LATT', kind:'3D', mode:33, p:{morph:0.4,detail:0.62,speed:0.6,zoom:0.45,hue:0.78,ca:0.5,cb:0.5,cc:0.5,iter:0.5}},
  {name:'Gyroid',       grp:'BULB', kind:'3D', mode:34, p:{morph:0.5,detail:0.62,speed:0.55,zoom:0.44,hue:0.02,ca:0.45,cb:0.32,cc:0.4,iter:0.6}},
  {name:'Spudsville',   grp:'BULB', kind:'3D', mode:35, p:{morph:0.45,detail:0.62,speed:0.55,zoom:0.28,hue:0.7,ca:0.5,cb:0.5,cc:0.4,iter:0.5}},
  {name:'Quat Mandel',  grp:'BULB', kind:'3D', mode:36, p:{morph:0.4,detail:0.6,speed:0.7,zoom:0.42,hue:0.9,ca:0.5,cb:0.5,cc:0.35,iter:0.58}},
  {name:'CubeKochMosely',grp:'LATT',kind:'3D', mode:42, p:{morph:0.42,detail:0.60,speed:0.6,zoom:0.30,hue:0.45,ca:0.5,cb:0.45,cc:0.2,iter:0.5}},
  {name:'Tesseract',    grp:'LATT', kind:'3D', mode:41, p:{morph:0.45,detail:0.62,speed:0.5,zoom:0.22,hue:0.60,ca:0.5,cb:0.3,cc:0.34,iter:0.5}},
  // 2D escape-time
  {name:'Mandelbrot',   grp:'FLD', kind:'2D', mode:6,  p:{morph:0.55,detail:0.60,speed:0.6,zoom:0.62,hue:0.20,cc:0.2}},
  {name:'Julia',        grp:'FLD', kind:'2D', mode:7,  p:{morph:0.50,detail:0.50,speed:1.0,zoom:0.30,hue:0.42,cc:0.35}},
  {name:'Sine Lambda',  grp:'FLD', kind:'2D', mode:8,  p:{morph:0.5,detail:0.55,speed:0.5,zoom:0.30,hue:0.05,ca:0.5,cb:0.5,cc:0.15}},
  {name:'Mirror Tunnel',grp:'TUN', kind:'2D', mode:10, p:{morph:0.55,detail:0.50,speed:1.1,zoom:0.40,hue:0.62,cc:0.3}},
  {name:'Flow',         grp:'TUN', kind:'2D', mode:11, p:{morph:0.42,detail:0.45,speed:1.0,zoom:0.45,hue:0.90,cc:0.5}},
  {name:'Multibrot',    grp:'FLD', kind:'2D', mode:17, p:{morph:0.4,detail:0.55,speed:0.5,zoom:0.35,hue:0.25,ca:0.35,cb:0.5,cc:0.25}},
  {name:'Phoenix',      grp:'FLD', kind:'2D', mode:18, p:{morph:0.4,detail:0.55,speed:0.6,zoom:0.22,hue:0.55,ca:0.5,cb:0.5,cc:0.4}},
  {name:'Ship Julia',   grp:'FLD', kind:'2D', mode:20, p:{morph:0.5,detail:0.55,speed:0.6,zoom:0.42,hue:0.08,ca:0.5,cb:0.5,cc:0.3}},
  {name:'Celtic',       grp:'FLD', kind:'2D', mode:21, p:{morph:0.4,detail:0.55,speed:0.5,zoom:0.35,hue:0.45,ca:0.5,cb:0.5,cc:0.35}},
  {name:'Newton',       grp:'FLD', kind:'2D', mode:19, p:{morph:0.4,detail:0.55,speed:0.45,zoom:0.3,hue:0.62,ca:0.5,cb:0.5,cc:0.3,iter:0.5}},
  {name:'Lyapunov',     grp:'FLD', kind:'2D', mode:37, p:{morph:0.4,detail:0.6,speed:0.4,zoom:0.28,hue:0.3,ca:0.5,cb:0.5,cc:0.3,iter:0.6}},
  {name:'Harmony',      grp:'FLD', kind:'2D', mode:39, p:{morph:0.5,detail:0.6,speed:0.35,zoom:0.02,hue:0.55,ca:0.5,cb:0.5,cc:0.3,iter:0.55}},
  {name:'Spider',       grp:'FLD', kind:'2D', mode:38, p:{morph:0.35,detail:0.55,speed:0.5,zoom:0.32,hue:0.48,ca:0.5,cb:0.5,cc:0.35,iter:0.55}},
  // Synth / audio-reactive shaders
  {name:'Spectrum',     grp:'SYN', kind:'SYN', mode:22, p:{morph:0.3,detail:0.62,speed:0.8,zoom:0.5,hue:0.18,ca:0.55,cb:0.5,cc:0.3}},
  {name:'Tri Emitter',  grp:'SYN', kind:'SYN', mode:23, p:{morph:0.0,detail:0.55,speed:0.9,zoom:0.45,hue:0.6,ca:0.5,cb:0.5,cc:0.45}},
  {name:'Particles',    grp:'SYN', kind:'SYN', mode:24, p:{morph:0.4,detail:0.72,speed:0.9,zoom:0.5,hue:0.85,ca:0.5,cb:0.5,cc:0.4}},
  {name:'Atom',         grp:'SYN', kind:'SYN', mode:25, p:{morph:0.0,detail:0.6,speed:1.0,zoom:0.5,hue:0.42,ca:0.5,cb:0.5,cc:0.3}},
  {name:'Grid Pulse',   grp:'SYN', kind:'SYN', mode:26, p:{morph:0.35,detail:0.68,speed:0.8,zoom:0.5,hue:0.05,ca:0.6,cb:0.5,cc:0.25}},
  {name:'Ribbons',      grp:'SYN', kind:'SYN', mode:27, p:{morph:0.4,detail:0.75,speed:0.9,zoom:0.5,hue:0.7,ca:0.55,cb:0.5,cc:0.4}},
  {name:'Ink Blobs',    grp:'SYN', kind:'SYN', mode:28, p:{morph:0.45,detail:0.66,speed:0.7,zoom:0.45,hue:0.3,ca:0.55,cb:0.5,cc:0.45}},
  // Canvas-drawn scenes (modes >= 90): no shader family, no raymarch pass.
  {name:'Spectrum Mesh',grp:'SYN', kind:'2DC', mode:90, p:{morph:0.4,detail:0.6,speed:0.9,zoom:0.5,hue:0.2,ca:0.5,cb:0.5,cc:0.3}},
  {name:'Outrun',       grp:'TUN', kind:'2DC', mode:91, p:{morph:0.5,detail:0.6,speed:0.9,zoom:0.5,hue:0.55,ca:0.5,cb:0.5,cc:0.3}},
  {name:'Code Tunnel',  grp:'TUN', kind:'2DC', mode:92, p:{morph:0.5,detail:0.6,speed:0.9,zoom:0.5,hue:0.35,ca:0.5,cb:0.5,cc:0.3}},
  {name:'Half Pipe',    grp:'TUN', kind:'2DC', mode:93, p:{morph:0.5,detail:0.6,speed:0.85,zoom:0.5,hue:0.55,ca:0.5,cb:0.45,cc:0.4,iter:0.5}},
  {name:'Shorebreak',   grp:'SCN', kind:'2DC', mode:94, p:{morph:0.5,detail:0.6,speed:0.7,zoom:0.5,hue:0.5,ca:0.55,cb:0.5,cc:0.5,iter:0.5}},
  {name:'Pascal Weave',  grp:'ATTR', kind:'2DC', mode:95, p:{morph:0.5,detail:0.55,speed:0.6,zoom:0.5,hue:0.42,ca:0.5,cb:0.45,cc:0.5,iter:0.35}},
  {name:'Chaos Sequence',grp:'ATTR', kind:'2DC', mode:96, p:{morph:0.5,detail:0.55,speed:0.6,zoom:0.5,hue:0.62,ca:0.42,cb:0.5,cc:0.2,iter:0.4}},
  {name:'Lerp Polygon',  grp:'ATTR', kind:'2DC', mode:97, p:{morph:0.5,detail:0.55,speed:0.55,zoom:0.5,hue:0.18,ca:0.5,cb:0.5,cc:0.7,iter:0.35}},
  {name:'Bird',          grp:'ATTR', kind:'2DC', mode:98, p:{morph:0.42,detail:0.55,speed:0.45,zoom:0.5,hue:0.09,ca:0.5,cb:0.45,cc:0.66,iter:0.4}},
  {name:'Lorenz',        grp:'ATTR', kind:'2DC', mode:99, p:{morph:0.42,detail:0.55,speed:0.5,zoom:0.5,hue:0.55,ca:0.5,cb:0.45,cc:0.55,iter:0.35}},
  {name:'Thomas',        grp:'ATTR', kind:'2DC', mode:100,p:{morph:0.5,detail:0.55,speed:0.5,zoom:0.5,hue:0.28,ca:0.45,cb:0.45,cc:0.62,iter:0.6}},
  {name:'Hypno Swirl',   grp:'TUN', kind:'2DC', mode:101,p:{morph:0.42,detail:0.4,speed:0.45,zoom:0.5,hue:0.6,ca:0.14,cb:0.4,cc:1.0,iter:0.0}},
  {name:'Black Hole',    grp:'TUN', kind:'2DC', mode:102,p:{morph:0.72,detail:0.3,speed:0.5,zoom:0.5,hue:0.08,ca:0.5,cb:0.5,cc:0.45,iter:0.45}},
  {name:'Disco Robot',   grp:'SCN', kind:'2DC', mode:103,p:{morph:0.5,detail:0.6,speed:0.85,zoom:0.5,hue:0.5,ca:0.55,cb:0.5,cc:0.45,iter:0.5}},
  {name:'Aizawa',        grp:'ATTR', kind:'2DC', mode:104,p:{morph:0.46,detail:0.5,speed:0.5,zoom:0.5,hue:0.62,ca:0.5,cb:0.5,cc:0.72,iter:0.45}}
];

const SLIDER_DEFS = [
  {key:'morph',  label:'Morph'},
  {key:'detail', label:'Detail'},
  {key:'speed',  label:'Speed'},
  {key:'zoom',   label:'Zoom'},
  {key:'react',  label:'React'},
  {key:'hue',    label:'Hue'}
];

const SOURCES = [
  {id:'off',  tag:'—'},
  {id:'lfo',  tag:'LFO'},
  {id:'bass', tag:'BAS'},
  {id:'mid',  tag:'MID'},
  {id:'high', tag:'HGH'},
  {id:'lvl',  tag:'LVL'}
];

const VID_MODES = [
  {id:0, name:'Blend'},
  {id:1, name:'Kaleido'},
  {id:2, name:'Warp'},
  {id:3, name:'Luma'},
  {id:4, name:'Roto'},
  {id:5, name:'Ink'},
  {id:6, name:'Portal'},
  {id:7, name:'Slice'},
  {id:8, name:'Chroma'},
  {id:9, name:'Cells'},
  {id:10, name:'Diff'},
  {id:11, name:'Surface'},
  {id:12, name:'Emit'},
  {id:13, name:'Ascii'},
  {id:14, name:'Wire'}
];

const KEYMAP = ['1','2','3','4','5','6','7','8','9','q','w','e'];


const _SDBOX = FRAG.indexOf('float sdBox(');
const _E2G = FRAG.indexOf('#ifdef P_E2A');
const _E2 = _E2G >= 0 ? _E2G : FRAG.indexOf('vec3 escape2(');
// Start of the synth chunk: kfold/synF are synth-only helpers that live just
// above synth() itself, so the split has to begin there or the syn program
// loses them to the 2D chunk.
const _SYN_A = FRAG.indexOf('vec2 kfold(');
const _SYN_B = FRAG.indexOf('vec3 sampleVid(vec2 t){');
const _MAIN = FRAG.indexOf('void main(){');
const _HEAD = FRAG.slice(0, _SDBOX);
const _B3 = FRAG.slice(_SDBOX, _E2);
const _B2 = FRAG.slice(_E2, _SYN_A);
const _BS = FRAG.slice(_SYN_A, _SYN_B);
const _VID = FRAG.slice(_SYN_B, _MAIN);
const _TAILSRC = FRAG.slice(_MAIN);
const _DISPATCH = FRAG.slice(FRAG.indexOf('  vec3 col;'), FRAG.indexOf('  col=videoLayer('));
const _tail = d => _TAILSRC.replace(_DISPATCH, '  vec3 col=' + d + ';\n');

const _MAPSRC = _B3.slice(_B3.indexOf('float map(vec3 p,out float trap){'), _B3.indexOf('vec3 nrm('));
const _BRANCH = {};
{
  const re = /if\(uMode==(\d+)\)\{\n([\s\S]*?)\n  \}/g;
  let m;
  while((m = re.exec(_MAPSRC))) _BRANCH[m[1]] = m[2];
  const el = /\} else \{\n([\s\S]*?)\n  \}\n\}/.exec(_MAPSRC);
  if(el) _BRANCH['5'] = el[1];
}
// Per-mode fill-in for controls a given distance estimator ignores, injected
// before its branch. Every 3D scene ends up with a live Morph and Cst C:
//   twist - Morph shears the solid around Y, a shape change every DE responds to
//   warp  - Cst C displaces along a sine lattice, adding surface relief
const _MORPH_DEAD = ['5','12','13','14','15','16','30','32','33','34','36'];
const _CC_DEAD    = ['0','1','3','4','5','12','13','14','15','16','30','32','34','36'];
const _fillFor = m => {
  const k = String(m);
  let pre = '';
  if(_MORPH_DEAD.indexOf(k) >= 0)
    pre += '  p.xz*=rot((uMorph-0.5)*1.9*p.y);\n';
  if(_CC_DEAD.indexOf(k) >= 0)
    pre += '  p+=sin(p.zxy*mix(1.0,7.0,uCC))*(uCC-0.28)*0.13;\n';
  return pre;
};
// Text is unioned in at the map level rather than composited afterwards: that
// is what buys real occlusion (a fractal arm in front of a letter hides it) and
// correct normals, since nrm() differences this same function. trap=-1 marks a
// text hit so the shader can give it its own material.
const _mapFor = m => 'float mapG(vec3 p,out float trap){\n  trap=0.0;\n' + _fillFor(m) + (_BRANCH[String(m)] || _BRANCH['0']) + '\n}\n'
  + 'float map(vec3 p,out float trap){\n  float d=mapG(p,trap);\n  float dt=sdText3(p);\n  if(dt<d){ trap=-1.0; return dt; }\n  return d;\n}\n';

const _2D_PATH = m => m<=9 ? ['P_E2A','escape2(uv,uMode-6)']
  : m===10 ? ['P_TUN','tunnel(uv)']
  : m===11 ? ['P_FLW','flow(uv)']
  : (m>=37 && m<=39) ? ['P_E2C','escape2c(uv,uMode-37)']
           : ['P_E2B','escape2b(uv,uMode-17)'];
const _frag2D = m => {
  const [def, call] = _2D_PATH(m);
  return _HEAD + '#define '+def+' 1\n' + _B2 + _VID
    + _TAILSRC.replace(_DISPATCH, '  vec3 col='+call+';\n');
};
const FRAG_SYN = _HEAD + _BS + _VID + _tail('synth(uv,uMode-22)');
const FAM_OF = m => m>=90 ? 'can'
  : (m<=5 || (m>=12 && m<=16) || (m>=30 && m<=36) || m===41 || m===42) ? ('3d:'+m)
  : (m>=22 && m<30 ? 'syn' : '2d:'+_2D_PATH(m)[0]);
const FRAG_FOR = m => {
  const f = FAM_OF(m);
  if(f === 'syn') return FRAG_SYN;
  if(f.slice(0,3) === '2d:') return _frag2D(m);
  return _HEAD + '#define SURF3D 1\n' + _B3.replace(_MAPSRC, _mapFor(m)) + _VID + _tail('render3(uv)');
};

function ifsCenter(ang, scale, iter){
  const off = [1.0, 0.92, 1.08];
  const ii = Math.max(7, Math.min(16, Math.round((10.0 + 0.55*5.0) * iter)));
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const de = (px,py,pz) => {
    let x = px + off[0], y = py + off[1], z = pz + off[2], sum = 0;
    for(let i=0;i<ii;i++){
      x = Math.abs(x); y = Math.abs(y); z = Math.abs(z);
      let t;
      if(x < y){ t = x; x = y; y = t; }
      if(x < z){ t = x; x = z; z = t; }
      if(y < z){ t = y; y = z; z = t; }
      const nx = x*ca - z*sa, nz = x*sa + z*ca;
      x = nx; z = nz;
      x = x*scale - off[0]*(scale-1);
      y = y*scale - off[1]*(scale-1);
      z = z*scale - off[2]*(scale-1);
      sum += 1;
      if(x*x+y*y+z*z > 4096) break;
    }
    return Math.sqrt(x*x+y*y+z*z) * Math.pow(scale, -sum);
  };
  const G = 13, R = 2.2, step = (R*2)/(G-1);
  let sx=0, sy=0, sz=0, w=0;
  for(let i=0;i<G;i++) for(let j=0;j<G;j++) for(let k=0;k<G;k++){
    const x = -R + i*step, y = -R + j*step, z = -R + k*step;
    const d = de(x,y,z);
    if(!isFinite(d)) continue;
    const m = Math.exp(-Math.max(0,d)*3.2);
    if(m < 0.002) continue;
    sx += x*m; sy += y*m; sz += z*m; w += m;
  }
  return w > 0.001 ? [sx/w, sy/w, sz/w] : [0,0,0];
}

const XF_NAMES = ['Dissolve','Möbius','Power','Contour','Droste','Quadratic','Wipe','Slice','Zoom'];

const GLYPHS = new Uint8Array([0,0,0,0,0,0,0,0,0,0,0,0,4,0,0,0,0,0,0,4,2,4,4,0,0,0,0,0,0,4,0,0,4,0,0,4,10,17,0,0,0,0,4,4,4,4,0,4,0,16,16,8,4,2,1,1,1,1,2,4,8,16,16,4,4,4,4,4,4,4,8,4,2,2,2,4,8,2,4,8,8,8,4,2,16,8,4,2,4,8,16,1,2,4,8,4,2,1,8,4,4,2,4,4,8,2,4,4,8,4,4,2,12,4,4,4,4,4,12,6,4,4,4,4,4,6,1,17,8,4,2,17,16,1,1,1,1,1,15,0,17,17,10,4,4,4,0,28,8,8,8,9,6,0,31,4,4,4,4,4,0,14,4,4,4,4,14,0,0,4,21,14,21,4,0,17,17,17,17,10,4,0,17,17,10,4,10,17,0,14,17,1,1,17,14,0,17,9,5,5,9,17,0,31,1,1,15,1,1,0,17,17,17,17,17,14,0,31,16,8,4,2,31,0,30,1,14,16,17,14,0,15,17,17,15,1,1,0,14,17,17,17,17,14,0,6,9,6,25,21,9,22,17,17,17,21,27,17,0,17,17,17,31,17,17,0,17,19,21,25,17,17,0,17,27,21,17,17,17,0,14,17,1,29,17,14,0,14,17,17,21,9,22,0,14,17,17,31,17,17,0,15,17,17,15,9,17,0,15,17,17,17,17,15,0,4,30,5,14,20,15,4,31,1,1,15,1,31,0,15,17,15,17,17,15,0,10,10,31,10,31,10,10,14,17,23,21,23,17,14]);
window.VJE = {ifsCenter,VERT,FRAG_FOR,FAM_OF,POST,PAL_NAMES,XF_NAMES,PRESETS,SLIDER_DEFS,SOURCES,VID_MODES,KEYMAP,GLYPHS};
})();
