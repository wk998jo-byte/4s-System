# SCC Platform — API Design

**Stage:** backend design only. Not implemented.  
**Stack status:** FastAPI + OpenAPI is **proposed**, not company-approved. Paths and schemas can be regenerated if the company later mandates another backend.

**Primary source:** Requirements v2.8. Supporting: `docs/REQUIREMENTS_ANALYSIS.md`, `docs/WORKFLOW_RULES.md`, `docs/OPEN_QUESTIONS.md`.

A future frontend is **not** trusted to enforce roles, status, or required fields **[Fact — §2.1, §1.3, §11]**.

**Not in this API:** ITQAN/camera/FMS/weather-station integrations **[Fact — §1.3]**; notification push **[Fact — §1.4]**; Analytics, overdue, contractor fields **[Fact — §1.4]**; a global header-search endpoint unless D3 is confirmed; a permission-toggle editor unless D1 is confirmed.

---

## 1. Conventions

Base path **[Recommendation]:** `/api/v1`.

### 1.1 Authentication

Every endpoint except `POST /api/v1/auth/login` (and a future health check) requires an authenticated user **[Fact — §11]**. Login method is **[Uncertain — C1]**. This design assumes a session cookie or bearer token issued after platform login; SSO would replace login but not `/auth/me`.

Failed auth: `401` with code `UNAUTHENTICATED`.  
Failed role: `403` with code `ACCESS_DENIED` (Operators hitting Admin-only URLs) **[Fact — §2.1]**.

### 1.2 Pagination

List endpoints:

| Query | Default | Notes |
| --- | --- | --- |
| `page` | 1 | 1-based |
| `page_size` | 20 | Max 100 **[Recommendation]** |

Response envelope:

```json
{
  "items": [],
  "page": 1,
  "page_size": 20,
  "total": 0
}
```

Dashboard and report **aggregations** are not paginated (they return summary objects). Report **detail rows** are paginated or returned in full for export.

### 1.3 Filtering and sorting (lists)

Common query parameters on record lists and Review:

| Param | Meaning |
| --- | --- |
| `status` | `open` \| `under_process` \| `closed` |
| `project_id` | list_item id (`project` type) |
| `department_id` | Dashcam/Speed only |
| `record_type` | Review only: `ai_camera` \| `dashcam` \| `speed` \| `sos` |
| `q` | Case ID or name **on Review and module lists** (UI lists). Header global search is **[Uncertain — D3]** and is **not** a separate endpoint here |
| `week_year`, `week_number` | Optional |
| `date_from`, `date_to` | Inclusive dates in AST |
| `sort` | Default `-occurred_on` (newest first). Allow `occurred_on`, `case_id`, `status` |

Unknown sort fields: `400` `INVALID_QUERY`.

### 1.4 Error response

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Iqama Number is required when Rental driver is Yes.",
    "details": [
      { "field": "iqama_number", "code": "REQUIRED_CONDITIONAL" }
    ]
  }
}
```

| HTTP | `code` | When |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Missing/invalid fields, illegal status transition, reject without reason |
| 401 | `UNAUTHENTICATED` | No/invalid session |
| 403 | `ACCESS_DENIED` | Role cannot perform the action |
| 404 | `NOT_FOUND` | Unknown or **logically deleted** record (deleted records must not appear) **[Fact — §2]** |
| 409 | `CONFLICT` | Duplicate case_id (should not happen), unique list label |
| 413 | `PAYLOAD_TOO_LARGE` | Attachment over limit **[Uncertain — C4]** |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Attachment type |
| 500 | `INTERNAL_ERROR` | |

### 1.5 Status and derived fields

Clients **must not** send `status`, `week_number`, `case_id`, `close_out_action` (violations), or speed `alert_summary`. If sent, ignore or `400` `READ_ONLY_FIELD` **[Fact — §1.3]**.

### 1.6 Delete confirmation

Admin delete APIs require a body `{ "confirm": true }` **[Recommendation]** corresponding to “after a confirmation message” **[Fact — §2]**. `confirm: false` or omitted → `400`.

### 1.7 File uploads and downloads

| Kind | Method | Content type |
| --- | --- | --- |
| Upload | `POST .../attachments` | `multipart/form-data` field `file` plus `field_name` |
| Download | `GET /api/v1/attachments/{id}/content` | File bytes; **authenticated** **[Fact — §11]** |
| Metadata | included on parent GET | `{ "id", "filename", "content_type", "field_name" }` |

Export:

| Endpoint | Response |
| --- | --- |
| Report / HW / Operator Performance export | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` or `application/pdf` |

