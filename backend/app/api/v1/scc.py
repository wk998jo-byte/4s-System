from datetime import date

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from app.api.deps import get_current_user, require_admin, require_capability
from app.schemas.auth import ConfirmDelete, RejectBody, UserOut, actor_label
from app.schemas.scc import (
    AiCameraCloseOut,
    AiCameraCreate,
    CaseAdminUpdate,
    CaseDetail,
    CaseList,
    CaseSummary,
    ConfirmDriver,
    ContactCreate,
    ContactUpdate,
    DashcamCreate,
    HwUpdate,
    ItqanCreate,
    ItqanStatusUpdate,
    ListCollection,
    ListItem,
    ListItemCreate,
    ListItemUpdate,
    SosClose,
    SosCreate,
    SpeedCreate,
    WeatherHourlySaveIn,
    WeatherSheetIn,
    WeatherWeeklySubmitIn,
)
from app.services.platform_store import platform_store

router = APIRouter(tags=["SCC screens"], dependencies=[Depends(get_current_user)])


def _http_value_error(exc: ValueError) -> None:
    raise HTTPException(status_code=400, detail=str(exc)) from exc


def as_summary(row: dict) -> CaseSummary:
    return CaseSummary(
        id=row["id"],
        case_id=row["case_id"],
        record_type=row["record_type"],
        status=row["status"],
        project=row.get("project"),
        department=row.get("department"),
        title=row["title"],
        date=row["date"],
        week_number=row["week_number"],
        risk_level=row.get("risk_level"),
        created_at=row["created_at"],
        fields=dict(row.get("fields") or {}),
    )


def as_detail(row: dict) -> CaseDetail:
    return CaseDetail(**as_summary(row).model_dump(), prototype=True)


@router.get("/lists")
def list_catalog() -> dict:
    return {
        "types": platform_store.catalog.types(),
        "notes": {
            "dashcam_alert_summary": "Values were not supplied (OPEN_QUESTIONS A1). Type a summary on the form.",
            "hw_site": "Dhahran is hardware-only and is omitted from record Project lists.",
        },
    }


@router.get("/assets")
def list_assets(
    q: str | None = None,
    category: str | None = None,
    asset_type: str | None = None,
    limit: int = Query(default=5000, ge=1, le=10000),
):
    return {
        "items": platform_store.list_assets(
            q=q, category=category, asset_type=asset_type, limit=limit
        ),
        "meta": platform_store.asset_meta(),
    }


@router.get("/lists/{list_type}", response_model=ListCollection)
def get_list(
    list_type: str,
    include_inactive: bool = Query(False),
) -> ListCollection:
    if list_type not in platform_store.catalog.types():
        raise HTTPException(status_code=404, detail="Unknown list type.")
    note = None
    if list_type == "dashcam_alert_summary":
        note = "Requester has not supplied initial values. You may add prototype entries."
    return ListCollection(
        list_type=list_type,
        items=[
            ListItem(**item)
            for item in platform_store.catalog.get(
                list_type, active_only=not include_inactive
            )
        ],
        notes=note,
    )


@router.post("/lists/{list_type}/items", response_model=ListItem, status_code=201)
def add_list_item(
    list_type: str,
    payload: ListItemCreate,
    user: UserOut = Depends(require_admin),
) -> ListItem:
    try:
        item = platform_store.add_list_item(list_type, payload.label)
    except KeyError:
        raise HTTPException(status_code=404, detail="Unknown list type.") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    platform_store.record_audit(
        actor_user_id=user.id,
        actor_name=actor_label(user),
        action="list_item_added",
        category="lists",
        summary=f"Added “{item['label']}” to {list_type}",
        details={"list_type": list_type, "label": item["label"]},
    )
    return ListItem(**item)


@router.patch("/lists/{list_type}/items/{item_id}", response_model=ListItem)
def update_list_item(
    list_type: str,
    item_id: str,
    payload: ListItemUpdate,
    user: UserOut = Depends(require_admin),
) -> ListItem:
    try:
        item = platform_store.rename_list_item(
            list_type,
            item_id,
            payload.label,
            is_active=payload.is_active,
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="List value not found.") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    status = "active" if item.get("is_active", True) else "inactive"
    platform_store.record_audit(
        actor_user_id=user.id,
        actor_name=actor_label(user),
        action="list_item_updated",
        category="lists",
        summary=f"Updated “{item['label']}” in {list_type} ({status})",
        details={
            "list_type": list_type,
            "label": item["label"],
            "is_active": item.get("is_active", True),
        },
    )
    return ListItem(**item)


