// In-game HUD controller (DOM). Receives callbacks from Game.
import { settings, keyName } from './settings.js';
import { WEAPONS } from '../shared/weapons.js';
import { net } from './net.js';

const $ = id => document.getElementById(id);

export function renderCrosshair(el, c) {
  el.innerHTML = '';
  const mk = (css) => { const i = document.createElement('i'); i.style.cssText = `background:${c.color};opacity:${c.opacity};${css}`; el.appendChild(i); };
  const t = c.thickness, s = c.size, g = c.gap;
  if (c.style === 'dot') { mk(`width:${t + 2}px;height:${t + 2}px;left:${-(t + 2) / 2}px;top:${-(t + 2) / 2}px;border-radius:50%`); return; }
  if (c.style === 'circle') {
    const i = document.createElement('i'); const d = s * 2;
    i.style.cssText = `width:${d}px;height:${d}px;left:${-s}px;top:${-s}px;border:${t}px solid ${c.color};opacity:${c.opacity};border-radius:50%;background:transparent`; el.appendChild(i);
    mk(`width:${t}px;height:${t}px;left:${-t / 2}px;top:${-t / 2}px;border-radius:50%`); return;
  }
  mk(`width:${t}px;height:${s}px;left:${-t / 2}px;top:${-g - s}px`); mk(`width:${t}px;height:${s}px;left:${-t / 2}px;top:${g}px`);
  mk(`height:${t}px;width:${s}px;top:${-t / 2}px;left:${-g - s}px`); mk(`height:${t}px;width:${s}px;top:${-t / 2}px;left:${g}px`);
}

export function createHud() {
  const cache = {}; let sbVisible = false, sbTimer = 0, noticeT = 0, barKey = '', pauseOpen = false, matchActive = false;
  const set = (id, key, val, fn) => { if (cache[key] !== val) { cache[key] = val; fn($(id), val); } };
  const fmt = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  const hud = {
    paused: () => pauseOpen,
    onStart() { matchActive = true; barKey = ''; $('hud').classList.remove('hidden'); $('deathbox').classList.add('hidden'); $('countdown').textContent = ''; Object.keys(cache).forEach(k => delete cache[k]); },
    onEnd() { matchActive = false; $('hud').classList.add('hidden'); hud.showPause(false); },
    applySettings(s) {
      renderCrosshair($('crosshair'), s.crosshair);
      $('fps').style.display = s.showFps ? '' : 'none'; $('ping').style.display = s.showPing ? '' : 'none';
      if (!s.hitmarker) $('hitmarker').className = '';
    },
    onLockChange(locked) { if (matchActive) hud.showPause(!locked); },
    showPause(on) { pauseOpen = on; $('pause').classList.toggle('hidden', !on); },
    onScoreboard(show) { sbVisible = show; $('scoreboard').classList.toggle('hidden', !show); },
    hitmarker(kill, head) { const h = $('hitmarker'); h.className = ''; void h.offsetWidth; h.className = 'on' + (kill ? ' kill' : head ? ' head' : ''); },
    damage(rel) {
      const d = document.createElement('div'); d.className = 'dmg'; d.style.transform = `rotate(${-rel}rad)`; $('damage-ring').appendChild(d); setTimeout(() => d.remove(), 900);
    },
    killfeed(e, me) {
      const row = document.createElement('div'); row.className = 'kf' + (e.killer === me ? ' me-k' : e.victim === me ? ' me-d' : '');
      const w = WEAPONS[e.w]?.name || e.w;
      row.innerHTML = `<b></b><i>[${w}${e.head ? ' ⌖' : ''}]</i><b></b>`; row.children[0].textContent = e.kn; row.children[2].textContent = e.vn;
      const kf = $('killfeed'); kf.prepend(row); while (kf.children.length > 6) kf.lastChild.remove(); setTimeout(() => row.remove(), 5200);
    },
    youDied(by) { $('deathby').textContent = `Killed by ${by}`; $('deathbox').classList.remove('hidden'); },
    youSpawned() { $('deathbox').classList.add('hidden'); },
    go() { const c = $('countdown'); c.textContent = 'GO!'; setTimeout(() => { if (c.textContent === 'GO!') c.textContent = ''; }, 700); },
    notice(msg) { const n = $('notice'); n.textContent = msg; n.classList.add('show'); clearTimeout(noticeT); noticeT = setTimeout(() => n.classList.remove('show'), 2500); },

    frame(g) {
      set('fps', 'fps', g.fps.value, (el, v) => { el.textContent = `${v} FPS`; });
      set('ping', 'ping', net.ping, (el, v) => { el.textContent = `${v} ms`; });
      set('timer', 'timer', g.timeLeft, (el, v) => { el.textContent = fmt(v); });
      const hp = Math.max(0, Math.round(g.hp)), maxHp = g.rules.startHealth;
      set('hp', 'hp', hp, (el, v) => { el.textContent = v; el.classList.toggle('low', v <= 30); });
      set('hpbar', 'hpbar', hp, (el, v) => { el.style.width = Math.min(100, v / maxHp * 100) + '%'; el.classList.toggle('low', v <= 30); });
      const w = WEAPONS[g.selected], am = w.infinite ? '∞' : (g.ammo[w.id] ?? 0);
      set('ammo', 'ammo', am, (el, v) => { el.textContent = v; el.classList.toggle('empty', v === 0); });
      set('wname', 'wname', w.name, (el, v) => { el.textContent = v.toUpperCase(); });
      const key = g.allowed.join(',');
      if (key !== barKey) {
        barKey = key; const bar = $('weaponbar'); bar.innerHTML = '';
        const keys = settings.all.keys;
        for (const id of g.allowed.slice().sort((a, b) => WEAPONS[a].slot - WEAPONS[b].slot)) {
          const el = document.createElement('div'); el.className = 'wslot'; el.dataset.id = id; el.innerHTML = `<b>${keyName(keys['weapon' + WEAPONS[id].slot] || '')}</b>${WEAPONS[id].name}`; bar.appendChild(el);
        }
      }
      for (const el of $('weaponbar').children) {
        const id = el.dataset.id, on = id === g.selected, empty = !WEAPONS[id].infinite && (g.ammo[id] ?? 0) <= 0;
        el.classList.toggle('on', on); el.classList.toggle('off', empty && !on);
      }
      if (g.serverState === 'countdown') set('countdown', 'cd', g.cd, (el, v) => { el.textContent = v > 0 ? v : ''; });
      else if ($('countdown').textContent !== 'GO!' && $('countdown').textContent !== '') $('countdown').textContent = '';
      $('protbadge').classList.toggle('hidden', !(g.prot && g.alive));
      $('vignette').style.opacity = g.hitFlash > 0 ? 1 : 0; if (g.hitFlash > 0) g.hitFlash -= 1 / 60;
      if (sbVisible && performance.now() - sbTimer > 250) { sbTimer = performance.now(); hud.drawBoard(g); }
    },
    drawBoard(g) {
      const body = $('sb-body'); body.innerHTML = '';
      g.board.forEach((p, i) => {
        const tr = document.createElement('tr'); if (p.id === g.myId) tr.className = 'me';
        for (const v of [i + 1, p.name, p.k, p.d]) { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); } body.appendChild(tr);
      });
      $('sb-limit').textContent = `First to ${g.settings.scoreLimit} kills · ${g.settings.mode === 'duel' ? '1v1 Duel' : 'Free For All'}`;
    },
  };
  return hud;
}
