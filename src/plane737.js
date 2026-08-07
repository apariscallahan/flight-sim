import * as THREE from 'three';
import { makeLitMaterial } from './litMaterial.js';

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** NACA 4-digit contour, trailing edge -> upper -> leading edge -> lower. */
function naca(m, pp, tt, n = 16) {
  const pts = [];
  const yt = (x) => 5 * tt * (0.2969 * Math.sqrt(x) - 0.1260 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1015 * x ** 4);
  const yc = (x) => (x < pp ? (m / (pp * pp)) * (2 * pp * x - x * x) : (m / ((1 - pp) ** 2)) * (1 - 2 * pp + 2 * pp * x - x * x));
  const dyc = (x) => (x < pp ? (2 * m / (pp * pp)) * (pp - x) : (2 * m / ((1 - pp) ** 2)) * (pp - x));
  const upper = [], lower = [];
  for (let i = 0; i <= n; i++) {
    const beta = (i / n) * Math.PI;
    const x = 0.5 * (1 - Math.cos(beta));
    const th = Math.atan(dyc(x));
    upper.push([x - yt(x) * Math.sin(th), yc(x) + yt(x) * Math.cos(th)]);
    lower.push([x + yt(x) * Math.sin(th), yc(x) - yt(x) * Math.cos(th)]);
  }
  for (let i = n; i >= 0; i--) pts.push(upper[i]);
  for (let i = 1; i <= n; i++) pts.push(lower[i]);
  return pts;
}

/** Loft closed cross-sections into a solid. Each station: array of Vector3, same length. */
function loft(stations, capFirst = true, capLast = true) {
  const m = stations.length, n = stations[0].length;
  const pos = [], idx = [];
  for (const st of stations) for (const p of st) pos.push(p.x, p.y, p.z);
  for (let s = 0; s < m - 1; s++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = s * n + i, b = s * n + j, c = (s + 1) * n + i, d = (s + 1) * n + j;
      idx.push(a, c, b, b, c, d);
    }
  }
  const capOf = (s, flip) => {
    const base = pos.length / 3;
    let cx = 0, cy = 0, cz = 0;
    for (const p of stations[s]) { cx += p.x; cy += p.y; cz += p.z; }
    pos.push(cx / n, cy / n, cz / n);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (flip) idx.push(base, s * n + j, s * n + i);
      else idx.push(base, s * n + i, s * n + j);
    }
  };
  if (capFirst) capOf(0, true);
  if (capLast) capOf(m - 1, false);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  return g;
}

/**
 * Wing/tail surface. `plan` describes stations along the span:
 * {y (span), le (x of leading edge, +x = aft), chord, dihedralY, twist, thick}
 */
function surfaceGeometry(plan, mirror = true, camber = 0.02) {
  const sections = [];
  for (const st of plan) {
    const af = naca(camber, 0.40, st.thick ?? 0.11, 12);
    const pts = af.map(([cx, cy]) => {
      const c = st.chord;
      let x = cx * c, y = cy * c;
      const tw = (st.twist ?? 0) * Math.PI / 180;
      const xr = x * Math.cos(tw) - y * Math.sin(tw);
      const yr = x * Math.sin(tw) + y * Math.cos(tw);
      return new THREE.Vector3(st.span, yr + (st.dihedralY ?? 0), xr + st.le);
    });
    sections.push(pts);
  }
  const g = loft(sections);
  if (!mirror) return g;
  const g2 = g.clone();
  const p = g2.attributes.position;
  for (let i = 0; i < p.count; i++) p.setX(i, -p.getX(i));
  const ix = g2.index.array;
  for (let i = 0; i < ix.length; i += 3) { const t = ix[i]; ix[i] = ix[i + 2]; ix[i + 2] = t; }
  g2.computeVertexNormals();
  return mergeAll([g, g2]);
}

