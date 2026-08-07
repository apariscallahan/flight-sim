import * as THREE from 'three';
import { GLSL_NOISE } from './noise.js';
import { GLSL_ATMO, atmo } from './atmosphere.js';

const RAIN_BOX = 62, RAIN_N = 14000;
const SNOW_BOX = 80, SNOW_N = 7000;

function seedAttr(n, box) {
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = Math.random() * box;
    a[i * 3 + 1] = Math.random() * box;
    a[i * 3 + 2] = Math.random() * box;
  }
  return new THREE.InstancedBufferAttribute(a, 3);
}

function precipGeometry(n, box, quadW, quadH) {
  const base = new THREE.PlaneGeometry(quadW, quadH);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.attributes.position = base.attributes.position;
  geo.attributes.uv = base.attributes.uv;
  geo.setAttribute('aSeed', seedAttr(n, box));
  const r = new Float32Array(n);
  for (let i = 0; i < n; i++) r[i] = Math.random();
  geo.setAttribute('aRand', new THREE.InstancedBufferAttribute(r, 1));
  geo.instanceCount = 0;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  return geo;
}

const COMMON_VERT_HEAD = /* glsl */`
precision highp float;
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 aSeed;
attribute float aRand;
uniform vec3 uCamPos;
uniform vec3 uMotion;      // world velocity the particles are pushed by
uniform float uTime;
uniform float uBox;
uniform vec3 uCenterBias;
`;

