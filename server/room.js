// Room + authoritative match simulation. Transport-agnostic: members expose emit(event, data).
import { DT, SNAPSHOT_EVERY, PLAYER, DEFAULT_SETTINGS, RULE_LIMITS, HISTORY_TICKS, MAX_REWIND_TICKS, TICK_RATE } from '../shared/constants.js';
import { MAPS, MAP_IDS } from '../shared/maps.js';
import { WEAPONS, WEAPON_IDS, SWITCH_COOLDOWN } from '../shared/weapons.js';
import { stepPlayer, newMoveState, aimDir, rayBox, rayWorld, playerBox } from '../shared/sim.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const COUNTDOWN_TICKS = 3 * TICK_RATE;
const MAX_QUEUE = 12;

export function normalizeSettings(patch, base = DEFAULT_SETTINGS) {
  const s = JSON.parse(JSON.stringify(base));
  if (!patch) return s;
  if (patch.mode === 'duel' || patch.mode === 'ffa') s.mode = patch.mode;
  if (MAP_IDS.includes(patch.map)) s.map = patch.map;
  if (Array.isArray(patch.weapons)) { const w = [...new Set(patch.weapons.filter(x => WEAPON_IDS.includes(x)))]; if (w.length) s.weapons = w; }
  if (patch.duration !== undefined) s.duration = Math.round(clamp(num(patch.duration, s.duration), ...RULE_LIMITS.duration));
  if (patch.scoreLimit !== undefined) s.scoreLimit = Math.round(clamp(num(patch.scoreLimit, s.scoreLimit), ...RULE_LIMITS.scoreLimit));
  if (patch.isPublic !== undefined) s.isPublic = !!patch.isPublic;
  if (patch.maxPlayers !== undefined) s.maxPlayers = Math.round(num(patch.maxPlayers, s.maxPlayers));
  if (patch.rules) {
    const r = patch.rules;
    if (r.startHealth !== undefined) s.rules.startHealth = Math.round(clamp(num(r.startHealth, 100), ...RULE_LIMITS.startHealth));
    if (r.gravityScale !== undefined) s.rules.gravityScale = clamp(num(r.gravityScale, 1), ...RULE_LIMITS.gravityScale);
    if (r.respawnDelay !== undefined) s.rules.respawnDelay = clamp(num(r.respawnDelay, 2), ...RULE_LIMITS.respawnDelay);
    if (r.pickups !== undefined) s.rules.pickups = !!r.pickups;
  }
  if (s.mode === 'duel') s.maxPlayers = 2;
  else s.maxPlayers = clamp(s.maxPlayers < 3 ? 6 : s.maxPlayers, RULE_LIMITS.ffaPlayers[0], RULE_LIMITS.ffaPlayers[1]);
  return s;
}

export class Room {
  constructor(code, settings, hooks = {}) {
    this.code = code;
    this.settings = normalizeSettings(settings);
    this.hooks = hooks;                 // { onEmpty(room), onStats(pid, delta) }
    this.members = new Map();           // id -> member
    this.leaderId = null;
    this.state = 'lobby';               // lobby | countdown | playing
    this.tick = 0;
    this.countdown = 0;
    this.timeLeftTicks = 0;
    this.map = null;
    this.pickups = [];
    this.events = [];
  }

  // ---------- membership ----------
  get playerCount() { return this.members.size; }
  canJoin() {
    if (this.members.size >= this.settings.maxPlayers) return 'Room is full';
    if (this.state !== 'lobby' && this.settings.mode === 'duel') return 'Duel already in progress';
    return null;
  }
  addMember({ id, pid, name, skin, emit }) {
    const m = {
      id, pid, name, skin, emit,
      ...newMoveState(), yaw: 0, pitch: 0, hp: 0, alive: false, respawnAt: 0, protUntil: 0,
      weapon: 'pistol', ammo: {}, cooldown: 0, switchCd: 0, queue: [], lastSeq: 0,
      kills: 0, deaths: 0, history: new Array(HISTORY_TICKS), fireHeld: false,
    };
    this.members.set(id, m);
    if (!this.leaderId) this.leaderId = id;
    if (this.state !== 'lobby') { this.initLoadout(m); this.spawn(m); emit('match:start', this.matchInfo(m)); }
    this.broadcastRoom();
    return m;
  }
  removeMember(id) {
    const m = this.members.get(id); if (!m) return;
    this.members.delete(id);
    this.broadcast('ev', [{ t: 'leave', name: m.name }]);
    if (this.members.size === 0) { this.hooks.onEmpty?.(this); return; }
    if (this.leaderId === id) this.leaderId = this.members.keys().next().value;
    if (this.state !== 'lobby' && this.members.size < 2) this.endMatch('forfeit');
    this.broadcastRoom();
  }
  updateProfile(id, { name, skin }) {
    const m = this.members.get(id); if (!m) return;
    m.name = name; m.skin = skin; this.broadcastRoom();
  }

