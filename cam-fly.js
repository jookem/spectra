// Camera views for the 3D families: Fly-through and Surface skim.
// The camera is steered from the scene's OWN distance estimator: each frame a
// 32x1 probe is drawn with the live program (uCamProbe=1) and read back
// asynchronously. Pixel 0 is the distance at the eye, 1-6 the axis samples for
// the gradient, 7-23 the free distance along 17 candidate headings.
(function(){
const V={
  add:(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]], sub:(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],
  sc:(a,s)=>[a[0]*s,a[1]*s,a[2]*s], dot:(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],
  cross:(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],
  len:a=>Math.hypot(a[0],a[1],a[2]),
};
V.nrm=a=>V.sc(a,1/(V.len(a)||1));
const rotAround=(v,ax,a)=>{const c=Math.cos(a),s=Math.sin(a);return V.add(V.add(V.sc(v,c),V.sc(V.cross(ax,v),s)),V.sc(ax,V.dot(ax,v)*(1-c)));};
// Must match the candidate set in render3's probe.
function candDirs(f,r,u){
  const out=[f];
  for(let j=0;j<16;j++){
    const ang=j<8?0.45:0.95, a=(j%8)*Math.PI/4;
    const ax=V.nrm(V.add(V.sc(r,-Math.sin(a)),V.sc(u,Math.cos(a))));
    out.push(V.add(V.sc(f,Math.cos(ang)),V.sc(V.cross(ax,f),Math.sin(ang))));
  }
  return out;
}
// The orbit camera's eye and basis, rebuilt from the live uniforms exactly as
// render3 builds them, so a fly or skim starts from the frame on screen.
// Uniform values as last set, recorded on the way in. gl.getUniform is a
// synchronous round trip to the GPU process; called many times a frame it
// stalled the pipeline badly enough to read as the app hanging.
function cacheUniforms(gl){
  if(gl.__uc)return gl.__uc;
  const m=gl.__uc=new WeakMap();
  const wrap=(name,fn)=>{ const o=gl[name]; if(!o)return; gl[name]=function(loc,...a){ if(loc)m.set(loc,fn(a)); return o.call(this,loc,...a); }; };
  wrap('uniform1f',a=>a[0]); wrap('uniform1i',a=>a[0]);
  wrap('uniform2f',a=>[a[0],a[1]]); wrap('uniform3f',a=>[a[0],a[1],a[2]]); wrap('uniform4f',a=>[a[0],a[1],a[2],a[3]]);
  wrap('uniform2fv',a=>Array.from(a[0]).slice(0,2)); wrap('uniform3fv',a=>Array.from(a[0]).slice(0,3)); wrap('uniform4fv',a=>Array.from(a[0]).slice(0,4));
  return m;
}
function orbitPose(gl,prog,u,md,dfar){
  const uc=gl.__uc;
  const g=(n,d)=>{ if(!u[n])return d; let v=uc&&uc.get(u[n]); if(v==null){ try{ v=gl.getUniform(prog,u[n]); }catch(e){} } return v==null?d:v; };
  const zoom=Math.min(1,Math.max(0,g('uZoom',0))), ex=zoom*9, zr=md===41?52:10;
  const dist=dfar*(1/zr+(1-1/zr)*Math.pow(2,-ex));
  const t=g('uTime',0)*g('uSpeed',1), auto=g('uCamAuto',0), spin=g('uSpin',0);
  const ay=t*0.16*auto*spin+g('uJump',0)+g('uCamYaw',0), ax=Math.sin(t*0.11)*0.55*auto*Math.abs(spin)+g('uCamPitch',0);
  const rYZ=(v,a)=>{const c=Math.cos(a),s=Math.sin(a);return [v[0],c*v[1]-s*v[2],s*v[1]+c*v[2]];};
  const rXZ=(v,a)=>{const c=Math.cos(a),s=Math.sin(a);return [c*v[0]-s*v[2],v[1],s*v[0]+c*v[2]];};
  let ro=rXZ(rYZ([0,0,-dist],ax),ay), cup=rXZ(rYZ([0,1,0],ax),ay);
  const roll=g('uCamRoll',0);
  if(Math.abs(roll)>1e-5){ const fw=V.nrm(V.sc(ro,-1)), rt=V.nrm(V.cross(cup,fw)); cup=V.nrm(V.add(V.sc(cup,Math.cos(roll)),V.sc(rt,Math.sin(roll)))); }
  const f=V.nrm(V.sc(ro,-1)), r=V.nrm(V.cross(cup,f)), uu=V.cross(f,r);
  const orb=g('uOrbit',[0,0,0]); ro=V.add(ro,[orb[0]||0,orb[1]||0,orb[2]||0]);
  const pan=g('uPan',[0,0]), res=g('uRes',[16,9]);
  let po=[(pan[0]||0)*1.6,(pan[1]||0)*1.6];
  const sp=[po[0]*1.7/Math.max(dist,0.05),po[1]*1.7/Math.max(dist,0.05)], lim=[(res[0]/Math.max(res[1],1))*0.85,0.85];
  const e=Math.hypot(sp[0]/lim[0],sp[1]/lim[1]); if(e>1)po=[po[0]/e,po[1]/e];
  ro=V.add(ro,V.add(V.sc(r,po[0]),V.sc(uu,po[1])));
  const c3=g('uCtr3',[0,0]); ro=V.add(ro,V.sc(V.add(V.sc(r,c3[0]||0),V.sc(uu,c3[1]||0)),dist));
  if([ro,f,uu].some(a=>a.some(x=>!isFinite(x))))return null;
  return {p:ro,f,up:uu};
}
const sm=x=>{x=Math.min(1,Math.max(0,x||0));return x*x*(3-2*x);};
// How far short of an aimed point travel stops: a surface hit leaves room to
// look at it, open space is flown right into.
const stopOf=(a,F)=>a.hit?Math.min(Math.max(a.L*0.12,F*0.004),F*0.08):F*0.01;
const tiltF=(f,up,t)=>t>1e-4?V.nrm(V.sub(f,V.sc(up,0.45*sm(t)))):f;
class CamFly{
  constructor(gl){
    this.gl=gl;cacheUniforms(gl);
    this.tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,32,1,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D,null);
    const fb0=gl.getParameter(gl.FRAMEBUFFER_BINDING);
    this.fb=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,this.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.tex,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb0);
    this.pbo=gl.createBuffer();gl.bindBuffer(gl.PIXEL_PACK_BUFFER,this.pbo);
    gl.bufferData(gl.PIXEL_PACK_BUFFER,32*4,gl.STREAM_READ);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);
    this.px=new Uint8Array(32*4);this.fence=null;this.key=null;this.data=null;
  }
  reset(mode,scene,dfar,seed){
    const keep=this.sp&&this.scene===scene&&this.mode!==mode;
    const cur=keep?{p:this.sp.slice(),f:this.sf.slice(),up:this.su.slice()}:null;
    // Switching Fly<->Surface carries the motion over: speed, framing scale,
    // look-down tilt and the ease-in ramp. Zeroing them stopped the camera dead,
    // popped the fog/glow scale and snapped the pitch.
    const carry=keep?{vs:this.vs||0,scale:this.scale,tilt:this.tilt||0,t:this.t||0,ns:this.ns}:null;
    this.w=keep?(this.w??1):0;this.ret=false;this.needPush=!keep&&!!seed;
    this.key=mode+':'+scene;this.scene=scene;this.mode=mode;this.t=0;this.dfar0=dfar;this.sp=null;this.dS=null;this.tilt=0;this.d0=null;this.aim=null;this.go=null;this.tapReq=null;this.pTap=null;this.insp=null;this.safe=null;this.pPos=null;
    const s=cur||seed||{p:[0,0,-dfar],f:[0,0,1],up:[0,1,0]};
    this.p=s.p.slice();this.f=V.nrm(s.f);this.up=V.nrm(s.up);
    this.scale=dfar*0.12;this.alt=dfar*0.05;this.altMax=dfar*0.05;this.altDir=-1;
    this.data=null;this.autoT=null;this.fwd=dfar*0.3;this.tf=null;this.vs=0;this.altS=null;this.ns=null;this.alt=dfar*0.2;
    if(this.fence){this.gl.deleteSync(this.fence);this.fence=null;}
    this.scale=Math.max(this.scale,V.len(this.p)*0.12);
    if(carry){ this.vs=carry.vs; this.scale=carry.scale; this.tilt=carry.tilt; this.t=Math.min(carry.t,7); this.tf=this.f.slice(); this.ns=carry.ns||null; }
  }
  basis(){
    let f=this.f;
    f=tiltF(f,this.up,this.tilt);   // look down at the ground, eased in (Surface) / out (Fly)
    const r=V.nrm(V.cross(this.up,f)),u=V.cross(f,r);return {f,r,u};
  }
  _collect(){
    const gl=this.gl;if(!this.fence)return;
    if(gl.getSyncParameter(this.fence,gl.SYNC_STATUS)!==gl.SIGNALED)return;
    gl.deleteSync(this.fence);this.fence=null;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER,this.pbo);gl.getBufferSubData(gl.PIXEL_PACK_BUFFER,0,this.px);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);
    const v=[];for(let i=0;i<25;i++){const q=(this.px[i*4]*256+this.px[i*4+1])/65535;let x=Math.pow(2,q*64-40);if(this.px[i*4+2]>127)x=-x;v.push(x);}
    const e=this.pScale*0.15;
    // A route-planning round: its readings are from a waypoint, not the eye,
    // so they lay the next ring and never steer the camera.
    if(this.pPlan){ const q=this.pPlan; this.pPlan=null; this._planStep(q,v); return; }
    if(this.skip>0){this.skip--;this.data=null;return;}
    if(this.pTap){
      // Tapped ray came back: a hit lands on the surface, a miss (nothing
      // within reach, e.g. a hole into open space) aims a long way down the ray.
      const T=this.pTap, maxL=T.sc*400, raw=v[24], t=Math.abs(raw);
      if(T.chg&&!this.chg){ this.pTap=null; }
      else if(raw<0&&(T.n||0)<8){ this.tapReq={dir:T.dir,t0:t,P:T.P,sc:T.sc,n:(T.n||0)+1,chg:T.chg}; this.pTap=null; }
      else if(T.chg){
        // Held press: the probe gives the ray's reach (surface hit, or open).
        const c=this.chg; c.P=T.P; c.hit=raw>=0&&t<maxL*0.97; c.Lmax=c.hit?t:Infinity; this.pTap=null;
        this._chgAim(); if(this.autoGo){ this.autoGo=false; this.confirm(); }
      }
      else{
        const hit=raw>=0&&t<maxL*0.97, L=hit?t:Math.min(Math.max(t,(this.dfar0||5)*0.1),(this.dfar0||5)*0.6);
        this.aim={P:V.add(T.P,V.sc(T.dir,L)),dir:T.dir,L,hit,t0:performance.now(),R:Math.min(Math.max(L*0.07,(this.dfar0||5)*0.003),(this.dfar0||5)*0.2)};
        this.pTap=null;
        if(this.autoGo){ this.autoGo=false; this.confirm(); }
      }
    }
    this.data={d:v[0],n:V.nrm([v[1]-v[2],v[3]-v[4],v[5]-v[6]]),free:v.slice(7,24),dirs:this.pDirs,e};
    // The distance at the probed eye bounds a ball of empty space around it;
    // _guard keeps the rendered eye inside that ball (Surface only).
    if(this.pPos){ this.safe={P:this.pPos,dR:v[0]*0.6,n:this.data.n,need:null}; this.pPos=null; }
    // Pixel 25 is the scene's target colour (see tgtCol in render3).
    if(this.px[25*4+3]>127)this.sceneC=[this.px[100]/255,this.px[101]/255,this.px[102]/255];
  }
  update(o){
    this._update(o);
    this._guard(Math.min(0.1,Math.max(0,o.dt||0)));
  }
  // Surface collision guard. The rendered eye (sp) trails the raw pose (p) by
  // about a second, so on a curved surface it cut the chord through the form,
  // and the clearance was measured at sp while corrections went to p, so ground
  // rising ahead was only seen once the eye was already in it. The probe's
  // distance is a sphere-tracing bound: nothing lies within it of the probed
  // point. The eye is held inside that ball less a floor, and pushed straight
  // out along the normal when it is already nearer than the floor.
  _guard(dt){
    const s=this.safe;
    // Not during the entry blend (w<1): the probe then reads at the host's
    // offset eye, ahead of the one the shader's own clearance push renders,
    // and that push already keeps the view clear.
    if(!s||this.mode!==2||!this.sp||this.ret||(this.w??1)<1)return;
    const F=this.dfar0||5;
    const fl=this.insp?F*0.0014:this.go?F*0.0008:Math.max(F*0.001,(this.lo||F*0.02)*0.35);
    const off=this.off||[0,0,0], R=s.dR-fl;
    if(R<=0){
      if(s.need==null)s.need=-R;
      const k=s.dR<fl*0.5?1:Math.min(1,dt*10), push=s.need*k;
      if(push>0){ this.sp=V.add(this.sp,V.sc(s.n,push)); this.p=V.add(this.p,V.sc(s.n,push)); s.need-=push; }
      return;
    }
    const q=V.add(this.sp,off), v=V.sub(q,s.P), L=V.len(v);
    if(L>R){
      this.sp=V.sub(V.add(s.P,V.sc(v,R/L)),off);
      // While the eye is held, the raw pose may not run on ahead into
      // geometry the probe has not seen yet.
      const lead=V.sub(this.p,this.sp), ll=V.len(lead);
      if(ll>R)this.p=V.add(this.sp,V.sc(lead,R/ll));
    }
  }
  _update(o){
    const key=o.mode+':'+o.scene;
    { const uc=o.gl&&o.gl.__uc, z=uc&&o.u&&o.u.uZoom?uc.get(o.u.uZoom):0; this.zoom=Math.min(1,Math.max(0,+z||0));
      const rp=uc&&o.u&&o.u.uRep?uc.get(o.u.uRep):0; this.rep=+rp||0; }
    if(key!==this.key)this.reset(o.mode,o.scene,o.dfar,o.gl&&o.prog?orbitPose(o.gl,o.prog,o.u,o.md,o.dfar):null);
    this._collect();
    if(this.chg&&this.chg.P&&!this.chg.done)this._chgAim();
    if(this.aim)this._plan(this.aim); else if(!this.go)this.plan=null;
    let dt=Math.min(0.1,Math.max(0,o.dt||0));
    this.ret=false; this.wasRet=false;
    // The orbit view includes render3's clearance push (eye backed off along
    // the view axis when the surface is near). Reproduce it from the first
    // probe so the flight starts from the eye actually on screen; until then
    // the blend stays at 0 and the shader's own push covers the gap.
    if(this.needPush){
      if(!this.data)return;
      const clr=o.dfar*0.14, x=Math.min(1,Math.max(0,this.data.d/(clr*1.6))), s=x*x*(3-2*x), k=1-s;
      const push=clr*1.4*k*k*(3-2*k);
      this.push=push; this.p=V.sub(this.p,V.sc(this.f,push)); this.sp=null;
      this.needPush=false; this.data=null; this.skip=this.fence?1:0; this.pose(0); return;
    }
    this.w=Math.min(1,(this.w||0)+dt/4);
    this.pose(dt);
    // While a target waits for its confirming tap the flight eases down to a
    // quarter speed (turns included), so the ring holds still enough to hit.
    const wait=!!(this.aim||this.tapReq||this.pTap);
    this.aimK=(this.aimK??1)+((wait?0.25:1)-(this.aimK??1))*(1-Math.exp(-dt*(wait?5:1.5)));
    dt*=this.aimK;
    if(!o.run||!this.data)return;
    this.t+=dt;
    // Top of the Speed range climbs steeply to 4x at 100; low and mid settings are
    // nearly unchanged.
    const s0=Math.max(0.05,o.speed??1), boost=1+3*Math.pow(Math.min(1,s0),6);
    const D=this.data,spd=s0*boost,F=o.dfar; this.boost=boost;
    // Fog and ray reach follow the open space around the camera, not just the
    // nearest wall. Tied to the wall alone they collapsed the instant the
    // camera entered a tight cell and everything beyond it went black.
    { const tg=Math.max(this.scale,Math.min(F*0.1,(D.free[0]||0)*0.25),F*0.02), cur=this.fogS??tg;
      this.fogS=cur+(tg-cur)*(1-Math.exp(-dt*(tg>cur?1.2:0.2))); }
    // Ease in over the first few seconds of a view, then every change of
    // heading, speed and up passes through two slow low-pass stages so turns
    // start and finish gently instead of snapping to each probe result.
    const ramp=(x=>x*x*(3-2*x))(Math.min(1,this.t/7));
    const ease=(rate)=>1-Math.exp(-rate*0.5*dt);
    let d=D.d;const n=D.n;
    if(d<0){this.p=V.add(this.p,V.sc(n,-d+this.scale*0.3));this.vs=0;this.data=null;return;}
    d=Math.max(d*0.6,1e-7);
    this.dS=this.dS==null?d:Math.min(d,this.dS+(d-this.dS)*ease(0.6));
    const dR=d; d=this.dS;
    if(this.d0==null)this.d0=Math.max(d,F*0.02);
    if(this.go){ this._travel(D,d,dR,n,dt,spd,F); return; }
    if(this.mode===2&&this.insp&&this.insp.dir){ this._inspect(D,d,dR,n,dt,spd,F); return; }
    // Stand-off: never closer than a fixed share of the scene's framing
    // distance, so a solid object (Mandelbulb, Quats) still fills the view
    // as a landscape rather than a wall of pixels.
    const minT=F*(o.rep?0.05:0.1);
    // Stand-off starts at the clearance the camera entered with and only
    // tightens toward the target, so entry never shoves the camera away.
    this.d0=Math.min(this.d0,Math.max(minT,d*0.98));
    const minD=Math.min(minT,this.d0*0.9);
    if(!this.tf){this.tf=this.f;this.vs=0;}
    if(this.mode===1){
      this.tilt=Math.max(0,(this.tilt||0)-dt/3);
      this.fwd=D.free[0];
      // Weighted blend of the open headings, not the single best one: the best
      // flips between neighbours from frame to frame, which steered the camera
      // left-right and up-down. A soft blend moves only as the openings do.
      let mx=1e-9;for(let i=0;i<17;i++)mx=Math.max(mx,D.free[i]);
      let best=[0,0,0];
      // Headings that run into geometry inside the stand-off get no vote at all,
      // so the blend points into the open space between forms, not at a rim.
      const sm2=(a,b,x)=>{const k=Math.min(1,Math.max(0,(x-a)/(b-a)));return k*k*(3-2*k);};
      let ws=0,fs=0;
      for(let i=0;i<17;i++){const ang=i===0?0:(i<=8?0.45:0.95);const w=Math.pow(Math.max(0,D.free[i]/mx),4)*(1-ang*0.6)*sm2(minD*1.5,minD*4,D.free[i]);best=V.add(best,V.sc(D.dirs[i],w));ws+=w;fs+=w*D.free[i];}
      best=V.len(best)>1e-6?V.nrm(best):D.dirs[0];
      // A hole only counts when it is wide enough to fly through; a narrow
      // crack is treated as wall and the camera is pushed off the surface.
      const holeOk=d>Math.max(F*0.004,minD*0.25);
      if(d<minD*2&&!(holeOk&&D.free[0]>d*6)){best=V.nrm(V.add(best,V.sc(n,1.5*(minD*2-d)/(minD*2))));}
      if(!o.rep&&V.len(this.p)>F*0.9){const back=V.nrm(V.sc(this.p,-1));best=V.nrm(V.add(best,V.sc(back,Math.min(8,(V.len(this.p)/F-0.9)*6))));}
      const r=V.nrm(V.cross(this.up,this.f)),u=V.cross(this.f,r);
      this.tf=V.nrm(V.add(this.tf,V.sc(V.sub(best,this.tf),ease(0.35))));
      this.f=V.nrm(V.add(this.f,V.sc(V.sub(this.tf,this.f),ease(0.6))));
      // An opening: the way ahead runs far past the nearest wall (a hole, a
      // gap between cubes). The stand-off then shrinks with the gap so the
      // camera can pass through, slowing as it goes, instead of treating the
      // rim as solid.
      // Only near geometry: out in open space fwd always dwarfs d, and taking
      // this path there let speed, scale and probe reach feed each other into
      // a runaway away from the object.
      const inside=o.rep||V.len(this.p)<F;
      const open=inside&&holeOk&&d<F*0.05&&this.fwd>d*6;
      // Where the camera is heading: a point down the chosen opening, sized by
      // the clearance around it, for the host's target ring.
      { const s=Math.max(minD,Math.min(F*0.4,ws>0?fs/ws:this.fwd)*0.55), R=Math.max(F*0.002,Math.min(s*0.45,d*1.6));
        const P=V.add(this.p,V.sc(this.tf,s)); this.autoT=this.autoT?{P:V.add(this.autoT.P,V.sc(V.sub(P,this.autoT.P),ease(1.2))),R:this.autoT.R+(R-this.autoT.R)*ease(1.2),open}:{P,R,open}; }
      const dd=open?Math.max(d,F*0.002):Math.max(d,minD);
      // Slow down as the way ahead closes, to a stop well short of the wall.
      const vt=Math.min(F*0.25*this.boost,spd*ramp*Math.min(this.fwd*0.15,dd*1.0)*Math.min(1,Math.max(0,(this.fwd*0.6-minD)/(minD*2))));
      this.vs+=(vt-this.vs)*ease(0.8);
      let mv=V.sc(this.f,this.vs*dt);
      const keep=open?Math.max(F*0.002,Math.min(minD,d*0.5)):Math.max(minD,this.fwd*0.05);
      // Inside the stand-off, the part of the motion that points into the
      // surface is removed, so the camera slides along it instead of entering.
      if(d<keep*1.5){const into=V.dot(mv,n);if(into<0)mv=V.sub(mv,V.sc(n,into*Math.min(1,(keep*1.5-d)/keep)));}
      this.p=V.add(this.p,mv);
      // Corrections back off along -f (a dolly), so the subject stays put in
      // frame instead of sliding sideways.
      const bk=V.nrm(V.sub(V.sc(n,0.4),this.f));
      if(dR<keep*0.35)this.p=V.add(this.p,V.sc(bk,(keep*0.35-dR)*ease(4)));
      else if(d<keep*0.8)this.p=V.add(this.p,V.sc(bk,(keep*0.8-d)*ease(0.5)));
      const wu=[0,1,0],pu=V.nrm(V.sub(wu,V.sc(this.f,V.dot(wu,this.f))));
      this.up=V.nrm(V.add(this.up,V.sc(V.sub(pu,this.up),ease(0.2))));
      this.up=V.nrm(V.sub(this.up,V.sc(this.f,V.dot(this.up,this.f))));
      this.scale+=(Math.min(F*0.3,open?Math.max(d*2,F*0.004):Math.max(dd,this.fwd*0.08,F*0.06))-this.scale)*ease(0.7);
    } else {
      this.tilt=Math.min(1,(this.tilt||0)+dt/6);
      // Surface skim: hold an altitude over the surface, glide along it, and
      // drift the altitude slowly between a high and a low pass.
      const hi=F*0.2,lo=Math.min(F*0.09,this.d0*0.9); this.lo=lo;
      if(this.altS==null){this.alt=Math.max(lo,d);this.altDir=-1;}
      if(this.alt>hi)this.alt=Math.max(hi,this.alt*Math.exp(-dt*0.12));
      if(this.alt<lo*0.5)this.alt=lo;
      if(this.alt<=hi){this.alt*=Math.exp(this.altDir*dt*0.03*spd);
      if(this.alt<lo){this.alt=lo;this.altDir=1;} if(this.alt>hi){this.alt=hi;this.altDir=-1;}}
      this.altS=this.altS==null?this.alt:this.altS+(this.alt-this.altS)*ease(0.3);
      this.ns=this.ns?V.nrm(V.add(this.ns,V.sc(V.sub(n,this.ns),ease(0.3)))):n;
      const N=this.ns;
      const step=Math.max(-d*0.15,Math.min(d*0.3,(this.altS-d)*ease(0.5)));
      this.p=V.add(this.p,V.sc(N,step));
      if(dR<lo*0.3)this.p=V.add(this.p,V.sc(n,(lo*0.3-dR)*ease(4)));
      let ft=V.sub(this.tf,V.sc(N,V.dot(this.tf,N)));
      if(V.len(ft)<0.25){ const ref=Math.abs(N[1])<0.9?[0,1,0]:[1,0,0]; ft=V.cross(N,ref); }
      ft=V.nrm(ft);
      ft=rotAround(ft,N,Math.sin(this.t*0.07)*dt*0.08);
      if(D.free[0]*0.6<this.altS*4)ft=V.nrm(V.add(ft,V.sc(N,ease(0.6)*Math.min(1,(this.altS*4-D.free[0]*0.6)/(this.altS*4)))));
      this.tf=ft;
      this.f=V.nrm(V.add(this.f,V.sc(V.sub(ft,this.f),ease(0.5))));
      this.up=V.nrm(V.add(this.up,V.sc(V.sub(N,this.up),ease(0.25))));
      this.up=V.nrm(V.sub(this.up,V.sc(this.f,V.dot(this.up,this.f))));
      // Ease off as the way ahead closes, so a rising wall is climbed rather
      // than run into while the heading is still pitching up.
      const ahead=Math.min(1,Math.max(0.2,(D.free[0]*0.6-this.altS)/(this.altS*3)));
      const vt=spd*ramp*Math.min(this.altS,d)*0.7*ahead;
      this.vs+=(vt-this.vs)*ease(0.8);
      this.p=V.add(this.p,V.sc(this.f,this.vs*dt));
      this.scale+=(Math.min(F*0.3,this.altS)-this.scale)*ease(0.7);
    }
  }
  // Inspect (Surface, after arriving on a picked fractal): circle it like a
  // satellite round the earth, looking straight down at it. The orbit plane
  // turns slowly about the line to the centre, so successive passes sweep the
  // whole form. Runs until something else is picked or the view changes.
  _inspect(D,d,dR,n,dt,spd,F){
    // A true orbit: the eye sits on a sphere round the fractal's centre, so it
    // cannot wander off. With repeats the centre is the copy's own cell centre
    // (exact); otherwise a point just inside the picked surface. Clearance from
    // the probe only ever raises the radius, through its own smoothed offset,
    // so it never fights the orbit. The look is locked on the centre from the
    // eye actually rendered (the smoothed pose), not the raw one.
    const I=this.insp, ease=(r)=>1-Math.exp(-r*0.5*dt);
    if(!I.C){
      const rp=this.rep;
      // Pivot is the piece's own centre: its repeat cell, or the object origin
      // for a single fractal. The old pivot was a point just inside the tapped
      // spot, sized by how far away the tap was, so a long tap orbited wide.
      if(rp>0){ I.C=I.P.map(x=>Math.round(x/rp)*rp); I.Rg=rp*0.5; }
      else I.C=[0,0,0];
      const r0=V.len(V.sub(this.sp||this.p,I.C));
      I.r0=Math.max(r0,I.Rg*1.25); I.rOff=0; I.T=0;
      let off=V.sub(this.sp||this.p,I.C); I.rad=V.len(off)>1e-9?V.nrm(off):V.sc(I.dir,-1);
    }
    I.T+=dt;
    const rad0=I.rad;
    if(!I.ax){ let a=V.cross(rad0,this.up); if(V.len(a)<1e-3)a=V.cross(rad0,[0,1,0]); if(V.len(a)<1e-3)a=V.cross(rad0,[1,0,0]); I.ax=V.nrm(a); }
    // Orbit plane precesses about the line to the centre: passes sweep the form.
    I.ax=V.nrm(rotAround(I.ax,rad0,dt*0.1));
    I.ax=V.nrm(V.sub(I.ax,V.sc(rad0,V.dot(I.ax,rad0))));
    const ramp=(x=>x*x*(3-2*x))(Math.min(1,I.T/3)), w=0.2*Math.max(0.2,spd)*ramp;
    I.rad=V.nrm(rotAround(rad0,I.ax,w*dt));
    // Gravity: the orbit holds a fixed low altitude over the piece's own
    // surface. dR is the distance to the nearest surface, so the radius is
    // pulled in wherever the eye has more clearance than that and eased out
    // where it has less; it can never creep outward over time. A collision
    // push-out still exists but decays in about a second, and the radius is
    // bounded to the piece so the camera stays in its pull.
    // Altitude is fixed in scene units, not tied to the piece's size, and the
    // radius can only shrink below the arrival radius: the pull is inward.
    const alt=F*0.0028;
    if(I.rMax==null){ I.r0=V.len(V.sub(this.sp||this.p,I.C)); I.rMax=I.r0*1.08; if(this.rep>0) I.rMax=Math.min(I.rMax,this.rep*0.7); I.rMin=alt*0.8; }
    I.r0+=(alt-dR)*ease(dR>alt?2.2:4.5);
    I.r0=Math.min(I.rMax, Math.max(I.rMin, I.r0));
    // Hard floor: inside 70% of the altitude the push-out is immediate, so a
    // ridge rising under the orbit lifts the camera before it can cut through.
    const clr=alt*0.7;
    if(dR<clr)I.rOff+=(clr-dR)*Math.min(1,ease(10)*2); else I.rOff*=Math.exp(-dt*1.2);
    I.rOff=Math.min(I.rOff, alt*5);
    const r=I.r0+I.rOff, np=V.add(I.C,V.sc(I.rad,r));
    this.vs=V.len(V.sub(np,this.p))/Math.max(dt,1e-4);
    this.p=np;
    const tg=V.nrm(V.cross(I.ax,I.rad));
    this.f=V.nrm(V.sub(I.C,this.p)); this.tf=this.f;
    this.up=V.nrm(V.sub(tg,V.sc(this.f,V.dot(tg,this.f))));
    if(this.sp&&this.sf){
      const lf=V.nrm(V.sub(I.C,this.sp));
      this.sf=V.nrm(V.add(this.sf,V.sc(V.sub(lf,this.sf),ease(8))));
      this.su=V.nrm(V.add(this.su,V.sc(V.sub(this.up,this.su),ease(2))));
      this.su=V.nrm(V.sub(this.su,V.sc(this.sf,V.dot(this.su,this.sf))));
    }
    // The rendered eye (sp) eases after p, and while p circles the centre the
    // eased point cuts the chord — inside the orbit sphere, which is what cut
    // through the surface. Hold it on (or outside) the sphere, and never let
    // it sit closer to the surface than the floor.
    if(this.sp){ const so=V.sub(this.sp,I.C), sl=V.len(so);
      if(sl<r && sl>1e-9) this.sp=V.add(I.C,V.sc(so,r/sl));
      if(dR<clr*0.6) this.sp=V.add(this.sp,V.sc(V.nrm(V.sub(this.sp,I.C)),clr*0.6-dR)); }
    this.tilt=Math.max(0,(this.tilt||0)-dt/1.5);
    this.scale+=(Math.min(F*0.3,Math.max(r-I.Rg,F*0.004))-this.scale)*ease(0.7);
    this.altS=null;
  }
  // Travel to a tapped point. Heads straight at the stop point (just short of
  // the surface hit, or down the ray on a miss), slowing with the clearance
  // around it so a hole on the way is passed through, not bounced off.
  _travel(D,d,dR,n,dt,spd,F){
    const g=this.go, ease=(r)=>1-Math.exp(-r*0.5*dt);
    g.t=(g.t||0)+dt;
    const to=V.sub(g.S,this.p), L=V.len(to);
    if(L<g.stop*0.25||g.t>40){ this.arr={P:g.P,hit:g.hit,R:g.R,Rg:g.Rg,n:g.n||0,t0:performance.now()};
      // Surface: the piece you landed on stays marked while you look at it.
      if(this.mode===2&&g.Rg)this.insp={P:g.P,R:g.R,Rg:g.Rg,dir:V.nrm(V.sub(g.P,g.S)),t0:performance.now()}; this.go=null; this.tf=this.f; this.altS=null; this.d0=Math.max(F*0.004,d); this.t=Math.min(this.t,4); return; }
    // Fly through the planned rings in order: aim at the next one, and count
    // it passed once it is close or already behind the camera.
    const pl=g.plan, pts=pl&&pl.pts;
    let W=g.S;
    if(pts){ g.k=g.k||1;
      while(g.k<pts.length-1){ const Q=pts[g.k], A=pts[g.k-1], dq=V.sub(Q,this.p);
        if(V.len(dq)<Math.max(pl.u*0.35,g.stop)||V.dot(dq,V.sub(Q,A))<0)g.k++; else break; }
      if(g.k<pts.length-1)W=pts[g.k]; }
    let tf=V.nrm(V.sub(W,this.p));
    // Geometry between camera and destination: bend toward the open heading
    // that still points most at the target, then straighten once it clears.
    if(D.free&&D.dirs){ const reach=Math.min(L,F*0.12), f0=D.free[0];
      if(f0<reach*0.95){ let bi=0,bs=-1; for(let i=0;i<17;i++){const c=Math.max(0,V.dot(D.dirs[i],tf));const s=Math.min(D.free[i],reach)*c*c;if(s>bs){bs=s;bi=i;}}
        const k=Math.min(1,Math.max(0,1-f0/reach))*0.85; tf=V.nrm(V.add(V.sc(tf,1-k),V.sc(D.dirs[bi],k))); } }
    this.tf=tf;
    this.f=V.nrm(V.add(this.f,V.sc(V.sub(tf,this.f),ease(1.6))));
    this.up=V.nrm(V.sub(this.up,V.sc(this.f,V.dot(this.up,this.f))));
    this.tilt=Math.max(0,(this.tilt||0)-dt/1.5);
    const face=Math.max(0,V.dot(this.f,tf)), r=(x=>x*x*(3-2*x))(Math.min(1,g.t/1.5));
    const vt=Math.min(F*0.25*(this.boost||1),spd*r*face*face*Math.min(L*0.6,Math.max(d,F*0.002)*2.2));
    this.vs+=(vt-this.vs)*ease(1.2);
    let mv=V.sc(this.f,this.vs*dt);
    const keep=Math.max(F*0.0015,Math.min(g.stop,d*0.5));
    if(dR<keep){const into=V.dot(mv,n);if(into<0)mv=V.sub(mv,V.sc(n,into));this.p=V.add(this.p,V.sc(n,(keep-dR)*ease(4)));}
    this.p=V.add(this.p,mv);
    this.scale+=(Math.min(F*0.3,Math.max(Math.min(d*2,L),F*0.004))-this.scale)*ease(0.9);
  }
  // Screen tap (CSS px within a W x H canvas). First tap aims: the ray is
  // probed and a marker shows where it lands. A second tap on the marker
  // confirms and the camera travels there; a tap elsewhere re-aims. During a
  // flight the same applies: the current trip carries on while a new point is
  // aimed, and confirming it swaps the destination.
  tap(sx,sy,W,H){
    if(!this.sp||!this.B)return 'none';
    const m=this.mark(W,H);
    if(m&&m.state==='aim'&&Math.hypot(m.x-sx,m.y-sy)<Math.max(90,Math.min(W,H)*0.12))return this.confirm();
    const ux=(2*sx-W)/H, uy=(H-2*sy)/H, B=this.B;
    const dir=V.nrm(V.add(V.add(V.sc(B.r,ux),V.sc(B.u,uy)),V.sc(B.f,B.fl)));
    this.tapReq={dir};this.aim=null;this.autoGo=false;return 'aim';
  }
  // Press and hold: on the aimed ring it confirms; anywhere else it aims there
  // and sets off as soon as the probe lands, with no second tap to chase.
  hold(sx,sy,W,H){
    if(!this.sp||!this.B)return 'none';
    const m=this.mark(W,H);
    if(m&&m.state==='aim'&&Math.hypot(m.x-sx,m.y-sy)<Math.max(90,Math.min(W,H)*0.12))return this.confirm();
    const r=this.tap(sx,sy,W,H); if(r==='aim')this.autoGo=true; return r;
  }
  // Press-and-hold range: the ring starts one step out along the pressed ray
  // and steps further each second held (under 1 s = 1 step, up to 8). A step
  // is sized to the detail around the camera; a surface on the ray caps it.
  charge(sx,sy,W,H,t0){
    if(!this.sp||!this.B)return 'none';
    const ux=(2*sx-W)/H, uy=(H-2*sy)/H, B=this.B, F=this.dfar0||5;
    const dir=V.nrm(V.add(V.add(V.sc(B.r,ux),V.sc(B.u,uy)),V.sc(B.f,B.fl)));
    this.chg={t0:t0||performance.now(),dir,u:Math.min(F*0.35,Math.max(F*0.06,(this.scale||F*0.1)*4)),P:null,Lmax:Infinity,hit:false,n:1,nT:performance.now()};
    this.tapReq={dir,chg:true};this.aim=null;this.autoGo=false;return 'charge';
  }
  chargeN(){ const c=this.chg; if(!c)return 0; if(c.done)return c.n; return Math.min(8,Math.max(1,Math.ceil((performance.now()-c.t0)/1000-0.15))); }
  _chgAim(){
    const c=this.chg, F=this.dfar0||5; let n=this.chargeN();
    if(n!==c.n){c.n=n;c.nT=performance.now();}
    const sel=this.mode===2&&c.hit, want=n*c.u, cap=c.hit&&(sel||want>=c.Lmax), L=cap?c.Lmax:want;
    if(sel)n=0;
    this.aim={P:V.add(c.P,V.sc(c.dir,L)),dir:c.dir,L,hit:cap,t0:this.aim?this.aim.t0:performance.now(),R:Math.min(Math.max(L*0.07,F*0.003),F*0.2),n,cap,chg:true};
  }
  release(){
    const c=this.chg; if(!c)return 'none';
    c.n=this.chargeN(); c.done=true;
    if(c.P){ this._chgAim(); return this.confirm(); }
    this.autoGo=true; return 'wait';
  }
  cancelCharge(){ if(!this.chg)return; this.chg=null;this.aim=null;this.autoGo=false;this.tapReq=null; }
  confirm(){
    if(!this.aim)return 'none';
    this.chg=null;
    // Surface looks down by a tilt on top of its heading, and travel relaxes
    // that tilt. Relaxing it here made the view pitch UP before turning down
    // toward a low target. Fold the tilt into the heading instead (raw and
    // smoothed pose alike) so travel starts from exactly the view on screen.
    if((this.tilt||0)>1e-4){
      const fold=(f,up)=>{ const nf=tiltF(f,up,this.tilt); return [nf, V.nrm(V.sub(up,V.sc(nf,V.dot(up,nf))))]; };
      [this.f,this.up]=fold(this.f,this.up);
      if(this.sf&&this.su)[this.sf,this.su]=fold(this.sf,this.su);
      this.tf=this.f.slice(); this.tilt=0;
    }
    {
      const a=this.aim, F=this.dfar0||5, stop=stopOf(a,F);
      // Re-targeting mid-flight keeps the speed ramp already built up, so the
      // camera banks onto the new heading instead of stalling and restarting.
      const was=this.go;
      this.insp=null;
      this.go={plan:this.plan,k:1,n:a.n||0,Rg:a.hit?Math.min(F*0.3,Math.max(F*0.01,a.L*0.3)):0,R:a.R,t1:performance.now(),P:a.P,S:V.sub(a.P,V.sc(a.dir,stop)),stop,hit:a.hit,t:was?Math.max(1.5,Math.min(was.t||0,1.5)):0,L0:Math.max(1e-6,V.len(V.sub(V.sub(a.P,V.sc(a.dir,stop)),this.sp)))};this.aim=null;this.arr=null;return 'go';
    }
  }
  // Route to an aimed point, as a chain of rings one step apart. Each step is
  // probed from the last ring looking at the destination: clear ahead, the
  // next ring goes straight on; geometry in the way, it goes down the
  // candidate heading that keeps a step's clearance while turning least from
  // the destination, so the route bends round solid forms. One step per
  // probe, on alternate frames, so the camera's own steering keeps its
  // readings.
  _plan(a){
    const F=this.dfar0||5, T=V.sub(a.P,V.sc(a.dir,stopOf(a,F))), pl=this.plan;
    if(pl&&pl.n===(a.n||0)&&V.len(V.sub(pl.T,T))<pl.u*0.05)return;
    const P0=(this.B&&this.B.P)||this.sp||this.p, L=V.len(V.sub(T,P0));
    // one ring per chosen step when held; a tap gets 3 to 10 by length
    const u=L/(this.chg&&a.n>0?a.n:Math.min(10,Math.max(3,Math.ceil(L/(F*0.04)))));
    this.plan={id:(pl?pl.id:0)+1,n:a.n||0,T,pts:[P0],u:Math.max(u,1e-6),sc:Math.max(this.scale||F*0.1,1e-6),max:24,done:false};
  }
  _planProbe(){
    const pl=this.plan; if(!pl||pl.done||this.pTap||this.tapReq)return null;
    this._plFlip=!this._plFlip; if(!this._plFlip&&this.data)return null;
    const P=pl.pts[pl.pts.length-1], to=V.sub(pl.T,P), L=V.len(to);
    return {id:pl.id,P,f:V.nrm(to),L,sc:pl.sc};
  }
  _planStep(q,v){
    const pl=this.plan; if(!pl||pl.id!==q.id||pl.done)return;
    const st=pl.u, F=this.dfar0||5, last=pl.pts.length-1;
    // A ring too near the surface is pushed straight off it and measured
    // again, so the route arcs round a form instead of skimming it.
    const keep=Math.min(st*0.35,F*0.03), d=v[0];
    if(last>0&&d<keep&&(pl.nudge||0)<3){ pl.nudge=(pl.nudge||0)+1;
      const n=V.nrm([v[1]-v[2],v[3]-v[4],v[5]-v[6]]); pl.pts[last]=V.add(q.P,V.sc(n,keep-d)); return; }
    pl.nudge=0;
    if(q.L<=st||pl.pts.length>=pl.max){ pl.pts.push(pl.T); pl.done=true; return; }
    // Pixel 24 is the reach toward the destination (negative: nothing hit).
    // Clear for the next two steps: one step straight on.
    if(v[24]<0||Math.abs(v[24])>=Math.min(q.L,st*2)*0.98){ pl.pts.push(V.add(q.P,V.sc(q.f,st))); return; }
    // Blocked: the candidate heading that keeps a step's clearance while
    // turning least from the destination; boxed in, the most open one.
    let bi=-1,bs=0;
    for(let i=0;i<17;i++){ const c=V.dot(q.dirs[i],q.f), fr=Math.abs(v[7+i]);
      if(c<0.05||fr<st*0.5)continue; const sc=Math.min(fr,st*2)*c*c; if(sc>bs){bs=sc;bi=i;} }
    if(bi<0)for(let i=0;i<17;i++){ const fr=Math.abs(v[7+i]); if(fr>bs){bs=fr;bi=i;} }
    const len=bi<0?0:Math.min(st,Math.abs(v[7+bi])*0.6);
    if(len<st*0.15){ pl.pts.push(pl.T); pl.done=true; return; }
    pl.pts.push(V.add(q.P,V.sc(q.dirs[bi],len)));
  }
  cancelTap(){this.plan=null;this.insp=null;this.chg=null;this.autoT=null;this.autoGo=false;this.aim=null;this.go=null;this.tapReq=null;this.arr=null;}
  // Marker for the host overlay: screen position of the aimed or travelled-to point.
  mark(W,H){
    if(!this.go&&!this.aim&&this.arr&&this.B){
      // Arrived: keep the marker on the point for the closing flash and fade.
      const age=(performance.now()-this.arr.t0)/900; if(age>=1){this.arr=null;return null;}
      const B=this.B, v=V.sub(this.arr.P,B.P), z=V.dot(v,B.f);
      const x=z>1e-6?V.dot(v,B.r)/z*B.fl:0, y=z>1e-6?V.dot(v,B.u)/z*B.fl:0;
      return {x:(x*H+W)/2, y:(H-y*H)/2, state:'arr', hit:this.arr.hit, prog:1, age, n:this.arr.n||0};
    }
    if(this.aim&&!this.aim.chg&&performance.now()-this.aim.t0>5000)this.aim=null;
    const a=this.aim||this.go;
    if(!a&&this.mode===1&&this.autoT&&this.B&&this.data){
      const B=this.B, v=V.sub(this.autoT.P,B.P), z=V.dot(v,B.f); if(z<=1e-6)return null;
      const x=V.dot(v,B.r)/z*B.fl, y=V.dot(v,B.u)/z*B.fl;
      return {x:(x*H+W)/2, y:(H-y*H)/2, state:'auto', hit:!this.autoT.open, rpx:this.autoT.R/z*B.fl*H/2};
    }
    if(!a||!this.B)return null;
    const B=this.B, v=V.sub(a.P,B.P), z=V.dot(v,B.f); if(z<=1e-6)return null;
    const x=V.dot(v,B.r)/z*B.fl, y=V.dot(v,B.u)/z*B.fl;
    const prog=(!this.aim&&this.go)?Math.min(1,Math.max(0,1-V.len(V.sub(this.go.S,B.P))/this.go.L0)):0;
    // The rings still ahead on the route (the last one is the marker itself).
    const pl=this.aim?this.plan:this.go&&this.go.plan, path=[];
    if(pl)for(let i=this.aim?1:(this.go.k||1);i<pl.pts.length-1;i++){ const q=V.sub(pl.pts[i],B.P), qz=V.dot(q,B.f); if(qz<=1e-6)continue;
      path.push({x:(V.dot(q,B.r)/qz*B.fl*H+W)/2, y:(H-V.dot(q,B.u)/qz*B.fl*H)/2, r:pl.u*0.22/qz*B.fl*H/2}); }
    return {path, x:(x*H+W)/2, y:(H-y*H)/2, state:this.aim?'aim':'go', hit:a.hit, prog, goAge:this.go?(performance.now()-(this.go.t1||0))/1000:99, age:this.aim&&!this.aim.chg?(performance.now()-this.aim.t0)/5000:0, chg:!!(this.aim&&this.aim.chg), n:(this.aim?this.aim.n:this.go&&this.go.n)||0, cap:!!(this.aim&&this.aim.cap), stepAge:this.chg?(performance.now()-this.chg.nT)/1000:9};
  }
  // Leaving Fly/Surface for Orbit: glide from the current pose to the orbit
  // eye while the blend falls back to 0. Returns false once it has arrived.
  back(o){
    if(!this.sp)return false;
    const dt=Math.min(0.1,Math.max(0,o.dt||0));
    const tgt=orbitPose(o.gl,o.prog,o.u,o.md,o.dfar); if(!tgt){this.w=0;return false;}
    this.ret=true;
    this.w=Math.max(0,(this.w||0)-dt/3);
    // Target is the eye Orbit actually renders: its pose backed off by the
    // clearance push measured at entry. apply() hands the shader's own push
    // back as w falls, so the rendered eye moves one way only.
    const tp=V.sub(tgt.p,V.sc(tgt.f,this.push||0));
    // The pull toward Orbit starts from zero and builds over ~1.2 s while the
    // flight's own forward speed coasts out, so leaving Fly/Surface has no
    // kick at the start. It never jumps the rest of the way at the end either:
    // it just keeps easing until the gap is invisible.
    if(!this.wasRet)this.rt=0; this.rt=(this.rt||0)+dt;
    const s=1-Math.exp(-2.2*(0.15+0.85*sm(this.rt/1.2))*dt);
    this.vs=(this.vs||0)*Math.exp(-dt*1.8);
    this.sp=V.add(this.sp,V.sc(this.sf,this.vs*dt*(1-sm(this.rt/1.2))));
    this.sp=V.add(this.sp,V.sc(V.sub(tp,this.sp),s));
    this.sf=V.nrm(V.add(this.sf,V.sc(V.sub(tgt.f,this.sf),s)));
    this.su=V.nrm(V.add(this.su,V.sc(V.sub(tgt.up,this.su),s)));
    this.tilt=Math.max(0,(this.tilt||0)-dt/2);
    this.p=this.sp.slice();this.f=this.sf.slice();this.up=this.su.slice();
    this.wasRet=true;
    if(this.w<=0&&V.len(V.sub(tp,this.sp))<o.dfar*0.0015&&V.dot(this.sf,tgt.f)>0.99999&&V.dot(this.su,tgt.up)>0.9999){this.key=null;this.sp=null;this.wasRet=false;return false;}
    if(this.w<=0)this.w=0.0001;
    return true;
  }
  pose(dt){
    const bad=a=>!a||a.some(x=>!isFinite(x));
    if(bad(this.p)||bad(this.f)||bad(this.up)||V.len(this.f)<0.5||V.len(this.up)<0.5){ this.reset(this.mode,this.key.split(':').slice(1).join(':'),this.dfar0||5); return; }
    const k=1-Math.exp(-1.1*Math.max(0,dt||0));
    if(!this.sp){this.sp=this.p.slice();this.sf=this.f.slice();this.su=this.up.slice();return;}
    this.sp=V.add(this.sp,V.sc(V.sub(this.p,this.sp),k));
    this.sf=V.nrm(V.add(this.sf,V.sc(V.sub(this.f,this.sf),k)));
    this.su=V.nrm(V.add(this.su,V.sc(V.sub(this.up,this.su),k)));
  }
  apply(gl,u){
    const F0=this.sf||this.f,U0=this.su||this.up;
    let P=this.sp||this.p;
    // The shader adds its clearance push x(1-w); offset by the same amount so
    // the eye on screen stays where the host put it.
    const we=sm(this.w??1);
    if(this.push)P=V.add(P,V.sc(F0,this.push*(1-we)));
    const f=tiltF(F0,U0,this.tilt);
    const r=V.nrm(V.cross(U0,f)),uu=V.cross(f,r);
    const B={f,r,u:uu,P,fl:1.7*Math.pow(2,(this.zoom||0)*2.6*we)};
    this.B=B; this.off=V.sub(P,this.sp||this.p);
    if(B.r.some(x=>!isFinite(x))||V.len(B.r)<0.5)return;
    gl.uniform1f(u.uCamMode,1+Math.max(0.0001,we));
    gl.uniform3f(u.uCamPos,P[0],P[1],P[2]);
    gl.uniform3f(u.uCamF,B.f[0],B.f[1],B.f[2]);gl.uniform3f(u.uCamR,B.r[0],B.r[1],B.r[2]);gl.uniform3f(u.uCamU,B.u[0],B.u[1],B.u[2]);
    gl.uniform1f(u.uCamScale,Math.max(this.scale,1e-6));
    if(u.uCamFog)gl.uniform1f(u.uCamFog,this.fogS||0);
    this.applyTgt(gl,u,P);
  }
  // Target highlight in the scene: x,y,z the point, w its radius; K = strength,
  // kind (0 surface point, 1 open space), sweep (0..1 confirmation pulse).
  applyTgt(gl,u,P){
    if(!u.uTgt)return;
    const now=performance.now(); let T=null,k=0,sw=1;
    if(this.aim){ const a=(now-this.aim.t0)/1000; T=this.aim; k=Math.min(1,a/0.25)*(1-Math.max(0,a/5-0.7)/0.3); sw=Math.min(1,a/0.9); }
    else if(this.go){ const g=this.go, pr=Math.min(1,Math.max(0,1-V.len(V.sub(g.S,P))/g.L0)), a=(now-(g.t1||now))/1000;
      T=g; k=0.6*(1-pr*0.6)+Math.max(0,0.5-a)*0.8; sw=Math.min(1,a/0.6); }
    else if(this.arr){ const a=(now-this.arr.t0)/900; if(a<1){ T=this.arr; k=1.2*Math.max(0,1-a*1.3); sw=a; } }
    let rg=0;
    if(this.mode===2&&T){ const F=this.dfar0||5; rg=T.Rg!=null?T.Rg:(T.hit&&T.L?Math.min(F*0.3,Math.max(F*0.01,T.L*0.3)):0); }
    if(!T||!T.R||k<=0.001){ gl.uniform4f(u.uTgt,0,0,0,0); return; }
    const c=this.tgtC||[0.78,1,0.18];
    gl.uniform4f(u.uTgt,T.P[0],T.P[1],T.P[2],T.R);
    gl.uniform3f(u.uTgtK,Math.max(0,k),this.mode===2?-rg:1,sw);
    if(u.uTgtC)gl.uniform3f(u.uTgtC,c[0],c[1],c[2]);
  }
  // Draws the probe with the live program; call after apply().
  probe(gl,prog,u){
    if(this.fence||!u.uCamProbe)return;
    const fb=gl.getParameter(gl.FRAMEBUFFER_BINDING),vp=gl.getParameter(gl.VIEWPORT);
    const res=u.uRes?gl.getUniform(prog,u.uRes):null;
    const pl=this._planProbe();
    if(pl){
      // Planning round: from the last ring, headings around the destination,
      // the reach ray (pixel 24) straight at it.
      const f=pl.f, up=Math.abs(V.dot(this.up,f))<0.95?this.up:[1,0,0], r=V.nrm(V.cross(up,f)), uu=V.cross(f,r);
      gl.uniform3f(u.uCamF,f[0],f[1],f[2]);gl.uniform3f(u.uCamR,r[0],r[1],r[2]);gl.uniform3f(u.uCamU,uu[0],uu[1],uu[2]);
      pl.dirs=candDirs(f,r,uu); this.pPlan=pl;
      if(u.uCamTap)gl.uniform3f(u.uCamTap,f[0],f[1],f[2]);
      gl.uniform3f(u.uCamPos,pl.P[0],pl.P[1],pl.P[2]); gl.uniform1f(u.uCamScale,pl.sc);
      this._probeDraw(gl,u,fb,vp,res); return;
    }
    // the probe's headings are around the steering direction, not the
    // looked-down view of Surface mode
    const f=this.f,r=V.nrm(V.cross(this.up,f)),uu=V.cross(f,r);
    gl.uniform3f(u.uCamF,f[0],f[1],f[2]);gl.uniform3f(u.uCamR,r[0],r[1],r[2]);gl.uniform3f(u.uCamU,uu[0],uu[1],uu[2]);
    this.pDirs=candDirs(f,r,uu);this.pScale=this.scale;
    if(u.uCamTap){
      const q=this.tapReq, k=q?1+(q.t0||0):1;
      gl.uniform3f(u.uCamTap,q?q.dir[0]*k:0,q?q.dir[1]*k:0,q?q.dir[2]*k:1);
      if(q){
        // Chained rounds march from the original eye at the original scale.
        const P0=q.P||(this.B&&this.B.P)||this.sp||this.p, sc=q.sc||Math.max(this.scale,1e-6);
        this.pTap={dir:q.dir,P:P0,sc,n:q.n||0,chg:q.chg}; this.tapReq=null;
        if(q.P){ this._tapPos=P0; this._tapSc=sc; }
      }
    }
    // Pixel 0 of a chained tap round is measured at the tap origin, not the eye.
    this.pPos=this._tapPos?null:((this.B&&this.B.P)||this.sp||this.p).slice();
    if(this._tapPos){ gl.uniform3f(u.uCamPos,this._tapPos[0],this._tapPos[1],this._tapPos[2]); gl.uniform1f(u.uCamScale,this._tapSc); this._tapPos=null; }
    this._probeDraw(gl,u,fb,vp,res);
  }
  _probeDraw(gl,u,fb,vp,res){
    gl.uniform1f(u.uCamProbe,1);if(u.uRes)gl.uniform2f(u.uRes,32,1);
    gl.bindFramebuffer(gl.FRAMEBUFFER,this.fb);gl.viewport(0,0,32,1);
    gl.drawArrays(gl.TRIANGLES,0,3);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER,this.pbo);gl.readPixels(0,0,32,1,gl.RGBA,gl.UNSIGNED_BYTE,0);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);
    this.fence=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);
    gl.uniform1f(u.uCamProbe,0);if(res)gl.uniform2f(u.uRes,res[0],res[1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.viewport(vp[0],vp[1],vp[2],vp[3]);
    this.apply(gl,u);
  }
}
window.CamFly=CamFly;window.camFlyCacheUniforms=cacheUniforms;
})();
