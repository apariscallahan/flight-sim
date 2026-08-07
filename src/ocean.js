import * as THREE from 'three';
import { GLSL_NOISE } from './noise.js';
import { GLSL_TERRAIN, MAX_AIRPORTS } from './terrainCommon.js';
import { GLSL_ATMO, atmo } from './atmosphere.js';

export const SEA_LEVEL = 0.0;

export class Ocean {
  constructor() {
    const geo = new THREE.CircleGeometry(190000, 128, 0, Math.PI * 2);
    geo.rotateX(-Math.PI / 2);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);

    this.material = new THREE.ShaderMaterial({
      uniforms: Object.assign({}, atmo, {
        uApData: { value: Array.from({ length: MAX_AIRPORTS }, () => new THREE.Vector4()) },
        uApCount: { value: 0 },
        uWindStrength: { value: 0.45 },
      }),
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
        uniform float uWindStrength;
        varying vec3 vWorld;

        float waveH(vec2 p, float t, float amp, float freq, vec2 dir){
          return snoise(p * freq + dir * t) * amp;
        }

        void main(){
          #include <logdepthbuf_fragment>
          vec3 V = uCamPos - vWorld;
          float dist = length(V);
          V /= max(dist, 1e-4);

          float bed = terrainHeight(vWorld.xz, 0.02);
          float depth = max(-bed, 0.0);

          float fade = 1.0 - smoothstep(400.0, 6000.0, dist);
          float fadeMid = 1.0 - smoothstep(3000.0, 40000.0, dist);
          float t = uTime;

          // layered wave normals, damped in shallow water and with distance
          vec3 N = vec3(0.0, 1.0, 0.0);
          float shallow = smoothstep(0.0, 25.0, depth);
          float amp = uWindStrength * mix(0.35, 1.0, shallow);
          vec2 e = vec2(0.9, 0.0);

          float s = 0.0, sx = 0.0, sz = 0.0;
          float f = 0.045, a = 1.0;
          vec2 d1 = vec2(0.55, 0.31);
          for (int i = 0; i < 4; i++){
            float w = a * (i < 2 ? fadeMid : fade);
            s  += w * snoise(vWorld.xz * f + d1 * t * (1.0 + float(i)));
            sx += w * snoise((vWorld.xz + e.xy) * f + d1 * t * (1.0 + float(i)));
            sz += w * snoise((vWorld.xz + e.yx) * f + d1 * t * (1.0 + float(i)));
            f *= 2.4; a *= 0.55; d1 = vec2(-d1.y, d1.x) * 1.1;
          }
          N = normalize(vec3((s - sx) * amp * 1.6, 0.9, (s - sz) * amp * 1.6));

          vec3 L = normalize(uSunDir);
          vec3 R = reflect(-V, N);
          R.y = abs(R.y) * 0.55 + 0.05;
          vec3 skyRefl = sampleSky(normalize(R));

          // water body colour: deep blue -> tropical shallows
          vec3 deepCol = vec3(0.012, 0.055, 0.105);
          vec3 shallowCol = vec3(0.09, 0.33, 0.36);
          vec3 body = mix(shallowCol, deepCol, smoothstep(1.0, 55.0, depth));
          body *= (uSunColor * uSunIntensity * 0.10 + uSkyAmbient * 0.9);

          float f0 = 0.02;
          float fres = f0 + (1.0 - f0) * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);

          vec3 color = mix(body, skyRefl, clamp(fres, 0.0, 1.0));

          // sun glint (roughness grows with distance to stop sparkle aliasing)
          vec3 H = normalize(V + L);
          float rough = mix(0.06, 0.30, smoothstep(200.0, 20000.0, dist)) + uWindStrength * 0.04;
          float sh = max(dot(N, H), 0.0);
          float spec = pow(sh, 2.0 / max(rough * rough, 1e-3));
          color += uSunColor * uSunIntensity * spec * 0.35
                 * smoothstep(-0.02, 0.06, uSunDir.y) * cloudShadow(vWorld);

          // shoreline foam
          float foamBand = 1.0 - smoothstep(0.0, 3.2, depth);
          float foamN = fbmW(vWorld.xz + vec2(t * 1.5, t * 0.9), 0.35, 3, 1e9) * 0.5 + 0.5;
          float foam = clamp(foamBand * smoothstep(0.35, 0.75, foamN) * 1.3, 0.0, 1.0) * fade;
          float crest = smoothstep(0.55, 0.95, s * amp) * fade * uWindStrength;
          foam = clamp(foam + crest * 0.35, 0.0, 1.0);
          vec3 foamCol = (uSunColor * uSunIntensity * 0.22 + uSkyAmbient);
          color = mix(color, foamCol, foam * 0.85);

          color = applyAerial(color, vWorld);

          // fade the water out where land pokes above it, so beaches look clean
          float alpha = clamp(smoothstep(-0.02, 0.55, depth), 0.0, 1.0);
          gl_FragColor = vec4(color, alpha);
        }`,
      transparent: true,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  setAirports(list) {
    const u = this.material.uniforms;
    u.uApCount.value = Math.min(list.length, MAX_AIRPORTS);
    for (let i = 0; i < u.uApCount.value; i++) {
      u.uApData.value[i].set(list[i].x, list[i].z, list[i].elev, list[i].hdg);
    }
  }

  update(camX, camZ) {
    this.mesh.position.set(camX, SEA_LEVEL, camZ);
  }
}
