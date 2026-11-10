import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchWeatherDayMaxes,
  fetchWeatherHourly,
  fetchWeatherWeeklyLogs,
  fetchWeatherWeeklyPreview,
  saveWeatherHourly,
  submitWeatherWeekly,
  type WeatherDayMaxDto,
  type WeatherHourlyTable,
  type WeatherWeeklyLogDto,
} from "../api/scc";
import { useAuth } from "../auth/AuthContext";
import { bannerYear, formatUserLabel } from "./shared";
import {
  heatCategory,
  isoDate,
  sundayWeekBounds,
  sundayWeekParts,
  weatherPeriodRange,
  WEATHER_DAY_HOURS,
  WEATHER_PROJECTS,
  WEATHER_STATIONS,
  type HourlyWeatherRow,
  type WeatherPeriodId,
  type WeatherStation,
  type WeeklyWeatherLog,
} from "../lib/weatherReport";
import heatIndexChart from "../assets/heat-index-chart.png";
import heatIndexCategories from "../assets/heat-index-categories.png";
import { useChartReveal } from "../lib/useChartReveal";
import { useProjectAccess } from "../lib/useProjectAccess";
import { ChartTip, tipFromEvent, type ChartTipData } from "./chartTip";

function asWeeklyLog(dto: WeatherWeeklyLogDto): WeeklyWeatherLog {
  return {
    id: dto.id,
    project: dto.project,
    week: dto.week,
    weekStartIso: dto.weekStartIso,
    weekEndIso: dto.weekEndIso,
    weekLabel: dto.weekLabel,
    location: dto.location,
    stationCount: dto.stationCount,
    hoursLogged: dto.hoursLogged,
    hoursExpected: dto.hoursExpected,
    maxTemp: dto.maxTemp,
    maxHumidity: dto.maxHumidity,
    maxHeatIndex: dto.maxHeatIndex,
    highestCategory: dto.highestCategory,
    submittedBy: dto.submittedBy,
    submittedAtLabel: dto.submittedAtLabel,
    remarks: dto.remarks,
    daysByStation: dto.daysByStation,
  };
}

function cellToHourly(cell: {
  hour: number;
  timeLabel: string;
  status: "ok" | "missing" | "upcoming";
  wind?: number;
  temp?: number;
  rh?: number;
  co2?: number;
  pm25?: number;
  pm10?: number;
  heatIndex?: number;
  category?: { level: number; name: string; prevention: string };
  remarks?: string;
  loggedBy?: string | null;
}): HourlyWeatherRow {
  return {
    hour: cell.hour,
    timeLabel: cell.timeLabel,
    status: cell.status,
    wind: cell.wind,
    temp: cell.temp,
    rh: cell.rh,
    co2: cell.co2,
    pm25: cell.pm25,
    pm10: cell.pm10,
    heatIndex: cell.heatIndex,
    category: cell.category,
    remarks: cell.remarks,
    loggedBy: cell.loggedBy || undefined,
  };
}

type TabId = "dash" | "log" | "weekly";

const MON3 = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Current week + the previous 3 — never more than 4 choices in the weekly log dropdown. */
const WEEKLY_LOG_WEEK_CHOICES = 4;

function buildWeeklyLogWeekOptions(ref: Date = new Date()) {
  const { start } = sundayWeekBounds(ref);
  return Array.from({ length: WEEKLY_LOG_WEEK_CHOICES }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() - i * 7);
    const { week } = sundayWeekParts(d);
    const mon = MONTHS[d.getMonth()];
    return {
      startIso: isoDate(d),
      label: `Week ${week} · ${d.getDate()} ${mon}${i === 0 ? " (in progress)" : ""}`,
    };
  });
}
const CAT_NAMES = ["Normal", "Caution", "Extreme Caution", "Danger", "Extreme Danger"] as const;
const CAT_COLORS = ["#A9A6A3", "#5FA86B", "#E9CF6A", "#F0A04B", "#C8102E"];
const PROJECT_COLORS = ["#C8102E", "#8B8A8F", "#E9CF6A", "#A67C52"];
const STATION_COLORS = ["#C8102E", "#8B8A8F", "#E9CF6A", "#A67C52", "#6B8E3D"];

