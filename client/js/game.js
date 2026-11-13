// Match runtime: input -> fixed-rate prediction -> network; snapshots -> interpolation -> render.
// Simulation + networking run on their own 60 Hz timer; the render loop (with FPS limiter) only draws.
import * as THREE from 'three';
import { DT, TICK_RATE, INTERP_TICKS, PLAYER } from '../shared/constants.js';
import { MAPS } from '../shared/maps.js';
import { WEAPONS } from '../shared/weapons.js';
import { stepPlayer, newMoveState } from '../shared/sim.js';
import { settings } from './settings.js';
import { net } from './net.js';
import { World } from './world.js';
import { ViewModel } from './viewmodel.js';
import { buildCharacter } from './character.js';
import { sfx, startAmbient, stopAmbient, startMusic, stopMusic, unlock } from './audio.js';

const TWO_PI = Math.PI * 2;
const angLerp = (a, b, t) => { let d = ((b - a + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI; return a + d * t; };

function makeNameTag(name) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d');
  g.font = 'bold 34px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.8)'; g.strokeText(name, 128, 32); g.fillStyle = '#fff'; g.fillText(name, 128, 32);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false }));
  s.scale.set(1.6, 0.4, 1); s.position.y = 2.15; s.renderOrder = 20; return s;
}

export class Game {
  constructor(canvas, hud) {
    this.canvas = canvas; this.hud = hud;
    this.world = new World(canvas);
    this.view = new ViewModel(this.world.camera);
    this.running = false; this.locked = false;
    this.keys = new Set(); this.mouseDown = false; this.fireEdge = false;
    this.remote = new Map();     // id -> { group, tag, name }
    this.unsubs = [];
    this.fps = { frames: 0, last: performance.now(), value: 0 };
    this._onResize = () => this.world.resize();
    addEventListener('resize', this._onResize);
  }

  // ---------- lifecycle ----------
  start(info, roomInfo) {
    this.stop();
    this.myId = info.you; this.settings = info.settings; this.map = MAPS[info.map]; this.rules = info.settings.rules;
    this.allowed = info.settings.weapons;
    this.world.loadMap(this.map); this.world.setFov(settings.all.fov); this.world.setQuality(settings.all.quality);
    this.players = new Map(roomInfo.players.map(p => [p.id, p]));
    this.cur = newMoveState(); this.prev = { ...this.cur }; this.errOff = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0; this.seq = 0; this.pending = []; this.shotsPending = [];
    this.selected = this.allowed.includes('pistol') ? 'pistol' : this.allowed[0]; this.localCd = 0;
    this.alive = false; this.hp = 0; this.ammo = {}; this.respawnNonce = -1; this.prot = 0;
    this.snaps = []; this.lastSnap = null; this.serverState = 'countdown'; this.timeLeft = info.settings.duration; this.cd = 3;
    this.board = []; this.killFeed = []; this.hitFlash = 0; this.shake = 0; this.deathT = 0; this.wasGround = true;
    this.acc = 0; this.lastTick = performance.now(); this.renderLast = 0; this.time = 0; this.lastFrame = performance.now();
    this.running = true;
    this.view.setWeapon(this.selected);
    this.bind();
    this.unsubs.push(net.on('snap', s => this.onSnap(s)), net.on('ev', e => this.onEvents(e)));
    this.unsubs.push(settings.subscribe((s, path) => this.onSetting(s, path)));
    this.onSetting(settings.all, '*');
    this.simTimer = setInterval(() => this.simLoop(), 4);   // not tied to rendering
    this.raf = requestAnimationFrame(t => this.renderLoop(t));
    startAmbient(); startMusic();
    this.hud.onStart?.();
  }
  stop() {
    if (!this.running) return; this.running = false;
    clearInterval(this.simTimer); cancelAnimationFrame(this.raf);
    this.unbind(); this.unsubs.forEach(u => u()); this.unsubs = [];
    for (const r of this.remote.values()) this.world.scene.remove(r.group); this.remote.clear();
    if (document.pointerLockElement) document.exitPointerLock();
    stopAmbient(); stopMusic();
  }
  onSetting(s, path) {
    this.world.setFov(s.fov); this.world.setQuality(s.quality);
    this.hud.applySettings?.(s);
    if (path === 'fullscreen' || path === '*') this.applyFullscreen(s.fullscreen);
  }
  applyFullscreen(on) {
    const fs = !!document.fullscreenElement;
    if (on && !fs) document.documentElement.requestFullscreen?.().catch(() => {});
    else if (!on && fs) document.exitFullscreen?.().catch(() => {});
  }

