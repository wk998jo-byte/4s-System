# SCC Platform — Database Design

**Stage:** backend design only. Not implemented.  
**Stack status:** Python, FastAPI, PostgreSQL, a migration tool, and file storage are a **proposed** architecture, not a company-approved standard. Table names and types below assume PostgreSQL; they can be ported if the company later chooses another store.

**Primary source:** `SCC_Platform_Requirements_EN_v2.8.docx` (v2.8).  
**Supporting:** `docs/REQUIREMENTS_ANALYSIS.md`, `docs/OPEN_QUESTIONS.md`.  
**Legend:** **[Fact]** documented requirement · **[Recommendation]** design choice · **[Uncertain]** still in `OPEN_QUESTIONS.md`.

Do not invent Dashcam Alert Summary values or Operator names. Seed only lists that §5 already names.

---

## 1. Design principles

1. **Single database, single service** **[Recommendation]**. The specification describes one platform **[Fact — §1]**.
2. **Status is never a client-writable column.** Application code sets it **[Fact — §1.3]**.
3. **Dropdowns are data, not code**, except Status **[Fact — §5]**.
4. **Deleted operational records are hidden** from screens, lists, counts, and reports; the deletion remains in the audit log **[Fact — §2, §11]**. Physical vs logical delete is **[Uncertain — E9]**. This design uses **`deleted_at` (logical delete)** so history and attachments can remain without inventing a restore feature.
5. **Deleted user names remain on records they created** **[Fact — §2]**. Store display snapshots on records; do not cascade-delete names.
6. **All authenticated users see all projects** **[Fact — §2]**. No project-scoped row security.
7. **Time zone AST (UTC+3)** **[Fact — §11]**. Store timestamps as `timestamptz` (UTC); interpret calendar dates and week numbers in AST **[Recommendation]**.
8. **Badge and Iqama are personal data** **[Fact — §11]**. No unauthenticated access. No extra encryption scheme is specified; keep them in ordinary columns behind auth until the owner defines retention **[Uncertain — E18]**.
9. **No tables for ITQAN, cameras, FMS devices, or notifications.** ITQAN is a manual proof image **[Fact — §1.3, §3.3]**. Real-time alerts are out of scope **[Fact — §1.4]**.

---

## 2. Entity relationship overview

```
users ─────────────────────────────┐
list_items (projects, depts, …)    │
        │                          │
        ├── ai_camera_observations ├── attachments
        ├── dashcam_observations   ├── audit_events
        ├── speed_violations
        ├── sos_alerts
        ├── weather_sheets ── weather_readings
        ├── contacts
        ├── hw_project_counts
        └── hw_department_counts
```

Four record types are **separate tables**, not one generic “cases” table **[Recommendation]**. Field sets and workflows differ enough (§4, §3) that a single polymorphic table would hide required nullability.

A shared **`case_id`** unique across types **[Fact — §11]** is allocated from one sequence **[Recommendation]**. Exact format is **[Uncertain — C5]**; UI samples look like `SCC-0185`.

---

## 3. Conventions used in the table definitions

| Marker | Meaning |
| --- | --- |
| PK | Primary key |
| FK | Foreign key |
| NN | NOT NULL |
| UQ | Unique |
| OPT | Nullable / optional at rest |
| SYS | System-set; clients must not supply |
| SEED | Initial values from §5 (Admin may add/edit/disable later) |

**Identifier type [Recommendation]:** `uuid` primary keys. Human `case_id` is separate.

**List foreign keys [Recommendation]:** store `*_list_item_id` (FK) **and** a text snapshot (`*_label`) so reports still show the value if Admin later edits or disables the item. Enforcement: the FK must point at an **active** item of the correct `list_type` at write time.

---

## 4. Identity and authorization

### 4.1 `users`

Admin manages users: add, change role, delete **[Fact — §2]**. Login method is **[Uncertain — C1]**.

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | uuid | PK | |
| `display_name` | text | NN | Shown on closed-by / activity |
| `role` | text | NN | `operator` or `admin` only **[Fact — §2]** |
| `username` | text | UQ, OPT | For platform accounts if C1 accepts them |
| `password_hash` | text | OPT | Null if SSO only |
| `sso_subject` | text | UQ, OPT | Null if platform accounts only |
| `badge_number` | text | OPT | Shown on Operator Performance **[Fact — §9.2]**; **[Uncertain — A2]** whether this is the source of badge |
| `is_active` | boolean | NN default true | Disable without delete |
| `deleted_at` | timestamptz | OPT | Deleted users hidden from Admin user list; **name remains on records** via snapshots **[Fact — §2]** |
| `created_at` | timestamptz | NN, SYS | |
| `updated_at` | timestamptz | NN, SYS | |