const HEAT_INDEX_GUIDE = [
  {
    roman: "IV",
    level: 4,
    name: "Extreme Danger",
    range: "≥ 52",
    symptoms: "Heat stroke imminent.",
    workRest: "20:10",
    water: "1 cup every 10 minutes",
    controls: "See Sec. 13.4.2(F) for progressive controls",
  },
  {
    roman: "III",
    level: 3,
    name: "Danger",
    range: "39–51",
    symptoms:
      "Heat cramps, heat exhaustion or heat stroke likely with prolonged exposure and physical activity.",
    workRest: "30:10",
    water: "1 cup every 15 minutes",
    controls: "Work under shade",
  },
  {
    roman: "II",
    level: 2,
    name: "Extreme Caution",
    range: "30–38",
    symptoms:
      "Heat cramps, heat exhaustion or heat stroke possible with prolonged exposure and physical activity.",
    workRest: "50:10",
    water: "1 cup every 20 minutes",
    controls: "No working alone (buddy system)",
  },
  {
    roman: "I",
    level: 1,
    name: "Caution",
    range: "25–29",
    symptoms: "Fatigue possible with prolonged exposure and/or physical activity.",
    workRest: "Normal / scheduled",
    water: "1 cup every 20 minutes",
    controls: "Visual monitoring of workers in direct sun and heavy work",
  },
] as const;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function fmtDate(isoOrMs: string | number) {
  const d =
    typeof isoOrMs === "number"
      ? new Date(isoOrMs)
      : new Date(`${String(isoOrMs).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(isoOrMs);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function hiColor(level: number) {
  return level >= 3 ? "var(--red)" : "var(--ink)";
}

function calcHeatIndex(temp: number, rh: number) {
  return (
    Math.round(
      (temp +
        (rh > 40 ? (rh - 40) * 0.08 : 0) +
        (temp > 32 ? (temp - 32) * 0.35 : 0)) *
        10,
    ) / 10
  );
}

function WeatherIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="10" r="3.2" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 3.5v1.6M12 14.8v1.6M5.8 10H4.2M19.8 10h-1.6M7.2 5.2l1.1 1.1M15.7 13.7l1.1 1.1M16.8 5.2l-1.1 1.1M8.3 13.7l-1.1 1.1"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M7 18.5c1.2-1.4 2.8-2.1 5-2.1s3.8.7 5 2.1"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Gauge({ value, max = 60 }: { value: number; max?: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<ChartTipData | null>(null);
  const reveal = useChartReveal(hostRef, `${value}|${max}`);
  const clamped = Math.max(0, Math.min(max, value));
  const pct = max > 0 ? clamped / max : 0;
  const r = 54;
  const cx = 70;
  const cy = 72;
  const arc = Math.PI * r;
  const fill = arc * pct;
  const cat = heatCategory(value);
  const stroke = cat.level >= 3 ? "#C8102E" : cat.level >= 2 ? "#F0A04B" : "#8B8A8F";
  const track = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  const label = value ? value.toFixed(1) : "—";
  return (
    <div className="v1-chart-host wx-gauge-host" ref={hostRef} onMouseLeave={() => setTip(null)}>
      <svg viewBox="0 0 140 110" className="wx-gauge" role="img" aria-label={`Heat index ${value}`}>
        <path
          d={track}
          fill="none"
          stroke="var(--line)"
          strokeWidth="12"
          strokeLinecap="round"
          pointerEvents="none"
        />
        {pct > 0.001 ? (
          <path
            d={track}
            fill="none"
            stroke={stroke}
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={`${fill * reveal} ${arc}`}
            style={{ cursor: "pointer" }}
            onMouseMove={(e) =>
              setTip(
                tipFromEvent(e, hostRef.current, {
                  title: "Heat index",
                  rows: [
                    { color: stroke, text: `${label} · ${cat.name}` },
                  ],
                }),
              )
            }
            onMouseLeave={() => setTip(null)}
          />
        ) : null}
        <text x={cx} y={cy - 10} textAnchor="middle" className="wx-gauge-val" pointerEvents="none">
          {label}
        </text>
        <text x={cx - r} y={cy + 26} textAnchor="middle" className="wx-gauge-tick" pointerEvents="none">
          0
        </text>
        <text x={cx + r} y={cy + 26} textAnchor="middle" className="wx-gauge-tick" pointerEvents="none">
          {max}
        </text>
      </svg>
      <ChartTip tip={tip} />
    </div>
  );
}

function BarChart({
  labels,
  values,
  colors,
  height = 180,
  yMax,
}: {
  labels: string[];
  values: number[];
  colors: string[];
  height?: number;
  yMax?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<ChartTipData | null>(null);
  const reveal = useChartReveal(hostRef, `${labels.join("|")}|${values.join(",")}`);
  const w = 360;
  const padL = 28;
  const padR = 8;
  const padT = 12;
  const padB = 36;
  const max = Math.max(yMax ?? 0, ...values, 1);
  const innerW = w - padL - padR;
  const innerH = height - padT - padB;
  const n = Math.max(labels.length, 1);
  const slot = innerW / n;
  const barW = Math.min(44, Math.max(14, slot * 0.48));
  const baseY = padT + innerH;
  return (
    <div className="v1-chart-host" ref={hostRef} onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${w} ${height}`} className="wx-chart" role="img">
        {[0, 0.25, 0.5, 0.75, 1].map((p) => {
          const y = padT + innerH * (1 - p);
          return (
            <g key={p}>
              <line x1={padL} y1={y} x2={w - padR} y2={y} className="wx-chart-grid" />
              <text x={padL - 6} y={y + 3} textAnchor="end" className="wx-chart-tick">
                {Math.round(max * p)}
              </text>
            </g>
          );
        })}
        {labels.map((label, i) => {
          const slotX = padL + i * slot;
          const x = slotX + (slot - barW) / 2;
          const h = (values[i] / max) * innerH * reveal;
          const y = baseY - h;
          const short = label.split(" ")[0];
          const color = colors[i] || colors[0];
          const value = values[i] || 0;
          return (
            <g key={label}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(h, 0)}
                rx={5}
                fill={color}
                style={{ cursor: value > 0 ? "pointer" : "default" }}
                onMouseMove={
                  value > 0
                    ? (e) =>
                        setTip(
                          tipFromEvent(e, hostRef.current, {
                            title: label,
                            rows: [{ color, text: String(value) }],
                          }),
                        )
                    : undefined
                }
                onMouseLeave={() => setTip(null)}
              />
              <text
                x={slotX + slot / 2}
                y={height - 12}
                textAnchor="middle"
                className="wx-chart-label"
                pointerEvents="none"
              >
                {short}
              </text>
            </g>
          );
        })}
      </svg>
      <ChartTip tip={tip} />
    </div>
  );
}

function shortStationLabel(label: string) {
  if (label === "Tank Farm Gate") return "Tank Farm";
  if (label === "Pump Station 2") return "Pump Station";
  return label;
}

