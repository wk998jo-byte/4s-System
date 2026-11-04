import { ApiError } from "../api/types";

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const extras = error.details
      .map((item) => item.message || `${item.field}: ${item.code}`)
      .filter(Boolean);
    return extras.length ? `${error.message} ${extras.join(" ")}` : error.message;
  }
  if (error instanceof Error) return error.message;
  return "Unexpected error.";
}