@router.delete("/lists/{list_type}/items/{item_id}")
def delete_list_item(
    list_type: str,
    item_id: str,
    user: UserOut = Depends(require_admin),
) -> dict:
    try:
        deleted = platform_store.delete_list_item(list_type, item_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="List value not found.") from None
    label = deleted.get("label") if isinstance(deleted, dict) else item_id
    platform_store.record_audit(
        actor_user_id=user.id,
        actor_name=actor_label(user),
        action="list_item_deleted",
        category="lists",
        summary=f"Deleted “{label}” from {list_type}",
        details={"list_type": list_type, "label": label},
    )
    return {"ok": True}


@router.get("/cases", response_model=CaseList)
def list_cases(
    record_type: str | None = None,
    status: str | None = None,
    project: str | None = None,
    user: UserOut = Depends(get_current_user),
) -> CaseList:
    rows = platform_store.list_cases(record_type, status, project)
    rows = platform_store.filter_cases_for_user(rows, user.model_dump())
    return CaseList(
        items=[as_summary(row) for row in rows],
        total=len(rows),
        storage=platform_store.storage_label(),
    )


@router.get("/cases/{case_id}", response_model=CaseDetail)
def get_case(case_id: str) -> CaseDetail:
    row = platform_store.get_case(case_id)
    if not row:
        raise HTTPException(status_code=404, detail="Record not found.")
    return as_detail(row)


@router.patch("/cases/{case_id}", response_model=CaseDetail)
def patch_case(
    case_id: str,
    payload: CaseAdminUpdate,
    user: UserOut = Depends(require_admin),
) -> CaseDetail:
    try:
        row = platform_store.update_case_admin(case_id, payload)
    except ValueError as exc:
        _http_value_error(exc)
    if not row:
        raise HTTPException(status_code=404, detail="Record not found.")
    platform_store.record_audit(
        actor_user_id=user.id,
        actor_name=actor_label(user),
        action="case_edited",
        category="records",
        summary=f"Edited {row.get('case_id', case_id)}",
        case_id=row.get("case_id"),
        details={
            "record_id": case_id,
            "record_type": row.get("record_type"),
            "project": row.get("project"),
            "department": row.get("department"),
        },
    )
    return as_detail(row)


@router.post("/ai-camera-observations", status_code=201, response_model=CaseDetail)
def create_ai_camera(
    payload: AiCameraCreate,
    user: UserOut = Depends(require_capability("register")),
) -> CaseDetail:
    try:
        return as_detail(platform_store.create_ai_camera(payload))
    except ValueError as exc:
        _http_value_error(exc)


@router.post("/dashcam-observations", status_code=201)
def create_dashcam(
    payload: DashcamCreate,
    user: UserOut = Depends(require_capability("register")),
):
    try:
        return platform_store.create_dashcam(payload)
    except ValueError as exc:
        _http_value_error(exc)


@router.post("/speed-violations", status_code=201)
def create_speed(
    payload: SpeedCreate,
    user: UserOut = Depends(require_capability("register")),
):
    try:
        return platform_store.create_speed(payload)
    except ValueError as exc:
        _http_value_error(exc)


@router.post("/sos-alerts", status_code=201)
def create_sos(
    payload: SosCreate,
    user: UserOut = Depends(require_capability("register")),
):
    try:
        return platform_store.create_sos(payload, actor=actor_label(user))
    except ValueError as exc:
        _http_value_error(exc)


@router.post("/itqan-violations", status_code=201, response_model=CaseDetail)
def create_itqan(
    payload: ItqanCreate,
    user: UserOut = Depends(require_capability("register")),
):
    try:
        return as_detail(platform_store.create_itqan(payload, actor=actor_label(user)))
    except ValueError as exc:
        _http_value_error(exc)


@router.post("/itqan-violations/{case_id}/status", response_model=CaseDetail)
def update_itqan_status(
    case_id: str,
    payload: ItqanStatusUpdate,
    user: UserOut = Depends(require_admin),
):
    try:
        row = platform_store.update_itqan_status(
            case_id, payload, actor=actor_label(user)
        )
    except ValueError as exc:
        _http_value_error(exc)
    if not row:
        raise HTTPException(status_code=404, detail="ITQAN violation not found.")
    platform_store.record_audit(
        actor_user_id=user.id,
        actor_name=actor_label(user),
        action="itqan_status_changed",
        category="records",
        summary=f"ITQAN status → {(row.get('fields') or {}).get('itqan_status')}",
        case_id=row.get("case_id"),
        details={
            "record_id": case_id,
            "itqan_status": (row.get("fields") or {}).get("itqan_status"),
        },
    )
    return as_detail(row)


