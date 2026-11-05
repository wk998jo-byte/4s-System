import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  closeOutAiCamera,
  closeSos,
  confirmDriver,
  fetchCase,
  fetchCases,
  postJson,
  type CaseDetail,
  type CaseSummary,
} from "../api/scc";
import { useAuth } from "../auth/AuthContext";
import { errorMessage } from "../lib/errors";
import { href, type ModuleType } from "../lib/routing";
import { useAutoFormProject } from "../lib/useProjectAccess";
import { RecordReviewDetail } from "./SupportScreens";
import { AiCameraScreen } from "./AiCameraScreen";
import { DashcamScreen } from "./DashcamScreen";
import { SpeedScreen } from "./SpeedScreen";
import { WearablesScreen } from "./WearablesScreen";
import { ItqanScreen } from "./ItqanScreen";
import {
  CasesTable,
  moduleTitle,
  nowLocal,
  SelectList,
  SignedInNameField,
  StatusPill,
  todayIso,
  TYPE_LABEL,
  useList,
  useSignedInName,
  weekFromIsoDate,
} from "./shared";

export function ModuleListScreen({
  type,
  caseId,
}: {
  type: ModuleType;
  caseId?: string;
}) {
  if (type === "itqan") return <ItqanScreen focusCaseId={caseId} />;
  if (type === "ai_camera") return <AiCameraScreen focusCaseId={caseId} />;
  if (type === "dashcam") return <DashcamScreen focusCaseId={caseId} />;
  if (type === "speed") return <SpeedScreen focusCaseId={caseId} />;
  if (type === "sos") return <WearablesScreen focusCaseId={caseId} />;
  return <GenericModuleList type={type} />;
}

function GenericModuleList({ type }: { type: ModuleType }) {
  const { user } = useAuth();
  const canRegister = Boolean(user?.capabilities.register);
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<CaseSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await fetchCases({ record_type: type, status: status || undefined });
      setRows(data.items);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [status, type]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="page">
      <div className="panel-head">
        <div className="dash-filters">
          <label>
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">All</option>
              <option value="open">Open</option>
              {type !== "sos" ? <option value="under_process">Under Process</option> : null}
              <option value="closed">Closed</option>
            </select>
          </label>
        </div>
        {canRegister ? (
          <a className="btn primary" href={href({ name: "new", type })}>
            New {TYPE_LABEL[type]}
          </a>
        ) : null}
      </div>
      {error ? <p className="state error">{error}</p> : null}
      <article className="panel table-panel">
        <CasesTable rows={rows} empty={`No ${moduleTitle(type).toLowerCase()} on the server yet.`} />
      </article>
    </section>
  );
}

export function NewRecordScreen({ type }: { type: ModuleType }) {
  if (type === "itqan") return <ItqanScreen openForm />;
  if (type === "ai_camera") return <AiCameraScreen openForm />;
  if (type === "dashcam") return <DashcamScreen openForm />;
  if (type === "speed") return <SpeedScreen openForm />;
  return <WearablesScreen openForm />;
}

function goToReview() {
  window.location.hash = href({ name: "review" });
}

const ITQAN_ACTION = "The Violation has been uploaded in ITQAN";

function RegisterIntro({
  filled,
  total,
  status,
}: {
  filled: number;
  total: number;
  status: string | null;
}) {
  return (
    <div className="register-intro">
      <p className="req-hint">
        <span className="req-star">*</span> Fields marked with a red asterisk
        are required. Register stays disabled until every required field is
        completed.
      </p>
      <div className="progress-meta">
        <div className="progress-track">
          <span style={{ width: `${(filled / total) * 100}%` }} />
        </div>
        <span>
          {filled} of {total} completed
        </span>
        {status ? <StatusPill status={status} /> : null}
      </div>
    </div>
  );
}