  // ---------- settings / lifecycle (leader only) ----------
  setSettings(id, patch) {
    if (id !== this.leaderId) return 'Only the room leader can change settings';
    if (this.state !== 'lobby') return 'Cannot change settings during a match';
    const next = normalizeSettings(patch, this.settings);
    if (next.maxPlayers < this.members.size) next.maxPlayers = Math.max(this.members.size, next.mode === 'duel' ? 2 : 3);
    if (next.mode === 'duel' && this.members.size > 2) return 'Too many players for a duel';
    this.settings = next; this.broadcastRoom(); return null;
  }
  start(id) {
    if (id !== this.leaderId) return 'Only the room leader can start the match';
    if (this.state !== 'lobby') return 'Match already running';
    if (this.members.size < 2) return 'Need at least 2 players';
    this.map = MAPS[this.settings.map];
    this.pickups = this.settings.rules.pickups ? this.map.pickups.map((p, i) => ({ ...p, i, active: true, respawnAt: 0 })) : [];
    for (const m of this.members.values()) { m.kills = 0; m.deaths = 0; m.queue = []; this.initLoadout(m); this.spawn(m); }
    this.state = 'countdown'; this.countdown = COUNTDOWN_TICKS;
    this.timeLeftTicks = this.settings.duration * TICK_RATE;
    for (const m of this.members.values()) m.emit('match:start', this.matchInfo(m));
    this.broadcastRoom();
    return null;
  }
  end(id) {
    if (id !== this.leaderId) return 'Only the room leader can end the match';
    if (this.state === 'lobby') return 'No match running';
    this.endMatch('leader'); return null;
  }

  initLoadout(m) {
    m.ammo = {};
    for (const w of this.settings.weapons) m.ammo[w] = WEAPONS[w].startAmmo;
    m.weapon = this.settings.weapons.includes('pistol') ? 'pistol' : this.settings.weapons[0];
    m.cooldown = 0;
  }
  matchInfo(m) {
    return { you: m.id, code: this.code, settings: this.settings, map: this.settings.map, state: this.state };
  }

  // ---------- spawning ----------
  spawn(m) {
    const spawns = this.map.spawns;
    const others = [...this.members.values()].filter(o => o !== m && o.alive);
    let best = spawns[0], bestD = -1;
    for (const sp of spawns) {
      const d = others.length ? Math.min(...others.map(o => Math.hypot(o.x - sp.x, o.z - sp.z))) : Math.random();
      if (d > bestD) { bestD = d; best = sp; }
    }
    Object.assign(m, newMoveState(best.x, best.y, best.z));
    m.yaw = best.yaw; m.pitch = 0; m.hp = this.settings.rules.startHealth; m.alive = true;
    m.protUntil = this.tick + 90; m.cooldown = 10; m.queue = []; m.history.fill(undefined);
    m.respawnNonce = (m.respawnNonce || 0) + 1;
  }

  // ---------- input ----------
  pushInput(id, cmd) {
    const m = this.members.get(id); if (!m || !cmd || typeof cmd !== 'object') return;
    if (m.queue.length >= MAX_QUEUE) m.queue.shift();
    m.queue.push({
      seq: num(cmd.seq) | 0,
      f: clamp(Math.round(num(cmd.f)), -1, 1), r: clamp(Math.round(num(cmd.r)), -1, 1),
      j: !!cmd.j, fire: !!cmd.fire,
      yaw: num(cmd.yaw), pitch: clamp(num(cmd.pitch), -1.5533, 1.5533),
      w: WEAPON_IDS.includes(cmd.w) ? cmd.w : null,
      vt: num(cmd.vt, -1),
    });
  }

  // ---------- main tick ----------
  update() {
    if (this.state === 'lobby') return;
    this.tick++;
    if (this.state === 'countdown') {
      for (const m of this.members.values()) { m.queue.length = 0; this.record(m); }
      if (--this.countdown <= 0) { this.state = 'playing'; this.events.push({ t: 'go' }); this.broadcastRoom(); }
    } else {
      for (const m of this.members.values()) this.updateMember(m);
      this.updatePickups();
      if (--this.timeLeftTicks <= 0) { this.endMatch('time'); return; }
    }
    if (this.tick % SNAPSHOT_EVERY === 0) this.sendSnapshot();
  }

