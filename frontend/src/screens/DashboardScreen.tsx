import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  fetchCases,
  fetchHw,
  fetchOverview,
  fetchOverdueNotifications,
  type CaseSummary,
  type DashboardOverview,
  type HwPayload,
} from "../api/scc";
import { errorMessage } from "../lib/errors";
import { href, type DashTab } from "../lib/routing";
import { useChartReveal } from "../lib/useChartReveal";
import {
  rowAllowedForProjects,
  useAutoProjectFilter,
  useProjectAccess,
} from "../lib/useProjectAccess";
import { useList } from "./shared";

/* Dashboard device tiles — values come from SCC Hardware (mapped labels). */
const DEVICE_TYPES = [
  "AI Camera",
  "GPS",
  "Dashcam",
  "Smart Helmet",
  "Smartwatch",
  "Weather Station",
] as const;

/** Map SCC HW catalog labels → dashboard device columns. */
const HW_TO_DASH: Record<string, (typeof DEVICE_TYPES)[number]> = {
  "AI Cameras": "AI Camera",
  "AI Camera": "AI Camera",
  AVL: "GPS",
  GPS: "GPS",
  Dashcams: "Dashcam",
  Dashcam: "Dashcam",
  "SOS Devices": "Smart Helmet",
  "Smart Helmet": "Smart Helmet",
  "Smart Helmets": "Smart Helmet",
  Smartwatch: "Smartwatch",
  "Smart Watch": "Smartwatch",
  Smartwatches: "Smartwatch",
  "Weather Stations": "Weather Station",
  "Weather Station": "Weather Station",
};

const DEV_IC = ["cctv", "gps", "cam", "helmet", "watch", "weather"] as const;

const PAL = {
  red: "#C8102E",
  steel: "#8B8A8F",
  amber: "#D98B13",
  copper: "#B4572E",
  sand: "#CDB48A",
  olive: "#7C8C47",
  ink: "#1D1C1F",
  ink2: "#4A474C",
  green: "#3F8A57",
};

const DONUT_PAL = [
  "#C8102E",
  "#8B8A8F",
  "#D98B13",
  "#B4572E",
  "#CDB48A",
  "#5B5A60",
  "#E1252F",
  "#A9A6A3",
  "#7C8C47",
  "#3A393E",
  "#F0A63A",
  "#6E1520",
];

const TECH_COLORS = [
  PAL.steel,
  PAL.amber,
  PAL.red,
  PAL.copper,
  PAL.ink2,
  PAL.olive,
];

type DashView = "overall" | "projects" | "departments";
type PeriodId =
  | "today"
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "ytd"
  | "custom";

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

function fmtN(n: number) {
  return Number(n || 0).toLocaleString("en-US");
}

type ChartTipData = {
  x: number;
  y: number;
  title: string;
  rows: Array<{ color: string; text: string }>;
  footer?: string;
  place?: "top" | "left" | "right" | "bottom";
};

function tipFromEvent(
  e: { clientX: number; clientY: number },
  host: HTMLElement | null,
  data: Omit<ChartTipData, "x" | "y">,
): ChartTipData | null {
  if (!host) return null;
  const r = host.getBoundingClientRect();
  return {
    ...data,
    x: e.clientX - r.left,
    y: e.clientY - r.top,
  };
}

function ChartTip({ tip }: { tip: ChartTipData | null }) {
  if (!tip) return null;
  return (
    <div
      className={`v1-chart-tip place-${tip.place || "top"}`}
      style={{ left: tip.x, top: tip.y }}
      role="tooltip"
    >
      <b>{tip.title}</b>
      {tip.rows.map((row, i) => (
        <div className="row" key={`${row.text}-${i}`}>
          <i style={{ background: row.color }} />
          <span>{row.text}</span>
        </div>
      ))}
      {tip.footer ? <div className="foot">{tip.footer}</div> : null}
    </div>
  );
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

function periodRange(
  period: PeriodId,
  from: string,
  to: string,
  now = new Date(),
) {
  const year = now.getFullYear();
  const t0 = sod(now).getTime();
  let a = t0;
  let b = now.getTime();
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
      b = to ? new Date(`${to}T23:59:59`).getTime() : now.getTime();
      const L = Math.max(DAY_MS, b - a);
      pb = a - 1;
      pa = a - L;
      label = `${formatDay(isoDate(new Date(a)))} to ${formatDay(isoDate(new Date(b)))}`;
      cmp = `previous ${Math.round(L / DAY_MS)} days`;
      break;
    }
    default: {
      a = new Date(year, 0, 1).getTime();
      pa = new Date(year - 1, 0, 1).getTime();
      pb = pa + (b - a);
      label = `1 Jan to ${formatDay(isoDate(now))} (Year to date)`;
      cmp = null;
      break;
    }
  }
  return {
    a,
    b,
    pa,
    pb,
    label,
    cmp,
    startIso: isoDate(new Date(a)),
    endIso: isoDate(new Date(Math.min(b, now.getTime()))),
  };
}

function matchesDevice(r: CaseSummary, device: string) {
  if (device === "All") return true;
  if (device === "AI Camera") return r.record_type === "ai_camera";
  if (device === "Dashcam") return r.record_type === "dashcam";
  if (device === "GPS") return r.record_type === "speed";
  if (device === "Smart Helmet" || device === "Smartwatch") return r.record_type === "sos";
  if (device === "Weather Station") return false;
  return true;
}

function isRow(r: CaseSummary) {
  return r.record_type === "speed" && /\brow\b/i.test(`${r.title} ${r.case_id}`);
}

function isLv(r: CaseSummary) {
  return (
    r.record_type === "speed" &&
    !isRow(r) &&
    /light/i.test(r.title || "")
  );
}

function isHv(r: CaseSummary) {
  return (
    r.record_type === "speed" &&
    !isRow(r) &&
    /heavy/i.test(r.title || "")
  );
}

function isPublicSpeed(r: CaseSummary) {
  return r.record_type === "speed" && !isRow(r);
}

function deltaMeta(cur: number, prev: number | null) {
  if (prev == null) return { text: "", cls: "flat" as const };
  if (!prev && !cur) return { text: "0%", cls: "flat" as const };
  if (!prev) return { text: "▲ new", cls: "up-bad" as const };
  const d = Math.round(((cur - prev) / prev) * 100);
  if (d === 0) return { text: "0%", cls: "flat" as const };
  return {
    text: `${d > 0 ? "▲" : "▼"} ${Math.abs(d)}%`,
    cls: (d > 0 ? "up-bad" : "down-good") as "up-bad" | "down-good",
  };
}

