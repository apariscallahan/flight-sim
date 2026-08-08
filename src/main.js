import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { Atmosphere, atmo, sunlightColor } from './atmosphere.js';
import { Sky, sunDirection, moonDirection } from './sky.js';
import { Terrain } from './terrain.js';
import { Ocean } from './ocean.js';
import { Clouds, CloudShadowMap } from './clouds.js';
import { Vegetation } from './vegetation.js';
import { Weather } from './weather.js';
import { AirportManager, airportsNear, lightUniforms } from './airports.js';
import { setAirportUniformData, terrainHeight, climate, clamp, smoothstep } from './terrainCommon.js';
import { Aircraft, KT, FT } from './aircraft.js';
import { build737, animate737 } from './plane737.js';
import {
  buildCockpit, updateCockpit, EYE, SEATS,
  makeEngineCanvas, drawEngineDisplay, makeCduCanvas, drawCdu, makeMcpCanvas, drawMcp,
} from './cockpit.js';
import { PFD } from './hud.js';
import { Minimap } from './minimap.js';
import { TerrainMap } from './terrainMap.js';
import { Navigation } from './navigation.js';
import { ND } from './nd.js';
import { Controls, HELP_ROWS } from './controls.js';
import { Audio } from './audio.js';

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: false, logarithmicDepthBuffer: true,
  powerPreference: 'high-performance', stencil: false,
});
renderer.setClearColor(0x05070b, 1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.44;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 400000);
camera.rotation.order = 'YXZ';

const rt = new THREE.WebGLRenderTarget(1, 1, {
  type: THREE.HalfFloatType, samples: 4,
  minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
});
const composer = new EffectComposer(renderer, rt);
const renderPass = new RenderPass(scene, camera);
// Threshold sits just above "sunlit white surface" in our HDR scale, so only the
// sun, runway lights and specular highlights glare.
const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.62, 0.85, 6.5);
const outputPass = new OutputPass();
composer.addPass(renderPass);
composer.addPass(bloomPass);
composer.addPass(outputPass);

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------
const atmosphere = new Atmosphere(renderer);
const sky = new Sky();
scene.add(sky.mesh);

const terrain = new Terrain();
scene.add(terrain.group);

const ocean = new Ocean();
scene.add(ocean.mesh);

const clouds = new Clouds(scene);
const cloudShadows = new CloudShadowMap(renderer);
const vegetation = new Vegetation(scene);
const weather = new Weather(scene);
const airports = new AirportManager(scene);

const ac = new Aircraft();
const model = build737();
scene.add(model);

const terrainMap = new TerrainMap(112);
const nav = new Navigation();
const pfd = new PFD(document.getElementById('pfdCanvas'));
const minimap = new Minimap(document.getElementById('mapCanvas'), terrainMap);
const nd = new ND(document.getElementById('ndCanvas'), terrainMap);
const engineCv = makeEngineCanvas();
const cduCv = makeCduCanvas();
const mcpCv = makeMcpCanvas();
drawMcp(mcpCv, ac);
const cockpit = buildCockpit({
  pfd: pfd.cv, nd: nd.cv, engine: engineCv, cdu: cduCv, mcp: mcpCv,
});
model.add(cockpit);

