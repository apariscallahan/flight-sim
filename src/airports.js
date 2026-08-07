import * as THREE from 'three';
import { hash2 } from './noise.js';
import { terrainBase, RWY_LENGTH, RWY_WIDTH, AP_FALLOFF } from './terrainCommon.js';
import { makeLitMaterial } from './litMaterial.js';
import { atmo } from './atmosphere.js';

export const CELL = 36000;          // one airport candidate per 36 km cell
const SEARCH_RADIUS = 100000;       // airports fed to the terrain shader
const BUILD_RADIUS = 42000;         // airports with real geometry

const cellCache = new Map();

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function makeName(cx, cz) {
  const a = Math.floor(hash2(cx * 7 + 3, cz * 13 + 11) * 26);
  const b = Math.floor(hash2(cx * 17 + 5, cz * 3 + 29) * 26);
  const c = Math.floor(hash2(cx * 31 + 7, cz * 23 + 41) * 26);
  return 'K' + LETTERS[a] + LETTERS[b] + LETTERS[c];
}

/** Deterministic airport (or null) for an integer cell. */
export function airportForCell(cx, cz) {
  const key = cx + ',' + cz;
  if (cellCache.has(key)) return cellCache.get(key);
  let result = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    const hx = hash2(cx * 92821 + attempt * 7919, cz * 68917 + 13);
    const hz = hash2(cx * 40499 + 31, cz * 74093 + attempt * 5417);
    const x = (cx + 0.15 + hx * 0.7) * CELL;
    const z = (cz + 0.15 + hz * 0.7) * CELL;

    let lo = Infinity, hi = -Infinity, sum = 0, n = 0;
    for (const [ox, oz] of [[0, 0], [1400, 0], [-1400, 0], [0, 1400], [0, -1400], [1000, 1000], [-1000, -1000]]) {
      const h = terrainBase(x + ox, z + oz);
      lo = Math.min(lo, h); hi = Math.max(hi, h); sum += h; n++;
    }
    if (lo < 10 || hi - lo > 280) continue;
    const elev = sum / n;

    // Both ends need a usable approach and departure corridor: a 2.3% surface
    // (well under a 3-degree glideslope) close in, and a 5.5% climb surface
    // further out. `d` is measured from the airport centre; the thresholds sit
    // at +/- RWY_LENGTH/2.
    const hdg = hash2(cx * 5011 + 91, cz * 7717 + attempt * 33) * Math.PI;
    const fx = Math.sin(hdg), fz = -Math.cos(hdg);
    const thr = RWY_LENGTH / 2;
    let clear = true;
    // gate distances from the airport centre, each paired with the highest
    // ground allowed there. All sit below a 3-degree glideslope from the
    // threshold (5.24%), so a normal approach stays clear of terrain.
    const gates = [
      [3000, 25 + (3000 - thr) * 0.040],
      [4200, 25 + (4200 - thr) * 0.040],
      [5600, 25 + (5600 - thr) * 0.040],
      [7500, 25 + (7500 - thr) * 0.042],
      [10000, 25 + (10000 - thr) * 0.044],
      [13500, 45 + (13500 - thr) * 0.050],
    ];
    for (const [d, limit] of gates) {
      for (const s of [-1, 1]) {
        if (terrainBase(x + fx * d * s, z + fz * d * s) > elev + limit) { clear = false; break; }
      }
      if (!clear) break;
    }
    if (!clear) continue;

    result = {
      key, cx, cz, x, z, elev, hdg,
      name: makeName(cx, cz),
    };
    break;
  }
  cellCache.set(key, result);
  return result;
}

export function airportsNear(x, z, radius = SEARCH_RADIUS, max = 12) {
  const r = Math.ceil(radius / CELL);
  const cx0 = Math.floor(x / CELL), cz0 = Math.floor(z / CELL);
  const found = [];
  for (let j = -r; j <= r; j++) {
    for (let i = -r; i <= r; i++) {
      const ap = airportForCell(cx0 + i, cz0 + j);
      if (!ap) continue;
      const d = Math.hypot(ap.x - x, ap.z - z);
      if (d <= radius) found.push({ ap, d });
    }
  }
  found.sort((a, b) => a.d - b.d);
  return found.slice(0, max).map(f => f.ap);
}

export function runwayDesignation(hdgRad) {
  let deg = (hdgRad * 180) / Math.PI;
  deg = ((deg % 360) + 360) % 360;
  let n = Math.round(deg / 10);
  if (n === 0) n = 36;
  return n;
}

// ---------------------------------------------------------------------------
// Procedural runway texture
// ---------------------------------------------------------------------------

const texCache = new Map();

