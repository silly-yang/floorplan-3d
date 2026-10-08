"""專案的例外階層。"""


class FloorplanError(Exception):
    """所有轉換錯誤的基底。"""


class DxfFormatError(FloorplanError):
    """DXF 內容不是預期的文字格式。"""


class ConfigError(FloorplanError):
    """overrides.json 內容不合法；problems 列出每一個錯誤欄位。"""

    def __init__(self, problems: list[str]) -> None:
        super().__init__("overrides 設定錯誤：\n" + "\n".join(f"- {p}" for p in problems))
        self.problems = problems


class RoomLeakError(FloorplanError):
    """房間填色碰到圖面邊界，代表牆或邊界線沒有封閉。"""
