// True endless zoom for every Fields scene.
//
// A fractal drawn in a map's own plane is EXACTLY self-similar about each of
// its repelling periodic points: near such a point P of period q with
// multiplier L, the map's q-th iterate is linearly conjugate to z -> L z
// (Koenigs), so the picture at scale r and the picture at scale r/|L| are the
// same picture, turned by arg(L), with every escape count larger by q. Zoom by
// L^k and the frame comes back to itself.
//
// So each scene's zoom is: open on the whole figure, glide straight in to a
// repelling point chosen near the middle of the figure (it stays put on
// screen; nothing pans), and from uZBase down run the similarity as a loop.
// The shader subtracts the counts the descent adds (uZCnt per octave), so the
// colors repeat as well as the shapes.
//
// Points are found by Newton on f^q(z) = z from a grid of seeds over the home
// frame, classified by the real Jacobian of f^q (conformal, or anti-conformal
// on the folded maps, where f^2q is used), and tracked frame to frame by a few
// Newton steps from the last one, so a modulated constant moves the point
// continuously instead of re-searching.
(function(){
const mul=(a,b)=>[a[0]*b[0]-a[1]*b[1], a[0]*b[1]+a[1]*b[0]];
const add=(a,b)=>[a[0]+b[0], a[1]+b[1]];
const sub=(a,b)=>[a[0]-b[0], a[1]-b[1]];
const div=(a,b)=>{const d=b[0]*b[0]+b[1]*b[1]||1e-300; return [(a[0]*b[0]+a[1]*b[1])/d, (a[1]*b[0]-a[0]*b[1])/d];};
const abs2=a=>Math.hypot(a[0],a[1]);
const csqrt=a=>{const r=abs2(a); return [Math.sqrt(Math.max(r+a[0],0)*0.5), (a[1]<0?-1:1)*Math.sqrt(Math.max(r-a[0],0)*0.5)];};
const v=(e,k,d)=>e&&e[k]!=null?e[k]:d;
const mix=(a,b,t)=>a+(b-a)*t;
const TAU=Math.PI*2;

// Home frames: [center x, center y, opening octave], in each program's own
// plane units (the escape2 path frames at 2.6*2^-ex, escape2b/c at 2.8*2^-ex).
// DEPTH: octaves below home where the loop starts — deep enough that the
// linearization error is under a pixel, shallow enough for float32.
const SCN={
  7:{home:[0,0,0.75], depth:9.5},
  8:{home:[0,0,1.3], depth:7.0},
  17:{home:[0.55,0,0.35], depth:9.0},
  18:{home:[0,0,0.9], depth:9.0},
  19:{home:[0,0,1.5], depth:4.0},
  20:{home:[0,0,1.1], depth:9.0},
  21:{home:[0,0,0.65], depth:9.0},
  37:{home:[0.5,0,2.4], depth:8.5},
  38:{home:[0,0,1.0], depth:9.0},
  39:{home:[0,0,1.0], depth:9.0},
};

// Each map in its plane coordinates, mirroring the shader exactly.
function mapFor(mode, e, h){
  const ca=v(e,'ca',0.5), cb=v(e,'cb',0.5), mo=v(e,'morph',0.45);
  if(mode===7){
    const c=[-0.4+(ca-0.5)*1.1+(mo-0.5)*0.25, 0.6+(cb-0.5)*1.1];
    return z=>add(mul(z,z),c);
  }
  if(mode===17){
    const c=[1.9+(ca-0.5)*0.8, 0.3+(cb-0.5)*0.6], sh=mix(0.7,1.3,mo);
    return z=>{const q=div(add(mul(z,z),[c[0]-sh,c[1]]), [2*z[0]+c[0]-2*sh+1e-9, 2*z[1]+c[1]]); return mul(q,q);};
  }
  if(mode===20){
    const ca3=(ca*0.5-0.5)*1.5, cb3=(cb*0.5-0.5)*1.5, c=[-1.12+ca3*0.17, 0.035+cb3*0.26];
    return z=>{const a=[Math.abs(z[0]),Math.abs(z[1])]; return add(mul(a,a),c);};
  }
  if(mode===21){
    const c=[-1.25+(ca-0.5)*0.4+(mo-0.5)*0.15, 0.05+(cb-0.5)*0.4+(mo-0.5)*0.15];
    return z=>{const q=mul(z,z); return [Math.abs(q[0])+c[0], q[1]+c[1]];};
  }
  if(mode===37){
    const r=[3.2+(ca-0.5)*0.8+(mo-0.5)*0.3, (cb-0.5)*0.8];
    return z=>mul(r, mul(z, [1-z[0], -z[1]]));
  }
  if(mode===39){
    const c=harmC(e,h);
    return z=>{const q=mul(z,z); return add(mul(q,q),c);};
  }
  return null;
}
// Harmony's constant, as the shader builds it from the tonal centroid.
function harmC(e,h){
  const ca=v(e,'ca',0.5), cb=v(e,'cb',0.5);
  const tx=h?h.tx||0:0, ty=h?h.ty||0:0, chg=h?h.chg||0:0;
  const th=Math.atan2(ty,tx)+Math.PI/2+(cb-0.5)*2;
  const cl=Math.min(1,Math.max(0,Math.hypot(tx,ty)*2.2));
  const r=mix(0.455,0.476,cl)+(ca-0.5)*0.02+chg*0.006;
  return [r*Math.cos(th), r*Math.sin(th)];
}

function iter(f,z,q){ for(let i=0;i<q;i++){ z=f(z); if(!isFinite(z[0])||!isFinite(z[1])||abs2(z)>1e6) return null; } return z; }
function jac(f,z,q){
  const s=1e-6*Math.max(1,abs2(z));
  const a=iter(f,[z[0]+s,z[1]],q), b=iter(f,[z[0]-s,z[1]],q), c=iter(f,[z[0],z[1]+s],q), d=iter(f,[z[0],z[1]-s],q);
  if(!a||!b||!c||!d) return null;
  return [(a[0]-b[0])/(2*s), (c[0]-d[0])/(2*s), (a[1]-b[1])/(2*s), (c[1]-d[1])/(2*s)];   // [dx/dx, dx/dy, dy/dx, dy/dy]
}
function newton(f,z,q,n){
  for(let k=0;k<n;k++){
    const w=iter(f,z,q); if(!w) return null;
    const g=[w[0]-z[0], w[1]-z[1]];
    if(Math.hypot(g[0],g[1])<1e-13) return z;
    const J=jac(f,z,q); if(!J) return null;
    const a=J[0]-1, b=J[1], c=J[2], d=J[3]-1, det=a*d-b*c;
    if(Math.abs(det)<1e-14) return null;
    const dx=( d*g[0]-b*g[1])/det, dy=(-c*g[0]+a*g[1])/det;
    let st=1; const m=Math.hypot(dx,dy); if(m>0.3) st=0.3/m;
    z=[z[0]-dx*st, z[1]-dy*st];
  }
  const w=iter(f,z,q);
  return w && Math.hypot(w[0]-z[0],w[1]-z[1])<1e-9 ? z : null;
}
// Classify a periodic point: complex multiplier and steps per period, or null
// when the map is not conformal there (a fold line too close).
function classify(f,z,q){
  const J=jac(f,z,q); if(!J) return null;
  const n=Math.hypot(J[0],J[1],J[2],J[3])+1e-12;
  if((Math.abs(J[0]-J[3])+Math.abs(J[1]+J[2]))/n < 2e-3) return {L:[J[0],J[2]], q};
  if((Math.abs(J[0]+J[3])+Math.abs(J[1]-J[2]))/n < 2e-3){
    // anti-conformal: twice round is conformal
    const J2=jac(f,z,2*q); if(!J2) return null;
    const n2=Math.hypot(J2[0],J2[1],J2[2],J2[3])+1e-12;
    if((Math.abs(J2[0]-J2[3])+Math.abs(J2[1]+J2[2]))/n2 > 2e-3) return null;
    return {L:[J2[0],J2[2]], q:2*q};
  }
  return null;
}
// The Jacobian must hold steady a little way off the point, or the orbit runs
// along a fold and the similarity breaks a few octaves up.
function smooth(f,z,q,L){
  const r=1e-3;
  for(let a=0;a<4;a++){
    const J=jac(f,[z[0]+r*Math.cos(a*1.57+0.3), z[1]+r*Math.sin(a*1.57+0.3)], q);
    if(!J) return false;
    if(Math.hypot(J[0]-L[0], J[2]-L[1]) > 0.05*abs2(L)) return false;
  }
  return true;
}
function score(cand, home){
  const half=2.7*Math.pow(2,-home[2]);
  const d=Math.hypot(cand.z[0]-home[0], cand.z[1]-home[1])/half;
  const m=Math.log2(abs2(cand.L));
  return d + 0.12*cand.q + (m<0.35 ? 2 : 0) + (m>3.5 ? (m-3.5)*0.5 : 0);
}
// On the folded maps a point can be repelling and still sit inside the filled
// set (the fold carries its whole neighborhood back in), where the loop would
// be a flat interior. The anchor has to be on the escape boundary: some of a
// small ring round it escapes, at two depths.
function onEdge(f, z, half){
  for(const r of [half/32, half/256]){
    let esc=0; const N=48;
    for(let k=0;k<N;k++){
      const t=(k+0.5)/N*TAU; let w=[z[0]+r*Math.cos(t), z[1]+r*Math.sin(t)], n=0;
      for(;n<220;n++){ w=f(w); if(!(w[0]*w[0]+w[1]*w[1]<256)) break; }
      if(n<220) esc++;
    }
    if(esc<2) return false;   // a dust set may escape all round; only a flat interior fails
  }
  return true;
}
function search(f, home, prefQ){
  const half=2.7*Math.pow(2,-home[2]);
  const cands=[];
  const seen=[];
  for(let q=1;q<=3;q++){
    for(let gy=0;gy<9;gy++) for(let gx=0;gx<13;gx++){
      const s=[home[0]+(gx/12-0.5)*2.2*half, home[1]+(gy/8-0.5)*1.6*half];
      const z=newton(f,s,q,40); if(!z) continue;
      if(seen.some(o=>Math.hypot(o[0]-z[0],o[1]-z[1])<1e-6)) continue;
      seen.push(z);
      const c=classify(f,z,q); if(!c) continue;
      if(abs2(c.L) < 1.15) continue;
      if(!smooth(f,z,c.q,c.L)) continue;
      const cand={z, L:c.L, q:c.q, base:q};
      cand.sc=score(cand, home);
      cands.push(cand);
    }
  }
  cands.sort((x,y)=>x.sc-y.sc);
  for(const c of cands) if(onEdge(f, c.z, half)) return c;
  return null;
}

// Choose k periods per sweep: near three octaves, with the smallest leftover turn.
function sweep(L, q){
  const base=Math.log2(Math.max(abs2(L),1.0001)), arg=Math.atan2(L[1],L[0]);
  const net=n=>n*arg-TAU*Math.round(n*arg/TAU);
  let k=0, bs=Infinity;
  for(let n=1;n<=16;n++){
    const oct=n*base; if(oct<1.5||oct>4.2) continue;
    const s=Math.abs(net(n))+Math.abs(oct-2.9)*0.35;
    if(s<bs){ bs=s; k=n; }
  }
  if(!k) k=Math.max(1,Math.min(16,Math.round(2.9/Math.max(base,0.08))));
  return {rat:k*base, rot:net(k), cnt:q/base};
}
function pack(mode, anc, L, q, aux){
  const S=SCN[mode], sw=sweep(L,q);
  return {anc, rat:sw.rat, rot:sw.rot, cnt:sw.cnt, home:S.home, base:S.home[2]+S.depth, aux:aux||[0,0,0,0], L, q};
}

// Families whose point is known in closed form.
function closed(mode, e){
  const ca=v(e,'ca',0.5), cb=v(e,'cb',0.5), mo=v(e,'morph',0.45);
  if(mode===8){
    // z <- c sin z fixes the origin with multiplier exactly c.
    return pack(8, [0,0], [1.5+(ca-0.5)*1.3, (cb-0.5)*1.1], 1);
  }
  if(mode===19){
    // Newton: the origin is a double pole, a preimage of infinity, and
    // infinity is a repelling fixed point with multiplier 1/(1-h/3). Near the
    // origin that reads as a similarity of ratio sqrt(1/(1-h/3)), no turn.
    const hh=0.75+ca*0.5, s=Math.sqrt(1/(1-hh/3));
    return pack(19, [0,0], [s,0], 1);
  }
  if(mode===38){
    // Spider: (z,c) -> (z^2+c, c/2+z^2+c) fixes the origin with eigenvalues
    // 0 and 3/2. The slice c = s*z crosses the stable direction (the z axis),
    // so the picture on it is self-similar by 3/2 about the origin.
    return pack(38, [0,0], [1.5,0], 1);
  }
  if(mode===18){
    // Phoenix: (z,y) -> (z^2 + a + b y, z). A saddle fixed point (z*,z*); the
    // slice y0 = z* runs through it across the stable direction, so the
    // picture on that slice is self-similar by the unstable eigenvalue.
    const caa=(ca-0.5)*1.5, cbb=(cb-0.5)*1.5;
    const a=0.5667+caa*0.35, b=(-0.5+cbb*0.35)*mix(0.15,1.7,mo);
    const disc=csqrt([(b-1)*(b-1)-4*a, 0]);
    const roots=[[(1-b+disc[0])/2, disc[1]/2], [(1-b-disc[0])/2, -disc[1]/2]];
    let best=null, bs=-1;
    for(const z of roots){
      const w=csqrt(add(mul(z,z),[b,0]));
      const l1=add(z,w), l2=sub(z,w);
      const [u,s]=abs2(l1)>=abs2(l2)?[l1,l2]:[l2,l1];
      const ok=abs2(u)>1.05 && abs2(s)<0.98;
      const sc=(ok?10:0)+abs2(u)-Math.hypot(z[0],z[1])*0.5;
      if(sc>bs){ bs=sc; best={z,u}; }
    }
    return pack(18, best.z, best.u, 1, [best.z[0], best.z[1], 0, 0]);
  }
  return null;
}

const track={};
function params(mode, e, h){
  if(!SCN[mode]) return null;
  const cl=closed(mode,e); if(cl) return cl;
  const f=mapFor(mode,e,h); if(!f) return null;
  const S=SCN[mode];
  let T=track[mode];
  if(T){
    const z=newton(f,T.z,T.base,6);
    if(z && Math.hypot(z[0]-T.z[0],z[1]-T.z[1]) < 0.05*2.7*Math.pow(2,-S.home[2])){
      const c=classify(f,z,T.base);
      if(c && abs2(c.L)>1.15){ T.z=z; T.L=c.L; T.q=c.q; return pack(mode,z,c.L,c.q); }
    }
  }
  const now=Date.now();
  if(T && now-(T.t||0)<250) return pack(mode,T.z,T.L,T.q);
  const b=search(f,S.home);
  if(!b){ if(T) return pack(mode,T.z,T.L,T.q); return null; }
  track[mode]={z:b.z, L:b.L, q:b.q, base:b.base, t:now};
  return pack(mode,b.z,b.L,b.q);
}

window.FieldLoops={params, mapFor, SCN, _search:search, _closed:closed};
})();
