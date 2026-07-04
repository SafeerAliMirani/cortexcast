// shaders.js - WGSL for CortexCast. The head pass paints a live scalp-power map:
// each fragment is an inverse-distance blend of the 64 electrode band-power
// values (storage buffers), with contour isolines and a coverage mask so the
// sensor-free lower head reads as neutral scalp. The electrode pass draws the 64
// sensors as instanced, outlined discs. One shared uniform block.

export const UNI = `
struct Uniforms {
  viewProj : mat4x4<f32>,
  params   : vec4<f32>,   // x: electrodeSizePx  y: dpr  z: nElectrodes  w: smooth
  screen   : vec4<f32>,   // x: width  y: height (device px)
  light    : vec4<f32>,   // xyz: light dir
};
@group(0) @binding(0) var<uniform> U : Uniforms;
`;

export const HEAD_SHADER = UNI + `
@group(0) @binding(1) var<storage, read> ePos : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> eVal : array<f32>;

struct VO { @builtin(position) pos : vec4<f32>, @location(0) wpos : vec3<f32>, @location(1) wnorm : vec3<f32> };

fn cmap(t : f32) -> vec3<f32> {
  let c0 = vec3<f32>(0.05, 0.03, 0.13);
  let c1 = vec3<f32>(0.31, 0.09, 0.42);
  let c2 = vec3<f32>(0.71, 0.21, 0.47);
  let c3 = vec3<f32>(0.96, 0.49, 0.30);
  let c4 = vec3<f32>(0.99, 0.90, 0.64);
  let x = clamp(t, 0.0, 1.0);
  if (x < 0.25) { return mix(c0, c1, x / 0.25); }
  if (x < 0.5)  { return mix(c1, c2, (x - 0.25) / 0.25); }
  if (x < 0.75) { return mix(c2, c3, (x - 0.5) / 0.25); }
  return mix(c3, c4, (x - 0.75) / 0.25);
}

@vertex fn vs(@location(0) p : vec3<f32>) -> VO {
  var o : VO;
  o.pos = U.viewProj * vec4<f32>(p, 1.0);
  o.wpos = p;
  o.wnorm = normalize(p);
  return o;
}

@fragment fn fs(i : VO) -> @location(0) vec4<f32> {
  let p = normalize(i.wpos);   // angle-based: works on any head mesh
  let n = u32(U.params.z);
  let sm = U.params.w;
  var acc = 0.0;
  var wsum = 0.0;
  var dmin = 1e9;
  for (var k = 0u; k < n; k = k + 1u) {
    let d = distance(p, ePos[k].xyz);
    dmin = min(dmin, d);
    let w = 1.0 / (d * d + sm);
    acc = acc + w * eVal[k];
    wsum = wsum + w;
  }
  let v = acc / max(wsum, 1e-6);
  var col = cmap(v);
  let bands = 8.0;
  let ff = fract(v * bands);
  let line = 1.0 - smoothstep(0.0, fwidth(v * bands) * 1.5, min(ff, 1.0 - ff));
  col = mix(col, col * 0.35, line * 0.55);
  let cap = smoothstep(-0.28, 0.12, p.y);   // topomap only on the upper scalp; face + neck stay skin
  let cover = (1.0 - smoothstep(0.30, 0.66, dmin)) * cap;
  col = mix(vec3<f32>(0.58, 0.52, 0.46), col, cover);
  let L = normalize(U.light.xyz);
  let lam = 0.62 + 0.38 * max(dot(normalize(i.wnorm), L), 0.0);
  return vec4<f32>(col * lam, 1.0);
}
`;

export const ELECTRODE_SHADER = UNI + `
@group(0) @binding(1) var<storage, read> ePos : array<vec4<f32>>;
struct VO { @builtin(position) pos : vec4<f32>, @location(0) uv : vec2<f32> };

@vertex fn vs(@builtin(instance_index) inst : u32, @builtin(vertex_index) vid : u32) -> VO {
  var o : VO;
  var corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0,-1.0), vec2<f32>(1.0,-1.0), vec2<f32>(1.0,1.0),
    vec2<f32>(-1.0,-1.0), vec2<f32>(1.0,1.0), vec2<f32>(-1.0,1.0));
  let c = corners[vid];
  let e = ePos[inst].xyz * 1.02;
  let clip = U.viewProj * vec4<f32>(e, 1.0);
  if (clip.w <= 0.0) { o.pos = vec4<f32>(2.0,2.0,2.0,1.0); o.uv = vec2<f32>(2.0,2.0); return o; }
  let off = c * (U.params.x * U.params.y) / U.screen.xy * 2.0;
  o.pos = vec4<f32>((clip.xy / clip.w + off) * clip.w, clip.z, clip.w);
  o.uv = c;
  return o;
}

@fragment fn fs(i : VO) -> @location(0) vec4<f32> {
  let r = length(i.uv);
  if (r > 1.0) { discard; }
  let core = smoothstep(0.62, 0.48, r);
  let ring = smoothstep(1.0, 0.84, r) * (1.0 - core);
  let col = mix(vec3<f32>(0.05, 0.06, 0.09), vec3<f32>(0.97, 0.98, 1.0), core);
  return vec4<f32>(col, max(core, ring) * 0.95);
}
`;
