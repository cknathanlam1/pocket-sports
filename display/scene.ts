// Placeholder Three.js scene with an explicit game loop. Real venue/assets come from /design in M4.
import * as THREE from 'three';
import { ITTF } from '../engine/config.ts';

export function startScene(canvas: HTMLCanvasElement): () => void {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87c6e8);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 100);
  // Third-person: behind and above the near end of the table (player side is +z).
  camera.position.set(0, ITTF.tableHeight + 0.9, ITTF.tableLength / 2 + 2.2);
  camera.lookAt(0, ITTF.tableHeight, -0.4);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x406040, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(2, 5, 3);
  scene.add(sun);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshLambertMaterial({ color: 0xd9c9a3 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const top = new THREE.Mesh(
    new THREE.BoxGeometry(ITTF.tableWidth, 0.03, ITTF.tableLength),
    new THREE.MeshLambertMaterial({ color: 0x1f5fa8 }),
  );
  top.position.y = ITTF.tableHeight - 0.015;
  scene.add(top);

  const net = new THREE.Mesh(
    new THREE.PlaneGeometry(ITTF.tableWidth + 0.3, ITTF.netHeight),
    new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
  );
  net.position.y = ITTF.tableHeight + ITTF.netHeight / 2;
  scene.add(net);

  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(ITTF.ballDiameter / 2, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xff8a00 }),
  );
  scene.add(ball);

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(canvas);

  let raf = 0;
  const frame = (now: number) => {
    const t = now / 1000;
    // Idle bounce so the loop is visibly alive; replaced by engine state in M1.
    ball.position.set(Math.sin(t * 0.7) * 0.4, ITTF.tableHeight + 0.02 + Math.abs(Math.sin(t * 3)) * 0.3, Math.sin(t * 1.4) * 0.9);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(raf);
    renderer.dispose();
  };
}
