// Physically-flavoured atmosphere: Rayleigh + Mie single scattering baked into a
// small equirectangular LUT whenever the sun moves, then reused for the skydome,
// image-based ambient, and aerial perspective on every other surface.

import * as THREE from 'three';
import { GLSL_NOISE } from './noise.js';

const Rg = 6360e3;      // planet radius
const Rt = 6420e3;      // atmosphere top
const Hr = 8000.0;      // Rayleigh scale height
const Hm = 1200.0;      // Mie scale height
const betaR = [5.8e-6, 13.5e-6, 33.1e-6];
const betaM = 21e-6;
const MIE_G = 0.76;

export const GLSL_SCATTER = /* glsl */`
const float Rg = 6360000.0;
const float Rt = 6420000.0;
const float Hr = 8000.0;
const float Hm = 1200.0;
const vec3  betaR = vec3(5.8e-6, 13.5e-6, 33.1e-6);
const float betaM = 21e-6;
const float MIE_G = 0.76;

// distance to the outer sphere along ray (assumes origin inside)
float raySphere(vec3 o, vec3 d, float r){
  float b = dot(o, d);
  float c = dot(o, o) - r * r;
  float h = b * b - c;
  if (h < 0.0) return -1.0;
  return -b + sqrt(h);
}
bool hitsGround(vec3 o, vec3 d){
  float b = dot(o, d);
  float c = dot(o, o) - Rg * Rg;
  return (b < 0.0) && (b * b - c > 0.0);
}

vec3 transmittance(vec3 o, vec3 d, float len){
  const int N = 6;
  float dr = 0.0, dm = 0.0;
  float step = len / float(N);
  for (int i = 0; i < N; i++){
    vec3 s = o + d * (float(i) + 0.5) * step;
    float h = max(length(s) - Rg, 0.0);
    dr += exp(-h / Hr) * step;
    dm += exp(-h / Hm) * step;
  }
  return exp(-(betaR * dr + betaM * 1.1 * dm));
}

// Single-scattered radiance looking along dir from alt metres up.
vec3 scatter(vec3 dir, vec3 sunDir, float alt, float sunIntensity){
  vec3 o = vec3(0.0, Rg + max(alt, 1.0), 0.0);
  float ground = -1.0;
  bool hg = hitsGround(o, dir);
  float len;
  if (hg){
    float b = dot(o, dir);
    float c = dot(o, o) - Rg * Rg;
    len = -b - sqrt(max(b * b - c, 0.0));
  } else {
    len = raySphere(o, dir, Rt);
  }
  len = min(len, 260000.0);

  const int N = 16;
  float step = len / float(N);
  float odr = 0.0, odm = 0.0;
  vec3 sumR = vec3(0.0), sumM = vec3(0.0);

  for (int i = 0; i < N; i++){
    vec3 s = o + dir * (float(i) + 0.5) * step;
    float h = max(length(s) - Rg, 0.0);
    float hr = exp(-h / Hr) * step;
    float hm = exp(-h / Hm) * step;
    odr += hr; odm += hm;

    vec3 upS = normalize(s);
    float sunLen = raySphere(s, sunDir, Rt);
    vec3 tSun = hitsGround(s, sunDir) ? vec3(0.0)
              : transmittance(s, sunDir, min(sunLen, 260000.0));
    vec3 tView = exp(-(betaR * odr + betaM * 1.1 * odm));
    vec3 att = tSun * tView;
    sumR += hr * att;
    sumM += hm * att;
  }

  float mu = dot(dir, sunDir);
  float pr = 3.0 / (16.0 * 3.14159265) * (1.0 + mu * mu);
  float g = MIE_G;
  float pm = 3.0 / (8.0 * 3.14159265) * ((1.0 - g * g) * (1.0 + mu * mu)) /
             ((2.0 + g * g) * pow(max(1.0 + g * g - 2.0 * g * mu, 1e-4), 1.5));

  vec3 col = (sumR * betaR * pr + sumM * betaM * pm) * sunIntensity;
  return max(col, vec3(0.0));
}
`;

