// Deep zoom for the Mandelbrot field: perturbation against one high-precision
// reference orbit. The center lives in BigInt fixed point (192 fractional bits),
// the GPU only ever sees small float32 offsets from the reference, so the zoom
// runs to ~1e-30 instead of stopping at float precision (~1e-5).
// Owns: the reference orbit texture (unit 6), a tiny probe program that reads
// back escape counts (iteration budget and color range only), and the BigInt
// center.
//
// FRAMING. There is no steering. The zoom opens on the whole set (center -0.6,
// depth 1) and goes straight in onto one Misiurewicz point M in seahorse
// valley, which stays put on screen. Near M the set is self-similar with the
// multiplier rho of M's cycle (Tan Lei): c -> M + rho (c - M) maps the picture
// onto itself with every escape count larger by the period. The similarity is
// asymptotic, so the loop starts LOOPD octaves down, where the mismatch is far
// under a pixel; from there every |rho| octaves the frame has turned by
// arg(rho) and is the same picture, so the phase wraps there. A true loop:
// nothing is blended and nothing is hidden. Zoom out runs it backwards and
// climbs back to the whole set.
(function(){
const FB=192n, FBn=192, TW=4096, UNIT=6;
const toFix=d=>BigInt(Math.round(d*2**FBn));
const toNum=b=>Number(b)/2**FBn;
// M = f^24(0) on a 3-cycle: c = -0.74901711228836318233 + 0.13517943177843302771i
// (mpmath, 90 digits), in 192-bit fixed point, and the cycle multiplier rho.
const MX=-4701656615379604861248056551908820548103914160923311970185n,
      MY=848535045804987379762600017783139323820212493194652052057n;
const RX=4.32340450876674, RY=-5.540845870382749, PER=3;
const LOOP=Math.log2(Math.hypot(RX,RY));        // ~2.8 octaves a turn of the loop
const ROT=Math.atan2(RY,RX);                    // and the turn it takes
// Home = the scene's whole-figure frame (fHome for the Mandelbrot).
const HX=-0.6, D0=1.0, S0=2.6*2**-D0;
// Where the loop starts, below home. The similarity error goes as the frame
// size times |d z_24 / dc| (~2^9.5); at 31 octaves down that is ~1e-6 of the
// frame, far under a pixel.
const LOOPD=31;
const PVS=`#version 300 es
in vec2 a;void main(){gl_Position=vec4(a,0,1);}`;
const PFS=`#version 300 es
precision highp float;precision highp int;
uniform sampler2D uOrb;uniform int uRefLen,uMax;uniform vec2 uOff,uRes;uniform float uS;
out vec4 o;
vec2 cm(vec2 a,vec2 b){return vec2(a.x*b.x-a.y*b.y,a.x*b.y+a.y*b.x);}
vec2 Z(int m){return texelFetch(uOrb,ivec2(m&4095,m>>12),0).xy;}
void main(){
  vec2 uv=(gl_FragCoord.xy*2.0-uRes)/uRes.y;
  vec2 dc=uOff+uv*uS,d=vec2(0.0),z;int m=0,i;float r2=0.0;
  for(i=0;i<uMax;i++){vec2 Zm=Z(m);d=2.0*cm(Zm,d)+cm(d,d)+dc;m++;z=Z(m)+d;r2=dot(z,z);
    if(r2>256.0)break;if(r2<dot(d,d)||m>=uRefLen-1){d=z;m=0;}}
  float n=i<uMax?float(i):0.0;
  o=vec4(mod(n,256.0)/255.0,mod(floor(n/256.0),256.0)/255.0,i<uMax?1.0:0.0,1.0);
}`;
class DeepZoom{
  constructor(gl,opts){
    this.gl=gl;this.cap=(opts&&opts.cap)||7000;
    const sh=(t,s)=>{const x=gl.createShader(t);gl.shaderSource(x,s);gl.compileShader(x);if(!gl.getShaderParameter(x,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(x));return x;};
    const p=this.prog=gl.createProgram();
    gl.attachShader(p,sh(gl.VERTEX_SHADER,PVS));gl.attachShader(p,sh(gl.FRAGMENT_SHADER,PFS));
    gl.bindAttribLocation(p,0,'a');gl.linkProgram(p);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p));
    this.U={};['uOrb','uRefLen','uMax','uOff','uRes','uS'].forEach(k=>this.U[k]=gl.getUniformLocation(p,k));
    const prev=gl.getParameter(gl.CURRENT_PROGRAM);
    gl.useProgram(p);gl.uniform1i(this.U.uOrb,UNIT);gl.useProgram(prev);
    const prevVao=gl.getParameter(gl.VERTEX_ARRAY_BINDING);
    this.vao=gl.createVertexArray();gl.bindVertexArray(this.vao);
    this.vb=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.vb);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
    gl.bindVertexArray(prevVao);
    this.orb=gl.createTexture();this._bindOrb();
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.activeTexture(gl.TEXTURE0);
    this.PW=64;this.PH=36;
    this.pt=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.pt);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,this.PW,64,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
    const prevFb=gl.getParameter(gl.FRAMEBUFFER_BINDING);
    this.pf=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,this.pf);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.pt,0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,prevFb);
    this.pbo=gl.createBuffer();gl.bindBuffer(gl.PIXEL_PACK_BUFFER,this.pbo);
    gl.bufferData(gl.PIXEL_PACK_BUFFER,this.PW*64*4,gl.STREAM_READ);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);
    this.px=new Uint8Array(this.PW*64*4);
    this.fence=null;this.lastProbe=0;
    this.reset();
  }
  reset(){
    this.cx=toFix(HX);this.cy=0n;this.rx=0n;this.ry=0n;
    this.refLen=0;this.refIter=0;this.maxIter=400;
    this.base=0;this.shade=200;this.depth=D0;this.interior=0;
    this.pix=S0;this.rc=1;this.rs=0;this.ph=null;
  }
  _bindOrb(){const gl=this.gl;gl.activeTexture(gl.TEXTURE0+UNIT);gl.bindTexture(gl.TEXTURE_2D,this.orb);}
  S(){return this.pix;}
  reference(){
    const gl=this.gl,N=this.maxIter+2,rows=Math.ceil(N/TW);
    const buf=new Float32Array(rows*TW*2);
    let zr=0n,zi=0n,n=0;const cr=this.cx,ci=this.cy,four=4n<<FB;
    for(;n<N;n++){
      buf[n*2]=toNum(zr);buf[n*2+1]=toNum(zi);
      const zr2=(zr*zr)>>FB,zi2=(zi*zi)>>FB;
      if(zr2+zi2>four){n++;break;}
      zi=((2n*zr*zi)>>FB)+ci;zr=zr2-zi2+cr;
    }
    this.refLen=Math.max(2,n);this.rx=cr;this.ry=ci;this.refIter=this.maxIter;
    this._bindOrb();
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RG32F,TW,rows,0,gl.RG,gl.FLOAT,buf);
    gl.activeTexture(gl.TEXTURE0);
  }
  _probeStart(aspect){
    const gl=this.gl;if(this.fence)return;
    const PH=Math.max(8,Math.min(64,Math.round(this.PW/Math.max(0.5,aspect))));this.PH=PH;
    const prog=gl.getParameter(gl.CURRENT_PROGRAM),fb=gl.getParameter(gl.FRAMEBUFFER_BINDING),
          vp=gl.getParameter(gl.VIEWPORT),vao=gl.getParameter(gl.VERTEX_ARRAY_BINDING);
    gl.useProgram(this.prog);gl.bindVertexArray(this.vao);this._bindOrb();gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(this.U.uRefLen,this.refLen);gl.uniform1i(this.U.uMax,this.maxIter);
    gl.uniform2f(this.U.uOff,toNum(this.cx-this.rx),toNum(this.cy-this.ry));
    gl.uniform2f(this.U.uRes,this.PW,PH);gl.uniform1f(this.U.uS,this.S());
    gl.bindFramebuffer(gl.FRAMEBUFFER,this.pf);gl.viewport(0,0,this.PW,PH);
    gl.drawArrays(gl.TRIANGLES,0,3);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER,this.pbo);
    gl.readPixels(0,0,this.PW,PH,gl.RGBA,gl.UNSIGNED_BYTE,0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);
    this.fence=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);
    this.probeS=this.S();this.probeCx=this.cx;this.probeCy=this.cy;
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.viewport(vp[0],vp[1],vp[2],vp[3]);
    gl.bindVertexArray(vao);gl.useProgram(prog);
  }
  _probeCollect(){
    const gl=this.gl;if(!this.fence)return;
    if(gl.getSyncParameter(this.fence,gl.SYNC_STATUS)!==gl.SIGNALED)return;
    gl.deleteSync(this.fence);this.fence=null;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER,this.pbo);gl.getBufferSubData(gl.PIXEL_PACK_BUFFER,0,this.px);gl.bindBuffer(gl.PIXEL_PACK_BUFFER,null);
    const PW=this.PW,H=this.PH,tot=PW*H,px=this.px,I=new Uint8Array(tot),ns=[];
    for(let k=0;k<tot;k++){if(px[k*4+2])ns.push(px[k*4]+px[k*4+1]*256);else I[k]=1;}
    const esc=ns.length;this.interior=1-esc/tot;
    ns.sort((a,b)=>a-b);
    const pc=f=>ns.length?ns[Math.min(ns.length-1,Math.floor(ns.length*f))]:0;
    const p99=pc(0.99),p02=pc(0.02);
    const want=Math.round(Math.min(this.cap,400+this.depth*220,Math.max(400,p99*1.5+200)));
    if(want>this.maxIter*1.15||want<this.maxIter*0.7)this.maxIter=want;
    if(esc){this.baseT=p02;this.shadeT=Math.max(p02+32,p99*1.15+20);}
  }
  // zoom: the host's zoom, 6.4 octaves a unit, floored at 0 (the whole set).
  frame(o){
    const dt=Math.min(0.1,Math.max(0,o.dt||0));
    const oz=Math.max(0,Math.min(1e6,(o.zoom||0)*6.4));
    let ol=oz, ph=null;
    if(oz>=LOOPD){ const u=(oz-LOOPD)/LOOP; ph=u-Math.floor(u); ol=LOOPD+ph*LOOP; }
    // At a wrap the picture is the same but every escape count differs by the
    // period, so the color range moves by exactly that and nothing is re-learned.
    if(ph!=null && this.ph!=null && Math.abs(ph-this.ph)>0.5){
      const d=(ph<this.ph ? -PER : PER);
      this.base+=d; this.shade+=d;
      if(this.baseT!=null){ this.baseT+=d; this.shadeT+=d; }
      if(this.fence){this.gl.deleteSync(this.fence);this.fence=null;}
    }
    this.ph=ph;
    const th=-ol/LOOP*ROT, k=Math.pow(2,-ol), kx=k*Math.cos(th), ky=k*Math.sin(th);
    // Fixed glide: the loop point slides to the middle over the first 4 octaves.
    const gt=Math.min(1,ol/4), gg=1-gt*gt*(3-2*gt);
    const wx=(HX-toNum(MX))*gg, wy=-toNum(MY)*gg;
    this.cx=MX+toFix(wx*kx-wy*ky); this.cy=MY+toFix(wx*ky+wy*kx);
    this.pix=S0*k; this.rc=Math.cos(th); this.rs=Math.sin(th);
    this.depth=D0+ol;
    const S=this.S();
    const dr=Math.hypot(toNum(this.cx-this.rx),toNum(this.cy-this.ry))/S;
    if(this.refLen===0||dr>0.6||this.maxIter>this.refIter)this.reference();
    this._probeCollect();
    const now=performance.now();
    if(now-this.lastProbe>250){this._probeStart(o.aspect||16/9);this.lastProbe=now;}
    const ke=1-Math.pow(0.05,dt);
    if(this.baseT!=null){this.base+=(this.baseT-this.base)*ke;this.shade+=(this.shadeT-this.shade)*ke;}
  }
  apply(gl,u){
    this._bindOrb();gl.activeTexture(gl.TEXTURE0);
    if(u.uDeep)gl.uniform1f(u.uDeep,1);
    if(u.uRefLen)gl.uniform1i(u.uRefLen,this.refLen);
    if(u.uDeepMax)gl.uniform1i(u.uDeepMax,this.maxIter);
    if(u.uDeepOff)gl.uniform2f(u.uDeepOff,toNum(this.cx-this.rx),toNum(this.cy-this.ry));
    if(u.uDeepPix)gl.uniform1f(u.uDeepPix,this.S());
    if(u.uDeepRot)gl.uniform2f(u.uDeepRot,this.rc,this.rs);
    if(u.uDeepBase)gl.uniform1f(u.uDeepBase,this.base);
    if(u.uDeepShade)gl.uniform1f(u.uDeepShade,this.shade);
  }
  zoomLabel(){return '1e-'+(this.depth*Math.LOG10E*Math.LN2).toFixed(1);}
}
window.DeepZoom=DeepZoom;
})();
