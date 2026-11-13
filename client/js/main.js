// App controller: screens, lobby/room UI, locker, profile, match lifecycle.
import { net } from './net.js';
import { Game } from './game.js';
import { createHud } from './hud.js';
import { initSettingsUI } from './settings-ui.js';
import { CharacterPreview } from './character.js';
import { unlock } from './audio.js';
import { MAPS, MAP_IDS } from '../shared/maps.js';
import { WEAPONS, WEAPON_IDS } from '../shared/weapons.js';
import { SKINS, RULE_LIMITS } from '../shared/constants.js';

const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); kids.forEach(k => e.append(k)); return e; };
const hud = createHud();
const game = new Game($('game'), hud);
const settingsUI = initSettingsUI({ onClose: () => { if (inMatch && !game.locked) hud.showPause(true); } });
let room = null, inMatch = false, screen = 'loading', menuPreview, lockerPreview, draftSkin = null, createOpts = { mode: 'duel', vis: 'public' };

addEventListener('pointerdown', () => unlock(), { once: true });
function toast(msg, err = false) { const t = $('toast'); t.textContent = msg; t.className = 'show' + (err ? ' err' : ''); clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = ''), 2800); }

// ---------------- screens ----------------
function show(name) {
  screen = name;
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  $('screen-' + name).classList.remove('hidden');
  if (name === 'menu') { menuPreview ||= new CharacterPreview($('menu-preview')); menuPreview.setSkin(net.profile.skin); menuPreview.start(); } else menuPreview?.stop();
  if (name !== 'locker') lockerPreview?.stop();
  if (name === 'locker') openLocker();
  if (name === 'profile') openProfile();
  if (name === 'join') { $('join-msg').textContent = ''; refreshRooms(); $('join-code').focus(); }
}
document.querySelectorAll('[data-go]').forEach(b => (b.onclick = () => {
  const g = b.dataset.go;
  if (g === 'play') return quickPlay();
  if (g === 'create') return $('modal-create').classList.remove('hidden');
  if (g === 'settings') return settingsUI.open();
  show(g);
}));

// ---------------- boot ----------------
async function boot() {
  $('retry').classList.add('hidden'); $('loading-msg').textContent = 'Connecting…';
  try { await net.connect(); $('menu-name').textContent = net.profile.name; show('menu'); }
  catch { $('loading-msg').textContent = 'Cannot reach the game server.'; $('retry').classList.remove('hidden'); }
}
$('retry').onclick = () => { net.socket?.close(); boot(); };
net.on('disconnected', () => { if (net.profile) { leaveToMenu(); toast('Disconnected from server', true); } });
net.on('connected', () => { if (screen === 'loading') return; });

