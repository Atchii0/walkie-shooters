// Client-side logic tests that don't need a browser: settings behaviour + module graph integrity (three stubbed).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
let pass = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('  ok  ', name); } catch (e) { console.error('  FAIL', name, '\n', e.stack?.split('\n').slice(0, 4).join('\n')); process.exitCode = 1; } };

// --- fake browser globals
const store = new Map();
globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
const mkEl = () => new Proxy(function () {}, { get: (_, p) => (p === 'style' ? {} : p === 'classList' ? { add() {}, remove() {}, toggle() {}, contains: () => false } : p === Symbol.toPrimitive ? () => '' : mkEl()), apply: () => mkEl(), set: () => true });
globalThis.window = globalThis; globalThis.document = { getElementById: () => mkEl(), createElement: () => mkEl(), querySelectorAll: () => [], addEventListener() {}, removeEventListener() {}, fullscreenElement: null };
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.devicePixelRatio = 1; globalThis.innerWidth = 1280; globalThis.innerHeight = 720;
globalThis.AudioContext = undefined; globalThis.ARENA_CONFIG = {};

console.log('Settings');
const S = await import('../client/js/settings.js');
await t('FOV maximum is exactly 103 and minimum 60', () => {
  assert.equal(S.FOV_MAX, 103); assert.equal(S.FOV_MIN, 60);
  S.settings.set('fov', 200); assert.equal(S.settings.all.fov, 103);
  S.settings.set('fov', 10); assert.equal(S.settings.all.fov, 60);
  S.settings.set('fov', 103); assert.equal(S.settings.all.fov, 103);
});
await t('FPS limit options are 30/60/120/144/165/240/Unlimited', () => { assert.deepEqual(S.FPS_OPTIONS, [30, 60, 120, 144, 165, 240, 0]); S.settings.set('fpsLimit', 165); assert.equal(S.settings.all.fpsLimit, 165); S.settings.set('fpsLimit', 77); assert.equal(S.settings.all.fpsLimit, 144); S.settings.set('fpsLimit', 0); assert.equal(S.settings.all.fpsLimit, 0); });
await t('sensitivity clamps and persists; invertY toggles', () => { S.settings.set('sensitivity', 99); assert.equal(S.settings.all.sensitivity, 10); S.settings.set('sensitivity', 3.3); S.settings.set('invertY', true); assert.equal(S.settings.all.invertY, true); });
await t('subscribers are notified immediately (live apply)', () => { let got = null; const un = S.settings.subscribe((s, p) => (got = p)); S.settings.set('crosshair.size', 20); assert.equal(got, 'crosshair.size'); assert.equal(S.settings.all.crosshair.size, 20); un(); });
await t('settings are saved to localStorage and restored on reload', async () => {
  S.settings.set('audio.music', 0.1); S.settings.set('keys', { ...S.settings.all.keys, jump: 'KeyF' }); S.settings.set('crosshair.color', '#ff0000');
  const saved = JSON.parse(store.get('arena-fps:settings:v1')); assert.equal(saved.audio.music, 0.1); assert.equal(saved.keys.jump, 'KeyF');
  const S2 = await import('../client/js/settings.js?reload=1'); assert.equal(S2.settings.all.keys.jump, 'KeyF'); assert.equal(S2.settings.all.crosshair.color, '#ff0000'); assert.equal(S2.settings.all.fov, 103); assert.equal(S2.settings.all.sensitivity, 3.3);
});
await t('corrupt / hostile saved data falls back to safe values', async () => {
  store.set('arena-fps:settings:v1', JSON.stringify({ fov: 'abc', fpsLimit: -5, quality: 'ultra', crosshair: { color: 'javascript:alert(1)', size: 9999 }, audio: { master: 50 } }));
  const S3 = await import('../client/js/settings.js?reload=2'); const a = S3.settings.all;
  assert.ok(a.fov >= 60 && a.fov <= 103); assert.equal(a.quality, 'high'); assert.match(a.crosshair.color, /^#[0-9a-f]{6}$/i); assert.equal(a.crosshair.size, 40); assert.equal(a.audio.master, 1);
});
await t('reset restores defaults', () => { S.settings.reset(); assert.equal(S.settings.all.fov, S.DEFAULTS.fov); assert.equal(S.settings.all.keys.jump, 'Space'); });

console.log('Module graph (three stubbed)');
const clientDir = path.join(here, '../client/js');
const names = new Set(); for (const f of fs.readdirSync(clientDir)) for (const m of fs.readFileSync(path.join(clientDir, f), 'utf8').matchAll(/THREE\.(\w+)/g)) names.add(m[1]);
const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'stub-'));
const handler = { get: (_, p) => (p === Symbol.toPrimitive ? () => 0 : p === 'then' ? undefined : mkStub()), apply: () => mkStub(), construct: () => mkStub(), set: () => true };
function mkStub() { return new Proxy(function () {}, handler); }
globalThis.__stub = mkStub;
fs.writeFileSync(path.join(tmp, 'three.mjs'), [...names].map(n => `export const ${n} = globalThis.__stub();`).join('\n'));
fs.writeFileSync(path.join(tmp, 'sio.mjs'), 'export const io = () => ({ on(){}, emit(){}, connected:false, timeout(){ return { emit(){} }; } });');
const { register } = await import('node:module');
const sharedDir = pathToFileURL(path.join(here, '../shared') + '/').href;
const hooks = `export async function resolve(s, c, n) { if (s.startsWith('../shared/')) return n(new URL(s.slice(10), ${JSON.stringify(sharedDir)}).href, c); if (s === 'three') return { url: ${JSON.stringify(pathToFileURL(path.join(tmp, 'three.mjs')).href)}, shortCircuit: true }; if (s.endsWith('socket.io.esm.min.js')) return { url: ${JSON.stringify(pathToFileURL(path.join(tmp, 'sio.mjs')).href)}, shortCircuit: true }; return n(s, c); }`;
fs.writeFileSync(path.join(tmp, 'hooks.mjs'), hooks); register(pathToFileURL(path.join(tmp, 'hooks.mjs')));
for (const f of ['character', 'world', 'viewmodel', 'audio', 'net', 'hud', 'settings-ui', 'game']) {
  await t(`client/js/${f}.js loads and all its imports resolve`, async () => { await import(`../client/js/${f}.js?g=1`); });
}
await t('main.js evaluates (screens, handlers wired)', async () => { await import('../client/js/main.js?g=1'); });
console.log(`\n${pass} passed`);
process.exit(process.exitCode ?? 0);
