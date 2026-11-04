import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  fetchCases,
  fetchHw,
  notifyCasesChanged,
  postJson,
  resolveMediaUrl,
  type CaseDetail,
  type CaseSummary,
  type HwPayload,
} from "../api/scc";
import { useAuth } from "../auth/AuthContext";
import { errorMessage } from "../lib/errors";
import { useChartReveal } from "../lib/useChartReveal";
import { href } from "../lib/routing";
import {
  rowAllowedForProjects,
  useAutoFormProject,
  useAutoProjectFilter,
  useProjectAccess,
} from "../lib/useProjectAccess";
import { ChartTip, tipFromEvent, type ChartTipData } from "./chartTip";
import { SosRecordDrawer } from "./SosRecordDrawer";
import {SelectList,
  SignedInNameField,
  StatusPill,
  nowLocal,
  useList,
  useSignedInName,
  weekFromIsoDate,
  ProjectOnlyViewSeg,
} from "./shared";

type WearablesView = "overall" | "projects";
type PeriodId =
  | "today"
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "ytd"
  | "custom";
type CurveMode = "week" | "month";
type LogStatus = "All" | "Open" | "Closed" | "Overdue";

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
const SOS_SLA_HOURS = 2;

const HW_TO_DASH: Record<string, "Smart Helmet" | "Smartwatch"> = {
  "SOS Devices": "Smart Helmet",
  "Smart Helmet": "Smart Helmet",
  "Smart Helmets": "Smart Helmet",
  Smartwatch: "Smartwatch",
  "Smart Watch": "Smartwatch",
  Smartwatches: "Smartwatch",
};

/** V1 wearable deployments — used when HW only has the combined "SOS Devices" bucket. */
const WEARABLE_DEPLOY: Record<string, { helmet: number; watch: number }> = {
  Jafurah: { helmet: 1348, watch: 0 },
  Yanbu: { helmet: 0, watch: 423 },
  MGS: { helmet: 0, watch: 35 },
  "Ras Tanura": { helmet: 0, watch: 44 },
  Dhahran: { helmet: 0, watch: 0 },
};

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
  const src = resolveMediaUrl(field(row, "worker_picture"));
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

function statusLabel(status: string): string {
  if (status === "open") return "Open";
  if (status === "closed") return "Closed";
  return status;
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

function pct(n: number, total: number) {
  if (!total) return 0;
  return Math.round((n / total) * 100);
}

function timeToSeeSec(row: CaseSummary): number | null {
  const stored = field(row, "time_to_see_seconds");
  if (stored) {
    const n = Number(stored);
    if (Number.isFinite(n)) return n;
  }
  const created = field(row, "sos_created_at");
  const seen = field(row, "seen_at");
  if (!created || !seen) return null;
  const a = new Date(created).getTime();
  const b = new Date(seen).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / 1000));
}

function avgTimeToSee(rows: CaseSummary[]) {
  const secs = rows.map(timeToSeeSec).filter((s): s is number => s != null);
  if (!secs.length) return 0;
  return Math.round(secs.reduce((a, s) => a + s, 0) / secs.length);
}

function fmtAvgTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

function deltaChip(current: number, prev: number | null) {
  if (prev == null) return null;
  const d = current - prev;
  if (!d) return <span className="tagx">No change</span>;
  const up = d > 0;
  return (
    <span className={`tagx ${up ? "amber" : "green"}`}>
      {up ? "+" : ""}
      {fmtN(d)} vs prior
    </span>
  );
}

type SlaState =
  | { k: "ok"; left: number }
  | { k: "soon"; left: number; label: string }
  | { k: "over" | "esc"; over: number; label: string }
  | null;

function slaState(row: CaseSummary, now = Date.now()): SlaState {
  if (row.status !== "open") return null;
  const h = SOS_SLA_HOURS;
  const created = new Date(row.created_at).getTime();
  const age = (now - created) / HOUR_MS;
  if (age > h * 2) return { k: "esc", label: "Escalated", over: age - h };
  if (age > h) return { k: "over", label: "Overdue", over: age - h };
  if (age > h * 0.75) return { k: "soon", label: "Due soon", left: h - age };
  return { k: "ok", left: h - age };
}

