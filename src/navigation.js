import { airportsNear, runwayDesignation } from './airports.js';
import { RWY_LENGTH } from './terrainCommon.js';

export const NM = 1852;
const GS_ANGLE = 3 * Math.PI / 180;      // standard glideslope
const LOC_FULL = 2.5;                    // degrees to full-scale localiser
const GS_FULL = 0.7;                     // degrees to full-scale glideslope

/**
 * Every runway is modelled as a pair of ILS approaches, one for each landing
 * direction. This is what turns the sim from "fly at the ground near an airport"
 * into something you can actually fly an instrument approach into.
 */
function approachesFor(ap) {
  const out = [];
  for (const end of [-1, 1]) {
    // Landing towards `end`: the threshold is at the opposite end.
    const course = end > 0 ? ap.hdg : ap.hdg + Math.PI;
    const dx = Math.sin(course), dz = -Math.cos(course);
    out.push({
      airport: ap,
      id: ap.name + '/' + String(runwayDesignation(course)).padStart(2, '0'),
      runway: String(runwayDesignation(course)).padStart(2, '0'),
      courseDeg: ((course * 180 / Math.PI) % 360 + 360) % 360,
      dx, dz,
      // threshold you cross on landing
      thrX: ap.x - dx * (RWY_LENGTH / 2),
      thrZ: ap.z - dz * (RWY_LENGTH / 2),
      elev: ap.elev,
    });
  }
  return out;
}

export class Navigation {
  constructor() {
    this.approaches = [];
    this.tuned = null;
    this.autoTune = true;
    this.dev = null;             // live deviations for the tuned approach
    this._at = { x: 1e9, z: 1e9 };
  }

  refresh(x, z, radius = 160000) {
    if (Math.hypot(x - this._at.x, z - this._at.z) < 5000 && this.approaches.length) return;
    this._at = { x, z };
    this.approaches = [];
    for (const ap of airportsNear(x, z, radius, 24)) {
      for (const a of approachesFor(ap)) this.approaches.push(a);
    }
  }

  /** Deviations for one approach, or null if it is behind us / unusable. */
  solve(a, ac) {
    const dx = ac.pos.x - a.thrX, dz = ac.pos.z - a.thrZ;
    // along-track: positive when still short of the threshold
    const along = -(dx * a.dx + dz * a.dz);
    const lateral = dx * Math.cos(a.courseDeg * Math.PI / 180) + dz * Math.sin(a.courseDeg * Math.PI / 180);
    const dme = Math.hypot(Math.hypot(dx, dz), ac.pos.y - a.elev);

    const locDeg = Math.atan2(lateral, Math.max(along, 200)) * 180 / Math.PI;
    const height = ac.pos.y - a.elev;
    const gsDeg = along > 200
      ? (Math.atan2(height, along) - GS_ANGLE) * 180 / Math.PI
      : 0;
    return {
      along, lateral, dme,
      locDeg,
      loc: Math.max(-1, Math.min(1, locDeg / LOC_FULL)),
      gsDeg,
      gs: Math.max(-1, Math.min(1, gsDeg / GS_FULL)),
      inRange: along > -RWY_LENGTH && along < 60 * NM,
      gsValid: along > 400 && along < 30 * NM && Math.abs(locDeg) < 8,
    };
  }

  /** Pick the approach the aircraft is best set up for. */
  best(ac) {
    let bestA = null, bestScore = Infinity;
    for (const a of this.approaches) {
      const d = this.solve(a, ac);
      if (!d.inRange) continue;
      let hdgErr = Math.abs(((a.courseDeg - ac.headingDeg + 540) % 360) - 180);
      const score = d.dme / NM + hdgErr * 0.9 + Math.abs(d.lateral) / NM * 2;
      if (score < bestScore) { bestScore = score; bestA = a; }
    }
    return bestA;
  }

  cycle(ac, dir = 1) {
    this.autoTune = false;
    const usable = this.approaches
      .map(a => ({ a, d: this.solve(a, ac) }))
      .filter(o => o.d.inRange)
      .sort((p, q) => p.d.dme - q.d.dme);
    if (!usable.length) return;
    const i = usable.findIndex(o => this.tuned && o.a.id === this.tuned.id);
    this.tuned = usable[(i + dir + usable.length + (i < 0 ? 1 : 0)) % usable.length].a;
  }

  update(ac) {
    this.refresh(ac.pos.x, ac.pos.z);
    if (this.autoTune || !this.tuned) {
      const b = this.best(ac);
      if (b) this.tuned = b;
    }
    if (this.tuned && !this.approaches.some(a => a.id === this.tuned.id)) this.tuned = null;
    this.dev = this.tuned ? this.solve(this.tuned, ac) : null;
  }

  /** Nearby airports sorted by distance, for the map and the CDU. */
  nearestAirports(ac, n = 6) {
    const seen = new Map();
    for (const a of this.approaches) {
      const d = Math.hypot(a.airport.x - ac.pos.x, a.airport.z - ac.pos.z);
      if (!seen.has(a.airport.name) || seen.get(a.airport.name).d > d) {
        seen.set(a.airport.name, { ap: a.airport, d });
      }
    }
    return [...seen.values()].sort((p, q) => p.d - q.d).slice(0, n);
  }
}
