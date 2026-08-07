// Simplex noise, implemented identically in JS and GLSL so that CPU-side queries
// (aircraft ground contact, tree placement, minimap) agree with what the GPU draws.

export function mod289(x) { return x - Math.floor(x * (1 / 289)) * 289; }
function permute(x) { return mod289(((x * 34) + 1) * x); }

const C0 = 0.211324865405187;
const C1 = 0.366025403784439;
const C2 = -0.577350269189626;
const C3 = 0.024390243902439;

/** 2D simplex noise, range roughly [-1,1]. Port of Ashima's snoise. */
export function snoise(px, py) {
  const dotC1 = (px + py) * C1;
  let ix = Math.floor(px + dotC1);
  let iy = Math.floor(py + dotC1);
  const dotC0 = (ix + iy) * C0;
  const x0x = px - ix + dotC0;
  const x0y = py - iy + dotC0;

  const i1x = x0x > x0y ? 1 : 0;
  const i1y = x0x > x0y ? 0 : 1;

  const x12x = x0x + C0 - i1x;
  const x12y = x0y + C0 - i1y;
  const x12z = x0x + C2;
  const x12w = x0y + C2;

  ix = mod289(ix); iy = mod289(iy);

  const p0 = permute(permute(iy) + ix);
  const p1 = permute(permute(iy + i1y) + ix + i1x);
  const p2 = permute(permute(iy + 1) + ix + 1);

  let m0 = Math.max(0.5 - (x0x * x0x + x0y * x0y), 0);
  let m1 = Math.max(0.5 - (x12x * x12x + x12y * x12y), 0);
  let m2 = Math.max(0.5 - (x12z * x12z + x12w * x12w), 0);
  m0 *= m0; m0 *= m0;
  m1 *= m1; m1 *= m1;
  m2 *= m2; m2 *= m2;

  const xx0 = 2 * (p0 * C3 - Math.floor(p0 * C3)) - 1;
  const xx1 = 2 * (p1 * C3 - Math.floor(p1 * C3)) - 1;
  const xx2 = 2 * (p2 * C3 - Math.floor(p2 * C3)) - 1;

  const h0 = Math.abs(xx0) - 0.5;
  const h1 = Math.abs(xx1) - 0.5;
  const h2 = Math.abs(xx2) - 0.5;

  const a0 = xx0 - Math.floor(xx0 + 0.5);
  const a1 = xx1 - Math.floor(xx1 + 0.5);
  const a2 = xx2 - Math.floor(xx2 + 0.5);

  m0 *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h0 * h0);
  m1 *= 1.79284291400159 - 0.85373472095314 * (a1 * a1 + h1 * h1);
  m2 *= 1.79284291400159 - 0.85373472095314 * (a2 * a2 + h2 * h2);

  const g0 = a0 * x0x + h0 * x0y;
  const g1 = a1 * x12x + h1 * x12y;
  const g2 = a2 * x12z + h2 * x12w;

  return 130 * (m0 * g0 + m1 * g1 + m2 * g2);
}

/** Fractal sum. `f0` is the starting frequency in world units (1/metres). */
export function fbmW(px, py, f0, maxOct, maxFreq) {
  let a = 0.5, s = 0, f = f0;
  for (let i = 0; i < 8; i++) {
    if (i >= maxOct || f > maxFreq) break;
    s += a * snoise(px * f, py * f);
    f *= 2.03; a *= 0.5;
  }
  return s;
}

/** Deterministic 0..1 hash from an integer 2D cell. */
export function hash2(x, y) {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return (h >>> 0) / 4294967296;
}

export const GLSL_NOISE = /* glsl */`
vec3 nmod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec2 nmod289(vec2 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec3 npermute(vec3 x){ return nmod289(((x*34.0)+1.0)*x); }

float snoise(vec2 v){
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                     -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = nmod289(i);
  vec3 p = npermute( npermute( i.y + vec3(0.0, i1.y, 1.0))
                   + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m; m = m*m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float fbmW(vec2 p, float f0, int maxOct, float maxFreq){
  float a = 0.5, s = 0.0, f = f0;
  for (int i = 0; i < 8; i++){
    if (i >= maxOct || f > maxFreq) break;
    s += a * snoise(p * f);
    f *= 2.03; a *= 0.5;
  }
  return s;
}

float hash21(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
vec2 hash22(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
`;
