/** V1 Administration seed helpers and display maps. */

export const ADMIN_TABS = [
  { id: "audit", label: "Audit log" },
  { id: "rules", label: "Overdue & notifications" },
  { id: "integ", label: "SafeLife & ITQAN" },
  { id: "users", label: "Users & roles" },
  { id: "lists", label: "Dropdown lists" },
  { id: "sched", label: "Report schedule" },
] as const;

export type AdminTabId = (typeof ADMIN_TABS)[number]["id"];

export const ADMIN_ROLE_OPTIONS = [
  "Operator",
  "Admin",
  "Dept HSE",
  "Project PM",
] as const;

/** Core reporting projects (schedule / PM distribution). */
export const ADMIN_PROJECTS = ["Jafurah", "MGS", "Yanbu", "Ras Tanura"] as const;

/**
 * Project-access dialog options = reporting projects ∪ SCC HW sites
 * (V1 order so the 2-column grid matches the mock).
 */
export const ACCESS_PROJECTS = [
  "Jafurah",
  "MGS",
  "Yanbu",
  "Ras Tanura",
  "Dhahran",
  "Salasil",
  "Rig Move",
  "Medical Division",
  "Aramco Emergency Job",
  "Safaniya",
] as const;

export const ADMIN_PMS: Record<string, string> = {
  Jafurah: "[PM name], Jafurah Project",
  MGS: "[PM name], MGS Project",
  Yanbu: "[PM name], Yanbu Project",
  "Ras Tanura": "[PM name], Ras Tanura Project",
};

export const ROLE_PERMISSIONS: Array<{
  label: string;
  operator: boolean;
  admin: boolean;
  dept_hse: boolean;
  project_pm: boolean;
}> = [
  { label: "View dashboards", operator: true, admin: true, dept_hse: true, project_pm: true },
  { label: "Register records", operator: true, admin: true, dept_hse: false, project_pm: false },
  {
    label: "Submit close-out / Confirm Driver & Submit",
    operator: true,
    admin: true,
    dept_hse: false,
    project_pm: false,
  },
  { label: "Approve or return (Closed)", operator: false, admin: true, dept_hse: false, project_pm: false },
  { label: "Edit submitted records", operator: false, admin: true, dept_hse: false, project_pm: false },
  { label: "Delete records and users", operator: false, admin: true, dept_hse: false, project_pm: false },
  { label: "Sign weekly reports", operator: false, admin: false, dept_hse: true, project_pm: false },
  { label: "Sign monthly reports", operator: false, admin: false, dept_hse: false, project_pm: true },
  { label: "Issue monthly reports", operator: false, admin: true, dept_hse: false, project_pm: false },
  { label: "Receive monthly reports", operator: false, admin: false, dept_hse: false, project_pm: true },
  { label: "KPI dashboard", operator: false, admin: true, dept_hse: false, project_pm: false },
  { label: "Operator Performance", operator: false, admin: true, dept_hse: false, project_pm: false },
  { label: "Manage lists, users, rules", operator: false, admin: true, dept_hse: false, project_pm: false },
];

