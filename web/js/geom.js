// geom.js - head geometry for CortexCast. Normalises the real 10-10 electrode
// coordinates into a consistent frame (centred, scaled to ~unit radius) and
// builds a UV-sphere mesh for the scalp that the topomap is painted onto.

// channels: [{label, xyz:[x,y,z]}] in metres (MNE head frame: +x right, +y
// front, +z up). Returns { pos:Float32Array(n*3), labels, index:{C3,C4,Cz},
// center, radius } normalised so electrodes sit near radius 1.
const HEAD = [0.85, 0.98, 1.06];   // width, height, front-back -> head-shaped, not a ball

export function normalizeElectrodes(channels) {
  const n = channels.length;
  const fit = fitSphere((i) => channels[i].xyz, n, null);   // sphere centre ~ true head centre (unbiased, unlike the cap centroid)
  const c = fit.center;
  const pos = new Float32Array(n * 3), posRaw = new Float32Array(n * 3), labels = [];
  const index = {};
  for (let i = 0; i < n; i++) {
    const rx = channels[i].xyz[0], ry = channels[i].xyz[1], rz = channels[i].xyz[2];
    posRaw[i * 3] = rx; posRaw[i * 3 + 1] = rz; posRaw[i * 3 + 2] = -ry;   // MNE(+x right,+y front,+z up) -> world(+x right,+y up,-z front), metres
    const x = rx - c[0], y = ry - c[1], z = rz - c[2];
    const wx = x, wy = z, wz = -y, L = Math.hypot(wx, wy, wz) || 1;   // unit direction from head centre (used by the 2D compare view)
    pos[i * 3] = wx / L; pos[i * 3 + 1] = wy / L; pos[i * 3 + 2] = wz / L;
    const lb = channels[i].label; labels.push(lb);
    const key = lb.toLowerCase();
    if (key === "c3") index.C3 = i; else if (key === "c4") index.C4 = i; else if (key === "cz") index.Cz = i;
    else if (key === "t7") index.T7 = i; else if (key === "t8") index.T8 = i; else if (key === "iz") index.Iz = i;
  }
  return { pos, posRaw, labels, index, center: c, radius: fit.radius };
}

// Co-register the official 10-20 montage onto the head mesh: solve the affine that
// maps the montage's four anatomical anchors (Cz, T7, T8, Iz) onto the mesh's
// detected landmarks (crown, left ear, right ear, inion), apply it to all 64
// electrodes, then seat each on the nearest scalp vertex. This is how EEG software
// places a cap: by landmarks and the standard coordinates, not by guesswork.
export function coregister(elec, lm, meshPos) {
  const P = elec.posRaw, i = elec.index;
  const mp = (k) => [P[k * 3], P[k * 3 + 1], P[k * 3 + 2]];
  const Cz = mp(i.Cz), T7 = mp(i.T7), T8 = mp(i.T8), Iz = mp(i.Iz);
  const Fpz = mp(elec.labels.findIndex((l) => l.toLowerCase() === "fpz"));
  // Per-axis scale+shift from anatomical anchors (frames already aligned: +x right, +y up, -z front).
  // x: ears; y: Cz(top) vs ear ring(bottom); z: nasion(front) vs inion(back).
  const sx = (lm.rEar[0] - lm.lEar[0]) / ((T8[0] - T7[0]) || 1e-6), tx = lm.lEar[0] - sx * T7[0];
  const emY = (T7[1] + T8[1]) / 2, eMy = (lm.lEar[1] + lm.rEar[1]) / 2;
  const sy = (lm.crown[1] - eMy) / ((Cz[1] - emY) || 1e-6), ty = eMy - sy * emY;
  const sz = (lm.inion[2] - lm.nasion[2]) / ((Iz[2] - Fpz[2]) || 1e-6), tz = lm.nasion[2] - sz * Fpz[2];
  const n = P.length / 3, nV = meshPos.length / 3;
  const vdir = new Float32Array(nV * 3), vrad = new Float32Array(nV);   // precompute vertex directions + radii once
  for (let v = 0; v < nV; v++) { const vx = meshPos[v * 3], vy = meshPos[v * 3 + 1], vz = meshPos[v * 3 + 2], vl = Math.hypot(vx, vy, vz) || 1; vrad[v] = vl; vdir[v * 3] = vx / vl; vdir[v * 3 + 1] = vy / vl; vdir[v * 3 + 2] = vz / vl; }
  const unit = new Float32Array(n * 4), disc = new Float32Array(n * 4);
  for (let e = 0; e < n; e++) {
    const tX = sx * P[e * 3] + tx, tY = Math.max(sy * P[e * 3 + 1] + ty, -0.18), tZ = sz * P[e * 3 + 2] + tz;   // cap point; floor keeps T9/T10 at the ear edge
    const tL = Math.hypot(tX, tY, tZ) || 1, dx = tX / tL, dy = tY / tL, dz = tZ / tL;   // electrode direction from the cranium centre
    let sumR = 0, cnt = 0;                                    // mean scalp radius in a cone around the direction: seats on the real surface (no floating), smoothed over ~20deg (no ear clustering)
    for (let v = 0; v < nV; v++) if (vdir[v * 3] * dx + vdir[v * 3 + 1] * dy + vdir[v * 3 + 2] * dz > 0.93) { sumR += vrad[v]; cnt++; }
    const R = (cnt ? sumR / cnt : tL) * 1.02;
    disc[e * 4] = dx * R; disc[e * 4 + 1] = dy * R; disc[e * 4 + 2] = dz * R;
    unit[e * 4] = dx; unit[e * 4 + 1] = dy; unit[e * 4 + 2] = dz;
  }
  return { unit, disc };
}

