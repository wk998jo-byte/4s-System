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
import { ChartTip, tipFromEvent, type ChartTipData } from "./chartTip";
import { ItqanRecordDrawer } from "./ItqanRecordDrawer";
import {SelectList,
  SignedInNameField,
  nowLocal,
  todayIso,
  useList,
  useSignedInName,
  weekFromIsoDate,
  ProjectOnlyViewSeg,
} from "./shared";

type ItqanView = "overall" | "projects" | "departments";
type PeriodId =
  | "today"
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "ytd"
  | "custom";
type CurveMode = "week" | "month";

const ITQAN_STATUSES = [
  "Under Safety",
  "Under HR Action",
  "Under Payroll",
  "Under Announcement",
  "Closed",
] as const;

const STATUS_COLORS: Record<string, string> = {
  "Under Safety": "#c62828",
  "Under HR Action": "#6b7280",
  "Under Payroll": "#d97706",
  "Under Announcement": "#a16207",
  Closed: "#15803d",
};

const PAL = {
  red: "#c62828",
  steel: "#5c6670",
  amber: "#d97706",
  green: "#15803d",
  ink2: "#6b6560",
  line: "#e4ddd4",
  copper: "#b45309",
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
const MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86_400_000;

function fmtN(n: number) {
  return n.toLocaleString("en-US");
}

function pct(n: number, total: number) {
  if (!total) return "0";
  return String(Math.round((n / total) * 100));
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

function periodRange(period: PeriodId, from: string, to: string, now = new Date()) {
  const year = now.getFullYear();
  const t0 = sod(now).getTime();
  const eod = t0 + DAY_MS - 1;
  let a = t0;
  let b = eod;
  let label = "";
  let cmp: string | null = "previous period";

  switch (period) {
    case "today":
      label = `Today, ${formatDay(isoDate(now))}`;
      cmp = "yesterday";
      break;
    case "this_week":
      a = weekStart(now).getTime();
      label = `${formatDay(isoDate(new Date(a)))} to ${formatDay(isoDate(now))}`;
      cmp = "last week";
      break;
    case "last_week": {
      const w = weekStart(now).getTime();
      b = w - 1;
      a = w - 7 * DAY_MS;
      label = `${formatDay(isoDate(new Date(a)))} to ${formatDay(isoDate(new Date(b)))}`;
      cmp = "the week before";
      break;
    }
    case "this_month":
      a = new Date(year, now.getMonth(), 1).getTime();
      label = `${MONTHS[now.getMonth()]} ${year} to date`;
      cmp = "same days last month";
      break;
    case "last_month": {
      const s = new Date(year, now.getMonth() - 1, 1);
      a = s.getTime();
      b = new Date(year, now.getMonth(), 1).getTime() - 1;
      const p = new Date(year, now.getMonth() - 2, 1);
      label = `${MONTHS[s.getMonth()]} ${s.getFullYear()}`;
      cmp = MONTHS[p.getMonth()];
      break;
    }
    case "custom": {
      a = from ? new Date(`${from}T00:00:00`).getTime() : new Date(year, 0, 1).getTime();
      b = to ? new Date(`${to}T23:59:59`).getTime() : eod;
      const L = Math.max(DAY_MS, b - a);
      label = `${formatDay(isoDate(new Date(a)))} to ${formatDay(isoDate(new Date(b)))}`;
      cmp = `previous ${Math.round(L / DAY_MS)} days`;
      break;
    }
    case "ytd":
    default:
      a = new Date(year, 0, 1).getTime();
      label = `1 Jan to ${formatDay(isoDate(now))} (Year to date)`;
      cmp = null;
      break;
  }
  return { a, b, label, cmp };
}

function field(row: CaseSummary, key: string): string {
  const v = row.fields?.[key];
  return v == null ? "" : String(v);
}

function itqStatus(row: CaseSummary) {
  return field(row, "itqan_status") || (row.status === "closed" ? "Closed" : "Under Safety");
}

function scopeLabel(row: CaseSummary) {
  return row.project || row.department || "—";
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

function statusTagClass(status: string) {
  if (status === "Closed") return " green";
  if (status === "Under Safety") return " red";
  if (status === "Under HR Action") return " amber";
  return "";
}

function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const c = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    width: size,
    height: size,
    "aria-hidden": true,
  };
  switch (name) {
    case "plus":
      return (
        <svg {...c}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case "itqan":
      return (
        <svg {...c}>
          <path d="M4 7h16M4 12h10M4 17h14" />
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
    case "search":
      return (
        <svg {...c}>
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-4-4" />
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
    default:
      return null;
  }
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
        />
        <path
          d="M20 78 A70 70 0 0 1 160 78"
          fill="none"
          stroke={PAL.steel}
          strokeWidth="16"
          strokeLinecap="round"
          strokeDasharray={`${fill * reveal} ${c}`}
          style={{ cursor: "pointer" }}
          onMouseMove={(e) =>
            setTip(
              tipFromEvent(e, hostRef.current, {
                title: "Total violations",
                rows: [{ color: PAL.steel, text: fmtN(value) }],
              }),
            )
          }
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

function VehicleDonut({ rows }: { rows: CaseSummary[] }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<ChartTipData | null>(null);
  const hv = rows.filter((r) => /heavy/i.test(field(r, "vehicle_type"))).length;
  const lv = rows.filter((r) => /light/i.test(field(r, "vehicle_type"))).length;
  const total = rows.length || 1;
  const reveal = useChartReveal(hostRef, `${hv}|${lv}|${rows.length}`);
  const segs = [
    { n: hv, c: PAL.red, l: "Heavy Vehicle" },
    { n: lv, c: PAL.steel, l: "Light Vehicle" },
  ].filter((s) => s.n > 0);
  const size = 168;
  const r = 38;
  const stroke = 16;
  const ringC = 2 * Math.PI * r;
  let ringOffset = 0;

  return (
    <div className="v1-donut-row">
      <div
        className="v1-donut-wrap"
        ref={hostRef}
        style={{ width: size, height: size }}
        onMouseLeave={() => setTip(null)}
      >
        <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden>
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke={PAL.line}
            strokeWidth={stroke}
            pointerEvents="none"
          />
          {segs.length === 1 ? (
            <circle
              cx="50"
              cy="50"
              r={r}
              fill="none"
              stroke={segs[0]!.c}
              strokeWidth={stroke}
              strokeDasharray={ringC}
              strokeDashoffset={ringC * (1 - reveal)}
              transform="rotate(-90 50 50)"
              style={{ cursor: "pointer" }}
              onMouseMove={(e: ReactMouseEvent) =>
                setTip(
                  tipFromEvent(e, hostRef.current, {
                    title: segs[0]!.l,
                    rows: [{ color: segs[0]!.c, text: fmtN(segs[0]!.n) }],
                  }),
                )
              }
            />
          ) : (
            segs.map((p) => {
              const len = (p.n / total) * ringC * reveal;
              const el = (
                <circle
                  key={p.l}
                  cx="50"
                  cy="50"
                  r={r}
                  fill="none"
                  stroke={p.c}
                  strokeWidth={stroke}
                  strokeDasharray={`${len} ${ringC - len}`}
                  strokeDashoffset={-ringOffset}
                  transform="rotate(-90 50 50)"
                  strokeLinecap="butt"
                  style={{ cursor: "pointer" }}
                  onMouseMove={(e: ReactMouseEvent) =>
                    setTip(
                      tipFromEvent(e, hostRef.current, {
                        title: p.l,
                        rows: [{ color: p.c, text: fmtN(p.n) }],
                      }),
                    )
                  }
                />
              );
              ringOffset += (p.n / total) * ringC * reveal;
              return el;
            })
          )}
        </svg>
        <ChartTip tip={tip} />
      </div>
      <div className="v1-legend col">
        {["Heavy Vehicle", "Light Vehicle"].map((k, i) => {
          const n = i === 0 ? hv : lv;
          return (
            <span key={k}>
              <i style={{ background: i ? PAL.steel : PAL.red }} />
              {k}
              <b className="mono">{pct(n, rows.length)}%</b>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function StatusPie({ rows }: { rows: CaseSummary[] }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<ChartTipData | null>(null);
  const total = rows.length || 1;
  const counts = ITQAN_STATUSES.map((s) => ({
    l: s,
    n: rows.filter((r) => itqStatus(r) === s).length,
    c: STATUS_COLORS[s] || PAL.steel,
  }));
  const reveal = useChartReveal(
    hostRef,
    counts.map((s) => `${s.l}:${s.n}`).join("|"),
  );
  const visible = counts.filter((s) => s.n > 0);
  const gap = visible.length > 1 ? 1.2 : 0;
  const slices: Array<{ l: string; n: number; c: string; start: number; sweep: number }> = [];
  let angle = 0;
  for (const s of visible) {
    const raw = (s.n / total) * 360;
    slices.push({ ...s, start: angle + gap / 2, sweep: Math.max(0.5, raw - gap) });
    angle += raw;
  }
  const size = 168;
  const r = 46;

  return (
    <div className="v1-donut-row">
      <div
        className="v1-donut-wrap"
        ref={hostRef}
        style={{ width: size, height: size }}
        onMouseLeave={() => setTip(null)}
      >
        <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden>
          {slices.length === 0 ? (
            <circle cx="50" cy="50" r={r} fill={PAL.line} />
          ) : slices.length === 1 ? (
            <circle
              cx="50"
              cy="50"
              r={r * reveal}
              fill={slices[0]!.c}
              style={{ cursor: "pointer" }}
              onMouseMove={(e) =>
                setTip(
                  tipFromEvent(e, hostRef.current, {
                    title: slices[0]!.l,
                    rows: [{ color: slices[0]!.c, text: fmtN(slices[0]!.n) }],
                  }),
                )
              }
            />
          ) : (
            slices.map((p) => {
              const sweep = p.sweep * reveal;
              const a0 = ((p.start - 90) * Math.PI) / 180;
              const a1 = ((p.start + sweep - 90) * Math.PI) / 180;
              const x0 = 50 + r * Math.cos(a0);
              const y0 = 50 + r * Math.sin(a0);
              const x1 = 50 + r * Math.cos(a1);
              const y1 = 50 + r * Math.sin(a1);
              const large = sweep > 180 ? 1 : 0;
              return (
                <path
                  key={p.l}
                  d={`M 50 50 L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`}
                  fill={p.c}
                  stroke="var(--surface, #f9f8f3)"
                  strokeWidth={1.5}
                  style={{ cursor: "pointer" }}
                  onMouseMove={(e) =>
                    setTip(
                      tipFromEvent(e, hostRef.current, {
                        title: p.l,
                        rows: [{ color: p.c, text: fmtN(p.n) }],
                      }),
                    )
                  }
                />
              );
            })
          )}
        </svg>
        <ChartTip tip={tip} />
      </div>
      <div className="v1-legend col">
        {counts.map((s) => (
          <span key={s.l}>
            <i style={{ background: s.c }} />
            {s.l}
            <b className="mono">{pct(s.n, rows.length)}%</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function HBarList({
  entries,
  color = PAL.red,
}: {
  entries: [string, number][];
  color?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<ChartTipData | null>(null);
  const reveal = useChartReveal(
    hostRef,
    entries.map(([k, n]) => `${k}:${n}`).join("|"),
  );
  const max = Math.max(1, ...entries.map(([, n]) => n));
  return (
    <div className="v1-hbar-list v1-chart-host" ref={hostRef} onMouseLeave={() => setTip(null)}>
      {entries.length ? (
        entries.map(([label, n]) => (
          <div className="v1-hbar-row" key={label}>
            <span className="clip" title={label}>
              {label.length > 28 ? `${label.slice(0, 27)}…` : label}
            </span>
            <div className="v1-hbar-track">
              <i
                style={{
                  width: `${(n / max) * 100 * reveal}%`,
                  background: color,
                  cursor: n > 0 ? "pointer" : "default",
                }}
                onMouseMove={
                  n > 0
                    ? (e) =>
                        setTip(
                          tipFromEvent(e, hostRef.current, {
                            title: label,
                            rows: [{ color, text: fmtN(n) }],
                            place: "right",
                          }),
                        )
                    : undefined
                }
                onMouseLeave={() => setTip(null)}
              />
            </div>
            <b className="mono">{fmtN(n)}</b>
          </div>
        ))
      ) : (
        <p className="muted">No data in this period.</p>
      )}
      <ChartTip tip={tip} />
    </div>
  );
}

function HBarChart({
  entries,
  color = PAL.red,
  height = 220,
}: {
  entries: [string, number][];
  color?: string;
  height?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<ChartTipData | null>(null);
  const reveal = useChartReveal(
    hostRef,
    entries.map(([k, v]) => `${k}:${v}`).join("|"),
  );
  const max = niceAxisMax(Math.max(1, ...entries.map((e) => e[1])));
  const rowH = Math.max(26, Math.min(34, (height - 28) / Math.max(1, entries.length || 1)));
  const H = Math.max(height, Math.max(1, entries.length) * rowH + 28);
  const W = 420;
  const labelW = 148;
  const barX = labelW + 8;
  const barW = W - barX - 16;
  const axisY = H - 16;

  if (!entries.length) return <p className="empty">No records.</p>;

  return (
    <div className="v1-chart-host" ref={hostRef} onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="ai-hbar-svg" style={{ height }} aria-hidden>
        {[0, 0.2, 0.4, 0.6, 0.8, 1].map((f) => {
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
          const label = k.length > 24 ? `${k.slice(0, 23)}…` : k;
          return (
            <g key={k}>
              <text
                x={labelW}
                y={y + rowH * 0.62}
                textAnchor="end"
                fontSize={12}
                fill="var(--ink-2)"
              >
                {label}
              </text>
              <rect
                x={barX}
                y={y + 5}
                width={Math.max(v > 0 ? 4 : 0, w)}
                height={14}
                rx={4}
                fill={color}
                style={{ cursor: v > 0 ? "pointer" : "default" }}
                onMouseMove={
                  v > 0
                    ? (e) =>
                        setTip(
                          tipFromEvent(e, hostRef.current, {
                            title: k,
                            rows: [{ color, text: fmtN(v) }],
                            place: "right",
                          }),
                        )
                    : undefined
                }
                onMouseLeave={() => setTip(null)}
              />
            </g>
          );
        })}
      </svg>
      <ChartTip tip={tip} />
    </div>
  );
}

function niceAxisMax(raw: number) {
  const n = Math.max(1, raw);
  if (n <= 5) return n;
  const exp = Math.pow(10, Math.floor(Math.log10(n)));
  const m = n / exp;
  const nice = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return Math.ceil(nice * exp);
}

function smoothCurvePath(pts: readonly (readonly [number, number])[], yMin: number, yMax: number) {
  if (!pts.length) return "";
  if (pts.length === 1) return `M${pts[0]![0]} ${pts[0]![1]}`;
  if (pts.length === 2) return `M${pts[0]![0]} ${pts[0]![1]} L${pts[1]![0]} ${pts[1]![1]}`;
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

function axisTicks(max: number) {
  const steps = max <= 5 ? max : 6;
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
  const W = 920;
  const H = 240;
  const pad = { t: 12, r: 16, b: 28, l: 36 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const max = niceAxisMax(Math.max(1, ...data));
  const pts = data.map((v, i) => {
    const x = pad.l + (labels.length <= 1 ? iw / 2 : (i / (labels.length - 1)) * iw);
    const y = pad.t + ih - (v / max) * ih;
    return [x, y] as const;
  });
  const baseY = pad.t + ih;
  const visibleCount = Math.max(1, Math.ceil(data.length * Math.max(reveal, 0.001)));
  const shownPts = pts.slice(0, visibleCount);
  const line = smoothCurvePath(shownPts, pad.t, baseY);
  const area = shownPts.length
    ? `${line} L${shownPts[shownPts.length - 1]![0]} ${baseY} L${shownPts[0]![0]} ${baseY} Z`
    : "";
  const tickVals = axisTicks(max);

  return (
    <div className="ai-curve-wrap v1-chart-host" ref={hostRef} onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="ai-curve-svg" aria-hidden>
        {tickVals.map((val) => {
          const y = pad.t + ih * (1 - val / max);
          return (
            <g key={val}>
              <line
                x1={pad.l}
                x2={W - pad.r}
                y1={y}
                y2={y}
                stroke={PAL.line}
                strokeWidth={1}
              />
              <text x={pad.l - 6} y={y + 3} textAnchor="end" fontSize={10} fill="var(--ink-2)">
                {fmtN(val)}
              </text>
            </g>
          );
        })}
        {area ? <path d={area} fill={`${PAL.red}22`} pointerEvents="none" /> : null}
        {line ? (
          <path d={line} fill="none" stroke={PAL.red} strokeWidth={2.25} pointerEvents="none" />
        ) : null}
        {shownPts.map((p, i) => (
          <circle
            key={i}
            cx={p[0]}
            cy={p[1]}
            r={4.5}
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
          const x = pad.l + (labels.length <= 1 ? iw / 2 : (i / (labels.length - 1)) * iw);
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

function Thumb({ row }: { row: CaseSummary }) {
  const src = resolveMediaUrl(field(row, "itqan_upload_proof"));
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
        background: `linear-gradient(135deg, hsl(${10 + hue} 45% 42%), hsl(${20 + hue} 35% 22%))`,
      }}
      aria-hidden
    />
  );
}

function ItqanNewDrawer({
  open,
  onClose,
  onRegistered,
}: {
  open: boolean;
  onClose: () => void;
  onRegistered: (row: CaseDetail) => void;
}) {
  const actorName = useSignedInName();
  const statuses = useList("itqan_status");
  const localNow = nowLocal();
  const localTime = localNow.includes("T") ? localNow.split("T")[1]!.slice(0, 5) : "";
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    assign_to: "project" as "project" | "department",
    project_id: "",
    department_id: "",
    driver_name: "",
    driver_badge_number: "",
    vehicle_type_id: "",
    violation_type_id: "",
    itqan_ref: "",
    itqan_status_id: "",
    occurred_on: todayIso(),
    occurred_time: localTime,
  });

  useEffect(() => {
    if (!open) return;
    const underSafety = statuses.items.find((i) => i.label === "Under Safety");
    if (underSafety && !form.itqan_status_id) {
      setForm((c) => ({ ...c, itqan_status_id: underSafety.id }));
    }
  }, [open, statuses.items, form.itqan_status_id]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const projectScope = useAutoFormProject(open, form.project_id, (patch) =>
    setForm((c) => ({ ...c, ...patch })),
  );

  if (!open) return null;

  const required = [
    form.assign_to === "project" ? form.project_id : form.department_id,
    form.driver_name.trim(),
    form.driver_badge_number.trim(),
    form.vehicle_type_id,
    form.violation_type_id,
    form.itqan_ref.trim(),
    form.itqan_status_id,
    form.occurred_on,
    form.occurred_time,
    actorName,
  ];
  const remaining = required.length - required.filter(Boolean).length;
  const canRegister = remaining === 0 && !saving;
  const week = weekFromIsoDate(form.occurred_on);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canRegister) return;
    setSaving(true);
    setError(null);
    try {
      const created = await postJson<CaseDetail>("/api/v1/itqan-violations", {
        assign_to: form.assign_to,
        project_id: form.assign_to === "project" ? form.project_id : null,
        department_id: form.assign_to === "department" ? form.department_id : null,
        driver_name: form.driver_name,
        driver_badge_number: form.driver_badge_number,
        vehicle_type_id: form.vehicle_type_id,
        violation_type_id: form.violation_type_id,
        itqan_ref: form.itqan_ref,
        itqan_status_id: form.itqan_status_id,
        occurred_on: form.occurred_on,
        occurred_time: form.occurred_time,
        reported_by: actorName,
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
      <div className="drawer drawer-page" role="dialog" aria-modal="true" aria-label="New ITQAN entry">
        <div className="drawer-hd">
          <div>
            <div className="sub">SCC Platform / New ITQAN Violation</div>
            <h2>New ITQAN entry</h2>
          </div>
          <button type="button" className="iconbtn" aria-label="Close" onClick={onClose}>
            <Icon name="x" size={18} />
          </button>
        </div>
        <form onSubmit={(e) => void onSubmit(e)}>
          <div className="drawer-body">
            <section className="v1-card">
              <h3>Assignment &amp; driver</h3>
              <div className="fgrid">
                <div className="fld-ctl" style={{ gridColumn: "1 / -1" }}>
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
                          name="itqan-assign"
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
                <label className="fld-ctl">
                  <span className="lbl">
                    Driver name <span className="req">*</span>
                  </span>
                  <input
                    value={form.driver_name}
                    onChange={(e) => setForm({ ...form, driver_name: e.target.value })}
                    required
                  />
                </label>
                <label className="fld-ctl">
                  <span className="lbl">
                    Badge number <span className="req">*</span>
                  </span>
                  <input
                    value={form.driver_badge_number}
                    onChange={(e) => setForm({ ...form, driver_badge_number: e.target.value })}
                    required
                  />
                </label>
                <SelectList
                  label="Asset category"
                  type="vehicle_type"
                  value={form.vehicle_type_id}
                  onChange={(vehicle_type_id) => setForm({ ...form, vehicle_type_id })}
                  required
                  hideNotes
                />
              </div>
            </section>
            <section className="v1-card" style={{ marginTop: 12 }}>
              <h3>Violation</h3>
              <div className="fgrid">
                <SelectList
                  label="Violation type"
                  type="itqan_violation_type"
                  value={form.violation_type_id}
                  onChange={(violation_type_id) => setForm({ ...form, violation_type_id })}
                  required
                  hideNotes
                />
                <label className="fld-ctl">
                  <span className="lbl">
                    ITQAN reference <span className="req">*</span>
                  </span>
                  <input
                    value={form.itqan_ref}
                    onChange={(e) => setForm({ ...form, itqan_ref: e.target.value })}
                    placeholder="ITQ-000000"
                    required
                  />
                </label>
                <SelectList
                  label="ITQAN status"
                  type="itqan_status"
                  value={form.itqan_status_id}
                  onChange={(itqan_status_id) => setForm({ ...form, itqan_status_id })}
                  required
                  hideNotes
                />
                <label className="fld-ctl">
                  <span className="lbl">
                    Date <span className="req">*</span>
                  </span>
                  <input
                    type="date"
                    value={form.occurred_on}
                    onChange={(e) => setForm({ ...form, occurred_on: e.target.value })}
                    required
                  />
                </label>
                <label className="fld-ctl">
                  <span className="lbl">
                    Time <span className="req">*</span>
                  </span>
                  <input
                    type="time"
                    value={form.occurred_time}
                    onChange={(e) => setForm({ ...form, occurred_time: e.target.value })}
                    required
                  />
                </label>
                <div className="fld">
                  <span className="lbl">Week</span>
                  <input readOnly value={week != null ? `W${week}` : ""} />
                </div>
                <div className="fld full">
                  <SignedInNameField label="Reported by *" />
                </div>
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
              <Icon name="check" size={14} /> {saving ? "Saving…" : "Add to ITQAN log"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ItqanScreen({
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
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ItqanView>("overall");
  const [project, setProject] = useState("");
  const [department, setDepartment] = useState("");
  const [period, setPeriod] = useState<PeriodId>("ytd");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [curveMode, setCurveMode] = useState<CurveMode>("week");
  const [drawerOpen, setDrawerOpen] = useState(Boolean(openForm && canRegister));
  const [openRecordId, setOpenRecordId] = useState<string | null>(focusCaseId ?? null);
  const [logStatus, setLogStatus] = useState("All");
  const [logQ, setLogQ] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await fetchCases({ record_type: "itqan" });
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

  const catalogProjects = useMemo(
    () => projectList.items.map((item) => item.label),
    [projectList.items],
  );
  const projectAccess = useProjectAccess(catalogProjects);
  useAutoProjectFilter(projectAccess, project, setProject, setView);

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

  const statusCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of ITQAN_STATUSES) map.set(s, 0);
    for (const r of scoped) {
      const s = itqStatus(r);
      map.set(s, (map.get(s) || 0) + 1);
    }
    return map;
  }, [scoped]);

  const violationBars = useMemo(
    () => countBy(scoped, (r) => field(r, "violation_type") || "—"),
    [scoped],
  );
  const scopeBars = useMemo(
    () => countBy(scoped, (r) => r.project || r.department || "—"),
    [scoped],
  );
  const sourceBars = useMemo(
    () => countBy(scoped, (r) => field(r, "source") || "Manual entry"),
    [scoped],
  );

  const curve = useMemo(() => {
    if (curveMode === "month") {
      const labels: string[] = [];
      const data: number[] = [];
      for (let m = 0; m < 12; m++) {
        labels.push(MON3[m]!);
        data.push(
          scoped.filter((r) => {
            const [, mm] = r.date.split("-").map(Number);
            return mm === m + 1;
          }).length,
        );
      }
      return { labels, data };
    }
    const map = new Map<number, number>();
    for (const r of scoped) map.set(r.week_number, (map.get(r.week_number) || 0) + 1);
    const weeks = [...map.keys()].sort((a, b) => a - b).slice(-12);
    return {
      labels: weeks.map((w) => `W${w}`),
      data: weeks.map((w) => map.get(w) || 0),
    };
  }, [scoped, curveMode]);

  const logRows = useMemo(() => {
    let rows = [...scoped];
    if (logStatus !== "All") rows = rows.filter((r) => itqStatus(r) === logStatus);
    const q = logQ.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) =>
        [r.case_id, field(r, "driver_name"), field(r, "driver_badge_number"), field(r, "itqan_ref")]
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    }
    return rows.sort((a, b) => b.date.localeCompare(a.date) || b.case_id.localeCompare(a.case_id));
  }, [scoped, logStatus, logQ]);

  const gaugeMax = Math.max(scoped.length, Math.round(scoped.length * 1.25) || 10);

  return (
    <section className="page v1-page">
      <div className="v1-banner itqan">
        <div>
          <div className="eyebrow">SCC Platform / ITQAN Violations</div>
          <h1>ITQAN Internal Violations</h1>
          <p>
            Dashboard {year}
            <i>•</i> Internal Compliance <i>•</i> Violation Tracking <i>•</i> Corrective Actions
          </p>
        </div>
        <div className="v1-banner-actions">
          <span className="logo-chip itq">
            ITQ<em>A</em>N
          </span>
          {canRegister ? (
            <button type="button" className="btn primary" onClick={() => setDrawerOpen(true)}>
              <Icon name="plus" size={14} /> New ITQAN entry
            </button>
          ) : null}
        </div>
      </div>

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
              {!projectAccess.singleProject ? (
                <option value="">All projects</option>
              ) : null}
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
              <option value="">All departments</option>
              {departmentList.items.map((d) => (
                <option key={d.id} value={d.label}>
                  {d.label}
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

      {error ? <p className="state error">{error}</p> : null}
      {loading ? <p className="state">Loading ITQAN violations…</p> : null}

      <div className="v1-grid g6">
        <KpiTile
          title="Total violations"
          icon="itqan"
          value={scoped.length}
          sub="recorded in ITQAN"
        />
        {ITQAN_STATUSES.map((s) => (
          <KpiTile
            key={s}
            title={s}
            icon={s === "Closed" ? "review" : "clock"}
            value={statusCounts.get(s) || 0}
            sub={`${pct(statusCounts.get(s) || 0, scoped.length)}% of violations`}
          />
        ))}
      </div>

      <div className="v1-grid g3">
        <article className="v1-card">
          <h3>Total violations</h3>
          <Gauge value={scoped.length} max={gaugeMax} />
        </article>
        <article className="v1-card">
          <h3>Violations per vehicle type</h3>
          <VehicleDonut rows={scoped} />
        </article>
        <article className="v1-card">
          <h3>Violations type</h3>
          <HBarChart entries={violationBars} color={PAL.red} />
        </article>
      </div>

      <div className="v1-grid g3">
        <article className="v1-card">
          <h3>Violations by status</h3>
          <StatusPie rows={scoped} />
        </article>
        <article className="v1-card span2">
          <h3>Violations curve</h3>
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

      <div className="v1-grid g2">
        <article className="v1-card">
          <h3>By project and department</h3>
          <HBarList entries={scopeBars} />
        </article>
        <article className="v1-card">
          <h3>By source</h3>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
            Dashcam and Speed violations flow in at Confirm Driver &amp; Submit
          </p>
          <HBarList entries={sourceBars} color={PAL.steel} />
        </article>
      </div>

      <section className="v1-card ai-log">
        <div className="hd">
          <div>
            <h3>
              ITQAN violations log{" "}
              <small>
                {fmtN(logRows.length)} of {fmtN(scoped.length)} in the selected period · click a row
                to open it
              </small>
            </h3>
          </div>
          {canRegister ? (
            <button type="button" className="btn sm primary" onClick={() => setDrawerOpen(true)}>
              <Icon name="plus" size={13} /> New ITQAN entry
            </button>
          ) : null}
        </div>

        <div className="ai-log-filters">
          <div />
          <div className="ai-log-right">
            <select
              className="sel"
              value={logStatus}
              onChange={(e) => setLogStatus(e.target.value)}
              aria-label="Filter statuses"
            >
              <option value="All">All statuses</option>
              {ITQAN_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
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
                <th>Ref</th>
                <th>Date</th>
                <th>Driver / Badge</th>
                <th>Violation</th>
                <th>Vehicle</th>
                <th>Project / Dept</th>
                <th>Source</th>
                <th>ITQAN status</th>
              </tr>
            </thead>
            <tbody>
              {logRows.length ? (
                logRows.map((r) => {
                  const st = itqStatus(r);
                  const time = field(r, "occurred_time");
                  return (
                    <tr key={r.id} className="clk" onClick={() => setOpenRecordId(r.id)}>
                      <td>
                        <Thumb row={r} />
                      </td>
                      <td>
                        <span className="id">{r.case_id}</span>
                      </td>
                      <td>
                        <span className="num nw">
                          {formatDay(r.date)}
                          {time ? `, ${time}` : ""}
                          <br />
                          <small className="muted">W{r.week_number}</small>
                        </span>
                      </td>
                      <td>
                        <span className="nw">
                          {field(r, "driver_name") || "—"}
                          <br />
                          <small className="muted">{field(r, "driver_badge_number") || "—"}</small>
                        </span>
                      </td>
                      <td>{field(r, "violation_type") || "—"}</td>
                      <td>{field(r, "vehicle_type") || "—"}</td>
                      <td>{scopeLabel(r)}</td>
                      <td>{field(r, "source") || "—"}</td>
                      <td>
                        <span className={`tagx${statusTagClass(st)}`}>{st}</span>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={9} className="empty">
                    No ITQAN violations match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <ItqanNewDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onRegistered={(row) => {
          setDrawerOpen(false);
          notifyCasesChanged();
          void load().then(() => setOpenRecordId(row.id));
        }}
      />
      <ItqanRecordDrawer
        caseId={openRecordId}
        onClose={() => setOpenRecordId(null)}
        onChanged={() => void load()}
      />
    </section>
  );
}
