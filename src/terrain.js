import * as THREE from 'three';
import { GLSL_NOISE } from './noise.js';
import { GLSL_TERRAIN, MAX_AIRPORTS } from './terrainCommon.js';
import { GLSL_ATMO, atmo } from './atmosphere.js';

// A coarser grid with more rings covers the same ground for a quarter of the
// vertices: cost goes as G^2 per level but only log2 in the number of levels.
const G = 96;           // cells across one clipmap level
const S0 = 2.0;         // finest cell size, metres
const LEVELS = 10;      // -> 2 * 2^9 * 96 = 98 km across
const MORPH_START = 0.62;

export const TERRAIN_RADIUS = S0 * Math.pow(2, LEVELS - 1) * G * 0.5;

function buildGrid(withHole) {
  const verts = [];
  const half = G / 2;
  for (let j = 0; j <= G; j++) {
    for (let i = 0; i <= G; i++) verts.push(i - half, 0, j - half);
  }
  const idx = [];
  // The hole nominally spans the central half — exactly the area the next finer
  // ring covers. Each ring snaps its centre to its own grid though, so the two
  // can be offset by up to 2 cells of this ring. Shrinking the hole by 3 cells
  // per side guarantees the rings always overlap instead of leaving a gap.
  const q0 = G / 4 + 3, q1 = (3 * G) / 4 - 3;
  for (let j = 0; j < G; j++) {
    for (let i = 0; i < G; i++) {
      if (withHole && i >= q0 && i < q1 && j >= q0 && j < q1) continue;
      const a = j * (G + 1) + i;
      const b = a + 1;
      const c = a + (G + 1);
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  return geo;
}

const VERT = /* glsl */`
precision highp float;
#include <common>
#include <logdepthbuf_pars_vertex>
${GLSL_NOISE}
${GLSL_TERRAIN}
uniform float uSpacing;
uniform vec2  uCenter;
uniform float uMaxFreq;
uniform float uGridHalf;
uniform float uMorphStart;
uniform float uLevelBias;
uniform vec3  uCamPos;

varying vec3 vWorld;
varying vec2 vClimate;
varying float vApT;
varying float vDist;

// how strongly airports have flattened this point (for airfield grass shading)
float airportInfluence(vec2 p){
  float best = 0.0;
  for (int i = 0; i < MAX_AIRPORTS; i++){
    if (i >= uApCount) break;
    vec4 ap = uApData[i];
    vec2 d = p - ap.xy;
    vec2 fwd = vec2(sin(ap.w), -cos(ap.w));
    vec2 side = vec2(cos(ap.w), sin(ap.w));
    vec2 l = vec2(dot(d, fwd), dot(d, side));
    vec2 q = max(abs(l) - vec2(AP_HALF_L, AP_HALF_W), vec2(0.0));
    best = max(best, 1.0 - smoothstep(0.0, AP_FALLOFF * 0.75, length(q)));
  }
  return best;
}

void main(){
  vec2 grid = position.xz;
  vec2 world = uCenter + grid * uSpacing;

  float cheb = max(abs(grid.x), abs(grid.y)) / uGridHalf;
  float k = clamp((cheb - uMorphStart) / (1.0 - uMorphStart), 0.0, 1.0);
  vec2 parity = fract(grid * 0.5) * 2.0;
  world -= parity * uSpacing * k;

  // Detail cutoff is a function of world distance, not of which ring we are in.
  // Neighbouring rings therefore agree exactly where they meet, so the morphed
  // boundary vertices land on identical heights and no cracks open up.
  float camDist = distance(world, uCamPos.xz);
  float mf = min(1.0 / (0.05 * camDist + 6.0), uMaxFreq);

  // Exactly one height evaluation per vertex. The surface normal is recovered in
  // the fragment shader from screen-space derivatives, which is nearly free and
  // saves two more full terrain evaluations here — this was the single most
  // expensive thing in the renderer.
  float h = terrainHeight(world, mf);

  // Coarser rings sit fractionally lower so the finer ring always wins in the
  // overlap band. Sub-metre at ring scale, invisible at the distances involved.
  vWorld = vec3(world.x, h - uLevelBias, world.y);
  vClimate = climate(world);
  vApT = airportInfluence(world);
  vDist = distance(vWorld, uCamPos);

  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
  #include <logdepthbuf_vertex>
}
`;

const FRAG = /* glsl */`
precision highp float;
#include <common>
#include <logdepthbuf_pars_fragment>
${GLSL_NOISE}
${GLSL_ATMO}

varying vec3 vWorld;
varying vec2 vClimate;
varying float vApT;
varying float vDist;

const vec3 C_SAND     = vec3(0.76, 0.68, 0.48);
const vec3 C_DUNE     = vec3(0.82, 0.70, 0.44);
const vec3 C_SAVANNA  = vec3(0.50, 0.46, 0.24);
const vec3 C_TROPIC   = vec3(0.13, 0.30, 0.11);
const vec3 C_PLAIN    = vec3(0.36, 0.40, 0.21);
const vec3 C_FOREST   = vec3(0.19, 0.31, 0.15);
const vec3 C_TAIGA    = vec3(0.17, 0.26, 0.18);
const vec3 C_TUNDRA   = vec3(0.38, 0.38, 0.31);
const vec3 C_ROCK     = vec3(0.33, 0.31, 0.29);
const vec3 C_ROCK2    = vec3(0.45, 0.41, 0.36);
const vec3 C_SNOW     = vec3(0.90, 0.93, 0.99);
const vec3 C_SEABED   = vec3(0.30, 0.31, 0.26);

void main(){
  #include <logdepthbuf_fragment>
  // Geometric normal straight from the interpolated surface — no extra terrain
  // evaluations needed, and the bump detail below hides the faceting.
  vec3 Ng = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (Ng.y < 0.0) Ng = -Ng;
  vec3 N = Ng;                        // shading normal — gets fine bump detail
  float temp = vClimate.x, moist = vClimate.y;
  float h = vWorld.y;

  // Bump detail whose feature size follows viewing distance. One band covers
  // every range, so the terrain keeps texture from the cockpit window out to the
  // horizon and the flat-shaded facets never read as facets.
  float bs = clamp(vDist * 0.011, 1.1, 160.0);
  float bf = 0.42 / bs;
  float b0 = snoise(vWorld.xz * bf);
  float bx = snoise((vWorld.xz + vec2(bs, 0.0)) * bf);
  float bz = snoise((vWorld.xz + vec2(0.0, bs)) * bf);
  N += vec3(b0 - bx, 0.0, b0 - bz) * 0.19;

  // A second, finer band close in, where there are pixels to spare for it.
  float detFade = 1.0 - smoothstep(140.0, 700.0, vDist);
  if (detFade > 0.01){
    float e2 = 1.1, amp2 = 0.19 * detFade;
    float m0 = snoise(vWorld.xz * 0.38);
    float mx = snoise((vWorld.xz + vec2(e2, 0.0)) * 0.38);
    float mz = snoise((vWorld.xz + vec2(0.0, e2)) * 0.38);
    N += vec3(m0 - mx, 0.0, m0 - mz) * (amp2 / e2);
  }
  N = normalize(N);

  // --- biome albedo -------------------------------------------------------
  vec3 warm = mix(C_DUNE, C_SAVANNA, smoothstep(0.12, 0.42, moist));
  warm = mix(warm, C_TROPIC, smoothstep(0.44, 0.76, moist));
  vec3 temperate = mix(C_PLAIN, C_FOREST, smoothstep(0.26, 0.66, moist));
  vec3 cool = mix(C_TUNDRA, C_TAIGA, smoothstep(0.22, 0.58, moist));

  vec3 albedo = mix(cool, temperate, smoothstep(0.24, 0.48, temp));
  albedo = mix(albedo, warm, smoothstep(0.56, 0.80, temp));

  // Two noise fields drive every bit of ground variation below — macro
  // patchiness, field-scale mottling, canopy clumping, rock and snow. Sampling
  // each scale once and re-reading it is far cheaper than a call per effect.
  float macro = fbmW(vWorld.xz, 0.00065, 3, 1e9) * 0.5 + 0.5;
  float medCap = 1.0 / (0.020 * vDist + 0.8);
  float med = fbmW(vWorld.xz + 77.0, 0.011, 3, medCap) * 0.5 + 0.5;

  albedo *= 0.72 + 0.34 * macro + 0.30 * med;
  albedo = mix(albedo, albedo * vec3(1.12, 1.06, 0.86), macro * 0.35);
  albedo = mix(albedo, albedo * vec3(0.86, 1.08, 0.80), smoothstep(0.45, 0.9, med) * 0.5);

  // close-range grain
  if (detFade > 0.01){
    float grain = snoise(vWorld.xz * 1.7);
    albedo *= 1.0 + grain * 0.18 * detFade;
  }

  float slope = 1.0 - Ng.y;

  // forest canopy — mirrors the rules that place the 3D trees, so the
  // instanced woodland dissolves seamlessly into the painted canopy
  float treeline = 320.0 + temp * 3100.0;
  float canopy = smoothstep(0.12, 0.42, moist)
               * smoothstep(treeline, treeline - 700.0, h)
               * smoothstep(1.5, 9.0, h)
               * smoothstep(0.72, 0.88, Ng.y)
               * smoothstep(0.02, 0.10, temp)
               * (0.55 + 0.45 * smoothstep(0.30, 0.75, moist))
               * (1.0 - vApT);
  if (canopy > 0.008){
    float lump = fbmW(vWorld.xz, 0.085, 2, 1.0 / (0.020 * vDist + 1.2)) * 0.5 + 0.5;
    vec3 treeCol = mix(vec3(0.085, 0.185, 0.075), vec3(0.155, 0.295, 0.115), lump);
    treeCol = mix(treeCol, vec3(0.215, 0.255, 0.115), smoothstep(0.58, 0.86, temp));
    treeCol = mix(treeCol, vec3(0.115, 0.185, 0.125), smoothstep(0.40, 0.16, temp));
    float cover = canopy * smoothstep(0.28, 0.60, macro * 0.5 + med * 0.5);
    albedo = mix(albedo, treeCol * (0.72 + 0.55 * lump), clamp(cover, 0.0, 1.0) * 0.92);
    N = normalize(N + vec3(lump - 0.5, 0.0, med - 0.5) * cover * 0.55);
  }

  // rock on steep slopes — height folded into the sample coordinate so cliff
  // faces don't smear vertically
  float rockAmt = smoothstep(0.16, 0.42, slope);
  vec3 rock = C_ROCK;
  if (rockAmt > 0.004){
    vec2 rockP = vec2(vWorld.x + vWorld.y * 0.85, vWorld.z - vWorld.y * 0.85);
    rock = mix(C_ROCK, C_ROCK2, fbmW(rockP, 0.013, 2, 1e9) * 0.5 + 0.5);
    rock *= 0.82 + 0.36 * med;
  }
  albedo = mix(albedo, rock, rockAmt);

  // beaches
  float beach = smoothstep(6.5, 0.6, h) * smoothstep(0.30, 0.10, slope) * step(0.0, h);
  albedo = mix(albedo, C_SAND, beach * 0.92);

  // seabed
  albedo = mix(albedo, C_SEABED, smoothstep(0.0, -12.0, h));

  // snow: altitude + climate driven, plus weather accumulation. The snowline
  // wobble reuses the macro field rather than sampling another octave.
  float snowAlt = 260.0 + temp * 4200.0 + (macro - 0.5) * 520.0;
  float snowAmt = smoothstep(snowAlt, snowAlt + 320.0, h);
  snowAmt = max(snowAmt, uSnowCover * smoothstep(0.62, 0.95, Ng.y) * step(0.5, h));
  snowAmt *= smoothstep(0.30, 0.62, Ng.y);
  snowAmt *= 1.0 - beach * 0.8;
  vec3 snow = C_SNOW * (0.92 + 0.16 * med);
  albedo = mix(albedo, snow, clamp(snowAmt, 0.0, 1.0));

  // mown airfield grass
  vec3 field = mix(vec3(0.30, 0.37, 0.18), vec3(0.42, 0.44, 0.24), smoothstep(0.5, 0.85, temp));
  albedo = mix(albedo, field * (0.85 + 0.3 * med), vApT * 0.85 * (1.0 - snowAmt) * step(0.5, h));

  albedo = mix(albedo, albedo * 0.62, uWetness * 0.7);
  // the palette above is authored in sRGB; lighting happens in linear space
  albedo = pow(clamp(albedo, 0.0, 1.0), vec3(2.2));

  // --- lighting -----------------------------------------------------------
  vec3 L = normalize(uSunDir);
  float ndl = dot(N, L);
  float wrapped = clamp((ndl + 0.18) / 1.18, 0.0, 1.0);
  // large-scale terrain shadowing approximation
  float shade = mix(1.0, wrapped, 0.92);

  shade *= cloudShadow(vWorld);
  vec3 direct = uSunColor * uSunIntensity * shade * (1.0 / 3.14159265);
  float ndm = clamp((dot(N, normalize(uMoonDir)) + 0.16) / 1.16, 0.0, 1.0);
  direct += uMoonColor * ndm * (1.0 / 3.14159265);
  float skyOcc = 0.55 + 0.45 * N.y;
  vec3 ambient = mix(uGroundAmbient, uSkyAmbient, clamp(N.y * 0.5 + 0.5, 0.0, 1.0)) * skyOcc;

  vec3 color = albedo * (direct + ambient);

  // wet / snow specular sheen
  float gloss = uWetness * 0.9 + snowAmt * 0.25;
  if (gloss > 0.01){
    vec3 V = normalize(uCamPos - vWorld);
    vec3 H = normalize(V + L);
    float spec = pow(max(dot(N, H), 0.0), mix(24.0, 220.0, uWetness));
    color += uSunColor * uSunIntensity * spec * gloss * 0.06 * step(0.0, ndl);
  }

  color = applyAerial(color, vWorld);
  gl_FragColor = vec4(color, 1.0);
}
`;

export class Terrain {
  constructor() {
    this.group = new THREE.Group();
    this.group.frustumCulled = false;
    this.levels = [];

    const solid = buildGrid(false);
    const ring = buildGrid(true);

    const proto = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {},
      side: THREE.FrontSide,
      extensions: { derivatives: true },   // the fragment shader recovers normals
    });

    for (let l = 0; l < LEVELS; l++) {
      const spacing = S0 * Math.pow(2, l);
      const mat = proto.clone();
      mat.uniforms = Object.assign({}, atmo, {
        uApData: { value: Array.from({ length: MAX_AIRPORTS }, () => new THREE.Vector4()) },
        uApCount: { value: 0 },
        uSpacing: { value: spacing },
        uCenter: { value: new THREE.Vector2() },
        uMaxFreq: { value: 1.0 / (2.6 * spacing) },
        uGridHalf: { value: G / 2 },
        uMorphStart: { value: MORPH_START },
        uLevelBias: { value: l * 0.35 },
      });
      const mesh = new THREE.Mesh(l === 0 ? solid : ring, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = -10 + l;
      this.group.add(mesh);
      this.levels.push({ mesh, mat, spacing });
    }
    this.apUniforms = this.levels.map(l => l.mat.uniforms);
  }

  setAirports(list) {
    for (const u of this.apUniforms) {
      u.uApCount.value = Math.min(list.length, MAX_AIRPORTS);
      for (let i = 0; i < Math.min(list.length, MAX_AIRPORTS); i++) {
        u.uApData.value[i].set(list[i].x, list[i].z, list[i].elev, list[i].hdg);
      }
    }
  }

  update(camX, camZ) {
    for (const lv of this.levels) {
      const snap = lv.spacing * 2;
      lv.mat.uniforms.uCenter.value.set(
        Math.round(camX / snap) * snap,
        Math.round(camZ / snap) * snap
      );
    }
  }
}
