// Procedural character models driven by skin = { model, primary, secondary, visor }.
import * as THREE from 'three';

const box = (w, h, d, mat) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.25, ...o });

export function buildCharacter(skin) {
  const root = new THREE.Group();
  const P = std(skin.primary), S = std(skin.secondary, { roughness: 0.8, metalness: 0.1 });
  const V = std(skin.visor, { emissive: skin.visor, emissiveIntensity: 1.4, roughness: 0.2 });
  const mats = [P, S, V];
  const pivot = new THREE.Group();        // head + weapon rotate with pitch
  pivot.position.set(0, 1.35, 0);
  const add = (m, x, y, z, parent = root) => { m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };

  const gun = new THREE.Group();
  add(box(0.1, 0.12, 0.55, S), 0, 0, 0, gun); add(box(0.06, 0.06, 0.3, P), 0, 0.02, -0.4, gun);
  gun.position.set(0.3, -0.15, -0.25); pivot.add(gun);

  switch (skin.model) {
    case 'droid': {
      add(box(0.55, 0.12, 0.35, S), 0, 0.05, 0);
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.8, 14), P), 0, 1.0, 0);
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.7, 8), S), -0.2, 0.4, 0); add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.7, 8), S), 0.2, 0.4, 0);
      const head = add(new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12), P), 0, 0.1, 0, pivot);
      add(box(0.3, 0.1, 0.1, V), 0, 0.05, -0.22, pivot);
      add(box(0.08, 0.3, 0.08, S), 0, 0.42, 0, pivot);
      break;
    }
    case 'ronin': {
      add(box(0.22, 0.8, 0.26, S), -0.15, 0.4, 0); add(box(0.22, 0.8, 0.26, S), 0.15, 0.4, 0);
      add(box(0.62, 0.7, 0.36, P), 0, 1.1, 0);
      add(box(0.7, 0.1, 0.44, S), 0, 0.82, 0);
      add(box(0.5, 0.6, 0.06, S), 0, 0.95, 0.22);
      add(box(0.36, 0.34, 0.34, P), 0, 0.1, 0, pivot); add(box(0.3, 0.07, 0.05, V), 0, 0.08, -0.18, pivot);
      for (const sx of [-1, 1]) { const h = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.22, 6), V); add(h, sx * 0.15, 0.36, 0, pivot); h.rotation.z = -sx * 0.4; }
      break;
    }
    case 'phantom': {
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.34, 1.35, 10), P); body.rotation.x = Math.PI; add(body, 0, 0.75, 0);
      add(box(0.5, 0.08, 0.3, S), 0, 0.3, 0);
      add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10), S), 0, 0.12, 0, pivot);
      add(box(0.26, 0.06, 0.06, V), 0, 0.12, -0.2, pivot);
      break;
    }
    default: { // trooper
      add(box(0.26, 0.85, 0.3, S), -0.17, 0.42, 0); add(box(0.26, 0.85, 0.3, S), 0.17, 0.42, 0);
      add(box(0.66, 0.7, 0.4, P), 0, 1.15, 0);
      add(box(0.18, 0.6, 0.18, S), -0.42, 1.1, 0);
      add(box(0.36, 0.34, 0.36, P), 0, 0.1, 0, pivot); add(box(0.32, 0.1, 0.06, V), 0, 0.1, -0.19, pivot);
    }
  }
  root.add(pivot);
  root.userData = { pivot, mats, dispose: () => root.traverse(o => { o.geometry?.dispose?.(); }) };
  return root;
}

/** Turntable preview on a small canvas (locker + lobby). */
export class CharacterPreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    this.camera.position.set(0, 1.15, 4.2); this.camera.lookAt(0, 0.95, 0);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(3, 4, 3); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x66aaff, 1.5); rim.position.set(-3, 2, -3); this.scene.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08 }));
    floor.rotation.x = -Math.PI / 2; this.scene.add(floor);
    this.model = null; this.t = 0; this.raf = 0; this.running = false;
  }
  setSkin(skin) {
    if (this.model) this.scene.remove(this.model);
    this.model = buildCharacter(skin); this.scene.add(this.model);
  }
  resize() {
    const w = this.canvas.clientWidth || 300, h = this.canvas.clientHeight || 360;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  start() {
    if (this.running) return; this.running = true; this.resize();
    const loop = () => { if (!this.running) return; this.raf = requestAnimationFrame(loop);
      this.t += 0.012; if (this.model) this.model.rotation.y = Math.sin(this.t) * 0.9 + 0.3;
      this.renderer.render(this.scene, this.camera); };
    loop();
  }
  stop() { this.running = false; cancelAnimationFrame(this.raf); }
}
