// Settings modal. Each control writes to settings.set(), which persists and notifies gameplay immediately.
import { settings, DEFAULTS, FOV_MIN, FOV_MAX, FPS_OPTIONS, KEY_LABELS, keyName } from './settings.js';
import { renderCrosshair } from './hud.js';
import { sfx, unlock } from './audio.js';

const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); kids.forEach(k => e.append(k)); return e; };

function slider(label, path, min, max, step, fmt = v => v) {
  const get = () => path.split('.').reduce((o, k) => o[k], settings.all);
  const val = el('span', { className: 'val' }), inp = el('input', { type: 'range', min, max, step, value: get() });
  const sync = () => { val.textContent = fmt(+inp.value); };
  inp.oninput = () => { settings.set(path, +inp.value); sync(); }; sync();
  return el('div', { className: 'rowset' }, el('span', { textContent: label }), inp, val);
}
function toggle(label, path) {
  const get = () => path.split('.').reduce((o, k) => o[k], settings.all);
  const b = el('button', { className: 'chip' + (get() ? ' on' : ''), textContent: get() ? 'ON' : 'OFF' });
  b.onclick = () => { settings.set(path, !get()); b.classList.toggle('on', get()); b.textContent = get() ? 'ON' : 'OFF'; unlock(); sfx.click(); };
  return el('div', { className: 'rowset' }, el('span', { textContent: label }), b);
}
function choice(label, path, options) {
  const get = () => path.split('.').reduce((o, k) => o[k], settings.all);
  const wrap = el('div', { className: 'chips' });
  const draw = () => { wrap.innerHTML = ''; for (const [v, t] of options) { const b = el('button', { className: 'chip' + (get() === v ? ' on' : ''), textContent: t }); b.onclick = () => { settings.set(path, v); draw(); }; wrap.append(b); } };
  draw(); return el('div', { className: 'field' }, el('span', { textContent: label }), wrap);
}

const tabs = {
  Display(body) {
    body.append(slider('Field of view', 'fov', FOV_MIN, FOV_MAX, 1, v => v + '°'));
    body.append(choice('FPS limit', 'fpsLimit', FPS_OPTIONS.map(f => [f, f === 0 ? 'Unlimited' : String(f)])));
    const fs = toggle('Fullscreen', 'fullscreen'); body.append(fs);
    body.append(choice('Graphics quality', 'quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]));
    body.append(toggle('Show FPS counter', 'showFps'), toggle('Show ping counter', 'showPing'));
  },
  'Mouse & Keys'(body, ctx) {
    body.append(slider('Mouse sensitivity', 'sensitivity', 0.1, 10, 0.05, v => v.toFixed(2)), toggle('Invert Y-axis', 'invertY'));
    body.append(el('h3', { textContent: 'Key bindings' }));
    for (const [action, label] of Object.entries(KEY_LABELS)) {
      const b = el('button', { className: 'btn keybind', textContent: keyName(settings.all.keys[action]) });
      b.onclick = () => {
        b.textContent = 'Press a key…'; b.classList.add('listening'); ctx.capturing = true;
        const done = e => {
          e.preventDefault(); e.stopPropagation(); removeEventListener('keydown', done, true); ctx.capturing = false; b.classList.remove('listening');
          if (e.code !== 'Escape') {
            const keys = { ...settings.all.keys }, other = Object.keys(keys).find(a => keys[a] === e.code && a !== action);
            if (other) keys[other] = keys[action];   // swap so no two actions share a key
            keys[action] = e.code; settings.set('keys', keys);
          }
          ctx.render();
        };
        addEventListener('keydown', done, true);
      };
      body.append(el('div', { className: 'rowset' }, el('span', { textContent: label }), b));
    }
  },
  Audio(body) {
    for (const [k, t] of [['master', 'Master volume'], ['sfx', 'Sound effects'], ['weapons', 'Weapon sounds'], ['music', 'Music'], ['ambient', 'Ambient']]) body.append(slider(t, 'audio.' + k, 0, 1, 0.01, v => Math.round(v * 100) + '%'));
    body.append(toggle('Mute all', 'audio.mute'));
    const test = el('button', { className: 'btn small', textContent: 'Test weapon + hit sounds' }); test.onclick = () => { unlock(); sfx.shot('shotgun'); setTimeout(() => sfx.hit(false), 300); }; body.append(test);
  },
  Crosshair(body) {
    const prev = el('div', { style: 'height:120px;background:linear-gradient(135deg,#27334a,#1a2030);border-radius:10px;position:relative;overflow:hidden' }, el('div', { id: 'ch-prev', style: 'position:absolute;left:50%;top:50%' }));
    body.append(prev);
    body.append(choice('Style', 'crosshair.style', [['cross', 'Cross'], ['dot', 'Dot'], ['circle', 'Circle']]));
    body.append(slider('Size', 'crosshair.size', 2, 40, 1, v => v + 'px'), slider('Gap', 'crosshair.gap', 0, 20, 1, v => v + 'px'), slider('Thickness', 'crosshair.thickness', 1, 6, 1, v => v + 'px'), slider('Opacity', 'crosshair.opacity', 0.1, 1, 0.05, v => Math.round(v * 100) + '%'));
    const col = el('input', { type: 'color', value: settings.all.crosshair.color }); col.oninput = () => settings.set('crosshair.color', col.value);
    body.append(el('div', { className: 'rowset' }, el('span', { textContent: 'Color' }), col));
    body.append(toggle('Hitmarker', 'hitmarker'), toggle('Damage indicators', 'damageIndicators'));
    const upd = () => { const p = document.getElementById('ch-prev'); if (p) renderCrosshair(p, settings.all.crosshair); };
    upd(); ctxUnsub = settings.subscribe(upd);
  },
};
let ctxUnsub = null, current = 'Display';

export function initSettingsUI({ onClose } = {}) {
  const ctx = { capturing: false, render };
  function render() {
    ctxUnsub?.(); ctxUnsub = null;
    const t = $('st-tabs'); t.innerHTML = '';
    for (const name of Object.keys(tabs)) { const b = el('button', { className: 'tab' + (name === current ? ' on' : ''), textContent: name }); b.onclick = () => { current = name; render(); }; t.append(b); }
    const body = $('st-body'); body.innerHTML = ''; tabs[current](body, ctx);
  }
  $('st-close').onclick = () => close();
  $('st-reset').onclick = () => { settings.reset(); render(); };
  document.addEventListener('fullscreenchange', () => { const on = !!document.fullscreenElement; if (settings.all.fullscreen !== on) { settings.set('fullscreen', on); if (!$('modal-settings').classList.contains('hidden')) render(); } });
  addEventListener('keydown', e => { if (e.code === 'Escape' && !ctx.capturing && !$('modal-settings').classList.contains('hidden')) close(); });
  function close() { ctxUnsub?.(); ctxUnsub = null; $('modal-settings').classList.add('hidden'); onClose?.(); }
  return { open() { render(); $('modal-settings').classList.remove('hidden'); }, close };
}