@router.post("/ai-camera-observations/{case_id}/close-out")
def close_out_ai_camera(
    case_id: str,
    payload: AiCameraCloseOut,
    user: UserOut = Depends(require_capability("close_out")),
):
    try:
        row = platform_store.close_out_ai_camera(
            case_id, payload, actor=actor_label(user)
        )
    except ValueError as exc:
        _http_value_error(exc)
    if not row:
        raise HTTPException(status_code=404, detail="AI Camera observation not found.")
    return row


@router.post("/dashcam-observations/{case_id}/confirm-driver")
def confirm_dashcam_driver(
    case_id: str,
    payload: ConfirmDriver,
    user: UserOut = Depends(require_capability("confirm_driver")),
):
    try:
        row = platform_store.confirm_driver(
            case_id, "dashcam", payload, actor=actor_label(user)
        )
    except ValueError as exc:
        _http_value_error(exc)
    if not row:
        raise HTTPException(status_code=404, detail="DashCam observation not found.")
    return row


@router.post("/speed-violations/{case_id}/confirm-driver")
def confirm_speed_driver(
    case_id: str,
    payload: ConfirmDriver,
    user: UserOut = Depends(require_capability("confirm_driver")),
):
    try:
        row = platform_store.confirm_driver(
            case_id, "speed", payload, actor=actor_label(user)
        )
    except ValueError as exc:
        _http_value_error(exc)
    if not row:
        raise HTTPException(status_code=404, detail="Speed violation not found.")
    return row


@router.post("/sos-alerts/{case_id}/close")
def close_sos(
    case_id: str,
    payload: SosClose,
    user: UserOut = Depends(require_capability("close_sos")),
):
    try:
        row = platform_store.close_sos(case_id, payload, actor=actor_label(user))
    except ValueError as exc:
        _http_value_error(exc)
    if not row:
        raise HTTPException(status_code=404, detail="SOS alert not found.")
    return row


@router.get("/dashboard/overview")
def dashboard_overview(
    period: str = Query(default="this_week"),
    view: str = Query(default="overall"),
    project: str | None = None,
    department: str | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    user: UserOut = Depends(get_current_user),
):
    try:
        return platform_store.dashboard(
            period=period,
            view=view,
            project=project,
            department=department,
            start_date=start_date,
            end_date=end_date,
            user=user.model_dump(),
        )
    except ValueError as exc:
        _http_value_error(exc)


@router.get("/review/records", response_model=CaseList)
def review_records(status: str | None = None, record_type: str | None = None):
    rows = platform_store.list_cases(record_type, status)
    return CaseList(
        items=[as_summary(row) for row in rows],
        total=len(rows),
        storage=platform_store.storage_label(),
    )


@router.get("/weather")
def get_weather():
    return {
        "prototype": True,
        "hours": ["7:00 AM to 2:00 PM as shown on the template"],
        "sheets": platform_store.get_weather(),
    }


@router.put("/weather")
def put_weather(
    sheets: list[WeatherSheetIn],
    user: UserOut = Depends(require_capability("record_weather")),
):
    try:
        return {"sheets": platform_store.save_weather(sheets)}
    except ValueError as exc:
        _http_value_error(exc)


@router.get("/weather/stations")
def get_weather_stations(project: str | None = None):
    return {"items": platform_store.list_weather_stations(project)}


@router.get("/weather/hourly")
def get_weather_hourly(
    project: str = Query(..., min_length=1),
    observed_on: date = Query(...),
):
    return {
        "project": project,
        "observed_on": observed_on.isoformat(),
        "tables": platform_store.get_weather_hourly(project, observed_on),
    }


@router.get("/weather/day-maxes")
def get_weather_day_maxes(
    date_from: date = Query(...),
    date_to: date = Query(...),
    project: str | None = None,
    user: UserOut = Depends(get_current_user),
):
    allowed = [str(p) for p in (user.projects or [])]
    if project:
        if allowed and project not in allowed:
            return {"items": []}
        projects = None
        project_filter = project
    elif allowed:
        projects = allowed
        project_filter = None
    else:
        projects = None
        project_filter = None
    return {
        "items": platform_store.get_weather_day_maxes(
            date_from,
            date_to,
            project=project_filter,
            projects=projects,
        ),
    }


