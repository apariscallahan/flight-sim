import * as THREE from 'three';
import { makeLitMaterial } from './litMaterial.js';

// Design reference point: eye at the captain's seat, looking down the -Z axis.
const Z0 = -13.05;                 // eye station
const WINDSHIELD = Z0 - 1.55;      // front glass plane
const EYE_Y = 0.88;
// Centred on the aircraft's axis rather than in the left seat, so the view is
// symmetric and the runway centreline sits in the middle of the screen.
export const EYE = new THREE.Vector3(0, EYE_Y, Z0);

const GLARE_Y = 0.40;              // top of the glareshield
const TOP_Y = 1.62;                // top window frame

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

function panelTexture() {
  const W = 1024, H = 384;
  const { cv, g } = noiseCanvas(W, H, '#1e2227', 13);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 24; c++) {
      const x = 26 + c * 41, y = 40 + r * 112;
      g.fillStyle = '#14171b';
      g.fillRect(x, y, 30, 72);
      g.fillStyle = ['#c8ccd0', '#9aa0a6', '#3a4046'][(r + c) % 3];
      g.fillRect(x + 8, y + 8, 14, 30);
      g.fillStyle = ['#ffb020', '#31ff6a', '#ff3b30', '#2a2e33'][(r * 5 + c) % 4];
      g.fillRect(x + 6, y + 46, 18, 10);
      g.strokeStyle = 'rgba(190,200,210,0.22)'; g.lineWidth = 1;
      g.strokeRect(x + 0.5, y + 0.5, 30, 72);
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Mode control panel strip that sits on the glareshield. */
function mcpTexture() {
  const W = 1024, H = 128;
  const { cv, g } = noiseCanvas(W, H, '#23272c', 10);
  const win = (x, w, label, value, col) => {
    g.fillStyle = '#0a0c0f';
    g.fillRect(x, 42, w, 44);
    g.strokeStyle = 'rgba(170,185,200,0.35)'; g.lineWidth = 1.5;
    g.strokeRect(x + 0.5, 42.5, w - 1, 43);
    g.fillStyle = col;
    g.font = 'bold 30px Consolas, monospace';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(value, x + w / 2, 65);
    g.fillStyle = 'rgba(190,205,215,0.75)';
    g.font = '13px "Segoe UI", sans-serif';
    g.fillText(label, x + w / 2, 26);
  };
  win(70, 130, 'IAS', '280', '#4be0a0');
  win(250, 150, 'HEADING', '045', '#4be0a0');
  win(440, 130, 'ALTITUDE', '10000', '#4be0a0');
  win(620, 110, 'V/S', '+000', '#4be0a0');
  for (let i = 0; i < 9; i++) {
    g.fillStyle = i % 3 === 0 ? '#2d6b3f' : '#2a2e33';
    g.fillRect(790 + (i % 3) * 62, 34 + Math.floor(i / 3) * 30, 52, 22);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildCockpit(pfdCanvas, ndCanvas) {
  const g = new THREE.Group();

  // The flight deck is shaded by the airframe: almost no direct sun reaches it, so
  // it is lit by a baked "cabin fill" that main.js keeps proportional to exposure.
  const fill = (o) => makeLitMaterial(Object.assign({ directScale: 0.18 }, o));
  const shellMat = fill({ color: 0x2c3035, roughness: 0.92, specular: 0.05, emissive: 0x4a4640, emissiveIntensity: 0.85, side: THREE.DoubleSide });
  const dark = fill({ color: 0x181b1f, roughness: 0.94, specular: 0.05, emissive: 0x37342f, emissiveIntensity: 0.70, side: THREE.DoubleSide });
  const frame = fill({ color: 0x585d64, roughness: 0.75, specular: 0.2, emissive: 0x5b564e, emissiveIntensity: 0.75 });
  const panelMat = fill({ map: panelTexture(), roughness: 0.88, specular: 0.08, emissive: 0x454a52, emissiveIntensity: 1.05 });
  const mcpMat = fill({ map: mcpTexture(), roughness: 0.85, specular: 0.1, emissive: 0x555c66, emissiveIntensity: 1.35 });
  const fillMats = [
    [shellMat, 0.85], [dark, 0.70], [frame, 0.75], [panelMat, 1.05], [mcpMat, 1.35],
  ];

  // --- shell: a tube around the flight deck, open at the front -------------
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(1.86, 1.86, 4.6, 22, 1, true), shellMat);
  tube.rotation.x = Math.PI / 2;
  tube.position.set(0, 0.30, Z0 - 0.25);
  g.add(tube);
  const rearWall = new THREE.Mesh(new THREE.CircleGeometry(1.86, 22), dark);
  rearWall.position.set(0, 0.30, Z0 + 2.05);
  g.add(rearWall);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.08, 4.6), dark);
  floor.position.set(0, -0.98, Z0 - 0.25);
  g.add(floor);

  // --- glareshield ---------------------------------------------------------
  const glare = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.14, 0.62), dark);
  glare.position.set(0, GLARE_Y - 0.05, WINDSHIELD + 0.34);
  glare.rotation.x = -0.16;
  g.add(glare);
  const coaming = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.26, 0.09), frame);
  coaming.position.set(0, GLARE_Y - 0.11, WINDSHIELD + 0.03);
  g.add(coaming);

  // MCP strip, angled toward the pilot
  const mcp = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.17, 0.05), mcpMat);
  mcp.position.set(0, GLARE_Y + 0.015, WINDSHIELD + 0.52);
  mcp.rotation.x = -0.62;
  g.add(mcp);

  // --- main instrument panel ----------------------------------------------
  const panel = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.86, 0.14), panelMat);
  panel.position.set(0, GLARE_Y - 0.50, WINDSHIELD + 0.46);
  panel.rotation.x = 0.14;
  g.add(panel);

  const displays = [];
  const mkDisplay = (canvas, w, h, x, y) => {
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    const bez = new THREE.Mesh(new THREE.BoxGeometry(w + 0.045, h + 0.045, 0.035), dark);
    bez.position.set(x, y, WINDSHIELD + 0.545);
    bez.rotation.x = 0.14;
    g.add(bez);
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
    );
    m.position.set(x, y + 0.0035, WINDSHIELD + 0.567);
    m.rotation.x = 0.14;
    g.add(m);
    displays.push(tex);
  };
  for (const s of [-1, 1]) {
    mkDisplay(pfdCanvas, 0.40, 0.31, s * 0.86, GLARE_Y - 0.27);
    mkDisplay(ndCanvas, 0.32, 0.32, s * 0.42, GLARE_Y - 0.29);
  }
  // standby cluster between the pilots
  const stby = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.30, 0.05), dark);
  stby.position.set(0, GLARE_Y - 0.29, WINDSHIELD + 0.545);
  stby.rotation.x = 0.14;
  g.add(stby);

  // --- window frame --------------------------------------------------------
  const pillar = (x, w, tilt) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, TOP_Y - GLARE_Y + 0.15, 0.11), frame);
    m.position.set(x, (TOP_Y + GLARE_Y) / 2, WINDSHIELD - 0.02);
    m.rotation.z = tilt;
    g.add(m);
  };
  // No centre post: the eye sits on the aircraft axis, so one there would stare
  // straight down the runway centreline.
  pillar(-0.98, 0.12, 0.06);
  pillar(0.98, 0.12, -0.06);
  const topFrame = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.30, 0.85), frame);
  topFrame.position.set(0, TOP_Y + 0.10, WINDSHIELD + 0.30);
  topFrame.rotation.x = 0.20;
  g.add(topFrame);
  // eyebrow / side window posts
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, TOP_Y - GLARE_Y + 0.2, 0.14), frame);
    post.position.set(s * 1.55, (TOP_Y + GLARE_Y) / 2, WINDSHIELD + 0.42);
    post.rotation.y = s * 0.42;
    g.add(post);
  }

  // --- overhead ------------------------------------------------------------
  const ovh = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.15, 0.10), panelMat);
  ovh.position.set(0, 1.78, Z0 + 0.30);
  ovh.rotation.x = -1.24;
  g.add(ovh);

  // --- pedestal ------------------------------------------------------------
  const ped = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.70, 1.30), panelMat);
  ped.position.set(0, -0.32, Z0 - 0.30);
  ped.rotation.x = -0.16;
  g.add(ped);

  const knobMat = fill({ color: 0x1c1f23, roughness: 0.55, specular: 0.35, emissive: 0x2a2d31, emissiveIntensity: 0.8 });
  fillMats.push([knobMat, 0.8]);
  const levers = [];
  for (const s of [-1, 1]) {
    const lg = new THREE.Group();
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.30, 0.045), frame);
    arm.position.y = 0.15;
    lg.add(arm);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.052, 10, 8), knobMat);
    knob.position.y = 0.31;
    lg.add(knob);
    lg.position.set(s * 0.085, -0.06, Z0 - 0.62);
    g.add(lg);
    levers.push(lg);
  }
  const flapLever = new THREE.Group();
  const flapMat = fill({ color: 0x6d5322, roughness: 0.6, specular: 0.3, emissive: 0x3a2d12, emissiveIntensity: 0.8 });
  fillMats.push([flapMat, 0.8]);
  const fl = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.26, 0.045), flapMat);
  fl.position.y = 0.13;
  flapLever.add(fl);
  flapLever.position.set(0.24, -0.10, Z0 - 0.22);
  g.add(flapLever);

  // --- yokes ---------------------------------------------------------------
  const yokes = [];
  for (const s of [-1, 1]) {
    const yg = new THREE.Group();
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.052, 0.62, 8), frame);
    col.rotation.x = 0.40;
    col.position.set(0, -0.24, 0.12);
    yg.add(col);
    const hub = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.13, 0.09), dark);
    yg.add(hub);
    const barH = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.042, 0.048), dark);
    barH.position.y = 0.05;
    yg.add(barH);
    for (const h of [-1, 1]) {
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.19, 0.048), dark);
      grip.position.set(h * 0.20, -0.04, 0);
      yg.add(grip);
    }
    yg.position.set(s * 0.40, 0.10, Z0 - 0.80);
    g.add(yg);
    yokes.push({ g: yg, baseZ: Z0 - 0.80 });
  }

  for (const s of [-1, 1]) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.58, 1.0, 0.20), dark);
    seat.position.set(s * 0.40, 0.10, Z0 + 0.75);
    g.add(seat);
  }

  g.userData = { levers, yokes, flapLever, displays, fillMats };
  return g;
}

export function updateCockpit(ck, ac, exposure = 0.44) {
  const u = ck.userData;
  const k = 0.44 / Math.max(exposure, 0.05);
  for (const [mat, base] of u.fillMats) mat.uniforms.uEmissiveI.value = base * k;
  for (const lg of u.levers) lg.rotation.x = -0.50 + ac.throttle * 0.90;
  u.flapLever.rotation.x = -0.32 + (ac.flapIndex / 7) * 0.80;
  for (const y of u.yokes) {
    y.g.rotation.z = -ac.aileron * 0.55;
    y.g.position.z = y.baseZ + ac.elevator * 0.085;
  }
  for (const t of u.displays) t.needsUpdate = true;
}
