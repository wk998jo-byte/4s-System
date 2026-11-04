# SCC Platform — Requirements Analysis

**Stage:** requirements analysis only. No application code, database, or frontend framework is selected in this document.

**Primary source:** `SCC_Platform_Requirements_EN_v2.8.docx` (Functional Requirements Specification, version 2.8, 17 October 2026).  
**Supporting sources:** `SCC_Platform_Workflows_Visual_Guide (7).pdf`, `SCC_Platform_UI_Design_Concepts_v2 (7).pdf`, `SCC Platform Screens-selection (7).pdf`.

**How sources are used:** functional rules come from the requirements document. Workflow and UI PDFs are treated as supporting visual references. Where they differ, both are recorded. Nothing below invents dropdown values or business rules that the documents do not state.

**Legend**

- **[Fact]** Documented in a source.
- **[UI observation]** Visible in a workflow or UI PDF; not a substitute for the specification.
- **[Ambiguous]** Present but incomplete, conflicting, or pending confirmation.
- **[Recommendation]** Technical suggestion from this analysis, not a documented requirement.

---

## 1. Documents reviewed

| Document | Status | What was extracted |
| --- | --- | --- |
| `docs/SCC_Platform_Requirements_EN_v2.8.docx` | Fully read | Structured text of sections 1–12, Appendices A–B captions, permission tables, field tables, and three embedded images (status workflow, weather template, older dashboard reference). Header: “SCC Platform \| Requirements and Workflow Specification \| v2.8”. |
| `docs/SCC_Platform_Workflows_Visual_Guide (7).pdf` | Reviewed as images | Image-only PDF (no text layer). About 13 page markers and 79 embedded JPEGs. Content is annotated UI mockups of registration, close-out, review, weather, and operator-performance fragments, plus four full screens shared with the UI concepts PDF. |
| `docs/SCC_Platform_UI_Design_Concepts_v2 (7).pdf` | Reviewed as images | Image-only PDF. About 44 page markers and 76 JPEGs. Full-screen mockups (1920×968) for dashboards (light/dark), forms, review, weather, contacts, SCC HW, reports, administration lists, navigation-by-role, and operator performance. |
| `docs/SCC Platform Screens-selection (7).pdf` | Reviewed as images, with two pages downsampled | Image-only PDF. 25 full-page JPEGs. Higher-resolution / less-cropped versions of the same design system. Pages 23–24 were too large to inspect as original JPEGs and were downsampled for reading. No login screen was found. |

All four files were present and were inspected. None were skipped.

---

## 2. System purpose and scope

### 2.1 Purpose **[Fact — Requirements §1.1]**

The SCC Platform (Safety Command Center) records and tracks:

- AI camera observations
- Dashcam violations
- Speed violations
- SOS alerts

It also captures weather monitoring data; maintains key personnel, emergency contacts, and SCC device coverage; and provides dashboards and reports across projects and departments.

### 2.2 General principles **[Fact — Requirements §1.3]**

- All data is entered manually. No integration with cameras, AVL, SOS devices, weather stations, or ITQAN is required.
- Counts, summaries, and record statuses update automatically when data is added or updated.
- Status is system-controlled and is never entered manually. New records start as **Open**.
- AI Camera Observations are recorded against a **Project only**. DashCam Observations and Speed Violations are recorded against **either a Project or a Department**.
- Fields marked with a red asterisk (`*`) are required. An Operator cannot register a record until all required fields are completed, and cannot submit a close-out until all close-out fields are completed.
- Week number is calculated automatically from the date on observation, violation, and SOS forms (§4).

### 2.3 Out of scope **[Fact — Requirements §1.4]**

Appendix B is a look-and-layout guide only. The following elements shown there are **not** part of these requirements unless requested later:

- Overdue indicators
- Target Date, Responsible Person, Priority, and Contractor fields
- Real-time alerts and notifications
- Contractor-based charts
- The Analytics page

### 2.4 Items the specification itself flags as pending **[Fact — cover + §12]**

The cover states: “Items listed in Section 12 are pending confirmation.”

---

## 3. User roles, permissions, and navigation

### 3.1 Roles **[Fact — Requirements §2]**

Two roles: **Operator** and **Admin**. Admin has full permissions and performs review and approval of close-out submissions.

All users can view records of all projects. There is no project-level restriction.

### 3.2 Permission matrix **[Fact — Requirements §2 table]**

| Capability | Operator | Admin |
| --- | --- | --- |
| Register observations, violations and SOS alerts | Yes | Yes |
| Upload close-out action and evidence | Yes | Yes |
| Correct and resubmit close-out after rejection | Yes | Yes |
| Close an SOS alert (after completing the closure fields) | Yes | Yes |
| Complete Confirm Driver & Submit on a violation | Yes | Yes |
| Record weather monitoring data | Yes | Yes |
| Edit the original details of a submitted record | No | Yes |
| Review close-out; approve (Closed) or reject with a reason | No | Yes |
| Delete a record | No | Yes |
| View dashboard, records (all projects) and reports | Yes | Yes |
| Generate and export reports (Excel / PDF) | Yes | Yes |
| Update key personnel and emergency contacts | No | Yes |
| Update SCC HW data and export the devices report | No | Yes |
| Open Operator Performance | No | Yes |
| Manage users (add, change role, delete) and dropdown lists | No | Yes |

