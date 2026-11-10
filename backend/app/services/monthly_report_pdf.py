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


def _case_image_path(row: dict) -> Path | None:
    for key in (
        "observation_picture",
        "violation_picture",
        "fms_evidence",
        "close_out_picture",
        "worker_picture",
        "itqan_record_picture",
    ):
        path = _signature_image_path(_field(row, key))
        if path:
            return path
    return None


def _case_description(row: dict) -> str:
    for key in ("alert_summary", "observation_details", "description", "remarks"):
        value = _field(row, key).strip()
        if value:
            return value
    return str(row.get("title") or "-")


def _case_close_out(row: dict) -> str:
    for key in ("close_out_action", "close_out_report"):
        value = _field(row, key).strip()
        if value:
            return value
    return "Closed" if row.get("status") == "closed" else "Pending close-out"


def _case_location(row: dict, scope: str) -> str:
    for key in ("location", "position", "camera_location"):
        value = _field(row, key).strip()
        if value:
            return value
    return str(row.get("project") or scope or "-")


def _case_risk_label(row: dict) -> str:
    if row.get("record_type") == "sos":
        return "NA"
    raw = str(row.get("risk_level") or "").replace(" Risk", "").strip()
    if "positive" in raw.lower() or "positive" in str(row.get("title") or "").lower():
        return "Positive"
    return raw or "-"


def _doc_no(scope: str) -> str:
    letters = "".join(ch for ch in (scope or "SCC").upper() if ch.isalnum())[:3]
    return f"BQ-SCC - {(letters or 'SCC').ljust(3, 'X')[:3]}"


