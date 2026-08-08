import { KT, FT, FLAP_SETTINGS } from './aircraft.js';

const CY = '#00e5ff';
const MAG = '#e64bff';
const GRN = '#31ff6a';
const AMB = '#ffb020';
const RED = '#ff3b30';

export class PFD {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.W = 520; this.H = 396;
  }

  resize(dpr) {
    this.cv.width = this.W * dpr;
    this.cv.height = this.H * dpr;
    this.cv.style.width = this.W + 'px';
    this.cv.style.height = this.H + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dpr = dpr;
  }

  draw(ac, info, nav) {
    const g = this.ctx, W = this.W, H = this.H;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, W, H);

    g.fillStyle = 'rgba(6,10,16,0.62)';
    roundRect(g, 0, 0, W, H, 10); g.fill();
    g.strokeStyle = 'rgba(120,160,190,0.30)'; g.lineWidth = 1;
    roundRect(g, 0.5, 0.5, W - 1, H - 1, 10); g.stroke();

    this.attitude(g, ac, 260, 168, 108);
    this.ils(g, ac, nav, 260, 168, 108);
    this.speedTape(g, ac, 62, 168, 46, 240);
    this.altTape(g, ac, 400, 168, 62, 240);
    this.vsi(g, ac, 476, 168, 22, 240);
    this.headingTape(g, ac, 260, 324, 260);
    this.modes(g, ac, info, nav);
    this.bottom(g, ac, info);
  }

  /** Localiser and glideslope deviation, the way you actually fly an approach. */
  ils(g, ac, nav, cx, cy, r) {
    if (!nav || !nav.tuned || !nav.dev || !nav.dev.inRange) return;
    const d = nav.dev;

    // localiser: scale under the attitude indicator
    const ly = cy + r * 0.94 + 13;
    g.strokeStyle = 'rgba(200,215,225,0.7)'; g.lineWidth = 1.2;
    for (let i = -2; i <= 2; i++) {
      if (i === 0) continue;
      g.beginPath(); g.arc(cx + i * r * 0.40, ly, 3.2, 0, 7); g.stroke();
    }
    g.beginPath(); g.moveTo(cx, ly - 7); g.lineTo(cx, ly + 7); g.stroke();
    // The needle shows where the beam is relative to the aircraft, so you steer
    // towards it: right of the localiser puts the needle left.
    g.fillStyle = MAG;
    const lx = cx - Math.max(-1, Math.min(1, d.loc)) * r * 0.80;
    g.beginPath();
    g.moveTo(lx, ly - 7); g.lineTo(lx + 7, ly); g.lineTo(lx, ly + 7); g.lineTo(lx - 7, ly);
    g.closePath(); g.fill();

    // glideslope: scale down the right edge of the attitude indicator
    if (d.gsValid) {
      const gx = cx + r - 9;
      g.strokeStyle = 'rgba(200,215,225,0.7)'; g.lineWidth = 1.2;
      for (let i = -2; i <= 2; i++) {
        if (i === 0) continue;
        g.beginPath(); g.arc(gx, cy + i * r * 0.40, 3.2, 0, 7); g.stroke();
      }
      g.beginPath(); g.moveTo(gx - 7, cy); g.lineTo(gx + 7, cy); g.stroke();
      g.fillStyle = MAG;
      const gy = cy + Math.max(-1, Math.min(1, d.gs)) * r * 0.80;
      g.beginPath();
      g.moveTo(gx, gy - 7); g.lineTo(gx + 7, gy); g.lineTo(gx, gy + 7); g.lineTo(gx - 7, gy);
      g.closePath(); g.fill();
    }

  }

  // --- attitude director ----------------------------------------------------
  attitude(g, ac, cx, cy, r) {
    const pitch = ac.pitchDeg, bank = ac.bankDeg;
    g.save();
    g.beginPath(); g.rect(cx - r, cy - r * 0.94, r * 2, r * 1.88); g.clip();
    g.translate(cx, cy);
    g.rotate(-bank * Math.PI / 180);
    const ppd = 4.2;               // px per degree
    g.translate(0, pitch * ppd);

    g.fillStyle = '#2f7fd0';
    g.fillRect(-r * 2.4, -r * 6, r * 4.8, r * 6);
    const gr = g.createLinearGradient(0, 0, 0, r * 3);
    gr.addColorStop(0, '#8a5a28'); gr.addColorStop(1, '#4a3116');
    g.fillStyle = gr;
    g.fillRect(-r * 2.4, 0, r * 4.8, r * 6);
    g.strokeStyle = '#ffffff'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(-r * 2.4, 0); g.lineTo(r * 2.4, 0); g.stroke();

    g.lineWidth = 1.4; g.font = '10px "Segoe UI", sans-serif';
    g.textAlign = 'right'; g.textBaseline = 'middle';
    for (let d = -80; d <= 80; d += 5) {
      if (d === 0) continue;
      const y = -d * ppd;
      const w = d % 10 === 0 ? 34 : 17;
      g.strokeStyle = '#ffffff';
      g.beginPath(); g.moveTo(-w, y); g.lineTo(w, y); g.stroke();
      if (d % 10 === 0) {
        g.fillStyle = '#ffffff';
        g.fillText(String(Math.abs(d)), -w - 4, y);
        g.textAlign = 'left';
        g.fillText(String(Math.abs(d)), w + 4, y);
        g.textAlign = 'right';
      }
    }
    g.restore();

    // bank scale
    g.save();
    g.translate(cx, cy);
    g.strokeStyle = '#ffffff'; g.lineWidth = 1.6;
    for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
      const rad = (a - 90) * Math.PI / 180;
      const l = [0, 30, 60].includes(Math.abs(a)) ? 11 : 6;
      g.beginPath();
      g.moveTo(Math.cos(rad) * r * 0.94, Math.sin(rad) * r * 0.94);
      g.lineTo(Math.cos(rad) * (r * 0.94 - l), Math.sin(rad) * (r * 0.94 - l));
      g.stroke();
    }
    // roll pointer
    g.rotate(-bank * Math.PI / 180);
    g.fillStyle = bank > 33 || bank < -33 ? AMB : '#ffffff';
    g.beginPath();
    g.moveTo(0, -r * 0.90); g.lineTo(-7, -r * 0.90 + 12); g.lineTo(7, -r * 0.90 + 12);
    g.closePath(); g.fill();
    // slip indicator
    const slip = Math.max(-1, Math.min(1, ac.beta * 6));
    g.fillStyle = Math.abs(slip) > 0.55 ? AMB : '#ffffff';
    g.fillRect(-11 + slip * 22, -r * 0.90 + 14, 22, 5);
    g.restore();

    // fixed aircraft symbol
    g.strokeStyle = '#000'; g.lineWidth = 5;
    for (const pass of [0, 1]) {
      g.strokeStyle = pass ? AMB : '#000';
      g.lineWidth = pass ? 3 : 5.5;
      g.beginPath();
      g.moveTo(cx - 62, cy); g.lineTo(cx - 22, cy); g.lineTo(cx - 22, cy + 9);
      g.moveTo(cx + 62, cy); g.lineTo(cx + 22, cy); g.lineTo(cx + 22, cy + 9);
      g.stroke();
      g.beginPath(); g.arc(cx, cy, 3.2, 0, 7); g.stroke();
    }

    // flight path vector
    if (ac.tas > 20) {
      const fpaDeg = Math.atan2(ac.vs, Math.max(Math.hypot(ac.vel.x, ac.vel.z), 1)) * 180 / Math.PI;
      const dy = (pitch - fpaDeg) * 4.2;
      const dx = Math.max(-50, Math.min(50, ac.beta * 180 / Math.PI * 3));
      g.strokeStyle = GRN; g.lineWidth = 2;
      g.beginPath(); g.arc(cx + dx, cy + dy, 6, 0, 7); g.stroke();
      g.beginPath();
      g.moveTo(cx + dx - 14, cy + dy); g.lineTo(cx + dx - 6, cy + dy);
      g.moveTo(cx + dx + 14, cy + dy); g.lineTo(cx + dx + 6, cy + dy);
      g.moveTo(cx + dx, cy + dy - 12); g.lineTo(cx + dx, cy + dy - 6);
      g.stroke();
    }

    g.strokeStyle = 'rgba(150,180,200,0.5)'; g.lineWidth = 1;
    g.strokeRect(cx - r, cy - r * 0.94, r * 2, r * 1.88);
  }

  // --- speed ----------------------------------------------------------------
  speedTape(g, ac, cx, cy, w, h) {
    const kt = ac.ias / KT;
    g.save();
    g.beginPath(); g.rect(cx - w / 2, cy - h / 2, w, h); g.clip();
    g.fillStyle = 'rgba(10,14,20,0.75)'; g.fillRect(cx - w / 2, cy - h / 2, w, h);
    const ppk = 2.6;
    g.textAlign = 'right'; g.textBaseline = 'middle';
    g.font = '13px "Segoe UI", sans-serif';
    for (let s = Math.floor((kt - 60) / 10) * 10; s <= kt + 60; s += 10) {
      if (s < 0) continue;
      const y = cy + (kt - s) * ppk;
      g.strokeStyle = '#dfe6ea'; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(cx + w / 2 - 8, y); g.lineTo(cx + w / 2, y); g.stroke();
      if (s % 20 === 0) { g.fillStyle = '#dfe6ea'; g.fillText(String(s), cx + w / 2 - 11, y); }
    }
    // stall / flap / Vmo bands
    const vs = ac.stallSpeed() / KT;
    g.fillStyle = 'rgba(255,60,48,0.75)';
    g.fillRect(cx + w / 2 - 5, cy + (kt - vs) * ppk, 5, h);
    g.fillStyle = 'rgba(255,176,32,0.75)';
    g.fillRect(cx + w / 2 - 5, cy + (kt - vs * 1.15) * ppk, 5, (vs * 0.15) * ppk);
    const vmo = 340;
    g.fillStyle = 'rgba(255,60,48,0.75)';
    g.fillRect(cx + w / 2 - 5, cy - h / 2, 5, (kt - vmo) * ppk + h / 2);

    // speed bugs: rotate and V2 on the ground, Vref in the approach configuration
    const bug = (v, label, col) => {
      const y = cy + (kt - v) * ppk;
      g.fillStyle = col;
      g.fillRect(cx - w / 2 - 6, y - 1.5, 8, 3);
      g.font = '9px "Consolas", monospace'; g.textAlign = 'right'; g.textBaseline = 'middle';
      g.fillText(label, cx - w / 2 - 8, y);
    };
    if (ac.onGround || ac.ias < 5) {
      bug(vs * 1.13, 'VR', '#31ff6a');
      bug(vs * 1.22, 'V2', '#31ff6a');
    } else if (ac.flapIndex >= 5) {
      bug(vs * 1.30, 'REF', '#31ff6a');
    }
    // autothrottle selected speed
    if (ac.ap.on && ac.ap.spdHold) bug(ac.ap.spd, 'SEL', MAG);
    g.restore();

    g.strokeStyle = 'rgba(150,180,200,0.45)'; g.lineWidth = 1;
    g.strokeRect(cx - w / 2, cy - h / 2, w, h);
    // readout box
    g.fillStyle = '#0b0f14';
    g.strokeStyle = ac.overspeed ? RED : ac.stallWarn ? AMB : '#dfe6ea';
    g.lineWidth = 1.6;
    roundRect(g, cx - w / 2 - 4, cy - 13, w + 12, 26, 3); g.fill(); g.stroke();
    g.fillStyle = ac.overspeed ? RED : ac.stallWarn ? AMB : '#ffffff';
    g.font = 'bold 19px "Consolas", monospace';
    g.textAlign = 'center';
    g.fillText(String(Math.round(kt)).padStart(3, ' '), cx + 2, cy + 1);
    g.font = '10px "Segoe UI", sans-serif';
    g.fillStyle = CY;
    g.textAlign = 'center';
    g.fillText('IAS  M ' + ac.mach.toFixed(3), cx + 2, cy - h / 2 - 8);
  }

  // --- altitude -------------------------------------------------------------
  altTape(g, ac, cx, cy, w, h) {
    const ft = ac.pos.y / FT;
    g.save();
    g.beginPath(); g.rect(cx - w / 2, cy - h / 2, w, h); g.clip();
    g.fillStyle = 'rgba(10,14,20,0.75)'; g.fillRect(cx - w / 2, cy - h / 2, w, h);
    const ppf = 0.115;
    g.textAlign = 'left'; g.textBaseline = 'middle';
    g.font = '12px "Segoe UI", sans-serif';
    for (let s = Math.floor((ft - 1100) / 200) * 200; s <= ft + 1100; s += 200) {
      const y = cy + (ft - s) * ppf;
      g.strokeStyle = '#dfe6ea'; g.lineWidth = 1.3;
      g.beginPath(); g.moveTo(cx - w / 2, y); g.lineTo(cx - w / 2 + 7, y); g.stroke();
      if (s % 1000 === 0) { g.fillStyle = '#dfe6ea'; g.fillText(String(s), cx - w / 2 + 10, y); }
    }
    // ground
    const gy = cy + (ft - (ac.pos.y - ac.agl) / FT) * ppf;
    g.fillStyle = 'rgba(200,140,40,0.35)';
    g.fillRect(cx - w / 2, gy, w, h);
    g.strokeStyle = AMB; g.lineWidth = 2;
    g.beginPath(); g.moveTo(cx - w / 2, gy); g.lineTo(cx + w / 2, gy); g.stroke();

    // selected altitude bug
    if (ac.ap.altHold) {
      const by = cy + (ft - ac.ap.alt / FT) * ppf;
      g.fillStyle = MAG;
      g.beginPath();
      g.moveTo(cx - w / 2, by - 7); g.lineTo(cx - w / 2 + 9, by - 7);
      g.lineTo(cx - w / 2 + 9, by + 7); g.lineTo(cx - w / 2, by + 7);
      g.lineTo(cx - w / 2 + 4, by); g.closePath(); g.fill();
    }
    g.restore();

    g.strokeStyle = 'rgba(150,180,200,0.45)'; g.lineWidth = 1;
    g.strokeRect(cx - w / 2, cy - h / 2, w, h);
    g.fillStyle = '#0b0f14';
    g.strokeStyle = '#dfe6ea'; g.lineWidth = 1.6;
    roundRect(g, cx - w / 2 - 6, cy - 13, w + 12, 26, 3); g.fill(); g.stroke();
    g.fillStyle = '#ffffff';
    g.font = 'bold 18px "Consolas", monospace';
    g.textAlign = 'center';
    g.fillText(String(Math.round(ft / 10) * 10), cx, cy + 1);
    g.font = '10px "Segoe UI", sans-serif';
    g.fillStyle = CY;
    g.fillText('ALT ft', cx, cy - h / 2 - 8);

    // radio altitude
    if (ac.agl / FT < 2500) {
      g.font = 'bold 13px "Consolas", monospace';
      g.fillStyle = ac.agl / FT < 200 ? AMB : GRN;
      g.fillText('RA ' + Math.round(ac.agl / FT), cx, cy + h / 2 + 14);
    }
  }

  vsi(g, ac, cx, cy, w, h) {
    const fpm = ac.vs / FT * 60;
    g.fillStyle = 'rgba(10,14,20,0.75)';
    g.fillRect(cx - w / 2, cy - h / 2, w, h);
    g.strokeStyle = 'rgba(150,180,200,0.45)'; g.lineWidth = 1;
    g.strokeRect(cx - w / 2, cy - h / 2, w, h);
    const map = v => {
      const s = Math.sign(v), a = Math.min(Math.abs(v), 6000);
      const n = a <= 1000 ? a / 1000 * 0.45 : 0.45 + (a - 1000) / 5000 * 0.55;
      return cy - s * n * (h / 2 - 6);
    };
    g.strokeStyle = '#8fa4b4'; g.lineWidth = 1;
    for (const v of [-6000, -2000, -1000, 0, 1000, 2000, 6000]) {
      const y = map(v);
      g.beginPath(); g.moveTo(cx - w / 2, y); g.lineTo(cx - w / 2 + (v % 2000 === 0 ? 8 : 5), y); g.stroke();
    }
    g.strokeStyle = Math.abs(fpm) > 2000 ? AMB : GRN;
    g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(cx - w / 2, cy); g.lineTo(cx + w / 2 - 2, map(fpm)); g.stroke();
  }

  headingTape(g, ac, cx, cy, w) {
    const hdg = ac.headingDeg;
    const h = 26;
    g.save();
    g.beginPath(); g.rect(cx - w / 2, cy - h / 2, w, h); g.clip();
    g.fillStyle = 'rgba(10,14,20,0.75)'; g.fillRect(cx - w / 2, cy - h / 2, w, h);
    const ppd = 3.2;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let d = Math.floor((hdg - 45) / 5) * 5; d <= hdg + 45; d += 5) {
      const x = cx + (d - hdg) * ppd;
      const dd = ((d % 360) + 360) % 360;
      g.strokeStyle = '#dfe6ea'; g.lineWidth = 1.3;
      g.beginPath(); g.moveTo(x, cy - h / 2); g.lineTo(x, cy - h / 2 + (dd % 10 === 0 ? 8 : 4)); g.stroke();
      if (dd % 10 === 0) {
        g.fillStyle = '#dfe6ea';
        g.font = '11px "Segoe UI", sans-serif';
        const lbl = dd === 0 ? 'N' : dd === 90 ? 'E' : dd === 180 ? 'S' : dd === 270 ? 'W' : String(dd / 10);
        g.fillText(lbl, x, cy + 5);
      }
    }
    if (ac.ap.on && ac.ap.hdgHold) {
      const dx = (((ac.ap.hdg - hdg + 540) % 360) - 180) * ppd;
      g.strokeStyle = MAG; g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(cx + dx, cy - h / 2); g.lineTo(cx + dx - 5, cy - h / 2 + 8); g.lineTo(cx + dx + 5, cy - h / 2 + 8);
      g.closePath(); g.stroke();
    }
    g.restore();
    g.strokeStyle = 'rgba(150,180,200,0.45)'; g.lineWidth = 1;
    g.strokeRect(cx - w / 2, cy - h / 2, w, h);
    g.fillStyle = '#0b0f14'; g.strokeStyle = '#dfe6ea'; g.lineWidth = 1.4;
    roundRect(g, cx - 26, cy - h / 2 - 19, 52, 19, 3); g.fill(); g.stroke();
    g.fillStyle = '#fff'; g.font = 'bold 14px "Consolas", monospace';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(String(Math.round(hdg)).padStart(3, '0'), cx, cy - h / 2 - 9);
  }

  modes(g, ac, info, nav) {
    if (nav && nav.tuned) {
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = MAG; g.font = 'bold 11px "Consolas", monospace';
      const dme = nav.dev ? `  ${(nav.dev.dme / 1852).toFixed(1)}NM` : '';
      g.fillText(`${nav.tuned.airport.name} ILS ${nav.tuned.runway}  CRS ${String(Math.round(nav.tuned.courseDeg)).padStart(3, '0')}${dme}`, 260, 34);
    }
    g.textAlign = 'left'; g.textBaseline = 'middle';
    g.font = 'bold 11px "Segoe UI", sans-serif';
    const A = ac.ap;
    const items = [
      ['A/T', A.on && A.spdHold, `SPD ${Math.round(A.spd)}`],
      ['ROLL', A.on && A.hdgHold, `HDG ${String(Math.round(A.hdg)).padStart(3, '0')}`],
      ['PITCH', A.on && A.altHold, `ALT ${Math.round(A.alt / FT / 100) * 100}`],
    ];
    let x = 14;
    for (const [k, on, label] of items) {
      g.fillStyle = on ? GRN : 'rgba(150,170,185,0.55)';
      g.fillText(on ? label : k, x, 16);
      x += 92;
    }
    g.fillStyle = A.on ? MAG : 'rgba(150,170,185,0.55)';
    g.fillText(A.on ? 'CMD' : 'A/P OFF', 320, 16);

    if (ac.stallWarn) { g.fillStyle = RED; g.font = 'bold 15px "Segoe UI", sans-serif'; g.fillText('STALL', 404, 16); }
    else if (ac.overspeed) { g.fillStyle = RED; g.font = 'bold 15px "Segoe UI", sans-serif'; g.fillText('OVERSPEED', 380, 16); }
    else if (ac.parkBrake) {
      g.fillStyle = RED; g.font = 'bold 15px "Segoe UI", sans-serif';
      g.fillText('PARK BRK', 396, 16);
    }
  }

  bottom(g, ac, info) {
    g.textBaseline = 'middle'; g.textAlign = 'left';
    g.font = '11px "Segoe UI", sans-serif';
    const y = 372;
    const n1 = (ac.n1[0] + ac.n1[1]) / 2;
    const cells = [
      ['N1', n1.toFixed(0) + '%', n1 > 98 ? AMB : GRN],
      ['THR', Math.round(ac.throttle * 100) + '%', CY],
      ['FLAP', String(FLAP_SETTINGS[ac.flapIndex]), ac.flapIndex ? GRN : '#c9d4dc'],
      ['GEAR', ac.gearPos > 0.99 ? 'DOWN' : ac.gearPos < 0.01 ? 'UP' : 'TRAN',
        ac.gearPos > 0.99 ? GRN : ac.gearPos < 0.01 ? '#c9d4dc' : AMB],
      ['BRAKES', ac.parkBrake ? 'PARK' : ac.brake > 0.5 ? 'ON' : 'OFF',
        ac.parkBrake ? RED : ac.brake > 0.5 ? AMB : '#c9d4dc'],
      ['SPD BRK', ac.spoilerCmd > 0.5 ? 'OUT' : 'RET', ac.spoilerCmd > 0.5 ? AMB : '#c9d4dc'],
      ['TRIM', (ac.elevTrim * 10).toFixed(1), '#c9d4dc'],
      ['G', ac.gLoad.toFixed(1), Math.abs(ac.gLoad - 1) > 1.2 ? AMB : '#c9d4dc'],
      ['GS', Math.round(Math.hypot(ac.vel.x, ac.vel.z) / KT) + 'kt', '#c9d4dc'],
    ];
    let x = 10;
    for (const [k, v, c] of cells) {
      g.fillStyle = 'rgba(150,170,185,0.7)';
      g.fillText(k, x, y - 7);
      g.fillStyle = c;
      g.font = 'bold 12px "Consolas", monospace';
      g.fillText(v, x, y + 7);
      g.font = '11px "Segoe UI", sans-serif';
      x += 56;
    }
  }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