Additional documented rules **[Fact — Requirements §2]**:

- An Operator cannot edit an observation or violation after submission. Only Admin can edit original details.
- When a record is closed, the system records and displays the name of the person who closed it: the Admin who approved the close-out, or the Operator who closed an SOS alert.
- Admin can delete a record or a user after a confirmation message. A deleted record is removed from all screens, lists, counts, and reports; the deletion remains in the audit log with the Admin’s name (§11). A deleted user’s name remains on records that user created.

### 3.3 Navigation menu by role **[Fact — Requirements §2.1; UI concepts navigation screen; Screens-selection page 3]**

The left menu is built from the signed-in user’s role. Operators still **see** Administration and Operator Performance, greyed out with a lock; selecting them does nothing. The same items must be blocked on the server: if an Operator opens the address directly, the platform shows an access-denied message.

| Menu item | Operator | Admin |
| --- | --- | --- |
| Dashboard | Shown | Shown |
| AI Camera Observations | Shown | Shown |
| DashCam Observations | Shown | Shown |
| Speed Violations | Shown | Shown |
| SOS Alerts | Shown | Shown |
| Review & Records | Shown | Shown |
| Reports | Shown | Shown |
| Weather Monitoring | Shown | Shown |
| SCC HW | Shown (view only) | Shown |
| Key Personnel & Contacts | Shown (view only) | Shown |
| Administration | Shown, locked | Shown |
| Operator Performance | Shown, locked | Shown |

Menu grouping in the UI **[UI observation]**: OPERATIONS, REVIEW, MONITORING, ADMINISTRATION.

### 3.4 Difference: Administration “Roles and permissions” toggles

**[UI observation — Screens-selection Administration page]** The Administration screen shows a “Roles and permissions” panel with on/off toggles per capability for Operator and Admin (Register records, Submit close-out, Approve or reject close-out, Edit submitted records, Delete records, Delete users, Manage lists, users and permissions).

**[Fact — Requirements §2]** The specification defines a **fixed** two-role matrix. It does not say Admins can change those permissions at runtime.

**[Ambiguous]** Treat the UI toggles as a visual of the documented matrix unless the project owner confirms that permissions are configurable.

---

## 4. Platform modules

**[Fact — Requirements §1.2]**

| Module | Documented description |
| --- | --- |
| Dashboard | Live summary of all records, plus a separate dashboard for AI Camera, Dashcam, Speed and SOS, with view and period filters and light and dark modes. |
| AI Camera Observations | Registration and close-out of observations raised from AI camera monitoring. |
| DashCam Observations | Registration and close-out of dashcam violations. |
| Speed Violations | Registration and close-out of speed violations (ROW / Public Road). |
| SOS Alerts | Registration and closure of SOS alerts. |
| Weather Monitoring | Recording and display of weather data, following the attached template. |
| Key Personnel & Emergency Contacts | A contact list for each project. |
| SCC HW | Number of SCC devices by type for each project, and AVL and Dashcam counts for each department, with the devices report (export to Excel / PDF). |
| Reports | Weekly and monthly reports on records, with filters and export to Excel / PDF. |
| Operator Performance | Admin-only workspace that rates each Operator on the observations and violations they registered and on their actions: uploads, close-outs and edits. |
| Administration | Management of users and dropdown lists (supporting module). |
| Review & Records | Present in the navigation table (§2.1) though not listed as its own row in the §1.2 module table. Used for listing records by status and for Admin review. |

---

## 5. Workflows and status transitions

### 5.1 Statuses **[Fact — Requirements §3.1]**

| Status | Meaning | Applies to |
| --- | --- | --- |
| Open | Registered and waiting for the next Operator step: close-out (observations) or Confirm Driver & Submit (violations). Includes records returned after rejection. | All record types |
| Under Process | Close-out submitted (observations) or Confirm Driver & Submit completed (violations), awaiting Admin review. | AI Camera, Dashcam, Speed |
| Closed | Close-out approved by Admin (SOS: closed by the Operator after completing the closure fields). | All record types |

SOS Alerts use **Open** and **Closed** only **[Fact — Requirements §5 Status row, §3.4]**.

The requirements document embeds a status diagram (word/media/image1.png) matching this model:

- Observations and violations: Open → Under Process (Operator close-out / Confirm Driver & Submit) → Closed (Admin approves). Admin reject with reason returns status to Open.
- SOS: Open → Closed (Operator completes closure fields). No Under Process, no Admin approval.

### 5.2 AI Camera observation workflow **[Fact — Requirements §3.2]**

| Step | Actor | Resulting status |
| --- | --- | --- |
| 1 | Operator registers the observation | Open |
| 2 | Operator completes close-out: Close-out Action, Close-out Picture, and Safety Officer (HSEO) in the area: Name & Badge Number | Under Process |
| 3 | Admin reviews close-out action and evidence | Under Process |
| 4a | Admin approves; system records approving Admin’s name | Closed |
| 4b | Admin rejects and enters a rejection reason; reason is displayed to the Operator | Open |
| 5 | Operator corrects close-out and resubmits; cycle repeats from step 3 | Under Process |