function mergeAll(list) {
  let vc = 0, ic = 0;
  for (const g of list) { vc += g.attributes.position.count; ic += g.index.count; }
  const pos = new Float32Array(vc * 3), nrm = new Float32Array(vc * 3), uv = new Float32Array(vc * 2);
  const idx = new Uint32Array(ic);
  let vo = 0, io = 0;
  for (const g of list) {
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
    pos.set(p.array, vo * 3);
    if (n) nrm.set(n.array, vo * 3);
    if (u) uv.set(u.array, vo * 2);
    for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.getX(i) + vo;
    vo += p.count; io += g.index.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

// ---------------------------------------------------------------------------
// Fuselage
// ---------------------------------------------------------------------------

const FUS_LEN = 39.5, FUS_R = 1.92;

function fuselageProfile(t) {
  // t: 0 at nose, 1 at tail. returns {r, yOff, rz}
  let r, yOff = 0, sy = 1;
  if (t < 0.085) {
    const s = t / 0.085;
    r = FUS_R * Math.pow(Math.sin(s * Math.PI * 0.5), 0.62);
    yOff = -0.28 * (1 - s) * (1 - s);
    sy = 0.86 + 0.14 * s;
  } else if (t < 0.70) {
    r = FUS_R;
  } else {
    const s = (t - 0.70) / 0.30;
    r = FUS_R * (1 - 0.86 * s * s);
    yOff = 1.65 * s * s * s;
    sy = 1 - 0.18 * s;
  }
  return { r: Math.max(r, 0.06), yOff, sy };
}

function fuselageGeometry(lenSegs = 60, radSegs = 28) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= lenSegs; i++) {
    const t = i / lenSegs;
    const { r, yOff, sy } = fuselageProfile(t);
    const z = -FUS_LEN * 0.42 + t * FUS_LEN;
    for (let j = 0; j <= radSegs; j++) {
      const a = (j / radSegs) * Math.PI * 2;
      // slightly flattened belly, like a real double-bubble
      const rr = r * (1 - 0.06 * Math.max(0, -Math.cos(a)));
      pos.push(Math.sin(a) * rr, Math.cos(a) * rr * sy + yOff, z);
      uv.push(t, j / radSegs);
    }
  }
  const row = radSegs + 1;
  for (let i = 0; i < lenSegs; i++) {
    for (let j = 0; j < radSegs; j++) {
      const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function liveryTexture() {
  const W = 2048, H = 512;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');

  // v: 0 = top, 0.25 = right side, 0.5 = belly, 0.75 = left side
  const V = f => f * H;
  g.fillStyle = '#f2f3f4';
  g.fillRect(0, 0, W, H);

  // grey belly
  const bg = g.createLinearGradient(0, V(0.33), 0, V(0.5));
  bg.addColorStop(0, 'rgba(150,156,162,0)');
  bg.addColorStop(1, 'rgba(126,133,140,1)');
  g.fillStyle = bg; g.fillRect(0, V(0.33), W, V(0.17));
  const bg2 = g.createLinearGradient(0, V(0.67), 0, V(0.5));
  bg2.addColorStop(0, 'rgba(150,156,162,0)');
  bg2.addColorStop(1, 'rgba(126,133,140,1)');
  g.fillStyle = bg2; g.fillRect(0, V(0.5), W, V(0.17));

  // cheatline
  for (const c of [0.235, 0.765]) {
    g.fillStyle = '#1b3f77';
    g.fillRect(0, V(c + 0.043), W, V(0.030));
    g.fillStyle = '#3f7fd0';
    g.fillRect(0, V(c + 0.074), W, V(0.011));
  }

  // Each side of the fuselage is seen from the opposite direction, so anything
  // with handedness is rotated 180° about its own centre on the far side. That
  // keeps the feature at the same station along the body while reading correctly.
  const perSide = (cx, cy, draw) => {
    for (const flip of [false, true]) {
      g.save();
      g.translate(cx, flip ? H - cy : cy);
      if (flip) g.rotate(Math.PI);
      draw();
      g.restore();
    }
  };

  // cabin windows
  for (const c of [0.222, 0.778]) {
    const y = V(c);
    for (let x = W * 0.13; x < W * 0.80; x += W * 0.0138) {
      if (x > W * 0.40 && x < W * 0.435) continue;
      g.fillStyle = '#1c2733';
      roundRect(g, x, y - 7, 11, 15, 4);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.16)';
      roundRect(g, x + 1, y - 6, 9, 5, 2);
      g.fill();
    }
    for (const dx of [0.115, 0.395, 0.60, 0.80]) {
      g.strokeStyle = 'rgba(120,128,136,0.85)';
      g.lineWidth = 2.5;
      roundRect(g, W * dx, y - 26, 34, 60, 8);
      g.stroke();
    }
  }

  // cockpit windows
  perSide(W * 0.07, V(0.222), () => {
    const ox = -W * 0.042;
    g.fillStyle = '#101820';
    g.beginPath();
    g.moveTo(ox + 0, -4);
    g.lineTo(ox + W * 0.047, -20);
    g.lineTo(ox + W * 0.047, 6);
    g.lineTo(ox + W * 0.002, 8);
    g.closePath(); g.fill();
    g.fillStyle = '#0c1218';
    roundRect(g, ox + W * 0.050, -19, 30, 24, 4); g.fill();
    g.strokeStyle = '#c9ccd0'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(ox - W * 0.002, 10); g.lineTo(ox + W * 0.087, 8); g.stroke();
  });

  // roof anti-glare panel
  g.fillStyle = '#20293a';
  g.fillRect(0, V(0.47), W * 0.10, V(0.06));

  g.textBaseline = 'middle';
  g.textAlign = 'center';
  perSide(W * 0.745, V(0.30), () => {
    g.fillStyle = '#1b3f77';
    g.font = 'bold 44px "Arial Black", Arial, sans-serif';
    g.fillText('N737SM', 0, 0);
  });
  perSide(W * 0.30, V(0.155), () => {
    g.fillStyle = '#1b3f77';
    g.font = 'bold 92px "Arial Black", Arial, sans-serif';
    g.fillText('SKYWIND', 0, 0);
  });
  g.textAlign = 'left';

  // panel lines
  g.strokeStyle = 'rgba(0,0,0,0.055)'; g.lineWidth = 1.5;
  for (let x = 0; x < W; x += W * 0.021) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  for (let y = 0; y < H; y += H * 0.055) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }

  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
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

function finTexture() {
  const N = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, N);
  grd.addColorStop(0, '#1b3f77');
  grd.addColorStop(1, '#2b5ea8');
  g.fillStyle = grd; g.fillRect(0, 0, N, N);
  g.strokeStyle = 'rgba(255,255,255,0.92)';
  g.lineWidth = 22;
  g.beginPath();
  g.arc(N * 0.52, N * 0.44, N * 0.24, Math.PI * 0.15, Math.PI * 1.25);
  g.stroke();
  g.beginPath();
  g.moveTo(N * 0.30, N * 0.66);
  g.lineTo(N * 0.78, N * 0.30);
  g.stroke();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------------------
// Engine nacelle
// ---------------------------------------------------------------------------

function nacelleGeometry() {
  const stations = [];
  const prof = [
    [-1.30, 1.10], [-1.15, 1.28], [-0.90, 1.38], [0.0, 1.42],
    [1.4, 1.40], [2.4, 1.28], [3.1, 1.06], [3.5, 0.86],
  ];
  const n = 20;
  for (const [z, r] of prof) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      // flat-bottomed "hamster pouch" inlet
      const flat = 1 - 0.16 * Math.max(0, -Math.cos(a)) * (z < 1.0 ? 1 : 0.4);
      pts.push(new THREE.Vector3(Math.sin(a) * r * flat, Math.cos(a) * r * flat * 0.97, z));
    }
    stations.push(pts);
  }
  return loft(stations, false, true);
}

