import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  fetchReports,
  fetchWeatherWeeklyLogs,
  fetchWeatherWeeklyPreview,
  issueReport,
  openNotificationsPanel,
  signReport,
  type CaseSummary,
  type ReportPacket,
  type ReportsPayload,
  type WeatherWeeklyLogDto,
} from "../api/scc";
import { useAuth } from "../auth/AuthContext";
import { errorMessage } from "../lib/errors";
import { useProjectAccess } from "../lib/useProjectAccess";
import { formatUserLabel } from "./shared";
import {
  buildDailyWeatherTables,
  buildMonthlyWeatherMaxes,
  type DailyStationWeather,
  type MonthlyStationWeatherMax,
  type WeeklyWeatherLog,
} from "../lib/weatherReport";
import bqLogo from "../assets/bq-logo.png";

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

type ReportTab = "daily" | "weekly" | "monthly";

type BuiltReport = {
  id: string;
  kind: ReportTab;
  periodLabel: string;
  periodIso: string;
  periodEndIso?: string;
  scope: string;
  records: number;
  open: number;
  underReview: number;
  closed: number;
  overdue: number;
  highRisk: number;
  generatedLabel: string;
  status: string;
  statusTone: "compiling" | "generated" | "awaiting" | "ready" | "issued" | "signed";
  compiling: boolean;
  cases: CaseSummary[];
  packet?: ReportPacket;
};

