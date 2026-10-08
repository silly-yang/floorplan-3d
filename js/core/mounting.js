// 吸頂、掛牆物件放置時的離地高度（公尺）；其他物件回 undefined，交給 elevationOf 依檯面推算
export function initialElevation(catalogItem, ceilingHeight) {
  if (catalogItem?.placement === 'ceiling') return Math.round((ceilingHeight - catalogItem.size.h / 100) * 1000) / 1000;
  if (catalogItem?.placement === 'wall' && catalogItem.mountHeight) return catalogItem.mountHeight / 100;
  return undefined;
}