**Documented rule:** submitting the close-out does **not** close a record. Final closure requires Admin approval.

### 5.3 Dashcam and Speed violation workflow **[Fact — Requirements §3.3]**

| Step | Actor | Resulting status |
| --- | --- | --- |
| 1 | Operator registers the violation with driver data, violation details, and violation picture | Open |
| 2 | Driver is verified **outside the platform**. Record remains Open; driver details can still be edited | Open |
| 3 | Any Operator completes **Confirm Driver & Submit** in one action: confirms the driver, attaches ITQAN Upload Proof (image), selects their name in Uploaded by. May be a different Operator from the registrar. System fills Close-out Action automatically: `The Violation has been uploaded in ITQAN`, records name and date of the step | Under Process |
| 4 | Admin reviews, including who confirmed the driver and uploaded the violation | Under Process |
| 5a | Admin approves; system records approving Admin’s name | Closed |
| 5b | Admin rejects with a reason; Operator corrects and repeats step 3 | Open |

**Documented rule:** driver details can be edited until Confirm Driver & Submit is completed; afterwards only Admin can edit them.

### 5.4 SOS alert workflow **[Fact — Requirements §3.4]**

| Step | Actor | Resulting status |
| --- | --- | --- |
| 1 | Operator registers the SOS alert, including SOS Created At and Seen At | Open |
| 2 | Operator completes four closure fields (Worker Picture, Worker Picture Shared By, Closed At, Close-out Report) and closes the alert. Closure is blocked until all four are completed. System records the Operator who closed it | Closed |

No Under Process stage and no Admin approval.

### 5.5 Modules with no status workflow **[Fact — Requirements §3.5]**

Weather Monitoring: recording and display only.  
Key Personnel & Emergency Contacts and SCC HW: maintained by Admin.

### 5.6 Workflow PDF vs requirements

**[UI observation]** The workflow visual guide is not a set of independent process diagrams. It is cropped UI of the same forms, with helper text such as “Submitting the close-out changes the status to Under Process”, “Return with reason / Approve”, “4 of 4 closure fields completed”, and Case ID examples (`SCC-0184`, `SCC-0182`).

**[Difference]** UI labels Admin rejection as **Return with reason** / **Return to Operator**. The specification uses **reject** / **rejection reason**. Same behaviour; different wording.

---

## 6. Registration fields, required fields, and validation

The specification says required fields are those marked with a red asterisk in the platform **[Fact — Requirements §4]**. The §4 tables do not mark every row as required vs optional. Conditional and close-out fields are called out in notes. Asterisks visible in the UI are listed as **[UI observation]** and should be confirmed where the specification is silent.

**Week rule (all dated forms) [Fact — Requirements §4, §12 item 9]:** calculated automatically from the date. Weeks start on Sunday; week 1 is the week that contains 1 January. Time zone: Arabia Standard Time (UTC+3) **[Fact — Requirements §11]**.

**Case ID [Fact — Requirements §11; UI observation]:** auto-generated unique reference. UI shows values such as `SCC-0185` and “Generated on save”. The exact format (prefix, padding, per-type vs global sequence) is not specified.

### 6.1 AI Camera Observation **[Fact — Requirements §4.1]**

Recorded against a Project only (no Department field).

| # | Field | Input | Notes from specification |
| --- | --- | --- | --- |
| 1 | Project | Dropdown | |
| 2 | Location | Text | |
| 3 | Date | Date | |
| 4 | Week | Automatic | From date |
| 5 | Time | Time | |
| 6 | Alert Summary | Long text | |
| 7 | Alert Type | Dropdown | §5 |
| 8 | Category | Dropdown | 34 categories in §5 |
| 9 | Risk Level | Dropdown | §5 |
| 10 | Detection Method | Dropdown | §4.1 says “values to be provided”; §5 lists AI, Manual — see contradictions |
| 11 | Observation Picture | Image upload | Evidence of the observation |
| 12 | Reported By | Dropdown | Operator names; each Operator selects their own name |
| 13 | Safety Officer (HSEO) in the Area: Name & Badge Number | Text | Completed at close-out |
| 14 | Close-out Action | Long text | Completed at close-out |
| 15 | Close-out Picture | Image upload | Completed at close-out |

**[UI observation — New AI Camera Observation]** Asterisks on Project, Location, Date, Time, Alert Type, Category, Risk Level, Detection Method, Alert Summary, Observation Picture, Reported By. Close-out fields are shown on the create form but captioned “Completed at close-out, not at registration.” Progress example: “7 of 11 completed”. Register stays disabled until required fields are completed.

### 6.2 DashCam Observation **[Fact — Requirements §4.2]**