// Shared uniforms — every material references these same objects.
export const atmo = {
  uSkyLUT: { value: null },
  uSunDir: { value: new THREE.Vector3(0.4, 0.6, -0.7) },
  uSunColor: { value: new THREE.Color(1, 1, 1) },
  uSunIntensity: { value: 20.0 },
  uSkyAmbient: { value: new THREE.Color(0.3, 0.45, 0.7) },
  uGroundAmbient: { value: new THREE.Color(0.15, 0.14, 0.12) },
  uCamPos: { value: new THREE.Vector3() },
  uFogRho: { value: 1.0 / 26000.0 },
  uFogH: { value: 2400.0 },
  uFogUniform: { value: 0.0 },
  uFogTint: { value: new THREE.Color(0.7, 0.75, 0.82) },
  uFogTintMix: { value: 0.0 },
  uTime: { value: 0 },
  uWetness: { value: 0.0 },
  uSnowCover: { value: 0.0 },
  uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
  uMoonColor: { value: new THREE.Color(0, 0, 0) },
  uNightMix: { value: 0 },
  uCloudShadow: { value: null },
  // xy = map centre, z = half extent, w = cloud base altitude
  uCloudShadowRect: { value: new THREE.Vector4(0, 0, 30000, 1500) },
};

export const GLSL_ATMO = /* glsl */`
uniform sampler2D uSkyLUT;
uniform vec3  uSunDir;
uniform vec3  uSunColor;
uniform float uSunIntensity;
uniform vec3  uSkyAmbient;
uniform vec3  uGroundAmbient;
uniform vec3  uCamPos;
uniform float uFogRho;
uniform float uFogH;
uniform float uFogUniform;
uniform vec3  uFogTint;
uniform float uFogTintMix;
uniform float uTime;
uniform float uWetness;
uniform float uSnowCover;
uniform vec3  uMoonDir;
uniform vec3  uMoonColor;
uniform sampler2D uCloudShadow;
uniform vec4  uCloudShadowRect;
uniform float uNightMix;

/** Scotopic vision: colour drains away and shifts blue in dim light. */
vec3 nightAdapt(vec3 c){
  if (uNightMix <= 0.002) return c;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return mix(c, vec3(l) * vec3(0.68, 0.84, 1.32), uNightMix);
}

/** 1.0 in full sun, lower under the cumulus deck. */
float cloudShadow(vec3 wp){
  vec3 L = normalize(uSunDir);
  if (L.y < 0.06) return 1.0;
  float t = max((uCloudShadowRect.w - wp.y) / L.y, 0.0);
  if (t <= 0.0) return 1.0;
  vec2 p = wp.xz + L.xz * t;
  vec2 uv = (p - uCloudShadowRect.xy) / (2.0 * uCloudShadowRect.z) + 0.5;
  float edge = min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y));
  if (edge <= 0.0) return 1.0;
  float s = texture2D(uCloudShadow, uv).r;
  return mix(1.0, s, smoothstep(0.0, 0.06, edge));
}

/** Diffuse irradiance from sun + moon for a surface with normal N. */
vec3 keyLight(vec3 N, vec3 wp){
  float ndl = max(dot(N, normalize(uSunDir)), 0.0) * cloudShadow(wp);
  float ndm = clamp((dot(N, normalize(uMoonDir)) + 0.16) / 1.16, 0.0, 1.0);
  return (uSunColor * uSunIntensity * ndl + uMoonColor * ndm) * (1.0 / 3.14159265);
}

vec2 skyDirToUv(vec3 d){
  float az = atan(d.z, d.x) / 6.2831853 + 0.5;
  float el = asin(clamp(d.y, -1.0, 1.0)) / 1.5707963;   // -1..1
  float v = sign(el) * sqrt(abs(el)) * 0.5 + 0.5;
  return vec2(az, clamp(v, 0.002, 0.998));
}

vec3 sampleSky(vec3 d){
  return texture2D(uSkyLUT, skyDirToUv(normalize(d))).rgb;
}

// Analytic exponential-height fog integral plus a uniform (precipitation) term.
float fogAmount(vec3 worldPos){
  vec3 delta = worldPos - uCamPos;
  float dist = length(delta);
  vec3 dirN = delta / max(dist, 1e-4);
  float base = uFogRho * exp(-max(uCamPos.y, -200.0) / uFogH);
  float integral;
  if (abs(dirN.y) < 1e-4) integral = base * dist;
  else integral = base * uFogH / dirN.y * (1.0 - exp(-dist * dirN.y / uFogH));
  integral = max(integral, 0.0) + dist * uFogUniform;
  return 1.0 - exp(-integral);
}

// Haze is lit from above, so even when looking down at the ground the scattered
// light comes from near the horizon — never from the dark nadir of the LUT.
vec3 hazeColor(vec3 dirN){
  vec3 hd = normalize(vec3(dirN.x, max(dirN.y, 0.0) * 0.55 + 0.055, dirN.z));
  vec3 sky = sampleSky(hd);
  vec3 tint = uFogTint * uSunIntensity * (0.020 + 0.115 * max(uSunDir.y, 0.0));
  return mix(sky, tint, uFogTintMix);
}

vec3 applyAerial(vec3 color, vec3 worldPos){
  vec3 delta = worldPos - uCamPos;
  float dist = length(delta);
  vec3 dirN = delta / max(dist, 1e-4);
  return nightAdapt(mix(color, hazeColor(dirN), clamp(fogAmount(worldPos), 0.0, 1.0)));
}
`;

