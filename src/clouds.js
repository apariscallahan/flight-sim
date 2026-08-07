import * as THREE from 'three';
import { GLSL_NOISE } from './noise.js';
import { GLSL_TERRAIN, MAX_AIRPORTS } from './terrainCommon.js';
import { GLSL_ATMO, atmo } from './atmosphere.js';

// A stack of slabs through the cloud layer. The weight controls how much of the
// noise field survives at that height, so the deck bulges in the middle and
// tapers at the top — cumulus rather than a flat sheet.
// Three slabs rather than five. Each one is a full-screen transparent layer, so
// they overdraw; this is the most expensive geometry in the scene per pixel.
const SLABS = [
  { y: 1500, w: 0.92, o: 0.0 },
  { y: 1810, w: 1.00, o: 17.3 },
  { y: 2140, w: 0.66, o: 37.1 },
];

function cumulusMaterial(slab) {
  return new THREE.ShaderMaterial({
    uniforms: Object.assign({}, atmo, {
      uCoverage: { value: 0.45 },
      uSlabW: { value: slab.w },
      uSlabO: { value: slab.o },
      uSlabY: { value: slab.y },
      uWind: { value: new THREE.Vector2(6, 2) },
      uDarken: { value: 0.0 },
      uApData: { value: Array.from({ length: MAX_AIRPORTS }, () => new THREE.Vector4()) },
      uApCount: { value: 0 },
    }),
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      precision highp float;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vWorld;
      void main(){
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      precision highp float;
      #include <common>
      #include <logdepthbuf_pars_fragment>
      ${GLSL_NOISE}
      ${GLSL_TERRAIN}
      ${GLSL_ATMO}
      uniform float uCoverage, uSlabW, uSlabO, uSlabY, uDarken;
      uniform vec2 uWind;
      varying vec3 vWorld;

      ${CLOUD_FIELD_GLSL}
      float cloudField(vec2 p){
        return cloudFieldRaw(p + uSlabO * 137.0, uWind, uTime);
      }

      void main(){
        #include <logdepthbuf_fragment>
        float dist = length(vWorld - uCamPos);
        if (dist > 120000.0) discard;

        float f = cloudField(vWorld.xz);
        float thresh = 1.0 - uCoverage * (0.34 + 0.66 * uSlabW);
        float d = smoothstep(thresh, thresh + 0.085, f);
        if (d < 0.012) discard;

        // Self shadow: how much cloud sits between this point and the sun. The
        // shadow map already holds exactly that field, so read it instead of
        // evaluating the noise a second and third time.
        vec2 sunOff = normalize(uSunDir.xz + vec2(0.001)) * 1400.0;
        vec2 sUv = (vWorld.xz + sunOff - uCloudShadowRect.xy) / (2.0 * uCloudShadowRect.z) + 0.5;
        float ds = 0.0;
        if (sUv.x > 0.0 && sUv.x < 1.0 && sUv.y > 0.0 && sUv.y < 1.0) {
          ds = (1.0 - texture2D(uCloudShadow, sUv).r) / 0.72;
        }
        float lit = clamp(1.0 - ds * 0.85, 0.0, 1.0);
        lit = mix(lit, 1.0, clamp(uSunDir.y * 0.8, 0.0, 1.0) * 0.35);

        // vertical shading: brighter tops, dim bases
        float above = clamp((uCamPos.y - uSlabY) / 900.0, -1.0, 1.0);
        float faceUp = 0.5 + 0.5 * above;
        float shade = mix(0.16, 1.0, lit) * mix(0.50, 1.10, faceUp);

        vec3 sunC = uSunColor * uSunIntensity;
        vec3 col = sunC * shade * 0.185 + uSkyAmbient * 0.95;

        // silver lining toward the sun
        vec3 V = normalize(vWorld - uCamPos);
        float fwd = max(dot(V, normalize(uSunDir)), 0.0);
        col += sunC * pow(fwd, 22.0) * (1.0 - lit * 0.6) * 0.35;
        col *= mix(1.0, 0.42, uDarken);

        float alpha = clamp(d * 1.55, 0.0, 1.0);
        // soften as the camera passes through the deck
        alpha *= 1.0 - exp(-abs(uCamPos.y - uSlabY) / 200.0);
        alpha *= 1.0 - smoothstep(60000.0, 105000.0, dist);
        // a flat slab seen edge-on becomes a hard streak — fade those out
        alpha *= smoothstep(0.015, 0.16, abs(V.y));
        // and dissolve the slab where it would slice through a mountain, using
        // the ground height packed into the shadow map's green channel
        vec2 gUv = (vWorld.xz - uCloudShadowRect.xy) / (2.0 * uCloudShadowRect.z) + 0.5;
        if (gUv.x > 0.0 && gUv.x < 1.0 && gUv.y > 0.0 && gUv.y < 1.0) {
          float ground = texture2D(uCloudShadow, gUv).g * 4000.0;
          alpha *= smoothstep(-120.0, 460.0, uSlabY - ground);
        }
        col = mix(col, sampleSky(V), clamp(fogAmount(vWorld) * 0.9, 0.0, 1.0));
        gl_FragColor = vec4(col, alpha);
      }`,
  });
}

function cirrusMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: Object.assign({}, atmo, {
      uAmount: { value: 0.5 },
    }),
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      precision highp float;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vWorld;
      void main(){
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      precision highp float;
      #include <common>
      #include <logdepthbuf_pars_fragment>
      ${GLSL_NOISE}
      ${GLSL_ATMO}
      uniform float uAmount;
      varying vec3 vWorld;
      void main(){
        #include <logdepthbuf_fragment>
        vec2 p = vWorld.xz + vec2(uTime * 22.0, uTime * 7.0);
        float warp = fbmW(p, 0.000030, 2, 1e9);
        vec2 q = p + vec2(warp * 15000.0, warp * 4000.0);
        // stretched along one axis so the sheets read as wind-blown cirrus
        float n = fbmW(vec2(q.x * 0.30, q.y), 0.00013, 4, 1e9);
        float d = smoothstep(0.16, 0.72, n * 0.5 + 0.5) * uAmount;
        if (d < 0.01) discard;
        vec3 V = normalize(vWorld - uCamPos);
        float dist = length(vWorld - uCamPos);
        vec3 col = uSunColor * uSunIntensity * 0.20 + uSkyAmbient * 0.9;
        col += uSunColor * uSunIntensity * pow(max(dot(V, normalize(uSunDir)), 0.0), 8.0) * 0.16;
        float a = clamp(d * 0.42, 0.0, 1.0) * smoothstep(0.02, 0.20, abs(V.y));
        gl_FragColor = vec4(col, a);
      }`,
  });
}

const CLOUD_FIELD_GLSL = /* glsl */`
float cloudFieldRaw(vec2 p, vec2 wind, float t){
  p += wind * t;
  float warp = fbmW(p + 913.0, 0.00011, 2, 1e9);
  p += vec2(warp * 2600.0, warp * 1700.0);
  float n = fbmW(p, 0.00026, 3, 1e9);
  n += fbmW(p, 0.00160, 2, 1e9) * 0.26;
  return n * 0.5 + 0.5;
}
`;

/**
 * Renders the cumulus deck's coverage into a small top-down texture each frame
 * so every surface in the world can be dappled by moving cloud shadows for the
 * price of one texture fetch.
 */
export class CloudShadowMap {
  constructor(renderer, size = 512, halfExtent = 30000) {
    this.renderer = renderer;
    this.halfExtent = halfExtent;
    this.target = new THREE.WebGLRenderTarget(size, size, {
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      generateMipmaps: false,
    });
    this.target.texture.colorSpace = THREE.NoColorSpace;
    atmo.uCloudShadow.value = this.target.texture;

    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uCentre: { value: new THREE.Vector2() },
        uHalf: { value: halfExtent },
        uCoverage: { value: 0.4 },
        uWind: { value: new THREE.Vector2(6, 2) },
        uTime: atmo.uTime,
        uStrength: { value: 0.72 },
        uApData: { value: Array.from({ length: MAX_AIRPORTS }, () => new THREE.Vector4()) },
        uApCount: { value: 0 },
      },
      depthTest: false, depthWrite: false,
      vertexShader: `
        varying vec2 vUv;
        void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `
        precision highp float;
        varying vec2 vUv;
        uniform vec2 uCentre; uniform float uHalf, uCoverage, uTime, uStrength;
        uniform vec2 uWind;
        ${GLSL_NOISE}
        ${GLSL_TERRAIN}
        ${CLOUD_FIELD_GLSL}
        void main(){
          vec2 p = uCentre + (vUv - 0.5) * 2.0 * uHalf;
          float n = cloudFieldRaw(p, uWind, uTime);
          float thresh = 1.0 - uCoverage;
          float d = smoothstep(thresh, thresh + 0.085, n);
          // G carries a coarse ground height so the cloud slabs can dissolve
          // where they would otherwise slice through a mountain, without each
          // of them having to evaluate the terrain per pixel.
          float g = clamp(terrainBase(p, 0.0028) / 4000.0, 0.0, 1.0);
          gl_FragColor = vec4(1.0 - d * uStrength, g, 0.0, 1.0);
        }`,
    });
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat));
  }

  update(camX, camZ, coverage, baseAlt) {
    const texel = (this.halfExtent * 2) / this.target.width;
    const cx = Math.round(camX / texel) * texel;
    const cz = Math.round(camZ / texel) * texel;
    this.mat.uniforms.uCentre.value.set(cx, cz);
    this.mat.uniforms.uCoverage.value = coverage;
    atmo.uCloudShadowRect.value.set(cx, cz, this.halfExtent, baseAlt);
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(this.scene, this.cam);
    this.renderer.setRenderTarget(prev);
  }
}

export class Clouds {
  constructor(scene) {
    this.group = new THREE.Group();
    this.slabs = [];
    for (const s of SLABS) {
      const geo = new THREE.CircleGeometry(110000, 72);
      geo.rotateX(-Math.PI / 2);
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
      const mesh = new THREE.Mesh(geo, cumulusMaterial(s));
      mesh.frustumCulled = false;
      mesh.renderOrder = 20;
      mesh.position.y = s.y;
      this.group.add(mesh);
      this.slabs.push({ mesh, y: s.y });
    }
    const cg = new THREE.CircleGeometry(160000, 64);
    cg.rotateX(-Math.PI / 2);
    cg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.cirrus = new THREE.Mesh(cg, cirrusMaterial());
    this.cirrus.frustumCulled = false;
    this.cirrus.position.y = 9200;
    this.cirrus.renderOrder = 18;
    this.group.add(this.cirrus);
    scene.add(this.group);
  }

  setWeather({ coverage, darken, cirrus, baseAlt }) {
    for (let i = 0; i < this.slabs.length; i++) {
      const u = this.slabs[i].mesh.material.uniforms;
      u.uCoverage.value = coverage;
      u.uDarken.value = darken;
      const y = baseAlt + (SLABS[i].y - SLABS[0].y);
      this.slabs[i].mesh.position.y = y;
      this.slabs[i].y = y;
      u.uSlabY.value = y;
    }
    this.cirrus.material.uniforms.uAmount.value = cirrus;
  }

  /** Drop the outer slabs on weak hardware — they are pure overdraw. */
  setSlabCount(n) {
    this.slabs.forEach((s, i) => { s.mesh.visible = i < n; });
  }

  update(cam) {
    for (const s of this.slabs) {
      if (!s.mesh.visible) continue;
      s.mesh.position.x = cam.x; s.mesh.position.z = cam.z;
      // draw the deck we are under before/after depending on which side we sit
      s.mesh.renderOrder = cam.y > s.y ? 20 - s.y * 0.001 : 20 + s.y * 0.001;
    }
    this.cirrus.position.x = cam.x; this.cirrus.position.z = cam.z;
  }

  /** 0..1 how deep inside the cloud deck the camera is. */
  insideFactor(y) {
    let m = 0;
    for (const s of this.slabs) {
      const w = s.mesh.material.uniforms.uSlabW.value;
      m = Math.max(m, (1 - Math.min(Math.abs(y - s.y) / 130, 1)) * w);
    }
    return m;
  }
}