function RegisterFooter({
  error,
  remaining,
  status,
  closeRemaining,
  saving,
  registerLabel,
  canRegister,
  hideRegister,
}: {
  error: string | null;
  remaining: number;
  status: string | null;
  closeRemaining: number;
  saving: boolean;
  registerLabel: string;
  canRegister: boolean;
  hideRegister: boolean;
}) {
  let message = "Ready to register.";
  let bad = false;
  if (error) {
    message = error;
    bad = true;
  } else if (!status) {
    if (remaining > 0) {
      message = `${remaining} required field${remaining === 1 ? " is" : "s are"} still empty`;
      bad = true;
    }
  } else if (status === "open") {
    if (closeRemaining > 0) {
      message = `Status Open. ${closeRemaining} close-out field${closeRemaining === 1 ? " is" : "s are"} still empty`;
      bad = true;
    } else {
      message = "Status Open. Close-out is unlocked and ready to submit.";
    }
  } else if (status === "closed") {
    message = "Close-out submitted. Status is Closed.";
  } else {
    message = "Close-out submitted. Status is Under Process.";
  }
  return (
    <div className="register-foot">
      <p className={bad ? "foot-status is-error" : "foot-status is-ok"}>
        <span className="foot-dot" aria-hidden="true" />
        {message}
      </p>
      <div className="register-actions">
        <button className="btn ghost" type="button" onClick={goToReview}>
          {status ? "Review & Records" : "Cancel"}
        </button>
        {hideRegister ? null : (
          <button className="btn primary" type="submit" disabled={!canRegister}>
            {saving ? "Saving…" : registerLabel}
          </button>
        )}
      </div>
    </div>
  );
}

function ConfirmDriverPanel({
  unlocked,
  submitted,
  proofName,
  uploadedBy,
  saving,
  onProof,
  onSubmit,
}: {
  unlocked: boolean;
  submitted: boolean;
  proofName: string;
  uploadedBy: string;
  saving: boolean;
  onProof: (name: string) => void;
  onSubmit: () => void;
}) {
  const enabled = unlocked && !submitted;
  return (
    <article className="panel closeout-panel">
      <h3>
        {unlocked ? null : <span className="lock-mark" aria-hidden="true" />}
        Close-out
      </h3>
      <p className="muted">
        {submitted
          ? "Close-out submitted. Status is Under Process."
          : unlocked
            ? `Record is Open. Confirm Driver and the ITQAN proof are required in this step (uploaded by ${uploadedBy || "signed-in user"}). This prototype does not call ITQAN.`
            : "Locked until the violation is registered. Status will be Open after Register."}
      </p>
      <label>
        ITQAN Upload Proof (image) *
        <span className={`dropzone${enabled ? "" : " is-disabled"}`}>
          {enabled ? (
            <input
              type="file"
              accept="image/*"
              onChange={(event) =>
                onProof(event.target.files?.[0]?.name ?? "")
              }
            />
          ) : null}
          <strong>Drop a file here or browse</strong>
          <span>
            {proofName ||
              "Screenshot that shows the violation uploaded to ITQAN"}
          </span>
        </span>
      </label>
      <SignedInNameField
        label="Uploaded by *"
        note="Filled from whoever is signed in now (can differ from who reported)"
      />
      <label>
        Close-out Action
        <textarea
          disabled
          rows={3}
          value={submitted ? ITQAN_ACTION : ""}
          placeholder="Filled automatically when the step is submitted"
        />
        <span className="field-note">
          After the step it reads: The Violation has been uploaded in ITQAN
        </span>
      </label>
      <div className="closeout-actions">
        <button
          className="btn primary"
          type="button"
          disabled={!unlocked || submitted || saving}
          onClick={onSubmit}
        >
          {saving ? "Saving…" : "Confirm Driver & Submit"}
        </button>
      </div>
    </article>
  );
}

