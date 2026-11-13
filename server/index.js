import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { Store, sanitizeName, sanitizeSkin } from './store.js';
import { RoomManager } from './rooms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(root, 'data');
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || '*';   // set to your static-site URL if hosted separately

const store = new Store(DATA_DIR);
const manager = new RoomManager(store);
manager.startLoop();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_ORIGIN === '*' ? '*' : CLIENT_ORIGIN.split(',') },
  pingInterval: 10000, pingTimeout: 20000, maxHttpBufferSize: 1e5,
});

app.disable('x-powered-by');
app.get('/healthz', (_req, res) => res.json({ ok: true, rooms: manager.rooms.size }));
app.use('/vendor/three', express.static(path.join(root, 'node_modules/three/build')));
app.use('/vendor/socket.io', express.static(path.join(root, 'node_modules/socket.io-client/dist')));
app.use('/shared', express.static(path.join(root, 'shared')));
app.use(express.static(path.join(root, 'client')));

const ok = (cb, data = {}) => typeof cb === 'function' && cb({ ok: true, ...data });
const fail = (cb, error) => typeof cb === 'function' && cb({ ok: false, error });

io.on('connection', socket => {
  let token = null;
  let profile = null;
  let room = null;

  const leave = () => { if (room) { room.removeMember(socket.id); socket.leave(room.code); room = null; } };
  const enter = (r, cb) => {
    const err = r.canJoin(); if (err) return fail(cb, err);
    leave();
    room = r; socket.join(r.code);
    r.addMember({
      id: socket.id, pid: token, name: profile.name, skin: profile.skin,
      emit: (ev, data) => socket.emit(ev, data),
    });
    ok(cb, { code: r.code, info: r.roomInfo() });
  };

  socket.on('hello', (d, cb) => {
    const r = store.login(d?.token, d?.name);
    token = r.token; profile = r.profile;
    ok(cb, { token, id: socket.id, profile });
  });
  socket.on('profile:get', (_d, cb) => (profile ? ok(cb, { profile }) : fail(cb, 'Not logged in')));
  socket.on('profile:save', (d, cb) => {
    if (!token) return fail(cb, 'Not logged in');
    profile = store.update(token, { name: sanitizeName(d?.name), skin: sanitizeSkin(d?.skin) });
    room?.updateProfile(socket.id, profile);
    ok(cb, { profile });
  });
  socket.on('rooms:list', (_d, cb) => ok(cb, { rooms: manager.listPublic() }));
  socket.on('room:create', (d, cb) => {
    if (!profile) return fail(cb, 'Not logged in');
    const r = manager.create({ ...(d?.settings || {}), isPublic: d?.settings?.isPublic !== false });
    enter(r, cb);
  });
  socket.on('room:join', (d, cb) => {
    if (!profile) return fail(cb, 'Not logged in');
    const r = manager.get(d?.code); if (!r) return fail(cb, 'Room not found');
    enter(r, cb);
  });
  socket.on('room:quick', (_d, cb) => {
    if (!profile) return fail(cb, 'Not logged in');
    enter(manager.findQuick() || manager.create({ mode: 'duel', isPublic: true }), cb);
  });
  socket.on('room:leave', (_d, cb) => { leave(); ok(cb); });
  socket.on('room:settings', (d, cb) => { const e = room?.setSettings(socket.id, d); e ? fail(cb, e) : ok(cb); });
  socket.on('room:start', (_d, cb) => { const e = room?.start(socket.id); e ? fail(cb, e) : ok(cb); });
  socket.on('room:end', (_d, cb) => { const e = room?.end(socket.id); e ? fail(cb, e) : ok(cb); });
  socket.on('input', cmd => room?.pushInput(socket.id, cmd));
  socket.on('ping:c', (_d, cb) => typeof cb === 'function' && cb());
  socket.on('disconnect', leave);
});

server.listen(PORT, '0.0.0.0', () => console.log(`Arena FPS listening on :${PORT} (data: ${DATA_DIR})`));

const shutdown = () => { manager.stopLoop(); io.close(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
