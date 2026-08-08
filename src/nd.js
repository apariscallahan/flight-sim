import { KT, FT } from './aircraft.js';
import { NM } from './navigation.js';
import { RWY_LENGTH } from './terrainCommon.js';

const CY = '#37d7ff';
const MAG = '#ff5ce8';
const GRN = '#3dff7a';
const AMB = '#ffb020';
const WHT = '#e8f0f4';

/**
 * Arc-mode Navigation Display, the instrument a pilot actually navigates with:
 * track-up, compass arc across the top, range rings, terrain awareness shading,
 * airports and runways to scale, and the tuned approach course.
 */
export class ND {
  constructor(canvas, terrainMap) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.tmap = terrainMap;
    this.W = 460; this.H = 430;
    this.ranges = [5, 10, 20, 40, 80, 160];
    this.rangeIdx = 2;
    this.showTerrain = true;
  }

  get range() { return this.ranges[this.rangeIdx]; }

  resize(dpr) {
    this.cv.width = this.W * dpr;
    this.cv.height = this.H * dpr;
    this.cv.style.width = this.W + 'px';
    this.cv.style.height = this.H + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dpr = dpr;
  }

  cycleRange(d) {
    this.rangeIdx = Math.max(0, Math.min(this.ranges.length - 1, this.rangeIdx + d));
  }

  draw(ac, nav) {
    const g = this.ctx, W = this.W, H = this.H;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#05090e';
    g.fillRect(0, 0, W, H);

    const cx = W / 2, cy = H - 58;         // aircraft symbol
    const R = H - 96;                       // radius to the full-range arc
    const hdg = ac.headingDeg;
    const pxPerM = R / (this.range * NM);

    // --- terrain awareness under everything ---------------------------------
    g.save();
    g.beginPath();
    g.moveTo(cx, cy);
    g.arc(cx, cy, R, Math.PI * 1.5 - 1.15, Math.PI * 1.5 + 1.15);
    g.closePath();
    g.clip();

    if (this.showTerrain && this.tmap.ready) {
      this.tmap.updateAwareness(ac.pos.y);
      const t = this.tmap;
      const w = t.origin.half * 2 * pxPerM;
      g.save();
      g.translate(cx, cy);
      g.rotate(-hdg * Math.PI / 180);
      g.translate((t.origin.x - ac.pos.x) * pxPerM, (t.origin.z - ac.pos.z) * pxPerM);
      g.imageSmoothingEnabled = true;
      g.globalAlpha = 0.85;
      g.drawImage(t.awareness, -w / 2, -w / 2, w, w);
      g.globalAlpha = 1;
      g.restore();
    }

    // --- everything else is drawn in track-up world space -------------------
    g.save();
    g.translate(cx, cy);
    g.rotate(-hdg * Math.PI / 180);
    const P = (x, z) => [(x - ac.pos.x) * pxPerM, (z - ac.pos.z) * pxPerM];

    // airports and their runways
    for (const { ap } of nav.nearestAirports(ac, 10)) {
      const [x, y] = P(ap.x, ap.z);
      if (Math.hypot(x, y) > R * 1.3) continue;
      const dx = Math.sin(ap.hdg), dz = -Math.cos(ap.hdg);
      const L = (RWY_LENGTH / 2) * pxPerM;
      g.strokeStyle = WHT; g.lineWidth = Math.max(1.5, L * 0.09);
      g.beginPath();
      g.moveTo(x - dx * L, y - dz * L);
      g.lineTo(x + dx * L, y + dz * L);
      g.stroke();
      if (L < 4) {
        g.strokeStyle = WHT; g.lineWidth = 1.4;
        g.beginPath(); g.arc(x, y, 4, 0, 7); g.stroke();
      }
      g.save();
      g.translate(x, y); g.rotate(hdg * Math.PI / 180);
      g.fillStyle = WHT; g.font = '11px "Consolas", monospace'; g.textAlign = 'center';
      g.fillText(ap.name, 0, -9);
      g.restore();
    }

    // tuned approach: extended centreline out to 12 NM
    if (nav.tuned) {
      const a = nav.tuned;
      const [tx, ty] = P(a.thrX, a.thrZ);
      const back = 12 * NM * pxPerM;
      g.strokeStyle = MAG; g.lineWidth = 2;
      g.setLineDash([7, 5]);
      g.beginPath();
      g.moveTo(tx, ty);
      g.lineTo(tx - a.dx * back, ty - a.dz * back);
      g.stroke();
      g.setLineDash([]);
      // range ticks every 2 NM along the approach
      for (let d = 2; d <= 12; d += 2) {
        const px = tx - a.dx * d * NM * pxPerM, py = ty - a.dz * d * NM * pxPerM;
        g.fillStyle = MAG;
        g.beginPath(); g.arc(px, py, 2.2, 0, 7); g.fill();
      }
    }

    // ground track, 2 minutes ahead
    const gs = Math.hypot(ac.vel.x, ac.vel.z);
    if (gs > 5) {
      const [tx, ty] = P(ac.pos.x + ac.vel.x * 120, ac.pos.z + ac.vel.z * 120);
      g.strokeStyle = GRN; g.lineWidth = 1.6; g.setLineDash([5, 5]);
      g.beginPath(); g.moveTo(0, 0); g.lineTo(tx, ty); g.stroke();
      g.setLineDash([]);
    }
    g.restore();
    g.restore();

    // --- range rings --------------------------------------------------------
    g.strokeStyle = 'rgba(150,190,210,0.35)'; g.lineWidth = 1;
    for (const f of [0.5, 1]) {
      g.beginPath();
      g.arc(cx, cy, R * f, Math.PI * 1.5 - 1.15, Math.PI * 1.5 + 1.15);
      g.stroke();
    }
    // range labels on the left arm of each arc, clear of the compass numbers
    g.fillStyle = CY; g.font = '11px "Consolas", monospace';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const f of [0.5, 1]) {
      const a = Math.PI * 1.5 - 1.05;
      g.fillText(String(this.range * f), cx + Math.cos(a) * R * f, cy + Math.sin(a) * R * f + (f === 1 ? 12 : 0));
    }
    g.textBaseline = 'alphabetic';

    // --- compass arc --------------------------------------------------------
    g.save();
    g.translate(cx, cy);
    for (let d = -60; d <= 60; d += 5) {
      const a = (d - 90) * Math.PI / 180;
      const major = ((Math.round(hdg + d) % 10) + 10) % 10 < 5 && d % 10 === 0;
      const len = d % 10 === 0 ? 11 : 6;
      g.strokeStyle = WHT; g.lineWidth = 1.3;
      g.beginPath();
      g.moveTo(Math.cos(a) * R, Math.sin(a) * R);
      g.lineTo(Math.cos(a) * (R - len), Math.sin(a) * (R - len));
      g.stroke();
      if (d % 30 === 0) {
        const lbl = (((Math.round(hdg + d) % 360) + 360) % 360);
        g.save();
        g.translate(Math.cos(a) * (R - 24), Math.sin(a) * (R - 24));
        g.rotate(0);
        g.fillStyle = WHT; g.font = 'bold 13px "Consolas", monospace';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        const txt = lbl === 0 ? 'N' : lbl === 90 ? 'E' : lbl === 180 ? 'S' : lbl === 270 ? 'W'
          : String(Math.round(lbl / 10)).padStart(2, '0');
        g.fillText(txt, 0, 0);
        g.restore();
      }
    }
    // heading bug
    if (ac.ap.hdgHold) {
      const rel = ((ac.ap.hdg - hdg + 540) % 360) - 180;
      if (Math.abs(rel) < 64) {
        const a = (rel - 90) * Math.PI / 180;
        g.fillStyle = MAG;
        g.save();
        g.translate(Math.cos(a) * R, Math.sin(a) * R);
        g.rotate(a + Math.PI / 2);
        g.beginPath(); g.moveTo(0, 0); g.lineTo(-6, -11); g.lineTo(6, -11); g.closePath(); g.fill();
        g.restore();
      }
    }
    g.restore();

    // lubber line + aircraft symbol
    g.strokeStyle = WHT; g.lineWidth = 2;
    g.beginPath(); g.moveTo(cx, cy - R); g.lineTo(cx, cy - R + 14); g.stroke();
    g.beginPath();
    g.moveTo(cx, cy - 11); g.lineTo(cx - 9, cy + 8); g.lineTo(cx, cy + 3); g.lineTo(cx + 9, cy + 8);
    g.closePath(); g.fillStyle = WHT; g.fill();

    // --- readouts -----------------------------------------------------------
    g.textBaseline = 'top';
    g.textAlign = 'left';
    g.font = '11px "Segoe UI", sans-serif';
    g.fillStyle = 'rgba(160,190,205,0.8)'; g.fillText('GS', 10, 8);
    g.fillStyle = WHT; g.font = 'bold 15px "Consolas", monospace';
    g.fillText(String(Math.round(gs / KT)).padStart(3, ' '), 32, 6);
    g.fillStyle = 'rgba(160,190,205,0.8)'; g.font = '11px "Segoe UI", sans-serif';
    g.fillText('TAS', 78, 8);
    g.fillStyle = WHT; g.font = 'bold 15px "Consolas", monospace';
    g.fillText(String(Math.round(ac.tas / KT)).padStart(3, ' '), 106, 6);

    // wind
    const wx = ac.wind.x, wz = ac.wind.z;
    const wspd = Math.hypot(wx, wz) / KT;
    if (wspd > 1) {
      const wdir = ((Math.atan2(-wx, wz) * 180 / Math.PI) + 360) % 360;
      g.fillStyle = WHT; g.font = '12px "Consolas", monospace';
      g.fillText(`${String(Math.round(wdir)).padStart(3, '0')}/${Math.round(wspd)}`, 10, 28);
      g.save();
      g.translate(30, 62);
      g.rotate((wdir - hdg + 180) * Math.PI / 180);
      g.strokeStyle = WHT; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(0, -11); g.lineTo(0, 11); g.moveTo(-4, 6); g.lineTo(0, 11); g.lineTo(4, 6); g.stroke();
      g.restore();
    }

    // tuned approach block, top right
    g.textAlign = 'right';
    if (nav.tuned && nav.dev) {
      const a = nav.tuned, d = nav.dev;
      g.fillStyle = MAG; g.font = 'bold 13px "Consolas", monospace';
      g.fillText(`${a.airport.name} ILS ${a.runway}`, W - 10, 6);
      g.fillStyle = WHT; g.font = '12px "Consolas", monospace';
      g.fillText(`CRS ${String(Math.round(a.courseDeg)).padStart(3, '0')}`, W - 10, 24);
      g.fillText(`DME ${(d.dme / NM).toFixed(1)}`, W - 10, 40);
      if (gs > 20) {
        const mins = (d.dme / gs) / 60;
        g.fillText(`ETE ${Math.floor(mins)}:${String(Math.floor((mins % 1) * 60)).padStart(2, '0')}`, W - 10, 56);
      }
    } else {
      g.fillStyle = 'rgba(160,190,205,0.6)'; g.font = '12px "Consolas", monospace';
      g.fillText('NO APPROACH IN RANGE', W - 10, 6);
    }

    // mode strip
    g.textAlign = 'center';
    g.fillStyle = CY; g.font = 'bold 12px "Segoe UI", sans-serif';
    g.fillText('ARC', cx, 8);
    if (this.showTerrain) {
      g.fillStyle = GRN; g.font = '10px "Segoe UI", sans-serif';
      g.fillText('TERR', cx, 26);
    }

    // frame
    g.strokeStyle = 'rgba(140,190,220,0.4)'; g.lineWidth = 1.5;
    g.strokeRect(0.75, 0.75, W - 1.5, H - 1.5);
  }
}
