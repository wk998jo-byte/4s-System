"""Parse ITQAN "tracking violations" exports / the import template.

The ITQAN portal exports a ``.xls`` that is really an HTML table, so besides real
``.xlsx`` workbooks and CSV we read HTML tables with the standard library.
"""

from __future__ import annotations

import csv
import io
import re
from datetime import date, datetime, time
from html.parser import HTMLParser

TEMPLATE_HEADERS = [
    "SN",
    "Violator Name",
    "Badge No",
    "Position",
    "Project",
    "Violation Type",
    "Violation Date",
    "No of Freq",
    "Vehicle Door No.",
    "Vehicle Type",
    "Remark",
    "Status",
    "Reference No",
]

# Sheet column header (normalised) -> canonical key
_HEADER_KEYS = {
    "sn": "sn",
    "violator name": "driver_name",
    "badge no": "badge",
    "position": "position",
    "project": "project",
    "violation type": "violation_type",
    "violation date": "violation_date",
    "no of freq": "frequency",
    "vehicle door no.": "door_no",
    "vehicle door no": "door_no",
    "vehicle type": "vehicle_type",
    "remark": "remark",
    "status": "status",
    "reference no": "reference",
    "reference no.": "reference",
}

# ITQAN sheet violation label -> platform ITQAN violation type (catalog label)
_VIOLATION_RULES: list[tuple[str, str]] = [
    ("speeding", "Speeding"),
    ("over speed", "Speeding"),
    ("mobile phone", "Using Mobile Phone"),
    ("seat belt", "Not Using Seat Belt"),
    ("seatbelt", "Not Using Seat Belt"),
    ("tamper", "Tampering with Device"),
    ("negligence", "Negligence / Reckless Driving"),
    ("reckless", "Negligence / Reckless Driving"),
    ("distracted", "Distracted Driving"),
]


class ItqanImportError(ValueError):
    """The uploaded file cannot be read as an ITQAN sheet."""


