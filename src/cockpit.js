import * as THREE from 'three';
import { makeLitMaterial } from './litMaterial.js';

// ---------------------------------------------------------------------------
// 737-style flight deck. Layout follows the real thing: six windows, a
// glareshield carrying the mode control panel, six display units on the main
// panel, a centre pedestal with the thrust quadrant and two CDUs, and an
// overhead panel. Dimensions are in metres in the aircraft's body frame.
// ---------------------------------------------------------------------------

const Z0 = -13.05;                 // eye station
const WS = Z0 - 1.62;              // windshield plane
const EYE_Y = 0.80;

// Captain's eye reference point. `seat` in main.js can re-centre this.
export const EYE = new THREE.Vector3(-0.44, EYE_Y, Z0);
export const SEATS = { captain: -0.44, centre: 0, firstOfficer: 0.44 };

const GLARE_Y = 0.44;              // top of the glareshield
const TOP_Y = 1.66;                // top of the window aperture

function noiseCanvas(W, H, base, amt) {
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, W, H);
  const img = g.getImageData(0, 0, W, H), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amt;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  return { cv, g };
}

function tex(cv) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// --- panel artwork ---------------------------------------------------------

/** Generic switch-and-knob panel face used for the overhead and side panels. */
function switchPanelTexture(W, H, cols, rows) {
  const { cv, g } = noiseCanvas(W, H, '#4b4e52', 12);
  const cw = W / cols, ch = H / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cw + cw * 0.12, y = r * ch + ch * 0.12;
      const w = cw * 0.76, h = ch * 0.76;
      g.fillStyle = '#33363a';
      g.fillRect(x, y, w, h);
      g.strokeStyle = 'rgba(190,198,206,0.30)'; g.lineWidth = 1;
      g.strokeRect(x + 0.5, y + 0.5, w, h);
      const kind = (r * 7 + c * 3) % 5;
      if (kind === 0) {                       // toggle switch
        g.fillStyle = '#c9ced3';
        g.fillRect(x + w * 0.42, y + h * 0.18, w * 0.16, h * 0.5);
        g.beginPath(); g.arc(x + w * 0.5, y + h * 0.18, w * 0.12, 0, 7); g.fill();
      } else if (kind === 1) {                // rotary knob
        g.fillStyle = '#1b1d20';
        g.beginPath(); g.arc(x + w * 0.5, y + h * 0.45, Math.min(w, h) * 0.3, 0, 7); g.fill();
        g.strokeStyle = '#d7dbdf'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(x + w * 0.5, y + h * 0.45); g.lineTo(x + w * 0.5, y + h * 0.2); g.stroke();
      } else if (kind === 2) {                // annunciator
        g.fillStyle = ['#2b2f33', '#8a6a12', '#1f6b2c'][(r + c) % 3];
        g.fillRect(x + w * 0.12, y + h * 0.2, w * 0.76, h * 0.34);
      } else if (kind === 3) {                // push button
        g.fillStyle = '#5a5f65';
        g.fillRect(x + w * 0.2, y + h * 0.2, w * 0.6, h * 0.42);
        g.fillStyle = 'rgba(255,255,255,0.13)';
        g.fillRect(x + w * 0.2, y + h * 0.2, w * 0.6, h * 0.14);
      } else {                                 // gauge
        g.strokeStyle = '#9aa2aa'; g.lineWidth = 1.5;
        g.beginPath(); g.arc(x + w * 0.5, y + h * 0.45, Math.min(w, h) * 0.28, 2.4, 7.0); g.stroke();
        g.strokeStyle = '#e8eef2';
        g.beginPath(); g.moveTo(x + w * 0.5, y + h * 0.45);
        g.lineTo(x + w * 0.5 + Math.cos(3.8) * w * 0.22, y + h * 0.45 + Math.sin(3.8) * h * 0.22);
        g.stroke();
      }
      g.fillStyle = 'rgba(225,232,238,0.55)';
      g.font = `${Math.round(ch * 0.13)}px "Arial Narrow", Arial, sans-serif`;
      g.textAlign = 'center';
      g.fillText('SYS ' + (r * cols + c + 1), x + w * 0.5, y + h * 0.92);
    }
  }
  return tex(cv);
}

