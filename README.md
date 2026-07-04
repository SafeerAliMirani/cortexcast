# CortexCast

**A browser brain–computer-interface demo: real motor-imagery EEG replays as a live WebGPU scalp map, and a decoder reads left-vs-right hand imagery from the motor cortex — zero install, hand-written WGSL.**

_By **Dr. Safeer Ali Mirani** — GPU / XR / real-time visualisation engineer and computational neuroscientist (PhD)._

CortexCast loads real 64-channel EEG from people imagining left- or right-hand movement (the **PhysioNet EEG Motor Movement/Imagery** dataset), computes **μ (8–12 Hz)** and **β (13–30 Hz)** band power live with an in-browser FFT, and paints a rotating 3D scalp map whose colour is a GPU-interpolated blend of the 64 electrodes (hand-written WGSL, with contour isolines and a coverage mask). A decoder watches the **event-related desynchronisation** over the C3/C4 motor region — the opposite cortex quiets when you imagine a hand — and calls **left vs right**, scoring itself against the true cue. This is the exact kind of EEG/BCI analysis I do in MATLAB/MNE, rebuilt to run for anyone with a browser.

## Honest by design

This is an **offline replay** of recorded data with a live read-out — a BCI-*style* demo, not a closed-loop BCI. The "decoder" is a physiology-based μ/β ERD contrast (C3/C4 motor ROI, 2 s window), **not** a trained classifier: **~60–66%** agreement with the cue on 2-class left/right (chance = 50%) — in-sample, not a held-out classifier score. The scalp colour shows **raw** band power; the decoder uses baseline-relative ERD. Every recording is real, cited, and only **reformatted** (never synthesised).

## Features

- **Real EEG, in your browser** — 64-channel motor-imagery recordings; μ/β power via a hand-written radix-2 FFT (dsp.js).
- **GPU scalp map** — a sphere whose every fragment is an inverse-distance blend of the 64 electrode values, in raw WGSL, with contour isolines and a neutral-scalp coverage mask (no smear where there are no sensors). Depth buffer + 4× MSAA.
- **Live decoder** — mean μ/β ERD over a right vs left motor ROI across a 2 s trailing window → left / right / rest, with a ✓/✗ against the actual cue and a strength read-out.
- **Scrolling EEG** — C3 / Cz / C4 raw traces with shaded cue windows and a playhead.
- **Explore** — rotate the head, scroll to zoom, switch subjects/runs, toggle μ/β, play / scrub.

## Real, public data — and how it's loaded

Unlike a live-streaming demo, EEG can't be fetched straight into the browser: PhysioNet files are **EDF+** (browsers can't parse) and **CORS-blocked**, and the full set is 3.4 GB. So `convert.py` runs once, offline, to download a handful of real recordings and reformat them into compact `int16` blobs + a `manifest.json` (signals, real 10-10 electrode positions, T0/T1/T2 event labels) bundled in `web/data/`. The app then loads real, cited recordings same-origin, one at a time.

| Source | What | How |
|---|---|---|
| **PhysioNet eegmmidb** (DOI 10.13026/C28G6P, ODC-BY) | 64-ch motor-imagery EEG | downloaded + converted offline by `convert.py`, bundled as int16 + manifest |

## Run it

```bash
# one-time data prep (real recordings -> web/data/)
pip install mne numpy
python convert.py

# serve
cd web
python serve.py        # then open http://localhost:8080
```

Requirements: a WebGPU browser (Chrome/Edge 113+ or desktop Safari 18+), Python 3 + MNE for the one-time conversion. `serve.py` just disables caching for local dev.

## Prior art & what's different

EEG topographic maps are standard — MNE-Python, EEGLAB, and BCI toolkits all draw them, and motor-imagery decoding is a classic BCI benchmark. Those live in desktop Python/MATLAB. CortexCast is different in *where and how* it runs: the topomap is computed **on the GPU in hand-written WGSL** (not matplotlib), the FFT and decoder run **live in the browser** with no server or install, and it's honest about being a physiological contrast rather than a tuned classifier. The differentiator is the same as the rest of my portfolio — real data, raw WebGPU, open in a link.

## Architecture

Plain ES modules, no bundler. `convert.py` (data prep) → `web/data/` → the app.

| Module | Role |
|---|---|
| `convert.py` | one-time: PhysioNet EDF+ → int16 + manifest.json (signals, 10-10 positions, events) |
| `web/js/eeg-data.js` | loads manifest + one recording's int16 (lazy), int16→µV |
| `web/js/dsp.js` | radix-2 FFT; μ/β band-power envelopes; spectrogram |
| `web/js/geom.js` | scalp sphere mesh; normalises electrodes to a unit head (y-up) |
| `web/js/shaders.js` | WGSL: scalp-power topomap (interpolation + isolines + coverage) and electrode discs |
| `web/js/render-core.js` | WebGPU device, pipelines, depth + 4× MSAA |
| `web/js/camera.js` · `mat.js` | arcball camera + matrix math |
| `web/js/app.js` | orchestrator: load, band power, topomap, ERD decoder, traces, UI |

## Tech highlights

- **GPU topographic interpolation** — 64-electrode inverse-distance blend per fragment in WGSL, with `fwidth`-based contour isolines and a coverage mask so the sensor-free scalp reads neutral.
- **Real in-browser DSP** — hand-written FFT computes μ/β power per channel; per-band, baseline-relative ERD drives the decoder so μ and β contribute on equal footing.
- **Honest decoding** — contralateral C3/C4 ERD over a 2 s window; self-scored against the cue; ~60–66% 2-class (in-sample, not held-out), stated on screen.
- **Robust data path** — offline EDF+→int16 conversion with cited provenance; lazy per-recording load; atomic recording swaps.

## Data source & credit

- **EEG** — [PhysioNet EEG Motor Movement/Imagery Dataset](https://physionet.org/content/eegmmidb/1.0.0/) (Schalk et al.; DOI 10.13026/C28G6P; Open Data Commons Attribution License). Reformatted, not redistributed wholesale.

## Author

**Dr. Safeer Ali Mirani** — GPU / XR / real-time visualisation engineer and computational neuroscientist (PhD).
[safeer.ali.mirani@gmail.com](mailto:safeer.ali.mirani@gmail.com) · [Portfolio](https://safeeralimirani.netlify.app) · [GitHub](https://github.com/SafeerAliMirani) · [LinkedIn](https://www.linkedin.com/in/safeeralimirani)

## License

[MIT](LICENSE) © 2026 Dr. Safeer Ali Mirani. EEG data © its authors (ODC-BY), loaded via a documented offline conversion.

## Credits

Head geometry: the *LeePerry Smith* head scan from the three.js examples (Infinite-Realities, CC-BY) — loaded from a CDN and parsed by hand; no three.js runtime is used. All EEG data: PhysioNet EEGMMIDB (ODC-BY). Falls back to a procedural sphere if the model can't be fetched.