@router.put("/weather/hourly")
def put_weather_hourly(
    body: WeatherHourlySaveIn,
    user: UserOut = Depends(require_capability("record_weather")),
):
    try:
        if not body.logged_by:
            body.logged_by = actor_label(user)
        tables = platform_store.save_weather_hourly(body)
    except ValueError as exc:
        _http_value_error(exc)
    platform_store.record_audit(
        actor_user_id=user.id,
        actor_name=actor_label(user),
        action="weather_hourly_saved",
        category="weather",
        summary=f"Saved hourly weather for {body.location} on {body.observed_on.isoformat()}",
        details={
            "station_id": body.station_id,
            "project": body.project,
            "observed_on": body.observed_on.isoformat(),
            "reading_count": len(body.readings),
        },
    )
    return {"tables": tables}


@router.get("/weather/weekly")
def get_weather_weekly(
    project: str | None = None,
    user: UserOut = Depends(get_current_user),
):
    allowed = user.projects
    if project:
        if allowed and project not in {str(p) for p in allowed}:
            return {"items": []}
        projects = [project]
    elif allowed:
        projects = [str(p) for p in allowed]
    else:
        projects = None
    return {"items": platform_store.list_weather_weekly_logs(projects)}


@router.get("/weather/weekly/preview")
def get_weather_weekly_preview(
    project: str = Query(..., min_length=1),
    week_start: date = Query(...),
):
    try:
        return platform_store.build_weather_weekly_preview(project, week_start)
    except ValueError as exc:
        _http_value_error(exc)


@router.get("/weather/weekly/{log_id}")
def get_weather_weekly_log(log_id: str):
    row = platform_store.get_weather_weekly_log(log_id)
    if not row:
        raise HTTPException(status_code=404, detail="Weekly weather log not found.")
    return row


@router.post("/weather/weekly")
def post_weather_weekly(
    body: WeatherWeeklySubmitIn,
    user: UserOut = Depends(require_capability("record_weather")),
):
    try:
        if not body.submitted_by:
            body.submitted_by = actor_label(user)
        row = platform_store.submit_weather_weekly(body)
    except ValueError as exc:
        _http_value_error(exc)
    platform_store.record_audit(
        actor_user_id=user.id,
        actor_name=actor_label(user),
        action="weather_weekly_submitted",
        category="weather",
        summary=f"Submitted weekly weather log {row['id']}",
        details={
            "id": row["id"],
            "project": row["project"],
            "week_start": row["weekStartIso"],
        },
    )
    return row


@router.get("/contacts")
def get_contacts(project_id: str | None = None):
    return {"items": platform_store.list_contacts(project_id)}


@router.post("/cases/{case_id}/approve")
def approve_case(case_id: str, user: UserOut = Depends(require_admin)):
    try:
        row = platform_store.approve_case(case_id, actor_label(user))
    except ValueError as exc:
        _http_value_error(exc)
    if not row:
        raise HTTPException(status_code=404, detail="Record not found.")
    platform_store.record_audit(
        actor_user_id=user.id,
        actor_name=actor_label(user),
        action="case_approved",
        category="records",
        summary=f"Approved {row.get('case_id', case_id)}",
        case_id=row.get("case_id"),
        details={
            "record_id": case_id,
            "record_type": row.get("record_type"),
            "project": row.get("project"),
            "department": row.get("department"),
        },
    )
    return row


@router.post("/cases/{case_id}/reject")
def reject_case(
    case_id: str,
    payload: RejectBody,
    user: UserOut = Depends(require_admin),
):
    try:
        row = platform_store.reject_case(case_id, payload.reason, actor_label(user))
    except ValueError as exc:
        _http_value_error(exc)
    if not row:
        raise HTTPException(status_code=404, detail="Record not found.")
    platform_store.record_audit(
        actor_user_id=user.id,
        actor_name=actor_label(user),
        action="case_rejected",
        category="records",
        summary=f"Rejected {row.get('case_id', case_id)}",
        case_id=row.get("case_id"),
        details={
            "record_id": case_id,
            "record_type": row.get("record_type"),
            "reason": payload.reason.strip(),
            "project": row.get("project"),
            "department": row.get("department"),
        },
    )
    return row


