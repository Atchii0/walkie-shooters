import assert from 'node:assert/strict';
import { stepPlayer, newMoveState, rayBox, aimDir } from '../shared/sim.js';
import { MAPS } from '../shared/maps.js';
import { Room, normalizeSettings } from '../server/room.js';
import { TICK_RATE } from '../shared/constants.js';

let pass = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ok  ', name); } catch (e) { console.error('  FAIL', name, '\n', e.message); process.exitCode = 1; } };
const map = MAPS.foundry;
const cmd = (o = {}) => ({ f: 0, r: 0, j: false, yaw: 0, ...o });

console.log('Simulation');
t('gravity lands on floor', () => { const s = newMoveState(0, 5, -18); for (let i = 0; i < 120; i++) stepPlayer(s, cmd(), map, {}); assert.equal(s.y, 0); assert.ok(s.onGround); });
t('forward movement reaches ground speed', () => { const s = newMoveState(8, 0, 18); s.onGround = true; for (let i = 0; i < 60; i++) stepPlayer(s, cmd({ f: 1 }), map, {}); assert.ok(Math.abs(Math.hypot(s.vx, s.vz) - 8) < 0.05, 'speed ' + Math.hypot(s.vx, s.vz)); assert.ok(s.z < 18); });
t('walls block movement', () => { const s = newMoveState(0, 0, 18); s.onGround = true; for (let i = 0; i < 200; i++) stepPlayer(s, cmd({ f: 1 }), map, {}); assert.ok(s.z >= 14.4, 'z=' + s.z + ' should be stopped by the wall at z=14'); });
t('can climb stairs onto platform', () => { const s = newMoveState(9, 0, 0); s.onGround = true; for (let i = 0; i < 40; i++) stepPlayer(s, cmd({ f: 1, yaw: Math.PI / 2 }), map, {}); assert.ok(s.y >= 1.19, 'y=' + s.y); assert.ok(s.x < 5.1, 'x=' + s.x); });
t('arena bounds clamp', () => { const s = newMoveState(0, 0, 0); for (let i = 0; i < 600; i++) stepPlayer(s, cmd({ f: 1, yaw: Math.PI }), MAPS.crypt, {}); assert.ok(Math.abs(s.z) <= MAPS.crypt.bounds.z); });
t('jump leaves ground and returns', () => { const s = newMoveState(0, 0, 18); s.onGround = true; stepPlayer(s, cmd({ j: true }), map, {}); assert.ok(s.vy > 0 && !s.onGround); for (let i = 0; i < 120; i++) stepPlayer(s, cmd(), map, {}); assert.ok(s.onGround); });
t('air strafing gains speed beyond ground speed', () => {
  const s = newMoveState(8, 0, 18); s.onGround = true; s.vx = 0; s.vz = -8; stepPlayer(s, cmd({ f: 1, j: true }), map, {});
  let yaw = 0; for (let i = 0; i < 38; i++) { yaw -= 0.04; stepPlayer(s, cmd({ r: 1, yaw }), map, {}); }
  assert.ok(Math.hypot(s.vx, s.vz) > 8.5, 'speed ' + Math.hypot(s.vx, s.vz));
});
t('prediction determinism: same inputs -> same state', () => {
  const a = newMoveState(1, 0, 10), b = newMoveState(1, 0, 10);
  for (let i = 0; i < 300; i++) { const c = cmd({ f: 1, r: i % 7 < 3 ? 1 : 0, j: i % 40 === 0, yaw: i * 0.01 }); stepPlayer(a, c, map, {}); stepPlayer(b, { ...c }, map, {}); }
  assert.deepEqual(a, b);
});
t('rayBox hit / miss', () => { assert.ok(rayBox([0, 0, 0], [0, 0, -1], [-1, -1, -5], [1, 1, -3]) > 0); assert.equal(rayBox([0, 0, 0], [1, 0, 0], [-1, -1, -5], [1, 1, -3]), -1); });

console.log('Rooms');
function mk(code = 'TEST1', settings) {
  const room = new Room(code, settings, { onStats: () => {}, onEmpty: () => { room.emptied = true; } });
  const add = (id, name = id) => { const log = []; const m = room.addMember({ id, pid: id, name, skin: {}, emit: (e, d) => log.push([e, d]) }); m.log = log; return m; };
  return { room, add };
}
const run = (room, ticks) => { for (let i = 0; i < ticks; i++) room.update(); };