export type AuditRow = {
  id: string;
  at: number;
  by: string;
  mod: string;
  act: string;
  caseId: string;
  det: string;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtAdminDT(ms: number | string | null | undefined): string {
  if (ms == null || ms === "") return "—";
  const d = typeof ms === "number" ? new Date(ms) : new Date(ms);
  if (Number.isNaN(d.getTime())) return String(ms);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${h}:${m}`;
}

export function roleLabel(role: string): string {
  const map: Record<string, string> = {
    operator: "Operator",
    admin: "Admin",
    dept_hse: "Dept HSE",
    // Backend id is "receiver"; product label is Project PM (not a second role).
    receiver: "Project PM",
    project_pm: "Project PM",
  };
  return map[role] ?? role;
}

export function roleValue(label: string): string {
  const map: Record<string, string> = {
    Operator: "operator",
    Admin: "admin",
    "Dept HSE": "dept_hse",
    Receiver: "receiver",
    "Project PM": "receiver",
  };
  return map[label] ?? label.toLowerCase().replace(/\s+/g, "_");
}

export function moduleFromCategory(category: string, action: string, summary: string): string {
  const blob = `${category} ${action} ${summary}`.toLowerCase();
  if (/scc.?hw|hardware|transfer|inventory/.test(blob)) return "SCC HW";
  if (/speed/.test(blob)) return "Speed Violation";
  if (/ai.?camera|aic-/.test(blob)) return "AI Camera Observation";
  if (/dashcam|dcm-/.test(blob)) return "Dashcam Observation";
  if (/itqan|itq-/.test(blob)) return "ITQAN Violation";
  if (/sos/.test(blob)) return "SOS Alert";
  if (/user|role|access/.test(blob)) return "Users & access";
  if (/weather/.test(blob)) return "Weather Monitoring";
  if (/list/.test(blob)) return "Administration";
  return "Administration";
}

/** Demo audit rows matching V1 screenshots when the live log is empty. */
export function sampleAuditRows(now = Date.now()): AuditRow[] {
  const base = now;
  return [
    {
      id: "s1",
      at: base - 15 * 60_000,
      by: "Rayan Alghamdi",
      mod: "SCC HW",
      act: "SCC HW change",
      caseId: "Jafurah",
      det: "Jafurah • Smart Helmet • In Stock 80→85 • Receipt of TRF-0007 (from Warehouse, sent by Warehouse Keeper): 5 of 5 received.",
    },
    {
      id: "s2",
      at: base - 40 * 60_000,
      by: "Altayeb Altayeb",
      mod: "Speed Violation",
      act: "Approved and closed",
      caseId: "SPD-26-2038",
      det: "Speed Violation, Dept: Pipe Dolly",
    },
    {
      id: "s3",
      at: base - 55 * 60_000,
      by: "Rayan Alghamdi",
      mod: "AI Camera Observation",
      act: "Approved and closed",
      caseId: "AIC-26-0964",
      det: "AI Camera Observation, Jafurah",
    },
    {
      id: "s4",
      at: base - 70 * 60_000,
      by: "Rayan Alghamdi",
      mod: "Dashcam Observation",
      act: "Approved and closed",
      caseId: "DCM-26-0649",
      det: "Dashcam Observation, Jafurah",
    },
    {
      id: "s5",
      at: base - 90 * 60_000,
      by: "Altayeb",
      mod: "AI Camera Observation",
      act: "Approved and closed",
      caseId: "AIC-26-0949",
      det: "AI Camera Observation, Yanbu",
    },
    {
      id: "s6",
      at: base - 110 * 60_000,
      by: "ITQAN sync",
      mod: "ITQAN Violation",
      act: "Registered",
      caseId: "ITQ-26-1183",
      det: "ITQAN Violation, MGS",
    },
    {
      id: "s7",
      at: base - 130 * 60_000,
      by: "Turki",
      mod: "Speed Violation",
      act: "Close-out submitted",
      caseId: "SPD-26-2031",
      det: "Speed Violation, Dept: Logistics",
    },
    {
      id: "s8",
      at: base - 150 * 60_000,
      by: "Raghadah",
      mod: "Dashcam Observation",
      act: "Driver confirmed & ITQAN proof submitted",
      caseId: "DCM-26-0638",
      det: "Dashcam Observation, Ras Tanura",
    },
    {
      id: "s9",
      at: base - 180 * 60_000,
      by: "Rayan Alghamdi",
      mod: "SOS Alert",
      act: "SOS alert closed",
      caseId: "SOS-26-0412",
      det: "SOS Alert, Jafurah",
    },
    {
      id: "s10",
      at: base - 210 * 60_000,
      by: "Nawaz",
      mod: "AI Camera Observation",
      act: "Close-out submitted",
      caseId: "AIC-26-0933",
      det: "AI Camera Observation, MGS",
    },
  ];
}

export const DEFAULT_SETTINGS: Record<string, unknown> = {
  sla: {
    High: { hours: 24, label: "24 h" },
    Medium: { hours: 72, label: "3 days" },
    Low: { hours: 168, label: "7 days" },
    dueSoon: 0.75,
    escalate: 2,
  },
  safelifeDefault: true,
  itqanDefault: true,
  safelifeAsk: true,
  itqanAsk: true,
  notifyOperator: true,
  notifyAdmin: true,
  notifyHSE: true,
  dailyAt: "23:59",
  weeklyDay: "Saturday",
  monthlyDay: 1,
  reportTestEmail: "rose.subait@binquraya.com",
  reportHseEmail: "",
  reportHseName: "Dept HSE",
  reportDistribution: {
    Jafurah: { name: "[PM name], Jafurah Project", email: "" },
    MGS: { name: "[PM name], MGS Project", email: "" },
    Yanbu: { name: "[PM name], Yanbu Project", email: "" },
    "Ras Tanura": { name: "[PM name], Ras Tanura Project", email: "" },
  },
};

export const INTEG_STATS = {
  safelifeYes: 787,
  safelifeNo: 178,
  dashcamUpload: 555,
  speedUpload: 3657,
  itqanNo: 525,
};
