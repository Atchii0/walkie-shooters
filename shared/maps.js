// Arena maps: axis-aligned boxes. Compact on purpose.
// box = { min:[x,y,z], max:[x,y,z], kind }
const box = (x0, y0, z0, x1, y1, z1, kind = 'wall') => ({ min: [x0, y0, z0], max: [x1, y1, z1], kind });
const centered = (cx, cz, w, d, h, y0 = 0, kind = 'wall') => box(cx - w / 2, y0, cz - d / 2, cx + w / 2, y0 + h, cz + d / 2, kind);

// Stairs whose TOP edge is at (sx,sz); they descend outward in direction (dx,dz).
// Step height must stay <= MOVE.stepHeight so players can walk up without jumping.
function stairs(sx, sz, dx, dz, width, n, sh = 0.4, sd = 1.1) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = i * sd, b = (i + 1) * sd, hgt = (n - i) * sh;
    const x0 = sx + dx * a, x1 = sx + dx * b, z0 = sz + dz * a, z1 = sz + dz * b;
    const hw = width / 2;
    if (dx !== 0) out.push(box(Math.min(x0, x1), 0, sz - hw, Math.max(x0, x1), hgt, sz + hw, 'stairs'));
    else out.push(box(sx - hw, 0, Math.min(z0, z1), sx + hw, hgt, Math.max(z0, z1), 'stairs'));
  }
  return out;
}

function foundry() {
  const b = [];
  b.push(centered(0, 0, 10, 10, 1.2, 0, 'platform'));
  b.push(...stairs(5, 0, 1, 0, 4, 3));
  b.push(...stairs(-5, 0, -1, 0, 4, 3));
  b.push(...stairs(0, 5, 0, 1, 4, 3));
  b.push(...stairs(0, -5, 0, -1, 4, 3));
  for (const [x, z] of [[-13, -13], [13, -13], [-13, 13], [13, 13]]) b.push(centered(x, z, 2.4, 2.4, 6, 0, 'pillar'));
  for (const [x, z, w, d] of [[-13, 0, 1, 6], [13, 0, 1, 6], [0, -14, 6, 1], [0, 14, 6, 1]]) b.push(centered(x, z, w, d, 2.2, 0, 'wall'));
  b.push(centered(-8, 8, 3, 1, 1.2, 0, 'crate'), centered(8, -8, 3, 1, 1.2, 0, 'crate'));
  return {
    id: 'foundry', name: 'Foundry', desc: 'Central platform, pillars, tight sightlines.',
    bounds: { x: 20, z: 20 }, boxes: b,
    spawns: [[-16, -16, 0.8], [16, 16, 3.9], [16, -16, 2.4], [-16, 16, 5.5], [0, -18, 0], [0, 18, 3.14], [-18, 0, 1.57], [18, 0, -1.57]].map(([x, z, yaw]) => ({ x, y: 0, z, yaw })),
    pickups: [
      { type: 'health', x: 0, y: 1.2, z: 0 }, { type: 'ammo', x: -9, y: 0, z: -9 }, { type: 'ammo', x: 9, y: 0, z: 9 },
      { type: 'health', x: -17, y: 0, z: 17 }, { type: 'health', x: 17, y: 0, z: -17 },
    ],
    theme: { sky: '#1b1424', fog: '#2a1b30', floor: '#3a3340', wall: '#6b4a3a', accent: '#ff7a2f', light: '#ffd2a8' },
  };
}

function skybridge() {
  const b = [];
  b.push(centered(-11, 0, 8, 8, 3, 0, 'platform'), centered(11, 0, 8, 8, 3, 0, 'platform'));
  b.push(box(-7, 2.6, -1.5, 7, 3, 1.5, 'bridge'));
  b.push(...stairs(-11, 4, 0, 1, 3, 8, 0.375, 1.0));
  b.push(...stairs(11, -4, 0, -1, 3, 8, 0.375, 1.0));
  b.push(centered(0, -9, 4, 1, 2, 0, 'wall'), centered(0, 9, 4, 1, 2, 0, 'wall'));
  b.push(centered(0, 0, 2, 2, 2, 0, 'pillar')); // under the bridge
  b.push(centered(-5, -12, 2, 2, 1.2, 0, 'crate'), centered(5, 12, 2, 2, 1.2, 0, 'crate'));
  return {
    id: 'skybridge', name: 'Skybridge', desc: 'Two towers joined by an exposed bridge.',
    bounds: { x: 17, z: 17 }, boxes: b,
    spawns: [[-14, -14, 0.8], [14, 14, 3.9], [14, -14, 2.4], [-14, 14, 5.5], [0, -15, 0], [0, 15, 3.14], [-15, 0, 1.57], [15, 0, -1.57]].map(([x, z, yaw]) => ({ x, y: 0, z, yaw })),
    pickups: [
      { type: 'health', x: -11, y: 3, z: 0 }, { type: 'ammo', x: 11, y: 3, z: 0 }, { type: 'health', x: 0, y: 3, z: 0 },
      { type: 'ammo', x: -5, y: 0, z: 12 }, { type: 'ammo', x: 5, y: 0, z: -12 },
    ],
    theme: { sky: '#0f2238', fog: '#173a5a', floor: '#2b3b4a', wall: '#4d6a85', accent: '#3be0ff', light: '#cfe9ff' },
  };
}

function cryptmap() {
  const b = [];
  // Small box-arena of corridors: good for duels.
  b.push(centered(0, 0, 3, 14, 3, 0, 'wall'));
  b.push(centered(-8, 0, 3, 3, 3, 0, 'wall'), centered(8, 0, 3, 3, 3, 0, 'wall'));
  b.push(centered(-5, -8, 8, 1, 3, 0, 'wall'), centered(5, 8, 8, 1, 3, 0, 'wall'));
  b.push(centered(-12, 7, 1, 8, 3, 0, 'wall'), centered(12, -7, 1, 8, 3, 0, 'wall'));
  b.push(centered(0, -12, 3, 3, 1.2, 0, 'crate'), centered(0, 12, 3, 3, 1.2, 0, 'crate'));
  return {
    id: 'crypt', name: 'Crypt', desc: 'Tight corridors. Made for duels.',
    bounds: { x: 15, z: 15 }, boxes: b,
    spawns: [[-13, -13, 0.8], [13, 13, 3.9], [13, -13, 2.4], [-13, 13, 5.5], [-6, 0, 1.57], [6, 0, -1.57], [0, -5, 0], [0, 5, 3.14]].map(([x, z, yaw]) => ({ x, y: 0, z, yaw })),
    pickups: [
      { type: 'health', x: 0, y: 0, z: -4 }, { type: 'health', x: 0, y: 0, z: 4 },
      { type: 'ammo', x: -10, y: 0, z: 10 }, { type: 'ammo', x: 10, y: 0, z: -10 },
    ],
    theme: { sky: '#0c1410', fog: '#16251b', floor: '#2a332c', wall: '#4a5d4e', accent: '#7dff9b', light: '#d6ffe0' },
  };
}

export const MAPS = { foundry: foundry(), skybridge: skybridge(), crypt: cryptmap() };
export const MAP_IDS = Object.keys(MAPS);
