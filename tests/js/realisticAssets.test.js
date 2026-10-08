import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  boxProjectUv,
  externalModelOf,
  floorTextureOf,
  textureRepeat,
  tintRatio,
  usableBounds,
  veneerFor,
} from '../../js/core/realisticAssets.js';

const close = (actual, expected, message) => {
  assert.equal(actual.length, expected.length, message);
  actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-6, `${message ?? ''} [${i}] ${v} ≠ ${expected[i]}`));
};

// ---------- 地板材質 → 貼圖 ----------

for (const [materialId, setId, size, files] of [
  ['laminate', 'laminate_floor_02', [1.7, 1.7], ['laminate_floor_02_diff_1k.jpg', 'laminate_floor_02_nor_gl_1k.jpg', 'laminate_floor_02_rough_1k.jpg']],
  ['engineered', 'laminate_floor_03', [2.08, 2.08], ['laminate_floor_03_diff_1k.jpg', 'laminate_floor_03_nor_gl_1k.jpg', 'laminate_floor_03_rough_1k.jpg']],
  ['microcement', 'Concrete034', [1.1, 0.55], ['Concrete034_1K-JPG_Color.jpg', 'Concrete034_1K-JPG_NormalGL.jpg', 'Concrete034_1K-JPG_Roughness.jpg']],
  ['walnut', 'WoodFloor046', [1.3, 1.3], ['WoodFloor046_1K-JPG_Color.jpg', 'WoodFloor046_1K-JPG_NormalGL.jpg', 'WoodFloor046_1K-JPG_Roughness.jpg']],
  ['marble', 'marble_01', [1.5, 1.5], ['marble_01_diff_1k.jpg', 'marble_01_nor_gl_1k.jpg', 'marble_01_rough_1k.jpg']],
  ['mosaic', 'rounded_square_tiled_wall', [2, 2], ['rounded_square_tiled_wall_diff_1k.jpg', 'rounded_square_tiled_wall_nor_gl_1k.jpg', 'rounded_square_tiled_wall_rough_1k.jpg']],
]) {
  test(`floorTextureOf ${materialId} 對應 ${setId}，三張貼圖、縮圖與代表尺寸`, () => {
    // Act
    const set = floorTextureOf(materialId);

    // Assert
    const dir = `assets/textures/${setId}/`;
    assert.deepEqual(set, {
      id: setId,
      size,
      map: dir + files[0],
      normalMap: dir + files[1],
      roughnessMap: dir + files[2],
      thumb: `${dir}thumb.jpg`,
    });
  });
}

for (const materialId of ['spc', 'polished-60', 'polished-80', 'wood-tile', 'anti-slip', 'lava', undefined]) {
  test(`floorTextureOf ${materialId} 沒有對應貼圖，維持程式紋理`, () => {
    // Act & Assert
    assert.equal(floorTextureOf(materialId), null);
  });
}

// ---------- 貼圖重複次數 ----------

for (const [name, rect, size, repeat, offset] of [
  ['正方形貼圖：重複＝實際尺寸／代表尺寸', [0.6, 2.4, 5.9, 5.15], [1.7, 1.7], [5.3 / 1.7, 2.75 / 1.7], [0.6 / 1.7, 2.4 / 1.7]],
  ['長方形貼圖：兩軸各自換算', [0, 0, 2.2, 1.1], [1.1, 0.55], [2, 2], [0, 0]],
  ['長方形貼圖的位移也是兩軸各自換算', [1.1, 0.55, 2.2, 1.1], [1.1, 0.55], [1, 1], [1, 1]],
  ['位移以世界座標對齊，相鄰兩塊接得起來', [1.7, 3.4, 3.4, 5.1], [1.7, 1.7], [1, 1], [1, 2]],
]) {
  test(`textureRepeat ${name}`, () => {
    // Act
    const result = textureRepeat(rect, size);

    // Assert
    close(result.repeat, repeat, 'repeat');
    close(result.offset, offset, 'offset');
  });
}

// ---------- 自訂顏色換算成貼圖的乘色 ----------

for (const [name, custom, base, expected] of [
  ['沒有自訂顏色時用貼圖原色', undefined, '#c9a77c', [1, 1, 1]],
  ['自訂顏色與材質原色相同時用貼圖原色', '#c9a77c', '#c9a77c', [1, 1, 1]],
  ['自訂較暗時依各色版比例壓暗', '#808080', '#ffffff', [128 / 255, 128 / 255, 128 / 255]],
  ['原色某色版為 0 時直接用自訂值', '#ff0000', '#000000', [1, 0, 0]],
  ['比例上限 3，避免過曝', '#ffffff', '#202020', [3, 3, 3]],
]) {
  test(`tintRatio ${name}`, () => {
    // Act & Assert
    close(tintRatio(custom, base), expected);
  });
}

