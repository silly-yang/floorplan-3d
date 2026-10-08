// 沿牆面線條（踢腳板、天花板線板）把斷面拉成實體，兩端依轉角接法斜切
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// 斷面 profile：[[外凸距離 o, 高度 h], ...]，在 (o, h) 平面上逆時針排列
// 端點往 dir 方向位移多少：外角往外斜切、內角往內斜切、頂到別道牆整個退一個厚度
function endShift(kind, o, thickness) {
  if (kind === 'convex') return o;
  if (kind === 'reflex') return -o;
  if (kind === 'butt') return -thickness;
  return 0;
}

const signedArea = (pts) => pts.reduce((sum, [x0, y0], i) => {
  const [x1, y1] = pts[(i + 1) % pts.length];
  return sum + x0 * y1 - x1 * y0;
}, 0) / 2;

// 三角形 (p, q, r) 的法線要朝 normal 那一側，不是就反過來
function pushTriangle(out, p, q, r, normal) {
  const n = new THREE.Vector3().subVectors(q, p).cross(new THREE.Vector3().subVectors(r, p));
  const [b, c] = n.dot(normal) >= 0 ? [q, r] : [r, q];
  out.push(p.x, p.y, p.z, b.x, b.y, b.z, c.x, c.y, c.z);
}

// run：{ a, b, dir, out, start, end }（平面座標），baseY：斷面 h = 0 的世界高度
export function runGeometry(run, profile, baseY) {
  const thickness = Math.max(...profile.map(([o]) => o));
  const length = Math.hypot(run.b[0] - run.a[0], run.b[1] - run.a[1]);
  const world = (along, o, h) => new THREE.Vector3(
    run.a[0] + run.dir[0] * along + run.out[0] * o,
    baseY + h,
    -(run.a[1] + run.dir[1] * along + run.out[1] * o),
  );
  const starts = profile.map(([o, h]) => world(-endShift(run.start, o, thickness), o, h));
  const ends = profile.map(([o, h]) => world(length + endShift(run.end, o, thickness), o, h));
  const outWorld = new THREE.Vector3(run.out[0], 0, -run.out[1]);
  const dirWorld = new THREE.Vector3(run.dir[0], 0, -run.dir[1]);
  const positions = [];
  profile.forEach(([o0, h0], i) => {
    const j = (i + 1) % profile.length;
    const [o1, h1] = profile[j];
    // 逆時針斷面的邊，往右手邊是斷面外側
    const normal = outWorld.clone().multiplyScalar(h1 - h0).add(new THREE.Vector3(0, -(o1 - o0), 0));
    pushTriangle(positions, starts[i], ends[i], ends[j], normal);
    pushTriangle(positions, starts[i], ends[j], starts[j], normal);
  });
  const contour = profile.map(([o, h]) => new THREE.Vector2(o, h));
  for (const [p, q, r] of THREE.ShapeUtils.triangulateShape(contour, [])) {
    pushTriangle(positions, starts[p], starts[q], starts[r], dirWorld.clone().negate());
    pushTriangle(positions, ends[p], ends[q], ends[r], dirWorld);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

// 整組線條合併成一個 mesh：上百段各自一個 draw call 對手機太重
export function trimMesh(runs, profile, baseYOf, material) {
  if (signedArea(profile) <= 0) throw new Error('斷面要逆時針排列');
  const parts = runs.map((run) => runGeometry(run, profile, baseYOf(run)));
  const mesh = new THREE.Mesh(parts.length ? mergeGeometries(parts) : new THREE.BufferGeometry(), material);
  parts.forEach((g) => g.dispose());
  return mesh;
}