function Spark({
  values,
  color = PAL.red,
  weekLabels,
}: {
  values: number[];
  color?: string;
  weekLabels?: Array<{ label: string; range: string }>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<ChartTipData | null>(null);
  const reveal = useChartReveal(hostRef, values.join(","));
  const w = 120;
  const h = 30;
  const mx = Math.max(1, ...values);
  const mn = Math.min(0, ...values);
  const span = Math.max(1, mx - mn);
  const points = values.map((v, i) => {
    const x = values.length <= 1 ? w / 2 : (i / (values.length - 1)) * w;
    const y = h - ((v - mn) / span) * (h - 4) - 2;
    return { x, y, v, i };
  });
  const visibleCount = Math.max(1, Math.ceil(values.length * Math.max(reveal, 0.001)));
  const shown = points.slice(0, visibleCount);
  const pts = shown.map((p) => `${p.x},${p.y}`).join(" ");
  return (
    <div className="v1-chart-host v1-spark-host" ref={hostRef} onMouseLeave={() => setTip(null)}>
      <svg className="v1-spark" viewBox={`0 0 ${w} ${h}`} width="100%" height={30} aria-hidden>
        <polyline fill="none" stroke={color} strokeWidth="2" points={pts} pointerEvents="none" />
        {shown.map((p) => {
          const wk = weekLabels?.[p.i];
          const title = wk ? `${wk.label}, ${wk.range}` : `Week ${p.i + 1}`;
          return (
            <circle
              key={p.i}
              cx={p.x}
              cy={p.y}
              r={4}
              fill={color}
              style={{ cursor: "pointer" }}
              onMouseMove={(e) =>
                setTip(
                  tipFromEvent(e, hostRef.current, {
                    title,
                    rows: [{ color, text: fmtN(p.v) }],
                    place: "top",
                  }),
                )
              }
              onMouseLeave={() => setTip(null)}
            />
          );
        })}
      </svg>
      <ChartTip tip={tip} />
    </div>
  );
}

function deviceRowsFromHw(hw: HwPayload | null): Array<[string, number[]]> {
  if (!hw?.project_counts) return [];
  return Object.entries(hw.project_counts)
    .map(([site, counts]) => {
      const vals = DEVICE_TYPES.map((dashType) =>
        Object.entries(counts).reduce((sum, [hwType, n]) => {
          if (HW_TO_DASH[hwType] === dashType) return sum + (Number(n) || 0);
          return sum;
        }, 0),
      );
      return [site, vals] as [string, number[]];
    })
    .sort((a, b) => b[1].reduce((x, y) => x + y, 0) - a[1].reduce((x, y) => x + y, 0));
}

function deviceTotals(rows: Array<[string, number[]]>) {
  return DEVICE_TYPES.map((_, i) => rows.reduce((a, [, v]) => a + (v[i] || 0), 0));
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
    case "dash":
      return (
        <svg {...c}>
          <rect x="3" y="3" width="7" height="9" rx="1.5" />
          <rect x="14" y="3" width="7" height="5" rx="1.5" />
          <rect x="14" y="12" width="7" height="9" rx="1.5" />
          <rect x="3" y="16" width="7" height="5" rx="1.5" />
        </svg>
      );
    case "report":
      return (
        <svg {...c}>
          <path d="M6 3h9l4 4v14H6z" />
          <path d="M15 3v4h4M9 13h6M9 17h6" />
        </svg>
      );
    case "shield":
      return (
        <svg {...c}>
          <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    case "cctv":
      return (
        <svg {...c}>
          <path d="M2 8l14-4 2 6-14 4z" />
          <path d="M6 13l1 4h4" />
        </svg>
      );
    case "gps":
      return (
        <svg {...c}>
          <circle cx="12" cy="12" r="3" />
          <circle cx="12" cy="12" r="8" />
        </svg>
      );
    case "cam":
      return (
        <svg {...c}>
          <path d="M3 7h11l3 3v4l-3 3H3z" />
          <path d="M17 10l4-2v8l-4-2" />
        </svg>
      );
    case "helmet":
      return (
        <svg {...c}>
          <path d="M3 16h18" />
          <path d="M5 16a7 7 0 0 1 14 0" />
        </svg>
      );
    case "watch":
      return (
        <svg {...c}>
          <rect x="7" y="4" width="10" height="16" rx="3" />
          <path d="M12 10v3l2 1" />
        </svg>
      );
    case "weather":
      return (
        <svg {...c}>
          <path d="M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 11a3.5 3.5 0 0 0 1 7z" />
        </svg>
      );
    case "bell":
      return (
        <svg {...c}>
          <path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z" />
          <path d="M10 20a2 2 0 0 0 4 0" />
        </svg>
      );
    case "alert":
      return (
        <svg {...c}>
          <path d="M12 3l10 18H2z" />
          <path d="M12 10v4M12 17h.01" />
        </svg>
      );
    case "car":
      return (
        <svg {...c}>
          <path d="M5 17h14v-5l-2-5H7l-2 5z" />
          <circle cx="7.5" cy="17.5" r="1.5" />
          <circle cx="16.5" cy="17.5" r="1.5" />
        </svg>
      );
    case "clock":
      return (
        <svg {...c}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case "download":
      return (
        <svg {...c}>
          <path d="M12 4v10M8 10l4 4 4-4M5 19h14" />
        </svg>
      );
    default:
      return null;
  }
}

function niceAxisMax(raw: number) {
  const n = Math.max(1, raw);
  if (n <= 5) return n;
  const exp = Math.pow(10, Math.floor(Math.log10(n)));
  const m = n / exp;
  const nice = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return Math.ceil(nice * exp);
}

function axisTicks(max: number, preferred = 5) {
  const steps = max <= 5 ? max : preferred;
  const vals: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const v = Math.round((max * i) / steps);
    if (!vals.includes(v)) vals.push(v);
  }
  if (vals[vals.length - 1] !== max) vals.push(max);
  return vals;
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

function Donut({
  labels,
  values,
  colors,
  center,
  size = 200,
  cut = 0.58,
}: {
  labels: string[];
  values: number[];
  colors: string[];
  center?: { value: string; label: string };
  size?: number;
  cut?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<ChartTipData | null>(null);
  const reveal = useChartReveal(hostRef, `${labels.join("|")}|${values.join(",")}`);
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const r = size * 0.34;
  const stroke = size * 0.1 * (1 - cut * 0.12);
  const c = 2 * Math.PI * r;
  let offset = 0;
  const cx = size / 2;
  const cy = size / 2;
  const active = values
    .map((v, i) => ({ v, label: labels[i] ?? String(i), color: colors[i % colors.length]! }))
    .filter((x) => x.v > 0);

  function showSeg(
    e: ReactMouseEvent,
    label: string,
    color: string,
    value: number,
  ) {
    setTip(
      tipFromEvent(e, hostRef.current, {
        title: label,
        rows: [{ color, text: fmtN(value) }],
        place: "top",
      }),
    );
  }

  return (
    <div
      className="v1-donut-wrap"
      ref={hostRef}
      style={{ width: size, height: size }}
      onMouseLeave={() => setTip(null)}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="var(--line)"
          strokeWidth={stroke}
          pointerEvents="none"
        />
        {active.length === 1 ? (
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={active[0]!.color}
            strokeWidth={stroke}
            strokeDasharray={c}
            strokeDashoffset={c * (1 - reveal)}
            transform={`rotate(-90 ${cx} ${cy})`}
            style={{ cursor: "pointer" }}
            onMouseMove={(e) =>
              showSeg(e, active[0]!.label, active[0]!.color, active[0]!.v)
            }
            onMouseLeave={() => setTip(null)}
          />
        ) : (
          values.map((v, i) => {
            if (!v) return null;
            const len = (v / total) * c * reveal;
            const label = labels[i] ?? String(i);
            const color = colors[i % colors.length]!;
            const el = (
              <circle
                key={label}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={color}
                strokeWidth={stroke}
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${cx} ${cy})`}
                strokeLinecap="butt"
                style={{ cursor: "pointer" }}
                onMouseMove={(e) => showSeg(e, label, color, v)}
                onMouseLeave={() => setTip(null)}
              />
            );
            offset += (v / total) * c * reveal;
            return el;
          })
        )}
      </svg>
      {center ? (
        <div className="v1-donut-center">
          <b>{center.value}</b>
          <small>{center.label}</small>
        </div>
      ) : null}
      <ChartTip tip={tip} />
    </div>
  );
}

function HBars({
  rows,
  colorFor,
}: {
  rows: Array<{ label: string; value: number }>;
  colorFor?: (label: string, i: number) => string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<ChartTipData | null>(null);
  const reveal = useChartReveal(
    hostRef,
    rows.map((r) => `${r.label}:${r.value}`).join("|"),
  );
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="v1-bars v1-chart-host" ref={hostRef} onMouseLeave={() => setTip(null)}>
      {rows.map((row, i) => {
        const barColor =
          colorFor?.(row.label, i) ??
          (row.label === "Total" ? "var(--ink-2)" : "var(--steel)");
        return (
          <div className="v1-bar" key={row.label}>
            <span className="l">{row.label}</span>
            <span className="tr">
              <i
                style={{
                  width: `${(row.value / max) * 100 * reveal}%`,
                  background: barColor,
                  cursor: row.value > 0 ? "pointer" : "default",
                }}
                onMouseMove={
                  row.value > 0
                    ? (e) =>
                        setTip(
                          tipFromEvent(e, hostRef.current, {
                            title: row.label,
                            rows: [{ color: barColor, text: fmtN(row.value) }],
                            place: "right",
                          }),
                        )
                    : undefined
                }
                onMouseLeave={() => setTip(null)}
              />
            </span>
            <span className="v">{fmtN(row.value)}</span>
          </div>
        );
      })}
      <ChartTip tip={tip} />
    </div>
  );
}

function VBars({
  labels,
  values,
  colors,
  highlight,
}: {
  labels: string[];
  values: number[];
  colors: string[];
  highlight?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<ChartTipData | null>(null);
  const reveal = useChartReveal(hostRef, `${labels.join("|")}|${values.join(",")}`);
  const max = niceAxisMax(Math.max(1, ...values));
  const ticks = axisTicks(max);
  return (
    <div className="v1-vbars-wrap" ref={hostRef} onMouseLeave={() => setTip(null)}>
      <div className="v1-vbars-y">
        {[...ticks].reverse().map((t) => (
          <span key={t}>{fmtN(t)}</span>
        ))}
      </div>
      <div className="v1-vbars">
        <div className="v1-vbars-grid" aria-hidden>
          {ticks.map((t) => (
            <i
              key={t}
              className={t === 0 ? "is-zero" : undefined}
              style={{ bottom: `${(t / max) * 100}%` }}
            />
          ))}
        </div>
        {labels.map((label, i) => {
          const dim = highlight && highlight !== "All" && highlight !== label;
          const color = dim ? "var(--line)" : colors[i % colors.length]!;
          const value = values[i] || 0;
          return (
            <div className="v1-vbar" key={label}>
              <div className="col">
                <span
                  style={{
                    height: `${(value / max) * 100 * reveal}%`,
                    background: color,
                    cursor: value > 0 ? "pointer" : "default",
                  }}
                  onMouseMove={
                    value > 0
                      ? (e) =>
                          setTip(
                            tipFromEvent(e, hostRef.current, {
                              title: label,
                              rows: [
                                {
                                  color: colors[i % colors.length]!,
                                  text: fmtN(value),
                                },
                              ],
                              place: "top",
                            }),
                          )
                      : undefined
                  }
                  onMouseLeave={() => setTip(null)}
                />
              </div>
              <small>
                {label.split(" ").map((w) => (
                  <span key={w}>{w}</span>
                ))}
              </small>
            </div>
          );
        })}
      </div>
      <ChartTip tip={tip} />
    </div>
  );
}

function StackedWeekChart({
  weeks,
  series,
}: {
  weeks: Array<{ label: string; range: string }>;
  series: Array<{ name: string; color: string; data: number[] }>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<ChartTipData | null>(null);
  const reveal = useChartReveal(
    hostRef,
    `${weeks.map((w) => w.label).join("|")}|${series.map((s) => s.data.join(",")).join(";")}`,
  );
  const totals = weeks.map((_, i) => series.reduce((a, s) => a + (s.data[i] || 0), 0));
  const max = niceAxisMax(Math.max(1, ...totals));
  const W = 760;
  const H = 200;
  const pad = { t: 12, r: 12, b: 36, l: 36 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const n = Math.max(1, weeks.length);
  const slot = iw / n;
  const barW = Math.min(36, slot * 0.55);
  const ticks = axisTicks(max);
  const totalPts = totals.map((v, i) => {
    const x = pad.l + slot * i + slot / 2;
    const y = pad.t + ih - (v / max) * ih * reveal;
    return [x, y] as const;
  });
  const totalLine = smoothCurvePath(totalPts, pad.t, pad.t + ih);

  function showWeek(e: ReactMouseEvent, i: number) {
    const w = weeks[i]!;
    const cur = totals[i] || 0;
    const prev = i > 0 ? totals[i - 1] || 0 : null;
    const diff = prev == null ? null : cur - prev;
    const pct =
      prev == null || prev === 0
        ? null
        : Math.round(((cur - prev) / prev) * 100);
    setTip(
      tipFromEvent(e, hostRef.current, {
        title: `${w.label}, ${w.range}`,
        rows: [
          ...series.map((s) => ({
            color: s.color,
            text: `${s.name}: ${fmtN(s.data[i] || 0)}`,
          })),
          { color: "var(--ink)", text: `Total: ${fmtN(cur)}` },
        ],
        footer:
          diff == null
            ? undefined
            : `Change vs previous week: ${diff > 0 ? "+" : ""}${diff}${
                pct == null ? "" : ` (${pct > 0 ? "+" : ""}${pct}%)`
              }`,
        place: "left",
      }),
    );
  }

  return (
    <div className="v1-chart-host" ref={hostRef} onMouseLeave={() => setTip(null)}>
      <svg className="v1-stack-chart" viewBox={`0 0 ${W} ${H}`} aria-hidden>
        {ticks.map((val) => {
          const y = pad.t + ih * (1 - val / max);
          return (
            <g key={val}>
              <line x1={pad.l} x2={W - pad.r} y1={y} y2={y} stroke="var(--line)" strokeWidth={1} />
              <text x={pad.l - 6} y={y + 3} textAnchor="end" fontSize={10} fill="var(--muted)">
                {fmtN(val)}
              </text>
            </g>
          );
        })}
        {weeks.map((w, i) => {
          const x = pad.l + slot * i + slot / 2 - barW / 2;
          let y = pad.t + ih;
          const topSi = (() => {
            for (let si = series.length - 1; si >= 0; si--) {
              if ((series[si]!.data[i] || 0) > 0) return si;
            }
            return -1;
          })();
          return (
            <g key={`${w.label}-${i}`}>
              {series.map((s, si) => {
                const v = s.data[i] || 0;
                const h = (v / max) * ih * reveal;
                y -= h;
                if (h <= 0) return null;
                return (
                  <rect
                    key={s.name}
                    x={x}
                    y={y}
                    width={barW}
                    height={Math.max(1, h)}
                    fill={s.color}
                    rx={si === topSi ? 2 : 0}
                    style={{ cursor: "pointer" }}
                    onMouseMove={(e) => showWeek(e, i)}
                    onMouseLeave={() => setTip(null)}
                  />
                );
              })}
              <text
                x={pad.l + slot * i + slot / 2}
                y={H - 18}
                textAnchor="middle"
                fontSize={10}
                fill="var(--muted)"
              >
                {w.label}
              </text>
              <text
                x={pad.l + slot * i + slot / 2}
                y={H - 6}
                textAnchor="middle"
                fontSize={9}
                fill="var(--muted)"
              >
                {w.range}
              </text>
            </g>
          );
        })}
        {totalLine ? (
          <path
            d={totalLine}
            fill="none"
            stroke="var(--ink)"
            strokeWidth={2}
            pointerEvents="none"
          />
        ) : null}
        {totalPts.map((p, i) => (
          <circle
            key={i}
            cx={p[0]}
            cy={p[1]}
            r={3.5}
            fill="var(--ink)"
            stroke="var(--surface)"
            strokeWidth={2}
            style={{ cursor: "pointer" }}
            onMouseMove={(e) => showWeek(e, i)}
            onMouseLeave={() => setTip(null)}
          />
        ))}
      </svg>
      <ChartTip tip={tip} />
    </div>
  );
}

function weekBuckets(cases: CaseSummary[], count = 10) {
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - start.getDay() - 7 * (count - 1));
  start.setHours(0, 0, 0, 0);
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
  const weeks: Array<{ label: string; range: string; a: number; b: number }> = [];
  for (let i = 0; i < count; i += 1) {
    const a = new Date(start);
    a.setDate(start.getDate() + i * 7);
    const b = new Date(a);
    b.setDate(a.getDate() + 7);
    const weekNo =
      Math.floor(
        (Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()) -
          Date.UTC(a.getFullYear(), 0, 1)) /
          86400000 /
          7,
      ) + 1;
    weeks.push({
      label: `W${weekNo}`,
      range: `${a.getDate()} ${months[a.getMonth()]}`,
      a: a.getTime(),
      b: b.getTime(),
    });
  }
  function countType(pred: (r: CaseSummary) => boolean) {
    return weeks.map(
      (w) =>
        cases.filter((r) => {
          const t = new Date(r.date).getTime();
          return pred(r) && t >= w.a && t < w.b;
        }).length,
    );
  }
  return { weeks, countType };
}

function WeekObsVioChart({
  weeks,
  obs,
  vio,
  chg,
}: {
  weeks: Array<{ label: string; range: string }>;
  obs: number[];
  vio: number[];
  chg: number[];
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<ChartTipData | null>(null);
  const reveal = useChartReveal(
    hostRef,
    `${weeks.map((w) => w.label).join("|")}|${obs.join(",")}|${vio.join(",")}|${chg.join(",")}`,
  );
  const maxBar = niceAxisMax(Math.max(1, ...obs, ...vio));
  // Keep % axis readable; a single huge jump shouldn't stretch to ±500%
  const rawChg = Math.max(20, ...chg.map((x) => Math.abs(x || 0)));
  const maxChg = Math.min(100, niceAxisMax(rawChg));
  const W = 1000;
  const H = 260;
  const pad = { t: 14, r: 48, b: 32, l: 40 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const n = Math.max(1, weeks.length);
  const slot = iw / n;
  // Same width for both series — clearer side-by-side comparison
  const barW = Math.min(26, slot * 0.38);
  const gap = 3;
  const barTicks = axisTicks(maxBar);
  const chgTicks = [-maxChg, -maxChg / 2, 0, maxChg / 2, maxChg].map((v) => Math.round(v));
  const chgY = (pct: number) => {
    const clamped = Math.max(-maxChg, Math.min(maxChg, pct));
    return pad.t + ih / 2 - (clamped / maxChg) * (ih / 2);
  };
  const chgPts = weeks.map((_, i) => {
    const x = pad.l + slot * i + slot / 2;
    return [x, chgY(chg[i] || 0)] as const;
  });
  const chgVisible = Math.max(2, Math.ceil(weeks.length * Math.max(reveal, 0.001)));
  const chgShown = chgPts.slice(0, chgVisible);
  const chgLine = smoothCurvePath(chgShown, pad.t, pad.t + ih);

  function showWeek(e: ReactMouseEvent, i: number) {
    const w = weeks[i]!;
    setTip(
      tipFromEvent(e, hostRef.current, {
        title: `${w.label}, ${w.range}`,
        rows: [
          {
            color: PAL.steel,
            text: `Observations (AI Camera + SOS): ${fmtN(obs[i] || 0)}`,
          },
          {
            color: PAL.red,
            text: `Violations (Dashcam + Speed + ROW): ${fmtN(vio[i] || 0)}`,
          },
          {
            color: PAL.amber,
            text: `Violations change vs previous week (%): ${Math.round(chg[i] || 0)}`,
          },
        ],
        place: "top",
      }),
    );
  }

  return (
    <div className="v1-chart-host" ref={hostRef} onMouseLeave={() => setTip(null)}>
      <svg className="v1-dual-chart" viewBox={`0 0 ${W} ${H}`} aria-hidden>
        {barTicks.map((val) => {
          const y = pad.t + ih * (1 - val / maxBar);
          return (
            <g key={`b-${val}`}>
              <line x1={pad.l} x2={W - pad.r} y1={y} y2={y} stroke="var(--line)" strokeWidth={1} />
              <text x={pad.l - 6} y={y + 3} textAnchor="end" fontSize={11} fill="var(--muted)">
                {fmtN(val)}
              </text>
            </g>
          );
        })}
        {chgTicks.map((val) => {
          const y = chgY(val);
          return (
            <text
              key={`c-${val}`}
              x={W - pad.r + 6}
              y={y + 3}
              textAnchor="start"
              fontSize={11}
              fill="var(--muted)"
            >
              {val}%
            </text>
          );
        })}
        {weeks.map((w, i) => {
          const cx = pad.l + slot * i + slot / 2;
          const obsH = ((obs[i] || 0) / maxBar) * ih * reveal;
          const vioH = ((vio[i] || 0) / maxBar) * ih * reveal;
          const pairW = barW * 2 + gap;
          const left = cx - pairW / 2;
          return (
            <g key={`${w.label}-${i}`}>
              {obsH > 0 ? (
                <rect
                  x={left}
                  y={pad.t + ih - obsH}
                  width={barW}
                  height={Math.max(2, obsH)}
                  rx={2}
                  fill={PAL.steel}
                  style={{ cursor: "pointer" }}
                  onMouseMove={(e) => showWeek(e, i)}
                  onMouseLeave={() => setTip(null)}
                />
              ) : null}
              {vioH > 0 ? (
                <rect
                  x={left + barW + gap}
                  y={pad.t + ih - vioH}
                  width={barW}
                  height={Math.max(2, vioH)}
                  rx={2}
                  fill={PAL.red}
                  style={{ cursor: "pointer" }}
                  onMouseMove={(e) => showWeek(e, i)}
                  onMouseLeave={() => setTip(null)}
                />
              ) : null}
              <text x={cx} y={H - 10} textAnchor="middle" fontSize={11.5} fill="var(--muted)">
                {w.label} {w.range}
              </text>
            </g>
          );
        })}
        {chgLine ? (
          <path
            d={chgLine}
            fill="none"
            stroke={PAL.amber}
            strokeWidth={2.25}
            strokeDasharray="5 4"
            pointerEvents="none"
          />
        ) : null}
        {chgShown.map((p, i) => (
          <circle
            key={i}
            cx={p[0]}
            cy={p[1]}
            r={4}
            fill={PAL.amber}
            stroke="var(--surface)"
            strokeWidth={2}
            style={{ cursor: "pointer" }}
            onMouseMove={(e) => showWeek(e, i)}
            onMouseLeave={() => setTip(null)}
          />
        ))}
      </svg>
      <ChartTip tip={tip} />
    </div>
  );
}

function MonthTrendChart({
  labels,
  series,
}: {
  labels: string[];
  series: Array<{ n: string; c: string; data: number[] }>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<ChartTipData | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const reveal = useChartReveal(
    hostRef,
    `${labels.join("|")}|${series.map((s) => `${s.n}:${s.data.join(",")}`).join(";")}`,
  );
  const w = 760;
  const h = 168;
  const pad = { t: 14, r: 14, b: 26, l: 36 };
  const max = niceAxisMax(Math.max(1, ...series.flatMap((s) => s.data)));
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const xAt = (i: number) =>
    pad.l + (labels.length <= 1 ? innerW / 2 : (i / (labels.length - 1)) * innerW);
  const yAt = (v: number) => pad.t + innerH - (v / max) * innerH;
  const visibleCount = Math.max(1, Math.ceil(labels.length * Math.max(reveal, 0.001)));
  const ticks = axisTicks(max);
  function showMonth(e: ReactMouseEvent, i: number) {
    setActive(i);
    setTip(
      tipFromEvent(e, hostRef.current, {
        title: labels[i] || "",
        rows: series.map((s) => ({
          color: s.c,
          text: `${s.n}: ${fmtN(s.data[i] || 0)}`,
        })),
        place: "top",
      }),
    );
  }

  return (
    <div
      className="v1-chart-host"
      ref={hostRef}
      onMouseLeave={() => {
        setTip(null);
        setActive(null);
      }}
    >
      <svg className="v1-month-chart" viewBox={`0 0 ${w} ${h}`} aria-hidden>
        {ticks.map((val) => {
          const y = yAt(val);
          return (
            <g key={val}>
              <line x1={pad.l} x2={w - pad.r} y1={y} y2={y} stroke="var(--line)" strokeWidth="1" />
              <text x={pad.l - 6} y={y + 3} textAnchor="end" fontSize="10" fill="var(--muted)">
                {fmtN(val)}
              </text>
            </g>
          );
        })}
        {active != null ? (
          <line
            x1={xAt(active)}
            x2={xAt(active)}
            y1={pad.t}
            y2={pad.t + innerH}
            stroke="var(--ink-2)"
            strokeWidth={1}
            strokeOpacity={0.35}
            pointerEvents="none"
          />
        ) : null}
        {series.map((s) => {
          const pts = s.data.map((v, i) => [xAt(i), yAt(v)] as const);
          const shownPts = pts.slice(0, visibleCount);
          const line = smoothCurvePath(shownPts, pad.t, pad.t + innerH);
          return (
            <g key={s.n}>
              {line ? (
                <path
                  d={line}
                  fill="none"
                  stroke={s.c}
                  strokeWidth="2.25"
                  pointerEvents="none"
                />
              ) : null}
              {shownPts.map((p, i) => (
                <circle
                  key={i}
                  cx={p[0]}
                  cy={p[1]}
                  r="5"
                  fill={s.c}
                  style={{ cursor: "pointer" }}
                  onMouseMove={(e) => showMonth(e, i)}
                  onMouseLeave={() => {
                    setTip(null);
                    setActive(null);
                  }}
                />
              ))}
            </g>
          );
        })}
        {labels.map((label, i) => (
          <text
            key={label}
            x={xAt(i)}
            y={h - 6}
            textAnchor="middle"
            fontSize="11"
            fill="var(--muted)"
          >
            {label}
          </text>
        ))}
      </svg>
      <ChartTip tip={tip} />
    </div>
  );
}

function RiskStackedChart({
  rows,
}: {
  rows: Array<{
    label: "High" | "Medium" | "Low";
    closed: number;
    open: number;
  }>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<ChartTipData | null>(null);
  const reveal = useChartReveal(
    hostRef,
    rows.map((r) => `${r.label}:${r.closed},${r.open}`).join("|"),
  );
  const colors = {
    High: { closed: "#E88A96", open: PAL.red },
    Medium: { closed: "#E8C48A", open: PAL.amber },
    Low: { closed: "#E2D4B8", open: PAL.sand },
  };
  const max = Math.max(1, ...rows.map((r) => r.closed + r.open));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(max * t));

  function showSeg(
    e: ReactMouseEvent,
    label: string,
    kind: "Closed" | "Not closed",
    color: string,
    value: number,
  ) {
    setTip(
      tipFromEvent(e, hostRef.current, {
        title: label,
        rows: [{ color, text: `${kind}: ${fmtN(value)}` }],
        place: "left",
      }),
    );
  }

  return (
    <div className="v1-risk-stack" ref={hostRef} onMouseLeave={() => setTip(null)}>
      <div className="v1-risk-stack-plot">
        <div className="v1-risk-stack-y">
          {rows.map((r) => (
            <span key={r.label}>{r.label}</span>
          ))}
        </div>
        <div className="v1-risk-stack-bars">
          <div className="v1-risk-stack-grid">
            {ticks.map((t) => (
              <i key={t} style={{ left: `${(t / max) * 100}%` }} />
            ))}
          </div>
          {rows.map((r) => {
            const total = r.closed + r.open;
            const closedPct = (r.closed / max) * 100 * reveal;
            const openPct = (r.open / max) * 100 * reveal;
            return (
              <div className="v1-risk-stack-row" key={r.label}>
                <div className="track">
                  {r.closed > 0 ? (
                    <span
                      className="seg closed"
                      style={{
                        width: `${closedPct}%`,
                        background: colors[r.label].closed,
                      }}
                      onMouseMove={(e) =>
                        showSeg(e, r.label, "Closed", colors[r.label].closed, r.closed)
                      }
                      onMouseLeave={() => setTip(null)}
                    />
                  ) : null}
                  {r.open > 0 ? (
                    <span
                      className="seg open"
                      style={{
                        width: `${openPct}%`,
                        background: colors[r.label].open,
                      }}
                      onMouseMove={(e) =>
                        showSeg(e, r.label, "Not closed", colors[r.label].open, r.open)
                      }
                      onMouseLeave={() => setTip(null)}
                    />
                  ) : null}
                </div>
                <span className="sr-only">
                  {r.label}: {fmtN(total)}
                </span>
              </div>
            );
          })}
          <div className="v1-risk-stack-x">
            {ticks.map((t) => (
              <span key={t} style={{ left: `${(t / max) * 100}%` }}>
                {fmtN(t)}
              </span>
            ))}
          </div>
          <ChartTip tip={tip} />
        </div>
      </div>
      <div className="v1-legend row risk-legend">
        <span>
          <i style={{ background: colors.High.closed }} />
          Closed
        </span>
        <span>
          <i style={{ background: colors.High.open }} />
          Not closed
        </span>
      </div>
    </div>
  );
}

function LocCard({
  title,
  index,
  rows,
  totals,
}: {
  title: string;
  index: number;
  rows: Array<[string, number[]]>;
  totals: number[];
}) {
  const entries = rows
    .map(([l, v]) => ({ label: l, value: v[index] }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value);
  return (
    <article className="v1-card">
      <div className="hd">
        <h3>{title}</h3>
      </div>
      <p className="sub">
        {entries.length} {entries.length === 1 ? "location" : "locations"}
      </p>
      {entries.length ? (
        <HBars
          rows={[{ label: "Total", value: totals[index] }, ...entries]}
          colorFor={(k) =>
            k === "Total" ? "var(--ink-2)" : index === 4 || index === 5 ? "var(--red)" : "var(--steel)"
          }
        />
      ) : (
        <div className="empty">No devices in this scope.</div>
      )}
    </article>
  );
}

export function DashboardScreen({
  tab,
}: {
  tab: DashTab;
  dark?: boolean;
  onDark?: (value: boolean) => void;
}) {
  const mainTab: "overview" | "summary" = tab === "summary" ? "summary" : "overview";
  const projectList = useList("project");
  const departmentList = useList("department");

  const [view, setView] = useState<DashView>("overall");
  const [period, setPeriod] = useState<PeriodId>("ytd");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [device, setDevice] = useState<string>("All");
  const [project, setProject] = useState("");
  const [department, setDepartment] = useState("");
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [hw, setHw] = useState<HwPayload | null>(null);
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [overdue, setOverdue] = useState<{
    items: Array<Record<string, unknown>>;
    counts: { all: number };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const catalogProjects = useMemo(
    () =>
      projectList.items.length
        ? projectList.items.map((p) => p.label)
        : overview?.projects ?? [],
    [projectList.items, overview?.projects],
  );
  const projectAccess = useProjectAccess(catalogProjects);
  useAutoProjectFilter(projectAccess, project, setProject, setView);

  const range = useMemo(
    () => periodRange(period, customFrom, customTo),
    [period, customFrom, customTo],
  );

  const load = useCallback(async () => {
    if (period === "custom" && (!customFrom || !customTo)) {
      setError(null);
      return;
    }
    try {
      const [ov, caseData, od, hwData] = await Promise.all([
        fetchOverview({
          period: "custom",
          view: view === "overall" ? "overall" : view,
          project: view === "projects" ? project || undefined : undefined,
          department: view === "departments" ? department || undefined : undefined,
          start_date: range.startIso,
          end_date: range.endIso,
        }),
        fetchCases(),
        fetchOverdueNotifications().catch(() => ({
          items: [] as Array<Record<string, unknown>>,
          counts: { all: 0, esc: 0, over: 0, soon: 0 },
        })),
        fetchHw(),
      ]);
      setOverview(ov);
      setCases(caseData.items);
      setOverdue(od);
      setHw(hwData);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [period, customFrom, customTo, view, project, department, range.startIso, range.endIso]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") void load();
    };
    const onHash = () => {
      if (window.location.hash.startsWith("#/dashboard")) void load();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("hashchange", onHash);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("hashchange", onHash);
    };
  }, [load]);

  const rows = useMemo(() => deviceRowsFromHw(hw), [hw]);
  const totals = useMemo(() => deviceTotals(rows), [rows]);

  const viewScoped = useMemo(() => {
    return cases.filter((r) => {
      if (!rowAllowedForProjects(r.project, projectAccess)) return false;
      if (view === "projects" && project && r.project !== project) return false;
      if (view === "departments" && department && r.department !== department) return false;
      if (view === "projects" && !r.project) return false;
      if (view === "departments" && !r.department) return false;
      return true;
    });
  }, [cases, view, project, department, projectAccess]);

  const periodCases = useMemo(
    () =>
      viewScoped.filter((r) => {
        const t = new Date(r.date).getTime();
        return t >= range.a && t <= range.b;
      }),
    [viewScoped, range.a, range.b],
  );

  const prevCases = useMemo(
    () =>
      viewScoped.filter((r) => {
        const t = new Date(r.date).getTime();
        return t >= range.pa && t <= range.pb;
      }),
    [viewScoped, range.pa, range.pb],
  );

  const scopedCases = useMemo(
    () => periodCases.filter((r) => matchesDevice(r, device)),
    [periodCases, device],
  );

  const { weeks, countType } = useMemo(
    () => weekBuckets(viewScoped.filter((r) => matchesDevice(r, device)), 10),
    [viewScoped, device],
  );

  const weekSeries = useMemo(() => {
    const all = [
      {
        name: "AI Camera",
        color: PAL.red,
        data: countType((r) => r.record_type === "ai_camera"),
        device: "AI Camera",
      },
      {
        name: "Dashcam",
        color: PAL.steel,
        data: countType((r) => r.record_type === "dashcam"),
        device: "Dashcam",
      },
      {
        name: "Speed (Public Road)",
        color: PAL.amber,
        data: countType((r) => isPublicSpeed(r)),
        device: "GPS",
      },
      {
        name: "ROW",
        color: PAL.copper,
        data: countType((r) => isRow(r)),
        device: "GPS",
      },
      {
        name: "SOS (wearables)",
        color: PAL.olive,
        data: countType((r) => r.record_type === "sos"),
        device: "Smart Helmet",
      },
    ];
    return all
      .filter((s) => device === "All" || s.device === device || (device === "Smartwatch" && s.device === "Smart Helmet"))
      .filter((s) => s.data.some((x) => x > 0) || device !== "All");
  }, [countType, device]);

  const recordCounts = useMemo(() => {
    const by = (pred: (r: CaseSummary) => boolean) => periodCases.filter(pred).length;
    return {
      "AI Camera": by((r) => r.record_type === "ai_camera"),
      GPS: by((r) => r.record_type === "speed"),
      Dashcam: by((r) => r.record_type === "dashcam"),
      "Smart Helmet": by((r) => r.record_type === "sos"),
      Smartwatch: by((r) => r.record_type === "sos"),
      "Weather Station": 0,
    } as Record<string, number>;
  }, [periodCases]);

  const chartCases = useMemo(
    () => scopedCases.filter((r) => r.record_type !== "itqan"),
    [scopedCases],
  );

  const statusCounts = useMemo(() => {
    const open = chartCases.filter((r) => r.status === "open").length;
    const under = chartCases.filter((r) => r.status === "under_process").length;
    const closed = chartCases.filter((r) => r.status === "closed").length;
    return { open, under, closed, total: open + under + closed };
  }, [chartCases]);

  const riskCounts = useMemo(() => {
    const bucket = (k: string) =>
      chartCases.filter((r) => (r.risk_level || "").toLowerCase().includes(k));
    return (["high", "medium", "low"] as const).reduce(
      (acc, k) => {
        const list = bucket(k);
        const open = list.filter((r) => r.status !== "closed").length;
        acc[k] = {
          n: list.length,
          open,
          closed: list.length - open,
        };
        return acc;
      },
      {} as Record<string, { n: number; open: number; closed: number }>,
    );
  }, [chartCases]);

  const projDonut = useMemo(() => {
    const di = DEVICE_TYPES.indexOf(device as (typeof DEVICE_TYPES)[number]);
    const entries = rows
      .map(([l, v]) => [l, di >= 0 ? v[di] : v.reduce((a, b) => a + b, 0)] as [string, number])
      .filter((x) => x[1] > 0)
      .sort((a, b) => b[1] - a[1]);
    return { labels: entries.map((e) => e[0]), values: entries.map((e) => e[1]) };
  }, [rows, device]);

  const compareWeeks = weeks.slice(-2);
  const compareRows = useMemo(() => {
    const series: Array<{ label: string; pred: (r: CaseSummary) => boolean; device: string }> = [
      { label: "AI Camera", pred: (r) => r.record_type === "ai_camera", device: "AI Camera" },
      { label: "Dashcam", pred: (r) => r.record_type === "dashcam", device: "Dashcam" },
      { label: "Speed (Public Road)", pred: (r) => isPublicSpeed(r), device: "GPS" },
      { label: "ROW", pred: (r) => isRow(r), device: "GPS" },
      { label: "SOS (wearables)", pred: (r) => r.record_type === "sos", device: "Smart Helmet" },
    ];
    const pool = viewScoped.filter((r) => matchesDevice(r, device));
    return series
      .filter(
        (s) =>
          device === "All" ||
          s.device === device ||
          (device === "Smartwatch" && s.device === "Smart Helmet"),
      )
      .map((s) => {
        const a = pool.filter((r) => {
          const t = new Date(r.date).getTime();
          return s.pred(r) && t >= (compareWeeks[0]?.a ?? 0) && t < (compareWeeks[0]?.b ?? 0);
        }).length;
        const b = pool.filter((r) => {
          const t = new Date(r.date).getTime();
          return s.pred(r) && t >= (compareWeeks[1]?.a ?? 0) && t < (compareWeeks[1]?.b ?? 0);
        }).length;
        const meta = deltaMeta(b, a);
        return { label: s.label, a, b, meta };
      })
      .filter((r) => device !== "All" || r.a + r.b > 0);
  }, [viewScoped, device, compareWeeks]);

  const openConfirm = viewScoped.filter(
    (r) => (r.record_type === "dashcam" || r.record_type === "speed") && r.status === "open",
  ).length;
  const underReview = viewScoped.filter((r) => r.status === "under_process").length;
  const sosOpen = viewScoped.filter((r) => r.record_type === "sos" && r.status === "open").length;
  const odAll = overdue?.counts.all ?? 0;
  const odHigh = (overdue?.items || []).filter((x) =>
    String(x.risk_level || "")
      .toLowerCase()
      .includes("high"),
  ).length;

  const sumTypes = useMemo(
    () =>
      [
        {
          t: "AI Camera Observations",
          ic: "cctv",
          f: (r: CaseSummary) => r.record_type === "ai_camera",
        },
        {
          t: "SOS Alerts (Wearables)",
          ic: "watch",
          f: (r: CaseSummary) => r.record_type === "sos",
        },
        {
          t: "ROW (Zone) Violations",
          ic: "gps",
          f: (r: CaseSummary) => isRow(r),
        },
        {
          t: "Light Vehicle Speed Violations",
          ic: "car",
          f: (r: CaseSummary) => isLv(r) || (isPublicSpeed(r) && !isHv(r) && !/heavy/i.test(r.title || "")),
        },
        {
          t: "Heavy Vehicle Speed Violations",
          ic: "gps",
          f: (r: CaseSummary) => isHv(r),
        },
        {
          t: "Dashcam Violations",
          ic: "cam",
          f: (r: CaseSummary) => r.record_type === "dashcam",
        },
        {
          t: "ITQAN Violations",
          ic: "report",
          f: (r: CaseSummary) => r.record_type === "itqan",
        },
      ] as const,
    [],
  );

  const sparkWeeks = useMemo(() => weekBuckets(viewScoped, 8), [viewScoped]);

  const weekCmp = useMemo(() => {
    const w = weekBuckets(viewScoped.filter((r) => matchesDevice(r, device)), 10).weeks;
    const pool = viewScoped.filter((r) => matchesDevice(r, device));
    const obs = w.map(
      (week) =>
        pool.filter((r) => {
          const t = new Date(r.date).getTime();
          return (
            t >= week.a &&
            t < week.b &&
            (r.record_type === "ai_camera" || r.record_type === "sos")
          );
        }).length,
    );
    const vio = w.map(
      (week) =>
        pool.filter((r) => {
          const t = new Date(r.date).getTime();
          return (
            t >= week.a &&
            t < week.b &&
            (r.record_type === "dashcam" || r.record_type === "speed")
          );
        }).length,
    );
    const chg = vio.map((v, i) =>
      i ? Math.round(((v - vio[i - 1]) / Math.max(1, vio[i - 1])) * 100) : 0,
    );
    const l4 = vio.slice(-5, -1).reduce((a, b) => a + b, 0) / 4;
    const p4 = vio.slice(-9, -5).reduce((a, b) => a + b, 0) / 4;
    const imp = p4 ? Math.round(((p4 - l4) / p4) * 100) : 0;
    return { weeks: w, obs, vio, chg, imp, l4, p4 };
  }, [viewScoped, device]);

  const monthSeries = useMemo(() => {
    const now = new Date();
    const months = Array.from({ length: now.getMonth() + 1 }, (_, i) => i);
    const pool = viewScoped.filter((r) => matchesDevice(r, device));
    const defs = [
      { n: "AI Camera Observations", c: PAL.steel, f: (r: CaseSummary) => r.record_type === "ai_camera" },
      { n: "SOS Alerts (Wearables)", c: PAL.olive, f: (r: CaseSummary) => r.record_type === "sos" },
      { n: "ROW (Zone) Violations", c: PAL.amber, f: (r: CaseSummary) => isRow(r) },
      { n: "Light Vehicle Speed Violations", c: PAL.copper, f: (r: CaseSummary) => isLv(r) || (isPublicSpeed(r) && !isHv(r)) },
      { n: "Heavy Vehicle Speed Violations", c: PAL.red, f: (r: CaseSummary) => isHv(r) },
      { n: "Dashcam Violations", c: PAL.ink2, f: (r: CaseSummary) => r.record_type === "dashcam" },
      { n: "ITQAN Violations", c: PAL.sand, f: (r: CaseSummary) => r.record_type === "itqan" },
    ];
    return {
      labels: months.map((m) => MON3[m]),
      series: defs.map((d) => ({
        ...d,
        data: months.map(
          (m) =>
            pool.filter((r) => {
              const dt = new Date(r.date);
              return dt.getFullYear() === now.getFullYear() && dt.getMonth() === m && d.f(r);
            }).length,
        ),
      })),
    };
  }, [viewScoped, device]);

  const siteRows = useMemo(() => {
    const keys =
      view === "departments"
        ? [...new Set(scopedCases.map((r) => r.department).filter(Boolean) as string[])]
        : [
            ...new Set(
              [
                ...scopedCases.map((r) => r.project).filter(Boolean),
                ...scopedCases.map((r) => r.department).filter(Boolean),
              ] as string[],
            ),
          ];
    const prevMap = prevCases
      .filter((r) => matchesDevice(r, device))
      .reduce<Record<string, number>>((acc, r) => {
        const k = r.project || r.department || "—";
        acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {});
    const rowsOut = keys
      .map((k) => {
        const list = scopedCases.filter((r) => (r.project || r.department) === k);
        const row = sumTypes.map((t) => list.filter(t.f).length);
        const tot = row.reduce((a, b) => a + b, 0);
        const st = ["open", "under_process", "closed"].map(
          (s) => list.filter((r) => r.status === s && r.record_type !== "itqan").length,
        );
        const od = (overdue?.items || []).filter(
          (item) =>
            (String(item.project || item.department || "") === k) &&
            (item.state === "over" || item.state === "esc"),
        ).length;
        return {
          k,
          isP: Boolean(list[0]?.project && list[0].project === k),
          row,
          tot,
          st,
          od,
          prev: range.cmp ? prevMap[k] ?? 0 : null,
        };
      })
      .filter((x) => x.tot > 0)
      .sort((a, b) => b.tot - a.tot);
    const colT = sumTypes.map((_, i) => rowsOut.reduce((a, x) => a + x.row[i], 0));
    return { rowsOut, colT };
  }, [scopedCases, prevCases, device, view, sumTypes, overdue, range.cmp]);

  const updatedAt = overview?.generated_at
    ? new Date(overview.generated_at).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

  const year = new Date().getFullYear();
  const periodLabel = range.label;
  const periodCmp = range.cmp ? `Compared with ${range.cmp}` : "Compared month by month";

  const show = (i: number) => device === "All" || device === DEVICE_TYPES[i];
  const locIndex =
    device === "All" ? 0 : Math.max(0, DEVICE_TYPES.indexOf(device as (typeof DEVICE_TYPES)[number]));

  if (error && !overview && !(period === "custom" && (!customFrom || !customTo))) {
    return <p className="state error">{error}</p>;
  }
  if (!overview && !(period === "custom" && (!customFrom || !customTo))) {
    return <p className="state">Loading dashboard…</p>;
  }

  return (
    <section className="page v1-dash">
      <section className="v1-banner dash-hero">
        <div className="v1-banner-icon">
          <Icon name="shield" size={32} />
        </div>
        <div className="v1-banner-copy">
          <h1>
            SAFETY COMMAND CENTER <em>DASHBOARD {year}</em>
          </h1>
          <p>
            Real-Time Monitoring <i>•</i> Smarter Decisions <i>•</i> Safer Operations
          </p>
        </div>
        <div className="v1-banner-actions">
          <span className="tagx green live">
            <span className="dot" /> Live · updated {updatedAt}
          </span>
        </div>
      </section>

      <div className="v1-tabs">
        <a
          className={mainTab === "overview" ? "on" : undefined}
          href={href({ name: "dashboard", tab: "overview" })}
        >
          <Icon name="dash" /> Overview
        </a>
        <a
          className={mainTab === "summary" ? "on" : undefined}
          href={href({ name: "dashboard", tab: "summary" })}
        >
          <Icon name="report" /> Observations &amp; Violations Summary
        </a>
      </div>

      <div className="v1-filters">
        <div className="grp">
          <label className="k">View</label>
          <div className="seg">
            {(
              [
                ["overall", "Over All"],
                ["projects", "By Project"],
                ["departments", "By Department"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={view === id ? "on" : undefined}
                onClick={() => setView(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {view === "projects" ? (
          <div className="grp">
            <label className="k">Project</label>
            <select
              className="sel"
              value={project}
              onChange={(e) => setProject(e.target.value)}
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
          </div>
        ) : null}
        {view === "departments" ? (
          <div className="grp">
            <label className="k">Department</label>
            <select
              className="sel"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
            >
              <option value="">All departments</option>
              {(departmentList.items.length
                ? departmentList.items.map((d) => d.label)
                : overview?.departments ?? []
              ).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        ) : null}
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
        <div className="grp">
          <label className="k">Device</label>
          <select
            className="sel"
            value={device}
            onChange={(e) => setDevice(e.target.value)}
            aria-label="Device"
          >
            <option value="All">All devices</option>
            {DEVICE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="range">
          <b>{periodLabel}</b>
          <span>{periodCmp}</span>
        </div>
      </div>

      {period === "custom" && (!customFrom || !customTo) ? (
        <p className="note">Choose a start and end date for the custom range.</p>
      ) : null}

      {mainTab === "overview" && overview ? (
        <>
          <div className="v1-grid g6">
            {DEVICE_TYPES.map((d, i) => {
              const selected = device === d;
              const n = recordCounts[d] ?? 0;
              return (
                <button
                  type="button"
                  className={`v1-kpi click ${selected ? "sel" : ""}`}
                  key={d}
                  onClick={() => setDevice(selected ? "All" : d)}
                >
                  <div className="t">
                    <span className="ic">
                      <Icon name={DEV_IC[i]} />
                    </span>
                    {d}
                  </div>
                  <div className="v">{fmtN(totals[i])}</div>
                  <div className="s">
                    {d === "Weather Station"
                      ? `devices deployed · ${fmtN(totals[i])} logging hourly`
                      : `devices deployed · ${fmtN(n)} records`}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="v1-grid g3">
            <article className="v1-card">
              <div className="hd">
                <h3>Projects overview</h3>
              </div>
              <p className="sub">
                All devices by location{device !== "All" ? ` · ${device}` : ""}
              </p>
              <div className="v1-donut-row">
                <Donut
                  labels={projDonut.labels}
                  values={projDonut.values}
                  colors={DONUT_PAL}
                  size={200}
                />
                <div className="v1-legend col">
                  {projDonut.labels.slice(0, 9).map((label, i) => (
                    <span key={label}>
                      <i style={{ background: DONUT_PAL[i % DONUT_PAL.length] }} />
                      {label}
                      <b className="mono">{fmtN(projDonut.values[i])}</b>
                    </span>
                  ))}
                </div>
              </div>
            </article>

            <article className="v1-card">
              <div className="hd">
                <h3>Technologies used</h3>
              </div>
              <p className="sub">Devices deployed by type</p>
              <VBars
                labels={[...DEVICE_TYPES]}
                values={totals}
                colors={TECH_COLORS}
                highlight={device}
              />
            </article>

            <LocCard
              title={
                show(0) && device === "All"
                  ? "AI Camera per location"
                  : `${DEVICE_TYPES[locIndex]} per location`
              }
              index={locIndex}
              rows={rows}
              totals={totals}
            />
          </div>

          <div className="v1-grid g4">
            {[1, 2, 4, 5]
              .filter((i) => show(i) && !(device !== "All" && i === locIndex && !show(0)))
              .map((i) => (
                <LocCard
                  key={DEVICE_TYPES[i]}
                  title={`${DEVICE_TYPES[i]}${i === 5 ? "s" : ""} per location`}
                  index={i}
                  rows={rows}
                  totals={totals}
                />
              ))}
          </div>

          {device === "All" ? (
            <div className="v1-grid g4">
              <LocCard title="Smart Helmets per location" index={3} rows={rows} totals={totals} />
              <article className="v1-card span3">
                <div className="hd">
                  <h3>Needs attention</h3>
                </div>
                <p className="sub">What is waiting for someone right now</p>
                <div className="v1-att-grid">
                  {[
                    {
                      ic: "alert",
                      n: odAll,
                      text: `records are overdue for close-out (${odHigh} High risk)`,
                      action: "Open",
                      go: () =>
                        document
                          .querySelector<HTMLButtonElement>('[aria-label="Notifications"]')
                          ?.click(),
                    },
                    {
                      ic: "car",
                      n: openConfirm,
                      text: "Dashcam and Speed violations wait for Confirm Driver & Submit",
                      action: "View",
                      href: href({ name: "review" }),
                    },
                    {
                      ic: "clock",
                      n: underReview,
                      text: "records wait for Admin review",
                      action: "Review",
                      href: href({ name: "review" }),
                    },
                    {
                      ic: "watch",
                      n: sosOpen,
                      text: "SOS alerts are still open",
                      action: "Open",
                      href: href({ name: "list", type: "sos" }),
                    },
                  ].map((a) => (
                    <div className="v1-att" key={a.text}>
                      <span className="ic">
                        <Icon name={a.ic} />
                      </span>
                      <b>{fmtN(a.n)}</b>
                      <span className="txt">{a.text}</span>
                      {a.href ? (
                        <a className="linkbtn" href={a.href}>
                          {a.action} →
                        </a>
                      ) : (
                        <button className="linkbtn" type="button" onClick={a.go}>
                          {a.action} →
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </article>
            </div>
          ) : null}

          <article className="v1-card">
            <div className="hd">
              <h3>Weekly progress: records registered, week by week</h3>
            </div>
            <p className="sub">
              Last 10 weeks by record type, with the total and the change from the previous
              week. Weeks start on Sunday.
            </p>
            <div className="v1-legend row">
              {weekSeries.map((s) => (
                <span key={s.name}>
                  <i style={{ background: s.color }} />
                  {s.name}
                </span>
              ))}
              <span>
                <i className="line" style={{ background: "var(--ink)" }} />
                Total
              </span>
            </div>
            <StackedWeekChart weeks={weeks} series={weekSeries} />
          </article>

          <article className="v1-card">
            <div className="hd">
              <h3>This week compared with last week</h3>
            </div>
            <p className="sub">Lower numbers of violations mean an improvement</p>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Record type</th>
                    <th className="n">
                      {compareWeeks[0]?.label} ({compareWeeks[0]?.range})
                    </th>
                    <th className="n">
                      {compareWeeks[1]?.label} (to date)
                    </th>
                    <th className="n">Change</th>
                    <th>Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {compareRows.map((row) => (
                    <tr key={row.label}>
                      <td>{row.label}</td>
                      <td className="n">{row.a}</td>
                      <td className="n">
                        <b>{row.b}</b>
                      </td>
                      <td className="n">
                        <span className={`delta ${row.meta.cls}`}>{row.meta.text || "0%"}</span>
                      </td>
                      <td>
                        {row.b < row.a ? (
                          <span className="tagx green">Improving</span>
                        ) : row.b > row.a ? (
                          <span className="tagx red">Rising</span>
                        ) : (
                          <span className="tagx">Stable</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="v1-card">
            <div className="hd">
              <h3>Dashboard summary</h3>
              <button
                className="btn sm"
                type="button"
                onClick={() => {
                  const header = ["Location", ...DEVICE_TYPES, "Total"];
                  const lines = [
                    header.join(","),
                    ...rows.map(([l, v]) =>
                      [l, ...v, v.reduce((a, b) => a + b, 0)].join(","),
                    ),
                  ];
                  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "scc-dashboard-summary.csv";
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                <Icon name="download" /> Export Excel
              </button>
            </div>
            <p className="sub">
              Devices deployed per project and location, shaded by share of each device type
            </p>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Projects / locations</th>
                    {DEVICE_TYPES.map((t) => (
                      <th className="n" key={t}>
                        {t}
                      </th>
                    ))}
                    <th className="n">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {[...rows]
                    .sort(
                      (a, b) =>
                        b[1].reduce((x, y) => x + y, 0) - a[1].reduce((x, y) => x + y, 0),
                    )
                    .map(([site, vals]) => (
                      <tr key={site}>
                        <td>
                          <b>{site}</b>
                        </td>
                        {vals.map((v, i) => (
                          <td
                            className="n heat"
                            key={`${site}-${i}`}
                            style={
                              {
                                "--h": (v / Math.max(1, totals[i]) * 0.28).toFixed(2),
                              } as CSSProperties
                            }
                          >
                            <span>{fmtN(v)}</span>
                          </td>
                        ))}
                        <td className="n">
                          <b>{fmtN(vals.reduce((a, b) => a + b, 0))}</b>
                        </td>
                      </tr>
                    ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total</td>
                    {totals.map((v, i) => (
                      <td className="n" key={i}>
                        {fmtN(v)}
                      </td>
                    ))}
                    <td className="n">{fmtN(totals.reduce((a, b) => a + b, 0))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </article>
        </>
      ) : overview ? (
        <>
          <div className="v1-grid g4">
            {sumTypes.map((t) => {
              const n = scopedCases.filter(t.f).length;
              const p = range.cmp
                ? prevCases.filter((r) => matchesDevice(r, device) && t.f(r)).length
                : null;
              const meta = deltaMeta(n, p);
              const spark = sparkWeeks.countType((r) => matchesDevice(r, device) && t.f(r));
              return (
                <div className="v1-kpi ikpi" key={t.t}>
                  <div className="ikpi-body">
                    <div className="t">{t.t}</div>
                    <div className="v">{fmtN(n)}</div>
                    <div className="s">
                      {meta.text ? <span className={`delta ${meta.cls}`}>{meta.text}</span> : null}{" "}
                      <span>{range.cmp ? `vs ${range.cmp}` : "year to date"}</span>
                    </div>
                    <Spark values={spark} weekLabels={sparkWeeks.weeks} />
                  </div>
                  <div className="art">
                    <Icon name={t.ic} size={28} />
                  </div>
                </div>
              );
            })}
            {(() => {
              const n = scopedCases.length;
              const p = range.cmp
                ? prevCases.filter((r) => matchesDevice(r, device)).length
                : null;
              const meta = deltaMeta(n, p);
              return (
                <div className="v1-kpi ikpi dark">
                  <div className="ikpi-body">
                    <div className="t">All observations &amp; violations</div>
                    <div className="v">{fmtN(n)}</div>
                    <div className="s">
                      {meta.text ? <span className={`delta ${meta.cls}`}>{meta.text}</span> : null}{" "}
                      <span>{range.cmp ? `vs ${range.cmp}` : "year to date"}</span>
                    </div>
                    <Spark
                      values={sparkWeeks.countType((r) => matchesDevice(r, device))}
                      color="#E1252F"
                      weekLabels={sparkWeeks.weeks}
                    />
                  </div>
                  <div className="art">
                    <Icon name="shield" size={28} />
                  </div>
                </div>
              );
            })()}
          </div>

          <div className="v1-grid g3">
            <article className="v1-card">
              <div className="hd">
                <h3>Overall status</h3>
              </div>
              <p className="sub">Observations and violations (ITQAN excluded)</p>
              <div className="v1-donut-center-wrap">
                <Donut
                  labels={["Open", "Under Review", "Closed"]}
                  values={[statusCounts.open, statusCounts.under, statusCounts.closed]}
                  colors={[PAL.red, PAL.amber, PAL.green]}
                  center={{ value: fmtN(statusCounts.total), label: "records" }}
                  size={188}
                  cut={0.78}
                />
              </div>
              <HBars
                rows={[
                  { label: "Open", value: statusCounts.open },
                  { label: "Under Review", value: statusCounts.under },
                  { label: "Closed", value: statusCounts.closed },
                ]}
                colorFor={(k) =>
                  k === "Open" ? PAL.red : k === "Closed" ? PAL.green : PAL.amber
                }
              />
            </article>

            <article className="v1-card">
              <div className="hd">
                <h3>Overall risk level</h3>
              </div>
              <p className="sub">Risk level of every observation and violation</p>
              <RiskStackedChart
                rows={(["High", "Medium", "Low"] as const).map((k) => ({
                  label: k,
                  closed: riskCounts[k.toLowerCase()]?.closed ?? 0,
                  open: riskCounts[k.toLowerCase()]?.open ?? 0,
                }))}
              />
              <div className="v1-grid g3 risk-boxes">
                {(["High", "Medium", "Low"] as const).map((k) => (
                  <div className={`risk-box ${k}`} key={k}>
                    <span className={`rk ${k}`}>{k}</span>
                    <div className="vn">{fmtN(riskCounts[k.toLowerCase()]?.n ?? 0)}</div>
                    <small>{riskCounts[k.toLowerCase()]?.open ?? 0} still open</small>
                  </div>
                ))}
              </div>
            </article>

            <article className="v1-card">
              <div className="hd">
                <h3>Overdue by risk level</h3>
              </div>
              <p className="sub">Unclosed records past their close-out deadline</p>
              <HBars
                rows={(["High", "Medium", "Low"] as const).map((k) => ({
                  label: `${k} (${k === "High" ? "24 hours" : k === "Medium" ? "3 days" : "7 days"})`,
                  value: (overdue?.items || []).filter(
                    (item) =>
                      String(item.risk_level || "")
                        .toLowerCase()
                        .includes(k.toLowerCase()) &&
                      (item.state === "over" || item.state === "esc"),
                  ).length,
                }))}
                colorFor={(k) =>
                  k.startsWith("High")
                    ? PAL.red
                    : k.startsWith("Medium")
                      ? PAL.amber
                      : "var(--sand)"
                }
              />
              <div className="note">
                Records past their deadline notify the Operator and Admin. After 2× the
                deadline they escalate to the Department HSE.
              </div>
              <button
                className="btn sm"
                type="button"
                onClick={() =>
                  document
                    .querySelector<HTMLButtonElement>('[aria-label="Notifications"]')
                    ?.click()
                }
              >
                <Icon name="bell" /> Open notifications
              </button>
            </article>
          </div>

          <article className="v1-card">
            <div className="hd">
              <h3>Week-by-week comparison: observations vs violations</h3>
            </div>
            <p className="sub">
              Bars: records per week. Line: % change from the previous week (negative means
              fewer violations, an improvement).
            </p>
            <div className="v1-legend row">
              <span>
                <i style={{ background: PAL.steel }} />
                Observations (AI Camera + SOS)
              </span>
              <span>
                <i style={{ background: PAL.red }} />
                Violations (Dashcam + Speed + ROW)
              </span>
              <span>
                <i className="line" style={{ background: PAL.amber }} />
                Violations change vs previous week
              </span>
            </div>
            <WeekObsVioChart
              weeks={weekCmp.weeks}
              obs={weekCmp.obs}
              vio={weekCmp.vio}
              chg={weekCmp.chg}
            />
            <div className="row v1-cmp-note">
              <span className={`tagx ${weekCmp.imp >= 0 ? "green" : "red"}`}>
                {weekCmp.imp >= 0
                  ? `▼ ${weekCmp.imp}% fewer`
                  : `▲ ${-weekCmp.imp}% more`}{" "}
                violations
              </span>
              <span className="muted" style={{ fontSize: 12.5 }}>
                Average of the last 4 full weeks ({Math.round(weekCmp.l4)} per week) compared
                with the 4 weeks before ({Math.round(weekCmp.p4)} per week).
              </span>
            </div>
          </article>

          <article className="v1-card">
            <div className="hd">
              <h3>Observations and violations by project site</h3>
            </div>
            <p className="sub">
              Total number of observations and violations, project site wise. Shading shows
              each site&apos;s share of the column.
            </p>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>
                      {view === "departments" ? "Department" : "Project / department"}
                    </th>
                    {sumTypes.map((t) => (
                      <th className="n" key={t.t} title={t.t}>
                        {t.t
                          .replace(" Violations", "")
                          .replace(" Observations", "")
                          .replace("Light Vehicle Speed", "LV Speed")
                          .replace("Heavy Vehicle Speed", "HV Speed")
                          .replace(" (Wearables)", "")
                          .replace(" (Zone)", "")}
                      </th>
                    ))}
                    <th className="n">Total</th>
                    <th className="n">Open</th>
                    <th className="n">Under Review</th>
                    <th className="n">Closed</th>
                    <th className="n">Overdue</th>
                    <th className="n">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {siteRows.rowsOut.map((x) => (
                    <tr key={x.k}>
                      <td>
                        <b>{x.k}</b>
                        {!x.isP ? <small className="muted"> dept</small> : null}
                      </td>
                      {x.row.map((v, i) => (
                        <td
                          className="n heat"
                          key={i}
                          style={
                            {
                              "--h": (
                                v / Math.max(1, siteRows.colT[i]) *
                                0.5
                              ).toFixed(2),
                            } as CSSProperties
                          }
                        >
                          <span>{fmtN(v)}</span>
                        </td>
                      ))}
                      <td className="n">
                        <b>{fmtN(x.tot)}</b>
                      </td>
                      {x.st.map((v, i) => (
                        <td className="n" key={i}>
                          {fmtN(v)}
                        </td>
                      ))}
                      <td className="n">
                        {x.od ? <span className="tagx red">{x.od}</span> : "0"}
                      </td>
                      <td className="n">
                        <span className={`delta ${deltaMeta(x.tot, x.prev).cls}`}>
                          {deltaMeta(x.tot, x.prev).text || "0%"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total</td>
                    {siteRows.colT.map((v, i) => (
                      <td className="n" key={i}>
                        {fmtN(v)}
                      </td>
                    ))}
                    <td className="n">{fmtN(siteRows.colT.reduce((a, b) => a + b, 0))}</td>
                    {[0, 1, 2].map((i) => (
                      <td className="n" key={i}>
                        {fmtN(siteRows.rowsOut.reduce((a, x) => a + x.st[i], 0))}
                      </td>
                    ))}
                    <td className="n">
                      {fmtN(siteRows.rowsOut.reduce((a, x) => a + x.od, 0))}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </article>

          <article className="v1-card">
            <div className="hd">
              <h3>Monthly trend by record type</h3>
            </div>
            <p className="sub">Records per month in {year}</p>
            <div className="v1-legend row">
              {monthSeries.series.map((s) => (
                <span key={s.n}>
                  <i style={{ background: s.c }} />
                  {s.n}
                </span>
              ))}
            </div>
            <MonthTrendChart labels={monthSeries.labels} series={monthSeries.series} />
          </article>
        </>
      ) : (
        <p className="state">Loading dashboard…</p>
      )}
    </section>
  );
}
