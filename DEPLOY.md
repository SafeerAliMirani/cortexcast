# Deploying CortexCast

CortexCast is a static site with **no build step**. The app lives in **`web/`**
(the publish directory, set by `netlify.toml`). Visitors need a WebGPU browser
(Chrome/Edge 113+, desktop Safari 18+).

## Before deploying: generate the data (once)

Unlike the live-streaming projects, CortexCast bundles its (real) EEG. Run the
converter first so `web/data/` contains the `.i16` blobs + `manifest.json`:

```bash
pip install mne numpy
python convert.py
```

The `.edf` downloads are gitignored; the small `.i16` + `manifest.json` **are**
committed (they're the bundled real data the site serves). Confirm they exist:
`ls web/data` should show `manifest.json` and several `S00xR0y.i16`.

## Recommended: private GitHub repo → Netlify

### 1. Create the repo
- github.com → **New repository** → name `cortexcast` → **Private** → **Create** (empty).

### 2. Push
```bash
cd "…/new project for cv/CortexCast"
git init -b main
git add .
git commit -m "CortexCast — in-browser motor-imagery EEG decoder (WebGPU)"
git remote add origin https://github.com/SafeerAliMirani/cortexcast.git
git push -u origin main
```
(The `.i16` data files go up with everything else; the `.edf` files are ignored.)

### 3. Connect on Netlify
- app.netlify.com → **Add new site → Import an existing project → GitHub** → pick `cortexcast`.
- Settings auto-fill from `netlify.toml`: build command blank, publish `web`.
- **Deploy.** Rename the site to `cortexcast` → `https://cortexcast.netlify.app`.

## After it's live
Add the URL to `PORTFOLIO.md`, your résumé, and your portfolio site.
