// app.js - CortexCast orchestrator: load a real EEGMMIDB recording, compute mu/
// beta band power (FFT), paint the GPU scalp-power topomap, scroll the raw
// traces with event cues, and decode left-vs-right imagery from motor-cortex ERD.
import { Renderer } from "./render-core.js";
import { OrbitCamera } from "./camera.js";
import { loadManifest, loadRecording, CODE_LABEL } from "./eeg-data.js";
import { bandEnvelopes } from "./dsp.js";
import { normalizeElectrodes, sphereMesh, coregister } from "./geom.js";
import { loadHeadMesh } from "./mesh.js";
import { makeElectrodeLabels } from "./labels.js";

const canvas = document.getElementById("gpu");
const state = { electrodeSize: 4.5, smooth: 0.02 };
let renderer, camera, manifest, elec, tracesCtx;
let rec = null, env = null, band = "mu";
let roiL = [], roiR = [];
const norm = { mu: [0, 1], beta: [0, 1] };
let frameLabels = null, baseMu = null, baseBeta = null;
let sample = 0, playing = true, speed = 1.0, last = 0, loadGen = 0, topoScratch = null;
let elabels = null, capDisc = null;

const $ = (id) => document.getElementById(id);
function setLoading(m) { const t = $("loading-text"); if (t) t.textContent = m; }
function hideLoading() { const o = $("loading"); if (o) o.classList.add("hidden"); }
function showNoGPU(m) { const o = $("nogpu"); if (o) o.classList.remove("hidden"); if (m) { const e = $("nogpu-msg"); if (e) e.textContent = m; } }
function setStat(id, v) { const el = $(id); if (el) el.textContent = v; }
function friendly(id) { const s = +id.slice(1, 4), r = +id.slice(5); return "Subject " + s + " · run " + r; }

async function boot() {
  if (!(await Renderer.supported())) { showNoGPU(); return; }
  renderer = new Renderer(canvas);
  renderer.onLost = () => showNoGPU("The GPU context was lost. Please reload the page.");
  try { await renderer.init(); } catch (e) { console.error(e); showNoGPU(e.message); return; }
  camera = new OrbitCamera();
  camera.distance = 3.7; camera.minDist = 1.7; camera.maxDist = 6; camera.elevation = 0.12; camera.azimuth = 4.18;
  buildOrient();
  const tc = $("traces"); if (tc) tracesCtx = tc.getContext("2d");
  setupInput();
  loop();
  try {
    setLoading("Loading real EEG recordings…");
    manifest = await loadManifest();
    if (!manifest.recordings || !manifest.recordings.length) throw new Error("manifest has no recordings, run convert.py");
    elec = normalizeElectrodes(manifest.channels);
    const findIx = (nm) => elec.labels.findIndex((l) => l.toLowerCase() === nm.toLowerCase());
    roiL = ["C3", "FC3", "CP3", "C5", "C1"].map(findIx).filter((i) => i >= 0);
    roiR = ["C4", "FC4", "CP4", "C6", "C2"].map(findIx).filter((i) => i >= 0);
    const nCh = elec.pos.length / 3;
    setLoading("Loading head model…");
    let headMesh;
    try { headMesh = await loadHeadMesh(); } catch (e) { console.warn("head mesh failed, sphere fallback:", e); headMesh = sphereMesh(64, 96, 1.0); }
    renderer.setHead(headMesh);
    const cap = coregister(elec, headMesh.landmarks, headMesh.positions);   // official 10-20, co-registered to the head by landmarks
    renderer.setElectrodes(cap.unit, cap.disc, nCh);
    capDisc = cap.disc; const _ob = $("orient"); if (_ob) elabels = makeElectrodeLabels(_ob, elec.labels, canvas, camera);
    buildRecSelect();
    setProvenance();
    await loadRec(manifest.recordings[0]);
    hideLoading();
    maybeIntro();
  } catch (e) { console.error(e); setLoading("Could not load: " + (e.message || e)); }
}