/**
 * Face of the main instrument panel. Bezels are drawn to line up with where the
 * live screens are mounted: the panel is 3.0 m x 0.92 m, so panel-local
 * (x, y) maps to texture (512 + x/3*1024, 192 - y/0.92*384).
 */
function mainPanelTexture() {
  const W = 1024, H = 384;
  const { cv, g } = noiseCanvas(W, H, '#26292d', 10);
  const U = x => W * (0.5 + x / 3.0);
  const V = y => H * (0.5 - y / 0.92);
  const bez = (x, y, w, h) => {
    const px = U(x - w / 2), py = V(y + h / 2);
    const pw = (w / 3.0) * W, ph = (h / 0.92) * H;
    g.fillStyle = '#0a0b0d';
    g.fillRect(px - 5, py - 5, pw + 10, ph + 10);
    g.strokeStyle = 'rgba(150,160,170,0.35)'; g.lineWidth = 2;
    g.strokeRect(px - 5, py - 5, pw + 10, ph + 10);
  };
  bez(-0.90, 0.22, 0.42, 0.32); bez(-0.45, 0.21, 0.38, 0.34);
  bez(0.45, 0.21, 0.38, 0.34); bez(0.90, 0.22, 0.42, 0.32);
  bez(0, 0.24, 0.23, 0.29); bez(0, -0.16, 0.21, 0.25);

  g.fillStyle = 'rgba(220,228,235,0.5)';
  g.font = '15px "Arial Narrow", Arial, sans-serif';
  g.textAlign = 'center';
  g.fillText('CAPT', U(-0.90), V(-0.02));
  g.fillText('F/O', U(0.90), V(-0.02));

  // standby instruments and switch rows either side of the CDU
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const x = side * (0.30 + i * 0.145), y = -0.20;
      const px = U(x) - 22, py = V(y) - 30;
      g.fillStyle = '#15171a'; g.fillRect(px, py, 44, 60);
      g.strokeStyle = 'rgba(160,170,180,0.3)'; g.lineWidth = 1.5;
      g.strokeRect(px, py, 44, 60);
      g.strokeStyle = '#aeb6bd'; g.lineWidth = 2;
      g.beginPath(); g.arc(px + 22, py + 26, 15, 2.4, 7.0); g.stroke();
      g.strokeStyle = '#e8eef2';
      g.beginPath(); g.moveTo(px + 22, py + 26);
      g.lineTo(px + 22 + Math.cos(3.6 + i) * 12, py + 26 + Math.sin(3.6 + i) * 12);
      g.stroke();
    }
  }
  // landing gear lever well, right of the CDU
  g.fillStyle = '#101214';
  g.fillRect(U(0.44) - 34, V(-0.30) - 40, 68, 86);
  g.strokeStyle = 'rgba(160,170,180,0.35)'; g.lineWidth = 2;
  g.strokeRect(U(0.44) - 34, V(-0.30) - 40, 68, 86);
  g.fillStyle = 'rgba(220,228,235,0.7)'; g.font = '14px Arial';
  g.fillText('GEAR', U(0.44), V(-0.30) - 48);
  return tex(cv);
}

/** Centre pedestal face: radios, transponder, engine start, trim indicator. */
function pedestalTexture() {
  const { cv, g } = noiseCanvas(512, 768, '#3d4045', 11);
  let y = 16;
  const block = (h, label) => {
    g.fillStyle = '#212428'; g.fillRect(18, y, 476, h);
    g.strokeStyle = 'rgba(180,190,200,0.28)'; g.lineWidth = 1.5;
    g.strokeRect(18.5, y + 0.5, 475, h);
    g.fillStyle = 'rgba(215,224,232,0.6)';
    g.font = '13px "Arial Narrow", Arial, sans-serif'; g.textAlign = 'left';
    g.fillText(label, 28, y + 18);
    y += h + 12;
  };
  // radio panels with green readouts
  for (const [lbl, a, b] of [['VHF 1', '118.700', '121.900'], ['VHF 2', '119.100', '124.350'],
    ['NAV 1', '110.30', '111.75'], ['NAV 2', '109.90', '110.10']]) {
    g.fillStyle = '#212428'; g.fillRect(18, y, 476, 66);
    g.strokeStyle = 'rgba(180,190,200,0.28)'; g.lineWidth = 1.5;
    g.strokeRect(18.5, y + 0.5, 475, 66);
    g.fillStyle = 'rgba(215,224,232,0.6)'; g.font = '12px Arial'; g.textAlign = 'left';
    g.fillText(lbl, 28, y + 18);
    g.fillStyle = '#06110a'; g.fillRect(120, y + 12, 150, 40); g.fillRect(300, y + 12, 150, 40);
    g.fillStyle = '#5cffa0'; g.font = 'bold 27px "Consolas", monospace'; g.textAlign = 'center';
    g.fillText(a, 195, y + 41); g.fillText(b, 375, y + 41);
    y += 78;
  }
  block(70, 'TRANSPONDER');
  g.fillStyle = '#06110a'; g.fillRect(140, y - 66, 150, 40);
  g.fillStyle = '#5cffa0'; g.font = 'bold 27px "Consolas", monospace'; g.textAlign = 'center';
  g.fillText('2000', 215, y - 37);
  block(78, 'ENGINE START');
  block(78, 'FUEL CONTROL');
  block(96, 'STAB TRIM');
  return tex(cv);
}

