import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { ChartTip, tipFromEvent, type ChartTipData } from "./chartTip";
import {
  fetchCases,
  fetchPerformance,
  fetchUsers,
  type CaseSummary,
  type PerformancePayload,
} from "../api/scc";
import { errorMessage } from "../lib/errors";
import { useChartReveal } from "../lib/useChartReveal";
import {
  rowAllowedForProjects,
  useAutoProjectFilter,
  useProjectAccess,
} from "../lib/useProjectAccess";
import {formatUserLabel, useList,
  ProjectOnlyViewSeg,
} from "./shared";

type PeriodId =
  | "today"
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "ytd"
  | "custom";

type ViewId = "overall" | "projects" | "departments";

type OpRow = {
  name: string;
  reg: number;
  ai: number;
  dc: number;
  sp: number;
  sos: number;
  up: number;
  co: number;
  ret: number;
  retPct: number;
  avg: number;
  onT: number;
  total: number;
  last: number;
  score: number;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SLA_HOURS: Record<string, number> = { High: 24, Medium: 72, Low: 168, NA: 2 };
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const PAL = {
  ink2: "#4A474C",
  red: "#C8102E",
  green: "#3F8A57",
  line: "color-mix(in srgb, var(--line) 80%, transparent)",
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function isoDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDay(isoOrDate: string | Date) {
  const d =
    typeof isoOrDate === "string"
      ? new Date(`${isoOrDate.slice(0, 10)}T00:00:00`)
      : isoOrDate;
  if (Number.isNaN(d.getTime())) return String(isoOrDate);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function formatStamp(ms: number | null | undefined) {
  if (!ms) return "—";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const sunday = new Date(jan1);
  sunday.setDate(jan1.getDate() - jan1.getDay());
  return Math.floor((sod(d).getTime() - sunday.getTime()) / DAY_MS / 7) + 1;
}

function pct(a: number, b: number) {
  return b ? Math.round((a / b) * 100) : 0;
}

function fmtN(n: number) {
  return n.toLocaleString("en-US");
}

function fmtDur(h: number) {
  if (!Number.isFinite(h) || h <= 0) return "0 min";
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${Math.round(h * 10) / 10} h`;
  return `${Math.round((h / 24) * 10) / 10} days`;
}

function field(row: CaseSummary, key: string) {
  const v = row.fields?.[key];
  return v == null ? "" : String(v);
}

function riskKey(row: CaseSummary) {
  if (row.record_type === "sos") return "NA";
  const raw = (row.risk_level || "Medium").replace(/\s*Risk$/i, "");
  return SLA_HOURS[raw] != null ? raw : "Medium";
}

function slaHours(row: CaseSummary) {
  return SLA_HOURS[riskKey(row)] ?? 72;
}

function tsOf(row: CaseSummary) {
  const t = new Date(row.date || row.created_at).getTime();
  return Number.isFinite(t) ? t : 0;
}

function closeMs(row: CaseSummary) {
  const raw =
    field(row, "confirmed_at") ||
    field(row, "closure_closed_at") ||
    field(row, "closed_at") ||
    field(row, "closeout_at") ||
    field(row, "close_out_submitted_at");
  if (raw) {
    const t = new Date(raw).getTime();
    if (Number.isFinite(t)) return t;
  }
  if (row.status === "closed" || field(row, "close_out_action")) {
    const t = new Date(row.created_at).getTime();
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

function periodRange(period: PeriodId, from: string, to: string, now = new Date()) {
  const year = now.getFullYear();
  const t0 = sod(now).getTime();
  let a = t0;
  let b = now.getTime();
  let label = "";
  let cmp: string | null = "previous period";
  let pa = a;
  let pb = b;

  switch (period) {
    case "today":
      a = t0;
      pa = t0 - DAY_MS;
      pb = t0 - 1;
      label = `Today, ${formatDay(now)}`;
      cmp = "yesterday";
      break;
    case "this_week":
      a = weekStart(now).getTime();
      pa = a - 7 * DAY_MS;
      pb = a - 1;
      label = `${formatDay(new Date(a))} to ${formatDay(now)}`;
      cmp = "last week";
      break;
    case "last_week": {
      const w = weekStart(now).getTime();
      b = w - 1;
      a = w - 7 * DAY_MS;
      pa = a - 7 * DAY_MS;
      pb = a - 1;
      label = `${formatDay(new Date(a))} to ${formatDay(new Date(b))}`;
      cmp = "the week before";
      break;
    }
    case "this_month":
      a = new Date(year, now.getMonth(), 1).getTime();
      pa = new Date(year, now.getMonth() - 1, 1).getTime();
      pb = a - 1;
      label = `${MONTHS[now.getMonth()]} ${year} to date`;
      cmp = "same days last month";
      break;
    case "last_month": {
      const s = new Date(year, now.getMonth() - 1, 1);
      a = s.getTime();
      b = new Date(year, now.getMonth(), 1).getTime() - 1;
      pa = new Date(year, now.getMonth() - 2, 1).getTime();
      pb = a - 1;
      label = `${MONTHS[s.getMonth()]} ${s.getFullYear()}`;
      cmp = MONTHS[(s.getMonth() + 11) % 12];
      break;
    }
    case "custom":
      a = from ? new Date(`${from}T00:00:00`).getTime() : new Date(year, 0, 1).getTime();
      b = to ? new Date(`${to}T23:59:59`).getTime() : now.getTime();
      {
        const L = Math.max(b - a, DAY_MS);
        pb = a - 1;
        pa = a - L;
      }
      label = `${formatDay(new Date(a))} to ${formatDay(new Date(b))}`;
      cmp = "previous range";
      break;
    default:
      a = new Date(year, 0, 1).getTime();
      pa = new Date(year - 1, 0, 1).getTime();
      pb = pa + (Math.min(b, now.getTime()) - a);
      label = `1 Jan to ${formatDay(now)} (Year to date)`;
      cmp = null;
      break;
  }

  return {
    a,
    b: Math.min(b, now.getTime()),
    pa,
    pb,
    label,
    cmp,
    startIso: isoDate(new Date(a)),
    endIso: isoDate(new Date(Math.min(b, now.getTime()))),
  };
}

function lastWeeks(n: number, now = new Date()) {
  const ws = weekStart(now).getTime();
  const out: Array<{ a: number; b: number; label: string }> = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const a = ws - i * 7 * DAY_MS;
    out.push({
      a,
      b: a + 7 * DAY_MS - 1,
      label: `W${weekNo(new Date(a))}`,
    });
  }
  return out;
}

function inView(
  row: CaseSummary,
  view: ViewId,
  project: string,
  department: string,
) {
  if (view === "projects") {
    if (!row.project) return false;
    if (project && row.project !== project) return false;
  }
  if (view === "departments") {
    if (!row.department) return false;
    if (department && row.department !== department) return false;
  }
  return true;
}

function deltaChip(cur: number, prev: number | null, goodWhenDown = false) {
  if (prev == null) return null;
  if (!prev && !cur) return <span className="delta flat">0%</span>;
  if (!prev) {
    return (
      <span className={`delta ${goodWhenDown ? "up-bad" : "up-good"}`}>▲ new</span>
    );
  }
  const d = Math.round(((cur - prev) / prev) * 100);
  if (d === 0) return <span className="delta flat">0%</span>;
  const up = d > 0;
  const cls = up
    ? goodWhenDown
      ? "up-bad"
      : "up-good"
    : goodWhenDown
      ? "down-good"
      : "down-bad";
  return (
    <span className={`delta ${cls}`}>
      {up ? "▲" : "▼"} {Math.abs(d)}%
    </span>
  );
}

function PerfIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 19V5M4 19h16"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M8 16v-5M12 16V8M16 16v-3M20 16V6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 4v11M8.5 11.5 12 15l3.5-3.5M4 18.5h16"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function KpiIcon({ name }: { name: string }) {
  const props = {
    width: 14,
    height: 14,
    viewBox: "0 0 24 24",
    fill: "none",
    "aria-hidden": true as const,
  };
  if (name === "report") {
    return (
      <svg {...props}>
        <path d="M7 3.5h7l4 4V20.5H7z" stroke="currentColor" strokeWidth="1.7" />
        <path d="M14 3.5V8h4.5M9 12h6M9 15.5h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === "itqan") {
    return (
      <svg {...props}>
        <path d="M12 3v18M5 8h14M7 12h10M9 16h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === "review") {
    return (
      <svg {...props}>
        <path d="M5 12.5 10 17.5 19 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (name === "clock") {
    return (
      <svg {...props}>
        <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.7" />
        <path d="M12 8v5l3 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === "x") {
    return (
      <svg {...props}>
        <path d="M7 7l10 10M17 7 7 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg {...props}>
      <circle cx="9" cy="9" r="3.2" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="16" cy="10.5" r="2.6" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3.5 19c1.2-3 3.4-4.5 5.5-4.5s4.3 1.5 5.5 4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M13.5 18.5c.8-2 2.2-3 3.7-3 1.2 0 2.2.6 3 1.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function typeLabel(type: string) {
  if (type === "ai_camera") return "AI Camera Observation";
  if (type === "dashcam") return "Dashcam Observation";
  if (type === "speed") return "Speed Violation";
  if (type === "sos") return "SOS Alert";
  return type;
}

function actorMatches(stored: string, canonical: string) {
  const raw = (stored || "").trim();
  const want = (canonical || "").trim();
  if (!raw || !want) return false;
  if (raw === want) return true;
  // Old rows stored plain names; new rows use `badge - Name`.
  if (want.includes(" - ") && want.endsWith(` - ${raw}`)) return true;
  if (raw.includes(" - ") && raw.endsWith(` - ${want}`)) return true;
  return false;
}

function opStats(
  name: string,
  rows: CaseSummary[],
  a: number,
  b: number,
): OpRow {
  const reg = rows.filter(
    (r) =>
      actorMatches(field(r, "reported_by"), name) &&
      r.record_type !== "itqan" &&
      tsOf(r) >= a &&
      tsOf(r) <= b,
  );
  const up = rows.filter((r) => {
    if (r.record_type !== "dashcam" && r.record_type !== "speed") return false;
    if (!(field(r, "uploaded_by") || field(r, "itqan_upload_proof") || field(r, "confirmed_at")))
      return false;
    const by = field(r, "uploaded_by") || field(r, "reported_by");
    if (!actorMatches(by, name)) return false;
    const done = closeMs(r);
    return done != null && done >= a && done <= b;
  });
  const co = rows.filter((r) => {
    let by = "";
    let done: number | null = null;
    if (r.record_type === "ai_camera" && field(r, "close_out_action")) {
      by = field(r, "close_out_submitted_by") || field(r, "reported_by");
      done = closeMs(r);
    } else if (r.record_type === "sos" && r.status === "closed") {
      by = field(r, "closed_by") || field(r, "reported_by");
      done = closeMs(r);
    } else {
      return false;
    }
    return actorMatches(by, name) && done != null && done >= a && done <= b;
  });
  const ret = reg.filter((r) => Boolean(field(r, "reject_reason"))).length;
  const actions = [...co, ...up];
  const resp = actions
    .map((r) => {
      const done = closeMs(r);
      if (done == null) return null;
      return (done - tsOf(r)) / HOUR_MS;
    })
    .filter((v): v is number => v != null && Number.isFinite(v) && v >= 0);
  const avg = resp.length ? resp.reduce((x, y) => x + y, 0) / resp.length : 0;
  const onTimeCount = actions.filter((r) => {
    const done = closeMs(r);
    if (done == null) return false;
    return (done - tsOf(r)) / HOUR_MS <= slaHours(r);
  }).length;
  const ai = reg.filter((r) => r.record_type === "ai_camera").length;
  const dc = reg.filter((r) => r.record_type === "dashcam").length;
  const sp = reg.filter((r) => r.record_type === "speed").length;
  const sos = reg.filter((r) => r.record_type === "sos").length;
  const last = Math.max(0, ...reg.map((r) => tsOf(r)), ...actions.map((r) => closeMs(r) || 0));
  return {
    name,
    reg: reg.length,
    ai,
    dc,
    sp,
    sos,
    up: up.length,
    co: co.length,
    ret,
    retPct: pct(ret, reg.length),
    avg,
    onT: pct(onTimeCount, actions.length),
    total: reg.length + up.length + co.length,
    last,
    score: 0,
  };
}

function scoreOps(ops: OpRow[]) {
  const mxT = Math.max(1, ...ops.map((o) => o.total));
  return ops
    .map((o) => {
      const follow =
        o.up + o.dc + o.sp
          ? Math.min(100, pct(o.up, Math.max(1, o.dc + o.sp))) * 0.1
          : 10;
      const score = Math.round(
        (o.total / mxT) * 40 + o.onT * 0.3 + (100 - o.retPct) * 0.2 + follow,
      );
      return { ...o, score };
    })
    .sort((a, b) => b.score - a.score || b.total - a.total);
}

function OperatorBars({ rows }: { rows: OpRow[] }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<ChartTipData | null>(null);
  const reveal = useChartReveal(
    hostRef,
    rows.map((r) => `${r.name}:${r.reg},${r.up},${r.co}`).join("|"),
  );
  const ranked = [...rows].sort((a, b) => b.total - a.total);
  const max = Math.max(1, ...ranked.map((o) => o.reg + o.up + o.co));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(max * t));

  function showSeg(
    e: ReactMouseEvent,
    name: string,
    label: string,
    color: string,
    value: number,
  ) {
    setTip(
      tipFromEvent(e, hostRef.current, {
        title: name,
        rows: [{ color, text: `${label}: ${fmtN(value)}` }],
        place: "right",
      }),
    );
  }

  if (!ranked.length) return <p className="state">No operator actions in this period.</p>;
  return (
    <div className="perf-v1-bars v1-chart-host" ref={hostRef} onMouseLeave={() => setTip(null)}>
      <div className="perf-v1-bars-axis" aria-hidden>
        {ticks.map((t) => (
          <span key={t}>{fmtN(t)}</span>
        ))}
      </div>
      <div className="perf-v1-bars-body">
        {ranked.map((row) => {
          const total = row.reg + row.up + row.co || 1;
          const width = Math.max((total / max) * 100 * reveal, 2);
          return (
            <div className="perf-v1-bar-row" key={row.name}>
              <span className="perf-v1-bar-label" title={row.name}>
                {row.name}
              </span>
              <div className="perf-v1-bar-track-wrap">
                <div className="perf-v1-bar-track" style={{ width: `${width}%` }}>
                  {row.reg > 0 ? (
                    <span
                      style={{
                        width: `${(row.reg / total) * 100}%`,
                        background: PAL.ink2,
                        cursor: "pointer",
                      }}
                      onMouseMove={(e) => showSeg(e, row.name, "Registered", PAL.ink2, row.reg)}
                      onMouseLeave={() => setTip(null)}
                    />
                  ) : null}
                  {row.up > 0 ? (
                    <span
                      style={{
                        width: `${(row.up / total) * 100}%`,
                        background: PAL.red,
                        cursor: "pointer",
                      }}
                      onMouseMove={(e) =>
                        showSeg(e, row.name, "Uploaded to ITQAN", PAL.red, row.up)
                      }
                      onMouseLeave={() => setTip(null)}
                    />
                  ) : null}
                  {row.co > 0 ? (
                    <span
                      style={{
                        width: `${(row.co / total) * 100}%`,
                        background: PAL.green,
                        cursor: "pointer",
                      }}
                      onMouseMove={(e) => showSeg(e, row.name, "Close-outs", PAL.green, row.co)}
                      onMouseLeave={() => setTip(null)}
                    />
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="perf-v1-legend">
        <span>
          <i style={{ background: PAL.ink2 }} /> Registered
        </span>
        <span>
          <i style={{ background: PAL.red }} /> Uploaded to ITQAN
        </span>
        <span>
          <i style={{ background: PAL.green }} /> Close-outs
        </span>
      </div>
      <ChartTip tip={tip} />
    </div>
  );
}

function PerfLineChart({
  series,
}: {
  series: Array<{ label: string; registered: number; uploaded: number; close_outs: number }>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<ChartTipData | null>(null);
  const reveal = useChartReveal(
    hostRef,
    series.map((r) => `${r.label}:${r.registered},${r.uploaded},${r.close_outs}`).join("|"),
  );
  const keys = ["registered", "uploaded", "close_outs"] as const;
  const seriesLabels = {
    registered: "Registered",
    uploaded: "Uploaded to ITQAN",
    close_outs: "Close-outs",
  };
  const colors = {
    registered: PAL.ink2,
    uploaded: PAL.red,
    close_outs: PAL.green,
  };
  const max = Math.max(
    1,
    ...series.flatMap((row) => keys.map((k) => Number(row[k] ?? 0))),
  );
  const width = 520;
  const height = 240;
  const padL = 36;
  const padR = 12;
  const padT = 16;
  const padB = 28;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(max * t));

  function xy(index: number, value: number) {
    const x =
      padL +
      (series.length <= 1 ? innerW / 2 : (index / (series.length - 1)) * innerW);
    const y = padT + innerH - (value / max) * innerH;
    return { x, y };
  }

  const visibleCount = Math.max(1, Math.ceil(series.length * Math.max(reveal, 0.001)));

  function pathFor(key: (typeof keys)[number], close = false) {
    const pts = series.slice(0, visibleCount).map((row, i) => xy(i, Number(row[key] ?? 0)));
    if (!pts.length) return "";
    let d = `M${pts[0].x},${pts[0].y}`;
    for (let i = 1; i < pts.length; i += 1) d += ` L${pts[i].x},${pts[i].y}`;
    if (close) {
      const last = pts[pts.length - 1];
      const first = pts[0];
      d += ` L${last.x},${padT + innerH} L${first.x},${padT + innerH} Z`;
    }
    return d;
  }

  function showWeek(e: ReactMouseEvent, i: number) {
    const row = series[i];
    if (!row) return;
    setTip(
      tipFromEvent(e, hostRef.current, {
        title: row.label,
        rows: keys.map((key) => ({
          color: colors[key],
          text: `${seriesLabels[key]}: ${fmtN(Number(row[key] ?? 0))}`,
        })),
        place: "top",
      }),
    );
  }

  return (
    <div className="perf-v1-line-wrap v1-chart-host" ref={hostRef} onMouseLeave={() => setTip(null)}>
      <svg className="perf-v1-line" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Actions over the last 8 weeks">
        {yTicks.map((t) => {
          const y = padT + innerH - (t / max) * innerH;
          return (
            <g key={t}>
              <line x1={padL} x2={width - padR} y1={y} y2={y} stroke="var(--line)" strokeWidth="1" />
              <text x={padL - 6} y={y + 3} textAnchor="end" fontSize="10" fill="var(--muted)">
                {t}
              </text>
            </g>
          );
        })}
        {series.map((row, i) => {
          const x = xy(i, 0).x;
          return (
            <text key={row.label} x={x} y={height - 8} textAnchor="middle" fontSize="10" fill="var(--muted)">
              {row.label}
            </text>
          );
        })}
        <path
          d={pathFor("registered", true)}
          fill="color-mix(in srgb, #4A474C 12%, transparent)"
          stroke="none"
          pointerEvents="none"
        />
        {keys.map((key) => (
          <g key={key}>
            <path d={pathFor(key)} fill="none" stroke={colors[key]} strokeWidth="2.2" pointerEvents="none" />
            {series.slice(0, visibleCount).map((row, i) => {
              const { x, y } = xy(i, Number(row[key] ?? 0));
              return (
                <circle
                  key={`${key}-${i}`}
                  cx={x}
                  cy={y}
                  r={5}
                  fill={colors[key]}
                  style={{ cursor: "pointer" }}
                  onMouseMove={(e) => showWeek(e, i)}
                  onMouseLeave={() => setTip(null)}
                />
              );
            })}
          </g>
        ))}
      </svg>
      <div className="perf-v1-legend">
        <span>
          <i style={{ background: PAL.ink2 }} /> Registered
        </span>
        <span>
          <i style={{ background: PAL.red }} /> Uploaded to ITQAN
        </span>
        <span>
          <i style={{ background: PAL.green }} /> Close-outs
        </span>
      </div>
      <ChartTip tip={tip} />
    </div>
  );
}

function exportCsv(ops: OpRow[]) {
  const lines = [
    ["Operator", "AI", "Dashcam", "Speed", "SOS", "Uploaded", "Close-outs", "On time %", "Returned %", "Score"],
    ...ops.map((o) => [
      o.name,
      o.ai,
      o.dc,
      o.sp,
      o.sos,
      o.up,
      o.co,
      o.onT,
      o.retPct,
      o.score,
    ]),
  ];
  const csv = lines.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "operator-performance.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export function PerformanceScreen() {
  const projects = useList("project");
  const departments = useList("department");
  const [view, setView] = useState<ViewId>("overall");
  const [period, setPeriod] = useState<PeriodId>("ytd");
  const [project, setProject] = useState("");
  const [department, setDepartment] = useState("");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [operators, setOperators] = useState<string[]>([]);
  const [activity, setActivity] = useState<PerformancePayload["activity"]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const catalogProjects = useMemo(
    () => projects.items.map((p) => p.label),
    [projects.items],
  );
  const projectAccess = useProjectAccess(catalogProjects);
  useAutoProjectFilter(projectAccess, project, setProject, setView);

  const range = useMemo(
    () => periodRange(period, customFrom, customTo),
    [period, customFrom, customTo],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchCases(), fetchUsers()])
      .then(([caseData, userData]) => {
        if (cancelled) return;
        setCases(caseData.items ?? []);
        setOperators(
          userData.items
            .filter((u) => u.role === "operator")
            .map((u) => formatUserLabel(u))
            .filter(Boolean),
        );
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchPerformance({
      period: "custom",
      start_date: range.startIso,
      end_date: range.endIso,
      project: view === "projects" && project ? project : undefined,
    })
      .then((data) => {
        if (!cancelled) setActivity(data.activity ?? []);
      })
      .catch(() => {
        if (!cancelled) setActivity([]);
      });
    return () => {
      cancelled = true;
    };
  }, [range.startIso, range.endIso, view, project]);

  const scoped = useMemo(
    () =>
      cases.filter(
        (r) =>
          rowAllowedForProjects(r.project, projectAccess) &&
          inView(r, view, project, department),
      ),
    [cases, view, project, department, projectAccess],
  );

  const names = useMemo(() => {
    if (operators.length) return operators;
    const set = new Set<string>();
    for (const row of scoped) {
      const reporter = field(row, "reported_by");
      if (reporter) set.add(reporter);
    }
    return [...set].sort();
  }, [operators, scoped]);

  const ops = useMemo(() => {
    const rows = scoreOps(
      names
        .map((name) => opStats(name, scoped, range.a, range.b))
        .filter((o) => o.total > 0),
    );
    return rows;
  }, [names, scoped, range.a, range.b]);

  const prevOps = useMemo(
    () =>
      names
        .map((name) => opStats(name, scoped, range.pa, range.pb))
        .filter((o) => o.total > 0),
    [names, scoped, range.pa, range.pb],
  );

  const sum = (key: keyof OpRow) =>
    ops.reduce((acc, o) => acc + Number(o[key] || 0), 0);
  const psum = (key: keyof OpRow) =>
    prevOps.reduce((acc, o) => acc + Number(o[key] || 0), 0);

  const onTimeAvg = ops.length
    ? Math.round(ops.reduce((a, o) => a + o.onT, 0) / ops.length)
    : 0;

  const weekSeries = useMemo(() => {
    const weeks = lastWeeks(8);
    return weeks.map((w) => {
      let registered = 0;
      let uploaded = 0;
      let close_outs = 0;
      for (const name of names) {
        const s = opStats(name, scoped, w.a, w.b);
        registered += s.reg;
        uploaded += s.up;
        close_outs += s.co;
      }
      return { label: w.label, registered, uploaded, close_outs };
    });
  }, [names, scoped]);

  const activityRows = useMemo(() => {
    if (activity.length) return activity;
    // Fallback from cases when API activity is empty.
    const events: PerformancePayload["activity"] = [];
    for (const row of scoped) {
      if (row.record_type === "itqan") continue;
      const t = tsOf(row);
      if (t < range.a || t > range.b) continue;
      const reporter = field(row, "reported_by");
      const reporterName = names.find((n) => actorMatches(reporter, n));
      if (reporterName) {
        events.push({
          at: row.created_at || row.date,
          operator: reporterName,
          action: "Registered",
          case_id: row.case_id,
          details: `${typeLabel(row.record_type)}, ${row.project || "—"}`,
        });
      }
      if (field(row, "uploaded_by") || field(row, "itqan_upload_proof")) {
        const uploader = field(row, "uploaded_by") || reporter;
        const uploaderName = names.find((n) => actorMatches(uploader, n));
        if (uploaderName) {
          events.push({
            at: field(row, "confirmed_at") || row.created_at,
            operator: uploaderName,
            action: "Driver confirmed & ITQAN proof submitted",
            case_id: row.case_id,
            details: `${typeLabel(row.record_type)}, ${row.project || "—"}`,
          });
        }
      }
    }
    return events
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 60);
  }, [activity, scoped, range.a, range.b, names]);

  const year = new Date().getFullYear();

  if (loading && !cases.length) return <p className="state">Loading operator performance…</p>;
  if (error && !cases.length) return <p className="state error">{error}</p>;

  const kpis: Array<{
    title: string;
    icon: string;
    value: string | number;
    prev: number | null;
    hint: string;
    downGood?: boolean;
  }> = [
    {
      title: "Records registered",
      icon: "report",
      value: sum("reg"),
      prev: psum("reg"),
      hint: "observations, violations and SOS",
    },
    {
      title: "Uploaded to ITQAN",
      icon: "itqan",
      value: sum("up"),
      prev: psum("up"),
      hint: "Confirm Driver & Submit completed",
    },
    {
      title: "Close-outs",
      icon: "review",
      value: sum("co"),
      prev: psum("co"),
      hint: "AI close-outs and SOS closed",
    },
    {
      title: "On-time actions",
      icon: "clock",
      value: `${onTimeAvg}%`,
      prev: null,
      hint: "within the risk deadline",
    },
    {
      title: "Returned by Admin",
      icon: "x",
      value: sum("ret"),
      prev: psum("ret"),
      hint: "close-outs sent back for rework",
      downGood: true,
    },
    {
      title: "Active operators",
      icon: "users",
      value: ops.length,
      prev: null,
      hint: "with at least one action",
    },
  ];

  return (
    <section className="page v1-dash perf-v1">
      <section className="v1-banner">
        <div className="v1-banner-icon">
          <PerfIcon />
        </div>
        <div className="v1-banner-copy">
          <h1>
            OPERATOR <em>PERFORMANCE</em>
          </h1>
          <p>
            What each Operator registered, uploaded and closed <i>•</i> Speed{" "}
            <i>•</i> Quality
          </p>
        </div>
        <div className="v1-banner-actions">
          <span className="tagx red">
            <LockIcon /> Admin only
          </span>
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
              {departments.items.map((d) => (
                <option key={d.id} value={d.label}>
                  {d.label}
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
              />
              <span className="muted">to</span>
              <input
                type="date"
                className="inp"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </>
          ) : null}
        </div>
        <div className="range">
          <b>{range.label}</b>
          <span>
            {range.cmp ? `Compared with ${range.cmp}` : "Compared month by month"}
          </span>
        </div>
      </div>

      <div className="v1-grid g6">
        {kpis.map((card) => (
          <article className="v1-kpi" key={card.title}>
            <div className="t">
              <span className="ic">
                <KpiIcon name={card.icon} />
              </span>
              {card.title}
              {card.prev != null && typeof card.value === "number" ? (
                <span style={{ marginLeft: "auto" }}>
                  {deltaChip(card.value, card.prev, Boolean(card.downGood))}
                </span>
              ) : null}
            </div>
            <div className="v">
              {typeof card.value === "number" ? fmtN(card.value) : card.value}
            </div>
            <div className="s">{card.hint}</div>
          </article>
        ))}
      </div>

      <article className="v1-card">
        <div className="hd">
          <div>
            <h3>Leaderboard</h3>
            <p className="sub">
              Score = volume 40% · on-time 30% · quality (not returned) 20% · ITQAN
              follow-through 10%.
            </p>
          </div>
          <button
            type="button"
            className="btn sm"
            onClick={() => exportCsv(ops)}
          >
            <DownloadIcon /> Export Excel
          </button>
        </div>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>#</th>
                <th>Operator</th>
                <th className="n">AI Camera</th>
                <th className="n">Dashcam</th>
                <th className="n">Speed</th>
                <th className="n">SOS</th>
                <th className="n">Uploaded</th>
                <th className="n">Close-outs</th>
                <th className="n">On time</th>
                <th className="n">Returned</th>
                <th className="n">Avg response</th>
                <th className="n">Score</th>
                <th>Last activity</th>
              </tr>
            </thead>
            <tbody>
              {ops.map((o, i) => (
                <tr key={o.name}>
                  <td>
                    {i < 3 ? (
                      <span className={`tagx ${i === 0 ? "red" : "amber"}`}>#{i + 1}</span>
                    ) : (
                      <b className="mono">#{i + 1}</b>
                    )}
                  </td>
                  <td>
                    <b>{o.name}</b>
                  </td>
                  <td className="n">{o.ai}</td>
                  <td className="n">{o.dc}</td>
                  <td className="n">{o.sp}</td>
                  <td className="n">{o.sos}</td>
                  <td className="n">{o.up}</td>
                  <td className="n">{o.co}</td>
                  <td className="n">{o.onT}%</td>
                  <td className="n">{o.retPct}%</td>
                  <td className="n">{fmtDur(o.avg)}</td>
                  <td className="n">
                    <span
                      className={`tagx ${
                        o.score >= 75 ? "green" : o.score >= 55 ? "amber" : "red"
                      }`}
                    >
                      {o.score}
                    </span>
                  </td>
                  <td className="muted">{formatStamp(o.last)}</td>
                </tr>
              ))}
              {!ops.length ? (
                <tr>
                  <td colSpan={13} className="muted">
                    No operator activity in this period.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </article>

      <div className="v1-grid g2">
        <article className="v1-card">
          <div className="hd">
            <div>
              <h3>Actions by operator</h3>
              <p className="sub">
                Registered, uploaded to ITQAN and close-outs in the period
              </p>
            </div>
          </div>
          <OperatorBars rows={ops} />
        </article>
        <article className="v1-card">
          <div className="hd">
            <div>
              <h3>Actions over the last 8 weeks</h3>
              <p className="sub">All Operators together · {year}</p>
            </div>
          </div>
          <PerfLineChart series={weekSeries} />
        </article>
      </div>

      <article className="v1-card">
        <div className="hd">
          <div>
            <h3>Activity log</h3>
            <p className="sub">
              Every action an Operator takes, newest first, from the audit trail.
            </p>
          </div>
        </div>
        <div className="tbl-wrap perf-v1-activity">
          <table className="tbl">
            <thead>
              <tr>
                <th>Date and time</th>
                <th>Operator</th>
                <th>Action</th>
                <th>Case ID</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {activityRows.map((row, index) => (
                <tr key={`${row.case_id}-${row.action}-${index}`}>
                  <td className="num nw">
                    {formatStamp(new Date(row.at).getTime())}
                  </td>
                  <td>{row.operator}</td>
                  <td>{row.action}</td>
                  <td className="id">{row.case_id}</td>
                  <td className="muted">{row.details}</td>
                </tr>
              ))}
              {!activityRows.length ? (
                <tr>
                  <td colSpan={5} className="muted">
                    No activity in this period.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}
