import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  addListItem,
  deleteListItem,
  approveCase,
  closeOutAiCamera,
  closeSos,
  confirmDriver,
  uploadImage,
  createUser,
  deleteCase,
  deleteUser,
  fetchCase,
  fetchCases,
  fetchCatalog,
  createContact,
  deleteContact,
  fetchContacts,
  updateContact,
  fetchList,
  fetchPermissionMatrix,
  fetchAuditLog,
  fetchUsers,
  fetchPlatformSettings,
  notifyCasesChanged,
  openNotificationsPanel,
  savePlatformSettings,
  putJson,
  rejectCase,
  updateCase,
  updateListItem,
  updateUser,
  type AuditLogItem,
  type CaseDetail,
  type CaseSummary,
  type ContactRow,
  type ListItem,
} from "../api/scc";
import { notifyListsChanged } from "../api/lists";
import { useAuth } from "../auth/AuthContext";
import { errorMessage } from "../lib/errors";
import { href } from "../lib/routing";
import { AiCameraRecordDrawer } from "./AiCameraRecordDrawer";
import { DashcamRecordDrawer } from "./DashcamRecordDrawer";
import { ItqanRecordDrawer } from "./ItqanRecordDrawer";
import { SosRecordDrawer } from "./SosRecordDrawer";
import { SpeedRecordDrawer } from "./SpeedRecordDrawer";
import {
  CONTACT_LABEL,
  formatUserLabel,
  LIST_LABEL,
  RiskPill,
  SignedInNameField,
  StatusPill,
  TYPE_LABEL,
  useList,
  useSignedInName,
} from "./shared";

const CONTACT_CATEGORIES = Object.keys(CONTACT_LABEL);

const REVIEW_TYPE: Record<string, string> = {
  ai_camera: "AI Camera Observation",
  dashcam: "DashCam Observation",
  speed: "Speed Violation",
  sos: "SOS Alert",
  itqan: "ITQAN Violation",
};

function formatReviewDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${Number(match[3])} ${months[Number(match[2]) - 1]} ${match[1]}`;
}

const ITQAN_ACTION = "The Violation has been uploaded in ITQAN";

function canCloseOutFromReview(row: Pick<CaseSummary, "status" | "record_type">) {
  return (
    row.status === "open" &&
    (row.record_type === "ai_camera" ||
      row.record_type === "dashcam" ||
      row.record_type === "speed" ||
      row.record_type === "sos")
  );
}

function handledBy(row: CaseSummary): string {
  if (row.status === "closed") return "Closed";
  if (row.status === "under_process") return "Waiting for Admin review";
  if (row.record_type === "dashcam" || row.record_type === "speed") {
    return "Waiting for Confirm Driver & Submit";
  }
  if (row.record_type === "sos") return "Waiting for close";
  return "Waiting for close-out";
}

function reviewScope(row: CaseSummary) {
  if (row.project) return row.project;
  if (row.department) return `Dept: ${row.department}`;
  return "—";
}

const REVIEW_SLA_HOURS: Record<string, number> = { High: 24, Medium: 72, Low: 168 };
const REVIEW_HOUR_MS = 3600000;
const REVIEW_PAGE_SIZE = 12;

function reviewRiskKey(row: CaseSummary) {
  return (row.risk_level || "").replace(/\s*Risk$/i, "").trim() || "Low";
}

function fmtReviewSla(hours: number) {
  if (hours < 24) return `${hours.toFixed(1)} h`;
  const d = hours / 24;
  if (d < 7) return `${d.toFixed(1)} days`;
  return `${(d / 7).toFixed(1)} wk`;
}

type ReviewSla =
  | { kind: "left"; hours: number; urgent: boolean; label: string }
  | { kind: "over"; hours: number; label: string }
  | null;

function reviewSla(row: CaseSummary, now = Date.now()): ReviewSla {
  if (row.status === "closed") return null;
  const limit = REVIEW_SLA_HOURS[reviewRiskKey(row)] ?? 72;
  const created = new Date(row.created_at).getTime();
  if (!Number.isFinite(created)) return null;
  const age = (now - created) / REVIEW_HOUR_MS;
  if (age > limit) {
    return { kind: "over", hours: age - limit, label: `${fmtReviewSla(age - limit)} over` };
  }
  const left = limit - age;
  return {
    kind: "left",
    hours: left,
    urgent: left < 24 || age > limit * 0.75,
    label: `${fmtReviewSla(left)} left`,
  };
}

function isReviewOverdue(row: CaseSummary, now = Date.now()) {
  const sla = reviewSla(row, now);
  return Boolean(sla && sla.kind === "over");
}

function ReviewCheckIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M8 12.5l2.5 2.5L16 9.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ReviewKpiIcon({ name }: { name: "camera" | "car" | "speed" | "warn" }) {
  const c = {
    width: 14,
    height: 14,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (name) {
    case "camera":
      return (
        <svg {...c}>
          <path d="M3 8h12l3 3v5l-3 3H3z" />
          <circle cx="10" cy="13.5" r="2.5" />
          <path d="M18 11l3-1.5v8L18 16" />
        </svg>
      );
    case "car":
      return (
        <svg {...c}>
          <path d="M3 14l2-6h14l2 6" />
          <path d="M5 14v4M19 14v4M7 18h2M15 18h2" />
          <circle cx="7.5" cy="14.5" r="1.5" />
          <circle cx="16.5" cy="14.5" r="1.5" />
        </svg>
      );
    case "speed":
      return (
        <svg {...c}>
          <path d="M4 18a9 9 0 1 1 16 0" />
          <path d="M12 18l4-6" />
          <circle cx="12" cy="18" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      );
    case "warn":
      return (
        <svg {...c}>
          <path d="M12 3L22 20H2L12 3z" />
          <path d="M12 10v4" />
          <circle cx="12" cy="17" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
  }
}

function fieldValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function fileName(value: unknown, fallback = "[File name]") {
  const text = fieldValue(value);
  return text === "—" ? fallback : text;
}

type DetailRow = { label: string; value: string; muted?: boolean };
type DetailBlock =
  | { kind: "rows"; items: DetailRow[] }
  | { kind: "text"; title: string; body: string }
  | { kind: "file"; title: string; name: string }
  | { kind: "audit"; items: DetailRow[] };

function assignRows(row: CaseDetail): DetailRow[] {
  if (row.project) return [{ label: "Assigned to", value: `Project: ${row.project}` }];
  if (row.department) {
    return [{ label: "Assigned to", value: `Department: ${row.department}` }];
  }
  return [];
}

function dateWeekValue(row: CaseDetail) {
  return `${formatReviewDate(row.date)}${
    row.week_number ? ` (Week ${row.week_number})` : ""
  }`;
}

function buildReviewBlocks(row: CaseDetail): DetailBlock[] {
  const f = row.fields;
  const blocks: DetailBlock[] = [];

  if (row.record_type === "speed") {
    blocks.push({
      kind: "rows",
      items: [
        ...assignRows(row),
        { label: "Speed Violation Type", value: fieldValue(f.speed_violation_type) },
        { label: "Vehicle Type", value: fieldValue(f.vehicle_type) },
        { label: "Model", value: fieldValue(f.model) },
        { label: "Asset Number", value: fieldValue(f.asset_number) },
        {
          label: "Driver",
          value: `${fieldValue(f.driver_name)} / ${fieldValue(f.driver_badge_number)}`,
        },
        { label: "Position", value: fieldValue(f.position) },
        { label: "Date", value: dateWeekValue(row) },
        {
          label: "Permitted Speed (Speed Limit)",
          value: `${fieldValue(f.permitted_speed_kmh)} km/h`,
        },
        { label: "Vehicle Speed", value: `${fieldValue(f.vehicle_speed_kmh)} km/h` },
        { label: "Reported By", value: fieldValue(f.reported_by) },
      ],
    });
    blocks.push({
      kind: "text",
      title: "Alert Summary",
      body: fieldValue(f.alert_summary ?? row.title),
    });
    blocks.push({
      kind: "file",
      title: "FMS Evidence",
      name: fileName(f.fms_evidence),
    });
    if (f.close_out_action) {
      blocks.push({
        kind: "text",
        title: "Close-out Action",
        body: fieldValue(f.close_out_action),
      });
    }
    if (f.itqan_upload_proof || f.close_out_action) {
      blocks.push({
        kind: "file",
        title: "ITQAN Upload Proof",
        name: fileName(f.itqan_upload_proof),
      });
    }
  } else if (row.record_type === "dashcam") {
    blocks.push({
      kind: "rows",
      items: [
        ...assignRows(row),
        { label: "Violation Type", value: fieldValue(f.violation_type) },
        { label: "Vehicle Type", value: fieldValue(f.vehicle_type) },
        { label: "Model", value: fieldValue(f.model) },
        { label: "Asset Number", value: fieldValue(f.asset_number) },
        {
          label: "Driver",
          value: `${fieldValue(f.driver_name)} / ${fieldValue(f.driver_badge_number)}`,
        },
        { label: "Location Coordinates", value: fieldValue(f.location_coordinates) },
        { label: "Date", value: dateWeekValue(row) },
        { label: "Risk Level", value: row.risk_level || "—" },
        { label: "Reported By", value: fieldValue(f.reported_by) },
      ],
    });
    blocks.push({
      kind: "text",
      title: "Alert Summary",
      body: fieldValue(f.alert_summary ?? row.title),
    });
    blocks.push({
      kind: "file",
      title: "Violation Picture",
      name: fileName(f.violation_picture),
    });
    if (f.close_out_action) {
      blocks.push({
        kind: "text",
        title: "Close-out Action",
        body: fieldValue(f.close_out_action),
      });
    }
    if (f.itqan_upload_proof || f.close_out_action) {
      blocks.push({
        kind: "file",
        title: "ITQAN Upload Proof",
        name: fileName(f.itqan_upload_proof),
      });
    }
  } else if (row.record_type === "ai_camera") {
    blocks.push({
      kind: "rows",
      items: [
        { label: "Project", value: row.project || "—" },
        { label: "Location", value: fieldValue(f.location) },
        { label: "Date", value: dateWeekValue(row) },
        { label: "Time", value: fieldValue(f.occurred_time) },
        { label: "Alert Type", value: fieldValue(f.alert_type) },
        { label: "Category", value: fieldValue(f.category) },
        { label: "Risk Level", value: row.risk_level || "—" },
        { label: "Detection Method", value: fieldValue(f.detection_method) },
        { label: "Reported By", value: fieldValue(f.reported_by) },
      ],
    });
    blocks.push({
      kind: "text",
      title: "Alert Summary",
      body: fieldValue(f.alert_summary ?? row.title),
    });
    blocks.push({
      kind: "file",
      title: "Observation Picture",
      name: fileName(f.observation_picture),
    });
    if (f.hseo_name_badge) {
      blocks.push({
        kind: "rows",
        items: [
          {
            label: "Safety Officer (HSEO)",
            value: fieldValue(f.hseo_name_badge),
          },
        ],
      });
    }
    if (f.close_out_action) {
      blocks.push({
        kind: "text",
        title: "Close-out Action",
        body: fieldValue(f.close_out_action),
      });
    }
    if (f.close_out_picture) {
      blocks.push({
        kind: "file",
        title: "Close-out Picture",
        name: fileName(f.close_out_picture),
      });
    }
  } else {
    blocks.push({
      kind: "rows",
      items: [
        { label: "Project", value: row.project || "—" },
        { label: "Worker Name & Badge", value: fieldValue(f.worker_name_badge) },
        { label: "SOS Created At", value: fieldValue(f.sos_created_at) },
        { label: "Seen At", value: fieldValue(f.seen_at) },
        { label: "Location", value: fieldValue(f.location) },
        { label: "Source", value: fieldValue(f.source) },
        { label: "Date", value: dateWeekValue(row) },
      ],
    });
    if (f.close_out_report) {
      blocks.push({
        kind: "text",
        title: "Close-out Report",
        body: fieldValue(f.close_out_report),
      });
    }
  }

  if (f.reject_reason) {
    blocks.push({
      kind: "text",
      title: "Previous rejection reason",
      body: fieldValue(f.reject_reason),
    });
  }

  const audit: DetailRow[] = [
    {
      label: "Registered by",
      value:
        row.record_type === "sos"
          ? formatReviewDate(row.created_at)
          : `${fieldValue(f.reported_by)}, ${formatReviewDate(row.created_at)}`,
    },
  ];
  if (row.record_type === "dashcam" || row.record_type === "speed") {
    audit.push({
      label: "Confirmed and uploaded by",
      value:
        f.uploaded_by || f.confirmed_at
          ? `${fieldValue(f.uploaded_by)}${
              f.confirmed_at ? `, ${formatReviewDate(String(f.confirmed_at))}` : ""
            }`
          : "—",
    });
  } else if (row.record_type === "ai_camera" && f.close_out_submitted_by) {
    audit.push({
      label: "Close-out submitted by",
      value: fieldValue(f.close_out_submitted_by),
    });
  }
  if (row.record_type !== "sos") {
    audit.push({
      label: "Closed by",
      value: f.closed_by
        ? fieldValue(f.closed_by)
        : "Shows [Admin name] after approval",
      muted: !f.closed_by,
    });
  } else if (f.closed_by) {
    audit.push({ label: "Closed by", value: fieldValue(f.closed_by) });
  }
  blocks.push({ kind: "audit", items: audit });
  return blocks;
}

function FileGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="5" width="16" height="14" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M8 15.2 10.2 12.4a1.2 1.2 0 0 1 1.8 0L14 14.2l1.1-1.2a1.2 1.2 0 0 1 1.8.1L18 15.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="9.2" cy="9" r="1.2" fill="currentColor" />
    </svg>
  );
}

function EditGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="14" height="14">
      <path
        d="M4 20h4.2L18.6 9.6a1.6 1.6 0 0 0 0-2.3L16.7 5.4a1.6 1.6 0 0 0-2.3 0L4 15.8V20z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M13.2 6.8 17.2 10.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function strField(fields: Record<string, unknown>, key: string): string {
  const value = fields[key];
  if (value === null || value === undefined) return "";
  return String(value);
}

function boolField(fields: Record<string, unknown>, key: string): boolean {
  const value = fields[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return ["true", "yes", "1"].includes(value.trim().toLowerCase());
  }
  return Boolean(value);
}

type RecordEditDraft = {
  project: string;
  department: string;
  assignTo: "project" | "department";
  occurred_on: string;
  risk_level: string;
  title: string;
  fields: Record<string, string>;
  rental_driver: boolean;
};

function buildEditDraft(detail: CaseDetail): RecordEditDraft {
  const f = detail.fields ?? {};
  const assignTo: "project" | "department" =
    detail.department && !detail.project ? "department" : "project";
  const fieldKeys =
    detail.record_type === "ai_camera"
      ? ["location", "occurred_time", "alert_summary", "alert_type", "category", "detection_method"]
      : detail.record_type === "dashcam"
        ? [
            "violation_type",
            "vehicle_type",
            "model",
            "asset_number",
            "driver_name",
            "driver_badge_number",
            "location_coordinates",
            "alert_summary",
            "iqama_number",
          ]
        : detail.record_type === "speed"
          ? [
              "speed_violation_type",
              "vehicle_type",
              "model",
              "asset_number",
              "driver_name",
              "driver_badge_number",
              "position",
              "location_coordinates",
              "permitted_speed_kmh",
              "vehicle_speed_kmh",
              "iqama_number",
            ]
          : [
              "worker_name_badge",
              "location",
              "source",
              "sos_created_at",
              "seen_at",
              "close_out_report",
            ];
  const fields: Record<string, string> = {};
  for (const key of fieldKeys) {
    fields[key] = strField(f, key);
  }
  if (!fields.alert_summary && detail.title) {
    fields.alert_summary = detail.title;
  }
  return {
    project: detail.project ?? "",
    department: detail.department ?? "",
    assignTo,
    occurred_on: detail.date?.slice(0, 10) ?? "",
    risk_level: detail.risk_level ?? "",
    title: detail.title ?? "",
    fields,
    rental_driver: boolField(f, "rental_driver"),
  };
}

function setDraftField(
  draft: RecordEditDraft,
  key: string,
  value: string,
): RecordEditDraft {
  return { ...draft, fields: { ...draft.fields, [key]: value } };
}

export function RecordReviewDetail({
  detail,
  editing = false,
  onSaved,
  onCancel,
}: {
  detail: CaseDetail;
  editing?: boolean;
  onSaved?: (row: CaseDetail) => void;
  onCancel?: () => void;
}) {
  const projects = useList("project");
  const departments = useList("department");
  const riskLevels = useList("risk_level");
  const [draft, setDraft] = useState(() => buildEditDraft(detail));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (editing) {
      setDraft(buildEditDraft(detail));
      setError(null);
    }
  }, [editing, detail]);

  async function saveEdit() {
    if (saving || !onSaved) return;
    setSaving(true);
    setError(null);
    try {
      const fields: Record<string, unknown> = { ...draft.fields };
      if (detail.record_type === "dashcam" || detail.record_type === "speed") {
        fields.rental_driver = draft.rental_driver;
      }
      const body: Parameters<typeof updateCase>[1] = {
        fields,
        occurred_on: draft.occurred_on || null,
        title: draft.title.trim() || draft.fields.alert_summary?.trim() || detail.title,
      };
      if (detail.record_type === "dashcam" || detail.record_type === "speed") {
        if (draft.assignTo === "project") {
          body.project = draft.project.trim() || null;
          body.department = null;
        } else {
          body.department = draft.department.trim() || null;
          body.project = null;
        }
      } else {
        body.project = draft.project.trim() || null;
      }
      if (detail.record_type === "ai_camera" || detail.record_type === "dashcam") {
        body.risk_level = draft.risk_level.trim() || null;
      }
      const updated = await updateCase(detail.id, body);
      onSaved(asCaseDetail(updated));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="record-detail">
        {buildReviewBlocks(detail).map((block, index) => {
          if (block.kind === "rows" || block.kind === "audit") {
            return (
              <dl
                key={`${block.kind}-${index}`}
                className={block.kind === "audit" ? "review-dl review-audit" : "review-dl"}
              >
                {block.items.map((item) => (
                  <div key={item.label}>
                    <dt>{item.label}</dt>
                    <dd className={item.muted ? "is-muted" : undefined}>{item.value}</dd>
                  </div>
                ))}
              </dl>
            );
          }
          if (block.kind === "text") {
            return (
              <div key={`${block.title}-${index}`} className="record-block">
                <h4>{block.title}</h4>
                <div className="record-box">{block.body}</div>
              </div>
            );
          }
          return (
            <div key={`${block.title}-${index}`} className="record-file">
              <span className="record-file-icon">
                <FileGlyph />
              </span>
              <div>
                <strong>{block.title}</strong>
                <span>{block.name}</span>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  const f = draft.fields;
  const violation = detail.record_type === "dashcam" || detail.record_type === "speed";

  return (
    <div className="record-detail record-edit">
      <p className="muted record-edit-note">Edit original record fields, then save.</p>
      {error ? <p className="state error">{error}</p> : null}
      <div className="record-edit-grid">
        {violation ? (
          <>
            <label>
              Assigned to
              <select
                value={draft.assignTo}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    assignTo: event.target.value as "project" | "department",
                  })
                }
              >
                <option value="project">Project</option>
                <option value="department">Department</option>
              </select>
            </label>
            {draft.assignTo === "project" ? (
              <label>
                Project
                <select
                  value={draft.project}
                  onChange={(event) => setDraft({ ...draft, project: event.target.value })}
                >
                  <option value="">Select project</option>
                  {projects.items.map((item) => (
                    <option key={item.id} value={item.label}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label>
                Department
                <select
                  value={draft.department}
                  onChange={(event) => setDraft({ ...draft, department: event.target.value })}
                >
                  <option value="">Select department</option>
                  {departments.items.map((item) => (
                    <option key={item.id} value={item.label}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        ) : (
          <label>
            Project
            <select
              value={draft.project}
              onChange={(event) => setDraft({ ...draft, project: event.target.value })}
            >
              <option value="">Select project</option>
              {projects.items.map((item) => (
                <option key={item.id} value={item.label}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        )}

        <label>
          Date
          <input
            type="date"
            value={draft.occurred_on}
            onChange={(event) => setDraft({ ...draft, occurred_on: event.target.value })}
          />
        </label>

        {detail.record_type === "ai_camera" ? (
          <>
            <label>
              Location
              <input
                value={f.location ?? ""}
                onChange={(event) => setDraft(setDraftField(draft, "location", event.target.value))}
              />
            </label>
            <label>
              Time
              <input
                value={f.occurred_time ?? ""}
                onChange={(event) =>
                  setDraft(setDraftField(draft, "occurred_time", event.target.value))
                }
              />
            </label>
            <label>
              Alert Type
              <input
                value={f.alert_type ?? ""}
                onChange={(event) =>
                  setDraft(setDraftField(draft, "alert_type", event.target.value))
                }
              />
            </label>
            <label>
              Category
              <input
                value={f.category ?? ""}
                onChange={(event) => setDraft(setDraftField(draft, "category", event.target.value))}
              />
            </label>
            <label>
              Risk Level
              <select
                value={draft.risk_level}
                onChange={(event) => setDraft({ ...draft, risk_level: event.target.value })}
              >
                <option value="">—</option>
                {riskLevels.items.map((item) => (
                  <option key={item.id} value={item.label}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Detection Method
              <input
                value={f.detection_method ?? ""}
                onChange={(event) =>
                  setDraft(setDraftField(draft, "detection_method", event.target.value))
                }
              />
            </label>
          </>
        ) : null}

        {detail.record_type === "dashcam" ? (
          <>
            <label>
              Violation Type
              <input
                value={f.violation_type ?? ""}
                onChange={(event) =>
                  setDraft(setDraftField(draft, "violation_type", event.target.value))
                }
              />
            </label>
            <label>
              Vehicle Type
              <input
                value={f.vehicle_type ?? ""}
                onChange={(event) =>
                  setDraft(setDraftField(draft, "vehicle_type", event.target.value))
                }
              />
            </label>
            <label>
              Model
              <input
                value={f.model ?? ""}
                onChange={(event) => setDraft(setDraftField(draft, "model", event.target.value))}
              />
            </label>
            <label>
              Asset Number
              <input
                value={f.asset_number ?? ""}
                onChange={(event) =>
                  setDraft(setDraftField(draft, "asset_number", event.target.value))
                }
              />
            </label>
            <label>
              Driver Name
              <input
                value={f.driver_name ?? ""}
                onChange={(event) =>
                  setDraft(setDraftField(draft, "driver_name", event.target.value))
                }
              />
            </label>
            <label>
              Driver Badge
              <input
                value={f.driver_badge_number ?? ""}
                onChange={(event) =>
                  setDraft(setDraftField(draft, "driver_badge_number", event.target.value))
                }
              />
            </label>
            <label>
              Location Coordinates
              <input
                value={f.location_coordinates ?? ""}
                onChange={(event) =>
                  setDraft(setDraftField(draft, "location_coordinates", event.target.value))
                }
              />
            </label>
            <label>
              Risk Level
              <select
                value={draft.risk_level}
                onChange={(event) => setDraft({ ...draft, risk_level: event.target.value })}
              >
                <option value="">—</option>
                {riskLevels.items.map((item) => (
                  <option key={item.id} value={item.label}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Iqama Number
              <input
                value={f.iqama_number ?? ""}
                onChange={(event) =>
                  setDraft(setDraftField(draft, "iqama_number", event.target.value))
                }
              />
            </label>
            <label className="record-edit-check">
              <input
                type="checkbox"
                checked={draft.rental_driver}
                onChange={(event) =>
                  setDraft({ ...draft, rental_driver: event.target.checked })
                }
              />
              Rental driver
            </label>
          </>
        ) : null}

        {detail.record_type === "speed" ? (
          <>
            <label>
              Speed Violation Type
              <input
                value={f.speed_violation_type ?? ""}
                onChange={(event) =>
                  setDraft(setDraftField(draft, "speed_violation_type", event.target.value))
                }
              />
            </label>
            <label>
              Vehicle Type
              <input
                value={f.vehicle_type ?? ""}
                onChange={(event) =>
                  setDraft(setDraftField(draft, "vehicle_type", event.target.value))
                }
              />
            </label>
            <label>
              Model
              <input
                value={f.model ?? ""}
                onChange={(event) => setDraft(setDraftField(draft, "model", event.target.value))}
              />
            </label>
            <label>
              Asset Number
              <input
                value={f.asset_number ?? ""}
                onChange={(event) =>
                  setDraft(setDraftField(draft, "asset_number", event.target.value))
                }
              />
            </label>
            <label>
              Driver Name
              <input
                value={f.driver_name ?? ""}
                onChange={(event) =>
                  setDraft(setDraftField(draft, "driver_name", event.target.value))
                }
              />
            </label>
            <label>
              Driver Badge
              <input
                value={f.driver_badge_number ?? ""}
                onChange={(event) =>
                  setDraft(setDraftField(draft, "driver_badge_number", event.target.value))
                }
              />
            </label>
            <label>
              Position
              <input
                value={f.position ?? ""}
                onChange={(event) => setDraft(setDraftField(draft, "position", event.target.value))}
              />
            </label>
            <label>
              Location Coordinates
              <input
                value={f.location_coordinates ?? ""}
                onChange={(event) =>
                  setDraft(setDraftField(draft, "location_coordinates", event.target.value))
                }
              />
            </label>
            <label>
              Permitted Speed (km/h)
              <input
                value={f.permitted_speed_kmh ?? ""}
                onChange={(event) =>
                  setDraft(setDraftField(draft, "permitted_speed_kmh", event.target.value))
                }
              />
            </label>
            <label>
              Vehicle Speed (km/h)
              <input
                value={f.vehicle_speed_kmh ?? ""}
                onChange={(event) =>
                  setDraft(setDraftField(draft, "vehicle_speed_kmh", event.target.value))
                }
              />
            </label>
            <label>
              Iqama Number
              <input
                value={f.iqama_number ?? ""}
                onChange={(event) =>
                  setDraft(setDraftField(draft, "iqama_number", event.target.value))
                }
              />
            </label>
            <label className="record-edit-check">
              <input
                type="checkbox"
                checked={draft.rental_driver}
                onChange={(event) =>
                  setDraft({ ...draft, rental_driver: event.target.checked })
                }
              />
              Rental driver
            </label>
          </>
        ) : null}

        {detail.record_type === "sos" ? (
          <>
            <label>
              Worker Name & Badge
              <input
                value={f.worker_name_badge ?? ""}
                onChange={(event) =>
                  setDraft(setDraftField(draft, "worker_name_badge", event.target.value))
                }
              />
            </label>
            <label>
              Location
              <input
                value={f.location ?? ""}
                onChange={(event) => setDraft(setDraftField(draft, "location", event.target.value))}
              />
            </label>
            <label>
              Source
              <input
                value={f.source ?? ""}
                onChange={(event) => setDraft(setDraftField(draft, "source", event.target.value))}
              />
            </label>
            <label>
              SOS Created At
              <input
                value={f.sos_created_at ?? ""}
                onChange={(event) =>
                  setDraft(setDraftField(draft, "sos_created_at", event.target.value))
                }
              />
            </label>
            <label>
              Seen At
              <input
                value={f.seen_at ?? ""}
                onChange={(event) => setDraft(setDraftField(draft, "seen_at", event.target.value))}
              />
            </label>
          </>
        ) : null}
      </div>

      {detail.record_type !== "sos" ? (
        <label className="record-edit-wide">
          Alert Summary
          <textarea
            rows={3}
            value={f.alert_summary ?? ""}
            onChange={(event) =>
              setDraft(setDraftField(draft, "alert_summary", event.target.value))
            }
          />
        </label>
      ) : (
        <label className="record-edit-wide">
          Close-out Report
          <textarea
            rows={4}
            value={f.close_out_report ?? ""}
            onChange={(event) =>
              setDraft(setDraftField(draft, "close_out_report", event.target.value))
            }
          />
        </label>
      )}

      <div className="record-edit-actions">
        <button className="btn ghost" type="button" disabled={saving} onClick={onCancel}>
          Cancel
        </button>
        <button
          className="btn primary"
          type="button"
          disabled={saving}
          onClick={() => void saveEdit()}
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

function asCaseDetail(row: CaseDetail): CaseDetail {
  return {
    id: row.id,
    case_id: row.case_id,
    record_type: row.record_type,
    status: row.status,
    project: row.project ?? null,
    department: row.department ?? null,
    title: row.title,
    date: row.date,
    week_number: row.week_number,
    risk_level: row.risk_level ?? null,
    created_at: String(row.created_at),
    fields: row.fields ?? {},
  };
}

function ReviewCloseOut({
  detail,
  onDone,
  onDeleted,
}: {
  detail: CaseDetail;
  onDone: (row: CaseDetail) => void;
  onDeleted: () => void;
}) {
  const { user } = useAuth();
  const actorName = useSignedInName();
  const violation = detail.record_type === "dashcam" || detail.record_type === "speed";
  const sos = detail.record_type === "sos";
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workerPictureFile, setWorkerPictureFile] = useState<File | null>(null);
  const [form, setForm] = useState({
    hseo_name_badge: "",
    close_out_action: "",
    close_out_picture: "",
    itqan_proof: "",
    alarm: "" as "" | "False Alarm" | "True Alarm",
    worker_picture: "",
    picture_shared_by: "",
    closed_at: "",
    close_out_report: "",
  });

  const filled = sos
    ? [
        form.alarm,
        workerPictureFile ? "ok" : "",
        form.picture_shared_by.trim(),
        form.closed_at,
        form.close_out_report.trim(),
      ]
    : violation
      ? [form.itqan_proof, actorName]
      : [
          form.hseo_name_badge.trim(),
          form.close_out_action.trim(),
          form.close_out_picture,
        ];
  const remaining = filled.length - filled.filter(Boolean).length;
  async function submit() {
    if (saving) return;
    if (remaining > 0) {
      setError(
        `${remaining} close-out field${remaining === 1 ? " is" : "s are"} still empty`,
      );
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = sos
        ? await (async () => {
            if (!workerPictureFile) throw new Error("Worker picture is required.");
            const uploaded = await uploadImage(workerPictureFile);
            return closeSos(detail.id, {
              alarm: form.alarm,
              worker_picture: uploaded.url,
              picture_shared_by: form.picture_shared_by,
              closed_at: new Date(form.closed_at).toISOString(),
              close_out_report: form.close_out_report,
            });
          })()
        : violation
          ? await confirmDriver(detail.record_type as "dashcam" | "speed", detail.id, {
              itqan_proof: form.itqan_proof,
              uploaded_by: actorName,
            })
          : await closeOutAiCamera(detail.id, {
              hseo_name_badge: form.hseo_name_badge,
              close_out_action: form.close_out_action,
              close_out_picture: form.close_out_picture,
            });
      onDone(asCaseDetail(updated));
      notifyCasesChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="review-closeout">
      <h4>Close-out</h4>
      <p className="muted">
        {sos
          ? "Alarm type and all four close-out fields are required. Submitting close-out sets this SOS alert to Closed."
          : violation
            ? "Confirm Driver and the ITQAN proof are required. This prototype does not call ITQAN."
            : "HSEO name, action taken, and a close-out picture are required."}
      </p>
      {sos ? (
        <>
          <div className="fld">
            <span className="field-label lbl">Alarm *</span>
            <div className="radio">
              <label>
                <input
                  type="radio"
                  name="reviewSosAlarm"
                  checked={form.alarm === "False Alarm"}
                  onChange={() => setForm({ ...form, alarm: "False Alarm" })}
                />{" "}
                False alarm
              </label>
              <label>
                <input
                  type="radio"
                  name="reviewSosAlarm"
                  checked={form.alarm === "True Alarm"}
                  onChange={() => setForm({ ...form, alarm: "True Alarm" })}
                />{" "}
                True alarm
              </label>
            </div>
          </div>
          <label>
            Worker Picture *
            <span className="dropzone">
              <input
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp,image/bmp"
                onChange={(event) =>
                  setWorkerPictureFile(event.target.files?.[0] ?? null)
                }
              />
              <strong>Drop a file here or browse</strong>
              <span>{workerPictureFile?.name || "Image of the worker"}</span>
            </span>
          </label>
          <label>
            Worker Picture Shared By: Name & Badge Number *
            <input
              placeholder="Name / Badge number"
              value={form.picture_shared_by}
              onChange={(event) =>
                setForm({ ...form, picture_shared_by: event.target.value })
              }
            />
          </label>
          <label>
            Closed At *
            <input
              type="datetime-local"
              value={form.closed_at}
              onChange={(event) =>
                setForm({ ...form, closed_at: event.target.value })
              }
            />
          </label>
          <label>
            Close-out Report *
            <textarea
              rows={4}
              placeholder="Report text"
              value={form.close_out_report}
              onChange={(event) =>
                setForm({ ...form, close_out_report: event.target.value })
              }
            />
          </label>
        </>
      ) : violation ? (
        <>
          <label>
            ITQAN Upload Proof (image) *
            <span className="dropzone">
              <input
                type="file"
                accept="image/*"
                onChange={(event) =>
                  setForm({
                    ...form,
                    itqan_proof: event.target.files?.[0]?.name ?? "",
                  })
                }
              />
              <strong>Drop a file here or browse</strong>
              <span>
                {form.itqan_proof ||
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
              placeholder="Filled automatically when the step is submitted"
            />
            <span className="field-note">
              After the step it reads: {ITQAN_ACTION}
            </span>
          </label>
        </>
      ) : (
        <>
          <label>
            Safety Officer (HSEO) in the Area: Name & Badge Number *
            <input
              placeholder="[Name] / [Badge number]"
              value={form.hseo_name_badge}
              onChange={(event) =>
                setForm({ ...form, hseo_name_badge: event.target.value })
              }
            />
          </label>
          <label>
            Close-out Action *
            <textarea
              rows={3}
              placeholder="[Action taken]"
              value={form.close_out_action}
              onChange={(event) =>
                setForm({ ...form, close_out_action: event.target.value })
              }
            />
          </label>
          <label>
            Close-out Picture *
            <span className="dropzone">
              <input
                type="file"
                accept="image/*"
                onChange={(event) =>
                  setForm({
                    ...form,
                    close_out_picture: event.target.files?.[0]?.name ?? "",
                  })
                }
              />
              <strong>Drop a file here or browse</strong>
              <span>
                {form.close_out_picture || "Image of the corrective action"}
              </span>
            </span>
          </label>
        </>
      )}
      {error ? <p className="state error">{error}</p> : null}
      <p className={remaining > 0 ? "muted" : "foot-status is-ok"}>
        {remaining > 0
          ? `${remaining} close-out field${remaining === 1 ? " is" : "s are"} still empty`
          : "Ready to submit close-out."}
      </p>
      <div className="review-actions">
        {user?.capabilities.delete_record ? (
          <button
            className="btn danger ghost"
            type="button"
            disabled={saving}
            onClick={() => {
              if (!window.confirm("Delete this record? It is removed from all screens.")) return;
              setSaving(true);
              deleteCase(detail.id)
                .then(onDeleted)
                .catch((err) => setError(errorMessage(err)))
                .finally(() => setSaving(false));
            }}
          >
            Delete record
          </button>
        ) : (
          <span />
        )}
        <div className="review-actions-end">
          <button
            className="btn closeout"
            type="button"
            disabled={saving}
            onClick={() => void submit()}
          >
            {saving ? "Saving…" : "Close-out"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ReviewScreen({ caseId }: { caseId?: string }) {
  const { user } = useAuth();
  const projects = useList("project");
  const departments = useList("department");
  const defaultStatus = user?.role === "admin" ? "under_process" : "open";
  const [status, setStatus] = useState(defaultStatus);
  const [type, setType] = useState("");
  const [scope, setScope] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<CaseSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openRecordId, setOpenRecordId] = useState<string | null>(caseId ?? null);
  const [focusApplied, setFocusApplied] = useState(false);
  const defaultStatusApplied = useRef(false);

  useEffect(() => {
    if (!user || defaultStatusApplied.current || caseId) return;
    defaultStatusApplied.current = true;
    setStatus(user.role === "admin" ? "under_process" : "open");
  }, [user, caseId]);

  const load = useCallback(async () => {
    try {
      const data = await fetchCases();
      setRows(data.items);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setFocusApplied(false);
    if (caseId) setOpenRecordId(caseId);
  }, [caseId]);

  useEffect(() => {
    if (!caseId || focusApplied || rows.length === 0) return;
    const row = rows.find((item) => item.id === caseId);
    if (!row) return;
    setType(row.record_type);
    setStatus(row.status);
    setOpenRecordId(caseId);
    setFocusApplied(true);
  }, [caseId, focusApplied, rows]);

  const filteredBase = rows.filter((row) => {
    if (type && row.record_type !== type) return false;
    if (scope.startsWith("project:")) {
      if (row.project !== scope.slice("project:".length)) return false;
    } else if (scope.startsWith("department:")) {
      if (row.department !== scope.slice("department:".length)) return false;
    }
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const haystack = [
      row.case_id,
      row.title,
      row.project ?? "",
      row.department ?? "",
      TYPE_LABEL[row.record_type] ?? "",
      REVIEW_TYPE[row.record_type] ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });

  const underReviewByType = useMemo(() => {
    const waiting = rows.filter((row) => row.status === "under_process");
    return {
      ai_camera: waiting.filter((row) => row.record_type === "ai_camera").length,
      dashcam: waiting.filter((row) => row.record_type === "dashcam").length,
      speed: waiting.filter((row) => row.record_type === "speed").length,
      overdue: rows.filter((row) => isReviewOverdue(row)).length,
    };
  }, [rows]);

  const visible = status
    ? filteredBase.filter((row) => row.status === status)
    : filteredBase;

  const counts = {
    all: filteredBase.length,
    open: filteredBase.filter((row) => row.status === "open").length,
    under_process: filteredBase.filter((row) => row.status === "under_process").length,
    closed: filteredBase.filter((row) => row.status === "closed").length,
  };

  const pageCount = Math.max(1, Math.ceil(visible.length / REVIEW_PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = visible.slice(
    (safePage - 1) * REVIEW_PAGE_SIZE,
    safePage * REVIEW_PAGE_SIZE,
  );

  useEffect(() => {
    setPage(1);
  }, [status, type, scope, search]);

  const openRecordType = rows.find((row) => row.id === openRecordId)?.record_type ?? null;

  const closeRecord = () => {
    setOpenRecordId(null);
    if (caseId) window.location.hash = href({ name: "review" });
  };

  const onRecordChanged = () => {
    void load();
    notifyCasesChanged();
  };

  const applyKpi = (nextType: string) => {
    setType(nextType);
    setStatus("under_process");
  };

  return (
    <section className="page v1-dash review-page">
      <section className="v1-banner">
        <div className="v1-banner-icon">
          <ReviewCheckIcon />
        </div>
        <div className="v1-banner-copy">
          <h1>REVIEW &amp; RECORDS</h1>
          <p>
            All records by status <i>•</i> Admin reviews close-outs <i>•</i> Closing
            and deleting is logged with the Admin&apos;s name
          </p>
        </div>
      </section>

      <div className="v1-grid g4">
        <button
          type="button"
          className={`v1-kpi click${type === "ai_camera" && status === "under_process" ? " sel" : ""}`}
          onClick={() => applyKpi("ai_camera")}
        >
          <div className="t">
            <span className="ic">
              <ReviewKpiIcon name="camera" />
            </span>
            AI Camera Observations
          </div>
          <div className="v">{underReviewByType.ai_camera}</div>
          <div className="s">waiting for Admin review</div>
        </button>
        <button
          type="button"
          className={`v1-kpi click${type === "dashcam" && status === "under_process" ? " sel" : ""}`}
          onClick={() => applyKpi("dashcam")}
        >
          <div className="t">
            <span className="ic">
              <ReviewKpiIcon name="car" />
            </span>
            Dashcam Observations
          </div>
          <div className="v">{underReviewByType.dashcam}</div>
          <div className="s">waiting for Admin review</div>
        </button>
        <button
          type="button"
          className={`v1-kpi click${type === "speed" && status === "under_process" ? " sel" : ""}`}
          onClick={() => applyKpi("speed")}
        >
          <div className="t">
            <span className="ic">
              <ReviewKpiIcon name="speed" />
            </span>
            Speed Violations
          </div>
          <div className="v">{underReviewByType.speed}</div>
          <div className="s">waiting for Admin review</div>
        </button>
        <button
          type="button"
          className="v1-kpi click"
          onClick={() => openNotificationsPanel("over")}
        >
          <div className="t">
            <span className="ic" style={{ color: "var(--red)" }}>
              <ReviewKpiIcon name="warn" />
            </span>
            Overdue
          </div>
          <div className="v">{underReviewByType.overdue}</div>
          <div className="s">past the risk-level deadline</div>
        </button>
      </div>

      <div className="review-toolbar">
        <div className="review-tabs" role="tablist" aria-label="Record status">
          {(
            [
              ["", "All", counts.all],
              ["open", "Open", counts.open],
              ["under_process", "Under Review", counts.under_process],
              ["closed", "Closed", counts.closed],
            ] as const
          ).map(([value, label, count]) => (
            <button
              key={value || "all"}
              type="button"
              role="tab"
              className={status === value ? "review-tab is-active" : "review-tab"}
              aria-selected={status === value}
              onClick={() => setStatus(value)}
            >
              {label} <em>{count}</em>
            </button>
          ))}
        </div>
        <div className="review-filters">
          <select
            className="sel"
            value={type}
            aria-label="Record type"
            onChange={(event) => setType(event.target.value)}
          >
            <option value="">All types</option>
            <option value="ai_camera">AI Camera Observation</option>
            <option value="dashcam">DashCam Observation</option>
            <option value="speed">Speed Violation</option>
            <option value="sos">SOS Alert</option>
            <option value="itqan">ITQAN Violation</option>
          </select>
          <select
            className="sel"
            value={scope}
            aria-label="Project or department"
            onChange={(event) => setScope(event.target.value)}
          >
            <option value="">All projects &amp; departments</option>
            {projects.items.map((item) => (
              <option key={`p-${item.id}`} value={`project:${item.label}`}>
                {item.label}
              </option>
            ))}
            {departments.items.map((item) => (
              <option key={`d-${item.id}`} value={`department:${item.label}`}>
                Dept: {item.label}
              </option>
            ))}
          </select>
          <input
            className="inp"
            value={search}
            placeholder="Case ID or name"
            aria-label="Search case ID or name"
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>

      {error ? <p className="state error">{error}</p> : null}
      <article className="v1-card table-panel review-table-card">
        {visible.length === 0 ? (
          <p className="state">No records to review.</p>
        ) : (
          <>
            <div className="table-wrap">
              <table className="tbl review-tbl">
                <thead>
                  <tr>
                    <th>Case ID</th>
                    <th>Type</th>
                    <th>Project / Department</th>
                    <th>Date</th>
                    <th>Risk</th>
                    <th>Status</th>
                    <th>Handled by</th>
                    <th>SLA</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row) => {
                    const sla = reviewSla(row);
                    const overdue = Boolean(sla && sla.kind === "over");
                    return (
                      <tr
                        key={row.id}
                        className={`clk${overdue ? " overdue" : ""}${row.id === openRecordId ? " is-selected" : ""}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => setOpenRecordId(row.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setOpenRecordId(row.id);
                          }
                        }}
                      >
                        <td>
                          <span className="id">{row.case_id}</span>
                        </td>
                        <td>{REVIEW_TYPE[row.record_type] ?? TYPE_LABEL[row.record_type]}</td>
                        <td>{reviewScope(row)}</td>
                        <td className="nw">{formatReviewDate(row.date)}</td>
                        <td>
                          <RiskPill risk={row.risk_level} recordType={row.record_type} />
                        </td>
                        <td>
                          <StatusPill status={row.status} />
                        </td>
                        <td className="muted">{handledBy(row)}</td>
                        <td>
                          {sla ? (
                            <span
                              className={`review-sla${sla.kind === "over" || (sla.kind === "left" && sla.urgent) ? " is-urgent" : ""}`}
                            >
                              {sla.label}
                            </span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="review-pager">
              <span className="muted">
                {visible.length} record{visible.length === 1 ? "" : "s"} · page {safePage} of{" "}
                {pageCount}
              </span>
              <div className="review-pager-btns">
                <button
                  type="button"
                  className="btn sm"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="btn sm primary"
                  disabled={safePage >= pageCount}
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </article>

      <AiCameraRecordDrawer
        caseId={openRecordType === "ai_camera" ? openRecordId : null}
        onClose={closeRecord}
        onChanged={onRecordChanged}
      />
      <DashcamRecordDrawer
        caseId={openRecordType === "dashcam" ? openRecordId : null}
        onClose={closeRecord}
        onChanged={onRecordChanged}
      />
      <SpeedRecordDrawer
        caseId={openRecordType === "speed" ? openRecordId : null}
        onClose={closeRecord}
        onChanged={onRecordChanged}
      />
      <SosRecordDrawer
        caseId={openRecordType === "sos" ? openRecordId : null}
        onClose={closeRecord}
        onChanged={onRecordChanged}
      />
      <ItqanRecordDrawer
        caseId={openRecordType === "itqan" ? openRecordId : null}
        onClose={closeRecord}
        onChanged={onRecordChanged}
      />
    </section>
  );
}