---

## 2. Audit logging

Write an `audit_events` row **after success** for:

**Required by §11 / §9.2 [Fact]:** create record (`registered`); edit; SOS close (`sos_closed`); AI Camera close-out submit (`close_out_submitted`); Confirm Driver & Submit (`confirm_driver`); approve; reject; delete record.

**Also required so Admin user delete is traceable [Fact — §2]:** delete user.

**Recommended (not named in §9.2 but needed for a complete log):** weather save, contact CRUD, HW update, list add/edit/disable, user create/role change. Operator Performance **does not** count these in Total actions.

GET endpoints do not write audit rows.

---

## 3. Authentication

### `POST /api/v1/auth/login`

- **Role:** public.
- **Purpose:** establish a session. **[Uncertain — C1]** body may be `{ "username", "password" }` or an SSO callback later.
- **Response:** `{ "user": { "id", "display_name", "role" } }` plus Set-Cookie or `{ "access_token" }`.
- **Errors:** `401` invalid credentials.

### `POST /api/v1/auth/logout`

- **Role:** authenticated.
- **Purpose:** invalidate session.
- **Response:** `204`.

### `GET /api/v1/auth/me`

- **Role:** authenticated.
- **Purpose:** current user and **capabilities derived from the fixed §2 matrix** (not a stored ACL).
- **Response:** `{ "id", "display_name", "role", "capabilities": { "approve": false, "manage_users": false, ... } }`.
- Used by a future UI to lock Administration / Operator Performance. Server still enforces.

---

## 4. Users and roles (Administration)

All routes: **Admin only** **[Fact — §2]**. Operator → `403 ACCESS_DENIED`.

### `GET /api/v1/admin/users`

- List non-deleted users: display_name, role, badge_number, is_active.
- Paginated.

### `POST /api/v1/admin/users`

- **Body:** `{ "display_name", "role", "username"?, "password"?, "badge_number"? }` depending on C1.
- **Response:** `201` user.
- **Errors:** invalid role, missing password if platform accounts.
- **Audit:** user created.
- **Do not** auto-insert Reported By **[Uncertain — D8]**.

### `PATCH /api/v1/admin/users/{id}`

- Change role, display_name, is_active, badge_number. Not password via this doc until C1.
- Operator cannot call.
- **Audit:** `user_role_changed` / `edited`.

### `DELETE /api/v1/admin/users/{id}`

- Body `{ "confirm": true }`.
- Soft-delete user. **Name remains on records** **[Fact — §2]**.
- **Audit:** `user_deleted`.
- **Errors:** cannot delete last Admin **[Recommendation — not specified; flag as product question if needed]**. Not in OPEN_QUESTIONS as a documented gap about last admin — I'll mention as recommendation only in passing... actually user said don't invent. Skip last-admin rule or mark uncertain. I'll say: specification does not say whether the last Admin can be deleted **[Uncertain — not numbered]**. Return 400 only if we add it after confirmation. Don't invent: allow delete as specified.

---

## 5. Administration — dropdown lists

**Admin write; all authenticated users read active items** **[Fact — §5]**.

### `GET /api/v1/lists/{list_type}`

- **Role:** Operator, Admin.
- **Query:** `include_inactive=true` **Admin only**.
- **Response:** `{ "list_type", "items": [ { "id", "label", "is_active", "sort_order" } ] }`.
- **Errors:** unknown `list_type` → `404`.
- **Special:** `GET /lists/project` does **not** include Dhahran **[Fact — §7; Uncertain — B4]**.
- **Special:** `GET /lists/hw-site` returns the four projects plus Dhahran for SCC HW.

### `POST /api/v1/admin/lists/{list_type}/items`