**Indexes:** unique on `username` where not null; unique on `sso_subject` where not null; `(role)` ; `(deleted_at)`.

**Not in this table [Recommendation aligned with D1]:** a permissions bitfield. Roles are a **fixed matrix** **[Fact — §2]**. Do not add `role_permissions` unless the owner confirms the Administration toggles are editable **[Uncertain — D1]**.

### 4.2 How roles are enforced (database vs application)

| Layer | What it does |
| --- | --- |
| Database | `users.role` check constraint (`operator` \| `admin`). No project ACL tables. |
| Application | Every mutating and Admin-only route checks `current_user.role` against the §2 matrix. Operators receive access-denied for Administration, Operator Performance, user/list management, HW updates, contact writes, original-field edits, approve/reject, delete **[Fact — §2, §2.1, §11]**. |
| Database RLS | Not required **[Recommendation]**. Visibility is “all projects for all authenticated users”. |

`GET /auth/me` (see `API_DESIGN.md`) returns the role so a future UI can grey-out menu items. **The UI must not be trusted**; the API repeats the check.

Relationship of `users` to **Reported By** list is **[Uncertain — A2, D8]**. Until answered:

- Keep `list_items` of type `reported_by` as the dropdown source **[Fact — §5]**.
- Do **not** auto-create list rows from `users` in this design.
- Store both `reported_by_item_id` and `reported_by_label` on records.

---

## 5. Dropdown lists

### 5.1 `list_types` (optional static enum) / `list_items`

**[Fact — §5]** Admin add, edit, disable without code changes.

| Column (`list_items`) | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | uuid | PK | |
| `list_type` | text | NN | See allowed types below |
| `label` | text | NN | Display value |
| `is_active` | boolean | NN default true | Disable, do not hard-delete if referenced |
| `sort_order` | int | NN default 0 | Order not specified; useful for Admin UI **[Recommendation]** |
| `is_system` | boolean | NN default false | **[Recommendation]** true for Status if Status is ever stored here — prefer **not** putting Status in this table |
| `created_at` / `updated_at` | timestamptz | NN, SYS | |

**Unique:** `(list_type, label)` among active rows **[Recommendation]**.  
**Indexes:** `(list_type, is_active, sort_order)`.

**Allowed `list_type` values [Fact — §5]:**

| `list_type` | Seed labels | Notes |
| --- | --- | --- |
| `alert_type` | Unsafe Act, Unsafe Condition, Positive | |
| `project` | Jafurah, MGS, Yanbu, Ras Tanura | **Not** Dhahran here if Dhahran is HW-only **[Fact — §7; Uncertain — B4]** |
| `hw_location` | Dhahran | **[Recommendation]** separate type so forms cannot pick Dhahran; or `project` plus `scope` column |
| `department` | Pipe Dolly, Workshop, Salasil, HR, Rig Move, Transportation, Procurement, Logistics, IT, Zuluf, Safaniya | |
| `risk_level` | Low Risk, Medium Risk, High Risk | |
| `dashcam_observation_type` | Camera Covered, Tampering, Smoking, Using Phone, Seat Belt | |
| `ai_camera_category` | 34 labels in §5 | Do not seed “4S Requirements” |
| `speed_violation_type` | ROW, Public Road | |
| `detection_method` | AI, Manual | §4.1 vs §5 conflict **[Uncertain]**; seed §5 only if owner confirms |
| `vehicle_type` | Light Vehicle, Heavy Vehicle | Definitions **[Uncertain — B2]** |
| `model` | Bus, Pickup, Car, Van, Truck | Confirm despite §12 item 1 **[Uncertain — A3]** |
| `reported_by` | *(empty until requester provides names)* | Also used as Uploaded by **[Fact — §5]** |
| `dashcam_alert_summary` | *(empty until requester provides values)* | **[Uncertain — A1]** |
| `sos_source` | Smart Helmet, Smart Watch | |
| `scc_device_type` | AI Cameras, AVL, Dashcams, SOS Devices, Weather Stations, Router, NVR, Edge Server | Admin may add |

