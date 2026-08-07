import * as THREE from 'three';
import { GLSL_NOISE, hash2, snoise } from './noise.js';
import { GLSL_ATMO, atmo } from './atmosphere.js';
import { terrainHeight, climate, airportInfluence, isPaved, clamp, smoothstep } from './terrainCommon.js';
import { makeLitMaterial } from './litMaterial.js';

// ---------------------------------------------------------------------------
// What grows where
// ---------------------------------------------------------------------------

const NONE = 0, CONIFER = 1, BROADLEAF = 2, PALM = 3, SHRUB = 4;
const TREE_KINDS = [CONIFER, BROADLEAF, PALM, SHRUB];

function siteInfo(x, z) {
  const h = terrainHeight(x, z);
  if (h < 1.2) return null;
  // Forward differences rather than a full central-difference normal: two extra
  // terrain evaluations instead of four, and this runs tens of thousands of
  // times per rebuild.
  const e = 4.0;
  const sx = (h - terrainHeight(x + e, z)) / e;
  const sz = (h - terrainHeight(x, z + e)) / e;
  const ny = 1 / Math.sqrt(1 + sx * sx + sz * sz);
  if (ny < 0.80) return null;
  const cl = climate(x, z);
  const ap = airportInfluence(x, z);
  if (ap > 0.32) return null;              // airports keep their approach clear

  const treeline = 320 + cl.t * 3100;
  const alt = smoothstep(treeline, treeline - 700, h);           // 1 below treeline
  const wet = smoothstep(0.12, 0.42, cl.m);
  let density = wet * alt * (1 - ap / 0.32);
  density *= smoothstep(0.02, 0.10, cl.t) * (0.55 + 0.45 * smoothstep(0.3, 0.75, cl.m));
  density *= smoothstep(1.5, 7.0, h);

  let type;
  if (cl.t > 0.74 && cl.m > 0.46) type = h < 26 ? PALM : BROADLEAF;
  else if (cl.t > 0.68 && cl.m < 0.34) type = SHRUB;
  else if (cl.t > 0.40) type = BROADLEAF;
  else if (cl.t > 0.16) type = CONIFER;
  else type = h < treeline * 0.5 ? CONIFER : SHRUB;

  return { h, ny, cl, ap, density, type };
}

// ---------------------------------------------------------------------------
// Grass
// ---------------------------------------------------------------------------