| # | Field | Input | Notes from specification |
| --- | --- | --- | --- |
| 1 | Project or Department | Selection + dropdown | Exactly one of Project or Department, then a value from that list |
| 2 | Vehicle Type | Dropdown | Light Vehicle or Heavy Vehicle. Required for Public Road and ROW |
| 3 | Model | Dropdown | Bus, Pickup, Car, Van, Truck |
| 4 | Asset Number | Text | |
| 5 | Driver Name | Text | |
| 6 | Driver Badge Number | Text | |
| 7 | Rental driver | Yes / No | Default No. When Yes, Iqama Number becomes required |
| 8 | Iqama Number | Text | Conditional: required only when Rental driver is Yes |
| 9 | Location Coordinates | Text (coordinates) | |
| 10 | Date | Date | |
| 11 | Week | Automatic | |
| 12 | Time | Time | |
| 13 | Violation Type | Dropdown | §5 |
| 14 | Risk Level | Dropdown | §5 |
| 15 | Alert Summary | Dropdown | Values to be provided |
| 16 | Violation Picture | Image upload | |
| 17 | Reported By | Dropdown | Operator names |
| 18 | ITQAN Upload Proof | Image upload | Confirm Driver & Submit. Required |
| 19 | Uploaded by | Dropdown | Same Operator list; may differ from Reported By |
| 20 | Close-out Action | Text (automatic) | Read-only: `The Violation has been uploaded in ITQAN` |

**[UI observation]** Create form also shows locked Confirm Driver & Submit fields with helper text that they are available once the record is registered. Iqama is shown disabled when Rental is No.

### 6.3 Speed Violation **[Fact — Requirements §4.3]**

Same Project-or-Department, vehicle/driver, rental/Iqama, coordinates, date/week/time, Reported By, and ITQAN confirm-step fields as Dashcam, plus:

| Field | Input | Notes |
| --- | --- | --- |
| Speed Violation Type | Dropdown | ROW or Public Road. Operator must select one |
| Position | Text | Driver’s job position |
| Permitted Speed (Speed Limit) | Number (km/h) | Manual |
| Vehicle Speed | Number (km/h) | Manual |
| Alert Summary | Text, automatic, read-only | Generated from Speed Violation Type, Vehicle Type, Permitted Speed, Vehicle Speed. Exceedance = Vehicle Speed minus Permitted Speed. Two templates: Public Road and ROW (full wording in §4.3) |
| FMS Evidence | Attachment (image or file) | Uploaded at registration |

**[UI observation]** Create form shows both Permitted Speed and Vehicle Speed with km/h suffix; Alert Summary updates when those fields change. Confirm Driver & Submit is locked until after registration.

### 6.4 SOS Alert **[Fact — Requirements §4.4]**

Risk Type is not used for SOS Alerts. There is no Rental Yes/No field; Iqama is entered in the Worker Name & Badge Number field when the worker is rental.

| # | Field | Input | Notes |
| --- | --- | --- | --- |
| 1 | Project | Dropdown | |
| 2 | Worker Name & Badge Number (Iqama if Rental) | Text | One field |
| 3 | SOS Created At | Date and time | Manual |
| 4 | Week | Automatic | From SOS Created At |
| 5 | Seen At | Date and time | Manual |
| 6 | Location | Text | |
| 7 | Source | Dropdown | Smart Helmet or Smart Watch |
| 8 | Worker Picture | Image upload | Closure; required to close |
| 9 | Worker Picture Shared By: Name & Badge Number | Text | Closure |
| 10 | Closed At | Date and time | Closure; manual |
| 11 | Close-out Report | Text (file attachment optional) | Closure; mandatory |

**[UI observation]** Register and Close are separate actions on the same screen. Close alert is disabled until four closure fields are complete. Progress “4 of 6 completed” refers to registration fields. No optional-file control is shown for Close-out Report (text only).

**[Ambiguous]** Whether Seen At must be after SOS Created At is not stated. Average time-to-see on the dashboard is Seen At minus SOS Created At **[Fact — §8.6, §12 item 16]**, which would be wrong or negative if Seen At can precede Created At.

### 6.5 Weather Monitoring **[Fact — Requirements §4.5, Appendix A, §12 items 2, 8, 13]**

- Manual entry. Four tables, one under the other.
- Per filled table, required: Project, Location, Date. Week automatic.
- Time column once per row. Template shows 7:00 AM to 2:00 PM; complete range is to be confirmed.
- Readings are optional and may be empty.
- Columns: Time; Highest Wind Speed Recorded (m/s); Highest Temperature Recorded (°C); Highest RH Recorded (%); Highest CO2 Recorded (ppm); Highest PM2.5 Recorded; Highest PM10 Recorded; Heat Index (manual); Remarks / Corrective Actions.
- Project replaces the Contractor column of the original sheet.
- Department column in the original template is not required.
- No Duration. TSP and H2S removed (pending confirmation, §12 item 13).
- No status workflow. Weather summary shown on the Dashboard.

**[UI observation]** Save weather records button. Helper: “Recording only. Weather records have no status workflow.” Sample locations: Riyas Laydown / Jafurah; MGS TCP / MGS; Yanbu Tank Farm / Yanbu; Ras Tanura Camp / Ras Tanura. These location names are sample data, not a documented location master list.

