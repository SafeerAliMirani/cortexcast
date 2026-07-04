// camera.js - orbit camera: arcball grab-drag with momentum and smooth zoom.
import { perspective, lookAt, multiply } from "./mat.js";

const INERTIA_DECAY = 3.5;
const INERTIA_EPS = 1e-4;

export class OrbitCamera {
  constructor() {
    this.target = [0, 0, 0];
    this.distance = 2.6;
    this.azimuth = 0.6;
    this.elevation = 0.35;
    this.fov = (45 * Math.PI) / 180;
    this.near = 0.01;
    this.far = 50;
    this.minDist = 1.15;
    this.maxDist = 8;
    this._elevLimit = Math.PI / 2 - 0.02;
    this._dragging = false;
    this._velAz = 0;
    this._velEl = 0;
  }

  eye() {
    const ce = Math.cos(this.elevation);
    return [
      this.distance * ce * Math.cos(this.azimuth),
      this.distance * Math.sin(this.elevation),
      this.distance * ce * Math.sin(this.azimuth),
    ];
  }

  orbit(dAz, dEl) {
    this.azimuth += dAz;
    this.elevation = Math.max(-this._elevLimit, Math.min(this._elevLimit, this.elevation + dEl));
  }

  rotateByPixels(dx, dy, viewportHeight) {
    const h = viewportHeight || 1;
    const rate = (this.fov / h) * (this.distance / 2.6);
    const dAz = dx * rate, dEl = dy * rate;
    this.azimuth += dAz;
    this.elevation = Math.max(-this._elevLimit, Math.min(this._elevLimit, this.elevation + dEl));
    const dtGuess = 1 / 60;
    this._velAz = dAz / dtGuess;
    this._velEl = dEl / dtGuess;
  }

  beginDrag() { this._dragging = true; this._velAz = 0; this._velEl = 0; }
  endDrag() { this._dragging = false; }

  update(dt) {
    if (this._dragging) return;
    if (this._velAz === 0 && this._velEl === 0) return;
    this.azimuth += this._velAz * dt;
    this.elevation = Math.max(-this._elevLimit, Math.min(this._elevLimit, this.elevation + this._velEl * dt));
    const damp = Math.exp(-dt * INERTIA_DECAY);
    this._velAz *= damp; this._velEl *= damp;
    if (Math.abs(this._velAz) < INERTIA_EPS) this._velAz = 0;
    if (Math.abs(this._velEl) < INERTIA_EPS) this._velEl = 0;
  }

  zoom(factor) { this.distance = Math.max(this.minDist, Math.min(this.maxDist, this.distance * factor)); }
  zoomBy(factor) { this.zoom(factor); }

  viewProj(aspect) {
    const proj = perspective(this.fov, aspect, this.near, this.far);
    const view = lookAt(this.eye(), this.target, [0, 1, 0]);
    return multiply(proj, view);
  }
}
