// DXF 匯入的例外階層；呼叫端用 instanceof 分辨要顯示給使用者的訊息
export class FloorplanError extends Error {
  constructor(message) {
    super(message);
    this.name = new.target.name;
  }
}

// DXF 內容不是預期的文字格式
export class DxfFormatError extends FloorplanError {}

// 設定內容不合法；problems 列出每一個錯誤欄位
export class ConfigError extends FloorplanError {
  constructor(problems) {
    super(`匯入設定錯誤：\n${problems.map((p) => `- ${p}`).join('\n')}`);
    this.problems = problems;
  }
}

// 房間填色碰到圖面邊界，代表牆或邊界線沒有封閉
export class RoomLeakError extends FloorplanError {}