**[Difference — Appendix A image vs §4.5]** The embedded Appendix A spreadsheet still shows Department (e.g. RPPG), Duration, TSP, H2S, and Time repeated per monitoring group. Section 4.5 and §12 item 13 explicitly replace that layout. The specification text wins for functional requirements; Appendix A is the historical template.

---

## 7. Dropdown lists and classifications

**[Fact — Requirements §5]** All lists are managed by Admin (add, edit, disable) without code changes. Lists marked “to be provided” will be supplied separately.

| Field | Documented options | Notes |
| --- | --- | --- |
| Alert Type | Unsafe Act, Unsafe Condition, Positive | |
| Project | Jafurah, MGS, Yanbu, Ras Tanura | Dhahran is shown in SCC HW only (§7). New projects can be added by Admin |
| Department | Pipe Dolly, Workshop, Salasil, HR, Rig Move, Transportation, Procurement, Logistics, IT, Zuluf, Safaniya | 11 departments. Admin can add and edit |
| Risk Level | Low Risk, Medium Risk, High Risk | |
| Status | Open, Under Process, Closed | System-controlled. SOS: Open and Closed only |
| DashCam Observation Type | Camera Covered, Tampering, Smoking, Using Phone, Seat Belt | Admin can add types |
| AI Camera Category | 34 values listed in §5 (General Safety & Health Provisions through Positive Observation) | 4S Requirements excluded. Admin can add and edit |
| Speed Violation Type | ROW, Public Road | |
| Detection Method | AI, Manual | |
| Vehicle Type | Light Vehicle, Heavy Vehicle | Light: cars, pickups, vans. Heavy: trucks, buses, equipment (definitions to be confirmed, §12 item 6) |
| Model | Bus, Pickup, Car, Van, Truck | Initial values; Admin can add and edit |
| Reported By | Operator names (to be provided) | Also used as Uploaded by. Each Operator selects their own name |
| Dashcam Alert Summary | To be provided | Admin can add values |
| SOS Source | Smart Helmet, Smart Watch | |
| SCC Device Type | AI Cameras, AVL, Dashcams, SOS Devices, Weather Stations, Router, NVR, Edge Server | Admin can add types |

**[UI observation — Administration Lists]** The lists panel includes exactly these list names, including Dashcam Alert Summary and SCC Device Type, with Active status and disable (lock) actions.

This analysis does **not** invent Dashcam Alert Summary values or Operator names.

---

## 8. Key Personnel & Emergency Contacts

**[Fact — Requirements §6]**

A separate contact list per project, covering:

- Key project personnel
- SCC Team
- Safety Team
- Emergency contacts
- Emergency Response Team (ERT) members

Each contact: Name, Job Title, Role, Contact Number, Email Address.

Admin can add, update, and remove contacts. All users can view them.

**[UI observation]** Project tabs: Jafurah, MGS, Yanbu, Ras Tanura (no Dhahran). Category chips matching the five groups above, plus All. Add contact (Admin). Edit/delete icons per row.

---

## 9. SCC HW (SCC hardware)

**[Fact — Requirements §7]**

- Device counts by type for each project: Jafurah, Ras Tanura, Yanbu, MGS, **and Dhahran**. Dhahran appears in this module only.
- AVL and Dashcam counts for each Department.
- Separate summary per project and overall totals.
- Date of the latest update, recorded automatically.
- Data entered and updated manually by Admin.
- Presented as a Report box: the SCC devices report, exportable to Excel and PDF. This report is **not** part of the Reports module (§9).

**[UI observation]** KPI cards: All projects, Jafurah, Ras Tanura, Yanbu, MGS, Dhahran. Tables: Devices by type and project; AVL and Dashcams by Department. Buttons: Update counts, Export Excel, Export PDF. Sample “Last updated 13 Oct 2026”.

**[Ambiguous]** Whether department AVL/Dashcam counts must reconcile with project-level AVL/Dashcam totals is not stated. Sample UI numbers do not obviously match (project AVL total 70 vs department AVL total 58).

---

## 10. Dashboard

**[Fact — Requirements §8]** Summarizes numerical data and updates automatically when a record is added or its status changes. Overview plus category dashboards: AI Camera, Dashcam, Speed, SOS. Tabs show record counts.

### 10.1 Controls on every dashboard **[Fact — §8.1]**

- Category tabs: Overview, AI Camera, Dashcam, Speed, SOS.
- Live indicator with time of last update, next to display mode switch.
- Every KPI card: icon, change against previous period, small trend line.
- View selector: **Over All** (default; projects and departments together), **All Projects**, **All Departments**.
- All Projects: second row with Jafurah, MGS, Yanbu, Ras Tanura.
- All Departments: second row with the 11 departments. Applies to Dashcam and Speed only; AI Camera and SOS dashboards do not offer it.
- Period: This week (default), Last week, This month, Custom range. Selected period and comparison period shown.
- KPI percentage change vs previous period of the same length, with both period counts. Increases in violations in red; decreases in green (§12 item 15).
- Light and dark modes from the dashboard header. Category colours: AI Camera navy, Dashcam blue, Speed amber, SOS teal.

