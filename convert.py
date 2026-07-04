#!/usr/bin/env python3
"""
CortexCast data prep: downloads a few REAL recordings from PhysioNet's
EEG Motor Movement/Imagery Dataset (eegmmidb) and reformats the EDF+ files into
compact int16 blobs + a manifest.json that the browser app loads same-origin.

This is 100% real recorded data (PhysioNet eegmmidb v1.0.0, DOI 10.13026/C28G6P,
Open Data Commons Attribution License). The script only DOWNLOADS and REFORMATS
it, nothing is synthesised. It exists because the .edf files are EDF+ (browsers
can't parse) and PhysioNet doesn't send CORS headers (browsers can't fetch them
directly), so we convert a handful of runs once, offline, and bundle the result.

Run once:
    pip install mne numpy
    python convert.py
Then paste the output back so any channel/name issues can be fixed.
"""
import os, json, urllib.request, traceback
import numpy as np
import mne

BASE = "https://physionet.org/files/eegmmidb/1.0.0"
OUT  = os.path.join(os.path.dirname(__file__), "web", "data")
SCALE_UV = 0.1                      # microvolts per int16 unit (range +/-3276.8 uV)

# Left-vs-right hand MOTOR IMAGERY runs are R04, R08, R12 (T1=left fist,
# T2=right fist, T0=rest). Subjects to bundle (each ~7 MB for its 3 runs, lazy-loaded);
# trim or extend this list, then re-run this script.
SUBJECTS = ["S001", "S002", "S003", "S004", "S005", "S006"]
RUNS     = ["R04", "R08", "R12"]   # ONLY unilateral-fist IMAGERY runs; T1=left/T2=right holds ONLY for these
assert set(RUNS) <= {"R04", "R08", "R12"}, "Other eegmmidb runs use T1/T2 for different tasks (both fists / feet) and would mislabel the demo."

os.makedirs(OUT, exist_ok=True)

# Standard 10-10 electrode positions (case-insensitive lookup).
montage = mne.channels.make_standard_montage("standard_1005")
mpos = montage.get_positions()["ch_pos"]                 # name -> xyz (metres)
mlow = {k.lower(): (k, v) for k, v in mpos.items()}

def clean(name):                                          # 'Fc5.' -> 'Fc5', 'Cz..' -> 'Cz'
    return name.strip().strip(".").strip()

manifest, channels, unmapped_all = [], None, set()

for subj in SUBJECTS:
    for run in RUNS:
        rec = f"{subj}{run}"
        edf = os.path.join(OUT, rec + ".edf")
        try:
            if not os.path.exists(edf):
                url = f"{BASE}/{subj}/{rec}.edf"
                print("  downloading", url, flush=True)
                urllib.request.urlretrieve(url, edf)
            raw = mne.io.read_raw_edf(edf, preload=True, verbose="ERROR")
            sf = int(round(raw.info["sfreq"]))
            labels = [clean(c) for c in raw.ch_names]

            # electrode xyz (compute once; identical montage across recordings)
            xyz, miss = [], []
            for lb in labels:
                hit = mlow.get(lb.lower())
                if hit: xyz.append([round(float(v), 4) for v in hit[1]])
                else:   xyz.append([0.0, 0.0, 0.0]); miss.append(lb)
            unmapped_all.update(miss)

            # signals -> microvolts -> int16, channel-major [nCh, nSamp]
            data_uv = raw.get_data() * 1e6
            q = np.clip(np.round(data_uv / SCALE_UV), -32768, 32767).astype("<i2")
            q.tofile(os.path.join(OUT, rec + ".i16"))

            events = [{"t": round(float(o), 3), "code": str(d)}
                      for o, d in zip(raw.annotations.onset, raw.annotations.description)]

            manifest.append({
                "id": rec, "subject": subj, "run": run,
                "task": "motor imagery: T0 rest, T1 left fist, T2 right fist",
                "sfreq": sf, "nChannels": len(labels), "nSamples": int(q.shape[1]),
                "scaleUV": SCALE_UV, "layout": "int16 little-endian, channel-major [nCh][nSamp]",
                "file": rec + ".i16", "events": events,
            })
            if channels is None:
                channels = [{"label": lb, "xyz": p} for lb, p in zip(labels, xyz)]
            print(f"  ok {rec}: {q.shape[0]} ch x {q.shape[1]} samp @ {sf}Hz, {len(events)} events", flush=True)
        except Exception:
            print(f"  FAILED {rec}:\n{traceback.format_exc()}", flush=True)

json.dump({
    "dataset": "PhysioNet EEG Motor Movement/Imagery Dataset (eegmmidb) v1.0.0",
    "doi": "10.13026/C28G6P",
    "license": "Open Data Commons Attribution License v1.0",
    "citation": "Schalk G. (2009). EEG Motor Movement/Imagery Dataset. PhysioNet.",
    "note": "Real recordings; EDF+ reformatted to int16 + JSON by convert.py. Nothing synthesised.",
    "channels": channels,
    "recordings": manifest,
}, open(os.path.join(OUT, "manifest.json"), "w"), indent=1)

print(f"\nDone: {len(manifest)} recordings -> {OUT}")
if unmapped_all:
    print("!! Unmapped channel names (need a fix):", sorted(unmapped_all))
    raise SystemExit("Aborting: unmapped channels would get [0,0,0] positions and corrupt the topomap. Fix the montage mapping.")
else:
    print("All channels mapped to 10-10 positions.")
print("Tip: the .edf files are gitignored; commit the .i16 + manifest.json.")