export function AiCameraForm() {
  const actorName = useSignedInName();
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pictureName, setPictureName] = useState("");
  const [record, setRecord] = useState<CaseDetail | null>(null);
  const [closeout, setCloseout] = useState({
    hseo_name_badge: "",
    close_out_action: "",
    close_out_picture: "",
  });
  const [form, setForm] = useState({
    project_id: "",
    location: "",
    occurred_on: todayIso(),
    occurred_time: "",
    alert_summary: "",
    alert_type_id: "",
    category_id: "",
    risk_level_id: "",
    detection_method_id: "",
  });
  const projectScope = useAutoFormProject(true, form.project_id, (patch) =>
    setForm((c) => ({ ...c, project_id: patch.project_id })),
  );

  const requiredFilled = [
    form.project_id,
    form.location.trim(),
    form.occurred_on,
    form.occurred_time,
    form.alert_type_id,
    form.category_id,
    form.risk_level_id,
    form.detection_method_id,
    form.alert_summary.trim(),
    pictureName,
    actorName,
  ];
  const completed = requiredFilled.filter(Boolean).length;
  const remaining = requiredFilled.length - completed;
  const week = weekFromIsoDate(form.occurred_on);
  const locked = Boolean(record);
  const unlocked = record?.status === "open";
  const submitted = record?.status === "under_process";
  const canRegister = remaining === 0 && !saving && !locked;
  const closeFilled = [
    closeout.hseo_name_badge.trim(),
    closeout.close_out_action.trim(),
    closeout.close_out_picture,
  ];
  const closeRemaining = closeFilled.filter(Boolean).length === 3 ? 0 : 3 - closeFilled.filter(Boolean).length;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canRegister) return;
    setSaving(true);
    setError(null);
    try {
      const created = await postJson<CaseDetail>("/api/v1/ai-camera-observations", {
        ...form,
        reported_by: actorName,
        observation_picture: pictureName || null,
      });
      setRecord(created);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function onCloseOut() {
    if (!record || !unlocked || closing) return;
    if (closeRemaining > 0) {
      setError(
        `Status Open. ${closeRemaining} close-out field${closeRemaining === 1 ? " is" : "s are"} still empty`,
      );
      return;
    }
    setClosing(true);
    setError(null);
    try {
      const updated = await closeOutAiCamera(record.id, closeout);
      setRecord(updated);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setClosing(false);
    }
  }

  return (
    <section className="page register-page">
      <RegisterIntro
        filled={completed}
        total={requiredFilled.length}
        status={record?.status ?? null}
      />
      <form className="register-form" onSubmit={(event) => void onSubmit(event)}>
        <div className="register-grid ai-grid">
          <fieldset className="register-lock" disabled={locked}>
          <article className="panel">
            <h3>Observation details</h3>
            <div className="form-row">
              <SelectList
                label="Project"
                type="project"
                value={form.project_id}
                onChange={(project_id) => setForm((current) => ({ ...current, project_id }))}
                required
                hideNotes
                allowedLabels={projectScope.allowedLabels}
                disabled={projectScope.lockProjectSelect}
              />
              <label>
                Location *
                <input
                  required
                  placeholder="Location"
                  value={form.location}
                  onChange={(event) => setForm({ ...form, location: event.target.value })}
                />
              </label>
            </div>
            <div className="form-row three">
              <label>
                Date *
                <input
                  type="date"
                  required
                  value={form.occurred_on}
                  onChange={(event) => setForm({ ...form, occurred_on: event.target.value })}
                />
              </label>
              <label>
                Week
                <input readOnly value={week ?? ""} />
                <span className="field-note">Calculated from the date</span>
              </label>
              <label>
                Time *
                <input
                  type="time"
                  required
                  value={form.occurred_time}
                  onChange={(event) => setForm({ ...form, occurred_time: event.target.value })}
                />
              </label>
            </div>
            <div className="form-row">
              <SelectList
                label="Alert Type"
                type="alert_type"
                value={form.alert_type_id}
                onChange={(alert_type_id) => setForm((current) => ({ ...current, alert_type_id }))}
                required
                hideNotes
              />
              <SelectList
                label="Category"
                type="ai_camera_category"
                value={form.category_id}
                onChange={(category_id) => setForm((current) => ({ ...current, category_id }))}
                required
                hideNotes
                hint="Managed by Admin"
              />
            </div>
            <div className="form-row">
              <SelectList
                label="Risk Level"
                type="risk_level"
                value={form.risk_level_id}
                onChange={(risk_level_id) => setForm((current) => ({ ...current, risk_level_id }))}
                required
                hideNotes
              />
              <SelectList
                label="Detection Method"
                type="detection_method"
                value={form.detection_method_id}
                onChange={(detection_method_id) =>
                  setForm((current) => ({ ...current, detection_method_id }))
                }
                required
                hideNotes
              />
            </div>
            <label>
              Alert Summary *
              <textarea
                required
                rows={4}
                  placeholder="[What the camera detected]"
                value={form.alert_summary}
                onChange={(event) => setForm({ ...form, alert_summary: event.target.value })}
              />
            </label>
          </article>
          </fieldset>
          <div className="register-col">
            <fieldset className="register-lock" disabled={locked}>
            <article className="panel">
              <h3>Evidence and reporting</h3>
              <label>
                Observation Picture *
                <span className="dropzone">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(event) =>
                      setPictureName(event.target.files?.[0]?.name ?? "")
                    }
                  />
                  <strong>Drop a file here or browse</strong>
                  <span>{pictureName || "Image of the observation"}</span>
                </span>
              </label>
              <SignedInNameField label="Reported By *" />
            </article>
            </fieldset>
            <article className="panel closeout-panel">
              <h3>
                {unlocked ? null : <span className="lock-mark" aria-hidden="true" />}
                Close-out
              </h3>
              <p className="muted">
                {submitted
                  ? "Close-out submitted. Status is Under Process."
                  : unlocked
                    ? "Record is Open. All close-out fields are required to submit."
                    : "Locked until the observation is registered. Status will be Open after Register."}
              </p>
              <label>
                Safety Officer (HSEO) in the Area: Name & Badge Number *
                <input
                  disabled={!unlocked}
                  placeholder="[Name] / [Badge number]"
                  value={closeout.hseo_name_badge}
                  onChange={(event) =>
                    setCloseout({ ...closeout, hseo_name_badge: event.target.value })
                  }
                />
              </label>
              <label>
                Close-out Action *
                <textarea
                  disabled={!unlocked}
                  rows={3}
                  placeholder="[Action taken]"
                  value={closeout.close_out_action}
                  onChange={(event) =>
                    setCloseout({ ...closeout, close_out_action: event.target.value })
                  }
                />
              </label>
              <label>
                Close-out Picture *
                <span className={`dropzone${unlocked ? "" : " is-disabled"}`}>
                  {unlocked ? (
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(event) =>
                        setCloseout({
                          ...closeout,
                          close_out_picture: event.target.files?.[0]?.name ?? "",
                        })
                      }
                    />
                  ) : null}
                  <strong>Drop a file here or browse</strong>
                  <span>
                    {closeout.close_out_picture || "Image of the corrective action"}
                  </span>
                </span>
              </label>
              <div className="closeout-actions">
                <button
                  className="btn primary"
                  type="button"
                  disabled={!unlocked || closing}
                  onClick={() => void onCloseOut()}
                >
                  {closing ? "Saving…" : "Submit close-out"}
                </button>
              </div>
            </article>
          </div>
        </div>
        <RegisterFooter
          error={error}
          remaining={remaining}
          status={record?.status ?? null}
          closeRemaining={closeRemaining}
          saving={saving}
          registerLabel="Register observation"
          canRegister={canRegister}
          hideRegister={locked}
        />
      </form>
    </section>
  );
}

