// The single source of truth for world shape. The GLSL and JS versions below are
// line-for-line equivalents; the GPU displaces terrain with the shader version while
// the CPU uses the JS version for ground contact, object placement and the minimap.

import { snoise, fbmW, hash2 } from './noise.js';

export const MAX_AIRPORTS = 12;

// Airport flattening footprint (metres). The flat core must comfortably contain
// the runway plus its overruns.
export const AP_HALF_L = 1850.0;
export const AP_HALF_W = 300.0;
export const AP_FALLOFF = 1200.0;

// Runway geometry — 3200 m, a normal length for a jet airport and enough for a
// fully loaded 737 out of a high-elevation field.
export const RWY_LENGTH = 3200.0;
export const RWY_WIDTH = 46.0;

export const CLIMATE_SCALE = 420000.0; // metres from equator to polar climate

export const GLSL_TERRAIN = /* glsl */`
#define MAX_AIRPORTS ${MAX_AIRPORTS}
uniform vec4 uApData[MAX_AIRPORTS];   // xy = world xz, z = elevation, w = heading (rad)
uniform int  uApCount;

const float AP_HALF_L = ${AP_HALF_L.toFixed(1)};
const float AP_HALF_W = ${AP_HALF_W.toFixed(1)};
const float AP_FALLOFF = ${AP_FALLOFF.toFixed(1)};
const float CLIMATE_SCALE = ${CLIMATE_SCALE.toFixed(1)};

float ridgeN(float n){ n = 1.0 - abs(n); return n*n; }

// Continental shelf / landmass mask, 0 = deep ocean .. 1 = solid interior
float continentField(vec2 p){
  return fbmW(p + vec2(1200.0, -800.0), 0.0000220, 4, 1e9);
}

// Octave counts here are deliberately lean: this runs once per terrain vertex
// and again for every CPU-side ground query, so it is the hottest code in the
// project. Fine surface texture is added in the fragment shader instead.
float terrainBase(vec2 p, float maxFreq){
  float cont = continentField(p);
  float land = smoothstep(-0.06, 0.20, cont);
  float base = -520.0 + 1750.0 * smoothstep(-0.42, 0.60, cont);

  // Where mountain belts run
  float mm = fbmW(p + vec2(-4100.0, 2600.0), 0.0000480, 3, 1e9);
  float mountain = smoothstep(0.00, 0.46, mm) * land;

  // Ridged multifractal: each octave is gated by the one above it, so detail
  // gathers along ridgelines and the flanks and valleys stay smooth.
  float r = 0.0, a = 0.5, f = 0.00030, w = 1.0;
  for (int i = 0; i < 6; i++){
    if (f > maxFreq) break;
    float n = ridgeN(snoise(p * f + vec2(17.3, -9.1))) * w;
    w = clamp(n * 2.4, 0.0, 1.0);
    r += a * n;
    f *= 2.07; a *= 0.52;
  }
  r *= 1.42;
  float h = base + mountain * r * 2900.0;

  // Rolling hills + valleys
  h += land * fbmW(p + vec2(88.0, 33.0), 0.00105, 4, maxFreq) * 64.0;
  // Fine surface relief
  h += land * fbmW(p + vec2(-500.0, 900.0), 0.00850, 3, maxFreq) * 7.0;
  return h;
}

// Flatten the ground into a plateau around each nearby airport.
float applyAirports(vec2 p, float h){
  for (int i = 0; i < MAX_AIRPORTS; i++){
    if (i >= uApCount) break;
    vec4 ap = uApData[i];
    vec2 d = p - ap.xy;
    vec2 fwd = vec2(sin(ap.w), -cos(ap.w));
    vec2 side = vec2(cos(ap.w), sin(ap.w));
    vec2 l = vec2(dot(d, fwd), dot(d, side));
    vec2 q = max(abs(l) - vec2(AP_HALF_L, AP_HALF_W), vec2(0.0));
    float t = 1.0 - smoothstep(0.0, AP_FALLOFF, length(q));
    t = t * t * (3.0 - 2.0 * t);
    h = mix(h, ap.z, t);
  }
  return h;
}

float terrainHeight(vec2 p, float maxFreq){
  return applyAirports(p, terrainBase(p, maxFreq));
}

// x = temperature (0 polar .. 1 tropical), y = moisture (0 arid .. 1 wet)
vec2 climate(vec2 p){
  float lat = clamp(p.y / CLIMATE_SCALE, -1.6, 1.6);
  float t = 0.70 - 0.78 * abs(lat)
          + 0.30 * fbmW(p + vec2(9000.0, 4000.0), 0.0000165, 2, 1e9);
  float m = 0.50 + 0.62 * fbmW(p + vec2(-21000.0, 15000.0), 0.0000205, 2, 1e9);
  return clamp(vec2(t, m), 0.0, 1.0);
}
`;

// ---------------------------------------------------------------------------
// JS mirror
// ---------------------------------------------------------------------------

let apData = [];   // {x, z, elev, hdg}

export function setAirportUniformData(list) { apData = list; }

