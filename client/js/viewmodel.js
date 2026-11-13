// First-person weapon models, bobbing, recoil and switch animations, muzzle flash.
import * as THREE from 'three';
import { WEAPONS } from '../shared/weapons.js';

const std = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.5, ...o });
const bx = (w, h, d, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); return o; };

function buildGun(id) {
  const g = new THREE.Group(); const dark = std(0x23262e), mid = std(0x4a505e), acc = std(WEAPONS[id].color, { emissive: WEAPONS[id].color, emissiveIntensity: 0.6 });
  if (id === 'pistol') { g.add(bx(0.07, 0.1, 0.3, mid), bx(0.05, 0.05, 0.14, dark, 0, 0.01, -0.2), bx(0.06, 0.14, 0.07, dark, 0, -0.1, 0.08), bx(0.075, 0.015, 0.2, acc, 0, 0.055, -0.02)); g.userData.muzzle = [0, 0.01, -0.3]; }
  else if (id === 'machinegun') { g.add(bx(0.09, 0.13, 0.55, mid), bx(0.05, 0.05, 0.3, dark, 0, 0.02, -0.4), bx(0.07, 0.18, 0.09, dark, 0, -0.14, 0.05), bx(0.1, 0.02, 0.3, acc, 0, 0.075, -0.05), bx(0.12, 0.1, 0.1, dark, 0, 0.1, 0.18)); g.userData.muzzle = [0, 0.02, -0.58]; }
  else if (id === 'shotgun') { g.add(bx(0.1, 0.11, 0.7, mid), bx(0.05, 0.05, 0.5, dark, -0.035, 0.0, -0.55), bx(0.05, 0.05, 0.5, dark, 0.035, 0.0, -0.55), bx(0.11, 0.09, 0.22, dark, 0, -0.07, -0.25), bx(0.11, 0.02, 0.4, acc, 0, 0.065, -0.1)); g.userData.muzzle = [0, 0, -0.82]; }
  else { g.add(bx(0.09, 0.12, 0.8, mid), bx(0.035, 0.035, 0.5, dark, 0, 0.02, -0.65), bx(0.12, 0.03, 0.6, acc, 0, 0.075, -0.1), bx(0.02, 0.1, 0.5, acc, 0.055, 0, -0.1), bx(0.02, 0.1, 0.5, acc, -0.055, 0, -0.1), bx(0.07, 0.17, 0.08, dark, 0, -0.14, 0.15)); g.userData.muzzle = [0, 0.02, -0.92]; }
  return g;
}

export class ViewModel {
  constructor(camera) {
    this.root = new THREE.Group(); camera.add(this.root);
    this.guns = {}; this.current = null; this.recoil = 0; this.switchT = 1; this.bobT = 0; this.flashT = 0; this.kick = 0;
    this.flash = new THREE.PointLight(0xffd080, 0, 6); this.root.add(this.flash);
    this.flashMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.28), new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    this.root.add(this.flashMesh);
    this.base = new THREE.Vector3(0.22, -0.2, -0.38);
    for (const id of Object.keys(WEAPONS)) { const g = buildGun(id); g.visible = false; g.traverse(o => { o.frustumCulled = false; o.renderOrder = 10; }); this.guns[id] = g; this.root.add(g); }
  }
  setWeapon(id) {
    if (this.current === id) return; if (this.current) this.guns[this.current].visible = false;
    this.current = id; if (id) { this.guns[id].visible = true; this.switchT = 0; this.flashMesh.material.color.set(WEAPONS[id].color); this.flashMesh.material.color.lerp(new THREE.Color(0xffffff), 0.5); }
  }
  fire() { const w = WEAPONS[this.current]; if (!w) return; this.recoil = Math.min(1, this.recoil + (w.id === 'shotgun' ? 1 : w.id === 'railgun' ? 0.9 : 0.35)); this.flashT = w.id === 'machinegun' ? 0.04 : 0.07; this.flashMesh.rotation.z = Math.random() * 6; }
  update(dt, speed, onGround, visible) {
    this.root.visible = visible;
    this.recoil = Math.max(0, this.recoil - dt * 6); this.switchT = Math.min(1, this.switchT + dt * 5);
    this.flashT = Math.max(0, this.flashT - dt);
    if (onGround) this.bobT += dt * Math.min(speed, 9) * 1.3;
    const bobAmt = onGround ? Math.min(speed / 8, 1) : 0;
    const sw = (1 - this.switchT); const ease = sw * sw;
    this.root.position.set(
      this.base.x + Math.sin(this.bobT) * 0.012 * bobAmt,
      this.base.y + Math.abs(Math.cos(this.bobT)) * 0.012 * bobAmt - ease * 0.35,
      this.base.z + this.recoil * 0.09);
    this.root.rotation.set(this.recoil * 0.12 + ease * 0.6, 0, 0);
    const w = this.guns[this.current];
    if (w) {
      const m = w.userData.muzzle; this.flashMesh.position.set(m[0], m[1], m[2] - 0.05);
      this.flash.position.set(m[0], m[1], m[2] - 0.1);
      this.flashMesh.material.opacity = this.flashT > 0 ? 1 : 0; this.flash.intensity = this.flashT > 0 ? 8 : 0;
    }
  }
}
