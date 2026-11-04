# SCC Platform — Workflow Rules

**Stage:** backend design. These rules must be enforced **on the server**. A future UI may hide buttons; it is not an authority.

**Primary source:** Requirements v2.8 §§1.3, 2, 3, 4, 8.5–8.6, 12.  
**Open items:** `docs/OPEN_QUESTIONS.md` — marked **[Question]**, not filled in.

Status is never accepted from the client **[Fact — §1.3]**. New records start **Open**.

---

## 1. Status vocabulary

| Status | Meaning **[Fact — §3.1]** | AI Camera | DashCam | Speed | SOS |
| --- | --- | --- | --- | --- | --- |
| Open | Registered; waiting for Operator next step. Also used after Admin rejection. | yes | yes | yes | yes |
| Under Process | Close-out or Confirm Driver submitted; waiting for Admin. | yes | yes | yes | **no** |
| Closed | Admin approved close-out, **or** Operator closed SOS after four fields. | yes | yes | yes | yes |

Display labels: Open, Under Process, Closed. UI “Return with reason” is the same as specification **reject** **[Difference — D4]**. **[Question]** preferred wording; behaviour below uses “reject”.

---

## 2. Who may do what (workflow-related)

From the §2 matrix **[Fact]** (fixed roles; not a stored ACL unless D1 says otherwise):

| Action | Operator | Admin |
| --- | --- | --- |
| Register any of the four record types | Yes | Yes |
| Submit AI Camera close-out | Yes | Yes |
| Confirm Driver & Submit (DashCam, Speed) | Yes | Yes |
| Close SOS after four fields | Yes | Yes |
| Edit original details after submit | No | Yes |
| Approve / reject with reason | No | Yes |
| Delete record | No | Yes |

Confirm Driver may be a **different** Operator from the registrar **[Fact — §3.3]**.  
**[Question E8]** If Admin performs Confirm Driver, must `uploaded_by` still be an Operator-name list item?

Driver verification itself happens **outside the platform**; the record stays Open until Confirm Driver **[Fact — §3.3]**. There is **no** ITQAN API.

---

## 3. Shared registration rules

1. Cannot register until **required** fields for that type are complete **[Fact — §1.3, §4]**. Close-out / Confirm Driver / SOS closure fields are **not** registration-required **[Fact — §4]** even if the UI shows them locked **[Question D5]**.
2. Week is computed from the form date (SOS: from SOS Created At): weeks start **Sunday**; week 1 contains **1 January** **[Fact — §4, §12.9]**. Time zone AST **[Fact — §11]**. **[Question E13]** year-boundary details.
3. `case_id` allocated on successful register **[Fact — §11]**. Format **[Question C5]**.
4. `reported_by` is a dropdown of Operator names; each Operator “selects their own name” **[Fact — §5]**. **[Question A2 / D7]** whether the API must equal the signed-in user.
5. After a successful register, Operators **cannot** edit original observation/violation details **[Fact — §2]**, except DashCam/Speed **driver details while still Open and before Confirm Driver** **[Fact — §3.3]**.
6. Deleted records are omitted from every workflow list and count **[Fact — §2]**.

Which §4 columns besides those with explicit notes are mandatory is **[Question]** (spec vs UI asterisks). Until the owner confirms, treat **UI asterisks** as the working required set for implementation tests, and keep them labelled as UI-observed in analysis — **do not** treat Appendix B sample fields as required **[Fact — §10, §1.4]**.

---

## 4. AI Camera — close-out then Admin approval

```
(register) → Open
    → (submit close-out: HSEO + action + picture) → Under Process
        → (Admin approve) → Closed
        → (Admin reject + reason) → Open
            → (Operator resubmit close-out) → Under Process → …
```

**[Fact — §3.2]** Submitting close-out does **not** close the record.

### 4.1 Register → Open

- Actor: Operator or Admin.
- Project only (no department) **[Fact — §4.1]**.
- Observation picture is an image upload **[Fact]**.
- Detection Method: §5 lists AI, Manual; §4.1 says values to be provided. **[Question]** seed list.
- Positive Alert Type: same flow unless the owner says otherwise. **[Question E12]**