// ---------- 系統櫃門片木皮 ----------

for (const [name, color, expected] of [
  ['淺色櫃體用白橡木皮', '#e9e4dc', 'white_oak_veneer'],
  ['深色櫃體用煙燻胡桃木皮', '#4a3a2c', 'smoked_walnut_veneer'],
  ['亮度剛過一半算淺色', '#808080', 'white_oak_veneer'],
  ['亮度未滿一半算深色', '#7f7f7f', 'smoked_walnut_veneer'],
]) {
  test(`veneerFor ${name}`, () => {
    // Act & Assert
    assert.equal(veneerFor(color), expected);
  });
}

// ---------- 外部模型對照表 ----------

for (const [type, url, rotationY] of [
  ['armchair', 'assets/models/modern_arm_chair_01/modern_arm_chair_01_1k.gltf', 0],
  ['coffee-table', 'assets/models/modern_coffee_table_01/modern_coffee_table_01_1k.gltf', Math.PI / 2],
  ['dining-chair', 'assets/models/dining_chair_02/dining_chair_02_1k.gltf', 0],
  ['tv-stand', 'assets/models/modern_wooden_cabinet/modern_wooden_cabinet_1k.gltf', 0],
  ['sofa', 'assets/models/quaternius/couch_medium.glb', 0],
  ['double-bed', 'assets/models/quaternius/bed_king.glb', 0],
  ['single-bed', 'assets/models/quaternius/bed_single.glb', 0],
  ['plant', 'assets/models/quaternius/houseplant.glb', 0],
  ['floor-lamp', 'assets/models/quaternius/light_floor.glb', 0],
]) {
  test(`externalModelOf ${type}：網址與正面朝 +z 的旋轉修正`, () => {
    // Act
    const model = externalModelOf(type);

    // Assert
    assert.equal(model.url, url);
    assert.equal(model.rotationY, rotationY);
  });
}

// 餐桌只有橢圓款，換上會誤導長方形餐桌的外觀，維持程式模型
for (const type of ['wardrobe', 'desk', 'dining-table', 'custom-cabinet', 'lava']) {
  test(`externalModelOf ${type} 沒有外部模型，用程式模型`, () => {
    // Act & Assert
    assert.equal(externalModelOf(type), null);
  });
}

test('沒有貼圖座標的低多邊形模型：材質名稱對到重新上材質的方式', () => {
  // Act
  const sofa = externalModelOf('sofa');
  const bed = externalModelOf('double-bed');

  // Assert
  assert.deepEqual(sofa.finishes, { Couch_Blue: 'fabric', Black: 'legs' });
  assert.deepEqual(bed.finishes, { Red: 'tint', DarkRed: 'tint', Wood: 'walnut', White: 'linen', Grey: 'linen' });
  assert.ok(sofa.unit > 0, '模型單位換算公尺要大於 0');
});

test('Poly Haven 模型自帶貼圖，不重新上材質', () => {
  // Act & Assert
  assert.equal(externalModelOf('armchair').finishes, undefined);
});

// ---------- 載入的模型能不能用 ----------

for (const [name, size, expected] of [
  ['三軸都有尺寸', { x: 1, y: 0.5, z: 2 }, true],
  ['扁平（某軸為 0）不能拉伸', { x: 1, y: 0, z: 2 }, false],
  ['空場景的外框是負無限大', { x: -Infinity, y: -Infinity, z: -Infinity }, false],
  ['NaN 不能用', { x: NaN, y: 1, z: 1 }, false],
]) {
  test(`usableBounds ${name}`, () => {
    // Act & Assert
    assert.equal(usableBounds(size), expected);
  });
}

// ---------- 低多邊形模型補貼圖座標 ----------

test('boxProjectUv 依法向量最大的軸投影，並換算成貼圖重複', () => {
  // Arrange：三個頂點，法向量分別朝 y、x、z；模型 1 單位＝0.5 m，貼圖代表 0.25 m
  const positions = [1, 0, 2, 3, 4, 5, 6, 7, 8];
  const normals = [0.6, -0.8, 0, 1, 0, 0, 0, 0, -1];

  // Act
  const uv = boxProjectUv(positions, normals, 0.5, 0.25);

  // Assert：y 面取 (x, z)、x 面取 (z, y)、z 面取 (x, y)，乘上 0.5 / 0.25 = 2
  close([...uv], [2, 4, 10, 8, 12, 14]);
});
