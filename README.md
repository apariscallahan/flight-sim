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

Screenshots of what it looks like are in `screenshots/`.

## Your first flight

You start already airborne, trimmed and hands-off on final approach to the
nearest field. Let go of everything and the aeroplane will fly straight and
level on its own — nothing needs to be held.

### Taking off

Press **Enter** to be placed at the start of a runway, then:

1. **Flaps 5** — press `]` twice. The `FLAP` readout on the PFD should show `5`.
2. **Full thrust** — hold **Shift** for about two seconds until `THR` shows
   `100%`. The engines take a further few seconds to spool: `N1` climbs to about
   93 % after five seconds and 100 % shortly after. **The first couple of
   seconds feel like nothing is happening — that is correct.** A loaded jet is
   slow to start rolling, then accelerates hard.
3. **Keep straight** — use `Q` and `E` for the nosewheel if you drift. You
   shouldn't need much.
4. **Rotate at 150 kt** — watch the speed tape on the left of the PFD. At 150,
   pull back gently: hold **↓** (or `S`) until the nose is about **13° up** on
   the pitch ladder, then ease off. Do not pull past ~18° or you'll lose speed.
5. **Gear up** once you have a positive climb — press `G`. The `GEAR` readout
   goes `DOWN` → `TRAN` → `UP`.
6. **Flaps up** passing about 1000 ft — press `[` twice.
7. Trim off any stick force with `,` and `.` so you can let go of the yoke.

You lift off after about 1500 m of a 3200 m runway — roughly 35 seconds — and
climb away at around 3000 fpm. You start lined up on the threshold, so the whole
runway is ahead of you. To level off, press `1` to engage the autopilot: it
captures the heading, altitude and speed you are at, and you can then type new
ones into the panel on the right.

### If it won't accelerate

Check the PFD: a red **PARK BRK** flag at the top right, or `BRAKES: PARK` in
the bottom strip, means the parking brake is set. Press **V** to release it.
The engines cannot overcome it.

### Flying an instrument approach

Every runway has an ILS on both landing directions, and the sim tunes the one
you are best set up for automatically — press **T** to cycle through the others
in range. The tuned approach shows up in three places:

- **On the PFD**, a magenta diamond below the attitude indicator is the
  localiser and one down its right edge is the glideslope. They show where the
  beam is relative to you, so you steer *towards* the diamond: needle left means
  fly left. Both are centred when you are on profile.
- **On the navigation display**, the approach is drawn as a magenta dashed
  centreline running back from the threshold, with a tick every 2 NM.
- **On the CDU**, in the centre of the panel, as runway, course, distance and
  the current localiser and glideslope errors in degrees.

A normal approach: intercept the centreline about 10 NM out at around 2000 ft
above the field, gear down, flaps 30, and hold roughly 145 kt. Keep both
diamonds centred and you will arrive at the threshold at 50 ft.

### The navigation display

The ND is track-up in arc mode. It shows terrain shaded the way a real terrain
awareness system does — red is at or above your altitude, amber is within about
3000 ft below, green is below that — plus airports with their runways drawn to
scale, your ground track, the wind, and the tuned approach. **Z** and **X**
change the range; **J** toggles the terrain shading; **N** swaps the corner
display between the moving map and the ND.

### Landing

Press **Backspace** to be placed on a 9 NM final. Then: gear down (`G`), flaps
30 (`]` until `FLAP` shows `30`), and aim for about **145 kt**. Hold roughly
700 fpm down — the green circle on the PFD is your flight path vector; put it
on the runway threshold and that is where you will touch down. Flare gently at
about 30 ft, close the throttle, and after touchdown press **Space** for the
speedbrakes, hold **R** for reverse thrust and **B** for the wheel brakes.

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

Representative behaviour: rotation around 150 kt, ~13°/s roll rate at full
aileron, 2.2 g at full aft stick from cruise trim, and a stable 3° approach at
Vref on roughly 70 % N1.

### What makes it feel heavy

A lot of the difference between "aeroplane" and "spaceship with wings" is not in
the aerodynamics but in everything between your hand and the air:

- **Thrust is strongly non-linear in N1.** 70 % N1 is only about a third of
  takeoff thrust. Idle is not zero either, so the aeroplane creeps when you
  release the brakes. Spool time shortens as the core spins up — lazy off idle,
  brisk once it is turning.
