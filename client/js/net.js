// Socket.IO wrapper: connection, profile login, RTT measurement. The socket lives outside the render loop,
// so FPS limiting can never delay inbound/outbound packets.
import { io } from '../vendor/socket.io/socket.io.esm.min.js';

const TOKEN_KEY = 'arena-fps:token';
const SERVER_URL = (window.ARENA_CONFIG && window.ARENA_CONFIG.SERVER_URL) || undefined;  // undefined => same origin

export const net = {
  socket: null, id: null, profile: null, ping: 0, handlers: {},
  connect() {
    return new Promise((resolve, reject) => {
      const s = this.socket = io(SERVER_URL, { transports: ['websocket', 'polling'], reconnection: true });
      s.on('connect', async () => {
        this.id = s.id;
        let token = null; try { token = localStorage.getItem(TOKEN_KEY); } catch { /* ignore */ }
        const r = await this.emit('hello', { token, name: this.profile?.name });
        if (r.ok) { try { localStorage.setItem(TOKEN_KEY, r.token); } catch { /* ignore */ } this.profile = r.profile; resolve(r); this.fire('connected', r); }
      });
      s.on('connect_error', e => { reject(e); this.fire('error', e); });
      s.on('disconnect', reason => this.fire('disconnected', reason));
      for (const ev of ['room:state', 'match:start', 'match:end', 'snap', 'ev']) s.on(ev, d => this.fire(ev, d));
      setInterval(() => { // independent RTT probe
        if (!s.connected) return; const t = performance.now();
        s.timeout(3000).emit('ping:c', null, err => { if (!err) this.ping = Math.round(performance.now() - t); });
      }, 1000);
    });
  },
  on(ev, fn) { (this.handlers[ev] ||= new Set()).add(fn); return () => this.handlers[ev].delete(fn); },
  fire(ev, d) { this.handlers[ev]?.forEach(fn => fn(d)); },
  emit(ev, data) {
    return new Promise(res => { this.socket.timeout(8000).emit(ev, data, (err, r) => res(err ? { ok: false, error: 'Server timeout' } : r)); });
  },
  input(cmd) { this.socket?.volatile.emit('input', cmd); },
};