  record(m) { m.history[this.tick % HISTORY_TICKS] = { tick: this.tick, x: m.x, y: m.y, z: m.z, alive: m.alive && this.tick >= m.protUntil - 0 }; }

  updateMember(m) {
    if (m.cooldown > 0) m.cooldown--;
    if (m.switchCd > 0) m.switchCd--;
    if (!m.alive) {
      m.queue.length = 0;
      if (this.tick >= m.respawnAt) { this.spawn(m); this.events.push({ t: 'spawn', id: m.id }); }
      this.record(m); return;
    }
    let n = m.queue.length > 4 ? 2 : 1;     // gentle catch-up, never more than 2 per tick
    while (n-- > 0 && m.queue.length && m.alive) {
      const c = m.queue.shift();
      m.lastSeq = c.seq; m.yaw = c.yaw; m.pitch = c.pitch;
      stepPlayer(m, c, this.map, this.settings.rules);
      if (c.w && c.w !== m.weapon && this.settings.weapons.includes(c.w) && m.switchCd <= 0) {
        m.weapon = c.w; m.cooldown = Math.max(m.cooldown, SWITCH_COOLDOWN); m.switchCd = SWITCH_COOLDOWN;
      }
      this.record(m);
      if (c.fire) this.tryFire(m, c);
    }
    if (!m.queue.length && m.history[this.tick % HISTORY_TICKS]?.tick !== this.tick) this.record(m);
  }

  // ---------- combat ----------
  tryFire(m, c) {
    const w = WEAPONS[m.weapon];
    if (m.cooldown > 0) return;
    if (!w.infinite && m.ammo[w.id] <= 0) return;
    m.cooldown = w.interval;
    if (!w.infinite) m.ammo[w.id]--;
    const origin = [m.x, m.y + PLAYER.eye, m.z];
    const rewind = c.vt >= 0 ? clamp(this.tick - c.vt, 0, MAX_REWIND_TICKS) : 0;
    const targetTick = this.tick - rewind;
    const tracers = [];
    const hits = new Map();   // victim id -> {dmg, head}
    for (let i = 0; i < w.pellets; i++) {
      const d = this.spreadDir(m.yaw, m.pitch, w.spread);
      let best = Math.min(rayWorld(origin, d, this.map, w.range), w.range), victim = null, head = false;
      for (const o of this.members.values()) {
        if (o === m || !o.alive) continue;
        const pos = this.posAt(o, targetTick);
        if (!pos || pos.alive === false) continue;
        const bx = playerBox(pos);
        const t = rayBox(origin, d, bx.min, bx.max);
        if (t >= 0 && t < best) { best = t; victim = o; head = origin[1] + d[1] * t - pos.y > PLAYER.headY; }
      }
      tracers.push([origin[0] + d[0] * best, origin[1] + d[1] * best, origin[2] + d[2] * best]);
      if (victim && this.tick >= victim.protUntil) {
        const h = hits.get(victim.id) || { dmg: 0, head: false };
        h.dmg += w.damage * (head ? PLAYER.headshotMult : 1); h.head ||= head; hits.set(victim.id, h);
      }
    }
    this.events.push({ t: 'shot', id: m.id, w: w.id, o: origin, p: tracers });
    for (const [vid, h] of hits) this.damage(m, this.members.get(vid), Math.round(h.dmg), h.head, w.id);
  }

  spreadDir(yaw, pitch, spread) {
    if (!spread) return aimDir(yaw, pitch);
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
    return aimDir(yaw + Math.cos(a) * r, clamp(pitch + Math.sin(a) * r, -1.55, 1.55));
  }
  posAt(o, tick) {
    const h = o.history[tick % HISTORY_TICKS];
    if (h && h.tick === tick) return h;
    return { x: o.x, y: o.y, z: o.z, alive: o.alive };
  }

  damage(att, vic, dmg, head, weapon) {
    if (!vic || !vic.alive || dmg <= 0) return;
    vic.hp -= dmg;
    att.emit('ev', [{ t: 'hit', dmg, head, kill: vic.hp <= 0 }]);
    vic.emit('ev', [{ t: 'hurt', dmg, from: [att.x, att.z], hp: Math.max(0, vic.hp) }]);
    if (vic.hp > 0) return;
    vic.hp = 0; vic.alive = false; vic.deaths++; att.kills++;
    vic.respawnAt = this.tick + Math.round(this.settings.rules.respawnDelay * TICK_RATE);
    this.events.push({ t: 'kill', killer: att.id, kn: att.name, victim: vic.id, vn: vic.name, w: weapon, head });
    if (att.kills >= this.settings.scoreLimit) this.endMatch('score');
  }

