# Skywind 737

A browser flight simulator built on Three.js. Everything you see is generated at
runtime from code — there are no image, model or audio assets anywhere in the
project. Terrain, biomes, sky, clouds, weather, the aeroplane, the cockpit, the
runway markings and the engine sound are all synthesised.

## Running it

```bash
npm install
npm start
```

Then open <http://localhost:5173>. A server is required (ES modules and the
Three.js import map will not load over `file://`).

## The aircraft

A 737-800 class twinjet, modelled with a full six-degree-of-freedom rigid body:

| | |
|---|---|
| Wing area / span / MAC | 124.6 m² · 34.32 m · 4.17 m |
| Operating empty / payload / fuel | 41 400 kg · 14 500 kg · up to 20 800 kg |
| Engines | 2 × 117 kN static, with N1 spool lag and density/Mach lapse |
| Flaps | 0 · 1 · 5 · 10 · 15 · 25 · 30 · 40 |

Forces come from an ISA atmosphere, a lift curve with a proper stall break,
induced and parasite drag, ground effect, flap/gear/spoiler increments, and the
usual static and damping derivatives in all three axes. Landing gear is modelled
as three sprung struts with load-dependent tyre friction, brakes, thrust
reverse and nosewheel steering; there are separate fuselage contact points, so a
tailstrike or gear-up landing does what you would expect.

Representative behaviour: rotation around 150 kt, ~12°/s roll rate at full
aileron, 2.2 g at full aft stick from cruise trim, and a stable 3° approach at
Vref on roughly 70 % N1.

The autopilot has heading, altitude and speed channels with bank limiting and
speed-based envelope protection, so it will not stall the aircraft in a climb.

## The world

Terrain is a procedural heightfield evaluated **in the vertex shader** and drawn
with a CDLOD geometry clipmap — ten concentric rings from 2 m spacing under the
aircraft out to a 65 km radius, with vertex morphing so there are no cracks or
popping between levels. The identical height function is implemented in
JavaScript (`src/terrainCommon.js`) for ground contact, object placement and the
map, so what you fly over is exactly what you see.

Biomes come from continent-scale temperature and moisture fields: fly north or
south and you pass through tropics, savanna, desert, temperate forest, taiga and
tundra, with an altitude-driven snow line on top.

Airports are deterministic — every 36 km cell hashes to a candidate site that is
accepted only if the ground is flat enough and both approach corridors stay
under a surface below a 3° glideslope. Accepted sites flatten the terrain into a
plateau in the same height function the GPU uses, so the runway is genuinely
level. Each one gets procedurally drawn asphalt with markings and threshold
numbers derived from its heading, a taxiway, apron, terminal, control tower,
hangars, and a full lighting set (edge, threshold, PAPI, approach, taxiway).

## Graphics

- **Atmosphere** — Rayleigh + Mie single scattering ray-marched into a small
  equirectangular LUT whenever the sun moves. The same LUT drives the skydome,
  the ambient light, and the aerial perspective on every other surface, so
  distant terrain haze is always consistent with the sky behind it.
- **Sun and moon** — real solar geometry from a time-of-day clock, with sunlight
  colour taken from atmospheric transmittance. Moonlight is a second key light,
  so nights are navigable rather than black. Exposure adapts like an eye.
- **Clouds** — a stacked cumulus deck whose coverage tapers with height (so it
  domes rather than lying flat), plus a wind-stretched cirrus sheet. Flying into
  the deck fogs you in.
- **Weather** — clear, fair, overcast, rain, thunderstorm and snow. Rain streaks
  align to the airflow, so they go nearly horizontal at speed; snow drifts.
  Snow also accumulates on the ground and frosts the trees, and lightning
  lights the whole scene.
- **Vegetation** — instanced grass blades with per-blade wind, close-range trees
  in four species chosen by biome, distance impostors, and a painted forest
  canopy in the terrain shader that the impostors dissolve into.

## Controls

Yoke convention: **pull back (↓ / S) to raise the nose.** Press `H` in the sim
for the full list.

| | |
|---|---|
| Pitch / roll | `↓ ↑` `← →` or `S W A D` |
| Rudder | `Q` / `E` |
| Throttle | `Shift` / `Ctrl`, or the mouse wheel |
| Flaps | `[` / `]` |
| Gear · brakes · parking brake | `G` · `B` (hold) · `V` |
| Speedbrake · reversers | `Space` · `R` (hold) |
| Pitch trim | `,` / `.` |
| Autopilot | `1` master · `2` HDG · `3` ALT · `4` SPD |
| Camera | `C`, or `5`–`8` for cockpit / chase / wing / orbit |
| Look around | drag with the mouse |
| Mouse as yoke | `M` |
| Map range | `Z` / `X` |
| Reposition | `Enter` on a runway · `Backspace` on approach |
| Pause · help | `P` · `H` |

Gamepads are picked up automatically (sticks for roll/pitch/yaw, right stick
vertical for throttle).

## Layout

```
index.html          canvas, HUD overlay, settings panel
server.js           static file server
src/
  main.js           renderer, post-processing, frame loop, glue
  noise.js          simplex noise — matched JS and GLSL implementations
  terrainCommon.js  the world height function, biomes, airport flattening
  terrain.js        CDLOD clipmap + terrain shading
  atmosphere.js     scattering LUT, shared uniforms, aerial perspective
  sky.js            skydome, sun/moon geometry, stars
  ocean.js          water shading, shallows, foam, glint
  clouds.js         cumulus deck and cirrus
  weather.js        precipitation and weather presets
  vegetation.js     grass, trees, impostors
  airports.js       site selection, runway/lighting/building generation
  aircraft.js       6-DOF flight model, gear, engines, autopilot
  plane737.js       procedural airframe and livery
  cockpit.js        flight deck interior
  hud.js            primary flight display
  minimap.js        moving map
  controls.js       keyboard / mouse / gamepad
  audio.js          synthesised engine, wind, rain
```

## Performance notes

Terrain detail, vegetation density and cloud sampling are all distance-gated,
and the vegetation rebuilds are spread across frames. If it runs hot, the
settings panel has a render scale slider and toggles for bloom and vegetation.