  // ---------- input ----------
  bind() {
    this._kd = e => this.onKey(e, true); this._ku = e => this.onKey(e, false);
    this._mm = e => this.onMouseMove(e);
    this._md = e => { if (!this.locked) return; if (e.button === 0) { this.mouseDown = true; this.fireEdge = true; } };
    this._mu = e => { if (e.button === 0) this.mouseDown = false; };
    this._wh = e => { if (this.locked) this.cycleWeapon(e.deltaY > 0 ? 1 : -1); };
    this._pl = () => { this.locked = document.pointerLockElement === this.canvas; if (!this.locked) { this.mouseDown = false; this.keys.clear(); } this.hud.onLockChange?.(this.locked); };
    this._blur = () => { this.keys.clear(); this.mouseDown = false; };
    addEventListener('keydown', this._kd); addEventListener('keyup', this._ku); addEventListener('mousemove', this._mm);
    addEventListener('mousedown', this._md); addEventListener('mouseup', this._mu); addEventListener('wheel', this._wh, { passive: true });
    document.addEventListener('pointerlockchange', this._pl); addEventListener('blur', this._blur);
    addEventListener('contextmenu', this._cm = e => { if (this.running) e.preventDefault(); });
  }
  unbind() {
    removeEventListener('keydown', this._kd); removeEventListener('keyup', this._ku); removeEventListener('mousemove', this._mm);
    removeEventListener('mousedown', this._md); removeEventListener('mouseup', this._mu); removeEventListener('wheel', this._wh);
    document.removeEventListener('pointerlockchange', this._pl); removeEventListener('blur', this._blur); removeEventListener('contextmenu', this._cm);
  }
  lock() { unlock(); this.canvas.requestPointerLock?.(); if (settings.all.fullscreen) this.applyFullscreen(true); }

  onKey(e, down) {
    const k = settings.all.keys;
    if (down && e.code === k.scoreboard) e.preventDefault();
    if (!this.locked) return;
    if (e.repeat) return;
    if (down) this.keys.add(e.code); else this.keys.delete(e.code);
    if (down) {
      if (e.code === k.scoreboard || e.code === 'Space') e.preventDefault();
      const slots = [k.weapon1, k.weapon2, k.weapon3, k.weapon4];
      const si = slots.indexOf(e.code);
      if (si >= 0) { const id = Object.values(WEAPONS).find(w => w.slot === si + 1 && this.allowed.includes(w.id)); if (id) this.selectWeapon(id.id); }
      else if (e.code === k.nextWeapon) this.cycleWeapon(1); else if (e.code === k.prevWeapon) this.cycleWeapon(-1);
    }
    this.hud.onScoreboard?.(this.keys.has(k.scoreboard));
  }
  onMouseMove(e) {
    if (!this.locked) return;
    const s = settings.all, k = 0.022 * s.sensitivity * Math.PI / 180;   // single linear sensitivity, applied directly
    this.yaw -= e.movementX * k;
    this.pitch -= e.movementY * k * (s.invertY ? -1 : 1);
    this.pitch = Math.max(-1.5533, Math.min(1.5533, this.pitch));
  }
  selectWeapon(id) { if (id === this.selected || !this.allowed.includes(id)) return; this.selected = id; this.view.setWeapon(id); this.localCd = Math.max(this.localCd, 12); sfx.switchWeapon(); }
  cycleWeapon(dir) {
    const order = Object.values(WEAPONS).filter(w => this.allowed.includes(w.id)).sort((a, b) => a.slot - b.slot).map(w => w.id);
    const i = order.indexOf(this.selected); this.selectWeapon(order[(i + dir + order.length) % order.length]);
  }