class _HtmlTable(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.rows: list[list[str]] = []
        self._row: list[str] | None = None
        self._cell: str | None = None

    def handle_starttag(self, tag, attrs):  # noqa: ANN001
        if tag == "tr":
            self._row = []
        elif tag in ("td", "th"):
            self._cell = ""
        elif tag == "br" and self._cell is not None:
            self._cell += " "

    def handle_endtag(self, tag):  # noqa: ANN001
        if tag in ("td", "th") and self._row is not None and self._cell is not None:
            self._row.append(re.sub(r"\s+", " ", self._cell).strip())
            self._cell = None
        elif tag == "tr" and self._row is not None:
            self.rows.append(self._row)
            self._row = None

    def handle_data(self, data):  # noqa: ANN001
        if self._cell is not None:
            self._cell += data


def _cell_text(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.strftime("%d/%m/%Y %I:%M %p")
    if isinstance(value, date):
        return value.strftime("%d/%m/%Y")
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def _rows_from_bytes(content: bytes, filename: str) -> list[list[str]]:
    head = content[:2048].lstrip()
    lowered = head.lower()
    if content[:4] == b"PK\x03\x04":
        from openpyxl import load_workbook

        try:
            wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        except Exception as exc:  # noqa: BLE001
            raise ItqanImportError("Could not read the Excel file.") from exc
        try:
            for ws in wb.worksheets:
                rows = [[_cell_text(c) for c in row] for row in ws.iter_rows(values_only=True)]
                if _find_header(rows) is not None:
                    return rows
            return []
        finally:
            wb.close()
    if content[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
        raise ItqanImportError(
            "This is a legacy binary .xls file. Open it in Excel and save it as .xlsx, "
            "or upload the file exactly as exported from ITQAN."
        )
    text = content.decode("utf-8-sig", errors="replace")
    if b"<table" in lowered or b"<html" in lowered or b"<tr" in lowered:
        parser = _HtmlTable()
        parser.feed(text)
        return parser.rows
    if filename.lower().endswith(".csv"):
        return [list(r) for r in csv.reader(io.StringIO(text))]
    raise ItqanImportError("Unsupported file. Upload the ITQAN .xls / .xlsx export or the template.")


def _norm(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip().lower()


def _find_header(rows: list[list[str]]) -> tuple[int, dict[int, str]] | None:
    for idx, row in enumerate(rows[:15]):
        mapping = {
            col: _HEADER_KEYS[_norm(text)]
            for col, text in enumerate(row)
            if _norm(text) in _HEADER_KEYS
        }
        if "reference" in mapping.values() and "violation_date" in mapping.values():
            return idx, mapping
    return None


def parse_violation_datetime(raw: str) -> datetime | None:
    text = (raw or "").strip()
    if not text:
        return None
    for fmt in (
        "%d/%m/%Y %I:%M %p",
        "%d/%m/%Y %I:%M:%S %p",
        "%d/%m/%Y %H:%M",
        "%d/%m/%Y %H:%M:%S",
        "%d/%m/%Y",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d",
    ):
        try:
            parsed = datetime.strptime(text, fmt)
        except ValueError:
            continue
        if fmt in ("%d/%m/%Y", "%Y-%m-%d"):
            return datetime.combine(parsed.date(), time(0, 0))
        return parsed
    return None


def parse_itqan_sheet(content: bytes, filename: str = "") -> list[dict]:
    """Return one dict per data row (keys from ``_HEADER_KEYS``, plus ``row_number``)."""
    rows = _rows_from_bytes(content, filename)
    located = _find_header(rows)
    if located is None:
        raise ItqanImportError(
            "Could not find the ITQAN columns. The sheet needs at least "
            "'Reference No' and 'Violation Date' headers (use the template)."
        )
    header_idx, mapping = located
    out: list[dict] = []
    for offset, row in enumerate(rows[header_idx + 1 :], start=header_idx + 2):
        if not any((c or "").strip() for c in row):
            continue
        item = {key: (row[col].strip() if col < len(row) else "") for col, key in mapping.items()}
        item["row_number"] = offset
        out.append(item)
    return out


def itqan_violation_label(sheet_value: str) -> str:
    low = _norm(sheet_value)
    for needle, label in _VIOLATION_RULES:
        if needle in low:
            return label
    return (sheet_value or "").strip() or "Distracted Driving"


def source_type_for_violation(sheet_value: str) -> str:
    """Speeding rows belong to Speed Violations, everything else to DashCam."""
    return "speed" if "speed" in _norm(sheet_value) else "dashcam"


def normalise_badge(value: object) -> str:
    return re.sub(r"[\s\-_/]", "", str(value or "")).lower().lstrip("0")


def build_template_xlsx() -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Font

    wb = Workbook()
    ws = wb.active
    ws.title = "ITQAN Violations"
    ws.append(TEMPLATE_HEADERS)
    for cell in ws[1]:
        cell.font = Font(bold=True)
    ws.append(
        [
            1,
            "Example Driver",
            "12345",
            "Heavy Driver",
            "MGS Project",
            "Using Mobile Phones & Electronic Devices",
            "17/11/2026 05:20 PM",
            1,
            "007-01-342",
            "Heavy Vehicle",
            "The driver use the mobile phone while driving.",
            "Under Safety",
            "REF_0000001",
        ]
    )
    widths = [6, 28, 14, 18, 30, 44, 22, 10, 18, 16, 44, 20, 16]
    for col, width in enumerate(widths, start=1):
        ws.column_dimensions[chr(64 + col)].width = width
    notes = wb.create_sheet("Instructions")
    for line in (
        "Replace the example row with your ITQAN rows (or paste the ITQAN export).",
        "Required: Reference No, Violation Date (dd/mm/yyyy hh:mm AM/PM), Violation Type.",
        "Status: Under Safety, Under HR Action, Under Payroll, Under Announcement or Finished.",
        "Re-importing a Reference No that already exists only updates its status.",
        "Rows are linked to Dashcam / Speed records by driver badge + date/time.",
    ):
        notes.append([line])
    notes.column_dimensions["A"].width = 100
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
