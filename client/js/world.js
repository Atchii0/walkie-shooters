// Scene, map geometry, pickups, tracers, impact effects. Pure rendering; no networking.
import * as THREE from 'three';

const QUALITY = {
  low:    { pr: 1,   shadows: false, edges: false },
  medium: { pr: 1.5, shadows: false, edges: true },
  high:   { pr: 2,   shadows: true,  edges: true },
};

function gridTexture(base, line) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'); g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = line; g.lineWidth = 3; g.strokeRect(0, 0, 256, 256);
  g.globalAlpha = 0.25; g.lineWidth = 1; g.beginPath(); g.moveTo(128, 0); g.lineTo(128, 256); g.moveTo(0, 128); g.lineTo(256, 128); g.stroke();
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class World {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(90, 1, 0.05, 400);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.mapGroup = null; this.pickups = []; this.fx = [];
    this.tracerGeo = new THREE.BoxGeometry(1, 1, 1); this.sparkGeo = new THREE.SphereGeometry(0.08, 6, 6);
    this.quality = 'high';
    this.resize();
  }
  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, QUALITY[this.quality].pr));
    this.renderer.setSize(w, h, false);
  }
  setFov(fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
  setQuality(q) {
    this.quality = q; const Q = QUALITY[q];
    this.renderer.shadowMap.enabled = Q.shadows; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if (this.sun) { this.sun.castShadow = Q.shadows; }
    this.scene.traverse(o => { if (o.userData.edge) o.visible = Q.edges; if (o.material) o.material.needsUpdate = true; });
    this.resize();
  }

  loadMap(map) {
    if (this.mapGroup) { this.scene.remove(this.mapGroup); this.mapGroup.traverse(o => { o.geometry?.dispose?.(); }); }
    const th = map.theme; const g = this.mapGroup = new THREE.Group(); this.scene.add(g);
    this.scene.background = new THREE.Color(th.sky); this.scene.fog = new THREE.Fog(th.fog, 25, 85);
    // lights
    g.add(new THREE.HemisphereLight(new THREE.Color(th.light), new THREE.Color(th.floor), 0.9));
    const sun = this.sun = new THREE.DirectionalLight(new THREE.Color(th.light), 1.6);
    sun.position.set(14, 30, 10); sun.castShadow = QUALITY[this.quality].shadows;
    sun.shadow.mapSize.set(2048, 2048); const sc = sun.shadow.camera; sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 80;
    sun.shadow.bias = -0.0004; g.add(sun);
    // floor
    const ft = gridTexture(th.floor, th.accent); ft.repeat.set(map.bounds.x, map.bounds.z);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(map.bounds.x * 2, map.bounds.z * 2), new THREE.MeshStandardMaterial({ map: ft, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; g.add(floor);
    // boundary walls (visual only; the simulation clamps to bounds)
    const bw = new THREE.MeshStandardMaterial({ color: th.wall, roughness: 0.9 });
    for (const [x, z, w, d] of [[0, -map.bounds.z - 0.5, map.bounds.x * 2 + 2, 1], [0, map.bounds.z + 0.5, map.bounds.x * 2 + 2, 1], [-map.bounds.x - 0.5, 0, 1, map.bounds.z * 2], [map.bounds.x + 0.5, 0, 1, map.bounds.z * 2]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 8, d), bw); m.position.set(x, 4, z); m.receiveShadow = true; g.add(m);
    }
    // boxes
    const mats = {};
    const matFor = kind => mats[kind] ||= new THREE.MeshStandardMaterial({
      color: kind === 'crate' ? new THREE.Color(th.wall).offsetHSL(0.02, 0, 0.12) : kind === 'platform' || kind === 'bridge' ? new THREE.Color(th.floor).offsetHSL(0, 0, 0.1) : kind === 'stairs' ? new THREE.Color(th.floor).offsetHSL(0, 0, 0.18) : kind === 'pillar' ? new THREE.Color(th.wall).offsetHSL(0, 0, -0.05) : th.wall,
      roughness: 0.8, metalness: 0.1,
    });
    const edgeMat = new THREE.LineBasicMaterial({ color: th.accent, transparent: true, opacity: 0.55 });
    for (const b of map.boxes) {
      const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1], d = b.max[2] - b.min[2];
      const geo = new THREE.BoxGeometry(w, h, d);
      const m = new THREE.Mesh(geo, matFor(b.kind)); m.position.set(b.min[0] + w / 2, b.min[1] + h / 2, b.min[2] + d / 2);
      m.castShadow = m.receiveShadow = true; g.add(m);
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat); e.position.copy(m.position); e.userData.edge = true; e.visible = QUALITY[this.quality].edges; g.add(e);
    }
    // pickups
    this.pickups = map.pickups.map(p => {
      const grp = new THREE.Group();
      const c = p.type === 'health' ? 0x3bff7a : 0xffd21f;
      const mat = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.8 });
      if (p.type === 'health') { grp.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.15, 0.15), mat), new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.5, 0.15), mat)); }
      else grp.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.4), mat));
      grp.position.set(p.x, p.y + 0.9, p.z); grp.userData.baseY = p.y + 0.9; g.add(grp);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.55, 24), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.5, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(p.x, p.y + 0.03, p.z); g.add(ring);
      return grp;
    });
    this.setQuality(this.quality);
  }

  setPickupActive(i, on) { if (this.pickups[i]) this.pickups[i].visible = !!on; }

  tracer(from, to, color, width = 0.02, life = 0.12) {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), len = a.distanceTo(b);
    if (len < 0.01) return;
    const m = new THREE.Mesh(this.tracerGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
    m.scale.set(width, width, len); m.position.copy(a).lerp(b, 0.5); m.lookAt(b);
    this.scene.add(m); this.fx.push({ mesh: m, life, max: life, kind: 'tracer' });
  }
  spark(pos, color = 0xffffff) {
    const m = new THREE.Mesh(this.sparkGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 }));
    m.position.set(...pos); this.scene.add(m); this.fx.push({ mesh: m, life: 0.25, max: 0.25, kind: 'spark' });
  }
  updateFx(dt, time) {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i]; f.life -= dt;
      if (f.life <= 0) { this.scene.remove(f.mesh); f.mesh.material.dispose(); this.fx.splice(i, 1); continue; }
      const k = f.life / f.max; f.mesh.material.opacity = k;
      if (f.kind === 'spark') f.mesh.scale.setScalar(1 + (1 - k) * 2);
    }
    for (const p of this.pickups) { p.rotation.y = time * 1.5; p.position.y = p.userData.baseY + Math.sin(time * 2 + p.position.x) * 0.08; }
  }
  render() { this.renderer.render(this.scene, this.camera); }
}