function deviceRowsFromHw(hw: HwPayload | null): Array<[string, { helmet: number; watch: number }]> {
  const sites = new Set<string>([
    ...Object.keys(hw?.project_counts || {}),
    ...Object.keys(WEARABLE_DEPLOY),
  ]);
  return [...sites]
    .map((site) => {
      const counts = hw?.project_counts?.[site] || {};
      let helmet = 0;
      let watch = 0;
      let hasExplicitHelmet = false;
      let hasExplicitWatch = false;
      for (const [hwType, n] of Object.entries(counts)) {
        const mapped = HW_TO_DASH[hwType];
        const val = Number(n) || 0;
        if (mapped === "Smart Helmet") {
          helmet += val;
          if (hwType !== "SOS Devices") hasExplicitHelmet = true;
        }
        if (mapped === "Smartwatch") {
          watch += val;
          hasExplicitWatch = true;
        }
      }
      // HW catalog still stores a single "SOS Devices" bucket (all mapped to helmet).
      // Fall back to V1 wearable deployments so Smart Watch sites show up.
      const demo = WEARABLE_DEPLOY[site];
      if (demo && !hasExplicitWatch && !hasExplicitHelmet) {
        helmet = demo.helmet;
        watch = demo.watch;
      } else if (demo && !hasExplicitWatch && watch === 0) {
        watch = demo.watch;
        if (!hasExplicitHelmet && demo.helmet > helmet) helmet = demo.helmet;
      }
      return [site, { helmet, watch }] as [string, { helmet: number; watch: number }];
    })
    .filter(([, v]) => v.helmet || v.watch)
    .sort((a, b) => b[1].helmet + b[1].watch - (a[1].helmet + a[1].watch));
}

