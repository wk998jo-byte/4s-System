import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { ChartTip, tipFromEvent, type ChartTipData } from "./chartTip";
import {
  downloadHwRegisterTemplate,
  fetchHw,
  fetchHwRegister,
  fetchHwTransfers,
  importHwRegister,
  receiveHwTransfer,
  type HwPayload,
  type HwRegisterItem,
} from "../api/scc";
import { useAuth } from "../auth/AuthContext";
import { errorMessage } from "../lib/errors";
import { DashboardScreen } from "./DashboardScreen";
import { formatUserLabel, ProjectOnlyViewSeg } from "./shared";
import { useChartReveal } from "../lib/useChartReveal";
import {
  buildDeviceRegister,
  damagedLostByProject,
  defaultChangeHistory,
  fmtHwDate,
  fmtHwDateTime,
  fmtN,
  healthByType,
  AI_CAMERA_LOCATIONS,
  coerceHwStatusForDevice,
  HW_DEVICE_META,
  HW_PROJECTS,
  HW_STATUS_COLORS,
  hwStatusesForDevice,
  hwTotalDevices,
  installedTrend,
  isAiCameraLocation,
  mergeTransfers,
  projectDeviceMatrix,
  statusByProject,
  type HwDevice,
  type HwDeviceType,
  type HwStatus,
  type HwTransfer,
} from "../lib/hwData";

type TabId = "fleet" | "dash" | "summary" | "register" | "transfers" | "history";
type ViewId = "overall" | "projects" | "departments";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function HwIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="4" width="8" height="16" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <rect x="13" y="4" width="8" height="16" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M6 8h2M6 12h2M16 8h2M16 12h2M16 16h2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function csvCell(value: string | number | null | undefined): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, rows: Array<Array<string | number | null | undefined>>) {
  const lines = rows.map((row) => row.map(csvCell).join(","));
  const blob = new Blob([`\uFEFF${lines.join("\n")}`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function HwExcelBtns({
  onExport,
  onTemplate,
  onImportClick,
  importInputRef,
  onImportFile,
  importing,
}: {
  onExport: () => void;
  onTemplate: () => void;
  onImportClick: () => void;
  importInputRef: { current: HTMLInputElement | null };
  onImportFile: (file: File) => void;
  importing?: boolean;
}) {
  return (
    <div className="hw-toolbar">
      <button type="button" className="btn ghost sm hw-xl-btn" onClick={onTemplate}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M4 14v3.5A1.5 1.5 0 0 0 5.5 19h13a1.5 1.5 0 0 0 1.5-1.5V14M12 4v11M8.5 11.5 12 15l3.5-3.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Template
      </button>
      <button
        type="button"
        className="btn ghost sm hw-xl-btn"
        onClick={onImportClick}
        disabled={importing}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M14 3H7.5A1.5 1.5 0 0 0 6 4.5v15A1.5 1.5 0 0 0 7.5 21h9a1.5 1.5 0 0 0 1.5-1.5V8L14 3Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path d="M14 3v5h5M12 17V11M9.5 13.5 12 11l2.5 2.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {importing ? "Importing…" : "Import Excel"}
      </button>
      <input
        ref={importInputRef}
        type="file"
        accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onImportFile(file);
        }}
      />
      <button type="button" className="btn ghost sm hw-xl-btn" onClick={onExport}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M14 3H7.5A1.5 1.5 0 0 0 6 4.5v15A1.5 1.5 0 0 0 7.5 21h9a1.5 1.5 0 0 0 1.5-1.5V8L14 3Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path d="M14 3v5h5M12 11v6M9.5 14.5 12 17l2.5-2.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Export Excel
      </button>
    </div>
  );
}

function asHwDevices(items: HwRegisterItem[], fallbackNow: Date): HwDevice[] {
  return items.map((item, index) => {
    const meta = HW_DEVICE_META.find((d) => d.device === item.device);
    const device = (item.device as HwDeviceType) || "AI Camera";
    return {
      id: item.id || `DEV-${item.serial || index}`,
      device,
      system: (item.system as HwDevice["system"]) || meta?.system || "4S",
      serial: item.serial,
      status: coerceHwStatusForDevice(device, item.status || "In Stock"),
      project: item.project,
      lastSignal: item.lastSignal ?? null,
      updatedIso: item.updatedIso || fallbackNow.toISOString(),
    };
  });
}

function HwTypeGlyph({ kind }: { kind: string }) {
  const common = {
    width: 28,
    height: 28,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  switch (kind) {
    case "AI Camera":
      return (
        <svg {...common}>
          <path d="M4 8.5h11a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6.5a2 2 0 0 1 2-2Z" />
          <circle cx="9.5" cy="13.5" r="2.4" />
          <path d="M15 11.5l5-2.8v8.6l-5-2.8" />
        </svg>
      );
    case "Edge Server":
    case "NVR":
    case "All":
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="5" rx="1.2" />
          <rect x="4" y="10.5" width="16" height="5" rx="1.2" />
          <rect x="4" y="17" width="16" height="3" rx="1" />
          <path d="M7 6.5h.01M7 13h.01M10 6.5h4M10 13h4" />
        </svg>
      );
    case "Router":
      return (
        <svg {...common}>
          <rect x="3" y="11" width="18" height="7" rx="1.5" />
          <path d="M7 11V7.5M12 11V6M17 11V7.5" />
          <circle cx="7" cy="5.5" r="1.2" />
          <circle cx="12" cy="4.2" r="1.2" />
          <circle cx="17" cy="5.5" r="1.2" />
          <path d="M7 14.5h.01M11 14.5h6" />
        </svg>
      );
    case "Smart Helmet":
      return (
        <svg {...common}>
          <path d="M4 14c0-4.5 3.5-8 8-8s8 3.5 8 8" />
          <path d="M3.5 14.5h17v2.2a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-2.2Z" />
          <path d="M12 6v2.5" />
        </svg>
      );
    case "Smart Watch":
      return (
        <svg {...common}>
          <rect x="7" y="6.5" width="10" height="11" rx="2.2" />
          <path d="M9 6.5V4.8a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1V6.5M9 17.5v1.7a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-1.7" />
          <path d="M12 10v2.2l1.4 1.2" />
        </svg>
      );
    case "Weather Station":
      return (
        <svg {...common}>
          <circle cx="9" cy="9" r="2.4" />
          <path d="M9 4.5v1.2M9 12.3v1.2M4.5 9H5.7M12.3 9h1.2M5.9 5.9l.9.9M11.2 11.2l.9.9M5.9 12.1l.9-.9M11.2 6.8l.9-.9" />
          <path d="M8 15.5h8.5a3 3 0 1 0-.4-6H15" />
        </svg>
      );
    case "GPS":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <circle cx="12" cy="12" r="7" />
          <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2" />
        </svg>
      );
    case "Dashcam":
      return (
        <svg {...common}>
          <rect x="3" y="8" width="14" height="9" rx="1.8" />
          <circle cx="10" cy="12.5" r="2.4" />
          <path d="M17 10.5l4-2v8l-4-2" />
        </svg>
      );
    case "Weight Sensor":
      return (
        <svg {...common}>
          <path d="M7 7h10l2 4H5l2-4Z" />
          <path d="M8 11v7.5h8V11M6.5 18.5h11" />
          <path d="M12 7V4.8" />
        </svg>
      );
    case "PWAS":
      return (
        <svg {...common}>
          <path d="M12 4.2 20.5 19H3.5L12 4.2Z" />
          <path d="M12 10v4.2M12 16.5h.01" />
        </svg>
      );
    default:
      return <HwIcon />;
  }
}


