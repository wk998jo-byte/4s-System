import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  fetchCases,
  notifyCasesChanged,
  postJson,
  resolveMediaUrl,
  uploadImage,
  type CaseDetail,
  type CaseSummary,
} from "../api/scc";
import { useAuth } from "../auth/AuthContext";
import { errorMessage } from "../lib/errors";
import { useChartReveal } from "../lib/useChartReveal";
import { ITQAN_SKIP_REASONS, useIntegSettings } from "../lib/integSettings";
import { href } from "../lib/routing";
import {
  rowAllowedForProjects,
  useAutoFormProject,
  useAutoProjectFilter,
  useProjectAccess,
} from "../lib/useProjectAccess";
import { AssetFields } from "./AssetFields";
import { ChartTip, tipFromEvent, type ChartTipData } from "./chartTip";
import { SpeedRecordDrawer } from "./SpeedRecordDrawer";
import {SelectList,
  SignedInNameField,
  StatusPill,
  nowLocal,
  speedSummaryPreview,
  todayIso,
  useList,
  useSignedInName,
  weekFromIsoDate,
  ProjectOnlyViewSeg,
} from "./shared";

type SpeedView = "overall" | "projects" | "departments";
type PeriodId =
  | "today"
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "ytd"
  | "custom";
type CurveMode = "week" | "month";
type LogStatus = "All" | "Open" | "Under Review" | "Closed" | "Overdue";

