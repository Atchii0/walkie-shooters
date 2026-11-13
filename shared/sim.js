// Deterministic player movement + collision + ray helpers, shared by client prediction and server.
import { DT, PLAYER, MOVE } from './constants.js';

const EPS = 1e-4;

export function forwardVec(yaw) { return [-Math.sin(yaw), -Math.cos(yaw)]; }
export function rightVec(yaw) { return [Math.cos(yaw), -Math.sin(yaw)]; }
export function aimDir(yaw, pitch) {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

export function newMoveState(x = 0, y = 0, z = 0) {
  return { x, y, z, vx: 0, vy: 0, vz: 0, onGround: false };
}

function overlaps(s, b) {
  const r = PLAYER.radius;
  return s.x + r > b.min[0] && s.x - r < b.max[0] &&
         s.y + PLAYER.height > b.min[1] && s.y < b.max[1] &&
         s.z + r > b.min[2] && s.z - r < b.max[2];
}

function accelerate(s, wx, wz, wishSpeed, accel, capSpeed) {
  const cur = s.vx * wx + s.vz * wz;
  const add = Math.min(wishSpeed, capSpeed) - cur;
  if (add <= 0) return;
  const a = Math.min(accel * wishSpeed * DT, add);
  s.vx += a * wx; s.vz += a * wz;
}

/**
 * Advance one fixed tick. cmd = { f:-1..1, r:-1..1, j:bool, yaw }.
 * map = { boxes, bounds:{x,z} }, rules = { gravityScale }.
 */
export function stepPlayer(s, cmd, map, rules) {
  const gScale = (rules && rules.gravityScale) || 1;
  const [fx, fz] = forwardVec(cmd.yaw);
  const [rx, rz] = rightVec(cmd.yaw);
  let wx = fx * cmd.f + rx * cmd.r, wz = fz * cmd.f + rz * cmd.r;
  const wl = Math.hypot(wx, wz);
  if (wl > 0) { wx /= wl; wz /= wl; }
  const wishSpeed = wl > 0 ? MOVE.groundSpeed : 0;

  let jumped = false;
  if (s.onGround && cmd.j) { s.vy = MOVE.jump; s.onGround = false; jumped = true; }

  if (s.onGround) {
    const sp = Math.hypot(s.vx, s.vz);
    if (sp > 0) {
      const drop = Math.max(sp, MOVE.stopSpeed) * MOVE.friction * DT;
      const k = Math.max(sp - drop, 0) / sp;
      s.vx *= k; s.vz *= k;
    }
    if (wl > 0) accelerate(s, wx, wz, wishSpeed, MOVE.accel, wishSpeed);
  } else if (wl > 0) {
    accelerate(s, wx, wz, wishSpeed, MOVE.airAccel, MOVE.airWishCap);
  }

  s.vy -= MOVE.gravity * gScale * DT;
  if (s.vy < -MOVE.maxFall) s.vy = -MOVE.maxFall;

  const boxes = map.boxes;
  const wasGround = s.onGround;

  // X axis
  s.x += s.vx * DT;
  for (const b of boxes) if (overlaps(s, b)) {
    const top = b.max[1] - s.y;
    if (top > 0 && top <= MOVE.stepHeight && (wasGround || s.onGround)) {
      const prevY = s.y; s.y = b.max[1] + EPS;
      let blocked = false; for (const o of boxes) if (o !== b && overlaps(s, o)) { blocked = true; break; }
      if (!blocked) continue; s.y = prevY;
    }
    s.x = s.vx > 0 ? b.min[0] - PLAYER.radius - EPS : b.max[0] + PLAYER.radius + EPS; s.vx = 0;
  }
  // Z axis
  s.z += s.vz * DT;
  for (const b of boxes) if (overlaps(s, b)) {
    const top = b.max[1] - s.y;
    if (top > 0 && top <= MOVE.stepHeight && (wasGround || s.onGround)) {
      const prevY = s.y; s.y = b.max[1] + EPS;
      let blocked = false; for (const o of boxes) if (o !== b && overlaps(s, o)) { blocked = true; break; }
      if (!blocked) continue; s.y = prevY;
    }
    s.z = s.vz > 0 ? b.min[2] - PLAYER.radius - EPS : b.max[2] + PLAYER.radius + EPS; s.vz = 0;
  }
  // Y axis
  s.y += s.vy * DT;
  s.onGround = false;
  if (s.y <= 0) { s.y = 0; if (s.vy < 0) s.vy = 0; s.onGround = true; }
  for (const b of boxes) if (overlaps(s, b)) {
    if (s.vy <= 0) { s.y = b.max[1]; s.vy = 0; s.onGround = true; }
    else { s.y = b.min[1] - PLAYER.height - EPS; s.vy = 0; }
  }
  // Arena bounds
  const bx = map.bounds.x - PLAYER.radius, bz = map.bounds.z - PLAYER.radius;
  if (s.x > bx) { s.x = bx; s.vx = Math.min(s.vx, 0); } else if (s.x < -bx) { s.x = -bx; s.vx = Math.max(s.vx, 0); }
  if (s.z > bz) { s.z = bz; s.vz = Math.min(s.vz, 0); } else if (s.z < -bz) { s.z = -bz; s.vz = Math.max(s.vz, 0); }
  return jumped;
}

/** Ray vs AABB (slab). Returns distance t or -1. */
export function rayBox(o, d, min, max) {
  let tmin = 0, tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (o[i] < min[i] || o[i] > max[i]) return -1; continue; }
    let t1 = (min[i] - o[i]) / d[i], t2 = (max[i] - o[i]) / d[i];
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  return tmin;
}

/** Nearest static-geometry hit distance along ray (floor included), or Infinity. */
export function rayWorld(o, d, map, maxDist) {
  let best = Infinity;
  for (const b of map.boxes) { const t = rayBox(o, d, b.min, b.max); if (t >= 0 && t < best) best = t; }
  if (d[1] < 0) { const t = -o[1] / d[1]; if (t >= 0 && t < best) best = t; }
  return best > maxDist ? Infinity : best;
}

export function playerBox(p) {
  const r = PLAYER.radius;
  return { min: [p.x - r, p.y, p.z - r], max: [p.x + r, p.y + PLAYER.height, p.z + r] };
}
