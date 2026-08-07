import * as THREE from 'three';
import { terrainHeight, terrainNormal } from './terrainCommon.js';
import { snoise } from './noise.js';

export const KT = 0.514444;      // knots -> m/s
export const FT = 0.3048;

// --- ISA atmosphere ---------------------------------------------------------
export function isa(alt) {
  let T, p;
  if (alt < 11000) {
    T = 288.15 - 0.0065 * alt;
    p = 101325 * Math.pow(T / 288.15, 5.25588);
  } else {
    T = 216.65;
    p = 22632.1 * Math.exp(-9.80665 * (alt - 11000) / (287.053 * T));
  }
  const rho = p / (287.053 * T);
  const a = Math.sqrt(1.4 * 287.053 * T);
  return { T, p, rho, a };
}

// --- 737-800 class parameters ----------------------------------------------
const S = 124.6;          // wing area, m^2
const B = 34.32;          // span, m
const CBAR = 4.17;        // mean aerodynamic chord, m
const OEW = 41400;        // operating empty weight, kg
const PAYLOAD = 14500;
const FUEL_CAP = 20800;

const IXX = 2.4e6, IYY = 4.6e6, IZZ = 6.4e6;

const T_MAX_ENG = 117000; // N, static sea level, per engine
const N_ENG = 2;

export const FLAP_SETTINGS = [0, 1, 5, 10, 15, 25, 30, 40];
const FLAP_DCL = [0, 0.18, 0.42, 0.62, 0.80, 1.05, 1.22, 1.40];
const FLAP_DCD = [0, 0.005, 0.013, 0.021, 0.031, 0.055, 0.072, 0.098];
const FLAP_DCM = [0, -0.02, -0.05, -0.075, -0.095, -0.13, -0.15, -0.175];
const FLAP_DASTALL = [0, 1.0, 2.0, 2.8, 3.4, 4.4, 5.0, 5.6]; // deg of stall alpha lost

// contact points, body frame (x right, y up, z aft; nose points -z)
const GEAR = [
  { r: new THREE.Vector3(0, -3.05, -11.6), k: 6.5e5, c: 9.0e4, brake: 0.0, steer: true, main: false },
  { r: new THREE.Vector3(-3.9, -3.15, 1.3), k: 1.35e6, c: 1.8e5, brake: 1.0, steer: false, main: true },
  { r: new THREE.Vector3(3.9, -3.15, 1.3), k: 1.35e6, c: 1.8e5, brake: 1.0, steer: false, main: true },
];
const BELLY = [
  { r: new THREE.Vector3(0, -2.0, -8), k: 9e5, c: 2.2e5 },
  { r: new THREE.Vector3(0, -2.0, 4), k: 9e5, c: 2.2e5 },
  { r: new THREE.Vector3(0, -1.0, 17), k: 6e5, c: 1.5e5 },
];

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function approach(cur, target, rate, dt) {
  const d = target - cur;
  const m = rate * dt;
  return Math.abs(d) <= m ? target : cur + Math.sign(d) * m;
}

export class Aircraft {
  constructor() {
    this.pos = new THREE.Vector3(0, 2000, 0);
    this.vel = new THREE.Vector3(0, 0, -120);
    this.quat = new THREE.Quaternion();
    this.omega = new THREE.Vector3();       // body-frame rad/s

    this.fuel = 12000;
    this.mass = OEW + PAYLOAD + this.fuel;

    // controls (-1..1)
    this.elevator = 0; this.aileron = 0; this.rudder = 0;
    this.elevTrim = 0.0;
    this.throttle = 0.0;
    this.n1 = [20, 20];
    this.flapIndex = 0;
    this.flapPos = 0;              // 0..1 fraction of flapIndex travel
    this.flapActual = 0;           // in degrees
    this.gearDown = true;
    this.gearPos = 1;              // 0 up .. 1 down
    this.spoilers = 0; this.spoilerCmd = 0;
    this.brake = 0;
    this.parkBrake = false;
    this.reverse = 0;

    // derived / telemetry
    this.alpha = 0; this.beta = 0; this.ias = 0; this.tas = 0; this.mach = 0;
    this.agl = 0; this.gLoad = 1; this.vs = 0; this.onGround = false;
    this.gearForce = [0, 0, 0];
    this.stallWarn = false; this.overspeed = false;
    this.crashed = false; this.touchdownVS = 0;
    this._wasOnGround = true;

    this.wind = new THREE.Vector3();
    this.windTarget = new THREE.Vector3();
    this.turbulence = 0.25;

    this.ap = {
      on: false, hdgHold: false, altHold: false, spdHold: false,
      hdg: 0, alt: 3000, spd: 250, vsLimit: 12,
      _iSpd: 0, _iAlt: 0,
    };

    this._tmp = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._t = 0;
  }

