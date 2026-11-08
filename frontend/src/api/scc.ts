import { getApiBaseUrl, joinUrl } from "./client";
import { request } from "./http";

export interface ListItem {
  id: string;
  label: string;
  is_active: boolean;
  sort_order: number;
}

export interface CaseSummary {
  id: string;
  case_id: string;
  record_type: string;
  status: string;
  project: string | null;
  department: string | null;
  title: string;
  date: string;
  week_number: number;
  risk_level: string | null;
  created_at: string;
  fields?: Record<string, unknown>;
}

export interface CaseDetail extends CaseSummary {
  fields: Record<string, unknown>;
  prototype?: boolean;
}

export interface DashboardOverview {
  prototype: boolean;
  period: string;
  view: string;
  project: string | null;
  department: string | null;
  period_start: string;
  period_end: string;
  projects: string[];
  departments: string[];
  generated_at: string;
  kpis: Record<string, number>;
  by_status: Record<string, number>;
  by_project: Record<string, number>;
  by_department: Record<string, number>;
  series_8_weeks: Array<Record<string, number>>;
  needs_attention: {
    confirm_driver: { count: number; case_id: string | null };
    admin_review: { count: number; case_id: string | null };
    open_sos: { count: number; case_id: string | null };
    ai_camera_open_over_7_days: { count: number; case_id: string | null };
  };
  latest: CaseSummary[];
  weather_summary: {
    project: string | null;
    location: string | null;
    observed_on: string | null;
    scope?: "all" | "project";
    wind_speed_ms: number | null;
    temperature_c: number | null;
    rh_percent: number | null;
    heat_index: number | null;
  } | null;
  category: Record<string, Record<string, unknown>>;
}

export const fetchList = (type: string, options?: { includeInactive?: boolean }) => {
  const query = options?.includeInactive ? "?include_inactive=true" : "";
  return request<{ list_type: string; items: ListItem[]; notes?: string }>(
    `/api/v1/lists/${type}${query}`,
  );
};

export const addListItem = (type: string, label: string) =>
  request<ListItem>(`/api/v1/lists/${type}/items`, {
    method: "POST",
    body: JSON.stringify({ label }),
  });