### 10.2 Overview **[Fact — §8.2]**

- Five KPI cards: Total records, AI Camera, Dashcam, Speed, SOS, each vs previous week.
- Weekly curve for last 8 weeks, one line per category.
- Records by status and records by project.
- Needs attention: violations waiting for Confirm Driver & Submit; records waiting for Admin review; open SOS alerts; AI Camera observations open for more than 7 days (threshold to confirm, §12 item 18). Each line links to its list.
- One tile per category with status counts and Open dashboard.
- Weather summary and latest records.

**[UI observation — Screens-selection Overview]** Also shows Weather summary metrics (Highest wind speed, Highest temperature, Highest RH, Heat Index) from “Latest record” and an Open Weather Monitoring control; Latest records table with Case ID, Type, Project/Department, Date, Status.

### 10.3 Category dashboards **[Fact — §8.3–8.6]**

**AI Camera:** KPIs Observations, Open, Under Process, Closed, Positive observations. Charts: weekly curve; by status; by Risk Level; top 10 of 34 categories; by Alert Type; by project; by Detection Method.

**Dashcam:** KPIs Violations, Open, Under Process, Closed, High Risk. Open means waiting for Confirm Driver & Submit. Charts: weekly; status; Risk Level; project and department together; Violation Type; Vehicle Type; Model.

**Speed:** KPIs Violations, Open, Under Process, Closed, Average exceedance. Charts: weekly; status; type (Public Road or ROW); project and department; Vehicle Type with Public Road and ROW counts for Light and Heavy; Model; exceedance bands up to 10, 11–20, over 20 km/h.

**SOS:** KPIs Alerts, Open, Closed, Average time to see (Seen At minus SOS Created At). No Under Process. Charts: weekly; status; source; project; time to see (average, fastest, slowest).

Every category dashboard ends with latest records of that category. SCC device counts are **not** on the Dashboard.

**[UI observation]** SOS dashboard also shows a Closure tile (“8 of 10 closed / All four closure fields completed”) which is not named in §8.6.

---

## 11. Reports and Operator Performance

### 11.1 Reports **[Fact — Requirements §9, §9.1]**

Weekly and monthly reports on AI Camera Observations, DashCam Observations, Speed Violations, and SOS Alerts: counts, classifications, closure statuses, and access to detailed records.

Includes:

- Summary of records for each project with statuses (Open, Under Process, Closed).
- Breakdown by department.
- Consolidated summary for all projects.
- Observation and violation details, including statuses.

Filters: period (week, month, or date range), project, department, record type, status.  
Export: Excel and PDF. Generated on demand. Reporting week starts on Sunday.

The SCC devices report lives in SCC HW, not here.

**[UI observation — Reports]** Filters include a Report type (Weekly) and a Period week picker. Tables: Records by project (type counts + Open/Under Process/Closed); Records by department (Dashcam and Speed assigned to a Department); Observation and violation details (Case ID, Type, Project/Department, Date, Risk Level, Status). SOS risk level shown as “Not applicable”. Rows are intended to open the full record.

### 11.2 Operator Performance (Admin only) **[Fact — Requirements §9.2]**

Figures come from the audit log. Server-side access control required.

| Measure | How it is counted |
| --- | --- |
| Registered | Records the Operator created, by type |
| Uploaded to ITQAN | Confirm Driver & Submit steps the Operator completed (Uploaded by), even if another Operator registered |
| Close-outs | AI Camera close-outs the Operator submitted and SOS alerts the Operator closed |
| Edits | Changes the Operator made to records, shown in the activity log |
| Total actions | Registered + uploaded + close-outs. Admin approvals and rejections are **not** counted |

Filters: period, Operator, record type, project, action.  
Summary cards: records registered, observations (AI Camera and DashCam), Speed violations, uploads to ITQAN, close-outs, each vs previous period.  
Charts: actions by Operator; actions over last 8 weeks.  
Operator details table: badge number, counts by record type, uploads, close-outs, total actions, last activity, total row, export Excel/PDF.  
Activity log: every Operator action, newest first: date/time, Operator, action, Case ID, details.

**[UI observation]** Activity action chips include Registered, Uploaded to ITQAN, Closed, Close-out, Edited. “Open full activity log” control is shown; behaviour is not specified in the requirements text.

---

## 12. Platform design notes (non-functional for backend, still relevant)

**[Fact — Requirements §10]** Design follows Appendix B for look and layout, but **fields in §4 apply**. Sample fields in the reference are not requirements.

**[Fact — Appendix B image]** The embedded Appendix B is an older “SCC Safety Violation Management System” concept (Overdue, Analytics, contractors, Target Date, Priority, real-time alerts). Section 1.4 excludes those items.

**[UI observation]** Current mockups include: global “Search Case ID or name”, a bell icon, a “Sample data” badge, light/dark on dashboards, and a live updated timestamp. Real-time alerts/notifications are out of scope (§1.4). Whether the bell does anything is not specified.

**[Fact — §12 item 17]** Light and dark modes are selected from the dashboard header. Dark mode is designed for the dashboards.

