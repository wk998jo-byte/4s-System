import { useEffect, useMemo, useState } from "react";
import { subscribeLists } from "../api/lists";
import { fetchList, type CaseSummary, type ListItem } from "../api/scc";
import { useAuth } from "../auth/AuthContext";
import { href, type ModuleType } from "../lib/routing";

/** Calendar year for page banner titles — rolls over automatically on 1 Jan. */
export function bannerYear(now: Date = new Date()) {
  return now.getFullYear();
}

export const TYPE_LABEL: Record<string, string> = {
  ai_camera: "AI Camera",
  dashcam: "DashCam",
  speed: "Speed",
  sos: "SOS",
  itqan: "ITQAN",
};

export const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  under_process: "Under Review",
  closed: "Closed",
};

export const CONTACT_LABEL: Record<string, string> = {
  key_project_personnel: "Key project personnel",
  scc_team: "SCC Team",
  safety_team: "Safety Team",
  emergency_contacts: "Emergency contacts",
  ert: "Emergency Response Team (ERT)",
};

export const LIST_LABEL: Record<string, string> = {
  alert_type: "Alert Type",
  project: "Project",
  hw_site: "SCC HW sites",
  department: "Department",
  risk_level: "Risk Level",
  dashcam_observation_type: "DashCam Observation Type",
  ai_camera_category: "AI Camera Category",
  speed_violation_type: "Speed Violation Type",
  detection_method: "Detection Method",
  vehicle_type: "Asset Category",
  model: "Asset Type",
  dashcam_alert_summary: "Dashcam Alert Summary",
  sos_source: "SOS Source",
  itqan_violation_type: "ITQAN Violation Type",
  itqan_status: "ITQAN Status",
  scc_device_type: "SCC Device Type",
};

export function useList(type: string) {
  const [items, setItems] = useState<ListItem[]>([]);
  const [notes, setNotes] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => subscribeLists(() => setRevision((value) => value + 1)), []);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    fetchList(type)
      .then((data) => {
        if (cancelled) return;
        setItems(data.items);
        setNotes(data.notes);
        setLoaded(true);
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setError(err.message);
          setLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [type, revision]);

  return { items, notes, error, loaded };
}

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={`status status-${status}`}>
      <i className="status-dot" aria-hidden />
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function RiskPill({
  risk,
  recordType,
}: {
  risk?: string | null;
  recordType?: string;
}) {
  if (recordType === "sos") {
    return <span className="risk-pill risk-na">Not applicable</span>;
  }
  const label = (risk || "").trim();
  if (!label) return <span className="risk-pill risk-na">—</span>;
  const key = label.toLowerCase();
  const tone = key.includes("high")
    ? "risk-high"
    : key.includes("medium")
      ? "risk-medium"
      : key.includes("low")
        ? "risk-low"
        : "risk-na";
  return <span className={`risk-pill ${tone}`}>{label}</span>;
}

/** Canonical person label: `badge - Name` when a badge exists. */
export function formatUserLabel(
  user:
    | {
        display_name?: string | null;
        badge_number?: string | null;
      }
    | null
    | undefined,
): string {
  const name = user?.display_name?.trim() ?? "";
  const badge = user?.badge_number?.trim() ?? "";
  if (badge && name) return `${badge} - ${name}`;
  return name || badge;
}

/** Display name of the currently signed-in user (empty if not signed in yet). */
export function useSignedInName() {
  const { user } = useAuth();
  return formatUserLabel(user);
}

/** Read-only Reported by / Uploaded by field locked to the signed-in user. */
export function SignedInNameField({
  label,
  note = "Filled automatically from your signed-in account",
}: {
  label: string;
  note?: string;
}) {
  const name = useSignedInName();
  return (
    <label className="fld-ctl">
      <span className="lbl">{label}</span>
      <input className="is-autofilled" value={name} readOnly disabled />
      <span className="field-note">{note}</span>
    </label>
  );
}

const DETAIL_TYPE_LABEL: Record<string, string> = {
  ai_camera: "AI Camera Observation",
  dashcam: "DashCam Observation",
  speed: "Speed Violation",
  sos: "SOS Alert",
  itqan: "ITQAN Violation",
};

function formatCaseDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
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
  return `${Number(match[3])} ${months[Number(match[2]) - 1]} ${match[1]}`;
}

