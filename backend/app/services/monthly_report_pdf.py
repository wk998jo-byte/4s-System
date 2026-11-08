"""Build monthly report PDFs that mirror the on-screen / printable report layout."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fpdf import FPDF

try:
    AST = ZoneInfo("Asia/Riyadh")
except ZoneInfoNotFoundError:
    from datetime import timedelta, timezone

    AST = timezone(timedelta(hours=3))

TYPE_LABELS = {
    "ai_camera": "AI Camera Observation",
    "dashcam": "Dashcam Observation",
    "speed": "Speed Violation",
    "sos": "SOS Alert",
    "itqan": "ITQAN Violation",
}

TYPE_ROWS = [
    ("ai_camera", "AI Camera Observations"),
    ("sos", "SOS Alerts (Wearables)"),
    ("row", "ROW (Zone) Violations"),
    ("speed_light", "Light Vehicle Speed Violations"),
    ("speed_heavy", "Heavy Vehicle Speed Violations"),
    ("dashcam", "Dashcam Violations"),
    ("itqan", "ITQAN Violations"),
]

MONTHS = (
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
)

SLA_HOURS = {"High": 24, "Medium": 72, "Low": 168}
BRAND_RED = (200, 16, 46)


def _clean(value: object) -> str:
    text = str(value if value is not None else "")
    return (
        text.replace("—", "-")
        .replace("–", "-")
        .replace("·", "|")
        .replace("•", "*")
        .encode("latin-1", "replace")
        .decode("latin-1")
    )


def _field(row: dict, key: str) -> str:
    fields = row.get("fields") or {}
    if not isinstance(fields, dict):
        return ""
    value = fields.get(key)
    return "" if value is None else str(value)


def _is_row_violation(row: dict) -> bool:
    return row.get("record_type") == "speed" and "row" in _field(row, "speed_violation_type").lower()


def _is_heavy_speed(row: dict) -> bool:
    return (
        row.get("record_type") == "speed"
        and not _is_row_violation(row)
        and "heavy" in _field(row, "vehicle_type").lower()
    )


def _is_light_speed(row: dict) -> bool:
    return (
        row.get("record_type") == "speed"
        and not _is_row_violation(row)
        and "heavy" not in _field(row, "vehicle_type").lower()
    )


def _matches_type(row: dict, key: str) -> bool:
    if key == "ai_camera":
        return row.get("record_type") == "ai_camera"
    if key == "sos":
        return row.get("record_type") == "sos"
    if key == "row":
        return _is_row_violation(row)
    if key == "speed_light":
        return _is_light_speed(row)
    if key == "speed_heavy":
        return _is_heavy_speed(row)
    if key == "dashcam":
        return row.get("record_type") == "dashcam"
    if key == "itqan":
        return row.get("record_type") == "itqan"
    return False


def _risk_key(row: dict) -> str:
    raw = str(row.get("risk_level") or "").replace(" Risk", "").strip()
    return raw or "Low"


def _is_overdue(row: dict, now: datetime) -> bool:
    if row.get("status") == "closed":
        return False
    created_raw = str(row.get("created_at") or "")
    try:
        created = datetime.fromisoformat(created_raw.replace("Z", "+00:00"))
    except ValueError:
        return False
    hours = SLA_HOURS.get(_risk_key(row), 72)
    return (now - created).total_seconds() / 3600 > hours


def _status_label(status: str) -> str:
    if status == "under_process":
        return "Under Review"
    if status == "open":
        return "Open"
    if status == "closed":
        return "Closed"
    return status or "-"


def _format_day(iso: str) -> str:
    parts = str(iso or "")[:10].split("-")
    if len(parts) != 3:
        return str(iso or "")
    try:
        year, month, day = int(parts[0]), int(parts[1]), int(parts[2])
        return f"{day} {MONTHS[month - 1]} {year}"
    except (ValueError, IndexError):
        return str(iso or "")


def _format_period(a: str, b: str) -> str:
    return f"{_format_day(a)} - {_format_day(b)}"


def _generated_stamp(now: datetime) -> str:
    local = now.astimezone(AST)
    return f"Generated (GMT+3) {local.strftime('%Y-%m-%d %H:%M:%S')}"


def _logo_path() -> Path | None:
    root = Path(__file__).resolve().parents[3]
    for candidate in (
        root / "frontend" / "src" / "assets" / "bq-logo.png",
        root / "frontend" / "src" / "assets" / "bq-logo-color.png",
    ):
        if candidate.is_file():
            return candidate
    return None


def _signature_image_path(signature: object) -> Path | None:
    """Resolve a stored PM signature (`/uploads/...`, filename, or data URL) to a file."""
    import base64
    import tempfile

    from app.services.uploads import UPLOAD_DIR

    raw = str(signature or "").strip()
    if not raw:
        return None
    if raw.startswith("data:image"):
        # data:image/png;base64,....
        try:
            header, _, payload = raw.partition(",")
            if not payload:
                return None
            ext = ".png"
            if "jpeg" in header or "jpg" in header:
                ext = ".jpg"
            elif "webp" in header:
                ext = ".webp"
            elif "gif" in header:
                ext = ".gif"
            data = base64.b64decode(payload)
            tmp = Path(tempfile.gettempdir()) / f"scc_pm_sig_{abs(hash(payload)) % 10_000_000}{ext}"
            tmp.write_bytes(data)
            return tmp if tmp.is_file() else None
        except Exception:
            return None
    name = raw
    if "/uploads/" in raw:
        name = raw.split("/uploads/", 1)[1]
    name = name.split("?", 1)[0].lstrip("/")
    if not name or ".." in name or "/" in name or "\\" in name:
        return None
    path = UPLOAD_DIR / name
    return path if path.is_file() else None


class MonthlyReportPDF(FPDF):
    def header_line(self) -> None:
        self.set_draw_color(*BRAND_RED)
        self.set_line_width(0.6)
        y = self.get_y()
        self.line(self.l_margin, y, self.w - self.r_margin, y)
        self.ln(3)

    def section_title(self, title: str) -> None:
        self.ln(3)
        self.set_font("Helvetica", "B", 11)
        self.set_text_color(*BRAND_RED)
        self.cell(0, 7, _clean(title.upper()), new_x="LMARGIN", new_y="NEXT")
        self.set_text_color(0, 0, 0)
        self.set_draw_color(*BRAND_RED)
        self.set_line_width(0.5)
        y = self.get_y()
        self.line(self.l_margin, y, self.w - self.r_margin, y)
        self.ln(3)

    def table_header(self, widths: list[float], headers: list[str]) -> None:
        self.set_font("Helvetica", "B", 8)
        self.set_text_color(120, 120, 120)
        for width, header in zip(widths, headers):
            self.cell(width, 7, _clean(header), border="B")
        self.ln()
        self.set_text_color(0, 0, 0)
        self.set_font("Helvetica", "", 8)

    def ensure_space(self, needed: float = 16) -> None:
        if self.get_y() + needed > self.h - self.b_margin:
            self.add_page()


def build_monthly_report_pdf(
    *,
    item: dict,
    rows: list[dict],
    distribution_name: str,
) -> bytes:
    scope = str(item.get("scope") or "")
    label = str(item.get("label") or "")
    report_id = str(item.get("id") or "")
    a = str(item.get("a") or "")
    b = str(item.get("b") or "")
    pm = item.get("pm_signed") or {}
    now = datetime.now(AST)

    open_n = sum(1 for r in rows if r.get("status") == "open")
    under_n = sum(1 for r in rows if r.get("status") == "under_process")
    closed_n = sum(1 for r in rows if r.get("status") == "closed")
    overdue_n = sum(1 for r in rows if _is_overdue(r, now))
    high_n = sum(1 for r in rows if "high" in str(r.get("risk_level") or "").lower())

    pdf = MonthlyReportPDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=14)
    pdf.add_page()

    # Header brand + meta
    logo = _logo_path()
    top_y = pdf.get_y()
    if logo:
        try:
            pdf.image(str(logo), x=pdf.l_margin, y=top_y, h=14)
        except Exception:
            logo = None
    title_x = pdf.l_margin + (28 if logo else 0)
    pdf.set_xy(title_x, top_y)
    pdf.set_font("Helvetica", "B", 18)
    pdf.cell(100, 8, "SCC MONTHLY REPORT", new_x="RIGHT", new_y="TOP")
    pdf.set_xy(pdf.w - pdf.r_margin - 70, top_y)
    pdf.set_font("Helvetica", "", 8)
    pdf.set_text_color(120, 120, 120)
    pdf.multi_cell(70, 4, _clean(f"{_generated_stamp(now)}\nAuto-generated by SCC Platform"), align="R")
    pdf.set_text_color(0, 0, 0)
    pdf.set_xy(title_x, top_y + 8)
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(100, 100, 100)
    pdf.cell(0, 6, _clean(f"Safety Command Center | {scope} | {label}"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_text_color(0, 0, 0)
    pdf.set_y(max(pdf.get_y(), top_y + 16))
    pdf.header_line()

    # Meta band
    pdf.set_font("Helvetica", "", 8)
    meta = [
        ("PERIOD", _format_period(a, b)),
        ("PREPARED BY", "SCC Platform (system)"),
        ("SCOPE", scope),
        ("DISTRIBUTION", distribution_name or f"[PM name], {scope} Project"),
    ]
    col_w = (pdf.w - pdf.l_margin - pdf.r_margin) / 2
    for i in range(0, 4, 2):
        x0 = pdf.l_margin
        y0 = pdf.get_y()
        for j, (label_m, value_m) in enumerate(meta[i : i + 2]):
            pdf.set_xy(x0 + j * col_w, y0)
            pdf.set_text_color(120, 120, 120)
            pdf.set_font("Helvetica", "B", 7)
            pdf.cell(col_w - 4, 4, label_m, new_x="LMARGIN", new_y="NEXT")
            pdf.set_x(x0 + j * col_w)
            pdf.set_text_color(0, 0, 0)
            pdf.set_font("Helvetica", "B", 10)
            pdf.cell(col_w - 4, 6, _clean(value_m)[:48], new_x="LMARGIN", new_y="NEXT")
        pdf.set_y(y0 + 12)
    pdf.header_line()

    # Key figures
    pdf.section_title("Key figures")
    kpis = [
        ("Records", len(rows)),
        ("Open", open_n),
        ("Under Review", under_n),
        ("Closed", closed_n),
        ("Overdue", overdue_n),
        ("High risk", high_n),
    ]
    box_w = (pdf.w - pdf.l_margin - pdf.r_margin - 6) / 2
    box_h = 16
    for i in range(0, 6, 2):
        pdf.ensure_space(box_h + 4)
        y0 = pdf.get_y()
        for j, (k_label, k_value) in enumerate(kpis[i : i + 2]):
            x = pdf.l_margin + j * (box_w + 6)
            pdf.set_xy(x, y0)
            pdf.set_draw_color(220, 220, 220)
            pdf.set_line_width(0.3)
            pdf.rect(x, y0, box_w, box_h)
            pdf.set_xy(x + 3, y0 + 2)
            pdf.set_font("Helvetica", "", 8)
            pdf.set_text_color(120, 120, 120)
            pdf.cell(box_w - 6, 4, k_label)
            pdf.set_xy(x + 3, y0 + 7)
            pdf.set_font("Helvetica", "B", 16)
            pdf.set_text_color(0, 0, 0)
            pdf.cell(box_w - 6, 7, str(k_value))
        pdf.set_y(y0 + box_h + 3)

    # By type
    pdf.section_title("Observations and violations by type")
    widths = [78, 22, 22, 32, 26]
    pdf.table_header(widths, ["Type", "Total", "Open", "Under Review", "Closed"])
    for key, type_label in TYPE_ROWS:
        subset = [r for r in rows if _matches_type(r, key)]
        vals = [
            type_label,
            str(len(subset)),
            str(sum(1 for r in subset if r.get("status") == "open")),
            str(sum(1 for r in subset if r.get("status") == "under_process")),
            str(sum(1 for r in subset if r.get("status") == "closed")),
        ]
        pdf.ensure_space(8)
        for width, val in zip(widths, vals):
            pdf.cell(width, 7, _clean(val), border="B")
        pdf.ln()

    # Risk
    pdf.section_title("Risk level")
    widths = [40, 28, 36, 28, 48]
    pdf.table_header(widths, ["Risk", "Records", "Closed on time", "Overdue", "Deadline"])
    for key, deadline in (("High", "24 hours"), ("Medium", "3 days"), ("Low", "7 days")):
        subset = [
            r
            for r in rows
            if _risk_key(r) == key and r.get("record_type") != "sos"
        ]
        closed = [r for r in subset if r.get("status") == "closed"]
        overdue = sum(1 for r in subset if _is_overdue(r, now))
        vals = [f"{key} Risk", str(len(subset)), str(len(closed)), str(overdue), deadline]
        pdf.ensure_space(8)
        for width, val in zip(widths, vals):
            pdf.cell(width, 7, _clean(val), border="B")
        pdf.ln()

    # Record details
    pdf.section_title("Record details")
    widths = [32, 28, 48, 28, 28, 26]
    pdf.table_header(widths, ["Case ID", "Date", "Type", "Scope", "Risk", "Status"])
    visible = rows[:25]
    if not visible:
        pdf.cell(sum(widths), 7, "No records in this period.", border="B", new_x="LMARGIN", new_y="NEXT")
    else:
        for row in visible:
            risk = "NA" if row.get("record_type") == "sos" else (row.get("risk_level") or "-")
            vals = [
                row.get("case_id"),
                _format_day(str(row.get("date") or "")),
                TYPE_LABELS.get(str(row.get("record_type") or ""), row.get("record_type")),
                row.get("project") or scope,
                risk,
                _status_label(str(row.get("status") or "")),
            ]
            pdf.ensure_space(8)
            for width, val in zip(widths, vals):
                pdf.cell(width, 7, _clean(val)[:40], border="B")
            pdf.ln()
    if len(rows) > 25:
        pdf.ln(1)
        pdf.set_font("Helvetica", "I", 8)
        pdf.set_text_color(120, 120, 120)
        pdf.cell(
            0,
            5,
            _clean(f"Showing 25 of {len(rows)}. The full log is in the Excel export."),
            new_x="LMARGIN",
            new_y="NEXT",
        )
        pdf.set_text_color(0, 0, 0)

    # Sign-off
    pdf.ln(6)
    sig_path = _signature_image_path(pm.get("signature") if isinstance(pm, dict) else None)
    card_w = (pdf.w - pdf.l_margin - pdf.r_margin - 8) / 3
    card_h = 52 if sig_path else 38
    pdf.ensure_space(card_h + 6)
    y0 = pdf.get_y()
    cards = [
        ("PREPARED BY", "SCC Platform | auto", "System compiled", "-"),
        (
            "REVIEWED & SIGNED | PROJECT PM",
            str(pm.get("by") or "Project PM"),
            "Signed" if pm else "Awaiting Project PM signature",
            _format_day(str(pm.get("at") or "")[:10]) if pm.get("at") else "-",
        ),
        (
            "ISSUED TO | PROJECT PM",
            distribution_name or f"[PM name], {scope} Project",
            "Ready to issue / issued",
            "-",
        ),
    ]
    for i, (title, line1, line2, line3) in enumerate(cards):
        x = pdf.l_margin + i * (card_w + 4)
        pdf.set_draw_color(210, 210, 210)
        pdf.rect(x, y0, card_w, card_h)
        pdf.set_xy(x + 3, y0 + 3)
        pdf.set_font("Helvetica", "B", 6)
        pdf.set_text_color(120, 120, 120)
        pdf.cell(card_w - 6, 4, _clean(title))
        pdf.set_xy(x + 3, y0 + 9)
        pdf.set_font("Helvetica", "", 8)
        pdf.set_text_color(0, 0, 0)
        pdf.cell(card_w - 6, 5, _clean(line1)[:36])
        # Middle card: embed the uploaded digital signature image when present.
        if i == 1 and sig_path:
            try:
                pdf.image(str(sig_path), x=x + 3, y=y0 + 15, h=16, w=min(card_w - 6, 48))
            except Exception:
                sig_path = None
            pdf.set_xy(x + 3, y0 + 33)
            pdf.set_font("Helvetica", "B", 10)
            pdf.cell(card_w - 6, 5, _clean(line2)[:28])
            pdf.set_xy(x + 3, y0 + 40)
            pdf.set_font("Helvetica", "", 8)
            pdf.set_text_color(120, 120, 120)
            pdf.cell(card_w - 6, 5, _clean(line3))
        else:
            pdf.set_xy(x + 3, y0 + 18)
            pdf.set_font("Helvetica", "B", 10)
            pdf.cell(card_w - 6, 6, _clean(line2)[:28])
            pdf.set_xy(x + 3, y0 + 28)
            pdf.set_font("Helvetica", "", 8)
            pdf.set_text_color(120, 120, 120)
            pdf.cell(card_w - 6, 5, _clean(line3))
        pdf.set_text_color(0, 0, 0)

    pdf.set_y(y0 + card_h + 4)
    pdf.set_font("Helvetica", "", 7)
    pdf.set_text_color(140, 140, 140)
    pdf.cell(0, 4, _clean(f"{report_id} | emailed PDF matches SCC Platform monthly report layout"))

    out = pdf.output()
    return bytes(out) if not isinstance(out, (bytes, bytearray)) else bytes(out)
