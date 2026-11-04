# SCC Platform — Open Questions

Questions for the project owner / requester. Nothing here invents missing business rules or dropdown values.

**Primary source:** `SCC_Platform_Requirements_EN_v2.8.docx` v2.8 (17 October 2026), especially §11 and §12.  
**Supporting sources:** workflow visual guide, UI design concepts v2, screens-selection PDFs.

Each item states what is already documented, why it is still open, and what a backend implementation cannot assume.

---

## A. Values the requester said they will supply

### A1. Dashcam Alert Summary list

- **Source:** Requirements §4.2 field 15, §5 row “Dashcam Alert Summary”, §12 item 1.
- **Documented:** Dropdown; “to be provided”; Admin can add further values.
- **Ask:** Please provide the initial Alert Summary values for DashCam Observations.
- **Do not assume:** any set of summaries (the UI only shows the placeholder “Select alert summary”).

### A2. Operator names for Reported By and Uploaded by

- **Source:** Requirements §5, §12 item 1; Operator Performance uses badge numbers (§9.2).
- **Documented:** Each Operator selects their own name from a dropdown. Admin can add and edit names. Names are still “to be provided”.
- **Ask:**
  1. What is the initial list of Operator names and badge numbers?
  2. Is this list the same as platform user accounts, or a separate “Reported By” list?
  3. Must the selected name match the signed-in user, or can an Operator select someone else (the UI says “Each Operator selects their own name” but does not technically prevent another name)?
- **Do not assume:** auto-fill from login, or a numeric count of Operators (the Operator Performance mockup shows eight sample Operators).

### A3. Model list

- **Source:** Requirements §5 and §12 item 1 (item 1 groups “Dashcam Alert Summary and Model”).
- **Documented:** Initial values Bus, Pickup, Car, Van, Truck; Admin can add and edit.
- **Ask:** Confirm that those five values are the approved initial set, despite item 1 listing Model as still to be provided.

---

## B. Section 12 items still pending confirmation

### B1. Weather hourly time range

- **Source:** §4.5, §12 item 2; UI tables 7:00 AM–2:00 PM; Appendix A same hours, image cropped.
- **Ask:** Is 7:00 AM to 2:00 PM the complete range, or are there earlier/later hours (and overnight shifts)?
- **Do not assume:** hours outside that window.

### B2. Light and Heavy vehicle definitions

- **Source:** §5 Vehicle Type; §12 item 6.
- **Documented assumption:** Light = cars, pickups, vans; Heavy = trucks, buses, equipment. To be confirmed against Aramco or company definition.
- **Ask:** Confirm or replace this mapping. Does “equipment” belong on Heavy, and should Model constrain Vehicle Type (e.g. Bus only with Heavy)?
- **Do not assume:** Model and Vehicle Type are cross-validated; the spec does not say they must match.

### B3. SOS Close-out Report format

- **Source:** §4.4 field 11; §12 item 7.
- **Documented:** Mandatory at closure. “Text (file attachment optional)”; format to be confirmed.
- **UI:** Text field only; no optional file control.
- **Ask:** Text only, or text plus optional file? Allowed file types if a file is required?
- **Do not assume:** a file upload for SOS close-out.

### B4. Dhahran

- **Source:** §5 Project notes, §7, §12 item 11.
- **Documented assumption:** Dhahran appears in SCC HW only, not in forms, Dashboard, Reports, or contacts.
- **Ask:** Confirm Dhahran is hardware-only and must never appear in Project dropdowns elsewhere.

### B5. Weather columns / four tables

- **Source:** §4.5, Appendix A, §12 item 13.
- **Documented assumption:** Follow requester sheet but: Time once at start; Contractor replaced by Project; four tables; no Duration; TSP and H2S removed.
- **Appendix A image still shows:** Department (e.g. RPPG), Duration, TSP, H2S, Time repeated per group.
- **Ask:** Confirm §12 item 13 wins over the Appendix A image. What do the four tables represent (four locations, four copies of the same template, four sites per day)?
- **Do not assume:** Department, Duration, TSP, or H2S columns in the product.

### B6. Needs attention threshold

- **Source:** §8.2, §12 item 18.
- **Documented:** AI Camera observations open more than 7 days are listed; number of days to be confirmed.
- **Ask:** Is 7 calendar days in AST the rule? Does “open” include Under Process or only status Open?