const PAL = {
  red: "#C8102E",
  steel: "#8B8A8F",
  amber: "#D98B13",
  copper: "#B4572E",
  sand: "#CDB48A",
  olive: "#7C8C47",
  green: "#3F8A57",
  ink2: "#4A474C",
  line: "#DDD9D4",
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const MON3 = MONTHS.map((m) => m.slice(0, 3));
const DAY_MS = 86400000;
const HOUR_MS = 3600000;
const SLA_HOURS: Record<string, number> = { High: 24, Medium: 72, Low: 168 };

function fmtN(n: number) {
  return Number(n || 0).toLocaleString("en-US");
}

function isoDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDay(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MON3[(m ?? 1) - 1]} ${y}`;
}

function sod(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function weekStart(d: Date) {
  const x = sod(d);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

function weekNo(d: Date) {
  const start = new Date(d.getFullYear(), 0, 1);
  const day = Math.floor((sod(d).getTime() - sod(start).getTime()) / DAY_MS);
  return Math.floor(day / 7) + 1;
}

function periodRange(period: PeriodId, from: string, to: string, now = new Date()) {
  const year = now.getFullYear();
  const t0 = sod(now).getTime();
  const eod = t0 + DAY_MS - 1;
  let a = t0;
  let b = eod;
  let pa = a - DAY_MS;
  let pb = b - DAY_MS;
  let label = "";
  let cmp: string | null = "previous period";

  switch (period) {
    case "today":
      a = t0;
      pa = a - DAY_MS;
      pb = b - DAY_MS;
      label = `Today, ${formatDay(isoDate(now))}`;
      cmp = "yesterday";
      break;
    case "this_week": {
      a = weekStart(now).getTime();
      pa = a - 7 * DAY_MS;
      pb = b - 7 * DAY_MS;
      label = `${formatDay(isoDate(new Date(a)))} to ${formatDay(isoDate(now))}`;
      cmp = "last week";
      break;
    }
    case "last_week": {
      const w = weekStart(now).getTime();
      b = w - 1;
      a = w - 7 * DAY_MS;
      pa = a - 7 * DAY_MS;
      pb = a - 1;
      label = `${formatDay(isoDate(new Date(a)))} to ${formatDay(isoDate(new Date(b)))}`;
      cmp = "the week before";
      break;
    }
    case "this_month": {
      a = new Date(year, now.getMonth(), 1).getTime();
      const pm = new Date(year, now.getMonth() - 1, 1);
      pa = pm.getTime();
      pb = pa + (b - a);
      label = `${MONTHS[now.getMonth()]} ${year} to date`;
      cmp = "same days last month";
      break;
    }
    case "last_month": {
      const s = new Date(year, now.getMonth() - 1, 1);
      a = s.getTime();
      b = new Date(year, now.getMonth(), 1).getTime() - 1;
      const p = new Date(year, now.getMonth() - 2, 1);
      pa = p.getTime();
      pb = a - 1;
      label = `${MONTHS[s.getMonth()]} ${s.getFullYear()}`;
      cmp = MONTHS[p.getMonth()];
      break;
    }
    case "custom": {
      a = from ? new Date(`${from}T00:00:00`).getTime() : new Date(year, 0, 1).getTime();
      b = to ? new Date(`${to}T23:59:59`).getTime() : eod;
      const L = Math.max(DAY_MS, b - a);
      pb = a - 1;
      pa = a - L;
      label = `${formatDay(isoDate(new Date(a)))} to ${formatDay(isoDate(new Date(b)))}`;
      cmp = `previous ${Math.round(L / DAY_MS)} days`;
      break;
    }
    case "ytd":
    default: {
      a = new Date(year, 0, 1).getTime();
      pa = new Date(year - 1, 0, 1).getTime();
      pb = new Date(year - 1, now.getMonth(), now.getDate()).getTime() + DAY_MS - 1;
      label = `1 Jan to ${formatDay(isoDate(now))} (Year to date)`;
      cmp = null;
      break;
    }
  }
  return { a, b, pa, pb, label, cmp };
}

function field(row: CaseSummary, key: string): string {
  const v = row.fields?.[key];
  return v == null ? "" : String(v);
}

function Thumb({ row }: { row: CaseSummary }) {
  const src = resolveMediaUrl(field(row, "fms_evidence"));
  if (src) {
    return (
      <span className="ai-thumb" aria-hidden>
        <img src={src} alt="" loading="lazy" />
      </span>
    );
  }
  let h = 0;
  for (let i = 0; i < row.case_id.length; i++) h = (h * 31 + row.case_id.charCodeAt(i)) >>> 0;
  const hue = h % 40;
  return (
    <span
      className="ai-thumb"
      style={{
        background: `linear-gradient(135deg, hsl(${210 + hue} 18% 28%), hsl(${200 + hue} 35% 14%))`,
      }}
      aria-hidden
    />
  );
}

function isLv(row: CaseSummary) {
  return /light/i.test(field(row, "vehicle_type"));
}

function isHv(row: CaseSummary) {
  return /heavy/i.test(field(row, "vehicle_type"));
}

function isRowType(row: CaseSummary) {
  return /row/i.test(field(row, "speed_violation_type"));
}

function isPublicType(row: CaseSummary) {
  return /public/i.test(field(row, "speed_violation_type"));
}

/** Table 3.2 — permitted speed by Asset Category × Public Road / ROW. */
const SPEED_LIMITS_KMH: Record<string, { publicRoad: number; row: number }> = {
  "light vehicle": { publicRoad: 120, row: 50 },
  "heavy vehicle": { publicRoad: 80, row: 50 },
  "heavy equipment": { publicRoad: 75, row: 50 },
};

function permittedFromCategoryAndRoad(
  assetCategory: string,
  roadKind: string,
): string {
  const limits = SPEED_LIMITS_KMH[assetCategory.trim().toLowerCase()];
  if (!limits) return "";
  if (/row/i.test(roadKind)) return String(limits.row);
  if (/public/i.test(roadKind)) return String(limits.publicRoad);
  return "";
}

function exceedanceOf(row: CaseSummary): number {
  const ex = field(row, "exceedance_kmh");
  if (ex !== "") {
    const n = Number(ex);
    if (Number.isFinite(n)) return n;
  }
  const permitted = Number(field(row, "permitted_speed_kmh"));
  const recorded = Number(field(row, "vehicle_speed_kmh"));
  if (Number.isFinite(permitted) && Number.isFinite(recorded)) return recorded - permitted;
  return Number.NaN;
}

function meanExceedance(rows: CaseSummary[]) {
  const vals = rows.map(exceedanceOf).filter((n) => Number.isFinite(n));
  if (!vals.length) return 0;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

function riskKey(row: CaseSummary): string {
  return (row.risk_level || "").replace(/\s*Risk$/i, "").trim() || "Low";
}

function statusLabel(status: string): string {
  if (status === "under_process") return "Under Review";
  if (status === "open") return "Open";
  if (status === "closed") return "Closed";
  return status;
}

function scopeLabel(row: CaseSummary) {
  if (row.project) return row.project;
  if (row.department) return `Dept: ${row.department}`;
  return "—";
}

function itqanLabel(row: CaseSummary) {
  if (field(row, "itqan_upload_proof") || row.status === "closed" || row.status === "under_process") {
    return "Uploaded";
  }
  if (row.fields?.upload_to_itqan === false) return "Not uploaded";
  return "To upload";
}

function inRange(row: CaseSummary, a: number, b: number) {
  const t = new Date(`${row.date}T00:00:00`).getTime();
  return Number.isFinite(t) && t >= a && t <= b;
}

function countBy(rows: CaseSummary[], keyFn: (r: CaseSummary) => string) {
  const map = new Map<string, number>();
  for (const r of rows) {
    const k = keyFn(r) || "—";
    map.set(k, (map.get(k) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function pct(n: number, total: number) {
  if (!total) return 0;
  return Math.round((n / total) * 100);
}

type SlaState =
  | { k: "ok"; left: number }
  | { k: "soon"; left: number; label: string }
  | { k: "over" | "esc"; over: number; label: string }
  | null;

function slaState(row: CaseSummary, now = Date.now()): SlaState {
  if (row.status !== "open") return null;
  if (field(row, "itqan_upload_proof") || field(row, "close_out_action")) return null;
  const risk = riskKey(row);
  const h = SLA_HOURS[risk] ?? 72;
  const created = new Date(row.created_at).getTime();
  const age = (now - created) / HOUR_MS;
  if (age > h * 2) return { k: "esc", label: "Escalated", over: age - h };
  if (age > h) return { k: "over", label: "Overdue", over: age - h };
  if (age > h * 0.75) return { k: "soon", label: "Due soon", left: h - age };
  return { k: "ok", left: h - age };
}

function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const c = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    width: size,
    height: size,
  };
  switch (name) {
    case "gauge":
      return (
        <svg {...c}>
          <path d="M12 3a9 9 0 0 1 9 9" />
          <path d="M12 12l4-4" />
          <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
        </svg>
      );
    case "road":
      return (
        <svg {...c}>
          <path d="M4 19h16M6 19l2-14h8l2 14" />
          <path d="M12 5v14M9 9h6M8 14h8" />
        </svg>
      );
    case "plus":
      return (
        <svg {...c}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case "report":
      return (
        <svg {...c}>
          <path d="M6 3h9l4 4v14H6z" />
          <path d="M15 3v4h4M9 13h6M9 17h6" />
        </svg>
      );
    case "alert":
      return (
        <svg {...c}>
          <path d="M12 3l10 18H2z" />
          <path d="M12 10v4M12 17h.01" />
        </svg>
      );
    case "clock":
      return (
        <svg {...c}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case "review":
      return (
        <svg {...c}>
          <path d="M4 6h16M4 12h10M4 18h14" />
        </svg>
      );
    case "shield":
      return (
        <svg {...c}>
          <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
        </svg>
      );
    case "sync":
      return (
        <svg {...c}>
          <path d="M21 12a9 9 0 1 1-2.6-6.3" />
          <path d="M21 4v6h-6" />
        </svg>
      );
    case "search":
      return (
        <svg {...c}>
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-4-4" />
        </svg>
      );
    case "download":
      return (
        <svg {...c}>
          <path d="M12 4v12M7 11l5 5 5-5M5 20h14" />
        </svg>
      );
    case "x":
      return (
        <svg {...c}>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      );
    case "check":
      return (
        <svg {...c}>
          <path d="M5 12l4 4L19 6" />
        </svg>
      );
    case "lock":
      return (
        <svg {...c}>
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
      );
    default:
      return null;
  }
}

function Gauge({ value, max }: { value: number; max: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<ChartTipData | null>(null);
  const reveal = useChartReveal(hostRef, `${value}|${max}`);
  const hi = Math.max(max, 1);
  const p = Math.min(1, value / hi);
  const r = 70;
  const c = Math.PI * r;
  const fill = c * p;
  return (
    <div className="ai-gauge" ref={hostRef} onMouseLeave={() => setTip(null)}>
      <svg viewBox="0 0 180 118" className="ai-gauge-svg" aria-hidden>
        <path
          d="M20 78 A70 70 0 0 1 160 78"
          fill="none"
          stroke={PAL.line}
          strokeWidth="16"
          strokeLinecap="round"
          pointerEvents="none"
        />
        <path
          d="M20 78 A70 70 0 0 1 160 78"
          fill="none"
          stroke={PAL.red}
          strokeWidth="16"
          strokeLinecap="round"
          strokeDasharray={`${fill * reveal} ${c}`}
          style={{ cursor: "pointer" }}
          onMouseMove={(e) =>
            setTip(
              tipFromEvent(e, hostRef.current, {
                title: "Total observations",
                rows: [{ color: PAL.red, text: fmtN(value) }],
              }),
            )
          }
          onMouseLeave={() => setTip(null)}
        />
              <text x="90" y="58" textAnchor="middle" dominantBaseline="middle" className="ai-gauge-val-svg" pointerEvents="none">
          {fmtN(value)}
        </text>
        <text x="20" y="108" textAnchor="middle" className="ai-gauge-end" pointerEvents="none">
          0
        </text>
        <text x="160" y="108" textAnchor="middle" className="ai-gauge-end" pointerEvents="none">
          {fmtN(hi)}
        </text>
      </svg>
      <ChartTip tip={tip} />
    </div>
  );
}

function StatusDonut({ rows }: { rows: CaseSummary[] }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<ChartTipData | null>(null);
  const open = rows.filter((r) => r.status === "open").length;
  const review = rows.filter((r) => r.status === "under_process").length;
  const closed = rows.filter((r) => r.status === "closed").length;
  const total = rows.length || 1;
  const reveal = useChartReveal(hostRef, `${open}|${review}|${closed}|${rows.length}`);
  const segs = [
    { n: open, c: PAL.red, l: "Open" },
    { n: review, c: PAL.amber, l: "Under Review" },
    { n: closed, c: PAL.green, l: "Closed" },
  ];
  const active = segs.filter((p) => p.n > 0);
  const ring = 2 * Math.PI * 40;
  let segOffset = 0;

  function showSeg(e: ReactMouseEvent, label: string, color: string, value: number) {
    setTip(
      tipFromEvent(e, hostRef.current, {
        title: label,
        rows: [{ color, text: fmtN(value) }],
      }),
    );
  }

  return (
    <div className="ai-donut-block">
      <div
        className="v1-donut-wrap"
        ref={hostRef}
        style={{ width: 170, height: 170 }}
        onMouseLeave={() => setTip(null)}
      >
        <svg viewBox="0 0 100 100" width={170} height={170} aria-hidden>
          <circle
            cx="50"
            cy="50"
            r="40"
            fill="none"
            stroke={PAL.line}
            strokeWidth="12"
            pointerEvents="none"
          />
          {active.length === 1 ? (
            <circle
              key={active[0]!.l}
              cx="50"
              cy="50"
              r="40"
              fill="none"
              stroke={active[0]!.c}
              strokeWidth="12"
              strokeDasharray={ring}
              strokeDashoffset={ring * (1 - reveal)}
              transform="rotate(-90 50 50)"
              style={{ cursor: "pointer" }}
              onMouseMove={(e) => showSeg(e, active[0]!.l, active[0]!.c, active[0]!.n)}
              onMouseLeave={() => setTip(null)}
            />
          ) : (
            segs.map((s) => {
              if (!s.n) return null;
              const len = (s.n / total) * ring * reveal;
              const el = (
                <circle
                  key={s.l}
                  cx="50"
                  cy="50"
                  r="40"
                  fill="none"
                  stroke={s.c}
                  strokeWidth="12"
                  strokeDasharray={`${len} ${ring - len}`}
                  strokeDashoffset={-segOffset}
                  transform="rotate(-90 50 50)"
                  strokeLinecap="butt"
                  style={{ cursor: "pointer" }}
                  onMouseMove={(e) => showSeg(e, s.l, s.c, s.n)}
                  onMouseLeave={() => setTip(null)}
                />
              );
              segOffset += (s.n / total) * ring * reveal;
              return el;
            })
          )}
        </svg>
        <div className="v1-donut-center">
          <b>{fmtN(rows.length)}</b>
        </div>
        <ChartTip tip={tip} />
      </div>
      <div className="v1-legend" style={{ justifyContent: "center" }}>
        {segs.map((s) => (
          <span key={s.l}>
            <i style={{ background: s.c }} />
            {s.l} <b className="mono">{fmtN(s.n)}</b>{" "}
            <span className="muted">{pct(s.n, rows.length)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function ExceedanceBars({ rows }: { rows: CaseSummary[] }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<ChartTipData | null>(null);
  const labels = ["Up to 10 km/h", "11 to 20 km/h", "Over 20 km/h"] as const;
  const data = [
    rows.filter((r) => {
      const ex = exceedanceOf(r);
      return Number.isFinite(ex) && ex <= 10;
    }).length,
    rows.filter((r) => {
      const ex = exceedanceOf(r);
      return Number.isFinite(ex) && ex > 10 && ex <= 20;
    }).length,
    rows.filter((r) => {
      const ex = exceedanceOf(r);
      return Number.isFinite(ex) && ex > 20;
    }).length,
  ];
  const colors = [PAL.sand, PAL.amber, PAL.red];
  const max = niceAxisMax(Math.max(1, ...data));
  const reveal = useChartReveal(hostRef, data.join(","));
  const W = 340;
  const H = 200;
  const pad = { t: 12, r: 12, b: 44, l: 40 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const bw = iw / labels.length - 16;
  const ticks = 5;

  return (
    <div className="v1-chart-host" ref={hostRef} onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="ai-risk-svg" role="img" aria-label="Exceedance bands">
        {Array.from({ length: ticks + 1 }, (_, i) => {
          const f = i / ticks;
          const y = pad.t + ih * (1 - f);
          const val = Math.round(max * f);
          return (
            <g key={f}>
              <line x1={pad.l} x2={W - pad.r} y1={y} y2={y} stroke={PAL.line} strokeWidth={1} />
              <text x={pad.l - 6} y={y + 3} textAnchor="end" fontSize={10} fill="var(--ink-2)">
                {fmtN(val)}
              </text>
            </g>
          );
        })}
        {labels.map((label, i) => {
          const v = data[i]!;
          const h = (v / max) * ih * reveal;
          const x = pad.l + i * (iw / labels.length) + 8;
          const y = pad.t + ih - h;
          return (
            <g key={label}>
              {v > 0 ? (
                <rect
                  x={x}
                  y={y}
                  width={bw}
                  height={Math.max(2, h)}
                  rx={5}
                  fill={colors[i]}
                  style={{ cursor: "pointer" }}
                  onMouseMove={(e) =>
                    setTip(
                      tipFromEvent(e, hostRef.current, {
                        title: label,
                        rows: [{ color: colors[i]!, text: fmtN(v) }],
                      }),
                    )
                  }
                  onMouseLeave={() => setTip(null)}
                />
              ) : null}
              <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize={10} fill="var(--ink-2)">
                {label.replace(" km/h", "")}
              </text>
            </g>
          );
        })}
      </svg>
      <ChartTip tip={tip} />
    </div>
  );
}

function GaugeWithStats({
  title,
  value,
  max,
  publicN,
  rowN,
  avgEx,
}: {
  title: string;
  value: number;
  max: number;
  publicN: number;
  rowN: number;
  avgEx: number;
}) {
  return (
    <article className="v1-card">
      <h3>{title}</h3>
      <div className="v1-grid g2" style={{ alignItems: "center", gap: 12 }}>
        <Gauge value={value} max={max} />
        <div className="kv one">
          <div>
            <span>Public Road</span>
            <b>{fmtN(publicN)}</b>
          </div>
          <div>
            <span>ROW</span>
            <b>{fmtN(rowN)}</b>
          </div>
          <div>
            <span>Avg exceedance</span>
            <b>+{fmtN(avgEx)} km/h</b>
          </div>
        </div>
      </div>
    </article>
  );
}

function HBarChart({
  entries,
  color = PAL.steel,
  height = 260,
}: {
  entries: [string, number][];
  color?: string | ((k: string) => string);
  height?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<ChartTipData | null>(null);
  const max = Math.max(1, ...entries.map((e) => e[1]));
  const reveal = useChartReveal(
    hostRef,
    entries.map(([k, v]) => `${k}:${v}`).join("|"),
  );
  const rowH = Math.max(26, Math.min(34, (height - 28) / Math.max(1, entries.length)));
  const H = Math.max(height, entries.length * rowH + 28);
  const W = 420;
  const labelW = 130;
  const barX = labelW + 8;
  const barW = W - barX - 48;
  const axisY = H - 16;

  if (!entries.length) return <p className="empty">No records.</p>;

  return (
    <div className="v1-chart-host" ref={hostRef} onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="ai-hbar-svg" style={{ height }} aria-hidden>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const x = barX + f * barW;
          return (
            <g key={f}>
              <line x1={x} x2={x} y1={8} y2={axisY - 4} stroke={PAL.line} strokeWidth={1} />
              <text x={x} y={H - 2} textAnchor="middle" fontSize={10} fill="var(--ink-2)">
                {fmtN(Math.round(max * f))}
              </text>
            </g>
          );
        })}
        {entries.map(([k, v], i) => {
          const y = 8 + i * rowH;
          const w = (v / max) * barW * reveal;
          const fill = typeof color === "function" ? color(k) : color;
          const label = k.length > 20 ? `${k.slice(0, 19)}…` : k;
          return (
            <g key={k}>
              <text x={0} y={y + rowH * 0.62} fontSize={12} fill="var(--ink-2)">
                {label}
              </text>
              <rect
                x={barX}
                y={y + 5}
                width={Math.max(2, w)}
                height={14}
                rx={4}
                fill={fill}
                style={{ cursor: "pointer" }}
                onMouseMove={(e) =>
                  setTip(
                    tipFromEvent(e, hostRef.current, {
                      title: k,
                      rows: [{ color: fill, text: fmtN(v) }],
                      place: "right",
                    }),
                  )
                }
                onMouseLeave={() => setTip(null)}
              />
              <text
                x={barX + Math.max(2, w) + 6}
                y={y + rowH * 0.62}
                fontSize={11}
                fill="var(--ink-2)"
                fontFamily="IBM Plex Mono, monospace"
              >
                {fmtN(v)}
              </text>
            </g>
          );
        })}
      </svg>
      <ChartTip tip={tip} />
    </div>
  );
}

function BarsList({
  entries,
  color,
}: {
  entries: [string, number][];
  color?: string | ((k: string, i: number) => string);
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<ChartTipData | null>(null);
  const max = Math.max(1, ...entries.map((e) => e[1]), 1);
  const reveal = useChartReveal(
    hostRef,
    entries.map(([k, v]) => `${k}:${v}`).join("|"),
  );
  if (!entries.length) return <p className="empty">No records.</p>;
  return (
    <div className="ai-bars" ref={hostRef} onMouseLeave={() => setTip(null)}>
      {entries.map(([k, v], i) => {
        const fill = typeof color === "function" ? color(k, i) : color || PAL.steel;
        return (
          <div className="ai-bar" key={k}>
            <span className="l" title={k}>
              {k}
            </span>
            <span className="tr">
              <i
                style={{
                  width: `${(v / max) * 100 * reveal}%`,
                  background: fill,
                  cursor: v > 0 ? "pointer" : "default",
                }}
                onMouseMove={
                  v > 0
                    ? (e) =>
                        setTip(
                          tipFromEvent(e, hostRef.current, {
                            title: k,
                            rows: [{ color: fill, text: fmtN(v) }],
                          }),
                        )
                    : undefined
                }
                onMouseLeave={() => setTip(null)}
              />
            </span>
            <span className="v">{fmtN(v)}</span>
          </div>
        );
      })}
      <ChartTip tip={tip} />
    </div>
  );
}

function smoothCurvePath(
  pts: readonly (readonly [number, number])[],
  yMin: number,
  yMax: number,
) {
  if (!pts.length) return "";
  if (pts.length === 1) return `M${pts[0]![0]} ${pts[0]![1]}`;
  if (pts.length === 2) {
    return `M${pts[0]![0]} ${pts[0]![1]} L${pts[1]![0]} ${pts[1]![1]}`;
  }
  const clampY = (y: number) => Math.max(yMin, Math.min(yMax, y));
  let d = `M${pts[0]![0]} ${pts[0]![1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[Math.min(pts.length - 1, i + 2)]!;
    // Gentler cardinal spline → rounded hills instead of sharp triangles
    const cp1x = p1[0] + (p2[0] - p0[0]) / 5;
    const cp1y = clampY(p1[1] + (p2[1] - p0[1]) / 5);
    const cp2x = p2[0] - (p3[0] - p1[0]) / 5;
    const cp2y = clampY(p2[1] - (p3[1] - p1[1]) / 5);
    d += ` C${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2[0]} ${p2[1]}`;
  }
  return d;
}

function niceAxisMax(raw: number) {
  const n = Math.max(1, raw);
  if (n <= 5) return n;
  const exp = Math.pow(10, Math.floor(Math.log10(n)));
  const m = n / exp;
  const nice = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return Math.ceil(nice * exp);
}

function axisTicks(max: number) {
  const steps = max <= 5 ? max : 5;
  const vals: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const v = Math.round((max * i) / steps);
    if (!vals.includes(v)) vals.push(v);
  }
  if (vals[vals.length - 1] !== max) vals.push(max);
  return vals;
}

