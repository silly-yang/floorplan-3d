// 程式產生的室內環境光（反射用）：暖色木地板、米白牆、天花板，一側是明亮的窗
// 只在載入時用 PMREM 烘一次；窗那一側轉到跟太陽同方向，地板、玻璃、金屬的反光才對得上真正的窗
import * as THREE from 'three';

const ROOM = { width: 10, depth: 10, height: 3.2 };

// MeshBasicMaterial 的顏色可以超過 1，烘進半浮點貼圖就是 HDR 的亮面
function glow(hex, intensity) {
  const material = new THREE.MeshBasicMaterial({ color: hex });
  material.color.multiplyScalar(intensity);
  return material;
}

function panel(scene, material, [w, h], [x, y, z], rotationY = 0) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotationY;
  scene.add(mesh);
  return mesh;
}

// 回傳環境貼圖；窗在 -x 牆上，需要時用 scene.environmentRotation 轉向
export function interiorEnvironment(renderer) {
  const scene = new THREE.Scene();
  const { width, depth, height } = ROOM;
  const room = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), glow('#e8e2d8', 0.55));
  room.material.side = THREE.BackSide;
  room.position.y = height / 2;
  scene.add(room);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), glow('#9a7a5c', 0.35));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.01;
  scene.add(floor);
  // 窗：兩大片偏冷的天光，窗框隔開；正對面牆上一片淡淡的反射
  const sky = glow('#dfeaf7', 6);
  for (const z of [-1.5, 1.5]) panel(scene, sky, [2.4, 1.9], [-width / 2 + 0.02, 1.45, z], Math.PI / 2);
  panel(scene, glow('#fff4e2', 1.2), [3, 1.4], [width / 2 - 0.02, 1.5, 0], -Math.PI / 2);
  // 天花板燈：小而亮，讓光滑地磚上有點高光
  const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.35, 24), glow('#fff1d6', 8));
  lamp.rotation.x = Math.PI / 2;
  lamp.position.set(0.5, height - 0.02, 0.5);
  scene.add(lamp);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0.03, 0.1, 50, { position: new THREE.Vector3(0, 1.4, 0) });
  pmrem.dispose();
  scene.traverse((o) => {
    o.geometry?.dispose();
    o.material?.dispose();
  });
  return target.texture;
}

// scene.environmentRotation.y：讓環境貼圖的窗（-x）轉到太陽那一側；toSun 為世界座標
export function environmentYaw(toSun) {
  return Math.atan2(-toSun.z, toSun.x) - Math.PI;
}