### B7. Heat Index

- **Source:** §4.5, §12 item 8.
- **Documented:** Entered manually.
- **Ask:** Confirm there is no formula the system should compute from temperature and RH.

---

## C. Technical topics the specification asked the team to propose

These are §11 items. The backend recommendation in `BACKEND_ARCHITECTURE_RECOMMENDATION.md` proposes answers; they still need owner agreement.

### C1. Login method

- **Documented:** Role-based Operator/Admin access is required. SSO vs platform accounts is open.
- **Ask:** Must the first release use company SSO, or are Admin-created platform accounts acceptable?
- **Proposed unless told otherwise:** platform accounts first, SSO later.

### C2. Hosting and environment

- **Ask:** Preferred cloud or on-prem, who operates PostgreSQL, backup/retention policy, named environments (dev/test/prod)?

### C3. Devices and browsers

- **Ask:** Desktop only for v1, or must tablets/phones work? Any required browsers?
- **UI observation:** Mockups are wide desktop layouts.

### C4. Attachment formats and maximum size

- **Documented:** Image upload for evidence; team to define formats and max size. Speed FMS Evidence is “image or file”.
- **Ask:** Confirm allowed types (e.g. JPEG/PNG for pictures; PDF for FMS) and max size.
- **Proposed unless told otherwise:** JPEG/PNG/WebP images; PDF also for FMS; 10 MB per file.

### C5. Case ID format

- **Documented:** Auto-generated unique reference.
- **UI:** `SCC-0185` style; “Generated on save”.
- **Ask:** Prefix, padding, single sequence vs per record type, and whether IDs are reused after deletion.

---

## D. Differences between specification and UI that need a decision

### D1. Admin permission toggles

- **Requirements §2:** Fixed two-role matrix.
- **Screens-selection Administration:** “Roles and permissions” switches per capability.
- **Ask:** Is that panel informational, or must Admin be able to change permissions at runtime?
- **Do not assume:** a configurable ACL.

### D2. Notification bell

- **Requirements §1.4:** Real-time alerts and notifications are out of scope.
- **UI:** Bell in the header.
- **Ask:** Confirm the bell is decorative for v1.

### D3. Global search

- **UI:** “Search Case ID or name” in the header on most screens.
- **Requirements:** Search appears on list/report mockups; a global search API is not specified.
- **Ask:** Is header search in scope? What does “name” mean (driver, worker, operator, location)?

### D4. Reject vs Return wording

- **Requirements:** Reject with a reason; status returns to Open.
- **UI:** Return with reason / Return to Operator.
- **Ask:** Preferred user-facing label. Backend behaviour is the same if the reason is required.

### D5. Close-out fields on the create form

- **Requirements:** Close-out / Confirm Driver fields are completed later, not at registration.
- **UI:** Shown locked on the create screen and included in “N of M completed”.
- **Ask:** Confirm registration validation ignores those locked fields.

### D6. Light and dark mode scope

- **§12 item 17:** Dark mode is designed for the dashboards.
- **UI:** Toggle on dashboard screens; other modules shown in light mode.
- **Ask:** Confirm dark mode is dashboard-only (mostly a frontend question; backend need not store a theme unless required).

### D7. Reported By vs authenticated user

- Covered in A2. Backend needs a yes/no: enforce match with the signed-in user or store whatever name was selected.

### D8. Administration Users vs Reported By list

- **UI:** Users and roles (Operator/Admin) plus a separate Reported By list of names that can be disabled.
- **Ask:** When Admin adds a user, is a Reported By name created automatically? When a user is deleted, is the name disabled on the list or left as-is (deleted user’s name must remain on old records — §2)?

---

## E. Validation and workflow gaps (not specified)

Do not implement invented rules until answered.

### E1. SOS time order

Dashboard average time to see = Seen At minus SOS Created At (§8.6, §12 item 16).  
**Ask:** Must Seen At be greater than or equal to SOS Created At? What if they are equal (UI sample is 1 minute apart)?

### E2. SOS Closed At

**Ask:** Must Closed At be after Seen At / Created At? Who’s clock — manual entry can disagree with server time.

### E3. Speed exceedance