- **Control surfaces lag the controls.** The stick and the elevator are separate
  states: your input ramps like a hand moving a heavy column, and the surface
  then takes about a third of a second to reach it. Full aileron takes ~3 s to
  reach a 25° bank rather than snapping there.
- **A yaw damper**, as every jet transport has. It opposes yaw rate and washes
  out over five seconds so it doesn't fight a steady turn — this is why the
  aeroplane tracks smoothly instead of wallowing in Dutch roll.
- **Buffet.** Separated flow near the stall, and wake off deployed speedbrakes,
  shakes the airframe — and the camera with it. It arrives a few knots before
  the stall warning, so you feel the edge before you're told about it.
- **Turbulence in two scales plus rotation.** Slow swells, a sharper ripple, and
  gusts that roll and yaw you rather than just shoving you sideways, which is
  what you actually feel in an aeroplane. It strengthens near the ground.
- **Runway rumble** through the gear, scaled with groundspeed.

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

## The flight deck

The cockpit is the intended way to fly this. It follows the real layout:

- **Six windows** — two forward windshields split by a centre post, two angled
  side windows, and aft quarter lights.
- **Glareshield** carrying the mode control panel, with course, speed, heading,
  altitude and vertical speed windows that track the autopilot, plus EFIS
  control panels and master caution lights either side.
- **Main panel** with six live screens: a PFD and ND for each pilot, an engine
  display showing N1, EGT and N2 per engine, and the CDU.
- **Centre pedestal** with the thrust levers, speedbrake and flap levers,
  trim wheels that turn with the stabiliser, parking brake, and radio panels.
- **Overhead panel**, side consoles, yokes that move with the controls, and
  rudder pedals.

You sit in the captain's seat by default. **K** moves you to the centre or the
right seat.

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
| Gear · wheel brakes · parking brake | `G` · `B` (hold) · `V` (toggle) |
| Speedbrake · reversers | `Space` · `R` (hold) |
| Pitch trim | `,` / `.` |
| Autopilot | `1` master · `2` HDG · `3` ALT · `4` SPD |
| Camera | `C`, or `5`–`8` for cockpit / chase / wing / orbit |
| Look around | drag with the mouse |
| Mouse as yoke | `M` |
| Seat | `K` — captain · centre · first officer |
| Range | `Z` / `X` — map and nav display |
| Tune next approach | `T` |
| Corner display | `N` — moving map or nav display |
| ND terrain shading | `J` |
| Graphics preset | the panel on the right (defaults to Auto) |
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
  cockpit.js        flight deck: geometry, panel artwork, live screens
  hud.js            primary flight display
  navigation.js     ILS approaches, tuning, deviations
  nd.js             navigation display (arc mode, terrain awareness)
  terrainMap.js     CPU terrain sampling shared by the map and the ND
  minimap.js        moving map
  controls.js       keyboard / mouse / gamepad
  audio.js          synthesised engine, wind, rain
```

## Performance

The graphics setting defaults to **Auto**: the frame loop keeps a rolling median
of real frame times and moves between four presets until the frame rate is
comfortable, so it self-tunes to whatever machine it lands on. You can pin a
preset from the panel if you prefer.

The presets trade off render scale, multisampling, bloom, the number of cloud
layers, vegetation and precipitation density.

If you are modifying this and want to know where the time goes, measure with
`EXT_disjoint_timer_query_webgl2` rather than wall-clock timing around
`gl.finish()` — the latter reports nonsense when the page is not compositing.
`window.SIM` exposes the renderer, scene and subsystems for exactly this.

Things that turned out to matter far more than expected, on a 2017-era
integrated GPU:

| | |
|---|---|
| Evaluating terrain height three times per vertex (for the normal) | the single largest cost in the renderer — the fragment shader recovers the normal from derivatives instead |
| Five stacked full-screen cloud layers | each one re-evaluated the noise field three times per pixel; now three layers that read the shadow map instead |
| Re-uploading the instrument canvases to the GPU every frame | ~2.2 MB/frame, more than the rest of the scene put together |
| 4× multisampling on a half-float target | pure memory bandwidth; only enabled on the top preset |
| Placing tree impostors in one pass | ~13 000 terrain queries in a single frame, which is exactly what a stutter looks like — now spread across frames with a time budget |