**Status is not a list_item [Recommendation].** It is system-controlled **[Fact — §5]**. Store as a check-constrained column on records: `open`, `under_process`, `closed`.

### 5.2 `hw_location` vs `project` **[Recommendation addressing B4]**

Until Dhahran is confirmed:

```
list_items.list_type = 'project'     → forms, dashboard, reports, contacts
list_items.list_type = 'hw_site'     → SCC HW columns: the four projects plus Dhahran
```

Alternatively one `project` type with `usable_in_records boolean` and `usable_in_hw boolean`. Either way, **do not** put Dhahran in observation Project dropdowns unless B4 is reversed.

---

## 6. Shared columns on operational records

Each of the four record tables includes:

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | uuid | PK | |
| `case_id` | text | NN, UQ across types | See `case_id_counters` |
| `status` | text | NN, SYS | See §7 |
| `week_year` | int | NN, SYS | AST calendar year of the source date |
| `week_number` | int | NN, SYS | Sunday-start; week 1 contains 1 January **[Fact — §4, §12.9]**; edge cases **[Uncertain — E13]** |
| `created_by_user_id` | uuid | FK users, NN | Registrar |
| `created_by_label` | text | NN | Snapshot |
| `updated_at` | timestamptz | NN, SYS | |
| `created_at` | timestamptz | NN, SYS | |
| `closed_by_user_id` | uuid | FK users, OPT | Admin who approved, or Operator who closed SOS **[Fact — §2]** |
| `closed_by_label` | text | OPT | |
| `closed_at` | timestamptz | OPT | Server time of closure (distinct from SOS field `closure_closed_at`, which is manual) |
| `rejection_reason` | text | OPT | Required on reject; displayed when status returns to Open **[Fact — §3.2–3.3]** |
| `rejected_at` | timestamptz | OPT | |
| `deleted_at` | timestamptz | OPT | Hidden when not null |
| `deleted_by_user_id` | uuid | FK users, OPT | Also written to audit **[Fact — §11]** |

**Global uniqueness of `case_id`:** unique index on each table is not enough. **[Recommendation]** table `case_id_counters` with a single row, or one `case_registry(case_id PK, record_type, record_id)`.

### 6.1 `case_id_counters` **[Recommendation; format Uncertain — C5]**

| Column | Type | Notes |
| --- | --- | --- |
| `id` | int PK = 1 | Single row |
| `next_value` | bigint NN | Increment on register |
| `prefix` | text NN default `'SCC'` | Unconfirmed |
| `padding` | int NN default 4 | Unconfirmed |

Do not reuse IDs after delete unless the owner says otherwise **[Uncertain — C5]**.

---

## 7. Workflow status representation

### 7.1 Column values **[Fact — §3.1]**

| Stored value | Display | AI Camera | Dashcam | Speed | SOS |
| --- | --- | --- | --- | --- | --- |
| `open` | Open | yes | yes | yes | yes |
| `under_process` | Under Process | yes | yes | yes | **never** |
| `closed` | Closed | yes | yes | yes | yes |

Check constraint on SOS: `status IN ('open','closed')`.  
Check constraint on the other three: `status IN ('open','under_process','closed')`.

### 7.2 Transitions are not extra tables **[Recommendation]**

Do **not** store a transition graph in SQL. Encode allowed moves in server-side workflow functions (see `WORKFLOW_RULES.md`). Persist:

- current `status`
- `audit_events` for each successful transition
- `rejection_reason` when returning to `open`

A `record_status_history` table is optional and **not required** by the spec; the audit log already records who changed status and when **[Fact — §11]**.

---

## 8. AI Camera observations

**Table:** `ai_camera_observations`  
**[Fact — §4.1]** Project only; no department.

