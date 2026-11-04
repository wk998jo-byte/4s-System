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
import {
  rowAllowedForProjects,
  useAutoFormProject,
  useAutoProjectFilter,
  useProjectAccess,
} from "../lib/useProjectAccess";
import {
  SAFELIFE_SKIP_REASONS,
  useIntegSettings,
} from "../lib/integSettings";
import { href } from "../lib/routing";
import { AiCameraRecordDrawer } from "./AiCameraRecordDrawer";
import { ChartTip, tipFromEvent, type ChartTipData } from "./chartTip";
import {SelectList,
  SignedInNameField,
  StatusPill,
  RiskPill,
  nowLocal,
  todayIso,
  useList,
  useSignedInName,
  weekFromIsoDate,
  ProjectOnlyViewSeg,
} from "./shared";

type DashView = "overall" | "projects";
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
const SLA_LABEL: Record<string, string> = {
  High: "24 hours",
  Medium: "3 days",
  Low: "7 days",
};
const SAFELIFE_NO =
  "SafeLife entry is completed by the HSEO at the site. Operator marks Not updated when registration does not include a SafeLife reference.";

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
  // Date-only rows must include all of "today" — wall-clock `now` drops
  // same-day records when compared against noon/midnight timestamps.
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

function riskKey(row: CaseSummary): string {
  return (row.risk_level || "").replace(/\s*Risk$/i, "").trim() || "Low";
}

function statusLabel(status: string): string {
  if (status === "under_process") return "Under Review";
  if (status === "open") return "Open";
  if (status === "closed") return "Closed";
  return status;
}

function alertTypeOf(row: CaseSummary): string {
  return field(row, "alert_type") || "Unsafe Act";
}

function isPositive(row: CaseSummary) {
  return alertTypeOf(row).toLowerCase() === "positive";
}

function inRange(row: CaseSummary, a: number, b: number) {
  // Compare by calendar day (start-of-day) so morning registrations still
  // fall inside YTD / Today / This week before wall-clock noon.
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

function fmtDur(hours: number) {
  if (hours < 24) return `${hours.toFixed(1)} h`;
  const d = hours / 24;
  if (d < 7) return `${d.toFixed(1)} days`;
  return `${(d / 7).toFixed(1)} wk`;
}

type SlaState =
  | { k: "ok"; left: number }
  | { k: "soon"; left: number; label: string }
  | { k: "over" | "esc"; over: number; label: string }
  | null;

function slaState(row: CaseSummary, now = Date.now()): SlaState {
  // Close-out deadline ends once close-out is submitted (Under Review) or closed.
  if (row.status !== "open") return null;
  if (field(row, "close_out_action") || field(row, "close_out_picture")) return null;
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
    case "cctv":
      return (
        <svg {...c}>
          <path d="M2 8l14-4 2 6-14 4z" />
          <path d="M6 13l1 4h4" />
          <circle cx="18" cy="17" r="3" />
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
          <path d="M5 12l4 4L19 6" />
        </svg>
      );
    case "shield":
      return (
        <svg {...c}>
          <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    case "sync":
      return (
        <svg {...c}>
          <path d="M21 12a9 9 0 1 1-2.3-6" />
          <path d="M21 3v6h-6" />
        </svg>
      );
    case "search":
      return (
        <svg {...c}>
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
      );
    case "download":
      return (
        <svg {...c}>
          <path d="M12 4v10M8 10l4 4 4-4M5 18h14" />
        </svg>
      );
    case "check":
      return (
        <svg {...c}>
          <path d="M5 12l4 4L19 6" />
        </svg>
      );
    case "x":
      return (
        <svg {...c}>
          <path d="M6 6l12 12M18 6L6 18" />
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
    <div
      className="ai-gauge"
      ref={hostRef}
      onMouseLeave={() => setTip(null)}
    >
      <svg viewBox="0 0 180 118" className="ai-gauge-svg" aria-hidden>
        <path
          d="M20 78 A70 70 0 0 1 160 78"
          fill="none"
          stroke={PAL.line}
          strokeWidth="14"
          strokeLinecap="round"
          pointerEvents="none"
        />
        <path
          d="M20 78 A70 70 0 0 1 160 78"
          fill="none"
          stroke={PAL.red}
          strokeWidth="14"
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

function RiskBars({ rows }: { rows: CaseSummary[] }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<ChartTipData | null>(null);
  const labels = ["Low", "Medium", "High", "Positive"] as const;
  const data = labels.map((k) => {
    if (k === "Positive") return rows.filter(isPositive).length;
    return rows.filter((r) => riskKey(r) === k && !isPositive(r)).length;
  });
  const colors = [PAL.sand, PAL.amber, PAL.red, PAL.olive];
  const max = niceAxisMax(Math.max(1, ...data));
  const reveal = useChartReveal(hostRef, data.join(","));
  const ticks = 5;
  const W = 340;
  const H = 190;
  const pad = { t: 12, r: 12, b: 36, l: 40 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const bw = iw / labels.length - 16;

  return (
    <div className="v1-chart-host" ref={hostRef} onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="ai-risk-svg" role="img" aria-label="Risk level">
        {Array.from({ length: ticks + 1 }, (_, i) => {
          const f = i / ticks;
          const y = pad.t + ih * (1 - f);
          const val = Math.round(max * f);
          return (
            <g key={f}>
              <line
                x1={pad.l}
                x2={W - pad.r}
                y1={y}
                y2={y}
                stroke={PAL.line}
                strokeWidth={1}
              />
              <text
                x={pad.l - 6}
                y={y + 3}
                textAnchor="end"
                fontSize={10}
                fill="var(--ink-2)"
              >
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
          const title = label === "Positive" ? "Positive" : `${label} Risk`;
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
                        title,
                        rows: [{ color: colors[i]!, text: fmtN(v) }],
                      }),
                    )
                  }
                  onMouseLeave={() => setTip(null)}
                />
              ) : null}
              <text
                x={x + bw / 2}
                y={H - 10}
                textAnchor="middle"
                fontSize={11}
                fill="var(--ink-2)"
              >
                {title}
              </text>
            </g>
          );
        })}
      </svg>
      <ChartTip tip={tip} />
    </div>
  );
}