// Live screens ---------------------------------------------------------------

/** Engine display: N1, EGT, N2, fuel flow, plus gear and flap state. */
export function makeEngineCanvas() {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 320;
  return cv;
}

export function drawEngineDisplay(cv, ac) {
  const g = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  g.fillStyle = '#05080b'; g.fillRect(0, 0, W, H);
  const gauge = (y, label, val, max, unit, warn) => {
    const cxs = [70, 172];
    g.fillStyle = 'rgba(170,190,205,0.75)';
    g.font = '12px "Segoe UI", sans-serif'; g.textAlign = 'center';
    g.fillText(label, W / 2, y - 34);
    for (let i = 0; i < 2; i++) {
      const cx = cxs[i], r = 26;
      const v = Array.isArray(val) ? val[i] : val;
      g.strokeStyle = 'rgba(150,170,185,0.5)'; g.lineWidth = 3;
      g.beginPath(); g.arc(cx, y, r, Math.PI * 0.75, Math.PI * 2.25); g.stroke();
      const frac = Math.max(0, Math.min(v / max, 1));
      g.strokeStyle = warn && frac > 0.95 ? '#ff4a3d' : '#3dff7a';
      g.lineWidth = 4;
      g.beginPath(); g.arc(cx, y, r, Math.PI * 0.75, Math.PI * 0.75 + frac * Math.PI * 1.5); g.stroke();
      g.fillStyle = '#e8f0f4'; g.font = 'bold 15px "Consolas", monospace';
      g.fillText(v.toFixed(1), cx, y + 5);
    }
    g.fillStyle = 'rgba(170,190,205,0.55)'; g.font = '10px "Segoe UI", sans-serif';
    g.fillText(unit, W / 2, y + 5);
  };
  const n1 = ac.n1;
  gauge(56, 'N1', n1, 100, '%', true);
  const egt = n1.map(v => 300 + v * 5.2);
  gauge(140, 'EGT', egt, 900, '°C', true);
  const n2 = n1.map(v => 58 + v * 0.44);
  gauge(224, 'N2', n2, 105, '%', false);

  g.fillStyle = 'rgba(170,190,205,0.75)';
  g.font = '11px "Segoe UI", sans-serif'; g.textAlign = 'left';
  g.fillText('FUEL', 14, 292);
  g.fillStyle = '#e8f0f4'; g.font = 'bold 13px "Consolas", monospace';
  g.fillText((ac.fuel / 1000).toFixed(1) + ' t', 54, 292);
  g.fillStyle = 'rgba(170,190,205,0.75)'; g.font = '11px "Segoe UI", sans-serif';
  g.fillText('FLAP', 140, 292);
  g.fillStyle = ac.flapIndex ? '#3dff7a' : '#e8f0f4'; g.font = 'bold 13px "Consolas", monospace';
  g.fillText(String([0, 1, 5, 10, 15, 25, 30, 40][ac.flapIndex]), 180, 292);
  g.fillStyle = ac.gearPos > 0.99 ? '#3dff7a' : ac.gearPos < 0.01 ? '#8d969d' : '#ffb020';
  g.font = 'bold 12px "Consolas", monospace'; g.textAlign = 'right';
  g.fillText(ac.gearPos > 0.99 ? 'GEAR DOWN' : ac.gearPos < 0.01 ? 'GEAR UP' : 'GEAR TRAN', W - 12, 310);
  g.strokeStyle = 'rgba(140,190,220,0.35)'; g.lineWidth = 1.5;
  g.strokeRect(0.75, 0.75, W - 1.5, H - 1.5);
}