| Column | Type | Req. at register | Notes |
| --- | --- | --- | --- |
| Shared columns | | | §6 |
| `project_item_id` | uuid FK | NN | `list_type=project` |
| `project_label` | text | NN | Snapshot |
| `location` | text | **[Uncertain]** UI asterisk | Spec table has no asterisk column; UI shows required |
| `occurred_on` | date | **[Uncertain]** UI asterisk | Spec: Date |
| `occurred_time` | time | **[Uncertain]** UI asterisk | Spec: Time |
| `alert_summary` | text | **[Uncertain]** UI asterisk | Long text |
| `alert_type_item_id` / `_label` | uuid / text | **[Uncertain]** UI asterisk | |
| `category_item_id` / `_label` | uuid / text | **[Uncertain]** UI asterisk | |
| `risk_level_item_id` / `_label` | uuid / text | **[Uncertain]** UI asterisk | |
| `detection_method_item_id` / `_label` | uuid / text | **[Uncertain]** UI asterisk | |
| `reported_by_item_id` / `_label` | uuid / text | **[Uncertain]** UI asterisk | |
| `observation_picture_id` | uuid FK attachments | **[Uncertain]** UI asterisk | Field `observation_picture` |
| `hseo_name_badge` | text | OPT at register; **required at close-out [Fact]** | |
| `close_out_action` | text | OPT at register; **required at close-out [Fact]** | |
| `close_out_picture_id` | uuid FK attachments | OPT at register; **required at close-out [Fact]** | |
| `close_out_submitted_at` | timestamptz | SYS, OPT | |
| `close_out_submitted_by_user_id` / `_label` | uuid / text | OPT | Operator who submitted close-out (performance “Close-outs”) **[Fact — §9.2]** |

**Useful indexes:** `(deleted_at, status)`, `(project_item_id, occurred_on)`, `(week_year, week_number)`, `(case_id)`, `(status, occurred_on)` for “open > 7 days” **[Fact — §8.2; threshold Uncertain — B6]**.

---

## 9. DashCam observations

**Table:** `dashcam_observations`  
**[Fact — §4.2]** Exactly one of Project or Department.

| Column | Type | Notes |
| --- | --- | --- |
| Shared columns | | |
| `assign_to` | text NN | `project` or `department` |
| `project_item_id` / `_label` | uuid / text | NN iff `assign_to=project` |
| `department_item_id` / `_label` | uuid / text | NN iff `assign_to=department` |
| `vehicle_type_item_id` / `_label` | | |
| `model_item_id` / `_label` | | |
| `asset_number` | text | |
| `driver_name` | text | |
| `driver_badge_number` | text | Personal data |
| `rental_driver` | boolean NN default false | **[Fact — §4.2, §12.4]** |
| `iqama_number` | text OPT | **Required when `rental_driver` is true [Fact]** |
| `location_coordinates` | text | Format **[Uncertain — E4]** |
| `occurred_on` | date | |
| `occurred_time` | time | |
| `violation_type_item_id` / `_label` | | DashCam Observation Type |
| `risk_level_item_id` / `_label` | | |
| `alert_summary_item_id` / `_label` | | Values **[Uncertain — A1]**; column exists, seed empty |
| `reported_by_item_id` / `_label` | | |
| `violation_picture_id` | uuid FK attachments | |
| `itqan_proof_id` | uuid FK attachments OPT | Required at Confirm Driver **[Fact]** |
| `uploaded_by_item_id` / `_label` | OPT | Same list as Reported By **[Fact]** |
| `confirm_submitted_at` | timestamptz OPT SYS | |
| `confirm_submitted_by_user_id` / `_label` | OPT | Actor of the step (may differ from registrar) |
| `close_out_action` | text OPT SYS | Set **only by server** to `The Violation has been uploaded in ITQAN` **[Fact — §3.3, §4.2]** |

**Check:** `(assign_to = 'project' AND project_item_id IS NOT NULL AND department_item_id IS NULL) OR (assign_to = 'department' AND department_item_id IS NOT NULL AND project_item_id IS NULL)`.

**Check:** `rental_driver = false OR iqama_number IS NOT NULL` (enforced on write; historical rows should already satisfy it).

Which registration columns are mandatory besides Project/Department, rental/Iqama, and confirm-step fields is **[Uncertain]** (spec vs UI asterisks). Do not mark every column NN until the owner confirms.

**Indexes:** `(deleted_at, status)`, `(assign_to, project_item_id)`, `(assign_to, department_item_id)`, `(occurred_on)`, `(week_year, week_number)`, `(risk_level_item_id)`, `(case_id)`.

---

## 10. Speed violations

**Table:** `speed_violations`  
Same assign-to, vehicle/driver, rental/Iqama, coordinates, date/time, reported by, and confirm-step columns as Dashcam **[Fact — §4.3]**, plus:

