// Constants shared by server and client. Anything that affects simulation lives here
// so client-side prediction and the authoritative server stay identical.
export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;
export const SNAPSHOT_EVERY = 2;          // snapshots at 30 Hz
export const INTERP_TICKS = 6;            // client renders remote players 100 ms in the past
export const HISTORY_TICKS = 64;          // lag-compensation history on the server
export const MAX_REWIND_TICKS = 30;       // never rewind more than 500 ms

export const PLAYER = {
  radius: 0.4,
  height: 1.8,
  eye: 1.62,
  headY: 1.45,        // hits above this (relative to feet) count as headshots
  headshotMult: 1.5,
};

export const MOVE = {
  groundSpeed: 8.0,
  accel: 10.0,
  airAccel: 10.0,
  airWishCap: 0.75,   // Quake-style air-strafe cap
  friction: 6.0,
  stopSpeed: 2.0,
  jump: 7.6,
  gravity: 22.0,
  stepHeight: 0.5,
  maxFall: 40,
};

export const RULE_LIMITS = {
  duration: [60, 900],
  scoreLimit: [1, 50],
  startHealth: [50, 200],
  gravityScale: [0.5, 1.5],
  respawnDelay: [1, 5],
  ffaPlayers: [3, 8],
};

export const DEFAULT_SETTINGS = {
  mode: 'duel',            // 'duel' | 'ffa'
  map: 'foundry',
  maxPlayers: 2,
  weapons: ['pistol', 'machinegun', 'shotgun', 'railgun'],
  duration: 300,
  scoreLimit: 10,
  isPublic: true,
  rules: { startHealth: 100, gravityScale: 1, respawnDelay: 2, pickups: true },
};

export const SKINS = {
  models: ['trooper', 'droid', 'ronin', 'phantom'],
  colors: ['#ff3b3b', '#ff8a1f', '#ffd21f', '#3bd16f', '#1fd1c9', '#3b8bff', '#8a5bff', '#ff4fb0', '#e8e8f0', '#2b2f3a'],
};