function runwayTexture(desigA) {
  if (texCache.has(desigA)) return texCache.get(desigA);
  const W = 256, H = 2048;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');

  const px = W / RWY_WIDTH;        // px per metre across
  const py = H / RWY_LENGTH;       // px per metre along
  const X = m => W * 0.5 + m * px; // metres from centreline
  const Y = m => m * py;           // metres from threshold A

  g.fillStyle = '#3b3c3e';
  g.fillRect(0, 0, W, H);

  // asphalt grain
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 34;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);

  // longitudinal construction seams + patches
  g.globalAlpha = 0.18;
  for (let k = 0; k < 9; k++) {
    g.fillStyle = k % 2 ? '#2e2f31' : '#47484a';
    const y = (k / 9) * H + Math.random() * 40;
    g.fillRect(0, y, W, 6 + Math.random() * 10);
  }
  for (let k = 0; k < 24; k++) {
    g.fillStyle = Math.random() > 0.5 ? '#333436' : '#454648';
    g.fillRect(Math.random() * W, Math.random() * H, 20 + Math.random() * 70, 30 + Math.random() * 120);
  }
  g.globalAlpha = 1;

  const white = '#e8e9e6';
  g.fillStyle = white;

  // edge stripes
  const edge = RWY_WIDTH / 2 - 1.2;
  g.fillRect(X(-edge - 0.45), 0, 0.9 * px, H);
  g.fillRect(X(edge - 0.45), 0, 0.9 * px, H);

  // centreline: 30 m stripe / 20 m gap
  for (let m = 60; m < RWY_LENGTH - 60; m += 50) {
    g.fillRect(X(-0.45), Y(m), 0.9 * px, 30 * py);
  }

  const drawEnd = (flip) => {
    const T = m => (flip ? Y(RWY_LENGTH - m) : Y(m));
    const hgt = (h) => (flip ? -h : h);

    // piano keys: 12 stripes, 1.8 m wide, 45 m long
    for (let k = 0; k < 12; k++) {
      const off = (k - 5.5) * 3.0;
      g.fillRect(X(off - 0.9), T(6), 1.8 * px, hgt(45 * py));
    }
    // touchdown zone bars at 150 m and 300 m
    for (const dist of [150, 300, 450]) {
      for (const s of [-1, 1]) {
        for (let b = 0; b < (dist === 300 ? 1 : dist === 150 ? 3 : 2); b++) {
          const lat = s * (5.5 + b * 2.5);
          g.fillRect(X(lat - 0.9), T(dist), 1.8 * px, hgt(22 * py));
        }
      }
    }
    // aiming point: 45 m x 6 m
    for (const s of [-1, 1]) {
      g.fillRect(X(s * 11 - 3), T(300), 6 * px, hgt(45 * py));
    }
    // rubber deposits
    const gr = g.createLinearGradient(0, T(120), 0, T(560));
    gr.addColorStop(0, 'rgba(24,24,26,0.55)');
    gr.addColorStop(0.35, 'rgba(24,24,26,0.42)');
    gr.addColorStop(1, 'rgba(24,24,26,0)');
    g.fillStyle = gr;
    g.fillRect(X(-16), Math.min(T(120), T(560)), 32 * px, Math.abs(T(560) - T(120)));
    g.fillStyle = white;
  };
  drawEnd(false);
  drawEnd(true);

  // designations
  const drawNumber = (num, flip) => {
    const s = String(num).padStart(2, '0');
    g.save();
    const cy = flip ? Y(RWY_LENGTH - 110) : Y(110);
    g.translate(W / 2, cy);
    if (!flip) g.rotate(Math.PI);
    g.scale(1, py / px * 3.2);   // counteract the anisotropic texel aspect
    g.fillStyle = white;
    g.font = 'bold 86px "Arial Narrow", Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(s, 0, 0);
    g.restore();
  };
  drawNumber(desigA, false);
  drawNumber(((desigA + 18 - 1) % 36) + 1, true);

  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  texCache.set(desigA, tex);
  return tex;
}

// ---------------------------------------------------------------------------
// Light points
// ---------------------------------------------------------------------------

function lightSprite() {
  if (lightSprite._t) return lightSprite._t;
  const N = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d');
  const gr = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.18, 'rgba(255,255,255,0.85)');
  gr.addColorStop(0.45, 'rgba(255,255,255,0.22)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, N, N);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  lightSprite._t = t;
  return t;
}

export const lightUniforms = {
  uLightGain: { value: 1.0 },
};

