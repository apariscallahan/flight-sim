import { RWY_LENGTH } from './terrainCommon.js';
import { airportsNear } from './airports.js';

const NM = 1852;
export const RANGES = [5, 10, 20, 40, 80, 160];

export class Minimap {
  constructor(canvas, terrainMap) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.size = 280;
    this.rangeIdx = 2;
    this.tmap = terrainMap;          // sampling is shared with the nav display
    this._airports = [];
    this._apAt = { x: 1e9, z: 1e9 };
  }

  get ready() { return this.tmap.ready; }
  get origin() { return this.tmap.origin; }
  get map() { return this.tmap.map; }

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
  }

  get halfExtent() { return RANGES[this.rangeIdx] * NM; }

  tick(px, pz) {
    this.tmap.setHalfExtent(this.halfExtent);
    this.tmap.tick(px, pz);
    if (Math.hypot(px - this._apAt.x, pz - this._apAt.z) > 4000) {
      this._apAt = { x: px, z: pz };
      this._airports = airportsNear(px, pz, Math.max(this.halfExtent * 1.5, 60000), 40);
    }
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