function buildRecSelect() {
  const sel = $("rec"); if (!sel) return; sel.innerHTML = "";
  manifest.recordings.forEach((r, i) => { const o = document.createElement("option"); o.value = i; o.textContent = friendly(r.id); sel.appendChild(o); });
  sel.onchange = () => { loadRec(manifest.recordings[+sel.value]).catch((e) => { console.error(e); hideLoading(); }); };
}
function setProvenance() { const p = $("prov"); if (p && manifest) p.textContent = manifest.dataset + " · DOI " + manifest.doi; }

async function loadRec(r) {
  const gen = ++loadGen;
  setLoading("Loading " + friendly(r.id) + " and computing band power…");
  const d = await loadRecording(r);
  if (gen !== loadGen) return;                              // superseded by a newer switch
  const e = bandEnvelopes(d.uv, d.nCh, d.nSamp, d.sfreq);
  const nF = e.nFrames;
  const nrm = {};
  for (const b of ["mu", "beta"]) { const s = Float32Array.from(e.bands[b]).sort(); const lo = s[Math.floor(s.length * 0.02)], hi = s[Math.floor(s.length * 0.98)]; nrm[b] = [lo, Math.max(hi, lo + 1e-6)]; }
  const fl = new Array(nF).fill("T0");
  const evs = r.events.map((x) => ({ f: Math.max(0, Math.round((x.t * d.sfreq - e.win / 2) / e.hop)), code: x.code })).sort((a, b) => a.f - b.f);
  for (let i = 0; i < evs.length; i++) { const f0 = Math.max(0, evs[i].f), f1 = i + 1 < evs.length ? evs[i + 1].f : nF; for (let f = f0; f < Math.min(nF, f1); f++) fl[f] = evs[i].code; }
  const bMu = new Float32Array(d.nCh), bBeta = new Float32Array(d.nCh);
  for (let c = 0; c < d.nCh; c++) { let sm = 0, sb = 0, n = 0; for (let f = 0; f < nF; f++) if (fl[f] === "T0") { sm += e.bands.mu[c * nF + f]; sb += e.bands.beta[c * nF + f]; n++; } bMu[c] = n ? sm / n : 1e-6; bBeta[c] = n ? sb / n : 1e-6; }
  if (gen !== loadGen) return;
  rec = d; env = e; norm.mu = nrm.mu; norm.beta = nrm.beta; frameLabels = fl; baseMu = bMu; baseBeta = bBeta; sample = 0; playing = true;
  const pb = $("play"); if (pb) pb.textContent = "❚❚ pause";
  setStat("stat-rec", friendly(r.id));
  hideLoading();
}

function curFrame() { return Math.min(env.nFrames - 1, Math.max(0, Math.floor(sample / env.hop))); }

function updateTopo() {
  const f = curFrame(), nF = env.nFrames, arr = env.bands[band], lo = norm[band][0], hi = norm[band][1];
  if (!topoScratch || topoScratch.length !== rec.nCh) topoScratch = new Float32Array(rec.nCh);
  const vals = topoScratch;
  for (let c = 0; c < rec.nCh; c++) vals[c] = Math.max(0, Math.min(1, (arr[c * nF + f] - lo) / (hi - lo)));
  renderer.setValues(vals);
}

// Per-band ERD averaged over a motor ROI: (baseline - power)/baseline, so mu and
// beta contribute equally (they live on different scales). + => right-cortex
// desync => LEFT hand imagery. Averaged over a ~2 s trailing window.
function classify() {
  if (!env || !roiL.length || !roiR.length) return null;
  const f = curFrame(), nF = env.nFrames, W = Math.round(2.0 * rec.sfreq / env.hop);
  const erd = (chs, ff) => {
    let s = 0;
    for (const c of chs) {
      const m = (baseMu[c] - env.bands.mu[c * nF + ff]) / (baseMu[c] || 1e-6);
      const b = (baseBeta[c] - env.bands.beta[c * nF + ff]) / (baseBeta[c] || 1e-6);
      s += 0.5 * (m + b);
    }
    return s / chs.length;
  };
  let d = 0, m = 0;
  for (let w = Math.max(0, f - W + 1); w <= f; w++) { d += erd(roiR, w) - erd(roiL, w); m++; }
  d /= m;
  const conf = Math.min(1, Math.abs(d) * 3.5);
  const decoded = Math.abs(d) < 0.04 ? "rest" : (d > 0 ? "left" : "right");
  return { decoded, conf, actual: CODE_LABEL[frameLabels[f]] || "rest" };
}