Exceedance = Vehicle Speed minus Permitted Speed.  
**Ask:** May Vehicle Speed be lower than Permitted Speed (negative exceedance), or must it be greater to register a violation?

### E4. Location coordinates format

**Ask:** Free text, or required `latitude, longitude` with numeric ranges?

### E5. Iqama and badge format

Personal data (§11).  
**Ask:** Length/checksum rules, or free text?

### E6. Weather save granularity

**Ask:** One save for all four tables together (UI “Save weather records”), or independent saves per table? Can a table be omitted entirely if Project/Location/Date are empty?

### E7. Editing after rejection

Observations: Operator corrects the **close-out** and resubmits (§3.2).  
Violations: Operator corrects the record and repeats Confirm Driver & Submit (§3.3).  
**Ask:** After rejection, may the Operator change original observation fields, or only close-out / confirm-step fields? (Operators cannot edit original details after submission — §2 — unless rejection re-opens that restriction.)

### E8. Who may Confirm Driver & Submit

**Documented:** Any Operator, possibly different from the registrar.  
**Ask:** May Admin complete that step (Admin has “Yes” in the permission table)? Must Uploaded by still be chosen from the Operator-name list if an Admin does it?

### E9. Delete confirmation and recovery

**Documented:** Confirmation message; record disappears from screens/counts/reports; deletion stays in the audit log.  
**Ask:** Is restore required? Hard delete vs hidden flag?

### E10. Concurrent edits

Not specified.  
**Ask:** Last-write-wins acceptable, or must Under Process records be locked during Admin review?

### E11. SCC HW consistency

Project device matrix vs department AVL/Dashcam table. Sample UI totals do not match.  
**Ask:** Independent datasets, or must department Dashcam/AVL sums equal project Dashcam/AVL sums (excluding Dhahran or including it)?

### E12. Positive observations

AI Camera Alert Type includes Positive; dashboard has a Positive observations KPI.  
**Ask:** Do Positive observations still require the same close-out and Admin approval as Unsafe Act/Condition?

### E13. Week numbering around 1 January

Week 1 contains 1 January; weeks start Sunday.  
**Ask:** Confirm ISO-like edge cases (e.g. 31 December) are acceptable as “week that contains 1 January is week 1 of that calendar year”.

### E14. Custom dashboard range comparison

§12 item 15: compare with the previous period of the same length.  
**Ask:** Confirm custom 10-day range compares to the immediately preceding 10 days.

### E15. FMS Evidence vs other pictures

**Ask:** Confirm FMS may be a non-image file while other evidence remains images only.

### E16. Access-denied page copy

**Ask:** Required message text for Operators hitting Administration or Operator Performance URLs?

### E17. Languages

Documents are English.  
**Ask:** Is Arabic (or bilingual UI/data) required for v1? Not mentioned in the specification.

### E18. Retention

**Ask:** How long to keep attachments, deleted-record audit rows, and personal data?

---

## F. Owner confirmation of assumptions the spec is already using

Section 12 lists some items as assumptions, not open questions. Please still confirm they are accepted so the backend can treat them as rules:

| §12 | Assumption |
| --- | --- |
| 3 | After Admin rejection, status returns to Open |
| 4 | Rental Yes/No (default No) on Dashcam and Speed only; SOS has no Rental field |
| 5 | Confirm Driver & Submit is one step by one Operator; driver details editable until then, then Admin only |
| 9 | Weeks start Sunday; week 1 contains 1 January |
| 10 | All users see all projects |
| 12 | Admin delete after confirmation; deleted records hidden; audit keeps the deletion |
| 14 | Router, NVR, Edge Server are device types; Admin can add more |
| 15 | Dashboard % is vs previous period of same length; violation increases red, decreases green |
| 16 | SOS time-to-see and speed exceedance formulas as written |
| 17 | User-selected light/dark from dashboard header |

---

## G. Suggested order of answers

Highest impact on backend design first:

1. Login method (C1) and whether users = Reported By list (A2, D8)
2. Dashcam Alert Summary values (A1)
3. Weather range and four-table meaning (B1, B5)
4. SOS close-out file (B3) and attachment policy (C4)
5. Case ID format (C5)
6. Configurable permissions or not (D1)
7. Rejection editing rules (E7)
8. Dhahran (B4) and SCC HW reconciliation (E11)
9. Hosting (C2) and devices (C3)
)
