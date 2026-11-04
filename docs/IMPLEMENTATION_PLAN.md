# SCC Platform — Backend Implementation Plan

**Stage:** planning only. No application code, packages, database, Git, or project config in this milestone.

**Stack:** Python, FastAPI, PostgreSQL, a migration tool, server-side validation, automated tests, file storage, and OpenAPI are **proposed**. Company standards are **not confirmed**. If the company later mandates Node.js or another store, keep the same milestone **shape** and swap the tools.

**Frontend:** out of scope. Deliver a documented HTTP API only.

**Related docs:** `DATABASE_DESIGN.md`, `API_DESIGN.md`, `WORKFLOW_RULES.md`, `OPEN_QUESTIONS.md`.

---

## 0. Principles for every milestone

- **One backend service**, one language **[Recommendation aligned with requirements of a single platform]**.
- **No** ITQAN, camera, FMS, or weather-station integrations **[Fact — §1.3]**.
- **No** notification push or extra background workers unless a later requirement appears **[Fact — §1.4]**. On-demand report generation runs in the request.
- Business rules live in the API, not in a future UI.
- Do not seed Dashcam Alert Summary values or Operator names.
- Do not silently adopt Appendix A/B columns that §1.4 / §4.5 removed.
- Automated tests are part of the definition of done, not a final bolt-on. Milestone 1 defines the test runner; later milestones add tests.
- Unanswered questions stay in `OPEN_QUESTIONS.md`. Implementation uses documented defaults only where the spec already states an assumption (§12 items 3–5, 9–10, 12, 14–17).

---

## Milestone A — Confirm architecture with the company

**Goal:** Get a yes/no on the proposed stack and the highest-impact open questions before writing code.

**Depends on:** nothing (analysis already done).

**Work**

- Present Python + FastAPI + PostgreSQL + Alembic (or equivalent migrations) + local/object file storage + OpenAPI.
- Walk through `OPEN_QUESTIONS.md` section G (login, Reported By vs users, Alert Summary, weather, attachments, Case ID, permissions toggles).

**Acceptance**

- [ ] Written decision: accept proposed stack **or** named alternative (still a **single** backend language).
- [ ] At least C1 (login) and D1 (fixed vs editable permissions) answered enough to implement Milestone C.
- [ ] Explicit statement that frontend framework remains undecided.

**If the stack is rejected:** rewrite tool names in later milestones; do not start Milestone B against an unapproved runtime.

---

## Milestone B — Project setup (after stack approval)

**Goal:** Empty runnable API skeleton with tests and OpenAPI stub. No business modules yet.

**Depends on:** A (approved stack).

**Work (if Python/FastAPI approved)**

- Application package layout, configuration via environment (database URL, file root, AST timezone).
- Health endpoint.
- Test runner and one passing health test.
- OpenAPI served at a documented URL.
- Migration tool initialized with a **no-op** or empty revision.

**Not in this milestone:** Git init unless the company asks; production hosting; frontend.

**Acceptance**

- [ ] `GET /api/v1/health` returns ok.
- [ ] Automated tests can be run with one command (once packages are allowed in that later coding stage).
- [ ] OpenAPI JSON is generated from the app.
- [ ] README for backend run/test — only when coding starts; not in this design stage.

---

## Milestone C — Database foundation and migrations

**Goal:** Tables from `DATABASE_DESIGN.md` exist; seeds for **documented** §5 lists only.

**Depends on:** B.

**Work**

- Migrations for `users`, `list_items`, `case_id_counters`, `attachments`, `audit_events`, four record tables, weather, contacts, HW.
- Check constraints for status and assign_to XOR.
- Seed: Alert Type, Projects (without Dhahran in form list), Departments, Risk Level, DashCam types, AI Camera 34 categories, Speed types, Detection Method (flag conflict with §4.1), Vehicle Type, Model (flag A3), SOS Source, SCC Device Types, HW site Dhahran.
- **Do not seed** `reported_by` or `dashcam_alert_summary`.

**Acceptance**

- [ ] Migrations apply cleanly on an empty PostgreSQL.
- [ ] Unique `case_id` registry exists.
- [ ] Status check rejects `under_process` on SOS.
- [ ] Tests: seed counts for lists that have documented values; empty Alert Summary list.

---

## Milestone D — Authentication, authorization, shared API foundations

**Goal:** Every request is authenticated (except login/health); role matrix is enforced; error/pagination envelopes exist; audit helper exists.

**Depends on:** C. **Needs C1 answer** (platform accounts vs SSO). If unanswered, implement **platform accounts** as the documented development-team proposal — behind a config flag so SSO can replace login later.

**Work**

- Login / logout / me.
- Password hashing if platform accounts.
- Dependency: current user; `require_admin`; `ACCESS_DENIED` body for Operators on Admin routes.
- Pagination, error JSON, read-only field rejection (`status`, `week_number`).
- Audit writer used by later modules.
- Week-number helper (Sunday start, week 1 contains 1 January) with unit tests; E13 remaining as documented risk.

**Acceptance**