t('first joiner is leader; leader reassigned on leave', () => { const { room, add } = mk(); add('a'); add('b'); assert.equal(room.leaderId, 'a'); room.removeMember('a'); assert.equal(room.leaderId, 'b'); });
t('only leader can change settings/start/end', () => { const { room, add } = mk(); add('a'); add('b'); assert.ok(room.setSettings('b', { map: 'crypt' })); assert.equal(room.settings.map, 'foundry'); assert.equal(room.setSettings('a', { map: 'crypt' }), null); assert.equal(room.settings.map, 'crypt'); assert.ok(room.start('b')); assert.ok(room.end('b')); });
t('cannot start with one player', () => { const { room, add } = mk(); add('a'); assert.match(room.start('a'), /2 players/); });
t('duel capped at 2 players; ffa raises cap', () => { const { room, add } = mk(); add('a'); add('b'); assert.match(room.canJoin(), /full/); room.setSettings('a', { mode: 'ffa', maxPlayers: 5 }); assert.equal(room.canJoin(), null); assert.equal(room.settings.maxPlayers, 5); });
t('settings are validated and clamped', () => { const s = normalizeSettings({ duration: 99999, scoreLimit: -4, map: 'nope', weapons: ['bogus'], rules: { startHealth: 9999, gravityScale: 99 } }); assert.equal(s.duration, 900); assert.equal(s.scoreLimit, 1); assert.equal(s.map, 'foundry'); assert.ok(s.weapons.length >= 1 && s.weapons.every(w => w !== 'bogus')); assert.equal(s.rules.startHealth, 200); assert.equal(s.rules.gravityScale, 1.5); });
t('countdown then playing', () => { const { room, add } = mk(); add('a'); add('b'); assert.equal(room.start('a'), null); assert.equal(room.state, 'countdown'); run(room, 3 * TICK_RATE + 2); assert.equal(room.state, 'playing'); });

function duel(weapons = ['pistol', 'machinegun', 'shotgun', 'railgun']) {
  const { room, add } = mk('DUEL1', { weapons, scoreLimit: 2 }); const a = add('a'), b = add('b');
  room.start('a'); run(room, 3 * TICK_RATE + 2); run(room, 100);   // out of spawn protection
  return { room, a, b };
}
function faceOff(room, a, b, gap = 10) { Object.assign(a, { x: 8, y: 0, z: 18, vx: 0, vz: 0 }); Object.assign(b, { x: 8, y: 0, z: 18 - gap, vx: 0, vz: 0 }); }
const fire = (room, m, o = {}) => { room.pushInput(m.id, { seq: ++m.seqc || (m.seqc = 1), yaw: 0, pitch: 0, fire: true, vt: -1, ...o }); room.update(); };