function ReportActionIcon({ name }: { name: "check" | "download" }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    width: 16,
    height: 16,
  };
  if (name === "check") {
    return (
      <svg {...common}>
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}


type ContactDraft = {
  category: string;
  name: string;
  job_title: string;
  role: string;
  contact_number: string;
  email: string;
};

const EMPTY_CONTACT_DRAFT: ContactDraft = {
  category: "key_project_personnel",
  name: "",
  job_title: "",
  role: "",
  contact_number: "",
  email: "",
};

function PermissionMark({ allowed }: { allowed: boolean }) {
  return (
    <span
      className={
        allowed ? "perm-mark is-yes" : "perm-mark is-no"
      }
      title={allowed ? "Yes" : "No"}
      aria-label={allowed ? "Yes" : "No"}
    >
      {allowed ? (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="m6.5 12.2 3.2 3.2 7.8-7.8"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M7 7l10 10M17 7 7 17"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        </svg>
      )}
    </span>
  );
}

function ContactIcon({ name }: { name: "edit" | "delete" | "save" | "cancel" | "close" | "search" }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (name === "edit") {
    return (
      <svg {...common}>
        <path d="M12.5 5.5 18.5 11.5" />
        <path d="M4 20 5.2 14.8 15.5 4.5a2.1 2.1 0 0 1 3 3L8.2 17.8 4 20z" />
      </svg>
    );
  }
  if (name === "delete") {
    return (
      <svg {...common}>
        <path d="M4.5 7h15" />
        <path d="M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7" />
        <path d="M7.5 7l.7 12a1.5 1.5 0 0 0 1.5 1.4h4.6a1.5 1.5 0 0 0 1.5-1.4l.7-12" />
      </svg>
    );
  }
  if (name === "save") {
    return (
      <svg {...common}>
        <path d="m6.5 12.2 3.2 3.2 7.8-7.8" />
      </svg>
    );
  }
  if (name === "cancel" || name === "close") {
    return (
      <svg {...common}>
        <path d="M7 7l10 10M17 7 7 17" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 3.5 3.5" />
    </svg>
  );
}

export function ContactsScreen() {
  const { user } = useAuth();
  const canWrite = Boolean(user?.capabilities.manage_contacts);
  const projects = useList("project");
  const [items, setItems] = useState<ContactRow[]>([]);
  const [projectId, setProjectId] = useState("");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ContactDraft>(EMPTY_CONTACT_DRAFT);
  const [form, setForm] = useState({
    project_id: "",
    ...EMPTY_CONTACT_DRAFT,
  });

  useEffect(() => {
    if (!projectId && projects.items.length) {
      const first = projects.items[0];
      setProjectId(first.id);
      setForm((prev) => ({ ...prev, project_id: first.id }));
    }
  }, [projectId, projects.items]);

  const load = useCallback(async () => {
    if (!projectId) {
      setItems([]);
      return;
    }
    try {
      const data = await fetchContacts(projectId);
      setItems(data.items);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeProject = projects.items.find((item) => item.id === projectId);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((row) => {
      if (category && row.category !== category) return false;
      if (q && !(row.name || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [category, items, search]);

  function openAddForm() {
    setShowAdd(true);
    setForm({
      project_id: projectId,
      ...EMPTY_CONTACT_DRAFT,
    });
    setError(null);
  }

  function closeAddForm() {
    setShowAdd(false);
    setError(null);
  }

  function startEdit(row: ContactRow) {
    setEditingId(row.id);
    setDraft({
      category: row.category,
      name: row.name,
      job_title: row.job_title || "",
      role: row.role || "",
      contact_number: row.contact_number || "",
      email: row.email || "",
    });
    setError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(EMPTY_CONTACT_DRAFT);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canWrite || saving) return;
    setSaving(true);
    setError(null);
    try {
      await createContact({
        project_id: form.project_id || projectId,
        category: form.category,
        name: form.name.trim(),
        job_title: form.job_title.trim() || undefined,
        role: form.role.trim() || undefined,
        contact_number: form.contact_number.trim() || undefined,
        email: form.email.trim() || undefined,
      });
      setShowAdd(false);
      setForm({ project_id: projectId, ...EMPTY_CONTACT_DRAFT });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function onSaveEdit(id: string) {
    if (!canWrite || saving) return;
    setSaving(true);
    setError(null);
    try {
      await updateContact(id, {
        category: draft.category,
        name: draft.name.trim(),
        job_title: draft.job_title.trim() || null,
        role: draft.role.trim() || null,
        contact_number: draft.contact_number.trim() || null,
        email: draft.email.trim() || null,
      });
      setEditingId(null);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(row: ContactRow) {
    if (!canWrite || saving) return;
    if (!window.confirm(`Delete contact “${row.name}”?`)) return;
    setSaving(true);
    setError(null);
    try {
      await deleteContact(row.id);
      if (editingId === row.id) cancelEdit();
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="page contacts-page">
      <div className="contacts-toolbar">
        <label className="contacts-search">
          <span className="contacts-search-icon">
            <ContactIcon name="search" />
          </span>
          <input
            value={search}
            placeholder="Search by name"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        {canWrite ? (
          <button className="btn contacts-add-btn" type="button" onClick={openAddForm}>
            + Add contact
          </button>
        ) : null}
      </div>

      <div className="contacts-project-tabs">
        {projects.items.map((item) => (
          <button
            key={item.id}
            type="button"
            className={projectId === item.id ? "contacts-project-tab is-active" : "contacts-project-tab"}
            onClick={() => {
              setProjectId(item.id);
              setCategory("");
              cancelEdit();
              setShowAdd(false);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="chips contacts-category-chips">
        <button
          type="button"
          className={!category ? "chip is-active" : "chip"}
          onClick={() => setCategory("")}
        >
          All
        </button>
        {CONTACT_CATEGORIES.map((key) => (
          <button
            key={key}
            type="button"
            className={category === key ? "chip is-active" : "chip"}
            onClick={() => setCategory(key)}
          >
            {CONTACT_LABEL[key]}
          </button>
        ))}
      </div>

      {canWrite && showAdd ? (
        <article className="panel contacts-add-panel">
          <div className="contacts-add-head">
            <div>
              <h3>Add contact</h3>
              <p className="muted">
                New contact for {activeProject?.label ?? "this project"}.
              </p>
            </div>
            <button
              className="contacts-icon-btn"
              type="button"
              aria-label="Close add contact form"
              onClick={closeAddForm}
            >
              <ContactIcon name="close" />
            </button>
          </div>
          <form className="form" onSubmit={(event) => void onSubmit(event)}>
            <div className="form-row">
              <label>
                Category *
                <select
                  value={form.category}
                  onChange={(event) => setForm({ ...form, category: event.target.value })}
                >
                  {CONTACT_CATEGORIES.map((key) => (
                    <option key={key} value={key}>
                      {CONTACT_LABEL[key]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Name *
                <input
                  required
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </label>
            </div>
            <div className="form-row">
              <label>
                Job title
                <input
                  value={form.job_title}
                  onChange={(event) => setForm({ ...form, job_title: event.target.value })}
                />
              </label>
              <label>
                Role
                <input
                  value={form.role}
                  onChange={(event) => setForm({ ...form, role: event.target.value })}
                />
              </label>
            </div>
            <div className="form-row">
              <label>
                Contact number
                <input
                  value={form.contact_number}
                  onChange={(event) =>
                    setForm({ ...form, contact_number: event.target.value })
                  }
                />
              </label>
              <label>
                Email
                <input
                  value={form.email}
                  onChange={(event) => setForm({ ...form, email: event.target.value })}
                />
              </label>
            </div>
            {error ? <p className="state error">{error}</p> : null}
            <div className="contacts-add-actions">
              <button className="btn ghost" type="button" onClick={closeAddForm}>
                Cancel
              </button>
              <button className="btn primary" disabled={saving}>
                {saving ? "Saving…" : "Save contact"}
              </button>
            </div>
          </form>
        </article>
      ) : null}

      <article className="panel table-panel contacts-table-panel">
        <div className="panel-head">
          <div>
            <h3>{activeProject?.label ?? "Project"} contacts</h3>
            <p className="muted">
              {canWrite
                ? "Admin can add, update and remove contacts. All users can view them."
                : "View-only contact list for this project."}
            </p>
          </div>
        </div>
        {error && !showAdd ? <p className="state error">{error}</p> : null}
        <div className="table-wrap">
          <table className="contacts-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Name</th>
                <th>Job title</th>
                <th>Role</th>
                <th>Contact number</th>
                <th>Email address</th>
                {canWrite ? <th className="contacts-actions-col" /> : null}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const editing = canWrite && editingId === row.id;
                return (
                  <tr key={row.id} className={editing ? "is-editing" : undefined}>
                    <td>
                      {editing ? (
                        <select
                          value={draft.category}
                          onChange={(event) =>
                            setDraft({ ...draft, category: event.target.value })
                          }
                        >
                          {CONTACT_CATEGORIES.map((key) => (
                            <option key={key} value={key}>
                              {CONTACT_LABEL[key]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        CONTACT_LABEL[row.category] ?? row.category
                      )}
                    </td>
                    <td>
                      {editing ? (
                        <input
                          value={draft.name}
                          onChange={(event) =>
                            setDraft({ ...draft, name: event.target.value })
                          }
                        />
                      ) : (
                        row.name
                      )}
                    </td>
                    <td>
                      {editing ? (
                        <input
                          value={draft.job_title}
                          onChange={(event) =>
                            setDraft({ ...draft, job_title: event.target.value })
                          }
                        />
                      ) : (
                        row.job_title || "—"
                      )}
                    </td>
                    <td>
                      {editing ? (
                        <input
                          value={draft.role}
                          onChange={(event) =>
                            setDraft({ ...draft, role: event.target.value })
                          }
                        />
                      ) : (
                        row.role || "—"
                      )}
                    </td>
                    <td>
                      {editing ? (
                        <input
                          value={draft.contact_number}
                          onChange={(event) =>
                            setDraft({ ...draft, contact_number: event.target.value })
                          }
                        />
                      ) : (
                        row.contact_number || "—"
                      )}
                    </td>
                    <td>
                      {editing ? (
                        <input
                          value={draft.email}
                          onChange={(event) =>
                            setDraft({ ...draft, email: event.target.value })
                          }
                        />
                      ) : (
                        row.email || "—"
                      )}
                    </td>
                    {canWrite ? (
                      <td className="contacts-actions-col">
                        <div className="contacts-row-actions">
                          {editing ? (
                            <>
                              <button
                                className="contacts-icon-btn is-save"
                                type="button"
                                aria-label={`Save ${row.name}`}
                                disabled={saving || !draft.name.trim()}
                                onClick={() => void onSaveEdit(row.id)}
                              >
                                <ContactIcon name="save" />
                              </button>
                              <button
                                className="contacts-icon-btn"
                                type="button"
                                aria-label="Cancel edit"
                                disabled={saving}
                                onClick={cancelEdit}
                              >
                                <ContactIcon name="cancel" />
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                className="contacts-icon-btn"
                                type="button"
                                aria-label={`Edit ${row.name}`}
                                disabled={saving}
                                onClick={() => startEdit(row)}
                              >
                                <ContactIcon name="edit" />
                              </button>
                              <button
                                className="contacts-icon-btn is-danger"
                                type="button"
                                aria-label={`Delete ${row.name}`}
                                disabled={saving}
                                onClick={() => void onDelete(row)}
                              >
                                <ContactIcon name="delete" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {visible.length === 0 ? (
          <p className="state">No contacts in this filter.</p>
        ) : null}
      </article>
    </section>
  );
}

type AdminUserRow = {
  id: string;
  username: string;
  display_name: string;
  badge_number: string | null;
  role: string;
};

type UserDraft = {
  username: string;
  display_name: string;
  badge_number: string;
  role: string;
  password: string;
};

/** Legacy admin UI retained for reference; App uses screens/AdminScreen.tsx */
function LegacyAdminScreen() {
  const { user: currentUser } = useAuth();
  const [types, setTypes] = useState<string[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [active, setActive] = useState("");
  const [items, setItems] = useState<ListItem[]>([]);
  const [listNote, setListNote] = useState<string | undefined>();
  const [label, setLabel] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [matrix, setMatrix] = useState<
    Array<{
      capability: string;
      operator: boolean;
      admin: boolean;
      dept_hse?: boolean;
      receiver?: boolean;
    }>
  >([]);
  const [settingsDraft, setSettingsDraft] = useState<Record<string, unknown> | null>(null);
  const [newUser, setNewUser] = useState({
    username: "",
    password: "",
    display_name: "",
    badge_number: "",
    role: "operator",
  });
  const [showAddUser, setShowAddUser] = useState(false);
  const [addingUser, setAddingUser] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [userDraft, setUserDraft] = useState<UserDraft>({
    username: "",
    display_name: "",
    badge_number: "",
    role: "operator",
    password: "",
  });
  const [savingUser, setSavingUser] = useState(false);
  const [showPermissions, setShowPermissions] = useState(false);
  const [adminTab, setAdminTab] = useState<"lists" | "users" | "audit" | "settings">(
    "lists",
  );
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [auditItems, setAuditItems] = useState<AuditLogItem[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditCategory, setAuditCategory] = useState("");
  const listsPanelRef = useRef<HTMLElement | null>(null);

  const emptyNewUser = {
    username: "",
    password: "",
    display_name: "",
    badge_number: "",
    role: "operator",
  };

  const loadItems = useCallback(async (type: string) => {
    const data = await fetchList(type, { includeInactive: true });
    setItems(data.items);
    setListNote(data.notes);
  }, []);

  useEffect(() => {
    void fetchCatalog().then((data) => {
      setTypes(data.types);
      setNotes(data.notes);
    });
    void fetchUsers().then((data) => setUsers(data.items)).catch((err) => setError(errorMessage(err)));
    void fetchPermissionMatrix().then((data) => setMatrix(data.items)).catch(() => undefined);
  }, []);

  useEffect(() => {
    setEditingId(null);
    setEditLabel("");
    setEditActive(true);
    setLabel("");
    if (!active) {
      setItems([]);
      setListNote(undefined);
      return;
    }
    void loadItems(active).catch((err) => setError(errorMessage(err)));
  }, [active, loadItems]);

  function closeListDetail() {
    setActive("");
    setEditingId(null);
    setEditLabel("");
    setEditActive(true);
    setLabel("");
    setItems([]);
    setListNote(undefined);
  }

  async function onAdd(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await addListItem(active, label);
      setLabel("");
      notifyListsChanged();
      await loadItems(active);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function onSaveItem(itemId: string) {
    setError(null);
    try {
      await updateListItem(active, itemId, {
        label: editLabel,
        is_active: editActive,
      });
      setEditingId(null);
      setEditLabel("");
      setEditActive(true);
      notifyListsChanged();
      await loadItems(active);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function onDeleteItem(item: ListItem) {
    if (!window.confirm(`Delete “${item.label}” from this list? Dropdowns will no longer show it.`)) {
      return;
    }
    setError(null);
    try {
      await deleteListItem(active, item.id);
      if (editingId === item.id) {
        setEditingId(null);
        setEditLabel("");
      }
      notifyListsChanged();
      await loadItems(active);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function openAddUserForm() {
    setShowAddUser(true);
    setNewUser(emptyNewUser);
    cancelUserEdit();
    setError(null);
  }

  function closeAddUserForm() {
    setShowAddUser(false);
    setNewUser(emptyNewUser);
    setError(null);
  }

  function startUserEdit(row: AdminUserRow) {
    if (row.role === "admin" && currentUser?.id !== row.id) {
      setError("Other admin accounts cannot be edited.");
      return;
    }
    setShowAddUser(false);
    setEditingUserId(row.id);
    setUserDraft({
      username: row.username,
      display_name: row.display_name,
      badge_number: row.badge_number || "",
      role: row.role,
      password: "",
    });
    setError(null);
  }

  function cancelUserEdit() {
    setEditingUserId(null);
    setUserDraft({
      username: "",
      display_name: "",
      badge_number: "",
      role: "operator",
      password: "",
    });
  }

  async function onAddUser(event: FormEvent) {
    event.preventDefault();
    if (addingUser) return;
    setAddingUser(true);
    setError(null);
    try {
      await createUser(newUser);
      setNewUser(emptyNewUser);
      setShowAddUser(false);
      setUsers((await fetchUsers()).items);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAddingUser(false);
    }
  }

  async function onSaveUser(id: string, row: AdminUserRow) {
    if (savingUser) return;
    setSavingUser(true);
    setError(null);
    try {
      const isAdminRow = row.role === "admin";
      const isSelf = currentUser?.id === row.id;
      const password = userDraft.password.trim();
      const canEditAdminCredentials = !isAdminRow || isSelf;
      await updateUser(id, {
        username: canEditAdminCredentials
          ? userDraft.username.trim()
          : row.username,
        display_name: userDraft.display_name.trim(),
        badge_number: userDraft.badge_number.trim(),
        role: isAdminRow ? "admin" : userDraft.role,
        password: canEditAdminCredentials ? password || null : null,
      });
      cancelUserEdit();
      setUsers((await fetchUsers()).items);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSavingUser(false);
    }
  }

  async function onDeleteUser(row: AdminUserRow) {
    if (savingUser) return;
    if (currentUser?.id === row.id) {
      setError("You cannot delete the account you are signed in with.");
      return;
    }
    if (
      !window.confirm(
        `Delete user “${row.display_name}”? They will no longer be able to sign in. Past records keep their name.`,
      )
    ) {
      return;
    }
    setSavingUser(true);
    setError(null);
    try {
      await deleteUser(row.id);
      if (editingUserId === row.id) cancelUserEdit();
      setUsers((await fetchUsers()).items);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSavingUser(false);
    }
  }

  const loadAuditLog = useCallback(async () => {
    setAuditLoading(true);
    try {
      const data = await fetchAuditLog();
      setAuditItems(data.items);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAuditLoading(false);
    }
  }, []);

  function switchAdminTab(tab: "lists" | "users" | "audit" | "settings") {
    setAdminTab(tab);
    setError(null);
    if (tab === "lists") {
      closeAddUserForm();
      cancelUserEdit();
      setShowPermissions(false);
    } else if (tab === "users") {
      closeListDetail();
    } else if (tab === "settings") {
      closeAddUserForm();
      cancelUserEdit();
      setShowPermissions(false);
      closeListDetail();
      fetchPlatformSettings()
        .then(setSettingsDraft)
        .catch((err) => setError(errorMessage(err)));
    } else {
      closeAddUserForm();
      cancelUserEdit();
      setShowPermissions(false);
      closeListDetail();
      void loadAuditLog();
    }
  }

  function auditCategoryLabel(category: string): string {
    if (category === "users") return "Users";
    if (category === "lists") return "Lists";
    if (category === "records") return "Records";
    if (category === "hw") return "SCC HW";
    if (category === "contacts") return "Contacts";
    return category;
  }

  function auditActionLabel(action: string): string {
    const labels: Record<string, string> = {
      user_created: "User created",
      user_updated: "User updated",
      user_deleted: "User deleted",
      list_item_added: "List value added",
      list_item_updated: "List value updated",
      list_item_deleted: "List value deleted",
      case_approved: "Approved",
      case_rejected: "Rejected",
      case_edited: "Record edited",
      case_deleted: "Record deleted",
      hw_updated: "HW counts updated",
      contact_added: "Contact added",
      contact_updated: "Contact updated",
      contact_deleted: "Contact deleted",
    };
    return labels[action] ?? action;
  }

  function formatAuditWhen(iso: string | null): string {
    if (!iso) return "—";
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
    if (!match) return iso;
    const months = [
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
    ];
    return `${Number(match[3])} ${months[Number(match[2]) - 1]} ${match[1]}, ${match[4]}:${match[5]}`;
  }

  const auditCategoryOptions = useMemo(() => {
    const known = [
      { id: "users", label: "Users" },
      { id: "lists", label: "Lists" },
      { id: "records", label: "Records" },
      { id: "hw", label: "SCC HW" },
      { id: "contacts", label: "Contacts" },
    ];
    const seen = new Set(known.map((item) => item.id));
    for (const item of auditItems) {
      if (!seen.has(item.category)) {
        seen.add(item.category);
        known.push({ id: item.category, label: auditCategoryLabel(item.category) });
      }
    }
    return known;
  }, [auditItems]);

  const visibleAuditItems = useMemo(() => {
    if (!auditCategory) return auditItems;
    return auditItems.filter((item) => item.category === auditCategory);
  }, [auditItems, auditCategory]);

  return (
    <section className="page admin-page">
      <div className="admin-section-tabs" role="tablist" aria-label="Administration sections">
        <button
          type="button"
          role="tab"
          aria-selected={adminTab === "lists"}
          className={
            adminTab === "lists"
              ? "admin-section-tab is-active"
              : "admin-section-tab"
          }
          onClick={() => switchAdminTab("lists")}
        >
          Lists
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={adminTab === "users"}
          className={
            adminTab === "users"
              ? "admin-section-tab is-active"
              : "admin-section-tab"
          }
          onClick={() => switchAdminTab("users")}
        >
          Users
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={adminTab === "audit"}
          className={
            adminTab === "audit"
              ? "admin-section-tab is-active"
              : "admin-section-tab"
          }
          onClick={() => switchAdminTab("audit")}
        >
          Audit Log
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={adminTab === "settings"}
          className={
            adminTab === "settings"
              ? "admin-section-tab is-active"
              : "admin-section-tab"
          }
          onClick={() => switchAdminTab("settings")}
        >
          Rules & schedule
        </button>
      </div>

      {adminTab === "lists" ? (
      <div className="split admin-lists-split">
        <article className="panel admin-lists-panel" ref={listsPanelRef}>
          <h3>Lists</h3>
          <ul className="module-list admin-lists-scroll">
            {types.map((type) => (
              <li key={type}>
                <button
                  type="button"
                  className={active === type ? "linkish is-active" : "linkish"}
                  onClick={() => setActive(type)}
                >
                  {LIST_LABEL[type] ?? type}
                </button>
                <strong>{active === type ? items.length : ""}</strong>
              </li>
            ))}
          </ul>
        </article>
        {active ? (
          <article className="panel admin-list-detail">
            <div className="contacts-add-head">
              <div>
                <h3>{LIST_LABEL[active] ?? active}</h3>
                {notes[active] ? <p className="muted">{notes[active]}</p> : null}
                {listNote ? <p className="muted">{listNote}</p> : null}
              </div>
              <button
                className="contacts-icon-btn"
                type="button"
                aria-label="Close list panel"
                onClick={closeListDetail}
              >
                <ContactIcon name="close" />
              </button>
            </div>
            <div className="admin-list-detail-scroll">
            <form className="form" onSubmit={(event) => void onAdd(event)}>
              <label>
                Add value
                <input value={label} onChange={(event) => setLabel(event.target.value)} required />
              </label>
              {error && !showAddUser ? <p className="state error">{error}</p> : null}
              <button className="btn primary">Add</button>
            </form>
            <ul className="module-list admin-list-items">
              {items.map((item) => (
                <li key={item.id}>
                  {editingId === item.id ? (
                    <input
                      value={editLabel}
                      onChange={(event) => setEditLabel(event.target.value)}
                      aria-label={`Edit ${item.label}`}
                    />
                  ) : (
                    <span>{item.label}</span>
                  )}
                  {editingId === item.id ? (
                    <select
                      className="admin-list-status-select"
                      value={editActive ? "active" : "inactive"}
                      aria-label={`Status for ${item.label}`}
                      onChange={(event) =>
                        setEditActive(event.target.value === "active")
                      }
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  ) : (
                    <span
                      className={
                        item.is_active
                          ? "status status-list-active"
                          : "status status-list-inactive"
                      }
                    >
                      {item.is_active ? "Active" : "Inactive"}
                    </span>
                  )}
                  <span className="list-row-actions">
                    {editingId === item.id ? (
                      <>
                        <button
                          className="contacts-icon-btn is-save"
                          type="button"
                          aria-label={`Save ${item.label}`}
                          disabled={!editLabel.trim()}
                          onClick={() => void onSaveItem(item.id)}
                        >
                          <ContactIcon name="save" />
                        </button>
                        <button
                          className="contacts-icon-btn"
                          type="button"
                          aria-label="Cancel edit"
                          onClick={() => {
                            setEditingId(null);
                            setEditLabel("");
                            setEditActive(true);
                          }}
                        >
                          <ContactIcon name="cancel" />
                        </button>
                      </>
                    ) : (
                      <button
                        className="contacts-icon-btn"
                        type="button"
                        aria-label={`Edit ${item.label}`}
                        onClick={() => {
                          setEditingId(item.id);
                          setEditLabel(item.label);
                          setEditActive(item.is_active);
                        }}
                      >
                        <ContactIcon name="edit" />
                      </button>
                    )}
                    <button
                      className="contacts-icon-btn is-danger"
                      type="button"
                      aria-label={`Delete ${item.label}`}
                      onClick={() => void onDeleteItem(item)}
                    >
                      <ContactIcon name="delete" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            </div>
          </article>
        ) : null}
      </div>
      ) : null}

      {adminTab === "users" ? (
      <>
      <div className="contacts-toolbar">
        <button className="btn contacts-add-btn" type="button" onClick={openAddUserForm}>
          + Add user
        </button>
      </div>
      {showAddUser ? (
        <article className="panel contacts-add-panel">
          <div className="contacts-add-head">
            <div>
              <h3>Add user</h3>
              <p className="muted">Create an Admin or Operator account.</p>
            </div>
            <button
              className="contacts-icon-btn"
              type="button"
              aria-label="Close add user form"
              onClick={closeAddUserForm}
            >
              <ContactIcon name="close" />
            </button>
          </div>
          <form className="form" onSubmit={(event) => void onAddUser(event)}>
            <div className="form-row">
              <label>
                Display name
                <input
                  value={newUser.display_name}
                  onChange={(event) =>
                    setNewUser({ ...newUser, display_name: event.target.value })
                  }
                  required
                />
              </label>
              <label>
                Badge number
                <input
                  value={newUser.badge_number}
                  onChange={(event) =>
                    setNewUser({ ...newUser, badge_number: event.target.value })
                  }
                  required
                />
              </label>
            </div>
            <div className="form-row">
              <label>
                Username
                <input
                  value={newUser.username}
                  onChange={(event) =>
                    setNewUser({ ...newUser, username: event.target.value })
                  }
                  required
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={newUser.password}
                  onChange={(event) =>
                    setNewUser({ ...newUser, password: event.target.value })
                  }
                  required
                />
              </label>
            </div>
            <div className="form-row">
              <label>
                Role
                <select
                  value={newUser.role}
                  onChange={(event) => setNewUser({ ...newUser, role: event.target.value })}
                >
                  <option value="operator">Operator</option>
                  <option value="admin">Admin</option>
                  <option value="dept_hse">Dept HSE</option>
                  <option value="receiver">Project PM</option>
                </select>
              </label>
            </div>
            {error ? <p className="state error">{error}</p> : null}
            <div className="contacts-add-actions">
              <button className="btn ghost" type="button" onClick={closeAddUserForm}>
                Cancel
              </button>
              <button className="btn primary" disabled={addingUser}>
                {addingUser ? "Saving…" : "Save user"}
              </button>
            </div>
          </form>
        </article>
      ) : null}
      <article className="panel table-panel">
        <div className="panel-head">
          <div>
            <h3>Users</h3>
            <p className="muted">Accounts that can sign in to the platform.</p>
          </div>
        </div>
        {error && !showAddUser ? <p className="state error">{error}</p> : null}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Badge No</th>
                <th>Username</th>
                <th>Role</th>
                <th className="contacts-actions-col" />
              </tr>
            </thead>
            <tbody>
              {users.map((row) => {
                const editing = editingUserId === row.id;
                const isAdminRow = row.role === "admin";
                const isSelf = currentUser?.id === row.id;
                const canEditUsername = !isAdminRow || isSelf;
                return (
                  <tr key={row.id} className={editing ? "is-editing" : undefined}>
                    <td>
                      {editing ? (
                        <div className="admin-user-name-cell">
                          <input
                            value={userDraft.display_name}
                            onChange={(event) =>
                              setUserDraft({ ...userDraft, display_name: event.target.value })
                            }
                            aria-label="Display name"
                          />
                          {isSelf ? (
                            <span className="status status-list-active">(you)</span>
                          ) : null}
                        </div>
                      ) : (
                        <div className="admin-user-name-cell">
                          <span>{formatUserLabel(row)}</span>
                          {isSelf ? (
                            <span className="status status-list-active">(you)</span>
                          ) : null}
                        </div>
                      )}
                    </td>
                    <td className="mono">
                      {editing ? (
                        <input
                          value={userDraft.badge_number}
                          onChange={(event) =>
                            setUserDraft({ ...userDraft, badge_number: event.target.value })
                          }
                          aria-label="Badge number"
                        />
                      ) : (
                        row.badge_number || "—"
                      )}
                    </td>
                    <td className="mono">
                      {editing && canEditUsername ? (
                        <input
                          value={userDraft.username}
                          onChange={(event) =>
                            setUserDraft({ ...userDraft, username: event.target.value })
                          }
                          aria-label="Username"
                        />
                      ) : (
                        row.username
                      )}
                    </td>
                    <td>
                      {editing && !isAdminRow ? (
                        <div className="admin-user-edit-extra">
                          <select
                            value={userDraft.role}
                            aria-label="Role"
                            onChange={(event) =>
                              setUserDraft({ ...userDraft, role: event.target.value })
                            }
                          >
                            <option value="operator">Operator</option>
                            <option value="admin">Admin</option>
                            <option value="dept_hse">Dept HSE</option>
                            <option value="receiver">Project PM</option>
                          </select>
                          <input
                            type="password"
                            value={userDraft.password}
                            placeholder="New password (optional)"
                            aria-label="New password"
                            onChange={(event) =>
                              setUserDraft({ ...userDraft, password: event.target.value })
                            }
                          />
                        </div>
                      ) : editing && isAdminRow && isSelf ? (
                        <div className="admin-user-edit-extra">
                          <span>Admin</span>
                          <input
                            type="password"
                            value={userDraft.password}
                            placeholder="New password (optional)"
                            aria-label="New password"
                            onChange={(event) =>
                              setUserDraft({ ...userDraft, password: event.target.value })
                            }
                          />
                        </div>
                      ) : row.role === "admin" ? (
                        "Admin"
                      ) : (
                        "Operator"
                      )}
                    </td>
                    <td className="contacts-actions-col">
                      <div className="contacts-row-actions">
                        {editing ? (
                          <>
                            <button
                              className="contacts-icon-btn is-save"
                              type="button"
                              aria-label={`Save ${row.display_name}`}
                              disabled={
                                savingUser ||
                                !userDraft.display_name.trim() ||
                                (canEditUsername && !userDraft.username.trim()) ||
                                !userDraft.badge_number.trim()
                              }
                              onClick={() => void onSaveUser(row.id, row)}
                            >
                              <ContactIcon name="save" />
                            </button>
                            <button
                              className="contacts-icon-btn"
                              type="button"
                              aria-label="Cancel edit"
                              disabled={savingUser}
                              onClick={cancelUserEdit}
                            >
                              <ContactIcon name="cancel" />
                            </button>
                          </>
                        ) : isAdminRow && !isSelf ? null : (
                          <button
                            className="contacts-icon-btn"
                            type="button"
                            aria-label={`Edit ${row.display_name}`}
                            disabled={savingUser}
                            onClick={() => startUserEdit(row)}
                          >
                            <ContactIcon name="edit" />
                          </button>
                        )}
                        <button
                          className="contacts-icon-btn is-danger"
                          type="button"
                          aria-label={`Delete ${row.display_name}`}
                          disabled={savingUser || currentUser?.id === row.id}
                          title={
                            currentUser?.id === row.id
                              ? "You cannot delete your own account"
                              : undefined
                          }
                          onClick={() => void onDeleteUser(row)}
                        >
                          <ContactIcon name="delete" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="admin-users-foot">
          <button
            className="btn ghost"
            type="button"
            onClick={() => setShowPermissions(true)}
          >
            View roles and permissions
          </button>
        </div>
      </article>
      {showPermissions ? (
        <article className="panel table-panel">
          <div className="contacts-add-head">
            <div>
              <h3>Roles and permissions</h3>
              <p className="muted">
                Closing and deleting are logged with the Admin&apos;s name
              </p>
            </div>
            <button
              className="contacts-icon-btn"
              type="button"
              aria-label="Close roles and permissions"
              onClick={() => setShowPermissions(false)}
            >
              <ContactIcon name="close" />
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Permission</th>
                  <th>Operator</th>
                  <th>Admin</th>
                  <th>Dept HSE</th>
                  <th>Project PM</th>
                </tr>
              </thead>
              <tbody>
                {matrix.map((row) => (
                  <tr key={row.capability}>
                    <td>{row.capability}</td>
                    <td className="perm-cell">
                      <PermissionMark allowed={row.operator} />
                    </td>
                    <td className="perm-cell">
                      <PermissionMark allowed={row.admin} />
                    </td>
                    <td className="perm-cell">
                      <PermissionMark allowed={Boolean(row.dept_hse)} />
                    </td>
                    <td className="perm-cell">
                      <PermissionMark allowed={Boolean(row.receiver)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      ) : null}
      </>
      ) : null}

      {adminTab === "settings" ? (
        <article className="panel">
          <div className="panel-head">
            <div>
              <h3>Overdue rules & report schedule</h3>
              <p className="muted">
                SLA hours by risk, SafeLife/ITQAN defaults, and automatic report
                timing.
              </p>
            </div>
            <button
              className="btn primary"
              type="button"
              disabled={settingsSaving || !settingsDraft}
              onClick={() => {
                if (!settingsDraft) return;
                setSettingsSaving(true);
                savePlatformSettings(settingsDraft)
                  .then(setSettingsDraft)
                  .catch((err) => setError(errorMessage(err)))
                  .finally(() => setSettingsSaving(false));
              }}
            >
              {settingsSaving ? "Saving…" : "Save settings"}
            </button>
          </div>
          {!settingsDraft ? (
            <p className="state">Loading settings…</p>
          ) : (
            <div className="form" style={{ maxWidth: 520 }}>
              <label>
                Daily report time
                <input
                  type="time"
                  value={String(settingsDraft.dailyAt ?? "23:59")}
                  onChange={(event) =>
                    setSettingsDraft({ ...settingsDraft, dailyAt: event.target.value })
                  }
                />
              </label>
              <label>
                Weekly compile day
                <select
                  value={String(settingsDraft.weeklyDay ?? "Saturday")}
                  onChange={(event) =>
                    setSettingsDraft({ ...settingsDraft, weeklyDay: event.target.value })
                  }
                >
                  {["Saturday", "Sunday", "Thursday"].map((day) => (
                    <option key={day} value={day}>
                      {day}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Monthly issue day
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={Number(settingsDraft.monthlyDay ?? 1)}
                  onChange={(event) =>
                    setSettingsDraft({
                      ...settingsDraft,
                      monthlyDay: Number(event.target.value) || 1,
                    })
                  }
                />
              </label>
              <label className="row">
                <input
                  type="checkbox"
                  checked={Boolean(settingsDraft.safelifeDefault)}
                  onChange={(event) =>
                    setSettingsDraft({
                      ...settingsDraft,
                      safelifeDefault: event.target.checked,
                    })
                  }
                />
                SafeLife update required by default
              </label>
              <label className="row">
                <input
                  type="checkbox"
                  checked={Boolean(settingsDraft.itqanDefault)}
                  onChange={(event) =>
                    setSettingsDraft({
                      ...settingsDraft,
                      itqanDefault: event.target.checked,
                    })
                  }
                />
                ITQAN upload required by default
              </label>
              <p className="muted">
                SLA: High {(settingsDraft.sla as { High?: { hours?: number } })?.High?.hours ?? 24}{" "}
                h · Medium{" "}
                {(settingsDraft.sla as { Medium?: { hours?: number } })?.Medium?.hours ?? 72} h ·
                Low {(settingsDraft.sla as { Low?: { hours?: number } })?.Low?.hours ?? 168} h ·
                Escalation ×
                {(settingsDraft.sla as { escalate?: number })?.escalate ?? 2} to Dept HSE.
              </p>
            </div>
          )}
        </article>
      ) : null}

      {adminTab === "audit" ? (
        <article className="panel table-panel audit-log-panel">
          <div className="panel-head audit-log-head">
            <div>
              <h3>Audit Log</h3>
              <p className="muted">
                Admin actions only: user management, list changes, contacts,
                SCC HW updates, approvals, rejections, record edits, and
                deletions.
              </p>
            </div>
            <div className="audit-log-toolbar">
              <label className="audit-log-filter">
                Category
                <select
                  value={auditCategory}
                  onChange={(event) => setAuditCategory(event.target.value)}
                >
                  <option value="">All categories</option>
                  {auditCategoryOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="btn ghost"
                type="button"
                disabled={auditLoading}
                onClick={() => void loadAuditLog()}
              >
                {auditLoading ? "Refreshing…" : "Refresh"}
              </button>
            </div>
          </div>
          {error ? <p className="state error">{error}</p> : null}
          <div className="audit-log-scroll">
            {auditLoading && !auditItems.length ? (
              <p className="state">Loading audit log…</p>
            ) : null}
            {!auditLoading && !auditItems.length ? (
              <p className="attention-empty">
                No admin actions recorded yet. Approvals, rejections, edits,
                deletions, contacts, SCC HW updates, user changes, and list
                edits will appear here.
              </p>
            ) : null}
            {!auditLoading && auditItems.length && !visibleAuditItems.length ? (
              <p className="attention-empty">
                No {auditCategoryLabel(auditCategory).toLowerCase()} actions in
                the current log.
              </p>
            ) : null}
            {visibleAuditItems.length ? (
              <ul className="audit-log-list">
                {visibleAuditItems.map((item) => (
                  <li key={item.id} className="audit-log-item">
                    <div className="audit-log-meta">
                      <span className={`audit-pill audit-${item.category}`}>
                        {auditCategoryLabel(item.category)}
                      </span>
                      <span className="audit-action">
                        {auditActionLabel(item.action)}
                      </span>
                      <time dateTime={item.occurred_at ?? undefined}>
                        {formatAuditWhen(item.occurred_at)}
                      </time>
                    </div>
                    <p className="audit-summary">{item.summary}</p>
                    <div className="audit-log-foot">
                      <span>By {item.actor_name}</span>
                      {item.case_id ? (
                        typeof item.details.record_id === "string" &&
                        item.action !== "case_deleted" ? (
                          <a
                            className="case-id-link"
                            href={href({
                              name: "detail",
                              id: String(item.details.record_id),
                            })}
                          >
                            {item.case_id}
                          </a>
                        ) : (
                          <span className="mono">{item.case_id}</span>
                        )
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </article>
      ) : null}
    </section>
  );
}