// ---------------------------------------------------------------------------
// The aeroplane
// ---------------------------------------------------------------------------

export function build737() {
  const root = new THREE.Group();

  const matFus = makeLitMaterial({ map: liveryTexture(), roughness: 0.32, specular: 0.55 });
  const matWing = makeLitMaterial({ color: 0xd7dadd, roughness: 0.38, specular: 0.5 });
  const matWingDark = makeLitMaterial({ color: 0x9aa0a6, roughness: 0.45, specular: 0.4 });
  const matFin = makeLitMaterial({ map: finTexture(), roughness: 0.35, specular: 0.5, side: THREE.DoubleSide });
  const matNac = makeLitMaterial({ color: 0xf0f1f2, roughness: 0.3, specular: 0.7 });
  const matDark = makeLitMaterial({ color: 0x24282c, roughness: 0.6, specular: 0.3 });
  const matMetal = makeLitMaterial({ color: 0x8f959b, roughness: 0.25, specular: 1.0 });
  const matTire = makeLitMaterial({ color: 0x1b1c1e, roughness: 0.95, specular: 0.05 });

  // fuselage
  const fus = new THREE.Mesh(fuselageGeometry(), matFus);
  root.add(fus);

  // main wing
  const wingPlan = [
    { span: 1.9, le: -3.4, chord: 7.6, dihedralY: -1.35, twist: 2.0, thick: 0.14 },
    { span: 5.0, le: -2.2, chord: 6.0, dihedralY: -1.05, twist: 1.4, thick: 0.13 },
    { span: 9.5, le: -0.1, chord: 4.5, dihedralY: -0.60, twist: 0.6, thick: 0.115 },
    { span: 13.5, le: 1.8, chord: 3.2, dihedralY: -0.18, twist: 0.0, thick: 0.10 },
    { span: 16.2, le: 3.1, chord: 2.3, dihedralY: 0.12, twist: -0.6, thick: 0.095 },
    { span: 17.15, le: 3.6, chord: 1.9, dihedralY: 0.25, twist: -1.0, thick: 0.09 },
  ];
  const wing = new THREE.Mesh(surfaceGeometry(wingPlan), matWing);
  wing.position.z = 2.2;
  root.add(wing);

  // winglets
  const wlPlan = [
    { span: 0.0, le: 3.6, chord: 1.9, dihedralY: 0.25, thick: 0.09 },
    { span: 0.9, le: 4.1, chord: 1.5, dihedralY: 1.5, thick: 0.085 },
    { span: 1.35, le: 4.5, chord: 1.0, dihedralY: 2.9, thick: 0.08 },
  ];
  for (const s of [-1, 1]) {
    const wl = new THREE.Mesh(surfaceGeometry(wlPlan.map(p => ({ ...p, span: 17.15 + p.span * 0.35 })), false), matFin);
    wl.position.z = 2.2;
    if (s < 0) wl.scale.x = -1;
    root.add(wl);
  }

  // horizontal stabiliser
  const stabPlan = [
    { span: 0.6, le: 0.0, chord: 3.9, dihedralY: 0.6, thick: 0.10 },
    { span: 3.5, le: 1.1, chord: 2.7, dihedralY: 0.95, thick: 0.095 },
    { span: 6.4, le: 2.2, chord: 1.5, dihedralY: 1.3, thick: 0.09 },
  ];
  const stab = new THREE.Mesh(surfaceGeometry(stabPlan), matWing);
  stab.position.z = 15.6;
  root.add(stab);

  // vertical fin
  const finSections = [];
  const finPlan = [
    { h: 0.0, le: -1.2, chord: 5.6 },
    { h: 1.6, le: -0.2, chord: 4.8 },
    { h: 4.0, le: 1.4, chord: 3.6 },
    { h: 6.3, le: 2.9, chord: 2.4 },
    { h: 7.4, le: 3.7, chord: 1.5 },
  ];
  for (const st of finPlan) {
    const af = naca(0, 0.4, 0.11, 10);
    finSections.push(af.map(([cx, cy]) => new THREE.Vector3(cy * st.chord, st.h, cx * st.chord + st.le)));
  }
  const fin = new THREE.Mesh(loft(finSections), matFin);
  fin.position.set(0, 1.5, 13.4);
  // planar UVs so the logo reads on the fin
  {
    const p = fin.geometry.attributes.position, uvA = fin.geometry.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      uvA.setXY(i, 1.0 - (p.getZ(i) + 1.6) / 7.4, p.getY(i) / 7.6);
    }
    uvA.needsUpdate = true;
  }
  root.add(fin);

  // dorsal fin fillet
  const dorsal = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.9, 4.0, 8, 1, false, 0, Math.PI), matFus);
  dorsal.rotation.x = Math.PI / 2;
  dorsal.rotation.y = Math.PI / 2;
  dorsal.position.set(0, 1.55, 11.4);
  dorsal.scale.set(0.5, 1, 1);
  root.add(dorsal);

  // --- control surfaces ---------------------------------------------------
  const surfaces = {};
  const panel = (w, c, thick = 0.10) => {
    const g = new THREE.BoxGeometry(w, thick, c);
    g.translate(0, 0, c / 2);
    return g;
  };

  surfaces.aileron = [];
  for (const s of [-1, 1]) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(panel(4.0, 1.0, 0.09), matWingDark);
    g.add(m);
    g.position.set(s * 14.6, 0.10, 5.9);
    root.add(g);
    surfaces.aileron.push({ g, sign: s });
  }

  surfaces.flap = [];
  for (const s of [-1, 1]) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(panel(7.4, 2.0, 0.13), matWingDark);
    g.add(m);
    g.position.set(s * 7.4, -0.28, 4.4);
    root.add(g);
    surfaces.flap.push({ g, sign: s, base: g.position.clone() });
  }

  surfaces.spoiler = [];
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      const m = new THREE.Mesh(panel(1.7, 0.95, 0.05), matWingDark);
      g.add(m);
      g.position.set(s * (6.0 + i * 2.0), 0.24, 3.6 + i * 0.55);
      root.add(g);
      surfaces.spoiler.push({ g, sign: s });
    }
  }

  surfaces.elevator = [];
  for (const s of [-1, 1]) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(panel(5.4, 1.15, 0.09), matWingDark);
    g.add(m);
    g.position.set(s * 3.4, 1.1, 18.0);
    root.add(g);
    surfaces.elevator.push({ g, sign: s });
  }

  {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.16, 5.6, 1.5), matFin);
    m.position.set(0, 2.9, 0.75);
    g.add(m);
    g.position.set(0, 2.0, 18.6);
    root.add(g);
    surfaces.rudder = g;
  }

  // --- engines ------------------------------------------------------------
  const engines = [];
  for (const s of [-1, 1]) {
    const eg = new THREE.Group();
    const nac = new THREE.Mesh(nacelleGeometry(), matNac);
    eg.add(nac);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(1.30, 0.11, 8, 24), matMetal);
    lip.position.z = -1.28;
    eg.add(lip);
    const fanFace = new THREE.Mesh(new THREE.CircleGeometry(1.20, 24), matDark);
    fanFace.position.z = -1.05;
    fanFace.rotation.y = Math.PI;
    eg.add(fanFace);
    const fan = new THREE.Mesh(new THREE.CylinderGeometry(1.16, 1.16, 0.10, 24, 1, true), matMetal);
    fan.rotation.x = Math.PI / 2;
    fan.position.z = -1.0;
    eg.add(fan);
    const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.7, 12), matDark);
    spinner.rotation.x = -Math.PI / 2;
    spinner.position.z = -1.25;
    eg.add(spinner);
    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.42, 1.5, 16), matMetal);
    exhaust.rotation.x = Math.PI / 2;
    exhaust.position.z = 3.6;
    eg.add(exhaust);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.40, 1.5, 14), matDark);
    cone.rotation.x = -Math.PI / 2;
    cone.position.z = 4.4;
    eg.add(cone);

    // pylon
    const pyl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.6, 3.4), matNac);
    pyl.position.set(0, 1.1, 0.9);
    eg.add(pyl);

    eg.position.set(s * 5.6, -1.55, 0.4);
    root.add(eg);
    engines.push({ g: eg, fan, spinner });
  }

  // --- landing gear -------------------------------------------------------
  const wheel = (r, w) => {
    const g = new THREE.Group();
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 18), matTire);
    tire.rotation.z = Math.PI / 2;
    g.add(tire);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, w * 1.06, 12), matMetal);
    hub.rotation.z = Math.PI / 2;
    g.add(hub);
    return g;
  };

  const noseGear = new THREE.Group();
  {
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 1.9, 10), matMetal);
    strut.position.y = -0.95;
    noseGear.add(strut);
    const axle = new THREE.Group();
    axle.position.y = -1.9;
    for (const s of [-1, 1]) {
      const w = wheel(0.42, 0.24);
      w.position.x = s * 0.24;
      axle.add(w);
    }
    noseGear.add(axle);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 1.9), matFus);
    door.position.set(0.5, -0.05, 0);
    noseGear.add(door);
    noseGear.position.set(0, -1.30, -11.6);
    root.add(noseGear);
  }

  const mainGears = [];
  for (const s of [-1, 1]) {
    const mg = new THREE.Group();
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 1.75, 10), matMetal);
    strut.position.y = -0.88;
    mg.add(strut);
    const brace = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.5, 8), matMetal);
    brace.position.set(-s * 0.35, -0.7, 0);
    brace.rotation.z = s * 0.45;
    mg.add(brace);
    const bogie = new THREE.Group();
    bogie.position.y = -1.72;
    for (const zz of [-0.46, 0.46]) {
      const w = wheel(0.56, 0.34);
      w.position.z = zz;
      bogie.add(w);
    }
    mg.add(bogie);
    mg.position.set(s * 3.9, -1.42, 1.3);
    root.add(mg);
    mainGears.push({ g: mg, sign: s });
  }

  // navigation & strobe lights
  const lightMats = {
    red: makeLitMaterial({ color: 0x330000, emissive: 0xff2222, emissiveIntensity: 3, roughness: 1 }),
    green: makeLitMaterial({ color: 0x003300, emissive: 0x22ff44, emissiveIntensity: 3, roughness: 1 }),
    white: makeLitMaterial({ color: 0x333333, emissive: 0xffffff, emissiveIntensity: 4, roughness: 1 }),
  };
  const navLights = [];
  const addLight = (x, y, z, mat, key) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), mat);
    m.position.set(x, y, z);
    root.add(m);
    navLights.push({ m, key });
  };
  addLight(-17.2, 0.4, 8.0, lightMats.red, 'nav');
  addLight(17.2, 0.4, 8.0, lightMats.green, 'nav');
  addLight(-17.1, 0.5, 8.4, lightMats.white, 'strobe');
  addLight(17.1, 0.5, 8.4, lightMats.white, 'strobe');
  addLight(0, 8.6, 17.0, lightMats.white, 'strobe');
  addLight(0, 2.0, -2.0, lightMats.red, 'beacon');
  addLight(0, -2.0, -2.0, lightMats.red, 'beacon');

  root.userData = { surfaces, engines, noseGear, mainGears, navLights, lightMats };
  return root;
}