function ridgeN(n) { n = 1 - Math.abs(n); return n * n; }

export function continentField(x, z) {
  return fbmW(x + 1200, z - 800, 0.0000220, 4, 1e9);
}

export function terrainBase(x, z, maxFreq = 1e9) {
  const cont = continentField(x, z);
  const land = smoothstep(-0.06, 0.20, cont);
  const base = -520 + 1750 * smoothstep(-0.42, 0.60, cont);

  const mm = fbmW(x - 4100, z + 2600, 0.0000480, 3, 1e9);
  const mountain = smoothstep(0.0, 0.46, mm) * land;

  let r = 0, a = 0.5, f = 0.00030, w = 1;
  for (let i = 0; i < 6; i++) {
    if (f > maxFreq) break;
    const n = ridgeN(snoise(x * f + 17.3, z * f - 9.1)) * w;
    w = clamp(n * 2.4, 0, 1);
    r += a * n;
    f *= 2.07; a *= 0.52;
  }
  r *= 1.42;
  let h = base + mountain * r * 2900;
  h += land * fbmW(x + 88, z + 33, 0.00105, 4, maxFreq) * 64;
  h += land * fbmW(x - 500, z + 900, 0.00850, 3, maxFreq) * 7;
  return h;
}

export function applyAirports(x, z, h) {
  for (let i = 0; i < apData.length; i++) {
    const ap = apData[i];
    const dx = x - ap.x, dz = z - ap.z;
    const fx = Math.sin(ap.hdg), fz = -Math.cos(ap.hdg);
    const sx = Math.cos(ap.hdg), sz = Math.sin(ap.hdg);
    const lx = dx * fx + dz * fz;
    const ly = dx * sx + dz * sz;
    const qx = Math.max(Math.abs(lx) - AP_HALF_L, 0);
    const qy = Math.max(Math.abs(ly) - AP_HALF_W, 0);
    let t = 1 - smoothstep(0, AP_FALLOFF, Math.hypot(qx, qy));
    t = t * t * (3 - 2 * t);
    h = h + (ap.elev - h) * t;
  }
  return h;
}

export function terrainHeight(x, z, maxFreq = 1e9) {
  return applyAirports(x, z, terrainBase(x, z, maxFreq));
}

/** True where an airport has laid asphalt or concrete — nothing grows here. */
export function isPaved(x, z) {
  for (let i = 0; i < apData.length; i++) {
    const ap = apData[i];
    const dx = x - ap.x, dz = z - ap.z;
    const lx = dx * Math.sin(ap.hdg) + dz * -Math.cos(ap.hdg);
    const ly = dx * Math.cos(ap.hdg) + dz * Math.sin(ap.hdg);
    const alx = Math.abs(lx), aly = Math.abs(ly);
    if (alx < RWY_LENGTH / 2 + 70 && aly < RWY_WIDTH / 2 + 17) return true;
    if (alx < RWY_LENGTH / 2 - 95 && Math.abs(ly - (RWY_WIDTH / 2 + 95)) < 14) return true;
    if (Math.abs(lx + 120) < 165 && Math.abs(ly - (RWY_WIDTH / 2 + 225)) < 110) return true;
  }
  return false;
}

/** 0..1 — how much an airport has taken over this patch of ground. */
export function airportInfluence(x, z) {
  let best = 0;
  for (let i = 0; i < apData.length; i++) {
    const ap = apData[i];
    const dx = x - ap.x, dz = z - ap.z;
    const lx = dx * Math.sin(ap.hdg) + dz * -Math.cos(ap.hdg);
    const ly = dx * Math.cos(ap.hdg) + dz * Math.sin(ap.hdg);
    const qx = Math.max(Math.abs(lx) - AP_HALF_L, 0);
    const qy = Math.max(Math.abs(ly) - AP_HALF_W, 0);
    best = Math.max(best, 1 - smoothstep(0, AP_FALLOFF * 0.75, Math.hypot(qx, qy)));
  }
  return best;
}

/** Surface normal via central differences. */
export function terrainNormal(x, z, eps = 2.0, out = { x: 0, y: 1, z: 0 }) {
  const hL = terrainHeight(x - eps, z), hR = terrainHeight(x + eps, z);
  const hD = terrainHeight(x, z - eps), hU = terrainHeight(x, z + eps);
  const nx = hL - hR, ny = 2 * eps, nz = hD - hU;
  const inv = 1 / Math.hypot(nx, ny, nz);
  out.x = nx * inv; out.y = ny * inv; out.z = nz * inv;
  return out;
}

export function climate(x, z) {
  const lat = clamp(z / CLIMATE_SCALE, -1.6, 1.6);
  const t = 0.70 - 0.78 * Math.abs(lat)
    + 0.30 * fbmW(x + 9000, z + 4000, 0.0000165, 2, 1e9);
  const m = 0.50 + 0.62 * fbmW(x - 21000, z + 15000, 0.0000205, 2, 1e9);
  return { t: clamp(t, 0, 1), m: clamp(m, 0, 1) };
}

export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export { hash2 };