  get grossMass() { return OEW + PAYLOAD + this.fuel; }

  placeOnRunway(ap) {
    const dir = new THREE.Vector3(Math.sin(ap.hdg), 0, -Math.cos(ap.hdg));
    this.pos.set(ap.x - dir.x * 1200, ap.elev + 3.2, ap.z - dir.z * 1200);
    this.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -ap.hdg);
    this.vel.set(0, 0, 0);
    this.omega.set(0, 0, 0);
    this.throttle = 0; this.n1 = [22, 22];
    this.gearDown = true; this.gearPos = 1;
    this.flapIndex = 0; this.flapActual = 0;
    this.parkBrake = true;
    this.resetTransient();
  }

  resetTransient() {
    this.spoilerCmd = 0; this.spoilers = 0;
    this.brake = 0; this.reverse = 0;
    this.elevator = 0; this.aileron = 0; this.rudder = 0; this.elevTrim = 0;
    this.crashed = false;
    this.onGround = false; this._wasOnGround = false; this.touchdownVS = 0;
    this.ap._iAlt = 0; this.ap._iSpd = 0; this.ap._accel = 0; this.ap._lastIas = undefined;
  }

  placeAirborne(ap, distNM = 12, altFt = 6000) {
    const dir = new THREE.Vector3(Math.sin(ap.hdg), 0, -Math.cos(ap.hdg));
    const d = distNM * 1852;
    this.pos.set(ap.x - dir.x * d, ap.elev + altFt * FT, ap.z - dir.z * d);
    this.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -ap.hdg);
    this.vel.copy(dir).multiplyScalar(140);
    this.omega.set(0, 0, 0);
    this.throttle = 0.6; this.n1 = [70, 70];
    this.gearDown = false; this.gearPos = 0;
    this.flapIndex = 0; this.flapActual = 0;
    this.parkBrake = false;
    this.resetTransient();
    this.ap.alt = altFt * FT;
    this.ap.hdg = (ap.hdg * 180 / Math.PI + 360) % 360;
  }

  get headingDeg() {
    const f = this._tmp.set(0, 0, -1).applyQuaternion(this.quat);
    let h = Math.atan2(f.x, -f.z) * 180 / Math.PI;
    return (h + 360) % 360;
  }

  get pitchDeg() {
    const f = this._tmp.set(0, 0, -1).applyQuaternion(this.quat);
    return Math.asin(clamp(f.y, -1, 1)) * 180 / Math.PI;
  }

  get bankDeg() {
    const r = this._tmp.set(1, 0, 0).applyQuaternion(this.quat);
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quat);
    const horizRight = new THREE.Vector3(-f.z, 0, f.x).normalize();
    const up = new THREE.Vector3().crossVectors(horizRight, f).normalize();
    const s = r.dot(up);
    const c = r.dot(horizRight);
    return -Math.atan2(s, c) * 180 / Math.PI;
  }

  setFlapIndex(i) { this.flapIndex = clamp(i, 0, FLAP_SETTINGS.length - 1); }

  updateWind(dt, weatherWind) {
    this._t += dt;
    const strength = weatherWind * 14;
    const dir = 2.1 + snoise(this._t * 0.004, 12.3) * 1.4;
    this.windTarget.set(Math.cos(dir) * strength, 0, Math.sin(dir) * strength);
    this.wind.lerp(this.windTarget, Math.min(dt * 0.15, 1));

    // turbulence: stronger low down, in cloud, and in bad weather
    const turbScale = this.turbulence * (0.4 + weatherWind);
    const t = this._t;
    const gust = (a, b) => snoise(t * a + b, this.pos.y * 0.0007 + b);
    this._gust = this._gust || new THREE.Vector3();
    const lowLevel = 1 + 2.0 * Math.exp(-Math.max(this.agl, 0) / 700);
    this._gust.set(
      gust(0.7, 0) * 3.0, gust(0.55, 40) * 2.4, gust(0.63, 80) * 3.0
    ).multiplyScalar(turbScale * lowLevel);
  }

  step(dt) {
    const g = 9.80665;
    const mass = this.grossMass;

    // --- actuators ---------------------------------------------------------
    const flapTarget = FLAP_SETTINGS[this.flapIndex];
    this.flapActual = approach(this.flapActual, flapTarget, 2.2, dt);
    this.gearPos = approach(this.gearPos, this.gearDown ? 1 : 0, 1 / 9, dt);
    this.spoilers = approach(this.spoilers, this.spoilerCmd, 1.6, dt);

    // engines: first order spool
    const idleN1 = 21 + Math.max(0, this.pos.y) * 0.0006 * 100 * 0.01;
    const cmdN1 = idleN1 + this.throttle * (100 - idleN1);
    for (let i = 0; i < 2; i++) {
      const tau = this.n1[i] < cmdN1 ? 2.6 : 1.6;
      this.n1[i] += (cmdN1 - this.n1[i]) * Math.min(dt / tau, 1);
    }

    // --- air data ----------------------------------------------------------
    const alt = this.pos.y;
    const { rho, a } = isa(Math.max(alt, -500));
    const rho0 = 1.225;

    const airVel = this._tmp.copy(this.vel).sub(this.wind);
    if (this._gust) airVel.sub(this._gust);

    const qInv = this._q.copy(this.quat).invert();
    const vb = airVel.clone().applyQuaternion(qInv);
    const u = -vb.z, vRight = vb.x, wDown = -vb.y;
    const V = vb.length();
    this.tas = V;
    this.ias = V * Math.sqrt(rho / rho0);
    this.mach = V / a;

    const alpha = V > 1 ? Math.atan2(wDown, Math.max(u, 0.1)) : 0;
    const beta = V > 1 ? Math.asin(clamp(vRight / V, -1, 1)) : 0;
    this.alpha = alpha; this.beta = beta;

    const p = -this.omega.z, qq = this.omega.x, r = -this.omega.y;

    // --- terrain / ground --------------------------------------------------
    const groundY = terrainHeight(this.pos.x, this.pos.z);
    this.agl = this.pos.y - groundY;

    // --- aerodynamic coefficients -----------------------------------------
    const fi = this.flapActual / 40;
    const fIdx = FLAP_SETTINGS.findIndex(v => v >= this.flapActual - 1e-6);
    const lo = Math.max(0, fIdx - 1), hi = Math.max(0, fIdx);
    const span = FLAP_SETTINGS[hi] - FLAP_SETTINGS[lo] || 1;
    const fr = clamp((this.flapActual - FLAP_SETTINGS[lo]) / span, 0, 1);
    const lerp = (arr) => arr[lo] + (arr[hi] - arr[lo]) * fr;
    const dCLflap = lerp(FLAP_DCL);
    const dCDflap = lerp(FLAP_DCD);
    const dCmflap = lerp(FLAP_DCM);
    const dAstall = lerp(FLAP_DASTALL);

    const AR = B * B / S;
    const geH = Math.max(this.agl, 0) / B;
    const geInduced = 1 - 0.42 * Math.exp(-4.0 * geH);
    const geLift = 1 + 0.06 * Math.exp(-4.0 * geH);

    const CL0 = 0.22;
    const CLa = 5.35;
    const aStall = (15.6 - dAstall) * Math.PI / 180;
    const CLlin = (CL0 + dCLflap + CLa * alpha) * geLift;
    const CLflat = 2 * Math.sin(alpha) * Math.cos(alpha) * Math.sign(1);
    const sig = 1 / (1 + Math.exp(-26 * (alpha - aStall))) + 1 / (1 + Math.exp(26 * (alpha + aStall)));
    const sigC = clamp(sig, 0, 1);
    let CL = (1 - sigC) * CLlin + sigC * CLflat * 1.05;

    const qhat = V > 1 ? qq * CBAR / (2 * V) : 0;
    const phat = V > 1 ? p * B / (2 * V) : 0;
    const rhat = V > 1 ? r * B / (2 * V) : 0;

    // control inputs use stick sense: +elevator = nose up, +rudder = nose right.
    // Control derivatives are scaled for a unit input meaning full deflection.
    CL += 6.2 * qhat - 0.06 * this.elevator - 0.42 * this.spoilers;

    const e = 0.80;
    const k = 1 / (Math.PI * e * AR);
    let CD = 0.0205 + dCDflap + 0.021 * this.gearPos + 0.052 * this.spoilers;
    CD += k * CL * CL * geInduced;
    // compressibility rise
    if (this.mach > 0.72) CD += 0.045 * Math.pow(this.mach - 0.72, 2) / 0.0016 * 0.001;
    CD += 0.28 * Math.abs(Math.sin(beta)) * Math.abs(Math.sin(beta));

    const CY = -0.92 * beta - 0.080 * this.rudder;

    let Cl = -0.13 * beta - 0.50 * phat + 0.11 * rhat
      + 0.0230 * this.aileron + 0.0060 * this.rudder;
    let Cm = 0.045 + dCmflap - 1.35 * alpha - 24.0 * qhat
      + 0.30 * (this.elevator + this.elevTrim) - 0.05 * this.spoilers;
    let Cn = 0.132 * beta - 0.035 * phat - 0.20 * rhat
      - 0.0028 * this.aileron + 0.045 * this.rudder;

    const qbar = 0.5 * rho * V * V;
    const Lift = qbar * S * CL;
    const Drag = qbar * S * CD;
    const Side = qbar * S * CY;

    // wind-axes -> aero body axes (x fwd, y right, z down)
    const ca = Math.cos(alpha), sa = Math.sin(alpha);
    const cb = Math.cos(beta), sb = Math.sin(beta);
    const Xa = -Drag * ca * cb - Side * ca * sb + Lift * sa;
    const Ya = -Drag * sb + Side * cb;
    const Za = -Drag * sa * cb - Side * sa * sb - Lift * ca;

    // to three.js body axes (x right, y up, z aft)
    const Fb = new THREE.Vector3(Ya, -Za, -Xa);

    // --- thrust ------------------------------------------------------------
    const lapse = Math.pow(rho / rho0, 0.85);
    let thrust = 0;
    for (let i = 0; i < N_ENG; i++) {
      const frac = Math.pow(clamp((this.n1[i] - 20) / 80, 0, 1), 3.0);
      let T = frac * T_MAX_ENG * lapse * (1 - 0.28 * clamp(this.mach, 0, 0.9));
      thrust += T;
    }
    if (this.reverse > 0 && this.onGround) thrust *= -0.42 * this.reverse;
    Fb.z += -thrust;                       // forward is -z
    Fb.y += thrust * 0.030;                // engines below CG -> slight pitch coupling
    const Mb = new THREE.Vector3(
      qbar * S * CBAR * Cm - thrust * 0.9 * 0.001,
      -(qbar * S * B * Cn),
      -(qbar * S * B * Cl)
    );

    this.fuel = Math.max(0, this.fuel - (thrust > 0 ? thrust : 0) * 1.05e-5 * dt);

    // --- gravity -----------------------------------------------------------
    const force = Fb.clone().applyQuaternion(this.quat);
    force.y -= mass * g;

    // --- ground contact ----------------------------------------------------
    let onGround = false;
    const nrm = terrainNormal(this.pos.x, this.pos.z, 6);
    const gN = new THREE.Vector3(nrm.x, nrm.y, nrm.z);
    const omegaWorld = this.omega.clone().applyQuaternion(this.quat);
    const contacts = [];
    if (this.gearPos > 0.75) {
      for (let i = 0; i < GEAR.length; i++) contacts.push({ ...GEAR[i], idx: i, gear: true });
    }
    for (const bp of BELLY) contacts.push({ ...bp, brake: 0.55, steer: false, main: false, gear: false });

    this.gearForce = [0, 0, 0];
    let maxImpact = 0;
    for (const c of contacts) {
      const rw = c.r.clone();
      if (c.gear) rw.y = -3.05 - (c.main ? 0.10 : 0) ;
      rw.copy(c.r).applyQuaternion(this.quat);
      const wp = this.pos.clone().add(rw);
      const gh = terrainHeight(wp.x, wp.z);
      const pen = gh - wp.y;
      if (pen <= 0) continue;
      onGround = true;
      const vPoint = this.vel.clone().add(new THREE.Vector3().crossVectors(omegaWorld, rw));
      const vN = vPoint.dot(gN);
      let N = c.k * pen - c.c * vN;
      if (N < 0) N = 0;
      N = Math.min(N, mass * g * 9);
      maxImpact = Math.max(maxImpact, -vN);
      if (c.gear) this.gearForce[c.idx] = N;

      const Fn = gN.clone().multiplyScalar(N);

      // friction basis
      let fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.quat);
      if (c.steer) {
        const steerAng = -this.rudder * (Math.abs(u) < 12 ? 0.52 : 0.12);
        fwd.applyAxisAngle(gN, steerAng);
      }
      fwd.sub(gN.clone().multiplyScalar(fwd.dot(gN)));
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
      fwd.normalize();
      const lat = new THREE.Vector3().crossVectors(gN, fwd).normalize();

      const vT = vPoint.clone().sub(gN.clone().multiplyScalar(vN));
      const vRoll = vT.dot(fwd), vLat = vT.dot(lat);

      const brakeMu = this.parkBrake ? 0.55 : this.brake * 0.48 * c.brake;
      const muRoll = c.gear ? (0.018 + brakeMu) : 0.55;
      const muLat = c.gear ? 0.85 : 0.85;

      // Tyres are stiff: full cornering force develops within a fraction of a
      // m/s of slip, so the aircraft tracks the centreline instead of drifting.
      const Froll = -clamp(vRoll * 60000, -muRoll * N, muRoll * N);
      const Flat = -clamp(vLat * 200000, -muLat * N, muLat * N);
      const Ff = fwd.clone().multiplyScalar(Froll).add(lat.clone().multiplyScalar(Flat));

      const Ftot = Fn.add(Ff);
      force.add(Ftot);
      const torqueW = new THREE.Vector3().crossVectors(rw, Ftot);
      Mb.add(torqueW.applyQuaternion(this._q.copy(this.quat).invert()));
    }

    if (onGround && !this._wasOnGround) this.touchdownVS = this.vs;
    if (!onGround && this._wasOnGround) this.touchdownVS = 0;
    this._wasOnGround = onGround;
    this.onGround = onGround;
    if (maxImpact > 8.5) this.crashed = true;

    // --- integrate ---------------------------------------------------------
    const acc = force.divideScalar(mass);
    this.gLoad = 1 + (acc.clone().add(new THREE.Vector3(0, g, 0)))
      .applyQuaternion(this._q.copy(this.quat).invert()).y / g - 1;
    const bodyAcc = acc.clone().add(new THREE.Vector3(0, g, 0))
      .applyQuaternion(this._q.copy(this.quat).invert());
    this.gLoad = bodyAcc.y / g;

    this.vel.addScaledVector(acc, dt);
    this.pos.addScaledVector(this.vel, dt);
    this.vs = this.vel.y;

    // angular: I * omegaDot = M - omega x (I*omega)
    const Iw = new THREE.Vector3(IXX * this.omega.x, IYY * this.omega.y, IZZ * this.omega.z);
    const gyro = new THREE.Vector3().crossVectors(this.omega, Iw);
    const domega = new THREE.Vector3(
      (Mb.x - gyro.x) / IXX, (Mb.y - gyro.y) / IYY, (Mb.z - gyro.z) / IZZ
    );
    this.omega.addScaledVector(domega, dt);
    this.omega.multiplyScalar(1 - Math.min(dt * 0.02, 0.5));

    const dq = new THREE.Quaternion(
      this.omega.x * dt * 0.5, this.omega.y * dt * 0.5, this.omega.z * dt * 0.5, 1
    );
    this.quat.multiply(dq).normalize();

    // hard floor so we never fall through the world
    if (this.pos.y < groundY - 40) {
      this.pos.y = groundY - 40;
      if (this.vel.y < 0) this.vel.y = 0;
      this.crashed = true;
    }

    const vs1g = this.stallSpeed();
    this.stallWarn = !onGround && V > 5 && (alpha > aStall * 0.92 || this.ias < vs1g * 1.03);
    this.overspeed = this.ias > 340 * KT || this.mach > 0.86;
  }

  stallSpeed() {
    const { rho } = isa(Math.max(this.pos.y, 0));
    const fIdx = this.flapIndex;
    const CLmax = 1.45 + FLAP_DCL[fIdx] * 0.92;
    const V = Math.sqrt(2 * this.grossMass * 9.80665 / (rho * S * CLmax));
    return V * Math.sqrt(rho / 1.225);   // as IAS
  }

  // --- autopilot ------------------------------------------------------------
  runAutopilot(dt) {
    const A = this.ap;
    if (!A.on) return;
    const bank = this.bankDeg, pitch = this.pitchDeg;

    if (A.hdgHold) {
      let err = ((A.hdg - this.headingDeg + 540) % 360) - 180;
      // shallow the bank when speed is marginal
      const margin = clamp((this.ias / (this.stallSpeed() * 1.35) - 1) * 3, 0.25, 1);
      const bankCmd = clamp(err * 1.35, -27, 27) * margin;
      const bankErr = bankCmd - bank;
      const rollRate = -this.omega.z * 180 / Math.PI;
      this.aileron = clamp(bankErr * 0.16 - rollRate * 0.30, -0.9, 0.9);
      // coordinate the turn: rudder yaws the nose toward the flight path
      this.rudder = clamp(this.beta * 9.0, -0.5, 0.5);
    }

    if (A.altHold) {
      const altErr = A.alt - this.pos.y;
      const vsCmd = clamp(altErr * 0.10, -A.vsLimit, A.vsLimit);
      const vsErr = vsCmd - this.vs;
      let pitchCmd = clamp(pitch + vsErr * 0.55, -12, 17);
      // envelope protection: never trade away more speed than we can spare
      const vFloor = this.stallSpeed() * 1.28;
      if (this.ias < vFloor) pitchCmd = Math.min(pitchCmd, pitch - (vFloor - this.ias) * 1.4);
      pitchCmd = clamp(pitchCmd, -14, 17);
      const pitchErr = pitchCmd - pitch;
      const pitchRate = this.omega.x * 180 / Math.PI;
      A._iAlt = clamp(A._iAlt + pitchErr * dt * 0.06, -0.6, 0.6);
      this.elevator = clamp(pitchErr * 0.10 + A._iAlt - pitchRate * 0.16, -0.95, 0.95);
      // hold the nose up through the bank
      this.elevator += Math.abs(bank) / 30 * 0.08;
    }

    if (A.spdHold) {
      const err = A.spd * KT - this.ias;
      A._iSpd = clamp(A._iSpd + err * dt * 0.010, -0.6, 0.6);
      A._accel = (A._accel ?? 0) * 0.97 + (this.ias - (A._lastIas ?? this.ias)) * 0.03 / Math.max(dt, 1e-3);
      A._lastIas = this.ias;
      this.throttle = clamp(0.5 + err * 0.030 + A._iSpd - A._accel * 0.35, 0, 1);
    }
  }
}
