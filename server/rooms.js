// Room registry + fixed-timestep game loop.
import { Room } from './room.js';
import { TICK_RATE } from '../shared/constants.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class RoomManager {
  constructor(store) {
    this.store = store;
    this.rooms = new Map();
    this.loop = null;
  }
  genCode() {
    for (;;) {
      let c = ''; for (let i = 0; i < 5; i++) c += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
      if (!this.rooms.has(c)) return c;
    }
  }
  create(settings) {
    const room = new Room(this.genCode(), settings, {
      onEmpty: r => this.rooms.delete(r.code),
      onStats: (pid, d) => this.store.addStats(pid, d),
    });
    this.rooms.set(room.code, room);
    return room;
  }
  get(code) { return this.rooms.get(String(code || '').trim().toUpperCase()); }
  listPublic() {
    return [...this.rooms.values()].filter(r => r.settings.isPublic).map(r => r.summary());
  }
  findQuick() {
    return [...this.rooms.values()].find(r => r.settings.isPublic && !r.canJoin() && r.state === 'lobby')
        || [...this.rooms.values()].find(r => r.settings.isPublic && !r.canJoin());
  }
  /** Fixed 60 Hz loop independent of any rendering/FPS concerns. */
  startLoop() {
    const step = 1000 / TICK_RATE;
    let last = performance.now(), acc = 0;
    this.loop = setInterval(() => {
      const now = performance.now();
      acc += Math.min(now - last, 250); last = now;
      while (acc >= step) {
        acc -= step;
        for (const r of this.rooms.values()) {
          try { r.update(); } catch (e) { console.error('room update error', r.code, e); }
        }
      }
    }, 4);
  }
  stopLoop() { clearInterval(this.loop); }
}
