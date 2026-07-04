// labels.js - floating 10-20 electrode name tags (Cz, C3, Fpz, ...). Each frame we
// project the electrode's 3D position to the screen and place a small HTML tag, hiding
// the ones on the far side of the head so it reads like the standard cap diagrams.

export function makeElectrodeLabels(box, labels, canvas, camera) {
  const els = labels.map((t) => {
    const el = document.createElement("div");
    el.className = "e-label";
    el.textContent = t;
    box.appendChild(el);
    return el;
  });
  let show = true;
  return {
    toggle() { show = !show; if (!show) for (const el of els) el.style.display = "none"; return show; },
    update(vp, disc) {
      if (!show) return;
      const cw = canvas.clientWidth, ch = canvas.clientHeight;
      const eye = camera.eye(), eL = Math.hypot(eye[0], eye[1], eye[2]) || 1;
      for (let i = 0; i < els.length; i++) {
        const el = els[i], x = disc[i * 4], y = disc[i * 4 + 1], z = disc[i * 4 + 2];
        const facing = (x * eye[0] + y * eye[1] + z * eye[2]) / ((Math.hypot(x, y, z) || 1) * eL);
        const w = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
        if (w <= 0 || facing < 0.0) { el.style.display = "none"; continue; }   // hide only the far (back) hemisphere; show every tag facing the camera, incl. the ear/temple ones
        const sx = ((vp[0] * x + vp[4] * y + vp[8] * z + vp[12]) / w * 0.5 + 0.5) * cw;
        const sy = (1 - ((vp[1] * x + vp[5] * y + vp[9] * z + vp[13]) / w * 0.5 + 0.5)) * ch;
        el.style.display = "block"; el.style.left = sx + "px"; el.style.top = sy + "px";
      }
    },
  };
}