  updatePickups() {
    for (const p of this.pickups) {
      if (!p.active) { if (this.tick >= p.respawnAt) { p.active = true; this.events.push({ t: 'pickup-spawn', i: p.i }); } continue; }
      for (const m of this.members.values()) {
        if (!m.alive) continue;
        if (Math.abs(m.x - p.x) > 0.9 || Math.abs(m.z - p.z) > 0.9 || m.y > p.y + 1.6 || m.y < p.y - 1.0) continue;
        if (p.type === 'health') { if (m.hp >= this.settings.rules.startHealth) continue; m.hp = Math.min(this.settings.rules.startHealth, m.hp + 40); }
        else {
          let gave = false;
          for (const wid of this.settings.weapons) { const w = WEAPONS[wid]; if (w.infinite) continue; const add = Math.ceil(w.maxAmmo / 4); if (m.ammo[wid] < w.maxAmmo) { m.ammo[wid] = Math.min(w.maxAmmo, m.ammo[wid] + add); gave = true; } }
          if (!gave) continue;
        }
        p.active = false; p.respawnAt = this.tick + 20 * TICK_RATE;
        this.events.push({ t: 'pickup', i: p.i, id: m.id, type: p.type });
        break;
      }
    }
  }

  // ---------- end of match ----------
  endMatch(reason) {
    if (this.state === 'lobby') return;
    const board = this.scoreboard();
    let winner = null;
    if (board.length) {
      const top = board[0];
      if (reason === 'forfeit') winner = this.members.size === 1 ? [...this.members.keys()][0] : null;
      else if (!board[1] || top.kills > board[1].kills) winner = top.id;
    }
    for (const m of this.members.values()) {
      this.hooks.onStats?.(m.pid, { kills: m.kills, deaths: m.deaths, matches: 1, wins: m.id === winner ? 1 : 0 });
    }
    this.broadcast('match:end', { reason, winner, board });
    this.state = 'lobby'; this.pickups = []; this.events = [];
    for (const m of this.members.values()) { m.alive = false; m.queue = []; }
    this.broadcastRoom();
  }

  scoreboard() {
    return [...this.members.values()].map(m => ({ id: m.id, name: m.name, kills: m.kills, deaths: m.deaths }))
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  }

  // ---------- networking ----------
  broadcast(ev, data) { for (const m of this.members.values()) m.emit(ev, data); }
  roomInfo() {
    return {
      code: this.code, leader: this.leaderId, state: this.state, settings: this.settings,
      players: [...this.members.values()].map(m => ({ id: m.id, name: m.name, skin: m.skin, kills: m.kills, deaths: m.deaths })),
    };
  }
  broadcastRoom() { this.broadcast('room:state', this.roomInfo()); }
  summary() {
    return { code: this.code, mode: this.settings.mode, map: this.settings.map, players: this.members.size, max: this.settings.maxPlayers, state: this.state, leader: this.members.get(this.leaderId)?.name };
  }

  sendSnapshot() {
    const players = [...this.members.values()].map(m => ({
      id: m.id, x: +m.x.toFixed(3), y: +m.y.toFixed(3), z: +m.z.toFixed(3),
      vx: +m.vx.toFixed(2), vy: +m.vy.toFixed(2), vz: +m.vz.toFixed(2), g: m.onGround ? 1 : 0,
      yaw: +m.yaw.toFixed(3), pitch: +m.pitch.toFixed(3), hp: m.hp, a: m.alive ? 1 : 0, w: m.weapon,
      k: m.kills, d: m.deaths, prot: this.tick < m.protUntil ? 1 : 0, rn: m.respawnNonce || 0,
    }));
    const base = {
      tick: this.tick, st: this.state, cd: this.state === 'countdown' ? Math.ceil(this.countdown / TICK_RATE) : 0,
      tl: Math.ceil(this.timeLeftTicks / TICK_RATE), p: players,
      pk: this.pickups.map(p => (p.active ? 1 : 0)), ev: this.events,
    };
    for (const m of this.members.values()) {
      m.emit('snap', { ...base, ack: m.lastSeq, ammo: m.ammo });
    }
    this.events = [];
  }
}
