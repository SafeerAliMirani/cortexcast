// mesh.js - load a real head mesh (glTF .glb) in raw JS. Parses the GLB
// container, reads POSITION + indices, centres it, rotates to our frame (y-up,
// nose toward -z), and scales to ~unit. Also projects the 10-20 electrode
// directions onto the actual scalp. Model: three.js LeePerrySmith head scan
// (Infinite-Realities, CC-BY), served from GitHub via jsDelivr (CORS-friendly).

import { fitSphere } from "./geom.js";

const MODEL = "https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/models/gltf/LeePerrySmith/LeePerrySmith.glb";

export async function loadHeadMesh(url = MODEL) {
  const buf = await (await fetch(url)).arrayBuffer();
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546C67) throw new Error("not a .glb");
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
  const binOffset = 28 + jsonLen;
  const prim = json.meshes[0].primitives[0];
  const readAcc = (ai) => {
    const acc = json.accessors[ai], bv = json.bufferViews[acc.bufferView];
    const off = binOffset + (bv.byteOffset || 0) + (acc.byteOffset || 0);
    const n = acc.count * (acc.type === "VEC3" ? 3 : 1);
    if (acc.componentType === 5126) return new Float32Array(buf.slice(off, off + n * 4));
    if (acc.componentType === 5123) return new Uint16Array(buf.slice(off, off + n * 2));
    if (acc.componentType === 5125) return new Uint32Array(buf.slice(off, off + n * 4));
    throw new Error("accessor componentType " + acc.componentType);
  };
  const src = readAcc(prim.attributes.POSITION);
  const idxRaw = readAcc(prim.indices);
  const indices = idxRaw instanceof Uint32Array ? idxRaw : Uint32Array.from(idxRaw);

  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < src.length; i += 3) for (let k = 0; k < 3; k++) { const v = src[i + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
  const bc = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
  const P = new Float32Array(src.length);                 // centre on bbox, rotate 180 about Y so nose faces world -z
  for (let i = 0; i < src.length; i += 3) { P[i] = -(src[i] - bc[0]); P[i + 1] = src[i + 1] - bc[1]; P[i + 2] = -(src[i + 2] - bc[2]); }
  const fit = fitSphere((i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], P.length / 3, (p) => p[1] > 0);   // cranium sphere from the upper half (excludes face/neck/shoulders)
  const C = fit.center, R = fit.radius || 1;
  const positions = new Float32Array(src.length);         // recentre on the cranium centre + scale to unit scalp radius
  for (let i = 0; i < src.length; i += 3) { positions[i] = (P[i] - C[0]) / R; positions[i + 1] = (P[i + 1] - C[1]) / R; positions[i + 2] = (P[i + 2] - C[2]) / R; }
  // detect anatomical landmarks for cap co-registration (unit-cranium frame: +y up, -z front, +x right)
  let crown = [0, -9, 0], lEar = [9, 0, 0], rEar = [-9, 0, 0], inion = [0, 0, -9], nasion = [0, 0, 9];
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (y > crown[1]) crown = [x, y, z];
    if (Math.abs(y) < 0.3 && z > -0.3 && z < 0.6) { if (x < lEar[0]) lEar = [x, y, z]; if (x > rEar[0]) rEar = [x, y, z]; }
    if (Math.abs(x) < 0.15 && y > -0.2 && y < 0.15 && z > inion[2]) inion = [x, y, z];    // backmost at ear level = inion
    if (Math.abs(x) < 0.10 && y > -0.05 && y < 0.30 && z < nasion[2]) nasion = [x, y, z];  // frontmost at brow level = nasion
  }
  return { positions, indices, craniumR: R, landmarks: { crown, lEar, rEar, inion, nasion } };
}

// Place each electrode (unit direction) on the mesh surface: dir * support(dir).
export function projectElectrodes(dirs, meshPos) {
  // Snap each electrode to the nearest SCALP vertex by direction. The mesh is
  // recentred on the cranium centre, so the face/eyes/cheeks/jaw/neck are the
  // vertices below the 10-20 cap ring (world y < YMIN); excluding them keeps the
  // frontal Fp/AF electrodes at the hairline instead of sliding onto the brow/eye,
  // while every electrode still sits on the real head surface.
  const YMIN = -0.10;
  const nV = meshPos.length / 3, n = dirs.length / 3, out = new Float32Array(n * 4);
  for (let e = 0; e < n; e++) {
    const dx = dirs[e * 3], dy = dirs[e * 3 + 1], dz = dirs[e * 3 + 2];
    let best = -2, bi = -1;
    for (let i = 0; i < nV; i++) {
      const vy = meshPos[i * 3 + 1]; if (vy < YMIN) continue;            // scalp only
      const vx = meshPos[i * 3], vz = meshPos[i * 3 + 2];
      const L = Math.hypot(vx, vy, vz) || 1, dot = (vx * dx + vy * dy + vz * dz) / L;
      if (dot > best) { best = dot; bi = i; }
    }
    if (bi < 0) bi = 0;
    out[e * 4] = meshPos[bi * 3] * 1.03; out[e * 4 + 1] = meshPos[bi * 3 + 1] * 1.03; out[e * 4 + 2] = meshPos[bi * 3 + 2] * 1.03;
  }
  return out;
}