function grassClumpGeometry(blades = 26, radius = 0.85) {
  const pos = [], nrm = [], uvs = [], phase = [], idx = [];
  let v = 0;
  let seed = 1;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

  for (let b = 0; b < blades; b++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * radius;
    const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
    const yaw = rnd() * Math.PI * 2;
    const dirx = Math.cos(yaw), dirz = Math.sin(yaw);
    const height = 0.30 + rnd() * 0.55;
    const width = 0.017 + rnd() * 0.013;
    const bendA = rnd() * Math.PI * 2;
    const bend = (0.10 + rnd() * 0.28) * height;
    const bx2 = Math.cos(bendA), bz2 = Math.sin(bendA);
    const ph = rnd() * 6.283;

    const levels = [0, 0.34, 0.68, 1.0];
    const widths = [1.0, 0.76, 0.44, 0.0];
    const start = v;
    for (let i = 0; i < levels.length; i++) {
      const t = levels[i];
      const y = height * t;
      const off = bend * t * t;
      const w = width * widths[i];
      const cx = bx + bx2 * off, cz = bz + bz2 * off;
      const nx = -dirz * 0.42, nz = dirx * 0.42;
      if (i === levels.length - 1) {
        pos.push(cx, y, cz); nrm.push(nx, 0.90, nz); uvs.push(0.5, t); phase.push(ph); v++;
      } else {
        pos.push(cx - dirx * w, y, cz - dirz * w); nrm.push(nx, 0.90, nz); uvs.push(0, t); phase.push(ph); v++;
        pos.push(cx + dirx * w, y, cz + dirz * w); nrm.push(nx, 0.90, nz); uvs.push(1, t); phase.push(ph); v++;
      }
    }
    for (let i = 0; i < 2; i++) {
      const a0 = start + i * 2, b0 = a0 + 1, c0 = a0 + 2, d0 = a0 + 3;
      idx.push(a0, c0, b0, b0, c0, d0);
    }
    const a0 = start + 4, b0 = start + 5, tip = start + 6;
    idx.push(a0, tip, b0);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('aPhase', new THREE.Float32BufferAttribute(phase, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

function grassMaterial(fadeRadius) {
  return new THREE.ShaderMaterial({
    uniforms: Object.assign({}, atmo, {
      uFade: { value: fadeRadius },
      uWind: { value: 0.35 },
      uWindDir: { value: new THREE.Vector2(1, 0.35) },
    }),
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      precision highp float;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      ${GLSL_NOISE}
      attribute float aPhase;
      uniform float uFade, uWind, uTime;
      uniform vec2 uWindDir;
      uniform vec3 uCamPos;
      varying vec3 vWorld; varying vec3 vNrm; varying vec2 vUv; varying vec3 vTint;
      void main(){
        mat4 im = instanceMatrix;
        vec3 base = vec3(im[3][0], im[3][1], im[3][2]);
        float d = length(base.xz - uCamPos.xz);
        float fade = 1.0 - smoothstep(uFade * 0.72, uFade, d);

        vec3 p = position;
        float t = uv.y;
        // wind: bend increases with height up the blade, gusts travel across the field
        float gust = 0.45 + 0.55 * (snoise(base.xz * 0.035 + uWindDir * uTime * 0.9) * 0.5 + 0.5);
        float sway = sin(uTime * 2.4 + aPhase + base.x * 0.25 + base.z * 0.19) * 0.55
                   + sin(uTime * 5.3 + aPhase * 1.7) * 0.18;
        p.xz += normalize(uWindDir) * sway * uWind * gust * t * t * 0.9;
        p.y *= fade;
        p.xz *= mix(0.6, 1.0, fade);

        vec4 wp = modelMatrix * im * vec4(p, 1.0);
        vWorld = wp.xyz;
        vNrm = normalize(mat3(im) * normal);
        vUv = uv;
        vTint = instanceColor;
        gl_Position = projectionMatrix * viewMatrix * wp;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      precision highp float;
      #include <common>
      #include <logdepthbuf_pars_fragment>
      ${GLSL_NOISE}
      ${GLSL_ATMO}
      varying vec3 vWorld; varying vec3 vNrm; varying vec2 vUv; varying vec3 vTint;
      void main(){
        #include <logdepthbuf_fragment>
        vec3 N = normalize(vNrm);
        if (!gl_FrontFacing) N = -N;
        vec3 L = normalize(uSunDir);
        float ndl = max(dot(N, L), 0.0);
        float back = max(dot(-N, L), 0.0);

        vec3 albedo = vTint * mix(0.42, 1.18, vUv.y);
        albedo *= mix(0.85, 1.1, abs(vUv.x - 0.5) * 2.0);
        albedo = mix(albedo, vec3(0.86, 0.90, 0.95), uSnowCover * 0.75 * smoothstep(0.3, 1.0, vUv.y));

        float ao = mix(0.45, 1.0, vUv.y);
        vec3 direct = uSunColor * uSunIntensity * (ndl + back * 0.55) * cloudShadow(vWorld) * (1.0 / 3.14159265)
                    + uMoonColor * clamp(dot(N, normalize(uMoonDir)) * 0.5 + 0.5, 0.0, 1.0) * (1.0 / 3.14159265);
        vec3 ambient = mix(uGroundAmbient, uSkyAmbient, 0.75) * ao;
        vec3 col = albedo * (direct * ao + ambient);
        col = applyAerial(col, vWorld);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

// ---------------------------------------------------------------------------
// Tree geometry
// ---------------------------------------------------------------------------

/** Push vertices around a little so canopies read as foliage, not polyhedra. */
function roughen(geo, amount, freq = 1.0) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = snoise(x * freq + y * 0.7, z * freq - y * 0.4);
    const n2 = snoise(z * freq * 2.3 + 11.0, x * freq * 2.3 - 7.0);
    const s = 1 + (n * 0.7 + n2 * 0.3) * amount;
    p.setXYZ(i, x * s, y * (1 + n2 * amount * 0.5), z * s);
  }
  geo.computeVertexNormals();
  return geo;
}

function coniferGeometry() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.13, 0.30, 9.0, 6);
  trunk.translate(0, 4.5, 0);
  colorize(trunk, 0.16, 0.11, 0.07);
  parts.push(trunk);
  const tiers = [
    [2.55, 2.6, 2.6], [2.25, 2.5, 3.9], [1.90, 2.4, 5.1],
    [1.50, 2.3, 6.3], [1.10, 2.2, 7.4], [0.68, 2.0, 8.5],
  ];
  for (const [r, hh, y] of tiers) {
    const c = new THREE.ConeGeometry(r, hh, 9, 2, true);
    const p = c.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const px = p.getX(i), pz = p.getZ(i);
      const j = 0.82 + 0.36 * (snoise(px * 3.1 + y, pz * 3.1) * 0.5 + 0.5);
      p.setXYZ(i, px * j, p.getY(i), pz * j);
    }
    c.computeVertexNormals();
    c.translate(0, y, 0);
    const v = 0.8 + Math.random() * 0.3;
    colorize(c, 0.045 * v, 0.105 * v, 0.048 * v);
    parts.push(c);
  }
  return mergeGeometries(parts);
}

function broadleafGeometry() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.20, 0.46, 5.0, 7);
  trunk.translate(0, 2.5, 0);
  colorize(trunk, 0.14, 0.105, 0.075);
  parts.push(trunk);
  for (const [ang, tilt] of [[0.4, 0.5], [2.5, 0.6], [4.6, 0.45]]) {
    const br = new THREE.CylinderGeometry(0.07, 0.15, 2.6, 5);
    br.translate(0, 1.3, 0);
    br.rotateZ(tilt);
    br.rotateY(ang);
    br.translate(0, 4.4, 0);
    colorize(br, 0.14, 0.105, 0.075);
    parts.push(br);
  }
  const blobs = [
    [0, 7.0, 0, 3.0], [1.9, 6.0, 0.8, 2.1], [-1.7, 6.2, -1.0, 2.0],
    [0.4, 8.5, -0.7, 2.0], [-0.6, 5.4, 1.7, 1.8],
  ];
  for (const [x, y, z, r] of blobs) {
    const s = new THREE.IcosahedronGeometry(r, 1);
    roughen(s, 0.26, 0.55);
    s.translate(x, y, z);
    s.scale(1, 0.82, 1);
    const v = 0.75 + Math.random() * 0.4;
    colorize(s, 0.052 * v, 0.115 * v, 0.038 * v);
    parts.push(s);
  }
  return mergeGeometries(parts);
}

function palmGeometry() {
  const parts = [];
  const pts = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    pts.push(new THREE.Vector2(0.30 - 0.16 * t, t * 8.5));
  }
  const trunk = new THREE.LatheGeometry(pts, 6);
  const posn = trunk.attributes.position;
  for (let i = 0; i < posn.count; i++) {
    const y = posn.getY(i);
    posn.setX(i, posn.getX(i) + 0.035 * y * y * 0.1);
  }
  colorize(trunk, 0.155, 0.115, 0.062);
  parts.push(trunk);
  for (let f = 0; f < 8; f++) {
    const a = (f / 8) * Math.PI * 2;
    const frond = new THREE.PlaneGeometry(0.9, 4.2, 1, 4);
    const p = frond.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const yy = p.getY(i) + 2.1;
      p.setZ(i, -0.30 * yy * yy * 0.16);
      p.setX(i, p.getX(i) * (1.0 - yy / 5.4));
    }
    frond.rotateX(-Math.PI / 2);
    frond.translate(0, 0, 2.1);
    frond.rotateX(-0.55);
    frond.rotateY(a);
    frond.translate(0, 8.4, 0);
    const v = 0.85 + Math.random() * 0.3;
    colorize(frond, 0.055 * v, 0.135 * v, 0.038 * v);
    parts.push(frond);
  }
  return mergeGeometries(parts);
}