// projected aircraft shadow
const shadow = (() => {
  const N = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const g = cv.getContext('2d');
  g.fillStyle = '#000';
  const ell = (x, y, rx, ry, rot) => {
    g.save(); g.translate(x, y); g.rotate(rot);
    g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, 7); g.fill(); g.restore();
  };
  ell(N / 2, N / 2, 10, 92, 0);                      // fuselage
  g.beginPath();                                      // wings
  g.moveTo(N / 2 - 6, N / 2 - 6); g.lineTo(N / 2 - 116, N / 2 + 40);
  g.lineTo(N / 2 - 112, N / 2 + 52); g.lineTo(N / 2 - 4, N / 2 + 26);
  g.lineTo(N / 2 + 4, N / 2 + 26); g.lineTo(N / 2 + 112, N / 2 + 52);
  g.lineTo(N / 2 + 116, N / 2 + 40); g.lineTo(N / 2 + 6, N / 2 - 6);
  g.closePath(); g.fill();
  g.beginPath();                                      // tailplane
  g.moveTo(N / 2 - 4, N / 2 + 66); g.lineTo(N / 2 - 44, N / 2 + 84);
  g.lineTo(N / 2 + 44, N / 2 + 84); g.lineTo(N / 2 + 4, N / 2 + 66);
  g.closePath(); g.fill();
  ell(N / 2 - 36, N / 2 + 12, 9, 16, -0.3);           // engines
  ell(N / 2 + 36, N / 2 + 12, 9, 16, 0.3);
  const blur = document.createElement('canvas');
  blur.width = blur.height = N;
  const bg = blur.getContext('2d');
  bg.filter = 'blur(5px)';
  bg.drawImage(cv, 0, 0);
  const tex = new THREE.CanvasTexture(blur);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(52, 52),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.5, depthWrite: false, color: 0x000000, toneMapped: false })
  );
  mesh.geometry.rotateX(-Math.PI / 2);
  mesh.renderOrder = 3;
  scene.add(mesh);
  return mesh;
})();

// ---------------------------------------------------------------------------
// UI state
// ---------------------------------------------------------------------------
const camFollow = { pos: new THREE.Vector3(), first: true, look: new THREE.Vector3() };
const ui = {
  hour: 7.6, rate: 30, weather: 'fair', cam: 0,
  bloom: true, veg: true, scale: 1, paused: false, invert: false,
  cornerND: false, seat: 'captain',
};

// ---------------------------------------------------------------------------
// Quality. This runs on everything from an integrated laptop GPU to a desktop
// card, so rather than guess, the manager watches real frame times and moves
// between presets until the frame rate is comfortable.
// ---------------------------------------------------------------------------
const QUALITY = [
  { name: 'Minimum', scale: 0.55, bloom: false, veg: false, slabs: 1, weather: 0.3, cirrus: false, msaa: 0 },
  { name: 'Low', scale: 0.68, bloom: false, veg: true, slabs: 2, weather: 0.5, cirrus: true, msaa: 0 },
  { name: 'Medium', scale: 0.82, bloom: false, veg: true, slabs: 3, weather: 0.75, cirrus: true, msaa: 0 },
  { name: 'High', scale: 1.0, bloom: true, veg: true, slabs: 3, weather: 1.0, cirrus: true, msaa: 4 },
];
const quality = { level: 2, auto: true, _cooldown: 3, _frames: [], _idx: 0 };

function applyQuality() {
  const q = QUALITY[quality.level];
  ui.scale = q.scale;
  // Multisampling a half-float buffer is bandwidth-hungry; on integrated
  // graphics it costs more than several of the scene's shaders put together.
  const msaa = q.msaa;
  for (const rtName of ['renderTarget1', 'renderTarget2']) {
    const rt = composer[rtName];
    if (rt && rt.samples !== msaa) { rt.samples = msaa; rt.dispose(); }
  }
  bloomPass.enabled = q.bloom && ui.bloom;
  vegetation.enabled = q.veg && ui.veg;
  clouds.setSlabCount(q.slabs);
  clouds.cirrus.visible = q.cirrus;
  weather.setQuality(q.weather);
  resize();
  const sel = el('qualitySel');
  if (sel) sel.value = quality.auto ? 'auto' : String(quality.level);
  const lbl = el('qualityNow');
  if (lbl) lbl.textContent = q.name + (quality.auto ? ' (auto)' : '');
}

/** Median of the recent real frame times, in ms. */
function frameMedian() {
  const f = quality._frames;
  if (f.length < 20) return 16;
  const s = f.slice().sort((a, b) => a - b);
  return s[s.length >> 1];
}