- **Role:** Admin.
- **Body:** `{ "label", "sort_order"? }`.
- **Errors:** empty label; Status cannot be created this way.
- **Audit:** `list_changed`.

### `PATCH /api/v1/admin/lists/items/{id}`

- **Role:** Admin.
- **Body:** `{ "label"?, "is_active"?, "sort_order"? }`.
- Disable rather than delete if referenced **[Recommendation]**.
- **Audit:** `list_changed`.

No endpoint to rewrite the §2 permission matrix **[Uncertain — D1]**.

`GET /api/v1/admin/permission-matrix` **[Recommendation, read-only]:** returns the documented Operator/Admin table as JSON so the Administration “Roles and permissions” panel can render **without** being editable. Operator → `403`.

---

## 6. AI Camera Observations

**Roles:** Operator and Admin may register and submit close-out. Only Admin may edit original submitted fields, approve, reject, delete **[Fact — §2, §3.2]**.

Required-at-register vs UI asterisks: **[Uncertain]**. Until confirmed, validate the set the UI marks with `*` (see WORKFLOW_RULES) and keep them listed as “UI-observed”.

### `GET /api/v1/ai-camera-observations`

- **Role:** Operator, Admin.
- **Purpose:** module list (filters, pagination).
- **Response:** summaries: case_id, project, location, date, alert_type, category, risk_level, status, reported_by.

### `GET /api/v1/ai-camera-observations/{id}`

- Full record including close-out, rejection_reason, closed_by, attachments metadata.
- Deleted → `404`.

### `POST /api/v1/ai-camera-observations`

- **Role:** Operator, Admin.
- **Body:** project, location, date, time, alert_summary, alert_type_id, category_id, risk_level_id, detection_method_id, reported_by_id. **Not** close-out fields **[Fact — §4]**; **[Uncertain — D5]**.
- **Attachments:** `observation_picture` must already be uploaded (id) or sent multipart in the same request **[Recommendation]**. If missing → `VALIDATION_ERROR`.
- **SYS:** status=`open`, case_id, week from date.
- **Response:** `201` full record.
- **Audit:** `registered`.

### `POST /api/v1/ai-camera-observations/{id}/attachments`

- **Upload.** `field_name`: `observation_picture` (only while creating / Admin edit) or `close_out_picture` (close-out).
- **Role:** Operator, Admin.
- **Errors:** 415, 413, wrong field for status.

### `POST /api/v1/ai-camera-observations/{id}/close-out`

- **Role:** Operator, Admin.
- **Allowed status:** `open` (including after rejection) **[Fact — §3.2]**.
- **Body:** `hseo_name_badge`, `close_out_action`, `close_out_picture_id` (all required).
- **Result:** `under_process`.
- **Errors:** missing close-out fields; wrong status.
- **Audit:** `close_out_submitted`.

### `PATCH /api/v1/ai-camera-observations/{id}`

- **Admin:** original details when not deleted.
- **Operator:** **not** after submission **[Fact — §2]**. After rejection, Operator uses close-out only unless E7 says otherwise → **[Uncertain — E7]**; API should reject Operator PATCH on original fields with `403` until E7 is answered.
- **Audit:** `edited`.

### `POST /api/v1/ai-camera-observations/{id}/approve`

- **Role:** Admin. Status must be `under_process`.
- **Result:** `closed`; store approving Admin name **[Fact — §3.2]**.
- **Audit:** `approved`.

### `POST /api/v1/ai-camera-observations/{id}/reject`

- **Role:** Admin. Status `under_process`.
- **Body:** `{ "reason": "..." }` required non-empty.
- **Result:** `open`; reason stored and returned on GET.
- **Audit:** `rejected`.

### `DELETE /api/v1/ai-camera-observations/{id}`

- **Role:** Admin. `{ "confirm": true }`.
- Hide from all lists/counts/reports **[Fact — §2]**.
- **Audit:** `deleted` with Admin name.

---

## 7. DashCam Observations

Same list/get/delete/approve/reject/Admin-edit pattern as AI Camera at:

- `GET/POST /api/v1/dashcam-observations`
- `GET/PATCH/DELETE /api/v1/dashcam-observations/{id}`
- `POST .../approve` `POST .../reject`
- `POST .../attachments` (`violation_picture`, `itqan_upload_proof`)

