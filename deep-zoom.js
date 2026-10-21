// Deep zoom for the Mandelbrot field: perturbation against one high-precision
// reference orbit. The center lives in BigInt fixed point (192 fractional bits),
// the GPU only ever sees small float32 offsets from the reference, so the zoom
// runs to ~1e-30 instead of stopping at float precision (~1e-5).
// Owns: the reference orbit texture (unit 6), a tiny probe program that reads
// back escape counts for auto-steering, and the BigInt center.
(function(){
const FB=192n, FBn=192, TW=4096, UNIT=6;
const toFix=d=>BigInt(Math.round(d*2**FBn));
const toNum=b=>Number(b)/2**FBn;
const MAXD=98;
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
    this.gl=gl;this.cap=(opts&&opts.cap)||6000;
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
    this.cx=toFix(-0.75);this.cy=0n;this.rx=0n;this.ry=0n;
    this.tx=0;this.ty=0;this.refLen=0;this.refIter=0;this.maxIter=400;
    this.base=0;this.shade=200;this.depth=2.1;this.interior=0;
  }
  _bindOrb(){const gl=this.gl;gl.activeTexture(gl.TEXTURE0+UNIT);gl.bindTexture(gl.TEXTURE_2D,this.orb);}
  S(){return 2.6*2**-this.depth;}
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
  _probeCollect(steer){
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
    if(!steer||this.depth<3)return;
    // Small interior islands are minibrots: head for the nearest while it is
    // still small. Big or edge-touching interiors (cardioid, grown minibrot)
    // are ruled out with a margin, which sends the zoom along their filaments.
    const lab=new Int32Array(tot).fill(-1),stk=[];let mb=null,mbs=-1e9;
    const uvx=x=>(2*x+1-PW)/H,uvy=y=>(2*y+1-H)/H;
    for(let k0=0;k0<tot;k0++){if(!I[k0]||lab[k0]>=0)continue;
      let a=0,sx=0,sy=0,edge=false;stk.push(k0);lab[k0]=k0;
      while(stk.length){const k=stk.pop(),x=k%PW,y=(k/PW)|0;a++;sx+=x;sy+=y;if(x===0||y===0||x===PW-1||y===H-1)edge=true;
        if(x>0){const q=k-1;if(I[q]&&lab[q]<0){lab[q]=k0;stk.push(q);}}
        if(x<PW-1){const q=k+1;if(I[q]&&lab[q]<0){lab[q]=k0;stk.push(q);}}
        if(y>0){const q=k-PW;if(I[q]&&lab[q]<0){lab[q]=k0;stk.push(q);}}
        if(y<H-1){const q=k+PW;if(I[q]&&lab[q]<0){lab[q]=k0;stk.push(q);}}}
      const big=a>=tot*0.06||edge;
      if(a>=3&&!big){const ux=uvx(sx/a),uy=uvy(sy/a);const sc=-Math.hypot(ux,uy);if(sc>mbs){mbs=sc;mb=[ux,uy];}}
      if(big)for(let k=0;k<tot;k++)if(lab[k]===k0)I[k]=2;
    }
    let bx=0,by=0,found=false;
    if(mb){bx=mb[0];by=mb[1];found=true;}
    else{
      let best=-1e9;const R=2;
      for(let y=R;y<H-R;y++)for(let x=R;x<PW-R;x++){
        const k=y*PW+x;if(I[k])continue;
        let near=false;for(let v=-R;v<=R&&!near;v++)for(let u=-R;u<=R;u++)if(I[k+v*PW+u]===2){near=true;break;}
        if(near)continue;
        const n=px[k*4]+px[k*4+1]*256,ux=uvx(x),uy=uvy(y);
        const sc=Math.log(n+1)-Math.hypot(ux,uy)*1.1;
        if(sc>best){best=sc;bx=ux;by=uy;found=true;}
      }
    }
    if(found){
      // target is relative to the probe's center, which the view has since left
      const S=this.probeS;
      this.tx=bx*S-toNum(this.cx-this.probeCx);this.ty=by*S-toNum(this.cy-this.probeCy);
    }
  }
  // zoom: the host's unbounded zoom phase. Depth folds back at MAXD so a long
  // set ping-pongs out and in rather than running past float32 range.
  frame(o){
    const dt=Math.min(0.1,Math.max(0,o.dt||0));
    let D=2.1+Math.max(0,o.zoom||0)*6.4;
    const span=MAXD-2.1;let f=(D-2.1)%(2*span);if(f>span)f=2*span-f;
    this.depth=2.1+f;
    if(this.depth<3){
      const hx=-0.75-toNum(this.cx),hy=-toNum(this.cy);
      this.tx=hx;this.ty=hy;
    }
    const k=Math.min(1,dt*1.8),sx=this.tx*k,sy=this.ty*k;
    if(sx||sy){this.cx+=toFix(sx);this.cy+=toFix(sy);this.tx-=sx;this.ty-=sy;}
    const S=this.S();
    const dr=Math.hypot(toNum(this.cx-this.rx),toNum(this.cy-this.ry))/S;
    if(this.refLen===0||dr>0.6||this.maxIter>this.refIter)this.reference();
    this._probeCollect(o.steer!==false);
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
    if(u.uDeepBase)gl.uniform1f(u.uDeepBase,this.base);
    if(u.uDeepShade)gl.uniform1f(u.uDeepShade,this.shade);
  }
  zoomLabel(){return '1e-'+(this.depth*Math.LOG10E*Math.LN2).toFixed(1);}
}
window.DeepZoom=DeepZoom;
})();