| Column | Type | Notes |
| --- | --- | --- |
| `speed_violation_type_item_id` / `_label` | | ROW or Public Road; Operator must select one **[Fact]** |
| `position` | text | Driver job position |
| `permitted_speed_kmh` | numeric NN at register if UI asterisk confirmed | Manual |
| `vehicle_speed_kmh` | numeric | Manual |
| `exceedance_kmh` | numeric SYS | `vehicle_speed_kmh - permitted_speed_kmh` **[Fact — §4.3, §12.16]**. Negative allowed? **[Uncertain — E3]** |
| `alert_summary` | text SYS | Generated from type, vehicle type, permitted, vehicle speed **[Fact — §4.3]**. Not a dropdown |
| `fms_evidence_id` | uuid FK attachments | Image or file **[Fact — §4.3]**; types **[Uncertain — C4, E15]** |
| Confirm-step columns | | Same as Dashcam |

**Exceedance bands** are **not stored**; they are computed for dashboards: up to 10, 11–20, over 20 km/h **[Fact — §8.5, §12.16]**.

**Indexes:** as Dashcam, plus `(speed_violation_type_item_id)`, `(exceedance_kmh)`.

---

## 11. SOS alerts

**Table:** `sos_alerts`  
**[Fact — §4.4]** Project only. No Risk Type. No Rental flag.

| Column | Type | Phase |
| --- | --- | --- |
| Shared columns | | `status` not `under_process` |
| `project_item_id` / `_label` | | Register |
| `worker_name_badge` | text | Register; Iqama in this field if rental **[Fact]** |
| `sos_created_at` | timestamptz | Register; **manual** |
| `seen_at` | timestamptz | Register; **manual**. Order vs created_at **[Uncertain — E1]** |
| `time_to_see_seconds` | int SYS OPT | `seen_at - sos_created_at` for dashboard **[Fact — §8.6]** |
| `location` | text | Register |
| `source_item_id` / `_label` | | Smart Helmet / Smart Watch |
| `worker_picture_id` | uuid FK OPT | **Required to close [Fact]** |
| `picture_shared_by` | text OPT | **Required to close [Fact]** |
| `closure_closed_at` | timestamptz OPT | **Required to close [Fact]**; manual; vs server `closed_at` **[Uncertain — E2]** |
| `close_out_report` | text OPT | **Required to close [Fact]** |
| `close_out_report_file_id` | uuid FK OPT | Spec: file optional, format unconfirmed **[Uncertain — B3]**. Do not require this column to be filled |

Week is computed from `sos_created_at` in AST **[Fact — §4.4]**.

**Indexes:** `(deleted_at, status)`, `(project_item_id)`, `(sos_created_at)`, `(source_item_id)`, `(case_id)`.

---

## 12. Attachments

Files live **outside** PostgreSQL **[Recommendation — architecture]**. The database stores metadata only.

**Table:** `attachments`

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | uuid | PK | |
| `storage_key` | text | NN, UQ | Path or object key |
| `original_filename` | text | NN | |
| `content_type` | text | NN | Validated server-side |
| `byte_size` | bigint | NN | Max size **[Uncertain — C4]** |
| `field_name` | text | NN | See vocabulary below |
| `record_type` | text | NN | `ai_camera`, `dashcam`, `speed`, `sos` |
| `record_id` | uuid | NN | No FK across four tables; application maintains consistency **[Recommendation]** |
| `uploaded_by_user_id` | uuid FK | NN | |
| `uploaded_at` | timestamptz | NN, SYS | |

**`field_name` vocabulary [Fact mapped]:**

| `field_name` | Record type | Spec |
| --- | --- | --- |
| `observation_picture` | ai_camera | Image |
| `close_out_picture` | ai_camera | Image |
| `violation_picture` | dashcam | Image |
| `itqan_upload_proof` | dashcam, speed | Image |
| `fms_evidence` | speed | Image or file |
| `worker_picture` | sos | Image |
| `sos_close_out_file` | sos | Optional; **[Uncertain — B3]** |

**Indexes:** `(record_type, record_id)`, `(uploaded_at)`.

When a record is logically deleted, keep attachment rows (reports must hide them; audit still needs the deletion event). Retention **[Uncertain — E18]**.

---

## 13. Audit log

**Table:** `audit_events` — append-only **[Recommendation]**. Operator Performance is computed from this table **[Fact — §9.2]**. No update or delete of audit rows in application code.

