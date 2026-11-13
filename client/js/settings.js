// Persistent settings with live-apply subscriptions. Every setting is consumed by gameplay code
// via get()/subscribe(), so changes take effect immediately.
export const FOV_MIN = 60, FOV_MAX = 103;
export const FPS_OPTIONS = [30, 60, 120, 144, 165, 240, 0];   // 0 = unlimited

export const DEFAULTS = {
  fov: 90,
  fpsLimit: 144,
  fullscreen: false,
  quality: 'high',          // low | medium | high
  showFps: true,
  showPing: true,
  sensitivity: 2.0,         // single slider, degrees-per-count = 0.022 * sensitivity
  invertY: false,
  keys: { forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', scoreboard: 'Tab', weapon1: 'Digit1', weapon2: 'Digit2', weapon3: 'Digit3', weapon4: 'Digit4', nextWeapon: 'KeyE', prevWeapon: 'KeyQ' },
  audio: { master: 0.7, sfx: 0.8, weapons: 0.8, music: 0.35, ambient: 0.5, mute: false },
  crosshair: { style: 'cross', size: 12, color: '#00ff99', opacity: 0.9, gap: 4, thickness: 2 },
  hitmarker: true,
  damageIndicators: true,
};

const KEY = 'arena-fps:settings:v1';
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const listeners = new Set();
let data = load();

function merge(base, over) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(base)) {
    if (over && over[k] !== undefined && over[k] !== null) {
      out[k] = (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) ? merge(base[k], over[k]) : over[k];
    }
  }
  return out;
}
function sanitize(s) {
  s.fov = clamp(Math.round(+s.fov) || DEFAULTS.fov, FOV_MIN, FOV_MAX);
  if (!FPS_OPTIONS.includes(+s.fpsLimit)) s.fpsLimit = DEFAULTS.fpsLimit; else s.fpsLimit = +s.fpsLimit;
  if (!['low', 'medium', 'high'].includes(s.quality)) s.quality = 'high';
  s.sensitivity = clamp(+s.sensitivity || DEFAULTS.sensitivity, 0.1, 10);
  for (const k of Object.keys(DEFAULTS.audio)) if (k !== 'mute') s.audio[k] = clamp(+s.audio[k], 0, 1);
  s.crosshair.size = clamp(+s.crosshair.size || 12, 2, 40);
  s.crosshair.opacity = clamp(+s.crosshair.opacity, 0.1, 1);
  s.crosshair.gap = clamp(+s.crosshair.gap, 0, 20);
  s.crosshair.thickness = clamp(+s.crosshair.thickness || 2, 1, 6);
  if (!/^#[0-9a-f]{6}$/i.test(s.crosshair.color)) s.crosshair.color = DEFAULTS.crosshair.color;
  return s;
}
function load() {
  try { return sanitize(merge(DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}'))); }
  catch { return sanitize(merge(DEFAULTS, {})); }
}
function persist() { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* storage unavailable */ } }

export const settings = {
  get all() { return data; },
  /** set('crosshair.size', 14) */
  set(path, value) {
    const parts = path.split('.'); let o = data;
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
    o[parts.at(-1)] = value;
    data = sanitize(data); persist();
    listeners.forEach(fn => fn(data, path));
  },
  reset() { data = sanitize(merge(DEFAULTS, {})); persist(); listeners.forEach(fn => fn(data, '*')); },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};

export const KEY_LABELS = {
  forward: 'Move forward', back: 'Move back', left: 'Strafe left', right: 'Strafe right', jump: 'Jump', scoreboard: 'Scoreboard',
  weapon1: 'Weapon 1', weapon2: 'Weapon 2', weapon3: 'Weapon 3', weapon4: 'Weapon 4', nextWeapon: 'Next weapon', prevWeapon: 'Previous weapon',
};
export const keyName = code => code.replace('Key', '').replace('Digit', '').replace('Arrow', '↔ ').replace('Space', 'Space');