function AssignBlock({
  assignTo,
  projectId,
  departmentId,
  onChange,
  hideNotes,
}: {
  assignTo: "project" | "department";
  projectId: string;
  departmentId: string;
  onChange: (patch: {
    assign_to?: "project" | "department";
    project_id?: string;
    department_id?: string;
  }) => void;
  hideNotes?: boolean;
}) {
  const projectScope = useAutoFormProject(true, projectId, (patch) => onChange(patch));
  return (
    <>
      <div>
        <span className="field-label">Assign to *</span>
        <div className="seg-group" role="group" aria-label="Assign to">
          <button
            type="button"
            className={assignTo === "project" ? "seg-btn is-active" : "seg-btn"}
            onClick={() =>
              onChange({ assign_to: "project", department_id: "" })
            }
          >
            Project
          </button>
          <button
            type="button"
            className={assignTo === "department" ? "seg-btn is-active" : "seg-btn"}
            onClick={() =>
              onChange({ assign_to: "department", project_id: "" })
            }
          >
            Department
          </button>
        </div>
      </div>
      {assignTo === "project" ? (
        <SelectList
          label="Project"
          type="project"
          value={projectId}
          onChange={(project_id) => onChange({ project_id, department_id: "" })}
          required
          hideNotes={hideNotes}
          allowedLabels={projectScope.allowedLabels}
          disabled={projectScope.lockProjectSelect}
        />
      ) : (
        <SelectList
          label="Department"
          type="department"
          value={departmentId}
          onChange={(department_id) => onChange({ department_id, project_id: "" })}
          required
          hideNotes={hideNotes}
        />
      )}
    </>
  );
}