| Column | Type | Constraints | Notes |
| --- | --- | --- | --- |
| `id` | uuid / bigserial | PK | |
| `occurred_at` | timestamptz | NN, SYS | |
| `actor_user_id` | uuid FK | OPT | Null only if system; prefer always set |
| `actor_label` | text | NN | Survives user delete |
| `actor_role` | text | NN | `operator` / `admin` at the time |
| `action` | text | NN | See vocabulary |
| `record_type` | text | OPT | Null for user/list/hw/contact/weather |
| `record_id` | uuid | OPT | |
| `case_id` | text | OPT | For performance activity log **[Fact — §9.2]** |
| `project_item_id` | uuid OPT | For performance filter by project |
| `details` | jsonb or text | NN | Human-readable details shown in the activity log |
| `metadata` | jsonb | OPT | Before/after snippets **[Recommendation]**; not specified |

**`action` values required to support §11 and §9.2 [Fact]:**

| `action` | Counts toward |
| --- | --- |
| `registered` | Registered; Total actions |
| `confirm_driver` (Uploaded to ITQAN) | Uploaded; Total actions |
| `close_out_submitted` (AI Camera) | Close-outs; Total actions |
| `sos_closed` | Close-outs; Total actions |
| `edited` | Edits (activity log only, **not** Total actions) |
| `approved` | Not counted in Total actions |
| `rejected` | Not counted |
| `deleted` | Not counted; retained after record hidden |
| `user_deleted` / `user_created` / `user_role_changed` | Admin user admin; not Operator Performance |
| `list_changed`, `contact_changed`, `hw_updated`, `weather_saved` | Not specified for performance; still useful **[Recommendation]** |

**Indexes:** `(occurred_at DESC)`, `(actor_user_id, occurred_at DESC)`, `(action, occurred_at)`, `(case_id)`, `(record_type, record_id)`.

Admin approvals and rejections **must not** increment Total actions **[Fact — §9.2]**.

---

## 14. Weather

No status workflow **[Fact — §3.5]**. Four tables **[Fact — §4.5]**; meaning of the four **[Uncertain — B5]**. Hours 7:00 AM–2:00 PM in the template **[Uncertain — B1]**. Follow §4.5 / §12.13, not Appendix A (no Department, Duration, TSP, H2S).

**Table:** `weather_sheets`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `slot` | smallint NN | 1–4 until owner defines meaning |
| `project_item_id` / `_label` | | **Required if the table is filled [Fact]** |
| `location` | text | **Required if filled [Fact]** |
| `observed_on` | date | **Required if filled [Fact]** |
| `week_year` / `week_number` | int SYS | From `observed_on` |
| `updated_by_user_id` | uuid FK | Operators and Admins may record **[Fact — §2]** |
| `updated_at` | timestamptz | |

**Unique [Recommendation]:** `(slot)` if the four tables are always the current four sheets; or `(slot, observed_on, project_item_id, location)` if they are historical. **[Uncertain — E6]** save granularity.

**Table:** `weather_readings`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `sheet_id` | uuid FK NN | |
| `reading_time` | time NN | e.g. 07:00 |
| `wind_speed_ms` | numeric OPT | Optional readings **[Fact]** |
| `temperature_c` | numeric OPT | |
| `rh_percent` | numeric OPT | |
| `co2_ppm` | numeric OPT | |
| `pm25` | numeric OPT | |
| `pm10` | numeric OPT | |
| `heat_index` | numeric OPT | Manual **[Fact — §12.8]**; no formula **[Uncertain — B7]** |
| `remarks` | text OPT | |

**Indexes:** `(sheet_id, reading_time)`, `(observed_on)` via join / denormalize date on readings if needed for dashboard “latest record”.

Do **not** add Duration, TSP, H2S, Department, or Contractor columns.

---

## 15. Contacts

**Table:** `contacts` **[Fact — §6]**

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `project_item_id` / `_label` | NN | Form projects only (not Dhahran unless B4 reversed) |
| `category` | text NN | One of: `key_project_personnel`, `scc_team`, `safety_team`, `emergency_contacts`, `ert` **[Fact — §6]** |
| `name` | text NN | Spec does not mark asterisks; treat as required for a usable row **[Recommendation]** |
| `job_title` | text OPT | |
| `role` | text OPT | Free text; not the Operator/Admin role |
| `contact_number` | text OPT | |
| `email` | text OPT | |
| `created_at` / `updated_at` | SYS | |
| `deleted_at` | OPT | If Admin “remove” is logical |

Whether `name` and other fields are mandatory is not asterisk-specified **[Uncertain]**. Category list is documented; whether Admin can add categories is not **[Uncertain]** — do not add a list_type until asked.

**Indexes:** `(project_item_id, category)`.

---

## 16. SCC HW