---

## 13. Technical considerations stated by the specification

**[Fact — Requirements §11]** These were not specified as solutions; the development team is asked to propose them.

| Topic | Requirement / status |
| --- | --- |
| Hosting and environment | To be proposed |
| Login method | Role-based access for Operator and Admin is required. SSO vs platform accounts is to be proposed |
| Devices and browsers | To be defined (desktop only, or also mobile and tablet) |
| Case ID | Auto-generated unique reference number |
| Access to Operator Performance | Restricted to Admin on the server, not only locked in the menu |
| Audit log | Who created, edited, closed, approved, rejected, or deleted a record; who completed Confirm Driver & Submit; when. Deleted records disappear from screens; deletion remains in the audit log with the Admin’s name |
| Attachments | Image upload for evidence pictures. Formats and maximum size to be defined by the development team |
| Time zone | Arabia Standard Time (UTC+3) |
| Personal data | Badge and Iqama numbers are personal data; access is limited to authenticated users |

Speed FMS Evidence is documented as image **or file** **[Fact — §4.3]**, which is broader than “image upload for evidence pictures” in §11.

---

## 14. Backend functionality required per module

This section maps documented behaviour to likely backend capabilities. Endpoint paths are **[Recommendation]** names, not mandated by the documents.

Cross-cutting:

- **Authentication:** login method not chosen; authenticated sessions required (§11).
- **Authorization:** enforce §2 matrix on the server, including locked menu routes and Operator Performance.
- **Audit logging:** create, edit, close, approve, reject, delete, Confirm Driver & Submit (§11, §9.2).
- **File storage:** observation/violation pictures, close-out pictures, ITQAN proof, worker picture, FMS evidence (image or file), optional SOS close-out file if confirmed.
- **Derived fields:** status, week number, speed Alert Summary, violation Close-out Action text, Case ID, last-update timestamps, dashboard and report aggregations.
- **Soft-delete vs hard-delete [Ambiguous]:** screens and reports must not show deleted records; audit log must retain the deletion event. Physical delete vs hidden flag is not specified.

### 14.1 Authentication and users

- Database: users with role Operator or Admin; display name; badge number appears on Operator Performance **[Fact — §9.2 table]**. How badge number is stored on the user vs Reported By list is **[Ambiguous]**.
- Likely APIs: login/logout (method TBD), current user, Admin user CRUD with confirmation on delete.
- Deleted user: name remains on records they created **[Fact — §2]**.

### 14.2 Administration (dropdown lists)

- Database: lookup tables (or a generic list-item table) with type, label, active/disabled, sort order (order not specified).
- Business rules: Admin add/edit/disable without code changes **[Fact — §5]**. Status list is system-controlled and should not be freely edited as a normal dropdown if that would let users pick status.
- Likely APIs: list items by type (active only for Operators); Admin CRUD.

### 14.3 AI Camera Observations

- Database: observation record; status; Case ID; project; fields in §4.1; close-out payload; rejection reason; closed-by Admin; attachment references.
- Rules: create → Open; Operator cannot edit original after submit; close-out submit → Under Process; Admin approve → Closed; Admin reject with required reason → Open; resubmit close-out → Under Process.
- Likely APIs: list/filter, get, create, Admin edit original, submit close-out, resubmit close-out, Admin approve, Admin reject, Admin delete, image upload.

### 14.4 DashCam Observations and Speed Violations

- Database: violation record with assign-to (project XOR department); driver fields; rental/Iqama conditional; confirm-step fields; FMS evidence for speed; generated Alert Summary for speed.
- Rules: Open until Confirm Driver & Submit; driver details editable by Operator only until that step; any Operator may complete the step; automatic close-out text; then Under Process; Admin approve/reject as above.
- Likely APIs: same pattern as observations, plus confirm-driver-submit and conditional Iqama validation. Speed create must compute exceedance and Alert Summary server-side so reports cannot be spoofed.

### 14.5 SOS Alerts

- Database: alert record; four closure fields; closed-by Operator; no Under Process.
- Rules: cannot close until four fields complete; no Admin approval.
- Likely APIs: list/filter, get, create, close, Admin edit, Admin delete, image (and optional file) upload.

### 14.6 Review & Records

- Cross-type list with status tabs, type filter, project filter, search by Case ID or name **[UI observation]**.
- Admin actions on a selected record: approve, reject, delete **[UI observation — Screens-selection Review]**.
- Likely APIs: unified search/list; reuse per-type action endpoints.

### 14.7 Weather Monitoring

- Database: four tables (or four table-instances) per save, each with project, location, date, and hourly reading rows. What “four tables” represent (four locations vs four blank templates) is **[Ambiguous]**.
- Likely APIs: get current/latest sheets, save records, dashboard weather summary query.

### 14.8 Key Personnel & Emergency Contacts

- Database: contacts keyed by project and category.
- Likely APIs: list by project/category (all authenticated users); Admin create/update/delete.

### 14.9 SCC HW

- Database: device counts by type and project (including Dhahran); AVL/Dashcam counts by department; last updated at/by.
- Likely APIs: get report, Admin update counts, export Excel/PDF. Device types from Admin lists.

