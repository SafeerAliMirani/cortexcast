// eeg-data.js - loads CortexCast's converted EEGMMIDB recordings: the small
// manifest.json (metadata + real 10-10 electrode positions + T0/T1/T2 events)
// and, lazily, one recording's int16 signal blob at a time. Real PhysioNet
// data (eegmmidb, DOI 10.13026/C28G6P), reformatted offline by convert.py.

const BASE = "./data";

export async function loadManifest() {
  const r = await fetch(`${BASE}/manifest.json`);
  if (!r.ok) throw new Error("manifest.json: HTTP " + r.status + " — run convert.py first");
  return r.json();
}

// rec: one entry from manifest.recordings. Returns signals in microvolts as a
// channel-major Float32Array (channel c, sample s at index c*nSamp + s).
export async function loadRecording(rec) {
  const r = await fetch(`${BASE}/${rec.file}`);
  if (!r.ok) throw new Error(rec.file + ": HTTP " + r.status);
  const i16 = new Int16Array(await r.arrayBuffer());
  const scale = rec.scaleUV ?? 0.1;
  const uv = new Float32Array(i16.length);
  for (let k = 0; k < i16.length; k++) uv[k] = i16[k] * scale;
  return {
    uv, nCh: rec.nChannels, nSamp: rec.nSamples, sfreq: rec.sfreq,
    events: rec.events || [], id: rec.id,
  };
}

// Convenience: pull the sample index of an event and map T0/T1/T2 to a label.
export const CODE_LABEL = { T0: "rest", T1: "left fist", T2: "right fist" };
export function eventsToSamples(events, sfreq) {
  return events.map((e) => ({ sample: Math.round(e.t * sfreq), code: e.code, label: CODE_LABEL[e.code] || e.code }));
}