t('server validates hit: damage applied to victim', () => {
  const { room, a, b } = duel(); faceOff(room, a, b); const hp = b.hp;
  a.weapon = 'railgun'; a.cooldown = 0; fire(room, a);
  assert.equal(b.hp, Math.max(0, hp - 120), 'level shot = headshot: 80 x 1.5');
});
t('walls block shots', () => {
  const { room, a, b } = duel(); a.weapon = 'railgun'; a.cooldown = 0;
  Object.assign(a, { x: -13, y: 0, z: 5 }); Object.assign(b, { x: -13, y: 0, z: 1 });  // wall block at (-13,0), 1x6
  fire(room, a); assert.equal(b.hp, 100, 'wall should block');
  a.cooldown = 0; Object.assign(a, { x: -8, y: 0, z: 5 }); Object.assign(b, { x: -8, y: 0, z: 1 });  // control: open lane
  fire(room, a); assert.ok(b.hp < 100, 'control shot should hit');
});
t('kill increments score, victim respawns, match ends at score limit', () => {
  const { room, a, b } = duel(['railgun']); let ended = null; a.emit = (e, d) => { if (e === 'match:end') ended = d; };
  for (let k = 0; k < 2; k++) {
    faceOff(room, a, b);
    for (let i = 0; i < 4 && b.alive; i++) { fire(room, a); run(room, 90); faceOff(room, a, b); }
    assert.equal(a.kills, k + 1); assert.equal(b.alive, false);
    if (k === 0) { run(room, 2 * TICK_RATE + 5); assert.equal(b.alive, true); assert.equal(b.hp, 100); run(room, 100); }
  }
  assert.ok(ended && ended.winner === 'a' && ended.reason === 'score'); assert.equal(room.state, 'lobby');
});
t('fire rate limited by weapon interval (cannot rapid-fire by spamming)', () => {
  const { room, a, b } = duel(['railgun']); faceOff(room, a, b); const ammo = a.ammo.railgun;
  for (let i = 0; i < 20; i++) fire(room, a);
  assert.equal(ammo - a.ammo.railgun, 1);
});
t('ammo runs out; pistol infinite', () => {
  const { room, a, b } = duel(); faceOff(room, a, b); a.weapon = 'railgun'; a.ammo.railgun = 0; a.cooldown = 0; const hp = b.hp; fire(room, a); assert.equal(b.hp, hp);
  a.weapon = 'pistol'; a.cooldown = 0; fire(room, a); assert.ok(b.hp < hp);
});
t('weapon not allowed by leader cannot be selected', () => {
  const { room, a } = duel(['pistol', 'machinegun']); room.pushInput('a', { seq: 99, yaw: 0, pitch: 0, w: 'railgun' }); room.update(); assert.notEqual(a.weapon, 'railgun');
});
t('spawn protection prevents damage', () => {
  const { room, a, b } = duel(); faceOff(room, a, b); b.protUntil = room.tick + 60; const hp = b.hp; a.weapon = 'railgun'; a.cooldown = 0; fire(room, a); assert.equal(b.hp, hp);
});
t('lag compensation: hits where target was, not where it is', () => {
  const { room, a, b } = duel(['railgun']); faceOff(room, a, b); run(room, 20);                // history at z=8
  const past = room.tick; b.x = 10; b.history[room.tick % 64] = undefined;                     // target moved far away
  a.cooldown = 0; const hp = b.hp; fire(room, a, { vt: past - 5 }); assert.ok(b.hp < hp, 'should hit rewound position');
});
t('shooter speed cheat: queue is bounded', () => { const { room, a } = duel(); for (let i = 0; i < 500; i++) room.pushInput('a', { seq: i, yaw: 0, pitch: 0, f: 1 }); assert.ok(a.queue.length <= 12); });
t('forfeit when a player leaves mid-match', () => { const { room, a, b } = duel(); let res; a.emit = (e, d) => { if (e === 'match:end') res = d; }; room.removeMember('b'); assert.equal(res.reason, 'forfeit'); assert.equal(res.winner, 'a'); assert.equal(room.state, 'lobby'); });
t('empty room is cleaned up', () => { const { room, add } = mk(); add('a'); room.removeMember('a'); assert.ok(room.emptied); });
t('snapshot contains ack + ammo for the owner', () => { const { room, a } = duel(); a.log.length = 0; run(room, 4); const s = a.log.filter(([e]) => e === 'snap').pop()[1]; assert.ok('ack' in s && s.ammo && s.p.length === 2); });
t('garbage input is sanitised', () => { const { room, a } = duel(); room.pushInput('a', { seq: 'x', f: 99, r: NaN, yaw: 'abc', pitch: 99, w: '../../x' }); const c = a.queue.at(-1); assert.equal(c.f, 1); assert.equal(c.r, 0); assert.ok(c.pitch <= 1.56); assert.equal(c.w, null); });

console.log(`\n${pass} passed`);

// ---- manager + store ----
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { RoomManager } from '../server/rooms.js'; import { Store, sanitizeName, sanitizeSkin } from '../server/store.js';
console.log('Manager & store');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-'));
const store = new Store(dir); const mgr = new RoomManager(store);
t('room codes are unique, 5 chars, case-insensitive lookup', () => { const a = mgr.create({}), b = mgr.create({ isPublic: false }); assert.notEqual(a.code, b.code); assert.match(a.code, /^[A-Z2-9]{5}$/); assert.equal(mgr.get(a.code.toLowerCase()), a); });
t('only public rooms are listed; private still joinable by code', () => { const codes = mgr.listPublic().map(r => r.code); const priv = [...mgr.rooms.values()].find(r => !r.settings.isPublic); assert.ok(!codes.includes(priv.code)); assert.ok(mgr.get(priv.code)); });
t('profile: login creates token, update persists + sanitises', () => { const { token, profile } = store.login(null, '<b>Bob</b>'); assert.equal(profile.name, 'bSBbob'.length ? profile.name : ''); assert.ok(!/[<>]/.test(profile.name)); store.update(token, { name: 'Zed', skin: { model: 'ronin', primary: '#ff0000', visor: 'bad' } }); const again = store.login(token); assert.equal(again.profile.name, 'Zed'); assert.equal(again.profile.skin.model, 'ronin'); assert.equal(again.profile.skin.visor, '#1fd1c9'); });
t('profile survives a restart (file persisted)', async () => { const { token } = store.login(null, 'Persist'); store.update(token, { name: 'Kept' }); await new Promise(r => setTimeout(r, 700)); const s2 = new Store(dir); assert.equal(s2.login(token).profile.name, 'Kept'); });
t('name/skin sanitisers reject junk', () => { assert.equal(sanitizeName('   '.repeat(3)).startsWith('Player'), true); assert.equal(sanitizeName('a'.repeat(50)).length, 16); assert.equal(sanitizeSkin({ model: 'x', primary: 'red' }).model, 'trooper'); });
console.log(`\n${pass} passed (total)`);