// ---------------- room flow ----------------
async function quickPlay() { const r = await net.emit('room:quick'); if (!r.ok) return toast(r.error, true); enterLobby(r.info); }
$('modal-create').querySelectorAll('.chips').forEach(c => c.querySelectorAll('.chip').forEach(b => (b.onclick = () => { c.querySelectorAll('.chip').forEach(x => x.classList.remove('on')); b.classList.add('on'); createOpts[c.id === 'cr-mode' ? 'mode' : 'vis'] = b.dataset.v; })));
$('cr-cancel').onclick = () => $('modal-create').classList.add('hidden');
$('cr-go').onclick = async () => {
  const r = await net.emit('room:create', { settings: { mode: createOpts.mode, isPublic: createOpts.vis === 'public' } });
  if (!r.ok) { $('cr-msg').textContent = r.error; return; }
  $('modal-create').classList.add('hidden'); enterLobby(r.info);
};
async function joinCode(code) {
  const r = await net.emit('room:join', { code }); if (!r.ok) { $('join-msg').textContent = r.error; return toast(r.error, true); }
  enterLobby(r.info);
}
$('join-code').oninput = e => (e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
$('join-code').onkeydown = e => { if (e.key === 'Enter') $('join-go').click(); };
$('join-go').onclick = () => joinCode($('join-code').value);
$('join-refresh').onclick = refreshRooms;
async function refreshRooms() {
  const r = await net.emit('rooms:list'); const list = $('join-list'); list.innerHTML = '';
  if (!r.ok || !r.rooms.length) { list.append(el('div', { className: 'muted', textContent: 'No public rooms right now. Create one!' })); return; }
  for (const x of r.rooms) {
    const b = el('button', { className: 'btn small', textContent: x.players >= x.max ? 'Full' : x.state !== 'lobby' && x.mode === 'duel' ? 'In match' : 'Join', disabled: x.players >= x.max || (x.state !== 'lobby' && x.mode === 'duel') });
    b.onclick = () => joinCode(x.code);
    list.append(el('div', { className: 'list-item' }, el('b', { textContent: x.code }), el('span', { className: 'grow', textContent: `${x.mode === 'duel' ? '1v1' : 'FFA'} · ${MAPS[x.map]?.name || x.map} · ${x.players}/${x.max}${x.leader ? ' · ' + x.leader : ''}` }), b));
  }
}

function enterLobby(info) { room = info; inMatch = false; show('lobby'); renderLobby(); }
function leaveToMenu(msg) {
  if (inMatch) { game.stop(); hud.onEnd(); } inMatch = false; room = null;
  $('modal-results').classList.add('hidden'); show('menu'); if (msg) toast(msg);
}
$('lobby-leave').onclick = async () => { await net.emit('room:leave'); leaveToMenu(); };
$('lobby-code').onclick = () => { navigator.clipboard?.writeText(room.code).then(() => toast('Room code copied')); };
$('lobby-start').onclick = async () => { const r = await net.emit('room:start'); if (!r.ok) toast(r.error, true); };
$('lobby-end').onclick = async () => { const r = await net.emit('room:end'); if (!r.ok) toast(r.error, true); };

net.on('room:state', r => {
  room = r; game.players = new Map(r.players.map(p => [p.id, p]));
  if (screen === 'lobby') renderLobby();
});

// ---------------- lobby rendering ----------------
const isLeader = () => room && room.leader === net.socket.id;
function renderLobby() {
  const r = room, s = r.settings, leader = isLeader();
  $('lobby-code').textContent = r.code;
  $('lobby-badge').innerHTML = ''; $('lobby-badge').append(el('span', { className: 'badge' + (r.state !== 'lobby' ? ' live' : ''), textContent: `${s.isPublic ? 'Public' : 'Private'} · ${s.mode === 'duel' ? '1v1 Duel' : 'FFA'}` }));
  $('lobby-count').textContent = `${r.players.length}/${s.maxPlayers}`;
  const pl = $('lobby-players'); pl.innerHTML = '';
  for (const p of r.players) pl.append(el('div', { className: 'pl' }, el('div', { className: 'dot', style: `background:linear-gradient(135deg,${p.skin.primary} 55%,${p.skin.visor} 55%)` }), el('div', { className: 'nm', textContent: p.name + (p.id === net.socket.id ? ' (you)' : '') }), ...(p.id === r.leader ? [el('span', { className: 'lead', textContent: 'LEADER' })] : [])));
  $('lobby-lock').textContent = leader ? '(you are the leader)' : '(only the leader can edit)';
  $('lobby-start').classList.toggle('hidden', !leader); $('lobby-end').classList.add('hidden');
  $('lobby-start').disabled = r.players.length < 2;
  $('lobby-msg').textContent = r.players.length < 2 ? 'Waiting for another player — share the room code.' : leader ? 'Ready when you are.' : 'Waiting for the leader to start…';
  renderLobbyForm(leader);
}
function renderLobbyForm(leader) {
  const f = $('lobby-form'); const s = room.settings; f.innerHTML = '';
  const send = async patch => { const r = await net.emit('room:settings', patch); if (!r.ok) toast(r.error, true); };
  const chips = (label, opts, selected, onPick, multi = false) => {
    const w = el('div', { className: 'chips' });
    for (const [v, t] of opts) { const on = multi ? selected.includes(v) : selected === v; const b = el('button', { className: 'chip' + (on ? ' on' : ''), textContent: t, disabled: !leader }); b.onclick = () => onPick(v); w.append(b); }
    return el('div', { className: 'field' }, el('span', { textContent: label }), w);
  };
  const range = (label, min, max, step, val, fmt, onChange) => {
    const v = el('span', { className: 'val', textContent: fmt(val) }), i = el('input', { type: 'range', min, max, step, value: val, disabled: !leader });
    i.oninput = () => (v.textContent = fmt(+i.value)); i.onchange = () => onChange(+i.value);
    return el('div', { className: 'rowset' }, el('span', { textContent: label }), i, v);
  };
  f.append(chips('Mode', [['duel', '1v1 Duel'], ['ffa', 'Free For All']], s.mode, v => send({ mode: v })));
  f.append(chips('Map', MAP_IDS.map(id => [id, MAPS[id].name]), s.map, v => send({ map: v })));
  if (s.mode === 'ffa') f.append(range('Max players', RULE_LIMITS.ffaPlayers[0], RULE_LIMITS.ffaPlayers[1], 1, s.maxPlayers, v => v, v => send({ maxPlayers: v })));
  f.append(chips('Weapons (click to toggle)', WEAPON_IDS.map(id => [id, WEAPONS[id].name]), s.weapons, id => { const w = s.weapons.includes(id) ? s.weapons.filter(x => x !== id) : [...s.weapons, id]; if (!w.length) return toast('At least one weapon is required', true); send({ weapons: w }); }, true));
  f.append(range('Match duration', 1, 15, 1, Math.round(s.duration / 60), v => v + ' min', v => send({ duration: v * 60 })));
  f.append(range('Score limit (kills)', 1, 50, 1, s.scoreLimit, v => v, v => send({ scoreLimit: v })));
  f.append(chips('Visibility', [[true, 'Public'], [false, 'Private']], s.isPublic, v => send({ isPublic: v })));
  f.append(el('h3', { textContent: 'Gameplay rules' }));
  f.append(range('Starting health', 50, 200, 10, s.rules.startHealth, v => v, v => send({ rules: { startHealth: v } })));
  f.append(range('Gravity', 0.5, 1.5, 0.1, s.rules.gravityScale, v => v.toFixed(1) + '×', v => send({ rules: { gravityScale: v } })));
  f.append(range('Respawn delay', 1, 5, 1, s.rules.respawnDelay, v => v + 's', v => send({ rules: { respawnDelay: v } })));
  f.append(chips('Health & ammo pickups', [[true, 'On'], [false, 'Off']], s.rules.pickups, v => send({ rules: { pickups: v } })));
  f.append(el('div', { className: 'muted small', textContent: MAPS[s.map].desc }));
}

// ---------------- match lifecycle ----------------
net.on('match:start', info => {
  inMatch = true; $('modal-results').classList.add('hidden');
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  menuPreview?.stop(); lockerPreview?.stop();
  game.start(info, room || { players: [] });
  $('pause').querySelector('h2').textContent = 'READY?'; $('pause-resume').textContent = 'Click to enter the arena';
  hud.showPause(true);
});
net.on('match:end', res => {
  if (!inMatch) return;
  game.stop(); hud.onEnd(); inMatch = false; show('lobby'); renderLobby();
  const me = net.socket.id;
  $('res-title').textContent = res.winner === me ? 'VICTORY' : res.winner ? 'DEFEAT' : 'DRAW';
  $('res-sub').textContent = { time: 'Time limit reached', score: 'Score limit reached', leader: 'Match ended by the leader', forfeit: 'Opponent left the match' }[res.reason] || '';
  const body = $('res-body'); body.innerHTML = '';
  res.board.forEach((p, i) => { const tr = el('tr', { className: p.id === me ? 'me' : '' }); for (const v of [i + 1, p.name, p.kills, p.deaths]) tr.append(el('td', { textContent: v })); body.append(tr); });
  $('modal-results').classList.remove('hidden');
});
$('res-close').onclick = () => $('modal-results').classList.add('hidden');
$('pause-resume').onclick = () => { game.lock(); setTimeout(() => { if (inMatch && !game.locked) { $('pause').querySelector('h2').textContent = 'PAUSED'; } }, 300); };
$('pause-settings').onclick = () => { hud.showPause(false); settingsUI.open(); };
$('pause-end').onclick = async () => { const r = await net.emit('room:end'); if (!r.ok) toast(r.error, true); };
$('pause-leave').onclick = async () => { await net.emit('room:leave'); leaveToMenu(); };
const origLock = hud.onLockChange; hud.onLockChange = l => { if (!l) { $('pause').querySelector('h2').textContent = 'PAUSED'; $('pause-resume').textContent = 'Resume'; } origLock(l); };
addEventListener('resize', () => { lockerPreview?.resize(); menuPreview?.resize(); });

// ---------------- locker / profile ----------------
function swatchRow(id, key) {
  const wrap = $(id); wrap.innerHTML = '';
  for (const c of SKINS.colors) { const s = el('div', { className: 'sw' + (draftSkin[key] === c ? ' on' : ''), style: `background:${c}` }); s.onclick = () => { draftSkin[key] = c; refreshLocker(); }; wrap.append(s); }
  const pick = el('input', { type: 'color', value: draftSkin[key] }); pick.oninput = () => { draftSkin[key] = pick.value; lockerPreview.setSkin(draftSkin); }; pick.onchange = refreshLocker; wrap.append(pick);
}
function refreshLocker() {
  const m = $('lk-models'); m.innerHTML = '';
  for (const id of SKINS.models) { const b = el('button', { className: 'chip' + (draftSkin.model === id ? ' on' : ''), textContent: id[0].toUpperCase() + id.slice(1) }); b.onclick = () => { draftSkin.model = id; refreshLocker(); }; m.append(b); }
  swatchRow('lk-primary', 'primary'); swatchRow('lk-secondary', 'secondary'); swatchRow('lk-visor', 'visor');
  lockerPreview.setSkin(draftSkin);
}
function openLocker() {
  draftSkin = { ...net.profile.skin }; $('lk-name').value = net.profile.name; $('lk-msg').textContent = '';
  lockerPreview ||= new CharacterPreview($('locker-preview')); lockerPreview.start(); refreshLocker();
}
$('lk-save').onclick = async () => {
  const r = await net.emit('profile:save', { name: $('lk-name').value, skin: draftSkin });
  if (r.ok) { net.profile = r.profile; $('menu-name').textContent = r.profile.name; $('lk-msg').textContent = 'Saved ✓'; toast('Loadout saved'); } else toast(r.error, true);
};
async function openProfile() {
  const r = await net.emit('profile:get'); if (!r.ok) return; net.profile = r.profile; const p = r.profile;
  $('pf-name').value = p.name; const st = $('pf-stats'); st.innerHTML = '';
  const kd = p.stats.deaths ? (p.stats.kills / p.stats.deaths).toFixed(2) : p.stats.kills.toFixed(2);
  for (const [k, v] of [['Kills', p.stats.kills], ['Deaths', p.stats.deaths], ['K/D', kd], ['Wins', `${p.stats.wins}/${p.stats.matches}`]]) st.append(el('div', { className: 'stat' }, el('b', { textContent: v }), el('span', { textContent: k })));
}
$('pf-save').onclick = async () => { const r = await net.emit('profile:save', { name: $('pf-name').value, skin: net.profile.skin }); if (r.ok) { net.profile = r.profile; $('menu-name').textContent = r.profile.name; toast('Name saved'); } };

boot();