const MONTHS = [
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
const MONTH_FULL = [
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

const TYPE_FULL: Record<string, string> = {
  ai_camera: "AI Camera Observation",
  dashcam: "Dashcam Observation",
  speed: "Speed Violation",
  sos: "SOS Alert",
  itqan: "ITQAN Violation",
};

const TYPE_ROWS = [
  { key: "ai_camera", label: "AI Camera Observations" },
  { key: "sos", label: "SOS Alerts (Wearables)" },
  { key: "row", label: "ROW (Zone) Violations" },
  { key: "speed_light", label: "Light Vehicle Speed Violations" },
  { key: "speed_heavy", label: "Heavy Vehicle Speed Violations" },
  { key: "dashcam", label: "Dashcam Violations" },
  { key: "itqan", label: "ITQAN Violations" },
] as const;

const SLA_HOURS: Record<string, number> = { High: 24, Medium: 72, Low: 168 };

function caseField(row: CaseSummary, key: string) {
  const v = row.fields?.[key];
  return v == null ? "" : String(v);
}

function isRowViolation(row: CaseSummary) {
  return row.record_type === "speed" && /row/i.test(caseField(row, "speed_violation_type"));
}

function isHeavySpeed(row: CaseSummary) {
  return (
    row.record_type === "speed" &&
    !isRowViolation(row) &&
    /heavy/i.test(caseField(row, "vehicle_type"))
  );
}

function isLightSpeed(row: CaseSummary) {
  return (
    row.record_type === "speed" &&
    !isRowViolation(row) &&
    !/heavy/i.test(caseField(row, "vehicle_type"))
  );
}

function matchesTypeRow(row: CaseSummary, key: (typeof TYPE_ROWS)[number]["key"]) {
  switch (key) {
    case "ai_camera":
      return row.record_type === "ai_camera";
    case "sos":
      return row.record_type === "sos";
    case "row":
      return isRowViolation(row);
    case "speed_light":
      return isLightSpeed(row);
    case "speed_heavy":
      return isHeavySpeed(row);
    case "dashcam":
      return row.record_type === "dashcam";
    case "itqan":
      return row.record_type === "itqan";
  }
}

function formatGeneratedAt(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `Generated (GMT+3) ${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

function formatDay(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function riskKey(row: CaseSummary) {
  return (row.risk_level || "").replace(/\s*Risk$/i, "").trim() || "Low";
}

function isOverdue(row: CaseSummary, now = Date.now()) {
  if (row.status === "closed") return false;
  const limit = SLA_HOURS[riskKey(row)] ?? 72;
  const created = new Date(row.created_at).getTime();
  if (!Number.isFinite(created)) return false;
  return (now - created) / 3600000 > limit;
}

function isHighRisk(row: CaseSummary) {
  return /high/i.test(row.risk_level || "");
}

function scopeOf(row: CaseSummary) {
  if (row.project) return row.project;
  if (row.department) return `Dept: ${row.department}`;
  return "—";
}

function statusLabel(status: string) {
  if (status === "under_process") return "Under Review";
  if (status === "open") return "Open";
  if (status === "closed") return "Closed";
  return status;
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function csvEscape(value: string) {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function buildExcelCsv(report: BuiltReport) {
  const lines = ['"Case ID","Date","Type","Scope","Risk","Status"'];
  const sorted = [...report.cases].sort((a, b) =>
    `${b.date}${b.created_at}`.localeCompare(`${a.date}${a.created_at}`),
  );
  for (const row of sorted) {
    const time = row.created_at?.includes("T")
      ? row.created_at.slice(11, 16)
      : "";
    const date = time ? `${row.date} ${time}` : row.date;
    const risk =
      row.record_type === "sos" ? "NA" : (row.risk_level || "").replace(/\s*Risk$/i, "") || "—";
    lines.push(
      [
        row.case_id,
        date,
        TYPE_FULL[row.record_type] ?? row.record_type,
        scopeOf(row),
        risk,
        statusLabel(row.status),
      ]
        .map((v) => csvEscape(String(v)))
        .join(","),
    );
  }
  return lines.join("\n");
}

function ReportDocIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path d="M14 3v5h5M8 13h8M8 17h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3v12M8 11l4 4 4-4M5 21h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function IssueIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function normalizeDailyAt(value: unknown): string {
  const raw = String(value ?? "23:59").trim();
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(raw);
  if (!match) return "23:59";
  const h = Math.min(23, Math.max(0, Number(match[1])));
  const m = Math.min(59, Math.max(0, Number(match[2])));
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function scheduleFromSettings(settings?: Record<string, unknown> | null) {
  return {
    dailyAt: normalizeDailyAt(settings?.dailyAt),
    weeklyDay: String(settings?.weeklyDay ?? "Saturday").trim() || "Saturday",
    monthlyDay: Math.min(10, Math.max(1, Number(settings?.monthlyDay ?? 1) || 1)),
  };
}

/** True once local clock has reached the configured daily generation time. */
function pastDailyCutoff(now: Date, dailyAt: string): boolean {
  const [hs, ms] = normalizeDailyAt(dailyAt).split(":").map(Number);
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  return minutesNow >= (hs ?? 23) * 60 + (ms ?? 59);
}

function buildDailyReports(
  cases: CaseSummary[],
  packets: ReportPacket[] = [],
  now = new Date(),
  dailyAt = "23:59",
): BuiltReport[] {
  const byDay = new Map<string, CaseSummary[]>();
  for (const row of cases) {
    const key = row.date?.slice(0, 10);
    if (!key) continue;
    const list = byDay.get(key) ?? [];
    list.push(row);
    byDay.set(key, list);
  }
  const today = isoDate(now);
  const genAt = normalizeDailyAt(dailyAt);
  const todayDone = pastDailyCutoff(now, genAt);
  const packetByDay = new Map<string, ReportPacket>();
  for (const packet of packets) {
    if (packet.kind !== "daily") continue;
    const day = (packet.a || packet.label || "").slice(0, 10);
    if (day) packetByDay.set(day, packet);
  }

  // Always show a calendar day for the last 30 days (even with 0 records),
  // so quiet days between reports still appear once generated at dailyAt.
  const days: string[] = [];
  for (let offset = 0; offset < 30; offset += 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    days.push(isoDate(d));
  }

  return days.map((day) => {
    const rows = byDay.get(day) ?? [];
    const packet = packetByDay.get(day);
    const packetCompiling = Boolean(
      packet && /compil|progress/i.test(String(packet.status || "")),
    );
    const compiling = packet
      ? packetCompiling
      : day === today && !todayDone;
    const id = packet?.id || `DR-${day.replace(/-/g, "")}`;
    return {
      id,
      kind: "daily" as const,
      periodLabel: formatDay(day),
      periodIso: day,
      scope: packet?.scope || "All projects",
      records: rows.length,
      open: rows.filter((r) => r.status === "open").length,
      underReview: rows.filter((r) => r.status === "under_process").length,
      closed: rows.filter((r) => r.status === "closed").length,
      overdue: rows.filter((r) => isOverdue(r)).length,
      highRisk: rows.filter((r) => isHighRisk(r)).length,
      generatedLabel: compiling
        ? "In progress"
        : `${formatDay(day)}, ${genAt} · auto`,
      status: compiling ? "Compiling" : packet?.status || "Generated",
      statusTone: compiling ? "compiling" : "generated",
      compiling,
      cases: rows,
      packet,
    };
  });
}

function casesInScope(
  cases: CaseSummary[],
  scope: string | null | undefined,
  fromIso: string,
  toIso: string,
) {
  const scopeName = (scope || "").trim();
  return cases.filter((row) => {
    const d = row.date?.slice(0, 10);
    if (!d || d < fromIso || d > toIso) return false;
    if (!scopeName || scopeName === "All projects") return true;
    // Project-scoped reports only include records assigned to that project.
    return (row.project || "").trim() === scopeName;
  });
}

function projectCode(name: string, index: number) {
  const letters = name.toUpperCase().replace(/[^A-Z]/g, "");
  return (letters.slice(0, 3) || `P${index + 1}`).padEnd(3, "X").slice(0, 3);
}

/** Sunday–Saturday bounds for the week containing `day`. */
function sundayWeekBounds(day: Date) {
  const d = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const daysSinceSunday = (d.getDay() + 7) % 7; // Sun=0
  const start = new Date(d);
  start.setDate(d.getDate() - daysSinceSunday);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end };
}

/** Sunday-start week number; week 1 contains 1 January (matches backend week_from_date). */
function sundayWeekParts(day: Date): { year: number; week: number } {
  const value = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const jan1 = new Date(value.getFullYear(), 0, 1);
  const week1Sunday = new Date(jan1);
  week1Sunday.setDate(jan1.getDate() - ((jan1.getDay() + 7) % 7));
  if (value < week1Sunday) {
    return sundayWeekParts(new Date(value.getFullYear() - 1, 11, 31));
  }
  const diffDays = Math.floor((value.getTime() - week1Sunday.getTime()) / 86400000);
  return { year: value.getFullYear(), week: Math.floor(diffDays / 7) + 1 };
}

function weeklyReportId(day: Date, projectName: string, index: number) {
  const { year, week } = sundayWeekParts(day);
  return `WR-${year}-W${String(week).padStart(2, "0")}-${projectCode(projectName, index)}`;
}

function summarizeScoped(
  kind: ReportTab,
  id: string,
  scope: string,
  fromIso: string,
  toIso: string,
  cases: CaseSummary[],
  packet?: ReportPacket,
): BuiltReport {
  const rows = casesInScope(cases, scope, fromIso, toIso);
  const packetStatus = packet?.status || "";
  // Do not use /sign/ here — it also matches "Signed".
  const signed = Boolean(packet?.signed) || /^signed$/i.test(packetStatus);
  const awaiting = /awaiting/i.test(packetStatus) && !signed;
  const ready = /ready/i.test(packetStatus);
  const issued = /issued/i.test(packetStatus);
  const compiling = /progress|compil/i.test(packetStatus);
  const a = new Date(`${fromIso}T00:00:00`);
  const periodLabel =
    kind === "monthly"
      ? `${MONTH_FULL[a.getMonth()]} ${a.getFullYear()}`
      : `${formatDay(fromIso)} – ${formatDay(toIso)}`;
  return {
    id,
    kind,
    periodLabel,
    periodIso: fromIso,
    periodEndIso: toIso,
    scope,
    records: rows.length,
    open: rows.filter((r) => r.status === "open").length,
    underReview: rows.filter((r) => r.status === "under_process").length,
    closed: rows.filter((r) => r.status === "closed").length,
    overdue: rows.filter((r) => isOverdue(r)).length,
    highRisk: rows.filter((r) => isHighRisk(r)).length,
    generatedLabel: compiling
      ? "In progress"
      : kind === "weekly"
        ? packet?.signed?.at
          ? `${formatDay(packet.signed.at)} · signed`
          : packet?.generated_at
            ? `${formatDay(packet.generated_at)} · auto`
            : `${formatDay(toIso)}, 23:59 · auto`
        : packet?.issued?.at
          ? `${formatDay(packet.issued.at)}, 00:00 · auto`
          : packet?.generated_at
            ? `${formatDay(packet.generated_at)} · auto`
            : `${formatDay(fromIso)}, 00:00 · auto`,
    status:
      packet?.status === "Issued"
        ? "Issued to PM"
        : compiling
          ? "Compiling"
          : packet?.status || (kind === "monthly" ? "Ready to issue" : "Generated"),
    statusTone: issued
      ? "issued"
      : ready
        ? "ready"
        : signed
          ? "signed"
          : awaiting
            ? "awaiting"
            : compiling
              ? "compiling"
              : "generated",
    compiling,
    cases: rows,
    packet,
  };
}

function buildWeeklyReports(
  packets: ReportPacket[],
  cases: CaseSummary[],
  projectNames: string[],
): BuiltReport[] {
  const weeklyPackets = packets.filter((p) => p.kind === "weekly");
  const scopes =
    projectNames.length > 0
      ? projectNames
      : ([...new Set(weeklyPackets.map((p) => p.scope).filter(Boolean))] as string[]);

  // Prefer API packets (already WR-YYYY-Www-CODE × projects). Fall back to local weeks.
  if (weeklyPackets.length) {
    const scopedPackets =
      projectNames.length > 0
        ? weeklyPackets.filter((p) => !p.scope || scopes.includes(p.scope))
        : weeklyPackets;
    return [...scopedPackets]
      .sort((a, b) => `${b.b}${a.scope}`.localeCompare(`${a.b}${b.scope}`))
      .map((packet, index) => {
        const scope = packet.scope || scopes[0] || "All projects";
        const end = packet.b ? new Date(`${packet.b}T00:00:00`) : new Date();
        const scopeIndex = Math.max(0, scopes.indexOf(scope));
        const id =
          packet.id && /-W\d{2}-/.test(packet.id)
            ? packet.id
            : weeklyReportId(end, scope, scopeIndex >= 0 ? scopeIndex : index);
        return summarizeScoped(
          "weekly",
          id,
          scope,
          packet.a,
          packet.b,
          cases,
          { ...packet, id },
        );
      });
  }

  const now = new Date();
  const { start: currentSunday } = sundayWeekBounds(now);
  const weekCount = 6;
  const built: BuiltReport[] = [];
  for (let weekOffset = 0; weekOffset < weekCount; weekOffset += 1) {
    const weekStart = new Date(currentSunday);
    weekStart.setDate(currentSunday.getDate() - 7 * weekOffset);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    const a = isoDate(weekStart);
    const b = isoDate(weekEnd);
    const { week } = sundayWeekParts(weekEnd);
    scopes.forEach((scope, index) => {
      const id = weeklyReportId(weekEnd, scope, index);
      built.push(
        summarizeScoped(
          "weekly",
          id,
          scope,
          a,
          b,
          cases,
          {
            id,
            kind: "weekly",
            scope,
            label: `Week ${String(week).padStart(2, "0")} · ${scope}`,
            status: "Awaiting HSE signature",
            a,
            b,
          },
        ),
      );
    });
  }
  return built;
}

function buildMonthlyReports(
  packets: ReportPacket[],
  cases: CaseSummary[],
  projectNames: string[],
): BuiltReport[] {
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const monthEnd = isoDate(now);
  const monthlyPackets = packets.filter((p) => p.kind === "monthly");
  const scopes =
    projectNames.length > 0
      ? projectNames
      : ([...new Set(monthlyPackets.map((p) => p.scope).filter(Boolean))] as string[]);

  // Prefer saved monthly packets (multiple months × projects), including 0-case months.
  if (monthlyPackets.length) {
    const scopedPackets =
      projectNames.length > 0
        ? monthlyPackets.filter((p) => !p.scope || scopes.includes(p.scope))
        : monthlyPackets;
    return [...scopedPackets]
      .sort((a, b) => `${b.a}${a.scope}`.localeCompare(`${a.a}${b.scope}`))
      .map((packet, index) => {
        const scope = packet.scope || scopes[0] || "All projects";
        const scopeIndex = Math.max(0, scopes.indexOf(scope));
        const code = projectCode(scope, scopeIndex >= 0 ? scopeIndex : index);
        const id =
          packet.id ||
          `MR-${String(packet.a || monthStart).slice(0, 4)}-${String(packet.a || monthStart).slice(5, 7)}-${code}`;
        return summarizeScoped(
          "monthly",
          id,
          scope,
          packet.a || monthStart,
          packet.b || monthEnd,
          cases,
          { ...packet, id },
        );
      });
  }

  return scopes.map((scope, index) => {
    const code = projectCode(scope, index);
    const id = `MR-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${code}`;
    return summarizeScoped(
      "monthly",
      id,
      scope,
      monthStart,
      monthEnd,
      cases,
      {
        id,
        kind: "monthly",
        scope,
        label: `${MONTH_FULL[now.getMonth()]} ${now.getFullYear()}`,
        status: "Compiling",
        a: monthStart,
        b: monthEnd,
      },
    );
  });
}

function typeStats(cases: CaseSummary[]) {
  return TYPE_ROWS.map((item) => {
    const rows = cases.filter((r) => matchesTypeRow(r, item.key));
    return {
      label: item.label,
      total: rows.length,
      open: rows.filter((r) => r.status === "open").length,
      underReview: rows.filter((r) => r.status === "under_process").length,
      closed: rows.filter((r) => r.status === "closed").length,
    };
  });
}

function topAiCategories(cases: CaseSummary[], limit = 8) {
  const counts = new Map<string, number>();
  for (const row of cases) {
    if (row.record_type !== "ai_camera") continue;
    const cat = String(row.fields?.category ?? "").trim() || "Uncategorized";
    counts.set(cat, (counts.get(cat) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function overdueCases(cases: CaseSummary[]) {
  return cases.filter((row) => isOverdue(row));
}

function riskStats(cases: CaseSummary[]) {
  return (
    [
      { key: "High", deadline: "24 hours" },
      { key: "Medium", deadline: "3 days" },
      { key: "Low", deadline: "7 days" },
    ] as const
  ).map((item) => {
    const rows = cases.filter((r) => riskKey(r) === item.key && r.record_type !== "sos");
    const closed = rows.filter((r) => r.status === "closed");
    const overdue = rows.filter((r) => isOverdue(r)).length;
    return {
      risk: `${item.key} Risk`,
      records: rows.length,
      closedOnTime: closed.length,
      overdue,
      deadline: item.deadline,
    };
  });
}

function WeatherLogViewer({
  log,
  onClose,
}: {
  log: WeeklyWeatherLog;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const ui = (
    <div
      className="scrim"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="drawer drawer-page drawer-record report-drawer-panel wx-log-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Weekly weather log ${log.id}`}
      >
        <div className="drawer-hd report-drawer-hd">
          <div>
            <div className="sub">
              {log.id} · submitted by {log.submittedBy}, {log.submittedAtLabel}
            </div>
            <h2>
              Weekly weather log · {log.project} · Week {log.week}
            </h2>
          </div>
          <button type="button" className="iconbtn" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="drawer-body report-drawer-body">
          {log.daysByStation.map((station) => (
            <div className="tbl-wrap wx-week-wrap" key={station.location}>
              <table className="wx-week-table">
                <thead>
                  <tr>
                    <th rowSpan={2}>Location</th>
                    <th rowSpan={2}>Project</th>
                    <th rowSpan={2}>Week</th>
                    <th rowSpan={2}>Date</th>
                    <th className="th-wind">Wind speed</th>
                    <th className="th-temp">Temperature</th>
                    <th className="th-rh">Relative humidity</th>
                    <th className="th-co2">CO2 (PPM)</th>
                    <th className="th-pm">PM10</th>
                    <th rowSpan={2} className="th-hi">
                      Heat index
                    </th>
                    <th rowSpan={2} className="th-rem">
                      Category / prevention
                    </th>
                    <th rowSpan={2}>Hours logged</th>
                  </tr>
                  <tr>
                    <th className="th-wind">Highest (m/s)</th>
                    <th className="th-temp">Highest (°C)</th>
                    <th className="th-rh">Max humidity (%)</th>
                    <th className="th-co2">Highest (ppm)</th>
                    <th className="th-pm">Highest</th>
                  </tr>
                </thead>
                <tbody>
                  {station.days.map((day, index) => (
                    <tr key={day.dateIso}>
                      {index === 0 ? (
                        <>
                          <td rowSpan={station.days.length}>{station.location}</td>
                          <td rowSpan={station.days.length}>{log.project}</td>
                          <td rowSpan={station.days.length}>
                            Week {log.week}
                            <br />
                            <small className="muted">
                              Table {station.tableIndex} of {station.tableCount}
                            </small>
                          </td>
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
                          <td className={`mono hi-cell c${day.category.level}`}>
                            {day.heatIndex}
                          </td>
                          <td className="cat-cell">
                            <span className={`hicat c${day.category.level}`}>
                              {day.category.name}
                            </span>{" "}
                            {day.category.prevention}
                          </td>
                          <td className="mono">
                            {day.hoursLogged} / {day.hoursExpected}
                          </td>
                        </>
                      ) : (
                        <td colSpan={8} className="muted">
                          No readings logged
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          {log.remarks ? (
            <div className="note wx-remarks-note">
              <b>Remarks / corrective actions:</b> {log.remarks}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );

  return createPortal(ui, document.body);
}

function ReportViewer({
  report,
  weatherLog,
  dailyWeather,
  monthlyWeather,
  onClose,
}: {
  report: BuiltReport;
  weatherLog: WeeklyWeatherLog | null;
  dailyWeather: DailyStationWeather[];
  monthlyWeather: MonthlyStationWeatherMax[];
  onClose: () => void;
}) {
  const title =
    report.kind === "daily"
      ? "SCC Daily Report"
      : report.kind === "weekly"
        ? "SCC Weekly Report"
        : "SCC Monthly Report";
  const docTitle =
    report.kind === "daily"
      ? "SCC DAILY REPORT"
      : report.kind === "weekly"
        ? "SCC WEEKLY REPORT"
        : "SCC MONTHLY REPORT";
  const byType = typeStats(report.cases);
  const byRisk = riskStats(report.cases);
  const aiCats = useMemo(
    () =>
      report.kind === "daily" || report.kind === "weekly"
        ? topAiCategories(report.cases)
        : [],
    [report.cases, report.kind],
  );
  const overdueRows = useMemo(
    () => (report.kind === "weekly" ? overdueCases(report.cases) : []),
    [report.cases, report.kind],
  );
  const periodText = report.periodEndIso
    ? `${formatDay(report.periodIso)} – ${formatDay(report.periodEndIso)}`
    : formatDay(report.periodIso);
  const generatedAt = formatGeneratedAt();
  const distribution =
    report.kind === "monthly"
      ? `[PM name], ${report.scope} Project`
      : report.kind === "weekly"
        ? "Dept HSE"
        : "SCC Supervisor";
  const subtitlePeriod =
    report.kind === "monthly" ? report.periodLabel : formatDay(report.periodIso);
  const VIEW_RECORD_LIMIT = 25;
  const sortedCases = useMemo(
    () =>
      [...report.cases].sort((a, b) =>
        `${b.date}${b.created_at}`.localeCompare(`${a.date}${a.created_at}`),
      ),
    [report.cases],
  );
  const visibleCases =
    report.kind === "monthly" ? sortedCases.slice(0, VIEW_RECORD_LIMIT) : sortedCases;
  const truncatedMonthly =
    report.kind === "monthly" && sortedCases.length > VIEW_RECORD_LIMIT;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function exportExcel() {
    const csv = buildExcelCsv(report);
    downloadBlob(
      `${report.id}.csv`,
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
  }

  function exportPdf() {
    const node = document.getElementById("report-print-root");
    if (!node) return;
    const logoSrc = bqLogo.startsWith("http")
      ? bqLogo
      : `${window.location.origin}${bqLogo.startsWith("/") ? "" : "/"}${bqLogo}`;
    const bodyHtml = node.innerHTML.replace(
      /src="[^"]*bq-logo[^"]*"|src="[^"]*bq_logo[^"]*"/gi,
      `src="${logoSrc}"`,
    ).replace(
      new RegExp(`src="${bqLogo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`, "g"),
      `src="${logoSrc}"`,
    );
    // Ensure any relative vite asset path becomes absolute for the print iframe.
    const absoluteBody = bodyHtml.replace(
      /src="(\/assets\/[^"]+)"/g,
      `src="${window.location.origin}$1"`,
    );
    const html = `<!doctype html><html><head><meta charset="utf-8"/><title>${report.id}</title>
      <style>
        @page{margin:14mm}
        body{font-family:Segoe UI,Arial,sans-serif;color:#1a1a1a;margin:20px;background:#fff}
        h1{font-size:26px;margin:0;font-weight:800}
        h3, .report-sec{font-size:13px;margin:20px 0 8px;color:#C8102E;text-transform:uppercase;letter-spacing:.04em;border-bottom:2px solid #C8102E;padding-bottom:4px;font-weight:800}
        .sub{color:#666;font-size:12.5px;margin:6px 0 0}
        .head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:0;padding-bottom:12px;border-bottom:2px solid #C8102E}
        .report-doc-brand{display:flex;align-items:flex-start;gap:14px;min-width:0}
        .report-doc-logo{height:52px;width:auto;display:block;object-fit:contain}
        .report-doc-meta{text-align:right;font-size:11.5px;color:#888;line-height:1.55;font-family:ui-monospace,Consolas,monospace}
        .report-meta-band{display:grid;grid-template-columns:1fr 1fr;gap:10px 28px;margin:0 0 18px;padding:12px 0;border-bottom:2px solid #C8102E;font-size:12px;color:#888}
        .report-meta-band span{display:block;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;font-weight:700}
        .report-meta-band b{display:block;margin-top:3px;color:#111;font-size:13.5px;font-weight:700}
        .kpis{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:8px 0 18px}
        .kpi{border:1px solid #ddd;border-radius:10px;padding:12px 14px;background:#fff;text-align:left}
        .kpi span{display:block;font-size:11px;color:#888;font-weight:600}
        .kpi b{display:block;margin-top:6px;font-size:28px;font-weight:800;line-height:1}
        .report-table{width:100%;border-collapse:collapse;font-size:12.5px;margin:4px 0 16px}
        .report-table th{background:transparent;color:#888;text-align:left;padding:8px 6px;font-size:11px;font-weight:700;font-family:ui-monospace,Consolas,monospace;border-bottom:1px solid #ddd;text-transform:none;letter-spacing:0}
        .report-table td{padding:9px 6px;border-bottom:1px solid #e8e8e8;vertical-align:top}
        .report-table .num,.report-table th.num{text-align:right;font-family:ui-monospace,Consolas,monospace;color:#555}
        .report-table td:first-child{color:#111;font-family:Segoe UI,Arial,sans-serif}
        .mono{font-family:ui-monospace,Consolas,monospace}
        .report-signoff{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:22px}
        .report-signoff-card{border:1px solid #ddd;border-radius:12px;padding:14px 16px;min-height:108px}
        .report-signoff-card > span{display:block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;font-weight:700;color:#888;margin-bottom:10px}
        .report-signoff-card p{margin:0 0 4px;font-size:13.5px}
        .report-signoff-card b{display:block;font-size:15px;font-weight:800;line-height:1.25}
        .report-signoff-card b.muted-strong{color:#555;font-weight:700}
        .report-signoff-card small{display:block;margin-top:8px;color:#888;font-size:12px}
        .report-truncation-note{margin:8px 0 0;font-size:11.5px;color:#888;line-height:1.4}
      </style></head><body>${absoluteBody}</body></html>`;

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const frame = document.createElement("iframe");
    frame.setAttribute("title", `Print ${report.id}`);
    frame.style.cssText =
      "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none";
    const cleanup = () => {
      URL.revokeObjectURL(url);
      frame.remove();
    };
    frame.onload = () => {
      const win = frame.contentWindow;
      if (!win) {
        cleanup();
        return;
      }
      window.setTimeout(() => {
        try {
          win.focus();
          win.print();
        } finally {
          window.setTimeout(cleanup, 1500);
        }
      }, 100);
    };
    frame.src = url;
    document.body.appendChild(frame);
  }

  const ui = (
    <div
      className="scrim"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="drawer drawer-page drawer-record report-drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="drawer-hd report-drawer-hd">
          <div>
            <div className="sub">
              {report.id} · {report.scope}
            </div>
            <h2>{title}</h2>
          </div>
          <div className="drawer-hd-meta report-drawer-actions">
            <span className={`report-status ${report.statusTone}`}>{report.status}</span>
            <button type="button" className="btn sm report-export excel" onClick={exportExcel}>
              <DownloadIcon /> Excel
            </button>
            <button type="button" className="btn sm report-export pdf" onClick={exportPdf}>
              <DownloadIcon /> PDF
            </button>
            <button type="button" className="iconbtn" aria-label="Close" onClick={onClose}>
              ×
            </button>
          </div>
        </div>
        <div className="drawer-body report-drawer-body">
          <article className="report-doc" id="report-print-root">
            <div className="head">
              <div className="report-doc-brand">
                <img className="report-doc-logo" src={bqLogo} alt="Bin Quraya" />
                <div className="report-doc-titles">
                  <h1>{docTitle}</h1>
                  <p className="sub">
                    Safety Command Center · {report.scope} · {subtitlePeriod}
                  </p>
                </div>
              </div>
              <div className="report-doc-meta">
                <div>{generatedAt}</div>
                <div>Auto-generated by SCC Platform</div>
              </div>
            </div>

            <div className="meta report-meta-band">
              <div>
                <span>Period</span>
                <b>{periodText}</b>
              </div>
              <div>
                <span>Prepared by</span>
                <b>SCC Platform (system)</b>
              </div>
              <div>
                <span>Scope</span>
                <b>{report.scope}</b>
              </div>
              <div>
                <span>Distribution</span>
                <b>{distribution}</b>
              </div>
            </div>

            <h3 className="report-sec">Key figures</h3>
            <div className="kpis">
              {(
                [
                  ["Records", report.records],
                  ["Open", report.open],
                  ["Under Review", report.underReview],
                  ["Closed", report.closed],
                  ["Overdue", report.overdue],
                  ["High risk", report.highRisk],
                ] as const
              ).map(([label, value]) => (
                <div className="kpi" key={label}>
                  <span>{label}</span>
                  <b>{value}</b>
                </div>
              ))}
            </div>

            <h3 className="report-sec">Observations and violations by type</h3>
            <table className="report-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th className="num">Total</th>
                  <th className="num">Open</th>
                  <th className="num">Under Review</th>
                  <th className="num">Closed</th>
                </tr>
              </thead>
              <tbody>
                {byType.map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td className="num">{row.total}</td>
                    <td className="num">{row.open}</td>
                    <td className="num">{row.underReview}</td>
                    <td className="num">{row.closed}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3 className="report-sec">Risk level</h3>
            <table className="report-table">
              <thead>
                <tr>
                  <th>Risk</th>
                  <th className="num">Records</th>
                  <th className="num">Closed on time</th>
                  <th className="num">Overdue</th>
                  <th>Deadline</th>
                </tr>
              </thead>
              <tbody>
                {byRisk.map((row) => (
                  <tr key={row.risk}>
                    <td>{row.risk}</td>
                    <td className="num">{row.records}</td>
                    <td className="num">{row.closedOnTime}</td>
                    <td className="num">{row.overdue}</td>
                    <td>{row.deadline}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {aiCats.length ? (
              <>
                <h3 className="report-sec">Top AI camera categories</h3>
                <ul className="report-ai-cats">
                  {aiCats.map((row) => (
                    <li key={row.label}>
                      <span>{row.label}</span>
                      <b>{row.count}</b>
                    </li>
                  ))}
                </ul>
              </>
            ) : report.kind === "daily" || report.kind === "weekly" ? (
              <>
                <h3 className="report-sec">Top AI camera categories</h3>
                <p className="report-truncation-note">No AI camera observations in this period.</p>
              </>
            ) : null}

            {report.kind === "daily" && dailyWeather.length ? (
              <>
                <h3 className="report-sec">Weather monitoring · hourly readings</h3>
                {dailyWeather.map((station) => (
                  <div key={`${station.project}-${station.location}`} className="report-wx-block">
                    <p className="report-wx-sub">
                      <b>{station.location}</b> · {station.project} · {station.dateLabel} · Week{" "}
                      {station.week}
                    </p>
                    <div className="table-wrap report-wx-scroll">
                      <table className="report-table report-wx-hourly">
                        <thead>
                          <tr>
                            <th>Time</th>
                            <th className="num">Wind (m/s)</th>
                            <th className="num">Temp (°C)</th>
                            <th className="num">RH (%)</th>
                            <th className="num">CO2 (ppm)</th>
                            <th className="num">PM2.5</th>
                            <th className="num">PM10</th>
                            <th className="num">Heat index</th>
                            <th>Category</th>
                            <th>Remarks / corrective actions</th>
                            <th>Logged by</th>
                          </tr>
                        </thead>
                        <tbody>
                          {station.hours.map((row) =>
                            row.status === "ok" ? (
                              <tr key={row.hour}>
                                <td>{row.timeLabel}</td>
                                <td className="num">{row.wind}</td>
                                <td className="num">{row.temp}</td>
                                <td className="num">{row.rh}</td>
                                <td className="num">{row.co2}</td>
                                <td className="num">{row.pm25}</td>
                                <td className="num">{row.pm10}</td>
                                <td className="num">
                                  <b>{row.heatIndex}</b>
                                </td>
                                <td>{row.category?.name}</td>
                                <td>{row.remarks}</td>
                                <td>{row.loggedBy}</td>
                              </tr>
                            ) : (
                              <tr key={row.hour}>
                                <td>{row.timeLabel}</td>
                                <td colSpan={10} className="muted">
                                  {row.status === "upcoming"
                                    ? "Not due yet"
                                    : "No reading logged"}
                                </td>
                              </tr>
                            ),
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </>
            ) : null}

            {report.kind === "weekly" && weatherLog ? (
              <>
                <h3 className="report-sec">Weather monitoring · highest readings per day</h3>
                {weatherLog.daysByStation.map((station) => (
                  <div key={station.location} className="report-wx-block">
                    <p className="report-wx-sub">
                      <b>{station.location}</b> · {weatherLog.project} · Week {weatherLog.week}
                    </p>
                    <table className="report-table">
                      <thead>
                        <tr>
                          <th>Day</th>
                          <th className="num">Hours logged</th>
                          <th className="num">Max wind (m/s)</th>
                          <th className="num">Max temp (°C)</th>
                          <th className="num">Max humidity (%)</th>
                          <th className="num">Max CO2 (ppm)</th>
                          <th className="num">Max PM10</th>
                          <th className="num">Max heat index</th>
                          <th>Category</th>
                        </tr>
                      </thead>
                      <tbody>
                        {station.days.map((day) => (
                          <tr key={day.dateIso}>
                            <td>{day.dayLabel}</td>
                            {day.hoursLogged > 0 ? (
                              <>
                                <td className="num">
                                  {day.hoursLogged} / {day.hoursExpected}
                                </td>
                                <td className="num">{day.wind}</td>
                                <td className="num">{day.temp}</td>
                                <td className="num">{day.rh}</td>
                                <td className="num">{day.co2}</td>
                                <td className="num">{day.pm10}</td>
                                <td className="num">
                                  <b>{day.heatIndex}</b>
                                </td>
                                <td>{day.category.name}</td>
                              </>
                            ) : (
                              <td colSpan={8} className="muted">
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
            ) : null}

            {report.kind === "monthly" && monthlyWeather.length ? (
              <>
                <h3 className="report-sec">Weather monitoring</h3>
                <table className="report-table report-wx-monthly">
                  <thead>
                    <tr>
                      <th>Station</th>
                      <th className="num">Hours logged</th>
                      <th className="num">Max temp °C</th>
                      <th className="num">Max heat index</th>
                      <th>Category</th>
                      <th className="num">Max wind m/s</th>
                      <th className="num">Max humidity %</th>
                      <th className="num">Max PM10</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyWeather.map((row) => (
                      <tr key={row.station}>
                        <td>{row.station}</td>
                        {row.hoursLogged > 0 ? (
                          <>
                            <td className="num">{row.hoursLogged}</td>
                            <td className="num">{row.maxTemp}</td>
                            <td className="num">
                              <b>{row.maxHeatIndex}</b>
                            </td>
                            <td>{row.category.name}</td>
                            <td className="num">{row.maxWind}</td>
                            <td className="num">{row.maxHumidity}</td>
                            <td className="num">{row.maxPm10}</td>
                          </>
                        ) : (
                          <td colSpan={7} className="muted">
                            No readings logged this month
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : null}

            <h3 className="report-sec">Record details</h3>
            <table className="report-table">
              <thead>
                <tr>
                  <th>Case ID</th>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Scope</th>
                  <th>Risk</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {visibleCases.length ? (
                  visibleCases.map((row) => (
                    <tr key={row.id}>
                      <td className="mono">{row.case_id}</td>
                      <td>{formatDay(row.date)}</td>
                      <td>{TYPE_FULL[row.record_type] ?? row.record_type}</td>
                      <td>{scopeOf(row)}</td>
                      <td>
                        {row.record_type === "sos" ? "NA" : row.risk_level || "—"}
                      </td>
                      <td>{statusLabel(row.status)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6}>No records in this period.</td>
                  </tr>
                )}
              </tbody>
            </table>
            {truncatedMonthly ? (
              <p className="report-truncation-note">
                Showing {visibleCases.length} of {sortedCases.length}. The full log is in the
                Excel export.
              </p>
            ) : null}

            {report.kind === "weekly" ? (
              <>
                <h3 className="report-sec">Overdue items</h3>
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>Case ID</th>
                      <th>Type</th>
                      <th>Risk</th>
                      <th>Status</th>
                      <th>Scope</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overdueRows.length ? (
                      overdueRows.map((row) => (
                        <tr key={row.id}>
                          <td className="mono">{row.case_id}</td>
                          <td>{TYPE_FULL[row.record_type] ?? row.record_type}</td>
                          <td>{row.record_type === "sos" ? "NA" : row.risk_level || "—"}</td>
                          <td>{statusLabel(row.status)}</td>
                          <td>{scopeOf(row)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={5}>No overdue items in this period.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </>
            ) : null}

            <div className="report-signoff">
              <div className="report-signoff-card">
                <span>Prepared by</span>
                <p>SCC Platform · auto</p>
                <b>System compiled</b>
                <small>—</small>
              </div>
              <div className="report-signoff-card">
                <span>Reviewed &amp; signed · Dept HSE</span>
                {report.kind === "weekly" && report.packet?.signed ? (
                  <>
                    <p>{report.packet.signed.by || "Dept HSE"}</p>
                    <b>Signed</b>
                    <small>
                      {report.packet.signed.at
                        ? formatDay(report.packet.signed.at)
                        : "—"}
                    </small>
                  </>
                ) : (
                  <b className="muted-strong">
                    {report.kind === "weekly"
                      ? "Awaiting Dept HSE signature"
                      : "Weekly reports signed"}
                  </b>
                )}
              </div>
              <div className="report-signoff-card">
                <span>Issued to · Project PM</span>
                {report.kind === "monthly" && report.packet?.issued ? (
                  <>
                    <p>{report.packet.issued.to || "Project PM"}</p>
                    <b>Issued</b>
                    <small>
                      {report.packet.issued.at
                        ? formatDay(report.packet.issued.at)
                        : "—"}
                    </small>
                  </>
                ) : (
                  <b className="muted-strong">
                    {report.kind === "monthly"
                      ? "Ready to issue / awaiting issue"
                      : "Monthly report only"}
                  </b>
                )}
              </div>
            </div>
          </article>
        </div>
      </div>
    </div>
  );

  return createPortal(ui, document.body);
}

export function ReportsScreen() {
  const { user } = useAuth();
  const [data, setData] = useState<ReportsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ReportTab>("daily");
  const [acting, setActing] = useState(false);
  const [viewing, setViewing] = useState<BuiltReport | null>(null);
  const [viewingWeather, setViewingWeather] = useState<WeeklyWeatherLog | null>(null);
  const [weatherLogs, setWeatherLogs] = useState<WeeklyWeatherLog[]>([]);

  const loadReports = useCallback(() => {
    fetchReports()
      .then(setData)
      .catch((err) => setError(errorMessage(err)));
  }, []);

  const loadWeatherLogs = useCallback(() => {
    fetchWeatherWeeklyLogs()
      .then((res) => setWeatherLogs(res.items.map(asWeeklyLog)))
      .catch(() => setWeatherLogs([]));
  }, []);

  useEffect(() => {
    loadReports();
    loadWeatherLogs();
  }, [loadReports, loadWeatherLogs]);

  useEffect(() => {
    const onSettings = () => loadReports();
    window.addEventListener("scc-settings-changed", onSettings);
    return () => window.removeEventListener("scc-settings-changed", onSettings);
  }, [loadReports]);

  const cases = data?.details ?? [];
  const packets = data?.packets ?? [];
  const schedule = useMemo(
    () => scheduleFromSettings(data?.settings ?? null),
    [data?.settings],
  );
  const catalogProjects = useMemo(() => {
    // Catalog projects from the reports payload (always one monthly per project).
    const fromSummary = (data?.by_project ?? [])
      .map((row) => String(row.project || "").trim())
      .filter(Boolean);
    if (fromSummary.length) return fromSummary;
    return [
      ...new Set(
        packets
          .filter((p) => p.kind === "monthly" && p.scope)
          .map((p) => String(p.scope).trim()),
      ),
    ];
  }, [data?.by_project, packets]);
  // Weekly/monthly only — daily stays all-project for every operator.
  const projectAccess = useProjectAccess(catalogProjects);
  const projectNames = useMemo(() => {
    if (projectAccess.isProjectScoped) return projectAccess.accessProjects;
    return catalogProjects.slice(0, 4);
  }, [projectAccess.isProjectScoped, projectAccess.accessProjects, catalogProjects]);

  const daily = useMemo(
    () => buildDailyReports(cases, packets, new Date(), schedule.dailyAt),
    [cases, packets, schedule.dailyAt],
  );
  const weekly = useMemo(
    () => buildWeeklyReports(packets, cases, projectNames),
    [packets, cases, projectNames],
  );
  const monthly = useMemo(
    () => buildMonthlyReports(packets, cases, projectNames),
    [packets, cases, projectNames],
  );
  const [viewingWeatherLog, setViewingWeatherLog] = useState<WeeklyWeatherLog | null>(null);

  useEffect(() => {
    if (!viewing || viewing.kind !== "weekly") {
      setViewingWeatherLog(null);
      return;
    }
    const existing = weatherLogs.find(
      (log) => log.project === viewing.scope && log.weekStartIso === viewing.periodIso,
    );
    if (existing) {
      setViewingWeatherLog(existing);
      return;
    }
    let cancelled = false;
    fetchWeatherWeeklyPreview(viewing.scope, viewing.periodIso)
      .then((dto) => {
        if (!cancelled) setViewingWeatherLog(asWeeklyLog(dto));
      })
      .catch(() => {
        if (!cancelled) setViewingWeatherLog(null);
      });
    return () => {
      cancelled = true;
    };
  }, [viewing, weatherLogs]);

  const viewingDailyWeather = useMemo(() => {
    if (!viewing || viewing.kind !== "daily") return [];
    const projects =
      projectNames.length > 0
        ? projectNames
        : ["Jafurah", "MGS", "Yanbu", "Ras Tanura"];
    return buildDailyWeatherTables(viewing.periodIso, projects);
  }, [viewing, projectNames]);

  const viewingMonthlyWeather = useMemo(() => {
    if (!viewing || viewing.kind !== "monthly") return [];
    const endIso = viewing.periodEndIso || viewing.periodIso;
    return buildMonthlyWeatherMaxes(viewing.scope, viewing.periodIso, endIso);
  }, [viewing]);

  const awaitingSign = weekly.filter((r) => r.statusTone === "awaiting").length;
  const readyIssue = monthly.filter((r) => /ready/i.test(r.status)).length;

  const rows = tab === "daily" ? daily : tab === "weekly" ? weekly : monthly;

  if (error) return <p className="state error">{error}</p>;
  if (!data) return <p className="state">Loading reports…</p>;

  return (
    <section className="page v1-dash reports-v1">
      <section className="v1-banner">
        <div className="v1-banner-icon">
          <ReportDocIcon />
        </div>
        <div className="v1-banner-copy">
          <h1>
            SCC <em>REPORTS</em>
          </h1>
          <p>
            Auto-generated daily, weekly and monthly <i>•</i> Signed by Dept HSE{" "}
            <i>•</i> Issued to Project PM
          </p>
        </div>
      </section>

      <div className="v1-grid g4 reports-flow">
        <article className="v1-kpi">
          <div className="t">Daily · {schedule.dailyAt}</div>
          <div className="v" style={{ fontSize: 18 }}>
            System compiles the daily log
          </div>
          <div className="s">Every record registered that day · all projects</div>
        </article>
        <article className="v1-kpi">
          <div className="t">Weekly · {schedule.weeklyDay}</div>
          <div className="v" style={{ fontSize: 18 }}>
            Weekly log compiled per project
          </div>
          <div className="s">Daily logs + weekly weather log · Sunday to Saturday</div>
        </article>
        <article className="v1-kpi">
          <div className="t">Sign-off</div>
          <div className="v" style={{ fontSize: 18 }}>
            Dept HSE signs the weekly report
          </div>
          <div className="s">
            {awaitingSign} weekly report{awaitingSign === 1 ? "" : "s"} awaiting signature
          </div>
        </article>
        <article className="v1-kpi">
          <div className="t">Monthly · day {schedule.monthlyDay}</div>
          <div className="v" style={{ fontSize: 18 }}>
            Issued to the Project PM
          </div>
          <div className="s">
            Once every weekly report of the month is signed · {readyIssue} ready
          </div>
        </article>
      </div>

      <div className="reports-tabs" role="tablist" aria-label="Report period">
        {(
          [
            ["daily", "Daily reports", daily.length],
            ["weekly", "Weekly reports", weekly.length],
            ["monthly", "Monthly reports", monthly.length],
          ] as const
        ).map(([id, label, count]) => (
          <button
            key={id}
            type="button"
            role="tab"
            className={tab === id ? "on" : undefined}
            aria-selected={tab === id}
            onClick={() => setTab(id)}
          >
            {label} <em>{count}</em>
          </button>
        ))}
      </div>

      <article className="v1-card table-panel review-table-card">
        {!rows.length ? (
          <p className="state">No {tab} reports yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="tbl review-tbl reports-tbl">
              <thead>
                <tr>
                  <th>Report no.</th>
                  <th>Period</th>
                  <th>Scope</th>
                  <th>Records</th>
                  <th>Open</th>
                  <th>Overdue</th>
                  <th>Generated</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <span className="id">{row.id}</span>
                    </td>
                    <td>{row.periodLabel}</td>
                    <td>{row.scope}</td>
                    <td>{row.records}</td>
                    <td>{row.open}</td>
                    <td>
                      {row.overdue > 0 ? (
                        <button
                          type="button"
                          className="linkish overdue-link"
                          onClick={() => openNotificationsPanel("over")}
                        >
                          {row.overdue}
                        </button>
                      ) : (
                        0
                      )}
                    </td>
                    <td className="muted">{row.generatedLabel}</td>
                    <td>
                      <span className={`report-status ${row.statusTone}`}>{row.status}</span>
                    </td>
                    <td>
                      <div className="reports-row-actions">
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => setViewing(row)}
                        >
                          View
                        </button>
                        {row.kind === "weekly" &&
                        row.statusTone === "awaiting" &&
                        !row.packet?.signed &&
                        user?.role === "dept_hse" &&
                        user.capabilities.sign_reports ? (
                          <button
                            type="button"
                            className="btn sm primary"
                            disabled={acting}
                            onClick={() => {
                              setActing(true);
                              signReport(row.id, formatUserLabel(user))
                                .then(() => loadReports())
                                .catch((err) => setError(errorMessage(err)))
                                .finally(() => setActing(false));
                            }}
                          >
                            Sign as Dept HSE
                          </button>
                        ) : null}
                        {row.kind === "monthly" &&
                        /ready/i.test(row.status) &&
                        user?.capabilities.issue_reports ? (
                          <button
                            type="button"
                            className="btn sm primary"
                            disabled={acting}
                            onClick={() => {
                              setActing(true);
                              issueReport(row.id)
                                .then(() => loadReports())
                                .catch((err) => setError(errorMessage(err)))
                                .finally(() => setActing(false));
                            }}
                          >
                            <IssueIcon /> Issue
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>

      <section className="reports-wx-section">
        <div className="reports-wx-head">
          <h2>Weekly weather logs</h2>
          <p>Submitted from Weather Monitoring and attached to each project&apos;s weekly report.</p>
        </div>
        {!weatherLogs.length ? (
          <p className="state">No weekly weather logs yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="tbl review-tbl reports-tbl reports-wx-tbl">
              <thead>
                <tr>
                  <th>Log no.</th>
                  <th>Project</th>
                  <th>Week</th>
                  <th>Hours logged</th>
                  <th>Max temp</th>
                  <th>Max humidity</th>
                  <th>Max heat index</th>
                  <th>Highest category</th>
                  <th>Submitted by</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {weatherLogs.map((log) => (
                  <tr
                    key={log.id}
                    className="clk"
                    onClick={() => setViewingWeather(log)}
                  >
                    <td>
                      <span className="id">{log.id}</span>
                    </td>
                    <td>{log.project}</td>
                    <td>{log.weekLabel}</td>
                    <td>
                      {log.hoursLogged} / {log.hoursExpected}
                    </td>
                    <td>{log.maxTemp}°C</td>
                    <td>{log.maxHumidity}%</td>
                    <td>
                      <b>{log.maxHeatIndex}</b>
                    </td>
                    <td>
                      <span className={`hicat c${log.highestCategory.level}`}>
                        {log.highestCategory.name}
                      </span>
                    </td>
                    <td>
                      {log.submittedBy}
                      <br />
                      <small className="muted">{log.submittedAtLabel}</small>
                    </td>
                    <td>
                      <span className="report-status signed">Attached to weekly report</span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setViewingWeather(log);
                        }}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {viewing ? (
        <ReportViewer
          report={viewing}
          weatherLog={viewingWeatherLog}
          dailyWeather={viewingDailyWeather}
          monthlyWeather={viewingMonthlyWeather}
          onClose={() => setViewing(null)}
        />
      ) : null}
      {viewingWeather ? (
        <WeatherLogViewer log={viewingWeather} onClose={() => setViewingWeather(null)} />
      ) : null}
    </section>
  );
}
