import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ChartTip, tipFromEvent, type ChartTipData } from "./chartTip";
import {
  fetchCases,
  fetchHw,
  type CaseSummary,
  type HwPayload,
} from "../api/scc";
import { errorMessage } from "../lib/errors";
import { useChartReveal } from "../lib/useChartReveal";
import {
  rowAllowedForProjects,
  useAutoProjectFilter,
  useProjectAccess,
} from "../lib/useProjectAccess";
import {useList,
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

type ProjectMetrics = {
  n: number;
  sla: number;
  closeT: number;
  closure: number;
  od: number;
  itq: number;
  sl: number;
  vp100: number;
  perCam: number;
  pos: number;
  vio: number;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MON3 = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const SLA_HOURS: Record<string, number> = { High: 24, Medium: 72, Low: 168, NA: 2 };
const PROJECT_COLORS = ["#C8102E", "#8B8A8F", "#E9CF6A", "#6B8E3D"];
const HOUR_MS = 3600000;
const DAY_MS = 86400000;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function isoDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDay(iso: string) {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function sod(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function weekStart(d: Date) {
  const x = sod(d);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

function pct(a: number, b: number) {
  return b ? Math.round((a / b) * 100) : 0;
}

function fmtN(n: number) {
  return n.toLocaleString("en-US");
}

function fmtDur(h: number) {
  if (!Number.isFinite(h) || h <= 0) return "—";
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${Math.round(h * 10) / 10} h`;
  return `${Math.round((h / 24) * 10) / 10} days`;
}

function caseField(row: CaseSummary, key: string) {
  const v = row.fields?.[key];
  return v == null ? "" : String(v);
}

function riskKey(row: CaseSummary) {
  if (row.record_type === "sos") return "NA";
  return row.risk_level || "Medium";
}

function closedAtMs(row: CaseSummary) {
  const raw =
    caseField(row, "closure_closed_at") ||
    caseField(row, "closed_at") ||
    caseField(row, "closeout_at");
  if (raw) {
    const t = new Date(raw).getTime();
    if (Number.isFinite(t)) return t;
  }
  if (row.status === "closed") {
    const t = new Date(row.created_at).getTime();
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

function isDone(row: CaseSummary) {
  return closedAtMs(row) != null;
}

function isOnTime(row: CaseSummary) {
  const closed = closedAtMs(row);
  if (closed == null) return false;
  const created = new Date(row.created_at).getTime();
  if (!Number.isFinite(created)) return false;
  const limit = SLA_HOURS[riskKey(row)] ?? 72;
  return (closed - created) / HOUR_MS <= limit;
}

function isOverdueOpen(row: CaseSummary, now = Date.now()) {
  if (row.status === "closed") return false;
  const created = new Date(row.created_at).getTime();
  if (!Number.isFinite(created)) return false;
  const limit = SLA_HOURS[riskKey(row)] ?? 72;
  return (now - created) / HOUR_MS > limit;
}

function periodRange(period: PeriodId, from: string, to: string, now = new Date()) {
  const year = now.getFullYear();
  const t0 = sod(now).getTime();
  let a = t0;
  let b = now.getTime();
  let label = "";
  let cmp: string | null = "previous period";

  switch (period) {
    case "today":
      a = t0;
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
      label = `${MONTHS[s.getMonth()]} ${s.getFullYear()}`;
      cmp = MONTHS[(s.getMonth() + 11) % 12];
      break;
    }
    case "custom":
      a = from ? new Date(`${from}T00:00:00`).getTime() : new Date(year, 0, 1).getTime();
      b = to ? new Date(`${to}T23:59:59`).getTime() : now.getTime();
      label = `${formatDay(isoDate(new Date(a)))} to ${formatDay(isoDate(new Date(b)))}`;
      cmp = "previous range";
      break;
    default:
      a = new Date(year, 0, 1).getTime();
      label = `1 Jan to ${formatDay(isoDate(now))} (Year to date)`;
      cmp = null;
      break;
  }
  return {
    a,
    b: Math.min(b, now.getTime()),
    label,
    cmp,
  };
}

function inPeriod(row: CaseSummary, a: number, b: number) {
  const t = new Date(row.date || row.created_at).getTime();
  return Number.isFinite(t) && t >= a && t <= b;
}

function hwCount(
  hw: HwPayload | null,
  project: string | null,
  match: (dtype: string) => boolean,
) {
  if (!hw) return 0;
  let sum = 0;
  for (const [site, counts] of Object.entries(hw.project_counts || {})) {
    if (project && site !== project) continue;
    for (const [dtype, n] of Object.entries(counts)) {
      if (match(dtype)) sum += Number(n) || 0;
    }
  }
  return sum;
}

function computeMetrics(
  rows: CaseSummary[],
  hw: HwPayload | null,
  project: string | null,
): ProjectMetrics {
  const all = rows.filter((r) => r.record_type !== "itqan");
  const done = all.filter(isDone);
  const onTime = done.filter(isOnTime).length;
  const closeT = done.length
    ? done.reduce((acc, r) => {
        const closed = closedAtMs(r)!;
        const created = new Date(r.created_at).getTime();
        return acc + (closed - created) / HOUR_MS;
      }, 0) / done.length
    : 0;
  const closed = all.filter((r) => r.status === "closed").length;
  const od = all.filter((r) => isOverdueOpen(r)).length;
  const vio = all.filter((r) => r.record_type === "dashcam" || r.record_type === "speed");
  const conf = vio.filter((r) => r.status !== "open");
  const itq = conf.filter(
    (r) => caseField(r, "itqan_upload_proof") || caseField(r, "uploaded_by"),
  ).length;
  const ai = all.filter((r) => r.record_type === "ai_camera");
  const sl = ai.filter(
    (r) =>
      r.fields?.safelife_update === true ||
      String(r.fields?.safelife_update) === "true" ||
      Boolean(caseField(r, "safelife_ref")),
  );
  const slDone = sl.filter((r) => r.status !== "open").length;
  const pos = ai.filter((r) => /positive/i.test(caseField(r, "alert_type"))).length;
  const gps = hwCount(hw, project, (d) => /avl|gps/i.test(d));
  const cams = hwCount(hw, project, (d) => /camera|cctv/i.test(d));
  return {
    n: all.length,
    sla: pct(onTime, done.length),
    closeT,
    closure: pct(closed, all.length),
    od,
    itq: pct(itq, conf.length),
    sl: pct(slDone, sl.length),
    vp100: gps ? Math.round((vio.length / gps) * 1000) / 10 : vio.length ? vio.length * 10 : 0,
    perCam: cams ? Math.round((ai.length / cams) * 10) / 10 : ai.length ? ai.length : 0,
    pos: pct(pos, ai.length),
    vio: vio.length,
  };
}

function scoreOf(x: ProjectMetrics) {
  return Math.round(
    x.sla * 0.35 +
      x.closure * 0.25 +
      x.itq * 0.15 +
      x.sl * 0.1 +
      Math.max(0, 100 - x.od * 4) * 0.15,
  );
}

function rag(
  val: number,
  target: number,
  inverted = false,
): "green" | "amber" | "red" {
  if (inverted) {
    if (val >= 100) return "green";
    if (val >= 80) return "amber";
    return "red";
  }
  if (val >= target) return "green";
  if (val >= target * 0.85) return "amber";
  return "red";
}

function ragLabel(tone: "green" | "amber" | "red") {
  return tone === "green" ? "On target" : tone === "amber" ? "Watch" : "Off target";
}

function KpiIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    </svg>
  );
}

function MiniIcon({ name }: { name: "clock" | "gps" | "cam" | "report" }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
  } as const;
  if (name === "clock") {
    return (
      <svg {...common} aria-hidden>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v5l3 2" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === "gps") {
    return (
      <svg {...common} aria-hidden>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 3v2M12 19v2M3 12h2M19 12h2" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === "cam") {
    return (
      <svg {...common} aria-hidden>
        <rect x="3" y="7" width="12" height="10" rx="1.5" />
        <path d="M15 10l5-2v8l-5-2" />
      </svg>
    );
  }
  return (
    <svg {...common} aria-hidden>
      <path d="M7 3h7l5 5v13H7V3z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" strokeLinecap="round" />
    </svg>
  );
}

function RadarChart({
  projects,
  series,
}: {
  projects: string[];
  series: number[][];
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<ChartTipData | null>(null);
  const reveal = useChartReveal(
    hostRef,
    `${projects.join("|")}|${series.map((s) => s.join(",")).join(";")}`,
  );
  const labels = [
    "On-time close-out",
    "Closure rate",
    "ITQAN compliance",
    "SafeLife updates",
    "Low overdue",
  ];
  // Keep labels inside the viewBox while filling more of the card.
  const size = 340;
  const cx = size / 2;
  const cy = size / 2;
  const r = 108;
  const n = labels.length;
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i: number, v: number) => {
    const a = angle(i);
    const rr = (Math.max(0, Math.min(100, v)) / 100) * r;
    return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr] as const;
  };
  const ring = (pctVal: number) =>
    labels
      .map((_, i) => {
        const [x, y] = pt(i, pctVal);
        return `${i === 0 ? "M" : "L"}${x},${y}`;
      })
      .join(" ") + " Z";

  return (
    <div
      className="kpi-chart-wrap kpi-chart-wrap-radar v1-chart-host"
      ref={hostRef}
      onMouseLeave={() => setTip(null)}
    >
      <svg viewBox={`0 0 ${size} ${size}`} className="kpi-radar" role="img" aria-label="Project comparison">
        {[25, 50, 75, 100].map((p) => (
          <path key={p} d={ring(p)} className="kpi-radar-grid" pointerEvents="none" />
        ))}
        {labels.map((label, i) => {
          const [x, y] = pt(i, 100);
          const [tx, ty] = pt(i, 122);
          return (
            <g key={label}>
              <line x1={cx} y1={cy} x2={x} y2={y} className="kpi-radar-axis" pointerEvents="none" />
              <text
                x={tx}
                y={ty}
                className="kpi-radar-label"
                textAnchor="middle"
                dominantBaseline="middle"
                pointerEvents="none"
              >
                {label}
              </text>
            </g>
          );
        })}
        {series.map((vals, si) => {
          const d =
            vals
              .map((v, i) => {
                const [x, y] = pt(i, v * reveal);
                return `${i === 0 ? "M" : "L"}${x},${y}`;
              })
              .join(" ") + " Z";
          const color = PROJECT_COLORS[si % PROJECT_COLORS.length];
          const name = projects[si] || "";
          return (
            <path
              key={name}
              d={d}
              fill={`${color}22`}
              stroke={color}
              strokeWidth={2}
              style={{ cursor: "pointer" }}
              onMouseMove={(e) =>
                setTip(
                  tipFromEvent(e, hostRef.current, {
                    title: name,
                    rows: labels.map((lab, i) => ({
                      color,
                      text: `${lab}: ${Math.round(vals[i] ?? 0)}%`,
                    })),
                  }),
                )
              }
              onMouseLeave={() => setTip(null)}
            />
          );
        })}
      </svg>
      <div className="kpi-legend">
        {projects.map((p, i) => (
          <span key={p}>
            <i style={{ background: PROJECT_COLORS[i % PROJECT_COLORS.length] }} />
            {p}
          </span>
        ))}
      </div>
      <ChartTip tip={tip} />
    </div>
  );
}

function TrendChart({
  labels,
  onTime,
  closure,
}: {
  labels: string[];
  onTime: number[];
  closure: number[];
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<ChartTipData | null>(null);
  const reveal = useChartReveal(
    hostRef,
    `${labels.join("|")}|${onTime.join(",")}|${closure.join(",")}`,
  );
  const w = 520;
  const h = 240;
  const padL = 36;
  const padR = 12;
  const padT = 16;
  const padB = 36;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const xAt = (i: number) =>
    padL + (labels.length <= 1 ? innerW / 2 : (i / (labels.length - 1)) * innerW);
  const yAt = (v: number) => padT + innerH * (1 - Math.max(0, Math.min(100, v)) / 100);
  const visibleCount = Math.max(1, Math.ceil(labels.length * Math.max(reveal, 0.001)));
  const line = (vals: number[]) =>
    vals
      .slice(0, visibleCount)
      .map((v, i) => `${i === 0 ? "M" : "L"}${xAt(i)},${yAt(v)}`)
      .join(" ");

  function showMonth(e: React.MouseEvent, i: number) {
    setTip(
      tipFromEvent(e, hostRef.current, {
        title: labels[i] || "",
        rows: [
          { color: "var(--red)", text: `On-time close-out: ${Math.round(onTime[i] ?? 0)}%` },
          { color: "#8B8A8F", text: `Closure rate: ${Math.round(closure[i] ?? 0)}%` },
        ],
        place: "top",
      }),
    );
  }

  return (
    <div className="kpi-chart-wrap v1-chart-host" ref={hostRef} onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${w} ${h}`} className="kpi-trend" role="img" aria-label="Monthly performance trend">
        {[0, 20, 40, 60, 80, 100].map((v) => (
          <g key={v}>
            <line x1={padL} y1={yAt(v)} x2={w - padR} y2={yAt(v)} className="kpi-grid-line" />
            <text x={padL - 6} y={yAt(v)} className="kpi-axis-label" textAnchor="end" dominantBaseline="middle">
              {v}%
            </text>
          </g>
        ))}
        <line
          x1={padL}
          y1={yAt(95)}
          x2={w - padR}
          y2={yAt(95)}
          stroke="var(--green)"
          strokeDasharray="6 4"
          strokeWidth={1.5}
        />
        <path d={line(onTime)} fill="none" stroke="var(--red)" strokeWidth={2.2} pointerEvents="none" />
        <path d={line(closure)} fill="none" stroke="#8B8A8F" strokeWidth={2.2} pointerEvents="none" />
        {labels.slice(0, visibleCount).map((_, i) => (
          <g key={labels[i]}>
            <circle
              cx={xAt(i)}
              cy={yAt(onTime[i] ?? 0)}
              r={6}
              fill="var(--red)"
              style={{ cursor: "pointer" }}
              onMouseMove={(e) => showMonth(e, i)}
              onMouseLeave={() => setTip(null)}
            />
            <circle
              cx={xAt(i)}
              cy={yAt(closure[i] ?? 0)}
              r={6}
              fill="#8B8A8F"
              style={{ cursor: "pointer" }}
              onMouseMove={(e) => showMonth(e, i)}
              onMouseLeave={() => setTip(null)}
            />
          </g>
        ))}
        {labels.map((label, i) => (
          <text key={label} x={xAt(i)} y={h - 12} className="kpi-axis-label" textAnchor="middle">
            {label}
          </text>
        ))}
      </svg>
      <div className="kpi-legend">
        <span>
          <i style={{ background: "var(--red)" }} />
          On-time close-out %
        </span>
        <span>
          <i style={{ background: "#8B8A8F" }} />
          Closure rate %
        </span>
        <span>
          <i className="dash" style={{ background: "var(--green)" }} />
          Target 95%
        </span>
      </div>
      <ChartTip tip={tip} />
    </div>
  );
}

function LeadLagChart({
  labels,
  observations,
  violations,
}: {
  labels: string[];
  observations: number[];
  violations: number[];
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<ChartTipData | null>(null);
  const reveal = useChartReveal(
    hostRef,
    `${labels.join("|")}|${observations.join(",")}|${violations.join(",")}`,
  );
  const w = 640;
  const h = 240;
  const padL = 36;
  const padR = 12;
  const padT = 16;
  const padB = 40;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const max = Math.max(1, ...observations, ...violations);
  const groupW = innerW / Math.max(1, labels.length);
  const barW = Math.min(16, groupW * 0.32);

  return (
    <div className="kpi-chart-wrap v1-chart-host" ref={hostRef} onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${w} ${h}`} className="kpi-leadlag" role="img" aria-label="Leading vs lagging">
        {[0, 0.25, 0.5, 0.75, 1].map((p) => {
          const v = Math.round(max * p);
          const y = padT + innerH * (1 - p);
          return (
            <g key={p}>
              <line x1={padL} y1={y} x2={w - padR} y2={y} className="kpi-grid-line" />
              <text x={padL - 6} y={y} className="kpi-axis-label" textAnchor="end" dominantBaseline="middle">
                {v}
              </text>
            </g>
          );
        })}
        {labels.map((label, i) => {
          const cx = padL + groupW * i + groupW / 2;
          const oh = (observations[i] / max) * innerH * reveal;
          const vh = (violations[i] / max) * innerH * reveal;
          return (
            <g key={label}>
              <rect
                x={cx - barW - 2}
                y={padT + innerH - oh}
                width={barW}
                height={oh}
                rx={3}
                fill="#6B8E3D"
                style={{ cursor: observations[i] ? "pointer" : "default" }}
                onMouseMove={
                  observations[i]
                    ? (e) =>
                        setTip(
                          tipFromEvent(e, hostRef.current, {
                            title: label,
                            rows: [
                              { color: "#6B8E3D", text: `Observations: ${fmtN(observations[i] ?? 0)}` },
                              { color: "var(--red)", text: `Violations: ${fmtN(violations[i] ?? 0)}` },
                            ],
                          }),
                        )
                    : undefined
                }
                onMouseLeave={() => setTip(null)}
              />
              <rect
                x={cx + 2}
                y={padT + innerH - vh}
                width={barW}
                height={vh}
                rx={3}
                fill="var(--red)"
                style={{ cursor: violations[i] ? "pointer" : "default" }}
                onMouseMove={
                  violations[i]
                    ? (e) =>
                        setTip(
                          tipFromEvent(e, hostRef.current, {
                            title: label,
                            rows: [
                              { color: "#6B8E3D", text: `Observations: ${fmtN(observations[i] ?? 0)}` },
                              { color: "var(--red)", text: `Violations: ${fmtN(violations[i] ?? 0)}` },
                            ],
                          }),
                        )
                    : undefined
                }
                onMouseLeave={() => setTip(null)}
              />
              <text x={cx} y={h - 14} className="kpi-axis-label" textAnchor="middle">
                {label}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="kpi-legend">
        <span>
          <i style={{ background: "#6B8E3D" }} />
          Observations (leading)
        </span>
        <span>
          <i style={{ background: "var(--red)" }} />
          Violations (lagging)
        </span>
      </div>
      <ChartTip tip={tip} />
    </div>
  );
}

function OffenderBars({
  items,
}: {
  items: Array<{ label: string; value: number }>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<ChartTipData | null>(null);
  const reveal = useChartReveal(
    hostRef,
    items.map((x) => `${x.label}:${x.value}`).join("|"),
  );
  const max = Math.max(1, ...items.map((x) => x.value));
  return (
    <div className="kpi-offenders v1-chart-host" ref={hostRef} onMouseLeave={() => setTip(null)}>
      {items.map((item) => (
        <div className="kpi-offender-row" key={item.label}>
          <span className="kpi-offender-name">{item.label}</span>
          <div className="kpi-offender-track">
            <i
              style={{
                width: `${(item.value / max) * 100 * reveal}%`,
                cursor: item.value > 0 ? "pointer" : "default",
              }}
              onMouseMove={
                item.value > 0
                  ? (e) =>
                      setTip(
                        tipFromEvent(e, hostRef.current, {
                          title: item.label,
                          rows: [{ color: "var(--red)", text: fmtN(item.value) }],
                          place: "right",
                        }),
                      )
                  : undefined
              }
              onMouseLeave={() => setTip(null)}
            />
          </div>
          <b>{item.value}</b>
        </div>
      ))}
      {!items.length ? <p className="state">No violations in this period.</p> : null}
      <ChartTip tip={tip} />
    </div>
  );
}

export function KpiScreen() {
  const projectList = useList("project");
  const departmentList = useList("department");
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [hw, setHw] = useState<HwPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewId>("projects");
  const [project, setProject] = useState("");
  const [department, setDepartment] = useState("");
  const [period, setPeriod] = useState<PeriodId>("ytd");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchCases(), fetchHw()])
      .then(([caseData, hwData]) => {
        if (cancelled) return;
        setCases(Array.isArray(caseData?.items) ? caseData.items : []);
        setHw(hwData ?? null);
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

  const nowDate = useMemo(() => new Date(), []);
  const nowMs = nowDate.getTime();
  const year = nowDate.getFullYear();
  const selectedRange = useMemo(
    () => periodRange(period, customFrom, customTo, nowDate),
    [period, customFrom, customTo, nowDate],
  );

  const catalogProjects = useMemo(() => {
    const fromList = projectList.items.map((p) => p.label).filter(Boolean);
    if (fromList.length) return fromList;
    return ["Jafurah", "MGS", "Yanbu", "Ras Tanura"];
  }, [projectList.items]);
  const projectAccess = useProjectAccess(catalogProjects);
  useAutoProjectFilter(projectAccess, project, setProject, setView);

  const projects = useMemo(() => {
    const list = projectAccess.accessProjects;
    return list.length ? list.slice(0, Math.max(4, list.length)) : catalogProjects.slice(0, 4);
  }, [projectAccess.accessProjects, catalogProjects]);

  const scoped = useMemo(() => {
    return cases.filter((row) => {
      if (!rowAllowedForProjects(row.project, projectAccess)) return false;
      if (!inPeriod(row, selectedRange.a, selectedRange.b)) return false;
      if (view === "projects" && project && row.project !== project) return false;
      if (view === "departments" && department && row.department !== department) return false;
      return true;
    });
  }, [cases, selectedRange, view, project, department, projectAccess]);

  const overall = useMemo(
    () =>
      computeMetrics(
        scoped,
        hw,
        view === "projects" && project ? project : null,
      ),
    [scoped, hw, view, project],
  );

  const byProject = useMemo(
    () =>
      projects.map((name) => {
        const rows = scoped.filter((r) => r.project === name);
        const metrics = computeMetrics(rows, hw, name);
        return { name, metrics, score: scoreOf(metrics) };
      }),
    [projects, scoped, hw],
  );

  const ranked = useMemo(
    () => [...byProject].sort((a, b) => b.score - a.score),
    [byProject],
  );

  const monthCount = nowDate.getMonth() + 1;
  const monthLabels = MON3.slice(0, monthCount);

  const monthlyTrend = useMemo(() => {
    const onTime: number[] = [];
    const closure: number[] = [];
    for (let i = 0; i < monthCount; i += 1) {
      const a = new Date(year, i, 1).getTime();
      const b = Math.min(new Date(year, i + 1, 1).getTime() - 1, nowMs);
      const rs = cases.filter(
        (r) =>
          r.record_type !== "itqan" &&
          rowAllowedForProjects(r.project, projectAccess) &&
          inPeriod(r, a, b) &&
          (view !== "projects" || !project || r.project === project) &&
          (view !== "departments" || !department || r.department === department),
      );
      const done = rs.filter(isDone);
      onTime.push(pct(done.filter(isOnTime).length, done.length));
      closure.push(pct(rs.filter((r) => r.status === "closed").length, rs.length));
    }
    return { onTime, closure };
  }, [cases, monthCount, year, nowMs, view, project, department, projectAccess]);

  const heat = useMemo(() => {
    const rows = projects.map((name) => {
      const counts = Array.from({ length: monthCount }, (_, i) => {
        const a = new Date(year, i, 1).getTime();
        const b = Math.min(new Date(year, i + 1, 1).getTime() - 1, nowMs);
        return cases.filter(
          (r) =>
            (r.record_type === "dashcam" || r.record_type === "speed") &&
            r.project === name &&
            inPeriod(r, a, b) &&
            (view !== "projects" || !project || r.project === project) &&
            (view !== "departments" || !department || r.department === department),
        ).length;
      });
      return { name, counts };
    });
    const max = Math.max(1, ...rows.flatMap((r) => r.counts));
    return { rows, max };
  }, [projects, monthCount, year, nowMs, cases, view, project, department]);

  const offenders = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of scoped) {
      if (row.record_type !== "dashcam" && row.record_type !== "speed") continue;
      const driver = caseField(row, "driver_name") || "Unknown";
      const badge = caseField(row, "driver_badge_number") || "—";
      const key = `${driver} · ${badge}`;
      map.set(key, (map.get(key) || 0) + 1);
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([label, value]) => ({ label, value }));
  }, [scoped]);

  const leadLag = useMemo(() => {
    const weeks: Array<{ label: string; a: number; b: number }> = [];
    const cursor = weekStart(nowDate);
    for (let i = 0; i < 12; i += 1) {
      const start = new Date(cursor);
      start.setDate(cursor.getDate() - 7 * (11 - i));
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      const weekNo =
        Math.floor(
          (start.getTime() - weekStart(new Date(start.getFullYear(), 0, 1)).getTime()) /
            (7 * DAY_MS),
        ) + 1;
      weeks.push({
        label: `W${weekNo}`,
        a: start.getTime(),
        b: Math.min(end.getTime(), nowMs),
      });
    }
    return {
      labels: weeks.map((w) => w.label),
      observations: weeks.map(
        (w) =>
          cases.filter(
            (r) =>
              r.record_type === "ai_camera" &&
              inPeriod(r, w.a, w.b) &&
              (view !== "projects" || !project || r.project === project),
          ).length,
      ),
      violations: weeks.map(
        (w) =>
          cases.filter(
            (r) =>
              (r.record_type === "dashcam" || r.record_type === "speed") &&
              inPeriod(r, w.a, w.b) &&
              (view !== "projects" || !project || r.project === project),
          ).length,
      ),
    };
  }, [cases, nowDate, nowMs, view, project]);

  type TargetCard = {
    title: string;
    value: string;
    target: number;
    raw: number;
    hint: string;
    targetLabel: string;
    inverted?: boolean;
  };

  const targets = useMemo((): TargetCard[] => {
    const overdueScore = overall.od === 0 ? 100 : Math.max(0, 100 - overall.od);
    return [
      {
        title: "Close-out on time",
        value: `${overall.sla}%`,
        target: 95,
        raw: overall.sla,
        hint: "% of close-outs within the risk deadline",
        targetLabel: "Target 95%",
      },
      {
        title: "Closure rate",
        value: `${overall.closure}%`,
        target: 90,
        raw: overall.closure,
        hint: "records closed in the period",
        targetLabel: "Target 90%",
      },
      {
        title: "ITQAN upload compliance",
        value: `${overall.itq}%`,
        target: 98,
        raw: overall.itq,
        hint: "confirmed violations uploaded",
        targetLabel: "Target 98%",
      },
      {
        title: "SafeLife update rate",
        value: `${overall.sl}%`,
        target: 95,
        raw: overall.sl,
        hint: "AI observations updated in SafeLife",
        targetLabel: "Target 95%",
      },
      {
        title: "Positive observations",
        value: `${overall.pos}%`,
        target: 10,
        raw: overall.pos,
        hint: "share of AI observations (leading indicator)",
        targetLabel: "Target 10%+",
      },
      {
        title: "Overdue open items",
        value: fmtN(overall.od),
        target: 0,
        raw: overdueScore,
        hint: "past the deadline now",
        targetLabel: "Target 0",
        inverted: true,
      },
    ];
  }, [overall]);

  if (loading) return <p className="state">Loading KPI dashboard…</p>;
  if (error) return <p className="state error">{error}</p>;

  return (
    <section className="page v1-dash kpi-dash">
      <section className="v1-banner">
        <div className="v1-banner-icon">
          <KpiIcon />
        </div>
        <div className="v1-banner-copy">
          <h1>
            EXECUTIVE <em>KPI {year}</em>
          </h1>
          <p>
            Analyse <i>•</i> Compare <i>•</i> Decide
          </p>
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
              {departmentList.items.map((d) => (
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
          <b>{selectedRange.label}</b>
          <span>
            {selectedRange.cmp
              ? `Compared with ${selectedRange.cmp}`
              : "Compared month by month"}
          </span>
        </div>
      </div>

      <div className="v1-grid g6">
        {targets.map((card) => {
          const tone = rag(card.raw, card.target, Boolean(card.inverted));
          const width = card.inverted
            ? card.raw
            : Math.min(100, (card.raw / Math.max(card.target, 1)) * 100);
          return (
            <article className="v1-kpi" key={card.title}>
              <div className="t">
                {card.title}
                <span className={`tagx ${tone}`} style={{ marginLeft: "auto" }}>
                  {ragLabel(tone)}
                </span>
              </div>
              <div className="v">{card.value}</div>
              <div className="s kpi-metric-hint">{card.hint}</div>
              <div className="kpi-metric-foot">
                <div className="progress">
                  <i
                    style={{
                      width: `${width}%`,
                      background:
                        tone === "green"
                          ? "var(--green)"
                          : tone === "amber"
                            ? "var(--amber)"
                            : "var(--red)",
                    }}
                  />
                </div>
                <div className="s">{card.targetLabel}</div>
              </div>
            </article>
          );
        })}
      </div>

      <div className="v1-grid g4">
        <article className="v1-kpi">
          <div className="t">
            <span className="ic">
              <MiniIcon name="clock" />
            </span>
            Average close-out time
          </div>
          <div className="v">{fmtDur(overall.closeT)}</div>
          <div className="s">registration to close-out</div>
        </article>
        <article className="v1-kpi">
          <div className="t">
            <span className="ic">
              <MiniIcon name="gps" />
            </span>
            Violations per 100 GPS vehicles
          </div>
          <div className="v">{overall.vp100}</div>
          <div className="s">Dashcam + Speed + ROW, per 100 tracked vehicles</div>
        </article>
        <article className="v1-kpi">
          <div className="t">
            <span className="ic">
              <MiniIcon name="cam" />
            </span>
            Observations per AI camera
          </div>
          <div className="v">{overall.perCam}</div>
          <div className="s">AI Camera observations ÷ cameras deployed</div>
        </article>
        <article className="v1-kpi">
          <div className="t">
            <span className="ic">
              <MiniIcon name="report" />
            </span>
            Records in period
          </div>
          <div className="v">{fmtN(overall.n)}</div>
          <div className="s">{selectedRange.label}</div>
        </article>
      </div>

      <article className="v1-card">
        <div className="hd">
          <div>
            <h3>Project scorecard</h3>
            <p className="sub">
              Score = on-time 35% · closure 25% · ITQAN 15% · SafeLife 10% · overdue 15%
            </p>
          </div>
        </div>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Project</th>
                <th className="n">Records</th>
                <th className="n">On time</th>
                <th className="n">Closure</th>
                <th className="n">Avg close-out</th>
                <th className="n">Overdue</th>
                <th className="n">ITQAN</th>
                <th className="n">SafeLife</th>
                <th className="n">Viol./100 veh.</th>
                <th className="n">Score</th>
                <th>Rating</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((row, i) => (
                <tr key={row.name}>
                  <td>
                    <b className="mono">#{i + 1}</b>
                  </td>
                  <td>
                    <b>{row.name}</b>
                  </td>
                  <td className="n">{fmtN(row.metrics.n)}</td>
                  <td className="n">{row.metrics.sla}%</td>
                  <td className="n">{row.metrics.closure}%</td>
                  <td className="n">{fmtDur(row.metrics.closeT)}</td>
                  <td className="n">{row.metrics.od}</td>
                  <td className="n">{row.metrics.itq}%</td>
                  <td className="n">{row.metrics.sl}%</td>
                  <td className="n">{row.metrics.vp100}</td>
                  <td className="n">
                    <b>{row.score}</b>
                  </td>
                  <td>
                    <span
                      className={`tagx ${
                        row.score >= 85 ? "green" : row.score >= 70 ? "amber" : "red"
                      }`}
                    >
                      {row.score >= 85
                        ? "Strong"
                        : row.score >= 70
                          ? "Needs attention"
                          : "At risk"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      <div className="v1-grid g2 kpi-charts-row">
        <article className="v1-card kpi-chart-card">
          <div className="hd">
            <div>
              <h3>Project comparison</h3>
              <p className="sub">Each axis is 0–100, higher is better</p>
            </div>
          </div>
          <RadarChart
            projects={byProject.map((p) => p.name)}
            series={byProject.map((p) => [
              p.metrics.sla,
              p.metrics.closure,
              p.metrics.itq,
              p.metrics.sl,
              Math.max(0, 100 - p.metrics.od * 4),
            ])}
          />
        </article>
        <article className="v1-card kpi-chart-card">
          <div className="hd">
            <div>
              <h3>Monthly performance trend</h3>
              <p className="sub">On-time close-out and closure rate per month</p>
            </div>
          </div>
          <TrendChart
            labels={monthLabels}
            onTime={monthlyTrend.onTime}
            closure={monthlyTrend.closure}
          />
        </article>
      </div>

      <div className="v1-grid g2">
        <article className="v1-card">
          <div className="hd">
            <div>
              <h3>Violations heat map by month and project</h3>
              <p className="sub">Dashcam, Speed and ROW violations</p>
            </div>
          </div>
          <div className="table-wrap kpi-heat-wrap">
            <table className="tbl kpi-heat">
              <thead>
                <tr>
                  <th>Project</th>
                  {monthLabels.map((m) => (
                    <th className="n" key={m}>
                      {m}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heat.rows.map((row) => (
                  <tr key={row.name}>
                    <td>
                      <b>{row.name}</b>
                    </td>
                    {row.counts.map((v, i) => {
                      const h = v / heat.max;
                      return (
                        <td
                          className="n heat"
                          key={`${row.name}-${i}`}
                          style={
                            {
                              "--h": h.toFixed(2),
                              color: h > 0.55 ? "#fff" : undefined,
                            } as CSSProperties
                          }
                        >
                          <span>{v}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
        <article className="v1-card">
          <div className="hd">
            <div>
              <h3>Repeat offenders</h3>
              <p className="sub">
                Drivers with the most violations in the period, for coaching and HR follow-up
              </p>
            </div>
          </div>
          <OffenderBars items={offenders} />
        </article>
      </div>

      <article className="v1-card">
        <div className="hd">
          <div>
            <h3>Leading vs lagging indicators</h3>
            <p className="sub">
              Observations raised (leading) against violations recorded (lagging), by week
            </p>
          </div>
        </div>
        <LeadLagChart
          labels={leadLag.labels}
          observations={leadLag.observations}
          violations={leadLag.violations}
        />
      </article>
    </section>
  );
}