function GroupedBarChart({
  labels,
  series,
  height = 250,
}: {
  labels: string[];
  series: Array<{ label: string; values: number[]; color: string }>;
  height?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<ChartTipData | null>(null);
  const reveal = useChartReveal(
    hostRef,
    `${labels.join("|")}|${series.map((s) => `${s.label}:${s.values.join(",")}`).join(";")}`,
  );
  const w = 420;
  const padL = 28;
  const padR = 8;
  const padT = 12;
  const padB = 48;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const innerW = w - padL - padR;
  const innerH = height - padT - padB;
  const n = Math.max(labels.length, 1);
  const groupW = innerW / n;
  const baseY = padT + innerH;
  // V1 Chart.js look: slender bars, tight pair, wide gap between stations.
  const barW = Math.min(14, Math.max(10, groupW * 0.16));
  const pairGap = 2;
  const pairW = series.length * barW + Math.max(0, series.length - 1) * pairGap;
  return (
    <div
      className="wx-chart-block v1-chart-host"
      ref={hostRef}
      onMouseLeave={() => setTip(null)}
    >
      <svg viewBox={`0 0 ${w} ${height}`} className="wx-chart" role="img">
        {[0, 0.25, 0.5, 0.75, 1].map((p) => {
          const y = padT + innerH * (1 - p);
          return (
            <g key={p}>
              <line x1={padL} y1={y} x2={w - padR} y2={y} className="wx-chart-grid" />
              <text x={padL - 6} y={y + 3} textAnchor="end" className="wx-chart-tick">
                {Math.round(max * p)}
              </text>
            </g>
          );
        })}
        {labels.map((label, i) => {
          const slotX = padL + i * groupW;
          const gx = slotX + (groupW - pairW) / 2;
          return (
            <g key={label}>
              {series.map((s, si) => {
                const value = s.values[i] || 0;
                const h = (value / max) * innerH * reveal;
                const x = gx + si * (barW + pairGap);
                const y = baseY - h;
                return (
                  <rect
                    key={s.label}
                    x={x}
                    y={y}
                    width={barW}
                    height={Math.max(h, 0)}
                    rx={2}
                    fill={s.color}
                    style={{ cursor: value > 0 ? "pointer" : "default" }}
                    onMouseMove={
                      value > 0
                        ? (e) =>
                            setTip(
                              tipFromEvent(e, hostRef.current, {
                                title: label,
                                rows: series.map((row) => ({
                                  color: row.color,
                                  text: `${row.label}: ${row.values[i] || 0}`,
                                })),
                              }),
                            )
                        : undefined
                    }
                    onMouseLeave={() => setTip(null)}
                  />
                );
              })}
              <text
                x={slotX + groupW / 2}
                y={height - 28}
                textAnchor="middle"
                className="wx-chart-label"
                pointerEvents="none"
              >
                {shortStationLabel(label)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="wx-legend">
        {series.map((s) => (
          <span key={s.label}>
            <i style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <ChartTip tip={tip} />
    </div>
  );
}

function MultiLineChart({
  labels,
  series,
  height = 220,
  yMin,
  fillWidth = false,
}: {
  labels: string[];
  series: Array<{
    label: string;
    values: Array<number | null>;
    color: string;
    dashed?: boolean;
    hideLegend?: boolean;
  }>;
  height?: number;
  yMin?: number;
  fillWidth?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<ChartTipData | null>(null);
  const reveal = useChartReveal(
    hostRef,
    `${labels.join("|")}|${series.map((s) => `${s.label}:${s.values.join(",")}`).join(";")}`,
  );
  const w = fillWidth ? 960 : 520;
  const padL = 36;
  const padR = 14;
  const padT = 14;
  const padB = 36;
  const nums = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  const max = Math.max(1, ...nums);
  const min = yMin ?? Math.min(...nums, max - 1);
  const span = Math.max(1, max - min);
  const innerW = w - padL - padR;
  const innerH = height - padT - padB;
  const baseY = padT + innerH;
  const xAt = (i: number) =>
    padL + (labels.length <= 1 ? innerW / 2 : (i / (labels.length - 1)) * innerW);
  const yAt = (v: number) => padT + innerH * (1 - (v - min) / span);
  const yAtReveal = (v: number) => baseY - (baseY - yAt(v)) * reveal;

  function pathFor(values: Array<number | null>) {
    let d = "";
    let drawing = false;
    values.forEach((v, i) => {
      if (v == null) {
        drawing = false;
        return;
      }
      d += `${drawing ? "L" : "M"}${xAt(i)},${yAtReveal(v)} `;
      drawing = true;
    });
    return d.trim();
  }

  function showTip(
    e: { clientX: number; clientY: number },
    index: number,
  ) {
    setTip(
      tipFromEvent(e, hostRef.current, {
        title: labels[index] || "",
        rows: series
          .filter((s) => s.values[index] != null)
          .map((s) => ({
            color: s.color,
            text: `${s.label}: ${s.values[index]}`,
          })),
      }),
    );
  }

  return (
    <div
      className={`wx-chart-block v1-chart-host${fillWidth ? " is-fill" : ""}`}
      ref={hostRef}
      onMouseLeave={() => setTip(null)}
    >
      <svg
        viewBox={`0 0 ${w} ${height}`}
        className={`wx-chart${fillWidth ? " is-fill" : ""}`}
        preserveAspectRatio={fillWidth ? "none" : "xMidYMid meet"}
        role="img"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((p) => {
          const y = padT + innerH * (1 - p);
          return (
            <g key={p}>
              <line x1={padL} y1={y} x2={w - padR} y2={y} className="wx-chart-grid" />
              <text x={padL - 6} y={y + 3} textAnchor="end" className="wx-chart-tick">
                {Math.round(min + span * p)}
              </text>
            </g>
          );
        })}
        {series.map((s) => (
          <g key={s.label}>
            <path
              d={pathFor(s.values)}
              fill="none"
              stroke={s.color}
              strokeWidth={s.dashed ? 1.5 : 2}
              strokeDasharray={s.dashed ? "5 4" : undefined}
              strokeLinejoin="round"
              strokeLinecap="round"
              pointerEvents="none"
            />
            {s.values.map((v, i) =>
              v == null ? null : (
                <circle
                  key={`${s.label}-${i}`}
                  cx={xAt(i)}
                  cy={yAtReveal(v)}
                  r={fillWidth ? 3.2 : 2.4}
                  fill={s.color}
                  stroke="var(--surface)"
                  strokeWidth={1.2}
                  style={{ cursor: "pointer" }}
                  onMouseMove={(e) => showTip(e, i)}
                  onMouseLeave={() => setTip(null)}
                />
              ),
            )}
          </g>
        ))}
        {labels.map((label, i) => (
          <text
            key={label}
            x={xAt(i)}
            y={height - 10}
            textAnchor="middle"
            className="wx-chart-label"
            pointerEvents="none"
          >
            {label}
          </text>
        ))}
      </svg>
      <div className="wx-legend">
        {series
          .filter((s) => !s.hideLegend)
          .map((s) => (
            <span key={s.label}>
              <i style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
      </div>
      <ChartTip tip={tip} />
    </div>
  );
}

function WeekTable({ log }: { log: WeeklyWeatherLog }) {
  return (
    <>
      {log.daysByStation.map((station) => (
        <div className="wx-week-wrap" key={station.location}>
          <table className="wx-week-table">
            <colgroup>
              <col className="wx-c-loc" />
              <col className="wx-c-proj" />
              <col className="wx-c-week" />
              <col className="wx-c-date" />
              <col className="wx-c-num" />
              <col className="wx-c-num" />
              <col className="wx-c-num" />
              <col className="wx-c-num" />
              <col className="wx-c-num" />
              <col className="wx-c-hi" />
              <col className="wx-c-cat" />
            </colgroup>
            <thead>
              <tr>
                <th>Location</th>
                <th>Project</th>
                <th>Week</th>
                <th>Date</th>
                <th className="th-wind">
                  Wind speed
                  <br />
                  (m/s)
                </th>
                <th className="th-temp">
                  Temperature
                  <br />
                  (°C)
                </th>
                <th className="th-rh">
                  Relative humidity
                  <br />
                  (%)
                </th>
                <th className="th-co2">
                  CO2 (PPM)
                  <br />
                  Highest
                </th>
                <th className="th-pm">
                  PM10
                  <br />
                  Highest
                </th>
                <th className="th-hi">Heat Index</th>
                <th className="th-rem">Category / prevention</th>
              </tr>
            </thead>
            <tbody>
              {station.days.map((day, index) => (
                <tr key={day.dateIso}>
                  {index === 0 ? (
                    <>
                      <td rowSpan={station.days.length}>{station.location}</td>
                      <td rowSpan={station.days.length}>{log.project}</td>
                      <td rowSpan={station.days.length}>Week {log.week}</td>
                    </>
                  ) : null}
                  <td>{day.dayLabel}</td>
                  {day.hoursLogged > 0 ? (
                    <>
                      <td className="mono">{day.wind}</td>
                      <td className="mono">{day.temp}</td>
                      <td className="mono">{day.rh}</td>
                      <td className="mono">{day.co2}</td>
                      <td className="mono">{day.pm10}</td>
                      <td className={`mono hi-cell c${day.category.level}`}>{day.heatIndex}</td>
                      <td className="cat-cell">
                        <span className={`hicat c${day.category.level}`}>{day.category.name}</span>
                        <span className="cat-prev">{day.category.prevention}</span>
                      </td>
                    </>
                  ) : (
                    <td colSpan={7} className="muted">
                      No readings logged
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}

function WeeklyLogDrawer({
  log,
  onClose,
  mode,
  remarks,
  onRemarks,
  onSubmit,
  projects,
  weekOptions,
  onProjectChange,
  onWeekChange,
}: {
  log: WeeklyWeatherLog;
  onClose: () => void;
  mode: "view" | "submit";
  remarks: string;
  onRemarks: (v: string) => void;
  onSubmit?: () => void;
  projects?: string[];
  weekOptions?: Array<{ startIso: string; label: string }>;
  onProjectChange?: (project: string) => void;
  onWeekChange?: (weekStartIso: string) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const complete = log.hoursLogged >= log.hoursExpected && log.hoursExpected > 0;

  return (
    <div
      className="scrim"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="drawer drawer-page drawer-record wx-weekly-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={mode === "submit" ? "Log weekly weather data" : `Weekly weather log ${log.id}`}
      >
        <div className="drawer-hd wx-weekly-hd">
          <div>
            <div className="sub">
              {mode === "submit"
                ? "Weather Monitoring"
                : `${log.id} · submitted by ${log.submittedBy}, ${log.submittedAtLabel}`}
            </div>
            <h2>
              {mode === "submit"
                ? "Log weekly weather data"
                : `Weekly weather log · ${log.project} · Week ${log.week}`}
            </h2>
          </div>
          <button type="button" className="iconbtn" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="drawer-body wx-weekly-body">
          {mode === "submit" ? (
            <div className="wx-weekly-filters">
              <div className="grp">
                <label className="k" htmlFor="wx-ww-project">
                  Project
                </label>
                <select
                  id="wx-ww-project"
                  className="sel"
                  value={log.project}
                  onChange={(e) => onProjectChange?.(e.target.value)}
                >
                  {(projects || [log.project]).map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grp">
                <label className="k" htmlFor="wx-ww-week">
                  Week
                </label>
                <select
                  id="wx-ww-week"
                  className="sel"
                  value={log.weekStartIso}
                  onChange={(e) => onWeekChange?.(e.target.value)}
                >
                  {(weekOptions || [{ startIso: log.weekStartIso, label: log.weekLabel }]).map(
                    (w) => (
                      <option key={w.startIso} value={w.startIso}>
                        {w.label}
                      </option>
                    ),
                  )}
                </select>
              </div>
              <div className="range">
                Compiled automatically from the hourly log
                <br />
                Highest reading of each day
              </div>
            </div>
          ) : null}

          <WeekTable log={log} />

          {mode === "submit" ? (
            <div className="wx-weekly-form">
              <label className="wx-field">
                <span>Remarks / corrective actions</span>
                <textarea
                  value={remarks}
                  onChange={(e) => onRemarks(e.target.value)}
                  placeholder="Heat stress controls, dust events, missing readings"
                  rows={2}
                />
              </label>
              <label className="wx-field">
                <span>Submitted by</span>
                <input value={log.submittedBy} readOnly />
              </label>
            </div>
          ) : log.remarks ? (
            <p className="wx-remarks-note">
              <b>Remarks / corrective actions:</b> {log.remarks}
            </p>
          ) : null}
        </div>

        <div className="drawer-ft wx-weekly-ft">
          <p className={`wx-weekly-msg${complete ? " ok" : ""}`}>
            {log.hoursLogged} of {log.hoursExpected} hourly readings logged this week
          </p>
          <div className="register-actions">
            <button type="button" className="btn ghost" onClick={onClose}>
              {mode === "submit" ? "Cancel" : "Close"}
            </button>
            {mode === "submit" && onSubmit ? (
              <button type="button" className="btn primary" onClick={onSubmit}>
                Submit weekly log
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export function WeatherScreen() {
  const { user } = useAuth();
  const canRecordWeather = Boolean(user?.capabilities.record_weather);
  const now = useMemo(() => new Date(), []);
  const year = bannerYear(now);

  const [tab, setTab] = useState<TabId>("dash");
  const [project, setProject] = useState("All");
  const [period, setPeriod] = useState<WeatherPeriodId>("ytd");
  const [category, setCategory] = useState("All");
  const [logProject, setLogProject] = useState<string>(WEATHER_PROJECTS[0]);
  const [logDate, setLogDate] = useState(isoDate(now));
  const [logEdits, setLogEdits] = useState<
    Record<string, Partial<Record<number, Partial<HourlyWeatherRow>>>>
  >({});
  const [dbHourly, setDbHourly] = useState<Record<string, HourlyWeatherRow[]>>({});
  const [weeklyLogs, setWeeklyLogs] = useState<WeeklyWeatherLog[]>([]);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const [viewing, setViewing] = useState<WeeklyWeatherLog | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitProject, setSubmitProject] = useState<string>(WEATHER_PROJECTS[0]);
  const [submitWeekStart, setSubmitWeekStart] = useState("");
  const [submitWeekOptions, setSubmitWeekOptions] = useState(() => buildWeeklyLogWeekOptions());
  const [submitRemarks, setSubmitRemarks] = useState("");
  const [submitPreview, setSubmitPreview] = useState<WeeklyWeatherLog | null>(null);
  const [savingStationId, setSavingStationId] = useState<string | null>(null);
  const [submittingBusy, setSubmittingBusy] = useState(false);
  const [dashDaysRaw, setDashDaysRaw] = useState<WeatherDayMaxDto[]>([]);
  const [dashTodayTables, setDashTodayTables] = useState<WeatherHourlyTable[]>([]);
  const [dashRefreshKey, setDashRefreshKey] = useState(0);

  const { hasAllProjectAccess, accessProjects, singleProject } = useProjectAccess([
    ...WEATHER_PROJECTS,
  ]);

  useEffect(() => {
    if (!accessProjects.includes(logProject)) {
      setLogProject(accessProjects[0] || WEATHER_PROJECTS[0]);
    }
  }, [accessProjects, logProject]);

  useEffect(() => {
    if (singleProject) {
      if (project !== singleProject) setProject(singleProject);
      return;
    }
    if (project !== "All" && !accessProjects.includes(project)) {
      setProject(hasAllProjectAccess || accessProjects.length > 1 ? "All" : accessProjects[0] || "All");
    }
  }, [accessProjects, project, hasAllProjectAccess, singleProject]);

  const range = useMemo(() => weatherPeriodRange(period, now), [period, now]);
  const todayIso = isoDate(now);
  const rangeFromIso = isoDate(range.a);
  const rangeToIso = isoDate(range.b);

  const stations = useMemo(
    () =>
      WEATHER_STATIONS.filter(
        (s) =>
          (project === "All" || s.project === project) &&
          accessProjects.includes(s.project),
      ),
    [project, accessProjects],
  );

  const dashProjects = useMemo(
    () =>
      project === "All" ? accessProjects : accessProjects.filter((p) => p === project),
    [project, accessProjects],
  );

  useEffect(() => {
    if (tab !== "dash") return;
    let cancelled = false;
    async function loadDash() {
      try {
        const [maxes, ...hourly] = await Promise.all([
          fetchWeatherDayMaxes(rangeFromIso, rangeToIso, project === "All" ? undefined : project),
          ...dashProjects.map((p) => fetchWeatherHourly(p, todayIso)),
        ]);
        if (cancelled) return;
        setDashDaysRaw(maxes.items.filter((item) => accessProjects.includes(item.project)));
        setDashTodayTables(
          hourly.flatMap((res) => res.tables).filter((t) => accessProjects.includes(t.project)),
        );
      } catch {
        if (!cancelled) {
          setDashDaysRaw([]);
          setDashTodayTables([]);
        }
      }
    }
    void loadDash();
    return () => {
      cancelled = true;
    };
  }, [
    tab,
    project,
    rangeFromIso,
    rangeToIso,
    todayIso,
    dashProjects.join("|"),
    accessProjects.join("|"),
    dashRefreshKey,
  ]);

  const days = useMemo(() => {
    const stationById = new Map(WEATHER_STATIONS.map((s) => [s.id, s]));
    const raw = dashDaysRaw.map((d) => {
      const station =
        stationById.get(d.stationId) ||
        ({ id: d.stationId, project: d.project, loc: d.location } satisfies WeatherStation);
      return {
        station,
        t: new Date(`${d.dateIso}T00:00:00`).getTime(),
        dateIso: d.dateIso,
        T: d.temp,
        RH: d.rh,
        hi: d.heatIndex,
        wind: d.wind,
        pm25: d.pm25 ?? 0,
        pm10: d.pm10,
        co2: d.co2,
        n: d.hoursLogged,
        category: d.category,
      };
    });
    if (category === "All") return raw;
    return raw.filter((d) => d.category.name === category);
  }, [dashDaysRaw, category]);

  const highestHi = useMemo(() => days.reduce((a, d) => Math.max(a, d.hi), 0), [days]);

  const byProjectHi = useMemo(() => {
    return dashProjects.map((p) => ({
      project: p,
      hi: days.filter((d) => d.station.project === p).reduce((a, d) => Math.max(a, d.hi), 0),
    }));
  }, [days, dashProjects]);

  const catCounts = useMemo(
    () => CAT_NAMES.map((name) => days.filter((d) => d.category.name === name).length),
    [days],
  );

  /** Station cards: today's daily highest from logged hourly rows only. */
  const stationCards = useMemo(() => {
    return stations.flatMap((st) => {
      const table = dashTodayTables.find((t) => t.stationId === st.id);
      const ok = (table?.hours || []).filter((h) => h.status === "ok" && h.heatIndex != null);
      if (!ok.length) return [];
      const heatIndex = Math.max(...ok.map((h) => h.heatIndex ?? 0));
      const temp = Math.max(...ok.map((h) => h.temp ?? 0));
      const rh = Math.max(...ok.map((h) => h.rh ?? 0));
      const wind = Math.max(...ok.map((h) => h.wind ?? 0));
      const pm25 = Math.max(...ok.map((h) => h.pm25 ?? 0));
      const peak = ok.reduce((best, row) =>
        (row.heatIndex ?? 0) >= (best.heatIndex ?? 0) ? row : best,
      );
      const cat = peak.category || heatCategory(heatIndex);
      return [
        {
          station: st,
          heatIndex: Math.round(heatIndex * 10) / 10,
          temp: Math.round(temp * 10) / 10,
          rh,
          wind: Math.round(wind * 10) / 10,
          pm25,
          peakHour: peak.hour,
          category: cat,
        },
      ];
    });
  }, [stations, dashTodayTables]);

  const todayHourly = useMemo(
    () =>
      stations
        .map((st) => {
          const table = dashTodayTables.find((t) => t.stationId === st.id);
          return {
            station: st,
            hours: table?.hours || [],
          };
        })
        .filter((row) => row.hours.some((h) => h.status === "ok")),
    [stations, dashTodayTables],
  );

  const trend = useMemo(() => {
    const months = now.getMonth() + 1;
    return dashProjects.map((p) => ({
      project: p,
      values: Array.from({ length: months }, (_, mi) => {
        let mx = 0;
        for (const d of dashDaysRaw) {
          if (d.project !== p) continue;
          const dt = new Date(`${d.dateIso}T00:00:00`);
          if (dt.getFullYear() === now.getFullYear() && dt.getMonth() === mi) {
            mx = Math.max(mx, d.heatIndex);
          }
        }
        return mx;
      }),
    }));
  }, [dashDaysRaw, dashProjects, now]);

  const observations = useMemo(
    () => [...days].sort((a, b) => b.t - a.t || b.hi - a.hi),
    [days],
  );

  async function reloadWeeklyLogs() {
    try {
      const res = await fetchWeatherWeeklyLogs();
      const allowed = new Set(accessProjects);
      setWeeklyLogs(
        res.items.filter((item) => allowed.has(item.project)).map(asWeeklyLog),
      );
    } catch {
      setWeeklyLogs([]);
    }
  }

  useEffect(() => {
    void reloadWeeklyLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessProjects.join("|")]);

  useEffect(() => {
    let cancelled = false;
    async function loadHourly() {
      try {
        const res = await fetchWeatherHourly(logProject, logDate);
        if (cancelled) return;
        const next: Record<string, HourlyWeatherRow[]> = {};
        for (const table of res.tables) {
          next[table.stationId] = table.hours.map(cellToHourly);
        }
        setDbHourly(next);
        setLogEdits({});
      } catch {
        if (!cancelled) {
          setDbHourly({});
        }
      }
    }
    void loadHourly();
    return () => {
      cancelled = true;
    };
  }, [logProject, logDate]);

  useEffect(() => {
    if (!submitOpen || !submitWeekStart) {
      setSubmitPreview(null);
      return;
    }
    let cancelled = false;
    async function loadPreview() {
      try {
        const dto = await fetchWeatherWeeklyPreview(submitProject, submitWeekStart);
        if (cancelled) return;
        setSubmitPreview({
          ...asWeeklyLog(dto),
          submittedBy: formatUserLabel(user) || user?.username || dto.submittedBy || "",
          remarks: submitRemarks || dto.remarks,
        });
      } catch {
        if (!cancelled) setSubmitPreview(null);
      }
    }
    void loadPreview();
    return () => {
      cancelled = true;
    };
  }, [submitOpen, submitWeekStart, submitProject, user, submitRemarks]);

  const submitting = submitPreview;

  const logStations = useMemo(
    () => WEATHER_STATIONS.filter((s) => s.project === logProject),
    [logProject],
  );

  const logDay = useMemo(() => new Date(`${logDate}T00:00:00`), [logDate]);
  const isLogToday = logDate === isoDate(now);
  const logWeek = sundayWeekParts(logDay).week;

  const logProgress = useMemo(() => {
    let filled = 0;
    let expect = 0;
    for (const st of logStations) {
      WEATHER_DAY_HOURS.forEach((hour) => {
        if (!isLogToday || hour <= now.getHours()) {
          expect += 1;
          const edit = logEdits[`${st.id}|${logDate}`]?.[hour];
          const fromDb = dbHourly[st.id]?.find((h) => h.hour === hour);
          const row = { ...(fromDb || {}), ...edit };
          if (
            row.status === "ok" ||
            (edit && (edit.temp != null || edit.rh != null))
          ) {
            filled += 1;
          }
        }
      });
    }
    return { filled, expect };
  }, [logStations, now, isLogToday, logEdits, logDate, dbHourly]);

  function openSubmitDialog() {
    const preferred =
      project !== "All" && accessProjects.includes(project)
        ? project
        : accessProjects[0] || WEATHER_PROJECTS[0];
    if (!accessProjects.includes(preferred)) return;
    // Always rebuild from "now" so the dialog opens on the live current week,
    // with only that week plus the previous 3 in the dropdown.
    const options = buildWeeklyLogWeekOptions(new Date());
    const week = options[0];
    if (!week) return;
    setSubmitWeekOptions(options);
    setSubmitProject(preferred);
    setSubmitWeekStart(week.startIso);
    setSubmitRemarks("");
    setSubmitOpen(true);
  }

  async function saveStationReadings(st: WeatherStation) {
    setSavingStationId(st.id);
    try {
      // Only persist hours that are due. Never convert upcoming → missing,
      // or save unlocks the rest of the day after one reading.
      const currentUser = formatUserLabel(user) || user?.username || "";
      const editKey = `${st.id}|${logDate}`;
      const hourEdits = logEdits[editKey] || {};
      const readings = WEATHER_DAY_HOURS.map((hour) => {
        const row = rowFor(st, hour);
        const touched = hour in hourEdits;
        // Preserve prior logger for untouched hours; stamp current user on edits/new.
        const hourLogger = touched || !row.loggedBy ? currentUser : row.loggedBy;
        return {
          hour,
          wind: row.wind ?? null,
          temp: row.temp ?? null,
          rh: row.rh ?? null,
          co2: row.co2 ?? null,
          pm25: row.pm25 ?? null,
          pm10: row.pm10 ?? null,
          heat_index: row.heatIndex ?? null,
          remarks: row.remarks ?? null,
          status: row.status,
          logged_by: hourLogger || null,
        };
      }).filter((row) => row.status !== "upcoming");
      const res = await saveWeatherHourly({
        station_id: st.id,
        project: st.project,
        location: st.loc,
        observed_on: logDate,
        logged_by: currentUser || undefined,
        readings,
      });
      const next: Record<string, HourlyWeatherRow[]> = { ...dbHourly };
      for (const table of res.tables) {
        next[table.stationId] = table.hours.map(cellToHourly);
      }
      setDbHourly(next);
      setLogEdits((prev) => {
        const copy = { ...prev };
        delete copy[`${st.id}|${logDate}`];
        return copy;
      });
      setSavedFlash(`Saved readings for ${st.loc}`);
      window.setTimeout(() => setSavedFlash(null), 2200);
      setDashRefreshKey((n) => n + 1);
    } catch (err) {
      setSavedFlash(err instanceof Error ? err.message : "Save failed");
      window.setTimeout(() => setSavedFlash(null), 3200);
    } finally {
      setSavingStationId(null);
    }
  }

  function updateLogCell(
    st: WeatherStation,
    hour: number,
    patch: Partial<HourlyWeatherRow>,
  ) {
    const key = `${st.id}|${logDate}`;
    setLogEdits((prev) => {
      const stationEdits = { ...(prev[key] || {}) };
      const current = { ...(stationEdits[hour] || {}) };
      Object.assign(current, patch);
      if (patch.temp != null || patch.rh != null) {
        const base = dbHourly[st.id]?.find((h) => h.hour === hour);
        const temp = patch.temp ?? current.temp ?? base?.temp ?? 0;
        const rh = patch.rh ?? current.rh ?? base?.rh ?? 0;
        const hi = calcHeatIndex(temp, rh);
        current.heatIndex = hi;
        current.category = heatCategory(hi);
        current.status = "ok";
      }
      stationEdits[hour] = current;
      return { ...prev, [key]: stationEdits };
    });
  }

  function rowFor(st: WeatherStation, hour: number): HourlyWeatherRow {
    const timeLabel = `${((hour + 11) % 12) + 1}:00 ${hour >= 12 ? "PM" : "AM"}`;
    // Future hours stay locked even if a bad save left a DB row.
    if ((isLogToday && hour > now.getHours()) || logDate > isoDate(now)) {
      return { hour, timeLabel, status: "upcoming" };
    }
    const fromDb = dbHourly[st.id]?.find((h) => h.hour === hour);
    const base =
      fromDb ||
      ({
        hour,
        timeLabel,
        status: "missing",
      } as HourlyWeatherRow);
    const edit = logEdits[`${st.id}|${logDate}`]?.[hour];
    return edit ? { ...base, ...edit, status: edit.status ?? base.status } : base;
  }

  return (
    <section className="page weather-page weather-v1">
      <section className="v1-banner">
        <div className="v1-banner-icon">
          <WeatherIcon />
        </div>
        <div className="v1-banner-copy">
          <h1>
            WEATHER STATION <em>DASHBOARD {year}</em>
          </h1>
          <p>
            Real-Time Monitoring <i>•</i> Smarter Decisions <i>•</i> Safer Operations
          </p>
        </div>
        {canRecordWeather ? (
          <div className="v1-banner-actions">
            <button type="button" className="btn primary" onClick={openSubmitDialog}>
              Log weekly weather data
            </button>
          </div>
        ) : null}
      </section>

      <div className="reports-tabs wx-tabs">
        {(
          [
            ["dash", "Weather dashboard"],
            ["log", "Hourly log by project"],
            ["weekly", "Weekly weather logs"],
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

      {tab === "dash" ? (
        <>
          <div className="v1-filters">
            <div className="grp">
              <label className="k">Project</label>
              <select
                className="sel"
                value={project}
                onChange={(e) => setProject(e.target.value)}
                disabled={Boolean(singleProject)}
              >
                {hasAllProjectAccess || accessProjects.length > 1 ? (
                  <option value="All">All</option>
                ) : null}
                {accessProjects.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div className="grp">
              <label className="k">Period</label>
              <select
                className="sel"
                value={period}
                onChange={(e) => setPeriod(e.target.value as WeatherPeriodId)}
              >
                <option value="today">Today</option>
                <option value="week">This week</option>
                <option value="lastweek">Last week</option>
                <option value="month">This month</option>
                <option value="lastmonth">Last month</option>
                <option value="ytd">Year to date</option>
              </select>
            </div>
            <div className="grp">
              <label className="k">Category</label>
              <select
                className="sel"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="All">All</option>
                {CAT_NAMES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="range">
              <b>{range.label}</b>
              {stations.length} station{stations.length === 1 ? "" : "s"} · readings 7:00 AM – 2:00
              PM
            </div>
          </div>

          <div className="wx-station-grid">
            {stationCards.length === 0 ? (
              <p className="muted wx-dash-empty">
                No hourly readings logged today. Station cards appear after the hourly log is filled —
                each card shows that station&apos;s highest readings for the day.
              </p>
            ) : (
              stationCards.map((card) => {
                const cat = card.category;
                return (
                  <article className="v1-card wx-station-card" key={card.station.id}>
                    <div className="wx-station-hd">
                      <div>
                        <h3>{card.station.loc}</h3>
                        <p className="sub">
                          {card.station.project} · {card.station.id} · highest today
                          {card.peakHour != null ? ` · peak HI at ${card.peakHour}:00` : ""}
                        </p>
                      </div>
                      <span className={`hicat c${cat.level}`}>{cat.name}</span>
                    </div>
                    <div className="wx-station-body">
                      <div>
                        <small className="muted">Heat index</small>
                        <div className="wx-hi" style={{ color: hiColor(cat.level) }}>
                          {card.heatIndex}°
                        </div>
                      </div>
                      <div className="wx-station-metrics">
                        <div>
                          <small>Temp</small>
                          <b>{card.temp}°C</b>
                        </div>
                        <div>
                          <small>RH</small>
                          <b>{card.rh}%</b>
                        </div>
                        <div>
                          <small>Wind</small>
                          <b>{card.wind}</b> m/s
                        </div>
                        <div>
                          <small>PM2.5</small>
                          <b>{card.pm25}</b>
                        </div>
                      </div>
                    </div>
                    <div className="wx-station-note">{cat.prevention}</div>
                  </article>
                );
              })
            )}
          </div>

          <div className="v1-grid g3">
            <article className="v1-card">
              <h3>Highest heat index</h3>
              <p className="sub">Highest reading in the period</p>
              <Gauge value={highestHi} />
            </article>
            <article className="v1-card">
              <h3>Highest heat index per project</h3>
              <BarChart
                labels={byProjectHi.map((x) => x.project)}
                values={byProjectHi.map((x) => x.hi)}
                colors={byProjectHi.map((x) =>
                  heatCategory(x.hi).level >= 3
                    ? "#C8102E"
                    : heatCategory(x.hi).level >= 2
                      ? "#F0A04B"
                      : "#8B8A8F",
                )}
                yMax={60}
              />
            </article>
            <article className="v1-card">
              <h3>Category</h3>
              <p className="sub">Station-days by heat-index category</p>
              <BarChart labels={[...CAT_NAMES]} values={catCounts} colors={CAT_COLORS} height={190} />
            </article>
          </div>

          <div className="v1-grid g2eq wx-charts-row">
            <article className="v1-card wx-chart-card">
              <h3>Today, hour by hour</h3>
              <p className="sub">Temperature (solid) and heat index (dashed) per station</p>
              <MultiLineChart
                labels={WEATHER_DAY_HOURS.map((h) => {
                  const h12 = h > 12 ? h - 12 : h;
                  return `${h12}${h >= 12 ? " PM" : " AM"}`;
                })}
                series={todayHourly.flatMap((row, i) => {
                  const color = STATION_COLORS[i % STATION_COLORS.length];
                  return [
                    {
                      label: `${row.station.loc} temp`,
                      color,
                      values: row.hours.map((h) => (h.status === "ok" ? (h.temp ?? null) : null)),
                    },
                    {
                      label: `${row.station.loc} HI`,
                      color,
                      dashed: true,
                      hideLegend: true,
                      values: row.hours.map((h) =>
                        h.status === "ok" ? (h.heatIndex ?? null) : null,
                      ),
                    },
                  ];
                })}
                height={250}
              />
            </article>
            <article className="v1-card wx-chart-card">
              <h3>Air quality</h3>
              <p className="sub">Highest PM2.5 and PM10 per station in the period</p>
              <GroupedBarChart
                labels={stations
                  .filter((s) => days.some((d) => d.station.id === s.id))
                  .map((s) => s.loc)}
                series={[
                  {
                    label: "PM2.5",
                    color: "#8B8A8F",
                    values: stations
                      .filter((s) => days.some((d) => d.station.id === s.id))
                      .map((s) =>
                        days
                          .filter((d) => d.station.id === s.id)
                          .reduce((a, d) => Math.max(a, d.pm25), 0),
                      ),
                  },
                  {
                    label: "PM10",
                    color: "#A67C52",
                    values: stations
                      .filter((s) => days.some((d) => d.station.id === s.id))
                      .map((s) =>
                        days
                          .filter((d) => d.station.id === s.id)
                          .reduce((a, d) => Math.max(a, d.pm10), 0),
                      ),
                  },
                ]}
                height={250}
              />
            </article>
          </div>

          <article className="v1-card wx-trend-card">
            <h3>Heat index trend</h3>
            <p className="sub">Highest daily heat index, by month and project</p>
            <MultiLineChart
              labels={MON3.slice(0, now.getMonth() + 1)}
              series={trend.map((row, i) => ({
                label: row.project,
                color: PROJECT_COLORS[i % PROJECT_COLORS.length],
                values: row.values,
              }))}
              height={220}
              yMin={15}
              fillWidth
            />
          </article>

          <article className="v1-card">
            <h3>Observations summary</h3>
            <p className="sub">Daily highest readings per station, newest first</p>
            <div className="tbl-wrap wx-obs-wrap">
              <table className="v1-tbl">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Project</th>
                    <th>Station</th>
                    <th className="n">Highest RH %</th>
                    <th className="n">Temperature °C</th>
                    <th className="n">Heat index</th>
                    <th>Category</th>
                    <th>Prevention</th>
                  </tr>
                </thead>
                <tbody>
                  {observations.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="muted">
                        No logged readings in this period yet.
                      </td>
                    </tr>
                  ) : (
                    observations.map((d) => (
                      <tr key={`${d.station.id}-${d.dateIso}`}>
                        <td className="mono">{fmtDate(d.t)}</td>
                        <td>{d.station.project}</td>
                        <td>{d.station.loc}</td>
                        <td className="n mono">{d.RH}</td>
                        <td className="n mono">{d.T}</td>
                        <td className="n mono">
                          <b>{d.hi}</b>
                        </td>
                        <td>
                          <span className={`hicat c${d.category.level}`}>{d.category.name}</span>
                        </td>
                        <td className="muted wx-prev">{d.category.prevention}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </article>
        </>
      ) : null}

      {tab === "log" ? (
        <>
          <div className="v1-filters">
            <div className="grp">
              <label className="k">Project</label>
              {accessProjects.length <= 1 ? (
                <div className="wx-access-lock" title="Assigned project access">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
                    <rect x="5" y="11" width="14" height="10" rx="2" />
                    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
                  </svg>
                  {accessProjects[0] || "No project access"}
                </div>
              ) : (
                <div className="seg">
                  {accessProjects.map((p) => (
                    <button
                      key={p}
                      type="button"
                      className={logProject === p ? "on" : undefined}
                      onClick={() => setLogProject(p)}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="grp">
              <label className="k">Date</label>
              <input
                type="date"
                className="inp"
                value={logDate}
                max={isoDate(now)}
                onChange={(e) => setLogDate(e.target.value)}
              />
            </div>
            <div className="range">
              <b>
                {logProgress.filled} of {logProgress.expect} hourly readings logged
              </b>
              Week {logWeek} · {isLogToday ? "current hour highlighted" : "past day"}
              {!hasAllProjectAccess ? (
                <>
                  <br />
                  Access limited to your assigned project
                  {accessProjects.length === 1 ? "" : "s"}
                </>
              ) : null}
            </div>
          </div>

          <p className="wx-log-note">
            The SCC team logs one row per station every hour from 7:00 AM to 2:00 PM. Location,
            project and date are fixed by the station. You can only edit tables for projects
            assigned to your account
            {hasAllProjectAccess ? " (admin: all projects)" : ""}. Readings are optional; heat
            index is calculated from temperature and RH and can be overwritten.
          </p>
          {savedFlash ? <p className="wx-save-flash">{savedFlash}</p> : null}

          {logStations.map((st, ti) => (
            <article className="v1-card wx-log-card" key={st.id}>
              <div className="wx-log-hd">
                <div>
                  <h3>
                    Table {ti + 1} of {logStations.length} · {st.loc}
                  </h3>
                  <p className="sub">
                    {st.id} · {logProject} · {fmtDate(logDate)}
                  </p>
                </div>
                {canRecordWeather ? (
                  <button
                    type="button"
                    className="btn sm"
                    disabled={savingStationId === st.id}
                    onClick={() => void saveStationReadings(st)}
                  >
                    {savingStationId === st.id ? "Saving…" : "Save readings"}
                  </button>
                ) : null}
              </div>
              <div className="tbl-wrap">
                <table className="weather-table wx-hourly-edit">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Wind (m/s)</th>
                      <th>Temp (°C)</th>
                      <th>RH (%)</th>
                      <th>CO2</th>
                      <th>PM2.5</th>
                      <th>PM10</th>
                      <th>Heat index</th>
                      <th>Category</th>
                      <th>Remarks</th>
                      <th>Logged by</th>
                    </tr>
                  </thead>
                  <tbody>
                    {WEATHER_DAY_HOURS.map((hour) => {
                      const row = rowFor(st, hour);
                      const upcoming = row.status === "upcoming";
                      const current =
                        isLogToday && hour === now.getHours() && !upcoming;
                      const currentUser =
                        formatUserLabel(user) || user?.username || "";
                      const hasReading =
                        row.status === "ok" &&
                        [
                          row.wind,
                          row.temp,
                          row.rh,
                          row.co2,
                          row.pm25,
                          row.pm10,
                          row.heatIndex,
                          row.remarks,
                        ].some((v) => v != null && String(v).trim() !== "");
                      const loggedByDisplay = row.loggedBy || (hasReading ? currentUser : "");
                      return (
                        <tr key={hour} className={current ? "is-current" : undefined}>
                          <td className="wx-time">{row.timeLabel}</td>
                          {upcoming ? (
                            <td colSpan={10} className="muted">
                              Upcoming
                            </td>
                          ) : (
                            <>
                              {(
                                [
                                  ["wind", "wind"],
                                  ["temp", "temp"],
                                  ["rh", "rh"],
                                  ["co2", "co2"],
                                  ["pm25", "pm25"],
                                  ["pm10", "pm10"],
                                  ["heatIndex", "heatIndex"],
                                ] as const
                              ).map(([key, field]) => (
                                <td key={key} className={`wx-${field === "heatIndex" ? "heat" : field}`}>
                                  <input
                                    type="number"
                                    step="0.1"
                                    value={row[field] ?? ""}
                                    onChange={(e) => {
                                      const raw = e.target.value;
                                      updateLogCell(st, hour, {
                                        [field]: raw === "" ? undefined : Number(raw),
                                        status: "ok",
                                      } as Partial<HourlyWeatherRow>);
                                    }}
                                  />
                                </td>
                              ))}
                              <td>
                                {row.category ? (
                                  <span className={`hicat c${row.category.level}`}>
                                    {row.category.name}
                                  </span>
                                ) : row.status === "missing" ? (
                                  <span className="muted">Missing</span>
                                ) : null}
                              </td>
                              <td className="wx-remarks">
                                <input
                                  value={row.remarks ?? ""}
                                  onChange={(e) =>
                                    updateLogCell(st, hour, {
                                      remarks: e.target.value,
                                      status: "ok",
                                    })
                                  }
                                />
                              </td>
                              <td className="wx-logged-by">
                                <input
                                  value={loggedByDisplay}
                                  readOnly
                                  aria-readonly="true"
                                  title={
                                    row.loggedBy
                                      ? `Saved by ${row.loggedBy}`
                                      : hasReading
                                        ? "Will save as you when you click Save readings"
                                        : undefined
                                  }
                                />
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </article>
          ))}

          <article className="v1-card wx-hi-ref">
            <div className="hd">
              <h3>Heat index reference</h3>
            </div>
            <p className="sub">
              Lookup chart and danger categories used when logging temperature and RH. Category is
              calculated from heat index (1 cup = 250 ml).
            </p>

            <div className="wx-hi-ref-bands">
              {HEAT_INDEX_GUIDE.map((row) => (
                <div key={row.roman} className={`wx-hi-band c${row.level}`}>
                  <div className="wx-hi-band-top">
                    <span className="wx-hi-band-roman">
                      {row.roman}. {row.name}
                    </span>
                    <strong className="mono">{row.range}</strong>
                  </div>
                  <p>{row.symptoms}</p>
                  <dl>
                    <div>
                      <dt>Work:Rest</dt>
                      <dd>{row.workRest}</dd>
                    </div>
                    <div>
                      <dt>Water</dt>
                      <dd>{row.water}</dd>
                    </div>
                    <div>
                      <dt>Controls</dt>
                      <dd>{row.controls}</dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>

            <div className="wx-hi-ref-figs">
              <figure className="wx-hi-fig">
                <figcaption>Heat index chart · Air temp (°C) × Relative humidity (%)</figcaption>
                <div className="wx-hi-fig-frame">
                  <img
                    src={heatIndexChart}
                    alt="Heat index chart by air temperature and relative humidity"
                  />
                </div>
              </figure>
              <figure className="wx-hi-fig">
                <figcaption>Heat index danger categories · work/rest and water guidance</figcaption>
                <div className="wx-hi-fig-frame">
                  <img
                    src={heatIndexCategories}
                    alt="Heat index danger category table with work rest and water requirements"
                  />
                </div>
              </figure>
            </div>
          </article>
        </>
      ) : null}

      {tab === "weekly" ? (
        <article className="v1-card">
          <div className="wx-log-hd">
            <div>
              <h3>Weekly weather logs</h3>
              <p className="sub">
                One log per project per week, compiled from the hourly readings
                {!hasAllProjectAccess
                  ? ` · showing ${accessProjects.join(", ")} only`
                  : ""}
              </p>
            </div>
            {canRecordWeather ? (
              <button type="button" className="btn sm primary" onClick={openSubmitDialog}>
                Log weekly weather data
              </button>
            ) : null}
          </div>
          <div className="tbl-wrap wx-weekly-list-wrap">
            <table className="v1-tbl">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Project</th>
                  <th>Week</th>
                  <th>Location</th>
                  <th className="n">Max HI</th>
                  <th>Category</th>
                  <th>Submitted by</th>
                  <th>Submitted</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {weeklyLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="mono">{log.id}</td>
                    <td>{log.project}</td>
                    <td>{log.weekLabel}</td>
                    <td>
                      {log.location}
                      {log.stationCount > 1 ? ` +${log.stationCount - 1}` : ""}
                    </td>
                    <td className="n mono">
                      <b>{log.maxHeatIndex}</b>
                    </td>
                    <td>
                      <span className={`hicat c${log.highestCategory.level}`}>
                        {log.highestCategory.name}
                      </span>
                    </td>
                    <td>{log.submittedBy}</td>
                    <td className="muted">{log.submittedAtLabel}</td>
                    <td>
                      <button
                        type="button"
                        className="btn sm ghost"
                        onClick={() => setViewing(log)}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      ) : null}

      {viewing ? (
        <WeeklyLogDrawer
          log={viewing}
          mode="view"
          remarks={viewing.remarks}
          onRemarks={() => undefined}
          onClose={() => setViewing(null)}
        />
      ) : null}

      {submitting ? (
        <WeeklyLogDrawer
          log={submitting}
          mode="submit"
          remarks={submitRemarks}
          onRemarks={setSubmitRemarks}
          projects={accessProjects}
          weekOptions={submitWeekOptions}
          onProjectChange={setSubmitProject}
          onWeekChange={(weekStartIso) => {
            if (submitWeekOptions.some((w) => w.startIso === weekStartIso)) {
              setSubmitWeekStart(weekStartIso);
            }
          }}
          onClose={() => setSubmitOpen(false)}
          onSubmit={() => {
            if (!submitting || submittingBusy) return;
            setSubmittingBusy(true);
            void submitWeatherWeekly({
              project: submitting.project,
              week_start: submitting.weekStartIso,
              remarks: submitRemarks,
              submitted_by: formatUserLabel(user) || user?.username || submitting.submittedBy,
            })
              .then(async (dto) => {
                await reloadWeeklyLogs();
                setSubmitOpen(false);
                setTab("weekly");
                setSavedFlash(`Weekly log ${dto.id} submitted`);
                window.setTimeout(() => setSavedFlash(null), 2500);
              })
              .catch((err) => {
                setSavedFlash(err instanceof Error ? err.message : "Submit failed");
                window.setTimeout(() => setSavedFlash(null), 3200);
              })
              .finally(() => setSubmittingBusy(false));
          }}
        />
      ) : null}
    </section>
  );
}
