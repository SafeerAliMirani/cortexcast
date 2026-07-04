# CortexCast — portfolio & CV framing

**Dr. Safeer Ali Mirani** · GPU / XR / real-time visualisation engineer · computational neuroscientist (PhD)
[safeer.ali.mirani@gmail.com](mailto:safeer.ali.mirani@gmail.com) · [Portfolio](https://safeeralimirani.netlify.app) · [GitHub](https://github.com/SafeerAliMirani) · [LinkedIn](https://www.linkedin.com/in/safeeralimirani)

🔗 **Live demo: [cortexcast.netlify.app](https://cortexcast.netlify.app)**

Reusable copy for a CV, portfolio site, or LinkedIn. All claims are accurate and verifiable.

## Résumé bullets

- Built **CortexCast**, a zero-install browser BCI-style demo that replays real 64-channel motor-imagery EEG (PhysioNet eegmmidb), computes μ/β band power live with a **hand-written in-browser FFT**, and renders a 3D scalp topographic map as an inverse-distance GPU interpolation over the 64 electrodes in **hand-written WGSL** (contour isolines, coverage mask, depth + 4× MSAA) — no three.js, no plotting library.
- Implemented a **left-vs-right motor-imagery decoder** from contralateral C3/C4 event-related desynchronisation (per-band ERD over a 2 s window), self-scored against the stimulus cue at **~60–66%** agreement (in-sample descriptive contrast, not a cross-validated classifier) — the real EEG/BCI analysis pipeline, shipped to the browser and honestly framed.

## Portfolio blurb (2–3 sentences)

CortexCast turns real brain-computer-interface data into something you can open in a link: 64-channel EEG of people imagining left- or right-hand movement replays as a rotating scalp map of μ/β rhythms, computed on the GPU, while a decoder reads the motor cortex and calls which hand — scoring itself against the truth. It pairs genuine EEG signal processing (in-browser FFT, event-related desynchronisation) with a hand-written WebGPU renderer, and states its own limits (a physiological contrast, not a tuned classifier; ~60–66% vs 50% chance). It's the exact analysis I do in MATLAB/MNE, made explorable by anyone.

## Interview talking points

1. **GPU topographic interpolation.** Every scalp fragment is an inverse-distance blend of 64 electrode values in WGSL, with `fwidth`-based contour isolines and a coverage mask so the sensor-free head reads neutral instead of smeared.
2. **Real DSP in the browser.** A hand-written radix-2 FFT computes μ/β power per channel; the decoder uses **per-band, baseline-relative ERD** so μ and β (very different scales) contribute equally — a subtle bug I caught and fixed.
3. **Honest decoding.** Contralateral C3/C4 desynchronisation over a trailing window; self-scored ✓/✗ against the cue; the ~60–66% number is on screen. The right posture for a scientific tool.
4. **A real data pipeline.** PhysioNet EDF+ is CORS-blocked and browser-unparseable, so I built an offline converter (MNE) to bundle cited int16 recordings + 10-10 positions + event labels, loaded lazily per recording.
5. **Robust real-time app.** Atomic recording swaps (no stale-state races), reused GPU buffers (no per-frame GC churn), depth/MSAA, device-loss handling.

## One-line version

*Real motor-imagery EEG decoded live in the browser: hand-written WGSL scalp topomap + in-browser FFT + a self-scored left/right physiology-based read-out, zero install. — Dr. Safeer Ali Mirani*
