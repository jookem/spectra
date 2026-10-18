// Depth-correct layer for the shorebreak wave.
//
// The wave is a curling shell: along one view ray the lip overhangs its own
// face, so no ordering of whole triangles is correct and the 2D canvas painter
// pass always left a hole somewhere. This renders the same triangles into an
// offscreen WebGL canvas with a real per-pixel depth buffer, then composites
// that one image back into the 2D scene at the exact point in the draw order
// where the wave belongs — so the wave still sits between the ocean belt's
// bands, and nothing else in the scene changes.
//
// Vertices arrive already projected by the scene's own perspective maths as
// (x px, y px, depth 0..1 front..back); the shader only converts to clip space.
// No culling: with a depth buffer the interior faces are correctly hidden by
// the near skin instead of being discarded.
(function () {
  const VS = `
attribute vec3 aPos;
attribute vec3 aCol;
uniform vec2 uRes;
varying vec3 vCol;
void main(){
  vCol = aCol;
  gl_Position = vec4(
    aPos.x / uRes.x * 2.0 - 1.0,
    1.0 - aPos.y / uRes.y * 2.0,
    aPos.z * 2.0 - 1.0,
    1.0);
}`;
  const FS = `
precision mediump float;
varying vec3 vCol;
void main(){ gl_FragColor = vec4(vCol, 1.0); }`;

  let cv = null, gl = null, prog = null, bufP = null, bufC = null, locRes = null;
  let P = new Float32Array(0), C = new Float32Array(0), n = 0;

  function init(w, h) {
    if (!cv) {
      cv = document.createElement('canvas');
      // Premultiplied: the antialiased edge pixels are resolved against the
      // transparent clear, so with straight alpha their colour came out half
      // black and drew a dark outline round the wave's foot on the sea.
      gl = cv.getContext('webgl', {
        alpha: true, depth: true, antialias: true,
        premultipliedAlpha: true, preserveDrawingBuffer: false
      });
      if (!gl) return false;
      const mk = (t, s) => {
        const sh = gl.createShader(t);
        gl.shaderSource(sh, s); gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
          console.warn('wave-gl shader', gl.getShaderInfoLog(sh));
        return sh;
      };
      prog = gl.createProgram();
      gl.attachShader(prog, mk(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      gl.useProgram(prog);
      locRes = gl.getUniformLocation(prog, 'uRes');
      bufP = gl.createBuffer(); bufC = gl.createBuffer();
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.BLEND);
    }
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    return !!gl;
  }

  function grow(tris) {
    const need = tris * 9;
    if (P.length < need) {
      P = new Float32Array(Math.max(need, 4096));
      C = new Float32Array(P.length);
    }
  }

  // Start a wave: sizes the layer, clears colour and depth.
  function begin(w, h, maxTris) {
    if (!init(w | 0, h | 0)) return false;
    grow(maxTris || 1024);
    n = 0;
    gl.viewport(0, 0, cv.width, cv.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    return true;
  }

  // One flat-shaded facet. z is 0 at the front of the model, 1 at the back.
  function tri(x0, y0, z0, x1, y1, z1, x2, y2, z2, r, g, b) {
    const i = n * 9;
    if (i + 9 > P.length) return;
    P[i] = x0; P[i + 1] = y0; P[i + 2] = z0;
    P[i + 3] = x1; P[i + 4] = y1; P[i + 5] = z1;
    P[i + 6] = x2; P[i + 7] = y2; P[i + 8] = z2;
    const rr = r / 255, gg = g / 255, bb = b / 255;
    for (let v = 0; v < 3; v++) { C[i + v * 3] = rr; C[i + v * 3 + 1] = gg; C[i + v * 3 + 2] = bb; }
    n++;
  }

  // Draw everything collected, then stamp the layer into the 2D scene.
  function end(ctx) {
    if (!gl || !n) return;
    gl.useProgram(prog);
    gl.uniform2f(locRes, cv.width, cv.height);
    const cnt = n * 3;
    gl.bindBuffer(gl.ARRAY_BUFFER, bufP);
    gl.bufferData(gl.ARRAY_BUFFER, P.subarray(0, cnt * 3), gl.DYNAMIC_DRAW);
    const aP = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aP);
    gl.vertexAttribPointer(aP, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufC);
    gl.bufferData(gl.ARRAY_BUFFER, C.subarray(0, cnt * 3), gl.DYNAMIC_DRAW);
    const aC = gl.getAttribLocation(prog, 'aCol');
    gl.enableVertexAttribArray(aC);
    gl.vertexAttribPointer(aC, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, cnt);
    // 1:1 — the layer was sized to the same W/H the scene projects into, so it
    // composites under whatever transform the 2D context already has.
    ctx.drawImage(cv, 0, 0);
    n = 0;
  }

  window.WaveGL = { begin, tri, end, get ok() { return !!gl || cv === null; } };
})();