function updateQuality(dt) {
  const f = quality._frames;
  f[quality._idx++ % 45] = dt * 1000;
  if (!quality.auto) return;
  quality._cooldown -= dt;
  if (quality._cooldown > 0 || f.length < 45) return;
  const med = frameMedian();
  if (med > 23 && quality.level > 0) {
    quality.level--; applyQuality(); quality._cooldown = 2.5; quality._frames.length = 0; quality._idx = 0;
    toast('Graphics reduced to ' + QUALITY[quality.level].name + ' to keep the frame rate up');
  } else if (med < 11.5 && quality.level < QUALITY.length - 1) {
    quality.level++; applyQuality(); quality._cooldown = 6; quality._frames.length = 0; quality._idx = 0;
  }
}
const el = id => document.getElementById(id);
const audio = new Audio();

function toast(msg) {
  const t = el('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 1700);
}

const actions = {
  throttleDelta(d) { ac.throttle = clamp(ac.throttle + d, 0, 1); },
  setThrottle(v) { ac.throttle = clamp(v, 0, 1); },
  toggleGear() {
    ac.gearDown = !ac.gearDown;
    toast('Landing gear ' + (ac.gearDown ? 'DOWN' : 'UP'));
  },
  toggleParkBrake() { ac.parkBrake = !ac.parkBrake; toast('Parking brake ' + (ac.parkBrake ? 'SET' : 'RELEASED')); },
  toggleSpoilers() { ac.spoilerCmd = ac.spoilerCmd > 0.5 ? 0 : 1; toast('Speedbrake ' + (ac.spoilerCmd ? 'DEPLOYED' : 'RETRACTED')); },
  flaps(d) {
    ac.setFlapIndex(ac.flapIndex + d);
    toast('Flaps ' + [0, 1, 5, 10, 15, 25, 30, 40][ac.flapIndex] + '°');
  },
  cycleCamera() { setCam((ui.cam + 1) % 4); },
  setCamera(i) { if (i >= 0 && i < 4) setCam(i); },
  toggleHelp() { el('help').classList.toggle('show'); },
  togglePause() { ui.paused = !ui.paused; toast(ui.paused ? 'Paused' : 'Resumed'); },
  mapRange(d) {
    minimap.cycleRange(d);
    nd.rangeIdx = minimap.rangeIdx;
    toast('Range ' + [5, 10, 20, 40, 80, 160][minimap.rangeIdx] + ' NM');
  },
  cycleApproach(d) {
    nav.cycle(ac, d);
    toast(nav.tuned ? 'Tuned ' + nav.tuned.airport.name + ' ILS ' + nav.tuned.runway
      : 'No approach in range');
  },
  toggleCornerDisplay() {
    ui.cornerND = !ui.cornerND;
    el('map').style.display = ui.cornerND ? 'none' : 'block';
    el('ndWrap').style.display = ui.cornerND ? 'block' : 'none';
    toast(ui.cornerND ? 'Corner: navigation display' : 'Corner: moving map');
  },
  toggleTerrainOverlay() {
    nd.showTerrain = !nd.showTerrain;
    toast('ND terrain ' + (nd.showTerrain ? 'ON' : 'OFF'));
  },
  cycleSeat() {
    const order = ['captain', 'centre', 'firstOfficer'];
    ui.seat = order[(order.indexOf(ui.seat) + 1) % order.length];
    EYE.x = SEATS[ui.seat];
    toast('Seat: ' + (ui.seat === 'firstOfficer' ? 'first officer' : ui.seat));
  },
  resetRunway() { const a = nearestAirport(); if (a) { ac.placeOnRunway(a); toast('Positioned at ' + a.name); } },
  resetApproach() { const a = nearestAirport(); if (a) { ac.placeAirborne(a, 9, 3000); toast('On final for ' + a.name); } },
  ap(which) {
    const A = ac.ap;
    if (which === 'master') {
      A.on = !A.on;
      if (A.on) { A.hdg = ac.headingDeg; A.alt = ac.pos.y; A.spd = ac.ias / KT; A.hdgHold = A.altHold = A.spdHold = true; syncApInputs(); }
      A._iAlt = 0; A._iSpd = 0;
      toast('Autopilot ' + (A.on ? 'ENGAGED' : 'DISCONNECTED'));
    } else if (which === 'hdg') { A.hdgHold = !A.hdgHold; if (A.hdgHold) { A.hdg = ac.headingDeg; syncApInputs(); } }
    else if (which === 'alt') { A.altHold = !A.altHold; if (A.altHold) { A.alt = ac.pos.y; syncApInputs(); } A._iAlt = 0; }
    else if (which === 'spd') { A.spdHold = !A.spdHold; if (A.spdHold) { A.spd = ac.ias / KT; syncApInputs(); } A._iSpd = 0; }
    refreshChips();
  },
  notify: toast,
};

const controls = new Controls(canvas, actions);

function nearestAirport() {
  const list = airportsNear(ac.pos.x, ac.pos.z, 200000, 12);
  return list[0] || null;
}

function setCam(i) {
  ui.cam = i;
  for (const c of el('camChips').children) c.classList.toggle('on', +c.dataset.cam === i);
  cockpit.visible = i === 0;
  camFollow.first = true;
}

function syncApInputs() {
  el('apHdgVal').value = Math.round(ac.ap.hdg);
  el('apAltVal').value = Math.round(ac.ap.alt / FT / 100) * 100;
  el('apSpdVal').value = Math.round(ac.ap.spd);
}
function refreshChips() {
  el('apMaster').classList.toggle('on', ac.ap.on);
  el('apHdg').classList.toggle('on', ac.ap.hdgHold);
  el('apAlt').classList.toggle('on', ac.ap.altHold);
  el('apSpd').classList.toggle('on', ac.ap.spdHold);
}

// --- wire the panel ---------------------------------------------------------
el('timeSlider').addEventListener('input', e => { ui.hour = +e.target.value; atmosphere.dirty = true; });
el('rateSlider').addEventListener('input', e => { ui.rate = +e.target.value; el('rateVal').textContent = ui.rate + '×'; });
el('weatherSel').addEventListener('change', e => { ui.weather = e.target.value; weather.setMode(ui.weather); });
el('optVeg').addEventListener('change', e => { ui.veg = e.target.checked; applyQuality(); });
el('optBloom').addEventListener('change', e => { ui.bloom = e.target.checked; applyQuality(); });
el('optInvert').addEventListener('change', e => { controls.invertPitch = e.target.checked; });
el('qualitySel').addEventListener('change', e => {
  if (e.target.value === 'auto') { quality.auto = true; quality._cooldown = 2; }
  else { quality.auto = false; quality.level = +e.target.value; }
  applyQuality();
});
el('btnRunway').addEventListener('click', actions.resetRunway);
el('btnApproach').addEventListener('click', actions.resetApproach);
el('btnHelp').addEventListener('click', actions.toggleHelp);
el('helpClose').addEventListener('click', actions.toggleHelp);
for (const c of el('camChips').children) c.addEventListener('click', () => setCam(+c.dataset.cam));
el('apMaster').addEventListener('click', () => actions.ap('master'));
el('apHdg').addEventListener('click', () => actions.ap('hdg'));
el('apAlt').addEventListener('click', () => actions.ap('alt'));
el('apSpd').addEventListener('click', () => actions.ap('spd'));
el('apHdgVal').addEventListener('change', e => { ac.ap.hdg = (+e.target.value % 360 + 360) % 360; });
el('apAltVal').addEventListener('change', e => { ac.ap.alt = +e.target.value * FT; });
el('apSpdVal').addEventListener('change', e => { ac.ap.spd = +e.target.value; });

el('helpTable').innerHTML = HELP_ROWS
  .map(([a, b, c]) => `<tr><td>${a}</td><td>${b}</td><td>${c}</td></tr>`).join('');

weather.setMode(ui.weather);

// ---------------------------------------------------------------------------
// Sizing
// ---------------------------------------------------------------------------
let lastW = 0, lastH = 0;
function resize() {
  // Guard against being laid out at zero size (page opened in a hidden tab);
  // the frame loop re-checks and calls back in once the viewport is real.
  const w = Math.max(window.innerWidth, 1), h = Math.max(window.innerHeight, 1);
  lastW = w; lastH = h;
  // Cap at 1.5x rather than 2x: this scene is fragment-bound, and rendering a
  // HiDPI display natively quadruples the most expensive work in the frame.
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * ui.scale;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  composer.setPixelRatio(dpr);
  composer.setSize(w, h);
  // Bloom runs at half resolution — it is a wide blur, so nobody can tell, and
  // it is one of the heaviest passes on integrated graphics.
  bloomPass.resolution.set(Math.max(w * dpr * 0.5, 8), Math.max(h * dpr * 0.5, 8));
  const hudDpr = Math.min(window.devicePixelRatio || 1, 2);
  pfd.resize(hudDpr);
  minimap.resize(hudDpr);
  nd.resize(hudDpr);
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------------------
// Start position
// ---------------------------------------------------------------------------
{
  const list = airportsNear(0, 0, 260000, 12);
  setAirportUniformData(list);
  const home = list[0];
  if (home) ac.placeAirborne(home, 9, 3000);
  else { ac.pos.set(0, 3000, 0); ac.vel.set(0, 0, -150); }
  ac.ap.alt = ac.pos.y;
  syncApInputs();
}
setCam(0);
refreshChips();
applyQuality();

// ---------------------------------------------------------------------------
// Frame loop
// ---------------------------------------------------------------------------
const sunDir = new THREE.Vector3();
const moonDir = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const camVel = new THREE.Vector3();
let last = performance.now() / 1000;
let simTime = 0;
let fps = 60, frames = 0, fpsT = 0;
let shakePhase = 0;
let hudClock = 0, mapClock = 0, slowClock = 0;
let started = false;

const dayAmb = new THREE.Color(0.30, 0.46, 0.86);
const duskAmb = new THREE.Color(0.85, 0.42, 0.26);
const nightAmb = new THREE.Color(0.045, 0.065, 0.14);

function updateSun(dt) {
  ui.hour = (ui.hour + dt * ui.rate / 3600) % 24;
  el('timeSlider').value = ui.hour;
  const hh = Math.floor(ui.hour), mm = Math.floor((ui.hour % 1) * 60);
  el('timeVal').textContent = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');

  sunDirection(ui.hour, 42, 12, sunDir);
  moonDirection(ui.hour, moonDir);
  atmo.uSunDir.value.copy(sunDir);
  atmo.uMoonDir.value.copy(moonDir);

  const e = sunDir.y;
  const p = weather.preset;
  const deckShadow = ac.pos.y < 2600 ? p.coverage * 0.62 : p.coverage * 0.10;

  sunlightColor(sunDir, Math.max(ac.pos.y, 0), atmo.uSunColor.value);
  atmo.uSunColor.value.multiplyScalar(1 - deckShadow);
  atmo.uSunIntensity.value = 21;

  // Sky-light colour and strength as a smooth function of solar elevation, with a
  // warm bump through the golden hour and a faint moonlit floor at night.
  const day = smoothstep(-0.12, 0.28, e);
  const dusk = Math.exp(-Math.pow((e - 0.02) / 0.10, 2));
  const amb = nightAmb.clone().lerp(dayAmb, day);
  amb.lerp(duskAmb, dusk * 0.55);
  amb.multiplyScalar(0.13 + 1.20 * day + dusk * 0.45);
  const moonUp = clamp(moonDir.y * 3, 0, 1) * (1 - day);
  amb.r += moonUp * 0.085; amb.g += moonUp * 0.105; amb.b += moonUp * 0.170;
  amb.multiplyScalar(1.25 * (1 - p.darken * 0.30));
  atmo.uMoonColor.value.setRGB(0.44, 0.52, 0.86)
    .multiplyScalar(moonUp * 0.95 * (1 - p.coverage * 0.75));
  if (weather.lightning > 0.02) amb.addScalar(weather.lightning * 3.2);
  atmo.uSkyAmbient.value.copy(amb);
  atmo.uGroundAmbient.value.copy(amb).multiplyScalar(0.30).multiply(new THREE.Color(1.1, 1.0, 0.85));

  el('flash').style.opacity = (weather.lightning * 0.55).toFixed(3);
  atmosphere.update(sunDir, Math.max(ac.pos.y, 0));

  // --- eye adaptation ------------------------------------------------------
  const lum = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const sunTerm = lum(atmo.uSunColor.value) * atmo.uSunIntensity.value / Math.PI
    * smoothstep(-0.06, 0.10, e);
  const illum = sunTerm + lum(atmo.uMoonColor.value) / Math.PI + lum(amb) + 0.02;
  atmo.uNightMix.value = clamp(1 - day * 2.4, 0, 0.80);
  const target = clamp(2.6 / illum, 0.26, 1.85);
  const k = Math.min(dt * 0.9, 1);
  renderer.toneMappingExposure += (target - renderer.toneMappingExposure) * k;

  // runway lighting is dimmed by daylight and by the exposure we are running at
  lightUniforms.uLightGain.value =
    clamp(1.35 - e * 4.2, 0.10, 1.9) * (1 + p.darken * 0.5) * clamp(0.55 / renderer.toneMappingExposure, 0.22, 1.6);
}

function biomeName() {
  const cl = climate(ac.pos.x, ac.pos.z);
  const h = terrainHeight(ac.pos.x, ac.pos.z);
  if (h < 0) return 'Ocean';
  if (h > 320 + cl.t * 3100) return 'Alpine';
  if (cl.t > 0.74) return cl.m > 0.5 ? 'Tropical forest' : cl.m > 0.28 ? 'Savanna' : 'Desert';
  if (cl.t > 0.42) return cl.m > 0.55 ? 'Temperate forest' : 'Plains';
  if (cl.t > 0.18) return cl.m > 0.35 ? 'Taiga' : 'Steppe';
  return 'Tundra';
}

function updateCamera(dt) {
  const look = controls.mouse;
  const headingQ = tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -ac.headingDeg * Math.PI / 180);

  if (ui.cam === 0) {
    const eye = EYE.clone().applyQuaternion(ac.quat).add(ac.pos);
    camera.position.copy(eye);
    camera.quaternion.copy(ac.quat);
    camera.rotateY(look.lookX * 1.6);
    // A pilot's resting scan is slightly down: over the glareshield and across
    // the instrument panel, not level with the horizon.
    camera.rotateX(look.lookY * 0.9 - 0.12);
    camera.fov = 76;
  } else if (ui.cam === 1) {
    const dist = 46, height = 11;
    const off = new THREE.Vector3(
      Math.sin(look.lookX) * dist,
      height + look.lookY * 22,
      Math.cos(look.lookX) * dist
    ).applyQuaternion(headingQ);
    const want = tmpV.copy(ac.pos).add(off);
    if (camFollow.first) { camFollow.pos.copy(want); camFollow.first = false; }
    camFollow.pos.lerp(want, Math.min(dt * 4.5, 1));
    const gh = terrainHeight(camFollow.pos.x, camFollow.pos.z) + 3;
    if (camFollow.pos.y < gh) camFollow.pos.y = gh;
    camera.position.copy(camFollow.pos);
    camera.lookAt(ac.pos.x, ac.pos.y + 1.5, ac.pos.z);
    camera.fov = 55;
  } else if (ui.cam === 2) {
    const eye = new THREE.Vector3(-13.5, 1.4, 3.5).applyQuaternion(ac.quat).add(ac.pos);
    camera.position.copy(eye);
    camera.quaternion.copy(ac.quat);
    camera.rotateY(-0.85 + look.lookX * 1.2);
    camera.rotateX(look.lookY * 0.8 - 0.06);
    camera.fov = 70;
  } else {
    const dist = 72;
    const a = look.lookX * 2.4 + simTime * 0.045;
    const el2 = 0.22 + look.lookY * 0.8;
    camera.position.set(
      ac.pos.x + Math.sin(a) * dist * Math.cos(el2),
      ac.pos.y + Math.sin(el2) * dist,
      ac.pos.z + Math.cos(a) * dist * Math.cos(el2)
    );
    const gh = terrainHeight(camera.position.x, camera.position.z) + 4;
    if (camera.position.y < gh) camera.position.y = gh;
    camera.lookAt(ac.pos);
    camera.fov = 50;
  }
  // Airframe shake: stall/speedbrake buffet, and the runway hammering through
  // the gear. Strongest in the cockpit, damped down in the external views.
  const shakeAmt = (ac.buffet * 0.85 + ac.rumble * 0.30) * (ui.cam === 0 ? 1 : 0.35);
  if (shakeAmt > 0.004) {
    shakePhase += dt * 47;
    const a = shakeAmt * 0.012;
    camera.rotateZ(Math.sin(shakePhase * 1.00) * a);
    camera.rotateX(Math.sin(shakePhase * 1.43 + 1.7) * a * 0.8);
    camera.rotateY(Math.sin(shakePhase * 0.79 + 3.1) * a * 0.6);
    camera.position.y += Math.sin(shakePhase * 1.61) * shakeAmt * 0.035;
  }

  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

function frame() {
  requestAnimationFrame(frame);
  const now = performance.now() / 1000;
  tick(Math.min(now - last, 0.1));
  last = now;
}

function tick(dt) {
  if (window.innerWidth !== lastW || window.innerHeight !== lastH) resize();
  updateQuality(dt);
  frames++; fpsT += dt;
  if (fpsT > 0.5) { fps = frames / fpsT; frames = 0; fpsT = 0; }

  if (!ui.paused) simTime += dt;
  atmo.uTime.value = simTime;

  // airports first: the terrain shape depends on them
  const near = airports.update(ac.pos.x, ac.pos.z);
  if (near && near.length) {
    setAirportUniformData(near);
    terrain.setAirports(near);
    ocean.setAirports(near);
  }

  const p = weather.preset;

  if (!ui.paused) {
    controls.update(dt, ac);
    ac.runAutopilot(dt);
    ac.updateWind(dt, p.wind);
    const steps = Math.min(Math.ceil(dt / (1 / 120)), 8);
    const h = dt / steps;
    for (let i = 0; i < steps; i++) ac.step(h);
  }

  updateSun(dt);

  // world follows the aircraft
  model.position.copy(ac.pos);
  model.quaternion.copy(ac.quat);
  animate737(model, ac, dt, simTime);
  // The instrument canvases are redrawn on their own slower clocks, and the
  // cockpit screens only re-upload when the source actually changed — a canvas
  // upload is one of the most expensive things per frame on integrated GPUs.
  hudClock += dt;
  const hudTick = hudClock >= 1 / 30;
  if (hudTick) hudClock = 0;
  mapClock += dt;
  const mapTick = mapClock >= 1 / 10;
  if (mapTick) mapClock = 0;
  slowClock += dt;
  const slowTick = slowClock >= 1 / 4;
  if (slowTick) slowClock = 0;

  updateCamera(dt);
  atmo.uCamPos.value.copy(camera.position);

  terrain.update(camera.position.x, camera.position.z);
  ocean.update(camera.position.x, camera.position.z);
  clouds.update(camera.position);
  clouds.setWeather({ coverage: p.coverage, darken: p.darken, cirrus: p.cirrus, baseAlt: 2300 });
  cloudShadows.update(camera.position.x, camera.position.z, p.coverage, 2300);
  sky.update(camera, sunDir);

  vegetation.setWind(p.wind, 2.1);
  vegetation.update(camera.position, camera.position.y - terrainHeight(camera.position.x, camera.position.z));

  const inside = clouds.insideFactor(camera.position.y) * smoothstep(0.34, 0.80, p.coverage);
  camVel.copy(ac.vel);
  const fwd = tmpV.set(0, 0, -1).applyQuaternion(camera.quaternion);
  weather.update(dt, camera.position, camVel, fwd, inside);

  // fog: thicker low down, and in bad weather
  atmo.uFogRho.value = (1 / 19000) * (1 + p.darken * 1.5);
  atmo.uFogH.value = 1900;

  // shadow
  if (sunDir.y > 0.06 && ac.agl < 600) {
    const t = ac.agl / sunDir.y;
    const sx = ac.pos.x - sunDir.x * t, sz = ac.pos.z - sunDir.z * t;
    shadow.visible = true;
    shadow.position.set(sx, terrainHeight(sx, sz) + 0.35, sz);
    shadow.rotation.y = -ac.headingDeg * Math.PI / 180;
    const spread = 1 + ac.agl / 900;      // penumbra grows slowly with height
    shadow.scale.set(spread, 1, spread);
    shadow.material.opacity = 0.55 * clamp(1 - ac.agl / 600, 0, 1) * clamp(sunDir.y * 3, 0, 1) * (1 - p.coverage * 0.7);
  } else shadow.visible = false;

  // Navigation and instruments. Each display runs on its own clock, and only
  // the ones actually redrawn get re-uploaded to the cockpit screens.
  nav.update(ac);
  const dirty = new Set();
  if (hudTick) { pfd.draw(ac, { fps }, nav); dirty.add(pfd.cv); }
  minimap.tick(ac.pos.x, ac.pos.z);
  if (mapTick) {
    if (ui.cornerND || ui.cam === 0) { nd.draw(ac, nav); dirty.add(nd.cv); }
    if (!ui.cornerND) minimap.draw(ac);
    if (ui.cam === 0) { drawEngineDisplay(engineCv, ac); dirty.add(engineCv); }
  }
  if (slowTick && ui.cam === 0) {
    drawCdu(cduCv, ac, nav); dirty.add(cduCv);
    drawMcp(mcpCv, ac); cockpit.userData.mcpTex.needsUpdate = true;
  }
  if (ui.cam === 0) updateCockpit(cockpit, ac, renderer.toneMappingExposure, dirty);

  audio.update(ac, p, dt, ui.cam === 0);

  el('status').innerHTML =
    `${biomeName()} <span class="sep">|</span> ` +
    `ALT ${Math.round(ac.pos.y / FT).toLocaleString()} ft <span class="sep">|</span> ` +
    `AGL ${Math.round(ac.agl / FT).toLocaleString()} ft <span class="sep">|</span> ` +
    `IAS ${Math.round(ac.ias / KT)} kt <span class="sep">|</span> ` +
    `M ${ac.mach.toFixed(2)} <span class="sep">|</span> ` +
    `FUEL ${(ac.fuel / 1000).toFixed(1)} t <span class="sep">|</span> ` +
    `${fps.toFixed(0)} fps` +
    (ac.crashed ? ' <span style="color:#ff5a4a">· AIRCRAFT DAMAGED — press Enter to reset</span>' : '') +
    (ui.paused ? ' <span style="color:#ffb020">· PAUSED</span>' : '');

  composer.render();

  if (!started) {
    started = true;
    setTimeout(() => {
      el('loading').classList.add('gone');
      setTimeout(() => el('loading').remove(), 900);
    }, 250);
  }
}

window.addEventListener('pointerdown', () => audio.start(), { once: true });
window.addEventListener('keydown', () => audio.start(), { once: true });

// Debug handle (also handy from the browser console).
window.SIM = { ac, ui, actions, controls, renderer, scene, camera, terrain, weather, minimap, nd, nav, vegetation, clouds, quality, tick, setCam, airportsNear };

el('loadMsg').textContent = 'compiling shaders…';
requestAnimationFrame(frame);