/** CDU: the flight-management scratchpad, here showing live approach data. */
export function makeCduCanvas() {
  const cv = document.createElement('canvas');
  cv.width = 300; cv.height = 360;
  return cv;
}

export function drawCdu(cv, ac, nav) {
  const g = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  g.fillStyle = '#04120a'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#7fffc0'; g.font = 'bold 15px "Consolas", monospace'; g.textAlign = 'center';
  g.fillText('APPROACH REF', W / 2, 24);
  g.font = '13px "Consolas", monospace'; g.textAlign = 'left';
  const row = (i, l, r, col) => {
    g.fillStyle = 'rgba(120,220,170,0.65)'; g.fillText(l, 12, 54 + i * 24);
    g.fillStyle = col || '#d8ffe8'; g.textAlign = 'right';
    g.fillText(r, W - 12, 54 + i * 24);
    g.textAlign = 'left';
  };
  const KTS = v => String(Math.round(v / 0.514444));
  if (nav.tuned && nav.dev) {
    const a = nav.tuned, d = nav.dev;
    row(0, 'DEST', a.airport.name);
    row(1, 'RWY', a.runway);
    row(2, 'CRS', String(Math.round(a.courseDeg)).padStart(3, '0') + '°');
    row(3, 'DIST', (d.dme / 1852).toFixed(1) + ' NM');
    row(4, 'ELEV', Math.round(a.elev / 0.3048) + ' FT');
    row(5, 'LOC', (d.locDeg >= 0 ? 'R' : 'L') + Math.abs(d.locDeg).toFixed(1) + '°',
      Math.abs(d.loc) < 0.35 ? '#7fffc0' : '#ffd27f');
    row(6, 'G/S', d.gsValid ? (d.gsDeg >= 0 ? 'HI ' : 'LO ') + Math.abs(d.gsDeg).toFixed(1) + '°' : '---',
      d.gsValid && Math.abs(d.gs) < 0.35 ? '#7fffc0' : '#ffd27f');
  } else {
    row(0, 'DEST', '----');
    row(2, 'CRS', '---');
  }
  row(8, 'VREF 30', KTS(ac.stallSpeed() * 1.3) + ' KT');
  row(9, 'GW', (ac.grossMass / 1000).toFixed(1) + ' T');
  g.fillStyle = 'rgba(120,220,170,0.5)'; g.font = '11px "Consolas", monospace';
  g.textAlign = 'center';
  g.fillText('T  cycles approach', W / 2, H - 16);
  g.strokeStyle = 'rgba(90,200,150,0.4)'; g.lineWidth = 1.5;
  g.strokeRect(0.75, 0.75, W - 1.5, H - 1.5);
}

/** Mode control panel artwork; redrawn as the autopilot state changes. */
export function makeMcpCanvas() {
  const cv = document.createElement('canvas');
  cv.width = 1024; cv.height = 150;
  return cv;
}

