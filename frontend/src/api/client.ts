import type {
  DashboardSummary,
  HealthResponse,
  PrototypeRecord,
  PrototypeRecordCreate,
  PrototypeRecordList,
} from "./types";
import { ApiError, type ApiErrorBody } from "./types";

export function getApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";
  return raw.replace(/\/+$/, "");
}

export function joinUrl(base: string, path: string): string {
  const normalisedBase = base.replace(/\/+$/, "");
  const normalisedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalisedBase}${normalisedPath}`;
}

async function parseError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as ApiErrorBody;
    if (body?.error?.message) {
      return new ApiError(
        response.status,
        body.error.code,
        body.error.message,
        body.error.details ?? [],
      );
    }
  } catch {
    /* fall through */
  }
  return new ApiError(
    response.status,
    "HTTP_ERROR",
    `Request failed (${response.status})`,
  );
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = joinUrl(getApiBaseUrl(), path);
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      "Cannot reach the API. Confirm the backend is running on the configured URL.",
    );
  }
  if (!response.ok) {
    throw await parseError(response);
  }
  return (await response.json()) as T;
}

export function fetchHealth(): Promise<HealthResponse> {
  return request<HealthResponse>("/api/v1/health");
}

export function fetchDashboard(): Promise<DashboardSummary> {
  return request<DashboardSummary>("/api/v1/dashboard/summary");
}

export function fetchRecords(): Promise<PrototypeRecordList> {
  return request<PrototypeRecordList>("/api/v1/records?page=1&page_size=50");
}

export function fetchRecord(id: string): Promise<PrototypeRecord> {
  return request<PrototypeRecord>(`/api/v1/records/${id}`);
}

export function createRecord(
  payload: PrototypeRecordCreate,
): Promise<PrototypeRecord> {
  return request<PrototypeRecord>("/api/v1/records", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
