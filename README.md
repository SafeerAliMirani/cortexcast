<h1 align="center">CortexCast</h1>
<p align="center"><b>Real motor-imagery EEG, decoded live in your browser: a hand-written WGSL scalp topomap over a real head mesh, zero install.</b></p>

<p align="center">
  <a href="https://cortexcast.netlify.app"><img src="https://img.shields.io/badge/Live_Demo-cortexcast.netlify.app-2ea44f?style=for-the-badge&logo=netlify&logoColor=white" alt="Live Demo"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/WebGPU-raw_%26_handwritten-ff6f00?style=for-the-badge" alt="WebGPU">
  <img src="https://img.shields.io/badge/WGSL-raw_shaders-9b59b6?style=for-the-badge" alt="WGSL">
  <img src="https://img.shields.io/badge/JavaScript-ES_modules-f7df1e?style=for-the-badge&logo=javascript&logoColor=black" alt="JavaScript">
  <img src="https://img.shields.io/badge/dependencies-none-4dd08a?style=for-the-badge" alt="No dependencies">
  <img src="https://img.shields.io/badge/License-MIT-3178c6?style=for-the-badge" alt="MIT License">
</p>

**Live demo: [cortexcast.netlify.app](https://cortexcast.netlify.app)**

Built by [Dr. Safeer Ali Mirani](https://github.com/SafeerAliMirani), GPU / XR / real-time visualisation engineer and computational neuroscientist.

## 🧠 What it does

CortexCast replays real 64-channel EEG recorded while people imagined moving their left or right hand (the PhysioNet EEG Motor Movement/Imagery dataset), computes mu (8 to 12 Hz) and beta (13 to 30 Hz) band power live with an in-browser FFT, and paints the result on a rotating 3D head as a GPU-interpolated scalp topomap. A decoder watches the motor cortex go quiet on the side opposite the imagined hand and calls left vs right, scoring itself against the real cue as it plays.

Everything runs in raw WebGPU with hand-written WGSL. No three.js, no plotting library, no ML framework. Open the link and it just works in a modern browser.

## ⚙️ How it works

**The data is real, and it's bundled.** PhysioNet's files are EDF+ (browsers can't parse that) and the server doesn't send CORS headers (browsers can't fetch it directly anyway), so `convert.py` runs once, offline: it downloads a handful of real recordings via MNE, reads the official 10-10 electrode positions, and reformats everything into compact `int16` blobs plus a `manifest.json`. Nothing is synthesised, only reformatted. The app then loads these same-origin, one recording at a time.

**The FFT is hand-written.** `web/js/dsp.js` implements an in-place radix-2 FFT from scratch and slides a Hann-windowed frame across each channel to get mu and beta power over time. No signal-processing library involved.

**The head is a real 3D scan, parsed by hand.** `web/js/mesh.js` fetches the LeePerrySmith head model (from the three.js examples) as a raw `.glb` file and parses the glTF binary container itself, reading out vertex positions and indices with a `DataView`. There's no three.js runtime here, just the file format understood and decoded directly.

**The electrode cap is co-registered onto the head, not eyeballed.** `web/js/mesh.js` scans the parsed mesh for anatomical landmarks (crown, both ears, inion, nasion) by their geometry. `web/js/geom.js` then solves the affine transform that maps the official montage's anatomical anchors onto those detected landmarks, places all 64 electrodes accordingly, and snaps each one to the nearest real scalp vertex. This is the same landmark-based approach EEG software uses to fit a cap to a head.

**The topomap is computed per-pixel on the GPU.** `web/js/shaders.js` is raw WGSL: every fragment on the scalp is an inverse-distance-weighted blend of all 64 electrode values, with `fwidth`-based contour isolines and a coverage mask so areas with no nearby sensors read as neutral scalp instead of smearing. `web/js/render-core.js` wires up the WebGPU pipelines with a depth buffer and 4x MSAA.

**The decoder is a physiological contrast, not a trained model.** `web/js/app.js` computes per-band event-related desynchronisation, ERD, as `(baseline - power) / baseline` over two motor regions of interest centered on C3 (left hemisphere) and C4 (right hemisphere), averaged across a 2 second trailing window. Since the opposite hemisphere desynchronises during imagined movement, a stronger right-side drop means left-hand imagery and vice versa. The app thresholds that contrast into left, right, or rest, and checks it against the actual cue live on screen.

## 🚀 Tech highlights

- Raw WebGPU end to end: hand-written WGSL shaders, hand-built pipelines, no rendering library.
- A from-scratch radix-2 FFT driving real spectral analysis, not a stand-in for one.
- A `.glb` glTF file parsed by hand from its binary layout, no three.js or glTF loader.
- 10-10 montage co-registration by detected anatomical landmarks and a solved affine transform, the same principle real EEG cap-fitting uses.
- A GPU-side topographic interpolation with contour isolines and a coverage mask, computed per-fragment in the fragment shader.

## 🔍 Honest by design

This is an **offline replay** of recorded data with a live read-out, not a closed-loop brain-computer interface. The decoder is a **physiological contrast** (contralateral C3/C4 ERD), not a trained or cross-validated classifier. The accuracy figure, around 60 to 66 percent on 2-class left/right against a 50 percent chance baseline, is measured **in-sample**, not on held-out data. All of this is stated on screen in the app itself, not just here.

## 🏃 Run it locally

```bash
# one-time data prep: downloads real recordings and converts them
pip install mne numpy
python convert.py

# serve the app (disables caching so you always see the latest files)
cd web
python serve.py
# open http://localhost:8080
```

`convert.py` is what regenerates everything in `web/data/`, the small `.i16` signal blobs plus `manifest.json` (channel positions, sample rate, event timing). Run it once and the app is fully self-contained after that, no server-side code, no build step, just static files. You'll need a WebGPU browser: Chrome or Edge 113+, or desktop Safari 18+.

## 📊 Data & credits

- **EEG**: [PhysioNet EEG Motor Movement/Imagery Dataset](https://physionet.org/content/eegmmidb/1.0.0/) (Schalk et al.), DOI [10.13026/C28G6P](https://doi.org/10.13026/C28G6P), Open Data Commons Attribution License v1.0. Reformatted for this app, not redistributed wholesale.
- **Head model**: the LeePerrySmith head scan from the [three.js examples](https://github.com/mrdoob/three.js) (Infinite-Realities), CC-BY. Fetched from a CDN and parsed by hand; falls back to a procedural sphere if it can't load.

## 📜 License

[MIT](LICENSE) © 2026 Dr. Safeer Ali Mirani. EEG data is © its authors under ODC-BY and loaded via the documented conversion above, not relicensed.

## Author

Built by **Dr. Safeer Ali Mirani**, GPU / XR / real-time visualisation engineer and computational neuroscientist (PhD).

[safeer.ali.mirani@gmail.com](mailto:safeer.ali.mirani@gmail.com) · [Portfolio](https://safeeralimirani.netlify.app) · [GitHub](https://github.com/SafeerAliMirani) · [LinkedIn](https://www.linkedin.com/in/safeeralimirani)