export function drawMcp(cv, ac) {
  const g = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  g.fillStyle = '#26292d'; g.fillRect(0, 0, W, H);
  const img = g.getImageData(0, 0, W, H), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 8; d[i] += n; d[i+1] += n; d[i+2] += n; }
  g.putImageData(img, 0, 0);

  const win = (x, w, label, value, lit) => {
    g.fillStyle = '#07100a'; g.fillRect(x, 44, w, 46);
    g.strokeStyle = 'rgba(175,190,205,0.4)'; g.lineWidth = 1.5;
    g.strokeRect(x + 0.5, 44.5, w - 1, 45);
    g.fillStyle = lit ? '#6dffb0' : '#4fbb84';
    g.font = 'bold 30px "Consolas", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(value, x + w / 2, 68);
    g.fillStyle = 'rgba(210,222,232,0.75)'; g.font = '13px "Arial Narrow", Arial, sans-serif';
    g.fillText(label, x + w / 2, 26);
  };
  const A = ac.ap;
  win(40, 130, 'COURSE', String(Math.round(A.hdg)).padStart(3, '0'), A.on);
  win(200, 150, 'IAS / MACH', String(Math.round(A.spd)), A.on && A.spdHold);
  win(378, 150, 'HEADING', String(Math.round(A.hdg)).padStart(3, '0'), A.on && A.hdgHold);
  win(556, 180, 'ALTITUDE', String(Math.round(A.alt / 0.3048 / 100) * 100), A.on && A.altHold);
  win(764, 130, 'V/S', (ac.vs >= 0 ? '+' : '-') + String(Math.abs(Math.round(ac.vs / 0.3048 * 60 / 50) * 50)).padStart(4, '0'), A.on && A.altHold);

  // mode buttons along the bottom
  const modes = [['A/T', A.spdHold && A.on], ['N1', false], ['SPEED', A.spdHold && A.on],
    ['LVL CHG', false], ['HDG SEL', A.hdgHold && A.on], ['APP', false],
    ['ALT HLD', A.altHold && A.on], ['V/S', false], ['CMD A', A.on]];
  modes.forEach(([m, on], i) => {
    const x = 34 + i * 108;
    g.fillStyle = '#1a1d21'; g.fillRect(x, 102, 92, 34);
    g.strokeStyle = 'rgba(175,190,205,0.3)'; g.lineWidth = 1;
    g.strokeRect(x + 0.5, 102.5, 91, 33);
    if (on) { g.fillStyle = '#2a6b3f'; g.fillRect(x + 4, 106, 84, 8); }
    g.fillStyle = on ? '#9dffc4' : 'rgba(205,215,225,0.6)';
    g.font = 'bold 14px "Arial Narrow", Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(m, x + 46, 124);
  });
  g.textBaseline = 'alphabetic';
}

// ---------------------------------------------------------------------------