/** Drive the animated bits from the flight model. */
export function animate737(model, ac, dt, time) {
  const { surfaces, engines, noseGear, mainGears, navLights, lightMats } = model.userData;
  const gp = ac.gearPos;

  for (const a of surfaces.aileron) a.g.rotation.x = -a.sign * ac.aileron * 0.35;
  for (const e of surfaces.elevator) e.g.rotation.x = -(ac.elevator + ac.elevTrim) * 0.38;
  surfaces.rudder.rotation.y = -ac.rudder * 0.42;

  const fdeg = ac.flapActual / 40;
  for (const f of surfaces.flap) {
    f.g.rotation.x = fdeg * 0.72;
    f.g.position.z = f.base.z + fdeg * 1.4;
    f.g.position.y = f.base.y - fdeg * 0.45;
  }
  for (const s of surfaces.spoiler) s.g.rotation.x = -ac.spoilers * 0.85;

  noseGear.rotation.x = (1 - gp) * 1.85;
  noseGear.rotation.y = ac.onGround ? -ac.rudder * 0.5 * (ac.tas < 12 ? 1 : 0.25) : 0;
  for (const m of mainGears) m.g.rotation.z = -m.sign * (1 - gp) * 1.75;
  noseGear.visible = gp > 0.001;
  for (const m of mainGears) m.g.visible = gp > 0.001;

  const spin = (ac.n1[0] / 100) * 60 * dt;
  for (const e of engines) { e.fan.rotation.y += spin; e.spinner.rotation.z += spin; }

  const strobe = (time % 1.4) < 0.06 || ((time + 0.16) % 1.4) < 0.06;
  const beacon = (Math.sin(time * 3.4) > 0.85);
  lightMats.white.uniforms.uEmissiveI.value = strobe ? 26 : 0.0;
  lightMats.red.uniforms.uEmissiveI.value = beacon ? 8 : 2.2;
  lightMats.green.uniforms.uEmissiveI.value = 2.6;
}