### `POST /api/v1/dashcam-observations`

- **Body:** `assign_to` (`project`|`department`) and matching id; vehicle_type_id; model_id; asset_number; driver_name; driver_badge_number; `rental_driver` default false; `iqama_number` required if rental **[Fact]**; location_coordinates; date; time; violation_type_id; risk_level_id; alert_summary_id (must be an active Dashcam Alert Summary — list may be empty until A1); violation_picture; reported_by_id.
- **Not accepted:** ITQAN proof, uploaded_by, close_out_action.
- **SYS:** status=`open`.
- **Errors:** both project and department; neither; rental without Iqama; inactive list ids.
- **Audit:** `registered`.

### `PATCH /api/v1/dashcam-observations/{id}`

- **Operator:** driver details **only while status is `open` and Confirm Driver has not occurred** **[Fact — §3.3]**.
- **Admin:** original details after that.
- **Audit:** `edited`.

### `POST /api/v1/dashcam-observations/{id}/confirm-driver`

- **Role:** Operator or Admin **[Fact — §2 table Yes/Yes]**; **[Uncertain — E8]** Uploaded by still from Operator-name list.
- **Status:** `open`.
- **Body:** `itqan_proof_id`, `uploaded_by_id`. One step, one person **[Fact — §3.3]**.
- **SYS:** `close_out_action` = `The Violation has been uploaded in ITQAN`; status=`under_process`; timestamp and actor name.
- **Errors:** missing proof or uploaded_by; wrong status.
- **Audit:** `confirm_driver` (counts as Uploaded to ITQAN even if actor ≠ registrar) **[Fact — §9.2]**.

No ITQAN HTTP call.

---

## 8. Speed Violations

Same as Dashcam at `/api/v1/speed-violations`, plus:

**Create body extra:** `speed_violation_type_id` (ROW or Public Road, required **[Fact]**); `position`; `permitted_speed_kmh`; `vehicle_speed_kmh`; `fms_evidence_id` (image or file).

**SYS:** `exceedance_kmh` = vehicle − permitted **[Fact — §4.3]**; `alert_summary` from the documented templates (see `WORKFLOW_RULES.md`). Reject negative exceedance only if E3 is confirmed; until then **do not invent** a minimum.

**Confirm-driver** identical to Dashcam (ITQAN proof image, uploaded_by, automatic close-out text).

**Attachments `field_name`:** `fms_evidence`, `itqan_upload_proof`.

---

## 9. SOS Alerts

No approve/reject. No `under_process` **[Fact — §3.4]**.

### `GET /api/v1/sos-alerts` / `GET /api/v1/sos-alerts/{id}`

- Operator, Admin.

### `POST /api/v1/sos-alerts`

- **Body:** project_id, worker_name_badge, sos_created_at, seen_at, location, source_id.
- **Not required at register:** four closure fields **[Fact]**.
- **SYS:** status=`open`; week from `sos_created_at`; optional `time_to_see_seconds`.
- **Do not** require Seen At ≥ Created At unless E1 is confirmed.
- **Audit:** `registered`.

### `POST /api/v1/sos-alerts/{id}/attachments`

- `worker_picture`; optionally `sos_close_out_file` **only if B3 confirms**.

### `POST /api/v1/sos-alerts/{id}/close`

- **Role:** Operator, Admin **[Fact — §2]**.
- **Status:** `open`.
- **Body:** worker_picture_id, picture_shared_by, closure_closed_at, close_out_report; optional file id if B3.
- All four closure fields required **[Fact — §3.4]**.
- **SYS:** status=`closed`; `closed_by_*` = current user; server `closed_at`.
- **Audit:** `sos_closed` (counts as Close-outs) **[Fact — §9.2]**.

### `PATCH` / `DELETE`

- PATCH original: Admin only after submit **[Fact — §2]**.
- DELETE: Admin + confirm.

---

## 10. Central Review & Records

**[Fact — §2.1]** Shown to both roles. Admin reviews close-outs here **[UI observation]**.

### `GET /api/v1/review/records`