export function DashcamForm() {
  const actorName = useSignedInName();
  const summaries = useList("dashcam_alert_summary");
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pictureName, setPictureName] = useState("");
  const [record, setRecord] = useState<CaseDetail | null>(null);
  const [proofName, setProofName] = useState("");
  const [form, setForm] = useState({
    assign_to: "project" as "project" | "department",
    project_id: "",
    department_id: "",
    vehicle_type_id: "",
    model_id: "",
    asset_number: "",
    driver_name: "",
    driver_badge_number: "",
    rental_driver: false,
    iqama_number: "",
    occurred_on: todayIso(),
    occurred_time: "",
    violation_type_id: "",
    risk_level_id: "",
    alert_summary: "",
  });

  const requiredFilled = [
    form.assign_to === "project" ? form.project_id : form.department_id,
    form.vehicle_type_id,
    form.model_id,
    form.asset_number.trim(),
    form.driver_name.trim(),
    form.driver_badge_number.trim(),
    form.rental_driver ? form.iqama_number.trim() : "ok",
    form.occurred_on,
    form.occurred_time,
    form.violation_type_id,
    form.risk_level_id,
    form.alert_summary.trim(),
    actorName,
  ];
  const completed = requiredFilled.filter(Boolean).length;
  const remaining = requiredFilled.length - completed;
  const week = weekFromIsoDate(form.occurred_on);
  const locked = Boolean(record);
  const unlocked = record?.status === "open";
  const submitted = record?.status === "under_process";
  const canRegister = remaining === 0 && !saving && !locked;
  const closeRemaining = [proofName, actorName].filter(Boolean).length === 2 ? 0 : 2 - [proofName, actorName].filter(Boolean).length;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canRegister) return;
    setSaving(true);
    setError(null);
    try {
      const created = await postJson<CaseDetail>("/api/v1/dashcam-observations", {
        assign_to: form.assign_to,
        project_id: form.assign_to === "project" ? form.project_id : null,
        department_id: form.assign_to === "department" ? form.department_id : null,
        vehicle_type_id: form.vehicle_type_id,
        model_id: form.model_id,
        asset_number: form.asset_number,
        driver_name: form.driver_name,
        driver_badge_number: form.driver_badge_number,
        rental_driver: form.rental_driver,
        iqama_number: form.rental_driver ? form.iqama_number : null,
        occurred_on: form.occurred_on,
        occurred_time: form.occurred_time,
        violation_type_id: form.violation_type_id,
        risk_level_id: form.risk_level_id,
        alert_summary: form.alert_summary,
        reported_by: actorName,
        violation_picture: pictureName || null,
      });
      setRecord(created);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function onConfirmDriver() {
    if (!record || !unlocked || closing) return;
    if (closeRemaining > 0) {
      setError(
        `Status Open. ${closeRemaining} close-out field${closeRemaining === 1 ? " is" : "s are"} still empty`,
      );
      return;
    }
    setClosing(true);
    setError(null);
    try {
      const updated = await confirmDriver("dashcam", record.id, {
        itqan_proof: proofName,
        uploaded_by: actorName,
      });
      setRecord(updated);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setClosing(false);
    }
  }

  return (
    <section className="page register-page">
      <RegisterIntro
        filled={completed}
        total={requiredFilled.length}
        status={record?.status ?? null}
      />
      <form className="register-form" onSubmit={(event) => void onSubmit(event)}>
        <div className="register-grid dashcam-grid">
          <fieldset className="register-lock" disabled={locked}>
          <article className="panel register-span">
            <h3>Project or Department</h3>
            <p className="muted">
              Select either a Project or a Department (one of the two)
            </p>
            <div className="form-row assign-row">
              <AssignBlock
                assignTo={form.assign_to}
                projectId={form.project_id}
                departmentId={form.department_id}
                hideNotes
                onChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
              />
            </div>
          </article>
          <article className="panel">
            <h3>Vehicle and driver</h3>
            <div className="form-row">
              <SelectList
                label="Vehicle Type"
                type="vehicle_type"
                value={form.vehicle_type_id}
                onChange={(vehicle_type_id) =>
                  setForm((current) => ({ ...current, vehicle_type_id }))
                }
                required
                hideNotes
                hint="Light: cars, pickups, vans. Heavy: trucks, buses, equipment."
              />
              <SelectList
                label="Model"
                type="model"
                value={form.model_id}
                onChange={(model_id) => setForm((current) => ({ ...current, model_id }))}
                required
                hideNotes
                hint="Clarifies the vehicle type"
              />
            </div>
            <div className="form-row">
              <label>
                Asset Number *
                <input
                  required
                  placeholder="Asset number"
                  value={form.asset_number}
                  onChange={(event) =>
                    setForm({ ...form, asset_number: event.target.value })
                  }
                />
              </label>
              <label>
                Driver Name *
                <input
                  required
                  placeholder="Driver name"
                  value={form.driver_name}
                  onChange={(event) =>
                    setForm({ ...form, driver_name: event.target.value })
                  }
                />
              </label>
            </div>
            <div className="form-row">
              <label>
                Driver Badge Number *
                <input
                  required
                  placeholder="Badge number"
                  value={form.driver_badge_number}
                  onChange={(event) =>
                    setForm({ ...form, driver_badge_number: event.target.value })
                  }
                />
              </label>
              <div>
                <span className="field-label">Rental driver</span>
                <div className="radio-pills" role="radiogroup" aria-label="Rental driver">
                  <label className={`radio-pill${!form.rental_driver ? " is-on" : ""}`}>
                    <input
                      type="radio"
                      name="rental_driver"
                      checked={!form.rental_driver}
                      onChange={() =>
                        setForm((current) => ({
                          ...current,
                          rental_driver: false,
                          iqama_number: "",
                        }))
                      }
                    />
                    <span className="radio-dot" aria-hidden />
                    <span>No</span>
                  </label>
                  <label className={`radio-pill${form.rental_driver ? " is-on" : ""}`}>
                    <input
                      type="radio"
                      name="rental_driver"
                      checked={form.rental_driver}
                      onChange={() =>
                        setForm((current) => ({ ...current, rental_driver: true }))
                      }
                    />
                    <span className="radio-dot" aria-hidden />
                    <span>Yes</span>
                  </label>
                </div>
              </div>
            </div>
            <label>
              Iqama Number {form.rental_driver ? "*" : "(if Rental)"}
              <input
                required={form.rental_driver}
                disabled={!form.rental_driver}
                placeholder="Iqama number"
                value={form.iqama_number}
                onChange={(event) =>
                  setForm({ ...form, iqama_number: event.target.value })
                }
              />
              <span className="field-note">
                Iqama Number is required when Rental is Yes
              </span>
            </label>
          </article>
          <article className="panel">
            <h3>Alert details</h3>
            <div className="form-row three">
              <label>
                Date *
                <input
                  type="date"
                  required
                  value={form.occurred_on}
                  onChange={(event) =>
                    setForm({ ...form, occurred_on: event.target.value })
                  }
                />
              </label>
              <label>
                Week
                <input readOnly value={week ?? ""} />
                <span className="field-note">Calculated from the date</span>
              </label>
              <label>
                Time *
                <input
                  type="time"
                  required
                  value={form.occurred_time}
                  onChange={(event) =>
                    setForm({ ...form, occurred_time: event.target.value })
                  }
                />
              </label>
            </div>
            <div className="form-row">
              <SelectList
                label="Violation Type"
                type="dashcam_observation_type"
                value={form.violation_type_id}
                onChange={(violation_type_id) =>
                  setForm((current) => ({ ...current, violation_type_id }))
                }
                required
                hideNotes
              />
              <SelectList
                label="Risk Level"
                type="risk_level"
                value={form.risk_level_id}
                onChange={(risk_level_id) =>
                  setForm((current) => ({ ...current, risk_level_id }))
                }
                required
                hideNotes
              />
            </div>
            <label>
              Alert Summary *
              {summaries.items.length ? (
                <select
                  required
                  value={form.alert_summary}
                  onChange={(event) =>
                    setForm({ ...form, alert_summary: event.target.value })
                  }
                >
                  <option value="">Select alert summary</option>
                  {summaries.items.map((item) => (
                    <option key={item.id} value={item.label}>
                      {item.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  required
                  value={form.alert_summary}
                  onChange={(event) =>
                    setForm({ ...form, alert_summary: event.target.value })
                  }
                  placeholder="Select alert summary"
                />
              )}
              {!summaries.items.length ? (
                <span className="field-note">
                  List values were not supplied. Type a summary, or add values in
                  Administration.
                </span>
              ) : null}
            </label>
          </article>
          <article className="panel">
            <h3>Evidence and reporting</h3>
            <label>
              Violation Picture *
              <span className="dropzone">
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) =>
                    setPictureName(event.target.files?.[0]?.name ?? "")
                  }
                />
                <strong>Drop a file here or browse</strong>
                <span>
                  {pictureName ||
                    "Image of the violation. Uploads are not stored in this prototype."}
                </span>
              </span>
            </label>
            <SignedInNameField label="Reported By *" />
          </article>
          </fieldset>
          <ConfirmDriverPanel
            unlocked={unlocked}
            submitted={submitted}
            proofName={proofName}
            uploadedBy={actorName}
            saving={closing}
            onProof={setProofName}
            onSubmit={() => void onConfirmDriver()}
          />
        </div>
        <RegisterFooter
          error={error}
          remaining={remaining}
          status={record?.status ?? null}
          closeRemaining={closeRemaining}
          saving={saving}
          registerLabel="Register violation"
          canRegister={canRegister}
          hideRegister={locked}
        />
      </form>
    </section>
  );
}

export function CaseDetailScreen({ id }: { id: string }) {
  const [row, setRow] = useState<CaseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closeForm, setCloseForm] = useState({
    alarm: "" as "" | "False Alarm" | "True Alarm",
    picture_shared_by: "",
    closed_at: nowLocal(),
    close_out_report: "",
  });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setRow(await fetchCase(id));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onClose(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (!closeForm.alarm) {
        setError("Select alarm type (False or True alarm) before closing.");
        return;
      }
      await closeSos(id, {
        alarm: closeForm.alarm,
        picture_shared_by: closeForm.picture_shared_by,
        closed_at: new Date(closeForm.closed_at).toISOString(),
        close_out_report: closeForm.close_out_report,
      });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (!row && !error) return <p className="state">Loading record…</p>;
  if (!row) return <p className="state error">{error}</p>;

  return (
    <section className="page">
      <article className="panel review-detail">
        <div className="panel-head record-detail-head">
          <div>
            <h3>
              {row.case_id}: {TYPE_LABEL[row.record_type]}
            </h3>
            <p className="muted">
              Week {row.week_number} · {row.date} · {row.project || row.department}
            </p>
          </div>
          <StatusPill status={row.status} />
        </div>
        <RecordReviewDetail detail={row} />
      </article>
      {row.record_type === "sos" && row.status === "open" ? (
        <article className="panel">
          <h3>Close alert</h3>
          <p className="muted">Worker picture is required in the specification and is not collected here yet.</p>
          <form className="form" onSubmit={(event) => void onClose(event)}>
            <div className="fld">
              <span className="field-label lbl">Alarm *</span>
              <div className="radio">
                <label>
                  <input
                    type="radio"
                    name="detailSosAlarm"
                    checked={closeForm.alarm === "False Alarm"}
                    onChange={() => setCloseForm({ ...closeForm, alarm: "False Alarm" })}
                  />{" "}
                  False alarm
                </label>
                <label>
                  <input
                    type="radio"
                    name="detailSosAlarm"
                    checked={closeForm.alarm === "True Alarm"}
                    onChange={() => setCloseForm({ ...closeForm, alarm: "True Alarm" })}
                  />{" "}
                  True alarm
                </label>
              </div>
            </div>
            <label>
              Worker Picture Shared By *
              <input
                required
                value={closeForm.picture_shared_by}
                onChange={(event) =>
                  setCloseForm({ ...closeForm, picture_shared_by: event.target.value })
                }
              />
            </label>
            <label>
              Closed At *
              <input
                type="datetime-local"
                required
                value={closeForm.closed_at}
                onChange={(event) =>
                  setCloseForm({ ...closeForm, closed_at: event.target.value })
                }
              />
            </label>
            <label>
              Close-out Report *
              <textarea
                required
                rows={3}
                value={closeForm.close_out_report}
                onChange={(event) =>
                  setCloseForm({ ...closeForm, close_out_report: event.target.value })
                }
              />
            </label>
            {error ? <p className="state error">{error}</p> : null}
            <button className="btn primary" disabled={saving}>
              {saving ? "Closing…" : "Close alert"}
            </button>
          </form>
        </article>
      ) : null}
    </section>
  );
}
