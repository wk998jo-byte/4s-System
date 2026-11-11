import { getToken } from "../auth/session";
import { ApiError, type ApiErrorBody } from "./types";
import { getApiBaseUrl, joinUrl } from "./client";

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = joinUrl(getApiBaseUrl(), path);
  const token = getToken();
  let response: Response;
  try {
    const isFormData =
      typeof FormData !== "undefined" && init?.body instanceof FormData;
    response = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body && !isFormData ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      "Cannot reach the API. Confirm the backend is running.",
    );
  }
  if (
    response.status === 401 &&
    !path.includes("/auth/login") &&
    !path.includes("/auth/password-recovery")
  ) {
    window.dispatchEvent(new Event("scc-unauthorized"));
  }
  if (!response.ok) {
    try {
      const body = (await response.json()) as ApiErrorBody;
      if (body?.error?.message) {
        throw new ApiError(
          response.status,
          body.error.code,
          body.error.message,
          body.error.details ?? [],
        );
      }
      const detail = (body as { detail?: string }).detail;
      if (detail) {
        throw new ApiError(response.status, "HTTP_ERROR", String(detail));
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
    }
    throw new ApiError(response.status, "HTTP_ERROR", `Request failed (${response.status})`);
  }
  return (await response.json()) as T;
}
