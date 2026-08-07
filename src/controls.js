import { KT, FLAP_SETTINGS } from './aircraft.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Controls {
  constructor(canvas, actions) {
    this.keys = new Set();
    this.actions = actions;
    this.mouseYoke = false;
    this.invertPitch = false;
    this.mouse = { x: 0, y: 0, look: false, lookX: 0, lookY: 0 };
    this.pitchCmd = 0; this.rollCmd = 0; this.yawCmd = 0;
    this.canvas = canvas;

    const tapped = new Set([
      'KeyG', 'KeyV', 'KeyC', 'KeyH', 'KeyM', 'KeyZ', 'KeyX', 'KeyP',
      'BracketLeft', 'BracketRight', 'Space', 'Enter', 'Backspace',
      'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8',
    ]);

    window.addEventListener('keydown', (e) => {
      if (e.target && /input|select|textarea/i.test(e.target.tagName)) return;
      if (!e.repeat && tapped.has(e.code)) this.onTap(e.code, e);
      this.keys.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(e.code)) e.preventDefault();
      if (e.code === 'Backspace') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 2 || (e.button === 0 && !this.mouseYoke)) {
        this.mouse.look = true;
        this._lx = e.clientX; this._ly = e.clientY;
      }
    });
    window.addEventListener('mouseup', () => { this.mouse.look = false; });
    window.addEventListener('mousemove', (e) => {
      if (this.mouse.look) {
        this.mouse.lookX = clamp(this.mouse.lookX + (e.clientX - this._lx) * 0.004, -Math.PI, Math.PI);
        this.mouse.lookY = clamp(this.mouse.lookY - (e.clientY - this._ly) * 0.004, -1.2, 1.2);
        this._lx = e.clientX; this._ly = e.clientY;
      }
      const r = canvas.getBoundingClientRect();
      this.mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.mouse.y = ((e.clientY - r.top) / r.height) * 2 - 1;
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.actions.throttleDelta(-Math.sign(e.deltaY) * 0.045);
    }, { passive: false });
  }

  onTap(code, e) {
    const A = this.actions;
    switch (code) {
      case 'KeyG': A.toggleGear(); break;
      case 'KeyV': A.toggleParkBrake(); break;
      case 'KeyC': A.cycleCamera(); break;
      case 'KeyH': A.toggleHelp(); break;
      case 'KeyM': this.mouseYoke = !this.mouseYoke; A.notify(this.mouseYoke ? 'Mouse yoke ON' : 'Mouse yoke OFF'); break;
      case 'KeyZ': A.mapRange(-1); break;
      case 'KeyX': A.mapRange(1); break;
      case 'KeyP': A.togglePause(); break;
      case 'BracketLeft': A.flaps(-1); break;
      case 'BracketRight': A.flaps(1); break;
      case 'Space': A.toggleSpoilers(); break;
      case 'Enter': A.resetRunway(); break;
      case 'Backspace': A.resetApproach(); break;
      case 'Digit1': A.ap('master'); break;
      case 'Digit2': A.ap('hdg'); break;
      case 'Digit3': A.ap('alt'); break;
      case 'Digit4': A.ap('spd'); break;
      case 'Digit5': case 'Digit6': case 'Digit7': case 'Digit8':
        A.setCamera(+code.slice(5) - 5); break;
    }
  }

  gamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  update(dt, ac) {
    const k = this.keys;
    const held = (...c) => c.some(x => k.has(x));
    const dz = (v, d = 0.09) => (Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d));

    let pitchIn = 0, rollIn = 0, yawIn = 0;
    if (held('ArrowDown', 'KeyS')) pitchIn += 1;
    if (held('ArrowUp', 'KeyW')) pitchIn -= 1;
    if (held('ArrowRight', 'KeyD')) rollIn += 1;
    if (held('ArrowLeft', 'KeyA')) rollIn -= 1;
    if (held('KeyE')) yawIn += 1;
    if (held('KeyQ')) yawIn -= 1;
    if (this.invertPitch) pitchIn = -pitchIn;

    const pad = this.gamepad();
    if (pad) {
      rollIn = clamp(rollIn + dz(pad.axes[0] || 0), -1, 1);
      pitchIn = clamp(pitchIn - dz(pad.axes[1] || 0), -1, 1);
      yawIn = clamp(yawIn + dz(pad.axes[2] || 0), -1, 1);
      const thr = pad.axes[3];
      if (thr !== undefined) this.actions.setThrottle(clamp((1 - thr) / 2, 0, 1));
      if (pad.buttons[0] && pad.buttons[0].pressed) ac.brake = 1;
    }

    if (this.mouseYoke) {
      rollIn = clamp(rollIn + this.mouse.x * 1.6, -1, 1);
      pitchIn = clamp(pitchIn - this.mouse.y * 1.4 * (this.invertPitch ? -1 : 1), -1, 1);
    }

    // rate-limited, self-centring yoke feel
    const toward = (cur, tgt, up, down) => {
      const rate = tgt === 0 ? down : up;
      const d = tgt - cur;
      return Math.abs(d) < rate * dt ? tgt : cur + Math.sign(d) * rate * dt;
    };
    this.pitchCmd = toward(this.pitchCmd, pitchIn, 2.0, 2.8);
    this.rollCmd = toward(this.rollCmd, rollIn, 3.2, 4.2);
    this.yawCmd = toward(this.yawCmd, yawIn, 2.6, 3.4);

    // gain schedule: less deflection needed as dynamic pressure rises
    const kt = ac.ias / KT;
    const gain = clamp(0.30 + 0.70 * (170 / Math.max(kt, 60)), 0.30, 1.0);

    if (!(ac.ap.on && ac.ap.altHold)) ac.elevator = clamp(this.pitchCmd * gain, -1, 1);
    if (!(ac.ap.on && ac.ap.hdgHold)) {
      ac.aileron = clamp(this.rollCmd * gain, -1, 1);
      ac.rudder = clamp(this.yawCmd * (ac.onGround ? 1 : gain), -1, 1);
    } else {
      ac.rudder = clamp(ac.rudder + this.yawCmd * 0.3, -1, 1);
    }

    if (!(ac.ap.on && ac.ap.spdHold)) {
      if (held('ShiftLeft', 'ShiftRight', 'PageUp')) this.actions.throttleDelta(0.42 * dt);
      if (held('ControlLeft', 'ControlRight', 'PageDown')) this.actions.throttleDelta(-0.42 * dt);
    }
    if (held('Comma')) ac.elevTrim = clamp(ac.elevTrim - 0.09 * dt, -0.5, 0.5);
    if (held('Period')) ac.elevTrim = clamp(ac.elevTrim + 0.09 * dt, -0.5, 0.5);

    ac.brake = held('KeyB') ? 1 : (pad && pad.buttons[0] && pad.buttons[0].pressed ? 1 : 0);
    ac.reverse = held('KeyR') ? 1 : 0;
  }
}

export const HELP_ROWS = [
  ['Pitch', '↓ / ↑  or  S / W', 'pull back = nose up'],
  ['Roll', '← / →  or  A / D', ''],
  ['Rudder', 'Q / E', 'also steers the nosewheel'],
  ['Throttle', 'Shift / Ctrl', 'or mouse wheel'],
  ['Flaps', '[  /  ]', FLAP_SETTINGS.join(' · ')],
  ['Gear', 'G', ''],
  ['Wheel brakes', 'B (hold)', ''],
  ['Parking brake', 'V', ''],
  ['Speedbrake', 'Space', ''],
  ['Reversers', 'R (hold, on ground)', ''],
  ['Pitch trim', ', / .', ''],
  ['Autopilot', '1 master · 2 HDG · 3 ALT · 4 SPD', ''],
  ['Camera', 'C or 5–8', 'cockpit · chase · wing · tower'],
  ['Look around', 'drag with the mouse', ''],
  ['Mouse yoke', 'M', ''],
  ['Map range', 'Z / X', ''],
  ['Reset on runway', 'Enter', ''],
  ['Reset on approach', 'Backspace', ''],
  ['Pause', 'P', ''],
  ['Help', 'H', ''],
];