### 14.10 Dashboard

- Read-only aggregation APIs parameterized by view (Over All / project / department), period, and category.
- Needs-attention queries as defined in §8.2.
- No requirement to push live data over websockets; “live” in §8 is automatic recalculation when data changes **[Recommendation to treat as on-read or on-write refresh, not external integration]**.

### 14.11 Reports

- On-demand generation with filters; Excel and PDF export **[Fact — §9.1]**.
- Likely APIs: generate (JSON for UI), export.xlsx, export.pdf.

### 14.12 Operator Performance

- Derived from audit log **[Fact — §9.2]**.
- Likely APIs: summary, charts, operator table, activity log, export; all Admin-only.

---

## 15. Confirmed vs ambiguous vs needs clarification

### 15.1 Confirmed (documented and internally consistent)

- Manual data entry; no external system integrations in v2.8.
- Two roles; server-enforced Admin-only modules.
- Status model and the three workflows, including rejection back to Open and SOS without Admin approval.
- Project-only AI Camera and SOS; Project-or-Department for Dashcam and Speed.
- Automatic week, automatic speed Alert Summary, automatic violation close-out text.
- Rental / Iqama rule for Dashcam and Speed; SOS Iqama-in-name-field.
- Admin-managed lists, with listed initial values except Dashcam Alert Summary and Operator names.
- Dashboard structure, report contents, SCC HW contents, contacts contents.
- Audit log events listed in §11.
- Time zone UTC+3.
- Deleted records hidden from operational UI; deletion retained in audit log.

### 15.2 Ambiguous (present in documents but incomplete or conflicting)

See also `docs/OPEN_QUESTIONS.md`. Highlights:

- Required vs optional for several §4 fields (asterisks only fully visible in UI).
- Detection Method “to be provided” in §4.1 vs AI/Manual in §5.
- Dashcam Alert Summary and Reported By / Operator names still “to be provided”.
- Weather hour range; meaning of four tables; Heat Index formula not given (manual).
- SOS Close-out Report format (text + optional file) vs UI text-only.
- Light/Heavy vehicle definitions pending Aramco/company confirmation.
- Dhahran as HW-only project pending confirmation.
- Needs-attention 7-day threshold pending confirmation.
- Login method, hosting, devices/browsers, file types/size.
- Case ID format.
- Whether Reported By/Uploaded by must equal the signed-in user.
- Whether Admin permission toggles in the UI are editable.
- Relationship between SCC HW project totals and department AVL/Dashcam totals.
- Delete semantics (hard delete vs hidden).
- Header search and notification bell vs out-of-scope notifications.
- Whether Seen At must be ≥ SOS Created At.

### 15.3 Explicitly pending in Section 12 **[Fact]**

Items 1–2, 6–8, 11, 13, 18 in §12 are written as to-be-provided or to-be-confirmed. Items 3–5, 9–10, 12, 14–17 are written as assumptions the specification is already using.

---

## 16. Contradictions and differences between sources

| Topic | Requirements (primary) | Supporting PDF / appendix | Handling |
| --- | --- | --- | --- |
| Weather template columns | §4.5 / §12.13: Project not Contractor; no Department; no Duration; TSP and H2S removed; Time once per row; four tables | Appendix A spreadsheet still shows Department, Duration, TSP, H2S, repeated Time columns | Follow §4.5; flag Appendix A as superseded template |
| Appendix B dashboard | §1.4 / §10: look and layout only; overdue, contractor, analytics, notifications out of scope | Appendix B image is an older “Safety Violation Management System” with those features | Out of scope unless requested later |
| Detection Method | §4.1: values to be provided; §5: AI, Manual | UI uses AI | Treat §5 as the working list; confirm with owner |
| Admin reject wording | Reject with a reason | UI: Return with reason / Return to Operator | Same transition; confirm label |
| Close-out Report | Text, optional file, format to confirm | UI: text field only | Do not implement optional file until confirmed |
| Notifications | Real-time alerts out of scope | Header bell icon on mockups | Do not implement notifications unless requested |
| Configurable permissions | Fixed Operator/Admin matrix | Administration screen shows permission toggles | Do not implement a permission editor unless requested |
| Workflows PDF | §3 describes steps in tables + embedded diagram | PDF is UI walkthrough, not a separate process model | No extra statuses found in the PDF |
| Progress counters vs required-at-register | Close-out fields completed at close-out, not registration | Create forms include locked close-out fields in “N of M completed” | Registration must not require close-out fields |
| SCC HW vs Dashboard | Device counts in SCC HW only | Consistent in UI | Confirmed |
| Sample counts | Not specified | Dashboard Open counts vs list filters sometimes differ (e.g. AI Camera Open 14 vs list Open 18) | Treat as sample-data inconsistency in mockups, not a business rule |

---

## 17. What this analysis does not do

- Does not select a frontend framework.
- Does not implement APIs, databases, or UI.
- Does not invent Dashcam Alert Summary values, Operator names, weather hour range beyond “template shows 7:00 AM to 2:00 PM”, or login/SSO choice.
)