function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    Installed: "green",
    Assigned: "teal",
    "In Stock": "steel",
    "Under Maintenance": "amber",
    Damaged: "red",
    Lost: "ink",
    transit: "amber",
    received: "green",
  };
  const tone =
    map[status] ||
    (status.startsWith("Received") ? "green" : "steel");
  return <span className={`hw-pill ${tone}`}>{status === "transit" ? "In transit" : status}</span>;
}

function Donut({
  parts,
}: {
  parts: Array<{ label: string; value: number; color: string }>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<ChartTipData | null>(null);
  const reveal = useChartReveal(
    hostRef,
    parts.map((p) => `${p.label}:${p.value}`).join("|"),
  );
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  const r = 54;
  const c = 2 * Math.PI * r;
  let offset = 0;

  function showSeg(e: ReactMouseEvent, label: string, color: string, value: number) {
    setTip(
      tipFromEvent(e, hostRef.current, {
        title: label,
        rows: [{ color, text: fmtN(value) }],
      }),
    );
  }

  return (
    <div className="hw-donut v1-chart-host" ref={hostRef} onMouseLeave={() => setTip(null)}>
      <svg viewBox="0 0 140 140" className="hw-donut-svg" aria-hidden>
        <circle cx="70" cy="70" r={r} fill="none" stroke="var(--line)" strokeWidth="16" pointerEvents="none" />
        {parts.map((p) => {
          const len = (p.value / total) * c * reveal;
          const el = (
            <circle
              key={p.label}
              cx="70"
              cy="70"
              r={r}
              fill="none"
              stroke={p.color}
              strokeWidth="16"
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 70 70)"
              style={{ cursor: p.value > 0 ? "pointer" : "default" }}
              onMouseMove={
                p.value > 0 ? (e) => showSeg(e, p.label, p.color, p.value) : undefined
              }
              onMouseLeave={() => setTip(null)}
            />
          );
          offset += (p.value / total) * c * reveal;
          return el;
        })}
        <text x="70" y="66" textAnchor="middle" className="hw-donut-val" pointerEvents="none">
          {fmtN(total)}
        </text>
        <text x="70" y="84" textAnchor="middle" className="hw-donut-sub" pointerEvents="none">
          devices
        </text>
      </svg>
      <div className="hw-donut-legend">
        {parts.map((p) => (
          <div className="hw-donut-row" key={p.label}>
            <i style={{ background: p.color }} />
            <span className="hw-donut-label">{p.label}</span>
            <div className="hw-donut-track">
              <b
                style={{
                  width: `${(p.value / total) * 100 * reveal}%`,
                  background: p.color,
                }}
              />
            </div>
            <strong>{fmtN(p.value)}</strong>
          </div>
        ))}
      </div>
      <ChartTip tip={tip} />
    </div>
  );
}