### 4.2 Submit close-out → Under Process

- Actor: Operator or Admin.
- Allowed only from **Open** (including post-rejection Open).
- **Required together [Fact — §3.2, §4.1]:**
  1. Safety Officer (HSEO) in the Area: Name & Badge Number
  2. Close-out Action
  3. Close-out Picture
- Missing any → reject request; status unchanged.
- Record who submitted the close-out (Operator Performance “Close-outs”) **[Fact — §9.2]**.

### 4.3 Admin approve → Closed

- Actor: **Admin only**.
- Allowed only from **Under Process**.
- Store approving Admin’s name as the person who closed it **[Fact — §2, §3.2]**.
- Does **not** count as Operator Total actions **[Fact — §9.2]**.

### 4.4 Admin reject → Open

- Actor: **Admin only**.
- Allowed only from **Under Process**.
- **Rejection reason required** **[Fact — §3.2]**. Empty reason → no transition.
- Status **Open**; reason displayed to the Operator **[Fact]**.
- Does not count as Total actions.

### 4.5 Resubmit

- Actor: Operator (or Admin).
- Same as 4.2 from Open after rejection **[Fact — §3.2]**.
- **[Question E7]** May the Operator also change original observation fields after rejection? Until answered: **no** Operator edit of original fields (strict reading of §2).

### 4.6 Illegal AI Camera transitions

| From | Attempt | Result |
| --- | --- | --- |
| Open | approve | `400` |
| Open | close (SOS-style) | `400` |
| Under Process | register duplicate close-out as if new | N/A; resubmit only from Open |
| Under Process | Operator PATCH original | `403` |
| Closed | close-out / approve / reject | `400` |
| any | client sets status | `400` READ_ONLY |
| SOS status Under Process | — | cannot exist |

---

## 5. DashCam and Speed — Confirm Driver then Admin approval

These two types share one workflow **[Fact — §3.3]**. They differ only in registration fields.

```
(register with driver + details + evidence) → Open
    → (driver verified outside platform; driver fields still editable) → Open
    → (any Operator: Confirm Driver & Submit = confirm + ITQAN image + Uploaded by) → Under Process
        → (Admin approve) → Closed
        → (Admin reject + reason) → Open
            → (correct and repeat Confirm Driver) → Under Process → …
```

### 5.1 Register → Open

- `assign_to`: **exactly one** of Project or Department **[Fact — §4.2, §4.3]**.
- Rental driver default **No**; if **Yes**, Iqama Number required **[Fact — §12.4]**.
- Vehicle Type Light/Heavy; Model from list **[Fact — §5]**. Cross-check Model vs Light/Heavy is **[Question B2]** — do not enforce until confirmed.
- DashCam Alert Summary: dropdown, values **not supplied** **[Question A1]** — validate that the id belongs to that list when the list is non-empty; do not invent labels.
- Speed: Operator must select ROW or Public Road **[Fact]**. FMS Evidence at registration (image or file) **[Fact — §4.3]**.
- Violation / observation picture at registration (DashCam) **[Fact]**.
- Confirm Driver fields **must not** be required here.

### 5.2 Driver edit window (still Open)

- Operator may edit **driver details** until Confirm Driver is completed **[Fact — §3.3]**.
- After Confirm Driver, **only Admin** may edit them **[Fact]**.
- Status remains Open during off-platform verification. There is no “Verified” status.

### 5.3 Confirm Driver & Submit → Under Process

Single action by one person **[Fact — §3.3, §12.5]**:

1. Confirm the driver (implied by submitting the step; no extra boolean is named — **[Question]** if an explicit checkbox is required; UI shows the step as one submit).
2. Attach **ITQAN Upload Proof (image)** — required.
3. Select **Uploaded by** from the same Operator-name list as Reported By — required; may differ from Reported By.

Server then:

- Sets Close-out Action to exactly:  
  `The Violation has been uploaded in ITQAN`  
  (read-only; never client-supplied) **[Fact — §4.2, §4.3]**
