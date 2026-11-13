// All audio is synthesised with WebAudio (no asset downloads). Bus volumes follow settings live.
import { settings } from './settings.js';

let ctx, master, buses = {}, noiseBuf, musicTimer, ambientNodes = [];

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
  ctx = new AC(); master = ctx.createGain(); master.connect(ctx.destination);
  for (const b of ['sfx', 'weapons', 'music', 'ambient']) { buses[b] = ctx.createGain(); buses[b].connect(master); }
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  applyVolumes();
  return ctx;
}
function applyVolumes() {
  if (!ctx) return;
  const a = settings.all.audio, t = ctx.currentTime;
  master.gain.setTargetAtTime(a.mute ? 0 : a.master, t, 0.02);
  buses.sfx.gain.setTargetAtTime(a.sfx, t, 0.02); buses.weapons.gain.setTargetAtTime(a.weapons, t, 0.02);
  buses.music.gain.setTargetAtTime(a.music * 0.5, t, 0.05); buses.ambient.gain.setTargetAtTime(a.ambient * 0.5, t, 0.05);
}
settings.subscribe(applyVolumes);

export function unlock() { const c = ensure(); if (c && c.state === 'suspended') c.resume(); }

function tone(bus, { f0, f1 = f0, dur = 0.15, type = 'sine', vol = 0.3, delay = 0 }) {
  if (!ensure()) return; const t = ctx.currentTime + delay;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(buses[bus]); o.start(t); o.stop(t + dur + 0.02);
}
function noise(bus, { dur = 0.15, vol = 0.3, freq = 1200, q = 0.7, type = 'bandpass', delay = 0, sweepTo }) {
  if (!ensure()) return; const t = ctx.currentTime + delay;
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(buses[bus]); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
}

// pan/volume by distance for remote sounds (simple attenuation)
export const sfx = {
  shot(weapon, gain = 1) {
    const v = gain;
    if (weapon === 'pistol') { noise('weapons', { dur: 0.12, vol: 0.5 * v, freq: 2200, sweepTo: 500 }); tone('weapons', { f0: 320, f1: 90, dur: 0.1, type: 'square', vol: 0.2 * v }); }
    else if (weapon === 'machinegun') { noise('weapons', { dur: 0.08, vol: 0.4 * v, freq: 3000, sweepTo: 800 }); tone('weapons', { f0: 220, f1: 80, dur: 0.06, type: 'sawtooth', vol: 0.15 * v }); }
    else if (weapon === 'shotgun') { noise('weapons', { dur: 0.35, vol: 0.8 * v, freq: 1400, sweepTo: 150, q: 0.5 }); tone('weapons', { f0: 140, f1: 40, dur: 0.25, type: 'square', vol: 0.3 * v }); noise('weapons', { dur: 0.1, vol: 0.3 * v, freq: 900, delay: 0.38 }); }
    else if (weapon === 'railgun') { tone('weapons', { f0: 1800, f1: 120, dur: 0.5, type: 'sawtooth', vol: 0.25 * v }); noise('weapons', { dur: 0.3, vol: 0.4 * v, freq: 5000, sweepTo: 300 }); }
  },
  dryFire() { tone('sfx', { f0: 900, f1: 700, dur: 0.04, type: 'square', vol: 0.08 }); },
  switchWeapon() { tone('sfx', { f0: 400, f1: 700, dur: 0.07, type: 'triangle', vol: 0.15 }); noise('sfx', { dur: 0.05, vol: 0.1, freq: 3000 }); },
  jump() { tone('sfx', { f0: 180, f1: 320, dur: 0.1, type: 'sine', vol: 0.12 }); },
  land() { noise('sfx', { dur: 0.1, vol: 0.2, freq: 300, type: 'lowpass' }); },
  hit(head) { tone('sfx', { f0: head ? 1800 : 1200, f1: head ? 2400 : 1500, dur: 0.06, type: 'sine', vol: 0.3 }); },
  kill() { tone('sfx', { f0: 600, f1: 600, dur: 0.1, type: 'triangle', vol: 0.3 }); tone('sfx', { f0: 900, f1: 900, dur: 0.15, type: 'triangle', vol: 0.3, delay: 0.09 }); },
  hurt() { tone('sfx', { f0: 140, f1: 70, dur: 0.18, type: 'sawtooth', vol: 0.3 }); noise('sfx', { dur: 0.12, vol: 0.2, freq: 500 }); },
  death() { tone('sfx', { f0: 300, f1: 40, dur: 0.7, type: 'sawtooth', vol: 0.3 }); },
  pickup() { tone('sfx', { f0: 500, f1: 1000, dur: 0.12, type: 'sine', vol: 0.25 }); },
  spawn() { tone('sfx', { f0: 200, f1: 800, dur: 0.3, type: 'triangle', vol: 0.2 }); },
  tick() { tone('sfx', { f0: 800, f1: 800, dur: 0.05, type: 'square', vol: 0.12 }); },
  go() { tone('sfx', { f0: 1000, f1: 1000, dur: 0.35, type: 'square', vol: 0.2 }); },
  click() { tone('sfx', { f0: 1200, f1: 900, dur: 0.03, type: 'square', vol: 0.06 }); },
};

export function startAmbient() {
  if (!ensure() || ambientNodes.length) return;
  const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
  const g = ctx.createGain(); g.gain.value = 0.35;
  const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.12; lg.gain.value = 90; lfo.connect(lg).connect(lp.frequency);
  const hum = ctx.createOscillator(); hum.type = 'sine'; hum.frequency.value = 55; const hg = ctx.createGain(); hg.gain.value = 0.12;
  src.connect(lp).connect(g).connect(buses.ambient); hum.connect(hg).connect(buses.ambient);
  src.start(); lfo.start(); hum.start(); ambientNodes = [src, lfo, hum];
}
export function stopAmbient() { ambientNodes.forEach(n => { try { n.stop(); } catch { /* already stopped */ } }); ambientNodes = []; }

// Simple generative music: slow minor arpeggio over a bass pulse.
export function startMusic() {
  if (!ensure() || musicTimer) return;
  const scale = [0, 3, 7, 10, 12, 15, 19, 22]; const root = 110; let step = 0;
  musicTimer = setInterval(() => {
    if (!ctx || ctx.state !== 'running') return;
    const n = scale[(step * 3 + (step >> 3)) % scale.length];
    tone('music', { f0: root * 2 ** (n / 12) * 2, dur: 0.22, type: 'triangle', vol: 0.18 });
    if (step % 4 === 0) tone('music', { f0: root / 2 * (step % 16 === 8 ? 1.19 : 1), dur: 0.45, type: 'sawtooth', vol: 0.12 });
    if (step % 2 === 0) noise('music', { dur: 0.04, vol: 0.05, freq: 6000, type: 'highpass' });
    step++;
  }, 230);
}
export function stopMusic() { clearInterval(musicTimer); musicTimer = null; }