- [ ] Unauthenticated API (other than login/health) → 401.
- [ ] Operator calling `GET /admin/users` or `GET /operator-performance` → **403 ACCESS_DENIED** (not 404, not empty 200) **[Fact — §2.1, §11]**.
- [ ] `/auth/me` returns role and derived capabilities from the **fixed** §2 matrix.
- [ ] No permission-editor tables unless D1 is yes.
- [ ] Unit tests for week numbering examples including a mid-year Sunday.

---

## Milestone E — Lists and user administration

**Goal:** Admin can manage users and dropdowns; Operators can read active lists.

**Depends on:** D.

**Work**

- List GET by type; Admin POST/PATCH (disable).
- `GET /lists/project` excludes Dhahran; `GET /lists/hw-site` includes it (B4 still a question; follow spec assumption).
- User CRUD + delete with confirm; deleted user names remain on future records via snapshots.
- Read-only permission-matrix GET for the Admin UI panel.

**Acceptance**

- [ ] Operator cannot add a list item (403).
- [ ] Disabled list item is omitted from Operator GET.
- [ ] Admin delete user with `confirm: true` writes `user_deleted` audit.
- [ ] Tests cover XOR of Dhahran vs form projects.

---

## Milestone F — File storage

**Goal:** Authenticated upload/download with `field_name` validation. Limits provisional until C4.

**Depends on:** D. **Used by:** G–I.

**Work**

- Store files outside the database; `attachments` rows.
- MIME/size checks (proposed JPEG/PNG/WebP; PDF for FMS only) — configurable.
- Download requires auth; 404 if parent logically deleted.

**Acceptance**

- [ ] Unauthenticated download → 401.
- [ ] Wrong `field_name` for record type → 400.
- [ ] Oversized file → 413.
- [ ] No files stored in PostgreSQL bytea.

Place this **before** record workflows because registration requires pictures **[Fact — §4]**.

---

## Milestone G — AI Camera workflow

**Goal:** Full register → close-out → approve/reject → resubmit, with tests.

**Depends on:** E, F.

**Work**

- CRUD list/detail; create sets Open + case_id + week.
- Close-out endpoint; approve; reject with reason; Admin delete.
- Operator cannot PATCH original fields (E7 unresolved: keep strict).
- Audit: registered, close_out_submitted, approved, rejected, deleted, edited.

**Acceptance**

- [ ] Create without required UI-observed fields → 400; status not written.
- [ ] Close-out without picture → 400; remains Open.
- [ ] Close-out success → Under Process, not Closed.
- [ ] Operator approve → 403.
- [ ] Admin reject without reason → 400.
- [ ] Reject → Open with reason on GET; resubmit → Under Process.
- [ ] Admin approve → Closed and `closed_by_label` set.
- [ ] Deleted record omitted from list, dashboard queries, reports (even if those modules are stubbed).

---

## Milestone H — DashCam and Speed workflows

**Goal:** Project XOR department, rental/Iqama, Confirm Driver, automatic close-out text, speed formulae.

**Depends on:** G (shared review/approve patterns) and F.

**Work**

- DashCam and Speed create/list/get.
- Operator driver PATCH only while Open and not confirmed.
- Confirm Driver & Submit; server sets exact ITQAN sentence.
- Speed: persist exceedance and generated Alert Summary; no ITQAN HTTP.
- Approve/reject same as AI Camera; on reject, allow repeating Confirm Driver.

**Acceptance**

- [ ] Create with both project and department → 400.
- [ ] Rental true without Iqama → 400; rental false with empty Iqama → allowed.
- [ ] Confirm Driver without proof → 400; stays Open.
- [ ] After confirm, Operator driver PATCH → 403; Admin PATCH allowed.
- [ ] `close_out_action` always the specified string; client cannot override.
- [ ] Speed Alert Summary matches Public Road / ROW templates for a fixture.
- [ ] Exceedance = vehicle − permitted in a fixture (negative still stored until E3).
- [ ] Second Operator can Confirm Driver on first Operator’s record.
- [ ] Audit `confirm_driver` counts for Uploaded by, not necessarily registrar.

---

## Milestone I — SOS direct closure

**Goal:** Open → Closed only; four-field gate.

**Depends on:** F, D.

**Work**

- Create without closure fields.
- Close requires four fields; no approve endpoint (return 400 if called).
- Optional SOS file omitted unless B3 is yes.

**Acceptance**

- [ ] Status never `under_process`.
- [ ] Close with three fields → 400 Open.
- [ ] Close with four fields → Closed; `closed_by_*` = actor.
- [ ] Operator Performance later counts this actor as close-out if they are an Operator.

---

## Milestone J — Review & Records

**Goal:** Unified list used by the Review menu.

**Depends on:** G, H, I.

**Work**

- `GET /review/records` with status tabs, type, project, q, counts.
- Handled-by labels derived from status and closed_by.

**Acceptance**

- [ ] Tab counts ignore deleted records.
- [ ] Open DashCam appears as waiting Confirm Driver.
- [ ] Under Process appears as waiting review.
- [ ] Closed SOS shows closed by Operator label.
- [ ] Operators can **view**; they still cannot approve (403 on approve URL).

