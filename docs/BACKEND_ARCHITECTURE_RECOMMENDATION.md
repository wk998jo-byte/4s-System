# SCC Platform — Backend Architecture Recommendation

**Status:** technical recommendation for review. Not a documented requirement.

**Based on:** `SCC_Platform_Requirements_EN_v2.8.docx` (primary), with workflow and UI PDFs as supporting visual references. See `docs/REQUIREMENTS_ANALYSIS.md` and `docs/OPEN_QUESTIONS.md`.

**Out of scope for this stage:** application implementation, package installation, database creation, Git initialization, and any frontend framework selection.

---

## 1. What the documented backend must do

From the specification, the platform is a **multi-user CRUD system with workflows, files, aggregations, and exports**, not a real-time integration hub.

Documented facts that drive architecture:

- Manual data entry only. No camera, AVL, SOS device, weather station, or ITQAN integration **[Fact — Requirements §1.3]**.
- Two roles (Operator, Admin) with server-side authorization, including access-denied when an Operator opens Admin-only addresses **[Fact — §2, §2.1, §11]**.
- System-owned statuses and transitions **[Fact — §3]**.
- File uploads (images; Speed FMS evidence may be image or file) **[Fact — §4, §11]**.
- Audit log feeding Operator Performance **[Fact — §9.2, §11]**.
- On-demand Excel and PDF export for Reports and the SCC HW devices report **[Fact — §7, §9]**.
- Dashboard KPIs and charts recalculated when data changes **[Fact — §8]**. Real-time alerts and notifications are out of scope **[Fact — §1.4]**.
- Time zone Arabia Standard Time (UTC+3) **[Fact — §11]**.
- Personal data (badge, Iqama) limited to authenticated users **[Fact — §11]**.
- Login method, hosting, devices/browsers, and attachment limits are explicitly left for the development team to propose **[Fact — §11]**.

The frontend framework is **undecided**. The backend must therefore expose a stable HTTP API that any later web client can call.

---

## 2. Language choice: Python, Node.js, or both

### 2.1 Recommendation

**Use Python only for the backend.** One service, one language, one deployment.

Do **not** split the backend across Python and Node.js. Nothing in the documents requires two runtimes. A polyglot backend would add coordination cost without meeting any extra requirement.

Node.js remains a valid alternative if the company later standardizes on JavaScript across the stack. That would be an organizational choice, not a requirements-driven one.

### 2.2 Why Python fits this specification better

| Documented need | Python | Node.js |
| --- | --- | --- |
| Form-centric workflows, validation, role checks | Straightforward in FastAPI or Django | Equally possible in Nest/Express |
| Excel / PDF reports on demand | Mature libraries (openpyxl / XlsxWriter, ReportLab or WeasyPrint) | Also possible (ExcelJS, PDFKit) |
| Dashboard aggregations and week-number rules | Natural in SQL + a small Python domain layer | Natural in SQL + a Node domain layer |
| File uploads stored and referenced from records | Routine | Routine |
| No external device streams, no ITQAN API, no websockets required | Python’s weaker realtime story does not matter here | Node’s event-loop strength is unused |
| Unknown frontend | OpenAPI from FastAPI gives a contract the future UI team can consume | Nest can also emit OpenAPI |
| Team skill | Primary backend owner already uses Python | Also available, useful if the future UI is Node-centric |

Python is recommended because this product is **records, rules, files, and reports**. That is a classic API-plus-database workload. Node.js does not fail the requirements; it is simply not simpler for this mix, and using both would be more complex than using either.

### 2.3 Why not both

A split such as “Node for API, Python for reports” would require two deployments, two auth stacks or a shared token convention, and duplicate validation. The specification has a single application surface. Keep one backend.

### 2.4 If the company later chooses a Node frontend

That does **not** force a Node backend. The UI can call a Python HTTP API. Conversely, if the company later mandates Node for all server code, the same module boundaries in section 4 can be implemented in NestJS without changing the data model.

---

## 3. Simplest architecture that meets the documented requirements

```
[Future web client — framework TBD]
        HTTPS / JSON
[Python API service]
        |
        +-- PostgreSQL (records, users, lists, audit log, weather, HW, contacts)
        +-- Object storage or local disk (attachments)
        +-- Report generator (Excel / PDF, in-process)
```