function CurveChart({ labels, data }: { labels: string[]; data: number[] }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<ChartTipData | null>(null);
  const reveal = useChartReveal(hostRef, `${labels.join("|")}|${data.join(",")}`);
  const W = 760;
  const H = 168;
  const pad = { t: 14, r: 14, b: 26, l: 36 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const max = niceAxisMax(Math.max(1, ...data));
  const xAt = (i: number) =>
    pad.l + (labels.length <= 1 ? iw / 2 : (i / (labels.length - 1)) * iw);
  const yAt = (v: number, anim = false) =>
    pad.t + ih - (v / max) * ih * (anim ? reveal : 1);
  const tipPts = data.map((v, i) => [xAt(i), yAt(v)] as const);
  const animPts = data.map((v, i) => [xAt(i), yAt(v, true)] as const);
  const baseY = pad.t + ih;
  const line = smoothCurvePath(animPts, pad.t, baseY);
  const area =
    animPts.length > 0
      ? `${line} L${animPts[animPts.length - 1]![0]} ${baseY} L${animPts[0]![0]} ${baseY} Z`
      : "";
  const tickVals = axisTicks(max);

  return (
    <div
      className="ai-curve-wrap v1-chart-host"
      ref={hostRef}
      onMouseLeave={() => setTip(null)}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="ai-curve-svg" aria-hidden>
        {tickVals.map((val) => {
          const y = pad.t + ih * (1 - val / max);
          return (
            <g key={val}>
              <line x1={pad.l} x2={W - pad.r} y1={y} y2={y} stroke={PAL.line} strokeWidth={1} />
              <text x={pad.l - 6} y={y + 3} textAnchor="end" fontSize={10} fill="var(--ink-2)">
                {fmtN(val)}
              </text>
            </g>
          );
        })}
        {area ? <path d={area} fill={`${PAL.red}22`} pointerEvents="none" /> : null}
        {line ? (
          <path
            d={line}
            fill="none"
            stroke={PAL.red}
            strokeWidth={2.25}
            pointerEvents="none"
          />
        ) : null}
        {tipPts.map((p, i) => (
          <circle
            key={i}
            cx={p[0]}
            cy={p[1]}
            r={5}
            fill={PAL.red}
            style={{ cursor: "pointer" }}
            onMouseMove={(e) =>
              setTip(
                tipFromEvent(e, hostRef.current, {
                  title: labels[i] || "",
                  rows: [{ color: PAL.red, text: fmtN(data[i] || 0) }],
                }),
              )
            }
            onMouseLeave={() => setTip(null)}
          />
        ))}
        {labels.map((lab, i) => {
          const x = xAt(i);
          return (
            <text key={lab + i} x={x} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--ink-2)">
              {lab}
            </text>
          );
        })}
      </svg>
      <ChartTip tip={tip} />
    </div>
  );
}