function drawTraces() {
  if (!tracesCtx || !rec) return;
  const ctx = tracesCtx, dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cw = Math.round(ctx.canvas.clientWidth * dpr), chh = Math.round(ctx.canvas.clientHeight * dpr);
  if (ctx.canvas.width !== cw) ctx.canvas.width = cw;
  if (ctx.canvas.height !== chh) ctx.canvas.height = chh;
  const W = ctx.canvas.width, H = ctx.canvas.height;
  ctx.clearRect(0, 0, W, H);
  const win = Math.round(rec.sfreq * 5);
  const s0 = Math.max(0, Math.floor(sample) - Math.floor(win * 0.8)), s1 = Math.min(rec.nSamp, s0 + win);
  const evs = rec.events;
  for (let i = 0; i < evs.length; i++) {
    const es = Math.floor(evs[i].t * rec.sfreq), ee = i + 1 < evs.length ? Math.floor(evs[i + 1].t * rec.sfreq) : rec.nSamp;
    if (ee < s0 || es > s1) continue;
    const x0 = (es - s0) / win * W, x1 = (ee - s0) / win * W;
    ctx.fillStyle = evs[i].code === "T1" ? "rgba(90,150,255,0.13)" : evs[i].code === "T2" ? "rgba(255,155,120,0.13)" : "rgba(255,255,255,0.02)";
    ctx.fillRect(x0, 0, x1 - x0, H);
  }
  const chans = [["C3 (L)", elec.index.C3, "#7fb0ff"], ["Cz", elec.index.Cz, "#cfd6e6"], ["C4 (R)", elec.index.C4, "#ff9b6f"]];
  chans.forEach((ch, ci) => {
    const idx = ch[1]; if (idx == null) return;
    const yc = (0.2 + ci * 0.3) * H, amp = H * 0.0011, half = H * 0.145;   // baselines 0.2/0.5/0.8; gentle gain + clamp to a band so spikes never overflow
    ctx.strokeStyle = ch[2]; ctx.lineWidth = 1 * dpr; ctx.beginPath();
    for (let s = s0; s < s1; s++) { const v = rec.uv[idx * rec.nSamp + s]; const x = (s - s0) / win * W, y = Math.max(yc - half, Math.min(yc + half, yc - v * amp)); if (s === s0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
    ctx.stroke();
    ctx.fillStyle = ch[2]; ctx.font = (11 * dpr) + "px Inter, system-ui, sans-serif"; ctx.fillText(ch[0], 6 * dpr, yc - 7 * dpr);
  });
  ctx.fillStyle = "rgba(154,168,198,0.9)"; ctx.font = (11 * dpr) + "px Inter, system-ui, sans-serif";
  ctx.fillText("raw EEG · motor electrodes · shaded = cue window", 6 * dpr, H - 7 * dpr);
  const xn = (Math.floor(sample) - s0) / win * W;
  ctx.strokeStyle = "#e0b872"; ctx.lineWidth = 1.5 * dpr; ctx.beginPath(); ctx.moveTo(xn, 0); ctx.lineTo(xn, H); ctx.stroke();
}

let orientEls = [];
function buildOrient() {
  const box = $("orient"); if (!box) return;
  const defs = [["\u25B2 front", [0, 0.22, -1.14], "front"], ["L", [-1.14, 0.1, 0], ""], ["R", [1.14, 0.1, 0], ""], ["top", [0, 1.16, 0], ""]];
  orientEls = defs.map((d) => { const el = document.createElement("div"); el.className = "o-label" + (d[2] ? " " + d[2] : ""); el.textContent = d[0]; box.appendChild(el); return { el, dir: d[1] }; });
}
function updateOrient(vp) {
  if (!orientEls.length) return;
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  const eye = camera.eye(), el2 = Math.hypot(eye[0], eye[1], eye[2]) || 1;
  for (const { el, dir } of orientEls) {
    const x = dir[0], y = dir[1], z = dir[2];
    const facing = (x * eye[0] + y * eye[1] + z * eye[2]) / (Math.hypot(x, y, z) * el2);
    const w = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
    if (w <= 0 || facing < -0.05) { el.style.display = "none"; continue; }
    const sx = ((vp[0] * x + vp[4] * y + vp[8] * z + vp[12]) / w * 0.5 + 0.5) * cw;
    const sy = (1 - ((vp[1] * x + vp[5] * y + vp[9] * z + vp[13]) / w * 0.5 + 0.5)) * ch;
    el.style.display = "block"; el.style.left = sx + "px"; el.style.top = sy + "px";
  }
}
let decoState = "";
function loop(now) {
  now = now || 0; const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!document.hidden && !(renderer && renderer.lost)) {
    if (rec && playing) { sample += dt * rec.sfreq * speed; if (sample >= rec.nSamp) sample = 0; }
    if (rec && env) {
      updateTopo(); drawTraces();
      const cls = classify();
      if (cls) {
        const key = cls.decoded + cls.actual + Math.round(cls.conf * 20);
        if (key !== decoState) {
          decoState = key;
          const match = (cls.decoded === "left" && /left/.test(cls.actual)) || (cls.decoded === "right" && /right/.test(cls.actual)) || (cls.decoded === "rest" && cls.actual === "rest");
          const badge = cls.decoded === "rest" ? "" : (match ? '<span class="ok">✓</span>' : '<span class="no">✗</span>');
          const el = $("decode");
          if (el) el.innerHTML = 'decoded <b class="d-' + cls.decoded + '">' + cls.decoded + '</b> ' + badge + '<span class="conf">contrast ' + Math.round(cls.conf * 100) + '%</span><span class="actual">actual cue: ' + cls.actual + '</span>';
        }
      }
      setStat("stat-time", (sample / rec.sfreq).toFixed(1) + "s");
      const sc = $("scrub"); if (sc && playing) sc.value = String(sample / rec.nSamp);
    }
    camera.update(dt);
    renderer.resize();
    const vp = camera.viewProj(canvas.clientWidth / Math.max(1, canvas.clientHeight));
    renderer.render(vp, state);
    updateOrient(vp);
    if (elabels) elabels.update(vp, capDisc);
  } else last = now;
  requestAnimationFrame(loop);
}

function maybeIntro() {
  let seen = false; try { seen = localStorage.getItem("cortexcast_seen") === "1"; } catch (e) {}
  const about = $("about"); if (about && !seen) { about.classList.remove("hidden"); playing = false; const p = $("play"); if (p) p.textContent = "▶ play"; }
}

function setupInput() {
  let drag = false, lx = 0, ly = 0;
  canvas.addEventListener("pointerdown", (e) => { drag = true; lx = e.clientX; ly = e.clientY; camera.beginDrag(); canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener("pointermove", (e) => { if (!drag) return; camera.rotateByPixels(e.clientX - lx, e.clientY - ly, canvas.clientHeight); lx = e.clientX; ly = e.clientY; });
  canvas.addEventListener("pointerup", () => { drag = false; camera.endDrag(); });
  canvas.addEventListener("wheel", (e) => { e.preventDefault(); camera.zoomBy(Math.exp(e.deltaY * 0.001)); }, { passive: false });

  const pb = $("play"); if (pb) pb.onclick = () => { playing = !playing; pb.textContent = playing ? "❚❚ pause" : "▶ play"; pb.setAttribute("aria-label", playing ? "pause" : "play"); };
  const sc = $("scrub"); if (sc) sc.oninput = () => { if (rec) { sample = (+sc.value) * rec.nSamp; playing = false; const p = $("play"); if (p) p.textContent = "▶ play"; } };
  document.querySelectorAll("[data-band]").forEach((b) => b.onclick = () => {
    band = b.getAttribute("data-band");
    document.querySelectorAll("[data-band]").forEach((x) => x.classList.toggle("on", x === b));
    const lbl = $("band-label"); if (lbl) lbl.textContent = band === "mu" ? "μ (8–12 Hz)" : "β (13–30 Hz)";
  });
  const sp = $("speed"); if (sp) sp.onchange = () => { speed = +sp.value; };
  const cb = $("compare-btn"); if (cb) cb.onclick = openCompare;
  const lbtn = $("labels-btn"); if (lbtn) lbtn.onclick = () => { const on = elabels ? elabels.toggle() : false; lbtn.classList.toggle("on", on); };
  const cc = $("compare-close"); if (cc) cc.onclick = () => { const o = $("compare"); if (o) o.classList.add("hidden"); };
  const ab = $("about-btn"), about = $("about"), abx = $("about-close");
  const closeAbout = () => { if (about) about.classList.add("hidden"); sample = 0; playing = true; const p = $("play"); if (p) p.textContent = "❚❚ pause"; try { localStorage.setItem("cortexcast_seen", "1"); } catch (e) {} };
  if (ab && about) ab.onclick = () => about.classList.toggle("hidden");
  if (abx) abx.onclick = closeAbout;
  const start = $("about-start"); if (start) start.onclick = closeAbout;
}

// Left-vs-right grand-average comparison (two 2-D topomaps)
function magma(t) {
  const cs = [[13,8,33],[79,23,107],[181,54,121],[245,125,77],[252,229,163]];
  const x = Math.max(0, Math.min(1, t)) * 4, i = Math.min(3, Math.floor(x)), f = x - i, A = cs[i], B = cs[i + 1];
  return [A[0]+(B[0]-A[0])*f, A[1]+(B[1]-A[1])*f, A[2]+(B[2]-A[2])*f];
}
function projectTopo2D() {
  const n = elec.labels.length, p2 = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const x = elec.pos[i*3], y = elec.pos[i*3+1], z = elec.pos[i*3+2];
    const colat = Math.acos(Math.max(-1, Math.min(1, y))), R = colat / (Math.PI * 0.5);
    const hl = Math.hypot(x, z) || 1e-6;
    p2[i*2] = R * (x / hl); p2[i*2+1] = R * (-z / hl);   // +x right, +y front(up)
  }
  return p2;
}
async function computeCompare() {
  const nCh = elec.labels.length, accL = new Float64Array(nCh), accR = new Float64Array(nCh);
  let nL = 0, nR = 0;
  for (const r of manifest.recordings) {
    const d = await loadRecording(r);
    const e = bandEnvelopes(d.uv, d.nCh, d.nSamp, d.sfreq, 128, 32);
    const nF = e.nFrames, fl = new Array(nF).fill("T0");
    const evs = r.events.map((x) => ({ f: Math.max(0, Math.round((x.t * d.sfreq - e.win/2) / e.hop)), code: x.code })).sort((a, b) => a.f - b.f);
    for (let i = 0; i < evs.length; i++) { const f0 = Math.max(0, evs[i].f), f1 = i+1<evs.length?evs[i+1].f:nF; for (let f = f0; f < Math.min(nF, f1); f++) fl[f] = evs[i].code; }
    const bMu = new Float64Array(d.nCh), bBe = new Float64Array(d.nCh);
    for (let c = 0; c < d.nCh; c++) { let sm=0, sb=0, m=0; for (let f=0;f<nF;f++) if (fl[f]==="T0"){ sm+=e.bands.mu[c*nF+f]; sb+=e.bands.beta[c*nF+f]; m++; } bMu[c]=m?sm/m:1e-6; bBe[c]=m?sb/m:1e-6; }
    for (let f = 0; f < nF; f++) { const lab = fl[f]; if (lab!=="T1" && lab!=="T2") continue; const isL = lab==="T1";
      for (let c = 0; c < d.nCh; c++) { const mu=(bMu[c]-e.bands.mu[c*nF+f])/bMu[c], be=(bBe[c]-e.bands.beta[c*nF+f])/bBe[c], erd=0.5*(mu+be); if (isL) accL[c]+=erd; else accR[c]+=erd; }
      if (isL) nL++; else nR++;
    }
  }
  const left = new Float32Array(nCh), right = new Float32Array(nCh);
  for (let c = 0; c < nCh; c++) { left[c] = nL?accL[c]/nL:0; right[c] = nR?accR[c]/nR:0; }
  return { left, right, nL, nR };
}
function drawTopo2D(cv, p2, vals, vmin, vmax) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2), S = Math.max(2, Math.round(cv.clientWidth * dpr));
  cv.width = S; cv.height = S;
  const ctx = cv.getContext("2d"), R = S * 0.42, cx = S / 2, cy = S / 2, n = vals.length;
  const img = ctx.createImageData(S, S), data = img.data, rng = (vmax - vmin) || 1e-6;
  for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
    const dx = (px - cx) / R, dy = (py - cy) / R, rr = Math.hypot(dx, dy), o = (py * S + px) * 4;
    if (rr > 1.05) { data[o+3] = 0; continue; }
    const qx = dx, qy = -dy;
    let acc = 0, w = 0;
    for (let i = 0; i < n; i++) { const ex = p2[i*2], ey = p2[i*2+1], dd = (qx-ex)*(qx-ex)+(qy-ey)*(qy-ey), wi = 1/(dd+0.02); acc += wi*vals[i]; w += wi; }
    const col = magma((acc / w - vmin) / rng);
    data[o]=col[0]; data[o+1]=col[1]; data[o+2]=col[2]; data[o+3]= rr>1.0 ? Math.round(255*(1.05-rr)/0.05) : 255;
  }
  ctx.putImageData(img, 0, 0);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  for (let i = 0; i < n; i++) { const ex = cx + p2[i*2]*R, ey = cy - p2[i*2+1]*R; ctx.beginPath(); ctx.arc(ex, ey, 1.6*dpr, 0, 6.283); ctx.fill(); }
  ctx.strokeStyle = "rgba(233,237,246,0.55)"; ctx.lineWidth = 1.5*dpr;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.283); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx-6*dpr, cy-R); ctx.lineTo(cx, cy-R-9*dpr); ctx.lineTo(cx+6*dpr, cy-R); ctx.stroke();
}
let compareData = null;
async function openCompare() {
  const ov = $("compare"); if (!ov) return; ov.classList.remove("hidden");
  if (compareData) return;
  const spin = $("compare-spin"); if (spin) spin.style.display = "flex";
  try {
    compareData = await computeCompare();
    const p2 = projectTopo2D();
    const nc = compareData.left.length, latL = new Float32Array(nc), latR = new Float32Array(nc);   // each hand minus the other: cancels shared frontal/eye activity, isolates the contralateral motor cortex
    for (let c = 0; c < nc; c++) { const m = 0.5 * (compareData.left[c] + compareData.right[c]); latL[c] = compareData.left[c] - m; latR[c] = compareData.right[c] - m; }
    let vmax = 1e-6; for (const v of latL) vmax = Math.max(vmax, Math.abs(v)); const vmin = -vmax;
    drawTopo2D($("topoL"), p2, latL, vmin, vmax);
    drawTopo2D($("topoR"), p2, latR, vmin, vmax);
    const cap = $("compare-cap"); if (cap) cap.textContent = "Grand average of " + manifest.recordings.length + " runs · " + compareData.nL + " left / " + compareData.nR + " right imagery windows · each map is that hand minus the other.";
  } catch (e) { console.error(e); const cap = $("compare-cap"); if (cap) cap.textContent = "Could not compute: " + (e.message || e); }
  if (spin) spin.style.display = "none";
}

boot();
