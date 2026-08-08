import { terrainHeight, climate } from './terrainCommon.js';

/**
 * A square patch of terrain sampled on the CPU around the aircraft, built up a
 * few rows per frame so it never stalls a frame. Two colourings are produced
 * from the same heights: a chart-style map, and an EGPWS-style terrain
 * awareness view where colour is relative to the aircraft's altitude.
 */
export class TerrainMap {
  constructor(size = 112) {
    this.N = size;
    this.heights = new Float32Array((size + 1) * (size + 1));

    this.map = document.createElement('canvas');
    this.map.width = this.map.height = size;
    this.mapCtx = this.map.getContext('2d');
    this.mapImg = this.mapCtx.createImageData(size, size);

    this.awareness = document.createElement('canvas');
    this.awareness.width = this.awareness.height = size;
    this.awareCtx = this.awareness.getContext('2d');
    this.awareImg = this.awareCtx.createImageData(size, size);

    this.half = 20 * 1852;
    this.origin = { x: 0, z: 0, half: 0 };
    this.ready = false;
    this.job = null;
    this._awareAlt = -1e9;
  }

  setHalfExtent(h) {
    if (h === this.half) return;
    this.half = h;
    this.job = null;
    this.ready = false;
  }

  /** Sample a slice; call once per frame. */
  tick(px, pz) {
    const N = this.N;
    const moved = Math.hypot(px - this.origin.x, pz - this.origin.z);
    if (!this.job && (moved > this.half * 0.10 || this.half !== this.origin.half || !this.ready)) {
      this.job = { x: px, z: pz, half: this.half, row: 0 };
    }
    if (!this.job) return;
    const j = this.job;
    const rows = Math.min(N + 1 - j.row, 6);
    const step = (j.half * 2) / N;
    for (let r = 0; r < rows; r++) {
      const zz = j.z - j.half + (j.row + r) * step;
      for (let i = 0; i <= N; i++) {
        const xx = j.x - j.half + i * step;
        this.heights[(j.row + r) * (N + 1) + i] = terrainHeight(xx, zz, 1 / (step * 2));
      }
    }
    j.row += rows;
    if (j.row > N) {
      this.colorize(j);
      this.origin = { x: j.x, z: j.z, half: j.half };
      this.ready = true;
      this.job = null;
      this._awareAlt = -1e9;      // force the awareness layer to refresh
    }
  }

  colorize(j) {
    const N = this.N, d = this.mapImg.data;
    const step = (j.half * 2) / N;
    for (let r = 0; r < N; r++) {
      for (let i = 0; i < N; i++) {
        const h = this.heights[r * (N + 1) + i];
        const hx = this.heights[r * (N + 1) + i + 1];
        const hz = this.heights[(r + 1) * (N + 1) + i];
        const o = (r * N + i) * 4;
        let R, G, B;
        if (h < 0) {
          const t = Math.min(-h / 900, 1);
          R = 12 + 26 * (1 - t); G = 46 + 76 * (1 - t); B = 92 + 78 * (1 - t);
        } else {
          const cl = climate(j.x - j.half + i * step, j.z - j.half + r * step);
          const warm = smooth(0.56, 0.82, cl.t), cold = 1 - smooth(0.18, 0.46, cl.t);
          const wet = smooth(0.22, 0.66, cl.m);
          R = 96 + warm * 80 - wet * 44 + cold * 24;
          G = 112 + wet * 22 - warm * 22 + cold * 20;
          B = 68 - wet * 20 + cold * 40 + warm * 6;
          const alt = Math.min(h / 2600, 1);
          R += alt * 90; G += alt * 88; B += alt * 96;
          if (h < 12) { R = R * 0.5 + 118; G = G * 0.5 + 108; B = B * 0.5 + 74; }
          const sl = (h - hx) + (h - hz);
          const sh = Math.max(0.58, Math.min(1.42, 1 + sl / (step * 2.4)));
          R *= sh; G *= sh; B *= sh;
        }
        d[o] = c255(R); d[o + 1] = c255(G); d[o + 2] = c255(B); d[o + 3] = 255;
      }
    }
    this.mapCtx.putImageData(this.mapImg, 0, 0);
  }

  /**
   * EGPWS colouring: red where terrain is at or above you, amber just below,
   * green well below, transparent where it is no threat at all.
   */
  updateAwareness(refAlt) {
    if (!this.ready || Math.abs(refAlt - this._awareAlt) < 60) return;
    this._awareAlt = refAlt;
    const N = this.N, d = this.awareImg.data;
    for (let r = 0; r < N; r++) {
      for (let i = 0; i < N; i++) {
        const h = this.heights[r * (N + 1) + i];
        const rel = h - refAlt;                    // metres above the aircraft
        const o = (r * N + i) * 4;
        let R = 0, G = 0, B = 0, A = 0;
        if (h > 0.5) {
          if (rel > -610) { R = 190; G = 30; B = 30; A = 200; }          // within 2000 ft
          else if (rel > -1000) { R = 205; G = 150; B = 20; A = 175; }   // within 3300 ft
          else if (rel > -2000) { R = 30; G = 130; B = 45; A = 150; }
          else { A = 0; }
        }
        d[o] = R; d[o + 1] = G; d[o + 2] = B; d[o + 3] = A;
      }
    }
    this.awareCtx.putImageData(this.awareImg, 0, 0);
  }
}

function smooth(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
function c255(v) { return v < 0 ? 0 : v > 255 ? 255 : v | 0; }