export const updateListItem = (
  type: string,
  id: string,
  body: { label: string; is_active?: boolean },
) =>
  request<ListItem>(`/api/v1/lists/${type}/items/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

export const deleteListItem = (type: string, id: string) =>
  request<{ ok: boolean }>(`/api/v1/lists/${type}/items/${id}`, {
    method: "DELETE",
  });

export const fetchCases = (params: Record<string, string | undefined> = {}) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) query.set(key, value);
  });
  const suffix = query.toString() ? `?${query}` : "";
  return request<{ items: CaseSummary[]; total: number }>(`/api/v1/cases${suffix}`);
};

export const fetchCase = (id: string) =>
  request<CaseDetail>(`/api/v1/cases/${id}`);

export const postJson = <T,>(path: string, body: unknown) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body) });

export type UploadResult = {
  url: string;
  filename: string;
  stored_name: string;
  content_type: string;
  size: number;
};

/** Upload an image; returns a public `/uploads/...` path stored on the case. */
export const uploadImage = (file: File) => {
  const body = new FormData();
  body.append("file", file);
  return request<UploadResult>("/api/v1/uploads", { method: "POST", body });
};

/**
 * Turn a stored picture field into an `<img src>`.
 * Real uploads are `/uploads/...`; older prototype rows only stored a filename.
 */
export function resolveMediaUrl(value: string | null | undefined): string | null {
  const v = (value || "").trim();
  if (!v) return null;
  if (
    v.startsWith("data:") ||
    v.startsWith("blob:") ||
    /^https?:\/\//i.test(v)
  ) {
    return v;
  }
  if (v.startsWith("/uploads/") || v.startsWith("/api/")) {
    return joinUrl(getApiBaseUrl(), v);
  }
  return null;
}

export const putJson = <T,>(path: string, body: unknown) =>
  request<T>(path, { method: "PUT", body: JSON.stringify(body) });

export const fetchOverview = (params: {
  period?: string;
  view?: string;
  project?: string;
  department?: string;
  start_date?: string;
  end_date?: string;
} = {}) => {
  const query = new URLSearchParams();
  query.set("period", params.period ?? "this_week");
  query.set("view", params.view ?? "overall");
  if (params.project) query.set("project", params.project);
  if (params.department) query.set("department", params.department);
  if (params.start_date) query.set("start_date", params.start_date);
  if (params.end_date) query.set("end_date", params.end_date);
  return request<DashboardOverview>(`/api/v1/dashboard/overview?${query}`);
};

export const fetchWeather = () =>
  request<{ sheets: WeatherSheet[] }>("/api/v1/weather");

export interface WeatherHourlyCell {
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
}

export interface WeatherHourlyTable {
  stationId: string;
  project: string;
  location: string;
  tableIndex: number;
  tableCount: number;
  dateIso: string;
  hours: WeatherHourlyCell[];
}

export interface WeatherWeeklyDayDto {
  dateIso: string;
  dayLabel: string;
  hoursLogged: number;
  hoursExpected: number;
  wind: number;
  temp: number;
  rh: number;
  co2: number;
  pm10: number;
  heatIndex: number;
  category: { level: number; name: string; prevention: string };
}

export interface WeatherWeeklyLogDto {
  id: string;
  project: string;
  week: number;
  weekYear?: number;
  weekStartIso: string;
  weekEndIso: string;
  weekLabel: string;
  location: string;
  stationCount: number;
  hoursLogged: number;
  hoursExpected: number;
  maxTemp: number;
  maxHumidity: number;
  maxHeatIndex: number;
  highestCategory: { level: number; name: string; prevention: string };
  remarks: string;
  submittedBy: string;
  submittedAtLabel: string;
  daysByStation: Array<{
    location: string;
    tableIndex: number;
    tableCount: number;
    days: WeatherWeeklyDayDto[];
  }>;
  submitted?: boolean;
}

export const fetchWeatherHourly = (project: string, observedOn: string) =>
  request<{ project: string; observed_on: string; tables: WeatherHourlyTable[] }>(
    `/api/v1/weather/hourly?project=${encodeURIComponent(project)}&observed_on=${encodeURIComponent(observedOn)}`,
  );

export interface WeatherDayMaxDto {
  stationId: string;
  project: string;
  location: string;
  dateIso: string;
  dayLabel: string;
  hoursLogged: number;
  hoursExpected: number;
  wind: number;
  temp: number;
  rh: number;
  co2: number;
  pm25: number;
  pm10: number;
  heatIndex: number;
  peakHour?: number;
  category: { level: number; name: string; prevention: string };
}

export const fetchWeatherDayMaxes = (dateFrom: string, dateTo: string, project?: string) => {
  const params = new URLSearchParams({
    date_from: dateFrom,
    date_to: dateTo,
  });
  if (project && project !== "All") params.set("project", project);
  return request<{ items: WeatherDayMaxDto[] }>(`/api/v1/weather/day-maxes?${params.toString()}`);
};

export const saveWeatherHourly = (body: {
  station_id: string;
  project: string;
  location: string;
  observed_on: string;
  logged_by?: string;
  readings: Array<{
    hour: number;
    wind?: number | null;
    temp?: number | null;
    rh?: number | null;
    co2?: number | null;
    pm25?: number | null;
    pm10?: number | null;
    heat_index?: number | null;
    remarks?: string | null;
    status?: string;
    logged_by?: string | null;
  }>;
}) =>
  request<{ tables: WeatherHourlyTable[] }>("/api/v1/weather/hourly", {
    method: "PUT",
    body: JSON.stringify(body),
  });

export const fetchWeatherWeeklyLogs = (project?: string) =>
  request<{ items: WeatherWeeklyLogDto[] }>(
    project
      ? `/api/v1/weather/weekly?project=${encodeURIComponent(project)}`
      : "/api/v1/weather/weekly",
  );

export const fetchWeatherWeeklyPreview = (project: string, weekStart: string) =>
  request<WeatherWeeklyLogDto>(
    `/api/v1/weather/weekly/preview?project=${encodeURIComponent(project)}&week_start=${encodeURIComponent(weekStart)}`,
  );

export const submitWeatherWeekly = (body: {
  project: string;
  week_start: string;
  remarks?: string;
  submitted_by?: string;
}) =>
  request<WeatherWeeklyLogDto>("/api/v1/weather/weekly", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const fetchContacts = (projectId?: string) =>
  request<{ items: ContactRow[] }>(
    projectId ? `/api/v1/contacts?project_id=${projectId}` : "/api/v1/contacts",
  );

export const createContact = (body: {
  project_id: string;
  category: string;
  name: string;
  job_title?: string;
  role?: string;
  contact_number?: string;
  email?: string;
}) =>
  request<ContactRow>("/api/v1/contacts", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const updateContact = (
  id: string,
  body: {
    category: string;
    name: string;
    job_title?: string | null;
    role?: string | null;
    contact_number?: string | null;
    email?: string | null;
  },
) =>
  request<ContactRow>(`/api/v1/contacts/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

export const deleteContact = (id: string) =>
  request<{ ok: boolean }>(`/api/v1/contacts/${id}`, { method: "DELETE" });

export const fetchHw = () => request<HwPayload>("/api/v1/hw");

export interface HwRegisterItem {
  id: string;
  device: string;
  system: string;
  serial: string;
  status: string;
  project: string;
  lastSignal?: string | null;
  updatedIso?: string;
}

export interface HwRegisterImportResult {
  imported: number;
  added: number;
  updated: number;
  skipped_errors: string[];
  items: HwRegisterItem[];
  hw: HwPayload;
}

export const fetchHwRegister = () =>
  request<{ items: HwRegisterItem[]; total: number }>("/api/v1/hw/register");

export async function downloadHwRegisterTemplate() {
  const { getToken } = await import("../auth/session");
  const { getApiBaseUrl, joinUrl } = await import("./client");
  const token = getToken();
  const response = await fetch(
    joinUrl(getApiBaseUrl(), "/api/v1/hw/register/template"),
    {
      headers: {
        Accept:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    },
  );
  if (!response.ok) {
    throw new Error("Could not download the HW template.");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "SCC_HW_Device_Register_Template.xlsx";
  a.click();
  URL.revokeObjectURL(url);
}

export const importHwRegister = (file: File) => {
  const body = new FormData();
  body.append("file", file);
  return request<HwRegisterImportResult>("/api/v1/hw/register/import", {
    method: "POST",
    body,
  });
};
export interface AssetItem {
  asset_number: string;
  asset_category: string;
  asset_type: string;
}

export interface AssetMetaCategory {
  label: string;
  types: string[];
}

export const fetchAssets = (params?: {
  q?: string;
  category?: string;
  asset_type?: string;
}) => {
  const query = new URLSearchParams();
  if (params?.q) query.set("q", params.q);
  if (params?.category) query.set("category", params.category);
  if (params?.asset_type) query.set("asset_type", params.asset_type);
  const qs = query.toString();
  return request<{
    items: AssetItem[];
    meta: { count: number; categories: AssetMetaCategory[] };
  }>(`/api/v1/assets${qs ? `?${qs}` : ""}`);
};

export const fetchReports = () => request<ReportsPayload>("/api/v1/reports");
export const fetchPerformance = (
  params: {
    period?: string;
    start_date?: string;
    end_date?: string;
    operator?: string;
    record_type?: string;
    project?: string;
    action?: string;
  } = {},
) => {
  const query = new URLSearchParams();
  query.set("period", params.period ?? "this_week");
  if (params.start_date) query.set("start_date", params.start_date);
  if (params.end_date) query.set("end_date", params.end_date);
  if (params.operator) query.set("operator", params.operator);
  if (params.record_type) query.set("record_type", params.record_type);
  if (params.project) query.set("project", params.project);
  if (params.action) query.set("action", params.action);
  return request<PerformancePayload>(`/api/v1/operator-performance?${query}`);
};

export const closeSos = (id: string, body: unknown) =>
  request<CaseDetail>(`/api/v1/sos-alerts/${id}/close`, {
    method: "POST",
    body: JSON.stringify(body),
  });

export const closeOutAiCamera = (id: string, body: unknown) =>
  request<CaseDetail>(`/api/v1/ai-camera-observations/${id}/close-out`, {
    method: "POST",
    body: JSON.stringify(body),
  });

export const confirmDriver = (
  kind: "dashcam" | "speed",
  id: string,
  body: unknown,
) =>
  request<CaseDetail>(
    kind === "dashcam"
      ? `/api/v1/dashcam-observations/${id}/confirm-driver`
      : `/api/v1/speed-violations/${id}/confirm-driver`,
    { method: "POST", body: JSON.stringify(body) },
  );

export const updateItqanStatus = (id: string, itqan_status_id: string) =>
  request<CaseDetail>(`/api/v1/itqan-violations/${id}/status`, {
    method: "POST",
    body: JSON.stringify({ itqan_status_id }),
  });

export const fetchCatalog = () =>
  request<{ types: string[]; notes: Record<string, string> }>("/api/v1/lists");

export const updateCase = (
  id: string,
  body: {
    project?: string | null;
    department?: string | null;
    title?: string | null;
    occurred_on?: string | null;
    risk_level?: string | null;
    fields?: Record<string, unknown>;
  },
) =>
  request<CaseDetail>(`/api/v1/cases/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

export const approveCase = (id: string) =>
  request<CaseDetail>(`/api/v1/cases/${id}/approve`, { method: "POST" });

export const rejectCase = (id: string, reason: string) =>
  request<CaseDetail>(`/api/v1/cases/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });

export const deleteCase = (id: string) =>
  request<{ ok: boolean }>(`/api/v1/cases/${id}/delete`, {
    method: "POST",
    body: JSON.stringify({ confirm: true }),
  });

export const fetchUsers = () =>
  request<{
    items: Array<{
      id: string;
      username: string;
      display_name: string;
      badge_number: string | null;
      role: string;
      projects?: string[] | null;
    }>;
  }>("/api/v1/admin/users");

export const createUser = (body: {
  username: string;
  password: string;
  display_name: string;
  badge_number: string;
  role: string;
  projects?: string[] | null;
}) => request("/api/v1/admin/users", { method: "POST", body: JSON.stringify(body) });

export const updateUser = (
  id: string,
  body: {
    username: string;
    display_name: string;
    badge_number: string;
    role: string;
    password?: string | null;
    projects?: string[] | null;
  },
) =>
  request<{
    id: string;
    username: string;
    display_name: string;
    badge_number: string | null;
    role: string;
    projects?: string[] | null;
  }>(`/api/v1/admin/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

export const deleteUser = (id: string) =>
  request<{ ok: boolean }>(`/api/v1/admin/users/${id}/delete`, {
    method: "POST",
    body: JSON.stringify({ confirm: true }),
  });

export const fetchPermissionMatrix = () =>
  request<{
    items: Array<{
      capability: string;
      operator: boolean;
      admin: boolean;
      dept_hse?: boolean;
      receiver?: boolean;
    }>;
  }>("/api/v1/admin/permission-matrix");

export interface AuditLogItem {
  id: string;
  occurred_at: string | null;
  actor_user_id: string | null;
  actor_name: string;
  action: string;
  category: string;
  summary: string;
  details: Record<string, unknown>;
  case_id: string | null;
}

export const fetchAuditLog = (limit = 200) =>
  request<{ items: AuditLogItem[] }>(`/api/v1/admin/audit-log?limit=${limit}`);

export interface WeatherSheet {
  slot: number;
  project_id: string | null;
  project: string | null;
  location: string | null;
  observed_on: string | null;
  week_number: number | null;
  readings: Array<Record<string, string | number | null>>;
}

export interface ContactRow {
  id: string;
  project_id: string;
  project: string;
  category: string;
  name: string;
  job_title?: string;
  role?: string;
  contact_number?: string;
  email?: string;
}

export interface HwPayload {
  last_updated_at: string | null;
  project_counts: Record<string, Record<string, number>>;
  project_totals: Record<string, number>;
  all_projects: number;
  department_counts: Record<string, Record<string, number>>;
}

export interface ReportPacket {
  id: string;
  kind: string;
  scope: string;
  label: string;
  status: string;
  a: string;
  b: string;
  generated_at?: string | null;
  signed?: { by: string; signature: string; at: string } | null;
  issued?: { by: string; to: string; at: string } | null;
}

export interface ReportsPayload {
  by_project: Array<Record<string, string | number>>;
  by_department: Array<Record<string, string | number>>;
  details: CaseSummary[];
  packets?: ReportPacket[];
  settings?: Record<string, unknown>;
}

export const signReport = (id: string, signature = "") =>
  request<ReportPacket>(
    `/api/v1/reports/${encodeURIComponent(id)}/sign?signature=${encodeURIComponent(signature)}`,
    { method: "POST" },
  );

export const issueReport = (id: string, recipient = "Project PM") =>
  request<ReportPacket>(
    `/api/v1/reports/${encodeURIComponent(id)}/issue?recipient=${encodeURIComponent(recipient)}`,
    { method: "POST" },
  );

export type OverdueNotificationItem = {
  id: string;
  case_id: string;
  record_type: string;
  record_label?: string;
  project?: string | null;
  department?: string | null;
  location?: string | null;
  risk_level?: string;
  risk_key?: string;
  status?: string;
  status_label?: string;
  state: "soon" | "over" | "esc" | string;
  state_label?: string;
  detail?: string;
  age_hours: number;
  over_hours?: number;
  left_hours?: number;
  deadline_hours?: number;
};

export const fetchOverdueNotifications = () =>
  request<{
    items: OverdueNotificationItem[];
    counts: { esc: number; over: number; soon: number; all: number };
    deadlines?: {
      High?: number;
      Medium?: number;
      Low?: number;
      SOS?: number;
      dueSoon?: number;
      escalate?: number;
    };
  }>("/api/v1/notifications/overdue");

/** Tell the shell to refresh the notifications badge / panel. */
export function notifyCasesChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("scc-cases-changed"));
  }
}

/** Open the shell notifications panel, optionally on a specific tab. */
export function openNotificationsPanel(
  tab: "all" | "esc" | "over" | "soon" = "all",
) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("scc-open-notifications", { detail: { tab } }),
    );
  }
}

export const fetchPlatformSettings = () =>
  request<Record<string, unknown>>("/api/v1/admin/settings");

/** SafeLife / ITQAN form toggles — available to every signed-in role. */
export const fetchIntegrationSettings = () =>
  request<{
    safelifeAsk: boolean;
    safelifeDefault: boolean;
    itqanAsk: boolean;
    itqanDefault: boolean;
  }>("/api/v1/settings/integrations");

export const savePlatformSettings = (body: Record<string, unknown>) =>
  request<Record<string, unknown>>("/api/v1/admin/settings", {
    method: "PUT",
    body: JSON.stringify(body),
  });

/** Tell forms to reload SafeLife / ITQAN admin toggles. */
export function notifySettingsChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("scc-settings-changed"));
  }
}

export const fetchHwTransfers = () =>
  request<{ items: Array<Record<string, unknown>>; register: Array<Record<string, unknown>> }>(
    "/api/v1/hw/transfers",
  );

export const receiveHwTransfer = (id: string) =>
  request<Record<string, unknown>>(`/api/v1/hw/transfers/${encodeURIComponent(id)}/receive`, {
    method: "POST",
  });

export interface PerformancePayload {
  period: string;
  period_start: string;
  period_end: string;
  compare_start: string;
  compare_end: string;
  kpis: Record<
    string,
    { value: number; delta: number; hint: string }
  >;
  series_8_weeks: Array<Record<string, number>>;
  operators: Array<{
    operator: string;
    badge_number: string | null;
    ai_camera: number;
    dashcam: number;
    speed: number;
    sos: number;
    uploaded: number;
    close_outs: number;
    registered: number;
    total_actions: number;
    last_activity: string | null;
  }>;
  activity: Array<{
    at: string;
    operator: string;
    action: string;
    case_id: string;
    details: string;
  }>;
  filters: {
    operators: string[];
    projects: string[];
    actions: string[];
    record_types: Array<{ id: string; label: string }>;
  };
}