Two independent count sets **[Fact — §7]**; whether they must reconcile is **[Uncertain — E11]**. Do **not** add a constraint that department totals equal project AVL/Dashcam totals.

**Table:** `hw_project_counts`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `hw_site_item_id` | uuid FK NN | Jafurah, Ras Tanura, Yanbu, MGS, Dhahran |
| `device_type_item_id` | uuid FK NN | `scc_device_type` |
| `quantity` | int NN default 0 | Manual |
| Unique `(hw_site_item_id, device_type_item_id)` | | |

**Table:** `hw_department_counts`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `department_item_id` | uuid FK NN UQ | One row per department |
| `avl_count` | int NN default 0 | |
| `dashcam_count` | int NN default 0 | |

**Table:** `hw_meta` (single row)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | int PK = 1 | |
| `last_updated_at` | timestamptz SYS | Automatic on Admin save **[Fact — §7]** |
| `last_updated_by_user_id` | uuid FK | |

Operators have **view only** **[Fact — §2.1]**.

---

## 17. Derived / not stored

| Concept | Storage |
| --- | --- |
| Dashboard KPIs, trends, % vs previous period | Query at read time **[Fact — §8]** |
| Exceedance bands | Query on `exceedance_kmh` |
| Operator Performance totals | Query on `audit_events` **[Fact — §9.2]** |
| Week number | Stored on the record for indexing, recomputed if date changes |
| Speed Alert Summary | Stored (SYS) so history does not change if templates later change **[Recommendation]**; always rewritten when speeds change |
| Light/dark theme | Not a backend table unless requested **[Uncertain — D6]** |
| Notifications | No table **[Fact — §1.4]** |
| Overdue / Target Date / Contractor / Priority | No columns **[Fact — §1.4]** |

---

## 18. Useful indexes (summary)

| Purpose | Index |
| --- | --- |
| Hide deleted records | Partial indexes `WHERE deleted_at IS NULL` on all record tables |
| Review & Records tabs | `(status)` + type |
| Reports by week | `(week_year, week_number)` |
| Dashboard by project/department | assign-to + FK columns |
| Needs attention: confirm-driver wait | dashcam/speed `status = open` |
| Needs attention: admin review | `status = under_process` |
| Needs attention: open SOS | sos `status = open` |
| Needs attention: AI Camera age | ai_camera `status = open` and `occurred_on` |
| Case search | `case_id` unique |
| Performance activity | `audit_events (occurred_at DESC, actor_user_id, action)` |

List-endpoint search by “name” **[Uncertain — D3]**. Until confirmed, index `driver_name`, `worker_name_badge`, `location` is optional.

---

## 19. Fields still uncertain (do not invent)

| Area | Open question | Schema implication |
| --- | --- | --- |
| Required asterisks | Spec vs UI | Avoid extra NOT NULL until confirmed; validate in API using a field map |
| A1 Dashcam Alert Summary | No seed values | Empty list_type |
| A2 / D8 Reported By vs users | | Separate list; snapshots on records |
| A3 Model seed | | Seed §5 five values only after confirm |
| B1 Hours | | Configurable hour set or 07:00–14:00 as **template default**, flagged |
| B3 SOS file | | Nullable `close_out_report_file_id` |
| B4 Dhahran | | Separate HW site list |
| B5 Four tables | | `slot` 1–4 |
| B6 7-day rule | | Query parameter, default 7, not a DB constraint |
| C1 Login | | Nullable password vs SSO columns |
| C4/E15 File types | | Validated in app, not DB enums |
| C5 Case ID | | Counter table with unconfirmed prefix |
| D1 Permission editor | | No ACL tables |
| E3 Negative exceedance | | Numeric column allows negative; API may reject later |
| E6 Weather save | | Unique key TBD |
| E7 Edit after reject | | No extra flags; workflow layer |
| E9 Hard vs soft delete | | `deleted_at` proposed |
| E11 HW reconcile | | No cross-table CHECK |

---

## 20. Migration approach **[Recommendation]**

Use a SQL migration tool (Alembic if Python/FastAPI is confirmed). One migration series:

1. `users`, `list_items`, `case_id_counters`, `attachments`, `audit_events`
2. Four record tables
3. `weather_sheets` / `weather_readings`
4. `contacts`, HW tables
5. Seed §5 lists that have documented values; **leave `reported_by` and `dashcam_alert_summary` empty**

No application code in this stage.
)