class MonthlyReportPDF(FPDF):
    def footer(self) -> None:
        self.set_y(-12)
        self.set_font("Helvetica", "", 9)
        self.set_text_color(91, 155, 213)
        self.cell(0, 8, f"Page {self.page_no()} | {{nb}}", align="C")
        self.set_text_color(0, 0, 0)

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
    a = str(item.get("a") or "")
    b = str(item.get("b") or "")
    hse = item.get("signed") if isinstance(item.get("signed"), dict) else {}
    pm = item.get("pm_signed") if isinstance(item.get("pm_signed"), dict) else {}
    now = datetime.now(AST)
    sorted_rows = sorted(
        rows,
        key=lambda row: f"{row.get('date') or ''}{row.get('created_at') or ''}",
    )

    open_n = sum(1 for r in sorted_rows if r.get("status") == "open")
    under_n = sum(1 for r in sorted_rows if r.get("status") == "under_process")
    closed_n = sum(1 for r in sorted_rows if r.get("status") == "closed")
    overdue_rows = [r for r in sorted_rows if _is_overdue(r, now)]
    overdue_n = len(overdue_rows)
    high_n = sum(1 for r in sorted_rows if "high" in str(r.get("risk_level") or "").lower())

    pdf = MonthlyReportPDF(orientation="P", unit="mm", format="A4")
    pdf.alias_nb_pages()
    pdf.set_auto_page_break(auto=True, margin=16)
    pdf.add_page()

    # --- Cover page: headlines + date + signatures ---
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(0, 6, "BIN QURAYA COMPANY LIMITED", new_x="LMARGIN", new_y="NEXT")
    logo = _logo_path()
    if logo:
        try:
            pdf.image(str(logo), x=pdf.w - pdf.r_margin - 28, y=pdf.t_margin, h=12)
        except Exception:
            logo = None

    pdf.ln(8)
    pdf.set_font("Helvetica", "BU", 14)
    pdf.cell(0, 7, "Bin Quraya Company Limited", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 7, "Safety Command Center (SCC)", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "B", 12)
    pdf.ln(2)
    pdf.cell(0, 6, _clean(scope), align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.cell(0, 6, "Monthly Report", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(6)

    frame_x = pdf.l_margin
    frame_w = pdf.w - pdf.l_margin - pdf.r_margin
    band_y = pdf.get_y()
    pdf.set_fill_color(*BRAND_RED)
    pdf.rect(frame_x, band_y, frame_w, 10, style="DF")
    pdf.set_xy(frame_x, band_y + 2)
    pdf.set_font("Helvetica", "B", 12)
    pdf.set_text_color(255, 255, 255)
    pdf.cell(frame_w, 6, _clean(f"SCC Report Month ({label})"), align="C")
    pdf.set_text_color(0, 0, 0)
    body_top = band_y + 10
    body_h = 110
    pdf.set_draw_color(40, 40, 40)
    pdf.rect(frame_x, band_y, frame_w, body_h + 10)
    pdf.set_xy(frame_x + 4, body_top + 6)
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(80, 80, 80)
    pdf.multi_cell(
        frame_w - 8,
        5,
        _clean(
            "Weather monitoring, observation summary, and full record details follow.\n"
            f"{_generated_stamp(now)}\n"
            f"Distribution | {distribution_name or f'[PM name], {scope} Project'}"
        ),
    )
    pdf.set_text_color(0, 0, 0)

    hse_sig_path = _signature_image_path(hse.get("signature") if hse else None)
    pm_sig_path = _signature_image_path(pm.get("signature") if pm else None)
    table_y = band_y + body_h + 10 - 28
    pdf.set_xy(frame_x, table_y)
    col = frame_w / 6
    pdf.set_font("Helvetica", "B", 8)
    pdf.set_fill_color(243, 243, 243)
    cells = [
        ("Rev", "00"),
        ("Date", _format_period(a, b)),
        ("Prepared by", "BQCL SCC Team"),
    ]
    x = frame_x
    for label_c, value_c in cells:
        pdf.set_xy(x, table_y)
        pdf.cell(col, 7, label_c, border=1, fill=True)
        pdf.set_xy(x + col, table_y)
        pdf.set_font("Helvetica", "", 8)
        pdf.cell(col, 7, _clean(value_c)[:28], border=1)
        pdf.set_font("Helvetica", "B", 8)
        x += 2 * col

    pdf.set_xy(frame_x, table_y + 7)
    pdf.cell(col, 14, "Prepared by", border=1, fill=True)
    pdf.set_xy(frame_x + col, table_y + 7)
    pdf.set_font("Helvetica", "", 8)
    pdf.cell(col, 14, "BQCL SCC Team", border=1)
    pdf.set_font("Helvetica", "B", 8)
    pdf.set_xy(frame_x + 2 * col, table_y + 7)
    pdf.cell(col, 14, "Review By-HSE", border=1, fill=True)
    pdf.set_xy(frame_x + 3 * col, table_y + 7)
    hse_reviewer = str(hse.get("by") or "Dept HSE") if hse else "Awaiting Dept HSE"
    if hse_sig_path:
        try:
            pdf.image(str(hse_sig_path), x=frame_x + 3 * col + 2, y=table_y + 8, h=10)
        except Exception:
            hse_sig_path = None
    pdf.set_font("Helvetica", "", 8)
    pdf.cell(col, 14, _clean(hse_reviewer)[:22], border=1)
    pdf.set_font("Helvetica", "B", 8)
    pdf.set_xy(frame_x + 4 * col, table_y + 7)
    pdf.cell(col, 14, "Review By-PM", border=1, fill=True)
    pdf.set_xy(frame_x + 5 * col, table_y + 7)
    pm_reviewer = str(pm.get("by") or "Project PM") if pm else "Awaiting Project PM"
    if pm_sig_path:
        try:
            pdf.image(str(pm_sig_path), x=frame_x + 5 * col + 2, y=table_y + 8, h=10)
        except Exception:
            pm_sig_path = None
    pdf.set_font("Helvetica", "", 8)
    pdf.cell(col, 14, _clean(pm_reviewer)[:22], border=1)
    pdf.set_xy(frame_x, table_y + 21)
    pdf.set_font("Helvetica", "B", 8)
    pdf.cell(frame_w, 7, _clean(f"Document No. - {_doc_no(scope)}"), border=1)

    # --- Summary page ---
    pdf.add_page()
    pdf.section_title("Observation summary")
    kpis = [
        ("Records", len(sorted_rows)),
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
            pdf.set_draw_color(220, 220, 220)
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

    pdf.section_title("Observations and violations by type")
    widths = [78, 22, 22, 32, 26]
    pdf.table_header(widths, ["Type", "Total", "Open", "Under Review", "Closed"])
    for key, type_label in TYPE_ROWS:
        subset = [r for r in sorted_rows if _matches_type(r, key)]
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

    pdf.section_title("Risk level")
    widths = [40, 28, 36, 28, 48]
    pdf.table_header(widths, ["Risk", "Records", "Closed on time", "Overdue", "Deadline"])
    for key, deadline in (("High", "24 hours"), ("Medium", "3 days"), ("Low", "7 days")):
        subset = [
            r for r in sorted_rows if _risk_key(r) == key and r.get("record_type") != "sos"
        ]
        closed = [r for r in subset if r.get("status") == "closed"]
        overdue = sum(1 for r in subset if _is_overdue(r, now))
        vals = [f"{key} Risk", str(len(subset)), str(len(closed)), str(overdue), deadline]
        pdf.ensure_space(8)
        for width, val in zip(widths, vals):
            pdf.cell(width, 7, _clean(val), border="B")
        pdf.ln()

    pdf.section_title("All records in period")
    widths = [32, 28, 48, 28, 28, 26]
    pdf.table_header(widths, ["Case ID", "Date", "Type", "Scope", "Risk", "Status"])
    if not sorted_rows:
        pdf.cell(sum(widths), 7, "No records in this period.", border="B", new_x="LMARGIN", new_y="NEXT")
    else:
        for row in sorted_rows:
            vals = [
                row.get("case_id"),
                _format_day(str(row.get("date") or "")),
                TYPE_LABELS.get(str(row.get("record_type") or ""), row.get("record_type")),
                row.get("project") or scope,
                _case_risk_label(row),
                _status_label(str(row.get("status") or "")),
            ]
            pdf.ensure_space(8)
            for width, val in zip(widths, vals):
                pdf.cell(width, 7, _clean(val)[:40], border="B")
            pdf.ln()

    # --- One page per observation ---
    for row in sorted_rows:
        pdf.add_page()
        pdf.set_font("Helvetica", "B", 9)
        pdf.cell(0, 5, "BIN QURAYA COMPANY LIMITED", new_x="LMARGIN", new_y="NEXT")
        if logo:
            try:
                pdf.image(str(logo), x=pdf.w - pdf.r_margin - 24, y=pdf.t_margin, h=10)
            except Exception:
                pass
        pdf.ln(4)

        meta_w = [30, 22, 48, 28, 28, 24]
        headers = ["Department", "Contractor", "Location", "Date", "Risk level", "Status"]
        pdf.set_fill_color(*BRAND_RED)
        pdf.set_text_color(255, 255, 255)
        pdf.set_font("Helvetica", "B", 8)
        for width, header in zip(meta_w, headers):
            pdf.cell(width, 7, header, border=1, fill=True)
        pdf.ln()
        pdf.set_text_color(0, 0, 0)
        pdf.set_font("Helvetica", "", 8)
        values = [
            row.get("department") or row.get("project") or scope,
            "BQ",
            _case_location(row, scope),
            _format_day(str(row.get("date") or "")),
            _case_risk_label(row),
            _status_label(str(row.get("status") or "")),
        ]
        for i, (width, val) in enumerate(zip(meta_w, values)):
            if i == 5 and row.get("status") == "closed":
                pdf.set_fill_color(46, 125, 50)
                pdf.set_text_color(255, 255, 255)
                pdf.cell(width, 8, _clean(val)[:24], border=1, fill=True, align="C")
                pdf.set_text_color(0, 0, 0)
            else:
                pdf.cell(width, 8, _clean(val)[:40], border=1)
        pdf.ln(10)
        pdf.set_font("Helvetica", "B", 9)
        pdf.cell(
            0,
            5,
            _clean(
                f"{row.get('case_id')}  |  "
                f"{TYPE_LABELS.get(str(row.get('record_type') or ''), row.get('record_type'))}"
            ),
            new_x="LMARGIN",
            new_y="NEXT",
        )
        pdf.ln(2)

        img = _case_image_path(row)
        if img:
            try:
                pdf.image(str(img), x=pdf.l_margin, w=frame_w, h=110)
                pdf.ln(4)
            except Exception:
                pdf.set_font("Helvetica", "I", 9)
                pdf.set_text_color(120, 120, 120)
                pdf.cell(0, 6, "Picture could not be embedded.", new_x="LMARGIN", new_y="NEXT")
                pdf.set_text_color(0, 0, 0)
        else:
            pdf.set_font("Helvetica", "I", 9)
            pdf.set_text_color(120, 120, 120)
            pdf.cell(0, 6, "No picture attached to this record.", new_x="LMARGIN", new_y="NEXT")
            pdf.set_text_color(0, 0, 0)

        pdf.ln(3)
        box_y = pdf.get_y()
        pdf.set_draw_color(40, 40, 40)
        pdf.set_font("Helvetica", "B", 10)
        pdf.cell(0, 6, "OBSERVATION DETAILS:", new_x="LMARGIN", new_y="NEXT")
        pdf.set_font("Helvetica", "", 9)
        desc = _clean(_case_description(row))
        close = _clean(_case_close_out(row))
        pdf.multi_cell(frame_w, 5, f"Description: {desc}")
        pdf.ln(1)
        pdf.multi_cell(frame_w, 5, f"Close out action: {close}")
        box_h = max(28, pdf.get_y() - box_y + 2)
        pdf.rect(pdf.l_margin, box_y - 1, frame_w, box_h)

    # --- Overdue section ---
    pdf.add_page()
    pdf.section_title("Overdue items")
    widths = [36, 48, 28, 28, 40]
    pdf.table_header(widths, ["Case ID", "Type", "Risk", "Status", "Scope"])
    if not overdue_rows:
        pdf.cell(sum(widths), 7, "No overdue items in this period.", border="B", new_x="LMARGIN", new_y="NEXT")
    else:
        for row in overdue_rows:
            vals = [
                row.get("case_id"),
                TYPE_LABELS.get(str(row.get("record_type") or ""), row.get("record_type")),
                _case_risk_label(row),
                _status_label(str(row.get("status") or "")),
                row.get("project") or scope,
            ]
            pdf.ensure_space(8)
            for width, val in zip(widths, vals):
                pdf.cell(width, 7, _clean(val)[:40], border="B")
            pdf.ln()

    out = pdf.output()
    return bytes(out) if not isinstance(out, (bytes, bytearray)) else bytes(out)
