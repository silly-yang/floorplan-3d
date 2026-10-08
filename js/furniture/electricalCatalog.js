// 水電類目錄：插座、開關、弱電面板；面板尺寸（公分）與預設離地高度（mountHeight，公分）
// allowOverlap：面板一定會跟貼牆的家具疊在一起，擋住與否由用電檢查另外判斷
// options：voltage（110／220）與 dedicated（專用迴路）；開關與弱電沒有電壓
const plate = (type, name, color, mountHeight, options = {}) => ({
  category: 'electrical',
  type,
  name,
  size: { w: 12, d: 4, h: 12 },
  color,
  placement: 'wall',
  surface: false,
  allowOverlap: true,
  mountHeight,
  options,
});

export const ELECTRICAL_ITEMS = [
  plate('outlet-110', '110V 插座', '#f4f4f2', 30, { voltage: 110, dedicated: false }),
  plate('outlet-220', '220V 插座', '#e8c4c0', 230, { voltage: 220, dedicated: true }),
  plate('outlet-dedicated', '專用迴路插座', '#f3e2b3', 110, { voltage: 110, dedicated: true }),
  plate('switch', '開關', '#f4f4f2', 120),
  plate('tv-jack', '電視孔', '#dfe6ea', 30),
  plate('lan-jack', '網路孔', '#dfe6ea', 30),
];