function shrubGeometry() {
  const parts = [];
  const blobs = [[0, 1.0, 0, 1.15], [0.95, 0.72, 0.5, 0.80], [-0.75, 0.78, -0.6, 0.74]];
  for (const [x, y, z, r] of blobs) {
    const s = new THREE.IcosahedronGeometry(r, 1);
    roughen(s, 0.30, 1.1);
    s.translate(x, y, z);
    s.scale(1.15, 0.78, 1.15);
    const v = 0.8 + Math.random() * 0.35;
    colorize(s, 0.085 * v, 0.098 * v, 0.040 * v);
    parts.push(s);
  }
  return mergeGeometries(parts);
}

function colorize(geo, r, g, b) {
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const j = 0.92 + Math.random() * 0.16;
    arr[i * 3] = r * j; arr[i * 3 + 1] = g * j; arr[i * 3 + 2] = b * j;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
}

function mergeGeometries(list) {
  let vc = 0, ic = 0;
  for (const g of list) {
    vc += g.attributes.position.count;
    ic += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(vc * 3), nrm = new Float32Array(vc * 3), col = new Float32Array(vc * 3);
  const idx = new Uint32Array(ic);
  let vo = 0, io = 0;
  for (const g of list) {
    if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position, nn = g.attributes.normal, c = g.attributes.color;
    for (let i = 0; i < p.count; i++) {
      pos[(vo + i) * 3] = p.getX(i); pos[(vo + i) * 3 + 1] = p.getY(i); pos[(vo + i) * 3 + 2] = p.getZ(i);
      nrm[(vo + i) * 3] = nn.getX(i); nrm[(vo + i) * 3 + 1] = nn.getY(i); nrm[(vo + i) * 3 + 2] = nn.getZ(i);
      col[(vo + i) * 3] = c.getX(i); col[(vo + i) * 3 + 1] = c.getY(i); col[(vo + i) * 3 + 2] = c.getZ(i);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.getX(i) + vo;
    else for (let i = 0; i < p.count; i++) idx[io + i] = i + vo;
    vo += p.count;
    io += g.index ? g.index.count : p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(vc * 2), 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

// Impostor billboards for the mid distance band
function billboardTexture(kind) {
  const N = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, N, N);
  const blob = (x, y, r, c) => {
    const gr = g.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
    gr.addColorStop(0, c[0]); gr.addColorStop(0.6, c[1]); gr.addColorStop(1, c[2]);
    g.fillStyle = gr;
    g.beginPath();
    for (let a = 0; a < 26; a++) {
      const t = (a / 26) * Math.PI * 2;
      const rr = r * (0.78 + Math.random() * 0.32);
      const px = x + Math.cos(t) * rr, py = y + Math.sin(t) * rr * 0.92;
      a === 0 ? g.moveTo(px, py) : g.lineTo(px, py);
    }
    g.closePath(); g.fill();
  };
  g.fillStyle = '#3d2f22';
  if (kind === CONIFER) {
    g.fillRect(N / 2 - 3, N * 0.62, 6, N * 0.38);
    for (let i = 0; i < 5; i++) {
      const t = i / 5;
      const w = (N * 0.42) * (1 - t * 0.78);
      const y = N * (0.86 - t * 0.78);
      g.fillStyle = `rgb(${Math.round(28 + t * 24)},${Math.round(66 + t * 30)},${Math.round(32 + t * 16)})`;
      g.beginPath();
      g.moveTo(N / 2, y - N * 0.22);
      g.lineTo(N / 2 - w, y);
      g.lineTo(N / 2 + w, y);
      g.closePath(); g.fill();
    }
  } else if (kind === PALM) {
    g.fillRect(N / 2 - 3, N * 0.42, 6, N * 0.58);
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI + (i / 6) * Math.PI;
      g.strokeStyle = '#2c5c22';
      g.lineWidth = 7;
      g.beginPath();
      g.moveTo(N / 2, N * 0.42);
      g.quadraticCurveTo(N / 2 + Math.cos(a) * N * 0.30, N * 0.28,
        N / 2 + Math.cos(a) * N * 0.46, N * 0.40 + Math.abs(Math.sin(a)) * 6);
      g.stroke();
    }
  } else if (kind === SHRUB) {
    blob(N / 2, N * 0.72, N * 0.30, ['#5c6a35', '#414d26', '#2c3419']);
    blob(N * 0.36, N * 0.80, N * 0.20, ['#4e5b2e', '#39441f', '#242c14']);
  } else {
    g.fillRect(N / 2 - 4, N * 0.60, 8, N * 0.40);
    blob(N / 2, N * 0.42, N * 0.34, ['#5a7a35', '#33511f', '#1e3213']);
    blob(N * 0.33, N * 0.56, N * 0.21, ['#4c6c2c', '#2c471a', '#1a2c10']);
    blob(N * 0.68, N * 0.55, N * 0.22, ['#517230', '#2f4b1c', '#1c2e11']);
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function impostorMaterial(tex, fade) {
  return new THREE.ShaderMaterial({
    uniforms: Object.assign({}, atmo, {
      uMap: { value: tex },
      uFade: { value: fade },
      uNear: { value: 0 },
    }),
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      precision highp float;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      attribute vec3 aPos;
      attribute vec2 aScale;
      attribute vec3 aTint;
      uniform float uFade, uNear;
      uniform vec3 uCamPos;
      varying vec2 vUv; varying vec3 vTint; varying vec3 vWorld; varying float vA;
      void main(){
        float d = length(aPos.xz - uCamPos.xz);
        float f = smoothstep(uNear, uNear + 40.0, d) * (1.0 - smoothstep(uFade * 0.78, uFade, d));
        vA = f;
        vec3 right = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));
        vec3 wp = aPos + right * position.x * aScale.x + vec3(0.0, 1.0, 0.0) * (position.y + 0.5) * aScale.y;
        vUv = uv; vTint = aTint; vWorld = wp;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      precision highp float;
      #include <common>
      #include <logdepthbuf_pars_fragment>
      ${GLSL_NOISE}
      ${GLSL_ATMO}
      uniform sampler2D uMap;
      varying vec2 vUv; varying vec3 vTint; varying vec3 vWorld; varying float vA;
      void main(){
        #include <logdepthbuf_fragment>
        vec4 t = texture2D(uMap, vUv);
        float a = t.a * vA;
        if (a < 0.30) discard;
        vec3 albedo = mix(t.rgb * vTint, vec3(0.70, 0.74, 0.80), uSnowCover * 0.65);
        vec3 L = normalize(uSunDir);
        vec3 N = normalize(vec3(L.x * 0.35, 0.85, L.z * 0.35));
        float ndl = max(dot(N, L), 0.25);
        vec3 col = albedo * (uSunColor * uSunIntensity * ndl * cloudShadow(vWorld) * (1.0 / 3.14159265)
                 + uMoonColor * 0.55 * (1.0 / 3.14159265)
                 + mix(uGroundAmbient, uSkyAmbient, 0.7));
        col = applyAerial(col, vWorld);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

const GRASS_R = 26;
const GRASS_N = 620;
const NEAR_R = 150;
const IMP_R = 1500;
const IMP_N = 5200;

export class Vegetation {
  constructor(scene) {
    this.scene = scene;
    this.enabled = true;

    // grass
    this.grass = new THREE.InstancedMesh(grassClumpGeometry(), grassMaterial(GRASS_R), GRASS_N);
    this.grass.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(GRASS_N * 3), 3);
    this.grass.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.grass.frustumCulled = false;
    this.grass.count = 0;
    scene.add(this.grass);

    // near trees
    const treeMat = makeLitMaterial({ vertexColors: true, roughness: 0.9, specular: 0.05, foliage: true, side: THREE.DoubleSide, translucency: 1.0 });
    treeMat.uniforms.uWindAmp.value = 0.35;
    this.treeMat = treeMat;
    const caps = { [CONIFER]: 460, [BROADLEAF]: 460, [PALM]: 150, [SHRUB]: 320 };
    const geos = {
      [CONIFER]: coniferGeometry(), [BROADLEAF]: broadleafGeometry(),
      [PALM]: palmGeometry(), [SHRUB]: shrubGeometry(),
    };
    this.trees = {};
    for (const k of [CONIFER, BROADLEAF, PALM, SHRUB]) {
      const im = new THREE.InstancedMesh(geos[k], treeMat, caps[k]);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(caps[k] * 3), 3);
      im.frustumCulled = false;
      im.count = 0;
      scene.add(im);
      this.trees[k] = im;
    }

    // impostors
    this.imp = {};
    for (const k of [CONIFER, BROADLEAF, PALM, SHRUB]) {
      const base = new THREE.PlaneGeometry(1, 1);
      const geo = new THREE.InstancedBufferGeometry();
      geo.index = base.index;
      geo.attributes.position = base.attributes.position;
      geo.attributes.uv = base.attributes.uv;
      const cap = k === PALM ? 900 : k === SHRUB ? 1400 : IMP_N;
      geo.setAttribute('aPos', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3));
      geo.setAttribute('aScale', new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2));
      geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3));
      geo.instanceCount = 0;
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
      const mesh = new THREE.Mesh(geo, impostorMaterial(billboardTexture(k), IMP_R));
      mesh.material.uniforms.uNear.value = NEAR_R * 0.62;
      mesh.frustumCulled = false;
      mesh.renderOrder = 2;
      scene.add(mesh);
      this.imp[k] = { mesh, geo, cap };
    }

    this._grassAt = new THREE.Vector2(1e9, 1e9);
    this._treeAt = new THREE.Vector2(1e9, 1e9);
    this._impAt = new THREE.Vector2(1e9, 1e9);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this.job = null;
  }

  setWind(strength, dirRad) {
    this.grass.material.uniforms.uWind.value = 0.18 + strength * 0.9;
    this.grass.material.uniforms.uWindDir.value.set(Math.cos(dirRad), Math.sin(dirRad));
    this.treeMat.uniforms.uWindAmp.value = 0.12 + strength * 0.75;
    this.treeMat.uniforms.uWindDir.value.set(Math.cos(dirRad), Math.sin(dirRad));
  }

  update(cam, agl) {
    if (!this.enabled) {
      this.grass.count = 0;
      for (const k in this.trees) this.trees[k].count = 0;
      for (const k in this.imp) this.imp[k].geo.instanceCount = 0;
      this.job = null;
      return;
    }
    const x = cam.x, z = cam.z;
    if (agl >= 90) this.grass.count = 0;
    if (agl >= 500) for (const k in this.trees) this.trees[k].count = 0;
    if (agl >= 3200) for (const k in this.imp) this.imp[k].geo.instanceCount = 0;

    // One rebuild at a time, and it is spread over as many frames as it needs.
    // Doing a whole placement pass in a single frame means tens of thousands of
    // terrain evaluations at once, which shows up as a hitch every few seconds.
    if (!this.job) {
      if (agl < 90 && Math.hypot(x - this._grassAt.x, z - this._grassAt.y) > 6) {
        this._grassAt.set(x, z);
        this.job = this.startGrass(x, z);
      } else if (agl < 500 && Math.hypot(x - this._treeAt.x, z - this._treeAt.y) > 40) {
        this._treeAt.set(x, z);
        this.job = this.startTrees(x, z);
      } else if (agl < 3200 && Math.hypot(x - this._impAt.x, z - this._impAt.y) > 220) {
        this._impAt.set(x, z);
        this.job = this.startImpostors(x, z);
      }
    }
    if (this.job) {
      const t0 = performance.now();
      while (this.job && performance.now() - t0 < 1.6) {
        if (!this.job.step()) { this.job.finish(); this.job = null; }
      }
    }
  }

  // Each placement pass is a job that consumes one row of its grid per call, so
  // the frame loop can stop whenever it has spent its budget. Instances written
  // so far stay visible: the count only shrinks once the pass completes, which
  // means the old placement keeps drawing until the new one has overtaken it.

  startGrass(cx, cz) {
    const self = this;
    const m = this._m, q = this._q, v = this._v, s = this._s;
    const col = this.grass.instanceColor.array;
    const step = (GRASS_R * 2) / Math.sqrt(GRASS_N / 0.78);
    const prev = this.grass.count;
    let n = 0, gz = -GRASS_R;
    return {
      step() {
        if (gz > GRASS_R || n >= GRASS_N) return false;
        for (let gx = -GRASS_R; gx <= GRASS_R && n < GRASS_N; gx += step) {
          const jx = (hash2(Math.round((cx + gx) * 3), Math.round((cz + gz) * 3)) - 0.5) * step * 1.5;
          const jz = (hash2(Math.round((cz + gz) * 5) + 71, Math.round((cx + gx) * 5) + 13) - 0.5) * step * 1.5;
          const wx = cx + gx + jx, wz = cz + gz + jz;
          if (Math.hypot(wx - cx, wz - cz) > GRASS_R) continue;
          const h = terrainHeight(wx, wz);
          if (h < 0.6) continue;
          if (isPaved(wx, wz)) continue;
          const e = 2.5;
          const sx = (h - terrainHeight(wx + e, wz)) / e;
          const sz = (h - terrainHeight(wx, wz + e)) / e;
          if (1 / Math.sqrt(1 + sx * sx + sz * sz) < 0.72) continue;
          const cl = climate(wx, wz);
          if (h > 320 + cl.t * 3100 + 400) continue;
          const dry = smoothstep(0.06, 0.30, cl.m);
          if (dry < 0.12) continue;

          const r = hash2(Math.round(wx * 11), Math.round(wz * 7));
          const scale = (0.75 + r * 0.7) * (0.6 + dry * 0.6);
          v.set(wx, h - 0.05, wz);
          q.setFromAxisAngle(UP, r * 6.283);
          s.set(scale, scale * (0.7 + dry * 0.6), scale);
          m.compose(v, q, s);
          self.grass.setMatrixAt(n, m);

          const lush = smoothstep(0.25, 0.7, cl.m);
          const warm = smoothstep(0.5, 0.85, cl.t);
          const jitter = 0.85 + r * 0.35;
          col[n * 3] = (0.30 + 0.34 * (1 - lush) + warm * 0.16) * jitter;
          col[n * 3 + 1] = (0.36 + 0.34 * lush) * jitter;
          col[n * 3 + 2] = (0.10 + 0.10 * lush) * jitter;
          n++;
        }
        gz += step;
        self.grass.count = Math.max(prev, n);
        return true;
      },
      finish() {
        self.grass.count = n;
        self.grass.instanceMatrix.needsUpdate = true;
        self.grass.instanceColor.needsUpdate = true;
      },
    };
  }

  startTrees(cx, cz) {
    const self = this;
    const m = this._m, q = this._q, v = this._v, s = this._s;
    const counts = { [CONIFER]: 0, [BROADLEAF]: 0, [PALM]: 0, [SHRUB]: 0 };
    const prev = {};
    for (const k of TREE_KINDS) prev[k] = this.trees[k].count;
    const step = 7.5;
    let gz = -NEAR_R;
    return {
      step() {
        if (gz > NEAR_R) return false;
        for (let gx = -NEAR_R; gx <= NEAR_R; gx += step) {
          const cellx = Math.round((cx + gx) / step), cellz = Math.round((cz + gz) / step);
          const r1 = hash2(cellx, cellz);
          const px = cellx * step + (hash2(cellx + 999, cellz) - 0.5) * step * 1.2;
          const pz = cellz * step + (hash2(cellx, cellz + 777) - 0.5) * step * 1.2;
          if (Math.hypot(px - cx, pz - cz) > NEAR_R) continue;
          const info = siteInfo(px, pz);
          if (!info || r1 > info.density * 0.95) continue;
          const im = self.trees[info.type];
          const n = counts[info.type];
          if (n >= im.instanceMatrix.count) continue;
          const r2 = hash2(cellx + 31, cellz + 57);
          const sc = (0.6 + r2 * 0.8) * (info.type === PALM ? 0.85 : 1.0);
          v.set(px, info.h - 0.2, pz);
          q.setFromAxisAngle(UP, r2 * 6.283);
          s.set(sc, sc * (0.85 + r1 * 0.4), sc);
          m.compose(v, q, s);
          im.setMatrixAt(n, m);
          const lush = smoothstep(0.30, 0.75, info.cl.m);
          const tint = im.instanceColor.array;
          const j = 0.72 + r1 * 0.62;
          tint[n * 3] = j * (1.18 - lush * 0.34);
          tint[n * 3 + 1] = j * (0.86 + lush * 0.30);
          tint[n * 3 + 2] = j * (0.80 - lush * 0.20);
          counts[info.type]++;
        }
        gz += step;
        for (const k of TREE_KINDS) self.trees[k].count = Math.max(prev[k], counts[k]);
        return true;
      },
      finish() {
        for (const k of TREE_KINDS) {
          self.trees[k].count = counts[k];
          self.trees[k].instanceMatrix.needsUpdate = true;
          self.trees[k].instanceColor.needsUpdate = true;
        }
      },
    };
  }

  startImpostors(cx, cz) {
    const self = this;
    const counts = { [CONIFER]: 0, [BROADLEAF]: 0, [PALM]: 0, [SHRUB]: 0 };
    const prev = {};
    for (const k of TREE_KINDS) prev[k] = this.imp[k].geo.instanceCount;
    const step = 30;
    let gz = -IMP_R;
    return {
      step() {
        if (gz > IMP_R) return false;
        for (let gx = -IMP_R; gx <= IMP_R; gx += step) {
          const cellx = Math.round((cx + gx) / step), cellz = Math.round((cz + gz) / step);
          const r1 = hash2(cellx * 3 + 1, cellz * 3 + 2);
          const px = cellx * step + (hash2(cellx + 5, cellz + 9) - 0.5) * step * 1.4;
          const pz = cellz * step + (hash2(cellx + 19, cellz + 3) - 0.5) * step * 1.4;
          const d = Math.hypot(px - cx, pz - cz);
          if (d > IMP_R || d < NEAR_R * 0.55) continue;
          const info = siteInfo(px, pz);
          if (!info || r1 > info.density) continue;
          const slot = self.imp[info.type];
          const n = counts[info.type];
          if (n >= slot.cap) continue;
          const r2 = hash2(cellx + 61, cellz + 13);
          const hgt = (info.type === SHRUB ? 2.2 : info.type === PALM ? 11 : 13) * (0.7 + r2 * 0.6);
          const wid = hgt * (info.type === CONIFER ? 0.52 : 0.85);
          slot.geo.attributes.aPos.setXYZ(n, px, info.h - 0.3, pz);
          slot.geo.attributes.aScale.setXY(n, wid, hgt);
          const lush = smoothstep(0.3, 0.75, info.cl.m);
          const t = 0.80 + r2 * 0.4;
          slot.geo.attributes.aTint.setXYZ(n, t * (1.05 - lush * 0.28), t * (0.86 + lush * 0.22), t * 0.62);
          counts[info.type]++;
        }
        gz += step;
        for (const k of TREE_KINDS) self.imp[k].geo.instanceCount = Math.max(prev[k], counts[k]);
        return true;
      },
      finish() {
        for (const k of TREE_KINDS) {
          const slot = self.imp[k];
          slot.geo.instanceCount = counts[k];
          slot.geo.attributes.aPos.needsUpdate = true;
          slot.geo.attributes.aScale.needsUpdate = true;
          slot.geo.attributes.aTint.needsUpdate = true;
        }
      },
    };
  }
}

const UP = new THREE.Vector3(0, 1, 0);
export { CONIFER, BROADLEAF, PALM, SHRUB, siteInfo };