const LUT_W = 256, LUT_H = 128;

export class Atmosphere {
  constructor(renderer) {
    this.renderer = renderer;
    this.target = new THREE.WebGLRenderTarget(LUT_W, LUT_H, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      generateMipmaps: false,
    });
    this.target.texture.wrapS = THREE.RepeatWrapping;
    this.target.texture.colorSpace = THREE.NoColorSpace;
    atmo.uSkyLUT.value = this.target.texture;

    this.lutScene = new THREE.Scene();
    this.lutCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.lutMat = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: atmo.uSunDir,
        uSunIntensity: atmo.uSunIntensity,
        uAlt: { value: 0.0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `
        precision highp float;
        varying vec2 vUv;
        uniform vec3 uSunDir; uniform float uSunIntensity; uniform float uAlt;
        ${GLSL_SCATTER}
        void main(){
          float az = (vUv.x - 0.5) * 6.2831853;
          float e = (vUv.y - 0.5) * 2.0;
          float el = sign(e) * e * e * 1.5707963;
          vec3 d = vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az));
          vec3 c = scatter(normalize(d), normalize(uSunDir), uAlt, uSunIntensity);
          gl_FragColor = vec4(c, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.lutScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.lutMat));

    this._lastSunY = -999;
    this._lastAlt = -99999;
    this.dirty = true;
  }

  update(sunDir, altitude) {
    const dy = Math.abs(sunDir.y - this._lastSunY);
    const da = Math.abs(altitude - this._lastAlt);
    if (!this.dirty && dy < 0.0025 && da < 400) return;
    this._lastSunY = sunDir.y;
    this._lastAlt = altitude;
    this.dirty = false;

    this.lutMat.uniforms.uAlt.value = Math.max(0, Math.min(altitude, 40000));
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(this.lutScene, this.lutCam);
    this.renderer.setRenderTarget(prev);
  }
}

// --- CPU-side scattering, used for the sun/ambient light colours -------------

function opticalDepth(originY, dir, len, H) {
  const N = 8;
  let sum = 0;
  const step = len / N;
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) * step;
    const x = dir.x * t, y = originY + dir.y * t, z = dir.z * t;
    const h = Math.max(Math.hypot(x, y, z) - Rg, 0);
    sum += Math.exp(-h / H) * step;
  }
  return sum;
}

/** Sunlight colour reaching `altitude` metres, already scaled by intensity. */
export function sunlightColor(sunDir, altitude, out = new THREE.Color()) {
  const oy = Rg + Math.max(altitude, 1);
  // length through atmosphere along the sun ray
  const b = oy * sunDir.y;
  const c = oy * oy - Rt * Rt;
  const len = Math.min(-b + Math.sqrt(Math.max(b * b - c, 0)), 900000);
  const dr = opticalDepth(oy, sunDir, len, Hr);
  const dm = opticalDepth(oy, sunDir, len, Hm);
  const r = Math.exp(-(betaR[0] * dr + betaM * 1.1 * dm));
  const g = Math.exp(-(betaR[1] * dr + betaM * 1.1 * dm));
  const bl = Math.exp(-(betaR[2] * dr + betaM * 1.1 * dm));
  out.setRGB(r, g, bl);
  return out;
}

export { MIE_G, Rg, Rt };
export const GLSL_NOISE_REF = GLSL_NOISE;