- **Role:** Operator, Admin.
- **Query:** `status` (or tabs: all/open/under_process/closed), `record_type`, `project_id`, `q`, pagination.
- **Response:** unified rows: case_id, type, project_or_department, date, status, handled_by (derived: “Waiting for Confirm Driver & Submit” | “Waiting for review” | “Closed by {label}”).
- Counts for tabs: `{ "all", "open", "under_process", "closed" }` excluding deleted.

Detail is `GET` on the type-specific resource. Approve/reject/delete use type-specific POSTs so workflow rules stay in one place.

No extra Review write API.

---

## 11. Dashboards

Read-only. **Role:** Operator, Admin. Recalculate from current (non-deleted) rows **[Fact — §8]**. No websocket.

Query (all dashboard GETs):

| Param | Values |
| --- | --- |
| `view` | `overall` (default) \| `projects` \| `departments` |
| `project_id` | Required when view=projects and a specific project is selected |
| `department_id` | Only Dashcam and Speed **[Fact — §8.1]**; `400` if sent on AI Camera or SOS |
| `period` | `this_week` (default) \| `last_week` \| `this_month` \| `custom` |
| `date_from`, `date_to` | Required if custom; comparison = previous interval of same length **[Fact — §12.15; Uncertain — E14]** |

### `GET /api/v1/dashboard/overview`

KPIs: total, ai_camera, dashcam, speed, sos with previous-period counts and % change. 8-week series. By status. By project (form projects). Needs attention:

- dashcam+speed with status open (waiting Confirm Driver)
- records with under_process
- sos open
- ai_camera open more than N days (N default 7 **[Uncertain — B6]**)

Weather summary from latest filled weather sheet **[Fact — §8.2]**. Latest records.

`generated_at` for the “live” timestamp **[Fact — §8.1]** — query time, not a push.

### `GET /api/v1/dashboard/ai-camera`

KPIs including Positive observations (Alert Type = Positive). By category top 10, alert type, project, detection method, risk, status, 8-week curve, latest records **[Fact — §8.3]**.

### `GET /api/v1/dashboard/dashcam`

Open KPI = waiting Confirm Driver **[Fact — §8.4]**. High Risk count. By project and department together, violation type, vehicle type, model.

### `GET /api/v1/dashboard/speed`

Average exceedance. By Public Road/ROW; Light/Heavy × Public Road/ROW; model; bands ≤10, 11–20, >20 **[Fact — §8.5]**.

### `GET /api/v1/dashboard/sos`

No under_process. Average/fastest/slowest time to see **[Fact — §8.6]**. By source and project.

Increases in **violations** red / decreases green is a **frontend colour rule** **[Fact — §8.1]**; API still returns signed percentages.

---

## 12. Reports

**Role:** Operator, Admin may generate and export **[Fact — §2]**. On demand **[Fact — §9.1]**. Week starts Sunday.

### `GET /api/v1/reports`

- **Query:** `granularity` = `week` \| `month` \| `range`; period identifiers; `project_id`; `department_id`; `record_type`; `status`.
- **Response JSON:**
  - records by project (counts per type + open/under_process/closed)
  - records by department (Dashcam + Speed assigned to department only)
  - all-projects totals
  - detail rows (case_id, type, project/department, date, risk_level or “not applicable” for SOS **[UI observation]**, status)

### `GET /api/v1/reports/export`

- **Query:** same filters plus `format=xlsx|pdf`.
- **File download.** Same numbers as JSON.
- SCC devices report is **not** here **[Fact — §7, §9]**.

---

## 13. Weather Monitoring

No status **[Fact — §3.5]**. Operators and Admins may record **[Fact — §2]**.

### `GET /api/v1/weather`

- Four sheets (slots 1–4) with hourly rows.
- Hours: do not invent beyond template 07:00–14:00; document as **[Uncertain — B1]**.

### `PUT /api/v1/weather`

- **Role:** Operator, Admin.
- **Body:** array of up to four tables: project_id, location, date, readings[]. Empty readings allowed **[Fact]**. If a table is “filled”, project, location, date required **[Fact]**. Whether unfilled tables may omit headers **[Uncertain — E6]**.
- **Errors:** Department/TSP/H2S/Duration rejected if sent (not in §4.5).
- **Audit:** `weather_saved`.

