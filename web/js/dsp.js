// dsp.js - real signal processing for CortexCast. A radix-2 FFT, plus sliding
// short-time band-power envelopes (mu 8-12 Hz, beta 13-30 Hz) computed per
// channel with a Hann window. Pure JS, run
// once when a recording loads; the envelopes then drive the live scalp topomap
// and the left/right classifier by playback time.

// In-place iterative radix-2 FFT of complex arrays re[], im[] (length = 2^k).
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cwr = 1, cwi = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = i + k + len / 2;
        const tr = re[b] * cwr - im[b] * cwi, ti = re[b] * cwi + im[b] * cwr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const ncwr = cwr * wr - cwi * wi; cwi = cwr * wi + cwi * wr; cwr = ncwr;
      }
    }
  }
}

function hann(n) { const w = new Float32Array(n); for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)); return w; }

// Compute per-channel band-power envelopes. uv is channel-major [nCh*nSamp].
// Returns { hop, nFrames, bands:{mu:Float32Array[nCh*nFrames], beta:...},
//           binHz } with each value = mean power in that band per window.
export function bandEnvelopes(uv, nCh, nSamp, sfreq, win = 128, hop = 8) {
  const w = hann(win);
  const binHz = sfreq / win;
  const bands = {
    mu:   [Math.ceil(8 / binHz), Math.floor(12 / binHz)],    // bins strictly inside 8-12 Hz
    beta: [Math.ceil(13 / binHz), Math.floor(30 / binHz)],  // and 13-30 Hz; non-overlapping
  };
  const nFrames = Math.max(1, Math.floor((nSamp - win) / hop) + 1);
  const out = { hop, win, nFrames, binHz, bands: { mu: new Float32Array(nCh * nFrames), beta: new Float32Array(nCh * nFrames) } };
  const re = new Float32Array(win), im = new Float32Array(win);
  for (let c = 0; c < nCh; c++) {
    const base = c * nSamp;
    for (let f = 0; f < nFrames; f++) {
      const s0 = f * hop;
      for (let i = 0; i < win; i++) { re[i] = uv[base + s0 + i] * w[i]; im[i] = 0; }
      fft(re, im);
      for (const [name, [b0, b1]] of Object.entries(bands)) {
        let p = 0; for (let b = b0; b <= b1; b++) p += re[b] * re[b] + im[b] * im[b];
        out.bands[name][c * nFrames + f] = p / (b1 - b0 + 1);
      }
    }
  }
  return out;
}
