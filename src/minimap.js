import { terrainHeight, climate, RWY_LENGTH } from './terrainCommon.js';
import { airportsNear } from './airports.js';

const NM = 1852;
export const RANGES = [5, 10, 20, 40, 80, 160];
const N = 112;                       // terrain samples per side

export class Minimap {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.size = 280;
    this.rangeIdx = 2;

    this.map = document.createElement('canvas');
    this.map.width = this.map.height = N;
    this.mapCtx = this.map.getContext('2d');
    this.img = this.mapCtx.createImageData(N, N);
    this.heights = new Float32Array((N + 1) * (N + 1));

    this.job = null;
    this.ready = false;
    this.origin = { x: 0, z: 0, half: 0 };
    this._airports = [];
    this._apAt = { x: 1e9, z: 1e9 };
  }

  resize(dpr) {
    this.cv.width = this.size * dpr;
    this.cv.height = this.size * dpr;
    this.cv.style.width = this.size + 'px';
    this.cv.style.height = this.size + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dpr = dpr;
  }

  cycleRange(dir) {
    this.rangeIdx = (this.rangeIdx + dir + RANGES.length) % RANGES.length;
    this.job = null; this.ready = false;
  }

  get halfExtent() { return RANGES[this.rangeIdx] * NM; }

  /** Progressive terrain sampling — a slice per frame keeps the frame rate flat. */
  tick(px, pz) {
    const half = this.halfExtent;
    const moved = Math.hypot(px - this.origin.x, pz - this.origin.z);
    if (!this.job && (moved > half * 0.10 || half !== this.origin.half || !this.ready)) {
      this.job = { x: px, z: pz, half, row: 0 };
    }
    if (this.job) {
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
      }
    }
    if (Math.hypot(px - this._apAt.x, pz - this._apAt.z) > 4000) {
      this._apAt = { x: px, z: pz };
      this._airports = airportsNear(px, pz, Math.max(half * 1.5, 60000), 40);
    }
  }

  colorize(j) {
    const d = this.img.data;
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
          // hillshade with the sun in the north-west
          const sl = (h - hx) + (h - hz);
          const sh = Math.max(0.58, Math.min(1.42, 1 + sl / (step * 2.4)));
          R *= sh; G *= sh; B *= sh;
        }
        d[o] = clamp255(R); d[o + 1] = clamp255(G); d[o + 2] = clamp255(B); d[o + 3] = 255;
      }
    }
    this.mapCtx.putImageData(this.img, 0, 0);
  }

  draw(ac) {
    const g = this.ctx, S = this.size, C = S / 2;
    const half = this.halfExtent;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, S, S);

    g.save();
    g.beginPath(); g.arc(C, C, C - 3, 0, 7); g.clip();

    g.fillStyle = '#0a1018'; g.fillRect(0, 0, S, S);

    // terrain, offset so the aircraft stays centred between rebuilds
    if (this.ready) {
      const scale = S / (half * 2) * (this.origin.half * 2 / (this.origin.half * 2));
      const pxPerM = S / (half * 2);
      const w = this.origin.half * 2 * pxPerM;
      const ox = C + (this.origin.x - ac.pos.x) * pxPerM - w / 2;
      const oy = C + (this.origin.z - ac.pos.z) * pxPerM - w / 2;
      g.imageSmoothingEnabled = true;
      g.globalAlpha = 0.95;
      g.drawImage(this.map, ox, oy, w, w);
      g.globalAlpha = 1;
    }

    const toPx = (x, z) => [
      C + (x - ac.pos.x) / half * (S / 2),
      C + (z - ac.pos.z) / half * (S / 2),
    ];

    // range rings
    g.strokeStyle = 'rgba(140,190,220,0.28)'; g.lineWidth = 1;
    for (const f of [1 / 3, 2 / 3, 1]) {
      g.beginPath(); g.arc(C, C, (S / 2 - 3) * f, 0, 7); g.stroke();
    }

    // airports
    for (const ap of this._airports) {
      const [x, y] = toPx(ap.x, ap.z);
      if (x < -30 || x > S + 30 || y < -30 || y > S + 30) continue;
      const dx = Math.sin(ap.hdg), dz = -Math.cos(ap.hdg);
      const L = Math.max(4, (RWY_LENGTH / 2) / half * (S / 2));
      g.strokeStyle = '#ffd24a'; g.lineWidth = 2.4;
      g.beginPath();
      g.moveTo(x - dx * L, y - dz * L);
      g.lineTo(x + dx * L, y + dz * L);
      g.stroke();
      g.fillStyle = 'rgba(255,210,74,0.9)';
      g.beginPath(); g.arc(x, y, 2.6, 0, 7); g.fill();
      if (L > 3.5) {
        g.fillStyle = '#ffe9a8';
        g.font = '9px "Consolas", monospace';
        g.textAlign = 'center';
        g.fillText(ap.name, x, y - 7);
      }
    }

    // ground track prediction (60 s)
    const gs = Math.hypot(ac.vel.x, ac.vel.z);
    if (gs > 5) {
      const [tx, ty] = toPx(ac.pos.x + ac.vel.x * 60, ac.pos.z + ac.vel.z * 60);
      g.strokeStyle = 'rgba(60,255,140,0.55)';
      g.setLineDash([4, 4]); g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(C, C); g.lineTo(tx, ty); g.stroke();
      g.setLineDash([]);
    }

    g.restore();

    // compass ticks
    g.save();
    g.translate(C, C);
    g.font = '10px "Segoe UI", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const [lbl, a] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]]) {
      const r = (a - 90) * Math.PI / 180;
      g.fillStyle = lbl === 'N' ? '#ff6a5a' : 'rgba(190,215,230,0.8)';
      g.fillText(lbl, Math.cos(r) * (C - 12), Math.sin(r) * (C - 12));
    }
    g.restore();

    // own aircraft
    g.save();
    g.translate(C, C);
    g.rotate(ac.headingDeg * Math.PI / 180);
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#0a0f14'; g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(0, -10); g.lineTo(7, 8); g.lineTo(0, 4); g.lineTo(-7, 8);
    g.closePath(); g.fill(); g.stroke();
    g.restore();

    // frame
    g.strokeStyle = 'rgba(140,190,220,0.55)'; g.lineWidth = 2;
    g.beginPath(); g.arc(C, C, C - 3, 0, 7); g.stroke();

    // readouts
    g.font = 'bold 11px "Consolas", monospace';
    g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillStyle = 'rgba(10,16,24,0.8)';
    g.fillRect(6, 6, 66, 16);
    g.fillStyle = '#7fe0ff';
    g.fillText(RANGES[this.rangeIdx] + ' NM', 11, 10);

    const near = this._airports[0];
    if (near) {
      const dx = near.x - ac.pos.x, dz = near.z - ac.pos.z;
      const dist = Math.hypot(dx, dz) / NM;
      let brg = Math.atan2(dx, -dz) * 180 / Math.PI;
      brg = (brg + 360) % 360;
      const rel = ((brg - ac.headingDeg + 540) % 360) - 180;
      g.fillStyle = 'rgba(10,16,24,0.8)';
      g.fillRect(6, S - 26, S - 12, 20);
      g.fillStyle = '#ffe9a8';
      g.textBaseline = 'middle';
      g.fillText(`${near.name}  ${String(Math.round(brg)).padStart(3, '0')}°  ${dist.toFixed(1)} NM  ${rel >= 0 ? 'R' : 'L'}${Math.abs(Math.round(rel))}`, 12, S - 16);
    }
  }
}

function smooth(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
function clamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : v | 0; }