@router.post("/cases/{case_id}/delete")
def delete_case(
    case_id: str,
    payload: ConfirmDelete,
    user: UserOut = Depends(require_admin),
):
    try:
        row = platform_store.delete_case(case_id, payload.confirm, actor_label(user))
    except ValueError as exc:
        _http_value_error(exc)
    if not row:
        raise HTTPException(status_code=404, detail="Record not found.")
    platform_store.record_audit(
        actor_user_id=user.id,
        actor_name=actor_label(user),
        action="case_deleted",
        category="records",
        summary=f"Deleted {row.get('case_id', case_id)}",
        case_id=row.get("case_id"),
        details={
            "record_id": case_id,
            "record_type": row.get("record_type"),
            "project": row.get("project"),
            "department": row.get("department"),
        },
    )
    return {"ok": True}


@router.post("/contacts", status_code=201)
def post_contact(payload: ContactCreate, user: UserOut = Depends(require_admin)):
    try:
        row = platform_store.add_contact(payload)
    except ValueError as exc:
        _http_value_error(exc)
    platform_store.record_audit(
        actor_user_id=user.id,
        actor_name=actor_label(user),
        action="contact_added",
        category="contacts",
        summary=f"Added contact “{row.get('name')}” ({row.get('project')})",
        details={
            "contact_id": row.get("id"),
            "name": row.get("name"),
            "project": row.get("project"),
            "project_id": row.get("project_id"),
            "category": row.get("category"),
        },
    )
    return row


@router.patch("/contacts/{contact_id}")
def patch_contact(
    contact_id: str,
    payload: ContactUpdate,
    user: UserOut = Depends(require_admin),
):
    try:
        row = platform_store.update_contact(contact_id, payload)
    except ValueError as exc:
        _http_value_error(exc)
    if not row:
        raise HTTPException(status_code=404, detail="Contact not found.")
    platform_store.record_audit(
        actor_user_id=user.id,
        actor_name=actor_label(user),
        action="contact_updated",
        category="contacts",
        summary=f"Updated contact “{row.get('name')}” ({row.get('project')})",
        details={
            "contact_id": contact_id,
            "name": row.get("name"),
            "project": row.get("project"),
            "project_id": row.get("project_id"),
            "category": row.get("category"),
        },
    )
    return row


