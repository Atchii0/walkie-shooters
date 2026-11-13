// Weapon definitions. Intervals are in server ticks (60/s).
export const WEAPONS = {
  pistol:     { id: 'pistol',     name: 'Sidearm',     slot: 1, damage: 18, pellets: 1,  spread: 0.004, interval: 20, infinite: true, startAmmo: 0,  maxAmmo: 0,  auto: false, range: 120, color: '#ffe08a', desc: 'Reliable semi-auto. Infinite ammo.' },
  machinegun: { id: 'machinegun', name: 'Machinegun',  slot: 2, damage: 7,  pellets: 1,  spread: 0.014, interval: 5,  infinite: false, startAmmo: 80, maxAmmo: 180, auto: true, range: 120, color: '#8affc1', desc: 'High rate of fire, light damage.' },
  shotgun:    { id: 'shotgun',    name: 'Shotgun',     slot: 3, damage: 9,  pellets: 10, spread: 0.075, interval: 52, infinite: false, startAmmo: 10, maxAmmo: 30,  auto: false, range: 40,  color: '#ff9a5c', desc: '10 pellets. Devastating up close.' },
  railgun:    { id: 'railgun',    name: 'Railgun',     slot: 4, damage: 80, pellets: 1,  spread: 0,     interval: 85, infinite: false, startAmmo: 6,  maxAmmo: 15,  auto: false, range: 300, color: '#8ab8ff', desc: 'Pinpoint, one-hit-ish. Slow reload.' },
};
export const WEAPON_IDS = Object.keys(WEAPONS);
export const SWITCH_COOLDOWN = 12;