function hwTotals(hw: HwPayload | null) {
  const rows = deviceRowsFromHw(hw);
  return rows.reduce(
    (acc, [, v]) => ({ helmet: acc.helmet + v.helmet, watch: acc.watch + v.watch }),
    { helmet: 0, watch: 0 },
  );
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
    case "watch":
      return (
        <svg {...c}>
          <rect x="7" y="5" width="10" height="14" rx="3" />
          <path d="M9 5V3M15 5V3M9 19v2M15 19v2" />
        </svg>
      );
    case "helmet":
      return (
        <svg {...c}>
          <path d="M4 14a8 8 0 0 1 16 0" />
          <path d="M12 6V4M8 8l-2-2M16 8l2-2" />
        </svg>
      );
    case "plus":
      return (
        <svg {...c}>
          <path d="M12 5v14M5 12h14" />
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
    case "search":
      return (
        <svg {...c}>
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3-3" />
        </svg>
      );
    case "download":
      return (
        <svg {...c}>
          <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
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
    default:
      return null;
  }
}

function Gauge({ value, max, color = PAL.steel }: { value: number; max: number; color?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<ChartTipData | null>(null);
  const reveal = useChartReveal(hostRef, `${value}|${max}`);
  const hi = Math.max(max, 1);
  const p = Math.min(1, value / hi);
  const r = 70;
  const arc = Math.PI * r;
  const fill = arc * p;
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
          stroke={color}
          strokeWidth="16"
          strokeLinecap="round"
          strokeDasharray={`${fill * reveal} ${arc}`}
          style={{ cursor: "pointer" }}
          onMouseMove={(e) =>
            setTip(
              tipFromEvent(e, hostRef.current, {
                title: "Total SOS alerts",
                rows: [{ color, text: fmtN(value) }],
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

function StatusDonutSos({ rows }: { rows: CaseSummary[] }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<ChartTipData | null>(null);
  const open = rows.filter((r) => r.status === "open").length;
  const closed = rows.filter((r) => r.status === "closed").length;
  const total = rows.length || 1;
  const reveal = useChartReveal(hostRef, `${open}|${closed}|${rows.length}`);
  const ringR = 40;
  const ringC = 2 * Math.PI * ringR;
  const segs = [
    { n: open, c: PAL.red, l: "Open" },
    { n: closed, c: PAL.green, l: "Closed" },
  ];
  const active = segs.filter((p) => p.n > 0);

  function showSeg(e: ReactMouseEvent, label: string, color: string, value: number) {
    setTip(
      tipFromEvent(e, hostRef.current, {
        title: label,
        rows: [{ color, text: fmtN(value) }],
      }),
    );
  }

  let ringOffset = 0;
  const slices =
    active.length === 1 ? (
      <circle
        cx="50"
        cy="50"
        r={ringR}
        fill="none"
        stroke={active[0]!.c}
        strokeWidth="12"
        strokeDasharray={ringC}
        strokeDashoffset={ringC * (1 - reveal)}
        transform="rotate(-90 50 50)"
        style={{ cursor: "pointer" }}
        onMouseMove={(e) => showSeg(e, active[0]!.l, active[0]!.c, active[0]!.n)}
      />
    ) : (
      active.map((p) => {
        const len = (p.n / total) * ringC * reveal;
        const el = (
          <circle
            key={p.l}
            cx="50"
            cy="50"
            r={ringR}
            fill="none"
            stroke={p.c}
            strokeWidth="12"
            strokeDasharray={`${len} ${ringC - len}`}
            strokeDashoffset={-ringOffset}
            transform="rotate(-90 50 50)"
            strokeLinecap="butt"
            style={{ cursor: "pointer" }}
            onMouseMove={(e) => showSeg(e, p.l, p.c, p.n)}
          />
        );
        ringOffset += (p.n / total) * ringC * reveal;
        return el;
      })
    );

  return (
    <div className="ai-donut-block">
      <div
        className="v1-donut-wrap"
        ref={hostRef}
        style={{ width: 170, height: 170 }}
        onMouseLeave={() => setTip(null)}
      >
        <svg viewBox="0 0 100 100" width={170} height={170} aria-hidden>
          <circle cx="50" cy="50" r="40" fill="none" stroke={PAL.line} strokeWidth="12" />
          {slices}
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

function BarsList({
  entries,
  color,
}: {
  entries: [string, number][];
  color?: string | ((k: string) => string);
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<ChartTipData | null>(null);
  const reveal = useChartReveal(
    hostRef,
    entries.map(([k, v]) => `${k}:${v}`).join("|"),
  );
  const max = Math.max(1, ...entries.map((e) => e[1]));
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

function StackedDevicesChart({
  rows,
}: {
  rows: Array<[string, { helmet: number; watch: number }]>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<ChartTipData | null>(null);
  const reveal = useChartReveal(
    hostRef,
    rows.map(([l, v]) => `${l}:${v.helmet},${v.watch}`).join("|"),
  );
  if (!rows.length) return <p className="empty">No hardware counts in scope.</p>;
  const max = niceAxisMax(Math.max(1, ...rows.map(([, v]) => v.helmet + v.watch)));
  const tickVals = axisTicks(max);
  const W = 360;
  const H = 220;
  const pad = { t: 14, r: 12, b: 48, l: 40 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const slot = iw / Math.max(1, rows.length);
  const bw = Math.min(48, slot - 10);

  return (
    <div className="v1-chart-host" ref={hostRef} onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} aria-hidden>
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
        {rows.map(([label, v], i) => {
          const hH = (v.helmet / max) * ih * reveal;
          const wH = (v.watch / max) * ih * reveal;
          const x = pad.l + i * slot + (slot - bw) / 2;
          const yHelmet = pad.t + ih - hH;
          const yWatch = yHelmet - wH;
          const short =
            label.length > 12 ? `${label.slice(0, 11)}…` : label;
          const showTip = (e: ReactMouseEvent) =>
            setTip(
              tipFromEvent(e, hostRef.current, {
                title: label,
                rows: [
                  { color: PAL.copper, text: `Smart Helmet ${fmtN(v.helmet)}` },
                  { color: PAL.red, text: `Smart Watch ${fmtN(v.watch)}` },
                ],
              }),
            );
          return (
            <g key={label}>
              {v.helmet > 0 ? (
                <rect
                  x={x}
                  y={yHelmet}
                  width={bw}
                  height={Math.max(2, hH)}
                  rx={3}
                  fill={PAL.copper}
                  style={{ cursor: "pointer" }}
                  onMouseMove={showTip}
                  onMouseLeave={() => setTip(null)}
                />
              ) : null}
              {v.watch > 0 ? (
                <rect
                  x={x}
                  y={yWatch}
                  width={bw}
                  height={Math.max(2, wH)}
                  rx={3}
                  fill={PAL.red}
                  style={{ cursor: "pointer" }}
                  onMouseMove={showTip}
                  onMouseLeave={() => setTip(null)}
                />
              ) : null}
              <text
                x={x + bw / 2}
                y={H - 10}
                textAnchor="middle"
                fontSize={10}
                fill="var(--ink-2)"
              >
                {short}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="v1-legend" style={{ marginTop: 2, justifyContent: "center" }}>
        <span>
          <i style={{ background: PAL.copper }} />
          Smart Helmet
        </span>
        <span>
          <i style={{ background: PAL.red }} />
          Smart Watch
        </span>
      </div>
      <ChartTip tip={tip} />
    </div>
  );
}

function TimeToSeeChart({ rows }: { rows: CaseSummary[] }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<ChartTipData | null>(null);
  const buckets: [string, number, number, string][] = [
    ["<30 s", 0, 30, PAL.green],
    ["30–60 s", 30, 60, PAL.olive],
    ["1–2 min", 60, 120, PAL.sand],
    ["2–3 min", 120, 180, PAL.amber],
    [">3 min", 180, 99999, PAL.red],
  ];
  const data = buckets.map(([label, a, b, color]) => ({
    label,
    color,
    n: rows.filter((r) => {
      const s = timeToSeeSec(r);
      return s != null && s >= a && s < b;
    }).length,
  }));
  const reveal = useChartReveal(
    hostRef,
    data.map((d) => `${d.label}:${d.n}`).join("|"),
  );
  const max = Math.max(1, ...data.map((d) => d.n));
  const W = 340;
  const H = 200;
  const pad = { t: 12, r: 12, b: 36, l: 36 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const bw = iw / data.length - 12;

  return (
    <div className="v1-chart-host" ref={hostRef} onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} aria-hidden>
        {data.map((d, i) => {
          const h = (d.n / max) * ih * reveal;
          const x = pad.l + i * (iw / data.length) + 6;
          const y = pad.t + ih - h;
          return (
            <g key={d.label}>
              {d.n > 0 ? (
                <rect
                  x={x}
                  y={y}
                  width={bw}
                  height={Math.max(2, h)}
                  rx={4}
                  fill={d.color}
                  style={{ cursor: "pointer" }}
                  onMouseMove={(e) =>
                    setTip(
                      tipFromEvent(e, hostRef.current, {
                        title: d.label,
                        rows: [{ color: d.color, text: fmtN(d.n) }],
                      }),
                    )
                  }
                />
              ) : null}
              <text x={x + bw / 2} y={H - 8} textAnchor="middle" fontSize={10} fill="var(--ink-2)">
                {d.label}
              </text>
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

function smoothCurvePath(
  pts: readonly (readonly [number, number])[],
  yMin: number,
  yMax: number,
) {
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

function CurveChart({ labels, data, color = PAL.steel }: { labels: string[]; data: number[]; color?: string }) {
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
  const area =
    shownPts.length > 0
      ? `${line} L${shownPts[shownPts.length - 1]![0]} ${baseY} L${shownPts[0]![0]} ${baseY} Z`
      : "";
  const tickVals = axisTicks(max);

  return (
    <div
      className="ai-curve-wrap v1-chart-host sos-curve-wrap"
      ref={hostRef}
      onMouseLeave={() => setTip(null)}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="ai-curve-svg sos-curve-svg" aria-hidden>
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
        {area ? <path d={area} fill={`${color}22`} pointerEvents="none" /> : null}
        {line ? (
          <path d={line} fill="none" stroke={color} strokeWidth={2.25} pointerEvents="none" />
        ) : null}
        {shownPts.map((p, i) => (
          <circle
            key={i}
            cx={p[0]}
            cy={p[1]}
            r={4.5}
            fill={color}
            style={{ cursor: "pointer" }}
            onMouseMove={(e) =>
              setTip(
                tipFromEvent(e, hostRef.current, {
                  title: labels[i] || "",
                  rows: [{ color, text: fmtN(data[i] || 0) }],
                }),
              )
            }
            onMouseLeave={() => setTip(null)}
          />
        ))}
        {labels.map((lab, i) => {
          const x =
            pad.l + (labels.length <= 1 ? iw / 2 : (i / (labels.length - 1)) * iw);
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

function KpiTile({
  title,
  icon,
  value,
  sub,
  extra,
}: {
  title: string;
  icon: string;
  value: number | string;
  sub: string;
  extra?: ReactNode;
}) {
  return (
    <div className="v1-kpi">
      <div className="t">
        <Icon name={icon} size={14} /> {title}
        {extra ? <span style={{ marginLeft: "auto" }}>{extra}</span> : null}
      </div>
      <div className="v">{typeof value === "number" ? fmtN(value) : value}</div>
      <div className="s">{sub}</div>
    </div>
  );
}

function SosNewDrawer({
  open,
  onClose,
  onRegistered,
}: {
  open: boolean;
  onClose: () => void;
  onRegistered: (row: CaseDetail) => void;
}) {
  const actorName = useSignedInName();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    project_id: "",
    worker_name_badge: "",
    sos_created_at: nowLocal(),
    seen_at: nowLocal(),
    location: "",
    source_id: "",
  });
  const week = weekFromIsoDate(form.sos_created_at.slice(0, 10));

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

  const required = [
    form.project_id,
    form.source_id,
    form.worker_name_badge.trim(),
    form.sos_created_at,
    form.seen_at,
    form.location.trim(),
    actorName,
  ];
  const completed = required.filter(Boolean).length;
  const remaining = required.length - completed;
  const canRegister = remaining === 0 && !saving;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canRegister) return;
    setSaving(true);
    setError(null);
    try {
      const created = await postJson<CaseDetail>("/api/v1/sos-alerts", {
        project_id: form.project_id,
        worker_name_badge: form.worker_name_badge,
        sos_created_at: new Date(form.sos_created_at).toISOString(),
        seen_at: new Date(form.seen_at).toISOString(),
        location: form.location,
        source_id: form.source_id,
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
      <div className="drawer drawer-page" role="dialog" aria-modal="true" aria-label="New SOS Alert">
        <div className="drawer-hd">
          <div>
            <div className="sub">SCC Platform / New SOS Alert</div>
            <h2>New SOS Alert</h2>
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
          {error ? <p className="state error">{error}</p> : null}

          <div className="form-grid dc-form">
            <section className="v1-card">
              <h3>Worker</h3>
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
              <SelectList
                label="Source (wearable)"
                type="sos_source"
                value={form.source_id}
                onChange={(source_id) => setForm((c) => ({ ...c, source_id }))}
                required
                hideNotes
              />
              <label>
                Worker name &amp; badge number *
                <input
                  required
                  placeholder="Worker name / Badge number"
                  value={form.worker_name_badge}
                  onChange={(e) => setForm({ ...form, worker_name_badge: e.target.value })}
                />
                <span className="field-note">
                  For a rental worker, enter the Iqama number instead of the badge number
                </span>
              </label>
            </section>

            <section className="v1-card">
              <h3>Alert</h3>
              <div className="form-row">
                <label>
                  SOS created at *
                  <input
                    type="datetime-local"
                    required
                    value={form.sos_created_at}
                    onChange={(e) => setForm({ ...form, sos_created_at: e.target.value })}
                  />
                  <span className="field-note">Manual entry</span>
                </label>
                <label>
                  Week
                  <input readOnly value={week ?? ""} />
                  <span className="field-note">Calculated from the date</span>
                </label>
              </div>
              <div className="form-row">
                <label>
                  Seen at *
                  <input
                    type="datetime-local"
                    required
                    value={form.seen_at}
                    onChange={(e) => setForm({ ...form, seen_at: e.target.value })}
                  />
                  <span className="field-note">Manual entry</span>
                </label>
                <label>
                  Location *
                  <input
                    required
                    placeholder="Location"
                    value={form.location}
                    onChange={(e) => setForm({ ...form, location: e.target.value })}
                  />
                </label>
              </div>
              <SignedInNameField
                label="Registered by"
                note="Filled in by the system from the logged-in user"
              />
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
              </section>
              <section className="v1-card">
                <h3>What happens next</h3>
                <div className="steps">
                  <div>
                    <i>1</i>
                    <span>
                      <b>Register</b>
                      <span>Complete every required field. Status: Open.</span>
                    </span>
                  </div>
                  <div>
                    <i>2</i>
                    <span>
                      <b>Close</b>
                      <span>
                        Alarm type, worker picture, who shared it, closing time and close-out
                        report. Status: Closed.
                      </span>
                    </span>
                  </div>
                </div>
              </section>
              <section className="v1-card">
                <h3>Response time</h3>
                <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                  SOS alerts must be closed within 2 hours of SOS created at or they show as
                  overdue.
                </p>
              </section>
            </aside>
          </div>

          <div className="drawer-ft">
            <span className="muted">
              {remaining > 0
                ? `${remaining} required field${remaining === 1 ? "" : "s"} remaining`
                : "Ready to register"}
            </span>
            <button type="submit" className="btn primary" disabled={!canRegister}>
              <Icon name="check" size={14} /> {saving ? "Saving…" : "Register alert"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function WearablesScreen({
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
  const sourceList = useList("sos_source");
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [hw, setHw] = useState<HwPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<WearablesView>("projects");
  const [project, setProject] = useState("");
  const [period, setPeriod] = useState<PeriodId>("ytd");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [curveMode, setCurveMode] = useState<CurveMode>("week");
  const [drawerOpen, setDrawerOpen] = useState(Boolean(openForm && canRegister));
  const [openRecordId, setOpenRecordId] = useState<string | null>(focusCaseId ?? null);
  const [logStatus, setLogStatus] = useState<LogStatus>("All");
  const [logSource, setLogSource] = useState("All");
  const [logQ, setLogQ] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const [data, hwData] = await Promise.all([
        fetchCases({ record_type: "sos" }),
        fetchHw().catch(() => null),
      ]);
      setCases(data.items);
      setHw(hwData);
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

  const filterView = useCallback(
    (rows: CaseSummary[]) => {
      let out = rows.filter((r) => rowAllowedForProjects(r.project, projectAccess));
      if (view === "projects") {
        out = out.filter((r) => Boolean(r.project));
        if (project) out = out.filter((r) => r.project === project);
      }
      return out;
    },
    [view, project, projectAccess],
  );

  const scoped = useMemo(
    () => filterView(cases.filter((r) => inRange(r, range.a, range.b))),
    [cases, range, filterView],
  );

  const prevScoped = useMemo(
    () => filterView(cases.filter((r) => inRange(r, range.pa, range.pb))),
    [cases, range, filterView],
  );

  const openN = scoped.filter((r) => r.status === "open").length;
  const closedN = scoped.filter((r) => r.status === "closed").length;
  const avgSec = avgTimeToSee(scoped);
  const prevAvg = avgTimeToSee(prevScoped);
  const deploy = hwTotals(hw);
  const gaugeMax = Math.max(scoped.length, Math.round(scoped.length * 1.25) || 10);

  const alarmBars = useMemo(() => {
    const closed = scoped.filter((r) => field(r, "alarm"));
    return countBy(closed, (r) => field(r, "alarm") || "Unknown");
  }, [scoped]);

  const sourceBars = useMemo(() => countBy(scoped, (r) => field(r, "source") || "Unknown"), [scoped]);
  const locationBars = useMemo(
    () => countBy(scoped, (r) => field(r, "location") || "Unknown").slice(0, 8),
    [scoped],
  );

  const hwRows = useMemo(() => {
    let rows = deviceRowsFromHw(hw);
    if (view === "projects" && project) {
      rows = rows.filter(([site]) => site === project);
    }
    return rows;
  }, [hw, view, project]);

  const curve = useMemo(() => {
    if (curveMode === "month") {
      const now = new Date();
      const labels = MON3.slice(0, now.getMonth() + 1);
      const data = labels.map((_, i) =>
        scoped.filter((r) => {
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
      data: weeks.map((w) => scoped.filter((r) => inRange(r, w.a, w.b)).length),
    };
  }, [scoped, curveMode]);

  const overdueN = scoped.filter((r) => {
    const s = slaState(r);
    return s && (s.k === "over" || s.k === "esc");
  }).length;

  const sources = useMemo(() => {
    const fromCatalog = sourceList.items.map((i) => i.label);
    if (fromCatalog.length) return fromCatalog;
    return [...new Set(scoped.map((r) => field(r, "source")).filter(Boolean))].sort() as string[];
  }, [sourceList.items, scoped]);

  const logRows = useMemo(() => {
    let rows = scoped.filter((r) => {
      if (logStatus === "All") return true;
      if (logStatus === "Overdue") {
        const s = slaState(r);
        return Boolean(s && (s.k === "over" || s.k === "esc"));
      }
      return statusLabel(r.status) === logStatus;
    });
    if (logSource !== "All") rows = rows.filter((r) => field(r, "source") === logSource);
    if (logQ.trim()) {
      const q = logQ.trim().toLowerCase();
      rows = rows.filter((r) =>
        [
          r.case_id,
          r.project,
          field(r, "worker_name_badge"),
          field(r, "source"),
          field(r, "location"),
          r.title,
        ].some((v) => v && String(v).toLowerCase().includes(q)),
      );
    }
    return rows;
  }, [scoped, logStatus, logSource, logQ]);

  function exportCsv() {
    const lines = [
      [
        "Case ID",
        "Project",
        "Date",
        "Worker",
        "Source",
        "Location",
        "SOS created",
        "Seen at",
        "Time to see (s)",
        "Alarm",
        "Status",
      ].join(","),
      ...logRows.map((r) =>
        [
          r.case_id,
          r.project || "",
          r.date,
          field(r, "worker_name_badge") || r.title,
          field(r, "source"),
          field(r, "location"),
          field(r, "sos_created_at"),
          field(r, "seen_at"),
          timeToSeeSec(r) ?? "",
          field(r, "alarm"),
          statusLabel(r.status),
        ]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sos-alerts-log.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <p className="state">Loading wearable devices…</p>;
  if (error) return <p className="state error">{error}</p>;

  return (
    <section className="page v1-dash ai-module">
      <section className="v1-banner">
        <div className="v1-banner-icon">
          <Icon name="watch" size={30} />
        </div>
        <div className="v1-banner-copy">
          <h1>
            WEARABLE DEVICES <em>SOS ALERT {year}</em>
          </h1>
          <p>
            Smart Watches and Smart Helmets <i>•</i> Real-Time Emergency Response <i>•</i> Safer
            Operations
          </p>
        </div>
        <div className="v1-banner-actions">
          {canRegister ? (
            <button type="button" className="btn primary" onClick={() => setDrawerOpen(true)}>
              <Icon name="plus" size={14} /> New SOS Alert
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
        <KpiTile
          title="Total SOS alerts"
          icon="alert"
          value={scoped.length}
          sub="in the selected period"
          extra={range.cmp ? deltaChip(scoped.length, prevScoped.length) : undefined}
        />
        <KpiTile title="Open" icon="clock" value={openN} sub="waiting for the closure fields" />
        <KpiTile title="Closed" icon="review" value={closedN} sub="closed by the Operator" />
        <KpiTile
          title="Average time to see"
          icon="clock"
          value={fmtAvgTime(avgSec)}
          sub="SOS created to seen"
          extra={range.cmp ? deltaChip(avgSec, prevAvg) : undefined}
        />
        <KpiTile
          title="Smart Helmets"
          icon="helmet"
          value={deploy.helmet}
          sub="deployed in scope"
        />
        <KpiTile title="Smart Watches" icon="watch" value={deploy.watch} sub="deployed in scope" />
      </div>

      <div className="v1-grid g3">
        <article className="v1-card">
          <h3>Total SOS alerts</h3>
          <Gauge value={scoped.length} max={gaugeMax} />
        </article>
        <article className="v1-card">
          <h3>Alert type</h3>
          <p className="sub">False and true alarms, by wearable source</p>
          {alarmBars.length ? (
            <BarsList
              entries={alarmBars}
              color={(k) => (k === "True Alarm" ? PAL.red : PAL.steel)}
            />
          ) : (
            <p className="muted" style={{ fontSize: 12 }}>
              Alarm type is recorded at close-out.
            </p>
          )}
          <div style={{ height: 10 }} />
          <BarsList entries={sourceBars} color={PAL.copper} />
        </article>
        <article className="v1-card">
          <h3>Observations status</h3>
          <StatusDonutSos rows={scoped} />
        </article>
      </div>

      <div className="v1-grid g3">
        <article className="v1-card">
          <h3>Wearable devices per project</h3>
          <p className="sub">Smart Helmets and Smart Watches deployed</p>
          <StackedDevicesChart rows={hwRows} />
        </article>
        <article className="v1-card">
          <h3>Alerts per location</h3>
          <BarsList entries={locationBars} color={PAL.red} />
        </article>
        <article className="v1-card">
          <h3>Time to see the alert</h3>
          <p className="sub">Seconds from SOS created to seen</p>
          <TimeToSeeChart rows={scoped} />
        </article>
      </div>

      <article className="v1-card">
        <h3>SOS alerts per date</h3>
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

      <section className="v1-card ai-log">
        <div className="hd">
          <div>
            <h3>
              Alert summary · logged records{" "}
              <small>
                {fmtN(logRows.length)} of {fmtN(scoped.length)} in the selected period · click a row
                to open it
              </small>
            </h3>
          </div>
          {canRegister ? (
            <button type="button" className="btn sm primary" onClick={() => setDrawerOpen(true)}>
              <Icon name="plus" size={13} /> New SOS Alert
            </button>
          ) : null}
        </div>

        <div className="ai-log-filters">
          <div className="chips">
            {(
              [
                ["All", scoped.length],
                ["Open", openN],
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
              value={logSource}
              onChange={(e) => setLogSource(e.target.value)}
              aria-label="Sources"
            >
              <option value="All">All sources</option>
              {sources.map((v) => (
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
                placeholder="Case ID, worker, location…"
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
                <th>Date</th>
                <th>Worker</th>
                <th>Source</th>
                <th>Location</th>
                <th>Time to see</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {logRows.length ? (
                logRows.map((r) => {
                  const sla = slaState(r);
                  const overdue = Boolean(sla && (sla.k === "over" || sla.k === "esc"));
                  const tts = timeToSeeSec(r);
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
                          <small className="muted">W{r.week_number}</small>
                        </span>
                      </td>
                      <td>{field(r, "worker_name_badge") || r.title || "—"}</td>
                      <td>{field(r, "source") || "—"}</td>
                      <td title={field(r, "location") || undefined}>
                        <span className="clip">{field(r, "location") || "—"}</span>
                      </td>
                      <td className="mono">{tts != null ? `${tts} s` : "—"}</td>
                      <td>
                        <StatusPill status={r.status} />
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={9} className="empty">
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

      <SosNewDrawer
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          if (openForm) window.location.hash = href({ name: "list", type: "sos" });
        }}
        onRegistered={(row) => {
          setDrawerOpen(false);
          void load().then(() => setOpenRecordId(row.id));
          notifyCasesChanged();
        }}
      />
      <SosRecordDrawer
        caseId={openRecordId}
        onClose={() => {
          setOpenRecordId(null);
          if (focusCaseId) {
            window.location.hash = href({ name: "list", type: "sos" });
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