- Records name and date of the step
- Sets status **Under Process**

Wrong status or missing proof / uploaded_by → no transition.

**Do not** call ITQAN.

### 5.4 Admin approve / reject

Same as AI Camera 4.3–4.4 **[Fact — §3.3]**. Closed-by = approving Admin.

After reject → Open; Operator “corrects the record and repeats step 3” **[Fact]**.  
**[Question E7]** which fields the Operator may correct besides repeating Confirm Driver (driver fields become editable again because status is Open and confirm step is undone — **this follows from §3.3 “until the step is completed”** once the step is no longer in effect). Treat Confirm Driver as **cleared** on reject so the step can be repeated: status Open implies the confirm step is not current. **[Question]** whether previous ITQAN proof is kept or must be uploaded again — not specified; **[Question]** do not delete the file automatically until answered; require a proof id on the new submit (may reuse).

### 5.5 Illegal DashCam/Speed transitions

Same as AI Camera regarding approve from Open, client-set status, Operator edit after confirm (except Admin).  
SOS-style close is invalid.  
AI Camera close-out payload is invalid on these types.

---

## 6. SOS — direct closure (no Admin approval)

```
(register including SOS Created At and Seen At) → Open
    → (four closure fields complete + close) → Closed
```

**[Fact — §3.4]** No Under Process. No Admin approval step.

### 6.1 Register → Open

- Project only. No Risk Type **[Fact — §4.4]**.
- No Rental Yes/No; Iqama (if rental) is inside Worker Name & Badge Number **[Fact — §12.4]**.
- SOS Created At and Seen At are **manual** datetimes **[Fact]**.
- **[Question E1]** Must Seen At ≥ Created At?
- Closure fields not required to register. Close button stays disabled until they are complete **[Fact + UI]**.

### 6.2 Close → Closed

- Actor: Operator or Admin **[Fact — §2]**.
- Allowed only from **Open**.
- **All four required [Fact — §3.4]:**
  1. Worker Picture (image)
  2. Worker Picture Shared By: Name & Badge Number
  3. Closed At (manual)
  4. Close-out Report (text; **mandatory**)
- Optional file with the report: **[Question B3]** — do not require a file.
- **[Question E2]** Closed At vs Created At / Seen At / server clock.
- Store the **Operator (or Admin) who closed** as closed-by **[Fact — §2, §3.4]**.
- Counts as Operator Performance close-out if the actor is an Operator **[Fact — §9.2]** (Admin closing SOS is allowed by §2; whether it appears on Operator Performance **[Question]** — counts are “SOS alerts the Operator closed”; Admin would not appear in the Operator table unless they are also an Operator name).

### 6.3 Illegal SOS transitions

| Attempt | Result |
| --- | --- |
| Set Under Process | impossible / `400` |
| Admin approve/reject | `400` not applicable |
| Close with any of four fields missing | `400`; stay Open |
| Operator edit original after submit | `403` unless Admin |

---

## 7. Modules without record status

| Module | Rule **[Fact — §3.5]** |
| --- | --- |
| Weather | Record and display only. Operators and Admins may save. No Open/Closed. |
| Contacts | Admin write, all users read. No status. |
| SCC HW | Admin write, Operators view. Last-updated timestamp automatic. No status. |

---

## 8. Speed exceedance and alert text **[Fact — §4.3, §8.5, §12.16]**

Computed **on the server** whenever Permitted Speed, Vehicle Speed, Speed Violation Type, or Vehicle Type changes.

```
Exceedance = Vehicle Speed − Permitted Speed   (km/h)
```

**[Question E3]** May Vehicle Speed be lower than Permitted Speed?

### 8.1 Alert Summary templates **[Fact — §4.3]**

Read-only. Substitute Light/Heavy from Vehicle Type, and the numeric speeds.

**Public Road:**

> The driver of a [light / heavy] vehicle exceeded the permitted speed limit on a public road. Permitted speed: [Permitted Speed] km/h. Recorded speed: [Vehicle Speed] km/h. Exceedance: [Exceedance] km/h.

