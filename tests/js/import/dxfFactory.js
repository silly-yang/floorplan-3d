// 測試共用：用程式組出最小的 DXF 文字，避免依賴真實圖檔
export const dxf = {
  // 組一份 HEADER、BLOCKS、ENTITIES 的 DXF；insunits 給 null 代表 HEADER 不寫 $INSUNITS
  document(entities, blocks = {}, { insunits = 4, eol = '\n' } = {}) {
    const parts = ['0', 'SECTION', '2', 'HEADER'];
    if (insunits !== null) parts.push('9', '$INSUNITS', '70', String(insunits));
    parts.push('0', 'ENDSEC', '0', 'SECTION', '2', 'BLOCKS');
    for (const [name, body] of Object.entries(blocks)) {
      parts.push('0', 'BLOCK', '8', '0', '2', name, '10', '0', '20', '0');
      for (const entity of body) parts.push(...entity.split('\n'));
      parts.push('0', 'ENDBLK', '8', '0');
    }
    parts.push('0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES');
    for (const entity of entities) parts.push(...entity.split('\n'));
    parts.push('0', 'ENDSEC', '0', 'EOF');
    return parts.join(eol) + eol;
  },

  line(layer, a, b) {
    return `0\nLINE\n8\n${layer}\n10\n${a[0]}\n20\n${a[1]}\n11\n${b[0]}\n21\n${b[1]}`;
  },

  lwpolyline(layer, points, closed) {
    const head = `0\nLWPOLYLINE\n8\n${layer}\n90\n${points.length}\n70\n${closed ? 1 : 0}`;
    return head + points.map(([x, y]) => `\n10\n${x}\n20\n${y}`).join('');
  },

  // 以 LINE 畫出矩形四邊（真實圖面的牆多半是這種畫法）
  rectLines(layer, x0, y0, x1, y1) {
    return [
      this.line(layer, [x0, y0], [x1, y0]),
      this.line(layer, [x1, y0], [x1, y1]),
      this.line(layer, [x1, y1], [x0, y1]),
      this.line(layer, [x0, y1], [x0, y0]),
    ];
  },

  text(layer, at, value) {
    return `0\nTEXT\n8\n${layer}\n10\n${at[0]}\n20\n${at[1]}\n40\n10\n1\n${value}`;
  },

  attrib(layer, at, tag, value) {
    return `0\nATTRIB\n8\n${layer}\n10\n${at[0]}\n20\n${at[1]}\n2\n${tag}\n1\n${value}`;
  },

  attdef(layer, at, tag, defaultValue) {
    return `0\nATTDEF\n8\n${layer}\n10\n${at[0]}\n20\n${at[1]}\n1\n${defaultValue}\n2\n${tag}`;
  },

  insert(layer, name, at, rotation = 0) {
    return `0\nINSERT\n8\n${layer}\n2\n${name}\n10\n${at[0]}\n20\n${at[1]}\n50\n${rotation}`;
  },

  arc(layer, center, radius, start, end) {
    return `0\nARC\n8\n${layer}\n10\n${center[0]}\n20\n${center[1]}\n40\n${radius}\n50\n${start}\n51\n${end}`;
  },
};

// 合法設定的最小內容；各測試只覆寫要驗的欄位
export function baseConfig() {
  return {
    unitScale: 0.01,
    clip: { xMin: -1000, yMin: -1000, xMax: 5000, yMax: 5000 },
    layers: {
      rcWall: ['L3'],
      partition: ['WALL2'],
      column: ['L12'],
      window: ['OPEN-Window'],
      door: ['OPEN-Door'],
      barrier: ['L23'],
      beam: [],
    },
    windowTypes: { W5: { sill: 0.9, head: 2.1 } },
    doorHead: 2.1,
    doorwayHead: 2.2,
    gapMin: 30,
    gapMax: 250,
    rooms: [],
    ignoreOpenings: [],
  };
}
