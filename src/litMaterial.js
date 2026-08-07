import * as THREE from 'three';
import { GLSL_NOISE } from './noise.js';
import { GLSL_ATMO, atmo } from './atmosphere.js';

/**
 * A single lighting model shared by every solid object in the world so that
 * runways, buildings, trees and the aircraft all sit in the same atmosphere.
 */
export function makeLitMaterial(opts = {}) {
  const {
    color = 0xffffff,
    map = null,
    roughness = 0.85,
    specular = 0.25,
    emissive = 0x000000,
    emissiveIntensity = 0.0,
    vertexColors = false,
    foliage = false,
    transparent = false,
    alphaTest = 0.0,
    side = THREE.FrontSide,
    opacity = 1.0,
    depthWrite = true,
    translucency = 0.0,
    directScale = 1.0,
  } = opts;

  const defines = {};
  if (map) defines.USE_TEXMAP = '';
  if (vertexColors) defines.USE_VCOLOR = '';
  if (foliage) defines.FOLIAGE = '';
  if (alphaTest > 0) defines.USE_ALPHATEST = '';

  const mat = new THREE.ShaderMaterial({
    defines,
    transparent,
    side,
    depthWrite,
    vertexColors,
    uniforms: Object.assign({}, atmo, {
      uColor: { value: new THREE.Color(color) },
      uMap: { value: map },
      uRough: { value: roughness },
      uSpec: { value: specular },
      uEmissive: { value: new THREE.Color(emissive) },
      uEmissiveI: { value: emissiveIntensity },
      uOpacity: { value: opacity },
      uAlphaTest: { value: alphaTest },
      uWindAmp: { value: 1.0 },
      uWindDir: { value: new THREE.Vector2(1, 0.3) },
      uTranslucency: { value: translucency },
      uDirectK: { value: directScale },
    }),
    vertexShader: /* glsl */`
      precision highp float;
      #include <common>
      #include <logdepthbuf_pars_vertex>
      ${GLSL_NOISE}
      uniform float uWindAmp;
      uniform vec2  uWindDir;
      uniform float uTime;
      varying vec3 vWorld;
      varying vec3 vNrm;
      varying vec2 vUv;
      #ifdef USE_VCOLOR
        varying vec3 vCol;
      #endif
      void main(){
        vec3 pos = position;
        vec3 nrm = normal;
        #ifdef USE_INSTANCING
          mat4 im = instanceMatrix;
        #else
          mat4 im = mat4(1.0);
        #endif
        vec4 wp = modelMatrix * im * vec4(pos, 1.0);
        #ifdef FOLIAGE
          float sway = uWindAmp * (0.35 + 0.65 * smoothstep(0.0, 6.0, pos.y));
          float ph = wp.x * 0.06 + wp.z * 0.05;
          float w = sin(uTime * 1.7 + ph) * 0.6 + sin(uTime * 3.1 + ph * 2.3) * 0.25;
          wp.xz += normalize(uWindDir) * w * sway;
        #endif
        vWorld = wp.xyz;
        vNrm = normalize(mat3(modelMatrix) * (mat3(im) * nrm));
        vUv = uv;
        #ifdef USE_VCOLOR
          vCol = color;
          #ifdef USE_INSTANCING_COLOR
            vCol *= instanceColor;
          #endif
        #else
          #ifdef USE_INSTANCING_COLOR
          #endif
        #endif
        gl_Position = projectionMatrix * viewMatrix * wp;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */`
      precision highp float;
      #include <common>
      #include <logdepthbuf_pars_fragment>
      ${GLSL_NOISE}
      ${GLSL_ATMO}
      uniform vec3 uColor;
      uniform sampler2D uMap;
      uniform float uRough, uSpec, uOpacity, uAlphaTest, uEmissiveI, uTranslucency, uDirectK;
      uniform vec3 uEmissive;
      varying vec3 vWorld;
      varying vec3 vNrm;
      varying vec2 vUv;
      #ifdef USE_VCOLOR
        varying vec3 vCol;
      #endif
      void main(){
        #include <logdepthbuf_fragment>
        vec4 base = vec4(uColor, uOpacity);
        #ifdef USE_TEXMAP
          vec4 t = texture2D(uMap, vUv);
          base *= t;
        #endif
        #ifdef USE_VCOLOR
          base.rgb *= vCol;
        #endif
        #ifdef USE_ALPHATEST
          if (base.a < uAlphaTest) discard;
        #endif

        vec3 N = normalize(vNrm);
        if (!gl_FrontFacing) N = -N;
        #ifdef FOLIAGE
          // snow settles on upward-facing foliage
          base.rgb = mix(base.rgb, vec3(0.72, 0.76, 0.82),
                         uSnowCover * 0.72 * smoothstep(0.1, 0.8, N.y));
        #endif
        vec3 L = normalize(uSunDir);
        vec3 V = normalize(uCamPos - vWorld);

        float ndl = max(dot(N, L), 0.0);
        vec3 direct = keyLight(N, vWorld) * uDirectK;
        vec3 ambient = mix(uGroundAmbient, uSkyAmbient, clamp(N.y * 0.5 + 0.5, 0.0, 1.0));

        vec3 color = base.rgb * (direct + ambient);

        if (uTranslucency > 0.0){
          float back = max(dot(-N, L), 0.0) * 0.5 + max(dot(N, L), 0.0) * 0.5;
          color += base.rgb * uSunColor * uSunIntensity * back * uTranslucency * 0.12;
        }

        vec3 H = normalize(V + L);
        float sp = pow(max(dot(N, H), 0.0), mix(4.0, 180.0, 1.0 - uRough));
        color += uSunColor * uSunIntensity * sp * uSpec * 0.05 * step(0.001, ndl);

        color += uEmissive * uEmissiveI;
        color = applyAerial(color, vWorld);
        gl_FragColor = vec4(color, base.a);
      }`,
  });
  return mat;
}