**ROW:**

> The driver of a [light / heavy] vehicle exceeded the permitted speed limit within the Right of Way (ROW). Permitted speed: [Permitted Speed] km/h. Recorded speed: [Vehicle Speed] km/h. Exceedance: [Exceedance] km/h.

### 8.2 Dashboard bands **[Fact — §8.5, §12.16]**

Group exceedance (not stored as a status):

| Band | Rule |
| --- | --- |
| Up to 10 km/h | exceedance ≤ 10 |
| 11 to 20 km/h | 11 ≤ exceedance ≤ 20 |
| Over 20 km/h | exceedance > 20 |

**[Question]** Where exceedance is exactly 10.0 it belongs in “up to 10”. Where it is 10.1–11, the spec says “11 to 20” — values **greater than 10 and less than 11** are **[Question]** (not specified). Do not invent a fourth band; flag for the owner.

Average exceedance KPI is the mean of (Vehicle Speed − Permitted Speed) in the filtered set **[Fact]**.

---

## 9. SOS time-to-see **[Fact — §8.6, §12.16]**

```
Time to see = Seen At − SOS Created At
```

Dashboard: average, fastest, slowest. Negative values if Seen At < Created At — **[Question E1]** whether to reject at register.

---

## 10. Needs attention (dashboard, not a status)

Derived lists **[Fact — §8.2]**; they do not add statuses:

1. DashCam and Speed with status **Open** (waiting Confirm Driver).
2. AI Camera, DashCam, Speed with status **Under Process** (waiting Admin).
3. SOS with status **Open**.
4. AI Camera **Open** for more than **7 days** — days **[Question B6]**; whether Under Process counts as “open” for this line **[Question B6]** (the text says “observations open for more than 7 days”).

---

## 11. Validation rules tied to workflow

| Rule | When | Source |
| --- | --- | --- |
| All documented required registration fields present | POST create | §4 |
| Iqama required | rental_driver = true | §4.2–4.3 |
| Iqama not required | rental_driver = false (default) | §12.4 |
| Assign project XOR department | DashCam, Speed create/update | §4.2–4.3 |
| Close-out trio required | AI Camera close-out | §3.2 |
| ITQAN image + Uploaded by | Confirm Driver | §3.3 |
| Four SOS closure fields | SOS close | §3.4 |
| Reject reason non-empty | Admin reject | §3.2–3.3 |
| Status not client-writable | all writes | §1.3 |
| Operator cannot PATCH original after submit | AI Camera always; violations after confirm | §2, §3.3 |
| List ids must be active and correct list_type | all dropdowns | §5 |
| Dashcam Alert Summary id | only if requester has supplied values | A1 |
| File type/size | uploads | §11; **[Question C4]** |
| Personal data only for authenticated users | all GETs of records | §11 |

Coordinate format, badge/Iqama format: **[Questions E4, E5]** — treat as text until answered.

---

## 12. Delete

- Admin only, after confirmation **[Fact — §2]**.
- Allowed regardless of status (not specified otherwise).
- Record disappears from workflow queues, dashboards, reports.
- Audit retains `deleted` with Admin name **[Fact — §11]**.
- Restore **[Question E9]**.

---

## 13. Concurrency

Not specified. **[Question E10]** Last-write-wins vs lock during Admin review. Until answered, do not add a lock table; document the risk that two Admins could approve and reject in a race (second call `400` if status already changed).

---

## 14. Rules that are questions, not assumptions

Do **not** implement as hard business rules until the owner answers:

- Enforce Reported By = current user (A2, D7)
- Positive observations skip close-out (E12)
- Seen At / Closed At ordering (E1, E2)
- Vehicle Speed must exceed limit (E3)
- Operator may edit original fields after reject (E7)
- Confirm Driver Uploaded by constrained if actor is Admin (E8)
- SOS close-out file required (B3)
- Configurable permissions (D1)
- 7-day threshold and whether it includes Under Process (B6)
- Exceedance between 10 and 11 km/h band membership
)