@router.delete("/contacts/{contact_id}")
def remove_contact(contact_id: str, user: UserOut = Depends(require_admin)):
    deleted = platform_store.delete_contact(contact_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Contact not found.")
    platform_store.record_audit(
        actor_user_id=user.id,
        actor_name=actor_label(user),
        action="contact_deleted",
        category="contacts",
        summary=f"Deleted contact “{deleted.get('name')}” ({deleted.get('project')})",
        details={
            "contact_id": contact_id,
            "name": deleted.get("name"),
            "project": deleted.get("project"),
            "project_id": deleted.get("project_id"),
            "category": deleted.get("category"),
        },
    )
    return {"ok": True}


@router.get("/hw")
def get_hw():
    return platform_store.get_hw()


@router.put("/hw")
def put_hw(payload: HwUpdate, user: UserOut = Depends(require_admin)):
    saved = platform_store.save_hw(payload)
    project_total = int(saved.get("all_projects") or 0)
    dept_total = sum(
        int(counts.get("avl") or 0) + int(counts.get("dashcam") or 0)
        for counts in (saved.get("department_counts") or {}).values()
    )
    platform_store.record_audit(
        actor_user_id=user.id,
        actor_name=actor_label(user),
        action="hw_updated",
        category="hw",
        summary="Updated SCC HW device counts",
        details={
            "project_total": project_total,
            "department_total": dept_total,
            "last_updated_at": saved.get("last_updated_at"),
        },
    )
    return saved


@router.get("/hw/register")
def get_hw_register(user: UserOut = Depends(get_current_user)):
    del user
    return platform_store.get_hw_register()


@router.get("/hw/register/template")
def download_hw_register_template(user: UserOut = Depends(get_current_user)):
    del user
    try:
        path = platform_store.hw_register_template_path()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return FileResponse(
        path,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename="SCC_HW_Device_Register_Template.xlsx",
    )


@router.post("/hw/register/import")
async def import_hw_register(
    file: UploadFile = File(...),
    user: UserOut = Depends(require_admin),
):
    name = (file.filename or "").lower()
    if not name.endswith((".xlsx", ".xlsm")):
        raise HTTPException(
            status_code=400,
            detail="Upload the Excel template (.xlsx).",
        )
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    try:
        result = platform_store.import_hw_register_excel(content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    platform_store.record_audit(
        actor_user_id=user.id,
        actor_name=actor_label(user),
        action="hw_register_imported",
        category="hw",
        summary=(
            f"Imported HW device register ({result['added']} added, "
            f"{result['updated']} updated)"
        ),
        details={
            "imported": result["imported"],
            "added": result["added"],
            "updated": result["updated"],
            "filename": file.filename,
        },
    )
    return result


@router.get("/reports")
def get_reports(user: UserOut = Depends(get_current_user)):
    return platform_store.reports(user=user.model_dump())


@router.post("/reports/{report_id}/sign")
def sign_report(
    report_id: str,
    user: UserOut = Depends(get_current_user),
    signature: str = Query("", max_length=200),
):
    if not user.capabilities.get("sign_reports") or user.role != "dept_hse":
        raise HTTPException(status_code=403, detail="Signing weekly reports requires the Dept HSE role.")
    try:
        item = platform_store.sign_report(
            report_id,
            actor=actor_label(user),
            signature=signature or actor_label(user),
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="Report not found.") from None
    except ValueError as exc:
        _http_value_error(exc)
    platform_store.record_audit(
        actor_user_id=user.id,
        actor_name=actor_label(user),
        action="report_signed",
        category="reports",
        summary=f"Signed weekly report {report_id}",
        details={"report_id": report_id, "scope": item.get("scope")},
    )
    return item


@router.post("/reports/{report_id}/issue")
def issue_report(
    report_id: str,
    user: UserOut = Depends(require_admin),
    recipient: str = Query("Project PM", max_length=200),
):
    try:
        item = platform_store.issue_report(
            report_id,
            actor=actor_label(user),
            recipient=recipient,
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="Report not found.") from None
    except ValueError as exc:
        _http_value_error(exc)
    platform_store.record_audit(
        actor_user_id=user.id,
        actor_name=actor_label(user),
        action="report_issued",
        category="reports",
        summary=f"Issued monthly report {report_id}",
        details={"report_id": report_id, "recipient": recipient},
    )
    return item


@router.get("/notifications/overdue")
def overdue_notifications(user: UserOut = Depends(get_current_user)):
    return platform_store.overdue_notifications(user.model_dump())


@router.get("/admin/settings")
def get_settings(user: UserOut = Depends(require_admin)):
    del user
    return platform_store.get_platform_settings()


@router.get("/settings/integrations")
def get_integration_settings(user: UserOut = Depends(get_current_user)):
    """SafeLife / ITQAN form toggles — readable by every signed-in role."""
    del user
    settings = platform_store.get_platform_settings()
    return {
        "safelifeAsk": bool(settings.get("safelifeAsk", True)),
        "safelifeDefault": bool(settings.get("safelifeDefault", True)),
        "itqanAsk": bool(settings.get("itqanAsk", True)),
        "itqanDefault": bool(settings.get("itqanDefault", True)),
    }


@router.put("/admin/settings")
def put_settings(payload: dict, user: UserOut = Depends(require_admin)):
    saved = platform_store.save_platform_settings(payload)
    platform_store.record_audit(
        actor_user_id=user.id,
        actor_name=actor_label(user),
        action="settings_updated",
        category="admin",
        summary="Updated platform settings",
        details={},
    )
    return saved


@router.get("/hw/transfers")
def get_hw_transfers(user: UserOut = Depends(get_current_user)):
    del user
    return platform_store.get_hw_transfers()


@router.post("/hw/transfers/{transfer_id}/receive")
def receive_hw_transfer(transfer_id: str, user: UserOut = Depends(get_current_user)):
    if not user.capabilities.get("receive_hw"):
        raise HTTPException(status_code=403, detail="Receiving transfers requires Project PM or Admin.")
    try:
        item = platform_store.receive_hw_transfer(transfer_id, actor=actor_label(user))
    except KeyError:
        raise HTTPException(status_code=404, detail="Transfer not found.") from None
    platform_store.record_audit(
        actor_user_id=user.id,
        actor_name=actor_label(user),
        action="hw_transfer_received",
        category="hw",
        summary=f"Received transfer {transfer_id}",
        details={"transfer_id": transfer_id},
    )
    return item


@router.get("/operator-performance")
def get_operator_performance(
    user: UserOut = Depends(require_admin),
    period: str = Query("this_week"),
    start_date: date | None = None,
    end_date: date | None = None,
    operator: str | None = None,
    record_type: str | None = None,
    project: str | None = None,
    action: str | None = None,
):
    del user
    try:
        return platform_store.operator_performance(
            period=period,
            start_date=start_date,
            end_date=end_date,
            operator=operator,
            record_type=record_type,
            project=project,
            action=action,
        )
    except ValueError as exc:
        _http_value_error(exc)
