// 匯出：畫面截圖（PNG）與整個場景（GLB，Blender／SketchUp 可開）
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

// 匯出前暫時拿掉選取框與衝突紅框，匯出完恢復
async function withoutDecorations(furnitureLayer, task) {
  const selected = furnitureLayer.selectedId;
  const conflicts = furnitureLayer.conflicts;
  furnitureLayer.setSelected(null);
  furnitureLayer.setConflicts([]);
  try {
    return await task();
  } finally {
    furnitureLayer.setConflicts(conflicts);
    furnitureLayer.setSelected(selected);
  }
}

export function exportPng(viewer, furnitureLayer) {
  return withoutDecorations(furnitureLayer, () => viewer.screenshot());
}

export function exportGlb(viewer, furnitureLayer) {
  return withoutDecorations(furnitureLayer, async () => {
    const targets = ['house', 'doors', 'furniture'].map((name) => viewer.scene.getObjectByName(name)).filter(Boolean);
    viewer.scene.updateMatrixWorld();
    const buffer = await new GLTFExporter().parseAsync(targets, { binary: true, onlyVisible: true });
    return new Blob([buffer], { type: 'model/gltf-binary' });
  });
}
