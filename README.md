# ARENA — multiplayer browser arena FPS

Three.js client · Node + Socket.IO server · **server-authoritative** simulation · 1v1 Duel and Free-For-All.

## Run locally
```bash
npm install
npm start            # http://localhost:3000
npm test             # 49 automated tests (simulation, rooms, combat, store, settings, module graph)
```
Open two browser windows (or two machines on your LAN), click **Create Room** in one, copy the 5-letter code, **Join Room** in the other, then the leader presses **Start match**.

## Deploy on Render (single service, recommended)
1. Push this folder to a GitHub repo.
2. Render Dashboard → **New → Blueprint** → select the repo. `render.yaml` creates one Node **Web Service** that runs the game server *and* serves the client (same origin → no CORS/WebSocket config needed).
   *(Or **New → Web Service** manually: Build `npm ci --omit=dev`, Start `npm start`, Health check `/healthz`.)*
3. Open `https://<your-service>.onrender.com`, share a room code with a friend.

Environment variables

| Name | Default | Purpose |
|---|---|---|
| `PORT` | set by Render | HTTP/WebSocket port |
| `DATA_DIR` | `./data` | where `players.json` (profiles/skins/stats) is stored |
| `CLIENT_ORIGIN` | `*` | allowed origins if the client is hosted elsewhere (comma-separated) |
| `NODE_VERSION` | 20.18.0 | Node runtime |

**Free-plan caveats:** the service sleeps after ~15 min idle (first visit takes ~30 s to wake; live matches keep it awake), and the filesystem is ephemeral, so profiles reset on redeploy. For persistent accounts use a paid plan, add a Disk mounted at `/var/data` and set `DATA_DIR=/var/data` (see commented block in `render.yaml`), or replace `server/store.js` with a Postgres-backed implementation (same 4 methods).

### Optional: separate static frontend
```bash
SERVER_URL=https://<your-backend>.onrender.com npm run build:client   # outputs ./dist
```
Create a Render **Static Site** with build command `npm ci && SERVER_URL=https://<backend>.onrender.com npm run build:client` and publish dir `dist`; set `CLIENT_ORIGIN=https://<static-site>.onrender.com` on the backend.

## Architecture
```
shared/   constants, weapons, maps, sim.js (movement+collision+raycast) — imported by BOTH sides
server/   index.js (Express+Socket.IO) · rooms.js (registry + 60 Hz loop) · room.js (lobby, rules, match, combat) · store.js (profiles)
client/   index.html · css · js/{main,game,world,viewmodel,character,hud,settings,settings-ui,audio,net}.js
test/     run.js (server/sim) · client.test.js (settings + module graph)
```
* **Netcode:** client predicts with the same `stepPlayer` at a fixed 60 Hz (own timer, *not* the render loop) and sends commands; server simulates authoritatively, sends 30 Hz snapshots + ack; client reconciles by replaying unacknowledged commands (with smoothed error correction). Remote players are interpolated 100 ms behind.
* **Hit validation:** all damage is computed on the server by hitscan against **lag-compensated** positions (rewound up to 500 ms using the client's render timestamp), blocked by world geometry, with headshots, spawn protection, weapon cooldown/ammo enforced server-side. Input is sanitised and queue-bounded (speed-hack resistant).
* **FPS limiter** only skips *drawing*; simulation and Socket.IO run on separate timers, so capping FPS never delays networking.

## Features
* Modes: 1v1 Duel, FFA (3–8), public rooms (browser list + quick play) and private rooms (code), 5-letter codes.
* Leader-only controls: mode, map (Foundry / Skybridge / Crypt), max players, allowed weapons, duration, score limit, start health, gravity, respawn delay, pickups, visibility, start/end match. Leadership transfers if the leader leaves.
* 4 weapons (Sidearm, Machinegun, Shotgun, Railgun) with distinct damage/rate/spread/pellets/ammo; pickups; synthesised sounds; viewmodel animations.
* Locker: 4 character models × custom primary/secondary/visor colors, live 3D preview, saved to your profile (server) .
* Settings (all live, saved to localStorage): FOV 60–**103**, FPS limit 30/60/120/144/165/240/Unlimited, fullscreen, graphics quality, FPS + ping counters, one linear sensitivity slider, invert Y, rebindable keys, 5 volume controls + mute, crosshair style/size/gap/thickness/color/opacity, hitmarker and damage-indicator toggles.

Controls (defaults): WASD move · Space jump (hold to bunny-hop) · mouse aim/fire · 1–4 / wheel / Q,E weapons · Tab scoreboard · Esc pause.

## Known limitations
* Accounts are anonymous tokens stored in the browser (no passwords/email login).
* Hitscan weapons only; no projectile weapons yet. Maps are box-based.
* Persistence is a JSON file (see free-plan caveat above).