function makeLights(positions, colors, sizes) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('lcolor', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('lsize', new THREE.Float32BufferAttribute(sizes, 1));
  geo.computeBoundingSphere();

  const mat = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, atmo, {
      uSprite: { value: lightSprite() },
      uLightGain: lightUniforms.uLightGain,
    }),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      precision highp float;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      attribute vec3 lcolor;
      attribute float lsize;
      varying vec3 vC;
      varying float vFade;
      uniform vec3 uCamPos;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vec4 mv = viewMatrix * wp;
        float dist = -mv.z;
        gl_Position = projectionMatrix * mv;
        float s = lsize * 620.0 / max(dist, 1.0);
        gl_PointSize = clamp(s, 1.0, 46.0);
        // keep total energy roughly constant when the sprite hits its floor size
        vFade = clamp(s / max(gl_PointSize, 0.001), 0.05, 1.0);
        vFade *= 1.0 - smoothstep(26000.0, 42000.0, dist);
        vC = lcolor;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      precision highp float;
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform sampler2D uSprite;
      uniform float uLightGain;
      varying vec3 vC;
      varying float vFade;
      void main(){
        #include <logdepthbuf_fragment>
        float a = texture2D(uSprite, gl_PointCoord).a;
        if (a < 0.004) discard;
        gl_FragColor = vec4(vC * uLightGain * (0.4 + 0.6 * vFade), a * uLightGain * vFade);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

// ---------------------------------------------------------------------------
// Airport geometry
// ---------------------------------------------------------------------------

const sharedMats = {};
function mats() {
  if (sharedMats.built) return sharedMats;
  sharedMats.concrete = makeLitMaterial({ color: 0x74736f, roughness: 0.95, specular: 0.08 });
  sharedMats.taxi = makeLitMaterial({ color: 0x4a4b4d, roughness: 0.92, specular: 0.1 });
  sharedMats.buildingA = makeLitMaterial({ color: 0xb9bcc0, roughness: 0.7, specular: 0.25 });
  sharedMats.buildingB = makeLitMaterial({ color: 0x6f7479, roughness: 0.7, specular: 0.25 });
  sharedMats.glass = makeLitMaterial({ color: 0x2b3b47, roughness: 0.15, specular: 1.2, emissive: 0xffd9a0, emissiveIntensity: 0.0 });
  sharedMats.built = true;
  return sharedMats;
}

function buildAirport(ap) {
  const g = new THREE.Group();
  const M = mats();
  const desig = runwayDesignation(ap.hdg);

  // Runway strip
  const rw = new THREE.Mesh(
    new THREE.PlaneGeometry(RWY_WIDTH, RWY_LENGTH),
    makeLitMaterial({ map: runwayTexture(desig), roughness: 0.9, specular: 0.22 })
  );
  rw.geometry.rotateX(-Math.PI / 2);
  rw.position.set(0, 0.12, 0);
  g.add(rw);

  // Shoulders + blast pads
  const shoulder = new THREE.Mesh(new THREE.PlaneGeometry(RWY_WIDTH + 30, RWY_LENGTH + 130), M.concrete);
  shoulder.geometry.rotateX(-Math.PI / 2);
  shoulder.position.set(0, 0.05, 0);
  g.add(shoulder);

  // Parallel taxiway
  const taxi = new THREE.Mesh(new THREE.PlaneGeometry(23, RWY_LENGTH - 200), M.taxi);
  taxi.geometry.rotateX(-Math.PI / 2);
  taxi.position.set(RWY_WIDTH / 2 + 95, 0.09, 0);
  g.add(taxi);
  for (const t of [-1, 0, 1]) {
    const link = new THREE.Mesh(new THREE.PlaneGeometry(23, 95 + RWY_WIDTH), M.taxi);
    link.geometry.rotateX(-Math.PI / 2);
    link.geometry.rotateY(Math.PI / 2);
    link.position.set(RWY_WIDTH / 2 + 47, 0.09, t * (RWY_LENGTH / 2 - 180));
    g.add(link);
  }

  // Apron + buildings
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(210, 320), M.taxi);
  apron.geometry.rotateX(-Math.PI / 2);
  apron.position.set(RWY_WIDTH / 2 + 95 + 130, 0.08, -120);
  g.add(apron);

  const term = new THREE.Mesh(new THREE.BoxGeometry(48, 16, 190), M.buildingA);
  term.position.set(RWY_WIDTH / 2 + 95 + 215, 8, -120);
  g.add(term);
  const termGlass = new THREE.Mesh(new THREE.BoxGeometry(48.6, 7, 186), M.glass);
  termGlass.position.set(RWY_WIDTH / 2 + 95 + 215, 9.5, -120);
  g.add(termGlass);

  const towerBase = new THREE.Mesh(new THREE.CylinderGeometry(5, 7, 34, 12), M.buildingB);
  towerBase.position.set(RWY_WIDTH / 2 + 95 + 175, 17, 20);
  g.add(towerBase);
  const towerCab = new THREE.Mesh(new THREE.CylinderGeometry(11, 8.5, 8, 12), M.glass);
  towerCab.position.set(RWY_WIDTH / 2 + 95 + 175, 38, 20);
  g.add(towerCab);
  const towerRoof = new THREE.Mesh(new THREE.CylinderGeometry(12, 12, 1.4, 12), M.buildingB);
  towerRoof.position.set(RWY_WIDTH / 2 + 95 + 175, 42.6, 20);
  g.add(towerRoof);

  for (let i = 0; i < 3; i++) {
    const hangar = new THREE.Mesh(new THREE.CylinderGeometry(26, 26, 62, 14, 1, false, 0, Math.PI), M.buildingB);
    hangar.rotation.z = -Math.PI / 2;
    hangar.rotation.y = Math.PI / 2;
    hangar.position.set(RWY_WIDTH / 2 + 95 + 200, 0, 140 + i * 72);
    g.add(hangar);
  }

  // --- lights -------------------------------------------------------------
  const P = [], C = [], S = [];
  const push = (x, y, z, c, s) => { P.push(x, y, z); C.push(c[0], c[1], c[2]); S.push(s); };
  const half = RWY_LENGTH / 2;
  const edgeX = RWY_WIDTH / 2 + 2.5;

  for (let m = -half; m <= half; m += 60) {
    const amber = Math.abs(m) > half - 600;
    const col = amber ? [1.0, 0.72, 0.25] : [1.0, 0.95, 0.85];
    push(-edgeX, 0.55, m, col, 1.0);
    push(edgeX, 0.55, m, col, 1.0);
  }
  // thresholds: green outward, red inward
  for (const end of [-1, 1]) {
    for (let k = -7; k <= 7; k++) {
      push(k * 3.1, 0.5, end * (half - 1), [0.15, 1.0, 0.35], 1.15);
      push(k * 3.1, 0.5, end * (half + 3), [1.0, 0.12, 0.12], 1.0);
    }
    // approach lighting system, 900 m out
    for (let d = 30; d <= 900; d += 30) {
      const z = end * (half + d);
      const rowW = d < 300 ? 3 : 1;
      for (let k = -rowW; k <= rowW; k++) push(k * 2.2, 0.9, z, [1.0, 0.98, 0.92], d % 150 === 0 ? 1.5 : 1.0);
      if (d === 300 || d === 600) for (let k = -7; k <= 7; k++) push(k * 2.2, 0.9, z, [1.0, 0.98, 0.92], 1.2);
    }
    // PAPI
    for (let k = 0; k < 4; k++) {
      push(-(RWY_WIDTH / 2 + 14 + k * 9), 0.8, end * (half - 300), [1.0, 0.98, 0.9], 1.3);
    }
  }
  // taxiway blue edge lights
  for (let m = -half + 100; m <= half - 100; m += 75) {
    push(RWY_WIDTH / 2 + 95 - 13, 0.5, m, [0.25, 0.5, 1.0], 0.8);
    push(RWY_WIDTH / 2 + 95 + 13, 0.5, m, [0.25, 0.5, 1.0], 0.8);
  }
  // apron floodlights
  for (let i = 0; i < 6; i++) {
    push(RWY_WIDTH / 2 + 95 + 40 + i * 34, 14, -120 + (i % 2) * 140 - 70, [1.0, 0.9, 0.7], 2.4);
  }
  // tower beacon
  push(RWY_WIDTH / 2 + 95 + 175, 44, 20, [0.4, 1.0, 0.6], 2.6);

  g.add(makeLights(P, C, S));

  g.position.set(ap.x, ap.elev, ap.z);
  g.rotation.y = -ap.hdg;
  g.userData.key = ap.key;
  return g;
}

export class AirportManager {
  constructor(scene) {
    this.scene = scene;
    this.live = new Map();
    this.nearList = [];
    this._lastX = 1e9; this._lastZ = 1e9;
  }

  update(x, z) {
    if (Math.hypot(x - this._lastX, z - this._lastZ) < 800) return this.nearList;
    this._lastX = x; this._lastZ = z;
    this.nearList = airportsNear(x, z, SEARCH_RADIUS, 12);

    const want = new Set();
    for (const ap of this.nearList) {
      if (Math.hypot(ap.x - x, ap.z - z) < BUILD_RADIUS) {
        want.add(ap.key);
        if (!this.live.has(ap.key)) {
          const g = buildAirport(ap);
          this.scene.add(g);
          this.live.set(ap.key, g);
        }
      }
    }
    for (const [key, g] of this.live) {
      if (!want.has(key)) {
        this.scene.remove(g);
        g.traverse(o => { if (o.geometry) o.geometry.dispose(); });
        this.live.delete(key);
      }
    }
    return this.nearList;
  }
}
