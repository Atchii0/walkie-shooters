// Tiny JSON-file persistence for player profiles (anonymous token accounts).
// Swap this module for Postgres/Redis if you need data to survive redeploys on Render's free tier
// (the free filesystem is ephemeral; attach a Render Disk and set DATA_DIR to keep this file).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { SKINS } from '../shared/constants.js';

export function sanitizeName(n) {
  n = String(n ?? '').replace(/[^\w \-.]/g, '').trim().slice(0, 16);
  return n || 'Player' + Math.floor(1000 + Math.random() * 9000);
}
export function sanitizeSkin(s = {}) {
  const hex = (c, d) => (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c.toLowerCase() : d);
  return {
    model: SKINS.models.includes(s.model) ? s.model : 'trooper',
    primary: hex(s.primary, '#3b8bff'),
    secondary: hex(s.secondary, '#2b2f3a'),
    visor: hex(s.visor, '#1fd1c9'),
  };
}

export class Store {
  constructor(dir) {
    try { fs.mkdirSync(dir, { recursive: true }); fs.accessSync(dir, fs.constants.W_OK); }
    catch { dir = path.join(os.tmpdir(), 'arena-fps-data'); fs.mkdirSync(dir, { recursive: true }); console.warn('DATA_DIR not writable; using', dir); }
    this.file = path.join(dir, 'players.json');
    this.data = { players: {} };
    this.timer = null;
    try { this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* fresh */ }
    if (!this.data.players) this.data.players = {};
  }
  /** Returns profile for token, creating one when unknown. Token is a secret bearer id. */
  login(token, name) {
    if (!token || !this.data.players[token]) {
      token = crypto.randomBytes(16).toString('hex');
      this.data.players[token] = { name: sanitizeName(name), skin: sanitizeSkin(), stats: { kills: 0, deaths: 0, matches: 0, wins: 0 }, created: Date.now() };
      this.save();
    }
    return { token, profile: this.data.players[token] };
  }
  update(token, patch) {
    const p = this.data.players[token]; if (!p) return null;
    if (patch.name !== undefined) p.name = sanitizeName(patch.name);
    if (patch.skin) p.skin = sanitizeSkin(patch.skin);
    this.save(); return p;
  }
  addStats(token, d) {
    const p = this.data.players[token]; if (!p) return;
    for (const k of Object.keys(d)) p.stats[k] = (p.stats[k] || 0) + d[k];
    this.save();
  }
  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try { const tmp = this.file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(this.data)); fs.renameSync(tmp, this.file); }
      catch (e) { console.error('store save failed', e.message); }
    }, 500);
    this.timer.unref?.();
  }
}