// Kasa algebraic sphere fit. getPt(i) -> [x,y,z]; optional filter(p) -> bool.
export function fitSphere(getPt, n, filter) {
  const M = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]], rhs = [0,0,0,0];
  let cnt = 0;
  for (let i = 0; i < n; i++) {
    const p = getPt(i); if (filter && !filter(p)) continue;
    const u = [2*p[0], 2*p[1], 2*p[2], 1], t = p[0]*p[0] + p[1]*p[1] + p[2]*p[2];
    for (let a = 0; a < 4; a++) { for (let b = 0; b < 4; b++) M[a][b] += u[a]*u[b]; rhs[a] += u[a]*t; }
    cnt++;
  }
  const s = solve4(M, rhs);
  const r2 = s[3] + s[0]*s[0] + s[1]*s[1] + s[2]*s[2];
  return { center: [s[0], s[1], s[2]], radius: Math.sqrt(Math.max(1e-6, r2)), count: cnt };
}
function solve4(A, b) {
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < 4; col++) {
    let piv = col; for (let r = col + 1; r < 4; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < 4; r++) if (r !== col) { const f = M[r][col] / (M[col][col] || 1e-9); for (let k = col; k <= 4; k++) M[r][k] -= f * M[col][k]; }
  }
  return [M[0][4] / (M[0][0] || 1e-9), M[1][4] / (M[1][1] || 1e-9), M[2][4] / (M[2][2] || 1e-9), M[3][4] / (M[3][3] || 1e-9)];
}

// UV sphere for the scalp. Returns { positions:Float32Array, indices:Uint32Array }.
export function sphereMesh(rings = 48, sectors = 64, radius = 1.0) {
  const positions = [], indices = [];
  for (let r = 0; r <= rings; r++) {
    const phi = Math.PI * r / rings;             // 0..pi (top..bottom)
    for (let s = 0; s <= sectors; s++) {
      const theta = 2 * Math.PI * s / sectors;
      const x = Math.sin(phi) * Math.cos(theta), y = Math.cos(phi), z = Math.sin(phi) * Math.sin(theta);
      positions.push(radius * x * HEAD[0], radius * y * HEAD[1], radius * z * HEAD[2]);
    }
  }
  const row = sectors + 1;
  for (let r = 0; r < rings; r++) for (let s = 0; s < sectors; s++) {
    const a = r * row + s, b = a + row;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

// (removed dead headFeatures nose/ears helper, replaced by the real head mesh)