**One API process. One database. Files stored outside the database. No message bus, no microservice split, no second language.**

### 3.1 API framework **[Recommendation]**

**FastAPI** (Python 3.12):

- Explicit request/response schemas matching §4 fields and §3 transitions.
- Built-in OpenAPI for the undecided frontend.
- Dependency-injected current user for §2 authorization.
- Upload endpoints for evidence files.

Django would also work (especially Admin screens), but the product already specifies custom Administration, Review, and Operator Performance UIs. FastAPI keeps those as first-class APIs instead of stretching Django Admin into a safety workflow tool.

### 3.2 Database **[Recommendation]**

**PostgreSQL.**

Reasons tied to the spec:

- Relational records with statuses, foreign keys to projects/departments/lists, and audit rows.
- Aggregations for dashboards and reports (counts by status, project, department, week).
- `timestamptz` storage with application-level AST (UTC+3) display and week rules.
- Row-level filtering is simple because **all authenticated users see all projects** **[Fact — §2]**; no multi-tenant isolation is specified.

SQLite is too weak for concurrent Operators plus file-backed reports. A document database is unnecessary: the field lists are tabular.

### 3.3 Suggested core tables (logical, not a schema to implement now)

- `users` (id, display_name, role, badge_number?, auth subject, active, deleted_at?)
- `list_items` (type, label, active, sort)
- `ai_camera_observations`, `dashcam_observations`, `speed_violations`, `sos_alerts`
- `attachments` (record_type, record_id, field_name, storage_key, content_type, uploaded_by, uploaded_at)
- `weather_tables` + `weather_readings` (hour rows; readings nullable)
- `contacts`
- `hw_device_counts` (project including Dhahran, device_type, count)
- `hw_department_counts` (department, avl, dashcam)
- `audit_events` (actor, action, record_type, case_id, details, at)

Status lives on the record and is **only** changed by workflow functions, never by a client-supplied status field **[Fact — §1.3]**.

### 3.4 Authentication proposal **[Recommendation answering §11]**

The specification requires role-based Operator/Admin access and asks the team to propose the login method.

**Simplest proposal that still satisfies §11:**

1. **Phase 1:** platform accounts (username + password or email + password) with hashed passwords, session or JWT access tokens, and Admin-managed users (add, change role, delete) as already required in §2.
2. **Phase 2 (optional):** company SSO (for example OpenID Connect) if IT provides an identity provider. Map the SSO identity to the same `users` row and role.

SSO is not required to start, because Admin must already manage users and roles inside the platform **[Fact — §2]**. Starting with SSO before that directory exists would block Operator setup (Reported By names are also “to be provided”).

All APIs, including file download URLs, require an authenticated user. Badge and Iqama never appear on unauthenticated endpoints **[Fact — §11]**.

### 3.5 Authorization **[Recommendation implementing documented rules]**

Enforce on every route, not only in the future UI:

- Operator forbidden: user CRUD, list management, Operator Performance, SCC HW updates, contact mutations, edit of original submitted fields, approve/reject, delete record.
- Operator allowed: register; close-out / Confirm Driver & Submit / SOS close; weather write; read dashboards, records, reports, SCC HW, contacts.
- Return a dedicated access-denied payload for Admin-only resources **[Fact — §2.1]**.

Do **not** build a generic permission-toggle engine unless the owner confirms the Administration UI toggles are editable **[Ambiguous — see OPEN_QUESTIONS]**. Hard-code the §2 matrix.

### 3.6 Workflow engine **[Recommendation]**

A small server-side state machine per record type is enough. No external workflow product.

- AI Camera: `open --submit_closeout--> under_process --approve--> closed`; `under_process --reject--> open`.
- Dashcam / Speed: `open --confirm_driver--> under_process --approve--> closed`; reject returns to `open`.
- SOS: `open --close--> closed` only if four closure fields are present.

Reject without a reason is invalid **[Fact — §3.2, §3.3]**. Confirm Driver & Submit fills Close-out Action on the server with the exact string from §3.3 / §4.2 / §4.3.

### 3.7 Files **[Recommendation answering §11 attachments]**

Until the owner confirms otherwise, propose:

- Images: JPEG, PNG, WebP.
- FMS Evidence additionally: PDF (because §4.3 says image or file).
- Maximum size: 10 MB per file (a starting limit to confirm).
- Store outside PostgreSQL (disk in development; later object storage if hosting requires it).
- Scan/validate content type server-side; store the uploader and timestamp in the audit log.

### 3.8 Reports and dashboards **[Recommendation]**

- Compute KPIs in SQL (or SQL views) using the same week rule: weeks start Sunday; week 1 contains 1 January **[Fact — §4, §9.1, §12 item 9]**. Interpret calendar dates in UTC+3.
- Generate Excel/PDF **on demand** in the API process. Volume implied by the spec is operational (Operators entering records), not a data warehouse.
- Dashboard “live” indicator = timestamp of last successful data change or last query, not a push channel **[Fact — §8.1 vs §1.4]**.

### 3.9 Audit log **[Recommendation]**

Append-only `audit_events`. Operator Performance reads this table; it does not maintain a second scoring store **[Fact — §9.2]**.

Count rules must be implemented exactly as specified: Total actions = registered + uploaded + close-outs; Admin approvals/rejections excluded; edits visible in the activity log but not in Total actions.

### 3.10 Hosting **[Recommendation answering §11]**

Simplest: one Linux VM or App Service / equivalent, PostgreSQL managed instance, HTTPS, backups. Desktop-first until devices are confirmed. No CDN or Kubernetes is required by the specification.

---

## 4. Likely API surface (contract sketch)

Paths are illustrative. Grouped so a future frontend can be built module-by-module.

**Auth**

- `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`

**Admin**

- `GET/POST /admin/users`, `PATCH/DELETE /admin/users/{id}`
- `GET/POST /admin/lists/{type}/items`, `PATCH /admin/lists/items/{id}` (disable/edit)

**Records (repeat per type: `ai-camera`, `dashcam`, `speed`, `sos`)**

- `GET /records/{type}` (filters: status, project, department, search)
- `GET /records/{type}/{id}`
- `POST /records/{type}`
- `POST /records/{type}/{id}/close-out` (AI Camera)
- `POST /records/{type}/{id}/confirm-driver` (Dashcam, Speed)
- `POST /records/sos/{id}/close`
- `POST /records/{type}/{id}/approve` (Admin)
- `POST /records/{type}/{id}/reject` (Admin, reason required)
- `PATCH /records/{type}/{id}` (Admin edit of original details; Operator driver-edit while Open on violations)
- `DELETE /records/{type}/{id}` (Admin, confirmed client-side)
- `POST /records/{type}/{id}/attachments`

**Cross-record**

- `GET /review/records` (Review & Records list)

**Other modules**

- `GET/PUT /weather`
- `GET/POST/PATCH/DELETE /contacts`
- `GET /hw`, `PUT /hw` (Admin), `GET /hw/export`
- `GET /dashboard/{overview|ai-camera|dashcam|speed|sos}`
- `POST /reports/generate`, `GET /reports/export`
- `GET /operator-performance` and related exports (Admin)

Every mutating call writes an audit event.

---

## 5. Frontend boundary (explicit non-decision)

The API above is UI-agnostic. It must not assume React, Vue, Angular, or any other client.

The mockups imply a single-page web app with a left nav, but that is a **future frontend decision**. The backend should not embed HTML for those screens at this stage.

Server-rendered pages are not required by the specification and would couple the backend to a UI stack before the company chooses one.

---

## 6. What not to build yet

Do not add:

- Device or ITQAN integrations **[Fact — §1.3]**
- Notification/push services **[Fact — §1.4]**
- Overdue, contractor, analytics, target-date fields **[Fact — §1.4]**
- A second backend language or microservice per module
- Configurable permission matrices unless the owner confirms the Admin toggle UI
- Dashcam Alert Summary values or Operator name lists that the requester has not supplied

---

## 7. Suggested sequence after this analysis (for later stages)

1. Confirm items in `docs/OPEN_QUESTIONS.md` with the project owner.
2. Agree Python FastAPI + PostgreSQL (or the company’s Node alternative) as the single backend.
3. Agree login method (platform accounts first, unless SSO is already mandatory).
4. Then, and only then, design the physical schema and implement APIs behind a still-undecided frontend.

That is the simplest architecture that meets the documented requirements without inventing missing business rules.