function HBarChart({
  entries,
  color = PAL.steel,
  height = 300,
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
  const rowH = Math.max(24, Math.min(32, (height - 20) / Math.max(1, entries.length)));
  const H = Math.max(height, entries.length * rowH + 20);
  const W = 420;
  const labelW = 150;
  const barX = labelW + 8;
  const barW = W - barX - 48;

  if (!entries.length) {
    return <p className="empty">No records.</p>;
  }

  return (
    <div className="v1-chart-host" ref={hostRef} onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="ai-hbar-svg" style={{ height }} aria-hidden>
        {entries.map(([k, v], i) => {
          const y = 8 + i * rowH;
          const w = (v / max) * barW * reveal;
          const fill = typeof color === "function" ? color(k) : color;
          const label = k.length > 24 ? `${k.slice(0, 23)}…` : k;
          return (
            <g key={k}>
              <text x={0} y={y + rowH * 0.62} fontSize={11.5} fill="var(--ink-2)">
                {label}
              </text>
              <rect
                x={barX}
                y={y + 4}
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
  color?: string | ((k: string) => string);
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<ChartTipData | null>(null);
  const max = Math.max(1, ...entries.map((e) => e[1]));
  const reveal = useChartReveal(
    hostRef,
    entries.map(([k, v]) => `${k}:${v}`).join("|"),
  );
  if (!entries.length) return <p className="empty">No records.</p>;
  return (
    <div className="ai-bars" ref={hostRef} onMouseLeave={() => setTip(null)}>
      {entries.map(([k, v]) => {
        const fill = typeof color === "function" ? color(k) : color || PAL.steel;
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

function OpsChart({ entries }: { entries: [string, number][] }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<ChartTipData | null>(null);
  const max = niceAxisMax(Math.max(1, ...entries.map((e) => e[1])));
  const reveal = useChartReveal(
    hostRef,
    entries.map(([k, v]) => `${k}:${v}`).join("|"),
  );
  const W = 360;
  const H = 230;
  const pad = { t: 14, r: 10, b: 48, l: 36 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  if (!entries.length) return <p className="empty">No records.</p>;
  const bw = Math.min(36, iw / entries.length - 8);
  const ticks = 5;
  return (
    <div className="v1-chart-host" ref={hostRef} onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="ai-ops-svg" aria-hidden>
        {Array.from({ length: ticks + 1 }, (_, i) => {
          const f = i / ticks;
          const y = pad.t + ih * (1 - f);
          return (
            <g key={f}>
              <line
                x1={pad.l}
                x2={W - pad.r}
                y1={y}
                y2={y}
                stroke={PAL.line}
                strokeWidth={1}
              />
              <text x={pad.l - 6} y={y + 3} textAnchor="end" fontSize={10} fill="var(--ink-2)">
                {fmtN(Math.round(max * f))}
              </text>
            </g>
          );
        })}
        {entries.map(([k, v], i) => {
          const h = (v / max) * ih * reveal;
          const x = pad.l + i * (iw / entries.length) + 4;
          const y = pad.t + ih - h;
          const fill = i === 0 ? PAL.red : i < 3 ? PAL.copper : PAL.steel;
          const name = k.split(/\s+/)[0] || k;
          return (
            <g key={k}>
              {v > 0 ? (
                <rect
                  x={x}
                  y={y}
                  width={bw}
                  height={Math.max(2, h)}
                  rx={4}
                  fill={fill}
                  style={{ cursor: "pointer" }}
                  onMouseMove={(e) =>
                    setTip(
                      tipFromEvent(e, hostRef.current, {
                        title: k,
                        rows: [{ color: fill, text: fmtN(v) }],
                      }),
                    )
                  }
                  onMouseLeave={() => setTip(null)}
                />
              ) : null}
              <text
                x={x + bw / 2}
                y={H - 8}
                textAnchor="middle"
                fontSize={10}
                fill="var(--ink-2)"
                transform={`rotate(-35 ${x + bw / 2} ${H - 8})`}
              >
                {name.length > 10 ? `${name.slice(0, 9)}…` : name}
              </text>
            </g>
          );
        })}
      </svg>
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

function CurveChart({
  labels,
  data,
}: {
  labels: string[];
  data: number[];
}) {
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
            <text
              key={lab + i}
              x={x}
              y={H - 6}
              textAnchor="middle"
              fontSize={10}
              fill="var(--ink-2)"
            >
              {lab}
            </text>
          );
        })}
      </svg>
      <ChartTip tip={tip} />
    </div>
  );
}

function Thumb({ row }: { row: CaseSummary }) {
  const src = resolveMediaUrl(field(row, "observation_picture"));
  if (src) {
    return (
      <span className="ai-thumb" aria-hidden>
        <img src={src} alt="" loading="lazy" />
      </span>
    );
  }
  let h = 0;
  const seed = row.case_id;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = h % 40;
  return (
    <span
      className="ai-thumb"
      style={{
        background: `linear-gradient(135deg, hsl(${20 + hue} 18% 28%), hsl(${10 + hue} 35% 18%))`,
      }}
      aria-hidden
    />
  );
}

function KpiTile({
  title,
  icon,
  value,
  sub,
}: {
  title: string;
  icon: string;
  value: string | number;
  sub: string;
}) {
  return (
    <div className="v1-kpi">
      <div className="t">
        <span className="ic">
          <Icon name={icon} size={14} />
        </span>
        {title}
      </div>
      <div className="v">{typeof value === "number" ? fmtN(value) : value}</div>
      <div className="s">{sub}</div>
    </div>
  );
}

/* ---------- New observation drawer (matches V1 formDrawer) ---------- */
function AiCameraNewDrawer({
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pictureFile, setPictureFile] = useState<File | null>(null);
  const [safelife, setSafelife] = useState<"Yes" | "No">("Yes");
  const [safelifeSkipReason, setSafelifeSkipReason] = useState("");
  const [form, setForm] = useState({
    project_id: "",
    location: "",
    occurred_on: todayIso(),
    occurred_time: localTime,
    camera_id: "",
    alert_summary: "",
    alert_type_id: "",
    category_id: "",
    category_other: "",
    risk_level_id: "",
    detection_method_id: "",
    safelife_reference: "",
  });
  const detectionList = useList("detection_method");
  const alertTypes = useList("alert_type");
  const categories = useList("ai_camera_category");

  useEffect(() => {
    if (form.detection_method_id) return;
    const ai = detectionList.items.find((i) => i.label.toLowerCase() === "ai");
    if (ai) setForm((c) => ({ ...c, detection_method_id: ai.id }));
  }, [detectionList.items, form.detection_method_id]);

  useEffect(() => {
    if (!open) return;
    setSafelife(integ.safelifeDefault ? "Yes" : "No");
    setSafelifeSkipReason("");
  }, [open, integ.safelifeDefault]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const projectScope = useAutoFormProject(open, form.project_id, (patch) =>
    setForm((c) => ({ ...c, project_id: patch.project_id })),
  );

  if (!open) return null;

  const alertTypeLabel =
    alertTypes.items.find((i) => i.id === form.alert_type_id)?.label || "";
  const isPositiveAlert = alertTypeLabel.toLowerCase() === "positive";
  const categoryLabel =
    categories.items.find((i) => i.id === form.category_id)?.label || "";
  const isOtherCategory = categoryLabel.toLowerCase().startsWith("other");

  const week = weekFromIsoDate(form.occurred_on);
  const required = [
    form.project_id,
    form.location.trim(),
    form.occurred_on,
    form.occurred_time,
    form.alert_type_id,
    form.category_id,
    isOtherCategory ? form.category_other.trim() : "ok",
    isPositiveAlert ? "ok" : form.risk_level_id,
    form.detection_method_id,
    form.alert_summary.trim(),
    pictureFile ? "ok" : "",
    actorName,
    safelife === "Yes" ? form.safelife_reference.trim() : safelifeSkipReason.trim(),
  ];
  const completed = required.filter(Boolean).length;
  const remaining = required.length - completed;
  const canRegister = remaining === 0 && !saving;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canRegister) return;
    if (!pictureFile) return;
    setSaving(true);
    setError(null);
    try {
      const uploaded = await uploadImage(pictureFile);
      const created = await postJson<CaseDetail>("/api/v1/ai-camera-observations", {
        project_id: form.project_id,
        location: form.location,
        occurred_on: form.occurred_on,
        occurred_time: form.occurred_time,
        alert_summary: form.alert_summary,
        alert_type_id: form.alert_type_id,
        category_id: form.category_id,
        category_other: isOtherCategory ? form.category_other.trim() : null,
        risk_level_id: isPositiveAlert ? null : form.risk_level_id,
        detection_method_id: form.detection_method_id,
        camera_id: form.camera_id || null,
        reported_by: actorName,
        observation_picture: uploaded.url,
        updated_in_safelife: safelife === "Yes",
        safelife_reference: safelife === "Yes" ? form.safelife_reference : null,
        safelife_skip_reason: safelife === "No" ? safelifeSkipReason : null,
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
        aria-label="New AI Camera Observation"
      >
        <div className="drawer-hd">
          <div>
            <div className="sub">SCC Platform / New AI Camera Observation</div>
            <h2>New AI Camera Observation</h2>
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

          <div className="form-grid">
            <section className="v1-card">
              <h3>Observation details</h3>
              <div className="fgrid">
                <div className="fld">
                  <SelectList
                    label="Project"
                    type="project"
                    value={form.project_id}
                    onChange={(project_id) => setForm((c) => ({ ...c, project_id }))}
                    required
                    hideNotes
                    allowedLabels={projectScope.allowedLabels}
                    disabled={projectScope.lockProjectSelect}
                  />
                </div>
                <div className="fld">
                  <label className="fld-ctl">
                    <span className="lbl">
                      Location <span className="req">*</span>
                    </span>
                    <input
                      required
                      placeholder="Type the location, e.g. Riyas KM 17"
                      value={form.location}
                      onChange={(e) => setForm({ ...form, location: e.target.value })}
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
                    <span className="hint">Calculated from the date (weeks start on Sunday)</span>
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
                    <span className="lbl">Camera ID</span>
                    <input
                      placeholder="CAM-JA-07"
                      value={form.camera_id}
                      onChange={(e) => setForm({ ...form, camera_id: e.target.value })}
                    />
                  </label>
                </div>
                <div className="fld">
                  <SelectList
                    label="Alert type"
                    type="alert_type"
                    value={form.alert_type_id}
                    onChange={(alert_type_id) => {
                      const label =
                        alertTypes.items.find((i) => i.id === alert_type_id)?.label || "";
                      const positive = label.toLowerCase() === "positive";
                      const positiveCategory =
                        categories.items.find(
                          (i) => i.label.toLowerCase() === "positive observation",
                        )?.id ?? "";
                      setForm((c) => ({
                        ...c,
                        alert_type_id,
                        risk_level_id: positive ? "" : c.risk_level_id,
                        category_id: positive
                          ? positiveCategory || c.category_id
                          : c.category_id,
                        category_other: positive ? "" : c.category_other,
                      }));
                    }}
                    required
                    hideNotes
                  />
                </div>
                <div className="fld">
                  <SelectList
                    label="Category"
                    type="ai_camera_category"
                    value={form.category_id}
                    onChange={(category_id) => {
                      const label =
                        categories.items.find((i) => i.id === category_id)?.label || "";
                      const other = label.toLowerCase() === "other";
                      setForm((c) => ({
                        ...c,
                        category_id,
                        category_other: other ? c.category_other : "",
                      }));
                    }}
                    required
                    hideNotes
                    hint="Managed by Admin"
                  />
                </div>
                {isOtherCategory ? (
                  <div className="fld">
                    <label className="fld-ctl">
                      <span className="lbl">
                        Other category <span className="req">*</span>
                      </span>
                      <input
                        required
                        placeholder="Describe the category"
                        value={form.category_other}
                        onChange={(e) =>
                          setForm({ ...form, category_other: e.target.value })
                        }
                      />
                    </label>
                  </div>
                ) : null}
                {!isPositiveAlert ? (
                  <div className="fld">
                    <SelectList
                      label="Risk level"
                      type="risk_level"
                      value={form.risk_level_id}
                      onChange={(risk_level_id) => setForm((c) => ({ ...c, risk_level_id }))}
                      required
                      hideNotes
                      hint="Sets the close-out deadline"
                    />
                  </div>
                ) : null}
                <div className="fld">
                  <SelectList
                    label="Detection method"
                    type="detection_method"
                    value={form.detection_method_id}
                    onChange={(detection_method_id) =>
                      setForm((c) => ({ ...c, detection_method_id }))
                    }
                    required
                    hideNotes
                  />
                </div>
                <div className="fld full">
                  <label className="fld-ctl">
                    <span className="lbl">
                      Alert summary <span className="req">*</span>
                    </span>
                    <textarea
                      required
                      rows={3}
                      placeholder="What the camera detected"
                      value={form.alert_summary}
                      onChange={(e) => setForm({ ...form, alert_summary: e.target.value })}
                    />
                  </label>
                </div>
              </div>
            </section>

            <section className="v1-card">
              <h3>Evidence and SafeLife</h3>
              <div className="fgrid">
                <div className="fld full">
                  <label className="fld-ctl">
                    <span className="lbl">
                      Observation picture <span className="req">*</span>
                    </span>
                    <span className="dropzone">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => setPictureFile(e.target.files?.[0] ?? null)}
                      />
                      <strong>Drop a picture here or browse</strong>
                      <span>{pictureFile?.name || "Image of the observation"}</span>
                    </span>
                  </label>
                </div>
                {integ.safelifeAsk ? (
                  <div className="fld full">
                    <span className="field-label lbl">
                      Updated in SafeLife? <span className="req">*</span>
                    </span>
                    <div className="radio-pills" role="radiogroup" aria-label="Updated in SafeLife">
                      {(["Yes", "No"] as const).map((opt) => (
                        <label
                          key={opt}
                          className={`radio-pill${safelife === opt ? " is-on" : ""}`}
                        >
                          <input
                            type="radio"
                            name="safelife"
                            checked={safelife === opt}
                            onChange={() => {
                              setSafelife(opt);
                              if (opt === "Yes") setSafelifeSkipReason("");
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
                      SafeLife default from Administration:{" "}
                      <b>{safelife === "Yes" ? "Update in SafeLife" : "Not updated"}</b>
                    </div>
                  </div>
                )}
                {safelife === "Yes" ? (
                  <div className="fld full">
                    <label className="fld-ctl">
                      <span className="lbl">
                        SafeLife reference number <span className="req">*</span>
                      </span>
                      <input
                        placeholder="SL-000000"
                        value={form.safelife_reference}
                        onChange={(e) =>
                          setForm({ ...form, safelife_reference: e.target.value })
                        }
                      />
                    </label>
                  </div>
                ) : (
                  <div className="fld full">
                    <div className="note" style={{ marginBottom: 8 }}>
                      {SAFELIFE_NO}
                    </div>
                    <label className="fld-ctl">
                      <span className="lbl">
                        Reason for not updating in SafeLife <span className="req">*</span>
                      </span>
                      <select
                        required
                        value={safelifeSkipReason}
                        onChange={(e) => setSafelifeSkipReason(e.target.value)}
                      >
                        <option value="">Select</option>
                        {SAFELIFE_SKIP_REASONS.map((reason) => (
                          <option key={reason} value={reason}>
                            {reason}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
                <div className="fld full">
                  <SignedInNameField
                    label="Reported by"
                    note="Filled in by the system from the logged-in user"
                  />
                </div>
              </div>
              <div className="note" style={{ marginTop: 8 }}>
                <Icon name="lock" size={13} /> Close-out fields (HSEO, action and picture) unlock
                after the record is registered.
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
                    <b className="mono">Generated on save</b>
                  </div>
                </div>
                <small className="muted">Set by the system. New records start as Open.</small>
              </section>
              <section className="v1-card">
                <h3>Close-out deadline</h3>
                <div className="kv one">
                  {(["High", "Medium", "Low"] as const).map((k) => (
                    <div key={k}>
                      <span>{k} risk</span>
                      <b>{SLA_LABEL[k]}</b>
                    </div>
                  ))}
                </div>
                <small className="muted">
                  Overdue records notify the Operator and Admin, and escalate after 2× the
                  deadline.
                </small>
              </section>
              <section className="v1-card">
                <h3>What happens next</h3>
                <div className="steps">
                  {[
                    ["Register", "Complete every required field. Status: Open."],
                    ["Close-out", "HSEO, action and picture. Status: Under Review."],
                    ["Review", "Admin approves (Closed) or returns with a reason (Open)."],
                  ].map(([t, s], i) => (
                    <div key={t}>
                      <i>{i + 1}</i>
                      <span>
                        <b>{t}</b>
                        <span>{s}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            </aside>
          </div>

          <div className="formbar">
            <span className={`msg${remaining ? "" : " ok"}`}>
              {error
                ? error
                : remaining
                  ? `${remaining} required field${remaining > 1 ? "s are" : " is"} still empty`
                  : "All required fields completed"}
            </span>
            <span style={{ flex: 1 }} />
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={!canRegister}>
              <Icon name="check" size={14} />{" "}
              {saving ? "Saving…" : "Register observation"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ---------- Main screen ---------- */
export function AiCameraScreen({
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
  const categoryList = useList("ai_camera_category");
  const alertTypeList = useList("alert_type");
  const detectionListDash = useList("detection_method");
  const riskList = useList("risk_level");
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<DashView>("projects");
  const [project, setProject] = useState("");
  const [period, setPeriod] = useState<PeriodId>("ytd");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [curveMode, setCurveMode] = useState<CurveMode>("week");
  const [drawerOpen, setDrawerOpen] = useState(Boolean(openForm && canRegister));
  const [openRecordId, setOpenRecordId] = useState<string | null>(focusCaseId ?? null);

  const [logStatus, setLogStatus] = useState<LogStatus>("All");
  const [logRisk, setLogRisk] = useState("All");
  const [logCat, setLogCat] = useState("All");
  const [logQ, setLogQ] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await fetchCases({ record_type: "ai_camera" });
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

  const scoped = useMemo(() => {
    let rows = cases.filter(
      (r) => inRange(r, range.a, range.b) && rowAllowedForProjects(r.project, projectAccess),
    );
    if (view === "projects") {
      rows = rows.filter((r) => Boolean(r.project));
      if (project) rows = rows.filter((r) => r.project === project);
    }
    return rows;
  }, [cases, range, view, project, projectAccess]);

  const prev = useMemo(() => {
    let rows = cases.filter(
      (r) => inRange(r, range.pa, range.pb) && rowAllowedForProjects(r.project, projectAccess),
    );
    if (view === "projects") {
      rows = rows.filter((r) => Boolean(r.project));
      if (project) rows = rows.filter((r) => r.project === project);
    }
    return rows;
  }, [cases, range, view, project, projectAccess]);

  const openN = scoped.filter((r) => r.status === "open").length;
  const reviewN = scoped.filter((r) => r.status === "under_process").length;
  const closedN = scoped.filter((r) => r.status === "closed").length;
  const posN = scoped.filter(isPositive).length;
  const prevPos = prev.filter(isPositive).length;
  const slWanted = scoped.filter((r) => Boolean(r.fields?.safelife_update));
  const slDone = slWanted.filter((r) => r.status !== "open").length;
  const slPct = slWanted.length ? `${pct(slDone, slWanted.length)}%` : "—";

  const catLabels = useMemo(
    () => categoryList.items.map((i) => i.label),
    [categoryList.items],
  );
  const catCounts = useMemo(() => {
    const map = new Map(countBy(scoped, (r) => field(r, "category") || "Uncategorized"));
    return map;
  }, [scoped]);
  const cats = useMemo(() => {
    const labels = catLabels.length
      ? catLabels
      : [...catCounts.keys()].sort((a, b) => (catCounts.get(b) || 0) - (catCounts.get(a) || 0));
    return labels
      .map((label) => [label, catCounts.get(label) || 0] as [string, number])
      .filter(([, n]) => n > 0)
      .slice(0, 10);
  }, [catLabels, catCounts]);
  const catTotal = catLabels.length || catCounts.size;

  const byProject = useMemo(() => {
    const map = new Map(
      countBy(
        scoped.filter((r) => r.project),
        (r) => r.project || "",
      ),
    );
    const labels = projects.length
      ? projects
      : [...map.keys()].sort((a, b) => (map.get(b) || 0) - (map.get(a) || 0));
    return labels
      .map((label) => [label, map.get(label) || 0] as [string, number])
      .filter(([, n]) => n > 0);
  }, [scoped, projects]);

  const byAlert = useMemo(() => {
    const map = new Map(countBy(scoped, alertTypeOf));
    const labels = alertTypeList.items.map((i) => i.label);
    const ordered = labels.length
      ? labels.map((label) => [label, map.get(label) || 0] as [string, number])
      : [...map.entries()];
    const known = new Set(labels);
    const extras = [...map.entries()].filter(([k]) => !known.has(k));
    return [...ordered, ...extras].filter(([, n]) => n > 0);
  }, [scoped, alertTypeList.items]);

  const byDetect = useMemo(() => {
    const map = new Map(countBy(scoped, (r) => field(r, "detection_method") || "AI"));
    const labels = detectionListDash.items.map((i) => i.label);
    const ordered = labels.length
      ? labels.map((label) => [label, map.get(label) || 0] as [string, number])
      : [...map.entries()];
    return ordered.filter(([, n]) => n > 0);
  }, [scoped, detectionListDash.items]);

  const byOps = countBy(scoped, (r) => field(r, "reported_by") || "Unknown").slice(0, 14);

  const curve = useMemo(() => {
    if (curveMode === "month") {
      const now = new Date();
      const labels = MON3.slice(0, now.getMonth() + 1);
      const data = labels.map((_, i) =>
        scoped.filter((r) => {
          const d = new Date(`${r.date}T12:00:00`);
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
      data: weeks.map(
        (w) => scoped.filter((r) => inRange(r, w.a, w.b)).length,
      ),
    };
  }, [scoped, curveMode]);

  const overdueN = scoped.filter((r) => {
    const s = slaState(r);
    return s && (s.k === "over" || s.k === "esc");
  }).length;

  const categories = useMemo(() => {
    if (catLabels.length) return catLabels;
    return [
      ...new Set(scoped.map((r) => field(r, "category")).filter(Boolean)),
    ].sort() as string[];
  }, [catLabels, scoped]);

  const riskLevels = useMemo(() => {
    const fromCatalog = riskList.items.map((i) => {
      const label = i.label.replace(/\s*risk$/i, "").trim();
      return label || i.label;
    });
    if (fromCatalog.length) return fromCatalog;
    return ["High", "Medium", "Low"];
  }, [riskList.items]);

  const logRows = useMemo(() => {
    let rows = scoped.filter((r) => {
      if (logStatus === "All") return true;
      if (logStatus === "Overdue") {
        const s = slaState(r);
        return Boolean(s && (s.k === "over" || s.k === "esc"));
      }
      return statusLabel(r.status) === logStatus;
    });
    if (logRisk !== "All") rows = rows.filter((r) => riskKey(r) === logRisk);
    if (logCat !== "All") rows = rows.filter((r) => field(r, "category") === logCat);
    if (logQ.trim()) {
      const q = logQ.trim().toLowerCase();
      rows = rows.filter((r) =>
        [
          r.case_id,
          r.project,
          field(r, "location"),
          field(r, "alert_summary"),
          field(r, "category"),
          field(r, "reported_by"),
          r.title,
        ].some((v) => v && String(v).toLowerCase().includes(q)),
      );
    }
    return rows;
  }, [scoped, logStatus, logRisk, logCat, logQ]);

  function openNew() {
    setDrawerOpen(true);
  }

  function exportCsv() {
    const cols = [
      "Case ID",
      "Project",
      "Location",
      "Date",
      "Alert type",
      "Category",
      "Risk",
      "Status",
      "SafeLife",
      "Reported by",
    ];
    const lines = [
      cols.join(","),
      ...logRows.map((r) =>
        [
          r.case_id,
          r.project || "",
          field(r, "location"),
          `${r.date} ${field(r, "occurred_time")}`,
          alertTypeOf(r),
          field(r, "category"),
          riskKey(r),
          statusLabel(r.status),
          r.fields?.safelife_update
            ? r.status === "open"
              ? "Pending"
              : "Updated"
            : "Not required",
          field(r, "reported_by"),
        ]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ai-camera-log.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <p className="state">Loading AI Camera observations…</p>;
  if (error) return <p className="state error">{error}</p>;

  const gaugeMax = Math.max(scoped.length, Math.round(scoped.length * 1.25) || 10);

  return (
    <section className="page v1-dash ai-module">
      <section className="v1-banner">
        <div className="v1-banner-icon">
          <Icon name="cctv" size={30} />
        </div>
        <div className="v1-banner-copy">
          <h1>
            AI CAMERA OBSERVATION <em>DASHBOARD {year}</em>
          </h1>
          <p>
            Real-Time Monitoring <i>•</i> Smarter Decisions <i>•</i> Safer Operations
          </p>
        </div>
        {canRegister ? (
          <div className="v1-banner-actions">
            <button type="button" className="btn primary" onClick={openNew}>
              <Icon name="plus" size={14} /> New observation
            </button>
          </div>
        ) : null}
      </section>

      <div className="v1-filters">
        <div className="grp">
          <label className="k">View</label>
          <div className="seg">
            <ProjectOnlyViewSeg
              view={view}
              setView={setView}
              options={[
                ["overall", "Over All"],
                ["projects", "By Project"],
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
        <KpiTile
          title="Under Review"
          icon="clock"
          value={reviewN}
          sub="waiting for Admin review"
        />
        <KpiTile title="Closed" icon="review" value={closedN} sub="approved and closed" />
        <KpiTile
          title="Positive observations"
          icon="shield"
          value={posN}
          sub={`Alert type: Positive${range.cmp ? ` · was ${fmtN(prevPos)}` : ""}`}
        />
        <KpiTile
          title="Updated in SafeLife"
          icon="sync"
          value={slPct}
          sub={`${fmtN(slDone)} entries synced`}
        />
      </div>

      <div className="v1-grid g3">
        <article className="v1-card">
          <h3>Total AI Camera observations</h3>
          <Gauge value={scoped.length} max={gaugeMax} />
        </article>
        <article className="v1-card">
          <h3>Observations status</h3>
          <StatusDonut rows={scoped} />
        </article>
        <article className="v1-card">
          <h3>Risk level</h3>
          <p className="sub">Number of records by risk level and positive observations</p>
          <RiskBars rows={scoped} />
        </article>
      </div>

      <div className="v1-grid g3">
        <article className="v1-card">
          <h3>Category</h3>
          <p className="sub">
            Top {Math.min(10, cats.length)} of {catTotal || cats.length} categories
          </p>
          <HBarChart entries={cats} height={300} />
        </article>
        <article className="v1-card">
          <h3>By project</h3>
          <p className="sub">Observations belong to a project only</p>
          <BarsList entries={byProject} />
        </article>
        <div className="ai-stack">
          <article className="v1-card">
            <h3>By alert type</h3>
            <BarsList
              entries={byAlert}
              color={(k) =>
                k === "Positive" ? PAL.olive : k === "Unsafe Act" ? PAL.red : PAL.steel
              }
            />
          </article>
          <article className="v1-card">
            <h3>By detection method</h3>
            <BarsList entries={byDetect} />
          </article>
        </div>
      </div>

      <div className="v1-grid g3">
        <article className="v1-card">
          <h3>Observations per operator</h3>
          <p className="sub">Records registered by each Operator</p>
          <OpsChart entries={byOps} />
        </article>
        <article className="v1-card span2">
          <h3>Observations per date</h3>
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
          <CurveChart labels={curve.labels} data={curve.data} />
        </article>
      </div>

      <section className="v1-card ai-log">
        <div className="hd">
          <div>
            <h3>
              AI Camera observations summary{" "}
              <small>
                {fmtN(logRows.length)} of {fmtN(scoped.length)} in the selected period · click a
                row to open it
              </small>
            </h3>
          </div>
          {canRegister ? (
            <button type="button" className="btn sm primary" onClick={openNew}>
              <Icon name="plus" size={13} /> New observation
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
              value={logCat}
              onChange={(e) => setLogCat(e.target.value)}
              aria-label="categories"
            >
              <option value="All">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <select
              className="sel"
              value={logRisk}
              onChange={(e) => setLogRisk(e.target.value)}
              aria-label="Risk"
            >
              <option value="All">All risk levels</option>
              {riskLevels.map((r) => (
                <option key={r} value={r}>
                  {r} Risk
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
                <th>Project</th>
                <th>Location</th>
                <th>Date</th>
                <th>Alert type</th>
                <th>Category</th>
                <th>Risk</th>
                <th>Status</th>
                <th>SafeLife</th>
                <th>Reported by</th>
                <th>SLA</th>
              </tr>
            </thead>
            <tbody>
              {logRows.length ? (
                logRows.map((r) => {
                  const sla = slaState(r);
                  const overdue = Boolean(sla && (sla.k === "over" || sla.k === "esc"));
                  const time = field(r, "occurred_time");
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
                      <td title={r.project || undefined}>{r.project || "—"}</td>
                      <td title={field(r, "location") || undefined}>
                        {field(r, "location") || "—"}
                      </td>
                      <td>
                        <span className="num nw">
                          {formatDay(r.date)}
                          <br />
                          <small className="muted">
                            {time || "—"} · W{r.week_number}
                          </small>
                        </span>
                      </td>
                      <td title={alertTypeOf(r) || undefined}>{alertTypeOf(r)}</td>
                      <td>
                        <span className="clip" title={field(r, "category")}>
                          {field(r, "category") || "—"}
                        </span>
                      </td>
                      <td>
                        <RiskPill risk={r.risk_level} />
                      </td>
                      <td>
                        <StatusPill status={r.status} />
                      </td>
                      <td>
                        {r.fields?.safelife_update ? (
                          <span className={`tagx${r.status === "open" ? "" : " green"}`}>
                            {r.status === "open" ? "Pending" : "Updated"}
                          </span>
                        ) : (
                          <span className="tagx">Not required</span>
                        )}
                      </td>
                      <td>{field(r, "reported_by") || "—"}</td>
                      <td>
                        {!sla ? (
                          r.status === "closed" ? (
                            <span className="muted">Met</span>
                          ) : null
                        ) : sla.k === "ok" ? (
                          <span className="muted mono">{fmtDur(sla.left)} left</span>
                        ) : sla.k === "soon" ? (
                          <span className="tagx amber">{fmtDur(sla.left)} left</span>
                        ) : (
                          <span className="tagx red">
                            {sla.label} {fmtDur(sla.over)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={12} className="empty">
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

      <AiCameraNewDrawer
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          if (openForm) window.location.hash = href({ name: "list", type: "ai_camera" });
        }}
        onRegistered={(row) => {
          setDrawerOpen(false);
          void load().then(() => setOpenRecordId(row.id));
          notifyCasesChanged();
        }}
      />
      <AiCameraRecordDrawer
        caseId={openRecordId}
        onClose={() => {
          setOpenRecordId(null);
          if (focusCaseId) {
            window.location.hash = href({ name: "list", type: "ai_camera" });
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