function StackedProjectBars({
  projects,
  byStatus,
}: {
  projects: string[];
  byStatus: Record<string, Record<HwStatus, number>>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<ChartTipData | null>(null);
  const reveal = useChartReveal(hostRef, projects.join("|"));
  const statuses = Object.keys(HW_STATUS_COLORS) as HwStatus[];
  const max = Math.max(
    1,
    ...projects.map((p) => statuses.reduce((s, st) => s + (byStatus[p]?.[st] || 0), 0)),
  );
  return (
    <div className="hw-stack-list v1-chart-host" ref={hostRef} onMouseLeave={() => setTip(null)}>
      {projects.map((project) => {
        const total = statuses.reduce((s, st) => s + (byStatus[project]?.[st] || 0), 0);
        return (
          <div className="hw-stack-row" key={project}>
            <span className="hw-stack-name">{project}</span>
            <div className="hw-stack-track">
              {statuses.map((st) => {
                const n = byStatus[project]?.[st] || 0;
                if (!n) return null;
                return (
                  <i
                    key={st}
                    style={{
                      width: `${(n / max) * 100 * reveal}%`,
                      background: HW_STATUS_COLORS[st],
                      cursor: "pointer",
                    }}
                    onMouseMove={(e) =>
                      setTip(
                        tipFromEvent(e, hostRef.current, {
                          title: project,
                          rows: [{ color: HW_STATUS_COLORS[st], text: `${st}: ${fmtN(n)}` }],
                          place: "right",
                        }),
                      )
                    }
                    onMouseLeave={() => setTip(null)}
                  />
                );
              })}
            </div>
            <b>{fmtN(total)}</b>
          </div>
        );
      })}
      <div className="hw-legend">
        {statuses.map((st) => (
          <span key={st}>
            <i style={{ background: HW_STATUS_COLORS[st] }} />
            {st}
          </span>
        ))}
      </div>
      <ChartTip tip={tip} />
    </div>
  );
}

function TrendLine({ labels, values }: { labels: string[]; values: number[] }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<ChartTipData | null>(null);
  const reveal = useChartReveal(hostRef, values.join(","));
  const w = 420;
  const h = 180;
  const padL = 36;
  const padR = 10;
  const padT = 12;
  const padB = 28;
  const min = Math.min(...values) - 40;
  const max = Math.max(...values) + 20;
  const span = Math.max(1, max - min);
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const xAt = (i: number) =>
    padL + (labels.length <= 1 ? innerW / 2 : (i / (labels.length - 1)) * innerW);
  const yAt = (v: number) => padT + innerH * (1 - (v - min) / span);
  const visibleCount = Math.max(2, Math.ceil(values.length * Math.max(reveal, 0.001)));
  const shown = values.slice(0, visibleCount);
  const d = shown
    .map((v, i) => `${i === 0 ? "M" : "L"}${xAt(i)},${yAt(v)}`)
    .join(" ");
  const area =
    shown.length > 1
      ? `${d} L${xAt(shown.length - 1)},${padT + innerH} L${xAt(0)},${padT + innerH} Z`
      : "";
  return (
    <div className="v1-chart-host" ref={hostRef} onMouseLeave={() => setTip(null)}>
    <svg viewBox={`0 0 ${w} ${h}`} className="hw-chart" role="img">
      {[0, 0.25, 0.5, 0.75, 1].map((p) => {
        const y = padT + innerH * (1 - p);
        return (
          <g key={p}>
            <line x1={padL} y1={y} x2={w - padR} y2={y} className="hw-grid" />
            <text x={padL - 6} y={y + 3} textAnchor="end" className="hw-tick">
              {Math.round(min + span * p)}
            </text>
          </g>
        );
      })}
      {area ? (
        <path d={area} fill="color-mix(in srgb, var(--red) 12%, transparent)" pointerEvents="none" />
      ) : null}
      <path d={d} fill="none" stroke="var(--red)" strokeWidth="2.2" pointerEvents="none" />
      {shown.map((v, i) => (
        <circle
          key={labels[i]}
          cx={xAt(i)}
          cy={yAt(v)}
          r={5}
          fill="var(--red)"
          style={{ cursor: "pointer" }}
          onMouseMove={(e) =>
            setTip(
              tipFromEvent(e, hostRef.current, {
                title: labels[i] || "",
                rows: [{ color: "var(--red)", text: fmtN(v) }],
                place: "top",
              }),
            )
          }
          onMouseLeave={() => setTip(null)}
        />
      ))}
      {labels.map((label, i) => (
        <text key={label} x={xAt(i)} y={h - 8} textAnchor="middle" className="hw-tick">
          {label}
        </text>
      ))}
    </svg>
    <ChartTip tip={tip} />
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="scrim hw-scrim"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`hw-modal${wide ? " wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="hw-modal-hd">
          <h2>{title}</h2>
          <button type="button" className="iconbtn" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="hw-modal-body">{children}</div>
        <div className="hw-modal-ft">{footer}</div>
      </div>
    </div>
  );
}

export function HwScreen() {
  const { user } = useAuth();
  const canWrite = Boolean(user?.capabilities.manage_hw);
  const canReceive = Boolean(user?.capabilities.receive_hw);
  const now = useMemo(() => new Date(), []);

  const [tab, setTab] = useState<TabId>("fleet");
  const [view, setView] = useState<ViewId>("overall");
  const [period, setPeriod] = useState("ytd");
  const [deviceFilter, setDeviceFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [projectFilter, setProjectFilter] = useState("");
  const [search, setSearch] = useState("");
  const [hw, setHw] = useState<HwPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [register, setRegister] = useState<HwDevice[]>([]);
  const [transfers, setTransfers] = useState<HwTransfer[]>([]);
  const [history] = useState(() => defaultChangeHistory(now));
  const [addOpen, setAddOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [receiveId, setReceiveId] = useState<string | null>(null);
  const [receiveSerials, setReceiveSerials] = useState<string[]>([]);
  const [receiveCondition, setReceiveCondition] = useState("Good");
  const [receiveNotes, setReceiveNotes] = useState("");
  const [receiveAck, setReceiveAck] = useState(false);
  const [statusEditId, setStatusEditId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const [addForm, setAddForm] = useState({
    device: "AI Camera",
    serial: "",
    status: "In Stock" as HwStatus,
    project: "Jafurah",
  });
  const [trForm, setTrForm] = useState({
    kind: "Delivery from warehouse",
    from: "Warehouse",
    to: "Jafurah",
    type: "AI Camera",
    qty: "",
    serials: "",
    reason: "",
    receiver: "",
  });

  const hasAllProjectAccess = useMemo(() => {
    if (user?.role === "admin") return true;
    const scoped = user?.projects;
    return !scoped || scoped.length === 0;
  }, [user?.role, user?.projects]);

  const accessProjects = useMemo(() => {
    if (hasAllProjectAccess) return [...HW_PROJECTS];
    const allowed = new Set((user?.projects || []).map(String));
    const matched = HW_PROJECTS.filter((p) => allowed.has(p));
    return matched.length ? matched : [...HW_PROJECTS];
  }, [hasAllProjectAccess, user?.projects]);

  useEffect(() => {
    if (hasAllProjectAccess) return;
    setView("projects");
    if (accessProjects.length === 1 && projectFilter !== accessProjects[0]) {
      setProjectFilter(accessProjects[0]!);
    } else if (
      projectFilter &&
      accessProjects.length > 1 &&
      !accessProjects.includes(projectFilter)
    ) {
      setProjectFilter("");
    }
  }, [hasAllProjectAccess, accessProjects, projectFilter]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchHw(), fetchHwTransfers(), fetchHwRegister()])
      .then(([hwData, tr, reg]) => {
        if (cancelled) return;
        setHw(hwData);
        setTransfers(mergeTransfers(tr.items || [], now));
        if (reg.items?.length) {
          setRegister(asHwDevices(reg.items, now));
        } else {
          setRegister(buildDeviceRegister(accessProjects, 60, now));
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(errorMessage(err));
          setTransfers(mergeTransfers([], now));
          setRegister(buildDeviceRegister(accessProjects, 60, now));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [accessProjects, now]);

  const addProjectOptions = useMemo(() => {
    if (addForm.device === "AI Camera") {
      return accessProjects.filter((p) => isAiCameraLocation(p));
    }
    return accessProjects;
  }, [accessProjects, addForm.device]);

  const transferToOptions = useMemo(() => {
    if (trForm.type === "AI Camera") {
      return accessProjects.filter((p) => isAiCameraLocation(p));
    }
    return accessProjects;
  }, [accessProjects, trForm.type]);

  useEffect(() => {
    const options =
      addForm.device === "AI Camera"
        ? accessProjects.filter((p) => isAiCameraLocation(p))
        : accessProjects;
    if (!options.includes(addForm.project)) {
      setAddForm((f) => ({ ...f, project: options[0] || "Jafurah" }));
    }
  }, [accessProjects, addForm.device, addForm.project]);

  useEffect(() => {
    if (trForm.type !== "AI Camera") return;
    if (!isAiCameraLocation(trForm.to)) {
      setTrForm((f) => ({
        ...f,
        to: accessProjects.find((p) => isAiCameraLocation(p)) || AI_CAMERA_LOCATIONS[0],
      }));
    }
  }, [trForm.type, trForm.to, accessProjects]);

  const scopedProjects = useMemo(() => {
    if (view === "projects" && projectFilter) {
      return accessProjects.filter((p) => p === projectFilter);
    }
    return accessProjects;
  }, [accessProjects, view, projectFilter]);

  const matrix = useMemo(() => {
    const fromDb = hw?.project_counts || {};
    const out: Record<string, Record<string, number>> = {};
    for (const project of scopedProjects) {
      const site = fromDb[project] || {};
      out[project] = {};
      for (const meta of HW_DEVICE_META) {
        out[project][meta.device] = Number(site[meta.device] || 0);
      }
    }
    // Fallback to V1 seed matrix only when DB has no inventory yet.
    const dbTotal = Object.values(fromDb).reduce(
      (sum, site) => sum + Object.values(site).reduce((a, n) => a + (Number(n) || 0), 0),
      0,
    );
    if (dbTotal > 0) return out;
    return projectDeviceMatrix(scopedProjects);
  }, [hw, scopedProjects]);

  const typeTotals = useMemo(() => {
    const out: Record<string, number> = {};
    for (const meta of HW_DEVICE_META) {
      out[meta.device] = scopedProjects.reduce(
        (s, p) => s + (matrix[p]?.[meta.device] || 0),
        0,
      );
    }
    return out;
  }, [matrix, scopedProjects]);

  const byStatus = useMemo(() => statusByProject(scopedProjects), [scopedProjects]);
  const health = useMemo(() => healthByType(scopedProjects), [scopedProjects]);

  const totals = useMemo(() => {
    const all =
      Object.values(typeTotals).reduce((s, n) => s + n, 0) || hwTotalDevices();
    // Sample totals: Assigned only from wearables (same rule as health-by-type).
    const installed = health.reduce((s, row) => s + row.installed, 0);
    const assigned = health.reduce((s, row) => s + row.assigned, 0);
    const inStock = health.reduce((s, row) => s + row.inStock, 0);
    const maint = health.reduce((s, row) => s + row.maint, 0);
    const damaged = health.reduce((s, row) => s + row.damaged, 0);
    const lost = health.reduce((s, row) => s + row.lost, 0);
    return {
      all,
      installed,
      assigned,
      inStock,
      maint,
      damaged,
      lost,
      out: maint + damaged + lost,
    };
  }, [typeTotals, health]);
  const attention = useMemo(() => damagedLostByProject(scopedProjects), [scopedProjects]);
  const trend = useMemo(() => installedTrend(now), [now]);
  const liveLabel = useMemo(() => {
    const t = hw?.last_updated_at ? new Date(hw.last_updated_at) : now;
    return `Live · updated ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
  }, [hw, now]);

  const rangeLabel = useMemo(() => {
    if (period === "ytd") return `1 Jan to ${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()} (Year to date)`;
    if (period === "month") return `${MONTHS[now.getMonth()]} ${now.getFullYear()} (This month)`;
    return "Selected period";
  }, [period, now]);

  const filteredRegister = useMemo(() => {
    const q = search.trim().toLowerCase();
    return register.filter((row) => {
      if (!scopedProjects.includes(row.project)) return false;
      if (deviceFilter !== "All" && row.device !== deviceFilter) return false;
      if (statusFilter !== "All" && row.status !== statusFilter) return false;
      if (!q) return true;
      return (
        row.serial.toLowerCase().includes(q) ||
        row.device.toLowerCase().includes(q) ||
        row.project.toLowerCase().includes(q)
      );
    });
  }, [register, scopedProjects, deviceFilter, statusFilter, search]);

  const filteredTransfers = useMemo(
    () =>
      transfers.filter(
        (t) =>
          scopedProjects.includes(t.to) ||
          scopedProjects.includes(t.from) ||
          t.from === "Warehouse",
      ),
    [transfers, scopedProjects],
  );

  const openTransfers = filteredTransfers.filter((t) => t.status === "transit").length;

  const filteredHistory = useMemo(
    () => history.filter((h) => scopedProjects.includes(h.location)),
    [history, scopedProjects],
  );

  const statusEdit = register.find((r) => r.id === statusEditId) || null;
  const receiveTransfer = transfers.find((t) => t.id === receiveId) || null;
  const canConfirmReceipt = canReceive || canWrite || user?.role === "admin";

  function toast(msg: string) {
    setFlash(msg);
    window.setTimeout(() => setFlash(null), 2200);
  }

  async function onDownloadTemplate() {
    setError(null);
    try {
      await downloadHwRegisterTemplate();
      toast("Template downloaded");
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function onImportExcel(file: File) {
    setError(null);
    setImporting(true);
    try {
      const result = await importHwRegister(file);
      setHw(result.hw);
      setRegister(asHwDevices(result.items, now));
      const warn =
        result.skipped_errors?.length > 0
          ? ` · ${result.skipped_errors.length} row(s) skipped`
          : "";
      toast(
        `Imported ${result.imported} row(s) (${result.added} new, ${result.updated} updated)${warn}`,
      );
      setTab("register");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setImporting(false);
    }
  }

  function exportSummaryCsv() {
    const header = ["Project / Location", ...HW_DEVICE_META.map((d) => d.device), "Total"];
    const body = scopedProjects.map((project) => {
      const counts = HW_DEVICE_META.map((d) => matrix[project]?.[d.device] || 0);
      const total = counts.reduce((s, n) => s + n, 0);
      return [project, ...counts, total];
    });
    const footer = [
      "Total",
      ...HW_DEVICE_META.map((d) => typeTotals[d.device] || 0),
      Object.values(typeTotals).reduce((s, n) => s + n, 0),
    ];
    downloadCsv("scc-hardware-dashboard-summary.csv", [header, ...body, footer]);
    toast("Exported dashboard summary");
  }

  function exportRegisterCsv() {
    downloadCsv("scc-hardware-device-register.csv", [
      [
        "Device",
        "System",
        "Serial number",
        "Status",
        "Project",
        "Last signal",
        "Last updated",
      ],
      ...filteredRegister.map((row) => [
        row.device,
        row.system,
        row.serial,
        row.status,
        row.project,
        row.lastSignal || "",
        fmtHwDate(row.updatedIso),
      ]),
    ]);
    toast("Exported device register");
  }

  function exportHistoryCsv() {
    downloadCsv("scc-hardware-change-history.csv", [
      [
        "Date and time",
        "Location",
        "Device",
        "Status",
        "From",
        "To",
        "Confirmed reason",
        "Source / confirmed by",
      ],
      ...filteredHistory.map((h) => [
        fmtHwDateTime(h.atIso),
        h.location,
        h.device,
        h.status,
        h.from,
        h.to,
        h.reason,
        h.by,
      ]),
    ]);
    toast("Exported change history");
  }

  function onAddDevice() {
    if (!addForm.serial.trim()) return;
    if (addForm.device === "AI Camera" && !isAiCameraLocation(addForm.project)) {
      setError(
        "AI cameras can only be added at Jafurah, Yanbu, Ras Tanura, MGS, Salasil, or Dhahran.",
      );
      return;
    }
    const meta = HW_DEVICE_META.find((d) => d.device === addForm.device);
    const row: HwDevice = {
      id: `DEV-${Date.now()}`,
      device: addForm.device as HwDevice["device"],
      system: meta?.system || "4S",
      serial: addForm.serial.trim(),
      status: coerceHwStatusForDevice(addForm.device, addForm.status),
      project: addForm.project,
      lastSignal: null,
      updatedIso: now.toISOString(),
    };
    setRegister((rows) => [row, ...rows]);
    setAddOpen(false);
    setError(null);
    setAddForm((f) => ({ ...f, serial: "" }));
    toast(`Added ${row.device} ${row.serial}`);
  }

  function onSendTransfer() {
    const qty = Number(trForm.qty) || 0;
    const serials = trForm.serials
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!qty || serials.length !== qty) {
      setError("Serial count must match quantity.");
      return;
    }
    if (trForm.type === "AI Camera" && !isAiCameraLocation(trForm.to)) {
      setError(
        "AI cameras can only be transferred to Jafurah, Yanbu, Ras Tanura, MGS, Salasil, or Dhahran.",
      );
      return;
    }
    const id = `TRF-${String(transfers.length + 8).padStart(4, "0")}`;
    const next: HwTransfer = {
      id,
      atIso: now.toISOString(),
      kind: trForm.kind.includes("warehouse") ? "delivery" : "shift",
      from: trForm.from,
      to: trForm.to,
      type: trForm.type,
      qty,
      serials,
      reason: trForm.reason || "Material movement",
      sender: formatUserLabel(user) || user?.username || "Sender",
      receiver: trForm.receiver || "Site Receiver",
      status: "transit",
    };
    setTransfers((rows) => [next, ...rows]);
    setTransferOpen(false);
    setError(null);
    setTab("transfers");
    toast(`Transfer ${id} sent`);
  }

  function openReceive(id: string) {
    const row = transfers.find((t) => t.id === id);
    if (!row || row.status !== "transit") return;
    setReceiveId(id);
    setReceiveSerials([...row.serials]);
    setReceiveCondition("Good");
    setReceiveNotes("");
    setReceiveAck(false);
    setError(null);
  }

  function closeReceive() {
    setReceiveId(null);
    setReceiveSerials([]);
    setReceiveAck(false);
    setReceiveNotes("");
  }

  function toggleReceiveSerial(serial: string) {
    setReceiveSerials((rows) =>
      rows.includes(serial) ? rows.filter((s) => s !== serial) : [...rows, serial],
    );
  }

  async function confirmReceipt() {
    if (!receiveTransfer || !receiveAck || !receiveSerials.length) return;
    const id = receiveTransfer.id;
    try {
      await receiveHwTransfer(id);
    } catch {
      /* local confirm still applies for demo seed rows */
    }
    const receivedAtIso = new Date().toISOString();
    setTransfers((rows) =>
      rows.map((t) =>
        t.id === id
          ? {
              ...t,
              status: "received",
              receivedAtIso,
              serials: receiveSerials,
              receiver: formatUserLabel(user) || user?.username || t.receiver,
            }
          : t,
      ),
    );
    closeReceive();
    toast(`Confirmed ${id}`);
  }

  const donutParts = (Object.keys(HW_STATUS_COLORS) as HwStatus[]).map((st) => ({
    label: st,
    value:
      st === "Installed"
        ? totals.installed
        : st === "Assigned"
          ? totals.assigned
          : st === "In Stock"
            ? totals.inStock
            : st === "Under Maintenance"
              ? totals.maint
              : st === "Damaged"
                ? totals.damaged
                : totals.lost,
    color: HW_STATUS_COLORS[st],
  }));

  return (
    <section className="page hw-v1">
      <section className="v1-banner">
        <div className="v1-banner-icon">
          <HwIcon />
        </div>
        <div className="v1-banner-copy">
          <h1>
            SCC <em>HARDWARE</em>
          </h1>
          <p>
            Devices Deployed <i>•</i> Confirmed Changes <i>•</i> Material Transfers
          </p>
        </div>
        <div className="v1-banner-actions">
          <span className="hw-live">
            <i />
            {liveLabel}
          </span>
          {canWrite ? (
            <button type="button" className="btn ghost" onClick={() => setTransferOpen(true)}>
              + New transfer
            </button>
          ) : null}
        </div>
      </section>

      <div className="reports-tabs hw-tabs">
        {(
          [
            ["fleet", "Dashboard"],
            ["dash", "Hardware Status"],
            ["summary", "Dashboard Summary"],
            ["register", "Device Register"],
            ["transfers", `Material Transfers${openTransfers ? ` (${openTransfers})` : ""}`],
            ["history", "Change History"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? "on" : undefined}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "fleet" ? <DashboardScreen embed="overview" /> : null}

      {tab === "fleet" ? null : (
      <div className="v1-filters">
        <div className="grp">
          <label className="k">View</label>
          <div className="seg">
            <ProjectOnlyViewSeg
              view={view}
              setView={setView}
              restrictToProject={!hasAllProjectAccess}
              options={[
                ["overall", "Over All"],
                ["projects", "By Project"],
                ["departments", "By Department"],
              ]}
            />
          </div>
        </div>
        {view === "projects" ? (
          <div className="grp">
            <label className="k">Project</label>
            <select
              className="sel"
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
            >
              <option value="">All assigned</option>
              {accessProjects.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="grp">
          <label className="k">Period</label>
          <select className="sel" value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="ytd">Year to date</option>
            <option value="month">This month</option>
            <option value="week">This week</option>
          </select>
        </div>
        <div className="grp">
          <label className="k">Device</label>
          <select
            className="sel"
            value={deviceFilter}
            onChange={(e) => setDeviceFilter(e.target.value)}
          >
            <option value="All">All devices</option>
            {HW_DEVICE_META.map((d) => (
              <option key={d.device} value={d.device}>
                {d.device}
              </option>
            ))}
          </select>
        </div>
        <div className="grp">
          <label className="k">Status</label>
          <select
            className="sel"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="All">All statuses</option>
            {(Object.keys(HW_STATUS_COLORS) as HwStatus[]).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="range">
          <b>{rangeLabel}</b>
          Counts follow the Device Register
          {!hasAllProjectAccess ? ` · ${accessProjects.join(", ")}` : ""}
        </div>
      </div>
      )}

      {flash ? <p className="hw-flash">{flash}</p> : null}
      {error ? <p className="state error">{error}</p> : null}

      {tab === "dash" ? (
        <>
          <div className="v1-grid g5 hw-kpi-row">
            <article className="v1-kpi hw-kpi-dark">
              <p>All SCC devices</p>
              <strong>{fmtN(totals.all)}</strong>
              <span>all devices · {scopedProjects.length} locations</span>
            </article>
            <article className="v1-kpi">
              <p>Installed</p>
              <strong>{fmtN(totals.installed)}</strong>
              <span>{Math.round((totals.installed / totals.all) * 100)}% · cameras, vehicles and site devices</span>
              <div className="progress">
                <i style={{ width: `${(totals.installed / totals.all) * 100}%`, background: "#2f9e5b" }} />
              </div>
            </article>
            <article className="v1-kpi">
              <p>Assigned</p>
              <strong>{fmtN(totals.assigned)}</strong>
              <span>{Math.round((totals.assigned / totals.all) * 100)}% · smart watches and helmets</span>
              <div className="progress">
                <i style={{ width: `${(totals.assigned / totals.all) * 100}%`, background: "#2a8f8a" }} />
              </div>
            </article>
            <article className="v1-kpi">
              <p>In Stock</p>
              <strong>{fmtN(totals.inStock)}</strong>
              <span>ready to deploy · {openTransfers} transfers in transit</span>
            </article>
            <article className="v1-kpi">
              <p>Out of service</p>
              <strong className="hw-danger">{fmtN(totals.out)}</strong>
              <span>
                {totals.maint} under maintenance · {totals.damaged} damaged · {totals.lost} lost
              </span>
            </article>
          </div>

          <div className="v1-grid g2eq hw-chart-pair">
            <article className="v1-card">
              <h3>Devices by status</h3>
              <p className="sub">Select a status to see where those devices are</p>
              <Donut parts={donutParts} />
            </article>
            <article className="v1-card">
              <h3>Devices by project</h3>
              <StackedProjectBars projects={scopedProjects} byStatus={byStatus} />
            </article>
          </div>

          <div className="v1-grid g2">
            <article className="v1-card">
              <h3>Device health by type</h3>
              <p className="sub">How many of each device are in use, in stock or out of service.</p>
              <div className="tbl-wrap hw-scroll-x">
                <table className="v1-tbl hw-health-tbl">
                  <thead>
                    <tr>
                      <th>Device</th>
                      <th>System</th>
                      <th className="n">Total</th>
                      <th className="n">Installed</th>
                      <th className="n">Assigned</th>
                      <th className="n">In Stock</th>
                      <th className="n">Maint.</th>
                      <th className="n">Damaged</th>
                      <th className="n">Lost</th>
                      <th>In Service</th>
                    </tr>
                  </thead>
                  <tbody>
                    {health.map((row) => (
                      <tr key={row.device}>
                        <td>{row.device}</td>
                        <td>{row.system}</td>
                        <td className="n mono">{fmtN(row.total)}</td>
                        <td className="n mono">{fmtN(row.installed)}</td>
                        <td className="n mono">{fmtN(row.assigned)}</td>
                        <td className="n mono">{fmtN(row.inStock)}</td>
                        <td className="n mono">{fmtN(row.maint)}</td>
                        <td className={`n mono${row.damaged ? " hw-danger" : ""}`}>
                          {fmtN(row.damaged)}
                        </td>
                        <td className={`n mono${row.lost ? " hw-danger" : ""}`}>{fmtN(row.lost)}</td>
                        <td>
                          <div className="hw-svc">
                            <div className="hw-mini-bar">
                              <i
                                style={{
                                  width: `${row.inServicePct}%`,
                                  background: row.damaged || row.lost ? "#2a8f8a" : "#2f9e5b",
                                }}
                              />
                            </div>
                            <span className="hw-svc-pct">{Math.round(row.inServicePct)}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
            <div className="hw-side-col">
              <article className="v1-card">
                <h3>Needs attention</h3>
                <p className="sub">Out-of-service devices, open transfers and detected changes.</p>
                <div className="hw-attn-list">
                  {attention.slice(0, 3).map((a) => (
                    <div className="hw-attn red" key={a.project}>
                      <b>{a.project}</b>
                      <span>
                        {a.total} damaged or lost ({a.damaged} damaged · {a.lost} lost)
                      </span>
                    </div>
                  ))}
                  {openTransfers ? (
                    <div className="hw-attn amber">
                      <b>{openTransfers} transfers waiting for receipt</b>
                      <span>
                        {filteredTransfers
                          .filter((t) => t.status === "transit")
                          .map((t) => `${t.id} to ${t.to}`)
                          .join(" · ")}
                      </span>
                    </div>
                  ) : null}
                </div>
              </article>
              <article className="v1-card">
                <h3>Devices installed or assigned</h3>
                <p className="sub">Month by month, {now.getFullYear()}.</p>
                <TrendLine labels={trend.labels} values={trend.values} />
              </article>
            </div>
          </div>
        </>
      ) : null}

      {tab === "summary" ? (
        <>
          <div className="v1-grid g4 hw-type-grid">
            {HW_DEVICE_META.map((d) => (
              <article className="v1-kpi ikpi" key={d.device}>
                <div className="ikpi-body">
                  <div className="t">{d.device}</div>
                  <div className="v">{fmtN(typeTotals[d.device] || 0)}</div>
                  <div className="s">{d.system}</div>
                </div>
                <div className="art" aria-hidden>
                  <HwTypeGlyph kind={d.device} />
                </div>
              </article>
            ))}
            <article className="v1-kpi ikpi dark">
              <div className="ikpi-body">
                <div className="t">All SCC devices</div>
                <div className="v">{fmtN(totals.all)}</div>
                <div className="s">all statuses</div>
              </div>
              <div className="art" aria-hidden>
                <HwTypeGlyph kind="All" />
              </div>
            </article>
          </div>
          <article className="v1-card hw-summary-card">
            <div className="hw-reg-hd">
              <div>
                <h3>Dashboard summary</h3>
                <p className="sub">
                  Devices per project and location, grouped by system. Counts come from the Device
                  Register. Select a number to open those devices.
                </p>
              </div>
              <HwExcelBtns
                onExport={exportSummaryCsv}
                onTemplate={() => void onDownloadTemplate()}
                onImportClick={() => importInputRef.current?.click()}
                importInputRef={importInputRef}
                onImportFile={(file) => void onImportExcel(file)}
                importing={importing}
              />
            </div>
            <div className="tbl-wrap hw-scroll-x">
              <table className="v1-tbl hw-heat-tbl">
                <thead>
                  <tr className="hw-heat-groups">
                    <th rowSpan={2}>Project / Location</th>
                    <th colSpan={7} className="sys-4s">
                      4S
                    </th>
                    <th colSpan={3} className="sys-fms">
                      FMS
                    </th>
                    <th colSpan={1} className="sys-pwas">
                      PWAS
                    </th>
                    <th rowSpan={2} className="n">
                      Total
                    </th>
                  </tr>
                  <tr>
                    {HW_DEVICE_META.map((d) => (
                      <th
                        key={d.device}
                        className={`n sys-${d.system.toLowerCase()}`}
                      >
                        {d.device}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {scopedProjects.map((project) => {
                    const rowTotal = HW_DEVICE_META.reduce(
                      (s, d) => s + (matrix[project]?.[d.device] || 0),
                      0,
                    );
                    return (
                      <tr key={project}>
                        <td>
                          <b>{project}</b>
                        </td>
                        {HW_DEVICE_META.map((d) => {
                          const n = matrix[project]?.[d.device] || 0;
                          const heat = n <= 0 ? 0 : Math.min(1, 0.18 + n / Math.max(d.total * 0.55, 1));
                          return (
                            <td key={d.device} className="n mono">
                              <button
                                type="button"
                                className={`hw-heat-pill${n ? " has" : ""}`}
                                style={n ? ({ "--h": heat.toFixed(2) } as CSSProperties) : undefined}
                              >
                                {fmtN(n)}
                              </button>
                            </td>
                          );
                        })}
                        <td className="n mono">
                          <b className="hw-heat-total">{fmtN(rowTotal)}</b>
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="hw-total-row">
                    <td>
                      <b>Total</b>
                    </td>
                    {HW_DEVICE_META.map((d) => (
                      <td key={d.device} className="n mono">
                        <b className="hw-heat-total">{fmtN(typeTotals[d.device] || 0)}</b>
                      </td>
                    ))}
                    <td className="n mono">
                      <b className="hw-heat-total">{fmtN(totals.all)}</b>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </article>
        </>
      ) : null}

      {tab === "register" ? (
        <article className="v1-card">
          <div className="hw-reg-hd">
            <div>
              <h3>Device register</h3>
              <p className="sub">
                Every device by serial number, with its status, project and last signal.
              </p>
            </div>
            <div className="hw-reg-actions">
              <input
                className="hw-search"
                placeholder="Serial, device or project"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <HwExcelBtns
                onExport={exportRegisterCsv}
                onTemplate={() => void onDownloadTemplate()}
                onImportClick={() => importInputRef.current?.click()}
                importInputRef={importInputRef}
                onImportFile={(file) => void onImportExcel(file)}
                importing={importing}
              />
              {canWrite ? (
                <button type="button" className="btn primary sm" onClick={() => setAddOpen(true)}>
                  + Add device
                </button>
              ) : null}
            </div>
          </div>
          <div className="tbl-wrap hw-list-wrap">
            <table className="v1-tbl">
              <thead>
                <tr>
                  <th>Device</th>
                  <th>System</th>
                  <th>Serial number</th>
                  <th>Status</th>
                  <th>Project</th>
                  <th>Last signal</th>
                  <th>Last updated</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredRegister.map((row) => (
                  <tr key={row.id}>
                    <td>{row.device}</td>
                    <td>{row.system}</td>
                    <td className="mono">{row.serial}</td>
                    <td>
                      <StatusPill status={row.status} />
                    </td>
                    <td>{row.project}</td>
                    <td>
                      {row.lastSignal ? (
                        <span className="hw-online">{row.lastSignal}</span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="muted">{fmtHwDate(row.updatedIso)}</td>
                    <td className="hw-actions">
                      {canWrite ? (
                        <>
                          <button
                            type="button"
                            className="linkbtn"
                            onClick={() => setStatusEditId(row.id)}
                          >
                            Change status
                          </button>
                          <button
                            type="button"
                            className="linkbtn muted"
                            onClick={() => {
                              setRegister((rows) => rows.filter((r) => r.id !== row.id));
                              toast(`Removed ${row.serial}`);
                            }}
                          >
                            Remove
                          </button>
                        </>
                      ) : (
                        <span className="muted">View only</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      ) : null}

      {tab === "transfers" ? (
        <article className="v1-card">
          <div className="hw-reg-hd">
            <div>
              <h3>Material transfers</h3>
              <p className="sub">
                Deliveries from the warehouse and shifts between projects. Counts move automatically
                when the receiver confirms receipt.
              </p>
            </div>
            {canWrite ? (
              <button type="button" className="btn primary sm" onClick={() => setTransferOpen(true)}>
                + New transfer
              </button>
            ) : null}
          </div>
          <div className="tbl-wrap hw-list-wrap">
            <table className="v1-tbl">
              <thead>
                <tr>
                  <th>Transfer</th>
                  <th>Date</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Device</th>
                  <th className="n">Qty</th>
                  <th>Serial numbers</th>
                  <th>Sender</th>
                  <th>Receiver</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredTransfers.map((t) => (
                  <tr key={t.id}>
                    <td className="mono">
                      <b>{t.id}</b>
                    </td>
                    <td>{fmtHwDate(t.atIso)}</td>
                    <td>{t.from}</td>
                    <td>{t.to}</td>
                    <td>{t.type}</td>
                    <td className="n mono">{t.qty}</td>
                    <td className="mono">
                      {t.serials.slice(0, 2).join(", ")}
                      {t.serials.length > 2 ? (
                        <span className="hw-more"> +{t.serials.length - 2} more</span>
                      ) : null}
                    </td>
                    <td>{t.sender}</td>
                    <td>{t.receiver}</td>
                    <td>
                      {t.status === "received" ? (
                        <StatusPill status={`Received ${fmtHwDate(t.receivedAtIso || t.atIso)}`} />
                      ) : (
                        <StatusPill status="transit" />
                      )}
                    </td>
                    <td>
                      {t.status === "transit" && canConfirmReceipt ? (
                        <button
                          type="button"
                          className="linkbtn"
                          onClick={() => openReceive(t.id)}
                        >
                          Confirm receipt
                        </button>
                      ) : t.status === "received" ? (
                        <span className="muted">Confirmed</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      ) : null}

      {tab === "history" ? (
        <article className="v1-card">
          <div className="hw-reg-hd">
            <div>
              <h3>Change history</h3>
              <p className="sub">
                Every automatic update, confirmed change and receipt, with its reason, newest first.
              </p>
            </div>
            <button type="button" className="btn ghost sm hw-xl-btn" onClick={exportHistoryCsv}>
              Export Excel
            </button>
          </div>
          <div className="tbl-wrap hw-list-wrap">
            <table className="v1-tbl">
              <thead>
                <tr>
                  <th>Date and time</th>
                  <th>Location</th>
                  <th>Device</th>
                  <th>Status</th>
                  <th>From / To</th>
                  <th>Confirmed reason</th>
                  <th>Source / confirmed by</th>
                </tr>
              </thead>
              <tbody>
                {filteredHistory.map((h) => (
                  <tr key={h.id}>
                    <td className="mono">{fmtHwDateTime(h.atIso)}</td>
                    <td>{h.location}</td>
                    <td>{h.device}</td>
                    <td>
                      <StatusPill status={h.status} />
                    </td>
                    <td className="mono">
                      {h.from} → {h.to}
                    </td>
                    <td>{h.reason}</td>
                    <td>{h.by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      ) : null}

      {addOpen ? (
        <Modal
          title="Add device"
          onClose={() => setAddOpen(false)}
          footer={
            <>
              <button type="button" className="btn ghost" onClick={() => setAddOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn primary" onClick={onAddDevice}>
                Add device
              </button>
            </>
          }
        >
          <div className="hw-form-grid">
            <label>
              Device
              <select
                value={addForm.device}
                onChange={(e) => {
                  const device = e.target.value;
                  setAddForm((f) => {
                    const nextProject =
                      device === "AI Camera" && !isAiCameraLocation(f.project)
                        ? accessProjects.find((p) => isAiCameraLocation(p)) ||
                          AI_CAMERA_LOCATIONS[0]
                        : f.project;
                    return {
                      ...f,
                      device,
                      project: nextProject,
                      status: coerceHwStatusForDevice(device, f.status),
                    };
                  });
                }}
              >
                {HW_DEVICE_META.map((d) => (
                  <option key={d.device}>{d.device}</option>
                ))}
              </select>
            </label>
            <label>
              Serial number
              <input
                value={addForm.serial}
                onChange={(e) => setAddForm((f) => ({ ...f, serial: e.target.value }))}
                placeholder="Serial"
              />
            </label>
            <label>
              Status
              <select
                value={coerceHwStatusForDevice(addForm.device, addForm.status)}
                onChange={(e) =>
                  setAddForm((f) => ({ ...f, status: e.target.value as HwStatus }))
                }
              >
                {hwStatusesForDevice(addForm.device).map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              Project
              <select
                value={addForm.project}
                onChange={(e) => setAddForm((f) => ({ ...f, project: e.target.value }))}
              >
                {addProjectOptions.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
              {addForm.device === "AI Camera" ? (
                <small>AI cameras are limited to the six site locations.</small>
              ) : null}
            </label>
          </div>
        </Modal>
      ) : null}

      {transferOpen ? (
        <Modal
          title="New material transfer"
          onClose={() => setTransferOpen(false)}
          footer={
            <>
              <button type="button" className="btn ghost" onClick={() => setTransferOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn primary" onClick={onSendTransfer}>
                Send transfer
              </button>
            </>
          }
        >
          <label className="hw-field">
            Transfer type
            <select
              value={trForm.kind}
              onChange={(e) => setTrForm((f) => ({ ...f, kind: e.target.value }))}
            >
              <option>Delivery from warehouse</option>
              <option>Shift between projects</option>
            </select>
          </label>
          <div className="hw-form-grid">
            <label>
              From
              <select
                value={trForm.from}
                onChange={(e) => setTrForm((f) => ({ ...f, from: e.target.value }))}
              >
                <option>Warehouse</option>
                {accessProjects.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            <label>
              To
              <select
                value={trForm.to}
                onChange={(e) => setTrForm((f) => ({ ...f, to: e.target.value }))}
              >
                {transferToOptions.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
              {trForm.type === "AI Camera" ? (
                <small>AI cameras can only go to the six site locations.</small>
              ) : null}
            </label>
            <label>
              Device type
              <select
                value={trForm.type}
                onChange={(e) => {
                  const type = e.target.value;
                  setTrForm((f) => ({
                    ...f,
                    type,
                    to:
                      type === "AI Camera" && !isAiCameraLocation(f.to)
                        ? accessProjects.find((p) => isAiCameraLocation(p)) ||
                          AI_CAMERA_LOCATIONS[0]
                        : f.to,
                  }));
                }}
              >
                {HW_DEVICE_META.map((d) => (
                  <option key={d.device}>{d.device}</option>
                ))}
              </select>
            </label>
            <label>
              Quantity
              <input
                value={trForm.qty}
                onChange={(e) => setTrForm((f) => ({ ...f, qty: e.target.value }))}
                placeholder="Qty"
              />
              <small>Sent from the warehouse.</small>
            </label>
          </div>
          <label className="hw-field">
            Serial numbers
            <textarea
              rows={4}
              value={trForm.serials}
              onChange={(e) => setTrForm((f) => ({ ...f, serials: e.target.value }))}
              placeholder="One serial number per line. The count must match the quantity."
            />
            <small>New devices: enter the serial numbers from the delivery note.</small>
          </label>
          <label className="hw-field">
            Reason
            <input
              value={trForm.reason}
              onChange={(e) => setTrForm((f) => ({ ...f, reason: e.target.value }))}
              placeholder="Why the material is moving."
            />
          </label>
          <div className="hw-form-grid">
            <label>
              Sender
              <input value={formatUserLabel(user) || user?.username || ""} readOnly />
            </label>
            <label>
              Receiver name
              <input
                value={trForm.receiver}
                onChange={(e) => setTrForm((f) => ({ ...f, receiver: e.target.value }))}
                placeholder="Name of the receiver at site."
              />
            </label>
          </div>
        </Modal>
      ) : null}

      {receiveTransfer ? (
        <Modal
          title="Confirm receipt"
          wide
          onClose={closeReceive}
          footer={
            <>
              <button type="button" className="btn ghost" onClick={closeReceive}>
                Cancel
              </button>
              <button
                type="button"
                className="btn primary hw-confirm-btn"
                disabled={!receiveAck || receiveSerials.length === 0}
                onClick={() => void confirmReceipt()}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M5 12.5 9.5 17 19 7.5"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                Confirm receipt
              </button>
            </>
          }
        >
          <div className="hw-recv-meta">
            {(
              [
                ["Transfer", receiveTransfer.id],
                ["From → To", `${receiveTransfer.from} → ${receiveTransfer.to}`],
                ["Device", receiveTransfer.type],
                ["Sent by", receiveTransfer.sender],
                ["Quantity sent", String(receiveTransfer.qty ?? "")],
                ["Reason", receiveTransfer.reason || "—"],
              ] as const
            ).map(([label, value]) => (
              <div className="hw-recv-row" key={label}>
                <span>{label}</span>
                <b>{value}</b>
              </div>
            ))}
          </div>

          <div className="hw-recv-serials">
            <b>Serial numbers received</b>
            <div className="hw-recv-serial-box">
              {receiveTransfer.serials.map((serial) => {
                const checked = receiveSerials.includes(serial);
                return (
                  <label key={serial} className="hw-recv-serial">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleReceiveSerial(serial)}
                    />
                    <span className="mono">{serial}</span>
                  </label>
                );
              })}
            </div>
            <small>
              {receiveSerials.length} of {receiveTransfer.serials.length} ticked. Untick any serial
              number that did not arrive.
            </small>
          </div>

          <div className="hw-form-grid">
            <label className="hw-field">
              Condition
              <select
                value={receiveCondition}
                onChange={(e) => setReceiveCondition(e.target.value)}
              >
                <option>Good</option>
                <option>Damaged</option>
                <option>Incomplete</option>
              </select>
            </label>
            <label className="hw-field">
              Received by
              <input
                value={formatUserLabel(user) || user?.username || ""}
                readOnly
              />
            </label>
          </div>

          <label className="hw-field">
            Notes
            <textarea
              rows={3}
              value={receiveNotes}
              onChange={(e) => setReceiveNotes(e.target.value)}
              placeholder="Missing or damaged items, serial numbers"
            />
          </label>

          <label className="hw-recv-ack">
            <input
              type="checkbox"
              checked={receiveAck}
              onChange={(e) => setReceiveAck(e.target.checked)}
            />
            <span>I confirm I have received the material listed above.</span>
          </label>
        </Modal>
      ) : null}

      {statusEdit ? (
        <Modal
          title={`Change status · ${statusEdit.serial}`}
          onClose={() => setStatusEditId(null)}
          footer={
            <>
              <button type="button" className="btn ghost" onClick={() => setStatusEditId(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  setStatusEditId(null);
                  toast("Status updated");
                }}
              >
                Save
              </button>
            </>
          }
        >
          <label className="hw-field">
            Status
            <select
              value={coerceHwStatusForDevice(statusEdit.device, statusEdit.status)}
              onChange={(e) => {
                const status = coerceHwStatusForDevice(
                  statusEdit.device,
                  e.target.value,
                );
                setRegister((rows) =>
                  rows.map((r) =>
                    r.id === statusEdit.id
                      ? { ...r, status, updatedIso: new Date().toISOString() }
                      : r,
                  ),
                );
              }}
            >
              {hwStatusesForDevice(statusEdit.device).map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        </Modal>
      ) : null}
    </section>
  );
}