export function CasesTable({
  rows,
  empty,
  hideRisk,
  detailStyle,
}: {
  rows: CaseSummary[];
  empty: string;
  hideRisk?: boolean;
  /** Match Reports design: full type names, Risk Level badges, Case ID links. */
  detailStyle?: boolean;
}) {
  if (!rows.length) return <p className="state">{empty}</p>;
  return (
    <div className="table-wrap">
      <table className={detailStyle ? "reports-details-table" : undefined}>
        <thead>
          <tr>
            <th>Case ID</th>
            <th>Type</th>
            <th>Project / Department</th>
            <th>Date</th>
            {hideRisk ? null : <th>{detailStyle ? "Risk Level" : "Risk"}</th>}
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const openDetail = () => {
              window.location.hash = href({ name: "detail", id: row.id });
            };
            return (
              <tr key={row.id} onClick={openDetail}>
                <td className="mono">
                  {detailStyle ? (
                    <button
                      type="button"
                      className="case-id-link"
                      onClick={(event) => {
                        event.stopPropagation();
                        openDetail();
                      }}
                    >
                      {row.case_id}
                    </button>
                  ) : (
                    row.case_id
                  )}
                </td>
                <td>
                  {detailStyle
                    ? DETAIL_TYPE_LABEL[row.record_type] ?? row.record_type
                    : TYPE_LABEL[row.record_type] ?? row.record_type}
                </td>
                <td>{row.project || row.department || "—"}</td>
                <td>{detailStyle ? formatCaseDate(row.date) : row.date}</td>
                {hideRisk ? null : (
                  <td>
                    {detailStyle ? (
                      <RiskPill risk={row.risk_level} recordType={row.record_type} />
                    ) : row.record_type === "sos" ? (
                      "Not applicable"
                    ) : (
                      row.risk_level || "—"
                    )}
                  </td>
                )}
                <td>
                  <StatusPill status={row.status} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Kpi({
  label,
  value,
  hint,
  tone = "navy",
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "navy" | "amber" | "blue" | "teal";
}) {
  return (
    <article className={`kpi kpi-${tone}`}>
      <p>{label}</p>
      <strong>{value}</strong>
      {hint ? <span>{hint}</span> : <span>From live API store</span>}
    </article>
  );
}

export function SelectList({
  label,
  type,
  value,
  onChange,
  required,
  hint,
  hideNotes,
  allowedLabels,
  disabled,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (id: string) => void;
  required?: boolean;
  hint?: string;
  hideNotes?: boolean;
  /** When set, only these labels appear (used for project-access scoping). */
  allowedLabels?: string[] | null;
  disabled?: boolean;
}) {
  const { items, notes, error, loaded } = useList(type);
  const visible = useMemo(() => {
    if (!allowedLabels) return items;
    const allowed = new Set(allowedLabels);
    return items.filter((item) => allowed.has(item.label));
  }, [items, allowedLabels]);
  return (
    <label className="fld-ctl">
      <span className="lbl">
        {label}
        {required ? <span className="req"> *</span> : null}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        disabled={disabled}
      >
        <option value="">
          {loaded && visible.length === 0 ? "No values supplied yet" : "Select…"}
        </option>
        {visible.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
      {hint ? <span className="field-note">{hint}</span> : null}
      {!hideNotes && notes ? <span className="field-note">{notes}</span> : null}
      {error ? <span className="field-note error">{error}</span> : null}
    </label>
  );
}

export function moduleTitle(type: ModuleType): string {
  const labels: Record<ModuleType, string> = {
    ai_camera: "AI Camera Observations",
    dashcam: "DashCam Observations",
    speed: "Speed Violations",
    sos: "Wearable Devices",
    itqan: "ITQAN Violations",
  };
  return labels[type];
}

export function weekFromIsoDate(iso: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const value = new Date(year, month - 1, day);

  function forDate(current: Date): number {
    const y = current.getFullYear();
    const jan1 = new Date(y, 0, 1);
    const week1Sunday = new Date(y, 0, 1 - jan1.getDay());
    if (current < week1Sunday) {
      return forDate(new Date(y - 1, 11, 31));
    }
    const diff = Math.round((current.getTime() - week1Sunday.getTime()) / 86400000);
    return Math.floor(diff / 7) + 1;
  }

  return forDate(value);
}

export function todayIso(): string {
  const now = new Date();
  const ast = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Riyadh" }));
  const month = String(ast.getMonth() + 1).padStart(2, "0");
  const day = String(ast.getDate()).padStart(2, "0");
  return `${ast.getFullYear()}-${month}-${day}`;
}

export function nowLocal(): string {
  const now = new Date();
  const ast = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Riyadh" }));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${ast.getFullYear()}-${pad(ast.getMonth() + 1)}-${pad(ast.getDate())}T${pad(ast.getHours())}:${pad(ast.getMinutes())}`;
}

/**
 * View seg for dashboards.
 * When `restrictToProject` is true (assigned operators), only By Project is clickable.
 * Admins / all-project users keep Over All and By Department enabled.
 */
export function ProjectOnlyViewSeg<T extends string>({
  view,
  setView,
  options,
  restrictToProject = false,
}: {
  view: T;
  setView: (next: T) => void;
  options: ReadonlyArray<readonly [T, string]>;
  /** Lock Over All / By Department for project-scoped users only. */
  restrictToProject?: boolean;
}) {
  return (
    <>
      {options.map(([id, label]) => {
        const locked = restrictToProject && id !== "projects";
        return (
          <button
            key={id}
            type="button"
            className={view === id ? "on" : undefined}
            disabled={locked}
            aria-disabled={locked}
            title={locked ? "Only By Project is available for your access" : undefined}
            onClick={() => {
              if (!locked) setView(id);
            }}
          >
            {label}
          </button>
        );
      })}
    </>
  );
}

export function speedSummaryPreview(
  kindLabel: string,
  vehicleLabel: string,
  permitted: number,
  recorded: number,
): string {
  if (!kindLabel || !vehicleLabel || Number.isNaN(permitted) || Number.isNaN(recorded)) {
    return "";
  }
  const exceedance = recorded - permitted;
  const weight = /light/i.test(vehicleLabel)
    ? "light"
    : /heavy/i.test(vehicleLabel)
      ? "heavy"
      : vehicleLabel.trim().toLowerCase() || "vehicle";
  const place = /row/i.test(kindLabel)
    ? "within the Right of Way (ROW)"
    : "on a public road";
  return (
    `The driver of a ${weight} vehicle exceeded the permitted speed limit ${place}. ` +
    `Permitted speed: ${permitted} km/h. Recorded speed: ${recorded} km/h. ` +
    `Exceedance: ${exceedance} km/h.`
  );
}