No workflow endpoints.

---

## 14. Key Personnel & Emergency Contacts

### `GET /api/v1/contacts`

- **Role:** Operator, Admin (view) **[Fact — §6]**.
- **Query:** `project_id`, `category`.

### `POST /api/v1/contacts` / `PATCH /api/v1/contacts/{id}` / `DELETE /api/v1/contacts/{id}`

- **Role:** Admin only **[Fact — §2]**. Operator → `403`.
- **Body:** project_id, category (five documented groups), name, job_title, role, contact_number, email.
- **Audit:** `contact_changed`.

---

## 15. Hardware inventory (SCC HW)

### `GET /api/v1/hw`

- **Role:** Operator (view), Admin **[Fact — §2.1]**.
- **Response:** counts by device type × HW site (including Dhahran); AVL/Dashcam by department; totals; `last_updated_at`.
- Do not reconcile department vs project totals **[Uncertain — E11]**.

### `PUT /api/v1/hw`

- **Role:** Admin. Operator → `403`.
- **Body:** project matrix quantities; department avl/dashcam counts.
- Sets `hw_meta.last_updated_at` **[Fact — §7]**.
- **Audit:** `hw_updated`.

### `GET /api/v1/hw/export`

- **Role:** Admin for export of the devices report **[Fact — §2]**: Operator may **view** HW but export of devices report is listed under “Update SCC HW data and export the devices report” = Admin **Yes**, Operator **No** **[Fact — §2 table]**.
- **Query:** `format=xlsx|pdf`.
- **File download.**

---

## 16. Operator Performance

**Admin only, server-enforced** **[Fact — §9.2, §11]**. Operator → `403 ACCESS_DENIED` (not an empty dashboard).

### `GET /api/v1/operator-performance`

- **Query:** period (same as dashboard), `operator_id`, `record_type`, `project_id`, `action`.
- **Response:** summary cards (registered, observations AI+Dashcam, speed, ITQAN uploads, close-outs) with previous-period change; chart series last 8 weeks; per-operator table (badge, counts by type, uploads, close-outs, total_actions = registered+uploaded+close-outs, last_activity); **exclude** Admin approve/reject from totals **[Fact — §9.2]**.

### `GET /api/v1/operator-performance/activity`

- Newest first. date/time, operator, action, case_id, details **[Fact — §9.2]**. Paginated.
- Data from `audit_events`.

### `GET /api/v1/operator-performance/export`

- `format=xlsx|pdf`. File download. Admin only.

---

## 17. Attachments (shared)

### `GET /api/v1/attachments/{id}/content`

- **Role:** any authenticated user (all projects visible) **[Fact — §2, §11]**.
- **404** if parent record is deleted.
- **Download.** Personal data may appear in surrounding JSON, not necessarily in the file.

Uploads are nested on the parent record (sections 6–9) so `field_name` and workflow phase can be validated.

---

## 18. Health (optional)

### `GET /api/v1/health`

- Unauthenticated liveness `{ "status": "ok" }`. Not a documented requirement; useful for hosting **[Recommendation]**. No business data.

---

## 19. OpenAPI

If FastAPI is adopted, generate OpenAPI 3 from the same schemas used for validation. Tag groups:

`Auth`, `Users`, `Lists`, `AI Camera`, `DashCam`, `Speed`, `SOS`, `Review`, `Dashboard`, `Reports`, `Weather`, `Contacts`, `Hardware`, `Operator Performance`, `Attachments`.

Do not publish example Dashcam Alert Summary enums until A1 is answered.

---

## 20. Endpoint → audit map (mutating)

| Method | Audit action |
| --- | --- |
| POST record | `registered` |
| PATCH record | `edited` |
| POST close-out (AI) | `close_out_submitted` |
| POST confirm-driver | `confirm_driver` |
| POST sos close | `sos_closed` |
| POST approve | `approved` |
| POST reject | `rejected` |
| DELETE record | `deleted` |
| DELETE user | `user_deleted` |
| PUT weather / HW / contact / list | module action (not in Total actions) |

GET, login, logout, exports: no performance audit (exports are not listed in §9.2).
)