export function buildCockpit(screens) {
  const g = new THREE.Group();

  // Boeing flight decks are a light warm grey, not charcoal — the dark shell
  // was what made this read as a cave.
  const fill = (o) => makeLitMaterial(Object.assign({ directScale: 0.20 }, o));
  const shellMat = fill({ color: 0x8e9088, roughness: 0.9, specular: 0.06, emissive: 0x6d6f68, emissiveIntensity: 0.85, side: THREE.DoubleSide });
  const trim = fill({ color: 0x6f7169, roughness: 0.85, specular: 0.1, emissive: 0x55574f, emissiveIntensity: 0.8 });
  const dark = fill({ color: 0x2a2c30, roughness: 0.93, specular: 0.05, emissive: 0x35373b, emissiveIntensity: 0.75, side: THREE.DoubleSide });
  const frameMat = fill({ color: 0x9a9c94, roughness: 0.72, specular: 0.18, emissive: 0x74766e, emissiveIntensity: 0.85 });
  const panelMat = fill({ map: mainPanelTexture(), roughness: 0.88, specular: 0.07, emissive: 0x3a3d41, emissiveIntensity: 1.0 });
  const pedMat = fill({ map: pedestalTexture(), roughness: 0.86, specular: 0.09, emissive: 0x3c3f44, emissiveIntensity: 1.0 });
  const ovhMat = fill({ map: switchPanelTexture(1024, 512, 10, 6), roughness: 0.88, specular: 0.08, emissive: 0x3c3f44, emissiveIntensity: 1.0 });
  const sideMat = fill({ map: switchPanelTexture(512, 256, 6, 3), roughness: 0.88, specular: 0.08, emissive: 0x3a3d41, emissiveIntensity: 0.95 });
  const mcpTex = tex(screens.mcp);
  const mcpMat = fill({ map: mcpTex, roughness: 0.85, specular: 0.1, emissive: 0x4a4e54, emissiveIntensity: 1.15 });
  const seatMat = fill({ color: 0x2f3438, roughness: 0.95, specular: 0.04, emissive: 0x2b2e32, emissiveIntensity: 0.8 });

  const fillMats = [
    [shellMat, 0.85], [trim, 0.8], [dark, 0.75], [frameMat, 0.85], [panelMat, 1.0],
    [pedMat, 1.0], [ovhMat, 1.0], [sideMat, 0.95], [mcpMat, 1.15], [seatMat, 0.8],
  ];

  // --- shell --------------------------------------------------------------
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(1.92, 1.92, 4.4, 24, 1, true), shellMat);
  tube.rotation.x = Math.PI / 2;
  tube.position.set(0, 0.34, Z0 - 0.20);
  g.add(tube);
  const rearWall = new THREE.Mesh(new THREE.CircleGeometry(1.92, 24), dark);
  rearWall.position.set(0, 0.34, Z0 + 2.0);
  g.add(rearWall);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.08, 4.6), dark);
  floor.position.set(0, -1.02, Z0 - 0.20);
  g.add(floor);

  // --- windows ------------------------------------------------------------
  // Six apertures: two forward windshields split by a centre post, two angled
  // side windows (the sliding ones), and two small aft quarter lights. The
  // frame pieces below define the openings; everything between is open glass.
  const post = (x, w, tilt = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, TOP_Y - GLARE_Y + 0.2, 0.13), frameMat);
    m.position.set(x, (TOP_Y + GLARE_Y) / 2, WS - 0.02);
    m.rotation.z = tilt;
    g.add(m);
  };
  post(0, 0.10);                      // centre post between No.1 windows
  post(-1.02, 0.10, 0.05);
  post(1.02, 0.10, -0.05);

  const topFrame = new THREE.Mesh(new THREE.BoxGeometry(3.7, 0.26, 0.9), frameMat);
  topFrame.position.set(0, TOP_Y + 0.09, WS + 0.34);
  topFrame.rotation.x = 0.2;
  g.add(topFrame);

  // Roof and outboard fill so the aperture reads as cut windows rather than the
  // open end of a tube.
  const roof = new THREE.Mesh(new THREE.BoxGeometry(3.7, 0.9, 2.0), trim);
  roof.position.set(0, TOP_Y + 0.62, WS + 1.2);
  g.add(roof);
  for (const s of [-1, 1]) {
    const outer = new THREE.Mesh(new THREE.BoxGeometry(0.7, TOP_Y - GLARE_Y + 0.5, 0.14), trim);
    outer.position.set(s * 1.83, (TOP_Y + GLARE_Y) / 2 + 0.06, WS + 0.02);
    g.add(outer);
  }

  // angled side windows: frame posts swept outboard and aft
  for (const s of [-1, 1]) {
    const p1 = new THREE.Mesh(new THREE.BoxGeometry(0.12, TOP_Y - GLARE_Y + 0.2, 0.13), frameMat);
    p1.position.set(s * 1.46, (TOP_Y + GLARE_Y) / 2 + 0.02, WS + 0.42);
    p1.rotation.y = s * 0.5;
    g.add(p1);
    const p2 = new THREE.Mesh(new THREE.BoxGeometry(0.12, TOP_Y - GLARE_Y + 0.1, 0.13), frameMat);
    p2.position.set(s * 1.70, (TOP_Y + GLARE_Y) / 2, WS + 1.16);
    p2.rotation.y = s * 0.85;
    g.add(p2);
    // sill running under the side windows
    const sill = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.13, 1.5), trim);
    sill.position.set(s * 1.60, GLARE_Y - 0.03, WS + 0.85);
    sill.rotation.y = s * 0.10;
    g.add(sill);
    // aft quarter light frame
    const p3 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.9, 0.12), frameMat);
    p3.position.set(s * 1.80, 0.95, WS + 1.86);
    g.add(p3);
    // side console below the sill
    const cons = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.55, 1.3), sideMat);
    cons.position.set(s * 1.62, GLARE_Y - 0.42, WS + 1.0);
    g.add(cons);
    // sliding window handle
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.2), frameMat);
    handle.position.set(s * 1.52, GLARE_Y + 0.12, WS + 0.95);
    g.add(handle);
  }

  // --- glareshield --------------------------------------------------------
  const glare = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.14, 0.66), dark);
  glare.position.set(0, GLARE_Y - 0.05, WS + 0.36);
  glare.rotation.x = -0.16;
  g.add(glare);
  const coaming = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.28, 0.09), trim);
  coaming.position.set(0, GLARE_Y - 0.12, WS + 0.04);
  g.add(coaming);

  // mode control panel across the glareshield
  const mcp = new THREE.Mesh(new THREE.BoxGeometry(1.44, 0.21, 0.05), mcpMat);
  mcp.position.set(0, GLARE_Y + 0.015, WS + 0.56);
  mcp.rotation.x = -0.62;
  g.add(mcp);
  // EFIS control panels flanking it
  for (const s of [-1, 1]) {
    const efis = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.19, 0.05), sideMat);
    efis.position.set(s * 0.94, GLARE_Y + 0.005, WS + 0.56);
    efis.rotation.x = -0.62;
    g.add(efis);
    // master caution / fire warning lights
    const warn = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.09, 0.03),
      fill({ color: 0x2a1a10, roughness: 0.6, specular: 0.2, emissive: 0xff9020, emissiveIntensity: 0.35 }));
    warn.position.set(s * 1.24, GLARE_Y + 0.02, WS + 0.5);
    warn.rotation.x = -0.5;
    g.add(warn);
  }

  // --- main instrument panel ----------------------------------------------
  const panel = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.92, 0.14), panelMat);
  panel.position.set(0, GLARE_Y - 0.48, WS + 0.48);
  panel.rotation.x = 0.14;
  g.add(panel);

  // Screens are children of the panel so they follow its tilt exactly; placing
  // them in world space leaves them buried behind the sloped face.
  const displays = [];
  const texCache = new Map();
  const screen = (canvas, w, h, x, y) => {
    let t = texCache.get(canvas);
    if (!t) {
      t = tex(canvas); t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
      texCache.set(canvas, t);
      displays.push({ tex: t, canvas });
    }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: t, toneMapped: false }));
    m.position.set(x, y, 0.076);          // panel-local: just proud of the face
    panel.add(m);
  };
  // captain outboard PFD, inboard ND; first officer mirrored; engine and CDU centre
  screen(screens.pfd, 0.42, 0.32, -0.90, 0.22);
  screen(screens.nd, 0.38, 0.34, -0.45, 0.21);
  screen(screens.nd, 0.38, 0.34, 0.45, 0.21);
  screen(screens.pfd, 0.42, 0.32, 0.90, 0.22);
  screen(screens.engine, 0.23, 0.29, 0, 0.24);
  screen(screens.cdu, 0.21, 0.25, 0, -0.16);

  // landing gear lever
  const gearLever = new THREE.Group();
  const gl = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.17, 8), frameMat);
  gl.position.y = 0.085; gearLever.add(gl);
  const gk = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8),
    fill({ color: 0xd6d8da, roughness: 0.5, specular: 0.4, emissive: 0x9a9c9e, emissiveIntensity: 0.7 }));
  gk.position.y = 0.18; gearLever.add(gk);
  gearLever.position.set(0.44, -0.30, 0.09);
  panel.add(gearLever);

  // --- overhead -----------------------------------------------------------
  const ovh = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.25, 0.09), ovhMat);
  ovh.position.set(0, 1.86, Z0 + 0.26);
  ovh.rotation.x = -1.26;
  g.add(ovh);
  const ovhFwd = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.42, 0.08), sideMat);
  ovhFwd.position.set(0, 1.80, Z0 - 0.60);
  ovhFwd.rotation.x = -0.95;
  g.add(ovhFwd);

  // --- centre pedestal ----------------------------------------------------
  const ped = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.84, 1.5), pedMat);
  ped.position.set(0, -0.36, Z0 - 0.16);
  ped.rotation.x = -0.14;
  g.add(ped);

  const knobMat = fill({ color: 0x1a1d21, roughness: 0.55, specular: 0.35, emissive: 0x2a2d31, emissiveIntensity: 0.75 });
  fillMats.push([knobMat, 0.75]);

  // thrust levers
  const levers = [];
  for (const s of [-1, 1]) {
    const lg = new THREE.Group();
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.34, 0.05), frameMat);
    arm.position.y = 0.17; lg.add(arm);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.058, 12, 9), knobMat);
    knob.position.y = 0.35; lg.add(knob);
    lg.position.set(s * 0.09, -0.05, Z0 - 0.72);
    g.add(lg);
    levers.push(lg);
  }
  // speedbrake lever (left of the thrust levers) and flap lever (right)
  const speedbrake = new THREE.Group();
  {
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.26, 0.04), frameMat);
    a.position.y = 0.13; speedbrake.add(a);
    const k = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.07), knobMat);
    k.position.y = 0.27; speedbrake.add(k);
    speedbrake.position.set(-0.23, -0.05, Z0 - 0.60);
    g.add(speedbrake);
  }
  const flapLever = new THREE.Group();
  {
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.28, 0.04),
      fill({ color: 0x7a5c26, roughness: 0.6, specular: 0.3, emissive: 0x4a3a1c, emissiveIntensity: 0.8 }));
    a.position.y = 0.14; flapLever.add(a);
    flapLever.position.set(0.23, -0.05, Z0 - 0.30);
    g.add(flapLever);
  }
  // trim wheels either side of the pedestal
  const trimWheels = [];
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.05, 16), knobMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(s * 0.33, -0.30, Z0 - 0.34);
    g.add(w);
    trimWheels.push(w);
  }
  // parking brake lever
  const park = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.16, 0.035),
    fill({ color: 0x8a1f1f, roughness: 0.6, specular: 0.3, emissive: 0x5a1414, emissiveIntensity: 0.9 }));
  park.position.set(-0.16, -0.02, Z0 - 0.02);
  g.add(park);

  // --- yokes and pedals ---------------------------------------------------
  const yokes = [];
  for (const s of [-1, 1]) {
    const yg = new THREE.Group();
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.66, 10), frameMat);
    col.rotation.x = 0.4; col.position.set(0, -0.26, 0.13);
    yg.add(col);
    const hub = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.09), dark);
    yg.add(hub);
    const barH = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.045, 0.05), dark);
    barH.position.y = 0.055; yg.add(barH);
    for (const h of [-1, 1]) {
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 0.05), dark);
      grip.position.set(h * 0.21, -0.045, 0);
      yg.add(grip);
      const horn = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.14), dark);
      horn.position.set(h * 0.21, 0.06, 0.02);
      yg.add(horn);
    }
    yg.position.set(s * 0.44, 0.12, Z0 - 0.84);
    g.add(yg);
    yokes.push({ g: yg, baseZ: Z0 - 0.84 });
  }
  for (const s of [-1, 1]) {
    for (const p of [-1, 1]) {
      const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.2, 0.05), trim);
      pedal.position.set(s * 0.44 + p * 0.15, -0.72, Z0 - 1.24);
      pedal.rotation.x = -0.35;
      g.add(pedal);
    }
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.05, 0.22), seatMat);
    seat.position.set(s * 0.44, 0.12, Z0 + 0.78);
    g.add(seat);
    const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.16, 0.55), seatMat);
    cushion.position.set(s * 0.44, -0.38, Z0 + 0.52);
    g.add(cushion);
  }

  g.userData = { levers, yokes, flapLever, speedbrake, trimWheels, gearLever, displays, fillMats, park, mcpTex };
  return g;
}