  // ---------- fixed-rate simulation + networking ----------
  simLoop() {
    const now = performance.now(); this.acc += Math.min(now - this.lastTick, 250); this.lastTick = now;
    const step = 1000 / TICK_RATE;
    while (this.acc >= step) { this.acc -= step; this.tickOnce(); }
  }
  tickOnce() {
    if (this.serverState === 'lobby') return;
    if (this.localCd > 0) this.localCd--;
    const k = settings.all.keys, K = this.keys;
    const frozen = this.serverState === 'countdown';
    const cmd = {
      seq: ++this.seq, f: (K.has(k.forward) ? 1 : 0) - (K.has(k.back) ? 1 : 0), r: (K.has(k.right) ? 1 : 0) - (K.has(k.left) ? 1 : 0),
      j: K.has(k.jump), yaw: this.yaw, pitch: this.pitch, w: this.selected, vt: this.renderTick ?? -1,
    };
    const w = WEAPONS[this.selected];
    const wantFire = this.locked && !frozen && (w.auto ? this.mouseDown : this.fireEdge);
    this.fireEdge = false; cmd.fire = !!wantFire;
    if (frozen) { cmd.f = cmd.r = 0; cmd.j = false; }
    if (!this.alive) { net.input({ ...cmd, f: 0, r: 0, j: false, fire: false }); return; }
    this.prev = { ...this.cur };
    const wasGround = this.cur.onGround;
    const jumped = stepPlayer(this.cur, cmd, this.map, this.rules);
    if (jumped) sfx.jump(); else if (!wasGround && this.cur.onGround && this.prev.vy < -6) sfx.land();
    this.pending.push(cmd);
    if (cmd.fire && this.localCd <= 0) {   // predicted shot feedback
      const have = w.infinite || (this.ammo[w.id] ?? 0) > 0;
      if (have) {
        this.localCd = w.interval; this.view.fire(); sfx.shot(w.id); this.shake = Math.max(this.shake, w.id === 'shotgun' ? 0.02 : 0.004);
        this.shotsPending.push({ seq: cmd.seq, w: w.id });
      } else if (!w.auto || this.mouseDown) { this.localCd = 10; sfx.dryFire(); }
    }
    net.input(cmd);
  }

