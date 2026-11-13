// Builds a static copy of the client in ./dist for hosting on a Render Static Site (or any CDN).
// Usage: SERVER_URL=https://your-backend.onrender.com npm run build:client
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const SERVER_URL = process.env.SERVER_URL || '';
if (!SERVER_URL) console.warn('WARNING: SERVER_URL is not set; the static client will try to connect to its own origin.');

fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(path.join(root, 'client'), dist, { recursive: true });
fs.cpSync(path.join(root, 'shared'), path.join(dist, 'shared'), { recursive: true });
fs.cpSync(path.join(root, 'node_modules/three/build'), path.join(dist, 'vendor/three'), { recursive: true });
fs.cpSync(path.join(root, 'node_modules/socket.io-client/dist'), path.join(dist, 'vendor/socket.io'), { recursive: true });
fs.writeFileSync(path.join(dist, 'config.js'), `window.ARENA_CONFIG = { SERVER_URL: ${JSON.stringify(SERVER_URL)} };\n`);
console.log(`Client built to ${dist} (server: ${SERVER_URL || 'same origin'})`);