/**
 * `dirty` is the set of instrument canvases that were actually redrawn this
 * frame. Uploading a canvas to the GPU is expensive enough that re-sending an
 * unchanged one costs more than everything else in the cockpit.
 */
export function updateCockpit(ck, ac, exposure = 0.44, dirty = null) {
  const u = ck.userData;
  const k = 0.44 / Math.max(exposure, 0.05);
  for (const [mat, base] of u.fillMats) mat.uniforms.uEmissiveI.value = base * k;

  for (const lg of u.levers) lg.rotation.x = -0.50 + ac.throttle * 0.90;
  u.flapLever.rotation.x = -0.32 + (ac.flapIndex / 7) * 0.80;
  u.speedbrake.rotation.x = -0.30 + ac.spoilers * 0.70;
  u.gearLever.rotation.x = ac.gearDown ? 0.34 : -0.34;
  u.park.rotation.x = ac.parkBrake ? -0.55 : 0.0;
  for (const w of u.trimWheels) w.rotation.x = ac.elevTrim * 9.0;
  for (const y of u.yokes) {
    y.g.rotation.z = -ac.ailSurf * 0.55;
    y.g.position.z = y.baseZ + ac.elevSurf * 0.085;
  }
  if (dirty) for (const d of u.displays) if (dirty.has(d.canvas)) d.tex.needsUpdate = true;
}