function countsForLabels(
  labels: string[],
  counts: Map<string, number>,
): [string, number][] {
  const ordered = labels.map((label) => [label, counts.get(label) || 0] as [string, number]);
  const known = new Set(labels);
  const extras = [...counts.entries()]
    .filter(([k, n]) => n > 0 && !known.has(k))
    .sort((a, b) => b[1] - a[1]);
  return [...ordered, ...extras];
}

function withCounts(entries: [string, number][]) {
  return entries.filter(([, n]) => n > 0);
}

function KpiTile({
  title,
  icon,
  value,
  sub,
}: {
  title: string;
  icon: string;
  value: number | string;
  sub: string;
}) {
  return (
    <div className="v1-kpi">
      <div className="t">
        <Icon name={icon} size={14} /> {title}
      </div>
      <div className="v">{typeof value === "number" ? fmtN(value) : value}</div>
      <div className="s">{sub}</div>
    </div>
  );
}

/* ---------- New speed violation (drawer) ---------- */
function SpeedNewDrawer({
  open,
  onClose,
  onRegistered,
}: {
  open: boolean;
  onClose: () => void;
  onRegistered: (row: CaseDetail) => void;
}) {
  const actorName = useSignedInName();
  const integ = useIntegSettings(open);
  const localNow = nowLocal();
  const localTime = localNow.includes("T") ? localNow.split("T")[1]!.slice(0, 5) : "";
  const types = useList("speed_violation_type");
  const vehicles = useList("vehicle_type");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [alertSummary, setAlertSummary] = useState("");
  const [itqan, setItqan] = useState<"Yes" | "No">("Yes");
  const [itqanSkipReason, setItqanSkipReason] = useState("");
  const [form, setForm] = useState({
    assign_to: "project" as "project" | "department",
    project_id: "",
    department_id: "",
    speed_violation_type_id: "",
    vehicle_type_id: "",
    model_id: "",
    asset_number: "",
    driver_name: "",
    driver_badge_number: "",
    position_id: "",
    rental_driver: false,
    iqama_number: "",
    location_coordinates: "",
    occurred_on: todayIso(),
    occurred_time: localTime,
    permitted_speed_kmh: "",
    vehicle_speed_kmh: "",
  });
  const positions = useList("driver_position");

  const kind =
    types.items.find((item) => item.id === form.speed_violation_type_id)?.label ?? "";
  const vehicle =
    vehicles.items.find((item) => item.id === form.vehicle_type_id)?.label ?? "";
  const permitted = Number(form.permitted_speed_kmh);
  const recorded = Number(form.vehicle_speed_kmh);
  const speedsReady =
    form.permitted_speed_kmh !== "" &&
    form.vehicle_speed_kmh !== "" &&
    !Number.isNaN(permitted) &&
    !Number.isNaN(recorded);
  const exceedance = speedsReady ? recorded - permitted : null;
  const riskFromSpeed =
    exceedance == null
      ? ""
      : exceedance <= 10
        ? "Low"
        : exceedance <= 20
          ? "Medium"
          : "High";
  const week = weekFromIsoDate(form.occurred_on);
  const permittedAuto = permittedFromCategoryAndRoad(vehicle, kind);

  useEffect(() => {
    if (!open) return;
    setItqan(integ.itqanDefault ? "Yes" : "No");
    setItqanSkipReason("");
  }, [open, integ.itqanDefault]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !permittedAuto) return;
    setForm((c) =>
      c.permitted_speed_kmh === permittedAuto
        ? c
        : { ...c, permitted_speed_kmh: permittedAuto },
    );
  }, [open, permittedAuto]);

  useEffect(() => {
    if (!open) {
      setAlertSummary("");
      return;
    }
    setAlertSummary(
      speedSummaryPreview(
        kind,
        vehicle,
        speedsReady ? permitted : Number.NaN,
        speedsReady ? recorded : Number.NaN,
      ),
    );
  }, [open, kind, vehicle, speedsReady, permitted, recorded]);

  const projectScope = useAutoFormProject(open, form.project_id, (patch) =>
    setForm((c) => ({ ...c, ...patch })),
  );

  if (!open) return null;
  const required = [
    form.assign_to === "project" ? form.project_id : form.department_id,
    form.vehicle_type_id,
    form.model_id,
    form.asset_number.trim(),
    form.driver_name.trim(),
    form.driver_badge_number.trim(),
    form.position_id,
    form.rental_driver ? form.iqama_number.trim() : "ok",
    form.speed_violation_type_id,
    form.location_coordinates.trim(),
    form.occurred_on,
    form.occurred_time,
    form.permitted_speed_kmh !== "" && !Number.isNaN(permitted) ? "ok" : "",
    form.vehicle_speed_kmh !== "" && !Number.isNaN(recorded) ? "ok" : "",
    evidenceFile ? "ok" : "",
    actorName,
    itqan === "No" ? itqanSkipReason.trim() : "ok",
  ];
  const completed = required.filter(Boolean).length;
  const remaining = required.length - completed;
  const canRegister = remaining === 0 && !saving;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canRegister || !evidenceFile) return;
    setSaving(true);
    setError(null);
    try {
      const uploaded = await uploadImage(evidenceFile);
      const created = await postJson<CaseDetail>("/api/v1/speed-violations", {
        assign_to: form.assign_to,
        project_id: form.assign_to === "project" ? form.project_id : null,
        department_id: form.assign_to === "department" ? form.department_id : null,
        speed_violation_type_id: form.speed_violation_type_id,
        vehicle_type_id: form.vehicle_type_id,
        model_id: form.model_id,
        asset_number: form.asset_number,
        driver_name: form.driver_name,
        driver_badge_number: form.driver_badge_number,
        position:
          positions.items.find((item) => item.id === form.position_id)?.label || "",
        rental_driver: form.rental_driver,
        iqama_number: form.rental_driver ? form.iqama_number : null,
        location_coordinates: form.location_coordinates,
        occurred_on: form.occurred_on,
        occurred_time: form.occurred_time,
        permitted_speed_kmh: permitted,
        vehicle_speed_kmh: recorded,
        reported_by: actorName,
        fms_evidence: uploaded.url,
        upload_to_itqan: itqan === "Yes",
        itqan_skip_reason: itqan === "No" ? itqanSkipReason : null,
      });
      onRegistered(created);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="scrim"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="drawer drawer-page"
        role="dialog"
        aria-modal="true"
        aria-label="New Speed Violation"
      >
        <div className="drawer-hd">
          <div>
            <div className="sub">SCC Platform / New Speed Violation</div>
            <h2>New Speed Violation</h2>
          </div>
          <button type="button" className="iconbtn" aria-label="Close" onClick={onClose}>
            <Icon name="x" size={18} />
          </button>
        </div>
        <form className="drawer-body" onSubmit={(e) => void onSubmit(e)}>
          <div className="ai-form-hint">
            <span>
              <span className="req">*</span> Required fields. Register stays disabled until every
              required field is completed.
            </span>
            <span className="ai-form-progress">
              <span className="progress">
                <i style={{ width: `${pct(completed, required.length)}%` }} />
              </span>
              <b className="mono">
                {completed} of {required.length} completed
              </b>
            </span>
          </div>

          <div className="form-grid dc-form">
            <section className="v1-card">
              <h3>Project or department</h3>
              <p className="sub">Select either a project or a department (one of the two).</p>
              <div className="fgrid assign-row">
                <div className="fld-ctl">
                  <span className="lbl">
                    Assign to <span className="req">*</span>
                  </span>
                  <div className="radio-pills" role="radiogroup" aria-label="Assign to">
                    {(["project", "department"] as const).map((opt) => (
                      <label
                        key={opt}
                        className={`radio-pill${form.assign_to === opt ? " is-on" : ""}`}
                      >
                        <input
                          type="radio"
                          name="assign"
                          checked={form.assign_to === opt}
                          onChange={() =>
                            setForm((c) => ({
                              ...c,
                              assign_to: opt,
                              project_id: opt === "project" ? c.project_id : "",
                              department_id: opt === "department" ? c.department_id : "",
                            }))
                          }
                        />
                        <span className="radio-dot" aria-hidden />
                        <span>{opt === "project" ? "Project" : "Department"}</span>
                      </label>
                    ))}
                  </div>
                </div>
                {form.assign_to === "project" ? (
                  <SelectList
                    label="Project"
                    type="project"
                    value={form.project_id}
                    onChange={(project_id) =>
                      setForm((c) => ({ ...c, project_id, department_id: "" }))
                    }
                    required
                    hideNotes
                    allowedLabels={projectScope.allowedLabels}
                    disabled={projectScope.lockProjectSelect}
                  />
                ) : (
                  <SelectList
                    label="Department"
                    type="department"
                    value={form.department_id}
                    onChange={(department_id) =>
                      setForm((c) => ({ ...c, department_id, project_id: "" }))
                    }
                    required
                    hideNotes
                  />
                )}
              </div>
            </section>

            <section className="v1-card">
              <h3>Vehicle and driver</h3>
              <div className="fgrid">
                <AssetFields
                  value={{
                    asset_number: form.asset_number,
                    vehicle_type_id: form.vehicle_type_id,
                    model_id: form.model_id,
                  }}
                  onChange={(next) => setForm((c) => ({ ...c, ...next }))}
                />
                <div className="fld">
                  <label className="fld-ctl">
                    <span className="lbl">
                      Driver name <span className="req">*</span>
                    </span>
                    <input
                      required
                      value={form.driver_name}
                      onChange={(e) => setForm({ ...form, driver_name: e.target.value })}
                      placeholder="Driver full name"
                    />
                  </label>
                </div>
                <div className="fld">
                  <label className="fld-ctl">
                    <span className="lbl">
                      Driver badge number <span className="req">*</span>
                    </span>
                    <input
                      required
                      value={form.driver_badge_number}
                      onChange={(e) => setForm({ ...form, driver_badge_number: e.target.value })}
                      placeholder="Badge number"
                    />
                  </label>
                </div>
                <div className="fld">
                  <SelectList
                    label="Position"
                    type="driver_position"
                    value={form.position_id}
                    onChange={(position_id) => setForm((c) => ({ ...c, position_id }))}
                    required
                    hideNotes
                    hint="Driver's job position"
                  />
                </div>
                <div className="fld">
                  <span className="field-label lbl">Rental driver</span>
                  <div className="radio-pills" role="radiogroup" aria-label="Rental driver">
                    {([false, true] as const).map((opt) => (
                      <label
                        key={String(opt)}
                        className={`radio-pill${form.rental_driver === opt ? " is-on" : ""}`}
                      >
                        <input
                          type="radio"
                          name="rental"
                          checked={form.rental_driver === opt}
                          onChange={() =>
                            setForm({
                              ...form,
                              rental_driver: opt,
                              iqama_number: opt ? form.iqama_number : "",
                            })
                          }
                        />
                        <span className="radio-dot" aria-hidden />
                        <span>{opt ? "Yes" : "No"}</span>
                      </label>
                    ))}
                  </div>
                </div>
                {form.rental_driver ? (
                  <div className="fld full">
                    <label className="fld-ctl">
                      <span className="lbl">
                        Iqama number <span className="req">*</span>
                      </span>
                      <input
                        required
                        value={form.iqama_number}
                        onChange={(e) => setForm({ ...form, iqama_number: e.target.value })}
                        placeholder="Iqama number"
                      />
                    </label>
                  </div>
                ) : null}
                <div className="fld full">
                  <label className="fld-ctl">
                    <span className="lbl">
                      FMS evidence <span className="req">*</span>
                    </span>
                    <span className="dropzone">
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/*"
                        onChange={(e) =>
                          setEvidenceFile(e.target.files?.[0] ?? null)
                        }
                      />
                      <strong>Drop a picture here or browse</strong>
                      <span>
                        {evidenceFile?.name ||
                          "Image from FMS, uploaded at registration"}
                      </span>
                    </span>
                  </label>
                </div>
              </div>
            </section>

            <aside className="aside grid">
              <section className="v1-card">
                <h3>Record status</h3>
                <div className="kv one">
                  <div>
                    <span>Status</span>
                    <b>
                      <StatusPill status="open" />
                    </b>
                  </div>
                  <div>
                    <span>Case ID</span>
                    <b className="muted">Generated on save</b>
                  </div>
                </div>
                <p className="hint" style={{ marginTop: 8 }}>
                  Set by the system. New records start as Open.
                </p>
              </section>
              <section className="v1-card">
                <h3>What happens next</h3>
                <div className="steps">
                  <div>
                    <i>1</i>
                    <span>
                      <b>Register</b>
                      <span>Complete every required field and register. Status: Open.</span>
                    </span>
                  </div>
                  <div>
                    <i>2</i>
                    <span>
                      <b>Confirm Driver &amp; Submit</b>
                      <span>
                        Verify the driver, attach the ITQAN proof (when uploading). Status: Under
                        Review.
                      </span>
                    </span>
                  </div>
                  <div>
                    <i>3</i>
                    <span>
                      <b>Review</b>
                      <span>Admin approves (Closed) or rejects with a reason (Open).</span>
                    </span>
                  </div>
                </div>
              </section>
            </aside>

            <section className="v1-card dc-span">
              <h3>Violation details</h3>
              <div className="fgrid">
                <div className="fld full">
                  <span className="field-label lbl">
                    Speed violation type <span className="req">*</span>
                  </span>
                  <div className="radio-pills" role="radiogroup" aria-label="Speed violation type">
                    {[...types.items]
                      .sort((a, b) => {
                        const rank = (label: string) =>
                          label.toLowerCase().includes("public") ? 0 : 1;
                        return rank(a.label) - rank(b.label);
                      })
                      .map((item) => {
                        const active = form.speed_violation_type_id === item.id;
                        return (
                          <label
                            key={item.id}
                            className={`radio-pill${active ? " is-on" : ""}`}
                          >
                            <input
                              type="radio"
                              name="speed_violation_type"
                              checked={active}
                              onChange={() =>
                                setForm((c) => {
                                  const category =
                                    vehicles.items.find((v) => v.id === c.vehicle_type_id)
                                      ?.label ?? "";
                                  const nextPermitted = permittedFromCategoryAndRoad(
                                    category,
                                    item.label,
                                  );
                                  return {
                                    ...c,
                                    speed_violation_type_id: item.id,
                                    permitted_speed_kmh: nextPermitted || c.permitted_speed_kmh,
                                  };
                                })
                              }
                            />
                            <span className="radio-dot" aria-hidden />
                            <span>{item.label}</span>
                          </label>
                        );
                      })}
                  </div>
                </div>
                <div className="fld full">
                  <label className="fld-ctl">
                    <span className="lbl">
                      Location coordinates <span className="req">*</span>
                    </span>
                    <input
                      required
                      placeholder="[Latitude, Longitude]"
                      value={form.location_coordinates}
                      onChange={(e) =>
                        setForm({ ...form, location_coordinates: e.target.value })
                      }
                    />
                  </label>
                </div>
                <div className="fld">
                  <label className="fld-ctl">
                    <span className="lbl">
                      Date <span className="req">*</span>
                    </span>
                    <input
                      type="date"
                      required
                      value={form.occurred_on}
                      onChange={(e) => setForm({ ...form, occurred_on: e.target.value })}
                    />
                  </label>
                </div>
                <div className="fld">
                  <label className="fld-ctl">
                    <span className="lbl">Week</span>
                    <input readOnly value={week ? `Week ${week}` : ""} />
                    <span className="hint">Calculated from the date</span>
                  </label>
                </div>
                <div className="fld">
                  <label className="fld-ctl">
                    <span className="lbl">
                      Time <span className="req">*</span>
                    </span>
                    <input
                      type="time"
                      required
                      value={form.occurred_time}
                      onChange={(e) => setForm({ ...form, occurred_time: e.target.value })}
                    />
                  </label>
                </div>
                <div className="fld">
                  <label className="fld-ctl">
                    <span className="lbl">
                      Permitted speed (km/h) <span className="req">*</span>
                    </span>
                    <span className="unit-input">
                      <input
                        type="number"
                        min={0}
                        required
                        readOnly={Boolean(permittedAuto)}
                        value={form.permitted_speed_kmh}
                        onChange={(e) =>
                          setForm({ ...form, permitted_speed_kmh: e.target.value })
                        }
                      />
                      <span className="unit">km/h</span>
                    </span>
                    <span className="hint">
                      Filled from Asset Category and Public Road / ROW limits
                    </span>
                  </label>
                </div>
                <div className="fld">
                  <label className="fld-ctl">
                    <span className="lbl">
                      Vehicle speed (km/h) <span className="req">*</span>
                    </span>
                    <span className="unit-input">
                      <input
                        type="number"
                        min={0}
                        required
                        value={form.vehicle_speed_kmh}
                        onChange={(e) =>
                          setForm({ ...form, vehicle_speed_kmh: e.target.value })
                        }
                      />
                      <span className="unit">km/h</span>
                    </span>
                  </label>
                </div>
                <div className="fld">
                  <label className="fld-ctl">
                    <span className="lbl">Exceedance</span>
                    <input
                      readOnly
                      value={
                        exceedance == null
                          ? ""
                          : `${exceedance >= 0 ? "+" : ""}${exceedance} km/h`
                      }
                      placeholder="Filled when both speeds are entered"
                    />
                  </label>
                </div>
                <div className="fld full">
                  <label className="fld-ctl">
                    <span className="lbl">Risk level</span>
                    <input
                      readOnly
                      value={riskFromSpeed}
                      placeholder="Filled from exceedance"
                    />
                    <span className="hint">
                      Automatic: ≤10 Low · 11–20 Medium · &gt;20 High
                    </span>
                  </label>
                </div>
                <div className="fld full">
                  <label className="fld-ctl">
                    <span className="lbl">Alert summary</span>
                    <textarea
                      readOnly
                      rows={4}
                      value={alertSummary}
                      placeholder="Fills in from vehicle type, violation type, and speeds"
                    />
                  </label>
                </div>
                {integ.itqanAsk ? (
                  <div className="fld full">
                    <span className="field-label lbl">
                      Upload to ITQAN at Confirm Driver &amp; Submit?{" "}
                      <span className="req">*</span>
                    </span>
                    <div className="radio-pills" role="radiogroup" aria-label="Upload to ITQAN">
                      {(["Yes", "No"] as const).map((opt) => (
                        <label
                          key={opt}
                          className={`radio-pill${itqan === opt ? " is-on" : ""}`}
                        >
                          <input
                            type="radio"
                            name="itqan"
                            checked={itqan === opt}
                            onChange={() => {
                              setItqan(opt);
                              if (opt === "Yes") setItqanSkipReason("");
                            }}
                          />
                          <span className="radio-dot" aria-hidden />
                          <span>{opt}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="fld full">
                    <div className="note">
                      ITQAN default from Administration:{" "}
                      <b>{itqan === "Yes" ? "Upload to ITQAN" : "Not uploaded"}</b>
                    </div>
                  </div>
                )}
                {itqan === "No" ? (
                  <div className="fld full">
                    <label className="fld-ctl">
                      <span className="lbl">
                        Reason for not uploading to ITQAN <span className="req">*</span>
                      </span>
                      <select
                        required
                        value={itqanSkipReason}
                        onChange={(e) => setItqanSkipReason(e.target.value)}
                      >
                        <option value="">Select</option>
                        {ITQAN_SKIP_REASONS.map((reason) => (
                          <option key={reason} value={reason}>
                            {reason}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ) : null}
                <div className="fld full">
                  <SignedInNameField label="Reported by *" />
                  <span className="hint">Filled in by the system from the logged-in user.</span>
                </div>
              </div>
              <div className="note" style={{ marginTop: 12 }}>
                <Icon name="lock" size={13} /> Confirm Driver &amp; ITQAN proof unlock after the
                record is registered.
              </div>
            </section>
          </div>

          <div className="formbar">
            <span className={`msg${remaining ? "" : " ok"}`}>
              {error
                ? error
                : remaining
                  ? `${remaining} required field${remaining === 1 ? " is" : "s are"} still empty`
                  : "All required fields completed"}
            </span>
            <span className="sp" />
            <button type="button" className="btn sm" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={!canRegister}>
              <Icon name="check" size={14} /> {saving ? "Saving…" : "Register violation"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ---------- Main screen ---------- */
export function SpeedScreen({
  openForm = false,
  focusCaseId,
}: {
  openForm?: boolean;
  focusCaseId?: string;
}) {
  const { user } = useAuth();
  const canRegister = Boolean(user?.capabilities.register);
  const year = new Date().getFullYear();
  const projectList = useList("project");
  const departmentList = useList("department");
  const speedTypeList = useList("speed_violation_type");
  const modelList = useList("model");
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<SpeedView>("overall");
  const [project, setProject] = useState("");
  const [department, setDepartment] = useState("");
  const [period, setPeriod] = useState<PeriodId>("ytd");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [curveMode, setCurveMode] = useState<CurveMode>("week");
  const [drawerOpen, setDrawerOpen] = useState(Boolean(openForm && canRegister));
  const [openRecordId, setOpenRecordId] = useState<string | null>(focusCaseId ?? null);
  const [logStatus, setLogStatus] = useState<LogStatus>("All");
  const [logType, setLogType] = useState("All");
  const [logQ, setLogQ] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await fetchCases({ record_type: "speed" });
      setCases(data.items);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (openForm && canRegister) setDrawerOpen(true);
  }, [openForm, canRegister]);

  useEffect(() => {
    if (focusCaseId) setOpenRecordId(focusCaseId);
  }, [focusCaseId]);

  const range = useMemo(
    () => periodRange(period, customFrom, customTo),
    [period, customFrom, customTo],
  );

  const projects = useMemo(
    () => projectList.items.map((item) => item.label),
    [projectList.items],
  );
  const projectAccess = useProjectAccess(projects);
  useAutoProjectFilter(projectAccess, project, setProject, setView);
  const departments = useMemo(
    () => departmentList.items.map((item) => item.label),
    [departmentList.items],
  );

  const scoped = useMemo(() => {
    let rows = cases.filter(
      (r) => inRange(r, range.a, range.b) && rowAllowedForProjects(r.project, projectAccess),
    );
    if (view === "projects") {
      rows = rows.filter((r) => Boolean(r.project));
      if (project) rows = rows.filter((r) => r.project === project);
    }
    if (view === "departments") {
      rows = rows.filter((r) => Boolean(r.department));
      if (department) rows = rows.filter((r) => r.department === department);
    }
    return rows;
  }, [cases, range, view, project, department, projectAccess]);

  const openN = scoped.filter((r) => r.status === "open").length;
  const reviewN = scoped.filter((r) => r.status === "under_process").length;
  const closedN = scoped.filter((r) => r.status === "closed").length;
  const avgExAll = meanExceedance(scoped);
  const rowN = scoped.filter(isRowType).length;

  const lvRows = scoped.filter(isLv);
  const hvRows = scoped.filter(isHv);
  const lvPublic = lvRows.filter(isPublicType).length;
  const lvRow = lvRows.filter(isRowType).length;
  const hvPublic = hvRows.filter(isPublicType).length;
  const hvRow = hvRows.filter(isRowType).length;
  const lvGaugeMax = Math.max(lvRows.length, Math.round(lvRows.length * 1.25) || 10);
  const hvGaugeMax = Math.max(hvRows.length, Math.round(hvRows.length * 1.25) || 10);

  const projectCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const [k, n] of countBy(
      scoped.filter((r) => r.project),
      (r) => r.project || "",
    )) {
      map.set(k, n);
    }
    return map;
  }, [scoped]);
  const deptCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const [k, n] of countBy(
      scoped.filter((r) => r.department),
      (r) => r.department || "",
    )) {
      map.set(k, n);
    }
    return map;
  }, [scoped]);

  const byProject = useMemo(
    () => withCounts(countsForLabels(projects, projectCounts)),
    [projects, projectCounts],
  );
  const byDept = useMemo(
    () => withCounts(countsForLabels(departments, deptCounts)),
    [departments, deptCounts],
  );

  const modelLabels = useMemo(
    () => modelList.items.map((i) => i.label),
    [modelList.items],
  );

  const byModel = useMemo(() => {
    const map = new Map(countBy(scoped, (r) => field(r, "model") || "Unknown"));
    const labels = modelLabels.length
      ? modelLabels
      : [...map.keys()].sort((a, b) => (map.get(b) || 0) - (map.get(a) || 0));
    return withCounts(countsForLabels(labels, map)).slice(0, 13);
  }, [scoped, modelLabels]);

  const curveFor = useCallback(
    (pred: (r: CaseSummary) => boolean) => {
      const rows = scoped.filter(pred);
      if (curveMode === "month") {
        const now = new Date();
        const labels = MON3.slice(0, now.getMonth() + 1);
        const data = labels.map((_, i) =>
          rows.filter((r) => {
            const d = new Date(`${r.date}T00:00:00`);
            return d.getMonth() === i && d.getFullYear() === now.getFullYear();
          }).length,
        );
        return { labels, data };
      }
      const weeks: { label: string; a: number; b: number }[] = [];
      let ws = weekStart(new Date());
      for (let i = 0; i < 12; i++) {
        const a = ws.getTime();
        const b = a + 7 * DAY_MS - 1;
        weeks.unshift({ label: `W${weekNo(ws)}`, a, b });
        ws = new Date(a - 7 * DAY_MS);
      }
      return {
        labels: weeks.map((w) => w.label),
        data: weeks.map((w) => rows.filter((r) => inRange(r, w.a, w.b)).length),
      };
    },
    [scoped, curveMode],
  );

  const lvCurve = useMemo(() => curveFor(isLv), [curveFor]);
  const hvCurve = useMemo(() => curveFor(isHv), [curveFor]);

  const overdueN = scoped.filter((r) => {
    const s = slaState(r);
    return s && (s.k === "over" || s.k === "esc");
  }).length;

  const speedTypes = useMemo(() => {
    const fromCatalog = speedTypeList.items.map((i) => i.label);
    if (fromCatalog.length) return fromCatalog;
    return [
      ...new Set(scoped.map((r) => field(r, "speed_violation_type")).filter(Boolean)),
    ].sort() as string[];
  }, [speedTypeList.items, scoped]);

  const logRows = useMemo(() => {
    let rows = scoped.filter((r) => {
      if (logStatus === "All") return true;
      if (logStatus === "Overdue") {
        const s = slaState(r);
        return Boolean(s && (s.k === "over" || s.k === "esc"));
      }
      return statusLabel(r.status) === logStatus;
    });
    if (logType !== "All") rows = rows.filter((r) => field(r, "speed_violation_type") === logType);
    if (logQ.trim()) {
      const q = logQ.trim().toLowerCase();
      rows = rows.filter((r) =>
        [
          r.case_id,
          r.project,
          r.department,
          field(r, "asset_number"),
          field(r, "driver_name"),
          field(r, "driver_badge_number"),
          field(r, "speed_violation_type"),
          field(r, "model"),
          field(r, "alert_summary"),
          r.title,
        ].some((v) => v && String(v).toLowerCase().includes(q)),
      );
    }
    return rows;
  }, [scoped, logStatus, logType, logQ]);

  function exportCsv() {
    const lines = [
      [
        "Case ID",
        "Project",
        "Department",
        "Date",
        "Time",
        "Asset",
        "Driver",
        "Badge",
        "Violation type",
        "Vehicle",
        "Model",
        "Permitted km/h",
        "Recorded km/h",
        "Exceedance km/h",
        "Status",
        "ITQAN",
      ].join(","),
      ...logRows.map((r) =>
        [
          r.case_id,
          r.project || "",
          r.department || "",
          r.date,
          field(r, "occurred_time"),
          field(r, "asset_number"),
          field(r, "driver_name"),
          field(r, "driver_badge_number"),
          field(r, "speed_violation_type"),
          field(r, "vehicle_type"),
          field(r, "model"),
          field(r, "permitted_speed_kmh"),
          field(r, "vehicle_speed_kmh"),
          field(r, "exceedance_kmh") || exceedanceOf(r),
          statusLabel(r.status),
          itqanLabel(r),
        ]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "speed-violations-log.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <p className="state">Loading speed violations…</p>;
  if (error) return <p className="state error">{error}</p>;

  return (
    <section className="page v1-dash ai-module">
      <section className="v1-banner">
        <div className="v1-banner-icon">
          <Icon name="gauge" size={30} />
        </div>
        <div className="v1-banner-copy">
          <h1>
            SPEED VIOLATIONS <em>DASHBOARD {year}</em>
          </h1>
          <p>
            Real-Time Monitoring <i>•</i> Smarter Decisions <i>•</i> Safer Operations
          </p>
        </div>
        <div className="v1-banner-actions">
          {canRegister ? (
            <button type="button" className="btn primary" onClick={() => setDrawerOpen(true)}>
              <Icon name="plus" size={14} /> New Speed Violation
            </button>
          ) : null}
        </div>
      </section>

      <div className="v1-filters">
        <div className="grp">
          <label className="k">View</label>
          <div className="seg">
            <ProjectOnlyViewSeg
              view={view}
              setView={setView}
              restrictToProject={projectAccess.isProjectScoped}
              options={[
                ["overall", "Over All"],
                ["projects", "By Project"],
                ["departments", "By Department"],
              ]}
            />
          </div>
          {view === "projects" ? (
            <select
              className="sel"
              value={project}
              onChange={(e) => setProject(e.target.value)}
              aria-label="Project"
              disabled={Boolean(projectAccess.singleProject)}
            >
              {!projectAccess.singleProject ? <option value="">All</option> : null}
              {projectAccess.accessProjects.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          ) : null}
          {view === "departments" ? (
            <select
              className="sel"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              aria-label="Department"
            >
              <option value="">All</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          ) : null}
        </div>
        <div className="grp">
          <label className="k">Period</label>
          <select
            className="sel"
            value={period}
            onChange={(e) => setPeriod(e.target.value as PeriodId)}
            aria-label="Period"
          >
            <option value="today">Today</option>
            <option value="this_week">This week</option>
            <option value="last_week">Last week</option>
            <option value="this_month">This month</option>
            <option value="last_month">Last month</option>
            <option value="ytd">Year to date</option>
            <option value="custom">Custom range</option>
          </select>
          {period === "custom" ? (
            <>
              <input
                type="date"
                className="inp"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                aria-label="From"
              />
              <span className="muted">to</span>
              <input
                type="date"
                className="inp"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                aria-label="To"
              />
            </>
          ) : null}
        </div>
        <div className="range">
          <b>{range.label}</b>
          <br />
          {range.cmp ? `Compared with ${range.cmp}` : "Compared month by month"}
        </div>
      </div>

      <div className="v1-grid g6">
        <KpiTile title="Total" icon="report" value={scoped.length} sub="in the selected period" />
        <KpiTile title="Open" icon="alert" value={openN} sub="waiting for the next step" />
        <KpiTile title="Under Review" icon="clock" value={reviewN} sub="waiting for Admin review" />
        <KpiTile title="Closed" icon="review" value={closedN} sub="approved and closed" />
        <KpiTile
          title="Average exceedance"
          icon="gauge"
          value={`+${fmtN(avgExAll)} km/h`}
          sub="over the permitted speed"
        />
        <KpiTile
          title="ROW violations"
          icon="road"
          value={rowN}
          sub="zone speed limit 40 km/h"
        />
      </div>

      <div className="v1-grid g2">
        <GaugeWithStats
          title="Light vehicle speed violations"
          value={lvRows.length}
          max={lvGaugeMax}
          publicN={lvPublic}
          rowN={lvRow}
          avgEx={meanExceedance(lvRows)}
        />
        <GaugeWithStats
          title="Heavy vehicle speed violations"
          value={hvRows.length}
          max={hvGaugeMax}
          publicN={hvPublic}
          rowN={hvRow}
          avgEx={meanExceedance(hvRows)}
        />
      </div>

      <div className="v1-grid g2eq">
        <article className="v1-card">
          <h3>LV violations per date</h3>
          <div className="seg" style={{ alignSelf: "flex-start" }}>
            <button
              type="button"
              className={curveMode === "week" ? "on" : undefined}
              onClick={() => setCurveMode("week")}
            >
              By week
            </button>
            <button
              type="button"
              className={curveMode === "month" ? "on" : undefined}
              onClick={() => setCurveMode("month")}
            >
              By month
            </button>
          </div>
          <CurveChart labels={lvCurve.labels} data={lvCurve.data} />
        </article>
        <article className="v1-card">
          <h3>HV violations per date</h3>
          <div className="seg" style={{ alignSelf: "flex-start" }}>
            <button
              type="button"
              className={curveMode === "week" ? "on" : undefined}
              onClick={() => setCurveMode("week")}
            >
              By week
            </button>
            <button
              type="button"
              className={curveMode === "month" ? "on" : undefined}
              onClick={() => setCurveMode("month")}
            >
              By month
            </button>
          </div>
          <CurveChart labels={hvCurve.labels} data={hvCurve.data} />
        </article>
      </div>

      <div className="v1-grid g3">
        <article className="v1-card">
          <h3>Violations per type (model)</h3>
          <HBarChart entries={byModel} color={PAL.steel} height={300} />
        </article>
        <article className="v1-card">
          <h3>Exceedance over the limit</h3>
          <p className="sub">Vehicle speed minus permitted speed</p>
          <ExceedanceBars rows={scoped} />
        </article>
        <article className="v1-card">
          <h3>Observations status</h3>
          <StatusDonut rows={scoped} />
        </article>
      </div>

      <article className="v1-card">
        <h3>By project and department</h3>
        <p className="sub">Each violation is assigned to a project or to a department.</p>
        <div className="dc-loc">
          <div>
            <div className="dc-loc-h">Projects</div>
            <BarsList entries={byProject} color={() => PAL.red} />
          </div>
          <div>
            <div className="dc-loc-h">Departments</div>
            <BarsList entries={byDept} color={() => PAL.steel} />
          </div>
        </div>
      </article>

      <section className="v1-card ai-log">
        <div className="hd">
          <div>
            <h3>
              Violations summary{" "}
              <small>
                {fmtN(logRows.length)} of {fmtN(scoped.length)} in the selected period · click a row
                to open it
              </small>
            </h3>
          </div>
          {canRegister ? (
            <button type="button" className="btn sm primary" onClick={() => setDrawerOpen(true)}>
              <Icon name="plus" size={13} /> New Speed Violation
            </button>
          ) : null}
        </div>

        <div className="ai-log-filters">
          <div className="chips">
            {(
              [
                ["All", scoped.length],
                ["Open", openN],
                ["Under Review", reviewN],
                ["Closed", closedN],
              ] as const
            ).map(([s, n]) => (
              <button
                key={s}
                type="button"
                className={`chip${logStatus === s ? " is-active" : ""}`}
                onClick={() => setLogStatus(s)}
              >
                {s} <span className="n">{n}</span>
              </button>
            ))}
            <button
              type="button"
              className={`chip${logStatus === "Overdue" ? " is-active" : ""}`}
              style={overdueN ? { color: "var(--red)" } : undefined}
              onClick={() => setLogStatus("Overdue")}
            >
              <Icon name="alert" size={12} /> Overdue <span className="n">{overdueN}</span>
            </button>
          </div>
          <div className="ai-log-right">
            <select
              className="sel"
              value={logType}
              onChange={(e) => setLogType(e.target.value)}
              aria-label="Violation types"
            >
              <option value="All">All violation types</option>
              {speedTypes.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <div className="search ai-log-search">
              <span>
                <Icon name="search" size={14} />
              </span>
              <input
                value={logQ}
                onChange={(e) => setLogQ(e.target.value)}
                placeholder="Case ID, driver, asset…"
                aria-label="Search log"
              />
            </div>
          </div>
        </div>

        <div className="tbl-wrap ai-log-scroll">
          <table className="tbl log">
            <thead>
              <tr>
                <th />
                <th>Case ID</th>
                <th>Project / Dept</th>
                <th>Date</th>
                <th>Asset</th>
                <th>Driver / Badge</th>
                <th>Type</th>
                <th>Vehicle</th>
                <th>Exceedance</th>
                <th>Status</th>
                <th>ITQAN</th>
              </tr>
            </thead>
            <tbody>
              {logRows.length ? (
                logRows.map((r) => {
                  const sla = slaState(r);
                  const overdue = Boolean(sla && (sla.k === "over" || sla.k === "esc"));
                  const time = field(r, "occurred_time");
                  const ex = exceedanceOf(r);
                  return (
                    <tr
                      key={r.id}
                      className={`clk${overdue ? " overdue" : ""}`}
                      onClick={() => setOpenRecordId(r.id)}
                    >
                      <td>
                        <Thumb row={r} />
                      </td>
                      <td>
                        <span className="id">{r.case_id}</span>
                      </td>
                      <td>{scopeLabel(r)}</td>
                      <td>
                        <span className="num nw">
                          {formatDay(r.date)}
                          <br />
                          <small className="muted">
                            {time || "—"} · W{r.week_number}
                          </small>
                        </span>
                      </td>
                      <td className="mono">{field(r, "asset_number") || "—"}</td>
                      <td>
                        <span className="nw">
                          {field(r, "driver_name") || "—"}
                          <br />
                          <small className="muted">{field(r, "driver_badge_number") || "—"}</small>
                        </span>
                      </td>
                      <td>{field(r, "speed_violation_type") || "—"}</td>
                      <td>
                        <span className="clip" title={`${field(r, "vehicle_type")} ${field(r, "model")}`}>
                          {[field(r, "vehicle_type"), field(r, "model")].filter(Boolean).join(" · ") ||
                            "—"}
                        </span>
                      </td>
                      <td className="mono">
                        {Number.isFinite(ex) ? `+${ex} km/h` : "—"}
                      </td>
                      <td>
                        <StatusPill status={r.status} />
                      </td>
                      <td>
                        <span
                          className={`tagx${
                            itqanLabel(r) === "Uploaded"
                              ? " green"
                              : itqanLabel(r) === "To upload"
                                ? " amber"
                                : ""
                          }`}
                        >
                          {itqanLabel(r)}
                        </span>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={11} className="empty">
                    No records match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="pager">
          <span>
            Showing {Math.min(10, logRows.length)} of {fmtN(logRows.length)}
            {logRows.length > 10 ? " · scroll for more" : ""}
          </span>
          <button type="button" className="btn sm" onClick={exportCsv}>
            <Icon name="download" size={13} /> Export Excel
          </button>
        </div>
      </section>

      <SpeedNewDrawer
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          if (openForm) window.location.hash = href({ name: "list", type: "speed" });
        }}
        onRegistered={(row) => {
          setDrawerOpen(false);
          void load().then(() => setOpenRecordId(row.id));
          notifyCasesChanged();
        }}
      />
      <SpeedRecordDrawer
        caseId={openRecordId}
        onClose={() => {
          setOpenRecordId(null);
          if (focusCaseId) {
            window.location.hash = href({ name: "list", type: "speed" });
          }
        }}
        onChanged={() => {
          void load();
          notifyCasesChanged();
        }}
      />
    </section>
  );
}