  // ---------- snapshots ----------
  onSnap(s) {
    const now = performance.now(); s.recv = now; this.lastSnap = s;
    this.snaps.push(s); if (this.snaps.length > 40) this.snaps.shift();
    if (s.st !== this.serverState) this.serverState = s.st;
    if (s.cd !== this.cd && s.cd > 0) sfx.tick();
    this.cd = s.cd; this.timeLeft = s.tl;
    this.board = s.p.map(p => ({ id: p.id, k: p.k, d: p.d, name: this.players.get(p.id)?.name || '???' })).sort((a, b) => b.k - a.k || a.d - b.d);
    this.world.pickups.forEach((_, i) => this.world.setPickupActive(i, !!s.pk[i]));
    if (s.ev && s.ev.length) this.onEvents(s.ev);
    const me = s.p.find(p => p.id === this.myId);
    if (!me) return;
    this.hp = me.hp; this.prot = me.prot;
    const wasAlive = this.alive; this.alive = !!me.a;
    if (this.alive && (!wasAlive || me.rn !== this.respawnNonce)) {         // (re)spawn: hard reset prediction
      this.cur = { x: me.x, y: me.y, z: me.z, vx: 0, vy: 0, vz: 0, onGround: true }; this.prev = { ...this.cur };
      this.pending = []; this.errOff.set(0, 0, 0); this.deathT = 0;
      if (me.rn !== this.respawnNonce && this.respawnNonce !== -1) { this.yaw = me.yaw; this.pitch = 0; }
      if (this.respawnNonce === -1) this.yaw = me.yaw;
      this.respawnNonce = me.rn;
    } else if (this.alive) {
      // reconcile: authoritative state at `ack`, then replay unacknowledged commands
      const before = new THREE.Vector3(this.cur.x, this.cur.y, this.cur.z);
      this.pending = this.pending.filter(c => c.seq > s.ack);
      const st = { x: me.x, y: me.y, z: me.z, vx: me.vx, vy: me.vy, vz: me.vz, onGround: !!me.g };
      for (const c of this.pending) stepPlayer(st, c, this.map, this.rules);
      this.cur = st;
      const err = before.sub(new THREE.Vector3(st.x, st.y, st.z));
      if (err.length() < 2) this.errOff.add(err); else this.errOff.set(0, 0, 0);
    } else { this.cur = { x: me.x, y: me.y, z: me.z, vx: 0, vy: 0, vz: 0, onGround: true }; this.prev = { ...this.cur }; }
    this.shotsPending = this.shotsPending.filter(sh => sh.seq > s.ack);
    this.ammo = { ...s.ammo };
    for (const sh of this.shotsPending) if (this.ammo[sh.w] !== undefined && !WEAPONS[sh.w].infinite) this.ammo[sh.w] = Math.max(0, this.ammo[sh.w] - 1);
  }

  onEvents(evs) {
    for (const e of evs) this.handleEvent(e);
  }
  handleEvent(e) {
    const set = settings.all;
    switch (e.t) {
      case 'shot': {
        const w = WEAPONS[e.w]; const mine = e.id === this.myId;
        const col = new THREE.Color(w.color);
        const origin = e.o.slice(); if (mine) { origin[1] -= 0.12; }
        for (const p of e.p) { this.world.tracer(origin, p, col, e.w === 'railgun' ? 0.05 : 0.015, e.w === 'railgun' ? 0.5 : 0.1); this.world.spark(p, col); }
        if (!mine) {
          const d = Math.hypot(e.o[0] - this.cur.x, e.o[2] - this.cur.z);
          sfx.shot(e.w, Math.max(0.08, Math.min(1, 14 / (d + 6))));
          const r = this.remote.get(e.id); if (r) r.flash = 0.08;
        }
        break;
      }
      case 'hit': if (set.hitmarker) this.hud.hitmarker?.(e.kill, e.head); sfx.hit(e.head); if (e.kill) sfx.kill(); break;
      case 'hurt': if (set.damageIndicators) this.hud.damage?.(Math.atan2(-(e.from[0] - this.cur.x), -(e.from[1] - this.cur.z)) - this.yaw); sfx.hurt(); this.hitFlash = 0.35; this.shake = Math.max(this.shake, 0.012); break;
      case 'kill': {
        this.hud.killfeed?.(e, this.myId);
        if (e.victim === this.myId) { sfx.death(); this.hud.youDied?.(e.kn); }
        break;
      }
      case 'pickup': if (e.id === this.myId) sfx.pickup(); this.world.setPickupActive(e.i, false); break;
      case 'pickup-spawn': this.world.setPickupActive(e.i, true); break;
      case 'spawn': if (e.id === this.myId) { sfx.spawn(); this.hud.youSpawned?.(); } break;
      case 'go': sfx.go(); this.hud.go?.(); break;
      case 'leave': this.hud.notice?.(`${e.name} left`); break;
    }
  }

