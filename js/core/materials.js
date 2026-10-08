// 地板材質目錄與各房間的預設；紋理外觀參數交給 scene/textures.js 畫
// pattern：wood 長條板、tile 方磚、concrete 無縫；tile＝一張紋理代表幾公尺；roughness 越低越亮
export const FLOOR_MATERIALS = [
  { id: 'laminate', name: '超耐磨木地板', pattern: 'wood', tile: 1.8, color: '#c9a77c', roughness: 0.55, options: { plankRows: 9 } },
  { id: 'engineered', name: '海島型木地板', pattern: 'wood', tile: 1.8, color: '#a97b52', roughness: 0.5, options: { plankRows: 7, grain: 0.1 } },
  { id: 'spc', name: 'SPC 石塑地板', pattern: 'wood', tile: 1.8, color: '#bca68c', roughness: 0.35, options: { plankRows: 10, grain: 0.04 } },
  { id: 'polished-60', name: '拋光石英磚 60×60', pattern: 'tile', tile: 1.8, color: '#e7e2d9', roughness: 0.12, options: { tiles: 3, grout: '#d6d0c6', speckle: 0.03 } },
  { id: 'polished-80', name: '拋光石英磚 80×80', pattern: 'tile', tile: 2.4, color: '#ece8e1', roughness: 0.1, options: { tiles: 3, grout: '#dad4ca', speckle: 0.02 } },
  { id: 'wood-tile', name: '木紋磚', pattern: 'wood', tile: 1.2, color: '#b49371', roughness: 0.4, options: { plankRows: 6, grout: true } },
  { id: 'microcement', name: '磐多魔／水泥粉光', pattern: 'concrete', tile: 3, color: '#b8b3ab', roughness: 0.45, options: {} },
  { id: 'anti-slip', name: '止滑地磚 30×30', pattern: 'tile', tile: 1.2, color: '#cdc8bf', roughness: 0.82, options: { tiles: 4, grout: '#a9a39a', speckle: 0.12 } },
  // 以下為寫實貼圖新增的選項，只能接在後面；pattern 是貼圖載入前（或失敗時）的程式紋理
  { id: 'walnut', name: '深色胡桃木地板', pattern: 'wood', tile: 1.8, color: '#5a3c26', roughness: 0.45, options: { plankRows: 8, grain: 0.1 } },
  { id: 'marble', name: '大理石', pattern: 'tile', tile: 1.5, color: '#c8b38e', roughness: 0.15, options: { tiles: 2, grout: '#b5a17e', speckle: 0.02 } },
  { id: 'mosaic', name: '浴室小磚', pattern: 'tile', tile: 0.8, color: '#b7aa94', roughness: 0.6, options: { tiles: 16, grout: '#8f8574', speckle: 0.04 } },
];

const BY_ID = new Map(FLOOR_MATERIALS.map((m) => [m.id, m]));
const ROOM_DEFAULTS = { bath: 'anti-slip', balcony: 'anti-slip' };

export function getFloorMaterial(id) {
  return BY_ID.get(id);
}

// 房間沒設定時的預設：浴室、陽台用止滑磚，其他用超耐磨木地板
export function floorMaterialOf(roomId, rooms) {
  return getFloorMaterial(rooms?.[roomId]?.floorMaterial) ?? getFloorMaterial(ROOM_DEFAULTS[roomId] ?? 'laminate');
}
