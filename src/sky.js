import * as THREE from 'three';
import { GLSL_NOISE } from './noise.js';
import { GLSL_ATMO, atmo } from './atmosphere.js';

const DEG = Math.PI / 180;

/**
 * Solar position for a fixed observer latitude. `hours` is local solar time.
 * World convention: +X = east, -Z = north, +Y = up.
 */
export function sunDirection(hours, latDeg = 42, declDeg = 12, out = new THREE.Vector3()) {
  const lat = latDeg * DEG, dec = declDeg * DEG;
  const H = (hours - 12) * 15 * DEG;
  const sinAlt = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(H);
  const alt = Math.asin(THREE.MathUtils.clamp(sinAlt, -1, 1));
  let cosAz = (Math.sin(dec) - sinAlt * Math.sin(lat)) / Math.max(Math.cos(alt) * Math.cos(lat), 1e-6);
  cosAz = THREE.MathUtils.clamp(cosAz, -1, 1);
  let az = Math.acos(cosAz);
  if (Math.sin(H) > 0) az = 2 * Math.PI - az;   // afternoon -> west
  out.set(Math.cos(alt) * Math.sin(az), Math.sin(alt), -Math.cos(alt) * Math.cos(az));
  return out.normalize();
}

export function moonDirection(hours, out = new THREE.Vector3()) {
  return sunDirection((hours + 12.6) % 24, 42, -6, out);
}

export class Sky {
  constructor() {
    const geo = new THREE.SphereGeometry(1, 64, 40);
    this.material = new THREE.ShaderMaterial({
      uniforms: Object.assign({}, atmo, { uStarFade: { value: 0 } }),
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main(){
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        precision highp float;
        varying vec3 vDir;
        ${GLSL_NOISE}
        ${GLSL_ATMO}
        uniform float uStarFade;

        float starField(vec3 d){
          vec2 suv = vec2(atan(d.z, d.x) / 6.2831853 + 0.5,
                          asin(clamp(d.y, -1.0, 1.0)) / 3.14159265 + 0.5);
          vec2 g = suv * vec2(1400.0, 700.0);
          vec2 cell = floor(g), f = fract(g);
          float acc = 0.0;
          for (int j = -1; j <= 1; j++){
            for (int i = -1; i <= 1; i++){
              vec2 c = cell + vec2(float(i), float(j));
              float h = hash21(c);
              if (h < 0.955) continue;
              vec2 pos = hash22(c + 3.7);
              float dsq = dot(f - vec2(float(i), float(j)) - pos, f - vec2(float(i), float(j)) - pos);
              float mag = (h - 0.955) / 0.045;
              float tw = 0.75 + 0.25 * sin(uTime * (1.4 + 5.0 * mag) + h * 60.0);
              acc += exp(-dsq * 850.0) * pow(mag, 2.2) * tw;
            }
          }
          return acc;
        }

        float milkyWay(vec3 d){
          vec3 axis = normalize(vec3(0.35, 0.28, 0.89));
          float band = 1.0 - abs(dot(d, axis));
          float m = smoothstep(0.86, 1.0, band);
          float n = fbmW(d.xz * 40.0 + d.y * 27.0, 1.0, 5, 1e9) * 0.5 + 0.5;
          return m * m * (0.35 + 0.9 * n * n);
        }

        vec3 moon(vec3 d){
          float ca = dot(d, uMoonDir);
          if (ca < 0.9993) {
            return vec3(0.55, 0.6, 0.75) * pow(max(ca, 0.0), 900.0) * 0.35;
          }
          // local disc coordinates
          vec3 up = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.02)));
          vec3 rt = normalize(cross(up, uMoonDir));
          vec2 lp = vec2(dot(d, rt), dot(d, up)) / 0.0165;
          float r2 = dot(lp, lp);
          if (r2 > 1.0) return vec3(0.0);
          vec3 n = normalize(vec3(lp, sqrt(max(1.0 - r2, 0.0))));
          vec3 sunLocal = normalize(vec3(dot(uSunDir, rt), dot(uSunDir, up), dot(uSunDir, uMoonDir)));
          float lam = max(dot(n, sunLocal), 0.0);
          float craters = fbmW(lp * 3.0, 1.0, 5, 1e9) * 0.5 + 0.5;
          craters = mix(0.72, 1.0, craters);
          float limb = smoothstep(1.0, 0.985, r2);
          return vec3(1.0, 0.97, 0.9) * lam * craters * limb * 2.2;
        }

        void main(){
          vec3 d = normalize(vDir);
          vec3 col = sampleSky(d);

          // Sun disc + forward glow
          float ca = dot(d, normalize(uSunDir));
          float disc = smoothstep(0.999940, 0.999975, ca);
          float above = smoothstep(-0.035, 0.02, uSunDir.y);
          col += uSunColor * disc * uSunIntensity * 1.9 * above;
          col += uSunColor * pow(max(ca, 0.0), 2200.0) * uSunIntensity * 0.05 * above;

          float night = uStarFade;
          if (night > 0.001){
            col += vec3(0.85, 0.9, 1.0) * starField(d) * 0.9 * night;
            col += vec3(0.55, 0.6, 0.85) * milkyWay(d) * 0.012 * night;
            col += moon(d) * night;
          }

          // horizon grounding so the world doesn't end abruptly
          float below = smoothstep(0.0, -0.06, d.y);
          col = mix(col, mix(col, uGroundAmbient * 0.5, 0.65), below);

          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.scale.setScalar(200000);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
  }

  update(camera, sunDir) {
    this.mesh.position.copy(camera.position);
    this.material.uniforms.uStarFade.value = THREE.MathUtils.clamp(
      (0.04 - sunDir.y) / 0.12, 0, 1);
  }
}