  // ---------- rendering ----------
  syncRemotes(renderTick) {
    const snaps = this.snaps; if (snaps.length < 1) return;
    let a = snaps[0], b = snaps[snaps.length - 1];
    for (let i = snaps.length - 1; i >= 0; i--) { if (snaps[i].tick <= renderTick) { a = snaps[i]; b = snaps[Math.min(i + 1, snaps.length - 1)]; break; } }
    const t = b.tick === a.tick ? 1 : Math.min(1, Math.max(0, (renderTick - a.tick) / (b.tick - a.tick)));
    const seen = new Set();
    for (const pb of b.p) {
      if (pb.id === this.myId) continue; seen.add(pb.id);
      const pa = a.p.find(p => p.id === pb.id) || pb;
      let r = this.remote.get(pb.id);
      const info = this.players.get(pb.id);
      if (!r || r.skinKey !== JSON.stringify(info?.skin)) {
        if (r) this.world.scene.remove(r.group);
        const group = buildCharacter(info?.skin || {}); const tag = makeNameTag(info?.name || '?'); group.add(tag);
        this.world.scene.add(group); r = { group, skinKey: JSON.stringify(info?.skin), flash: 0 }; this.remote.set(pb.id, r);
      }
      r.group.visible = !!pb.a;
      r.group.position.set(pa.x + (pb.x - pa.x) * t, pa.y + (pb.y - pa.y) * t, pa.z + (pb.z - pa.z) * t);
      r.group.rotation.y = angLerp(pa.yaw, pb.yaw, t);
      r.group.userData.pivot.rotation.x = pa.pitch + (pb.pitch - pa.pitch) * t;
      const emissive = pb.prot ? 0.2 + Math.sin(performance.now() / 60) * 0.2 : 0;
      r.group.userData.mats[0].emissive.setRGB(emissive, emissive, emissive);
    }
    for (const [id, r] of this.remote) if (!seen.has(id)) { this.world.scene.remove(r.group); this.remote.delete(id); }
  }

  renderLoop(ts) {
    if (!this.running) return;
    this.raf = requestAnimationFrame(t => this.renderLoop(t));
    const limit = settings.all.fpsLimit;
    if (limit > 0 && ts - this.renderLast < 1000 / limit - 1) return;     // FPS cap only skips drawing
    this.renderLast = ts;
    const now = performance.now(), dt = Math.min((now - this.lastFrame) / 1000, 0.1); this.lastFrame = now; this.time += dt;

    // estimated server tick for interpolation + lag-compensation timestamp
    if (this.lastSnap) {
      const est = this.lastSnap.tick + Math.min(4, (now - this.lastSnap.recv) / (1000 / TICK_RATE));
      this.renderTick = est - INTERP_TICKS; this.syncRemotes(this.renderTick); this.renderTick = Math.max(0, Math.floor(this.renderTick));
    }

    // local camera from predicted state, smoothed between ticks and across corrections
    const alpha = this.acc / (1000 / TICK_RATE), c = this.cur, p = this.prev;
    this.errOff.multiplyScalar(Math.exp(-dt * 14));
    const cam = this.world.camera;
    if (this.alive) {
      cam.position.set(p.x + (c.x - p.x) * alpha + this.errOff.x, p.y + (c.y - p.y) * alpha + this.errOff.y + PLAYER.eye, p.z + (c.z - p.z) * alpha + this.errOff.z);
      cam.rotation.set(this.pitch, this.yaw, 0);
    } else {
      this.deathT += dt; const k = Math.min(1, this.deathT * 2);
      cam.position.set(c.x, c.y + PLAYER.eye - 1.1 * k, c.z); cam.rotation.set(this.pitch * (1 - k) - 0.3 * k, this.yaw, 0.9 * k);
    }
    if (this.shake > 0) { cam.rotation.x += (Math.random() - 0.5) * this.shake; cam.rotation.y += (Math.random() - 0.5) * this.shake; this.shake = Math.max(0, this.shake - dt * 0.1); }

    this.view.update(dt, Math.hypot(c.vx, c.vz), c.onGround, this.alive);
    this.world.updateFx(dt, this.time);
    this.world.render();

    // FPS counter
    this.fps.frames++; if (now - this.fps.last >= 500) { this.fps.value = Math.round(this.fps.frames * 1000 / (now - this.fps.last)); this.fps.frames = 0; this.fps.last = now; }
    this.hud.frame?.(this);
  }
}