---

## Milestone K — Weather, contacts, SCC HW

**Goal:** Non-workflow modules.

**Depends on:** E (lists/projects).

**Work**

- Weather GET/PUT four slots; columns per §4.5 only (no TSP/H2S/Duration/Department).
- Hours: 07:00–14:00 as **template default**, tests marked pending B1.
- Contacts CRUD Admin; GET all roles.
- HW GET all roles; PUT and export Admin; last_updated_at set on PUT; Dhahran column; no sum-check vs departments (E11).

**Acceptance**

- [ ] Operator PUT contacts or HW → 403; Operator GET 200.
- [ ] Weather PUT with TSP field → 400.
- [ ] Filled weather table without project → 400; empty readings allowed.
- [ ] HW export xlsx/pdf Admin only (Operator 403) **[Fact — §2]**.
- [ ] `last_updated_at` changes on Admin save.

---

## Milestone L — Dashboards

**Goal:** Aggregation APIs for Overview and four category dashboards.

**Depends on:** G–K (weather summary uses weather).

**Work**

- Period/view parameters; comparison period of same length.
- Needs attention queries; 7-day filter configurable (default 7).
- SOS time-to-see; speed bands; Positive observation count.
- `generated_at` timestamp. No websocket.

**Acceptance**

- [ ] Creating a record changes KPI on next GET.
- [ ] Deleted records excluded.
- [ ] `department_id` on SOS dashboard → 400.
- [ ] Band fixture: exceedance 10 in “up to 10”; 20 in “11 to 20”; 21 in “over 20”. Document 10–11 gap as open.
- [ ] Percentage sign and colour are not required from API (signed numbers suffice).

---

## Milestone M — Reports and exports

**Goal:** Weekly/monthly/range JSON + Excel/PDF for records; HW export already in K.

**Depends on:** G–I; reuse query layer from L where possible.

**Work**

- Filters: period, project, department, type, status.
- Sections: by project, by department (Dashcam/Speed only), totals, detail rows.
- Excel and PDF in-process.

**Acceptance**

- [ ] Sunday-start week filter matches week helper.
- [ ] SOS detail risk_level null or “not applicable”.
- [ ] Export bytes non-empty; same totals as JSON.
- [ ] Operator may export **record** reports **[Fact — §2]**; still cannot export Operator Performance.

---

## Milestone N — Operator Performance

**Goal:** Admin-only metrics from `audit_events`.

**Depends on:** audit from G–I, D.

**Work**

- Summary cards, 8-week chart, operator table, activity log, export.
- Counting rules exactly §9.2 (Total = registered + uploaded + close-outs; **no** approvals).

**Acceptance**

- [ ] Operator GET → 403.
- [ ] Fixture: registrar ≠ uploader; counts split correctly.
- [ ] Admin approve does not increment Total actions.
- [ ] Edit appears in activity log, not in Total actions.
- [ ] Deleted records still appear in historical activity by case_id if audit kept the id.

---

## Milestone O — Automated test hardening and OpenAPI completeness

**Goal:** Cross-module regression pack and published API contract for the future frontend team.

**Depends on:** D–N.

**Work**

- End-to-end workflow tests per `WORKFLOW_RULES.md`.
- Authorization matrix test (every Admin-only route × Operator).
- OpenAPI tagged and examples without invented Alert Summary enums.
- Load-light check optional; not required by spec.

**Acceptance**

- [ ] CI (when the company has a pipeline) runs the suite.
- [ ] OpenAPI lists all routes in `API_DESIGN.md` that were implemented.
- [ ] No frontend project, no second language, no notification service.

---

## Dependency graph

```
A confirm stack/questions
        │
        ▼
B skeleton + test runner
        │
        ▼
C migrations + seeds
        │
        ▼
D authz + envelopes + week helper + audit helper
        │
        ├──────────────► E lists/users
        │                  │
        └────────► F files │
                     │     │
                     ▼     ▼
                   G AI Camera
                     │
                     ├► H DashCam/Speed
                     ├► I SOS
                     ▼
                   J Review
        D/E/F also ► K Weather/Contacts/HW
                     │
              G–K ───► L Dashboards
              G–I ───► M Reports
              G–I ───► N Operator Performance
              all ───► O Test/OpenAPI hardening
```

**File handling (F)** is before workflows, not after, because pictures are required at register.  
**Reporting (M)** is after records exist.  
**Tests** start in B and accumulate; O is the completeness gate.

---

## Suggested next milestone

**Next recommended step: Milestone A** — obtain company confirmation of the proposed backend stack and answers to C1, D1, A1, and A2. Do not initialize the FastAPI project until A is done.

If A is already approved in a later meeting, start **Milestone B** then **C**.

---

## Out of order / do not pull forward

- Frontend app or framework choice
- Dual Python+Node services
- Notification queues, websockets, scheduled overdue jobs
- ITQAN or camera adapters
- Configurable ACL (unless D1 = yes)
- Invented dropdown seeds
)