export class Weather {
  constructor(scene) {
    this.mode = 'clear';
    this.intensity = 0;

    // --- rain ---------------------------------------------------------
    this.rainGeo = precipGeometry(RAIN_N, RAIN_BOX, 0.012, 1.0);
    this.rainMat = new THREE.ShaderMaterial({
      uniforms: Object.assign({}, atmo, {
        uBox: { value: RAIN_BOX },
        uMotion: { value: new THREE.Vector3() },
        uCenterBias: { value: new THREE.Vector3() },
        uFall: { value: new THREE.Vector3(0, -9, 0) },
        uLen: { value: 1.0 },
        uOpacity: { value: 0.5 },
      }),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: COMMON_VERT_HEAD + /* glsl */`
        uniform vec3 uFall;
        uniform float uLen;
        varying float vA; varying vec2 vUv; varying vec3 vWorld;
        void main(){
          vec3 vel = uFall + uMotion;
          vec3 p = aSeed + vel * uTime;
          vec3 c = uCamPos + uCenterBias;
          p = mod(p - c + uBox * 0.5, uBox) - uBox * 0.5 + c;

          vec3 dir = normalize(vel);
          vec3 toCam = uCamPos - p;
          float dist = length(toCam);
          vec3 side = normalize(cross(dir, toCam / max(dist, 1e-3)));
          float len = uLen * (0.6 + aRand * 0.8) * (0.35 + 0.65 * min(length(vel) / 24.0, 2.0));
          vec3 wp = p + side * position.x * (1.0 + aRand) + dir * position.y * len;

          vA = (1.0 - smoothstep(uBox * 0.32, uBox * 0.5, dist));
          vUv = uv; vWorld = wp;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */`
        precision highp float;
        #include <common>
        #include <logdepthbuf_pars_fragment>
        ${GLSL_NOISE}
        ${GLSL_ATMO}
        uniform float uOpacity;
        varying float vA; varying vec2 vUv; varying vec3 vWorld;
        void main(){
          #include <logdepthbuf_fragment>
          float edge = 1.0 - abs(vUv.x - 0.5) * 2.0;
          float taper = sin(vUv.y * 3.14159);
          float a = vA * edge * taper * uOpacity;
          if (a < 0.01) discard;
          vec3 col = (uSkyAmbient * 2.2 + uSunColor * uSunIntensity * 0.05);
          gl_FragColor = vec4(col, a);
        }`,
    });
    this.rain = new THREE.Mesh(this.rainGeo, this.rainMat);
    this.rain.frustumCulled = false;
    this.rain.renderOrder = 60;
    scene.add(this.rain);

    // --- snow ---------------------------------------------------------
    this.snowGeo = precipGeometry(SNOW_N, SNOW_BOX, 0.075, 0.075);
    this.snowMat = new THREE.ShaderMaterial({
      uniforms: Object.assign({}, atmo, {
        uBox: { value: SNOW_BOX },
        uMotion: { value: new THREE.Vector3() },
        uCenterBias: { value: new THREE.Vector3() },
        uOpacity: { value: 0.85 },
      }),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: COMMON_VERT_HEAD + /* glsl */`
        varying float vA; varying vec2 vUv; varying vec3 vWorld;
        void main(){
          float fall = 0.9 + aRand * 0.9;
          vec3 p = aSeed + (uMotion + vec3(0.0, -fall, 0.0)) * uTime;
          // gentle drift
          float t = uTime * (0.4 + aRand * 0.5) + aRand * 31.4;
          p.x += sin(t) * 1.2 + sin(t * 2.3) * 0.4;
          p.z += cos(t * 0.87) * 1.2;
          vec3 c = uCamPos + uCenterBias;
          p = mod(p - c + uBox * 0.5, uBox) - uBox * 0.5 + c;

          vec3 toCam = uCamPos - p;
          float dist = length(toCam);
          vec3 fwd = toCam / max(dist, 1e-3);
          vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
          vec3 up = cross(fwd, side);
          float sc = 0.55 + aRand * 1.1;
          vec3 wp = p + side * position.x * sc + up * position.y * sc;

          vA = 1.0 - smoothstep(uBox * 0.30, uBox * 0.5, dist);
          vUv = uv; vWorld = wp;
          gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */`
        precision highp float;
        #include <common>
        #include <logdepthbuf_pars_fragment>
        ${GLSL_NOISE}
        ${GLSL_ATMO}
        uniform float uOpacity;
        varying float vA; varying vec2 vUv; varying vec3 vWorld;
        void main(){
          #include <logdepthbuf_fragment>
          vec2 d = vUv - 0.5;
          float r = dot(d, d) * 4.0;
          float a = vA * uOpacity * smoothstep(1.0, 0.15, r);
          if (a < 0.02) discard;
          vec3 col = uSkyAmbient * 2.0 + uSunColor * uSunIntensity * 0.10;
          gl_FragColor = vec4(col, a);
        }`,
    });
    this.snow = new THREE.Mesh(this.snowGeo, this.snowMat);
    this.snow.frustumCulled = false;
    this.snow.renderOrder = 60;
    scene.add(this.snow);

    this.lightning = 0;
    this._nextBolt = 4 + Math.random() * 8;
  }

  /** mode: clear | fair | overcast | rain | storm | snow */
  setMode(mode) { this.mode = mode; }

  get preset() {
    switch (this.mode) {
      case 'clear': return { coverage: 0.16, cirrus: 0.30, darken: 0.0, rain: 0, snow: 0, wet: 0, fogU: 0.0, wind: 0.25, snowCover: 0 };
      case 'fair': return { coverage: 0.34, cirrus: 0.42, darken: 0.05, rain: 0, snow: 0, wet: 0, fogU: 0.0, wind: 0.4, snowCover: 0 };
      case 'overcast': return { coverage: 0.86, cirrus: 0.15, darken: 0.45, rain: 0, snow: 0, wet: 0.15, fogU: 0.000012, wind: 0.5, snowCover: 0 };
      case 'rain': return { coverage: 0.92, cirrus: 0.1, darken: 0.55, rain: 0.7, snow: 0, wet: 0.85, fogU: 0.000045, wind: 0.7, snowCover: 0 };
      case 'storm': return { coverage: 1.0, cirrus: 0.0, darken: 0.78, rain: 1.0, snow: 0, wet: 1.0, fogU: 0.00009, wind: 1.0, snowCover: 0 };
      case 'snow': return { coverage: 0.9, cirrus: 0.1, darken: 0.35, rain: 0, snow: 1.0, wet: 0.2, fogU: 0.00007, wind: 0.55, snowCover: 1.0 };
      default: return { coverage: 0.2, cirrus: 0.3, darken: 0, rain: 0, snow: 0, wet: 0, fogU: 0, wind: 0.3, snowCover: 0 };
    }
  }

  update(dt, camPos, camVel, viewDir, insideCloud) {
    const p = this.preset;
    const t = atmo.uTime.value;

    // particles ride with the aircraft, biased ahead of the camera
    const motion = this._motion || (this._motion = new THREE.Vector3());
    motion.copy(camVel).multiplyScalar(-1);

    const rainOn = p.rain > 0.01;
    this.rainGeo.instanceCount = rainOn ? Math.floor(RAIN_N * p.rain) : 0;
    if (rainOn) {
      const u = this.rainMat.uniforms;
      u.uMotion.value.copy(motion);
      u.uFall.value.set(0, -9 - 4 * p.rain, 0);
      u.uOpacity.value = 0.16 + 0.22 * p.rain;
      u.uCenterBias.value.copy(viewDir).multiplyScalar(RAIN_BOX * 0.18);
    }

    const snowOn = p.snow > 0.01;
    this.snowGeo.instanceCount = snowOn ? Math.floor(SNOW_N * p.snow) : 0;
    if (snowOn) {
      const u = this.snowMat.uniforms;
      u.uMotion.value.copy(motion).multiplyScalar(0.92);
      u.uOpacity.value = 0.55 + 0.4 * p.snow;
      u.uCenterBias.value.copy(viewDir).multiplyScalar(SNOW_BOX * 0.15);
    }

    // lightning
    this.lightning = Math.max(0, this.lightning - dt * 6);
    if (this.mode === 'storm') {
      this._nextBolt -= dt;
      if (this._nextBolt <= 0) {
        this._nextBolt = 3 + Math.random() * 9;
        this.lightning = 1;
      }
    }

    atmo.uWetness.value += (p.wet - atmo.uWetness.value) * Math.min(dt * 0.6, 1);
    atmo.uSnowCover.value += (p.snowCover - atmo.uSnowCover.value) * Math.min(dt * 0.25, 1);
    const insideAdd = insideCloud * 0.0016;
    atmo.uFogUniform.value = p.fogU + insideAdd;
    atmo.uFogTintMix.value = Math.min(1, p.darken * 0.7 + insideCloud);
    return p;
  }
}
